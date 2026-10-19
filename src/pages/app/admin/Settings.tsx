import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { patch, post, put } from '../../../lib/api';
import { useAction, useAreas, useSettings } from '../../../lib/queries';
import { can, COUNTRIES, countryOf, driverCostPerMinute, driverMonthlyCost, feeByPriceList, formatMoney, FUEL_PRICES, fuelPriceFor, parseFuelOverrides, type Area, type CountryCode, type FuelType, type OrgSettings } from '../../../lib/domain';
import { currencyCode, money } from '../../../lib/format';
import { Button, Checkbox, Dialog, IconButton, NumberField, SelectField, TextArea, TextField } from '../../../ui/controls';
import { EmptyState, Notice, PageHeader } from '../../../ui/display';
import { MapView } from '../../../ui/MapView';
import { TabPanel, Tabs } from '../../../ui/Tabs';
import { useOrg } from '../ctx';
import Activity from './Activity';
import Shops from './Shops';

type Tab = 'costs' | 'prices' | 'business' | 'shops' | 'areas' | 'history';
const TABS: { value: Tab; label: string }[] = [
  { value: 'costs', label: 'Costs' },
  { value: 'prices', label: 'Price list' },
  { value: 'business', label: 'Company' },
  { value: 'shops', label: 'Shops' },
  { value: 'areas', label: 'Areas' },
  { value: 'history', label: 'History' },
];

export default function Settings() {
  const { role } = useOrg();
  const { tab = 'costs' } = useParams();
  const nav = useNavigate();
  const value = (TABS.some((t) => t.value === tab) ? tab : 'costs') as Tab;
  if (!can(role, 'settings.manage')) return <Notice tone="attention">Only an admin can change settings.</Notice>;
  return (
    <>
      <PageHeader title="Settings" description="Set once by the admin. The rates on the Costs tab drive every calculation staff see." />
      <Tabs id="settings" label="Settings sections" tabs={TABS} value={value} onChange={(v) => nav(`/app/settings/${v}`)} />
      <TabPanel id="settings" value={value}>
        {value === 'areas' ? <Areas /> : value === 'shops' ? <Shops /> : value === 'history' ? <Activity /> : <SettingsForm key={value} tab={value} />}
      </TabPanel>
    </>
  );
}

function SettingsForm({ tab }: { tab: 'costs' | 'prices' | 'business' }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const [s, setS] = useState<OrgSettings | null>(null);
  useEffect(() => {
    if (settings.data && !s) setS(settings.data);
  }, [settings.data, s]);
  const save = useAction((body: OrgSettings) => put<OrgSettings>('/settings', body), {
    success: 'Settings saved',
    invalidate: ['settings', 'me'],
  });
  if (settings.error) return <Notice tone="loss">{settings.error.message}</Notice>;
  if (!s) return <p className="text-ink-2">Loading…</p>;
  const set = <K extends keyof OrgSettings>(k: K, v: OrgSettings[K]) => setS((p) => (p ? { ...p, [k]: v } : p));
  const n: NumFn = (k, label, suffix, hint, step = '0.001') => (
    <NumberField label={label} suffix={suffix} step={step} hint={hint} value={s[k] as number} onValue={(v) => set(k, v as never)} />
  );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(s, { onSuccess: (out) => (setS(out), qc.setQueryData(['settings'], out)) });
  };

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-6">
      {tab === 'costs' ? (
        <CostsTab s={s} set={set} n={n} />
      ) : tab === 'prices' ? (
        <PricesTab s={s} n={n} />
      ) : (
        <>
          <section className="panel p-5" aria-labelledby="b1">
            <h2 id="b1" className="text-base font-semibold">Company</h2>
            <p className="mt-1 text-sm text-ink-2">Customers see these on their tracking page.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField label="Company name" value={s.company_name} onChange={(e) => set('company_name', e.target.value)} />
              <TextField label="Company name in Arabic" dir="rtl" lang="ar" value={s.company_name_ar} onChange={(e) => set('company_name_ar', e.target.value)} />
              <TextField label="Logo link (optional)" type="url" placeholder="https://…" value={s.logo_url} onChange={(e) => set('logo_url', e.target.value)} hint="A public https link to a square PNG or SVG, for example on your website." />
              <TextField label="Phone for customers" type="tel" value={s.phone} onChange={(e) => set('phone', e.target.value)} />
              <TextField label="Email" type="email" value={s.email} onChange={(e) => set('email', e.target.value)} />
              <TextField label="Address" value={s.address} onChange={(e) => set('address', e.target.value)} />
              <TextField label="Time zone" value={s.time_zone} onChange={(e) => set('time_zone', e.target.value)} hint="For Oman: Asia/Muscat" />
            </div>
          </section>
          <section className="panel p-5" aria-labelledby="b2">
            <h2 id="b2" className="text-base font-semibold">Customer messages</h2>
            <p className="mt-1 text-sm text-ink-2">
              Wording for WhatsApp messages staff send from a delivery. You can use {'{customer}'}, {'{document}'}, {'{date}'}, {'{driver}'}, {'{eta}'}, {'{time}'} and {'{link}'}.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              <TextArea label="When a driver is assigned" rows={3} value={s.whatsapp_assigned} onChange={(e) => set('whatsapp_assigned', e.target.value)} />
              <TextArea label="When the driver is on the way" rows={3} value={s.whatsapp_on_the_way} onChange={(e) => set('whatsapp_on_the_way', e.target.value)} />
              <TextArea label="When delivered" rows={3} value={s.whatsapp_delivered} onChange={(e) => set('whatsapp_delivered', e.target.value)} />
              <Checkbox label="Send SMS updates automatically" hint="Needs an SMS provider to be connected; until then this has no effect." checked={s.sms_enabled} onChange={(v) => set('sms_enabled', v)} />
            </div>
          </section>
        </>
      )}
      <div className="flex gap-3">
        <Button type="submit" variant="primary" busy={save.isPending}>
          Save settings
        </Button>
        <Button type="button" onClick={() => settings.data && setS(settings.data)}>
          Undo changes
        </Button>
      </div>
    </form>
  );
}

