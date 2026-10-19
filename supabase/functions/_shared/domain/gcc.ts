// GCC reference data and rules that change the cost or the timing of a delivery.
// Figures were collected in October 2026; the admin can override fuel prices in Settings.

export type CountryCode = 'OM' | 'AE' | 'SA' | 'QA' | 'KW' | 'BH';
export type FuelType = 'diesel' | 'petrol';

export interface Country {
  code: CountryCode;
  name: string;
  currency: string;
  /** Digits after the decimal point for this currency */
  decimals: number;
  vat_pct: number;
  time_zone: string;
  /** How often the government changes pump prices */
  fuel_review: string;
  cities: string[];
}

export const COUNTRIES: Record<CountryCode, Country> = {
  OM: { code: 'OM', name: 'Oman', currency: 'OMR', decimals: 3, vat_pct: 5, time_zone: 'Asia/Muscat', fuel_review: 'Prices capped since 2021', cities: ['Muscat', 'Sohar', 'Salalah', 'Nizwa', 'Sur', 'Other'] },
  AE: { code: 'AE', name: 'United Arab Emirates', currency: 'AED', decimals: 2, vat_pct: 5, time_zone: 'Asia/Dubai', fuel_review: 'Changed every month (announced on the last day)', cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Al Ain', 'Other'] },
  SA: { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', decimals: 2, vat_pct: 15, time_zone: 'Asia/Riyadh', fuel_review: 'Reviewed once a year (January)', cities: ['Riyadh', 'Jeddah', 'Dammam', 'Makkah', 'Madinah', 'Other'] },
  QA: { code: 'QA', name: 'Qatar', currency: 'QAR', decimals: 2, vat_pct: 0, time_zone: 'Asia/Qatar', fuel_review: 'Changed every month', cities: ['Doha', 'Al Wakrah', 'Al Rayyan', 'Other'] },
  KW: { code: 'KW', name: 'Kuwait', currency: 'KWD', decimals: 3, vat_pct: 0, time_zone: 'Asia/Kuwait', fuel_review: 'Set every quarter', cities: ['Kuwait City', 'Hawalli', 'Ahmadi', 'Jahra', 'Other'] },
  BH: { code: 'BH', name: 'Bahrain', currency: 'BHD', decimals: 3, vat_pct: 10, time_zone: 'Asia/Bahrain', fuel_review: 'Reviewed from time to time', cities: ['Manama', 'Muharraq', 'Riffa', 'Other'] },
};

export const countryOf = (code: string | undefined): Country => COUNTRIES[(code as CountryCode) ?? 'OM'] ?? COUNTRIES.OM;

export interface FuelPrice {
  country: CountryCode;
  fuel: FuelType;
  price: number;
  /** yyyy-mm-dd the price applies from */
  from: string;
  source: string;
}

/** Pump prices per litre, newest last within each country and fuel. Where a price is missing, the Settings price is used. */
export const FUEL_PRICES: FuelPrice[] = [
  { country: 'OM', fuel: 'diesel', price: 0.258, from: '2021-11-01', source: 'Oman price cap' },
  { country: 'OM', fuel: 'petrol', price: 0.229, from: '2021-11-01', source: 'Oman price cap (M91)' },
  { country: 'AE', fuel: 'diesel', price: 4.3, from: '2026-09-01', source: 'UAE Fuel Price Committee, Sep 2026' },
  { country: 'AE', fuel: 'diesel', price: 4.8, from: '2026-10-01', source: 'UAE Fuel Price Committee, Oct 2026' },
  { country: 'AE', fuel: 'petrol', price: 4.28, from: '2026-10-01', source: 'UAE Special 95, Oct 2026' },
  { country: 'SA', fuel: 'diesel', price: 1.66, from: '2025-01-01', source: 'Aramco, 2025' },
  { country: 'SA', fuel: 'diesel', price: 1.79, from: '2026-01-01', source: 'Aramco, Jan 2026' },
  { country: 'SA', fuel: 'petrol', price: 2.18, from: '2025-01-01', source: 'Aramco, petrol 91' },
  { country: 'QA', fuel: 'diesel', price: 2.05, from: '2026-10-01', source: 'QatarEnergy, Oct 2026' },
  { country: 'KW', fuel: 'diesel', price: 0.115, from: '2026-01-01', source: 'Kuwait, Q1 2026' },
  { country: 'BH', fuel: 'diesel', price: 0.2, from: '2025-01-01', source: 'Bahrain, 2025' },
  { country: 'BH', fuel: 'diesel', price: 0.22, from: '2026-04-01', source: 'Bahrain, Apr 2026' },
];

/** Admin overrides are stored in the `fuel_prices_json` setting as a JSON list of FuelPrice. */
export function parseFuelOverrides(json: string | undefined): FuelPrice[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.price === 'number' && x.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.from)) : [];
  } catch {
    return [];
  }
}

export interface FuelSettings {
  country: string;
  fuel_auto: boolean;
  fuel_price_per_litre: number;
  fuel_prices_json: string;
}

/** The price per litre on a given day. Overrides win over the built-in table on the same or a later date. */
export function fuelPriceFor(s: FuelSettings, fuel: FuelType = 'diesel', date = new Date().toISOString().slice(0, 10)): { price: number; source: string } {
  if (!s.fuel_auto) return { price: s.fuel_price_per_litre, source: 'set in Settings' };
  const c = countryOf(s.country).code;
  const rows = [...FUEL_PRICES, ...parseFuelOverrides(s.fuel_prices_json).map((r) => ({ ...r, source: r.source || 'your price' }))]
    .filter((r) => r.country === c && r.fuel === fuel && r.from <= date)
    .sort((a, b) => a.from.localeCompare(b.from));
  const hit = rows[rows.length - 1];
  return hit ? { price: hit.price, source: hit.source } : { price: s.fuel_price_per_litre, source: 'set in Settings' };
}

