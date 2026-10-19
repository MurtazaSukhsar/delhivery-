import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { patch, post } from '../../lib/api';
import { useAction, useCollections, type PaymentRow } from '../../lib/queries';
import { daysUntil, dateLabel, dateTimeIn, money } from '../../lib/format';
import { Button, Dialog, NumberField, TextField, cx } from '../../ui/controls';
import { EmptyState, Notice, PageHeader } from '../../ui/display';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { PayStatus } from './DeliveryDetail';
import { useOrg } from './ctx';

type Tab = 'drivers' | 'cheques' | 'transfers' | 'history';

/** When a cheque can be banked, and whether it is getting too old (cheques are valid for about six months). */
function chequeDue(date: string, today: string) {
  if (!date) return { text: 'No date', tone: 'muted' as const };
  const d = daysUntil(date, today);
  if (d < -180) return { text: 'Over 6 months old', tone: 'loss' as const };
  if (d < 0) return { text: 'Can be banked', tone: 'good' as const };
  if (d === 0) return { text: 'Due today', tone: 'attention' as const };
  if (d <= 3) return { text: `Due in ${d} day${d > 1 ? 's' : ''}`, tone: 'attention' as const };
  return { text: `Post-dated, ${d} days`, tone: 'muted' as const };
}

const TONE = { muted: 'text-ink-2', good: 'text-good', attention: 'font-medium text-attention', loss: 'font-medium text-loss' };

