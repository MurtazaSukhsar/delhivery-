import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CircleAlert, CircleCheck, Copy, ExternalLink, LogOut, Plus, RefreshCw, Wrench } from 'lucide-react';
import { post, patch } from '../../lib/api';
import { signOut } from '../../lib/auth';
import { useAction, useMe, usePlatformErrors, usePlatformInfo, usePlatformOrgs, type OrgCheckResult } from '../../lib/queries';
import { toast } from '../../lib/toast';
import { dateLabel } from '../../lib/format';
import type { ErrorLogEntry, Organization } from '../../lib/domain';
import { Button, Dialog, TextField, cx } from '../../ui/controls';
import { EmptyState, Notice, PageHeader } from '../../ui/display';
import { BrandMark } from '../../ui/BrandMark';
import { TabPanel, Tabs } from '../../ui/Tabs';

type Tab = 'orgs' | 'problems';

/** Farwings' own page: look after client organisations and see what is breaking for them. */
export default function Platform() {
  const me = useMe();
  const errors = usePlatformErrors();
  const [tab, setTab] = useState<Tab>('orgs');
  const open = (errors.data ?? []).filter((e) => !e.resolved).length;
  if (me.data && me.data.user.role !== 'super_admin') return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div>
              <p className="font-semibold leading-tight">Platform admin</p>
              <p className="text-xs text-ink-2">{me.data?.user.email}</p>
            </div>
          </div>
          <button type="button" onClick={() => signOut()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-canvas hover:text-ink">
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">
        <Tabs
          id="platform"
          label="Platform sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'orgs', label: 'Organisations' },
            { value: 'problems', label: open ? `Problems (${open})` : 'Problems' },
          ]}
        />
        <TabPanel id="platform" value={tab}>
          {tab === 'orgs' ? <Orgs errors={errors.data ?? []} showProblems={() => setTab('problems')} /> : <Problems errors={errors.data ?? []} loading={errors.isLoading} error={errors.error?.message} onRefresh={() => errors.refetch()} refreshing={errors.isFetching} />}
        </TabPanel>
      </main>
    </div>
  );
}

