import type { CostSettings, Equipment, LatLng, Vehicle } from './types.ts';
import { haversineKm, roadKm } from './route.ts';
import { round3 } from './format.ts';
import { countryOf, fuelPriceFor, type FuelType } from './gcc.ts';

/**
 * Delivery cost maths. It runs in the browser (so staff see every number change
 * as they type, without asking Google Sheets) and on the server (which saves the
 * same figures), so both always agree.
 */

export type Band = 'good' | 'attention' | 'loss';

export interface CostBreakdown {
  fuel: number;
  vehicle: number;
  driver: number;
  rental: number;
  helpers: number;
  equipment: number;
  tolls: number;
  overhead: number;
}

export type VehicleSpec = Pick<Vehicle, 'fuel_use' | 'maintenance_per_km' | 'ownership' | 'rental_per_day' | 'capacity_kg' | 'capacity_cbm'> & { fuel_type?: FuelType };
type CostVehicle = Pick<VehicleSpec, 'fuel_use' | 'maintenance_per_km' | 'ownership' | 'rental_per_day' | 'fuel_type'>;

export interface Load {
  weight_kg: number;
  volume_cbm: number;
}

/** Work at the site that costs extra: helpers, a crane or forklift, waiting, and road tolls. */
export interface Extras {
  helpers: number;
  equipment: Equipment;
  wait_minutes: number;
  /** tolls for the round trip */
  toll: number;
}
export const NO_EXTRAS: Extras = { helpers: 0, equipment: 'none', wait_minutes: 0, toll: 0 };

/** Used when a delivery is costed before any vehicle fits or exists. */
export const REFERENCE_VEHICLE: CostVehicle = { fuel_use: 12, fuel_type: 'diesel', maintenance_per_km: 0.03, ownership: 'owned', rental_per_day: 0 };

// ------------------------------------------------------------------ money in the right currency

export function currencyOf(s: Pick<CostSettings, 'country'>) {
  const c = countryOf(s.country);
  return { code: c.currency, decimals: c.decimals };
}
const roundTo = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
export const roundMoney = (x: number, s: Pick<CostSettings, 'country'>) => roundTo(x, currencyOf(s).decimals);
/** 19.478 OMR, 4.80 AED */
export function formatMoney(x: number, s: Pick<CostSettings, 'country'>) {
  const c = currencyOf(s);
  return `${(Number(x) || 0).toLocaleString('en-US', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals })} ${c.code}`;
}
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const n3 = (x: number) => (Math.round(x * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });

// ------------------------------------------------------------------ the parts

/** What a driver really costs a month: salary plus housing, visa, insurance and gratuity set aside. */
export function driverMonthlyCost(s: CostSettings) {
  const salary = s.driver_monthly_salary || 0;
  const housing = s.driver_housing_monthly || 0;
  const visa = s.driver_visa_months > 0 ? (s.driver_visa_cost || 0) / s.driver_visa_months : 0;
  const insurance = (s.driver_insurance_yearly || 0) / 12;
  const gratuity = ((salary / 30) * (s.gratuity_days_per_year || 0)) / 12;
  const total = salary + housing + visa + insurance + gratuity;
  return { salary, housing, visa, insurance, gratuity, total };
}

export function driverCostPerMinute(s: CostSettings) {
  const m = s.working_days_per_month * s.working_hours_per_day * 60;
  return m > 0 ? driverMonthlyCost(s).total / m : 0;
}

export function driveMinutes(km: number, s: CostSettings) {
  return s.average_speed_kmh > 0 ? (km / s.average_speed_kmh) * 60 * s.traffic_factor : 0;
}

/** A hired vehicle is paid per day, and a long job needs more than one day. */
export function rentalDays(mins: number, s: CostSettings) {
  const day = Math.max(1, s.working_hours_per_day) * 60;
  return Math.max(1, Math.ceil(mins / day));
}

export function fits(v: Pick<VehicleSpec, 'capacity_kg' | 'capacity_cbm'>, load: Load) {
  const weight = load.weight_kg <= v.capacity_kg;
  const volume = !(v.capacity_cbm > 0) || load.volume_cbm <= v.capacity_cbm;
  return { weight, volume, ok: weight && volume };
}

export function extrasCost(x: Extras, s: CostSettings) {
  return {
    helpers: round3(Math.max(0, x.helpers) * s.helper_cost_per_job),
    equipment: x.equipment === 'crane' ? round3(s.crane_cost_per_job) : x.equipment === 'forklift' ? round3(s.forklift_cost_per_job) : 0,
    tolls: round3(Math.max(0, x.toll)),
  };
}

