import { useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { post, patch } from '../../lib/api';
import { useAction, useAreas, type CustomerWithAddresses } from '../../lib/queries';
import type { Address } from '../../lib/domain';
import { Button, Dialog, SelectField, TextField } from '../../ui/controls';
import { Notice } from '../../ui/display';
import { MapView } from '../../ui/MapView';

type Draft = Omit<CustomerWithAddresses, 'created_at' | 'created_by'>;
type AddrDraft = Address & { _new?: boolean };

export function CustomerDialog({ initial, onClose, onSaved }: { initial: CustomerWithAddresses | null; onClose: () => void; onSaved?: (c: CustomerWithAddresses) => void }) {
  const areas = useAreas();
  const [c, setC] = useState<Draft>(initial ?? { id: '', name: '', contact_name: '', phone: '', addresses: [] });
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction(
    (body: Draft) => (initial ? patch<CustomerWithAddresses>(`/customers/${initial.id}`, body) : post<CustomerWithAddresses>('/customers', body)),
    { success: 'Customer saved', invalidate: ['customers'] },
  );

  const addAddress = () => {
    const ar = areas.data?.[0];
    const a: AddrDraft = { id: `new-${Date.now()}`, _new: true, customer_id: c.id, label: c.addresses.length ? `Site ${c.addresses.length + 1}` : 'Main address', line: '', area_id: ar?.id ?? '', lat: ar?.lat ?? 23.59, lng: ar?.lng ?? 58.38 };
    setC({ ...c, addresses: [...c.addresses, a] });
    setPinFor(a.id);
  };
  const patchAddr = (id: string, p: Partial<Address>) => setC({ ...c, addresses: c.addresses.map((a) => (a.id === id ? { ...a, ...p } : a)) });

  function submit() {
    const e: Record<string, string> = {};
    if (!c.name.trim()) e.name = 'Enter the customer name.';
    if (!/^\+?[\d\s-]{7,}$/.test(c.phone.trim())) e.phone = 'Enter a phone number, for example +968 9911 0001.';
    if (!c.addresses.length) e.addresses = 'Add at least one delivery address.';
    c.addresses.forEach((a) => {
      if (!a.line.trim()) e['line-' + a.id] = 'Enter the address or directions.';
    });
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = { ...c, addresses: c.addresses.map((a) => ((a as AddrDraft)._new ? { ...a, id: undefined, _new: undefined } : a)) } as Draft;
    save.mutate(body, {
      onSuccess: (saved) => {
        onSaved?.(saved);
        onClose();
      },
    });
  }

  const pinned = c.addresses.find((a) => a.id === pinFor);
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'New customer'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} busy={save.isPending}>
            Save customer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Customer or company name" className="sm:col-span-3" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} error={errors.name} required />
        <TextField label="Contact person" className="sm:col-span-2" value={c.contact_name} onChange={(e) => setC({ ...c, contact_name: e.target.value })} />
        <TextField label="Phone" type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} error={errors.phone} required hint="For driver calls and SMS." />
      </div>
      <fieldset className="mt-6">
        <legend className="text-base font-semibold">Delivery addresses</legend>
        <p className="text-sm text-ink-2">Pin each address on the map so costs and routes are right.</p>
        {errors.addresses && <Notice tone="loss" className="mt-2">{errors.addresses}</Notice>}
        <ul className="mt-3 flex flex-col gap-3">
          {c.addresses.map((a, i) => (
            <li key={a.id} className="rounded-lg border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr_1fr_auto] sm:items-end">
                <TextField label={`Address ${i + 1} name`} value={a.label} onChange={(e) => patchAddr(a.id, { label: e.target.value })} />
                <TextField label="Address or directions" value={a.line} onChange={(e) => patchAddr(a.id, { line: e.target.value })} error={errors['line-' + a.id]} required />
                <SelectField
                  label="Delivery area"
                  value={a.area_id}
                  onChange={(e) => {
                    const ar = areas.data?.find((x) => x.id === e.target.value);
                    patchAddr(a.id, { area_id: e.target.value, ...(ar ? { lat: ar.lat, lng: ar.lng } : {}) });
                  }}
                >
                  <option value="">No area</option>
                  {areas.data?.map((ar) => (
                    <option key={ar.id} value={ar.id}>
                      {ar.name}
                    </option>
                  ))}
                </SelectField>
                <Button icon={<MapPin size={16} />} onClick={() => setPinFor(pinFor === a.id ? null : a.id)} aria-expanded={pinFor === a.id}>
                  {pinFor === a.id ? 'Done' : 'Pin'}
                </Button>
              </div>
              <p className="num mt-2 text-xs text-ink-2">
                Location {a.lat.toFixed(5)}, {a.lng.toFixed(5)}
              </p>
            </li>
          ))}
        </ul>
        <Button className="mt-3" icon={<Plus size={16} />} onClick={addAddress}>
          Add address
        </Button>
      </fieldset>
      {pinned && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Click the map where “{pinned.label}” is.</p>
          <MapView label={`Map for choosing where ${pinned.label} is`} markers={[{ id: pinned.id, lat: pinned.lat, lng: pinned.lng, label: pinned.label, kind: 'pin' }]} onPick={(p) => patchAddr(pinned.id, p)} height={280} />
        </div>
      )}
    </Dialog>
  );
}
