import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronDown, ChevronRight, Hourglass, Plus, Route, Search, type LucideIcon } from 'lucide-react';
import { useDeliveries } from '../../lib/queries';
import { addDays, can, type Delivery } from '../../lib/domain';
import { dateLabel, money, timeIn } from '../../lib/format';
import { Button, cx, Dropdown } from '../../ui/controls';
import { BandBadge, EmptyState, Notice, StatusPill, UrgentTag } from '../../ui/display';
import { AssignDialog } from './AssignDialog';
import { TripDialog } from './TripDialog';
import { bandOf, costOf, problemOf, useNames, useOrg } from './ctx';

const WAITING = ['unassigned'];
const MOVING = ['assigned', 'accepted', 'picked_up', 'arrived'];
const ACCENT: Record<string, string> = { unassigned: 'border-s-attention', assigned: 'border-s-primary', accepted: 'border-s-primary', picked_up: 'border-s-primary', arrived: 'border-s-primary', delivered: 'border-s-good', failed: 'border-s-loss', cancelled: 'border-s-line' };

/**
 * The one screen the office works from: pick a day, see what needs a driver,
 * what is on the road and what is done. Tick deliveries to give them to a driver together.
 */
export default function Deliveries() {
  const { role, settings, tz, today, shop, shopName, shops } = useOrg();
  const names = useNames();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? today;
  const q = params.get('q') ?? '';
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (!v) n.delete(k);
    else n.set(k, v);
    setParams(n, { replace: true });
  };
  const res = useDeliveries({ shop, from: date, to: date, refetch: 60_000 });
  const [picked, setPicked] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [bandF, setBandF] = useState<'all' | 'good' | 'attention' | 'loss'>('all');
  const [focus, setFocus] = useState<'all' | 'waiting' | 'moving' | 'done'>('all');
  const canPlan = can(role, 'deliveries.plan');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (res.data?.deliveries ?? [])
      .filter((d) => bandF === 'all' || bandOf(d, settings) === bandF)
      .filter((d) => !term || [d.ref, d.doc_number, names.customer(d.customer_id)?.name, names.customer(d.customer_id)?.phone, names.driver(d.driver_id)?.name].join(' ').toLowerCase().includes(term))
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.window_from || '99').localeCompare(b.window_from || '99') || a.ref.localeCompare(b.ref));
  }, [res.data, q, names, bandF, settings]);

  const waiting = rows.filter((d) => WAITING.includes(d.status));
  const moving = rows.filter((d) => MOVING.includes(d.status));
  const done = rows.filter((d) => !WAITING.includes(d.status) && !MOVING.includes(d.status));
  const chosen = waiting.filter((d) => picked.includes(d.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const sameShop = chosen.every((d) => d.shop_id === chosen[0]?.shop_id);
  const shopObj = shops.find((s) => s.id === chosen[0]?.shop_id);

  const COLS = 'grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[1.25rem_minmax(0,1.5fr)_minmax(0,1.2fr)_7.5rem_9rem] md:items-center md:gap-x-4';

  const Row = ({ d, selectable }: { d: Delivery; selectable?: boolean }) => {
    const c = names.customer(d.customer_id);
    const a = names.address(d.address_id);
    const problem = problemOf(d, tz, today);
    const driver = names.driver(d.driver_id);
    const band = bandOf(d, settings);
    return (
      <li className={cx(COLS, 'border-s-4 transition-colors hover:bg-canvas/60', ACCENT[d.status])}>
        <span className="pt-1 md:pt-0">
          {selectable && canPlan && <input type="checkbox" className="h-4 w-4 accent-primary" checked={picked.includes(d.id)} onChange={() => toggle(d.id)} aria-label={`Select ${d.ref}, ${c?.name ?? ''}`} />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/app/deliveries/${d.id}`} className="font-semibold hover:text-primary hover:underline">
              {c?.name ?? '…'}
            </Link>
            {d.urgent && <UrgentTag />}
          </div>
          <p className="truncate text-sm text-ink-2">
            {a?.label ?? ''}
            {a?.line ? `, ${a.line}` : ''}
          </p>
        </div>
        <div className="col-start-2 min-w-0 text-xs text-ink-2 md:col-start-auto">
          <p>
            {d.ref} · {d.doc_kind} {d.doc_number}
          </p>
          <p className="truncate">
            {[shops.length > 1 && shop === 'all' ? shopName(d.shop_id) : '', d.timing === 'window' ? `${d.window_from}–${d.window_to}` : '', driver?.name ?? '', d.eta && MOVING.includes(d.status) ? `ETA ${timeIn(d.eta, tz)}` : ''].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="num col-start-2 text-sm md:col-start-auto md:text-end">
          <p className="font-medium">{money(costOf(d))}</p>
          <p className="text-xs text-ink-2">
            {d.weight_kg.toLocaleString()} kg{d.volume_cbm > 0 ? ` · ${d.volume_cbm} cbm` : ''}
          </p>
        </div>
        <div className="col-start-2 flex flex-wrap items-center gap-1.5 md:col-start-auto md:flex-col md:items-end">
          <StatusPill status={d.status} />
          <BandBadge band={band} short />
        </div>
        {problem && <p className="col-start-2 text-sm font-medium text-attention md:col-[2/-1]">{problem}</p>}
      </li>
    );
  };

  const Head = () => (
    <li aria-hidden="true" className={cx(COLS, 'hidden rounded-t-xl border-s-4 border-s-transparent bg-canvas py-2 text-xs font-medium uppercase tracking-wide text-ink-3 md:grid')}>
      <span />
      <span>Customer</span>
      <span>Details</span>
      <span className="text-end">Cost</span>
      <span className="text-end">Status</span>
    </li>
  );

  const Group = ({ title, hint, list, selectable, kind }: { title: string; hint?: string; list: Delivery[]; selectable?: boolean; kind: 'waiting' | 'moving' | 'done' }) =>
    list.length === 0 || (focus !== 'all' && focus !== kind) ? null : (
      <section className="mb-6" aria-labelledby={`g-${title}`}>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 id={`g-${title}`} className="text-base font-semibold">
            {title}
          </h2>
          <span className="text-sm text-ink-2">{list.length}</span>
          {hint && <span className="text-sm text-ink-3">{hint}</span>}
        </div>
        <ul className="panel divide-y divide-line-2 overflow-hidden"><Head />{list.map((d) => <Row key={d.id} d={d} selectable={selectable} />)}</ul>
      </section>
    );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous day" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface" onClick={() => setParam('date', addDays(date, -1))}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{date === today ? 'Today' : dateLabel(date)}</h1>
            <p className="text-sm text-ink-2">{date === today ? dateLabel(date) : date < today ? 'Past day' : 'Planned ahead'}</p>
          </div>
          <button type="button" aria-label="Next day" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface" onClick={() => setParam('date', addDays(date, 1))}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <label className="ms-2">
            <span className="sr-only">Choose a date</span>
            <input type="date" className="field-input !min-h-9 !w-auto py-1 text-sm" value={date} onChange={(e) => e.target.value && setParam('date', e.target.value)} />
          </label>
          {date !== today && (
            <Button size="sm" variant="ghost" onClick={() => setParam('date', null)}>
              Back to today
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <label htmlFor="q" className="sr-only">
              Search deliveries
            </label>
            <input id="q" type="search" className="field-input !min-h-10 ps-9 sm:w-64" placeholder="Search customer or number" value={q} onChange={(e) => setParam('q', e.target.value)} />
          </div>
          {can(role, 'deliveries.create') && (
            <Link to="/app/deliveries/new" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-strong">
              <Plus size={18} aria-hidden="true" /> New delivery
            </Link>
          )}
        </div>
      </div>

      {res.error && <Notice tone="loss" className="mb-4">{res.error.message}</Notice>}
      {res.isLoading && <p className="text-ink-2">Loading…</p>}
      {!res.isLoading && rows.length === 0 && (
        <div className="panel">
          <EmptyState title={q ? 'No deliveries match' : 'Nothing planned for this day'} body={q ? 'Check the spelling or clear the search.' : 'Create a delivery and it will show here.'} action={can(role, 'deliveries.create') && !q ? <Link to="/app/deliveries/new" className="font-medium text-primary underline">New delivery</Link> : undefined} />
        </div>
      )}
      {rows.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Stat icon={Hourglass} label="Needs a driver" value={waiting.length} tone="attention" on={focus === 'waiting'} onClick={() => setFocus(focus === 'waiting' ? 'all' : 'waiting')} />
          <Stat icon={Route} label="On the road" value={moving.length} tone="primary" on={focus === 'moving'} onClick={() => setFocus(focus === 'moving' ? 'all' : 'moving')} />
          <Stat icon={CheckCircle2} label="Finished" value={done.length} tone="good" on={focus === 'done'} onClick={() => setFocus(focus === 'done' ? 'all' : 'done')} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          { label: 'Status', value: { all: 'All', waiting: 'Needs a driver', moving: 'On the road', done: 'Finished' }[focus], items: (['all', 'waiting', 'moving', 'done'] as const).map((k) => ({ label: { all: 'All', waiting: 'Needs a driver', moving: 'On the road', done: 'Finished' }[k], active: focus === k, onSelect: () => setFocus(k) })) },
          { label: 'Cost check', value: { all: 'All', good: 'Within cost', attention: 'Attention', loss: 'Loss risk' }[bandF], items: (['all', 'good', 'attention', 'loss'] as const).map((k) => ({ label: { all: 'All', good: 'Within cost', attention: 'Attention', loss: 'Loss risk' }[k], active: bandF === k, onSelect: () => setBandF(k) })) },
        ].map((f) => (
          <Dropdown
            key={f.label}
            items={f.items}
            triggerClassName="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm shadow-[0_1px_1px_rgb(15_23_42/0.04)] hover:border-ink-3"
            trigger={
              <>
                <span className="text-ink-2">{f.label}:</span>
                <span className="font-medium">{f.value}</span>
                <ChevronDown size={16} className="text-ink-3" aria-hidden="true" />
              </>
            }
          />
        ))}
        {(focus !== 'all' || bandF !== 'all') && (
          <Button size="sm" variant="ghost" onClick={() => (setFocus('all'), setBandF('all'))}>
            Clear filters
          </Button>
        )}
      </div>
      <Group kind="waiting" title="Needs a driver" hint={canPlan ? 'Tick the ones that go together' : undefined} list={waiting} selectable />
      <Group kind="moving" title="On the road" list={moving} />
      <Group kind="done" title="Finished" list={done} />

      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-[4.25rem] z-30 border-t lg:bottom-0 lg:start-[15.5rem] border-line bg-surface/95 px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{chosen.length}</strong> selected · <span className="num">{chosen.reduce((a, d) => a + d.weight_kg, 0).toLocaleString()} kg</span> · <span className="num">{Math.round(chosen.reduce((a, d) => a + d.volume_cbm, 0) * 10) / 10} cbm</span>
              {!sameShop && <span className="ms-2 font-medium text-loss">These are from different shops. Pick deliveries from one shop.</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPicked([])}>
                Clear
              </Button>
              <Button variant="primary" disabled={!sameShop} onClick={() => setAssigning(true)}>
                {chosen.length === 1 ? 'Assign a driver' : `Assign ${chosen.length} together`}
              </Button>
            </div>
          </div>
        </div>
      )}
      {assigning && chosen.length === 1 && <AssignDialog delivery={chosen[0]} onClose={() => (setAssigning(false), setPicked([]))} />}
      {assigning && chosen.length > 1 && shopObj && <TripDialog shop={shopObj} date={date} list={chosen} onClose={() => setAssigning(false)} onDone={() => setPicked([])} />}
      {chosen.length > 0 && <div className={cx('h-16')} aria-hidden="true" />}
    </>
  );
}

const TONE: Record<'attention' | 'primary' | 'good', string> = {
  attention: 'bg-attention-soft text-attention',
  primary: 'bg-primary-soft text-primary',
  good: 'bg-good-soft text-good',
};

function Stat({ icon: Icon, label, value, tone, on, onClick }: { icon: LucideIcon; label: string; value: number; tone: keyof typeof TONE; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx('panel flex items-center gap-3 p-3 text-start transition-shadow hover:shadow-md sm:p-4', on && 'ring-2 ring-primary')}
    >
      <span className={cx('hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex', TONE[tone])}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="num block text-2xl font-semibold leading-none">{value}</span>
        <span className="mt-1 block text-xs leading-tight text-ink-2 sm:text-sm">{label}</span>
      </span>
    </button>
  );
}
