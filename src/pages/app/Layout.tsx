import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Car, ChevronsUpDown, Ellipsis, LogOut, Settings as SettingsIcon, Truck, UserCog, Users, Wallet, type LucideIcon } from 'lucide-react';
import { setShop, useMe, useShop } from '../../lib/queries';
import { signOut } from '../../lib/auth';
import { can, currencyOf, ROLE_LABEL, type Permission } from '../../lib/domain';
import { setCurrency } from '../../lib/format';
import { BrandMark } from '../../ui/BrandMark';
import { cx, Dialog, Dropdown } from '../../ui/controls';

/** Few places to go: the office works from Deliveries; admins also get Team and Settings. */
const NAV: { to: string; label: string; perm: Permission; icon: LucideIcon; end?: boolean }[] = [
  { to: '/app', label: 'Deliveries', perm: 'deliveries.view', icon: Truck, end: true },
  { to: '/app/customers', label: 'Customers', perm: 'customers.manage', icon: Users },
  { to: '/app/vehicles', label: 'Vehicles', perm: 'vehicles.view', icon: Car },
  { to: '/app/money', label: 'Money', perm: 'deliveries.plan', icon: Wallet },
  { to: '/app/reports', label: 'Reports', perm: 'costs.view', icon: BarChart3 },
  { to: '/app/team', label: 'Team', perm: 'staff.manage', icon: UserCog },
  { to: '/app/settings', label: 'Settings', perm: 'settings.manage', icon: SettingsIcon },
];

export default function AppLayout() {
  const me = useMe();
  const shop = useShop();
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);

  const shops = me.data?.shops ?? [];
  // Keep the selected shop valid for this person.
  useEffect(() => {
    if (!me.data) return;
    if (shop !== 'all' && !shops.some((s) => s.id === shop)) setShop(shops.length === 1 ? shops[0].id : 'all');
    if (shop === 'all' && shops.length === 1) setShop(shops[0].id);
  }, [me.data, shop, shops]);
  useEffect(() => setMore(false), [loc.pathname]);

  if (me.isLoading) return <p className="p-6 text-ink-2">Loading…</p>;
  if (me.error) return <Navigate to="/login" replace state={{ error: me.error.message }} />;
  const role = me.data!.user.role;
  if (role === 'super_admin') return <Navigate to="/platform" replace />;
  if (role === 'driver') return <Navigate to="/driver" replace />;

  setCurrency(currencyOf(me.data!.settings ?? { country: 'OM' }));
  const items = NAV.filter((n) => can(role, n.perm));
  const isOn = (n: (typeof NAV)[number]) => (n.end ? loc.pathname === n.to || loc.pathname.startsWith('/app/deliveries') : loc.pathname.startsWith(n.to));
  const primary = items.length > 5 ? items.slice(0, 4) : items;
  const rest = items.length > 5 ? items.slice(4) : [];
  const name = me.data!.user.name;

  const shopSelect = shops.length > 1 && (
    <>
      <label htmlFor="shop" className="sr-only">
        Shop
      </label>
      <select id="shop" value={shop} onChange={(e) => setShop(e.target.value)} className="field-input !min-h-9 w-full py-1 text-sm">
        <option value="all">All shops</option>
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only-focusable absolute start-2 top-2 z-50 rounded-lg bg-surface px-3 py-2 shadow">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-line bg-surface text-ink lg:flex print:hidden">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <BrandMark size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{me.data!.org?.name}</p>
            <p className="text-xs text-ink-3">Delivery management</p>
          </div>
        </div>
        {shops.length > 1 && <div className="px-4 pb-3">{shopSelect}</div>}
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={cx(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isOn(n) ? 'bg-primary-soft text-primary-strong' : 'text-ink-2 hover:bg-canvas hover:text-ink',
              )}
            >
              <n.icon size={19} aria-hidden="true" className={isOn(n) ? 'text-primary' : 'text-ink-3 group-hover:text-ink-2'} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="m-3">
          <Dropdown
            up
            className="w-full"
            triggerClassName="flex w-full items-center gap-3 rounded-xl border border-line-2 bg-canvas p-3 text-start transition-colors hover:border-line"
            label="Account menu"
            trigger={
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white" aria-hidden="true">
                  {name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-tight">{name}</span>
                  <span className="block text-xs text-ink-3">{ROLE_LABEL[role]}</span>
                </span>
                <ChevronsUpDown size={16} className="text-ink-3" aria-hidden="true" />
              </>
            }
            items={[
              ...(can(role, 'settings.manage') ? [{ label: 'Settings', icon: <SettingsIcon size={16} />, onSelect: () => nav('/app/settings') }] : []),
              { label: 'Sign out', icon: <LogOut size={16} />, tone: 'danger' as const, onSelect: () => void signOut() },
            ]}
          />
        </div>
      </aside>

      <div className="min-w-0">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden print:hidden">
          <BrandMark size={30} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{me.data!.org?.name}</span>
          {shops.length > 1 && <div className="w-36">{shopSelect}</div>}
        </header>

        <main id="main" className="mx-auto max-w-[84rem] px-4 pb-28 pt-5 lg:px-8 lg:pb-10 lg:pt-7">
          <Outlet />
        </main>

        {/* Mobile bottom tabs */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden" style={{ gridTemplateColumns: `repeat(${primary.length + (rest.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {primary.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isOn(n) ? 'text-primary' : 'text-ink-3')}>
              <span className={cx('flex h-7 w-12 items-center justify-center rounded-full', isOn(n) && 'bg-primary-soft')}>
                <n.icon size={20} aria-hidden="true" />
              </span>
              {n.label}
            </NavLink>
          ))}
          {rest.length > 0 && (
            <button type="button" onClick={() => setMore(true)} className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', rest.some(isOn) ? 'text-primary' : 'text-ink-3')}>
              <span className={cx('flex h-7 w-12 items-center justify-center rounded-full', rest.some(isOn) && 'bg-primary-soft')}>
                <Ellipsis size={20} aria-hidden="true" />
              </span>
              More
            </button>
          )}
        </nav>
      </div>

      <Dialog open={more} onClose={() => setMore(false)} title="More">
        <ul className="flex flex-col gap-1">
          {rest.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} className="flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium hover:bg-canvas">
                <n.icon size={20} className="text-primary" aria-hidden="true" /> {n.label}
              </NavLink>
            </li>
          ))}
          <li className="mt-2 border-t border-line-2 pt-2">
            <p className="px-3 pb-1 text-xs text-ink-2">
              {name} · {ROLE_LABEL[role]}
            </p>
            <button type="button" onClick={() => signOut()} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-base font-medium text-loss hover:bg-loss-soft">
              <LogOut size={20} aria-hidden="true" /> Sign out
            </button>
          </li>
        </ul>
      </Dialog>
    </div>
  );
}
