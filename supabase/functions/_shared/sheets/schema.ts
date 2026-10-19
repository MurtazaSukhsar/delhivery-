// The spreadsheet layout. Row 1 of every tab holds these column names.
// Columns are found by name, so the client may reorder columns or add their
// own extra columns in the sheet without breaking anything.

export type ColType = 'string' | 'number' | 'boolean';
export type Columns = Record<string, ColType>;

const s = 'string' as const;
const n = 'number' as const;
const b = 'boolean' as const;

/** Tabs in the one platform spreadsheet (owned by the platform operator). */
export const PLATFORM_TABLES = {
  organizations: { id: s, name: s, slug: s, sheet_id: s, status: s, created_at: s, created_by: s },
  error_log: { id: s, at: s, source: s, org_id: s, user_name: s, role: s, where: s, status: n, message: s, detail: s, resolved: b },
} satisfies Record<string, Columns>;

/** Tabs in each organisation's own spreadsheet. */
export const ORG_TABLES = {
  settings: { key: s, value: s },
  shops: { id: s, name: s, kind: s, address: s, phone: s, lat: n, lng: n, active: b, created_at: s, city: s },
  staff: { id: s, name: s, email: s, phone: s, role: s, shop_ids: s, active: b, licence_expiry: s, on_shift: b, shift_started_at: s, created_at: s },
  areas: { id: s, name: s, default_charge: n, lat: n, lng: n, note: s, toll_per_trip: n },
  customers: { id: s, name: s, contact_name: s, phone: s, created_at: s, created_by: s },
  addresses: { id: s, customer_id: s, label: s, line: s, area_id: s, lat: n, lng: n },
  vehicles: { id: s, shop_id: s, plate: s, type: s, make: s, ownership: s, capacity_kg: n, capacity_cbm: n, fuel_use: n, maintenance_per_km: n, rental_per_day: n, active: b, fuel_type: s },
  vehicle_documents: { id: s, vehicle_id: s, type: s, number: s, expiry: s, deleted: b },
  deliveries: {
    id: s,
    ref: s,
    shop_id: s,
    doc_kind: s,
    doc_number: s,
    invoice_value: n,
    delivery_charge: n,
    customer_id: s,
    address_id: s,
    date: s,
    timing: s,
    window_from: s,
    window_to: s,
    urgent: b,
    collect_type: s,
    collect_amount: n,
    collect_note: s,
    collected_amount: n,
    collected_note: s,
    weight_kg: n,
    volume_cbm: n,
    notes: s,
    plan_vehicle_id: s,
    status: s,
    driver_id: s,
    vehicle_id: s,
    trip_id: s,
    decline_reason: s,
    fail_reason: s,
    receiver_name: s,
    delivered_at: s,
    eta: s,
    est_distance_km: n,
    est_minutes: n,
    est_cost: n,
    trip_cost: n,
    rating: n,
    rating_comment: s,
    tracking_token: s,
    created_by: s,
    created_at: s,
    updated_at: s,
    helpers: n,
    equipment: s,
    wait_minutes: n,
    lines: s,
    pod_lines: s,
    pod_photos: s,
    pod_signature: s,
    pod_note: s,
    pod_issue: b,
  },
  delivery_events: { id: s, delivery_id: s, at: s, status: s, by: s, reason: s, offline: b, client_id: s },
  trips: { id: s, shop_id: s, date: s, driver_id: s, vehicle_id: s, stop_ids: s, distance_km: n, naive_distance_km: n, minutes: n, naive_minutes: n, cost: n, created_by: s, created_at: s },
  activity_log: { id: s, at: s, user_id: s, user_name: s, role: s, shop_id: s, action: s, entity: s, entity_id: s, details: s },
  payments: { id: s, delivery_id: s, customer_id: s, shop_id: s, driver_id: s, method: s, amount: n, cheque_no: s, bank: s, cheque_date: s, photo: s, status: s, collected_at: s, settlement_id: s, note: s, updated_at: s },
  settlements: { id: s, driver_id: s, shop_id: s, at: s, by: s, payment_ids: s, expected: n, counted: n, variance: n, note: s },
  vehicle_costs: { id: s, vehicle_id: s, date: s, kind: s, amount: n, litres: n, odometer: n, note: s, created_by: s, created_at: s, deleted: b },
} satisfies Record<string, Columns>;

export type OrgTable = keyof typeof ORG_TABLES;
export type PlatformTable = keyof typeof PLATFORM_TABLES;
