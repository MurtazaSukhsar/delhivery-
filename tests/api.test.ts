// End-to-end tests of the API against an in-memory spreadsheet and fake logins.
// Run: npm test
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/_shared/app.ts';
import { memoryDeps, SUPER_ADMIN } from '../scripts/fake-auth.ts';
import { quoteDelivery, rankVehicles, driverMonthlyCost, driverCostPerMinute, formatMoney, ownVsHire } from '../supabase/functions/_shared/domain/cost.ts';
import { DEFAULT_SETTINGS, type Vehicle } from '../supabase/functions/_shared/domain/types.ts';
import { fuelPriceFor, restrictionsFor } from '../supabase/functions/_shared/domain/gcc.ts';
import { feeByPriceList, feeForMargin } from '../supabase/functions/_shared/domain/pricing.ts';

const { deps, sheets, auth, files } = memoryDeps();
const ORG_SHEET = 'org-sheet-technical-hardware-0001';
sheets.createBook(ORG_SHEET);

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name);
    throw e;
  }
}

// deno-lint-ignore no-explicit-any
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await handle(
    new Request('http://localhost/api' + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    deps,
  );
  return { status: res.status, data: await res.json() };
}
async function ok(token: string | null, method: string, path: string, body?: unknown) {
  const r = await call(token, method, path, body);
  assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function fails(status: number, token: string | null, method: string, path: string, body?: unknown) {
  const r = await call(token, method, path, body);
  assert.equal(r.status, status, `${method} ${path} expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.error as string;
}
const login = (l: string, p: string) => auth.signIn(l, p, deps.phoneLoginDomain).token;

const superId = await auth.createUser({ email: SUPER_ADMIN, password: 'platform-pass', app_metadata: {} });
const SUPER = auth.tokenFor(superId);
const T: Record<string, string> = {};
const ids: Record<string, string> = {};

console.log('Platform');
await test('no token is rejected', async () => {
  await fails(401, null, 'GET', '/me');
});
await test('a sheet not shared with the service account gives a clear message', async () => {
  const err = await fails(400, SUPER, 'POST', '/platform/orgs', { name: 'X', slug: 'xx', sheet: 'not-shared-sheet-id-000000000', admin_name: 'A', admin_email: 'a@x.com', admin_password: 'password1' });
  assert.match(err, /Share it with/);
});
await test('platform admin creates an organisation and its spreadsheet is laid out', async () => {
  const org = await ok(SUPER, 'POST', '/platform/orgs', {
    name: 'Technical Hardware',
    slug: 'technical-hardware',
    sheet: `https://docs.google.com/spreadsheets/d/${ORG_SHEET}/edit#gid=0`,
    admin_name: 'Salim Al Harthy',
    admin_email: 'salim@technicalhardware.om',
    admin_password: 'admin-pass-1',
  });
  ids.org = org.id;
  const tabs = await sheets.listTabs(ORG_SHEET);
  for (const t of ['settings', 'shops', 'staff', 'deliveries', 'delivery_events', 'trips', 'activity_log']) assert.ok(tabs.includes(t), t);
  const header = (await sheets.readTabs(ORG_SHEET, ['deliveries']))[0][0];
  assert.ok(header.includes('tracking_token'));
  const orgs = await ok(SUPER, 'GET', '/platform/orgs');
  assert.equal(orgs.length, 1);
  T.admin = login('salim@technicalhardware.om', 'admin-pass-1');
});
await test('slug must be unique', async () => {
  sheets.createBook('another-sheet-000000000000000');
  await fails(400, SUPER, 'POST', '/platform/orgs', { name: 'Y', slug: 'technical-hardware', sheet: 'another-sheet-000000000000000', admin_name: 'A', admin_email: 'b@x.com', admin_password: 'password1' });
});

console.log('Organisation admin');
await test('/me returns the organisation and role', async () => {
  const me = await ok(T.admin, 'GET', '/me');
  assert.equal(me.user.role, 'org_admin');
  assert.equal(me.org.name, 'Technical Hardware');
});
await test('admin adds two shops', async () => {
  ids.shopA = (await ok(T.admin, 'POST', '/shops', { name: 'Ghala main store', kind: 'warehouse', address: 'Ghala Industrial', lat: 23.5847, lng: 58.3339 })).id;
  ids.shopB = (await ok(T.admin, 'POST', '/shops', { name: 'Sohar branch', address: 'Sohar Industrial', lat: 24.3476, lng: 56.7094 })).id;
  await fails(400, T.admin, 'POST', '/shops', { name: 'Ghala main store', lat: 1, lng: 1 });
});
await test('admin adds staff and drivers for each shop', async () => {
  await ok(T.admin, 'POST', '/staff', { name: 'Fatma', email: 'fatma@th.om', password: 'staff-pass-1', role: 'staff', shop_ids: ids.shopA });
  await ok(T.admin, 'POST', '/staff', { name: 'Hamad', email: 'hamad@th.om', password: 'staff-pass-2', role: 'staff', shop_ids: ids.shopB });
  await ok(T.admin, 'POST', '/staff', { name: 'Yousuf', email: 'yousuf@th.om', password: 'staff-pass-3', role: 'staff', shop_ids: ids.shopA });
  ids.driverA = (await ok(T.admin, 'POST', '/staff', { name: 'Ahmed Al Hinai', phone: '9200 0001', password: 'drive-pass-1', role: 'driver', shop_ids: ids.shopA })).id;
  ids.driverB = (await ok(T.admin, 'POST', '/staff', { name: 'Imran Khan', phone: '+968 9200 0002', password: 'drive-pass-2', role: 'driver', shop_ids: ids.shopB })).id;
  await fails(400, T.admin, 'POST', '/staff', { name: 'Dup', phone: '92000001', password: 'whatever1', role: 'driver', shop_ids: ids.shopA });
  await fails(400, T.admin, 'POST', '/staff', { name: 'Old role', email: 'old@th.om', password: 'whatever1', role: 'dispatcher', shop_ids: ids.shopA });
  T.disp = login('fatma@th.om', 'staff-pass-1');
  T.mgr = login('hamad@th.om', 'staff-pass-2');
  T.staff2 = login('yousuf@th.om', 'staff-pass-3');
  T.driverA = login('92000001', 'drive-pass-1'); // drivers sign in with phone
  T.driverB = login('+968 92000002', 'drive-pass-2');
});
await test('only the admin manages the company; staff and drivers cannot', async () => {
  await fails(403, T.disp, 'POST', '/shops', { name: 'Z', lat: 1, lng: 1 });
  await fails(403, T.disp, 'POST', '/staff', { name: 'Boss', email: 'boss@th.om', password: 'password1', role: 'org_admin', shop_ids: '*' });
  await fails(403, T.disp, 'GET', '/staff');
  await fails(403, T.disp, 'PUT', '/settings', { fuel_price_per_litre: 9 });
  await fails(403, T.disp, 'GET', '/activity');
  await fails(403, T.driverA, 'GET', '/deliveries');
  await fails(403, T.driverA, 'GET', '/customers');
});
await test('staff see the drivers of their own shop only', async () => {
  const a = await ok(T.disp, 'GET', '/drivers');
  assert.deepEqual(a.map((d: { name: string }) => d.name), ['Ahmed Al Hinai']);
  const b = await ok(T.mgr, 'GET', '/drivers');
  assert.deepEqual(b.map((d: { name: string }) => d.name), ['Imran Khan']);
});
await test('settings save and read back', async () => {
  const s = await ok(T.admin, 'PUT', '/settings', { fuel_price_per_litre: 0.25, phone: '+968 2450 0000' });
  assert.equal(s.fuel_price_per_litre, 0.25);
  assert.equal(s.deliveries_per_vehicle_day, undefined, 'the old setting is gone');
  assert.equal((await ok(T.disp, 'GET', '/settings')).phone, '+968 2450 0000');
});

