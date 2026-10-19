import { type Actor, type Deps, bad, notFound, need, readSettings, logActivity, str, num, isDate, allowedShops, shopFilter, fileUrls } from '../core.ts';
import { openOrg } from './admin.ts';
import type { ActivityEntry, Address, Area, Customer, Delivery, Payment, PaymentStatus, Settlement, Staff, Trip, Vehicle, VehicleCost } from '../domain/types.ts';
import { addDays, dateInZone, nowISO, round3, uid } from '../domain/format.ts';

// ------------------------------------------------------------------ collections: cash and cheques from the drivers

export async function listCollections(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, 'payments', 'settlements', 'deliveries', 'customers', 'staff');
  const s = readSettings(book);
  const shops = shopFilter(a, book, q);
  const today = dateInZone(s.time_zone);
  const from = isDate(q.get('from')) ? q.get('from')! : addDays(today, -60);
  const to = isDate(q.get('to')) ? q.get('to')! : today;
  const open = ['with_driver', 'handed_in', 'deposited', 'to_verify'];
  const rows = book
    .all<Payment>('payments')
    .filter((p) => shops.has(p.shop_id) && (open.includes(p.status) || (p.collected_at.slice(0, 10) >= from && p.collected_at.slice(0, 10) <= to)));
  const photos = await fileUrls(deps, a.orgId, rows.map((p) => p.photo));
  const withPhoto = rows.filter((p) => p.photo && p.photo.startsWith(a.orgId + '/'));
  const photoOf = new Map(withPhoto.map((p, i) => [p.id, photos[i]]));
  const name = (t: 'customers' | 'staff', id: string) => (book.get<Customer | Staff>(t, id) as { name?: string } | undefined)?.name ?? '';
  return {
    today,
    payments: rows
      .map((p) => {
        const d = book.get<Delivery>('deliveries', p.delivery_id);
        return { ...p, ref: d?.ref ?? '', doc: d ? `${d.doc_kind} ${d.doc_number}` : '', customer: name('customers', p.customer_id), driver: name('staff', p.driver_id), photo_url: photoOf.get(p.id) ?? '' };
      })
      .sort((x, y) => y.collected_at.localeCompare(x.collected_at)),
    settlements: book
      .all<Settlement>('settlements')
      .filter((st) => shops.has(st.shop_id) && st.at.slice(0, 10) >= from)
      .map((st) => ({ ...st, driver: name('staff', st.driver_id) }))
      .sort((x, y) => y.at.localeCompare(x.at)),
  };
}

/** The driver hands in the day's cash and cheques; the office counts the cash. */
export async function settleCollections(deps: Deps, a: Actor, body: Record<string, unknown>) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, 'payments', 'settlements', 'staff', 'activity_log');
  const driverId = str(body.driver_id, 60);
  const driver = book.get<Staff>('staff', driverId);
  if (!driver || driver.role !== 'driver') throw bad('Choose the driver.');
  const ids = Array.isArray(body.payment_ids) ? (body.payment_ids as string[]).map((x) => str(x, 60)) : [];
  if (!ids.length) throw bad('Choose what the driver is handing in.');
  const shops = new Set(allowedShops(a, book).map((x) => x.id));
  const list = ids.map((id) => book.get<Payment>('payments', id));
  for (const p of list) {
    if (!p || !shops.has(p.shop_id)) throw notFound('Payment');
    if (p.driver_id !== driverId) throw bad('Some of these were collected by another driver.');
    if (p.status !== 'with_driver') throw bad('Some of these have already been handed in.');
  }
  const payments = list as Payment[];
  const expected = round3(payments.filter((p) => p.method === 'cash').reduce((x, p) => x + p.amount, 0));
  const counted = round3(num(body.counted ?? expected, 'Cash counted', { max: 10_000_000 }));
  const st: Settlement = {
    id: uid('set_'),
    driver_id: driverId,
    shop_id: payments[0].shop_id,
    at: nowISO(),
    by: a.name,
    payment_ids: ids.join(','),
    expected,
    counted,
    variance: round3(counted - expected),
    note: str(body.note, 300),
  };
  book.insert('settlements', st as unknown as Record<string, unknown>);
  for (const p of payments) book.update<Payment>('payments', p.id, { status: 'handed_in', settlement_id: st.id, updated_at: nowISO() });
  logActivity(book, a, 'Received cash and cheques', 'settlement', st.id, `${driver.name}: expected ${expected}, counted ${counted}${st.variance ? `, difference ${st.variance}` : ''}`, st.shop_id);
  await book.commit();
  return st;
}