/** Cost of one trip of `km` and `mins` with `stops` deliveries on it (site extras are added per delivery). */
export function runningCost(km: number, mins: number, v: CostVehicle | undefined, s: CostSettings, stops = 1, date?: string): CostBreakdown {
  const car = v ?? REFERENCE_VEHICLE;
  const fuel = fuelPriceFor(s, car.fuel_type ?? 'diesel', date);
  return {
    fuel: round3(km * (car.fuel_use / 100) * fuel.price),
    vehicle: round3(km * car.maintenance_per_km),
    driver: round3(mins * driverCostPerMinute(s)),
    rental: car.ownership === 'rented' ? round3(car.rental_per_day * rentalDays(mins, s)) : 0,
    helpers: 0,
    equipment: 0,
    tolls: 0,
    overhead: round3(s.overhead_per_delivery * stops),
  };
}

export const sumBreakdown = (b: CostBreakdown) => round3(b.fuel + b.vehicle + b.driver + b.rental + b.helpers + b.equipment + b.tolls + b.overhead);

export function bandFor(ratio: number, s: CostSettings): Band {
  if (ratio <= s.attention_threshold_pct / 100) return 'good';
  if (ratio <= 1) return 'attention';
  return 'loss';
}

export function budgetFor(invoiceValue: number, charge: number, s: CostSettings) {
  return round3(Math.max(0, charge) + (Math.max(0, invoiceValue) * s.allowed_cost_pct) / 100);
}

export function bandFromNumbers(cost: number, invoiceValue: number, charge: number, s: CostSettings): Band {
  const budget = budgetFor(invoiceValue, charge, s);
  const ratio = budget > 0 ? cost / budget : cost > 0 ? Infinity : 0;
  return bandFor(ratio, s);
}

// ------------------------------------------------------------------ the full quote

export interface QuoteLine {
  key: keyof CostBreakdown;
  label: string;
  /** The sum, written out with the real numbers */
  detail: string;
  amount: number;
}

export interface Quote {
  straight_km: number;
  road_factor: number;
  one_way_km: number;
  distance_km: number; // round trip
  drive_minutes: number;
  service_minutes: number;
  wait_minutes: number;
  minutes: number;
  rental_days: number;
  fuel_price: number;
  fuel_source: string;
  breakdown: CostBreakdown;
  lines: QuoteLine[];
  cost: number;
  charge: number;
  invoice_value: number;
  invoice_allowance: number;
  budget: number;
  /** budget minus cost: positive means the delivery pays for itself */
  margin: number;
  ratio: number;
  band: Band;
  /** Smallest delivery charge that covers the cost, given the invoice allowance */
  break_even_charge: number;
  /** Furthest one-way distance this budget pays for (null = no limit) */
  max_one_way_km: number | null;
}

export interface QuoteInput {
  from: LatLng;
  to: LatLng;
  vehicle?: CostVehicle;
  settings: CostSettings;
  invoiceValue: number;
  deliveryCharge: number;
  extras?: Extras;
  /** delivery date, for the fuel price that applies */
  date?: string;
}