console.log('Records');
await test('areas, customers and vehicles', async () => {
  ids.areaSeeb = (await ok(T.admin, 'POST', '/areas', { name: 'Seeb', default_charge: 3, lat: 23.67, lng: 58.19 })).id;
  const c1 = await ok(T.disp, 'POST', '/customers', { name: 'Bayt Al Hijar Contracting', phone: '+968 9911 0001', addresses: [{ label: 'Villa site', line: 'Al Hail North plot 112', area_id: ids.areaSeeb, lat: 23.6531, lng: 58.2094 }] });
  const c2 = await ok(T.disp, 'POST', '/customers', { name: 'Ruwi Steel', phone: '+968 9911 0004', addresses: [{ label: 'Store', line: 'Ruwi High Street', lat: 23.5906, lng: 58.5433 }] });
  const c3 = await ok(T.staff2, 'POST', '/customers', { name: 'Mabela Plumbing', phone: '+968 9911 0007', addresses: [{ label: 'Yard', line: 'Al Mabela St 18', lat: 23.6489, lng: 58.2589 }] });
  Object.assign(ids, { c1: c1.id, a1: c1.addresses[0].id, c2: c2.id, a2: c2.addresses[0].id, c3: c3.id, a3: c3.addresses[0].id });
  ids.vehA = (await ok(T.admin, 'POST', '/vehicles', { shop_id: ids.shopA, plate: '4521 ab', type: 'Pickup', capacity_kg: 1000, capacity_cbm: 2.5, fuel_use: 12.5 })).id;
  await fails(403, T.disp, 'POST', '/vehicles', { shop_id: ids.shopA, plate: '1', type: 'Van' });
  await fails(403, T.mgr, 'POST', '/vehicles', { shop_id: ids.shopA, plate: '9999 XY', type: 'Van' });
  ids.vehB = (await ok(T.admin, 'POST', '/vehicles', { shop_id: ids.shopB, plate: '7788 RM', type: 'Van', capacity_kg: 900, capacity_cbm: 6 })).id;
  await ok(T.admin, 'POST', '/vehicle-documents', { vehicle_id: ids.vehA, type: 'insurance', number: 'INS-1', expiry: '2027-01-01' });
  const vs = await ok(T.disp, 'GET', '/vehicles?shop=all');
  assert.equal(vs.length, 1, 'staff of shop A see only shop A vehicles');
  assert.equal(vs[0].plate, '4521 AB');
  assert.equal(vs[0].capacity_cbm, 2.5);
  assert.equal(vs[0].documents.length, 1);
});

console.log('Deliveries');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const afterTomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
await test('create deliveries with a cost estimate', async () => {
  const base = { shop_id: ids.shopA, doc_kind: 'DO', date: today, timing: 'flexible', weight_kg: 120 };
  const d1 = await ok(T.disp, 'POST', '/deliveries', { ...base, doc_number: 'DO-1', customer_id: ids.c1, address_id: ids.a1, invoice_value: 820, delivery_charge: 0 });
  const d2 = await ok(T.staff2, 'POST', '/deliveries', { ...base, doc_number: 'DO-2', customer_id: ids.c2, address_id: ids.a2, invoice_value: 145, delivery_charge: 3, collect_type: 'cash', collect_amount: 148 });
  const d3 = await ok(T.disp, 'POST', '/deliveries', { ...base, doc_number: 'INV-3', doc_kind: 'Invoice', customer_id: ids.c3, address_id: ids.a3, invoice_value: 312, urgent: true, timing: 'window', window_from: '09:00', window_to: '12:00' });
  assert.equal(d1.ref, 'DL-1001');
  assert.equal(d3.ref, 'DL-1003');
  assert.ok(d1.est_cost > 0 && d1.est_distance_km > 0);
  assert.ok(d3.tracking_token.startsWith(ids.org + '.'));
  Object.assign(ids, { d1: d1.id, d2: d2.id, d3: d3.id, tok1: d1.tracking_token });
  await fails(400, T.disp, 'POST', '/deliveries', { ...base, doc_number: '', customer_id: ids.c1, address_id: ids.a1 });
  await fails(400, T.disp, 'POST', '/deliveries', { ...base, doc_number: 'X', customer_id: ids.c1, address_id: ids.a2 });
  await fails(403, T.disp, 'POST', '/deliveries', { ...base, shop_id: ids.shopB, doc_number: 'X', customer_id: ids.c1, address_id: ids.a1 });
});
await test('staff of another shop cannot see them', async () => {
  const r = await ok(T.mgr, 'GET', '/deliveries');
  assert.equal(r.deliveries.length, 0);
  await fails(404, T.mgr, 'GET', `/deliveries/${ids.d1}`);
});
await test('staff of another shop cannot plan this shop\u2019s deliveries', async () => {
  await fails(403, T.mgr, 'POST', '/trips', { shop_id: ids.shopA, date: today, driver_id: ids.driverA, vehicle_id: ids.vehA, delivery_ids: [ids.d1] });
});
await test('a driver from another shop cannot be assigned', async () => {
  await fails(400, T.disp, 'POST', '/trips', { shop_id: ids.shopA, date: today, driver_id: ids.driverB, vehicle_id: ids.vehA, delivery_ids: [ids.d1] });
});
await test('dispatcher plans one trip; urgent stop goes first', async () => {
  const trip = await ok(T.disp, 'POST', '/trips', { shop_id: ids.shopA, date: today, driver_id: ids.driverA, vehicle_id: ids.vehA, delivery_ids: [ids.d1, ids.d2, ids.d3], start_time: '08:00' });
  const stops = trip.stop_ids.split(',');
  assert.equal(stops.length, 3);
  assert.equal(stops[0], ids.d3, 'urgent first');
  assert.ok(trip.distance_km > 0 && trip.cost > 0);
  const { deliveries } = await ok(T.disp, 'GET', '/deliveries');
  for (const d of deliveries) {
    assert.equal(d.status, 'assigned');
    assert.ok(d.eta, 'has eta');
    assert.ok(d.trip_cost > 0, 'has cost share');
  }
  ids.trip = trip.id;
});

