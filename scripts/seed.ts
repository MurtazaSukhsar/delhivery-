// Sample organisation for the local demo, created through the real API.
import { handle } from '../supabase/functions/_shared/app.ts';
import type { Deps } from '../supabase/functions/_shared/core.ts';
import type { MemorySheetsClient } from '../supabase/functions/_shared/sheets/client.ts';
import { SUPER_ADMIN, type FakeAuth } from './fake-auth.ts';
import { seedHistory } from './seed-history.ts';

export const DEMO_ACCOUNTS = [
  { role: 'Platform admin (Farwings)', login: SUPER_ADMIN, password: 'platform-demo' },
  { role: 'Admin (owner of the company)', login: 'salim@technicalhardware.om', password: 'demo-pass-1' },
  { role: 'Staff, Ghala', login: 'fatma@technicalhardware.om', password: 'demo-pass-1' },
  { role: 'Staff, Rusayl', login: 'hamad@technicalhardware.om', password: 'demo-pass-1' },
  { role: 'Driver, Ghala', login: '92000001', password: 'demo-pass-1' },
  { role: 'Driver, Ghala', login: '92000002', password: 'demo-pass-1' },
  { role: 'Driver, Rusayl', login: '92000003', password: 'demo-pass-1' },
];

export async function seed(deps: Deps, sheets: MemorySheetsClient, auth: FakeAuth) {
  const ORG_SHEET = 'demo-org-sheet-technical-hardware';
  sheets.createBook(ORG_SHEET);
  const superId = await auth.createUser({ email: SUPER_ADMIN, password: 'platform-demo', app_metadata: { name: 'Farwings admin' } });

  // deno-lint-ignore no-explicit-any
  const api = async (token: string, method: string, path: string, body?: unknown): Promise<any> => {
    const res = await handle(new Request('http://local/api' + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
    const data = await res.json();
    if (res.status !== 200) throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const tok = (login: string) => auth.signIn(login, 'demo-pass-1', deps.phoneLoginDomain).token;

  const org = await api(auth.tokenFor(superId), 'POST', '/platform/orgs', {
    name: 'Technical Hardware',
    slug: 'technical-hardware',
    sheet: ORG_SHEET,
    admin_name: 'Salim Al Harthy',
    admin_email: 'salim@technicalhardware.om',
    admin_password: 'demo-pass-1',
  });
  const A = tok('salim@technicalhardware.om');
  await api(A, 'PUT', '/settings', { company_name_ar: 'التقنية للأدوات', phone: '+968 2450 0000', email: 'dispatch@technicalhardware.om', address: 'Ghala Industrial Area, Muscat' });

  const ghala = await api(A, 'POST', '/shops', { name: 'Ghala main warehouse', kind: 'warehouse', address: 'Way 3712, Ghala Industrial Area', phone: '+968 2450 0000', lat: 23.5847, lng: 58.3339 });
  const rusayl = await api(A, 'POST', '/shops', { name: 'Rusayl store', address: 'Rusayl Industrial Estate', phone: '+968 2444 1100', lat: 23.5462, lng: 58.1856 });

  const staff = async (name: string, role: string, shop: string, login: { email?: string; phone?: string }) =>
    api(A, 'POST', '/staff', { name, role, shop_ids: shop, password: 'demo-pass-1', ...login });
  await staff('Fatma Al Balushi', 'staff', ghala.id, { email: 'fatma@technicalhardware.om' });
  await staff('Hamad Al Rawahi', 'staff', rusayl.id, { email: 'hamad@technicalhardware.om' });
  const d1 = await staff('Ahmed Al Hinai', 'driver', ghala.id, { phone: '92000001' });
  const d2 = await staff('Imran Khan', 'driver', ghala.id, { phone: '92000002' });
  const d3 = await staff('Khalid Al Saadi', 'driver', rusayl.id, { phone: '92000003' });
  const d4 = await staff('Suresh Kumar', 'driver', `${ghala.id},${rusayl.id}`, { phone: '92000004' });

  const area = async (name: string, charge: number, lat: number, lng: number, note: string) => (await api(A, 'POST', '/areas', { name, default_charge: charge, lat, lng, note })).id as string;
  const seeb = await area('Seeb', 3, 23.6703, 58.1891, 'About 25 km from Ghala');
  const khuwair = await area('Al Khuwair', 2, 23.5933, 58.4139, 'About 10 km');
  const qurum = await area('Qurum', 2.5, 23.6146, 58.4794, 'About 17 km');
  const ruwi = await area('Ruwi', 3, 23.5906, 58.5433, 'About 25 km');
  const amerat = await area('Al Amerat', 3.5, 23.5108, 58.4936, 'About 25 km');
  const barka = await area('Barka', 6, 23.6786, 57.8892, 'About 55 km');

  const cust = async (name: string, contact: string, phone: string, addrs: [string, string, string, number, number][]) =>
    api(A, 'POST', '/customers', { name, contact_name: contact, phone, addresses: addrs.map(([label, line, area_id, lat, lng]) => ({ label, line, area_id, lat, lng })) });
  const c = {
    bayt: await cust('Bayt Al Hijar Contracting', 'Nasser', '+968 9911 0001', [['Seeb villa project', 'Al Hail North, plot 112', seeb, 23.6531, 58.2094], ['Head office', 'Al Khuwair, Way 3013', khuwair, 23.5975, 58.4202]]),
    green: await cust('Green Palm Maintenance', 'Rashid', '+968 9911 0002', [['Qurum workshop', 'Qurum Commercial Area', qurum, 23.6146, 58.4794]]),
    mawaleh: await cust('Al Mawaleh Electrical Trading', 'Hamed', '+968 9911 0003', [['Shop', 'Al Mawaleh South, near the roundabout', seeb, 23.6394, 58.2189]]),
    ruwi: await cust('Ruwi Steel & Fixings', 'Anil', '+968 9911 0004', [['Store', 'Ruwi High Street', ruwi, 23.5906, 58.5433]]),
    amerat: await cust('Amerat Housing Project', 'Site office', '+968 9911 0005', [['Phase 2 site gate', 'Al Amerat Heights', amerat, 23.5108, 58.4936]]),
    barka: await cust('Barka Farm Supplies', 'Saif', '+968 9911 0006', [['Warehouse', 'Barka industrial road', barka, 23.6786, 57.8892]]),
    coast: await cust('Coastline Facilities Management', 'Thomas', '+968 9911 0009', [['Ghubrah office', 'Al Ghubrah North', khuwair, 23.6033, 58.4331]]),
    // About 100 km by road from Ghala
    musannah: await cust('Musannah Date Farm', 'Said', '+968 9911 0010', [['Farm gate', 'Al Musannah, farm road 4', '', 23.74, 57.6]]),
    towers: await cust('Muscat Towers Fit-out', 'Site engineer', '+968 9911 0011', [['Tower B loading bay', 'Al Khuwair, Way 3019', khuwair, 23.5961, 58.4087]]),
  };

  const veh = async (shop: string, plate: string, type: string, make: string, cap: number, cbm: number, fuel: number, extra: Record<string, unknown> = {}) => (await api(A, 'POST', '/vehicles', { shop_id: shop, plate, type, make, capacity_kg: cap, capacity_cbm: cbm, fuel_use: fuel, ...extra })).id as string;
  const v1 = await veh(ghala.id, '4521 AB', 'Pickup', 'Toyota Hilux', 1000, 2.5, 12.5);
  const v2 = await veh(ghala.id, '9012 SN', 'Van', 'Nissan Urvan', 900, 6, 11, { fuel_type: 'petrol' });
  const v3 = await veh(ghala.id, '3345 HD', 'Truck 5t', 'Hino 300', 5000, 30, 21);
  const v4 = await veh(rusayl.id, '1290 KA', 'Truck 3t', 'Mitsubishi Canter', 3000, 18, 17, { maintenance_per_km: 0.05 });
  // Vehicles hired only when a job needs them. No plate: one price per day, for every shop.
  await veh('*', '', 'Truck 10t', 'Hired from a rental company', 10000, 60, 28, { ownership: 'rented', rental_per_day: 65, maintenance_per_km: 0.06 });
  await veh('*', '', 'Pickup', 'Hired from a rental company', 1000, 3, 12.5, { ownership: 'rented', rental_per_day: 18 });
  const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await api(A, 'POST', '/vehicle-documents', { vehicle_id: v1, type: 'insurance', number: 'INS-88412', expiry: addDays(9) });
  await api(A, 'POST', '/vehicle-documents', { vehicle_id: v2, type: 'registration', number: 'MLK-9012', expiry: addDays(-3) });
  await api(A, 'POST', '/vehicle-documents', { vehicle_id: v4, type: 'registration', number: 'MLK-1290', expiry: addDays(200) });

  const F = tok('fatma@technicalhardware.om');
  const H = tok('hamad@technicalhardware.om');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // deno-lint-ignore no-explicit-any
  const del = async (cust: any, addrIdx: number, shop: string, doc: string, inv: number, charge: number, extra: Record<string, unknown> = {}) =>
    api(shop === ghala.id ? F : H, 'POST', '/deliveries', { shop_id: shop, customer_id: cust.id, address_id: cust.addresses[addrIdx].id, doc_kind: doc.startsWith('INV') ? 'Invoice' : 'DO', doc_number: doc, invoice_value: inv, delivery_charge: charge, date: today, timing: 'flexible', weight_kg: 150, volume_cbm: 0.4, ...extra });

  // Two months of finished work, so reports and the money page have real figures.
  const adminId = (await api(A, 'GET', '/me')).user.id as string;
  await seedHistory({
    deps,
    sheet: ORG_SHEET,
    api,
    today,
    staffToken: { ghala: F, rusayl: H },
    shops: { ghala: ghala.id, rusayl: rusayl.id },
    drivers: { ahmed: d1, imran: d2, khalid: d3, suresh: d4 },
    vehicles: { pickup: v1, van: v2, truck5: v3, truck3: v4 },
    customers: c,
    admin: { id: adminId, name: 'Salim Al Harthy' },
  });

  const t1 = [
    await del(c.bayt, 0, ghala.id, 'DO-24101', 820, 0, { collect_type: 'documents', collect_note: 'Signed DO copy', weight_kg: 640, volume_cbm: 1.5, helpers: 1, lines: [{ d: 'Cement OPC 50 kg', q: 10, u: 'bags' }, { d: 'Gypsum board 12 mm', q: 6, u: 'sheets' }] }),
    await del(c.mawaleh, 0, ghala.id, 'INV-24102', 145.5, 3, { collect_type: 'cash', collect_amount: 148.5, timing: 'window', window_from: '09:30', window_to: '11:30', lines: [{ d: 'Cable 2.5 mm² × 100 m', q: 6, u: 'rolls' }, { d: 'Switch socket 13 A', q: 24, u: 'pcs' }] }),
    await del(c.green, 0, ghala.id, 'DO-24103', 96, 2.5, { notes: 'Call Rashid 15 minutes before arrival.' }),
  ];
  const t2 = [
    await del(c.ruwi, 0, ghala.id, 'DO-24104', 1240, 0, { urgent: true, timing: 'window', window_from: '10:00', window_to: '12:00', weight_kg: 480, volume_cbm: 3 }),
    await del(c.coast, 0, ghala.id, 'INV-24105', 188, 0, { collect_type: 'cheque', collect_amount: 188 }),
  ];
  await del(c.barka, 0, ghala.id, 'DO-24106', 64, 0, { weight_kg: 40, volume_cbm: 0.1, notes: 'Small order. Combine with the next Barka run if possible.' });
  // The two examples the client described: a small, far order, and a bulky one that needs a hired truck.
  await del(c.musannah, 0, ghala.id, 'INV-24110', 50, 0, { weight_kg: 100, volume_cbm: 0.5, notes: 'Small order, about 100 km away. A pickup is enough.' });
  await del(c.towers, 0, ghala.id, 'INV-24111', 500, 0, { weight_kg: 3200, volume_cbm: 48, helpers: 2, wait_minutes: 40, notes: 'Insulation rolls. Needs a large truck.', lines: [{ d: 'Glass wool insulation roll', q: 120, u: 'rolls' }] });
  await del(c.bayt, 1, ghala.id, 'DO-24107', 530, 0, { urgent: true, timing: 'window', window_from: '13:00', window_to: '15:00', weight_kg: 300, volume_cbm: 1 });
  await del(c.amerat, 0, rusayl.id, 'DO-24108', 2650, 15, { weight_kg: 2400, volume_cbm: 6, equipment: 'forklift', notes: 'Cement and rebar. Forklift on site.', lines: [{ d: 'Cement OPC 50 kg', q: 30, u: 'bags' }, { d: 'Rebar 12 mm × 12 m', q: 80, u: 'pcs' }] });

  await api(F, 'POST', '/trips', { shop_id: ghala.id, date: today, driver_id: d1.id, vehicle_id: v1, delivery_ids: t1.map((d) => d.id), start_time: '08:00' });
  await api(F, 'POST', '/trips', { shop_id: ghala.id, date: today, driver_id: d2.id, vehicle_id: v2, delivery_ids: t2.map((d) => d.id), start_time: '09:00' });

  // Ahmed has started: accepted, loaded, delivered the first stop.
  const D1 = tok('92000001');
  await api(D1, 'POST', '/driver/shift', { action: 'start' });
  const mine = (await api(D1, 'GET', '/driver/today')).deliveries as { id: string }[];
  const now = new Date().toISOString();
  await api(D1, 'POST', '/driver/sync', {
    updates: [
      ...mine.map((d, i) => ({ client_id: `seed-a${i}`, delivery_id: d.id, action: 'accept', at: now })),
      ...mine.map((d, i) => ({ client_id: `seed-p${i}`, delivery_id: d.id, action: 'pickup', at: now })),
      { client_id: 'seed-arr', delivery_id: mine[0].id, action: 'arrive', at: now },
      { client_id: 'seed-del', delivery_id: mine[0].id, action: 'deliver', receiver_name: 'Site supervisor', at: now },
    ],
  });
  return { org };
}