const NEXT: Record<PaymentStatus, PaymentStatus[]> = {
  with_driver: [],
  handed_in: ['deposited', 'cleared', 'bounced'],
  deposited: ['cleared', 'bounced'],
  to_verify: ['cleared', 'bounced'],
  cleared: [],
  bounced: ['deposited'],
};

/** Cheque deposited, cleared or bounced; transfer confirmed or not received. */
export async function updatePayment(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, 'payments', 'activity_log');
  const p = book.get<Payment>('payments', id);
  if (!p || !allowedShops(a, book).some((x) => x.id === p.shop_id)) throw notFound('Payment');
  const to = String(body.status) as PaymentStatus;
  if (!NEXT[p.status]?.includes(to)) throw bad(`This ${p.method} is ${p.status.replace('_', ' ')} and cannot be marked ${to.replace('_', ' ')}.`);
  const next = book.update<Payment>('payments', id, { status: to, note: str(body.note ?? p.note, 300), updated_at: nowISO() });
  logActivity(book, a, to === 'bounced' ? 'Cheque bounced' : `Payment ${to.replace('_', ' ')}`, 'payment', id, `${p.method} ${p.amount}${p.cheque_no ? ` no. ${p.cheque_no}` : ''}`, p.shop_id);
  await book.commit();
  return next;
}

// ------------------------------------------------------------------ reports

/** Everything the reports need for a period, in one read; the browser does the adding up. */
export async function reportData(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'costs.view');
  const book = await openOrg(deps, a, 'deliveries', 'trips', 'payments', 'settlements', 'vehicle_costs', 'vehicles', 'customers', 'addresses', 'areas', 'staff', 'activity_log');
  const s = readSettings(book);
  const shops = shopFilter(a, book, q);
  const today = dateInZone(s.time_zone);
  const from = isDate(q.get('from')) ? q.get('from')! : addDays(today, -29);
  const to = isDate(q.get('to')) ? q.get('to')! : today;
  if (from > to) throw bad('The start date is after the end date.');
  const inRange = (d: string) => d >= from && d <= to;
  const deliveries = book.all<Delivery>('deliveries').filter((d) => shops.has(d.shop_id) && inRange(d.date));
  const vehicles = book.all<Vehicle>('vehicles').filter((v) => v.shop_id === '*' || shops.has(v.shop_id));
  const vehicleIds = new Set(vehicles.map((v) => v.id));
  const drivers = book.all<Staff>('staff').filter((x) => x.role === 'driver');
  const driverIds = new Set(drivers.map((x) => x.id));
  return {
    from,
    to,
    today,
    deliveries: deliveries.map(({ tracking_token: _t, pod_photos: _p, pod_signature: _s, ...d }) => d),
    trips: book.all<Trip>('trips').filter((t) => shops.has(t.shop_id) && inRange(t.date) && t.stop_ids),
    payments: book.all<Payment>('payments').filter((p) => shops.has(p.shop_id) && inRange(p.collected_at.slice(0, 10))),
    settlements: book.all<Settlement>('settlements').filter((x) => shops.has(x.shop_id) && inRange(x.at.slice(0, 10))),
    vehicle_costs: book.all<VehicleCost>('vehicle_costs').filter((c) => !c.deleted && vehicleIds.has(c.vehicle_id) && inRange(c.date)),
    vehicles,
    customers: book.all<Customer>('customers').map((c) => ({ id: c.id, name: c.name })),
    addresses: book.all<Address>('addresses').map((x) => ({ id: x.id, area_id: x.area_id })),
    areas: book.all<Area>('areas').map((x) => ({ id: x.id, name: x.name })),
    drivers: drivers.map((x) => ({ id: x.id, name: x.name })),
    shifts: book
      .all<ActivityEntry>('activity_log')
      .filter((e) => driverIds.has(e.user_id) && (e.action === 'Started shift' || e.action === 'Ended shift') && inRange(dateInZone(s.time_zone, new Date(e.at))))
      .map((e) => ({ user_id: e.user_id, at: e.at, action: e.action })),
  };
}
