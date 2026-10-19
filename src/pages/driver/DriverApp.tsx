import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Fuel, ChevronRight, CircleCheck, CircleX, Clock, CloudUpload, Languages, LogOut, MapPin, MoreVertical, Navigation, PackageCheck, Phone, WifiOff } from 'lucide-react';
import { get, post } from '../../lib/api';
import { DEMO } from '../../lib/config';
import { signOut } from '../../lib/auth';
import { useMe } from '../../lib/queries';
import { toast } from '../../lib/toast';
import { useLang } from '../../lib/i18n';
import { googleMapsLink, wazeLink, type CollectType, type DeliveryStatus, type DriverUpdate, type OrderLine } from '../../lib/domain';
import { money, setCurrency, timeIn } from '../../lib/format';
import { cx } from '../../ui/controls';
import { BrandMark } from '../../ui/BrandMark';
import { BigButton, CompleteDialog, DeclineDialog, FailDialog, FuelDialog, type CompleteValues } from './sheets';
import { enqueue, flush, isOnline, RESULT, setSimulatedOffline, useQueue } from './queue';

// ------------------------------------------------------------------ data
interface DriverDelivery {
  id: string;
  ref: string;
  status: DeliveryStatus;
  doc_kind: string;
  doc_number: string;
  timing: 'flexible' | 'window';
  window_from: string;
  window_to: string;
  urgent: boolean;
  eta: string;
  weight_kg: number;
  volume_cbm?: number;
  lines?: OrderLine[];
  helpers?: number;
  equipment?: 'none' | 'crane' | 'forklift';
  notes: string;
  collect_type: CollectType;
  collect_amount: number;
  collect_note: string;
  trip_id: string;
  customer: { name: string; contact_name: string; phone: string };
  address: { label: string; line: string; lat: number; lng: number } | null;
  pickup: { name: string; lat: number; lng: number; address: string } | null;
}
interface Today {
  me: { id: string; name: string; on_shift: boolean; shift_started_at: string };
  today: string;
  time_zone: string;
  company: string;
  currency?: { code: string; decimals: number };
  vehicle?: { id: string; plate: string } | null;
  deliveries: DriverDelivery[];
}
type View = DriverDelivery & { view: DeliveryStatus; pending: boolean };

const SNAP = 'dp-driver-today';
function snapshot(): Today | undefined {
  try {
    const v = localStorage.getItem(SNAP);
    return v ? (JSON.parse(v) as Today) : undefined;
  } catch {
    return undefined;
  }
}