// ---------------------------------------------------------------- working-time rules

export interface TimeRule {
  country: CountryCode;
  /** Empty = whole country */
  city?: string;
  kind: 'midday' | 'truck';
  /** Applies only to trucks (3 t and above) */
  heavyOnly: boolean;
  /** mm-dd range in the year, inclusive; empty = all year */
  season?: [string, string];
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  days?: number[];
  from: string;
  to: string;
  text: string;
}

export const TIME_RULES: TimeRule[] = [
  // Summer midday outdoor-work bans (loading and unloading in the open)
  { country: 'AE', kind: 'midday', heavyOnly: false, season: ['06-15', '09-15'], from: '12:30', to: '15:00', text: 'UAE midday work ban (15 Jun–15 Sep): no outdoor unloading 12:30–15:00' },
  { country: 'SA', kind: 'midday', heavyOnly: false, season: ['06-15', '09-15'], from: '12:00', to: '15:00', text: 'Saudi midday work ban (15 Jun–15 Sep): no outdoor unloading 12:00–15:00' },
  { country: 'QA', kind: 'midday', heavyOnly: false, season: ['06-01', '09-15'], from: '10:00', to: '15:30', text: 'Qatar midday work ban (1 Jun–15 Sep): no outdoor unloading 10:00–15:30' },
  { country: 'KW', kind: 'midday', heavyOnly: false, season: ['06-01', '08-31'], from: '11:00', to: '16:00', text: 'Kuwait midday work ban (1 Jun–31 Aug): no outdoor unloading 11:00–16:00' },
  { country: 'OM', kind: 'midday', heavyOnly: false, season: ['06-01', '08-31'], from: '12:30', to: '15:30', text: 'Oman midday work ban (1 Jun–31 Aug): no outdoor unloading 12:30–15:30' },
  { country: 'BH', kind: 'midday', heavyOnly: false, season: ['06-15', '09-15'], from: '12:00', to: '16:00', text: 'Bahrain midday work ban (summer): no outdoor unloading 12:00–16:00' },
  // City truck bans
  { country: 'OM', city: 'Muscat', kind: 'truck', heavyOnly: true, days: [4], from: '12:00', to: '16:00', text: 'Muscat: trucks banned on Thursdays 12:00–16:00' },
  { country: 'OM', city: 'Muscat', kind: 'truck', heavyOnly: true, days: [6], from: '16:00', to: '22:00', text: 'Muscat: trucks banned on Saturdays 16:00–22:00' },
  { country: 'KW', kind: 'truck', heavyOnly: true, from: '06:30', to: '09:00', text: 'Kuwait: trucks banned on main roads 06:30–09:00' },
  { country: 'KW', kind: 'truck', heavyOnly: true, season: ['09-01', '05-31'], from: '12:30', to: '15:30', text: 'Kuwait: trucks banned on main roads 12:30–15:30' },
  { country: 'AE', city: 'Dubai', kind: 'truck', heavyOnly: true, from: '06:00', to: '22:00', text: 'Dubai: trucks banned on Sheikh Zayed Road and residential areas 06:00–22:00 (use Emirates Road)' },
];

/** General advice shown for a city, where exact hours were not published. */
export const ADVICE: { country: CountryCode; city?: string; text: string }[] = [
  { country: 'AE', city: 'Dubai', text: 'Dubai also bans trucks on Airport Rd, Oman St and Damascus St at peak hours (fine AED 1,000). Check RTA permits.' },
  { country: 'SA', text: 'Saudi cities fine trucks entering at banned times SAR 1,000–2,000. Check the city’s truck hours.' },
];

const inSeason = (date: string, season?: [string, string]) => {
  if (!season) return true;
  const md = date.slice(5);
  const [a, b] = season;
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
};
const overlap = (a1: string, a2: string, b1: string, b2: string) => a1 < b2 && b1 < a2;

export interface Restriction {
  level: 'warn' | 'info';
  text: string;
}

/**
 * Rules that touch a delivery. `from`/`to` is the expected time at the customer
 * (time window, or ETA ± service time); without it the rules for the day are listed as advice.
 */
export function restrictionsFor(a: { country: string; city: string; date: string; from?: string; to?: string; heavy: boolean }): Restriction[] {
  const c = countryOf(a.country).code;
  const day = new Date(a.date + 'T12:00:00Z').getUTCDay();
  const out: Restriction[] = [];
  for (const r of TIME_RULES) {
    if (r.country !== c) continue;
    if (r.city && r.city !== a.city) continue;
    if (r.heavyOnly && !a.heavy) continue;
    if (!inSeason(a.date, r.season)) continue;
    if (r.days && !r.days.includes(day)) continue;
    if (a.from && a.to) {
      if (overlap(a.from, a.to, r.from, r.to)) out.push({ level: 'warn', text: r.text });
    } else out.push({ level: 'info', text: r.text });
  }
  if (a.heavy) for (const ad of ADVICE) if (ad.country === c && (!ad.city || ad.city === a.city)) out.push({ level: 'info', text: ad.text });
  return out;
}

/** Trucks of 3 t and above are what city truck bans cover. */
export const isHeavy = (capacityKg: number) => capacityKg >= 3000;
