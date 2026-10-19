import { useMemo, useState } from 'react';
import { post } from '../../lib/api';
import { useAction, usePlanningVehicles } from '../../lib/queries';
import { allocateTripCost, driveMinutes, fits, hasShop, optimiseStops, roadKm, timeInZone, vehicleLabel, type Delivery, type Shop, type Trip } from '../../lib/domain';
import { km, minutes, money } from '../../lib/format';
import { Button, Dialog, SelectField, TextField, cx } from '../../ui/controls';
import { Notice, UrgentTag } from '../../ui/display';
import { MapView, type MapMarker } from '../../ui/MapView';
import { useNames, useOrg } from './ctx';

/** Pick a driver and vehicle for several deliveries; see the best stop order before assigning. */
export function TripDialog({ shop, date, list, onClose, onDone }: { shop: Shop; date: string; list: Delivery[]; onClose: () => void; onDone: () => void }) {
  const { settings: s, today, tz } = useOrg();
  const names = useNames();
  const vehicles = usePlanningVehicles(shop.id);
  const drivers = names.drivers.filter((d) => d.active && hasShop(d.shop_ids, shop.id));
  const weight = list.reduce((a, d) => a + d.weight_kg, 0);
  const cbm = list.reduce((a, d) => a + d.volume_cbm, 0);
  const [driverId, setDriverId] = useState(drivers.find((d) => d.on_shift)?.id ?? drivers[0]?.id ?? '');
  const [vehicleId, setVehicleId] = useState('');
  const vs = vehicles.data ?? [];
  // Start from the vehicle the first delivery was costed on, else the smallest one that carries everything.
  const planned = list.map((d) => d.plan_vehicle_id).find((id) => vs.some((v) => v.id === id && fits(v, { weight_kg: weight, volume_cbm: cbm }).ok));
  const smallest = [...vs].filter((v) => fits(v, { weight_kg: weight, volume_cbm: cbm }).ok).sort((a, b) => Number(a.ownership === 'rented') - Number(b.ownership === 'rented') || a.capacity_kg - b.capacity_kg)[0];
  const vid = vehicleId || planned || smallest?.id || vs[0]?.id || '';
  const vehicle = vs.find((v) => v.id === vid);
  const fit = vehicle ? fits(vehicle, { weight_kg: weight, volume_cbm: cbm }) : null;
  const [start, setStart] = useState(date === today ? timeInZone(tz) : '08:00');

  const pts = useMemo(() => list.map((d) => names.address(d.address_id)).filter((x): x is NonNullable<typeof x> => !!x), [list, names]);
  const plan = useMemo(() => {
    if (pts.length !== list.length) return null;
    const r = optimiseStops(shop, pts, s.road_factor, list.map((d) => d.urgent));
    const mins = driveMinutes(r.distanceKm, s) + s.service_minutes_per_stop * pts.length;
    const naive = driveMinutes(r.naiveDistanceKm, s) + s.service_minutes_per_stop * pts.length;
    const alloc = allocateTripCost(r.distanceKm, mins, shop, r.order.map((i) => pts[i]), vehicle, s);
    const [h, m] = start.split(':').map(Number);
    let clock = h * 60 + m;
    let prev = { lat: shop.lat, lng: shop.lng };
    const etas = r.order.map((i) => {
      clock += driveMinutes(roadKm(prev, pts[i], s.road_factor), s);
      const t = clock;
      clock += s.service_minutes_per_stop;
      prev = pts[i];
      return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(Math.round(t % 60) % 60).padStart(2, '0')}`;
    });
    return { r, mins, naive, alloc, etas, alone: list.reduce((a, d) => a + d.est_cost, 0) };
  }, [pts, list, shop, s, vehicle, start]);

  const order = plan?.r.order.join(',') ?? '';
  const markers: MapMarker[] = useMemo(
    () => (plan ? [{ id: 'w', lat: shop.lat, lng: shop.lng, label: shop.name, kind: 'warehouse' as const }, ...plan.r.order.map((i, n) => ({ id: list[i].id, lat: pts[i].lat, lng: pts[i].lng, label: `${n + 1}. ${names.customer(list[i].customer_id)?.name ?? ''}`, kind: 'stop' as const, text: String(n + 1) }))] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, shop, pts],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (plan ? [{ id: 'r', points: [shop, ...plan.r.order.map((i) => pts[i]), shop] }] : []), [order, shop, pts]);

  const create = useAction(() => post<Trip>('/trips', { shop_id: shop.id, date, driver_id: driverId, vehicle_id: vid, delivery_ids: list.map((d) => d.id), start_time: start }), {
    success: `Trip assigned to ${drivers.find((d) => d.id === driverId)?.name ?? 'the driver'}`,
    invalidate: ['deliveries', 'delivery'],
  });
  const late = plan ? plan.r.order.filter((i, n) => list[i].timing === 'window' && plan.etas[n] > list[i].window_to).length : 0;

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Plan a trip with ${list.length} ${list.length === 1 ? 'delivery' : 'deliveries'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={create.isPending} disabled={!plan || !driverId || !vid || !fit?.ok} onClick={() => create.mutate(undefined, { onSuccess: () => (onDone(), onClose()) })}>
            Assign trip
          </Button>
        </>
      }
    >
      {drivers.length === 0 && <Notice tone="attention" className="mb-4">No active drivers work for {shop.name}. Add one under Team.</Notice>}
      {vs.length === 0 && !vehicles.isLoading && <Notice tone="attention" className="mb-4">{shop.name} has no vehicles in use. Add one under Vehicles.</Notice>}
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.on_shift ? '' : ' (off shift)'}
            </option>
          ))}
        </SelectField>
        <SelectField label="Vehicle" value={vid} onChange={(e) => setVehicleId(e.target.value)}>
          {vs.map((v) => (
            <option key={v.id} value={v.id}>
              {vehicleLabel(v)} ({v.capacity_kg} kg{v.capacity_cbm > 0 ? `, ${v.capacity_cbm} cbm` : ''})
            </option>
          ))}
        </SelectField>
        <TextField label="Leaves at" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      {vehicle && fit && (
        <p className={cx('mt-3 text-sm', fit.ok ? 'text-ink-2' : 'font-medium text-loss')}>
          Load {weight.toLocaleString()} kg of {vehicle.capacity_kg.toLocaleString()} kg
          {vehicle.capacity_cbm > 0 && `, ${cbm.toLocaleString()} cbm of ${vehicle.capacity_cbm.toLocaleString()} cbm`}.
          {!fit.ok && ' It does not fit: pick a bigger vehicle or split the trip.'}
          {vehicle.ownership === 'rented' && ` Hired vehicle: ${money(vehicle.rental_per_day)} per day.`}
        </p>
      )}
      {late > 0 && <Notice tone="attention" className="mt-4">{late === 1 ? 'One stop is' : `${late} stops are`} expected after the customer’s time window. Leave earlier or split the trip.</Notice>}
      {plan && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Best stop order</h3>
            <ol className="mt-2 flex flex-col divide-y divide-line-2 rounded-lg border border-line">
              {plan.r.order.map((i, n) => {
                const d = list[i];
                return (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">{n + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{names.customer(d.customer_id)?.name}</p>
                      <p className="text-xs text-ink-2">
                        Arrive about {plan.etas[n]}
                        {d.timing === 'window' && `, window until ${d.window_to}`}
                      </p>
                    </div>
                    {d.urgent && <UrgentTag />}
                    <span className="num text-xs text-ink-2">{money(plan.alloc.shares[n])}</span>
                  </li>
                );
              })}
            </ol>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-2">Trip distance</dt>
              <dd className="num text-end font-medium">{km(plan.r.distanceKm)}</dd>
              <dt className="text-ink-2">Trip time</dt>
              <dd className="text-end font-medium">{minutes(plan.mins)}</dd>
              <dt className="text-ink-2">Trip cost</dt>
              <dd className="num text-end font-medium">{money(plan.alloc.total)}</dd>
              <dt className="text-ink-2">Same deliveries sent one by one</dt>
              <dd className="num text-end">{money(plan.alone)}</dd>
            </dl>
            {plan.r.naiveDistanceKm - plan.r.distanceKm > 0.5 ? (
              <Notice tone="good" className="mt-3">Saves {km(plan.r.naiveDistanceKm - plan.r.distanceKm)} and {minutes(plan.naive - plan.mins)} against visiting the nearest customer first.</Notice>
            ) : (
              <p className="mt-3 text-xs text-ink-2">This order matches the simple nearest-first order.</p>
            )}
            <p className="mt-2 text-xs text-ink-3">{plan.r.method === 'exact' ? `Checked all ${plan.r.evaluated.toLocaleString()} possible orders.` : 'Calculated with a fast method for larger trips.'} Urgent stops come first.</p>
          </div>
          <MapView label="Map of the planned trip; the same stops are listed in order" markers={markers} lines={lines} height={360} />
        </div>
      )}
    </Dialog>
  );
}