export default function Money() {
  const { tz, today, shop } = useOrg();
  const q = useCollections(shop);
  const [tab, setTab] = useState<Tab>('drivers');
  const [showCleared, setShowCleared] = useState(false);
  const [settling, setSettling] = useState<{ driver: string; driver_id: string; rows: PaymentRow[] } | null>(null);
  const rows = q.data?.payments ?? [];
  const day = q.data?.today ?? today;

  const withDrivers = rows.filter((p) => p.status === 'with_driver');
  const byDriver = useMemo(() => {
    const m = new Map<string, { driver: string; rows: PaymentRow[] }>();
    for (const p of withDrivers) {
      const g = m.get(p.driver_id) ?? { driver: p.driver, rows: [] };
      g.rows.push(p);
      m.set(p.driver_id, g);
    }
    return [...m.entries()];
  }, [withDrivers]);
  const cheques = rows.filter((p) => p.method === 'cheque').sort((a, b) => (a.cheque_date || '9').localeCompare(b.cheque_date || '9'));
  const RANK: Record<string, number> = { bounced: 0, with_driver: 2, handed_in: 1, deposited: 1, cleared: 3 };
  const shownCheques = cheques.filter((p) => showCleared || p.status !== 'cleared').sort((a, b) => RANK[a.status] - RANK[b.status] || (a.cheque_date || '9').localeCompare(b.cheque_date || '9'));
  const clearedCount = cheques.length - cheques.filter((p) => p.status !== 'cleared').length;
  const toBank = cheques.filter((p) => p.status === 'handed_in');
  const dueSoon = toBank.filter((p) => p.cheque_date && daysUntil(p.cheque_date, day) <= 3);
  const bounced = rows.filter((p) => p.status === 'bounced');
  const transfers = rows.filter((p) => p.method === 'transfer');
  const cashWithDrivers = withDrivers.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);

  const mark = useAction((a: { id: string; status: string }) => patch(`/payments/${a.id}`, { status: a.status }), { success: 'Updated', invalidate: ['collections', 'delivery'] });

  const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="panel p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={cx('num mt-1 text-xl font-semibold', tone)}>{value}</p>
      {sub && <p className="text-xs text-ink-2">{sub}</p>}
    </div>
  );

  const Actions = ({ p }: { p: PaymentRow }) => {
    const next: [string, string][] =
      p.status === 'handed_in' ? [['deposited', 'Deposited'], ['bounced', 'Bounced']] : p.status === 'deposited' ? [['cleared', 'Cleared'], ['bounced', 'Bounced']] : p.status === 'to_verify' ? [['cleared', 'Received'], ['bounced', 'Not received']] : p.status === 'bounced' && p.method === 'cheque' ? [['deposited', 'Deposited again']] : [];
    return (
      <span className="flex flex-wrap justify-end gap-1">
        {next.map(([s, l]) => (
          <Button key={s} size="sm" variant={s === 'bounced' ? 'danger' : 'secondary'} busy={mark.isPending && mark.variables?.id === p.id && mark.variables?.status === s} onClick={() => mark.mutate({ id: p.id, status: s })}>
            {l}
          </Button>
        ))}
      </span>
    );
  };

  return (
    <>
      <PageHeader title="Money" description="Cash and cheques the drivers collected, what still has to be handed in, and cheques to bank." />
      {q.error && <Notice tone="loss">{q.error.message}</Notice>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Cash with drivers" value={money(cashWithDrivers)} sub={`${withDrivers.length} item${withDrivers.length === 1 ? '' : 's'} not handed in`} tone={withDrivers.length ? 'text-attention' : undefined} />
        <Tile label="Cheques to bank" value={money(toBank.reduce((a, p) => a + p.amount, 0))} sub={dueSoon.length ? `${dueSoon.length} due within 3 days` : `${toBank.length} in the office`} tone={dueSoon.length ? 'text-attention' : undefined} />
        <Tile label="Bounced or not received" value={money(bounced.reduce((a, p) => a + p.amount, 0))} sub={`${bounced.length} item${bounced.length === 1 ? '' : 's'}`} tone={bounced.length ? 'text-loss' : undefined} />
        <Tile label="Transfers to check" value={String(transfers.filter((p) => p.status === 'to_verify').length)} sub="Customer says they paid by bank" />
      </div>

      <Tabs
        id="money"
        label="Money sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'drivers', label: `With drivers (${withDrivers.length})` },
          { value: 'cheques', label: `Cheques (${cheques.length - clearedCount})` },
          { value: 'transfers', label: 'Transfers' },
          { value: 'history', label: 'Handed in' },
        ]}
      />
      <TabPanel id="money" value={tab}>
        {q.isLoading && <p className="text-ink-2">Loading…</p>}
        {tab === 'drivers' &&
          (byDriver.length === 0 ? (
            <div className="panel">
              <EmptyState title="Nothing with the drivers" body="Cash and cheques collected at a drop show here until the driver hands them in." />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {byDriver.map(([id, g]) => {
                const cash = g.rows.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);
                return (
                  <section key={id} className="panel p-4" aria-labelledby={`d-${id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 id={`d-${id}`} className="text-base font-semibold">
                          {g.driver}
                        </h2>
                        <p className="text-sm text-ink-2">
                          Cash {money(cash)} · {g.rows.filter((p) => p.method === 'cheque').length} cheque(s)
                        </p>
                      </div>
                      <Button variant="primary" onClick={() => setSettling({ driver: g.driver, driver_id: id, rows: g.rows })}>
                        Receive from {g.driver.split(' ')[0]}
                      </Button>
                    </div>
                    <PayTable rows={g.rows} tz={tz} />
                  </section>
                );
              })}
            </div>
          ))}
        {tab === 'cheques' &&
          (cheques.length === 0 ? (
            <div className="panel">
              <EmptyState title="No cheques" body="Cheques collected by drivers appear here with the date they can be banked." />
            </div>
          ) : (
            <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-2">Bounced first, then by the date they can be banked. Cheques are valid for about six months from their date.</p>
              {clearedCount > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowCleared(!showCleared)}>
                  {showCleared ? 'Hide cleared' : `Show cleared (${clearedCount})`}
                </Button>
              )}
            </div>
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <caption className="sr-only">Cheque register</caption>
                <thead className="border-b border-line bg-canvas text-xs text-ink-2">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">Cheque</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">Customer</th>
                    <th scope="col" className="px-4 py-2.5 text-end font-medium">Amount</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">Date on cheque</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">Status</th>
                    <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {shownCheques.map((p) => {
                    const due = chequeDue(p.cheque_date, day);
                    return (
                      <tr key={p.id}>
                        <th scope="row" className="px-4 py-2.5 text-start font-medium">
                          <span className="num">{p.cheque_no || '—'}</span>
                          <span className="block text-xs font-normal text-ink-2">
                            {p.bank || 'Bank not given'}
                            {p.photo_url && (
                              <>
                                {' · '}
                                <a href={p.photo_url} target="_blank" rel="noreferrer" className="text-primary underline">
                                  photo
                                </a>
                              </>
                            )}
                          </span>
                        </th>
                        <td className="px-4 py-2.5">
                          {p.customer}
                          <span className="block text-xs text-ink-2">{p.ref}</span>
                        </td>
                        <td className="num px-4 py-2.5 text-end">{money(p.amount)}</td>
                        <td className="px-4 py-2.5">
                          {p.cheque_date ? dateLabel(p.cheque_date) : '—'}
                          {['handed_in', 'with_driver'].includes(p.status) && <span className={cx('block text-xs', TONE[due.tone])}>{due.text}</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <PayStatus status={p.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Actions p={p} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          ))}
        {tab === 'transfers' &&
          (transfers.length === 0 ? (
            <div className="panel">
              <EmptyState title="No bank transfers to check" body="When a customer says they paid by transfer, the driver records it and you confirm it here." />
            </div>
          ) : (
            <div className="panel p-4">
              <PayTable rows={transfers} tz={tz} actions={(p) => <Actions p={p} />} />
            </div>
          ))}
        {tab === 'history' &&
          ((q.data?.settlements ?? []).length === 0 ? (
            <div className="panel">
              <EmptyState title="Nothing handed in yet" />
            </div>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Cash handed in by drivers</caption>
                <thead className="border-b border-line bg-canvas text-xs text-ink-2">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">When</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">Driver</th>
                    <th scope="col" className="px-4 py-2.5 text-end font-medium">Cash expected</th>
                    <th scope="col" className="px-4 py-2.5 text-end font-medium">Counted</th>
                    <th scope="col" className="px-4 py-2.5 text-end font-medium">Difference</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">Received by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {q.data!.settlements.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5">{dateTimeIn(s.at, tz)}</td>
                      <td className="px-4 py-2.5">{s.driver}</td>
                      <td className="num px-4 py-2.5 text-end">{money(s.expected)}</td>
                      <td className="num px-4 py-2.5 text-end">{money(s.counted)}</td>
                      <td className={cx('num px-4 py-2.5 text-end', s.variance < 0 ? 'font-semibold text-loss' : s.variance > 0 ? 'text-attention' : 'text-good')}>{s.variance === 0 ? 'Exact' : money(s.variance)}</td>
                      <td className="px-4 py-2.5">
                        {s.by}
                        {s.note && <span className="block text-xs text-ink-2">{s.note}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </TabPanel>
      {settling && <SettleDialog {...settling} onClose={() => setSettling(null)} />}
    </>
  );
}

function PayTable({ rows, tz, actions }: { rows: PaymentRow[]; tz: string; actions?: (p: PaymentRow) => React.ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">Collected payments</caption>
        <thead className="border-b border-line text-xs text-ink-2">
          <tr>
            <th scope="col" className="py-2 text-start font-medium">Delivery</th>
            <th scope="col" className="py-2 text-start font-medium">Method</th>
            <th scope="col" className="py-2 text-end font-medium">Amount</th>
            <th scope="col" className="py-2 text-start font-medium ps-4">Collected</th>
            <th scope="col" className="py-2 text-start font-medium">Status</th>
            {actions && <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-2">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="py-2">
                <Link to={`/app/deliveries/${p.delivery_id}`} className="font-medium text-primary underline">
                  {p.ref}
                </Link>
                <span className="block text-xs text-ink-2">{p.customer}</span>
              </td>
              <td className="py-2 capitalize">
                {p.method}
                {p.cheque_no && <span className="block text-xs normal-case text-ink-2">no. {p.cheque_no}{p.cheque_date ? `, dated ${dateLabel(p.cheque_date)}` : ''}</span>}
              </td>
              <td className="num py-2 text-end">{money(p.amount)}</td>
              <td className="py-2 ps-4">{dateTimeIn(p.collected_at, tz)}</td>
              <td className="py-2">
                <PayStatus status={p.status} />
              </td>
              {actions && <td className="py-2">{actions(p)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettleDialog({ driver, driver_id, rows, onClose }: { driver: string; driver_id: string; rows: PaymentRow[]; onClose: () => void }) {
  const expected = Math.round(rows.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0) * 1000) / 1000;
  const [counted, setCounted] = useState(expected);
  const [note, setNote] = useState('');
  const diff = Math.round((counted - expected) * 1000) / 1000;
  const save = useAction(() => post('/collections/settle', { driver_id, payment_ids: rows.map((p) => p.id), counted, note }), { success: `Received from ${driver}`, invalidate: ['collections', 'delivery'] });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Receive cash and cheques from ${driver}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Confirm received
          </Button>
        </>
      }
    >
      <p className="text-sm">
        Cash expected: <strong className="num">{money(expected)}</strong>. Cheques: {rows.filter((p) => p.method === 'cheque').length}.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <NumberField label="Cash counted" value={counted} onValue={setCounted} />
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className={cx('mt-3 text-sm', diff < 0 ? 'font-medium text-loss' : diff > 0 ? 'text-attention' : 'text-good')} aria-live="polite">
        {diff === 0 ? 'Matches what was collected.' : diff < 0 ? `Short by ${money(-diff)}. This is recorded.` : `Over by ${money(diff)}. This is recorded.`}
      </p>
    </Dialog>
  );
}
