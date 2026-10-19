import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { post, patch } from '../../lib/api';
import { useAction, useVehicleCosts, useVehicles, type VehicleWithDocs } from '../../lib/queries';
import { addDays, can, type DocumentType, type Vehicle, type VehicleCost, type VehicleCostKind, type VehicleDocument } from '../../lib/domain';
import { currencyCode, dateLabel, daysUntil, money } from '../../lib/format';
import { Button, Checkbox, Dialog, IconButton, NumberField, Segmented, SelectField, TextField, cx } from '../../ui/controls';
import { EmptyState, Notice, PageHeader } from '../../ui/display';
import { useOrg } from './ctx';

const DOC_LABEL: Record<DocumentType, string> = { registration: 'Registration (Mulkiya)', insurance: 'Insurance', permit: 'Permit or rental contract', inspection: 'Inspection', other: 'Other' };

function docState(expiry: string, today: string) {
  const d = daysUntil(expiry, today);
  if (d < 0) return { text: `Expired ${-d} days ago`, cls: 'bg-loss-soft text-loss', rank: 0 };
  if (d <= 30) return { text: d === 0 ? 'Expires today' : `${d} days left`, cls: 'bg-attention-soft text-attention', rank: 1 };
  return { text: 'Valid', cls: 'bg-good-soft text-good', rank: 2 };
}

