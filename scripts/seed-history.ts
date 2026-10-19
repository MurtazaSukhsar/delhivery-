// Two months of finished deliveries for the demo, so the reports, the money page and the
// vehicle cost log have something real to show. Deliveries are created through the API
// (so their cost estimates are the real ones); what happened afterwards is written directly.
import type { Deps } from '../supabase/functions/_shared/core.ts';
import { orgBook, readSettings } from '../supabase/functions/_shared/core.ts';
import { recomputeTrip } from '../supabase/functions/_shared/services/deliveries.ts';
import { addDays, uid, zonedToUtc } from '../supabase/functions/_shared/domain/format.ts';
import { fuelPriceFor } from '../supabase/functions/_shared/domain/gcc.ts';
import type { Delivery, OrderLine, Payment, PodLine, Settlement, Trip, Vehicle, VehicleCost } from '../supabase/functions/_shared/domain/types.ts';

// deno-lint-ignore no-explicit-any
type Api = (token: string, method: string, path: string, body?: unknown) => Promise<any>;
// deno-lint-ignore no-explicit-any
type Cust = { id: string; addresses: { id: string }[] } & Record<string, any>;

export interface HistoryCtx {
  deps: Deps;
  sheet: string;
  api: Api;
  today: string;
  staffToken: { ghala: string; rusayl: string };
  shops: { ghala: string; rusayl: string };
  drivers: { ahmed: { id: string; name: string }; imran: { id: string; name: string }; khalid: { id: string; name: string }; suresh: { id: string; name: string } };
  vehicles: { pickup: string; van: string; truck5: string; truck3: string };
  customers: Record<string, Cust>;
  admin: { id: string; name: string };
}

/** Same numbers every run. */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

const ITEMS: [string, string, number, number][] = [
  // description, unit, typical qty, kg each
  ['Cement OPC 50 kg', 'bags', 40, 50],
  ['Rebar 12 mm × 12 m', 'pcs', 30, 10.7],
  ['PVC pipe 4 in × 6 m', 'pcs', 20, 6],
  ['Gypsum board 12 mm', 'sheets', 25, 22],
  ['Wall paint 18 L', 'pails', 10, 25],
  ['Cable 2.5 mm² × 100 m', 'rolls', 8, 9],
  ['Ceramic tile 60×60', 'boxes', 30, 25],
  ['Block 20 cm', 'pcs', 200, 18],
  ['Sanitary set', 'sets', 4, 35],
  ['Angle grinder 9 in', 'pcs', 3, 6],
];