console.log('Driver');
await test('drivers see only their own deliveries, in driving order', async () => {
  const a = await ok(T.driverA, 'GET', '/driver/today');
  assert.equal(a.deliveries.length, 3);
  assert.equal(a.deliveries[0].id, ids.d3);
  assert.equal(a.deliveries[0].customer.name, 'Mabela Plumbing');
  const b = await ok(T.driverB, 'GET', '/driver/today');
  assert.equal(b.deliveries.length, 0);
});
await test('shift start; offline batch applies once even if sent twice', async () => {
  await ok(T.driverA, 'POST', '/driver/shift', { action: 'start' });
  const batch = {
    updates: [
      { client_id: 'c1', delivery_id: ids.d1, action: 'accept', at: new Date().toISOString(), offline: true },
      { client_id: 'c2', delivery_id: ids.d2, action: 'accept', at: new Date().toISOString(), offline: true },
      { client_id: 'c3', delivery_id: ids.d3, action: 'accept', at: new Date().toISOString(), offline: true },
      { client_id: 'c4', delivery_id: ids.d2, action: 'decline', reason: 'Vehicle problem', at: new Date().toISOString() },
      { client_id: 'c5', delivery_id: ids.d1, action: 'pickup', at: new Date().toISOString() },
      { client_id: 'c6', delivery_id: ids.d3, action: 'pickup', at: new Date().toISOString() },
      { client_id: 'c7', delivery_id: ids.d3, action: 'arrive', at: new Date().toISOString() },
      { client_id: 'c8', delivery_id: ids.d3, action: 'deliver', receiver_name: 'Majid', at: new Date().toISOString() },
      { client_id: 'c9', delivery_id: ids.d1, action: 'fail', reason: 'Customer site closed', at: new Date().toISOString() },
    ],
  };
  const r1 = await ok(T.driverA, 'POST', '/driver/sync', batch);
  assert.ok(r1.results.every((x: { ok: boolean }) => x.ok), JSON.stringify(r1.results));
  const before = (await sheets.readTabs(ORG_SHEET, ['delivery_events']))[0].length;
  const r2 = await ok(T.driverA, 'POST', '/driver/sync', batch);
  assert.ok(r2.results.every((x: { ok: boolean }) => x.ok));
  const after = (await sheets.readTabs(ORG_SHEET, ['delivery_events']))[0].length;
  assert.equal(after, before, 'resending creates no duplicate events');
  const det = await ok(T.disp, 'GET', `/deliveries/${ids.d3}`);
  assert.equal(det.delivery.status, 'delivered');
  assert.equal(det.delivery.receiver_name, 'Majid');
  assert.ok(det.events.some((e: { offline: boolean }) => e.offline));
  const d2 = (await ok(T.disp, 'GET', `/deliveries/${ids.d2}`)).delivery;
  assert.equal(d2.status, 'unassigned');
  assert.equal(d2.decline_reason, 'Vehicle problem');
  assert.equal(d2.trip_id, '');
});
await test('a stale update is reported, not applied', async () => {
  const r = await ok(T.driverA, 'POST', '/driver/sync', { updates: [{ client_id: 'c10', delivery_id: ids.d2, action: 'pickup', at: new Date().toISOString() }] });
  assert.equal(r.results[0].ok, false);
});
await test('shift cannot end with deliveries still open; failed delivery is rescheduled', async () => {
  await ok(T.disp, 'POST', `/deliveries/${ids.d2}/assign`, { driver_id: ids.driverA, vehicle_id: ids.vehA });
  await ok(T.driverA, 'POST', '/driver/sync', { updates: [{ client_id: 'c11', delivery_id: ids.d2, action: 'accept', at: new Date().toISOString() }] });
  await fails(400, T.driverA, 'POST', '/driver/shift', { action: 'end' });
  const d1 = await ok(T.disp, 'POST', `/deliveries/${ids.d1}/reschedule`, { date: tomorrow });
  assert.equal(d1.status, 'unassigned');
  assert.equal(d1.date, tomorrow);
});
await test('cancel, and cannot cancel once on the road', async () => {
  await ok(T.disp, 'POST', `/deliveries/${ids.d2}/cancel`, { reason: 'Customer cancelled' });
  await fails(400, T.disp, 'POST', `/deliveries/${ids.d3}/cancel`, {});
});

console.log('Customer tracking');
await test('public tracking shows only what the customer needs', async () => {
  const d3 = (await ok(T.disp, 'GET', `/deliveries/${ids.d3}`)).delivery;
  const t = await ok(null, 'GET', `/track/${d3.tracking_token}`);
  assert.equal(t.delivery.status, 'delivered');
  assert.equal(t.delivery.driver_first_name, 'Ahmed');
  assert.equal(t.company.name, 'Technical Hardware');
  assert.equal(t.delivery.customer_id, undefined);
  await ok(null, 'POST', `/track/${d3.tracking_token}/rate`, { stars: 5, comment: 'Quick' });
  assert.equal((await ok(T.disp, 'GET', `/deliveries/${ids.d3}`)).delivery.rating, 5);
  await fails(404, null, 'GET', `/track/${ids.org}.nope`);
  await fails(404, null, 'GET', `/track/garbage`);
});

