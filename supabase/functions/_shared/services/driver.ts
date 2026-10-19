import { type Actor, type Deps, bad, forbidden, readSettings, logActivity, str, num, isDate, decodeImage, storeImage } from '../core.ts';
import { openOrg } from './admin.ts';
import { DELIVERY_TABS, addressOf, move, detach, updateEtas, parseLines } from './deliveries.ts';
import type { Customer, Delivery, DeliveryEvent, DriverUpdate, Payment, PaymentMethod, PodLine, Shop, Staff, Trip, Vehicle } from '../domain/types.ts';
import { dateInZone, nowISO, round3, uid } from '../domain/format.ts';
import { currencyOf } from '../domain/cost.ts';

function onlyDriver(a: Actor) {
  if (a.role !== 'driver') throw forbidden('Only driver accounts use the driver pages.');
}

/** Everything the driver's phone needs for today, in one request. */
export async function driverToday(deps: Deps, a: Actor) {
  onlyDriver(a);
  const book = await openOrg(deps, a, 'deliveries', 'trips', 'customers', 'addresses', 'staff', 'vehicles');
  const s = readSettings(book);
  const today = dateInZone(s.time_zone);
  const me = book.get<Staff>('staff', a.id);
  const trips = book
    .all<Trip>('trips')
    .filter((t) => t.driver_id === a.id && t.date === today && t.stop_ids)
    .sort((x, y) => x.created_at.localeCompare(y.created_at));
  const order = new Map<string, number>();
  trips.forEach((t, ti) => t.stop_ids.split(',').forEach((id, si) => order.set(id, ti * 1000 + si)));
  const deliveries = book
    .all<Delivery>('deliveries')
    .filter((d) => d.driver_id === a.id && d.date === today && !['unassigned', 'cancelled'].includes(d.status))
    .sort((x, y) => (order.get(x.id) ?? 1e6) - (order.get(y.id) ?? 1e6))
    .map((d) => {
      const c = book.get<Customer>('customers', d.customer_id);
      const adr = book.get(`addresses`, d.address_id) as { label: string; line: string; lat: number; lng: number } | undefined;
      const shop = book.get<Shop>('shops', d.shop_id);
      return {
        id: d.id,
        ref: d.ref,
        status: d.status,
        doc_kind: d.doc_kind,
        doc_number: d.doc_number,
        timing: d.timing,
        window_from: d.window_from,
        window_to: d.window_to,
        urgent: d.urgent,
        eta: d.eta,
        weight_kg: d.weight_kg,
        volume_cbm: d.volume_cbm,
        notes: d.notes,
        collect_type: d.collect_type,
        collect_amount: d.collect_amount,
        collect_note: d.collect_note,
        lines: parseLines(d.lines),
        helpers: d.helpers || 0,
        equipment: d.equipment || 'none',
        trip_id: d.trip_id,
        customer: { name: c?.name ?? '', contact_name: c?.contact_name ?? '', phone: c?.phone ?? '' },
        address: adr ? { label: adr.label, line: adr.line, lat: adr.lat, lng: adr.lng } : null,
        pickup: shop ? { name: shop.name, lat: shop.lat, lng: shop.lng, address: shop.address } : null,
      };
    });
  const vehicleId = trips.find((t) => t.vehicle_id)?.vehicle_id ?? '';
  const vehicle = vehicleId ? book.get<Vehicle>('vehicles', vehicleId) : undefined;
  return {
    me: { id: a.id, name: me?.name ?? a.name, on_shift: !!me?.on_shift, shift_started_at: me?.shift_started_at ?? '' },
    today,
    time_zone: s.time_zone,
    company: s.company_name,
    currency: currencyOf(s),
    vehicle: vehicle ? { id: vehicle.id, plate: vehicle.plate || vehicle.type } : null,
    deliveries,
  };
}

export async function driverShift(deps: Deps, a: Actor, body: Record<string, unknown>) {
  onlyDriver(a);
  const book = await openOrg(deps, a, 'staff', 'deliveries', 'activity_log');
  const s = readSettings(book);
  const me = book.get<Staff>('staff', a.id);
  if (!me) throw bad('Your staff record is missing. Ask your administrator.');
  if (body.action === 'start') {
    book.update<Staff>('staff', a.id, { on_shift: true, shift_started_at: nowISO() });
    logActivity(book, a, 'Started shift', 'staff', a.id);
  } else if (body.action === 'end') {
    const today = dateInZone(s.time_zone);
    const open = book.all<Delivery>('deliveries').filter((d) => d.driver_id === a.id && d.date === today && ['accepted', 'picked_up', 'arrived'].includes(d.status));
    if (open.length) throw bad('Finish or report your open deliveries before ending the shift.');
    book.update<Staff>('staff', a.id, { on_shift: false, shift_started_at: '' });
    logActivity(book, a, 'Ended shift', 'staff', a.id);
  } else throw bad('Unknown shift action.');
  await book.commit();
  return { on_shift: body.action === 'start' };
}

