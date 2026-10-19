import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { get, ApiFailure } from './api';
import { toast } from './toast';
import type { ActivityEntry, Address, Area, Customer, Delivery, DeliveryEvent, ErrorLogEntry, Organization, Payment, Settlement, VehicleCost, OrgSettings, PlatformRole, Shop, Staff, Trip, Vehicle, VehicleDocument } from './domain';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Google Sheets allows ~60 reads a minute for the whole app, so data is
      // kept for 30 s before a screen asks again.
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiFailure && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

// ------------------------------------------------------------------ types
export interface Me {
  user: { id: string; name: string; email: string; phone?: string; role: PlatformRole; shop_ids?: string; on_shift?: boolean; shift_started_at?: string };
  org: { id: string; name: string } | null;
  shops: Shop[];
  settings: OrgSettings | null;
}
export type CustomerWithAddresses = Customer & { addresses: Address[] };
export type VehicleWithDocs = Vehicle & { documents: VehicleDocument[] };
export interface DriverLite {
  id: string;
  name: string;
  phone: string;
  shop_ids: string;
  active: boolean;
  on_shift: boolean;
  shift_started_at: string;
  licence_expiry: string;
}
export interface DeliveriesResult {
  from: string;
  to: string;
  today: string;
  deliveries: Delivery[];
  trips: Trip[];
}

// ------------------------------------------------------------------ current shop
const SHOP_KEY = 'dp-shop';
let shop = (() => {
  try {
    return localStorage.getItem(SHOP_KEY) ?? 'all';
  } catch {
    return 'all';
  }
})();
const shopListeners = new Set<() => void>();
export function setShop(id: string) {
  shop = id;
  try {
    localStorage.setItem(SHOP_KEY, id);
  } catch {
    /* ignore */
  }
  shopListeners.forEach((l) => l());
}
/** Selected shop id, or "all". */
export function useShop() {
  return useSyncExternalStore(
    (l) => (shopListeners.add(l), () => shopListeners.delete(l)),
    () => shop,
  );
}

// ------------------------------------------------------------------ reads
export const useMe = (enabled = true) => useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/me'), enabled, staleTime: 60_000 });
export const useShops = () => useQuery({ queryKey: ['shops'], queryFn: () => get<Shop[]>('/shops') });
export const useStaff = (enabled = true) => useQuery({ queryKey: ['staff'], queryFn: () => get<Staff[]>('/staff'), enabled });
export const useDrivers = (enabled = true) => useQuery({ queryKey: ['drivers'], queryFn: () => get<DriverLite[]>('/drivers'), enabled });
export const useAreas = () => useQuery({ queryKey: ['areas'], queryFn: () => get<Area[]>('/areas') });
export const useCustomers = () => useQuery({ queryKey: ['customers'], queryFn: () => get<CustomerWithAddresses[]>('/customers') });
export const useVehicles = (shopId: string, enabled = true) => useQuery({ queryKey: ['vehicles', shopId], queryFn: () => get<VehicleWithDocs[]>(`/vehicles?shop=${shopId}`), enabled });
export const usePlanningVehicles = (shopId: string, enabled = true) => useQuery({ queryKey: ['vehicles-planning', shopId], queryFn: () => get<Vehicle[]>(`/vehicles/planning?shop=${shopId}`), enabled });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/settings') });
export const useActivity = (enabled = true) => useQuery({ queryKey: ['activity'], queryFn: () => get<ActivityEntry[]>('/activity?limit=400'), enabled });
export const useDeliveries = (p: { shop: string; from?: string; to?: string; refetch?: number }) =>
  useQuery({
    queryKey: ['deliveries', p.shop, p.from ?? '', p.to ?? ''],
    queryFn: () => get<DeliveriesResult>(`/deliveries?shop=${p.shop}${p.from ? `&from=${p.from}` : ''}${p.to ? `&to=${p.to}` : ''}`),
    refetchInterval: p.refetch,
  });
export interface DeliveryFull {
  delivery: Delivery;
  events: DeliveryEvent[];
  trip: Trip | null;
  payments: Payment[];
  pod: { photos: string[]; signature: string; cheque_photos: string[] };
}
export const useDelivery = (id: string) => useQuery({ queryKey: ['delivery', id], enabled: !!id, queryFn: () => get<DeliveryFull>(`/deliveries/${id}`) });
export const usePlatformOrgs = () => useQuery({ queryKey: ['platform-orgs'], queryFn: () => get<Organization[]>('/platform/orgs') });
export const usePlatformInfo = () => useQuery({ queryKey: ['platform-info'], queryFn: () => get<{ service_account_email: string; platform_sheet_id: string }>('/platform/info') });

// ------------------------------------------------------------------ writes
/** Run a write, show a toast, and refresh the given data. */
export function useAction<TArgs, TOut>(fn: (a: TArgs) => Promise<TOut>, opts: { success?: string | ((out: TOut) => string); invalidate?: string[] } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(out) : opts.success, 'success');
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Something went wrong.', 'error'),
  });
}

export interface OrgCheckResult {
  checked_at: string;
  service_account_email: string;
  results: { org_id: string; name: string; status: string; ok: boolean; problem: string; fixed: string[] }[];
}
export const usePlatformErrors = () => useQuery({ queryKey: ['platform-errors'], queryFn: () => get<ErrorLogEntry[]>('/platform/errors'), staleTime: 10_000 });

export type PaymentRow = Payment & { ref: string; doc: string; customer: string; driver: string; photo_url: string };
export const useCollections = (shop: string) => useQuery({ queryKey: ['collections', shop], queryFn: () => get<{ today: string; payments: PaymentRow[]; settlements: (Settlement & { driver: string })[] }>(`/collections?shop=${shop}`), staleTime: 15_000 });
export const useVehicleCosts = (vehicleId: string, enabled = true) => useQuery({ queryKey: ['vehicle-costs', vehicleId], enabled, queryFn: () => get<VehicleCost[]>(`/vehicle-costs?vehicle=${vehicleId}`) });

export type { ReportData } from '../pages/app/reportMath';
import type { ReportData } from '../pages/app/reportMath';
export const useReport = (shop: string, from: string, to: string) => useQuery({ queryKey: ['report', shop, from, to], queryFn: () => get<ReportData>(`/reports?shop=${shop}&from=${from}&to=${to}`) });
