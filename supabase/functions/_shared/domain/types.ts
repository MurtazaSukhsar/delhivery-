import type { FuelType } from './gcc.ts';

// Entities as the API returns them. Rows in Google Sheets map 1:1 onto these
// (column names are the snake_case keys; see sheets/schema.ts).

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Roles inside an organisation. `super_admin` is the platform owner (Farwings) and sits above all organisations.
 * - org_admin: the client's owner or manager. Sets costs, vehicles, shops and team.
 * - staff: office people who create, assign and track deliveries.
 * - driver: uses the driver pages on a phone.
 */
export type Role = 'org_admin' | 'staff' | 'driver';
export type PlatformRole = Role | 'super_admin';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  sheet_id: string;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface Shop extends LatLng {
  id: string;
  name: string;
  kind: 'shop' | 'warehouse';
  address: string;
  phone: string;
  /** City for truck-ban rules; empty = the organisation's city */
  city: string;
  active: boolean;
  created_at: string;
}

export interface Staff {
  id: string; // Supabase auth user id
  name: string;
  email: string;
  phone: string;
  role: Role;
  /** '*' for every shop, otherwise comma-separated shop ids */
  shop_ids: string;
  active: boolean;
  licence_expiry: string;
  on_shift: boolean;
  shift_started_at: string;
  created_at: string;
}

export interface Area extends LatLng {
  id: string;
  name: string;
  default_charge: number;
  /** Road tolls for a round trip to this area (e.g. Salik, Darb) */
  toll_per_trip: number;
  note: string;
}

export interface Customer {
  id: string;
  name: string;
  contact_name: string;
  phone: string;
  created_at: string;
  created_by: string;
}

export interface Address extends LatLng {
  id: string;
  customer_id: string;
  label: string;
  line: string;
  area_id: string;
}

export interface Vehicle {
  id: string;
  shop_id: string;
  plate: string;
  type: string;
  make: string;
  ownership: 'owned' | 'rented';
  capacity_kg: number;
  /** Cargo space in cubic metres. 0 means not set, so only weight is checked. */
  capacity_cbm: number;
  fuel_type: FuelType;
  fuel_use: number; // L/100 km
  maintenance_per_km: number; // OMR/km
  /** Hire price per day. Used only when ownership is 'rented'. */
  rental_per_day: number; // OMR/day
  active: boolean;
}

export type DocumentType = 'registration' | 'insurance' | 'permit' | 'inspection' | 'other';

export interface VehicleDocument {
  id: string;
  vehicle_id: string;
  type: DocumentType;
  number: string;
  expiry: string;
  deleted: boolean;
}

export type DeliveryStatus = 'unassigned' | 'assigned' | 'accepted' | 'picked_up' | 'arrived' | 'delivered' | 'failed' | 'cancelled';
export type CollectType = 'none' | 'cash' | 'cheque' | 'documents';
export type Equipment = 'none' | 'crane' | 'forklift';

export interface OrderLine {
  /** description */
  d: string;
  /** quantity */
  q: number;
  /** unit, e.g. bags, pcs, m */
  u: string;
}

/** What happened to one order line at the drop, in the same order as the order lines. */
export interface PodLine {
  delivered: number;
  damaged: number;
  returned: number;
  note?: string;
}

export type PaymentMethod = 'cash' | 'cheque' | 'transfer';
export type PaymentStatus = 'with_driver' | 'handed_in' | 'deposited' | 'cleared' | 'bounced' | 'to_verify';

/** Money collected at a drop: cash, a cheque (possibly post-dated) or a bank transfer the customer says they made. */
export interface Payment {
  id: string;
  delivery_id: string;
  customer_id: string;
  shop_id: string;
  driver_id: string;
  method: PaymentMethod;
  amount: number;
  cheque_no: string;
  bank: string;
  cheque_date: string;
  photo: string;
  status: PaymentStatus;
  collected_at: string;
  settlement_id: string;
  note: string;
  updated_at: string;
}

