import { type Actor, type Deps, type OrgBook, bad, forbidden, notFound, need, orgBook, readSettings, allowedShops, logActivity, str, num, phoneEmail, normalisePhone, ROLE_OK, isDate } from '../core.ts';
import type { Area, Shop, Staff, OrgSettings, ActivityEntry, Role } from '../domain/types.ts';
import { DEFAULT_SETTINGS } from '../domain/types.ts';
import { assignableRoles, hasShop } from '../domain/permissions.ts';
import { uid, nowISO } from '../domain/format.ts';
import { SheetsError } from '../sheets/client.ts';
import { ORG_TABLES } from '../sheets/schema.ts';
import { ensureTabs } from './setup.ts';
import { COUNTRIES, parseFuelOverrides } from '../domain/gcc.ts';

export async function openOrg(deps: Deps, a: Actor, ...tabs: Parameters<OrgBook['load']>) {
  if (a.role === 'super_admin') throw forbidden('Platform administrators work from the platform page.');
  const book = orgBook(deps, a.sheetId);
  try {
    await book.load('settings', 'shops', ...tabs);
    return book;
  } catch (e) {
    // A spreadsheet made by an older version lacks the newest tabs: add them once and read again.
    if (!(e instanceof SheetsError) || !/parse range|not found/i.test(e.message)) throw e;
    await ensureTabs(deps.sheets, a.sheetId, ORG_TABLES);
    const again = orgBook(deps, a.sheetId);
    await again.load('settings', 'shops', ...tabs);
    return again;
  }
}

// ------------------------------------------------------------------ me
export async function me(deps: Deps, a: Actor) {
  if (a.role === 'super_admin') return { user: { id: a.id, name: a.name, email: a.email, role: a.role }, org: null, shops: [], settings: null };
  const book = await openOrg(deps, a, 'staff');
  const staff = book.get<Staff>('staff', a.id);
  const settings = readSettings(book);
  return {
    user: { id: a.id, name: staff?.name ?? a.name, email: a.email, phone: staff?.phone ?? '', role: a.role, shop_ids: a.shopIds, on_shift: !!staff?.on_shift, shift_started_at: staff?.shift_started_at ?? '' },
    org: { id: a.orgId, name: settings.company_name },
    shops: allowedShops(a, book).filter((s) => s.active),
    settings,
  };
}

/** Recorded when someone signs in, so the activity log shows who used the system and when. */
export async function sessionStarted(deps: Deps, a: Actor, body: Record<string, unknown>) {
  if (a.role === 'super_admin') return { ok: true };
  const book = await openOrg(deps, a, 'activity_log');
  logActivity(book, a, 'Signed in', 'session', a.id, str(body.device, 120));
  await book.commit();
  return { ok: true };
}

// ------------------------------------------------------------------ settings
export async function getSettings(deps: Deps, a: Actor) {
  const book = await openOrg(deps, a);
  return readSettings(book);
}

export async function saveSettings(deps: Deps, a: Actor, body: Record<string, unknown>) {
  need(a, 'settings.manage');
  const book = await openOrg(deps, a, 'activity_log');
  // The settings tab is a simple key / value list in columns A and B.
  const loaded = book.all<{ key: string; value: string }>('settings');
  const changed: string[] = [];
  let rewrite = false;
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in body)) continue;
    let v = body[key];
    if (typeof def === 'number') v = num(v, key, { min: 0, max: 100000 });
    else if (typeof def === 'boolean') v = !!v;
    else v = str(v, key === 'fuel_prices_json' ? 8000 : 1000);
    if (key === 'country' && !(String(v) in COUNTRIES)) throw bad('Choose a GCC country.');
    if (key === 'fuel_prices_json' && v && parseFuelOverrides(String(v)).length === 0) throw bad('The fuel price list could not be read.');
    const row = loaded.find((r) => r.key === key);
    if (row && String(row.value) === String(v)) continue;
    changed.push(key);
    if (row) {
      row.value = String(v);
      rewrite = true;
    } else book.insert('settings', { key, value: String(v) });
  }
  if (rewrite) await deps.sheets.update(book.sheetId, [{ range: `'settings'!A2:B${loaded.length + 1}`, values: loaded.map((r) => [r.key, String(r.value)]) }]);
  if (changed.length) {
    logActivity(book, a, 'Changed settings', 'settings', '', changed.join(', '));
    await book.commit();
  }
  return readSettings(book);
}

// ------------------------------------------------------------------ shops
export async function listShops(deps: Deps, a: Actor) {
  const book = await openOrg(deps, a);
  return allowedShops(a, book);
}

function shopInput(body: Record<string, unknown>, base?: Shop): Shop {
  const name = str(body.name ?? base?.name, 120);
  if (!name) throw bad('Enter the shop name.');
  const lat = num(body.lat ?? base?.lat, 'Latitude', { min: -90, max: 90 });
  const lng = num(body.lng ?? base?.lng, 'Longitude', { min: -180, max: 180 });
  return {
    id: base?.id ?? uid('shop_'),
    name,
    kind: body.kind === 'warehouse' || (base?.kind === 'warehouse' && body.kind == null) ? 'warehouse' : 'shop',
    address: str(body.address ?? base?.address, 300),
    phone: str(body.phone ?? base?.phone, 40),
    city: str(body.city ?? base?.city, 60),
    lat,
    lng,
    active: body.active == null ? base?.active ?? true : !!body.active,
    created_at: base?.created_at ?? nowISO(),
  };
}

