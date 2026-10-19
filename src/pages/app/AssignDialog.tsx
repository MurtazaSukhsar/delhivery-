import { useState } from 'react';
import { post } from '../../lib/api';
import { money } from '../../lib/format';
import { useAction, usePlanningVehicles } from '../../lib/queries';
import { fits, hasShop, vehicleLabel, type Delivery } from '../../lib/domain';
import { Button, Dialog, SelectField } from '../../ui/controls';
import { Notice } from '../../ui/display';
import { useNames } from './ctx';

/** Give one delivery to a driver; it joins their not-yet-started trip that day. */
export function AssignDialog({ delivery, onClose }: { delivery: Delivery; onClose: () => void }) {
  const names = useNames();
  const vehicles = usePlanningVehicles(delivery.shop_id);
  const drivers = names.drivers.filter((d) => d.active && hasShop(d.shop_ids, delivery.shop_id));
  const [driverId, setDriverId] = useState(drivers.find((d) => d.id !== delivery.driver_id)?.id ?? '');
  const vs = vehicles.data ?? [];
  const [vehicleId, setVehicleId] = useState(delivery.vehicle_id);
  const load = { weight_kg: delivery.weight_kg, volume_cbm: delivery.volume_cbm };
  const planned = vs.find((x) => x.id === delivery.plan_vehicle_id && fits(x, load).ok)?.id;
  const vid = vehicleId || planned || vs.find((x) => fits(x, load).ok)?.id || vs[0]?.id || '';
  const moving = !!delivery.driver_id;
  const assign = useAction(() => post(`/deliveries/${delivery.id}/assign`, { driver_id: driverId, vehicle_id: vid }), {
    success: moving ? `${delivery.ref} moved` : `${delivery.ref} assigned`,
    invalidate: ['deliveries', 'delivery'],
  });
  const v = vs.find((x) => x.id === vid);

  return (
    <Dialog
      open
      onClose={onClose}
      title={moving ? `Move ${delivery.ref} to another driver` : `Assign ${delivery.ref}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={assign.isPending} disabled={!driverId || !vid || driverId === delivery.driver_id || (!!v && !fits(v, load).ok)} onClick={() => assign.mutate(undefined, { onSuccess: onClose })}>
            {moving ? 'Move delivery' : 'Assign delivery'}
          </Button>
        </>
      }
    >
      {drivers.length === 0 ? (
        <Notice tone="attention">No active drivers work for this shop. Add one under Team.</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <SelectField label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            {drivers.map((d) => (
              <option key={d.id} value={d.id} disabled={d.id === delivery.driver_id}>
                {d.name} ({d.on_shift ? 'on shift' : 'off shift'}){d.id === delivery.driver_id ? ', current' : ''}
              </option>
            ))}
          </SelectField>
          <SelectField label="Vehicle" value={vid} onChange={(e) => setVehicleId(e.target.value)} hint="If the driver already has a trip that day, its vehicle is used.">
            {vs.map((x) => (
              <option key={x.id} value={x.id}>
                {vehicleLabel(x)} ({x.capacity_kg} kg{x.capacity_cbm > 0 ? `, ${x.capacity_cbm} cbm` : ''})
              </option>
            ))}
          </SelectField>
          {v && !fits(v, load).ok && (
            <Notice tone="attention">
              The load ({delivery.weight_kg} kg, {delivery.volume_cbm} cbm) does not fit {vehicleLabel(v)} ({v.capacity_kg} kg, {v.capacity_cbm} cbm). Choose a bigger vehicle.
            </Notice>
          )}
          {v?.ownership === 'rented' && <p className="text-sm text-ink-2">Hired vehicle: {money(v.rental_per_day)} per day is part of the cost.</p>}
          <p className="text-sm text-ink-2">The driver sees it straight away and must accept it.</p>
        </div>
      )}
    </Dialog>
  );
}
