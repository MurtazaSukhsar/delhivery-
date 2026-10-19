// Stand-in for Supabase Auth, used by the tests and the local demo server.
import type { AppMeta, AuthProvider, AuthUser, Deps, FileStore } from '../supabase/functions/_shared/core.ts';
import { ApiError } from '../supabase/functions/_shared/core.ts';
import { MemorySheetsClient } from '../supabase/functions/_shared/sheets/client.ts';

export interface FakeUser extends AuthUser {
  password: string;
  banned: boolean;
}

export class FakeAuth implements AuthProvider {
  users = new Map<string, FakeUser>();

  /** Demo tokens are simply "demo.<user id>". */
  tokenFor(id: string) {
    return `demo.${id}`;
  }

  async getUser(token: string) {
    const id = token.startsWith('demo.') ? token.slice(5) : '';
    const u = this.users.get(id);
    if (!u || u.banned) return null;
    return { id: u.id, email: u.email, app_metadata: u.app_metadata };
  }

  async createUser({ email, password, app_metadata }: { email: string; password: string; app_metadata: AppMeta }) {
    const e = email.toLowerCase();
    if ([...this.users.values()].some((u) => u.email === e)) throw new ApiError(400, 'An account with this email or phone already exists.');
    const id = 'usr_' + crypto.randomUUID().slice(0, 8);
    this.users.set(id, { id, email: e, password, app_metadata: { ...app_metadata }, banned: false });
    return id;
  }

  async updateUser(id: string, patch: { password?: string; email?: string; app_metadata?: AppMeta; banned?: boolean }) {
    const u = this.users.get(id);
    if (!u) throw new ApiError(400, 'User not found');
    if (patch.password) u.password = patch.password;
    if (patch.email) u.email = patch.email.toLowerCase();
    if (patch.app_metadata) u.app_metadata = { ...u.app_metadata, ...patch.app_metadata };
    if (patch.banned != null) u.banned = patch.banned;
  }

  signIn(login: string, password: string, phoneDomain: string): { token: string; user: FakeUser } {
    const l = login.trim().toLowerCase();
    let email = l;
    if (!l.includes('@')) {
      let d = l.replace(/\D/g, '');
      if (d.startsWith('00')) d = d.slice(2);
      if (d.length === 8) d = '968' + d;
      email = `${d}@${phoneDomain}`;
    }
    const u = [...this.users.values()].find((x) => x.email === email);
    if (!u || u.password !== password) throw new ApiError(400, 'Invalid login credentials');
    if (u.banned) throw new ApiError(400, 'User is banned');
    return { token: this.tokenFor(u.id), user: u };
  }
}

/** Photo storage for tests and the demo: kept in memory, optionally saved to a folder. */
export class MemoryFiles implements FileStore {
  files = new Map<string, { data: Uint8Array; type: string }>();
  base: string;
  constructor(base = 'memory://files/') {
    this.base = base;
  }
  async put(path: string, data: Uint8Array, type: string) {
    this.files.set(path, { data, type });
  }
  async url(path: string) {
    return this.base + encodeURIComponent(path);
  }
}

export const PLATFORM_SHEET = 'platform-sheet-0000000000000000';
export const SUPER_ADMIN = 'admin@farwings.dev';

export function memoryDeps() {
  const sheets = new MemorySheetsClient();
  sheets.createBook(PLATFORM_SHEET);
  const auth = new FakeAuth();
  const files = new MemoryFiles();
  const deps: Deps = { sheets, auth, files, platformSheetId: PLATFORM_SHEET, superAdminEmails: [SUPER_ADMIN], phoneLoginDomain: 'phone.delivery.local' };
  return { deps, sheets, auth, files };
}