console.log('Audit and access');
await test('activity log records who did what', async () => {
  const log = await ok(T.admin, 'GET', '/activity');
  const actions = log.map((e: { action: string }) => e.action);
  for (const a of ['Created organisation', 'Added shop', 'Added staff', 'Created delivery', 'Planned trip', 'Started shift', 'Cancelled delivery']) assert.ok(actions.includes(a), a);
});
await test('switching off a staff account blocks it', async () => {
  const staff = await ok(T.admin, 'GET', '/staff');
  const yousuf = staff.find((s: { name: string }) => s.name === 'Yousuf');
  await ok(T.admin, 'PATCH', `/staff/${yousuf.id}`, { active: false });
  await fails(401, T.staff2, 'GET', '/me');
  await fails(400, T.admin, 'PATCH', `/staff/${(await ok(T.admin, 'GET', '/me')).user.id}`, { active: false });
});
await test('suspending the organisation locks its users out', async () => {
  await ok(SUPER, 'PATCH', `/platform/orgs/${ids.org}`, { status: 'suspended' });
  await fails(403, T.admin, 'GET', '/me');
  await ok(SUPER, 'PATCH', `/platform/orgs/${ids.org}`, { status: 'active' });
  await ok(T.admin, 'GET', '/me');
});

console.log('Capacity, hire and the cost sums');
const shopACoords = { lat: 23.5847, lng: 58.3339 };
await test('a small, far order: 100 km away, 50 OMR, 100 kg fits the pickup and the sums are all shown', async () => {
  const far = await ok(T.disp, 'POST', '/customers', { name: 'Musannah Date Farm', phone: '+968 9911 0010', addresses: [{ label: 'Farm', line: 'Al Musannah', lat: 23.74, lng: 57.6 }] });
  Object.assign(ids, { cFar: far.id, aFar: far.addresses[0].id });
  const d = await ok(T.disp, 'POST', '/deliveries', { shop_id: ids.shopA, doc_kind: 'Invoice', doc_number: 'INV-FAR', date: tomorrow, customer_id: far.id, address_id: far.addresses[0].id, invoice_value: 50, delivery_charge: 0, weight_kg: 100, volume_cbm: 0.5 });
  assert.equal(d.plan_vehicle_id, ids.vehA, 'planned on the pickup');
  assert.ok(d.est_distance_km > 150 && d.est_distance_km < 260, `round trip ${d.est_distance_km}`);
  const settings = await ok(T.disp, 'GET', '/settings');
  const q = quoteDelivery({ from: shopACoords, to: { lat: 23.74, lng: 57.6 }, vehicle: { fuel_use: 12.5, maintenance_per_km: 0.03, ownership: 'owned', rental_per_day: 0 }, settings, invoiceValue: 50, deliveryCharge: 0 });
  assert.equal(q.cost, d.est_cost, 'the browser and the server add up the same');
  assert.deepEqual(q.lines.map((l) => l.key), ['fuel', 'vehicle', 'driver', 'overhead']);
  assert.ok(q.lines.every((l) => l.detail.length > 10 && l.amount >= 0));
  assert.equal(q.band, 'loss', 'a 50 OMR order cannot pay for a 100 km trip');
  assert.ok(q.break_even_charge > 10, `break-even ${q.break_even_charge}`);
  assert.ok(Math.abs(q.budget - 1.5) < 0.001, 'budget = charge 0 + 3% of 50');
});
await test('a load the pickup cannot carry is refused, by weight and by volume', async () => {
  const base = { shop_id: ids.shopA, doc_kind: 'DO', doc_number: 'DO-BIG', date: tomorrow, customer_id: ids.c1, address_id: ids.a1, invoice_value: 100, plan_vehicle_id: ids.vehA };
  const w = await fails(400, T.disp, 'POST', '/deliveries', { ...base, weight_kg: 1500, volume_cbm: 1 });
  assert.match(w, /cannot carry/);
  const v = await fails(400, T.disp, 'POST', '/deliveries', { ...base, weight_kg: 100, volume_cbm: 4 });
  assert.match(v, /cannot carry/);
});
await test('a bulky order (48 cbm, 500 OMR) has no vehicle until a hire option is added', async () => {
  const body = { shop_id: ids.shopA, doc_kind: 'Invoice', doc_number: 'INV-BULK', date: afterTomorrow, customer_id: ids.c1, address_id: ids.a1, invoice_value: 500, delivery_charge: 0, weight_kg: 3200, volume_cbm: 48 };
  const none = await ok(T.disp, 'POST', '/deliveries', body);
  assert.equal(none.plan_vehicle_id, '', 'nothing carries it');
  await fails(400, T.disp, 'POST', '/trips', { shop_id: ids.shopA, date: afterTomorrow, driver_id: ids.driverA, vehicle_id: ids.vehA, delivery_ids: [none.id] });
  await fails(403, T.disp, 'POST', '/vehicles', { shop_id: '*', type: 'Truck 10t', ownership: 'rented', rental_per_day: 65, capacity_kg: 10000, capacity_cbm: 60 });
  await fails(400, T.admin, 'POST', '/vehicles', { shop_id: '*', plate: 'OWN 1', type: 'Truck 10t', capacity_kg: 10000 });
  ids.hire = (await ok(T.admin, 'POST', '/vehicles', { shop_id: '*', type: 'Truck 10t', ownership: 'rented', rental_per_day: 65, capacity_kg: 10000, capacity_cbm: 60, fuel_use: 28 })).id;
  await fails(400, T.admin, 'POST', '/vehicles', { shop_id: '*', type: 'truck 10t', ownership: 'rented', rental_per_day: 70, capacity_kg: 10000 });
  ids.bulk = none.id;
});
await test('with a hire option the same order is planned on the hired truck and the hire cost is in the sum', async () => {
  const c = await ok(T.disp, 'GET', '/customers');
  const adr = c.find((x: { id: string }) => x.id === ids.c1).addresses[0];
  const d = await ok(T.disp, 'POST', '/deliveries', { shop_id: ids.shopA, doc_kind: 'Invoice', doc_number: 'INV-BULK2', date: afterTomorrow, customer_id: ids.c1, address_id: adr.id, invoice_value: 500, weight_kg: 3200, volume_cbm: 48 });
  assert.equal(d.plan_vehicle_id, ids.hire);
  const settings = await ok(T.disp, 'GET', '/settings');
  const planning: Vehicle[] = await ok(T.disp, 'GET', '/vehicles/planning');
  assert.ok(planning.some((v) => v.id === ids.hire), 'staff can pick the hire option');
  const options = rankVehicles(planning, { from: shopACoords, to: { lat: 23.6531, lng: 58.2094 }, load: { weight_kg: 3200, volume_cbm: 48 }, settings, invoiceValue: 500, deliveryCharge: 0 });
  assert.equal(options[0].vehicle.id, ids.hire);
  assert.ok(options[0].fit.ok && !options[1].fit.ok, 'the pickup is listed but does not fit');
  assert.ok(options[0].quote.breakdown.rental === 65, 'one day of hire');
  assert.ok(options[0].quote.lines.some((l) => l.key === 'rental' && /65/.test(l.detail)));
  assert.equal(options[0].quote.cost, d.est_cost);
  // The cheaper pickup wins whenever the load fits it.
  const small = rankVehicles(planning, { from: shopACoords, to: { lat: 23.6531, lng: 58.2094 }, load: { weight_kg: 100, volume_cbm: 0.5 }, settings, invoiceValue: 50, deliveryCharge: 0 });
  assert.equal(small[0].vehicle.id, ids.vehA);
  ids.bulk2 = d.id;
});
await test('assigning checks the load against the vehicle', async () => {
  const e1 = await fails(400, T.disp, 'POST', `/deliveries/${ids.bulk2}/assign`, { driver_id: ids.driverA, vehicle_id: ids.vehA });
  assert.match(e1, /carries up to/);
  const done = await ok(T.disp, 'POST', `/deliveries/${ids.bulk2}/assign`, { driver_id: ids.driverA });
  assert.equal(done.vehicle_id, ids.hire, 'defaults to the vehicle it was planned on');
  assert.equal(done.status, 'assigned');
  // A second load that fits the truck by weight but not by cbm is refused
  const e2 = await fails(400, T.disp, 'POST', `/deliveries/${ids.bulk}/assign`, { driver_id: ids.driverA });
  assert.match(e2, /cbm|kg/);
});
await test('staff of another shop can also use the shared hire option', async () => {
  const planning: Vehicle[] = await ok(T.mgr, 'GET', '/vehicles/planning');
  assert.ok(planning.some((v) => v.id === ids.hire));
});

