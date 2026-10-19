import { type Actor, type Deps, bad, forbidden, notFound, need, logActivity, str, num, assertShop, shopFilter, isDate } from '../core.ts';
import { openOrg } from './admin.ts';
import type { Address, Customer, Vehicle, VehicleCost, VehicleCostKind, VehicleDocument, DocumentType } from '../domain/types.ts';
import { uid, nowISO } from '../domain/format.ts';
import { ALL_SHOPS, vehicleInShop } from '../domain/fleet.ts';

// ------------------------------------------------------------------ customers
export async function listCustomers(deps: Deps, a: Actor) {
  need(a, 'deliveries.view');
  const book = await openOrg(deps, a, 'customers', 'addresses');
  const addrs = book.all<Address>('addresses');
  return book
    .all<Customer>('customers')
    .map((c) => ({ ...c, addresses: addrs.filter((x) => x.customer_id === c.id) }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

function addressInput(raw: Record<string, unknown>, customerId: string, base?: Address): Address {
  const line = str(raw.line ?? base?.line, 300);
  if (!line) throw bad('Every address needs the address or directions.');
  return {
    id: base?.id ?? uid('adr_'),
    customer_id: customerId,
    label: str(raw.label ?? base?.label, 80) || 'Address',
    line,
    area_id: str(raw.area_id ?? base?.area_id, 40),
    lat: num(raw.lat ?? base?.lat, 'Latitude', { min: -90, max: 90 }),
    lng: num(raw.lng ?? base?.lng, 'Longitude', { min: -180, max: 180 }),
  };
}

export async function saveCustomer(deps: Deps, a: Actor, id: string | null, body: Record<string, unknown>) {
  need(a, 'customers.manage');
  const book = await openOrg(deps, a, 'customers', 'addresses', 'activity_log');
  const cur = id ? book.get<Customer>('customers', id) : undefined;
  if (id && !cur) throw notFound('Customer');
  const name = str(body.name ?? cur?.name, 160);
  const phone = str(body.phone ?? cur?.phone, 40);
  if (!name) throw bad('Enter the customer name.');
  if (!/^\+?[\d\s-]{7,}$/.test(phone)) throw bad('Enter the customer phone number.');
  const customer: Customer = {
    id: cur?.id ?? uid('cus_'),
    name,
    contact_name: str(body.contact_name ?? cur?.contact_name, 120),
    phone,
    created_at: cur?.created_at ?? nowISO(),
    created_by: cur?.created_by ?? a.id,
  };
  const list = Array.isArray(body.addresses) ? (body.addresses as Record<string, unknown>[]) : [];
  if (!cur && !list.length) throw bad('Add at least one delivery address.');
  const existing = book.all<Address>('addresses').filter((x) => x.customer_id === customer.id);
  const saved: Address[] = [];
  for (const raw of list) {
    const base = existing.find((x) => x.id === raw.id);
    const adr = addressInput(raw, customer.id, base);
    if (base) book.update('addresses', adr.id, adr);
    else book.insert('addresses', adr as unknown as Record<string, unknown>);
    saved.push(adr);
  }
  if (cur) book.update('customers', customer.id, customer);
  else book.insert('customers', customer as unknown as Record<string, unknown>);
  logActivity(book, a, cur ? 'Changed customer' : 'Added customer', 'customer', customer.id, name);
  await book.commit();
  const keep = existing.filter((x) => !saved.some((s) => s.id === x.id));
  return { ...customer, addresses: [...keep, ...saved] };
}

// ------------------------------------------------------------------ vehicles
export async function listVehicles(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'vehicles.view');
  const book = await openOrg(deps, a, 'vehicles', 'vehicle_documents');
  const shops = shopFilter(a, book, q);
  const docs = book.all<VehicleDocument>('vehicle_documents').filter((d) => !d.deleted);
  return book
    .all<Vehicle>('vehicles')
    .filter((v) => v.shop_id === ALL_SHOPS || shops.has(v.shop_id))
    .map((v) => ({ ...v, documents: docs.filter((d) => d.vehicle_id === v.id) }));
}

/** Vehicles a planner can assign (also for roles without the full vehicle page). */
export async function listVehiclesForPlanning(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, 'vehicles');
  const shops = shopFilter(a, book, q);
  return book.all<Vehicle>('vehicles').filter((v) => v.active && (v.shop_id === ALL_SHOPS || shops.has(v.shop_id)));
}

export async function saveVehicle(deps: Deps, a: Actor, id: string | null, body: Record<string, unknown>) {
  need(a, 'vehicles.manage');
  const book = await openOrg(deps, a, 'vehicles', 'activity_log');
  const cur = id ? book.get<Vehicle>('vehicles', id) : undefined;
  if (id && !cur) throw notFound('Vehicle');
  const ownership = (body.ownership ?? cur?.ownership) === 'rented' ? 'rented' : 'owned';
  const shopId = str(body.shop_id ?? cur?.shop_id, 40);
  if (shopId === ALL_SHOPS) {
    if (ownership !== 'rented') throw bad('Only hire-when-needed vehicles can be shared by every shop.');
    if (a.role !== 'org_admin') throw forbidden('Only an admin can add a vehicle for every shop.');
  } else {
    assertShop(a, book, shopId);
  }
  if (cur && cur.shop_id !== ALL_SHOPS) assertShop(a, book, cur.shop_id);
  const plate = str(body.plate ?? cur?.plate, 20).toUpperCase();
  if (ownership === 'owned' && !plate) throw bad('Enter the plate number.');
  if (plate && book.all<Vehicle>('vehicles').some((v) => v.plate === plate && v.id !== cur?.id)) throw bad('A vehicle with this plate already exists.');
  const type = str(body.type ?? cur?.type, 40) || 'Pickup';
  if (ownership === 'rented' && !plate && book.all<Vehicle>('vehicles').some((v) => !v.plate && v.type.toLowerCase() === type.toLowerCase() && vehicleInShop(v, shopId) && v.id !== cur?.id)) {
    throw bad(`There is already a hire option for a ${type}.`);
  }
  const rent = num(body.rental_per_day ?? cur?.rental_per_day ?? 0, 'Hire price per day', { max: 10000 });
  if (ownership === 'rented' && rent <= 0) throw bad('Enter what it costs to hire per day.');
  const v: Vehicle = {
    id: cur?.id ?? uid('veh_'),
    shop_id: shopId,
    plate,
    type,
    make: str(body.make ?? cur?.make, 80),
    ownership,
    capacity_kg: num(body.capacity_kg ?? cur?.capacity_kg ?? 1000, 'Carries up to (kg)', { min: 1, max: 60000 }),
    capacity_cbm: num(body.capacity_cbm ?? cur?.capacity_cbm ?? 0, 'Cargo space (cbm)', { max: 200 }),
    fuel_type: (body.fuel_type ?? cur?.fuel_type) === 'petrol' ? 'petrol' : 'diesel',
    fuel_use: num(body.fuel_use ?? cur?.fuel_use ?? 12, 'Fuel use', { max: 100 }),
    maintenance_per_km: num(body.maintenance_per_km ?? cur?.maintenance_per_km ?? 0.03, 'Running cost', { max: 10 }),
    rental_per_day: ownership === 'rented' ? rent : 0,
    active: body.active == null ? cur?.active ?? true : !!body.active,
  };
  if (cur) book.update('vehicles', v.id, v);
  else book.insert('vehicles', v as unknown as Record<string, unknown>);
  logActivity(book, a, cur ? 'Changed vehicle' : 'Added vehicle', 'vehicle', v.id, v.plate || `Hire ${v.type}`, v.shop_id === ALL_SHOPS ? '' : v.shop_id);
  await book.commit();
  return v;
}

const DOC_TYPES: DocumentType[] = ['registration', 'insurance', 'permit', 'inspection', 'other'];

export async function saveDocument(deps: Deps, a: Actor, id: string | null, body: Record<string, unknown>) {
  need(a, 'vehicles.manage');
  const book = await openOrg(deps, a, 'vehicles', 'vehicle_documents', 'activity_log');
  const cur = id ? book.get<VehicleDocument>('vehicle_documents', id) : undefined;
  if (id && !cur) throw notFound('Document');
  const vehicleId = str(body.vehicle_id ?? cur?.vehicle_id, 40);
  const v = book.get<Vehicle>('vehicles', vehicleId);
  if (!v) throw bad('Choose a vehicle.');
  if (v.shop_id !== ALL_SHOPS) assertShop(a, book, v.shop_id);
  const type = (body.type ?? cur?.type) as DocumentType;
  if (!DOC_TYPES.includes(type)) throw bad('Choose the document type.');
  const expiry = body.expiry ?? cur?.expiry;
  if (!isDate(expiry)) throw bad('Enter the expiry date.');
  const doc: VehicleDocument = { id: cur?.id ?? uid('doc_'), vehicle_id: vehicleId, type, number: str(body.number ?? cur?.number, 60), expiry, deleted: !!(body.deleted ?? cur?.deleted) };
  if (cur) book.update('vehicle_documents', doc.id, doc);
  else book.insert('vehicle_documents', doc as unknown as Record<string, unknown>);
  logActivity(book, a, doc.deleted ? 'Removed vehicle document' : cur ? 'Changed vehicle document' : 'Added vehicle document', 'vehicle_document', doc.id, `${v.plate || v.type} ${type} expires ${expiry}`, v.shop_id === ALL_SHOPS ? '' : v.shop_id);
  await book.commit();
  return doc;
}

// ------------------------------------------------------------------ vehicle running costs (fuel, servicing, tyres, fines)
const COST_KINDS: VehicleCostKind[] = ['fuel', 'maintenance', 'tyres', 'fine', 'toll', 'other'];

export async function listVehicleCosts(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'vehicles.view');
  const book = await openOrg(deps, a, 'vehicles', 'vehicle_costs');
  const shops = shopFilter(a, book, q);
  const vehicles = new Set(book.all<Vehicle>('vehicles').filter((v) => v.shop_id === ALL_SHOPS || shops.has(v.shop_id)).map((v) => v.id));
  const vid = q.get('vehicle');
  const from = q.get('from') ?? '';
  return book
    .all<VehicleCost>('vehicle_costs')
    .filter((c) => !c.deleted && vehicles.has(c.vehicle_id) && (!vid || c.vehicle_id === vid) && (!from || c.date >= from))
    .sort((x, y) => y.date.localeCompare(x.date) || y.created_at.localeCompare(x.created_at));
}