/** Today's list, kept on the phone so it still opens without signal. Checks for new work every minute. */
function useToday() {
  return useQuery({
    queryKey: ['driver-today'],
    queryFn: async () => {
      const t = await get<Today>('/driver/today');
      try {
        localStorage.setItem(SNAP, JSON.stringify(t));
      } catch {
        /* ignore */
      }
      return t;
    },
    initialData: snapshot,
    initialDataUpdatedAt: 0,
    refetchInterval: () => (isOnline() ? 60_000 : false),
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** The list with updates still waiting on the phone already applied, so the screen moves on at once. */
function useMine(data: Today | undefined): View[] {
  const { queue } = useQueue();
  return useMemo(() => {
    if (!data) return [];
    const out: View[] = [];
    for (const d of data.deliveries) {
      let view: DeliveryStatus | 'removed' = d.status;
      let pending = false;
      for (const q of queue) {
        if (q.delivery_id !== d.id) continue;
        view = RESULT[q.action];
        pending = true;
      }
      if (view !== 'removed') out.push({ ...d, view, pending });
    }
    return out;
  }, [data, queue]);
}

function useAct() {
  const qc = useQueryClient();
  const { t } = useLang('driver');
  return (delivery_id: string, action: DriverUpdate['action'], extra: Partial<DriverUpdate> = {}, quiet = false) => {
    const r = enqueue({ delivery_id, action, ...extra });
    if (!quiet) toast(r === 'queued' ? t('savedOffline') : t('saved'), r === 'queued' ? 'info' : 'success');
    void flush(() => qc.invalidateQueries({ queryKey: ['driver-today'] }));
  };
}

// ------------------------------------------------------------------ shell
export default function DriverApp() {
  const { t, dir, lang } = useLang('driver');
  const me = useMe();
  useEffect(() => {
    const prev = document.title;
    document.title = `${t('appName')} | Deliveries`;
    return () => {
      document.title = prev;
    };
  }, [t]);
  if (me.data && me.data.user.role !== 'driver') return <Navigate to="/" replace />;
  return (
    <div dir={dir} lang={lang} className="min-h-dvh bg-canvas text-[17px]">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-canvas">
        <SignedIn />
      </div>
    </div>
  );
}

function SignedIn() {
  const { t, lang, toggle } = useLang('driver');
  const nav = useNavigate();
  const qc = useQueryClient();
  const today = useToday();
  const { queue, simulatedOffline, browserOnline, flushing } = useQueue();
  const online = browserOnline && !simulatedOffline;
  const [menu, setMenu] = useState(false);
  const mine = useMine(today.data);
  const fresh = mine.filter((d) => d.view === 'assigned').length;
  const prevFresh = useRef<number | null>(null);
  const [alert, setAlert] = useState('');

  // Send waiting updates when the connection returns, and retry every 20 s while any are waiting.
  useEffect(() => {
    const go = () => flush(() => qc.invalidateQueries({ queryKey: ['driver-today'] }));
    if (online && queue.length) void go();
    if (!online || !queue.length) return;
    const h = setInterval(go, 20_000);
    return () => clearInterval(h);
  }, [online, queue.length, qc]);

  // New-assignment alert: vibrate and announce when the number of new deliveries goes up.
  useEffect(() => {
    if (!today.data || today.isPlaceholderData) return;
    if (prevFresh.current != null && fresh > prevFresh.current) {
      setAlert(t('newAssigned', { n: fresh }));
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* not supported */
      }
    }
    prevFresh.current = fresh;
  }, [fresh, t, today.data, today.isPlaceholderData]);

  const data = today.data;
  const started = data?.me.shift_started_at ? timeIn(data.me.shift_started_at, data.time_zone) : '';
  setCurrency(data?.currency);
  const [fuel, setFuel] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-surface text-ink">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{data?.me.name ?? '…'}</p>
            <p className="text-sm text-ink-2">{data?.me.on_shift ? t('onShiftSince', { time: started }) : t('shiftOff')}</p>
          </div>
          <div className="relative flex items-center">
            <button type="button" onClick={toggle} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 font-medium hover:bg-canvas" lang={lang === 'ar' ? 'en' : 'ar'}>
              <Languages size={20} aria-hidden="true" /> {t('otherLang')}
            </button>
            <button type="button" aria-label="Menu" aria-expanded={menu} aria-controls="drv-menu" onClick={() => setMenu(!menu)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-canvas">
              <MoreVertical size={22} aria-hidden="true" />
            </button>
            {menu && (
              <div id="drv-menu" className="absolute end-0 top-12 w-64 rounded-lg border border-line bg-surface p-1 text-ink shadow-xl">
                {data?.vehicle && (
                  <button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-start hover:bg-canvas" onClick={() => (setMenu(false), setFuel(true))}>
                    <Fuel size={20} aria-hidden="true" /> {t('addFuel')}
                  </button>
                )}
                {DEMO && (
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 hover:bg-canvas">
                    <input type="checkbox" className="h-5 w-5 accent-primary" checked={simulatedOffline} onChange={(e) => setSimulatedOffline(e.target.checked)} />
                    {t('simulateOffline')}
                  </label>
                )}
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-start hover:bg-canvas disabled:opacity-50"
                  disabled={queue.length > 0}
                  title={queue.length > 0 ? t('pending', { n: queue.length }) : undefined}
                  onClick={async () => {
                    await signOut();
                    qc.clear();
                    try {
                      localStorage.removeItem(SNAP);
                    } catch {
                      /* ignore */
                    }
                    nav('/login');
                  }}
                >
                  <LogOut size={20} aria-hidden="true" /> {t('signOut')}
                </button>
              </div>
            )}
          </div>
        </div>
        {!online && (
          <div role="status" className="flex items-start gap-2 bg-attention-soft px-4 py-2 text-sm font-medium text-attention">
            <WifiOff size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t('offline')} {queue.length > 0 && t('pending', { n: queue.length })}
            </span>
          </div>
        )}
        {online && queue.length > 0 && (
          <div role="status" className="flex items-center gap-2 bg-primary-soft px-4 py-2 text-sm text-primary-strong">
            <CloudUpload size={18} aria-hidden="true" className={flushing ? 'animate-pulse' : ''} /> {t('pending', { n: queue.length })}
          </div>
        )}
      </header>

      {fuel && data?.vehicle && (
        <FuelDialog
          plate={data.vehicle.plate}
          onClose={() => setFuel(false)}
          onSave={async (v) => {
            try {
              await post('/driver/fuel', { ...v, vehicle_id: data.vehicle!.id });
              toast(t('fuelSaved'), 'success');
              setFuel(false);
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Error', 'error');
            }
          }}
        />
      )}
      <div aria-live="assertive" className="sr-only">
        {alert}
      </div>
      {alert && (
        <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-attention/40 bg-attention-soft px-4 py-3 font-semibold text-attention">
          <span>{alert}</span>
          <button type="button" className="min-h-11 rounded-lg bg-primary px-3 text-sm text-white" onClick={() => (setAlert(''), nav('/driver'))}>
            {t('review')}
          </button>
        </div>
      )}

      {!data ? (
        <main className="px-5 py-8">
          {today.error ? (
            <p role="alert" className="rounded-md bg-loss-soft px-3 py-2 text-loss">
              {today.error.message}
            </p>
          ) : (
            <p role="status" className="text-ink-2">
              …
            </p>
          )}
        </main>
      ) : (
        <Routes>
          <Route index element={<Home data={data} mine={mine} />} />
          <Route path="delivery/:id" element={<StopScreen data={data} mine={mine} />} />
          <Route path="*" element={<Navigate to="/driver" replace />} />
        </Routes>
      )}
    </>
  );
}

// ------------------------------------------------------------------ home
function useShift() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (action: 'start' | 'end') => {
      setBusy(true);
      try {
        await post('/driver/shift', { action });
        await qc.invalidateQueries({ queryKey: ['driver-today'] });
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
      } finally {
        setBusy(false);
      }
    },
  };
}

