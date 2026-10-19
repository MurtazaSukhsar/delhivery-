import type { SheetsClient } from './sheets/client.ts';
import { Book } from './sheets/book.ts';
import { ORG_TABLES, PLATFORM_TABLES } from './sheets/schema.ts';
import type { PlatformRole, OrgSettings, Shop, Role } from './domain/types.ts';
import { DEFAULT_SETTINGS } from './domain/types.ts';
import { can, shopList, type Permission } from './domain/permissions.ts';
import { uid, nowISO } from './domain/format.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg: string) => new ApiError(400, msg);
export const forbidden = (msg = 'Your role is not allowed to do this.') => new ApiError(403, msg);
export const notFound = (what: string) => new ApiError(404, `${what} not found.`);

/** What we keep on each Supabase user (app_metadata, writable only with the service key). */
export interface AppMeta {
  role?: PlatformRole;
  org_id?: string;
  sheet_id?: string;
  shop_ids?: string;
  name?: string;
  suspended?: boolean;
  active?: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  app_metadata: AppMeta;
}

/** Supabase Auth, behind an interface so tests and the local demo can fake it. */
export interface AuthProvider {
  getUser(accessToken: string): Promise<AuthUser | null>;
  createUser(input: { email: string; password: string; app_metadata: AppMeta }): Promise<string>;
  updateUser(id: string, patch: { password?: string; email?: string; app_metadata?: AppMeta; banned?: boolean }): Promise<void>;
}

/** Photo and signature storage (Supabase Storage in production, memory or disk in the demo). */
export interface FileStore {
  put(path: string, data: Uint8Array, contentType: string): Promise<void>;
  /** A short-lived link to show the file */
  url(path: string): Promise<string>;
}

export interface Deps {
  sheets: SheetsClient;
  auth: AuthProvider;
  files: FileStore;
  platformSheetId: string;
  superAdminEmails: string[];
  phoneLoginDomain: string;
}

export type OrgBook = Book<typeof ORG_TABLES>;
export type PlatformBook = Book<typeof PLATFORM_TABLES>;

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  orgId: string;
  sheetId: string;
  shopIds: string;
}

export function orgBook(deps: Deps, sheetId: string): OrgBook {
  return new Book(deps.sheets, sheetId, ORG_TABLES);
}

export function platformBook(deps: Deps): PlatformBook {
  if (!deps.platformSheetId) throw new ApiError(500, 'PLATFORM_SHEET_ID is not set on the server.');
  return new Book(deps.sheets, deps.platformSheetId, PLATFORM_TABLES);
}

export async function actorFrom(deps: Deps, req: Request): Promise<Actor> {
  const h = req.headers.get('authorization') ?? '';
  const token = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
  if (!token) throw new ApiError(401, 'Sign in to continue.');
  const user = await deps.auth.getUser(token);
  if (!user) throw new ApiError(401, 'Your session has ended. Sign in again.');
  const m = user.app_metadata ?? {};
  if (deps.superAdminEmails.includes(user.email.toLowerCase())) {
    return { id: user.id, email: user.email, name: m.name || user.email, role: 'super_admin', orgId: '', sheetId: '', shopIds: '*' };
  }
  if (!m.org_id || !m.sheet_id || !m.role) throw new ApiError(403, 'This account is not linked to an organisation. Ask your administrator.');
  if (m.suspended) throw new ApiError(403, 'This organisation is suspended. Contact the platform administrator.');
  if (m.active === false) throw new ApiError(403, 'This account is switched off. Ask your administrator.');
  return { id: user.id, email: user.email, name: m.name || user.email, role: m.role, orgId: m.org_id, sheetId: m.sheet_id, shopIds: m.role === 'org_admin' ? '*' : m.shop_ids ?? '' };
}

export function need(a: Actor, p: Permission) {
  if (!can(a.role, p)) throw forbidden();
}

export function readSettings(book: OrgBook): OrgSettings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of book.all<{ key: string; value: string }>('settings')) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[row.key];
    if (typeof def === 'number') {
      const n = Number(row.value);
      if (Number.isFinite(n)) out[row.key] = n;
    } else if (typeof def === 'boolean') out[row.key] = ['true', '1', 'yes'].includes(String(row.value).toLowerCase());
    else out[row.key] = String(row.value ?? '');
  }
  return out as unknown as OrgSettings;
}

/** Shops this actor can work in. */
export function allowedShops(a: Actor, book: OrgBook): Shop[] {
  const shops = book.all<Shop>('shops');
  const l = shopList(a.shopIds);
  return l === '*' ? shops : shops.filter((s) => l.includes(s.id));
}

export function assertShop(a: Actor, book: OrgBook, shopId: string) {
  if (!allowedShops(a, book).some((s) => s.id === shopId)) throw forbidden('You do not have access to this shop.');
}

/** Shop filter from ?shop= (a single id, or "all" = every shop this actor can see). */
export function shopFilter(a: Actor, book: OrgBook, q: URLSearchParams): Set<string> {
  const allowed = allowedShops(a, book).map((s) => s.id);
  const pick = q.get('shop');
  if (!pick || pick === 'all') return new Set(allowed);
  if (!allowed.includes(pick)) throw forbidden('You do not have access to this shop.');
  return new Set([pick]);
}

export function logActivity(book: OrgBook, a: Actor, action: string, entity: string, entityId: string, details = '', shopId = '') {
  book.insert('activity_log', { id: uid('log_'), at: nowISO(), user_id: a.id, user_name: a.name, role: a.role, shop_id: shopId, action, entity, entity_id: entityId, details: details.slice(0, 500) });
}

/** Drivers sign in with phone + password; Supabase gets a matching internal email. */
export function normalisePhone(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '968' + d; // Omani local number
  return d;
}

export function phoneEmail(phone: string, domain: string) {
  return `${normalisePhone(phone)}@${domain}`;
}

export function str(v: unknown, max = 300): string {
  return String(v ?? '').trim().slice(0, max);
}

export function num(v: unknown, field: string, { min = 0, max = 1e9 } = {}): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${field} must be a number between ${min} and ${max}.`);
  return n;
}

export function isDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function isTime(v: unknown): v is string {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
}

export const ROLE_OK = (r: unknown): r is Role => ['org_admin', 'staff', 'driver'].includes(String(r));

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export interface DecodedImage {
  bytes: Uint8Array;
  type: string;
  ext: string;
}

/** Check and decode a photo sent as a data URL, before anything is changed. */
export function decodeImage(dataUrl: unknown): DecodedImage {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw bad('A photo could not be read. Take it again.');
  const bin = atob(m[2]);
  if (bin.length > 900_000) throw bad('A photo is too large. Take it again.');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1], ext: IMAGE_TYPES[m[1]] };
}

/** Store a decoded photo; returns its storage key. */
export async function storeImage(deps: Deps, a: Actor, folder: string, kind: string, img: DecodedImage): Promise<string> {
  const key = `${a.orgId}/${folder}/${kind}-${uid()}.${img.ext}`;
  await deps.files.put(key, img.bytes, img.type);
  return key;
}

/** Save a photo sent as a data URL; returns its storage key. */
export async function saveDataUrl(deps: Deps, a: Actor, folder: string, kind: string, dataUrl: unknown): Promise<string> {
  return storeImage(deps, a, folder, kind, decodeImage(dataUrl));
}

/** Links for stored files that belong to this organisation. */
export async function fileUrls(deps: Deps, orgId: string, keys: string[]): Promise<string[]> {
  const mine = keys.filter((k) => k && k.startsWith(orgId + '/'));
  return Promise.all(mine.map((k) => deps.files.url(k).catch(() => '')));
}