console.log('Problems log');
await test('a screen crash reported by the browser reaches the platform admin only', async () => {
  await ok(null, 'POST', '/client-error', { message: 'Cannot read properties of undefined', page: '/app/deliveries', stack: 'at Deliveries.tsx:12' });
  await ok(null, 'POST', '/client-error', { message: 'Cannot read properties of undefined', page: '/app/deliveries' });
  await fails(400, null, 'POST', '/client-error', { page: '/x' });
  await fails(403, T.admin, 'GET', '/platform/errors');
  const list = await ok(SUPER, 'GET', '/platform/errors');
  const mine = list.filter((e: { message: string }) => e.message.startsWith('Cannot read'));
  assert.equal(mine.length, 1, 'the same problem within a minute is logged once');
  assert.equal(mine[0].source, 'browser');
  assert.equal(mine[0].resolved, false);
  await ok(SUPER, 'PATCH', `/platform/errors/${mine[0].id}`, { resolved: true });
  assert.equal((await ok(SUPER, 'GET', '/platform/errors')).find((e: { id: string }) => e.id === mine[0].id).resolved, true);
});
await test('a client whose spreadsheet is no longer reachable is logged with their organisation', async () => {
  const S2 = 'second-client-sheet-0000000000001';
  sheets.createBook(S2);
  const org2 = await ok(SUPER, 'POST', '/platform/orgs', { name: 'Second Client', slug: 'second-client', sheet: S2, admin_name: 'Sara', admin_email: 'sara@second.om', admin_password: 'second-pass-1' });
  const T2 = login('sara@second.om', 'second-pass-1');
  await ok(T2, 'GET', '/me');
  assert.equal((await ok(T2, 'GET', '/deliveries')).deliveries.length, 0, 'clients never see each other\\u2019s deliveries');
  sheets.books.delete(S2); // somebody deleted or unshared it
  await fails(400, T2, 'GET', '/deliveries');
  const list = await ok(SUPER, 'GET', '/platform/errors');
  const e = list.find((x: { org_id: string }) => x.org_id === org2.id);
  assert.ok(e, 'logged');
  assert.equal(e.source, 'api');
  assert.match(e.message, /Share it with/);
  assert.equal(e.where, 'GET /deliveries');
  ids.org2 = org2.id;
});
await test('the check lists every client, finds the broken ones, and repairs missing tabs', async () => {
  sheets.books.get(ORG_SHEET)!.delete('areas');
  const r = await ok(SUPER, 'POST', '/platform/check', {});
  assert.ok(r.service_account_email.includes('@'));
  const first = r.results.find((x: { org_id: string }) => x.org_id === ids.org);
  const second = r.results.find((x: { org_id: string }) => x.org_id === ids.org2);
  assert.equal(first.ok, false);
  assert.match(first.problem, /areas/);
  assert.equal(second.ok, false);
  const fixed = await ok(SUPER, 'POST', '/platform/check', { repair: true });
  const again = fixed.results.find((x: { org_id: string }) => x.org_id === ids.org);
  assert.equal(again.ok, true);
  assert.deepEqual(again.fixed, ['areas']);
  assert.ok((await sheets.listTabs(ORG_SHEET)).includes('areas'));
  await fails(403, T.admin, 'POST', '/platform/check', {});
});
await test('a spreadsheet from an older version gets its new columns added automatically', async () => {
  const t = sheets.books.get(ORG_SHEET)!.get('vehicles')!;
  const col = t[0].indexOf('capacity_cbm');
  assert.ok(col >= 0);
  t[0].splice(col, 1); // pretend the column was never added
  for (const row of t.slice(1)) row.splice(col, 1);
  const vs = await ok(T.admin, 'GET', '/vehicles?shop=all');
  assert.ok(vs.length > 0);
  assert.ok(sheets.books.get(ORG_SHEET)!.get('vehicles')![0].includes('capacity_cbm'), 'header restored');
});