export async function createShop(deps: Deps, a: Actor, body: Record<string, unknown>) {
  if (a.role !== 'org_admin') throw forbidden('Only organisation admins add shops.');
  const book = await openOrg(deps, a, 'activity_log');
  const shop = shopInput(body);
  if (book.all<Shop>('shops').some((s) => s.name.toLowerCase() === shop.name.toLowerCase())) throw bad('A shop with this name already exists.');
  book.insert('shops', shop as unknown as Record<string, unknown>);
  logActivity(book, a, 'Added shop', 'shop', shop.id, shop.name, shop.id);
  await book.commit();
  return shop;
}

export async function updateShop(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  if (a.role !== 'org_admin') throw forbidden('Only organisation admins change shops.');
  const book = await openOrg(deps, a, 'activity_log');
  const cur = book.get<Shop>('shops', id);
  if (!cur) throw notFound('Shop');
  const next = shopInput(body, cur);
  book.update('shops', id, next);
  logActivity(book, a, next.active === cur.active ? 'Changed shop' : next.active ? 'Re-opened shop' : 'Closed shop', 'shop', id, next.name, id);
  await book.commit();
  return next;
}

// ------------------------------------------------------------------ staff
/** Only admins manage the team, and they see everyone in their organisation. */
function visibleStaff(_a: Actor, book: OrgBook): Staff[] {
  return book.all<Staff>('staff');
}

export async function listStaff(deps: Deps, a: Actor) {
  need(a, 'staff.manage');
  const book = await openOrg(deps, a, 'staff');
  return visibleStaff(a, book);
}

/** Staff visible to planners (drivers to assign). Any role that plans deliveries can read drivers of its shops. */
export async function listDrivers(deps: Deps, a: Actor) {
  if (!['org_admin', 'staff'].includes(a.role)) throw forbidden();
  const book = await openOrg(deps, a, 'staff');
  const shops = allowedShops(a, book).map((s) => s.id);
  return book
    .all<Staff>('staff')
    .filter((s) => s.role === 'driver' && shops.some((id) => hasShop(s.shop_ids, id)))
    .map(({ id, name, phone, shop_ids, active, on_shift, shift_started_at, licence_expiry }) => ({ id, name, phone, shop_ids, active, on_shift, shift_started_at, licence_expiry }));
}

function checkShopIds(a: Actor, book: OrgBook, raw: unknown): string {
  const v = str(raw, 2000);
  if (v === '*') {
    if (a.role !== 'org_admin') throw forbidden('Only organisation admins can give access to every shop.');
    return '*';
  }
  const ids = v.split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) throw bad('Choose at least one shop.');
  const allowed = allowedShops(a, book).map((s) => s.id);
  for (const id of ids) if (!allowed.includes(id)) throw forbidden('You can only give access to your own shops.');
  return ids.join(',');
}

