import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Languages, Phone, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { useLang, type Key } from '../../lib/i18n';
import { dateInZone, type DeliveryStatus } from '../../lib/domain';
import { money, setCurrency, timeIn } from '../../lib/format';
import { BrandMark } from '../../ui/BrandMark';
import { cx } from '../../ui/controls';

interface Tracked {
  company: { name: string; name_ar: string; logo_url: string; phone: string; time_zone: string; currency?: { code: string; decimals: number } };
  delivery: {
    ref: string;
    doc_kind: string;
    doc_number: string;
    status: DeliveryStatus;
    date: string;
    timing: 'flexible' | 'window';
    window_from: string;
    window_to: string;
    eta: string;
    delivered_at: string;
    receiver_name: string;
    to_pay: number;
    driver_first_name: string;
    vehicle_plate: string;
    rated: boolean;
    pod?: { signature: string; photos: string[] } | null;
  };
}

const STAGES: { key: Key; reached: DeliveryStatus[] }[] = [
  { key: 'stConfirmed', reached: ['unassigned', 'assigned', 'accepted', 'picked_up', 'arrived', 'delivered'] },
  { key: 'stAssigned', reached: ['assigned', 'accepted', 'picked_up', 'arrived', 'delivered'] },
  { key: 'stOnWay', reached: ['picked_up', 'arrived', 'delivered'] },
  { key: 'stArrived', reached: ['arrived', 'delivered'] },
  { key: 'stDelivered', reached: ['delivered'] },
];
const FINAL: DeliveryStatus[] = ['delivered', 'failed', 'cancelled'];