export default function Vehicles() {
  const { role, shop, shops, shopName, today, defaultShop } = useOrg();
  const vehicles = useVehicles(shop);
  const edit = can(role, 'vehicles.manage');
  const [editV, setEditV] = useState<Partial<Vehicle> | null>(null);
  const [editD, setEditD] = useState<Partial<VehicleDocument> | null>(null);
  const del = useAction((d: VehicleDocument) => patch(`/vehicle-documents/${d.id}`, { deleted: true }), { success: 'Document removed', invalidate: ['vehicles'] });

  const list = vehicles.data ?? [];
  const own = list.filter((v) => v.ownership === 'owned' || v.plate);
  const hire = list.filter((v) => v.ownership === 'rented' && !v.plate);
  const alerts = own.flatMap((v) => v.documents.filter((d) => daysUntil(d.expiry, today) <= 30).map((d) => ({ v, d })));
  const blank: Partial<Vehicle> = { shop_id: defaultShop, type: 'Pickup', ownership: 'owned', capacity_kg: 1000, capacity_cbm: 3, fuel_use: 12, maintenance_per_km: 0.03, rental_per_day: 0, active: true };

  return (
    <>
      <PageHeader
        title="Vehicles"
        description="What each vehicle carries and costs to run. When an order is too big for your own vehicles, a hire option is used and its daily price is added to the cost."
        actions={
          edit && (
            <>
              <Button icon={<Plus size={18} />} onClick={() => setEditV({ ...blank, ownership: 'rented', shop_id: '*', plate: '', type: 'Truck 10t', capacity_kg: 10000, capacity_cbm: 60, fuel_use: 28, rental_per_day: 65 })}>
                Add hire option
              </Button>
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditV(blank)}>
                Add vehicle
              </Button>
            </>
          )
        }
      />
      {vehicles.error && <Notice tone="loss">{vehicles.error.message}</Notice>}
      {alerts.length > 0 && (
        <Notice tone="attention" className="mb-4">
          {alerts.length === 1 ? 'One document needs attention' : `${alerts.length} documents need attention`}: {alerts.slice(0, 3).map(({ v, d }) => `${v.plate} ${DOC_LABEL[d.type].split(' (')[0].toLowerCase()} (${docState(d.expiry, today).text.toLowerCase()})`).join(', ')}
          {alerts.length > 3 ? '…' : '.'}
        </Notice>
      )}
      {vehicles.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : list.length === 0 ? (
        <div className="panel">
          <EmptyState title="No vehicles yet" body={edit ? 'Add the vehicles you deliver with, and a hire option for big orders.' : 'Your admin adds vehicles here.'} />
        </div>
      ) : (
        <>
          <h2 className="mb-2 text-base font-semibold">Our vehicles</h2>
          {own.length === 0 ? (
            <p className="mb-6 text-sm text-ink-2">None yet.</p>
          ) : (
            <ul className="mb-8 flex flex-col gap-3">
              {own.map((v: VehicleWithDocs) => (
                <li key={v.id} className={cx('panel', !v.active && 'opacity-70')}>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <h3 className="num text-base font-semibold">{v.plate}</h3>
                      <p className="text-sm text-ink-2">
                        {v.type}
                        {v.make && `, ${v.make}`}
                        {shops.length > 1 && `, ${shopName(v.shop_id)}`}
                        {v.ownership === 'rented' && ', hired'}
                        {!v.active && ', not in use'}
                      </p>
                    </div>
                    <Specs v={v} />
                    {edit && <IconButton label={`Edit ${v.plate}`} icon={<Pencil size={17} />} onClick={() => setEditV(v)} />}
                  </div>
                  <details className="border-t border-line-2 px-5 py-3">
                    <summary className="cursor-pointer text-sm font-medium text-primary">
                      Documents ({v.documents.length})
                      {v.documents.some((d) => daysUntil(d.expiry, today) <= 30) && <span className="ms-2 text-attention">needs attention</span>}
                    </summary>
                    {v.documents.length === 0 ? (
                      <p className="mt-2 text-sm text-ink-2">None added.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-line-2 text-sm">
                        {[...v.documents]
                          .sort((a, b) => a.expiry.localeCompare(b.expiry))
                          .map((d) => {
                            const st = docState(d.expiry, today);
                            return (
                              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                                <span className="min-w-0 flex-1">
                                  {DOC_LABEL[d.type]} <span className="num text-ink-2">{d.number}</span>
                                </span>
                                <span className="text-ink-2">Expires {dateLabel(d.expiry)}</span>
                                <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', st.cls)}>{st.text}</span>
                                {edit && (
                                  <span className="flex">
                                    <IconButton label={`Edit ${DOC_LABEL[d.type]}`} icon={<Pencil size={16} />} onClick={() => setEditD(d)} />
                                    <IconButton label={`Remove ${DOC_LABEL[d.type]}`} icon={<Trash2 size={16} />} onClick={() => del.mutate(d)} />
                                  </span>
                                )}
                              </li>
                            );
                          })}
                      </ul>
                    )}
                    {edit && (
                      <Button size="sm" variant="ghost" className="mt-2" icon={<Plus size={15} />} onClick={() => setEditD({ vehicle_id: v.id, type: 'insurance', number: '', expiry: today })}>
                        Add document
                      </Button>
                    )}
                  </details>
                  <CostLog v={v} canAdd={can(role, 'deliveries.plan')} today={today} />
                </li>
              ))}
            </ul>
          )}

          <h2 className="mb-1 text-base font-semibold">Hire when needed</h2>
          <p className="mb-2 text-sm text-ink-2">Not owned: a vehicle you rent for a day when an order is too heavy or bulky for your own. It is only offered when it is the cheapest that fits.</p>
          {hire.length === 0 ? (
            <p className="text-sm text-ink-2">No hire options yet.{edit && ' Add one so large orders can still be costed.'}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {hire.map((v) => (
                <li key={v.id} className={cx('panel flex flex-wrap items-start justify-between gap-3 px-5 py-4', !v.active && 'opacity-70')}>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{v.type} for hire</h3>
                    <p className="text-sm text-ink-2">
                      {v.shop_id === '*' ? 'Every shop' : shopName(v.shop_id)}
                      {!v.active && ', not in use'}
                    </p>
                  </div>
                  <Specs v={v} />
                  {edit && <IconButton label={`Edit ${v.type} for hire`} icon={<Pencil size={17} />} onClick={() => setEditV(v)} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {editV && <VehicleDialog v={editV} onClose={() => setEditV(null)} />}
      {editD && <DocDialog d={editD} onClose={() => setEditD(null)} />}
    </>
  );
}

function Specs({ v }: { v: Vehicle }) {
  const items: [string, string][] = [
    ['Carries', `${v.capacity_kg.toLocaleString()} kg`],
    ['Space', v.capacity_cbm > 0 ? `${v.capacity_cbm} cbm` : 'not set'],
    ['Fuel', `${v.fuel_use} L/100 km`],
    ['Running', `${money(v.maintenance_per_km)}/km`],
  ];
  if (v.ownership === 'rented') items.push(['Hire', `${money(v.rental_per_day)}/day`]);
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {items.map(([k, val]) => (
        <div key={k}>
          <dt className="text-xs text-ink-2">{k}</dt>
          <dd className="num font-medium">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

function VehicleDialog({ v: init, onClose }: { v: Partial<Vehicle>; onClose: () => void }) {
  const { shops, role } = useOrg();
  const [v, setV] = useState(init);
  const set = <K extends keyof Vehicle>(k: K, val: Vehicle[K]) => setV((p) => ({ ...p, [k]: val }));
  const hired = v.ownership === 'rented';
  const save = useAction((body: Partial<Vehicle>) => (init.id ? patch(`/vehicles/${init.id}`, body) : post('/vehicles', body)), { success: 'Vehicle saved', invalidate: ['vehicles', 'vehicles-planning'] });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={init.id ? `Edit ${init.plate || `${init.type} for hire`}` : hired ? 'Add a hire option' : 'Add a vehicle'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(v, { onSuccess: onClose })}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Segmented legend="Is it yours?" className="sm:col-span-3" value={(v.ownership ?? 'owned') as 'owned' | 'rented'} onChange={(o) => setV((p) => ({ ...p, ownership: o, shop_id: o === 'owned' && p.shop_id === '*' ? shops[0]?.id ?? '' : p.shop_id }))} options={[{ value: 'owned', label: 'We own it' }, { value: 'rented', label: 'We hire it when needed' }]} />
        <TextField label="Plate number" value={v.plate ?? ''} onChange={(e) => set('plate', e.target.value)} required={!hired} hint={hired ? 'Leave empty if it is any truck from a rental company.' : undefined} />
        <SelectField label="Type" value={v.type} onChange={(e) => set('type', e.target.value)}>
          {['Motorbike', 'Car', 'Van', 'Pickup', 'Truck 3t', 'Truck 5t', 'Box 7t', 'Truck 10t', ...(v.type && !['Motorbike', 'Car', 'Van', 'Pickup', 'Truck 3t', 'Truck 5t', 'Box 7t', 'Truck 10t'].includes(v.type) ? [v.type] : [])].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </SelectField>
        <TextField label="Make and model" value={v.make ?? ''} onChange={(e) => set('make', e.target.value)} />
        {(shops.length > 1 || hired) && (
          <SelectField label="Used by" value={v.shop_id} onChange={(e) => set('shop_id', e.target.value)}>
            {hired && role === 'org_admin' && <option value="*">Every shop</option>}
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        )}
        {hired && <NumberField label="Hire price per day" suffix={currencyCode()} value={v.rental_per_day ?? 0} onValue={(n) => set('rental_per_day', n)} />}
        <NumberField label="Carries up to" suffix="kg" step="1" value={v.capacity_kg ?? 0} onValue={(n) => set('capacity_kg', n)} />
        <NumberField label="Cargo space" suffix="cbm" step="0.5" value={v.capacity_cbm ?? 0} onValue={(n) => set('capacity_cbm', n)} hint="Cubic metres. Leave 0 to check weight only." />
        <SelectField label="Fuel" value={v.fuel_type ?? 'diesel'} onChange={(e) => set('fuel_type', e.target.value as 'diesel' | 'petrol')}>
          <option value="diesel">Diesel</option>
          <option value="petrol">Petrol</option>
        </SelectField>
        <NumberField label="Fuel use" suffix="L/100 km" step="0.1" value={v.fuel_use ?? 0} onValue={(n) => set('fuel_use', n)} />
        <NumberField label="Wear and maintenance" suffix={`${currencyCode()}/km`} value={v.maintenance_per_km ?? 0} onValue={(n) => set('maintenance_per_km', n)} hint="Tyres, servicing, repairs." />
      </div>
      <Checkbox className="mt-4" label="In use" hint="Vehicles not in use are left out of planning and costing." checked={v.active ?? true} onChange={(a) => set('active', a)} />
    </Dialog>
  );
}

function DocDialog({ d: init, onClose }: { d: Partial<VehicleDocument>; onClose: () => void }) {
  const [d, setD] = useState(init);
  const save = useAction((body: Partial<VehicleDocument>) => (init.id ? patch(`/vehicle-documents/${init.id}`, body) : post('/vehicle-documents', body)), { success: 'Document saved', invalidate: ['vehicles'] });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? 'Edit document' : 'Add document'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(d, { onSuccess: onClose })}>
            Save document
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Document" value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as DocumentType })}>
          {Object.entries(DOC_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
        <TextField label="Document number" value={d.number ?? ''} onChange={(e) => setD({ ...d, number: e.target.value })} />
        <TextField label="Expiry date" type="date" value={d.expiry ?? ''} onChange={(e) => setD({ ...d, expiry: e.target.value })} hint="The Vehicles page warns 30 days before." />
      </div>
    </Dialog>
  );
}

const KIND_LABEL: Record<VehicleCostKind, string> = { fuel: 'Fuel', maintenance: 'Service or repair', tyres: 'Tyres', fine: 'Fine', toll: 'Toll', other: 'Other' };

/** What was really spent on a vehicle: fuel, repairs, tyres, fines. Reports compare it with the estimate. */
function CostLog({ v, canAdd, today }: { v: Vehicle; canAdd: boolean; today: string }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<Partial<VehicleCost> | null>(null);
  const q = useVehicleCosts(v.id, open);
  const del = useAction((c: VehicleCost) => patch(`/vehicle-costs/${c.id}`, { deleted: true }), { success: 'Removed', invalidate: ['vehicle-costs'] });
  const list = q.data ?? [];
  const since = addDays(today, -30);
  const month = list.filter((c) => c.date >= since).reduce((a, c) => a + c.amount, 0);
  return (
    <details className="border-t border-line-2 px-5 py-3" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium text-primary">Running costs{open && list.length > 0 && <span className="ms-2 font-normal text-ink-2">{money(month)} in the last 30 days</span>}</summary>
      {q.isLoading && <p className="mt-2 text-sm text-ink-2">Loading…</p>}
      {!q.isLoading && list.length === 0 && <p className="mt-2 text-sm text-ink-2">Nothing logged yet. Drivers can log fuel from their app.</p>}
      {list.length > 0 && (
        <ul className="mt-2 divide-y divide-line-2 text-sm">
          {list.slice(0, 15).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="w-24 text-ink-2">{dateLabel(c.date)}</span>
              <span className="min-w-0 flex-1">
                {KIND_LABEL[c.kind]}
                {c.litres ? <span className="text-ink-2">, {c.litres} L</span> : null}
                {c.odometer ? <span className="text-ink-2">, {c.odometer.toLocaleString()} km on the clock</span> : null}
                {c.note && <span className="block text-xs text-ink-2">{c.note}</span>}
              </span>
              <span className="num">{money(c.amount)}</span>
              {canAdd && <IconButton label={`Remove ${KIND_LABEL[c.kind].toLowerCase()} of ${dateLabel(c.date)}`} icon={<Trash2 size={16} />} onClick={() => del.mutate(c)} />}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <Button size="sm" variant="ghost" className="mt-2" icon={<Plus size={15} />} onClick={() => setAdding({ vehicle_id: v.id, kind: 'maintenance', date: today, amount: 0, note: '' })}>
          Add cost
        </Button>
      )}
      {adding && <CostDialog c={adding} plate={v.plate} onClose={() => setAdding(null)} />}
    </details>
  );
}

function CostDialog({ c: init, plate, onClose }: { c: Partial<VehicleCost>; plate: string; onClose: () => void }) {
  const [c, setC] = useState(init);
  const save = useAction((x: Partial<VehicleCost>) => post('/vehicle-costs', x), { success: 'Cost added', invalidate: ['vehicle-costs'] });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Add a cost for ${plate}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(c, { onSuccess: onClose })}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="What for" value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value as VehicleCostKind })}>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
        <TextField label="Date" type="date" value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} />
        <NumberField label="Amount" suffix={currencyCode()} value={c.amount ?? 0} onValue={(n) => setC({ ...c, amount: n })} />
        {c.kind === 'fuel' && <NumberField label="Litres" step="0.1" value={c.litres ?? 0} onValue={(n) => setC({ ...c, litres: n || null })} />}
        <NumberField label="Odometer (optional)" step="1" suffix="km" value={c.odometer ?? 0} onValue={(n) => setC({ ...c, odometer: n || null })} />
        <TextField label="Note (optional)" value={c.note ?? ''} onChange={(e) => setC({ ...c, note: e.target.value })} />
      </div>
    </Dialog>
  );
}
