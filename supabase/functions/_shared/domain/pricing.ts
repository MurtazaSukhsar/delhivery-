import type { CostSettings, Equipment } from './types.ts';
import { formatMoney } from './cost.ts';
import { round3 } from './format.ts';

/**
 * The delivery fee a customer should be charged: from the company's price list,
 * and from the cost plus a target margin. Staff see both and pick one.
 */

export interface FeeInput {
  one_way_km: number;
  weight_kg: number;
  volume_cbm: number;
  invoice_value: number;
  helpers: number;
  equipment: Equipment;
  wait_minutes: number;
}

export interface FeeLine {
  label: string;
  detail: string;
  amount: number;
}

export interface FeeQuote {
  lines: FeeLine[];
  /** after the minimum and the free-delivery rule */
  total: number;
  free: boolean;
  minimum_applied: boolean;
}

export function feeByPriceList(s: CostSettings, i: FeeInput): FeeQuote {
  const m = (v: number) => formatMoney(v, s);
  const lines: FeeLine[] = [];
  const push = (label: string, detail: string, amount: number) => amount > 0 && lines.push({ label, detail, amount: round3(amount) });
  push('Base fee', 'Every delivery', s.fee_base);
  push('Distance', `${i.one_way_km.toFixed(1)} km × ${m(s.fee_per_km)} per km`, i.one_way_km * s.fee_per_km);
  push('Weight', `${Math.round(i.weight_kg).toLocaleString()} kg × ${m(s.fee_per_100kg)} per 100 kg`, (i.weight_kg / 100) * s.fee_per_100kg);
  push('Volume', `${i.volume_cbm} cbm × ${m(s.fee_per_cbm)} per cbm`, i.volume_cbm * s.fee_per_cbm);
  push('Helpers', `${i.helpers} × ${m(s.fee_helper)}`, i.helpers * s.fee_helper);
  if (i.equipment === 'crane') push('Crane truck (HIAB)', 'Lifting at site', s.fee_crane);
  if (i.equipment === 'forklift') push('Forklift', 'Lifting at site', s.fee_forklift);
  const paidWait = Math.max(0, i.wait_minutes - s.fee_free_wait_minutes);
  push('Waiting', `${paidWait} min beyond ${s.fee_free_wait_minutes} free × ${m(s.fee_wait_per_hour)} per hour`, (paidWait / 60) * s.fee_wait_per_hour);
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  const minimum_applied = sum < s.fee_min;
  let total = Math.max(sum, s.fee_min);
  const free = s.fee_free_over > 0 && i.invoice_value >= s.fee_free_over;
  if (free) total = 0;
  return { lines, total: round3(total), free, minimum_applied };
}

/** Charge that covers the cost plus the target margin, after the share of the invoice the company accepts. */
export function feeForMargin(cost: number, invoiceAllowance: number, s: CostSettings) {
  return round3(Math.max(0, cost * (1 + s.fee_target_margin_pct / 100) - invoiceAllowance));
}

/** A short text quote the office can paste into WhatsApp. */
export function quoteText(a: { s: CostSettings; company: string; customer: string; doc: string; fee: number; lines: FeeLine[]; free: boolean; date: string }) {
  const m = (v: number) => formatMoney(v, a.s);
  const rows = a.lines.map((l) => `• ${l.label}: ${m(l.amount)}`).join('\n');
  return [
    `${a.company}: delivery quote${a.doc ? ` for ${a.doc}` : ''}`,
    `Customer: ${a.customer}`,
    `Date: ${a.date}`,
    '',
    a.free ? 'Delivery is free for this order.' : rows,
    a.free ? '' : `Delivery charge: ${m(a.fee)}`,
  ]
    .filter((x) => x !== '')
    .join('\n');
}
