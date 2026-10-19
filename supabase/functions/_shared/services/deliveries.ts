import { type Actor, type Deps, type OrgBook, ApiError, bad, forbidden, notFound, need, readSettings, logActivity, str, num, assertShop, shopFilter, isDate, isTime, allowedShops, fileUrls } from '../core.ts';
import { openOrg } from './admin.ts';
import type { Address, Area, Customer, Delivery, DeliveryEvent, DeliveryStatus, OrgSettings, Shop, Staff, Trip, Vehicle, CollectType, Equipment, OrderLine, Payment } from '../domain/types.ts';
import { canMove, isReassignable } from '../domain/status.ts';
import { quoteDelivery, rankVehicles, fits, allocateTripCost, driveMinutes, extrasCost, type Extras } from '../domain/cost.ts';
import { vehicleInShop, vehicleLabel } from '../domain/fleet.ts';
import { optimiseStops, roadKm } from '../domain/route.ts';
import { uid, token, nowISO, dateInZone, timeInZone, zonedToUtc, addDays } from '../domain/format.ts';
import { hasShop } from '../domain/permissions.ts';

export const DELIVERY_TABS = ['deliveries', 'delivery_events', 'trips', 'customers', 'addresses', 'areas', 'vehicles', 'staff', 'activity_log', 'payments'] as const;

// ------------------------------------------------------------------ helpers
export function addressOf(book: OrgBook, d: Pick<Delivery, 'address_id' | 'ref'>): Address {
  const a = book.get<Address>('addresses', d.address_id);
  if (!a) throw bad(`The address for ${d.ref || 'this delivery'} is missing.`);
  return a;
}

function shopOf(book: OrgBook, id: string): Shop {
  const s = book.get<Shop>('shops', id);
  if (!s) throw bad('Shop not found.');
  return s;
}

/** Site extras of a delivery: helpers, lifting equipment, waiting, and the area's tolls. */
export function extrasOf(book: OrgBook, d: Pick<Delivery, 'address_id' | 'helpers' | 'equipment' | 'wait_minutes'>): Extras {
  const adr = book.get<Address>('addresses', d.address_id);
  const area = adr?.area_id ? (book.tabsLoaded('areas') ? book.get<Area>('areas', adr.area_id) : undefined) : undefined;
  return { helpers: Number(d.helpers) || 0, equipment: (d.equipment as Equipment) || 'none', wait_minutes: Number(d.wait_minutes) || 0, toll: Number(area?.toll_per_trip) || 0 };
}

export function addEvent(book: OrgBook, d: Delivery, status: DeliveryStatus, by: string, reason = '', offline = false, clientId = '') {
  book.insert('delivery_events', { id: uid('ev_'), delivery_id: d.id, at: nowISO(), status, by, reason, offline, client_id: clientId });
}

export function move(book: OrgBook, d: Delivery, to: DeliveryStatus, by: string, reason = '', offline = false, clientId = '') {
  if (!canMove(d.status, to)) throw bad(`${d.ref} is ${d.status.replace('_', ' ')} and cannot become ${to.replace('_', ' ')}.`);
  book.update<Delivery>('deliveries', d.id, { status: to, updated_at: nowISO() });
  addEvent(book, d, to, by, reason, offline, clientId);
}

function stopIds(t: Trip) {
  return t.stop_ids ? t.stop_ids.split(',').filter(Boolean) : [];
}

