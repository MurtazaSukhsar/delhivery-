import { type Actor, type Deps, bad, forbidden, notFound, platformBook, str, actorFrom } from '../core.ts';
import { ORG_TABLES, PLATFORM_TABLES } from '../sheets/schema.ts';
import type { ErrorLogEntry, Organization } from '../domain/types.ts';
import { uid, nowISO } from '../domain/format.ts';
import { ensureOrgSheet, ensurePlatformSheet } from './setup.ts';

/**
 * Problem log for the platform admin.
 *
 * Unexpected errors (bugs, Google or Supabase failures, browser crashes) are
 * appended to the `error_log` tab of the platform spreadsheet, so one person can
 * see what broke for any client without opening their data. Ordinary mistakes
 * (a wrong password, a missing field) are not logged.
 *
 * Logging must never make things worse, so it is throttled and every failure
 * inside it is swallowed.
 */

const recent = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;
const MAX_PER_MINUTE = 15;

export interface ErrorInfo {
  source: 'api' | 'browser';
  actor?: Actor | null;
  where: string;
  status: number;
  message: string;
  detail?: string;
}

export async function logError(deps: Deps, e: ErrorInfo): Promise<void> {
  try {
    if (!deps.platformSheetId) return;
    const now = Date.now();
    const key = `${e.source}|${e.actor?.orgId ?? ''}|${e.where}|${e.message}`.slice(0, 300);
    const last = recent.get(key);
    if (last && now - last < 60_000) return; // the same problem again within a minute
    if (recent.size > 200) recent.clear();
    recent.set(key, now);
    if (now - windowStart > 60_000) {
      windowStart = now;
      windowCount = 0;
    }
    if (++windowCount > MAX_PER_MINUTE) return; // an error storm must not use up the Sheets write quota

    const cols = Object.keys(PLATFORM_TABLES.error_log);
    const entry: Record<string, string | number | boolean> = {
      id: uid('err_'),
      at: nowISO(),
      source: e.source,
      org_id: e.actor?.orgId ?? '',
      user_name: e.actor?.name ?? '',
      role: e.actor?.role ?? '',
      where: str(e.where, 200),
      status: e.status,
      message: str(e.message, 500),
      detail: String(e.detail ?? '').slice(0, 2000),
      resolved: false,
    };
    const row = cols.map((c) => entry[c] ?? '');
    try {
      await deps.sheets.append(deps.platformSheetId, 'error_log', [row]);
    } catch {
      // The tab may not exist yet on a platform sheet made by an older version.
      await ensurePlatformSheet(deps.sheets, deps.platformSheetId);
      await deps.sheets.append(deps.platformSheetId, 'error_log', [row]);
    }
  } catch (err) {
    console.error('Could not write the error log:', err);
  }
}

/** Errors reported by the web app itself (a screen crashed). Open to anyone, but throttled. */
export async function clientError(deps: Deps, req: Request, body: Record<string, unknown>) {
  let actor: Actor | null = null;
  try {
    actor = await actorFrom(deps, req);
  } catch {
    actor = null; // customers on the tracking page are not signed in
  }
  const message = str(body.message, 400);
  if (!message) throw bad('Nothing to report.');
  await logError(deps, { source: 'browser', actor, where: str(body.page, 160) || 'browser', status: 0, message, detail: String(body.stack ?? '').slice(0, 1500) });
  return { ok: true };
}

function onlySuper(a: Actor) {
  if (a.role !== 'super_admin') throw forbidden('Only the platform administrator can do this.');
}

export async function listErrors(deps: Deps, a: Actor) {
  onlySuper(a);
  await ensurePlatformSheet(deps.sheets, deps.platformSheetId);
  const pb = platformBook(deps);
  await pb.load('error_log');
  return pb
    .all<ErrorLogEntry>('error_log')
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, 300);
}

export async function resolveError(deps: Deps, a: Actor, id: string, body: Record<string, unknown>) {
  onlySuper(a);
  const pb = platformBook(deps);
  await pb.load('error_log');
  if (!pb.get('error_log', id)) throw notFound('Log entry');
  pb.update<ErrorLogEntry>('error_log', id, { resolved: body.resolved !== false });
  await pb.commit();
  return { ok: true };
}

export interface OrgCheck {
  org_id: string;
  name: string;
  status: string;
  ok: boolean;
  problem: string;
  fixed: string[];
}

/**
 * Open every client's spreadsheet and report whether it is reachable and has all its tabs.
 * With `repair`, missing tabs and columns are added (never removed). One read per client.
 */
export async function checkOrgs(deps: Deps, a: Actor, body: Record<string, unknown>) {
  onlySuper(a);
  await ensurePlatformSheet(deps.sheets, deps.platformSheetId);
  const pb = platformBook(deps);
  await pb.load('organizations');
  const repair = body.repair === true;
  const results: OrgCheck[] = [];
  for (const org of pb.all<Organization>('organizations')) {
    const r: OrgCheck = { org_id: org.id, name: org.name, status: org.status, ok: true, problem: '', fixed: [] };
    try {
      const tabs = await deps.sheets.listTabs(org.sheet_id);
      const missing = Object.keys(ORG_TABLES).filter((t) => !tabs.includes(t));
      if (missing.length) {
        r.ok = false;
        r.problem = `Missing tabs: ${missing.join(', ')}`;
      }
      if (repair) {
        await ensureOrgSheet(deps.sheets, org.sheet_id, org.name);
        if (missing.length) {
          r.fixed = missing;
          r.ok = true;
          r.problem = '';
        }
      }
    } catch (e) {
      r.ok = false;
      r.problem = e instanceof Error ? e.message : 'Could not open the spreadsheet.';
    }
    results.push(r);
  }
  return { checked_at: nowISO(), service_account_email: deps.sheets.serviceAccountEmail(), results };
}