function Areas() {
  const areas = useAreas();
  const [editing, setEditing] = useState<Partial<Area> | null>(null);
  const list = [...(areas.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-2">Areas you deliver to and the usual charge for each. A new delivery to an address in an area starts with that charge.</p>
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing({ lat: 23.588, lng: 58.3829, default_charge: 0 })}>
          Add area
        </Button>
      </div>
      {areas.error && <Notice tone="loss">{areas.error.message}</Notice>}
      {areas.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : list.length === 0 ? (
        <div className="panel">
          <EmptyState title="No areas yet" body="Add the areas you deliver to, such as Ghala, Seeb or Barka." />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Delivery areas</caption>
              <thead className="border-b border-line bg-canvas text-xs text-ink-2">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">Area</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-medium">Usual charge</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-medium">Tolls</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {list.map((a) => (
                  <tr key={a.id}>
                    <th scope="row" className="px-4 py-2.5 text-start font-medium">
                      {a.name}
                      {a.note && <div className="text-xs font-normal text-ink-2">{a.note}</div>}
                    </th>
                    <td className="num px-4 py-2.5 text-end">{money(a.default_charge)}</td>
                    <td className="num px-4 py-2.5 text-end">{a.toll_per_trip ? money(a.toll_per_trip) : '—'}</td>
                    <td className="px-2 py-1 text-end">
                      <IconButton label={`Edit ${a.name}`} icon={<Pencil size={16} />} onClick={() => setEditing(a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MapView label="Map of delivery areas; the same areas are listed in the table" markers={list.map((a) => ({ id: a.id, lat: a.lat, lng: a.lng, label: a.name, kind: 'stop' as const }))} height={380} />
        </div>
      )}
      {editing && <AreaDialog area={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AreaDialog({ area: init, onClose }: { area: Partial<Area>; onClose: () => void }) {
  const [a, setA] = useState(init);
  const save = useAction((body: Partial<Area>) => (init.id ? patch(`/areas/${init.id}`, body) : post('/areas', body)), { success: 'Area saved', invalidate: ['areas'] });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : 'Add area'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(a, { onSuccess: onClose })}>
            Save area
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <TextField label="Area name" value={a.name ?? ''} onChange={(e) => setA({ ...a, name: e.target.value })} required />
          <NumberField label="Usual delivery charge" suffix={currencyCode()} value={a.default_charge ?? 0} onValue={(v) => setA({ ...a, default_charge: v })} />
          <NumberField label="Road tolls, there and back" suffix={currencyCode()} value={a.toll_per_trip ?? 0} onValue={(v) => setA({ ...a, toll_per_trip: v })} hint="For example Salik or Darb gates on the way. Added to the cost." />
          <TextField label="Note (optional)" value={a.note ?? ''} onChange={(e) => setA({ ...a, note: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Latitude" step="0.0001" value={a.lat ?? 0} onValue={(v) => setA({ ...a, lat: v })} />
            <NumberField label="Longitude" step="0.0001" value={a.lng ?? 0} onValue={(v) => setA({ ...a, lng: v })} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm text-ink-2">Click the middle of the area on the map.</p>
          <MapView label="Pick the area centre" markers={a.lat != null && a.lng != null ? [{ id: 'a', lat: a.lat, lng: a.lng, label: a.name || 'Area', kind: 'stop' }] : []} onPick={(p) => setA((x) => ({ ...x, lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) }))} height={320} />
        </div>
      </div>
    </Dialog>
  );
}

type NumFn = (k: keyof OrgSettings, label: string, suffix: string, hint?: string, step?: string) => React.ReactNode;
type SetFn = <K extends keyof OrgSettings>(k: K, v: OrgSettings[K]) => void;

function CostsTab({ s, set, n }: { s: OrgSettings; set: SetFn; n: NumFn }) {
  const country = countryOf(s.country);
  const cur = country.currency;
  const today = new Date().toISOString().slice(0, 10);
  const own = parseFuelOverrides(s.fuel_prices_json);
  const [row, setRow] = useState<{ fuel: FuelType; price: number; from: string; source: string }>({ fuel: 'diesel', price: 0, from: today, source: '' });
  const builtIn = FUEL_PRICES.filter((r) => r.country === country.code);
  const now = (['diesel', 'petrol'] as const).map((f) => ({ f, ...fuelPriceFor(s, f, today) }));
  const dc = driverMonthlyCost(s);
  const saveOwn = (list: typeof own) => set('fuel_prices_json', list.length ? JSON.stringify(list) : '');
  const m = (v: number) => formatMoney(v, s);
  return (
    <>
      <section className="panel p-5" aria-labelledby="c0">
        <h2 id="c0" className="text-base font-semibold">Country</h2>
        <p className="mt-1 text-sm text-ink-2">Sets the currency, the fuel prices and the truck-ban and midday-work rules the app warns about.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Country"
            value={country.code}
            onChange={(e) => {
              const c = COUNTRIES[e.target.value as CountryCode];
              set('country', c.code);
              set('city', c.cities[0]);
              set('time_zone', c.time_zone);
            }}
          >
            {Object.values(COUNTRIES).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Main city" value={s.city} onChange={(e) => set('city', e.target.value)} hint="Shops can have their own city.">
            {country.cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
          <div className="text-sm">
            <p className="font-medium">Currency and VAT</p>
            <p className="mt-2 text-ink-2">
              {cur}, {country.decimals} decimals · VAT {country.vat_pct}%
            </p>
          </div>
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="cf">
        <h2 id="cf" className="text-base font-semibold">Fuel price</h2>
        <Checkbox className="mt-3" label={`Use ${country.name} pump prices by date`} hint={`${country.fuel_review}. Each delivery uses the price on its date.`} checked={s.fuel_auto} onChange={(v) => set('fuel_auto', v)} />
        {s.fuel_auto ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {now.map((x) => (
                <div key={x.f} className="rounded-lg border border-line p-3">
                  <p className="text-xs uppercase tracking-wide text-ink-2">{x.f} today</p>
                  <p className="num text-lg font-semibold">
                    {x.price.toFixed(3)} {cur}/L
                  </p>
                  <p className="text-xs text-ink-2">{x.source}</p>
                </div>
              ))}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-primary">Price history in the app ({builtIn.length})</summary>
              <ul className="mt-2 text-sm text-ink-2">
                {builtIn.map((r, i) => (
                  <li key={i} className="num">
                    {r.from} · {r.fuel} · {r.price.toFixed(3)} {cur} · {r.source}
                  </li>
                ))}
              </ul>
            </details>
            <h3 className="mt-5 text-sm font-semibold">Your own prices</h3>
            <p className="text-sm text-ink-2">Add the new price when it changes (for example on the 1st of the month in the UAE). Yours win from their date.</p>
            {own.length > 0 && (
              <ul className="mt-2 divide-y divide-line-2 rounded-lg border border-line text-sm">
                {own.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="num">
                      {r.from} · {r.fuel} · {r.price.toFixed(3)} {cur}/L {r.source && `· ${r.source}`}
                    </span>
                    <IconButton label="Remove this price" icon={<Trash2 size={16} />} onClick={() => saveOwn(own.filter((_, j) => j !== i))} />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid items-end gap-3 sm:grid-cols-[8rem_9rem_10rem_1fr_auto]">
              <SelectField label="Fuel" value={row.fuel} onChange={(e) => setRow({ ...row, fuel: e.target.value as FuelType })}>
                <option value="diesel">Diesel</option>
                <option value="petrol">Petrol</option>
              </SelectField>
              <NumberField label="Price" suffix={`${cur}/L`} value={row.price} onValue={(v) => setRow({ ...row, price: v })} />
              <TextField label="From" type="date" value={row.from} onChange={(e) => setRow({ ...row, from: e.target.value })} />
              <TextField label="Note" value={row.source} onChange={(e) => setRow({ ...row, source: e.target.value })} placeholder="e.g. Nov 2026 announcement" />
              <Button disabled={!(row.price > 0) || !row.from} onClick={() => (saveOwn([...own, { country: country.code, ...row }]), setRow({ ...row, price: 0, source: '' }))}>
                Add price
              </Button>
            </div>
            <div className="mt-4 max-w-xs">{n('fuel_price_per_litre', 'Price when none is listed', `${cur}/L`)}</div>
          </>
        ) : (
          <div className="mt-4 max-w-xs">{n('fuel_price_per_litre', 'Fuel price', `${cur}/L`)}</div>
        )}
      </section>

      <section className="panel p-5" aria-labelledby="c1">
        <h2 id="c1" className="text-base font-semibold">What a driver really costs</h2>
        <p className="mt-1 text-sm text-ink-2">Salary alone under-costs every delivery. Add what you pay on top.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {n('driver_monthly_salary', 'Basic salary', `${cur}/month`, undefined, '1')}
          {n('driver_housing_monthly', 'Housing and allowances', `${cur}/month`, undefined, '1')}
          {n('driver_insurance_yearly', 'Health insurance', `${cur}/year`, undefined, '1')}
          {n('driver_visa_cost', 'Visa, permit and medical', cur, 'Total for one visa.', '1')}
          {n('driver_visa_months', 'Visa valid for', 'months', undefined, '1')}
          {n('gratuity_days_per_year', 'End-of-service gratuity', 'days/year', 'Days of basic salary per year worked.', '1')}
          {n('working_days_per_month', 'Working days', 'per month', undefined, '1')}
          {n('working_hours_per_day', 'Working hours', 'per day', undefined, '0.5')}
        </div>
        <table className="mt-4 w-full max-w-md text-sm">
          <caption className="sr-only">Driver cost per month</caption>
          <tbody className="divide-y divide-line-2">
            {[
              ['Salary', dc.salary],
              ['Housing and allowances', dc.housing],
              ['Visa (per month)', dc.visa],
              ['Insurance (per month)', dc.insurance],
              ['Gratuity set aside', dc.gratuity],
            ].map(([k, v]) => (
              <tr key={k as string}>
                <th scope="row" className="py-1.5 text-start font-normal text-ink-2">
                  {k}
                </th>
                <td className="num py-1.5 text-end">{m(v as number)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <th scope="row" className="py-1.5 text-start">
                Real cost per month
              </th>
              <td className="num py-1.5 text-end">{m(dc.total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-sm text-ink-2">
          That is <span className="num font-medium text-ink">{m(driverCostPerMinute(s) * 60)}</span> per working hour.
        </p>
      </section>

      <section className="panel p-5" aria-labelledby="c4">
        <h2 id="c4" className="text-base font-semibold">Work at the site</h2>
        <p className="mt-1 text-sm text-ink-2">What it costs you when a delivery needs helpers or lifting. Tolls are set on each area.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          {n('helper_cost_per_job', 'Helper', `${cur}/job`)}
          {n('crane_cost_per_job', 'Crane truck (HIAB)', `${cur}/job`)}
          {n('forklift_cost_per_job', 'Forklift', `${cur}/job`)}
          {n('overhead_per_delivery', 'Loading and paperwork', `${cur}/delivery`)}
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="c2">
        <h2 id="c2" className="text-base font-semibold">Driving time</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {n('average_speed_kmh', 'Average speed', 'km/h', undefined, '1')}
          {n('traffic_factor', 'Traffic allowance', '×', '1.2 means 20% slower than free roads.', '0.05')}
          {n('road_factor', 'Road distance factor', '×', 'Roads are longer than a straight line; 1.3 is typical.', '0.05')}
          {n('service_minutes_per_stop', 'Time at each stop', 'minutes', 'Unloading and signing.', '1')}
        </div>
      </section>
      <section className="panel p-5" aria-labelledby="c3">
        <h2 id="c3" className="text-base font-semibold">When a delivery is worth it</h2>
        <p className="mt-1 text-sm text-ink-2">The budget for a delivery is the charge to the customer plus this share of the invoice value.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {n('allowed_cost_pct', 'Share of invoice value', '%', `Example: 3% of a 1,000 ${cur} invoice is 30 ${cur}.`, '0.5')}
          {n('attention_threshold_pct', 'Warn when cost reaches', '% of budget', 'Above this the delivery shows as “attention”.', '1')}
        </div>
      </section>
    </>
  );
}

function PricesTab({ s, n }: { s: OrgSettings; n: NumFn }) {
  const cur = countryOf(s.country).currency;
  const [ex, setEx] = useState({ km: 25, kg: 800, cbm: 2, helpers: 1, equipment: 'none' as 'none' | 'crane' | 'forklift', wait: 60, invoice: 400 });
  const fee = feeByPriceList(s, { one_way_km: ex.km, weight_kg: ex.kg, volume_cbm: ex.cbm, invoice_value: ex.invoice, helpers: ex.helpers, equipment: ex.equipment, wait_minutes: ex.wait });
  const m = (v: number) => formatMoney(v, s);
  return (
    <>
      <section className="panel p-5" aria-labelledby="p1">
        <h2 id="p1" className="text-base font-semibold">Your delivery price list</h2>
        <p className="mt-1 text-sm text-ink-2">Staff see the charge this list gives on every new delivery, next to the charge that covers the cost plus your margin.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {n('fee_base', 'Base fee', cur)}
          {n('fee_per_km', 'Per km (one way)', cur)}
          {n('fee_per_100kg', 'Per 100 kg', cur)}
          {n('fee_per_cbm', 'Per cbm', cur)}
          {n('fee_min', 'Minimum charge', cur)}
          {n('fee_free_over', 'Free delivery over', cur, 'Invoice value. 0 = never free.', '1')}
        </div>
        <h3 className="mt-5 text-sm font-semibold">Extras</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          {n('fee_helper', 'Per helper', cur)}
          {n('fee_crane', 'Crane truck (HIAB)', cur)}
          {n('fee_forklift', 'Forklift', cur)}
          {n('fee_free_wait_minutes', 'Free waiting', 'minutes', undefined, '5')}
          {n('fee_wait_per_hour', 'Waiting after that', `${cur}/hour`)}
          {n('fee_target_margin_pct', 'Target margin', '%', 'Used for the “cost + margin” suggestion.', '1')}
        </div>
      </section>
      <section className="panel p-5" aria-labelledby="p2">
        <h2 id="p2" className="text-base font-semibold">Try it</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <NumberField label="Distance one way" suffix="km" step="1" value={ex.km} onValue={(v) => setEx({ ...ex, km: v })} />
          <NumberField label="Weight" suffix="kg" step="10" value={ex.kg} onValue={(v) => setEx({ ...ex, kg: v })} />
          <NumberField label="Volume" suffix="cbm" step="0.5" value={ex.cbm} onValue={(v) => setEx({ ...ex, cbm: v })} />
          <NumberField label="Invoice value" suffix={cur} step="10" value={ex.invoice} onValue={(v) => setEx({ ...ex, invoice: v })} />
          <NumberField label="Helpers" step="1" value={ex.helpers} onValue={(v) => setEx({ ...ex, helpers: v })} />
          <SelectField label="Lifting" value={ex.equipment} onChange={(e) => setEx({ ...ex, equipment: e.target.value as typeof ex.equipment })}>
            <option value="none">None</option>
            <option value="crane">Crane truck</option>
            <option value="forklift">Forklift</option>
          </SelectField>
          <NumberField label="Waiting" suffix="min" step="15" value={ex.wait} onValue={(v) => setEx({ ...ex, wait: v })} />
        </div>
        <table className="mt-4 w-full max-w-lg text-sm">
          <caption className="sr-only">Charge from the price list</caption>
          <tbody className="divide-y divide-line-2">
            {fee.lines.map((l) => (
              <tr key={l.label}>
                <th scope="row" className="py-1.5 text-start font-normal">
                  {l.label}
                  <span className="block text-xs text-ink-2">{l.detail}</span>
                </th>
                <td className="num py-1.5 text-end align-top">{m(l.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <th scope="row" className="py-1.5 text-start">
                Delivery charge
                {fee.minimum_applied && <span className="block text-xs font-normal text-ink-2">Raised to the minimum</span>}
                {fee.free && <span className="block text-xs font-normal text-ink-2">Free: the invoice is over {m(s.fee_free_over)}</span>}
              </th>
              <td className="num py-1.5 text-end align-top">{m(fee.total)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