/** Re-order a trip's open stops, refresh its distance, cost shares and ETAs. Empty trips are kept with no stops. */
export function recomputeTrip(book: OrgBook, s: OrgSettings, tripId: string, startAt?: Date) {
  const t = book.get<Trip>('trips', tripId);
  if (!t) return;
  const list = stopIds(t)
    .map((id) => book.get<Delivery>('deliveries', id))
    .filter((d): d is Delivery => !!d && d.trip_id === tripId && d.status !== 'cancelled');
  if (!list.length) {
    book.update<Trip>('trips', tripId, { stop_ids: '', distance_km: 0, naive_distance_km: 0, minutes: 0, naive_minutes: 0, cost: 0 });
    return;
  }
  const start = shopOf(book, t.shop_id);
  const done = list.filter((d) => d.status === 'delivered' || d.status === 'failed');
  const open = list.filter((d) => !done.includes(d));
  const r = optimiseStops(start, open.map((d) => addressOf(book, d)), s.road_factor, open.map((d) => d.urgent));
  const ordered = [...done, ...r.order.map((i) => open[i])];
  const pts = ordered.map((d) => addressOf(book, d));
  const all = optimiseStops(start, pts, s.road_factor);
  const waits = ordered.reduce((x, d) => x + (Number(d.wait_minutes) || 0), 0);
  const mins = driveMinutes(all.distanceKm, s) + s.service_minutes_per_stop * pts.length + waits;
  const vehicle = book.get<Vehicle>('vehicles', t.vehicle_id);
  const alloc = allocateTripCost(all.distanceKm, mins, start, pts, vehicle, s, t.date);
  let extrasTotal = 0;
  ordered.forEach((d, i) => {
    const x = extrasCost(extrasOf(book, d), s);
    const extra = x.helpers + x.equipment + x.tolls;
    extrasTotal += extra;
    book.update<Delivery>('deliveries', d.id, { trip_cost: Math.round((alloc.shares[i] + extra) * 1000) / 1000 });
  });
  book.update<Trip>('trips', tripId, {
    stop_ids: ordered.map((d) => d.id).join(','),
    distance_km: Math.round(all.distanceKm * 10) / 10,
    naive_distance_km: Math.round(all.naiveDistanceKm * 10) / 10,
    minutes: Math.round(mins),
    naive_minutes: Math.round(driveMinutes(all.naiveDistanceKm, s) + s.service_minutes_per_stop * pts.length),
    cost: Math.round((alloc.total + extrasTotal) * 1000) / 1000,
  });
  updateEtas(book, s, tripId, startAt);
}

export function updateEtas(book: OrgBook, s: OrgSettings, tripId: string, startAt?: Date) {
  const t = book.get<Trip>('trips', tripId);
  if (!t) return;
  let prev: { lat: number; lng: number } = shopOf(book, t.shop_id);
  let clock = (startAt ?? new Date()).getTime();
  for (const id of stopIds(t)) {
    const d = book.get<Delivery>('deliveries', id);
    if (!d || d.status === 'cancelled') continue;
    const p = addressOf(book, d);
    if (d.status === 'delivered' || d.status === 'failed') {
      prev = p;
      continue;
    }
    if (d.status !== 'arrived') clock += driveMinutes(roadKm(prev, p, s.road_factor), s) * 60000;
    book.update<Delivery>('deliveries', d.id, { eta: new Date(clock).toISOString() });
    clock += (s.service_minutes_per_stop + (Number(d.wait_minutes) || 0)) * 60000;
    prev = p;
  }
}

/** Take a delivery out of its trip. */
export function detach(book: OrgBook, s: OrgSettings, d: Delivery) {
  const tripId = d.trip_id;
  if (!tripId) return;
  const t = book.get<Trip>('trips', tripId);
  if (t) book.update<Trip>('trips', tripId, { stop_ids: stopIds(t).filter((x) => x !== d.id).join(',') });
  book.update<Delivery>('deliveries', d.id, { trip_id: '', eta: '', trip_cost: null });
  recomputeTrip(book, s, tripId);
}