function Orgs({ errors, showProblems }: { errors: ErrorLogEntry[]; showProblems: () => void }) {
  const orgs = usePlatformOrgs();
  const info = usePlatformInfo();
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState<OrgCheckResult | null>(null);
  const status = useAction((o: Organization) => patch(`/platform/orgs/${o.id}`, { status: o.status === 'active' ? 'suspended' : 'active' }), { success: 'Organisation updated', invalidate: ['platform-orgs'] });
  const check = useAction((repair: boolean) => post<OrgCheckResult>('/platform/check', { repair }), {
    success: (r) => (r.results.every((x) => x.ok) ? 'Every organisation is fine' : 'Some organisations need attention'),
  });
  const openByOrg = (id: string) => errors.filter((e) => e.org_id === id && !e.resolved).length;

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Each client company is separate: its own Google Sheet, its own shops and its own people. No client can open another’s data."
        actions={
          <>
            <Button icon={<RefreshCw size={16} />} busy={check.isPending} onClick={() => check.mutate(false, { onSuccess: setReport })}>
              Check all organisations
            </Button>
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
              New organisation
            </Button>
          </>
        }
      />
      {report && (
        <section className="panel mb-5 p-5" aria-labelledby="chk">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="chk" className="text-base font-semibold">
              Check result
            </h2>
            {report.results.some((r) => !r.ok) && (
              <Button size="sm" icon={<Wrench size={15} />} busy={check.isPending} onClick={() => check.mutate(true, { onSuccess: setReport })}>
                Add missing tabs and columns
              </Button>
            )}
          </div>
          <ul className="mt-3 divide-y divide-line-2 text-sm">
            {report.results.map((r) => (
              <li key={r.org_id} className="flex items-start gap-2 py-2">
                {r.ok ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-good" aria-hidden="true" /> : <CircleAlert size={18} className="mt-0.5 shrink-0 text-loss" aria-hidden="true" />}
                <div>
                  <p className="font-medium">
                    {r.name} <span className="font-normal text-ink-2">{r.ok ? (r.fixed.length ? `fixed: added ${r.fixed.join(', ')}` : 'spreadsheet reachable, all tabs present') : r.problem}</span>
                  </p>
                  {!r.ok && /Share it with|could not be opened/i.test(r.problem) && <p className="text-xs text-ink-2">Ask the client to share their sheet as Editor with {report.service_account_email}.</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {orgs.error && <Notice tone="loss">{orgs.error.message}</Notice>}
      {orgs.data && orgs.data.length === 0 && (
        <div className="panel">
          <EmptyState title="No organisations yet" body="Create the first one. You will need a Google Sheet shared with the app's service account." />
        </div>
      )}
      {orgs.data && orgs.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {orgs.data.map((o) => {
            const n = openByOrg(o.id);
            return (
              <li key={o.id} className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">
                    {o.name} {o.status !== 'active' && <span className="ms-1 rounded-full bg-loss-soft px-2 py-0.5 text-xs font-medium text-loss">Suspended</span>}
                  </h2>
                  <p className="text-sm text-ink-2">
                    {o.slug} · created {dateLabel(o.created_at.slice(0, 10))} ·{' '}
                    <a href={`https://docs.google.com/spreadsheets/d/${o.sheet_id}/edit`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                      Open sheet <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  </p>
                  {n > 0 && (
                    <button type="button" onClick={showProblems} className="mt-1 text-sm font-medium text-loss underline">
                      {n} open {n === 1 ? 'problem' : 'problems'}
                    </button>
                  )}
                </div>
                <Button size="sm" variant={o.status === 'active' ? 'danger' : 'secondary'} onClick={() => status.mutate(o)}>
                  {o.status === 'active' ? 'Suspend' : 'Re-activate'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <CreateOrg serviceEmail={info.data?.service_account_email ?? ''} onClose={() => setCreating(false)} />}
    </>
  );
}

function hint(e: ErrorLogEntry): string {
  if (/Share it with|could not be opened|not found/i.test(e.message)) return 'The client’s spreadsheet cannot be opened. It was probably deleted or no longer shared with the service account. Open Organisations → Check all organisations for the exact fix.';
  if (/quota|rate limit|429|busy|too many/i.test(e.message)) return 'Google’s per-minute limit was reached. It clears by itself; if it keeps coming back, ask Google for a higher Sheets quota.';
  if (e.source === 'browser') return 'A screen crashed in someone’s browser. The details show where. Fix it in src/, run npm run build, and upload the dist folder to Hostinger.';
  return 'A bug on the server. The details show where. Fix it in supabase/functions, run supabase functions deploy api, then mark this solved.';
}

function Problems({ errors, loading, error, onRefresh, refreshing }: { errors: ErrorLogEntry[]; loading: boolean; error?: string; onRefresh: () => void; refreshing: boolean }) {
  const orgs = usePlatformOrgs();
  const [show, setShow] = useState<'open' | 'solved'>('open');
  const name = (id: string) => orgs.data?.find((o) => o.id === id)?.name ?? (id ? id : 'Platform');
  const resolve = useAction((a: { id: string; resolved: boolean }) => patch(`/platform/errors/${a.id}`, { resolved: a.resolved }), { invalidate: ['platform-errors'] });
  const rows = useMemo(() => errors.filter((e) => (show === 'open' ? !e.resolved : e.resolved)), [errors, show]);

  return (
    <>
      <PageHeader
        title="Problems"
        description="Everything that broke while clients were using the system. Fix it in the main code, publish it again, then mark it solved."
        actions={
          <Button icon={<RefreshCw size={16} />} busy={refreshing} onClick={onRefresh}>
            Refresh
          </Button>
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label="Show">
        {(['open', 'solved'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={cx('min-h-9 rounded-[7px] px-3 text-sm font-medium', show === v ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2')}>
            {v === 'open' ? `Open (${errors.filter((e) => !e.resolved).length})` : 'Solved'}
          </button>
        ))}
      </div>
      {error && <Notice tone="loss">{error}</Notice>}
      {loading && <p className="text-ink-2">Loading…</p>}
      {!loading && rows.length === 0 && (
        <div className="panel">
          <EmptyState title={show === 'open' ? 'Nothing is broken' : 'Nothing solved yet'} body={show === 'open' ? 'When something fails for a client, it appears here with where it happened and who it happened to.' : undefined} icon={<CircleCheck size={28} />} />
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((e) => (
          <li key={e.id} className="panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{e.message}</p>
                <p className="text-sm text-ink-2">
                  {name(e.org_id)}
                  {e.user_name && ` · ${e.user_name}${e.role ? ` (${e.role})` : ''}`} · {e.source === 'browser' ? 'screen' : e.where} · {new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {e.source === 'browser' && e.where ? ` · ${e.where}` : ''}
                </p>
              </div>
              <Button size="sm" onClick={() => resolve.mutate({ id: e.id, resolved: !e.resolved })}>
                {e.resolved ? 'Reopen' : 'Mark solved'}
              </Button>
            </div>
            <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm text-ink-2">{hint(e)}</p>
            {e.detail && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-primary">Details for the fix</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-canvas p-3 text-xs">{e.detail}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function CreateOrg({ serviceEmail, onClose }: { serviceEmail: string; onClose: () => void }) {
  const [f, setF] = useState({ name: '', slug: '', sheet: '', admin_name: '', admin_email: '', admin_password: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value, ...(k === 'name' && !p.slug ? {} : {}) }));
  const create = useAction((body: typeof f) => post<Organization>('/platform/orgs', body), { success: (o) => `${o.name} is ready. Its admin can sign in now.`, invalidate: ['platform-orgs'] });
  const slug = f.slug || f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="New organisation"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={create.isPending} onClick={() => create.mutate({ ...f, slug }, { onSuccess: onClose })}>
            Create organisation
          </Button>
        </>
      }
    >
      <ol className="mb-5 flex list-decimal flex-col gap-2 ps-5 text-sm">
        <li>In the client’s Google account, create an empty Google Sheet. The client owns it and can always open it.</li>
        <li>
          Share it as <strong>Editor</strong> with the app’s service account:
          <span className="mt-1 flex items-center gap-2">
            <code className="rounded bg-canvas px-2 py-1 text-xs">{serviceEmail || 'loading…'}</code>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={14} />}
              onClick={() =>
                navigator.clipboard
                  .writeText(serviceEmail)
                  .then(() => toast('Email copied'))
                  .catch(() => toast('Could not copy. Select the email and copy it.', 'error'))
              }
            >
              Copy
            </Button>
          </span>
        </li>
        <li>Paste the sheet link below. The app adds every tab and column it needs.</li>
      </ol>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Organisation name" value={f.name} onChange={set('name')} required />
        <TextField label="Short name" value={slug} onChange={set('slug')} hint="Lower-case letters, numbers and dashes." />
        <TextField label="Google Sheet link" className="sm:col-span-2" value={f.sheet} onChange={set('sheet')} placeholder="https://docs.google.com/spreadsheets/d/…" required />
        <TextField label="First administrator’s name" value={f.admin_name} onChange={set('admin_name')} required />
        <TextField label="Their email (or phone)" value={f.admin_email} onChange={set('admin_email')} required hint="They sign in with this." />
        <TextField label="Temporary password" type="text" value={f.admin_password} onChange={set('admin_password')} required hint="At least 8 characters. Ask them to keep it private." />
      </div>
    </Dialog>
  );
}
