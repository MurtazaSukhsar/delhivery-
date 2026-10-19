import { type Actor, type Deps, ApiError, actorFrom } from './core.ts';
import { SheetsError } from './sheets/client.ts';
import * as platform from './services/platform.ts';
import * as admin from './services/admin.ts';
import * as records from './services/records.ts';
import * as deliveries from './services/deliveries.ts';
import * as driver from './services/driver.ts';
import * as tracking from './services/tracking.ts';
import * as logs from './services/logs.ts';
import * as money from './services/money.ts';

type Body = Record<string, unknown>;
interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Body;
  actor: () => Promise<Actor>;
}
type Handler = (ctx: Ctx, deps: Deps, req: Request) => Promise<unknown>;

const routes: [string, RegExp, string[], Handler][] = [];
function route(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push([method, re, keys, h]);
}

// ---- public check that the function is deployed and configured (reveals no secrets) ----
route('GET', '/health', async (_c, d) => {
  let google = false;
  try {
    google = !!d.sheets.serviceAccountEmail();
  } catch {
    google = false;
  }
  return { ok: true, google_key: google, platform_sheet: !!d.platformSheetId, super_admins: d.superAdminEmails.length > 0 };
});

// ---- problems reported by the web app itself ----
route('POST', '/client-error', async (c, d, req) => logs.clientError(d, req, c.body));

// ---- platform (Farwings) ----
route('GET', '/platform/info', async (c, d) => platform.platformInfo(d, await c.actor()));
route('GET', '/platform/orgs', async (c, d) => platform.listOrgs(d, await c.actor()));
route('POST', '/platform/orgs', async (c, d) => platform.createOrg(d, await c.actor(), c.body));
route('PATCH', '/platform/orgs/:id', async (c, d) => platform.updateOrg(d, await c.actor(), c.params.id, c.body));
route('GET', '/platform/errors', async (c, d) => logs.listErrors(d, await c.actor()));
route('PATCH', '/platform/errors/:id', async (c, d) => logs.resolveError(d, await c.actor(), c.params.id, c.body));
route('POST', '/platform/check', async (c, d) => logs.checkOrgs(d, await c.actor(), c.body));
route('POST', '/platform/orgs/:id/repair', async (c, d) => platform.repairOrg(d, await c.actor(), c.params.id));

// ---- signed-in user ----
route('GET', '/me', async (c, d) => admin.me(d, await c.actor()));
route('POST', '/session', async (c, d) => admin.sessionStarted(d, await c.actor(), c.body));

// ---- organisation admin ----
route('GET', '/settings', async (c, d) => admin.getSettings(d, await c.actor()));
route('PUT', '/settings', async (c, d) => admin.saveSettings(d, await c.actor(), c.body));
route('GET', '/shops', async (c, d) => admin.listShops(d, await c.actor()));
route('POST', '/shops', async (c, d) => admin.createShop(d, await c.actor(), c.body));
route('PATCH', '/shops/:id', async (c, d) => admin.updateShop(d, await c.actor(), c.params.id, c.body));
route('GET', '/staff', async (c, d) => admin.listStaff(d, await c.actor()));
route('POST', '/staff', async (c, d) => admin.createStaff(d, await c.actor(), c.body));
route('PATCH', '/staff/:id', async (c, d) => admin.updateStaff(d, await c.actor(), c.params.id, c.body));
route('GET', '/drivers', async (c, d) => admin.listDrivers(d, await c.actor()));
route('GET', '/areas', async (c, d) => admin.listAreas(d, await c.actor()));
route('POST', '/areas', async (c, d) => admin.saveArea(d, await c.actor(), null, c.body));
route('PATCH', '/areas/:id', async (c, d) => admin.saveArea(d, await c.actor(), c.params.id, c.body));
route('GET', '/activity', async (c, d) => admin.listActivity(d, await c.actor(), c.query));

// ---- records ----
route('GET', '/customers', async (c, d) => records.listCustomers(d, await c.actor()));
route('POST', '/customers', async (c, d) => records.saveCustomer(d, await c.actor(), null, c.body));
route('PATCH', '/customers/:id', async (c, d) => records.saveCustomer(d, await c.actor(), c.params.id, c.body));
route('GET', '/vehicles', async (c, d) => records.listVehicles(d, await c.actor(), c.query));
route('GET', '/vehicles/planning', async (c, d) => records.listVehiclesForPlanning(d, await c.actor(), c.query));
route('POST', '/vehicles', async (c, d) => records.saveVehicle(d, await c.actor(), null, c.body));
route('PATCH', '/vehicles/:id', async (c, d) => records.saveVehicle(d, await c.actor(), c.params.id, c.body));
route('POST', '/vehicle-documents', async (c, d) => records.saveDocument(d, await c.actor(), null, c.body));
route('PATCH', '/vehicle-documents/:id', async (c, d) => records.saveDocument(d, await c.actor(), c.params.id, c.body));
route('GET', '/vehicle-costs', async (c, d) => records.listVehicleCosts(d, await c.actor(), c.query));
route('POST', '/vehicle-costs', async (c, d) => records.saveVehicleCost(d, await c.actor(), null, c.body));
route('PATCH', '/vehicle-costs/:id', async (c, d) => records.saveVehicleCost(d, await c.actor(), c.params.id, c.body));

