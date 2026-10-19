// Vercel serverless entry for the hosted demo. Same API code as `npm run demo`,
// with an in-memory spreadsheet seeded on first request. Bundled to api/index.js
// by `npm run build:api` (esbuild) so Vercel needs no TypeScript setup.
// State lives in the warm instance: it resets on a cold start (about 15 min idle).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../supabase/functions/_shared/app.ts';
import { memoryDeps } from './fake-auth.ts';
import { seed, DEMO_ACCOUNTS } from './seed.ts';

const { deps, sheets, auth, files } = memoryDeps();
let ready: Promise<unknown> | null = null;
const init = () => (ready ??= seed(deps, sheets, auth));

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await init();
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const origin = `${proto}://${host}`;
  files.base = `${origin}/files/`;

  // vercel.json passes the original path as ?__p= so it survives the rewrite.
  const u = new URL(req.url ?? '/', origin);
  const path = u.searchParams.get('__p') || u.pathname;
  u.searchParams.delete('__p');
  const search = u.searchParams.toString();
  const url = origin + path + (search ? '?' + search : '');

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);

  if (path.startsWith('/files/')) {
    const f = files.files.get(decodeURIComponent(path.slice(7)));
    if (!f) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('content-type', f.type);
    res.setHeader('cache-control', 'private, max-age=3600');
    return res.end(Buffer.from(f.data));
  }

  if (path.startsWith('/dev/')) {
    res.setHeader('content-type', 'application/json');
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') return res.end();
    if (path === '/dev/accounts') return res.end(JSON.stringify(DEMO_ACCOUNTS));
    if (path === '/dev/login' && req.method === 'POST') {
      try {
        const { login, password } = JSON.parse(body.toString() || '{}');
        const { token, user } = auth.signIn(String(login ?? ''), String(password ?? ''), deps.phoneLoginDomain);
        return res.end(JSON.stringify({ access_token: token, user: { id: user.id, email: user.email } }));
      } catch {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid login credentials' }));
      }
    }
    res.statusCode = 404;
    return res.end('{}');
  }

  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : body,
  });
  const response = await handle(request, deps);
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}
