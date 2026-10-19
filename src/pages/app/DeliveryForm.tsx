import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { post, patch } from '../../lib/api';
import { useAction, useAreas, useDelivery, usePlanningVehicles, type CustomerWithAddresses } from '../../lib/queries';
import { can, isReassignable, type CollectType, type Delivery, type Equipment, type OrderLine } from '../../lib/domain';
import { currencyCode, money } from '../../lib/format';
import { Button, Checkbox, IconButton, NumberField, Segmented, SelectField, TextArea, TextField } from '../../ui/controls';
import { Notice, PageHeader } from '../../ui/display';
import { Calculation, usePlan } from './Calculation';
import { CustomerDialog } from './CustomerDialog';
import { useNames, useOrg } from './ctx';

type Form = Pick<Delivery, 'shop_id' | 'doc_kind' | 'doc_number' | 'invoice_value' | 'delivery_charge' | 'customer_id' | 'address_id' | 'date' | 'timing' | 'window_from' | 'window_to' | 'urgent' | 'collect_type' | 'collect_amount' | 'collect_note' | 'weight_kg' | 'volume_cbm' | 'plan_vehicle_id' | 'notes' | 'helpers' | 'equipment' | 'wait_minutes'> & { items: OrderLine[] };

export default function DeliveryForm() {
  const { id } = useParams();
  const existing = useDelivery(id ?? '');
  if (id && existing.isLoading) return <p className="text-ink-2">Loading…</p>;
  if (id && existing.error) return <Notice tone="loss">{existing.error.message}</Notice>;
  return <FormInner key={id ?? 'new'} existing={id ? existing.data?.delivery : undefined} />;
}

