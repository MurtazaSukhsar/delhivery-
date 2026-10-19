import type { SheetsClient } from '../sheets/client.ts';
import { colLetter } from '../sheets/client.ts';
import type { Columns } from '../sheets/schema.ts';
import { ORG_TABLES, PLATFORM_TABLES } from '../sheets/schema.ts';
import { DEFAULT_SETTINGS } from '../domain/types.ts';

/**
 * Make sure a spreadsheet has every tab and every column the app needs.
 * Safe to run again: it only adds what is missing and never removes data.
 */
export async function ensureTabs(sheets: SheetsClient, sheetId: string, schema: Record<string, Columns>) {
  const existing = await sheets.listTabs(sheetId);
  const names = Object.keys(schema);
  await sheets.addTabs(sheetId, names.filter((n) => !existing.includes(n)));
  const values = await sheets.readTabs(sheetId, names);
  const writes: { range: string; values: (string | number | boolean | null)[][] }[] = [];
  names.forEach((name, i) => {
    const header = (values[i]?.[0] ?? []).map((h) => String(h ?? '').trim());
    const missing = Object.keys(schema[name]).filter((k) => !header.includes(k));
    if (!missing.length) return;
    const start = header.length;
    writes.push({ range: `'${name}'!${colLetter(start)}1:${colLetter(start + missing.length - 1)}1`, values: [missing] });
  });
  if (writes.length) await sheets.update(sheetId, writes);
  return { values, names };
}

export async function ensureOrgSheet(sheets: SheetsClient, sheetId: string, companyName: string) {
  const { values, names } = await ensureTabs(sheets, sheetId, ORG_TABLES);
  const settingsRows = values[names.indexOf('settings')] ?? [];
  if (settingsRows.length <= 1) {
    const defaults = { ...DEFAULT_SETTINGS, company_name: companyName };
    await sheets.append(
      sheetId,
      'settings',
      Object.entries(defaults).map(([k, v]) => [k, String(v)]),
    );
  }
}

export async function ensurePlatformSheet(sheets: SheetsClient, sheetId: string) {
  await ensureTabs(sheets, sheetId, PLATFORM_TABLES);
}
