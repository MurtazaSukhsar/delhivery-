import { money } from '../../lib/format';
import { bandFromNumbers, budgetFor, dateInZone, fuelPriceFor, round3, timeInZone, type Delivery, type OrgSettings, type Payment, type Settlement, type Trip, type Vehicle, type VehicleCost } from '../../lib/domain';

export interface ReportData {
  from: string;
  to: string;
  today: string;
  deliveries: Delivery[];
  trips: Trip[];
  payments: Payment[];
  settlements: Settlement[];
  vehicle_costs: VehicleCost[];
  vehicles: Vehicle[];
  customers: { id: string; name: string }[];
  addresses: { id: string; area_id: string }[];
  areas: { id: string; name: string }[];
  drivers: { id: string; name: string }[];
  shifts: { user_id: string; at: string; action: string }[];
}

/**
 * All report figures, worked out in the browser from one read of the sheet.
 * The screen and the Excel file are both built from these tables, so they always agree.
 */

export type Kind = 'text' | 'money' | 'num' | 'km' | 'pct' | 'date';
export interface Col {
  key: string;
  label: string;
  kind: Kind;
  /** short help shown under the table */
  help?: string;
}
export type Cell = string | number | null;
export interface Table {
  id: string;
  title: string;
  note?: string;
  cols: Col[];
  rows: Record<string, Cell>[];
  /** totals row, same keys as rows */
  total?: Record<string, Cell>;
}
export interface Kpi {
  label: string;
  value: number;
  kind: Kind;
  sub?: string;
  tone?: 'good' | 'attention' | 'loss';
}

const costOf = (d: Pick<Delivery, 'trip_cost' | 'est_cost'>) => Number(d.trip_cost ?? d.est_cost) || 0;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

interface Agg {
  n: number;
  invoice: number;
  charged: number;
  cost: number;
  budget: number;
  loss: number;
}
const emptyAgg = (): Agg => ({ n: 0, invoice: 0, charged: 0, cost: 0, budget: 0, loss: 0 });
function add(a: Agg, d: Delivery, s: OrgSettings) {
  const c = costOf(d);
  a.n++;
  a.invoice += d.invoice_value;
  a.charged += d.delivery_charge;
  a.cost += c;
  a.budget += budgetFor(d.invoice_value, d.delivery_charge, s);
  if (bandFromNumbers(c, d.invoice_value, d.delivery_charge, s) === 'loss') a.loss++;
}
const MONEY_COLS: Col[] = [
  { key: 'n', label: 'Deliveries', kind: 'num' },
  { key: 'invoice', label: 'Invoice value', kind: 'money' },
  { key: 'charged', label: 'Charged', kind: 'money' },
  { key: 'cost', label: 'Delivery cost', kind: 'money' },
  { key: 'result', label: 'Charged − cost', kind: 'money', help: 'Negative means the delivery charges did not cover the cost.' },
  { key: 'cost_pct', label: 'Cost % of invoice', kind: 'pct' },
  { key: 'loss', label: 'Over budget', kind: 'num', help: 'Deliveries that cost more than the charge plus the allowed share of the invoice.' },
];
const aggRow = (a: Agg) => ({ n: a.n, invoice: round3(a.invoice), charged: round3(a.charged), cost: round3(a.cost), result: round3(a.charged - a.cost), cost_pct: ratio(a.cost, a.invoice), loss: a.loss });

function groupBy(list: Delivery[], key: (d: Delivery) => string, s: OrgSettings) {
  const m = new Map<string, Agg>();
  for (const d of list) {
    const k = key(d);
    const a = m.get(k) ?? emptyAgg();
    add(a, d, s);
    m.set(k, a);
  }
  return m;
}