function nextRef(book: OrgBook) {
  let max = 1000;
  for (const d of book.all<Delivery>('deliveries')) {
    const n = Number(String(d.ref).replace(/\D/g, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `DL-${max + 1}`;
}

function canSeeDelivery(a: Actor, book: OrgBook, d: Delivery) {
  return allowedShops(a, book).some((s) => s.id === d.shop_id);
}

function loadDelivery(a: Actor, book: OrgBook, id: string) {
  const d = book.get<Delivery>('deliveries', id);
  if (!d || !canSeeDelivery(a, book, d)) throw notFound('Delivery');
  return d;
}

// ------------------------------------------------------------------ reads
export async function listDeliveries(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'deliveries.view');
  const book = await openOrg(deps, a, 'deliveries', 'trips');
  const s = readSettings(book);
  const shops = shopFilter(a, book, q);
  const today = dateInZone(s.time_zone);
  const from = isDate(q.get('from')) ? q.get('from')! : isDate(q.get('date')) ? q.get('date')! : today;
  const to = isDate(q.get('to')) ? q.get('to')! : isDate(q.get('date')) ? q.get('date')! : from;
  const statuses = (q.get('status') ?? '').split(',').filter(Boolean);
  const deliveries = book
    .all<Delivery>('deliveries')
    .filter((d) => shops.has(d.shop_id) && d.date >= from && d.date <= to && (!statuses.length || statuses.includes(d.status)));
  const trips = book.all<Trip>('trips').filter((t) => shops.has(t.shop_id) && t.date >= from && t.date <= to && t.stop_ids);
  return { from, to, today, deliveries, trips };
}

export async function getDelivery(deps: Deps, a: Actor, id: string) {
  need(a, 'deliveries.view');
  const book = await openOrg(deps, a, 'deliveries', 'delivery_events', 'trips', 'payments');
  const d = loadDelivery(a, book, id);
  const payments = book.all<Payment>('payments').filter((p) => p.delivery_id === id);
  const photos = await fileUrls(deps, a.orgId, (d.pod_photos || '').split(',').filter(Boolean));
  const [signature] = await fileUrls(deps, a.orgId, [d.pod_signature]);
  const chequePhotos = await fileUrls(deps, a.orgId, payments.map((p) => p.photo));
  return {
    delivery: d,
    events: book.all<DeliveryEvent>('delivery_events').filter((e) => e.delivery_id === id).sort((x, y) => x.at.localeCompare(y.at)),
    trip: d.trip_id ? book.get<Trip>('trips', d.trip_id) ?? null : null,
    payments,
    pod: { photos, signature: signature ?? '', cheque_photos: chequePhotos },
  };
}

// ------------------------------------------------------------------ writes
const COLLECT: CollectType[] = ['none', 'cash', 'cheque', 'documents'];

function deliveryFields(body: Record<string, unknown>, base?: Delivery) {
  const v = (k: keyof Delivery) => (body[k] !== undefined ? body[k] : base?.[k]);
  const timing = v('timing') === 'window' ? 'window' : 'flexible';
  const out = {
    shop_id: str(v('shop_id'), 40),
    doc_kind: v('doc_kind') === 'Invoice' ? 'Invoice' : 'DO',
    doc_number: str(v('doc_number'), 60),
    invoice_value: num(v('invoice_value') ?? 0, 'Invoice value', { max: 10_000_000 }),
    delivery_charge: num(v('delivery_charge') ?? 0, 'Delivery charge', { max: 100000 }),
    customer_id: str(v('customer_id'), 40),
    address_id: str(v('address_id'), 40),
    date: String(v('date') ?? ''),
    timing,
    window_from: timing === 'window' ? String(v('window_from') ?? '') : '',
    window_to: timing === 'window' ? String(v('window_to') ?? '') : '',
    urgent: !!v('urgent'),
    collect_type: (COLLECT.includes(v('collect_type') as CollectType) ? v('collect_type') : 'none') as CollectType,
    collect_amount: num(v('collect_amount') ?? 0, 'Amount to collect', { max: 10_000_000 }),
    collect_note: str(v('collect_note'), 200),
    weight_kg: num(v('weight_kg') ?? 0, 'Weight', { max: 60000 }),
    volume_cbm: num(v('volume_cbm') ?? 0, 'Volume (cbm)', { max: 200 }),
    helpers: Math.round(num(v('helpers') ?? 0, 'Helpers', { max: 20 })),
    equipment: (['crane', 'forklift'].includes(String(v('equipment'))) ? v('equipment') : 'none') as Equipment,
    wait_minutes: Math.round(num(v('wait_minutes') ?? 0, 'Waiting time', { max: 1440 })),
    lines: linesField(v('lines')),
    notes: str(v('notes'), 1000),
    plan_vehicle_id: str(v('plan_vehicle_id'), 40),
  };
  if (!out.doc_number) throw bad('Enter the DO or invoice number.');
  if (!isDate(out.date)) throw bad('Choose the delivery date.');
  if (timing === 'window' && (!isTime(out.window_from) || !isTime(out.window_to) || out.window_from >= out.window_to)) throw bad('Enter a time window where the end is after the start.');
  if ((out.collect_type === 'cash' || out.collect_type === 'cheque') && out.collect_amount <= 0) throw bad('Enter the amount the driver must collect.');
  if (out.collect_type === 'none' || out.collect_type === 'documents') out.collect_amount = 0;
  return out;
}

/** Order lines arrive as a list (or its JSON text) and are stored as JSON. */
function linesField(raw: unknown): string {
  if (raw == null || raw === '') return '';
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      throw bad('The order lines could not be read.');
    }
  }
  if (!Array.isArray(list)) throw bad('The order lines could not be read.');
  if (list.length > 60) throw bad('A delivery can have up to 60 lines.');
  const clean: OrderLine[] = list
    .map((l) => ({ d: str((l as OrderLine)?.d, 120), q: Number((l as OrderLine)?.q), u: str((l as OrderLine)?.u, 20) }))
    .filter((l) => l.d);
  for (const l of clean) if (!(l.q > 0 && l.q <= 1_000_000)) throw bad(`Enter a quantity for “${l.d}”.`);
  return clean.length ? JSON.stringify(clean) : '';
}