console.log('GCC costing');
await test('fuel price follows the country and the delivery date, with your own prices on top', async () => {
  const base = { ...DEFAULT_SETTINGS, country: 'AE', fuel_auto: true };
  assert.equal(fuelPriceFor(base, 'diesel', '2026-09-15').price, 4.3);
  assert.equal(fuelPriceFor(base, 'diesel', '2026-10-02').price, 4.8);
  assert.equal(fuelPriceFor({ ...base, country: 'SA' }, 'diesel', '2026-03-01').price, 1.79);
  assert.equal(fuelPriceFor({ ...base, country: 'OM' }, 'diesel', '2026-10-01').price, 0.258);
  const mine = JSON.stringify([{ country: 'AE', fuel: 'diesel', price: 4.65, from: '2026-11-01', source: 'November price' }]);
  assert.equal(fuelPriceFor({ ...base, fuel_prices_json: mine }, 'diesel', '2026-11-05').price, 4.65);
  assert.equal(fuelPriceFor({ ...base, fuel_auto: false, fuel_price_per_litre: 4 }, 'diesel', '2026-11-05').price, 4);
  assert.equal(formatMoney(4.8, base), '4.80 AED');
  assert.equal(formatMoney(19.4781, DEFAULT_SETTINGS), '19.478 OMR');
});
await test('a driver costs more than the salary: housing, visa, insurance and gratuity', async () => {
  const c = driverMonthlyCost(DEFAULT_SETTINGS);
  assert.equal(c.visa, 12.5);
  assert.equal(c.insurance, 10);
  assert.ok(Math.abs(c.gratuity - (325 / 30) * 21 / 12) < 1e-9);
  assert.ok(Math.abs(c.total - (325 + 60 + 12.5 + 10 + c.gratuity)) < 1e-9);
  assert.ok(driverCostPerMinute(DEFAULT_SETTINGS) > 325 / (26 * 9 * 60));
});
await test('helpers, a crane, waiting and tolls are added as their own cost lines', async () => {
  const from = { lat: 23.5847, lng: 58.3339 }, to = { lat: 23.6531, lng: 58.2094 };
  const plain = quoteDelivery({ from, to, settings: DEFAULT_SETTINGS, invoiceValue: 500, deliveryCharge: 0 });
  const extra = quoteDelivery({ from, to, settings: DEFAULT_SETTINGS, invoiceValue: 500, deliveryCharge: 0, extras: { helpers: 2, equipment: 'crane', wait_minutes: 60, toll: 1.5 } });
  const keys = extra.lines.map((l) => l.key);
  for (const k of ['helpers', 'equipment', 'tolls']) assert.ok(keys.includes(k as never), k);
  assert.match(extra.lines.find((l) => l.key === 'driver')!.detail, /60 min waiting/);
  const expect = 2 * 4 + 25 + 1.5 + 60 * driverCostPerMinute(DEFAULT_SETTINGS);
  assert.ok(Math.abs(extra.cost - plain.cost - expect) < 0.01, `${extra.cost - plain.cost} vs ${expect}`);
});
await test('price list: base, distance, weight, volume, add-ons, minimum and free delivery', async () => {
  const s = DEFAULT_SETTINGS;
  const f = feeByPriceList(s, { one_way_km: 10, weight_kg: 500, volume_cbm: 2, invoice_value: 300, helpers: 1, equipment: 'crane', wait_minutes: 105 });
  const expect = s.fee_base + 10 * s.fee_per_km + 5 * s.fee_per_100kg + 2 * s.fee_per_cbm + s.fee_helper + s.fee_crane + 1 * s.fee_wait_per_hour;
  assert.ok(Math.abs(f.total - expect) < 0.001, `${f.total} vs ${expect}`);
  const small = feeByPriceList(s, { one_way_km: 1, weight_kg: 10, volume_cbm: 0, invoice_value: 5, helpers: 0, equipment: 'none', wait_minutes: 0 });
  assert.equal(small.total, s.fee_min);
  assert.ok(small.minimum_applied);
  const free = feeByPriceList({ ...s, fee_free_over: 200 }, { one_way_km: 10, weight_kg: 500, volume_cbm: 2, invoice_value: 300, helpers: 0, equipment: 'none', wait_minutes: 0 });
  assert.equal(free.total, 0);
  assert.ok(free.free);
  assert.equal(feeForMargin(10, 3, s), 9);
});
await test('truck bans and the summer midday ban are flagged for the delivery time', async () => {
  // 2026-10-15 is a Thursday
  const thu = restrictionsFor({ country: 'OM', city: 'Muscat', date: '2026-10-15', from: '13:00', to: '13:30', heavy: true });
  assert.ok(thu.some((r) => r.level === 'warn' && /Thursdays/.test(r.text)));
  assert.equal(restrictionsFor({ country: 'OM', city: 'Muscat', date: '2026-10-15', from: '13:00', to: '13:30', heavy: false }).length, 0);
  const july = restrictionsFor({ country: 'AE', city: 'Dubai', date: '2026-07-10', from: '13:00', to: '14:00', heavy: false });
  assert.ok(july.some((r) => r.level === 'warn' && /midday/.test(r.text)));
  const flexible = restrictionsFor({ country: 'KW', city: 'Kuwait City', date: '2026-10-10', heavy: true });
  assert.ok(flexible.length >= 2 && flexible.every((r) => r.level === 'info'));
});
await test('own vehicle against hired: cheapest of each that fits', async () => {
  const settings = await ok(T.disp, 'GET', '/settings');
  const planning: Vehicle[] = await ok(T.disp, 'GET', '/vehicles/planning');
  const options = rankVehicles(planning, { from: shopACoords, to: { lat: 23.6531, lng: 58.2094 }, load: { weight_kg: 300, volume_cbm: 1 }, settings, invoiceValue: 100, deliveryCharge: 0 });
  const r = ownVsHire(options);
  assert.equal(r.own?.vehicle.id, ids.vehA);
  assert.equal(r.hire?.vehicle.id, ids.hire);
  assert.equal(r.best, 'own');
  assert.ok((r.saving ?? 0) > 0);
});
await test('country must be a GCC country; switching it changes the currency', async () => {
  await fails(400, T.admin, 'PUT', '/settings', { country: 'IN' });
  await fails(400, T.admin, 'PUT', '/settings', { fuel_prices_json: 'not json' });
  const s = await ok(T.admin, 'PUT', '/settings', { country: 'AE', city: 'Dubai' });
  assert.equal(s.country, 'AE');
  await ok(T.admin, 'PUT', '/settings', { country: 'OM', city: 'Muscat' });
});

