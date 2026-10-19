import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { rankVehicles, quoteDelivery, vehicleLabel, ownVsHire, feeByPriceList, feeForMargin, quoteText, restrictionsFor, isHeavy, type Address, type Extras, type OrgSettings, type Quote, type Shop, type Vehicle, type VehicleOption } from '../../lib/domain';
import { toast } from '../../lib/toast';
import { minutes, money } from '../../lib/format';
import { cx } from '../../ui/controls';
import { BAND_LABEL, BandBadge, Notice } from '../../ui/display';

export interface Plan {
  options: VehicleOption<Vehicle>[];
  chosen: VehicleOption<Vehicle> | undefined;
  /** Costed with a standard vehicle when nothing fits, so the sums can still be shown. */
  indicative: Quote | null;
}

/** Every vehicle costed for this one job, and the one that will be used. */
export function usePlan(a: { shop?: Shop; address?: Address; weight: number; cbm: number; invoice: number; charge: number; vehicles: Vehicle[]; settings: OrgSettings; pick: string; extras?: Extras; date?: string }): Plan {
  const { shop, address, weight, cbm, invoice, charge, vehicles, settings, pick, extras, date } = a;
  const ex = JSON.stringify(extras ?? {});
  return useMemo(() => {
    if (!shop || !address) return { options: [], chosen: undefined, indicative: null };
    const x = JSON.parse(ex) as Extras;
    const options = rankVehicles(vehicles, { from: shop, to: address, load: { weight_kg: weight, volume_cbm: cbm }, settings, invoiceValue: invoice, deliveryCharge: charge, extras: x, date });
    const picked = options.find((o) => o.vehicle.id === pick && o.fit.ok);
    const chosen = picked ?? options.find((o) => o.fit.ok);
    const indicative = chosen ? null : quoteDelivery({ from: shop, to: address, settings, invoiceValue: invoice, deliveryCharge: charge, extras: x, date });
    return { options, chosen, indicative };
  }, [shop, address, weight, cbm, invoice, charge, vehicles, settings, pick, ex, date]);
}

const n = (x: number, d = 1) => x.toLocaleString('en-US', { maximumFractionDigits: d });

