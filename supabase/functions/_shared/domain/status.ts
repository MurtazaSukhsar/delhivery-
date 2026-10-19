import type { DeliveryStatus } from './types.ts';

/** Legal status moves. Enforced by the API; the UI only uses it to hide buttons. */
export const TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  unassigned: ['assigned', 'cancelled'],
  assigned: ['accepted', 'unassigned', 'assigned', 'cancelled'],
  accepted: ['picked_up', 'unassigned', 'assigned', 'cancelled'],
  picked_up: ['arrived', 'failed'],
  arrived: ['delivered', 'failed'],
  delivered: [],
  failed: ['unassigned'],
  cancelled: [],
};

export const canMove = (from: DeliveryStatus, to: DeliveryStatus) => TRANSITIONS[from]?.includes(to) ?? false;

export const ACTIVE: DeliveryStatus[] = ['assigned', 'accepted', 'picked_up', 'arrived'];
export const isReassignable = (s: DeliveryStatus) => s === 'unassigned' || s === 'assigned' || s === 'accepted';