function FormInner({ existing }: { existing?: Delivery }) {
  const { role, settings, today, shops, defaultShop } = useOrg();
  const names = useNames();
  const areas = useAreas();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState<Form>(() =>
    existing
      ? { ...existing, items: parseItems(existing.lines) }
      : {
          shop_id: defaultShop,
          doc_kind: 'DO',
          doc_number: '',
          invoice_value: 0,
          delivery_charge: 0,
          customer_id: params.get('customer') ?? '',
          address_id: '',
          date: today,
          timing: 'flexible',
          window_from: '09:00',
          window_to: '12:00',
          urgent: false,
          collect_type: 'none',
          collect_amount: 0,
          collect_note: '',
          weight_kg: 0,
          volume_cbm: 0,
          plan_vehicle_id: '',
          notes: '',
          helpers: 0,
          equipment: 'none',
          wait_minutes: 0,
          items: [],
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newCustomer, setNewCustomer] = useState(false);
  const vehicles = usePlanningVehicles(f.shop_id || 'all', !!f.shop_id && can(role, 'deliveries.plan'));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const customer = names.customer(f.customer_id);
  const addresses = customer?.addresses ?? [];
  const addressId = f.address_id || addresses[0]?.id || '';
  const address = addresses.find((a) => a.id === addressId);
  const shop = shops.find((s) => s.id === f.shop_id);
  const area = areas.data?.find((a) => a.id === address?.area_id);
  const extras = { helpers: f.helpers || 0, equipment: f.equipment || 'none', wait_minutes: f.wait_minutes || 0, toll: area?.toll_per_trip || 0 };
  const plan = usePlan({ shop, address, weight: f.weight_kg, cbm: f.volume_cbm, invoice: f.invoice_value, charge: f.delivery_charge, vehicles: vehicles.data ?? [], settings, pick: f.plan_vehicle_id, extras, date: f.date });
  const setItem = (i: number, patch: Partial<OrderLine>) => setF((p) => ({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const save = useAction(
    (body: Form) => (existing ? patch<Delivery>(`/deliveries/${existing.id}`, body) : post<Delivery>('/deliveries', body)),
    { success: (d) => (existing ? `${d.ref} saved` : `${d.ref} created`), invalidate: ['deliveries', 'delivery'] },
  );

  if (!can(role, 'deliveries.create')) return <Notice tone="attention">Your role cannot create or change deliveries.</Notice>;
  if (!shops.length) return <Notice tone="attention">There are no shops yet. An organisation admin adds them under Shops.</Notice>;
  const locked = existing && !isReassignable(existing.status);

  function submit(e: FormEvent, another = false) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!f.shop_id) er.shop = 'Choose the shop.';
    if (!f.customer_id) er.customer = 'Choose a customer.';
    if (!addressId) er.address = 'Choose a delivery address.';
    if (!f.doc_number.trim()) er.doc = 'Enter the DO or invoice number.';
    if (f.timing === 'window' && f.window_from >= f.window_to) er.window = 'The end time must be after the start time.';
    if ((f.collect_type === 'cash' || f.collect_type === 'cheque') && f.collect_amount <= 0) er.collect = 'Enter the amount to collect.';
    f.items.forEach((l, i) => {
      if (l.d.trim() && !(l.q > 0)) er[`item${i}`] = 'Enter a quantity.';
    });
    setErrors(er);
    if (Object.keys(er).length) {
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    if (f.weight_kg > 0 && !plan.chosen && plan.options.length > 0) {
      setErrors({ load: 'No vehicle carries this load. Add a hire option under Vehicles, or reduce the load.' });
      return;
    }
    const { items, ...rest } = f;
    save.mutate(
      { ...rest, lines: JSON.stringify(items.filter((l) => l.d.trim()).map((l) => ({ ...l, d: l.d.trim() }))), address_id: addressId, doc_number: f.doc_number.trim(), plan_vehicle_id: plan.chosen?.vehicle.id ?? '' } as unknown as Form,
      {
        onSuccess: (d) => {
          if (another) {
            setF((p) => ({ ...p, doc_number: '', customer_id: '', address_id: '', invoice_value: 0, delivery_charge: 0, notes: '', collect_type: 'none', collect_amount: 0, collect_note: '', urgent: false, weight_kg: 0, volume_cbm: 0, plan_vehicle_id: '', helpers: 0, equipment: 'none', wait_minutes: 0, items: [] }));
            window.scrollTo({ top: 0 });
          } else nav(`/app/deliveries/${d.id}`);
        },
      },
    );
  }

  const collect: { value: CollectType; label: string }[] = [
    { value: 'none', label: 'Nothing' },
    { value: 'cash', label: 'Cash' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'documents', label: 'Documents' },
  ];

  return (
    <>
      <PageHeader title={existing ? `Edit ${existing.ref}` : 'New delivery'} description={existing ? undefined : 'Fill in the order and see what it costs before anyone is assigned.'} />
      {locked && <Notice tone="attention" className="mb-4">This delivery has left the shop, so it can no longer be changed.</Notice>}
      <form onSubmit={(e) => submit(e)} noValidate className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_28rem]">
        <fieldset disabled={!!locked} className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="s1" className="panel p-5">
            <h2 id="s1" className="mb-4 text-base font-semibold">
              Customer
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {shops.length > 1 && (
                <SelectField label="Shop sending it" className="sm:col-span-2" value={f.shop_id} onChange={(e) => set('shop_id', e.target.value)} error={errors.shop} required>
                  <option value="">Choose a shop</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </SelectField>
              )}
              <div className="flex flex-col gap-2">
                <SelectField
                  label="Customer"
                  required
                  value={f.customer_id}
                  error={errors.customer}
                  onChange={(e) => {
                    const c = names.customer(e.target.value);
                    const ad = c?.addresses[0];
                    const ar = areas.data?.find((x) => x.id === ad?.area_id);
                    setF((p) => ({ ...p, customer_id: e.target.value, address_id: ad?.id ?? '', delivery_charge: p.delivery_charge || ar?.default_charge || 0 }));
                  }}
                >
                  <option value="">{names.loading ? 'Loading customers…' : 'Choose a customer'}</option>
                  {names.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectField>
                <Button variant="quiet" size="sm" icon={<UserPlus size={16} />} className="self-start" onClick={() => setNewCustomer(true)}>
                  Add a new customer
                </Button>
              </div>
              <SelectField label="Delivery address" required value={addressId} error={errors.address} onChange={(e) => set('address_id', e.target.value)} disabled={!customer}>
                <option value="">{customer ? 'Choose an address' : 'Choose a customer first'}</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}: {a.line}
                  </option>
                ))}
              </SelectField>
            </div>
            {customer && (
              <p className="mt-3 text-sm text-ink-2">
                Contact {customer.contact_name || 'not set'}, <span className="num">{customer.phone}</span>
                {area && `. Area ${area.name}, usual charge ${money(area.default_charge)}${area.toll_per_trip ? `, tolls ${money(area.toll_per_trip)}` : ''}`}
              </p>
            )}
          </section>

          <section aria-labelledby="s2" className="panel p-5">
            <h2 id="s2" className="mb-4 text-base font-semibold">
              Order, load and charge
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Segmented legend="Document type" value={f.doc_kind} onChange={(v) => set('doc_kind', v)} options={[{ value: 'DO', label: 'Delivery order' }, { value: 'Invoice', label: 'Invoice' }]} />
              <TextField label={f.doc_kind === 'DO' ? 'DO number' : 'Invoice number'} required value={f.doc_number} error={errors.doc} onChange={(e) => set('doc_number', e.target.value)} />
              <NumberField label="Invoice value" suffix={currencyCode()} min={0} value={f.invoice_value} onValue={(n) => set('invoice_value', n)} hint="Value of the goods, used to judge an acceptable delivery cost." />
              <NumberField label="Delivery charge" suffix={currencyCode()} min={0} value={f.delivery_charge} onValue={(n) => set('delivery_charge', n)} hint="Leave at 0 for free delivery." />
              <NumberField label="Weight" suffix="kg" step="1" min={0} value={f.weight_kg} onValue={(n) => set('weight_kg', n)} error={errors.load} />
              <NumberField label="Volume" suffix="cbm" step="0.1" min={0} value={f.volume_cbm} onValue={(n) => set('volume_cbm', n)} hint="Cubic metres the goods take up." />
            </div>
          </section>

          <section aria-labelledby="s3" className="panel p-5">
            <h2 id="s3" className="mb-4 text-base font-semibold">
              Timing
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="Delivery date" type="date" required value={f.date} min={existing ? undefined : today} onChange={(e) => set('date', e.target.value)} />
              <Segmented className="lg:col-span-3" legend="Time" value={f.timing} onChange={(v) => set('timing', v)} options={[{ value: 'flexible', label: 'Any time that day' }, { value: 'window', label: 'Between set times' }]} />
              {f.timing === 'window' && (
                <>
                  <TextField label="From" type="time" value={f.window_from} onChange={(e) => set('window_from', e.target.value)} />
                  <TextField label="To" type="time" value={f.window_to} onChange={(e) => set('window_to', e.target.value)} error={errors.window} />
                </>
              )}
            </div>
            <div className="mt-4 rounded-md border border-line p-3">
              <Checkbox label="Urgent delivery" hint="Shown first to the office and placed early in the driver's route." checked={f.urgent} onChange={(v) => set('urgent', v)} />
            </div>
          </section>

          <section aria-labelledby="s5" className="panel p-5">
            <h2 id="s5" className="text-base font-semibold">
              Work at the site
            </h2>
            <p className="mb-4 mt-1 text-sm text-ink-2">Helpers, lifting and waiting cost money. They are added to the cost and the price.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Helpers" step="1" min={0} value={f.helpers} onValue={(n) => set('helpers', Math.max(0, Math.round(n)))} />
              <SelectField label="Lifting" value={f.equipment} onChange={(e) => set('equipment', e.target.value as Equipment)}>
                <option value="none">None</option>
                <option value="crane">Crane truck (HIAB)</option>
                <option value="forklift">Forklift</option>
              </SelectField>
              <NumberField label="Expected waiting" suffix="min" step="15" min={0} value={f.wait_minutes} onValue={(n) => set('wait_minutes', Math.max(0, Math.round(n)))} />
            </div>
          </section>

          <section aria-labelledby="s6" className="panel p-5">
            <h2 id="s6" className="text-base font-semibold">
              Items (optional)
            </h2>
            <p className="mb-3 mt-1 text-sm text-ink-2">With items, the driver confirms each one at the drop: delivered, damaged or returned.</p>
            {f.items.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                {f.items.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
                    <TextField label={i === 0 ? 'Item' : `Item ${i + 1}`} value={l.d} onChange={(e) => setItem(i, { d: e.target.value })} placeholder="e.g. Cement 50 kg" />
                    <NumberField label="Qty" step="1" min={0} value={l.q} onValue={(n) => setItem(i, { q: n })} error={errors[`item${i}`]} />
                    <TextField label="Unit" value={l.u} onChange={(e) => setItem(i, { u: e.target.value })} placeholder="bags" />
                    <IconButton label={`Remove item ${i + 1}`} icon={<Trash2 size={16} />} onClick={() => setF((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))} />
                  </div>
                ))}
              </div>
            )}
            <Button size="sm" icon={<Plus size={16} />} onClick={() => setF((p) => ({ ...p, items: [...p.items, { d: '', q: 1, u: '' }] }))}>
              Add item
            </Button>
          </section>

          <section aria-labelledby="s4" className="panel p-5">
            <h2 id="s4" className="mb-4 text-base font-semibold">
              Collection and notes
            </h2>
            <div className="grid gap-4 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
              <Segmented legend="Driver must collect" value={f.collect_type} onChange={(v) => setF((p) => ({ ...p, collect_type: v, collect_amount: v === 'cash' || v === 'cheque' ? p.collect_amount || p.invoice_value + p.delivery_charge : 0 }))} options={collect} />
              {(f.collect_type === 'cash' || f.collect_type === 'cheque') && <NumberField label="Amount to collect" suffix={currencyCode()} value={f.collect_amount} onValue={(n) => set('collect_amount', n)} error={errors.collect} />}
              {f.collect_type !== 'none' && <TextField label={f.collect_type === 'documents' ? 'Which documents' : 'Note for the driver'} value={f.collect_note} onChange={(e) => set('collect_note', e.target.value)} />}
            </div>
            <TextArea className="mt-4" label="Notes for the driver" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Gate number, who to ask for, unloading equipment" />
          </section>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="lg" busy={save.isPending}>
              {existing ? 'Save changes' : 'Create delivery'}
            </Button>
            {!existing && (
              <Button size="lg" onClick={(e) => submit(e as unknown as FormEvent, true)} disabled={save.isPending}>
                Create and add another
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={() => nav(-1)}>
              Cancel
            </Button>
          </div>
        </fieldset>
        <div>
          <Calculation
            shop={shop}
            address={address}
            weight={f.weight_kg}
            cbm={f.volume_cbm}
            plan={plan}
            settings={settings}
            onPick={(id) => set('plan_vehicle_id', id)}
            isAdmin={role === 'org_admin'}
            fee={{ extras, invoice: f.invoice_value, charge: f.delivery_charge, onUse: (v) => set('delivery_charge', v), customer: customer?.name ?? '', doc: f.doc_number ? `${f.doc_kind} ${f.doc_number}` : '' }}
            when={{ date: f.date, from: f.timing === 'window' ? f.window_from : undefined, to: f.timing === 'window' ? f.window_to : undefined }}
          />
        </div>
      </form>
      {newCustomer && (
        <CustomerDialog
          initial={null}
          onClose={() => setNewCustomer(false)}
          onSaved={(c: CustomerWithAddresses) => {
            const ad = c.addresses[0];
            const ar = areas.data?.find((x) => x.id === ad?.area_id);
            setF((p) => ({ ...p, customer_id: c.id, address_id: ad?.id ?? '', delivery_charge: p.delivery_charge || ar?.default_charge || 0 }));
          }}
        />
      )}
    </>
  );
}

function parseItems(json: string): OrderLine[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
