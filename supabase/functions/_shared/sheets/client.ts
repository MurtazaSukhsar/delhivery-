// Google Sheets access with a service account, using only fetch + Web Crypto,
// so it runs unchanged in Supabase Edge Functions (Deno) and in Node.

export type Cell = string | number | boolean | null;

export interface SheetsClient {
  /** Values of whole tabs, in the same order as `tabs`. Row 1 is the header. */
  readTabs(sheetId: string, tabs: string[]): Promise<Cell[][][]>;
  /** Add rows after the last row of a tab. */
  append(sheetId: string, tab: string, rows: Cell[][]): Promise<void>;
  /** Overwrite specific ranges, e.g. `deliveries!A7:AN7`, in one request. */
  update(sheetId: string, data: { range: string; values: Cell[][] }[]): Promise<void>;
  listTabs(sheetId: string): Promise<string[]>;
  addTabs(sheetId: string, titles: string[]): Promise<void>;
  serviceAccountEmail(): string;
}

export class SheetsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function importKey(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export class GoogleSheetsClient implements SheetsClient {
  private sa: ServiceAccount;
  private token: { value: string; exp: number } | null = null;
  private key: CryptoKey | null = null;

  constructor(serviceAccountJson: string) {
    let parsed: Partial<ServiceAccount> = {};
    try {
      parsed = JSON.parse(serviceAccountJson || '{}');
    } catch {
      /* reported on first use */
    }
    this.sa = { client_email: parsed.client_email ?? '', private_key: String(parsed.private_key ?? '').replace(/\\n/g, '\n') };
  }

  serviceAccountEmail() {
    return this.sa.client_email;
  }

  private async accessToken(): Promise<string> {
    if (!this.sa.client_email || !this.sa.private_key) throw new SheetsError('The server is missing GOOGLE_SERVICE_ACCOUNT_JSON (the Google service account key).', 500);
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.exp - 60 > now) return this.token.value;
    this.key ??= await importKey(this.sa.private_key);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: this.sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', this.key, new TextEncoder().encode(`${header}.${claims}`));
    const assertion = `${header}.${claims}.${b64url(sig)}`;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new SheetsError(`Google sign-in for the service account failed (${res.status}). Check GOOGLE_SERVICE_ACCOUNT_JSON.`, 500);
    const j = await res.json();
    this.token = { value: j.access_token, exp: now + Number(j.expires_in || 3600) };
    return this.token.value;
  }

  /** fetch with retries on 429 / 5xx (truncated exponential backoff, as Google recommends). */
  private async call(url: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        ...init,
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      });
      if (res.ok) return res.status === 204 ? null : res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000 + Math.random() * 500));
        continue;
      }
      const text = await res.text();
      if (res.status === 403 || res.status === 404) {
        throw new SheetsError(`The spreadsheet could not be opened. Share it with ${this.sa.client_email} as Editor.`, 400);
      }
      if (res.status === 429) throw new SheetsError('Google Sheets is busy (too many requests this minute). Try again shortly.', 503);
      throw new SheetsError(`Google Sheets error ${res.status}: ${text.slice(0, 300)}`, 502);
    }
  }

  async readTabs(sheetId: string, tabs: string[]): Promise<Cell[][][]> {
    if (!tabs.length) return [];
    const q = tabs.map((t) => 'ranges=' + encodeURIComponent(`'${t}'`)).join('&');
    const j = (await this.call(`${API}/${sheetId}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`)) as {
      valueRanges?: { values?: Cell[][] }[];
    };
    return (j.valueRanges ?? []).map((v) => v.values ?? []);
  }

  async append(sheetId: string, tab: string, rows: Cell[][]) {
    if (!rows.length) return;
    // RAW: text is stored as typed, never evaluated as a formula.
    await this.call(`${API}/${sheetId}/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    });
  }

  async update(sheetId: string, data: { range: string; values: Cell[][] }[]) {
    if (!data.length) return;
    await this.call(`${API}/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }

  async listTabs(sheetId: string) {
    const j = (await this.call(`${API}/${sheetId}?fields=sheets.properties.title`)) as { sheets?: { properties: { title: string } }[] };
    return (j.sheets ?? []).map((x) => x.properties.title);
  }

  async addTabs(sheetId: string, titles: string[]) {
    if (!titles.length) return;
    await this.call(`${API}/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: titles.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }),
    });
  }
}

/** In-memory stand-in with the same behaviour, for tests and the local demo server. */
export class MemorySheetsClient implements SheetsClient {
  books = new Map<string, Map<string, Cell[][]>>();
  calls = { read: 0, write: 0 };

  private book(id: string) {
    const b = this.books.get(id);
    if (!b) throw new SheetsError(`The spreadsheet could not be opened. Share it with ${this.serviceAccountEmail()} as Editor.`, 400);
    return b;
  }
  createBook(id: string) {
    this.books.set(id, new Map());
  }
  serviceAccountEmail() {
    return 'delivery-app@demo-project.iam.gserviceaccount.com';
  }
  async readTabs(sheetId: string, tabs: string[]) {
    this.calls.read++;
    const b = this.book(sheetId);
    return tabs.map((t) => structuredClone(b.get(t) ?? []));
  }
  async append(sheetId: string, tab: string, rows: Cell[][]) {
    this.calls.write++;
    const b = this.book(sheetId);
    const t = b.get(tab);
    if (!t) throw new SheetsError(`Unable to parse range: ${tab}`, 400);
    t.push(...structuredClone(rows));
  }
  async update(sheetId: string, data: { range: string; values: Cell[][] }[]) {
    this.calls.write++;
    const b = this.book(sheetId);
    for (const d of data) {
      const m = /^'?([^'!]+)'?!([A-Z]+)(\d+)/.exec(d.range);
      if (!m) throw new Error('bad range ' + d.range);
      const t = b.get(m[1])!;
      const col = colIndex(m[2]);
      const row = Number(m[3]) - 1;
      d.values.forEach((vals, i) => {
        const r = (t[row + i] ??= []);
        vals.forEach((v, j) => (r[col + j] = v));
      });
    }
  }
  async listTabs(sheetId: string) {
    this.calls.read++;
    return [...this.book(sheetId).keys()];
  }
  async addTabs(sheetId: string, titles: string[]) {
    this.calls.write++;
    const b = this.book(sheetId);
    for (const t of titles) if (!b.has(t)) b.set(t, []);
  }
}

export function colLetter(i: number): string {
  let s = '';
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
