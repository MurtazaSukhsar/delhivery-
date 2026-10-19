import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import { useReport } from '../../lib/queries';
import { addDays } from '../../lib/domain';
import { currencyCode, dateLabel, km, money } from '../../lib/format';
import { Button, Segmented, TextField, cx } from '../../ui/controls';
import { EmptyState, Notice, PageHeader } from '../../ui/display';
import { useOrg } from './ctx';
import { buildReport, type Cell, type Kind, type Kpi, type Table } from './reportMath';
import { toast } from '../../lib/toast';

type Preset = 'month' | 'last_month' | '30' | '90' | 'custom';

function range(p: Preset, today: string): [string, string] {
  const first = today.slice(0, 8) + '01';
  if (p === 'month') return [first, today];
  if (p === 'last_month') {
    const end = addDays(first, -1);
    return [end.slice(0, 8) + '01', end];
  }
  if (p === '90') return [addDays(today, -89), today];
  return [addDays(today, -29), today];
}

export function show(v: Cell, k: Kind) {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return k === 'date' ? dateLabel(v) : v;
  if (k === 'money') return money(v, false);
  if (k === 'pct') return `${Math.round(v * 1000) / 10}%`;
  if (k === 'km') return km(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export default function Reports() {
  const { settings, shop, today, shopName } = useOrg();
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState<[string, string]>(() => range('30', today));
  const [from, to] = preset === 'custom' ? custom : range(preset, today);
  const q = useReport(shop, from, to);
  const report = useMemo(() => (q.data ? buildReport(q.data, settings) : null), [q.data, settings]);
  const [busy, setBusy] = useState(false);

  async function exportExcel() {
    if (!report) return;
    setBusy(true);
    try {
      const { default: write } = await import('write-excel-file/browser');
      const cur = currencyCode();
      const fmt = (k: Kind) => (k === 'money' ? `#,##0.${'0'.repeat(cur === 'OMR' || cur === 'KWD' || cur === 'BHD' ? 3 : 2)}` : k === 'pct' ? '0.0%' : k === 'km' ? '#,##0.0' : undefined);
      const sheetOf = (t: Table) => {
        const head = t.cols.map((c) => ({ value: c.kind === 'money' ? `${c.label} (${cur})` : c.label, fontWeight: 'bold' as const, backgroundColor: '#E8EEF0' }));
        const row = (r: Record<string, Cell>, bold = false) =>
          t.cols.map((c) => {
            const v = r[c.key];
            if (v == null || v === '') return null;
            if (typeof v === 'number') return { value: v, type: Number, format: fmt(c.kind), ...(bold ? { fontWeight: 'bold' as const } : {}) };
            return { value: c.kind === 'date' ? v : String(v), type: String, ...(bold ? { fontWeight: 'bold' as const } : {}) };
          });
        return {
          sheet: t.title.slice(0, 31),
          data: [head, ...t.rows.map((r) => row(r)), ...(t.total ? [row(t.total, true)] : [])],
          columns: t.cols.map((c, i) => ({ width: i === 0 ? 26 : c.kind === 'text' ? 20 : 15 })),
          stickyRowsCount: 1,
        };
      };
      const summary = {
        sheet: 'Summary',
        data: [
          [{ value: `Delivery report ${from} to ${to}${shop !== 'all' ? `, ${shopName(shop)}` : ''}`, fontWeight: 'bold' as const }],
          [null],
          ...report.kpis.map((k) => [
            { value: k.label, type: String },
            { value: k.value, type: Number, format: fmt(k.kind) },
            k.sub ? { value: k.sub, type: String } : null,
          ]),
        ],
        columns: [{ width: 32 }, { width: 18 }, { width: 48 }],
      };
      const t = report.tables;
      // The library's types do not model a mixed list of sheets well.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await write([summary, ...[t.customers, t.areas, t.vehicles, t.drivers, t.months, t.losses, t.collections, t.detail].map(sheetOf)] as any, { fontFamily: 'Calibri', fontSize: 11 }).toFile(`deliveries-${from}-to-${to}.xlsx`);
    } catch (e) {
      toast((e as Error).message || 'Could not make the Excel file.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="What deliveries really cost, who and where they lose money, and how each vehicle and driver is doing."
        actions={
          <span className="flex gap-2 print:hidden">
            <Button onClick={() => window.print()} disabled={!report}>
              <Printer aria-hidden className="size-4" /> Print
            </Button>
            <Button variant="primary" busy={busy} disabled={!report} onClick={exportExcel}>
              <Download aria-hidden className="size-4" /> Download Excel
            </Button>
          </span>
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-4 print:hidden">
        <Segmented<Preset>
          legend="Period"
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'month', label: 'This month' },
            { value: 'last_month', label: 'Last month' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: 'custom', label: 'Choose' },
          ]}
        />
        {preset === 'custom' && (
          <>
            <TextField label="From" type="date" value={custom[0]} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
            <TextField label="To" type="date" value={custom[1]} min={custom[0]} max={today} onChange={(e) => setCustom([custom[0], e.target.value])} />
          </>
        )}
      </div>
      <p className="mb-4 text-sm text-ink-2">
        {dateLabel(from)} to {dateLabel(to)}
        {shop !== 'all' ? ` · ${shopName(shop)}` : ' · all shops'} · amounts in {currencyCode()}
      </p>

      {q.error && <Notice tone="loss">{q.error.message}</Notice>}
      {q.isLoading && <p className="text-ink-2">Working out the figures…</p>}
      {report && report.delivered === 0 && (
        <div className="panel">
          <EmptyState title="No completed deliveries in this period" body="Choose a longer period, or come back once some deliveries are done." />
        </div>
      )}
      {report && report.delivered > 0 && (
        <>
          <section aria-label="Summary" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {report.kpis.map((k) => (
              <KpiTile key={k.label} k={k} />
            ))}
          </section>
          <MonthBars t={report.tables.months} />
          {[report.tables.customers, report.tables.areas, report.tables.losses, report.tables.vehicles, report.tables.drivers, report.tables.collections].map((t) => (
            <ReportTable key={t.id} t={t} />
          ))}
        </>
      )}
    </>
  );
}

function KpiTile({ k }: { k: Kpi }) {
  return (
    <div className="panel p-4">
      <p className="text-sm text-ink-2">{k.label}</p>
      <p className={cx('num mt-1 text-xl font-semibold', k.tone === 'loss' && 'text-loss', k.tone === 'attention' && 'text-attention', k.tone === 'good' && 'text-good')}>{k.kind === 'money' ? money(k.value) : show(k.value, k.kind)}</p>
      {k.sub && <p className="mt-0.5 text-xs text-ink-2">{k.sub}</p>}
    </div>
  );
}

/** Charged against cost for each month, as simple paired bars. */
function MonthBars({ t }: { t: Table }) {
  if (t.rows.length < 2) return null;
  const max = Math.max(...t.rows.flatMap((r) => [Number(r.charged) || 0, Number(r.cost) || 0]), 1);
  return (
    <section aria-labelledby="months-h" className="panel mb-8 p-4">
      <h2 id="months-h" className="text-base font-semibold">
        Charged and cost by month
      </h2>
      <p className="mb-3 flex gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-sm bg-primary" /> Charged</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-sm bg-attention" /> Cost</span>
      </p>
      <ul className="flex flex-col gap-3">
        {t.rows.map((r) => (
          <li key={String(r.name)} className="grid grid-cols-[9.5rem_1fr] items-center gap-3 text-sm">
            <span className="text-ink-2">{r.name}</span>
            <span className="flex flex-col gap-1">
              <Bar value={Number(r.charged)} max={max} cls="bg-primary" label={`Charged ${money(Number(r.charged))}`} />
              <Bar value={Number(r.cost)} max={max} cls="bg-attention" label={`Cost ${money(Number(r.cost))}`} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
const Bar = ({ value, max, cls, label }: { value: number; max: number; cls: string; label: string }) => (
  <span className="flex items-center gap-2">
    <span className={cx('h-2.5 rounded-sm', cls)} style={{ width: `${Math.max(1, (value / max) * 70)}%` }} />
    <span className="num whitespace-nowrap text-xs text-ink-2">{label}</span>
  </span>
);

function ReportTable({ t }: { t: Table }) {
  const [all, setAll] = useState(false);
  const rows = all ? t.rows : t.rows.slice(0, 10);
  const helps = t.cols.filter((c) => c.help);
  return (
    <section aria-labelledby={`${t.id}-h`} className="mb-8 break-inside-avoid">
      <h2 id={`${t.id}-h`} className="text-base font-semibold">
        {t.title}
      </h2>
      {t.note && <p className="mb-2 text-sm text-ink-2">{t.note}</p>}
      {t.rows.length === 0 ? (
        <p className="panel p-4 text-sm text-ink-2">{t.id === 'losses' ? 'None. Every delivery stayed within budget.' : 'Nothing in this period.'}</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">{t.title}</caption>
            <thead className="border-b border-line bg-canvas text-xs text-ink-2">
              <tr>
                {t.cols.map((c, i) => (
                  <th key={c.key} scope="col" className={cx('px-3 py-2.5 font-medium', i === 0 || c.kind === 'text' || c.kind === 'date' ? 'text-start' : 'text-end')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {rows.map((r, n) => (
                <tr key={n}>
                  {t.cols.map((c, i) => {
                    const v = r[c.key];
                    const neg = typeof v === 'number' && v < 0 && c.kind === 'money';
                    const content = t.id === 'losses' && c.key === 'ref' && r.id ? <Link to={`/app/deliveries/${r.id}`} className="font-medium text-primary underline">{show(v, c.kind)}</Link> : show(v, c.kind);
                    return i === 0 ? (
                      <th key={c.key} scope="row" className="px-3 py-2 text-start font-medium">
                        {content}
                      </th>
                    ) : (
                      <td key={c.key} className={cx('px-3 py-2', c.kind === 'text' || c.kind === 'date' ? 'text-start' : 'num text-end', neg && 'font-medium text-loss')}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {t.total && (
              <tfoot className="border-t-2 border-line font-semibold">
                <tr>
                  {t.cols.map((c, i) =>
                    i === 0 ? (
                      <th key={c.key} scope="row" className="px-3 py-2 text-start">
                        {show(t.total![c.key], c.kind)}
                      </th>
                    ) : (
                      <td key={c.key} className={cx('num px-3 py-2', c.kind === 'text' ? 'text-start' : 'text-end')}>
                        {show(t.total![c.key], c.kind)}
                      </td>
                    ),
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        {helps.length > 0 && <p className="text-xs text-ink-2">{helps.map((c) => `${c.label}: ${c.help}`).join(' ')}</p>}
        {t.rows.length > 10 && (
          <button type="button" className="min-h-10 rounded-lg px-2 text-sm font-medium text-primary hover:bg-canvas print:hidden" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${t.rows.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
