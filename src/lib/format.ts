import { format, parseISO } from 'date-fns';

/** The organisation's currency, set once its settings are loaded (OMR until then). */
let CUR = { code: 'OMR', decimals: 3 };
export function setCurrency(c: { code: string; decimals: number } | null | undefined) {
  if (c && c.code) CUR = c;
}
export const currencyCode = () => CUR.code;

export function money(n: number | null | undefined, unit = true) {
  const s = (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: CUR.decimals, maximumFractionDigits: CUR.decimals });
  return unit ? `${s} ${CUR.code}` : s;
}

export const km = (n: number) => `${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`;

export function minutes(n: number) {
  const m = Math.round(n);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export function dateLabel(iso: string) {
  try {
    return format(parseISO(iso), 'EEE d MMM');
  } catch {
    return iso;
  }
}

/** Clock time of an ISO timestamp in the organisation's time zone. */
export function timeIn(iso: string | undefined, tz: string) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function dateTimeIn(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function daysUntil(iso: string, today: string) {
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}