/**
 * Apply a batch of updates from the driver's phone, in order.
 * Each carries a client id; one already applied is skipped, so the phone can safely resend after losing signal.
 */
export async function driverSync(deps: Deps, a: Actor, body: Record<string, unknown>) {
  onlyDriver(a);
  const updates = (Array.isArray(body.updates) ? body.updates : []) as DriverUpdate[];
  if (updates.length > 100) throw bad('Too many updates in one request.');
  const book = await openOrg(deps, a, ...DELIVERY_TABS);
  const s = readSettings(book);
  const seen = new Set(book.all<DeliveryEvent>('delivery_events').map((e) => e.client_id).filter(Boolean));
  const results: { client_id: string; ok: boolean; error?: string }[] = [];

  for (const u of updates) {
    const cid = str(u.client_id, 80);
    if (!cid) {
      results.push({ client_id: '', ok: false, error: 'Missing client id' });
      continue;
    }
    if (seen.has(cid)) {
      results.push({ client_id: cid, ok: true });
      continue;
    }
    try {
      const d = book.get<Delivery>('deliveries', str(u.delivery_id, 60));
      if (!d || d.driver_id !== a.id) throw bad('This delivery is no longer assigned to you.');
      const offline = !!(u as { offline?: boolean }).offline;
      const by = a.name;
      switch (u.action) {
        case 'accept':
          if (d.status !== 'accepted') move(book, d, 'accepted', by, '', offline, cid);
          break;
        case 'decline': {
          const reason = str(u.reason, 200) || 'Declined';
          move(book, d, 'unassigned', by, reason, offline, cid);
          detach(book, s, d);
          book.update<Delivery>('deliveries', d.id, { decline_reason: reason, driver_id: '', vehicle_id: '' });
          break;
        }
        case 'pickup':
          if (d.status !== 'picked_up') move(book, d, 'picked_up', by, '', offline, cid);
          if (d.trip_id) updateEtas(book, s, d.trip_id);
          break;
        case 'arrive':
          if (d.status !== 'arrived') move(book, d, 'arrived', by, '', offline, cid);
          book.update<Delivery>('deliveries', d.id, { eta: u.at || nowISO() });
          break;
        case 'deliver': {
          const receiver = str(u.receiver_name, 120);
          if (!receiver) throw bad('Enter the receiver’s name.');
          // What actually arrived, line by line
          const lines = parseLines(d.lines);
          const given = Array.isArray(u.pod_lines) ? u.pod_lines : [];
          const pod: PodLine[] = lines.map((l, i) => {
            const p = (given[i] ?? {}) as Partial<PodLine>;
            const q = (v: unknown, def: number) => Math.max(0, Number(v ?? def) || 0);
            const out = { delivered: q(p.delivered, l.q), damaged: q(p.damaged, 0), returned: q(p.returned, 0), note: str(p.note, 120) };
            if (out.delivered + out.damaged + out.returned > l.q + 1e-9) throw bad(`“${l.d}”: more than the ${l.q} ordered.`);
            return out;
          });
          const podNote = str(u.pod_note, 300);
          const problems = pod.map((p, i) => ({ p, l: lines[i] })).filter(({ p, l }) => p.delivered < l.q);
          const issue = problems.length > 0 || !!podNote;
          // Check photos and payment before changing anything, so a bad update changes nothing.
          const photos = (Array.isArray(u.photos) ? u.photos.slice(0, 4) : []).map(decodeImage);
          const sig = u.signature ? decodeImage(u.signature) : null;
          const pay = u.payment && Number(u.payment.amount) > 0 ? u.payment : null;
          let payment: Omit<Payment, 'photo'> | null = null;
          let chequeImg = null;
          if (pay) {
            const method: PaymentMethod = (['cash', 'cheque', 'transfer'] as const).includes(pay.method) ? pay.method : 'cash';
            const amount = round3(num(pay.amount, 'Amount collected', { min: 0, max: 10_000_000 }));
            if (method === 'cheque' && !str(pay.cheque_no, 40)) throw bad('Enter the cheque number.');
            if (pay.cheque_date && !isDate(pay.cheque_date)) throw bad('Enter the cheque date.');
            chequeImg = pay.photo ? decodeImage(pay.photo) : null;
            payment = {
              id: uid('pay_'),
              delivery_id: d.id,
              customer_id: d.customer_id,
              shop_id: d.shop_id,
              driver_id: a.id,
              method,
              amount,
              cheque_no: str(pay.cheque_no, 40),
              bank: str(pay.bank, 60),
              cheque_date: method === 'cheque' ? str(pay.cheque_date, 10) : '',
              status: method === 'transfer' ? 'to_verify' : 'with_driver',
              collected_at: u.at || nowISO(),
              settlement_id: '',
              note: '',
              updated_at: nowISO(),
            };
          }
          if (d.status === 'picked_up') move(book, d, 'arrived', by, '', offline, cid + ':a');
          const summary = problems.map(({ p, l }) => `${l.d}: ${p.delivered}/${l.q} delivered${p.damaged ? `, ${p.damaged} damaged` : ''}${p.returned ? `, ${p.returned} returned` : ''}`).join('; ');
          move(book, d, 'delivered', by, issue ? `With issues. ${summary}${podNote ? ` ${podNote}` : ''}`.trim() : '', offline, cid);
          const folder = `deliveries/${d.id}`;
          const photoKeys: string[] = [];
          for (const p of photos) photoKeys.push(await storeImage(deps, a, folder, 'photo', p));
          const sigKey = sig ? await storeImage(deps, a, folder, 'signature', sig) : '';
          let collected: number | null = null;
          if (payment) {
            const photo = chequeImg ? await storeImage(deps, a, folder, 'cheque', chequeImg) : '';
            book.insert('payments', { ...payment, photo } as unknown as Record<string, unknown>);
            collected = payment.amount;
          } else if (d.collect_type === 'cash' || d.collect_type === 'cheque') {
            collected = round3(Number(u.collected_amount ?? 0));
          }
          book.update<Delivery>('deliveries', d.id, {
            receiver_name: receiver,
            delivered_at: u.at || nowISO(),
            collected_amount: collected,
            collected_note: str(u.collected_note, 200),
            pod_lines: pod.length ? JSON.stringify(pod) : '',
            pod_photos: photoKeys.join(','),
            pod_signature: sigKey,
            pod_note: podNote,
            pod_issue: issue,
          });
          if (d.trip_id) updateEtas(book, s, d.trip_id);
          break;
        }
        case 'fail': {
          const reason = str(u.reason, 200);
          if (!reason) throw bad('Choose why it could not be delivered.');
          move(book, d, 'failed', by, reason, offline, cid);
          book.update<Delivery>('deliveries', d.id, { fail_reason: reason });
          if (d.trip_id) updateEtas(book, s, d.trip_id);
          break;
        }
        default:
          throw bad('Unknown action.');
      }
      seen.add(cid);
      results.push({ client_id: cid, ok: true });
    } catch (e) {
      results.push({ client_id: cid, ok: false, error: e instanceof Error ? e.message : 'Could not apply this update.' });
    }
  }
  await book.commit();
  return { results };
}