export function parseLines(json: string): OrderLine[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Cost of the delivery as it will be planned: with the vehicle staff chose on the cost
 * screen, or else the cheapest vehicle (own or hired) that carries the load.
 */
function estimateFor(book: OrgBook, s: OrgSettings, f: { shop_id: string; address_id: string; weight_kg: number; volume_cbm: number; invoice_value: number; delivery_charge: number; plan_vehicle_id: string; helpers: number; equipment: Equipment; wait_minutes: number; date: string }) {
  const shop = shopOf(book, f.shop_id);
  const adr = book.get<Address>('addresses', f.address_id);
  if (!adr) throw bad('Choose a delivery address.');
  const pool = book.all<Vehicle>('vehicles').filter((v) => v.active && vehicleInShop(v, f.shop_id));
  const load = { weight_kg: f.weight_kg, volume_cbm: f.volume_cbm };
  const extras = extrasOf(book, f);
  const ranked = rankVehicles(pool, { from: shop, to: adr, load, settings: s, invoiceValue: f.invoice_value, deliveryCharge: f.delivery_charge, extras, date: f.date });
  const chosen = ranked.find((o) => o.vehicle.id === f.plan_vehicle_id) ?? ranked.find((o) => o.fit.ok);
  if (chosen && !chosen.fit.ok) throw bad(`${vehicleLabel(chosen.vehicle)} cannot carry this load (${f.weight_kg} kg, ${f.volume_cbm} cbm).`);
  const quote = chosen?.quote ?? quoteDelivery({ from: shop, to: adr, settings: s, invoiceValue: f.invoice_value, deliveryCharge: f.delivery_charge, extras, date: f.date });
  return { quote, vehicleId: chosen?.vehicle.id ?? '' };
}

export async function createDelivery(deps: Deps, a: Actor, body: Record<string, unknown>) {
  need(a, 'deliveries.create');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const f = deliveryFields(body);
  assertShop(a, book, f.shop_id);
  const c = book.get<Customer>('customers', f.customer_id);
  if (!c) throw bad('Choose a customer.');
  const adr = book.get<Address>('addresses', f.address_id);
  if (!adr || adr.customer_id !== c.id) throw bad('Choose one of this customer’s addresses.');
  const { quote: est, vehicleId: planned } = estimateFor(book, s, f);
  const d: Delivery = {
    ...f,
    plan_vehicle_id: planned,
    id: uid('dl_'),
    ref: nextRef(book),
    collected_amount: null,
    collected_note: '',
    status: 'unassigned',
    driver_id: '',
    vehicle_id: '',
    trip_id: '',
    decline_reason: '',
    fail_reason: '',
    receiver_name: '',
    delivered_at: '',
    eta: '',
    est_distance_km: est.distance_km,
    est_minutes: est.minutes,
    est_cost: est.cost,
    trip_cost: null,
    rating: null,
    rating_comment: '',
    tracking_token: `${a.orgId}.${token()}`,
    created_by: a.id,
    created_at: nowISO(),
    updated_at: nowISO(),
  } as Delivery;
  book.insert('deliveries', d as unknown as Record<string, unknown>);
  addEvent(book, d, 'unassigned', a.name);
  logActivity(book, a, 'Created delivery', 'delivery', d.id, `${d.ref} for ${c.name}, ${d.doc_kind} ${d.doc_number}`, d.shop_id);
  await book.commit();
  return d;
}

export async function updateDelivery(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  need(a, 'deliveries.create');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const cur = loadDelivery(a, book, id);
  if (!isReassignable(cur.status)) throw bad(`${cur.ref} has left the shop and can no longer be changed.`);
  const f = deliveryFields(body, cur);
  assertShop(a, book, f.shop_id);
  if (f.shop_id !== cur.shop_id && cur.trip_id) throw bad('Remove it from its trip before moving it to another shop.');
  const adr = book.get<Address>('addresses', f.address_id);
  if (!adr || adr.customer_id !== f.customer_id) throw bad('Choose one of this customer’s addresses.');
  const { quote: est, vehicleId: planned } = estimateFor(book, s, f);
  const next = book.update<Delivery>('deliveries', id, { ...f, plan_vehicle_id: planned, est_distance_km: est.distance_km, est_minutes: est.minutes, est_cost: est.cost, updated_at: nowISO() } as Partial<Delivery>);
  if (next.trip_id) recomputeTrip(book, s, next.trip_id);
  logActivity(book, a, 'Changed delivery', 'delivery', id, next.ref, next.shop_id);
  await book.commit();
  return next;
}

export async function cancelDelivery(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const d = loadDelivery(a, book, id);
  if (!isReassignable(d.status)) throw bad(`${d.ref} has left the shop and cannot be cancelled.`);
  const reason = str(body.reason, 200) || 'Cancelled';
  move(book, d, 'cancelled', a.name, reason);
  detach(book, s, d);
  logActivity(book, a, 'Cancelled delivery', 'delivery', id, `${d.ref}: ${reason}`, d.shop_id);
  await book.commit();
  return book.get<Delivery>('deliveries', id);
}

export async function rescheduleDelivery(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const d = loadDelivery(a, book, id);
  const date = body.date;
  if (!isDate(date)) throw bad('Choose the new date.');
  if (d.status === 'failed') move(book, d, 'unassigned', a.name, `Rescheduled to ${date}`);
  else if (d.status !== 'unassigned') throw bad('Only unassigned or failed deliveries can be moved to another date.');
  detach(book, s, d);
  book.update<Delivery>('deliveries', id, { date, driver_id: '', vehicle_id: '', fail_reason: '', updated_at: nowISO() });
  logActivity(book, a, 'Rescheduled delivery', 'delivery', id, `${d.ref} to ${date}`, d.shop_id);
  await book.commit();
  return book.get<Delivery>('deliveries', id);
}

function checkDriverVehicle(book: OrgBook, shopId: string, driverId: string, vehicleId: string, loads: Delivery[]) {
  const driver = book.get<Staff>('staff', driverId);
  if (!driver || driver.role !== 'driver' || !driver.active) throw bad('Choose an active driver.');
  if (!hasShop(driver.shop_ids, shopId)) throw bad(`${driver.name} does not work for this shop.`);
  const v = book.get<Vehicle>('vehicles', vehicleId);
  if (!v || !v.active) throw bad('Choose a vehicle that is in use.');
  if (!vehicleInShop(v, shopId)) throw bad(`${vehicleLabel(v)} belongs to another shop.`);
  const load = { weight_kg: loads.reduce((x, d) => x + d.weight_kg, 0), volume_cbm: loads.reduce((x, d) => x + d.volume_cbm, 0) };
  const fit = fits(v, load);
  if (!fit.weight) throw bad(`The load is ${load.weight_kg} kg but ${vehicleLabel(v)} carries up to ${v.capacity_kg} kg.`);
  if (!fit.volume) throw bad(`The load is ${load.volume_cbm} cbm but ${vehicleLabel(v)} holds ${v.capacity_cbm} cbm.`);
  return { driver, v };
}

export async function buildTrip(deps: Deps, a: Actor, body: Record<string, unknown>) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const shopId = str(body.shop_id, 40);
  assertShop(a, book, shopId);
  const date = body.date;
  if (!isDate(date)) throw bad('Choose the trip date.');
  const ids = Array.isArray(body.delivery_ids) ? (body.delivery_ids as string[]) : [];
  if (!ids.length) throw bad('Pick at least one delivery.');
  const list = ids.map((id) => loadDelivery(a, book, id));
  const { driver, v } = checkDriverVehicle(book, shopId, str(body.driver_id, 40), str(body.vehicle_id, 40), list);
  for (const d of list) {
    if (d.shop_id !== shopId) throw bad(`${d.ref} belongs to another shop.`);
    if (!isReassignable(d.status)) throw bad(`${d.ref} is already on the road.`);
  }
  for (const d of list) detach(book, s, d);
  const trip: Trip = { id: uid('trip_'), shop_id: shopId, date, driver_id: driver.id, vehicle_id: v.id, stop_ids: list.map((d) => d.id).join(','), distance_km: 0, naive_distance_km: 0, minutes: 0, naive_minutes: 0, cost: 0, created_by: a.id, created_at: nowISO() };
  book.insert('trips', trip as unknown as Record<string, unknown>);
  for (const d of list) {
    book.update<Delivery>('deliveries', d.id, { trip_id: trip.id, driver_id: driver.id, vehicle_id: v.id, date, decline_reason: '' });
    move(book, book.get<Delivery>('deliveries', d.id)!, 'assigned', a.name, d.status === 'unassigned' ? '' : 'Moved to a new trip');
  }
  const startTime = isTime(body.start_time) ? body.start_time : '08:00';
  const planned = zonedToUtc(date, startTime, s.time_zone);
  recomputeTrip(book, s, trip.id, planned.getTime() < Date.now() ? new Date() : planned);
  logActivity(book, a, 'Planned trip', 'trip', trip.id, `${list.length} deliveries for ${driver.name} in ${vehicleLabel(v)} on ${date}`, shopId);
  await book.commit();
  return book.get<Trip>('trips', trip.id);
}

