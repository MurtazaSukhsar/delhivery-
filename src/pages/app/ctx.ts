import { useMemo } from 'react';
import { useCustomers, useDrivers, useMe, useShop } from '../../lib/queries';
import { dateInZone, DEFAULT_SETTINGS, bandFromNumbers, type Delivery, type OrgSettings, type Band, can } from '../../lib/domain';
import { timeIn } from '../../lib/format';

/** Things almost every console page needs. */
export function useOrg() {
  const me = useMe();
  const shop = useShop();
  const settings: OrgSettings = me.data?.settings ?? DEFAULT_SETTINGS;
  const tz = settings.time_zone || 'Asia/Muscat';
  const shops = me.data?.shops ?? [];
  return {
    me: me.data,
    role: me.data?.user.role,
    settings,
    tz,
    shops,
    shop,
    today: dateInZone(tz),
    shopName: (id: string) => shops.find((s) => s.id === id)?.name ?? '',
    /** shop id to create things in: the selected shop, or the only/first one */
    defaultShop: shop !== 'all' ? shop : shops[0]?.id ?? '',
  };
}

export function useNames() {
  const { role } = useOrg();
  const customers = useCustomers();
  const drivers = useDrivers(!!role && can(role, 'deliveries.view'));
  return useMemo(() => {
    const c = new Map((customers.data ?? []).map((x) => [x.id, x]));
    const a = new Map((customers.data ?? []).flatMap((x) => x.addresses.map((ad) => [ad.id, ad] as const)));
    const d = new Map((drivers.data ?? []).map((x) => [x.id, x]));
    return {
      customer: (id: string) => c.get(id),
      address: (id: string) => a.get(id),
      driver: (id: string) => d.get(id),
      drivers: drivers.data ?? [],
      customers: customers.data ?? [],
      loading: customers.isLoading,
    };
  }, [customers.data, drivers.data, customers.isLoading]);
}

/** Cost to judge a delivery by: its share of the trip once planned, else the standalone estimate. */
export const costOf = (d: Delivery) => d.trip_cost ?? d.est_cost;
export const bandOf = (d: Delivery, s: OrgSettings): Band => bandFromNumbers(costOf(d), d.invoice_value, d.delivery_charge, s);

/** Why a dispatcher should look at this delivery now (or null). */
export function problemOf(d: Delivery, tz: string, today: string): string | null {
  if (d.status === 'failed') return d.fail_reason ? `Failed: ${d.fail_reason}` : 'Failed';
  if (d.status === 'unassigned' && d.decline_reason) return `Declined: ${d.decline_reason}`;
  if (d.timing === 'window' && d.window_to && d.eta && ['assigned', 'accepted', 'picked_up'].includes(d.status) && d.date === today) {
    if (timeIn(d.eta, tz) > d.window_to) return 'Expected after the customer’s time window';
  }
  if (d.status === 'unassigned' && d.date === today && d.urgent) return 'Urgent and no driver yet';
  return null;
}