/** A driver handing in the day's cash and cheques at the office. */
export interface Settlement {
  id: string;
  driver_id: string;
  shop_id: string;
  at: string;
  by: string;
  payment_ids: string;
  expected: number;
  counted: number;
  variance: number;
  note: string;
}

export type VehicleCostKind = 'fuel' | 'maintenance' | 'tyres' | 'fine' | 'toll' | 'other';

/** Money actually spent on a vehicle, to compare with the estimate. */
export interface VehicleCost {
  id: string;
  vehicle_id: string;
  date: string;
  kind: VehicleCostKind;
  amount: number;
  litres: number | null;
  odometer: number | null;
  note: string;
  created_by: string;
  created_at: string;
  deleted: boolean;
}

export interface Delivery {
  id: string;
  ref: string;
  shop_id: string;
  doc_kind: 'DO' | 'Invoice';
  doc_number: string;
  invoice_value: number;
  delivery_charge: number;
  customer_id: string;
  address_id: string;
  date: string;
  timing: 'flexible' | 'window';
  window_from: string;
  window_to: string;
  urgent: boolean;
  collect_type: CollectType;
  collect_amount: number;
  collect_note: string;
  collected_amount: number | null;
  collected_note: string;
  weight_kg: number;
  volume_cbm: number;
  /** Helpers sent with the driver to load and unload */
  helpers: number;
  /** Lifting equipment needed at the site */
  equipment: Equipment;
  /** Expected waiting time at the site, in minutes */
  wait_minutes: number;
  /** Order lines as JSON: OrderLine[] (optional) */
  lines: string;
  notes: string;
  /** Vehicle chosen on the cost screen when the delivery was created; the default when assigning. */
  plan_vehicle_id: string;
  status: DeliveryStatus;
  driver_id: string;
  vehicle_id: string;
  trip_id: string;
  decline_reason: string;
  fail_reason: string;
  receiver_name: string;
  delivered_at: string;
  /** Proof of delivery: PodLine[] as JSON, photo and signature file keys, note, and whether anything was wrong */
  pod_lines: string;
  pod_photos: string;
  pod_signature: string;
  pod_note: string;
  pod_issue: boolean;
  eta: string;
  est_distance_km: number;
  est_minutes: number;
  est_cost: number;
  trip_cost: number | null;
  rating: number | null;
  rating_comment: string;
  tracking_token: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DeliveryEvent {
  id: string;
  delivery_id: string;
  at: string;
  status: DeliveryStatus;
  by: string;
  reason: string;
  offline: boolean;
  client_id: string;
}

export interface Trip {
  id: string;
  shop_id: string;
  date: string;
  driver_id: string;
  vehicle_id: string;
  /** delivery ids in driving order, comma-separated */
  stop_ids: string;
  distance_km: number;
  naive_distance_km: number;
  minutes: number;
  naive_minutes: number;
  cost: number;
  created_by: string;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  user_id: string;
  user_name: string;
  role: string;
  shop_id: string;
  action: string;
  entity: string;
  entity_id: string;
  details: string;
}

export interface CostSettings {
  /** GCC country code (OM, AE, SA, QA, KW, BH); sets currency, fuel prices and work-ban rules */
  country: string;
  /** City for truck-ban rules */
  city: string;
  /** Use the GCC fuel price table (plus your own prices) instead of one fixed price */
  fuel_auto: boolean;
  fuel_price_per_litre: number;
  /** Your own fuel prices: JSON list of { country, fuel, price, from, source } */
  fuel_prices_json: string;
  driver_monthly_salary: number;
  driver_housing_monthly: number;
  /** Visa, permit and medical for one driver, spread over its validity */
  driver_visa_cost: number;
  driver_visa_months: number;
  driver_insurance_yearly: number;
  /** End-of-service gratuity, in days of basic salary per year worked */
  gratuity_days_per_year: number;
  helper_cost_per_job: number;
  crane_cost_per_job: number;
  forklift_cost_per_job: number;
  working_days_per_month: number;
  working_hours_per_day: number;
  overhead_per_delivery: number;
  average_speed_kmh: number;
  traffic_factor: number;
  service_minutes_per_stop: number;
  road_factor: number;
  allowed_cost_pct: number;
  attention_threshold_pct: number;
  // Delivery-fee price list
  fee_base: number;
  fee_per_km: number;
  fee_per_100kg: number;
  fee_per_cbm: number;
  fee_min: number;
  /** Free delivery when the invoice is at least this much (0 = never) */
  fee_free_over: number;
  fee_helper: number;
  fee_crane: number;
  fee_forklift: number;
  fee_free_wait_minutes: number;
  fee_wait_per_hour: number;
  /** Margin to add when suggesting a charge from the cost */
  fee_target_margin_pct: number;
}

export interface BusinessSettings {
  company_name: string;
  company_name_ar: string;
  /** https link to the company logo, shown on the customer tracking page */
  logo_url: string;
  phone: string;
  email: string;
  address: string;
  time_zone: string;
  whatsapp_assigned: string;
  whatsapp_on_the_way: string;
  whatsapp_delivered: string;
  sms_enabled: boolean;
}

export type OrgSettings = CostSettings & BusinessSettings;

export const DEFAULT_SETTINGS: OrgSettings = {
  country: 'OM',
  city: 'Muscat',
  fuel_auto: true,
  fuel_price_per_litre: 0.239,
  fuel_prices_json: '',
  driver_monthly_salary: 325,
  driver_housing_monthly: 60,
  driver_visa_cost: 300,
  driver_visa_months: 24,
  driver_insurance_yearly: 120,
  gratuity_days_per_year: 21,
  helper_cost_per_job: 4,
  crane_cost_per_job: 25,
  forklift_cost_per_job: 18,
  working_days_per_month: 26,
  working_hours_per_day: 9,
  overhead_per_delivery: 0.4,
  average_speed_kmh: 45,
  traffic_factor: 1.2,
  service_minutes_per_stop: 20,
  road_factor: 1.3,
  allowed_cost_pct: 3,
  attention_threshold_pct: 80,
  fee_base: 2,
  fee_per_km: 0.12,
  fee_per_100kg: 0.25,
  fee_per_cbm: 0.2,
  fee_min: 3,
  fee_free_over: 0,
  fee_helper: 6,
  fee_crane: 35,
  fee_forklift: 25,
  fee_free_wait_minutes: 45,
  fee_wait_per_hour: 5,
  fee_target_margin_pct: 20,
  company_name: '',
  company_name_ar: '',
  logo_url: '',
  phone: '',
  email: '',
  address: '',
  time_zone: 'Asia/Muscat',
  whatsapp_assigned: 'Hello {customer}, your order {document} is scheduled for delivery on {date}. Track it here: {link}',
  whatsapp_on_the_way: 'Hello {customer}, {driver} is on the way with your order {document}. Estimated arrival {eta}. Track: {link}',
  whatsapp_delivered: 'Your order {document} was delivered at {time}. Thank you. Rate us: {link}',
  sms_enabled: false,
};

/** Driver offline-sync update. */
export interface DriverUpdate {
  client_id: string;
  delivery_id: string;
  action: 'accept' | 'decline' | 'pickup' | 'arrive' | 'deliver' | 'fail';
  at: string;
  reason?: string;
  receiver_name?: string;
  collected_amount?: number;
  collected_note?: string;
  /** Proof of delivery (deliver action) */
  pod_lines?: PodLine[];
  pod_note?: string;
  /** Photos and signature as data URLs (image/jpeg or image/png) */
  photos?: string[];
  signature?: string;
  payment?: { method: PaymentMethod; amount: number; cheque_no?: string; bank?: string; cheque_date?: string; photo?: string };
}

/** One row of the platform error log, shown to the platform admin. */
export interface ErrorLogEntry {
  id: string;
  at: string;
  source: 'api' | 'browser';
  org_id: string;
  user_name: string;
  role: string;
  where: string;
  status: number;
  message: string;
  detail: string;
  resolved: boolean;
}
