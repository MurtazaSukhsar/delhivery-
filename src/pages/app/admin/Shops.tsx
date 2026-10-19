import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { patch, post } from '../../../lib/api';
import { useAction, useShops } from '../../../lib/queries';
import { countryOf, type Shop } from '../../../lib/domain';
import { Button, Checkbox, Dialog, IconButton, NumberField, Segmented, SelectField, TextField, cx } from '../../../ui/controls';
import { EmptyState, Notice, SubHeader } from '../../../ui/display';
import { MapView } from '../../../ui/MapView';
import { useOrg } from '../ctx';

const MUSCAT = { lat: 23.588, lng: 58.3829 };

export default function Shops() {
  const { role } = useOrg();
  const shops = useShops();
  const [editing, setEditing] = useState<Partial<Shop> | null>(null);
  if (role !== 'org_admin') return <Notice tone="attention">Only organisation admins manage shops.</Notice>;
  const list = shops.data ?? [];

  return (
    <>
      <SubHeader
        title="Shops and warehouses"
        description="Each shop has its own deliveries, vehicles and drivers. Deliveries leave from the shop’s location."
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing({ kind: 'shop', active: true, ...MUSCAT })}>
            Add shop
          </Button>
        }
      />
      {shops.error && <Notice tone="loss">{shops.error.message}</Notice>}
      {shops.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : list.length === 0 ? (
        <div className="panel">
          <EmptyState title="No shops yet" body="Add the first shop or warehouse that sends deliveries." />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ul className="flex flex-col gap-3">
            {list.map((s) => (
              <li key={s.id} className={cx('panel flex items-start gap-3 px-5 py-4', !s.active && 'opacity-70')}>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{s.name}</h2>
                  <p className="text-sm text-ink-2">
                    {s.kind === 'warehouse' ? 'Warehouse' : 'Shop'}
                    {s.address && `, ${s.address}`}
                    {!s.active && ', closed'}
                  </p>
                  {s.phone && <p className="num text-sm text-ink-2">{s.phone}</p>}
                </div>
                <IconButton label={`Edit ${s.name}`} icon={<Pencil size={17} />} onClick={() => setEditing(s)} />
              </li>
            ))}
          </ul>
          <MapView label="Map of shop locations; the same shops are listed beside it" markers={list.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, label: s.name, kind: 'warehouse' as const }))} height={380} />
        </div>
      )}
      {editing && <ShopDialog shop={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ShopDialog({ shop: init, onClose }: { shop: Partial<Shop>; onClose: () => void }) {
  const { settings } = useOrg();
  const [s, setS] = useState(init);
  const set = <K extends keyof Shop>(k: K, v: Shop[K]) => setS((p) => ({ ...p, [k]: v }));
  const save = useAction((body: Partial<Shop>) => (init.id ? patch(`/shops/${init.id}`, body) : post('/shops', body)), { success: 'Shop saved', invalidate: ['shops', 'me'] });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : 'Add shop'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(s, { onSuccess: onClose })}>
            Save shop
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <TextField label="Name" value={s.name ?? ''} onChange={(e) => set('name', e.target.value)} required />
          <Segmented legend="Type" value={(s.kind ?? 'shop') as 'shop' | 'warehouse'} onChange={(k) => set('kind', k)} options={[{ value: 'shop', label: 'Shop' }, { value: 'warehouse', label: 'Warehouse' }]} />
          <TextField label="Address" value={s.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          <TextField label="Phone" type="tel" value={s.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          <SelectField label="City" value={s.city ?? ''} onChange={(e) => set('city', e.target.value)} hint="For truck-ban warnings.">
            <option value="">Same as the company ({settings.city})</option>
            {countryOf(settings.country).cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Latitude" step="0.0001" value={s.lat ?? 0} onValue={(n) => set('lat', n)} />
            <NumberField label="Longitude" step="0.0001" value={s.lng ?? 0} onValue={(n) => set('lng', n)} />
          </div>
          {init.id && <Checkbox label="Open" hint="Closed shops are hidden from everyone’s shop list." checked={s.active ?? true} onChange={(v) => set('active', v)} />}
        </div>
        <div>
          <p className="mb-2 text-sm text-ink-2">Click the map to set where deliveries leave from, or type the coordinates.</p>
          <MapView label="Pick the shop location" markers={s.lat != null && s.lng != null ? [{ id: 's', lat: s.lat, lng: s.lng, label: s.name || 'Shop', kind: 'warehouse' }] : []} onPick={(p) => setS((x) => ({ ...x, lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) }))} height={340} />
        </div>
      </div>
    </Dialog>
  );
}
