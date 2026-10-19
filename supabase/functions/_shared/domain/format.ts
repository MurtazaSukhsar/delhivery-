// Small helpers shared by the API (Deno) and the web app (browser). No dependencies.

export function round3(n: number) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

export function uid(prefix = ''): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Long random token for public tracking links. */
export function token(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/** yyyy-mm-dd in the organisation's time zone (Oman by default). */
export function dateInZone(timeZone: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** HH:mm in a time zone. */
export function timeInZone(timeZone: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** A local date + time in a time zone, as a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nowISO() {
  return new Date().toISOString();
}
