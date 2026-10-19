import type { Cell, SheetsClient } from './client.ts';
import { colLetter } from './client.ts';
import type { Columns } from './schema.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface Loaded {
  headers: string[];
  raw: Cell[][]; // data rows only (sheet row = index + 2)
  objects: (Row | null)[]; // parallel to raw; null for blank rows
  byId: Map<string, number>;
}

/**
 * One spreadsheet, used for the length of one API request:
 * read the tabs you need in a single call, change objects in memory,
 * then `commit()` writes everything back in as few calls as possible.
 */
export class Book<S extends Record<string, Columns>> {
  private tabs = new Map<keyof S & string, Loaded>();
  private appends = new Map<keyof S & string, Row[]>();
  private dirty = new Map<keyof S & string, Set<number>>();

  private client: SheetsClient;
  readonly sheetId: string;
  private schema: S;

  constructor(client: SheetsClient, sheetId: string, schema: S) {
    this.client = client;
    this.sheetId = sheetId;
    this.schema = schema;
  }

  async load(...names: (keyof S & string)[]) {
    const missing = names.filter((n) => !this.tabs.has(n));
    if (!missing.length) return;
    const data = await this.client.readTabs(this.sheetId, missing);
    const heal: { range: string; values: Cell[][] }[] = [];
    missing.forEach((name, i) => {
      const loaded = this.parse(name, data[i] ?? []);
      this.tabs.set(name, loaded);
      // A spreadsheet made by an older version lacks the newest columns. Add them now,
      // once, so nothing is silently dropped when a row is saved.
      const absent = Object.keys(this.schema[name]).filter((k) => !loaded.headers.includes(k));
      if (absent.length && loaded.headers.length) {
        const start = loaded.headers.length;
        heal.push({ range: `'${name}'!${colLetter(start)}1:${colLetter(start + absent.length - 1)}1`, values: [absent] });
        loaded.headers.push(...absent);
      }
    });
    if (heal.length) await this.client.update(this.sheetId, heal);
  }

  private parse(name: keyof S & string, values: Cell[][]): Loaded {
    const headers = (values[0] ?? []).map((h) => String(h ?? '').trim());
    const cols = this.schema[name];
    const raw = values.slice(1);
    const byId = new Map<string, number>();
    const objects = raw.map((r, i) => {
      if (!r || r.every((c) => c === '' || c == null)) return null;
      const o: Row = {};
      for (const [key, type] of Object.entries(cols)) {
        const idx = headers.indexOf(key);
        o[key] = fromCell(idx >= 0 ? r[idx] : null, type);
      }
      if (o.id) byId.set(String(o.id), i);
      return o;
    });
    return { headers, raw, objects, byId };
  }

  /** Whether a tab was loaded in this request. */
  tabsLoaded(name: keyof S & string) {
    return this.tabs.has(name);
  }

  private t(name: keyof S & string) {
    const t = this.tabs.get(name);
    if (!t) throw new Error(`Tab ${String(name)} was not loaded`);
    return t;
  }

  /** All rows of a tab as objects (loaded rows plus rows added in this request). */
  all<T = Row>(name: keyof S & string): T[] {
    const t = this.t(name);
    return [...(t.objects.filter(Boolean) as Row[]), ...(this.appends.get(name) ?? [])] as T[];
  }

  get<T = Row>(name: keyof S & string, id: string): T | undefined {
    const t = this.t(name);
    const i = t.byId.get(id);
    if (i != null) return t.objects[i] as T;
    return (this.appends.get(name) ?? []).find((o) => o.id === id) as T | undefined;
  }

  insert<T extends Row>(name: keyof S & string, obj: T): T {
    this.t(name);
    const full: Row = {};
    for (const [key, type] of Object.entries(this.schema[name])) full[key] = obj[key] ?? emptyFor(type);
    const list = this.appends.get(name) ?? [];
    list.push(full);
    this.appends.set(name, list);
    return full as T;
  }

  /** Change fields of a row. Returns the updated object. */
  update<T = Row>(name: keyof S & string, id: string, patch: Partial<T>): T {
    const t = this.t(name);
    const pending = (this.appends.get(name) ?? []).find((o) => o.id === id);
    if (pending) return Object.assign(pending, patch) as T;
    const i = t.byId.get(id);
    if (i == null) throw new Error(`${String(name)} ${id} not found`);
    Object.assign(t.objects[i]!, patch);
    const d = this.dirty.get(name) ?? new Set<number>();
    d.add(i);
    this.dirty.set(name, d);
    return t.objects[i] as T;
  }

  /** Write all changes: one append per tab with new rows, one batch update for changed rows. */
  async commit() {
    const data: { range: string; values: Cell[][] }[] = [];
    for (const [name, rows] of this.dirty) {
      const t = this.t(name);
      for (const i of rows) {
        const o = t.objects[i]!;
        const r = [...(t.raw[i] ?? [])];
        while (r.length < t.headers.length) r.push('');
        for (const [key, type] of Object.entries(this.schema[name])) {
          const idx = t.headers.indexOf(key);
          if (idx >= 0) r[idx] = toCell(o[key], type);
        }
        t.raw[i] = r;
        data.push({ range: `'${name}'!A${i + 2}:${colLetter(Math.max(0, t.headers.length - 1))}${i + 2}`, values: [r] });
      }
    }
    this.dirty.clear();
    if (data.length) await this.client.update(this.sheetId, data);
    for (const [name, rows] of this.appends) {
      if (!rows.length) continue;
      const t = this.t(name);
      const cols = this.schema[name];
      const headers = t.headers.length ? t.headers : Object.keys(cols);
      await this.client.append(
        this.sheetId,
        name,
        rows.map((o) => headers.map((h) => (h in cols ? toCell(o[h], cols[h]) : ''))),
      );
      for (const o of rows) {
        t.raw.push([]);
        t.objects.push(o);
        if (o.id) t.byId.set(String(o.id), t.objects.length - 1);
      }
    }
    this.appends.clear();
  }
}

function emptyFor(type: string) {
  return type === 'number' ? null : type === 'boolean' ? false : '';
}

function fromCell(v: Cell | undefined, type: string) {
  if (type === 'number') {
    if (v === '' || v == null) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') {
    if (typeof v === 'boolean') return v;
    return ['true', 'yes', '1'].includes(String(v ?? '').trim().toLowerCase());
  }
  return v == null ? '' : String(v);
}

function toCell(v: unknown, type: string): Cell {
  if (v == null) return '';
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : v === '' ? '' : Number(v) || 0;
  if (type === 'boolean') return !!v;
  return String(v);
}
