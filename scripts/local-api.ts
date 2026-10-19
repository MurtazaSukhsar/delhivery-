// Local demo API: the real API code, but with an in-memory spreadsheet and
// demo logins instead of Google Sheets and Supabase. For trying the app
// without any accounts:  npm run demo   (or: npm run dev:api)
// Data is kept in .local-data.json between restarts; delete it to start over.
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { handle } from '../supabase/functions/_shared/app.ts';
import { memoryDeps, SUPER_ADMIN, type FakeUser } from './fake-auth.ts';
import type { Cell } from '../supabase/functions/_shared/sheets/client.ts';
import { seed, DEMO_ACCOUNTS } from './seed.ts';

const PORT = Number(process.env.PORT ?? 8787);
const FILE = '.local-data.json';
const FILES_DIR = '.local-files';
const { deps, sheets, auth, files } = memoryDeps();
files.base = `http://localhost:${PORT}/files/`;
// Photos and signatures are kept in a folder so they survive a restart.
const diskName = (p: string) => encodeURIComponent(p);
const putMem = files.put.bind(files);
files.put = async (path, data, type) => {
  await putMem(path, data, type);
  mkdirSync(FILES_DIR, { recursive: true });
  writeFileSync(`${FILES_DIR}/${diskName(path)}`, data);
  writeFileSync(`${FILES_DIR}/${diskName(path)}.type`, type);
};
if (existsSync(FILES_DIR)) {
  for (const f of readdirSync(FILES_DIR)) {
    if (f.endsWith('.type')) continue;
    files.files.set(decodeURIComponent(f), { data: readFileSync(`${FILES_DIR}/${f}`), type: existsSync(`${FILES_DIR}/${f}.type`) ? readFileSync(`${FILES_DIR}/${f}.type`, 'utf8') : 'image/jpeg' });
  }
}

function save() {
  const books: Record<string, Record<string, Cell[][]>> = {};
  for (const [id, b] of sheets.books) books[id] = Object.fromEntries(b);
  writeFileSync(FILE, JSON.stringify({ books, users: [...auth.users.values()] }));
}

if (existsSync(FILE)) {
  const data = JSON.parse(readFileSync(FILE, 'utf8')) as { books: Record<string, Record<string, Cell[][]>>; users: FakeUser[] };
  sheets.books.clear();
  for (const [id, tabs] of Object.entries(data.books)) sheets.books.set(id, new Map(Object.entries(tabs)));
  for (const u of data.users) auth.users.set(u.id, u);
  console.log(`Loaded saved demo data from ${FILE}`);
} else {
  console.log('Creating sample data…');
  await seed(deps, sheets, auth);
  save();
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const url = `http://localhost:${PORT}${req.url}`;

  // Demo-only file links, standing in for Supabase Storage signed URLs.
  if (req.url?.startsWith('/files/')) {
    const f = files.files.get(decodeURIComponent(req.url.slice(7).split('?')[0]));
    if (!f) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('content-type', f.type);
    res.setHeader('cache-control', 'private, max-age=3600');
    return res.end(Buffer.from(f.data));
  }

  // Demo-only sign-in, standing in for Supabase Auth.
  if (req.url?.startsWith('/dev/')) {
    res.setHeader('content-type', 'application/json');
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') return res.end();
    if (req.url === '/dev/accounts') return res.end(JSON.stringify(DEMO_ACCOUNTS));
    if (req.url === '/dev/login' && req.method === 'POST') {
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

  const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : body });
  const response = await handle(request, deps);
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
  if (req.method !== 'GET' && req.method !== 'OPTIONS' && response.status < 400) save();
}).listen(PORT, () => {
  console.log(`Demo API on http://localhost:${PORT}/api`);
  console.log(`Platform admin: ${SUPER_ADMIN} / platform-demo`);
});