function Home({ data, mine }: { data: Today; mine: View[] }) {
  const { t } = useLang('driver');
  const act = useAct();
  const shift = useShift();
  const [declining, setDeclining] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!data.me.on_shift) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-5 py-8">
        <BrandMark size={48} />
        <div>
          <h1 className="text-2xl font-semibold">{t('shiftOff')}</h1>
          <p className="mt-2 text-ink-2">{t('shiftRequired')}</p>
          {mine.length > 0 && <p className="mt-2 font-medium">{t('newAssigned', { n: mine.filter((d) => d.view === 'assigned').length })}</p>}
        </div>
        <BigButton disabled={shift.busy} onClick={() => shift.run('start')}>
          {t('startShift')}
        </BigButton>
      </main>
    );
  }

  const fresh = mine.filter((d) => d.view === 'assigned');
  const toLoad = mine.filter((d) => d.view === 'accepted');
  const onRoad = mine.filter((d) => d.view === 'picked_up' || d.view === 'arrived');
  const done = mine.filter((d) => d.view === 'delivered' || d.view === 'failed');
  const next = onRoad[0];
  const later = onRoad.slice(1);
  const open = fresh.length + toLoad.length + onRoad.length;
  const total = mine.length;
  const pickupName = toLoad[0]?.pickup?.name ?? '';

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-5">
      <h1 className="sr-only">{t('myDeliveries')}</h1>

      {fresh.length > 0 && (
        <section aria-labelledby="new-h" className="overflow-hidden rounded-2xl border border-primary/40 bg-surface shadow-sm">
                    <div className="p-4">
            <h2 id="new-h" className="text-lg font-semibold">
              {t('newAssigned', { n: fresh.length })}
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {fresh.map((d) => (
                <li key={d.id} className="rounded-lg border border-line p-3">
                  <StopSummary d={d} />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" className="min-h-12 rounded-lg border border-line font-semibold hover:border-ink-3" onClick={() => setDeclining(d.id)}>
                      {t('decline')}
                    </button>
                    <button type="button" className="min-h-12 rounded-lg bg-primary font-semibold text-white hover:bg-primary-strong" onClick={() => act(d.id, 'accept')}>
                      {t('accept')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {fresh.length > 1 && (
              <div className="mt-3">
                <BigButton onClick={() => fresh.forEach((d, i) => act(d.id, 'accept', {}, i < fresh.length - 1))}>{t('acceptAll')}</BigButton>
              </div>
            )}
          </div>
        </section>
      )}

      {toLoad.length > 0 && (
        <section aria-labelledby="load-h" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="load-h" className="flex items-center gap-2 text-lg font-semibold">
            <PackageCheck size={22} aria-hidden="true" /> {t('pickupTitle')}
          </h2>
          <p className="mt-1 text-ink-2">{t('pickupBody', { place: pickupName })}</p>
          <ul className="mt-3 flex flex-col divide-y divide-line-2">
            {toLoad.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-base">
                <span className="min-w-0 truncate">
                  {d.customer.name} <span className="text-sm text-ink-2">({d.doc_kind} {d.doc_number})</span>
                </span>
                <span className="num text-sm text-ink-2">{t('kg', { n: d.weight_kg })}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <BigButton onClick={() => toLoad.forEach((d, i) => act(d.id, 'pickup', {}, i < toLoad.length - 1))}>{t('confirmPickup')}</BigButton>
          </div>
        </section>
      )}

      {next && <NextStop key={next.id} d={next} index={done.length + 1} total={total} tz={data.time_zone} />}

      {later.length > 0 && (
        <section aria-labelledby="later-h">
          <h2 id="later-h" className="mb-2 font-semibold">
            {t('myDeliveries')}
          </h2>
          <ol className="flex flex-col gap-2">
            {later.map((d, i) => (
              <li key={d.id}>
                <Link to={`/driver/delivery/${d.id}`} className={cx('flex items-center gap-3 rounded-lg border border-line bg-surface p-3', d.urgent && 'border-attention/50')}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas font-semibold">{done.length + 2 + i}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.customer.name}</span>
                    <span className="block text-sm text-ink-2">{d.eta ? t('eta', { time: timeIn(d.eta, data.time_zone) }) : t('flexible')}</span>
                  </span>
                  <ChevronRight size={20} className="text-ink-3 rtl:rotate-180" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {total === 0 && (
        <section className="rounded-xl border border-line bg-surface p-6 text-center">
          <h2 className="text-lg font-semibold">{t('noDeliveries')}</h2>
          <p className="mt-1 text-ink-2">{t('noDeliveriesBody')}</p>
        </section>
      )}
      {total > 0 && open === 0 && (
        <section className="rounded-xl border border-good/30 bg-good-soft p-5 text-good">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CircleCheck size={22} aria-hidden="true" /> {t('allDone')}
          </h2>
          <p className="mt-1">{t('allDoneBody')}</p>
        </section>
      )}

      {done.length > 0 && (
        <section aria-labelledby="done-h">
          <h2 id="done-h" className="mb-2 font-semibold">
            {t('done')} ({done.length})
          </h2>
          <ul className="flex flex-col gap-1">
            {done.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg px-1 py-2 text-base">
                {d.view === 'delivered' ? <CircleCheck size={20} className="text-good" aria-hidden="true" /> : <CircleX size={20} className="text-loss" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{d.customer.name}</span>
                <span className="text-sm text-ink-2">{t(d.view === 'delivered' ? 'st_delivered' : 'st_failed')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-auto pt-4">
        {confirmEnd ? (
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="font-medium">{toLoad.length + onRoad.length > 0 ? t('endShiftBlocked') : t('endShiftConfirm')}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="min-h-12 rounded-lg border border-line font-semibold" onClick={() => setConfirmEnd(false)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={toLoad.length + onRoad.length > 0 || shift.busy}
                className="min-h-12 rounded-xl bg-primary font-semibold text-white disabled:opacity-50"
                onClick={async () => {
                  await shift.run('end');
                  setConfirmEnd(false);
                }}
              >
                {t('endShift')}
              </button>
            </div>
          </div>
        ) : (
          <BigButton tone="secondary" onClick={() => setConfirmEnd(true)}>
            {t('endShift')}
          </BigButton>
        )}
      </div>

      {declining && (
        <DeclineDialog
          onClose={() => setDeclining(null)}
          onConfirm={(reason) => {
            act(declining, 'decline', { reason });
            setDeclining(null);
          }}
        />
      )}
    </main>
  );
}

function UrgentChip() {
  const { t } = useLang('driver');
  return (
    <span className="inline-flex items-center rounded-full bg-attention-soft px-2.5 py-0.5 text-sm font-semibold text-attention">{t('urgent')}</span>
  );
}

function StopSummary({ d }: { d: View }) {
  const { t } = useLang('driver');
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-semibold">{d.customer.name}</p>
        {d.urgent && <UrgentChip />}
      </div>
      <p className="text-ink-2">
        {d.address?.label}
        {d.address?.line && `: ${d.address.line}`}
      </p>
      <p className="text-sm text-ink-2">
        {d.timing === 'window' ? t('window', { from: d.window_from, to: d.window_to }) : t('flexible')}, {t('kg', { n: d.weight_kg })}
      </p>
    </div>
  );
}

function CollectBox({ d }: { d: View }) {
  const { t } = useLang('driver');
  if (d.collect_type === 'none') return null;
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg bg-attention-soft px-3 py-2 text-attention">
      <Banknote size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="font-semibold">
        {t('collectTitle')}: {t(d.collect_type)}
        {(d.collect_type === 'cash' || d.collect_type === 'cheque') && (
          <>
            {' '}
            <span className="num inline-block" dir="ltr">
              {money(d.collect_amount)}
            </span>
          </>
        )}
        {d.collect_note && <span className="block text-sm font-normal">{d.collect_note}</span>}
      </p>
    </div>
  );
}

function NavButtons({ d }: { d: View }) {
  const { t } = useLang('driver');
  if (!d.address) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-ink-2">{t('navigate')}</p>
      <div className="grid grid-cols-2 gap-2">
        <a href={googleMapsLink(d.address)} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-white">
          <Navigation size={20} aria-hidden="true" /> {t('openGoogle')}
        </a>
        <a href={wazeLink(d.address)} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-white">
          <Navigation size={20} aria-hidden="true" /> {t('openWaze')}
        </a>
      </div>
    </div>
  );
}

function CallButton({ d }: { d: View }) {
  const { t } = useLang('driver');
  if (!d.customer.phone) return null;
  return (
    <a href={`tel:${d.customer.phone}`} className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-line bg-surface font-semibold hover:border-ink-3">
      <Phone size={20} aria-hidden="true" /> {t('call')}
      {d.customer.contact_name && <span className="font-normal text-ink-2">({d.customer.contact_name})</span>}
    </a>
  );
}

function NextStop({ d, index, total, tz }: { d: View; index: number; total: number; tz: string }) {
  const { t } = useLang('driver');
  const act = useAct();
  const [sheet, setSheet] = useState<null | 'complete' | 'fail'>(null);
  const arrived = d.view === 'arrived';
  return (
    <section aria-labelledby="next-h" className={cx('overflow-hidden rounded-xl border border-line bg-surface shadow-sm', d.urgent && 'border-attention/50')}>
            <div className="p-4">
        <p className="flex justify-between gap-3 text-sm font-medium text-ink-2">
          <span id="next-h">{t('nextStop')}</span>
          <span>{t('stopOf', { i: index, n: total })}</span>
        </p>
        <h2 className="mt-1 text-2xl font-semibold leading-tight">{d.customer.name}</h2>
        <p className="mt-1 flex items-start gap-2 text-lg">
          <MapPin size={20} className="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
          <span>
            {d.address?.label}
            {d.address?.line && `: ${d.address.line}`}
          </span>
        </p>
        <p className="mt-2 flex items-start gap-2 text-ink-2">
          <Clock size={18} className="mt-1 shrink-0" aria-hidden="true" />
          <span>
            {arrived ? t('st_arrived') : d.eta ? t('eta', { time: timeIn(d.eta, tz) }) : t('flexible')}
            {d.timing === 'window' && <span className="block">{t('window', { from: d.window_from, to: d.window_to })}</span>}
          </span>
        </p>
        <CollectBox d={d} />
        {d.notes && <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-base">{d.notes}</p>}
        <div className="mt-4 flex flex-col gap-2">
          {!arrived && <NavButtons d={d} />}
          <CallButton d={d} />
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-line-2 pt-4">
          {!arrived ? <BigButton onClick={() => act(d.id, 'arrive')}>{t('arrived')}</BigButton> : <BigButton onClick={() => setSheet('complete')}>{t('delivered')}</BigButton>}
          <BigButton tone="secondary" onClick={() => setSheet('fail')}>
            {t('couldNotDeliver')}
          </BigButton>
          <Link to={`/driver/delivery/${d.id}`} className="mt-1 text-center text-base font-medium text-primary underline">
            {t('document')}: {d.doc_kind} {d.doc_number}
          </Link>
        </div>
      </div>
      {sheet === 'complete' && <CompleteDialog collect={{ type: d.collect_type, amount: d.collect_amount }} lines={d.lines ?? []} onClose={() => setSheet(null)} onConfirm={(v: CompleteValues) => (setSheet(null), act(d.id, 'deliver', v))} />}
      {sheet === 'fail' && <FailDialog onClose={() => setSheet(null)} onConfirm={(reason) => (setSheet(null), act(d.id, 'fail', { reason }))} />}
    </section>
  );
}

// ------------------------------------------------------------------ one delivery
const STATUS_KEY = { assigned: 'st_assigned', accepted: 'st_accepted', picked_up: 'st_picked_up', arrived: 'st_arrived', delivered: 'st_delivered', failed: 'st_failed' } as const;

function StopScreen({ data, mine }: { data: Today; mine: View[] }) {
  const { id } = useParams();
  const { t } = useLang('driver');
  const nav = useNavigate();
  const act = useAct();
  const [sheet, setSheet] = useState<null | 'complete' | 'fail' | 'decline'>(null);
  const d = mine.find((x) => x.id === id);

  if (!d) {
    return (
      <main className="px-5 py-8">
        <p>{t('noDeliveries')}</p>
        <Link to="/driver" className="mt-4 inline-block font-medium text-primary underline">
          {t('back')}
        </Link>
      </main>
    );
  }
  const done = (fn: () => void) => () => (setSheet(null), fn(), nav('/driver'));

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      <Link to="/driver" className="inline-flex min-h-11 items-center gap-2 self-start font-medium text-primary">
        <ArrowLeft size={20} className="rtl:rotate-180" aria-hidden="true" /> {t('back')}
      </Link>
      <section className={cx('rounded-xl border border-line bg-surface p-4', d.urgent && 'border-attention/50')}>
        <p className="flex items-center gap-2 text-sm font-medium text-ink-2">
          {d.view in STATUS_KEY ? t(STATUS_KEY[d.view as keyof typeof STATUS_KEY]) : d.view}
          {d.urgent && <UrgentChip />}
        </p>
        <h1 className="text-2xl font-semibold leading-tight">{d.customer.name}</h1>
        <p className="mt-1 text-lg">
          {d.address?.label}
          {d.address?.line && `: ${d.address.line}`}
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-ink-2">{t('document')}</dt>
          <dd>
            {d.doc_kind} {d.doc_number}
          </dd>
          <dt className="text-ink-2">{t('etaLabel')}</dt>
          <dd>{d.eta ? timeIn(d.eta, data.time_zone) : t('flexible')}</dd>
          {d.timing === 'window' && (
            <>
              <dt className="text-ink-2">{t('timeWindow')}</dt>
              <dd dir="ltr" className="text-start">
                {d.window_from}–{d.window_to}
              </dd>
            </>
          )}
          <dt className="text-ink-2">{t('weight')}</dt>
          <dd className="num">{d.weight_kg}</dd>
          {d.notes && (
            <>
              <dt className="text-ink-2">{t('notes')}</dt>
              <dd>{d.notes}</dd>
            </>
          )}
        </dl>
        {((d.helpers ?? 0) > 0 || (d.equipment && d.equipment !== 'none')) && (
          <p className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
            {(d.helpers ?? 0) > 0 && <span className="rounded-full bg-primary-soft px-3 py-1 text-primary-strong">{t('helpersNeeded', { n: d.helpers ?? 0 })}</span>}
            {d.equipment === 'crane' && <span className="rounded-full bg-attention-soft px-3 py-1 text-attention">{t('craneNeeded')}</span>}
            {d.equipment === 'forklift' && <span className="rounded-full bg-attention-soft px-3 py-1 text-attention">{t('forkliftNeeded')}</span>}
          </p>
        )}
        {d.lines && d.lines.length > 0 && (
          <div className="mt-3">
            <h2 className="text-sm font-semibold text-ink-2">{t('items')}</h2>
            <ul className="mt-1 divide-y divide-line-2 rounded-lg border border-line">
              {d.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 px-3 py-2">
                  <span>{l.d}</span>
                  <span className="num shrink-0 font-semibold" dir="ltr">
                    {l.q} {l.u}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <CollectBox d={d} />
      </section>

      {['accepted', 'picked_up'].includes(d.view) && <NavButtons d={d} />}
      <CallButton d={d} />

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {d.view === 'assigned' && (
          <>
            <BigButton onClick={() => act(d.id, 'accept')}>{t('accept')}</BigButton>
            <BigButton tone="secondary" onClick={() => setSheet('decline')}>
              {t('decline')}
            </BigButton>
          </>
        )}
        {d.view === 'accepted' && <BigButton onClick={() => act(d.id, 'pickup')}>{t('confirmPickup')}</BigButton>}
        {d.view === 'picked_up' && <BigButton onClick={() => act(d.id, 'arrive')}>{t('arrived')}</BigButton>}
        {d.view === 'arrived' && <BigButton onClick={() => setSheet('complete')}>{t('delivered')}</BigButton>}
        {(d.view === 'picked_up' || d.view === 'arrived') && (
          <BigButton tone="secondary" onClick={() => setSheet('fail')}>
            {t('couldNotDeliver')}
          </BigButton>
        )}
      </div>

      {sheet === 'complete' && <CompleteDialog collect={{ type: d.collect_type, amount: d.collect_amount }} lines={d.lines ?? []} onClose={() => setSheet(null)} onConfirm={(v) => done(() => act(d.id, 'deliver', v))()} />}
      {sheet === 'fail' && <FailDialog onClose={() => setSheet(null)} onConfirm={(reason) => done(() => act(d.id, 'fail', { reason }))()} />}
      {sheet === 'decline' && <DeclineDialog onClose={() => setSheet(null)} onConfirm={(reason) => done(() => act(d.id, 'decline', { reason }))()} />}
    </main>
  );
}