export function buildReport(r: ReportData, s: OrgSettings) {
  const tz = s.time_zone || 'Asia/Muscat';
  const delivered = r.deliveries.filter((d) => d.status === 'delivered');
  const failed = r.deliveries.filter((d) => d.status === 'failed');
  const name = {
    customer: new Map(r.customers.map((c) => [c.id, c.name])),
    area: new Map(r.areas.map((a) => [a.id, a.name])),
    driver: new Map(r.drivers.map((x) => [x.id, x.name])),
    vehicle: new Map(r.vehicles.map((v) => [v.id, `${v.plate} ${v.type}`.trim()])),
  };
  const areaOfAddress = new Map(r.addresses.map((a) => [a.id, a.area_id]));
  const areaOf = (d: Delivery) => areaOfAddress.get(d.address_id) ?? '';

  // ---------- distance driven: planned trips, plus single deliveries outside a trip
  const tripKm = r.trips.reduce((a, t) => a + (Number(t.distance_km) || 0), 0);
  const soloKm = delivered.filter((d) => !d.trip_id).reduce((a, d) => a + (Number(d.est_distance_km) || 0), 0);
  const totalKm = tripKm + soloKm;
  const savedKm = r.trips.reduce((a, t) => a + Math.max(0, (Number(t.naive_distance_km) || 0) - (Number(t.distance_km) || 0)), 0);

  const all = emptyAgg();
  delivered.forEach((d) => add(all, d, s));
  const failedCost = failed.reduce((a, d) => a + costOf(d), 0);
  const costPerKm = ratio(all.cost + failedCost, totalKm);
  const cover = ratio(all.charged, all.cost);
  const costPct = ratio(all.cost, all.invoice);

  // ---------- on time: deliveries with a time window that arrived before it closed
  const windowed = delivered.filter((d) => d.timing === 'window' && d.window_to && d.delivered_at);
  const late = (d: Delivery) => dateInZone(tz, new Date(d.delivered_at)) > d.date || timeInZone(tz, new Date(d.delivered_at)) > d.window_to;
  const onTime = windowed.filter((d) => !late(d)).length;

  const kpis: Kpi[] = [
    { label: 'Delivered', value: all.n, kind: 'num', sub: `${failed.length} failed`, tone: failed.length > all.n * 0.05 ? 'attention' : undefined },
    { label: 'Charged to customers', value: round3(all.charged), kind: 'money' },
    { label: 'Delivery cost', value: round3(all.cost), kind: 'money', sub: failedCost ? `plus ${money(failedCost)} on failed trips` : undefined },
    { label: 'Charged − cost', value: round3(all.charged - all.cost), kind: 'money', tone: all.charged - all.cost < 0 ? 'loss' : 'good', sub: cover == null ? undefined : `Charges cover ${Math.round(cover * 100)}% of the cost` },
    { label: 'Cost as % of invoice value', value: costPct ?? 0, kind: 'pct', sub: `Your limit is ${s.allowed_cost_pct}%`, tone: costPct != null && costPct * 100 > s.allowed_cost_pct ? 'attention' : undefined },
    { label: 'Over budget', value: all.loss, kind: 'num', sub: all.n ? `${Math.round((all.loss / all.n) * 100)}% of deliveries` : undefined, tone: all.loss ? 'loss' : 'good' },
    { label: 'Cost per km', value: costPerKm ?? 0, kind: 'money', sub: `${Math.round(totalKm).toLocaleString()} km driven` },
    { label: 'Saved by route planning', value: round3(savedKm), kind: 'km', sub: costPerKm ? `about ${money(savedKm * costPerKm)} at your cost per km` : 'Plan trips with several stops to save km' },
  ];

  // ---------- by customer
  const byCustomer = groupBy(delivered, (d) => d.customer_id, s);
  const customers: Table = {
    id: 'customers',
    title: 'By customer',
    note: 'Customers whose deliveries cost more than they bring in are at the top.',
    cols: [{ key: 'name', label: 'Customer', kind: 'text' }, ...MONEY_COLS],
    rows: [...byCustomer.entries()].map(([id, a]) => ({ name: name.customer.get(id) ?? 'Unknown', ...aggRow(a) })).sort((x, y) => (x.result as number) - (y.result as number)),
    total: { name: 'Total', ...aggRow(all) },
  };

  // ---------- by area
  const byArea = groupBy(delivered, areaOf, s);
  const areas: Table = {
    id: 'areas',
    title: 'By area',
    note: 'Use this to set a fair delivery charge for each area.',
    cols: [{ key: 'name', label: 'Area', kind: 'text' }, ...MONEY_COLS.slice(0, 5), { key: 'avg_cost', label: 'Average cost', kind: 'money' }, { key: 'avg_charge', label: 'Average charge', kind: 'money' }, MONEY_COLS[6]],
    rows: [...byArea.entries()]
      .map(([id, a]) => ({ name: name.area.get(id) ?? 'No area', ...aggRow(a), avg_cost: round3(a.cost / a.n), avg_charge: round3(a.charged / a.n) }))
      .sort((x, y) => (x.result as number) - (y.result as number)),
    total: { name: 'Total', ...aggRow(all), avg_cost: all.n ? round3(all.cost / all.n) : 0, avg_charge: all.n ? round3(all.charged / all.n) : 0 },
  };

  // ---------- by vehicle: estimate against what was really spent
  const vKm = new Map<string, number>();
  const vN = new Map<string, number>();
  for (const t of r.trips) if (t.vehicle_id) vKm.set(t.vehicle_id, (vKm.get(t.vehicle_id) ?? 0) + (Number(t.distance_km) || 0));
  for (const d of delivered) {
    if (!d.vehicle_id) continue;
    vN.set(d.vehicle_id, (vN.get(d.vehicle_id) ?? 0) + 1);
    if (!d.trip_id) vKm.set(d.vehicle_id, (vKm.get(d.vehicle_id) ?? 0) + (Number(d.est_distance_km) || 0));
  }
  const vehicles: Table = {
    id: 'vehicles',
    title: 'By vehicle',
    note: 'Compares the cost per km the calculator uses with the fuel, repairs and tyres logged for each vehicle. A big gap means the settings need updating or the vehicle needs attention.',
    cols: [
      { key: 'name', label: 'Vehicle', kind: 'text' },
      { key: 'n', label: 'Deliveries', kind: 'num' },
      { key: 'km', label: 'Km', kind: 'km' },
      { key: 'est_per_km', label: 'Estimated per km', kind: 'money', help: 'Fuel and wear, as set on the vehicle.' },
      { key: 'spent', label: 'Logged spend', kind: 'money' },
      { key: 'actual_per_km', label: 'Logged per km', kind: 'money' },
      { key: 'litres', label: 'Fuel (litres)', kind: 'num' },
      { key: 'l100', label: 'L/100 km logged', kind: 'num' },
      { key: 'rated', label: 'L/100 km set', kind: 'num' },
    ],
    rows: r.vehicles
      .map((v) => {
        const km = vKm.get(v.id) ?? 0;
        const costs = r.vehicle_costs.filter((c) => c.vehicle_id === v.id);
        const running = costs.filter((c) => ['fuel', 'maintenance', 'tyres'].includes(c.kind)).reduce((a, c) => a + c.amount, 0);
        const litres = costs.reduce((a, c) => a + (Number(c.litres) || 0), 0);
        const price = fuelPriceFor(s, v.fuel_type || 'diesel', r.to).price;
        return {
          name: `${v.plate} ${v.type}`.trim() + (v.ownership === 'rented' ? ' (hired)' : ''),
          n: vN.get(v.id) ?? 0,
          km: Math.round(km),
          est_per_km: round3((v.fuel_use / 100) * price + v.maintenance_per_km),
          spent: round3(costs.reduce((a, c) => a + c.amount, 0)),
          actual_per_km: km > 0 && running > 0 ? round3(running / km) : null,
          litres: Math.round(litres),
          l100: km > 0 && litres > 0 ? Math.round((litres / km) * 1000) / 10 : null,
          rated: v.fuel_use,
        };
      })
      .filter((x) => x.n || x.km || x.spent)
      .sort((x, y) => y.km - x.km),
  };

  // ---------- by driver
  const shiftHours = new Map<string, number>();
  const byUser = new Map<string, { at: string; action: string }[]>();
  for (const e of r.shifts) byUser.set(e.user_id, [...(byUser.get(e.user_id) ?? []), e]);
  for (const [id, list] of byUser) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    let start: string | null = null;
    let h = 0;
    for (const e of list) {
      if (e.action === 'Started shift') start = e.at;
      else if (start) {
        h += Math.min(16, (Date.parse(e.at) - Date.parse(start)) / 3_600_000);
        start = null;
      }
    }
    shiftHours.set(id, h);
  }
  const drivers: Table = {
    id: 'drivers',
    title: 'By driver',
    cols: [
      { key: 'name', label: 'Driver', kind: 'text' },
      { key: 'n', label: 'Delivered', kind: 'num' },
      { key: 'failed', label: 'Failed', kind: 'num' },
      { key: 'on_time', label: 'On time', kind: 'pct', help: 'Of deliveries with a customer time window.' },
      { key: 'issues', label: 'With damage or returns', kind: 'num' },
      { key: 'hours', label: 'Hours on shift', kind: 'num' },
      { key: 'per_hour', label: 'Deliveries per hour', kind: 'num' },
      { key: 'rating', label: 'Customer rating', kind: 'num' },
      { key: 'variance', label: 'Cash difference', kind: 'money', help: 'Counted cash minus collected cash, over all hand-ins.' },
    ],
    rows: r.drivers
      .map((x) => {
        const mine = delivered.filter((d) => d.driver_id === x.id);
        const w = windowed.filter((d) => d.driver_id === x.id);
        const rated = mine.filter((d) => d.rating);
        const hours = Math.round((shiftHours.get(x.id) ?? 0) * 10) / 10;
        return {
          name: x.name,
          n: mine.length,
          failed: failed.filter((d) => d.driver_id === x.id).length,
          on_time: w.length ? w.filter((d) => !late(d)).length / w.length : null,
          issues: mine.filter((d) => d.pod_issue).length,
          hours: hours || null,
          per_hour: hours ? Math.round((mine.length / hours) * 10) / 10 : null,
          rating: rated.length ? Math.round((rated.reduce((a, d) => a + (d.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
          variance: round3(r.settlements.filter((st) => st.driver_id === x.id).reduce((a, st) => a + st.variance, 0)),
        };
      })
      .filter((x) => x.n || x.failed)
      .sort((a, b) => b.n - a.n),
  };

  // ---------- by month
  const byMonth = groupBy(delivered, (d) => d.date.slice(0, 7), s);
  const months: Table = {
    id: 'months',
    title: 'By month',
    cols: [{ key: 'name', label: 'Month', kind: 'text' }, ...MONEY_COLS],
    rows: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, a]) => ({ name: new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), ...aggRow(a) })),
  };

  // ---------- deliveries over budget
  const losses: Table = {
    id: 'losses',
    title: 'Deliveries over budget',
    note: 'Each of these cost more than its charge plus the allowed share of the invoice.',
    cols: [
      { key: 'ref', label: 'Delivery', kind: 'text' },
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'customer', label: 'Customer', kind: 'text' },
      { key: 'area', label: 'Area', kind: 'text' },
      { key: 'invoice', label: 'Invoice value', kind: 'money' },
      { key: 'charged', label: 'Charged', kind: 'money' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'short', label: 'Over budget by', kind: 'money' },
    ],
    rows: delivered
      .filter((d) => bandFromNumbers(costOf(d), d.invoice_value, d.delivery_charge, s) === 'loss')
      .map((d) => ({
        id: d.id,
        ref: d.ref,
        date: d.date,
        customer: name.customer.get(d.customer_id) ?? '',
        area: name.area.get(areaOf(d)) ?? '',
        invoice: d.invoice_value,
        charged: d.delivery_charge,
        cost: round3(costOf(d)),
        short: round3(costOf(d) - budgetFor(d.invoice_value, d.delivery_charge, s)),
      }))
      .sort((a, b) => b.short - a.short),
  };

  // ---------- money collected
  const methods = ['cash', 'cheque', 'transfer'] as const;
  const sum = (f: (p: (typeof r.payments)[number]) => boolean) => round3(r.payments.filter(f).reduce((a, p) => a + p.amount, 0));
  const collections: Table = {
    id: 'collections',
    title: 'Money collected at the door',
    cols: [
      { key: 'name', label: 'Method', kind: 'text' },
      { key: 'n', label: 'Payments', kind: 'num' },
      { key: 'collected', label: 'Collected', kind: 'money' },
      { key: 'with_driver', label: 'Still with drivers', kind: 'money' },
      { key: 'office', label: 'In the office / bank', kind: 'money' },
      { key: 'cleared', label: 'Cleared', kind: 'money' },
      { key: 'bounced', label: 'Bounced / not received', kind: 'money' },
    ],
    rows: methods.map((m) => ({
      name: m[0].toUpperCase() + m.slice(1),
      n: r.payments.filter((p) => p.method === m).length,
      collected: sum((p) => p.method === m),
      with_driver: sum((p) => p.method === m && p.status === 'with_driver'),
      office: sum((p) => p.method === m && ['handed_in', 'deposited', 'to_verify'].includes(p.status)),
      cleared: sum((p) => p.method === m && p.status === 'cleared'),
      bounced: sum((p) => p.method === m && p.status === 'bounced'),
    })),
  };

  // ---------- every delivery, for the spreadsheet
  const detail: Table = {
    id: 'detail',
    title: 'All deliveries',
    cols: [
      { key: 'ref', label: 'Delivery', kind: 'text' },
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'doc', label: 'Document', kind: 'text' },
      { key: 'customer', label: 'Customer', kind: 'text' },
      { key: 'area', label: 'Area', kind: 'text' },
      { key: 'driver', label: 'Driver', kind: 'text' },
      { key: 'vehicle', label: 'Vehicle', kind: 'text' },
      { key: 'km', label: 'Km (round trip)', kind: 'km' },
      { key: 'weight', label: 'Weight kg', kind: 'num' },
      { key: 'invoice', label: 'Invoice value', kind: 'money' },
      { key: 'charged', label: 'Charged', kind: 'money' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'result', label: 'Charged − cost', kind: 'money' },
      { key: 'issue', label: 'Damage or returns', kind: 'text' },
    ],
    rows: r.deliveries
      .filter((d) => d.status !== 'cancelled')
      .sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref))
      .map((d) => ({
        ref: d.ref,
        date: d.date,
        status: d.status.replace('_', ' '),
        doc: `${d.doc_kind} ${d.doc_number}`,
        customer: name.customer.get(d.customer_id) ?? '',
        area: name.area.get(areaOf(d)) ?? '',
        driver: name.driver.get(d.driver_id) ?? '',
        vehicle: name.vehicle.get(d.vehicle_id) ?? '',
        km: d.est_distance_km,
        weight: d.weight_kg,
        invoice: d.invoice_value,
        charged: d.delivery_charge,
        cost: round3(costOf(d)),
        result: round3(d.delivery_charge - costOf(d)),
        issue: d.pod_issue ? 'Yes' : '',
      })),
  };

  return { kpis, tables: { customers, areas, vehicles, drivers, months, losses, collections, detail }, delivered: all.n, onTime: windowed.length ? onTime / windowed.length : null };
}

export type Report = ReturnType<typeof buildReport>;
