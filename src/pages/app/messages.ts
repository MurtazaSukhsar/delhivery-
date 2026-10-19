import type { Delivery, OrgSettings } from '../../lib/domain';
import { dateLabel, timeIn } from '../../lib/format';

export const trackingUrl = (d: Delivery) => `${window.location.origin}/track/${encodeURIComponent(d.tracking_token)}`;

export function templateFor(d: Delivery, s: OrgSettings) {
  if (d.status === 'delivered') return s.whatsapp_delivered;
  if (d.status === 'picked_up' || d.status === 'arrived') return s.whatsapp_on_the_way;
  return s.whatsapp_assigned;
}

export function fillTemplate(tpl: string, d: Delivery, v: { customer: string; driver: string; tz: string }) {
  const vars: Record<string, string> = {
    customer: v.customer || 'customer',
    document: `${d.doc_kind} ${d.doc_number}`,
    date: dateLabel(d.date),
    driver: v.driver || 'our driver',
    eta: d.eta ? timeIn(d.eta, v.tz) : 'today',
    time: d.delivered_at ? timeIn(d.delivered_at, v.tz) : '',
    link: trackingUrl(d),
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export const whatsappLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