function Step({ no, title, children }: { no: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`calc-${no}`} className="border-t border-line-2 pt-5 first:border-0 first:pt-0">
      <h3 id={`calc-${no}`} className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs text-primary-strong">
          {no}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Shows every number behind a delivery's cost, as it changes: distance and time,
 * the vehicle choices (own or hired), the cost lines with their working, and what
 * the order can pay for. Rates come from Settings.
 */
export interface FeeContext {
  extras: Extras;
  invoice: number;
  charge: number;
  onUse: (charge: number) => void;
  customer: string;
  doc: string;
}

export function Calculation({ shop, address, weight, cbm, plan, settings, onPick, isAdmin, fee, when }: { shop?: Shop; address?: Address; weight: number; cbm: number; plan: Plan; settings: OrgSettings; onPick: (id: string) => void; isAdmin: boolean; fee?: FeeContext; when?: { date: string; from?: string; to?: string } }) {
  if (!shop || !address) {
    return (
      <div className="panel p-5">
        <h2 className="text-base font-semibold">Cost of this delivery</h2>
        <p className="mt-2 text-sm text-ink-2">Choose a customer and address. The distance, the vehicle and every cost line appear here and update as you type.</p>
      </div>
    );
  }
  const q = plan.chosen?.quote ?? plan.indicative!;
  const noFit = !plan.chosen;
  const pct = q.budget > 0 ? Math.min(100, (q.cost / q.budget) * 100) : 100;
  const barTone = q.band === 'good' ? 'bg-good' : q.band === 'attention' ? 'bg-attention' : 'bg-loss';
  const hasLoad = weight > 0 || cbm > 0;

  return (
    <section aria-labelledby="calc-h" className="panel flex flex-col gap-5 p-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 id="calc-h" className="text-base font-semibold">
            Cost of this delivery
          </h2>
          <BandBadge band={q.band} short />
        </div>
        <p className="num mt-1 text-2xl font-semibold">{money(q.cost)}</p>
        <p className="text-sm text-ink-2">
          {plan.chosen ? <>By {vehicleLabel(plan.chosen.vehicle)}. </> : <>With a standard vehicle (none fits yet). </>}
          {n(q.distance_km)} km there and back, about {minutes(q.minutes)}.
        </p>
      </div>

      {when && <Rules shop={shop} settings={settings} plan={plan} when={when} />}

      <Step no={1} title="Distance and time">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line-2">
            <Row k="Straight line" v={`${n(q.straight_km)} km`} note={`from ${shop.name}`} />
            <Row k="By road, one way" v={`${n(q.one_way_km)} km`} note={`${n(q.straight_km)} km × ${n(q.road_factor, 2)} road factor`} />
            <Row k="There and back" v={`${n(q.distance_km)} km`} note="the driver returns to the shop" />
            <Row k="Driving time" v={minutes(q.drive_minutes)} note={`${n(q.distance_km)} km ÷ ${n(settings.average_speed_kmh, 0)} km/h × ${n(settings.traffic_factor, 2)} traffic`} />
            <Row k="At the customer" v={minutes(q.service_minutes)} note="unloading and signing" />
            {q.wait_minutes > 0 && <Row k="Waiting at the site" v={minutes(q.wait_minutes)} note="expected, from the form" />}
            <Row k="Total time" v={minutes(q.minutes)} strong />
          </tbody>
        </table>
      </Step>

      <Step no={2} title={hasLoad ? `Choose a vehicle for ${n(weight, 0)} kg and ${n(cbm, 1)} cbm` : 'Choose a vehicle'}>
        {!hasLoad && <p className="mb-2 text-xs text-ink-2">Enter the weight and volume of the order to see which vehicles can carry it.</p>}
        {plan.options.length === 0 ? (
          <Notice tone="attention">
            There are no vehicles for this shop yet.{' '}
            {isAdmin ? (
              <Link to="/app/vehicles" className="font-medium underline">
                Add a vehicle or a hire option
              </Link>
            ) : (
              'Ask your admin to add one under Vehicles.'
            )}
          </Notice>
        ) : (
          <>
            <fieldset>
              <legend className="sr-only">Vehicle for this delivery</legend>
              <ul className="flex flex-col gap-2">
                {plan.options.map((o, i) => {
                  const sel = plan.chosen?.vehicle.id === o.vehicle.id;
                  const first = i === 0 && o.fit.ok;
                  const v = o.vehicle;
                  const why = !o.fit.weight ? `Too heavy: ${n(weight, 0)} kg is over ${n(v.capacity_kg, 0)} kg` : !o.fit.volume ? `Too bulky: ${n(cbm, 1)} cbm is over ${n(v.capacity_cbm, 1)} cbm` : '';
                  return (
                    <li key={v.id}>
                      <label className={cx('flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary', sel ? 'border-primary bg-primary-soft/60' : 'border-line', !o.fit.ok && 'cursor-not-allowed bg-canvas opacity-80')}>
                        <input type="radio" name="vehicle" className="mt-1 h-4 w-4 accent-primary" checked={sel} disabled={!o.fit.ok} onChange={() => onPick(v.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                            {vehicleLabel(v)}
                            {v.ownership === 'rented' && <span className="rounded-full bg-attention-soft px-2 text-xs text-attention">Hire {money(v.rental_per_day)} per day</span>}
                            {first && <span className="rounded-full bg-good-soft px-2 text-xs text-good">Cheapest that fits</span>}
                          </span>
                          <span className="block text-xs text-ink-2">
                            Carries {n(v.capacity_kg, 0)} kg{v.capacity_cbm > 0 ? `, ${n(v.capacity_cbm, 1)} cbm` : ''} · {n(v.fuel_use, 1)} L per 100 km
                          </span>
                          {why && <span className="block text-xs font-medium text-loss">{why}</span>}
                        </span>
                        {o.fit.ok && (
                          <span className="text-end">
                            <span className="num block text-sm font-semibold">{money(o.quote.cost)}</span>
                            <BandBadge band={o.quote.band} short />
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <OwnVsHire plan={plan} />
            {noFit && hasLoad && (
              <Notice tone="attention" className="mt-3">
                No vehicle carries {n(weight, 0)} kg and {n(cbm, 1)} cbm.{' '}
                {isAdmin ? (
                  <>
                    <Link to="/app/vehicles" className="font-medium underline">
                      Add a hire option
                    </Link>{' '}
                    with enough space, or split the order.
                  </>
                ) : (
                  'Ask your admin to add a hire option with enough space, or split the order.'
                )}
              </Notice>
            )}
          </>
        )}
      </Step>

      <Step no={3} title="Cost lines">
        <table className="w-full text-sm">
          <caption className="sr-only">How the cost is added up</caption>
          <tbody className="divide-y divide-line-2">
            {q.lines.map((l) => (
              <tr key={l.key}>
                <th scope="row" className="py-2 pe-3 text-start align-top font-normal">
                  {l.label}
                  <span className="block text-xs text-ink-2">{l.detail}</span>
                </th>
                <td className="num whitespace-nowrap py-2 text-end align-top">{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <th scope="row" className="py-2 text-start">
                Total cost
              </th>
              <td className="num whitespace-nowrap py-2 text-end">{money(q.cost)}</td>
            </tr>
          </tbody>
        </table>
      </Step>

      <Step no={4} title="What this order can pay for">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line-2">
            <Row k="Delivery charge" v={money(q.charge)} note="what you charge the customer" />
            <Row k={`Allowance from the invoice`} v={money(q.invoice_allowance)} note={`${n(settings.allowed_cost_pct, 2)}% of ${money(q.invoice_value)}`} />
            <Row k="Delivery budget" v={money(q.budget)} strong />
            <Row k="Cost of delivery" v={`− ${money(q.cost)}`} />
            <Row k={q.margin >= 0 ? 'Left over' : 'Short by'} v={money(Math.abs(q.margin))} strong tone={q.margin >= 0 ? 'good' : 'loss'} />
          </tbody>
        </table>
        <div className="mt-3" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
            <div className={cx('h-full', barTone)} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm font-medium">{BAND_LABEL[q.band]}</p>
          <p className="text-sm text-ink-2">
            {q.budget > 0 ? `The cost uses ${Math.round((q.cost / q.budget) * 100)}% of the budget.` : 'There is no charge and no invoice value, so any cost is a loss.'}
            {q.break_even_charge > q.charge && ` Charging at least ${money(q.break_even_charge)} would cover it.`}
            {q.max_one_way_km != null && ` At this budget it pays to go up to ${n(q.max_one_way_km)} km one way.`}
          </p>
        </div>
      </Step>

      {fee && <ChargeStep q={q} settings={settings} fee={fee} weight={weight} cbm={cbm} />}

      <p className="text-xs text-ink-3">
        Rates (fuel price, driver pay, speed, allowance) are set by your admin in Settings.
        {isAdmin && (
          <>
            {' '}
            <Link to="/app/settings/costs" className="underline">
              Open Settings
            </Link>
          </>
        )}
      </p>
    </section>
  );
}

function Row({ k, v, note, strong, tone }: { k: string; v: string; note?: string; strong?: boolean; tone?: 'good' | 'loss' }) {
  return (
    <tr className={cx(strong && 'font-semibold')}>
      <th scope="row" className="py-2 pe-3 text-start align-top font-[inherit]">
        <span className={strong ? '' : 'font-normal'}>{k}</span>
        {note && <span className="block text-xs font-normal text-ink-2">{note}</span>}
      </th>
      <td className={cx('num whitespace-nowrap py-2 text-end align-top', tone === 'good' && 'text-good', tone === 'loss' && 'text-loss')}>{v}</td>
    </tr>
  );
}

function OwnVsHire({ plan }: { plan: Plan }) {
  const r = ownVsHire(plan.options);
  if (!r.own && !r.hire) return null;
  let text: string;
  if (r.own && r.hire) text = r.best === 'own' ? `Your own ${vehicleLabel(r.own.vehicle)} is ${money(r.saving ?? 0)} cheaper than hiring.` : `Hiring is ${money(-(r.saving ?? 0))} cheaper than your own ${vehicleLabel(r.own.vehicle)}.`;
  else if (r.own) text = 'Your own vehicle carries it. No hire option fits.';
  else text = `None of your own vehicles carry it. Hiring costs ${money(r.hire!.quote.cost)}.`;
  return <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-sm">{text}</p>;
}

function Rules({ shop, settings, plan, when }: { shop: Shop; settings: OrgSettings; plan: Plan; when: { date: string; from?: string; to?: string } }) {
  const heavy = plan.chosen ? isHeavy(plan.chosen.vehicle.capacity_kg) : false;
  const list = restrictionsFor({ country: settings.country, city: shop.city || settings.city, date: when.date, from: when.from, to: when.to, heavy });
  if (!list.length) return null;
  const warn = list.filter((r) => r.level === 'warn');
  return (
    <div aria-live="polite">
      {warn.length > 0 && (
        <Notice tone="attention">
          <p className="font-medium">The time window clashes with:</p>
          <ul className="mt-1 list-disc ps-5">
            {warn.map((r) => (
              <li key={r.text}>{r.text}</li>
            ))}
          </ul>
        </Notice>
      )}
      {list.length > warn.length && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-medium text-primary">Rules for this day ({list.length - warn.length})</summary>
          <ul className="mt-1 list-disc ps-5 text-ink-2">
            {list
              .filter((r) => r.level === 'info')
              .map((r) => (
                <li key={r.text}>{r.text}</li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ChargeStep({ q, settings, fee, weight, cbm }: { q: Quote; settings: OrgSettings; fee: FeeContext; weight: number; cbm: number }) {
  const [copied, setCopied] = useState(false);
  const list = feeByPriceList(settings, { one_way_km: q.one_way_km, weight_kg: weight, volume_cbm: cbm, invoice_value: fee.invoice, helpers: fee.extras.helpers, equipment: fee.extras.equipment, wait_minutes: fee.extras.wait_minutes });
  const margin = feeForMargin(q.cost, q.invoice_allowance, settings);
  const copy = () => {
    const text = quoteText({ s: settings, company: settings.company_name, customer: fee.customer || 'Customer', doc: fee.doc, fee: list.total, lines: list.lines, free: list.free, date: new Date().toISOString().slice(0, 10) });
    navigator.clipboard
      .writeText(text)
      .then(() => (setCopied(true), toast('Quote copied. Paste it into WhatsApp.')))
      .catch(() => toast('Could not copy.', 'error'));
  };
  const Option = ({ title, amount, note }: { title: string; amount: number; note: string }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-ink-2">{note}</p>
      </div>
      <div className="text-end">
        <p className="num font-semibold">{money(amount)}</p>
        {Math.abs(amount - fee.charge) > 0.0005 ? (
          <button type="button" className="text-sm font-medium text-primary underline" onClick={() => fee.onUse(amount)}>
            Use this
          </button>
        ) : (
          <span className="text-xs text-good">In use</span>
        )}
      </div>
    </div>
  );
  return (
    <Step no={5} title="What to charge">
      <div className="flex flex-col gap-2">
        <Option title="Your price list" amount={list.total} note={list.free ? 'Free: the invoice is over your free-delivery amount' : list.lines.map((l) => l.label).join(' + ') + (list.minimum_applied ? ' (minimum)' : '')} />
        <Option title={`Cost + ${settings.fee_target_margin_pct}% margin`} amount={margin} note={`${money(q.cost)} cost, less ${money(q.invoice_allowance)} from the invoice`} />
      </div>
      <button type="button" onClick={copy} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium hover:border-ink-3">
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} Copy quote for WhatsApp
      </button>
    </Step>
  );
}