/** Assign or move one delivery: it joins the driver's not-yet-started trip that day, or starts a new one. */
export async function assignDelivery(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const d = loadDelivery(a, book, id);
  if (!isReassignable(d.status)) throw bad(`${d.ref} has left the shop. Ask the driver to bring it back first.`);
  const driverId = str(body.driver_id, 40);
  const open = book
    .all<Trip>('trips')
    .find((t) => t.date === d.date && t.driver_id === driverId && t.shop_id === d.shop_id && stopIds(t).every((sid) => {
      const x = book.get<Delivery>('deliveries', sid);
      return !x || isReassignable(x.status) || x.status === 'cancelled';
    }));
  const onTrip = open ? stopIds(open).map((sid) => book.get<Delivery>('deliveries', sid)).filter((x): x is Delivery => !!x && x.id !== d.id && x.status !== 'cancelled') : [];
  const { driver, v } = checkDriverVehicle(book, d.shop_id, driverId, open?.vehicle_id ?? (str(body.vehicle_id, 40) || d.plan_vehicle_id), [...onTrip, d]);
  detach(book, s, d);
  let tripId = open?.id;
  if (!open) {
    tripId = uid('trip_');
    book.insert('trips', { id: tripId, shop_id: d.shop_id, date: d.date, driver_id: driver.id, vehicle_id: v.id, stop_ids: d.id, distance_km: 0, naive_distance_km: 0, minutes: 0, naive_minutes: 0, cost: 0, created_by: a.id, created_at: nowISO() });
  } else {
    book.update<Trip>('trips', open.id, { stop_ids: [...stopIds(open), d.id].join(',') });
  }
  const moving = !!d.driver_id;
  book.update<Delivery>('deliveries', id, { trip_id: tripId!, driver_id: driver.id, vehicle_id: v.id, decline_reason: '' });
  move(book, book.get<Delivery>('deliveries', id)!, 'assigned', a.name, moving ? `Moved to ${driver.name}` : '');
  recomputeTrip(book, s, tripId!);
  logActivity(book, a, moving ? 'Reassigned delivery' : 'Assigned delivery', 'delivery', id, `${d.ref} to ${driver.name}`, d.shop_id);
  await book.commit();
  return book.get<Delivery>('deliveries', id);
}

export async function unassignDelivery(deps: Deps, a: Actor, id: string) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const d = loadDelivery(a, book, id);
  if (d.status === 'unassigned') return d;
  if (!isReassignable(d.status)) throw bad(`${d.ref} has left the shop.`);
  move(book, d, 'unassigned', a.name, 'Removed from trip');
  detach(book, s, d);
  book.update<Delivery>('deliveries', id, { driver_id: '', vehicle_id: '' });
  logActivity(book, a, 'Removed delivery from trip', 'delivery', id, d.ref, d.shop_id);
  await book.commit();
  return book.get<Delivery>('deliveries', id);
}

export async function listTrips(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'deliveries.view');
  const book = await openOrg(deps, a, 'trips');
  const s = readSettings(book);
  const shops = shopFilter(a, book, q);
  const date = isDate(q.get('date')) ? q.get('date')! : dateInZone(s.time_zone);
  return book.all<Trip>('trips').filter((t) => shops.has(t.shop_id) && t.date === date && t.stop_ids);
}

export { dateInZone, timeInZone, addDays, forbidden, ApiError };