/** Public page from the customer's SMS or WhatsApp link. Shows only this one delivery. */
export default function TrackPage() {
  const { token = '' } = useParams();
  const { t, dir, lang, toggle } = useLang('track');
  const q = useQuery({
    queryKey: ['track', token],
    queryFn: () => api<Tracked>('GET', `/track/${encodeURIComponent(token)}`, undefined, { auth: false }),
    // Every open page reads the sheets; two minutes keeps many customers within Google's limits.
    refetchInterval: (query) => (query.state.data && FINAL.includes(query.state.data.delivery.status) ? false : 120_000),
    retry: 1,
  });
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const c = q.data?.company;
  const company = c ? (lang === 'ar' ? c.name_ar || c.name : c.name) : '';
  useEffect(() => {
    document.title = company ? `${t('trackTitle')} | ${company}` : t('trackTitle');
  }, [t, company]);

  const header = (
    <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {c?.logo_url ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded object-contain" /> : <BrandMark size={40} />}
        <span className="truncate text-lg font-semibold">{company}</span>
      </div>
      <button type="button" onClick={toggle} lang={lang === 'ar' ? 'en' : 'ar'} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-medium text-primary hover:bg-canvas">
        <Languages size={20} aria-hidden="true" /> {t('otherLang')}
      </button>
    </header>
  );

  if (q.isLoading) {
    return (
      <div dir={dir} lang={lang} className="min-h-dvh bg-canvas">
        {header}
        <p role="status" className="mx-auto max-w-lg px-5 py-10 text-ink-2">
          …
        </p>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div dir={dir} lang={lang} className="min-h-dvh bg-canvas">
        {header}
        <main className="mx-auto max-w-lg px-5 py-10">
          <h1 className="text-2xl font-semibold">{t('notFound')}</h1>
          <p className="mt-2 text-ink-2">{t('notFoundBody')}</p>
        </main>
      </div>
    );
  }

  setCurrency(q.data.company.currency);
  const d = q.data.delivery;
  const tz = q.data.company.time_zone || 'Asia/Muscat';
  const reachedIdx = STAGES.reduce((acc, s, i) => (s.reached.includes(d.status) ? i : acc), -1);
  const rated = sent || d.rated;
  const fmtDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString(lang === 'ar' ? 'ar-OM' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const isToday = d.date === dateInZone(tz);

  async function sendRating(e: React.FormEvent) {
    e.preventDefault();
    if (!stars) return;
    setBusy(true);
    setErr('');
    try {
      await api('POST', `/track/${encodeURIComponent(token)}/rate`, { stars, comment }, { auth: false });
      setSent(true);
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir={dir} lang={lang} className="min-h-dvh bg-canvas text-[17px]">
      {header}
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-5 py-6">
        <div>
          <p className="text-ink-2">{t('orderRef', { doc: `${d.doc_kind} ${d.doc_number}` })}</p>
          <h1 className="text-2xl font-semibold">{t('trackTitle')}</h1>
        </div>

        {d.status === 'cancelled' ? (
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">{t('cancelledTitle')}</h2>
          </section>
        ) : d.status === 'failed' ? (
          <section className="rounded-xl border border-loss/30 bg-loss-soft p-5 text-loss">
            <h2 className="text-lg font-semibold">{t('failedTitle')}</h2>
            <p className="mt-1">{t('failedBody')}</p>
          </section>
        ) : d.status === 'delivered' ? (
          <section className="rounded-xl border border-good/30 bg-good-soft p-5 text-good" aria-live="polite">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Check size={22} aria-hidden="true" /> {t('confirmed')}
            </h2>
            <p className="mt-1">{t('confirmedBody', { company })}</p>
            {d.delivered_at && <p className="mt-2 text-ink">{t('deliveredAt', { time: timeIn(d.delivered_at, tz) })}</p>}
            {d.receiver_name && <p className="text-ink">{t('receivedBy', { name: d.receiver_name })}</p>}
          </section>
        ) : (
          <section className="rounded-xl border border-line bg-surface p-5" aria-live="polite">
            {d.eta && isToday && d.status !== 'arrived' ? (
              <>
                <p className="text-ink-2">{t('etaLabel')}</p>
                <p className="num text-[2.75rem] font-semibold leading-none" dir="ltr">
                  {timeIn(d.eta, tz)}
                </p>
              </>
            ) : d.status === 'arrived' ? (
              <p className="text-lg font-semibold">{t('stArrived')}</p>
            ) : (
              <p className="text-lg font-semibold">{t('scheduledFor', { date: fmtDate(d.date) })}</p>
            )}
            {d.timing === 'window' && (
              <p className="mt-1 text-ink-2" dir="ltr">
                {d.window_from}–{d.window_to}
              </p>
            )}
          </section>
        )}
        {d.status === 'delivered' && d.pod && (d.pod.signature || d.pod.photos.length > 0) && (
          <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="pod-h">
            <h2 id="pod-h" className="text-lg font-semibold">
              {t('proofTitle')}
            </h2>
            {d.pod.signature && <img src={d.pod.signature} alt={t('signatureAlt')} className="mt-3 h-24 rounded-lg border border-line bg-white p-1" />}
            {d.pod.photos.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {d.pod.photos.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    <img src={u} alt={t('photoAlt')} className="aspect-[4/3] w-full rounded-lg object-cover" />
                  </a>
                ))}
              </div>
            )}
          </section>
        )}

        {d.status !== 'cancelled' && d.status !== 'failed' && (
          <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="stages-h">
            <h2 id="stages-h" className="sr-only">
              {t('trackTitle')}
            </h2>
            <ol className="flex flex-col">
              {STAGES.map((s, i) => {
                const done = i <= reachedIdx;
                const current = i === reachedIdx;
                return (
                  <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0" aria-current={current ? 'step' : undefined}>
                    {i < STAGES.length - 1 && <span aria-hidden="true" className={cx('absolute start-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5', i < reachedIdx ? 'bg-good' : 'bg-line')} />}
                    <span aria-hidden="true" className={cx('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2', done ? 'border-good bg-good text-white' : 'border-line bg-surface')}>
                      {done && <Check size={16} />}
                    </span>
                    <span className={cx('pt-0.5', current ? 'font-semibold' : done ? '' : 'text-ink-3')}>
                      {t(s.key)}
                      <span className="sr-only">{done ? ' ✓' : ''}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {d.driver_first_name && !FINAL.includes(d.status) && (
          <section className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-5">
            <div>
              <p className="text-sm text-ink-2">{t('driver')}</p>
              <p className="font-semibold">{d.driver_first_name}</p>
            </div>
            {d.vehicle_plate && (
              <div>
                <p className="text-sm text-ink-2">{t('vehicle')}</p>
                <p className="num font-semibold" dir="ltr">
                  {d.vehicle_plate}
                </p>
              </div>
            )}
          </section>
        )}

        {d.to_pay > 0 && <p className="rounded-xl bg-attention-soft px-5 py-3 font-semibold text-attention">{t('toPay', { amount: money(d.to_pay) })}</p>}

        {d.status === 'delivered' && (
          <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="rate-h">
            <h2 id="rate-h" className="text-lg font-semibold">
              {t('rateTitle')}
            </h2>
            {rated ? (
              <p className="mt-2" role="status">
                {t('thanks')}
              </p>
            ) : (
              <form className="mt-3 flex flex-col gap-4" onSubmit={sendRating}>
                <fieldset>
                  <legend className="sr-only">{t('rateTitle')}</legend>
                  <div className="flex gap-1" dir="ltr">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="cursor-pointer rounded-md p-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary">
                        <input type="radio" name="stars" value={n} className="sr-only" checked={stars === n} onChange={() => setStars(n)} />
                        <Star size={36} aria-hidden="true" className={n <= stars ? 'fill-attention text-attention' : 'text-ink-3'} />
                        <span className="sr-only">{t('starsLabel', { n })}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="flex flex-col gap-1">
                  <label htmlFor="rc" className="font-medium">
                    {t('rateComment')}
                  </label>
                  <textarea id="rc" className="field-input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
                </div>
                {err && (
                  <p role="alert" className="text-loss">
                    {err}
                  </p>
                )}
                <button type="submit" disabled={!stars || busy} className="min-h-12 rounded-lg bg-primary font-semibold text-white disabled:opacity-50">
                  {t('sendRating')}
                </button>
              </form>
            )}
          </section>
        )}

        {c?.phone && (
          <a href={`tel:${c.phone}`} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface font-semibold">
            <Phone size={20} aria-hidden="true" /> {t('callUs')}{' '}
            <span className="num" dir="ltr">
              {c.phone}
            </span>
          </a>
        )}
      </main>
    </div>
  );
}