export async function createStaff(deps: Deps, a: Actor, body: Record<string, unknown>) {
  need(a, 'staff.manage');
  const book = await openOrg(deps, a, 'staff', 'activity_log');
  const role = body.role;
  if (!ROLE_OK(role)) throw bad('Choose a role.');
  if (!assignableRoles(a.role as Role).includes(role)) throw forbidden('You cannot create accounts with this role.');
  const name = str(body.name, 120);
  if (!name) throw bad('Enter the person’s name.');
  const email = str(body.email, 200).toLowerCase();
  const phone = str(body.phone, 40);
  if (role === 'driver' && !phone) throw bad('Drivers sign in with their phone number. Enter it.');
  if (!email && !phone) throw bad('Enter an email or a phone number to sign in with.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
  if (phone && normalisePhone(phone).length < 8) throw bad('Enter a full phone number.');
  const password = String(body.password ?? '');
  if (password.length < 8) throw bad('Password must be at least 8 characters.');
  const shop_ids = role === 'org_admin' ? '*' : checkShopIds(a, book, body.shop_ids);
  const staffAll = book.all<Staff>('staff');
  if (phone && staffAll.some((s) => s.phone && normalisePhone(s.phone) === normalisePhone(phone))) throw bad('Someone already uses this phone number.');
  if (email && staffAll.some((s) => s.email === email)) throw bad('Someone already uses this email.');
  const licence = body.licence_expiry && isDate(body.licence_expiry) ? body.licence_expiry : '';

  const loginEmail = role === 'driver' || !email ? phoneEmail(phone, deps.phoneLoginDomain) : email;
  const id = await deps.auth.createUser({ email: loginEmail, password, app_metadata: { role, org_id: a.orgId, sheet_id: a.sheetId, shop_ids, name, active: true } });
  const staff: Staff = { id, name, email, phone: phone ? '+' + normalisePhone(phone) : '', role, shop_ids, active: true, licence_expiry: licence, on_shift: false, shift_started_at: '', created_at: nowISO() };
  book.insert('staff', staff as unknown as Record<string, unknown>);
  logActivity(book, a, 'Added staff', 'staff', id, `${name} as ${role}`);
  await book.commit();
  return staff;
}

export async function updateStaff(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  need(a, 'staff.manage');
  const book = await openOrg(deps, a, 'staff', 'activity_log');
  const cur = visibleStaff(a, book).find((s) => s.id === id);
  if (!cur) throw notFound('Staff member');
  const assignable = assignableRoles(a.role as Role);
  if (!assignable.includes(cur.role)) throw forbidden('You cannot change this account.');
  const patch: Partial<Staff> = {};
  const changes: string[] = [];
  if (body.name != null && str(body.name, 120) && str(body.name, 120) !== cur.name) {
    patch.name = str(body.name, 120);
    changes.push('name');
  }
  if (body.role != null && body.role !== cur.role) {
    if (!ROLE_OK(body.role) || !assignable.includes(body.role)) throw forbidden('You cannot give this role.');
    patch.role = body.role;
    changes.push(`role to ${body.role}`);
  }
  if (body.shop_ids != null && (patch.role ?? cur.role) !== 'org_admin') {
    const v = checkShopIds(a, book, body.shop_ids);
    if (v !== cur.shop_ids) {
      patch.shop_ids = v;
      changes.push('shops');
    }
  }
  if ((patch.role ?? cur.role) === 'org_admin') patch.shop_ids = '*';
  if (body.licence_expiry != null && (body.licence_expiry === '' || isDate(body.licence_expiry))) patch.licence_expiry = body.licence_expiry as string;
  if (body.active != null && !!body.active !== cur.active) {
    if (id === a.id) throw bad('You cannot switch off your own account.');
    patch.active = !!body.active;
    changes.push(patch.active ? 'switched on' : 'switched off');
  }
  const removesAdmin = cur.role === 'org_admin' && (patch.role && patch.role !== 'org_admin' || patch.active === false);
  if (removesAdmin && book.all<Staff>('staff').filter((s) => s.role === 'org_admin' && s.active).length <= 1) throw bad('Keep at least one active organisation admin.');
  const password = body.password ? String(body.password) : '';
  if (password && password.length < 8) throw bad('Password must be at least 8 characters.');
  if (password) changes.push('password reset');

  const next = { ...cur, ...patch };
  await deps.auth.updateUser(id, {
    password: password || undefined,
    banned: patch.active == null ? undefined : !patch.active,
    app_metadata: { role: next.role, shop_ids: next.shop_ids, name: next.name, active: next.active, org_id: a.orgId, sheet_id: a.sheetId },
  });
  book.update('staff', id, patch);
  if (changes.length) logActivity(book, a, 'Changed staff', 'staff', id, `${next.name}: ${changes.join(', ')}`);
  await book.commit();
  return next;
}

// ------------------------------------------------------------------ areas
export async function listAreas(deps: Deps, a: Actor) {
  const book = await openOrg(deps, a, 'areas');
  return book.all<Area>('areas');
}

export async function saveArea(deps: Deps, a: Actor, id: string | null, body: Record<string, unknown>) {
  need(a, 'settings.manage');
  const book = await openOrg(deps, a, 'areas', 'activity_log');
  const cur = id ? book.get<Area>('areas', id) : undefined;
  if (id && !cur) throw notFound('Area');
  const area: Area = {
    id: cur?.id ?? uid('area_'),
    name: str(body.name ?? cur?.name, 80),
    default_charge: num(body.default_charge ?? cur?.default_charge ?? 0, 'Usual charge', { max: 1000 }),
    lat: num(body.lat ?? cur?.lat, 'Latitude', { min: -90, max: 90 }),
    lng: num(body.lng ?? cur?.lng, 'Longitude', { min: -180, max: 180 }),
    note: str(body.note ?? cur?.note, 200),
    toll_per_trip: num(body.toll_per_trip ?? cur?.toll_per_trip ?? 0, 'Tolls', { max: 10000 }),
  };
  if (!area.name) throw bad('Enter the area name.');
  if (cur) book.update('areas', area.id, area);
  else book.insert('areas', area as unknown as Record<string, unknown>);
  logActivity(book, a, cur ? 'Changed area' : 'Added area', 'area', area.id, area.name);
  await book.commit();
  return area;
}

// ------------------------------------------------------------------ activity
export async function listActivity(deps: Deps, a: Actor, q: URLSearchParams) {
  need(a, 'activity.view');
  const book = await openOrg(deps, a, 'activity_log');
  const shops = new Set(allowedShops(a, book).map((s) => s.id));
  const limit = Math.min(1000, Number(q.get('limit')) || 300);
  const user = q.get('user');
  return book
    .all<ActivityEntry>('activity_log')
    .filter((e) => (a.role === 'org_admin' || !e.shop_id || shops.has(e.shop_id)) && (!user || e.user_id === user))
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, limit);
}

export type { OrgSettings };
