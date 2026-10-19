import type { Vehicle } from './types.ts';

/** Hire-when-needed vehicles may belong to every shop (shop_id "*"). */
export const ALL_SHOPS = '*';

export const vehicleInShop = (v: Pick<Vehicle, 'shop_id'>, shopId: string) => v.shop_id === shopId || v.shop_id === ALL_SHOPS;

/** How staff see a vehicle: "9012 SN · Pickup", or "Rent a Truck 10t" for one hired when needed. */
export function vehicleLabel(v: Pick<Vehicle, 'plate' | 'type' | 'ownership'>) {
  if (v.plate) return `${v.plate} · ${v.type}${v.ownership === 'rented' ? ' (hired)' : ''}`;
  return `Hire a ${v.type}`;
}