// Money: collections from drivers, and reports
route('GET', '/collections', async (c, d) => money.listCollections(d, await c.actor(), c.query));
route('POST', '/collections/settle', async (c, d) => money.settleCollections(d, await c.actor(), c.body));
route('PATCH', '/payments/:id', async (c, d) => money.updatePayment(d, await c.actor(), c.params.id, c.body));
route('GET', '/reports', async (c, d) => money.reportData(d, await c.actor(), c.query));

// ---- deliveries ----
route('GET', '/deliveries', async (c, d) => deliveries.listDeliveries(d, await c.actor(), c.query));
route('POST', '/deliveries', async (c, d) => deliveries.createDelivery(d, await c.actor(), c.body));
route('GET', '/deliveries/:id', async (c, d) => deliveries.getDelivery(d, await c.actor(), c.params.id));
route('PATCH', '/deliveries/:id', async (c, d) => deliveries.updateDelivery(d, await c.actor(), c.params.id, c.body));
route('POST', '/deliveries/:id/cancel', async (c, d) => deliveries.cancelDelivery(d, await c.actor(), c.params.id, c.body));
route('POST', '/deliveries/:id/reschedule', async (c, d) => deliveries.rescheduleDelivery(d, await c.actor(), c.params.id, c.body));
route('POST', '/deliveries/:id/assign', async (c, d) => deliveries.assignDelivery(d, await c.actor(), c.params.id, c.body));
route('POST', '/deliveries/:id/unassign', async (c, d) => deliveries.unassignDelivery(d, await c.actor(), c.params.id));
route('GET', '/trips', async (c, d) => deliveries.listTrips(d, await c.actor(), c.query));
route('POST', '/trips', async (c, d) => deliveries.buildTrip(d, await c.actor(), c.body));

// ---- driver ----
route('GET', '/driver/today', async (c, d) => driver.driverToday(d, await c.actor()));
route('POST', '/driver/shift', async (c, d) => driver.driverShift(d, await c.actor(), c.body));
route('POST', '/driver/sync', async (c, d) => driver.driverSync(d, await c.actor(), c.body));
route('POST', '/driver/fuel', async (c, d) => driver.driverFuel(d, await c.actor(), c.body));

// ---- public tracking ----
route('GET', '/track/:token', async (c, d) => tracking.track(d, c.params.token));
route('POST', '/track/:token/rate', async (c, d) => tracking.rate(d, c.params.token, c.body));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
}

/** One web-standard handler: used by the Supabase Edge Function and by the local demo server. */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  // Supabase passes /api/... (the function name first); strip everything up to it.
  const i = url.pathname.indexOf('/api/');
  const path = i >= 0 ? url.pathname.slice(i + 4) : url.pathname.endsWith('/api') ? '/' : url.pathname;
  for (const [method, re, keys, h] of routes) {
    if (method !== req.method) continue;
    const m = re.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    keys.forEach((k, j) => (params[k] = decodeURIComponent(m[j + 1])));
    let body: Body = {};
    if (req.method !== 'GET') {
      try {
        const text = await req.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        return json(400, { error: 'The request body is not valid JSON.' });
      }
    }
    let actor: Actor | null = null;
    try {
      const data = await h({ params, query: url.searchParams, body, actor: async () => (actor ??= await actorFrom(deps, req)) }, deps, req);
      return json(200, data ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, { error: e.message });
      const where = `${req.method} ${path}`;
      if (e instanceof SheetsError) {
        // Google trouble (sheet not shared, quota, outage) is something the platform admin must see.
        await logs.logError(deps, { source: 'api', actor, where, status: e.status, message: e.message, detail: e.stack });
        return json(e.status, { error: e.message });
      }
      console.error(e);
      await logs.logError(deps, { source: 'api', actor, where, status: 500, message: e instanceof Error ? e.message : String(e), detail: e instanceof Error ? e.stack : '' });
      return json(500, { error: 'Something went wrong on the server. Try again; if it keeps happening, tell your administrator.' });
    }
  }
  return json(404, { error: `No such endpoint: ${req.method} ${path}` });
}