export async function saveVehicleCost(deps: Deps, a: Actor, id: string | null, body: Record<string, unknown>) {
  need(a, 'deliveries.plan');
  const book = await openOrg(deps, a, 'vehicles', 'vehicle_costs', 'activity_log');
  const cur = id ? book.get<VehicleCost>('vehicle_costs', id) : undefined;
  if (id && !cur) throw notFound('Cost entry');
  const vehicleId = str(body.vehicle_id ?? cur?.vehicle_id, 40);
  const v = book.get<Vehicle>('vehicles', vehicleId);
  if (!v) throw bad('Choose a vehicle.');
  if (v.shop_id !== ALL_SHOPS) assertShop(a, book, v.shop_id);
  if (body.deleted === true && cur) {
    book.update<VehicleCost>('vehicle_costs', cur.id, { deleted: true });
    logActivity(book, a, 'Removed vehicle cost', 'vehicle', v.id, `${cur.kind} ${cur.amount}`, v.shop_id === ALL_SHOPS ? '' : v.shop_id);
    await book.commit();
    return { ...cur, deleted: true };
  }
  const kind = String(body.kind ?? cur?.kind) as VehicleCostKind;
  if (!COST_KINDS.includes(kind)) throw bad('Choose what the cost was for.');
  const date = String(body.date ?? cur?.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Choose the date.');
  const opt = (k: 'litres' | 'odometer', label: string, max: number) => {
    const raw = body[k] !== undefined ? body[k] : cur?.[k];
    return raw == null || raw === '' ? null : num(raw, label, { max });
  };
  const row: VehicleCost = {
    id: cur?.id ?? uid('vc_'),
    vehicle_id: vehicleId,
    date,
    kind,
    amount: num(body.amount ?? cur?.amount, 'Amount', { min: 0.001, max: 1_000_000 }),
    litres: kind === 'fuel' ? opt('litres', 'Litres', 5000) : null,
    odometer: opt('odometer', 'Odometer', 5_000_000),
    note: str(body.note ?? cur?.note, 200),
    created_by: cur?.created_by ?? a.name,
    created_at: cur?.created_at ?? nowISO(),
    deleted: false,
  };
  if (cur) book.update('vehicle_costs', row.id, row);
  else book.insert('vehicle_costs', row as unknown as Record<string, unknown>);
  logActivity(book, a, cur ? 'Changed vehicle cost' : 'Added vehicle cost', 'vehicle', v.id, `${kind} ${row.amount}`, v.shop_id === ALL_SHOPS ? '' : v.shop_id);
  await book.commit();
  return row;
}
