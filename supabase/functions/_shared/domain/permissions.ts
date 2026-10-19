import type { PlatformRole, Role } from './types.ts';

/**
 * What each role may do. The API checks every request against this table;
 * the web app reads the same table to decide which screens to show.
 */
export type Permission =
  | 'deliveries.view'
  | 'deliveries.create'
  | 'deliveries.plan'
  | 'customers.manage'
  | 'vehicles.view'
  | 'vehicles.manage'
  | 'costs.view'
  | 'shops.manage'
  | 'staff.manage'
  | 'activity.view'
  | 'settings.manage'
  | 'driver.app';

const MATRIX: Record<Role, Permission[]> = {
  // The client's owner or manager: everything in their organisation.
  org_admin: ['deliveries.view', 'deliveries.create', 'deliveries.plan', 'customers.manage', 'vehicles.view', 'vehicles.manage', 'costs.view', 'shops.manage', 'staff.manage', 'activity.view', 'settings.manage'],
  // Office people: create, assign and track deliveries, and see what each one costs.
  staff: ['deliveries.view', 'deliveries.create', 'deliveries.plan', 'customers.manage', 'vehicles.view', 'costs.view'],
  driver: ['driver.app'],
};

export function can(role: PlatformRole | undefined | null, p: Permission): boolean {
  if (!role || role === 'super_admin') return false;
  return MATRIX[role]?.includes(p) ?? false;
}

export const ROLE_LABEL: Record<PlatformRole, string> = {
  super_admin: 'Platform admin',
  org_admin: 'Admin',
  staff: 'Staff',
  driver: 'Driver',
};

export const ROLES: Role[] = ['org_admin', 'staff', 'driver'];

/** Roles a given role may create or edit. Only admins manage the team. */
export function assignableRoles(by: Role): Role[] {
  return by === 'org_admin' ? ROLES : [];
}

export function shopList(shopIds: string): '*' | string[] {
  const v = (shopIds || '').trim();
  if (v === '*' || v === '') return v === '*' ? '*' : [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export function hasShop(shopIds: string, shopId: string) {
  const l = shopList(shopIds);
  return l === '*' || l.includes(shopId);
}