console.log('Proof of delivery and collections');
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg bytes').toString('base64');
const PNG = 'data:image/png;base64,' + Buffer.from('fake png signature').toString('base64');
await test('order lines, helpers and a crane are saved and costed', async () => {
  const base = { shop_id: ids.shopA, doc_kind: 'DO', date: today, customer_id: ids.c1, address_id: ids.a1, invoice_value: 900, delivery_charge: 0, weight_kg: 600, volume_cbm: 2 };
  const plain = await ok(T.disp, 'POST', '/deliveries', { ...base, doc_number: 'DO-PLAIN' });
  const full = await ok(T.disp, 'POST', '/deliveries', { ...base, doc_number: 'DO-POD', helpers: 2, equipment: 'crane', wait_minutes: 30, lines: [{ d: 'Cement 50 kg', q: 10, u: 'bags' }, { d: 'Rebar 12 mm', q: 20, u: 'pcs' }] });
  assert.ok(full.est_cost > plain.est_cost + 30, `${full.est_cost} vs ${plain.est_cost}`);
  assert.equal(JSON.parse(full.lines).length, 2);
  await fails(400, T.disp, 'POST', '/deliveries', { ...base, doc_number: 'X', lines: [{ d: 'No quantity', q: 0, u: 'pcs' }] });
  ids.pod = full.id;
  ids.cash = (await ok(T.disp, 'POST', '/deliveries', { ...base, doc_number: 'INV-CASH', doc_kind: 'Invoice', collect_type: 'cash', collect_amount: 120, weight_kg: 50, volume_cbm: 0.2 })).id;
  await ok(T.disp, 'POST', `/deliveries/${ids.pod}/assign`, { driver_id: ids.driverA, vehicle_id: ids.vehA });
  await ok(T.disp, 'POST', `/deliveries/${ids.cash}/assign`, { driver_id: ids.driverA, vehicle_id: ids.vehA });
  const trip = (await ok(T.disp, 'GET', `/deliveries/${ids.pod}`)).trip;
  assert.ok(trip.cost >= 25 + 8, 'crane and helpers are in the trip cost');
});
await test('the driver records what arrived, photos, signature and a post-dated cheque', async () => {
  const now = new Date().toISOString();
  const r = await ok(T.driverA, 'POST', '/driver/sync', {
    updates: [
      { client_id: 'p1', delivery_id: ids.pod, action: 'accept', at: now },
      { client_id: 'p2', delivery_id: ids.pod, action: 'pickup', at: now },
      {
        client_id: 'p3', delivery_id: ids.pod, action: 'deliver', at: now, receiver_name: 'Site engineer',
        pod_lines: [{ delivered: 8, damaged: 2, returned: 0 }, { delivered: 20, damaged: 0, returned: 0 }],
        pod_note: 'Two bags torn', photos: [JPEG, JPEG], signature: PNG,
        payment: { method: 'cheque', amount: 900, cheque_no: '004512', bank: 'Bank Muscat', cheque_date: '2026-12-31', photo: JPEG },
      },
      { client_id: 'p4', delivery_id: ids.cash, action: 'accept', at: now },
      { client_id: 'p5', delivery_id: ids.cash, action: 'pickup', at: now },
      { client_id: 'p6', delivery_id: ids.cash, action: 'deliver', at: now, receiver_name: 'Shop owner', payment: { method: 'cash', amount: 120 } },
    ],
  });
  assert.ok(r.results.every((x: { ok: boolean }) => x.ok), JSON.stringify(r.results));
  const det = await ok(T.disp, 'GET', `/deliveries/${ids.pod}`);
  assert.equal(det.delivery.status, 'delivered');
  assert.equal(det.delivery.pod_issue, true);
  assert.deepEqual(JSON.parse(det.delivery.pod_lines)[0], { delivered: 8, damaged: 2, returned: 0, note: '' });
  assert.match(det.events.at(-1).reason, /Cement 50 kg: 8\/10 delivered, 2 damaged/);
  assert.equal(det.pod.photos.length, 2);
  assert.ok(det.pod.signature.startsWith('memory://files/'));
  assert.equal(det.payments.length, 1);
  assert.equal(det.payments[0].cheque_date, '2026-12-31');
  assert.equal(det.payments[0].status, 'with_driver');
  assert.equal(det.pod.cheque_photos.length, 1);
  assert.equal(files.files.size, 4, 'two photos, a signature and the cheque photo stored');
  assert.ok([...files.files.keys()].every((k) => k.startsWith(ids.org + '/deliveries/')));
});
await test('more delivered than ordered, or a broken photo, is refused', async () => {
  const d = await ok(T.disp, 'POST', '/deliveries', { shop_id: ids.shopA, doc_kind: 'DO', doc_number: 'DO-BAD', date: today, customer_id: ids.c1, address_id: ids.a1, invoice_value: 10, weight_kg: 10, lines: [{ d: 'Tiles', q: 5, u: 'box' }] });
  await ok(T.disp, 'POST', `/deliveries/${d.id}/assign`, { driver_id: ids.driverA, vehicle_id: ids.vehA });
  const now = new Date().toISOString();
  const r = await ok(T.driverA, 'POST', '/driver/sync', {
    updates: [
      { client_id: 'b1', delivery_id: d.id, action: 'accept', at: now },
      { client_id: 'b1p', delivery_id: d.id, action: 'pickup', at: now },
      { client_id: 'b2', delivery_id: d.id, action: 'deliver', at: now, receiver_name: 'X', pod_lines: [{ delivered: 6 }] },
      { client_id: 'b3', delivery_id: d.id, action: 'deliver', at: now, receiver_name: 'X', photos: ['data:text/html;base64,PHNjcmlwdD4='] },
    ],
  });
  assert.equal(r.results[2].ok, false);
  assert.match(r.results[2].error, /more than the 5 ordered/);
  assert.equal(r.results[3].ok, false);
  assert.match(r.results[3].error, /photo/);
  assert.equal((await ok(T.disp, 'GET', `/deliveries/${d.id}`)).delivery.status, 'picked_up', 'nothing half-applied');
});
await test('the office receives cash and cheques from the driver and records the difference', async () => {
  await fails(403, T.driverA, 'GET', '/collections');
  const c = await ok(T.disp, 'GET', '/collections');
  const mine = c.payments.filter((p: { driver_id: string; status: string }) => p.driver_id === ids.driverA && p.status === 'with_driver');
  assert.equal(mine.length, 2);
  assert.ok(mine.some((p: { photo_url: string }) => p.photo_url));
  await fails(400, T.disp, 'POST', '/collections/settle', { driver_id: ids.driverB, payment_ids: mine.map((p: { id: string }) => p.id), counted: 120 });
  const st = await ok(T.disp, 'POST', '/collections/settle', { driver_id: ids.driverA, payment_ids: mine.map((p: { id: string }) => p.id), counted: 119, note: 'One rial short' });
  assert.equal(st.expected, 120, 'only cash is counted');
  assert.equal(st.variance, -1);
  await fails(400, T.disp, 'POST', '/collections/settle', { driver_id: ids.driverA, payment_ids: [mine[0].id], counted: 0 });
  const cheque = mine.find((p: { method: string }) => p.method === 'cheque');
  await ok(T.disp, 'PATCH', `/payments/${cheque.id}`, { status: 'deposited' });
  await fails(400, T.disp, 'PATCH', `/payments/${cheque.id}`, { status: 'handed_in' });
  const b = await ok(T.disp, 'PATCH', `/payments/${cheque.id}`, { status: 'bounced', note: 'Insufficient funds' });
  assert.equal(b.status, 'bounced');
  const log = await ok(T.admin, 'GET', '/activity');
  assert.ok(log.some((e: { action: string }) => e.action === 'Cheque bounced'));
  assert.ok(log.some((e: { action: string }) => e.action === 'Received cash and cheques'));
});
await test('the customer’s tracking page shows who received it and the signature', async () => {
  const det = await ok(T.disp, 'GET', `/deliveries/${ids.pod}`);
  const t = await ok(null, 'GET', `/track/${det.delivery.tracking_token}`);
  assert.equal(t.delivery.receiver_name, 'Site engineer');
  assert.ok(t.delivery.pod.signature);
  assert.equal(t.delivery.pod.photos.length, 2);
  assert.equal(t.company.currency.code, 'OMR');
});