export function quoteDelivery(a: QuoteInput): Quote {
  const s = a.settings;
  const x = a.extras ?? NO_EXTRAS;
  const car = a.vehicle ?? REFERENCE_VEHICLE;
  const cur = currencyOf(s).code;
  const m = (v: number) => formatMoney(v, s);
  const straight = haversineKm(a.from, a.to);
  const oneWay = roadKm(a.from, a.to, s.road_factor);
  const distance = oneWay * 2;
  const drive = driveMinutes(distance, s);
  const wait = Math.max(0, x.wait_minutes || 0);
  const mins = drive + s.service_minutes_per_stop + wait;
  const fuel = fuelPriceFor(s, car.fuel_type ?? 'diesel', a.date);
  const b = runningCost(distance, mins, car, s, 1, a.date);
  Object.assign(b, extrasCost(x, s));
  const cost = sumBreakdown(b);
  const days = rentalDays(mins, s);
  const perMin = driverCostPerMinute(s);

  const lines: QuoteLine[] = [
    { key: 'fuel', label: 'Fuel', detail: `${n1(distance)} km × ${n1(car.fuel_use)} L per 100 km × ${n3(fuel.price)} ${cur} per litre (${fuel.source})`, amount: b.fuel },
    { key: 'vehicle', label: 'Wear and maintenance', detail: `${n1(distance)} km × ${n3(car.maintenance_per_km)} ${cur} per km`, amount: b.vehicle },
    {
      key: 'driver',
      label: 'Driver time',
      detail: `${Math.round(mins)} min${wait ? ` (incl. ${Math.round(wait)} min waiting)` : ''} × ${n3(perMin)} ${cur} per minute (salary, housing, visa, insurance and gratuity ÷ working minutes)`,
      amount: b.driver,
    },
  ];
  if (car.ownership === 'rented') lines.push({ key: 'rental', label: 'Vehicle hire', detail: `${days} ${days === 1 ? 'day' : 'days'} × ${n3(car.rental_per_day)} ${cur} per day`, amount: b.rental });
  if (b.helpers) lines.push({ key: 'helpers', label: 'Helpers', detail: `${x.helpers} × ${m(s.helper_cost_per_job)} per job`, amount: b.helpers });
  if (b.equipment) lines.push({ key: 'equipment', label: x.equipment === 'crane' ? 'Crane truck (HIAB)' : 'Forklift', detail: `Hire for this job`, amount: b.equipment });
  if (b.tolls) lines.push({ key: 'tolls', label: 'Road tolls', detail: `Toll gates there and back, set on the area`, amount: b.tolls });
  lines.push({ key: 'overhead', label: 'Loading and paperwork', detail: `Fixed ${m(s.overhead_per_delivery)} per delivery`, amount: b.overhead });

  const allowance = round3((Math.max(0, a.invoiceValue) * s.allowed_cost_pct) / 100);
  const budget = round3(Math.max(0, a.deliveryCharge) + allowance);
  const ratio = budget > 0 ? cost / budget : cost > 0 ? Infinity : 0;

  const perKm = 2 * ((car.fuel_use / 100) * fuel.price + car.maintenance_per_km + driveMinutes(1, s) * perMin);
  const fixed = b.rental + b.helpers + b.equipment + b.tolls + b.overhead + (s.service_minutes_per_stop + wait) * perMin;
  const maxOneWay = perKm > 0 && budget > fixed ? (budget - fixed) / perKm : budget > 0 ? null : 0;

  return {
    straight_km: Math.round(straight * 10) / 10,
    road_factor: s.road_factor,
    one_way_km: Math.round(oneWay * 10) / 10,
    distance_km: Math.round(distance * 10) / 10,
    drive_minutes: Math.round(drive),
    service_minutes: s.service_minutes_per_stop,
    wait_minutes: Math.round(wait),
    minutes: Math.round(mins),
    rental_days: car.ownership === 'rented' ? days : 0,
    fuel_price: fuel.price,
    fuel_source: fuel.source,
    breakdown: b,
    lines,
    cost,
    charge: Math.max(0, a.deliveryCharge),
    invoice_value: Math.max(0, a.invoiceValue),
    invoice_allowance: allowance,
    budget,
    margin: round3(budget - cost),
    ratio,
    band: bandFor(ratio, s),
    break_even_charge: round3(Math.max(0, cost - allowance)),
    max_one_way_km: maxOneWay == null ? null : Math.max(0, Math.round(maxOneWay * 10) / 10),
  };
}

// ------------------------------------------------------------------ choosing a vehicle

export interface VehicleOption<V extends VehicleSpec = Vehicle> {
  vehicle: V;
  fit: ReturnType<typeof fits>;
  quote: Quote;
}

/**
 * Every active vehicle (own, or hired when needed) costed for this one job.
 * Vehicles that carry the load come first, cheapest first; the rest follow so
 * staff can see why they were left out.
 */
export function rankVehicles<V extends VehicleSpec & { active: boolean }>(
  vehicles: V[],
  a: { from: LatLng; to: LatLng; load: Load; settings: CostSettings; invoiceValue: number; deliveryCharge: number; extras?: Extras; date?: string },
): VehicleOption<V>[] {
  return vehicles
    .filter((v) => v.active)
    .map((vehicle) => ({
      vehicle,
      fit: fits(vehicle, a.load),
      quote: quoteDelivery({ from: a.from, to: a.to, vehicle, settings: a.settings, invoiceValue: a.invoiceValue, deliveryCharge: a.deliveryCharge, extras: a.extras, date: a.date }),
    }))
    .sort((x, y) => Number(y.fit.ok) - Number(x.fit.ok) || x.quote.cost - y.quote.cost || x.vehicle.capacity_kg - y.vehicle.capacity_kg);
}

/** Cheapest own vehicle that fits against the cheapest hire that fits. */
export function ownVsHire<V extends VehicleSpec & { active: boolean }>(options: VehicleOption<V>[]) {
  const own = options.find((o) => o.fit.ok && o.vehicle.ownership === 'owned');
  const hire = options.find((o) => o.fit.ok && o.vehicle.ownership === 'rented');
  const saving = own && hire ? round3(hire.quote.cost - own.quote.cost) : null;
  return { own, hire, saving, best: own && hire ? (own.quote.cost <= hire.quote.cost ? 'own' : 'hire') : own ? 'own' : hire ? 'hire' : 'none' } as const;
}

/** Trip cost shared across stops by each stop's direct distance from the start. */
export function allocateTripCost(tripKm: number, tripMinutes: number, start: LatLng, stops: LatLng[], v: CostVehicle | undefined, s: CostSettings, date?: string) {
  const total = sumBreakdown(runningCost(tripKm, tripMinutes, v, s, stops.length, date));
  const w = stops.map((p) => Math.max(0.5, roadKm(start, p, s.road_factor)));
  const sum = w.reduce((x, y) => x + y, 0) || 1;
  return { total, shares: w.map((x) => round3((total * x) / sum)) };
}
