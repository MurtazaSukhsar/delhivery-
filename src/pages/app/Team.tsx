import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { patch, post } from '../../lib/api';
import { useAction, useShops, useStaff } from '../../lib/queries';
import { assignableRoles, can, ROLE_LABEL, shopList, type Role, type Staff } from '../../lib/domain';
import { dateLabel, daysUntil } from '../../lib/format';
import { Button, Checkbox, Dialog, SelectField, TextField, cx } from '../../ui/controls';
import { EmptyState, Notice, PageHeader } from '../../ui/display';
import { useOrg } from './ctx';

const ROLE_HELP: Record<Role, string> = {
  org_admin: 'Runs the company in this system: shops, vehicles, team, settings and history, plus everything staff can do.',
  staff: 'Office work: creates deliveries, sees the cost, assigns drivers and tracks them.',
  driver: 'Uses the driver pages on their phone.',
};

export default function Team() {
  const { role, me, today, shopName } = useOrg();
  const ok = can(role, 'staff.manage');
  const staff = useStaff(ok);
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState('');
  const [editing, setEditing] = useState<Partial<Staff> | null>(null);
  if (!ok || !role || role === 'super_admin') return <Notice tone="attention">Only an admin can manage the team.</Notice>;
  const roles = assignableRoles(role);
  const term = q.trim().toLowerCase();
  const rows = (staff.data ?? [])
    .filter((s) => (!roleF || s.role === roleF) && (!term || `${s.name} ${s.email} ${s.phone}`.toLowerCase().includes(term)))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const shopsText = (ids: string) => {
    const l = shopList(ids);
    return l === '*' ? 'All shops' : l.map(shopName).filter(Boolean).join(', ') || '—';
  };

  return (
    <>
      <PageHeader
        title="Team"
        description="Admins, office staff and drivers: who signs in and which shops they work for."
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing({ role: 'staff', active: true })}>
            Add person
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <label htmlFor="sq" className="mb-1 block text-sm font-medium">
            Search the team
          </label>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input id="sq" type="search" className="field-input ps-9" placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <SelectField label="Role" value={roleF} onChange={(e) => setRoleF(e.target.value)} className="w-52">
          <option value="">All roles</option>
          {Object.entries(ROLE_LABEL)
            .filter(([r]) => r !== 'super_admin')
            .map(([r, l]) => (
              <option key={r} value={r}>
                {l}
              </option>
            ))}
        </SelectField>
      </div>
      {staff.error && <Notice tone="loss">{staff.error.message}</Notice>}
      {staff.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState title="Nobody found" body={term || roleF ? 'Nothing matches this search.' : 'Add the people who will use the system.'} />
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Team</caption>
            <thead className="border-b border-line bg-canvas text-xs text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Signs in with</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Role</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Shops</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {rows.map((s) => {
                const lic = s.role === 'driver' && s.licence_expiry ? daysUntil(s.licence_expiry, today) : null;
                return (
                  <tr key={s.id} className={cx(!s.active && 'text-ink-2')}>
                    <th scope="row" className="px-4 py-3 text-start font-medium">
                      {s.name}
                      {s.id === me?.user.id && <span className="ms-1 text-xs font-normal text-ink-2">(you)</span>}
                      {lic != null && (
                        <div className={cx('text-xs font-normal', lic < 0 ? 'text-loss' : lic <= 30 ? 'text-attention' : 'text-ink-2')}>
                          Licence {lic < 0 ? 'expired' : 'expires'} {dateLabel(s.licence_expiry)}
                        </div>
                      )}
                    </th>
                    <td className="num px-4 py-3">{s.role === 'driver' || !s.email ? s.phone : s.email}</td>
                    <td className="px-4 py-3">{ROLE_LABEL[s.role]}</td>
                    <td className="px-4 py-3 text-ink-2">{shopsText(s.shop_ids)}</td>
                    <td className="px-4 py-3">
                      {!s.active ? (
                        <span className="rounded-full bg-line-2 px-2 py-0.5 text-xs font-medium">Switched off</span>
                      ) : s.role === 'driver' && s.on_shift ? (
                        <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">On shift</span>
                      ) : (
                        <span className="text-xs text-ink-2">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {roles.includes(s.role) && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <StaffDialog person={editing} roles={roles} isAdmin={role === 'org_admin'} self={editing.id === me?.user.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function StaffDialog({ person: init, roles, isAdmin, self, onClose }: { person: Partial<Staff>; roles: Role[]; isAdmin: boolean; self: boolean; onClose: () => void }) {
  const shops = useShops();
  const [p, setP] = useState(init);
  const [password, setPassword] = useState('');
  const set = <K extends keyof Staff>(k: K, v: Staff[K]) => setP((x) => ({ ...x, [k]: v }));
  const editing = !!init.id;
  const all = p.shop_ids === '*';
  const picked = all ? [] : (p.shop_ids ?? '').split(',').filter(Boolean);
  const toggle = (id: string) => set('shop_ids', (picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]).join(','));
  const save = useAction(
    () => {
      const body = { name: p.name, email: p.email, phone: p.phone, role: p.role, shop_ids: p.shop_ids ?? '', licence_expiry: p.licence_expiry ?? '', active: p.active, ...(password ? { password } : {}) };
      return editing ? patch(`/staff/${init.id}`, body) : post('/staff', body);
    },
    { success: editing ? 'Changes saved' : 'Account created', invalidate: ['staff', 'drivers'] },
  );
  const driver = p.role === 'driver';

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={editing ? `Edit ${init.name}` : 'Add person'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {editing ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Full name" value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} required />
        <SelectField label="Role" value={p.role} onChange={(e) => set('role', e.target.value as Role)} hint={p.role ? ROLE_HELP[p.role] : undefined} disabled={self}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </SelectField>
        {editing ? (
          <p className="text-sm text-ink-2 sm:col-span-2">
            Signs in with <span className="num font-medium text-ink">{init.role === 'driver' || !init.email ? init.phone : init.email}</span>. To change the sign-in, switch this account off and create a new one.
          </p>
        ) : (
          <>
            <TextField label={driver ? 'Phone number' : 'Phone number (optional)'} type="tel" inputMode="tel" value={p.phone ?? ''} onChange={(e) => set('phone', e.target.value)} hint={driver ? 'Drivers sign in with this number.' : undefined} required={driver} />
            {!driver && <TextField label="Email" type="email" value={p.email ?? ''} onChange={(e) => set('email', e.target.value)} hint="Office staff sign in with this email." />}
          </>
        )}
        <TextField label={editing ? 'New password (leave empty to keep)' : 'Password'} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters. Give it to the person privately." required={!editing} />
        {driver && <TextField label="Driving licence expiry" type="date" value={p.licence_expiry ?? ''} onChange={(e) => set('licence_expiry', e.target.value)} />}
      </div>

      {p.role !== 'org_admin' && (
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Works for</legend>
          {shops.isLoading ? (
            <p className="text-sm text-ink-2">Loading shops…</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {isAdmin && <Checkbox label="All shops, including new ones" checked={all} onChange={(v) => set('shop_ids', v ? '*' : '')} />}
              {!all &&
                (shops.data ?? [])
                  .filter((s) => s.active)
                  .map((s) => <Checkbox key={s.id} label={s.name} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />)}
            </div>
          )}
        </fieldset>
      )}
      {editing && !self && (
        <div className="mt-5 border-t border-line-2 pt-4">
          <Checkbox label="Account switched on" hint="Switching off signs the person out and stops them signing in. Their history stays." checked={p.active ?? true} onChange={(v) => set('active', v)} />
        </div>
      )}
    </Dialog>
  );
}