console.log('Fleet costs and reports');
await test('fuel, servicing and fines are logged per vehicle; drivers can add fuel', async () => {
  await ok(T.admin, 'POST', '/vehicle-costs', { vehicle_id: ids.vehA, date: today, kind: 'maintenance', amount: 45.5, odometer: 120400, note: 'Oil change' });
  await fails(400, T.admin, 'POST', '/vehicle-costs', { vehicle_id: ids.vehA, date: today, kind: 'party', amount: 1 });
  const fuel = await ok(T.driverA, 'POST', '/driver/fuel', { amount: 12.6, litres: 48.8, odometer: 120450 });
  assert.equal(fuel.vehicle_id, ids.vehA);
  await fails(400, T.driverB, 'POST', '/driver/fuel', { amount: 10 });
  const list = await ok(T.disp, 'GET', `/vehicle-costs?vehicle=${ids.vehA}`);
  assert.equal(list.length, 2);
  await ok(T.disp, 'PATCH', `/vehicle-costs/${fuel.id}`, { vehicle_id: ids.vehA, deleted: true });
  assert.equal((await ok(T.disp, 'GET', `/vehicle-costs?vehicle=${ids.vehA}`)).length, 1);
});
await test('reports get every delivery, payment, cost and shift of the period in one read', async () => {
  await fails(403, T.driverA, 'GET', '/reports');
  await fails(400, T.admin, 'GET', `/reports?from=${today}&to=2020-01-01`);
  const r0 = sheets.calls.read;
  const r = await ok(T.admin, 'GET', `/reports?from=${today}&to=${afterTomorrow}`);
  assert.equal(sheets.calls.read - r0, 1);
  assert.ok(r.deliveries.length >= 5);
  assert.equal(r.deliveries[0].tracking_token, undefined, 'no tracking links in reports');
  assert.ok(r.payments.length >= 2);
  assert.ok(r.vehicle_costs.length >= 1);
  assert.ok(r.shifts.some((x: { action: string }) => x.action === 'Started shift'));
  assert.ok(r.trips.length >= 1);
  const staff = await ok(T.disp, 'GET', `/reports?from=${today}&to=${today}`);
  assert.ok(staff.deliveries.every((d: { shop_id: string }) => d.shop_id === ids.shopA), 'staff see their own shop only');
});

console.log('Quota use');
await test('one screen load is one Google read', async () => {
  const r0 = sheets.calls.read;
  await ok(T.disp, 'GET', '/deliveries');
  assert.equal(sheets.calls.read - r0, 1);
  const w0 = sheets.calls.write;
  const r1 = sheets.calls.read;
  await ok(T.disp, 'POST', `/deliveries/${ids.d1}/assign`, { driver_id: ids.driverA, vehicle_id: ids.vehA });
  const writes = sheets.calls.write - w0;
  console.log(`    assigning a delivery: ${sheets.calls.read - r1} read, ${writes} writes`);
  assert.ok(writes <= 4);
});

console.log('Demo data and report figures');
await test('the demo company has two months of history, and report tables add up to the totals', async () => {
  const { seed } = await import('../scripts/seed.ts');
  const { buildReport } = await import('../src/pages/app/reportMath.ts');
  const demo = memoryDeps();
  await seed(demo.deps, demo.sheets, demo.auth);
  const tok = demo.auth.signIn('salim@technicalhardware.om', 'demo-pass-1', demo.deps.phoneLoginDomain).token;
  const res = await handle(new Request('http://localhost/api/reports?shop=all', { headers: { authorization: `Bearer ${tok}` } }), demo.deps);
  const data = await res.json();
  const me = await (await handle(new Request('http://localhost/api/me', { headers: { authorization: `Bearer ${tok}` } }), demo.deps)).json();
  const rep = buildReport(data, me.settings);
  assert.ok(rep.delivered > 80, 'enough finished deliveries in 30 days');
  const sum = (rows: Record<string, unknown>[], k: string) => Math.round(rows.reduce((a, r) => a + Number(r[k] || 0), 0) * 1000) / 1000;
  for (const t of [rep.tables.customers, rep.tables.areas]) {
    assert.equal(sum(t.rows, 'n'), rep.delivered);
    assert.ok(Math.abs(sum(t.rows, 'cost') - Number(t.total!.cost)) < 0.01, `${t.title} costs add up`);
    assert.ok(Math.abs(sum(t.rows, 'charged') - Number(t.total!.charged)) < 0.01);
  }
  assert.ok(rep.tables.losses.rows.length > 0, 'some deliveries are over budget');
  const van = rep.tables.vehicles.rows.find((r) => String(r.name).startsWith('9012'));
  assert.ok(van && Number(van.l100) > Number(van.rated), 'the van burns more than its setting');
  assert.ok(rep.tables.drivers.rows.some((r) => Number(r.hours) > 0));
});

console.log(`\n${passed} tests passed`);