export async function seedHistory(c: HistoryCtx) {
  const r = rng(20261016);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const chance = (p: number) => r() < p;
  const C = c.customers;

  type Plan = { shop: 'ghala' | 'rusayl'; cust: Cust; addr: number; inv: number; charge: number; kg: number; cbm: number; extra: Record<string, unknown>; lines?: OrderLine[]; pay?: 'cash' | 'cheque' | 'transfer' };
  const days: { date: string; plans: Plan[] }[] = [];

  for (let back = 60; back >= 1; back--) {
    const date = addDays(c.today, -back);
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    if (dow === 5) continue; // Friday
    const n = dow === 6 ? 2 + Math.floor(r() * 2) : 4 + Math.floor(r() * 4);
    const plans: Plan[] = [];
    for (let i = 0; i < n; i++) {
      const who = pick(['bayt', 'bayt', 'green', 'mawaleh', 'mawaleh', 'ruwi', 'coast', 'towers', 'barka', 'qurum']);
      const cust = who === 'qurum' ? C.green : C[who];
      const big = who === 'towers' || (who === 'bayt' && chance(0.3));
      const kg = big ? 1200 + Math.round(r() * 2600) : 40 + Math.round(r() * 700);
      const inv = Math.round((big ? 600 + r() * 2400 : 40 + r() * 600) * 10) / 10;
      // Small orders to far areas, charged too little: these show up as over budget.
      const charge = who === 'barka' ? pick([0, 2, 3]) : who === 'mawaleh' || who === 'green' ? pick([2, 2.5, 3]) : big ? pick([0, 10, 15]) : pick([0, 0, 2]);
      const lines = chance(0.6)
        ? Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
            const it = pick(ITEMS);
            return { d: it[0], u: it[1], q: Math.max(1, Math.round(it[2] * (0.4 + r()))) };
          })
        : undefined;
      const pay = who === 'mawaleh' || who === 'green' ? (chance(0.8) ? 'cash' : 'transfer') : who === 'coast' || who === 'ruwi' ? (chance(0.7) ? 'cheque' : undefined) : undefined;
      plans.push({
        shop: 'ghala',
        cust,
        addr: who === 'bayt' ? (chance(0.7) ? 0 : 1) : 0,
        inv,
        charge,
        kg,
        cbm: Math.round((kg / 350) * 10) / 10,
        extra: { helpers: big && chance(0.6) ? 2 : 0, equipment: who === 'towers' && chance(0.5) ? 'crane' : 'none', wait_minutes: big ? 30 : 0, timing: chance(0.3) ? 'window' : 'flexible', window_from: '09:00', window_to: pick(['11:00', '12:00', '13:00']) },
        lines,
        pay,
      });
    }
    // Rusayl: the Amerat housing project, mostly heavy, with a forklift on site.
    for (let i = 0; i < (dow === 6 ? 0 : 1 + Math.floor(r() * 2)); i++) {
      const kg = 800 + Math.round(r() * 2100);
      plans.push({ shop: 'rusayl', cust: C.amerat, addr: 0, inv: Math.round((900 + r() * 2200) * 10) / 10, charge: pick([10, 15, 15]), kg, cbm: Math.round((kg / 400) * 10) / 10, extra: { equipment: chance(0.5) ? 'forklift' : 'none', helpers: chance(0.4) ? 1 : 0, wait_minutes: 20, timing: 'flexible' }, pay: chance(0.4) ? 'cheque' : undefined });
    }
    days.push({ date, plans });
  }

  // 1. Create every delivery through the API, with its date.
  let doc = 23000;
  const made: { date: string; plan: Plan; d: Delivery }[] = [];
  for (const day of days) {
    for (const p of day.plans) {
      doc++;
      const isInv = p.pay === 'cash' || chance(0.4);
      const collectAmount = Math.round((p.inv + p.charge) * 1000) / 1000;
      const d = await c.api(p.shop === 'ghala' ? c.staffToken.ghala : c.staffToken.rusayl, 'POST', '/deliveries', {
        shop_id: c.shops[p.shop],
        customer_id: p.cust.id,
        address_id: p.cust.addresses[p.addr].id,
        doc_kind: isInv ? 'Invoice' : 'DO',
        doc_number: `${isInv ? 'INV' : 'DO'}-${doc}`,
        invoice_value: p.inv,
        delivery_charge: p.charge,
        date: day.date,
        weight_kg: p.kg,
        volume_cbm: p.cbm,
        collect_type: p.pay === 'cash' ? 'cash' : p.pay === 'cheque' ? 'cheque' : 'none',
        collect_amount: p.pay === 'cash' || p.pay === 'cheque' ? collectAmount : 0,
        lines: p.lines ?? [],
        ...p.extra,
      });
      made.push({ date: day.date, plan: p, d });
    }
  }

  // 2. Write what happened, in one go.
  const book = orgBook(c.deps, c.sheet);
  await book.load('settings', 'shops', 'deliveries', 'delivery_events', 'trips', 'addresses', 'areas', 'vehicles', 'payments', 'settlements', 'vehicle_costs', 'activity_log', 'staff');
  const s = readSettings(book);
  const tz = s.time_zone;
  const at = (date: string, minutes: number) => zonedToUtc(date, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, tz).toISOString();
  const D = c.drivers;
  const V = c.vehicles;
  const vehicleOf = (id: string) => book.get<Vehicle>('vehicles', id)!;
  const kmByVehicle = new Map<string, { date: string; km: number }[]>();
  const shift = (driver: { id: string; name: string }, shop: string, date: string, start: number, end: number) => {
    for (const [action, m] of [['Started shift', start], ['Ended shift', end]] as const)
      book.insert('activity_log', { id: uid('log_'), at: at(date, m), user_id: driver.id, user_name: driver.name, role: 'driver', shop_id: shop, action, entity: 'staff', entity_id: driver.id, details: '' });
  };
  const paymentsByDriverDay = new Map<string, Payment[]>();
  const failReasons = ['Customer not available', 'Site closed', 'Wrong address, customer asked to come tomorrow'];

  const byDay = new Map<string, typeof made>();
  for (const m of made) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m]);

  for (const [date, list] of byDay) {
    // Who drives what: heavy loads go on the 5-tonne truck with Suresh; the rest split by space.
    const crews: { driver: { id: string; name: string }; vehicle: string; shop: string; items: typeof made }[] = [
      { driver: D.ahmed, vehicle: V.pickup, shop: c.shops.ghala, items: [] },
      { driver: D.imran, vehicle: V.van, shop: c.shops.ghala, items: [] },
      { driver: D.suresh, vehicle: V.truck5, shop: c.shops.ghala, items: [] },
      { driver: D.khalid, vehicle: V.truck3, shop: c.shops.rusayl, items: [] },
    ];
    for (const m of list) {
      if (m.plan.shop === 'rusayl') crews[3].items.push(m);
      else if (m.d.weight_kg > 900) crews[2].items.push(m);
      else {
        const load = (k: number) => crews[k].items.reduce((a, x) => a + x.d.weight_kg, 0);
        crews[load(0) <= load(1) && load(0) + m.d.weight_kg <= 1000 ? 0 : load(1) + m.d.weight_kg <= 900 ? 1 : 0].items.push(m);
      }
    }
    for (const crew of crews) {
      if (!crew.items.length) continue;
      const tripId = crew.items.length > 1 ? uid('tr_') : '';
      if (tripId)
        book.insert('trips', { id: tripId, shop_id: crew.shop, date, driver_id: crew.driver.id, vehicle_id: crew.vehicle, stop_ids: crew.items.map((m) => m.d.id).join(','), distance_km: 0, naive_distance_km: 0, minutes: 0, naive_minutes: 0, cost: 0, created_by: c.admin.id, created_at: at(date, 7 * 60 + 30) } satisfies Trip);
      let clock = 8 * 60 + Math.floor(r() * 20);
      for (const m of crew.items) {
        const d = m.d;
        clock += Math.round(d.est_minutes / (tripId ? 2.2 : 1)) + Math.floor(r() * 15);
        const failed = chance(0.04);
        const late = d.timing === 'window' && chance(0.15);
        const minute = late ? Math.max(clock, Number(d.window_to.slice(0, 2)) * 60 + 20) : d.timing === 'window' ? Math.min(clock, Number(d.window_to.slice(0, 2)) * 60 - 25) : clock;
        const lines: OrderLine[] = JSON.parse(d.lines || '[]');
        const damaged = !failed && lines.length > 0 && chance(0.1);
        const pod: PodLine[] = lines.map((l, i) => (damaged && i === 0 ? { delivered: l.q - 2, damaged: 2, returned: 0, note: 'Broken in transit' } : { delivered: l.q, damaged: 0, returned: 0 }));
        book.update<Delivery>('deliveries', d.id, {
          status: failed ? 'failed' : 'delivered',
          driver_id: crew.driver.id,
          vehicle_id: crew.vehicle,
          trip_id: tripId,
          fail_reason: failed ? pick(failReasons) : '',
          receiver_name: failed ? '' : pick(['Site supervisor', 'Storekeeper', 'Nasser', 'Rashid', 'Hamed', 'Anil', 'Security guard']),
          delivered_at: failed ? '' : at(date, minute),
          pod_lines: pod.length ? JSON.stringify(pod) : '',
          pod_issue: damaged,
          pod_note: damaged ? 'Two items broken, customer signed for the rest.' : '',
          collected_amount: !failed && m.plan.pay === 'cash' ? d.collect_amount : null,
          rating: !failed && chance(0.35) ? pick([5, 5, 5, 4, 4, 3]) : null,
          updated_at: at(date, minute),
        });
        for (const [st, mm] of [['assigned', 7 * 60 + 30], ['accepted', 7 * 60 + 40], ['picked_up', 7 * 60 + 55], [failed ? 'failed' : 'delivered', minute]] as const)
          book.insert('delivery_events', { id: uid('ev_'), delivery_id: d.id, at: at(date, mm), status: st, by: st === 'assigned' ? 'Office' : crew.driver.name, reason: st === 'failed' ? 'Customer not available' : st === 'delivered' && damaged ? 'With issues. Two items broken.' : '', offline: false, client_id: '' });
        if (!failed && m.plan.pay) {
          const method = m.plan.pay;
          const amount = Math.round((d.invoice_value + d.delivery_charge) * 1000) / 1000;
          const p: Payment = {
            id: uid('pay_'),
            delivery_id: d.id,
            customer_id: d.customer_id,
            shop_id: d.shop_id,
            driver_id: crew.driver.id,
            method,
            amount,
            cheque_no: method === 'cheque' ? String(100000 + Math.floor(r() * 899999)) : '',
            bank: method === 'cheque' ? pick(['Bank Muscat', 'NBO', 'Sohar International', 'Bank Dhofar']) : '',
            cheque_date: method === 'cheque' ? addDays(date, pick([0, 0, 15, 30, 45])) : '',
            photo: '',
            status: method === 'transfer' ? 'to_verify' : 'with_driver',
            collected_at: at(date, minute),
            settlement_id: '',
            note: '',
            updated_at: at(date, minute),
          };
          book.insert('payments', p as unknown as Record<string, unknown>);
          if (method !== 'transfer') {
            const key = `${crew.driver.id}|${date}`;
            paymentsByDriverDay.set(key, [...(paymentsByDriverDay.get(key) ?? []), p]);
          }
        }
        clock += s.service_minutes_per_stop + (Number(d.wait_minutes) || 0);
      }
      if (tripId) recomputeTrip(book, s, tripId, new Date(at(date, 8 * 60)));
      const trip = tripId ? book.get<Trip>('trips', tripId) : undefined;
      const km = trip ? trip.distance_km : crew.items.reduce((a, m) => a + m.d.est_distance_km, 0);
      kmByVehicle.set(crew.vehicle, [...(kmByVehicle.get(crew.vehicle) ?? []), { date, km }]);
      shift(crew.driver, crew.shop, date, 7 * 60 + 40 + Math.floor(r() * 10), Math.min(clock + 25, 19 * 60));
    }
  }

  // 3. Drivers hand in cash and cheques the next working morning; cheques move through the bank.
  for (const [key, list] of paymentsByDriverDay) {
    const [driverId, date] = key.split('|');
    if (date >= addDays(c.today, -1)) continue; // yesterday's are still with the driver
    const expected = Math.round(list.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0) * 1000) / 1000;
    const short = expected > 0 && chance(0.12) ? pick([0.5, 1, 2.5]) : 0;
    const st: Settlement = { id: uid('set_'), driver_id: driverId, shop_id: list[0].shop_id, at: at(addDays(date, 1), 7 * 60 + 35), by: 'Fatma Al Balushi', payment_ids: list.map((p) => p.id).join(','), expected, counted: expected - short, variance: -short, note: short ? 'Driver says change was given to the customer' : '' };
    book.insert('settlements', st as unknown as Record<string, unknown>);
    for (const p of list) {
      let status: Payment['status'] = p.method === 'cash' ? 'cleared' : 'handed_in';
      if (p.method === 'cheque' && p.cheque_date <= addDays(c.today, -4)) status = chance(0.06) ? 'bounced' : 'cleared';
      else if (p.method === 'cheque' && p.cheque_date <= c.today) status = chance(0.5) ? 'deposited' : 'handed_in';
      book.update<Payment>('payments', p.id, { status, settlement_id: st.id });
    }
  }
  for (const p of book.all<Payment>('payments')) if (p.method === 'transfer' && p.collected_at < at(addDays(c.today, -5), 0)) book.update<Payment>('payments', p.id, { status: 'cleared' });

  // 4. Fuel and repairs actually paid. The van uses more fuel than its setting says.
  const thirst: Record<string, number> = { [V.pickup]: 1.08, [V.van]: 1.32, [V.truck5]: 1.12, [V.truck3]: 1.05 };
  for (const [vid, runs] of kmByVehicle) {
    const v = vehicleOf(vid);
    let km = 0;
    let odo = 40000 + Math.floor(r() * 60000);
    for (const run of runs) {
      km += run.km;
      odo += Math.round(run.km);
      if (km < 250) continue;
      const litres = Math.round(((km * v.fuel_use) / 100) * thirst[vid] * 10) / 10;
      const price = fuelPriceFor(s, v.fuel_type || 'diesel', run.date).price;
      book.insert('vehicle_costs', { id: uid('vc_'), vehicle_id: vid, date: run.date, kind: 'fuel', amount: Math.round(litres * price * 1000) / 1000, litres, odometer: odo, note: '', created_by: c.admin.id, created_at: at(run.date, 18 * 60), deleted: false } satisfies VehicleCost);
      km = 0;
    }
  }
  const cost = (vid: string, back: number, kind: VehicleCost['kind'], amount: number, note: string) =>
    book.insert('vehicle_costs', { id: uid('vc_'), vehicle_id: vid, date: addDays(c.today, -back), kind, amount, litres: null, odometer: null, note, created_by: c.admin.id, created_at: at(addDays(c.today, -back), 12 * 60), deleted: false } satisfies VehicleCost);
  cost(V.pickup, 41, 'maintenance', 38, 'Oil and filter service');
  cost(V.van, 33, 'maintenance', 145, 'Brake pads and discs');
  cost(V.van, 12, 'maintenance', 62, 'AC gas refill');
  cost(V.truck5, 27, 'tyres', 240, 'Two rear tyres');
  cost(V.truck5, 8, 'maintenance', 85, 'Service 60,000 km');
  cost(V.truck3, 19, 'maintenance', 55, 'Oil and filter service');
  cost(V.van, 22, 'fine', 15, 'Parking fine, Ruwi');

  await book.commit();
  return { deliveries: made.length };
}