/** A fuel fill-up entered by the driver, for the vehicle on today's trip. */
export async function driverFuel(deps: Deps, a: Actor, body: Record<string, unknown>) {
  onlyDriver(a);
  const book = await openOrg(deps, a, 'trips', 'vehicles', 'vehicle_costs', 'activity_log');
  const s = readSettings(book);
  const today = dateInZone(s.time_zone);
  const mine = book.all<Trip>('trips').filter((t) => t.driver_id === a.id && t.date === today && t.vehicle_id);
  const vehicleId = str(body.vehicle_id, 40) || mine[0]?.vehicle_id || '';
  if (!vehicleId || !mine.some((t) => t.vehicle_id === vehicleId)) throw bad('You have no vehicle on a trip today.');
  const amount = round3(num(body.amount, 'Amount', { min: 0.001, max: 10000 }));
  const litres = body.litres == null || body.litres === '' ? null : num(body.litres, 'Litres', { max: 2000 });
  const odometer = body.odometer == null || body.odometer === '' ? null : num(body.odometer, 'Odometer', { max: 5_000_000 });
  const row = { id: uid('vc_'), vehicle_id: vehicleId, date: today, kind: 'fuel', amount, litres, odometer, note: str(body.note, 200) || 'Added by driver', created_by: a.name, created_at: nowISO() };
  book.insert('vehicle_costs', row);
  logActivity(book, a, 'Added fuel', 'vehicle', vehicleId, `${amount}`);
  await book.commit();
  return row;
}

export { addressOf };
