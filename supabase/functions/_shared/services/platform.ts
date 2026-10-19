import { type Actor, type Deps, bad, forbidden, notFound, orgBook, platformBook, str, logActivity, phoneEmail } from '../core.ts';
import type { Organization, Staff } from '../domain/types.ts';
import { uid, nowISO } from '../domain/format.ts';
import { ensureOrgSheet, ensurePlatformSheet } from './setup.ts';

function onlySuper(a: Actor) {
  if (a.role !== 'super_admin') throw forbidden('Only the platform administrator can manage organisations.');
}

export function sheetIdFrom(input: string): string {
  const v = str(input, 500);
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(v);
  const id = m ? m[1] : v;
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(id)) throw bad('Paste the Google Sheet link or its ID.');
  return id;
}

export async function platformInfo(deps: Deps, a: Actor) {
  onlySuper(a);
  return { service_account_email: deps.sheets.serviceAccountEmail(), platform_sheet_id: deps.platformSheetId };
}

export async function listOrgs(deps: Deps, a: Actor) {
  onlySuper(a);
  await ensurePlatformSheet(deps.sheets, deps.platformSheetId);
  const pb = platformBook(deps);
  await pb.load('organizations');
  return pb.all<Organization>('organizations').sort((x, y) => x.name.localeCompare(y.name));
}

export async function createOrg(deps: Deps, a: Actor, body: Record<string, unknown>) {
  onlySuper(a);
  const name = str(body.name, 120);
  const slug = str(body.slug, 40).toLowerCase();
  const sheetId = sheetIdFrom(String(body.sheet ?? ''));
  const adminName = str(body.admin_name, 120);
  const adminLogin = str(body.admin_email, 200).toLowerCase();
  const password = String(body.admin_password ?? '');
  if (!name) throw bad('Enter the organisation name.');
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw bad('Short name may use lower-case letters, numbers and dashes.');
  if (!adminName) throw bad('Enter the first administrator’s name.');
  if (!adminLogin) throw bad('Enter the administrator’s email or phone.');
  if (password.length < 8) throw bad('Password must be at least 8 characters.');

  await ensurePlatformSheet(deps.sheets, deps.platformSheetId);
  const pb = platformBook(deps);
  await pb.load('organizations');
  const orgs = pb.all<Organization>('organizations');
  if (orgs.some((o) => o.slug === slug)) throw bad('That short name is already used by another organisation.');
  if (orgs.some((o) => o.sheet_id === sheetId)) throw bad('That spreadsheet already belongs to another organisation.');

  // Fails with a clear message if the sheet is not shared with the service account.
  await ensureOrgSheet(deps.sheets, sheetId, name);

  const orgId = uid('org_');
  const isEmail = adminLogin.includes('@');
  const email = isEmail ? adminLogin : phoneEmail(adminLogin, deps.phoneLoginDomain);
  const userId = await deps.auth.createUser({
    email,
    password,
    app_metadata: { role: 'org_admin', org_id: orgId, sheet_id: sheetId, shop_ids: '*', name: adminName, active: true },
  });

  const ob = orgBook(deps, sheetId);
  await ob.load('staff', 'activity_log');
  const staff: Staff = {
    id: userId,
    name: adminName,
    email: isEmail ? adminLogin : '',
    phone: isEmail ? '' : adminLogin,
    role: 'org_admin',
    shop_ids: '*',
    active: true,
    licence_expiry: '',
    on_shift: false,
    shift_started_at: '',
    created_at: nowISO(),
  };
  ob.insert('staff', staff as unknown as Record<string, unknown>);
  logActivity(ob, a, 'Created organisation', 'organization', orgId, `${name}; first admin ${adminName}`);
  await ob.commit();

  const org: Organization = { id: orgId, name, slug, sheet_id: sheetId, status: 'active', created_at: nowISO() };
  pb.insert('organizations', { ...org, created_by: a.email });
  await pb.commit();
  return org;
}

export async function updateOrg(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  onlySuper(a);
  const pb = platformBook(deps);
  await pb.load('organizations');
  const org = pb.get<Organization>('organizations', id);
  if (!org) throw notFound('Organisation');
  const before = { ...org };
  const patch: Partial<Organization> = {};
  if (body.name != null) patch.name = str(body.name, 120) || org.name;
  if (body.status === 'active' || body.status === 'suspended') patch.status = body.status;
  pb.update('organizations', id, patch);
  await pb.commit();

  if (patch.status && patch.status !== before.status) {
    // Suspension is enforced on every request through each user's account flags.
    const ob = orgBook(deps, org.sheet_id);
    await ob.load('staff', 'activity_log');
    for (const s of ob.all<Staff>('staff')) {
      await deps.auth.updateUser(s.id, { app_metadata: { suspended: patch.status === 'suspended' } });
    }
    logActivity(ob, a, patch.status === 'suspended' ? 'Suspended organisation' : 'Re-activated organisation', 'organization', id);
    await ob.commit();
  }
  return { ...before, ...patch };
}

/** Re-create any missing tabs or columns (for example after someone deleted a column by mistake). */
export async function repairOrg(deps: Deps, a: Actor, id: string) {
  onlySuper(a);
  const pb = platformBook(deps);
  await pb.load('organizations');
  const org = pb.get<Organization>('organizations', id);
  if (!org) throw notFound('Organisation');
  await ensureOrgSheet(deps.sheets, org.sheet_id, org.name);
  return { ok: true };
}
