import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, UserRoundPlus, Ban, CalendarClock, Link2, MessageCircle, ExternalLink, Phone, Undo2, Star, Printer, TriangleAlert } from 'lucide-react';
import { post } from '../../lib/api';
import { useAction, useAreas, useDelivery, usePlanningVehicles } from '../../lib/queries';
import { toast } from '../../lib/toast';
import { addDays, can, isReassignable, quoteDelivery, vehicleLabel, type OrderLine, type Payment, type PodLine } from '../../lib/domain';
import { dateLabel, dateTimeIn, km, minutes, money, timeIn } from '../../lib/format';
import { cx } from '../../ui/controls';
import { Button, Dialog, SelectField, TextField } from '../../ui/controls';
import { BandBadge, Facts, Notice, PageHeader, SectionTitle, STATUS_LABEL, StatusPill, UrgentTag } from '../../ui/display';
import { AssignDialog } from './AssignDialog';
import { bandOf, costOf, useNames, useOrg } from './ctx';
import { fillTemplate, templateFor, trackingUrl, whatsappLink } from './messages';

export default function DeliveryDetail() {
  const { id = '' } = useParams();
  const { role, settings, tz, today, shopName, shops } = useOrg();
  const vehicles = usePlanningVehicles('all');
  const areas = useAreas();
  const names = useNames();
  const q = useDelivery(id);
  const [dialog, setDialog] = useState<null | 'assign' | 'cancel' | 'reschedule'>(null);
  const [reason, setReason] = useState('Customer cancelled the order');
  const [newDate, setNewDate] = useState(addDays(today, 1));
  const inv = ['deliveries', 'delivery'];
  const unassign = useAction(() => post(`/deliveries/${id}/unassign`), { success: 'Removed from the trip', invalidate: inv });
  const cancel = useAction(() => post(`/deliveries/${id}/cancel`, { reason }), { success: 'Delivery cancelled', invalidate: inv });
  const reschedule = useAction(() => post(`/deliveries/${id}/reschedule`, { date: newDate }), { success: `Moved to ${dateLabel(newDate)}`, invalidate: inv });

  if (q.isLoading) return <p className="text-ink-2">Loading…</p>;
  if (q.error || !q.data) return <Notice tone="loss">{q.error?.message ?? 'Not found.'} <Link to="/app" className="underline">Back to deliveries</Link></Notice>;
  const { delivery: d, events, trip, payments, pod } = q.data;
  const c = names.customer(d.customer_id);
  const a = names.address(d.address_id);
  const driver = names.driver(d.driver_id);
  const canPlan = can(role, 'deliveries.plan');
  const showMoney = can(role, 'costs.view');
  const open = isReassignable(d.status);
  const msg = fillTemplate(templateFor(d, settings), d, { customer: c?.contact_name || c?.name || '', driver: driver?.name ?? '', tz });
  const stops = trip?.stop_ids.split(',') ?? [];
  const shop = shops.find((x) => x.id === d.shop_id);
  const vehicle = (vehicles.data ?? []).find((v) => v.id === (d.vehicle_id || d.plan_vehicle_id));
  const area = areas.data?.find((x) => x.id === a?.area_id);
  const extras = { helpers: d.helpers || 0, equipment: d.equipment || 'none', wait_minutes: d.wait_minutes || 0, toll: area?.toll_per_trip || 0 };
  const quote = shop && a ? quoteDelivery({ from: shop, to: a, vehicle, settings, invoiceValue: d.invoice_value, deliveryCharge: d.delivery_charge, extras, date: d.date }) : null;
  const lines = parseJson<OrderLine[]>(d.lines, []);
  const podLines = parseJson<PodLine[]>(d.pod_lines, []);
  const collect = d.collect_type === 'none' ? 'Nothing to collect' : d.collect_type === 'documents' ? `Documents${d.collect_note ? `: ${d.collect_note}` : ''}` : `${d.collect_type === 'cash' ? 'Cash' : 'Cheque'} ${money(d.collect_amount)}`;
  const extra: [string, ReactNode][] = [];
  if (showMoney) extra.push(['Invoice value', money(d.invoice_value)], ['Delivery charge', d.delivery_charge ? money(d.delivery_charge) : 'Free delivery']);
  if (d.collected_amount != null) extra.push(['Collected', <span key="c" className={d.collected_amount !== d.collect_amount ? 'font-medium text-loss' : ''}>{money(d.collected_amount)}{d.collected_note ? `, ${d.collected_note}` : ''}</span>]);

  return (
    <>
      <PageHeader
        title={`${d.ref}: ${c?.name ?? ''}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={d.status} />
            {d.urgent && <UrgentTag />}
            <span>
              {d.doc_kind} {d.doc_number}
              {shops.length > 1 && `, ${shopName(d.shop_id)}`}
            </span>
          </span>
        }
        actions={
          <>
            <a href={`/print/delivery/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:border-ink-3">
              <Printer size={16} aria-hidden="true" /> Delivery note
            </a>
            {can(role, 'deliveries.create') && open && (
              <Link to={`/app/deliveries/${d.id}/edit`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:border-ink-3">
                <Pencil size={16} aria-hidden="true" /> Edit
              </Link>
            )}
            {canPlan && open && (
              <Button variant="primary" icon={<UserRoundPlus size={16} />} onClick={() => setDialog('assign')}>
                {d.driver_id ? 'Move to another driver' : 'Assign driver'}
              </Button>
            )}
          </>
        }
      />
      {d.status === 'unassigned' && d.decline_reason && <Notice tone="attention" className="mb-4">The driver declined it: {d.decline_reason}. Assign it again.</Notice>}
      {d.status === 'failed' && (
        <Notice tone="loss" className="mb-4">
          Not delivered: {d.fail_reason}.{' '}
          {canPlan && (
            <button type="button" className="font-medium underline" onClick={() => setDialog('reschedule')}>
              Move it to another date
            </button>
          )}
        </Notice>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="h1" className="panel p-5">
            <SectionTitle id="h1">Customer and address</SectionTitle>
            <Facts
              items={[
                ['Customer', c?.name],
                ['Contact', c?.contact_name || '—'],
                ['Phone', <a key="p" href={`tel:${c?.phone}`} className="num inline-flex items-center gap-1 text-primary hover:underline"><Phone size={14} aria-hidden="true" /> {c?.phone}</a>],
                ['Address', a ? `${a.label}: ${a.line}` : '—'],
              ]}
            />
          </section>
          <section aria-labelledby="h2" className="panel p-5">
            <SectionTitle id="h2">Order and timing</SectionTitle>
            <Facts
              items={[
                ['Document', `${d.doc_kind === 'DO' ? 'Delivery order' : 'Invoice'} ${d.doc_number}`],
                ...extra,
                ['Date', d.date === today ? `Today, ${dateLabel(d.date)}` : dateLabel(d.date)],
                ['Time', d.timing === 'window' ? `Between ${d.window_from} and ${d.window_to}` : 'Any time that day'],
                ['Load', `${d.weight_kg.toLocaleString()} kg${d.volume_cbm > 0 ? `, ${d.volume_cbm} cbm` : ''}`],
                ['At the site', [d.helpers ? `${d.helpers} helper${d.helpers > 1 ? 's' : ''}` : '', d.equipment === 'crane' ? 'crane truck' : d.equipment === 'forklift' ? 'forklift' : '', d.wait_minutes ? `${d.wait_minutes} min waiting` : ''].filter(Boolean).join(', ') || '—'],
                ['Collect', collect],
                ['Notes', d.notes || '—'],
              ]}
            />
          </section>
          {(lines.length > 0 || d.status === 'delivered') && (
            <section aria-labelledby="hp" className="panel p-5">
              <SectionTitle id="hp">{d.status === 'delivered' ? 'Proof of delivery' : 'Items'}</SectionTitle>
              {d.pod_issue && (
                <Notice tone="attention" className="mb-3">
                  <span className="inline-flex items-center gap-1 font-medium">
                    <TriangleAlert size={16} aria-hidden="true" /> Delivered with a problem
                  </span>
                  {d.pod_note && <span className="block">{d.pod_note}</span>}
                </Notice>
              )}
              {lines.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Items</caption>
                    <thead className="border-b border-line text-xs text-ink-2">
                      <tr>
                        <th scope="col" className="py-2 text-start font-medium">Item</th>
                        <th scope="col" className="py-2 text-end font-medium">Ordered</th>
                        {podLines.length > 0 && (
                          <>
                            <th scope="col" className="py-2 text-end font-medium">Delivered</th>
                            <th scope="col" className="py-2 text-end font-medium">Damaged</th>
                            <th scope="col" className="py-2 text-end font-medium">Returned</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-2">
                      {lines.map((l, i) => {
                        const p = podLines[i];
                        const short = p && p.delivered < l.q;
                        return (
                          <tr key={i} className={short ? 'bg-attention-soft' : ''}>
                            <th scope="row" className="py-2 text-start font-normal">{l.d}</th>
                            <td className="num py-2 text-end">
                              {l.q} {l.u}
                            </td>
                            {p && (
                              <>
                                <td className="num py-2 text-end">{p.delivered}</td>
                                <td className={`num py-2 text-end ${p.damaged ? 'font-semibold text-loss' : ''}`}>{p.damaged || '—'}</td>
                                <td className={`num py-2 text-end ${p.returned ? 'font-semibold text-attention' : ''}`}>{p.returned || '—'}</td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {d.status === 'delivered' && (
                <div className="mt-4 flex flex-wrap items-start gap-4">
                  <div className="text-sm">
                    <p className="text-ink-2">Received by</p>
                    <p className="font-medium">{d.receiver_name}</p>
                    <p className="text-ink-2">{d.delivered_at ? dateTimeIn(d.delivered_at, tz) : ''}</p>
                  </div>
                  {pod.signature && (
                    <figure>
                      <img src={pod.signature} alt={`Signature of ${d.receiver_name}`} className="h-24 rounded-lg border border-line bg-white" />
                      <figcaption className="sr-only">Signature</figcaption>
                    </figure>
                  )}
                  {pod.photos.map((u, i) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
                      <img src={u} alt={`Delivery photo ${i + 1}`} className="h-24 w-24 rounded-lg object-cover" />
                    </a>
                  ))}
                  {!pod.signature && pod.photos.length === 0 && <p className="text-sm text-ink-2">No photos or signature were taken.</p>}
                </div>
              )}
            </section>
          )}

          {payments.length > 0 && (
            <section aria-labelledby="hm" className="panel p-5">
              <SectionTitle id="hm" aside={<Link to="/app/money" className="text-sm font-medium text-primary underline">Open Money</Link>}>
                Payment collected
              </SectionTitle>
              <ul className="divide-y divide-line-2 text-sm">
                {payments.map((p: Payment, i: number) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium capitalize">{p.method}</span> <span className="num">{money(p.amount)}</span>
                      {p.cheque_no && <span className="text-ink-2"> · no. {p.cheque_no}{p.bank ? `, ${p.bank}` : ''}{p.cheque_date ? `, dated ${dateLabel(p.cheque_date)}` : ''}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      {pod.cheque_photos[i] && (
                        <a href={pod.cheque_photos[i]} target="_blank" rel="noreferrer" className="text-primary underline">
                          Cheque photo
                        </a>
                      )}
                      <PayStatus status={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="h3" className="panel p-5">
            <SectionTitle id="h3">Driver and trip</SectionTitle>
            {d.driver_id ? (
              <Facts
                items={[
                  ['Driver', driver?.name ?? '—'],
                  ['Vehicle', vehicle ? vehicleLabel(vehicle) : '—'],
                  ['Trip', trip ? `Stop ${stops.indexOf(d.id) + 1} of ${stops.length}, ${km(trip.distance_km)} in total` : '—'],
                  ['Estimated arrival', d.eta && open ? timeIn(d.eta, tz) : d.status === 'picked_up' && d.eta ? timeIn(d.eta, tz) : '—'],
                  ...(d.delivered_at ? ([['Delivered', `${timeIn(d.delivered_at, tz)} to ${d.receiver_name}`]] as [string, string][]) : []),
                ]}
              />
            ) : (
              <p className="text-sm text-ink-2">No driver yet.</p>
            )}
            {canPlan && open && d.driver_id && (
              <Button className="mt-4" size="sm" icon={<Undo2 size={16} />} busy={unassign.isPending} onClick={() => unassign.mutate(undefined)}>
                Remove from trip
              </Button>
            )}
          </section>
          <section aria-labelledby="h4" className="panel p-5">
            <SectionTitle id="h4">History</SectionTitle>
            <ol className="flex flex-col gap-4 border-s-2 border-line ps-5">
              {[...events].reverse().map((e) => (
                <li key={e.id} className="relative">
                  <span aria-hidden="true" className="absolute -start-[1.6rem] top-1 h-3 w-3 rounded-full border-2 border-surface bg-ink-3" />
                  <p className="text-sm font-medium">
                    {STATUS_LABEL[e.status]}
                    {e.offline && <span className="ms-2 text-xs font-normal text-ink-2">(sent after the phone reconnected)</span>}
                  </p>
                  <p className="text-xs text-ink-2">
                    {dateTimeIn(e.at, tz)}, by {e.by}
                  </p>
                  {e.reason && <p className="text-sm text-ink-2">{e.reason}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="flex flex-col gap-6 xl:sticky xl:top-6">
          {showMoney && quote && (
            <section aria-labelledby="h5" className="panel p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 id="h5" className="text-base font-semibold">
                  Cost of this delivery
                </h2>
                <BandBadge band={bandOf(d, settings)} short />
              </div>
              <p className="num mt-1 text-2xl font-semibold">{money(costOf(d))}</p>
              <p className="text-sm text-ink-2">{d.trip_cost != null ? 'Its share of the trip it is on.' : `Sent on its own${vehicle ? ` with ${vehicleLabel(vehicle)}` : ''}.`}</p>
              <table className="mt-3 w-full text-sm">
                <caption className="sr-only">How the cost on its own is added up</caption>
                <tbody className="divide-y divide-line-2">
                  <tr>
                    <th scope="row" className="py-1.5 text-start font-normal text-ink-2">Distance there and back</th>
                    <td className="num whitespace-nowrap py-1.5 text-end">{km(quote.distance_km)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-1.5 text-start font-normal text-ink-2">Time</th>
                    <td className="num whitespace-nowrap py-1.5 text-end">{minutes(quote.minutes)}</td>
                  </tr>
                  {quote.lines.map((l) => (
                    <tr key={l.key}>
                      <th scope="row" className="py-1.5 text-start font-normal">
                        {l.label}
                        <span className="block text-xs text-ink-2">{l.detail}</span>
                      </th>
                      <td className="num whitespace-nowrap py-1.5 text-end align-top">{money(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <th scope="row" className="py-1.5 text-start">Total on its own</th>
                    <td className="num whitespace-nowrap py-1.5 text-end">{money(quote.cost)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-1.5 text-start font-normal">
                      Budget
                      <span className="block text-xs text-ink-2">
                        {money(quote.charge)} charge + {money(quote.invoice_allowance)} ({settings.allowed_cost_pct}% of invoice)
                      </span>
                    </th>
                    <td className="num whitespace-nowrap py-1.5 text-end align-top">{money(quote.budget)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <th scope="row" className="py-1.5 text-start">{quote.margin >= 0 ? 'Left over' : 'Short by'}</th>
                    <td className={cx('num whitespace-nowrap py-1.5 text-end', quote.margin >= 0 ? 'text-good' : 'text-loss')}>{money(Math.abs(quote.margin))}</td>
                  </tr>
                </tbody>
              </table>
              {d.trip_cost != null && <p className="mt-2 text-xs text-ink-2">On its trip the cost is shared with the other stops, so it is {d.trip_cost < quote.cost ? 'lower' : 'not lower'} than when sent alone.</p>}
            </section>
          )}
          <section aria-labelledby="h6" className="panel p-5">
            <h2 id="h6" className="text-base font-semibold">
              Customer updates
            </h2>
            <p className="mt-1 text-sm text-ink-2">The customer follows this delivery from a private link.</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button
                icon={<Link2 size={16} />}
                onClick={() =>
                  navigator.clipboard
                    .writeText(trackingUrl(d))
                    .then(() => toast('Tracking link copied'))
                    .catch(() => toast('Could not copy. Open the page and copy its address.', 'error'))
                }
              >
                Copy tracking link
              </Button>
              <a href={trackingUrl(d)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:border-ink-3">
                <ExternalLink size={16} aria-hidden="true" /> Open tracking page
              </a>
              {c && (
                <a href={whatsappLink(c.phone, msg)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:border-ink-3">
                  <MessageCircle size={16} aria-hidden="true" /> Send WhatsApp message
                </a>
              )}
            </div>
            <p className="mt-3 break-words rounded-lg bg-canvas p-3 text-xs text-ink-2 [overflow-wrap:anywhere]">{msg}</p>
          </section>
          {d.rating != null && (
            <section aria-labelledby="h7" className="panel p-5">
              <h2 id="h7" className="text-base font-semibold">
                Customer rating
              </h2>
              <p className="mt-2 flex gap-1" aria-label={`${d.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={20} aria-hidden="true" className={n <= (d.rating ?? 0) ? 'fill-attention text-attention' : 'text-line'} />
                ))}
              </p>
              {d.rating_comment && <p className="mt-2 text-sm">“{d.rating_comment}”</p>}
            </section>
          )}
          {canPlan && (open || d.status === 'failed') && (
            <section aria-labelledby="h8" className="panel p-5">
              <h2 id="h8" className="text-base font-semibold">
                Other actions
              </h2>
              <div className="mt-3 flex flex-col gap-2">
                {(d.status === 'unassigned' || d.status === 'failed') && (
                  <Button icon={<CalendarClock size={16} />} onClick={() => setDialog('reschedule')}>
                    Move to another date
                  </Button>
                )}
                {open && (
                  <Button variant="danger" icon={<Ban size={16} />} onClick={() => setDialog('cancel')}>
                    Cancel delivery
                  </Button>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>

      {dialog === 'assign' && <AssignDialog delivery={d} onClose={() => setDialog(null)} />}
      <Dialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={`Cancel ${d.ref}?`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Keep delivery</Button>
            <Button variant="danger" busy={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => setDialog(null) })}>
              Cancel delivery
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-ink-2">It is taken off any trip and the driver no longer sees it. This cannot be undone.</p>
        <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>Customer cancelled the order</option>
          <option>Customer will collect from the shop</option>
          <option>Goods not available</option>
          <option>Created by mistake</option>
        </SelectField>
      </Dialog>
      <Dialog
        open={dialog === 'reschedule'}
        onClose={() => setDialog(null)}
        title={`Move ${d.ref} to another date`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" busy={reschedule.isPending} onClick={() => reschedule.mutate(undefined, { onSuccess: () => setDialog(null) })}>
              Move delivery
            </Button>
          </>
        }
      >
        <TextField label="New delivery date" type="date" value={newDate} min={today} onChange={(e) => setNewDate(e.target.value)} />
        <p className="mt-3 text-sm text-ink-2">It goes back to unassigned on that date so it can be planned again.</p>
      </Dialog>
    </>
  );
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const PAY_STATUS: Record<Payment['status'], { label: string; cls: string }> = {
  with_driver: { label: 'With the driver', cls: 'bg-attention-soft text-attention' },
  handed_in: { label: 'Handed in', cls: 'bg-primary-soft text-primary-strong' },
  deposited: { label: 'Deposited', cls: 'bg-primary-soft text-primary-strong' },
  cleared: { label: 'Cleared', cls: 'bg-good-soft text-good' },
  bounced: { label: 'Bounced', cls: 'bg-loss-soft text-loss' },
  to_verify: { label: 'Check the bank', cls: 'bg-attention-soft text-attention' },
};

export function PayStatus({ status }: { status: Payment['status'] }) {
  const s = PAY_STATUS[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
