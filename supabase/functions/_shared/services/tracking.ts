import { type Deps, ApiError, bad, orgBook, platformBook, readSettings, str, fileUrls } from '../core.ts';
import { currencyOf } from '../domain/cost.ts';
import type { Delivery, Organization, Staff, Vehicle } from '../domain/types.ts';

const notValid = () => new ApiError(404, 'This tracking link is not valid.');

async function open(deps: Deps, token: string) {
  const t = str(token, 200);
  const orgId = t.split('.')[0];
  if (!orgId || !t.includes('.')) throw notValid();
  const pb = platformBook(deps);
  await pb.load('organizations');
  const org = pb.get<Organization>('organizations', orgId);
  if (!org || org.status !== 'active') throw notValid();
  const book = orgBook(deps, org.sheet_id);
  await book.load('settings', 'deliveries', 'staff', 'vehicles');
  const d = book.all<Delivery>('deliveries').find((x) => x.tracking_token === t);
  if (!d) throw notValid();
  return { book, d, orgId };
}

/** Public: the customer sees only their own delivery, and only what they need. */
export async function track(deps: Deps, token: string) {
  const { book, d, orgId } = await open(deps, token);
  const s = readSettings(book);
  const delivered = d.status === 'delivered';
  const [signature] = delivered ? await fileUrls(deps, orgId, [d.pod_signature]) : [];
  const photos = delivered ? await fileUrls(deps, orgId, (d.pod_photos || '').split(',').filter(Boolean).slice(0, 2)) : [];
  const driver = book.get<Staff>('staff', d.driver_id);
  const vehicle = book.get<Vehicle>('vehicles', d.vehicle_id);
  return {
    company: { name: s.company_name, name_ar: s.company_name_ar, logo_url: /^https:\/\//.test(s.logo_url) ? s.logo_url : '', phone: s.phone, time_zone: s.time_zone, currency: currencyOf(s) },
    delivery: {
      ref: d.ref,
      doc_kind: d.doc_kind,
      doc_number: d.doc_number,
      status: d.status,
      date: d.date,
      timing: d.timing,
      window_from: d.window_from,
      window_to: d.window_to,
      eta: ['assigned', 'accepted', 'picked_up', 'arrived'].includes(d.status) ? d.eta : '',
      delivered_at: d.delivered_at,
      receiver_name: d.status === 'delivered' ? d.receiver_name : '',
      to_pay: (d.collect_type === 'cash' || d.collect_type === 'cheque') && d.status !== 'delivered' ? d.collect_amount : 0,
      driver_first_name: driver ? driver.name.split(' ')[0] : '',
      vehicle_plate: vehicle?.plate ?? '',
      rated: d.rating != null,
      pod: delivered ? { signature: signature ?? '', photos } : null,
    },
  };
}

export async function rate(deps: Deps, token: string, body: Record<string, unknown>) {
  const { book, d } = await open(deps, token);
  if (d.status !== 'delivered') throw bad('You can rate the delivery once it has arrived.');
  if (d.rating != null) return { ok: true };
  const stars = Math.round(Number(body.stars));
  if (!(stars >= 1 && stars <= 5)) throw bad('Choose from 1 to 5 stars.');
  book.update<Delivery>('deliveries', d.id, { rating: stars, rating_comment: str(body.comment, 500) });
  await book.commit();
  return { ok: true };
}
