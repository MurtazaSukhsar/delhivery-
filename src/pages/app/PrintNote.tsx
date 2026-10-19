import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useDelivery, useMe, useVehicles } from '../../lib/queries';
import { currencyOf, type OrderLine, type PodLine } from '../../lib/domain';
import { dateTimeIn, money, setCurrency } from '../../lib/format';
import { trackingUrl } from './messages';
import { useNames } from './ctx';

const parse = <T,>(json: string): T[] => {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** English label with its Arabic beside it, for a bilingual printed note. */
const Bi = ({ en, ar }: { en: string; ar: string }) => (
  <span className="flex items-baseline justify-between gap-2">
    <span>{en}</span>
    <span lang="ar" dir="rtl" className="font-normal">
      {ar}
    </span>
  </span>
);

/**
 * A printable delivery note (A4) the driver takes with the goods: items, a box for the receiver's
 * signature and stamp, and a QR code the customer can scan to follow the delivery.
 */
export default function PrintNote() {
  const { id = '' } = useParams();
  const me = useMe();
  const q = useDelivery(id);
  const names = useNames();
  const d = q.data?.delivery;
  const vehicles = useVehicles(d?.shop_id ?? 'all', !!d);
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (d?.tracking_token) QRCode.toDataURL(trackingUrl(d), { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(''));
  }, [d]);
  useEffect(() => {
    if (me.data?.settings) setCurrency(currencyOf(me.data.settings));
  }, [me.data]);

  if (q.isLoading || me.isLoading) return <p className="p-6 text-ink-2">Loading…</p>;
  if (q.error || !d) return <p className="p-6 text-loss">{q.error?.message ?? 'Delivery not found.'}</p>;

  const shop = me.data?.shops.find((s) => s.id === d.shop_id);
  const customer = names.customer(d.customer_id);
  const address = names.address(d.address_id);
  const driver = names.driver(d.driver_id);
  const vehicle = vehicles.data?.find((v) => v.id === d.vehicle_id);
  const lines = parse<OrderLine>(d.lines);
  const pod = parse<PodLine>(d.pod_lines);
  const done = d.status === 'delivered';
  const blankRows = Math.max(0, 6 - lines.length);
  const cell = 'border border-ink/40 px-2 py-1.5';

  return (
    <div className="min-h-dvh bg-canvas print:bg-white">
      <nav aria-label="Delivery note" className="mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-3 print:hidden">
        <Link to={`/app/deliveries/${d.id}`} className="text-sm font-medium text-primary underline">
          Back to the delivery
        </Link>
        <button type="button" onClick={() => window.print()} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white">
          Print
        </button>
      </nav>
      <main className="mx-auto mb-8 max-w-[210mm] bg-white p-[12mm] text-[13px] text-ink shadow print:m-0 print:p-[8mm] print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-3">
          <div>
            <p className="text-lg font-bold">{me.data?.org?.name}</p>
            <p>{shop?.name}</p>
            {shop?.address && <p className="text-ink-2">{shop.address}</p>}
            {shop?.phone && <p className="text-ink-2">Tel {shop.phone}</p>}
          </div>
          <div className="text-end">
            <h1 className="text-xl font-bold">Delivery note</h1>
            <p lang="ar" dir="rtl" className="text-xl font-bold">
              إشعار تسليم
            </p>
            <p className="num mt-1 font-semibold">{d.ref}</p>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-semibold"><Bi en="Customer" ar="العميل" /></dt>
            <dd>{customer?.name}</dd>
            <dt className="font-semibold"><Bi en="Contact" ar="الاتصال" /></dt>
            <dd>{[customer?.contact_name, customer?.phone].filter(Boolean).join(', ')}</dd>
            <dt className="font-semibold"><Bi en="Address" ar="العنوان" /></dt>
            <dd>{[address?.label, address?.line].filter(Boolean).join(', ')}</dd>
          </dl>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-semibold"><Bi en="Date" ar="التاريخ" /></dt>
            <dd className="num">{d.date}</dd>
            <dt className="font-semibold"><Bi en={d.doc_kind === 'DO' ? 'DO no.' : 'Invoice no.'} ar={d.doc_kind === 'DO' ? 'رقم أمر التسليم' : 'رقم الفاتورة'} /></dt>
            <dd className="num">{d.doc_number}</dd>
            <dt className="font-semibold"><Bi en="Driver" ar="السائق" /></dt>
            <dd>{driver?.name ?? '________________'}</dd>
            <dt className="font-semibold"><Bi en="Vehicle" ar="المركبة" /></dt>
            <dd className="num">{vehicle?.plate ?? '________________'}</dd>
          </dl>
          {qr && (
            <figure className="text-center">
              <img src={qr} alt="QR code to follow this delivery" className="size-[28mm]" />
              <figcaption className="mt-1 text-[11px] leading-tight">
                Scan to track
                <br />
                <span lang="ar" dir="rtl">امسح للتتبع</span>
              </figcaption>
            </figure>
          )}
        </section>

        <table className="mt-5 w-full border-collapse">
          <thead className="bg-canvas print:bg-transparent">
            <tr>
              <th scope="col" className={`${cell} w-8 text-center`}>#</th>
              <th scope="col" className={`${cell} text-start`}><Bi en="Description" ar="الوصف" /></th>
              <th scope="col" className={`${cell} w-20 text-end`}><Bi en="Qty" ar="الكمية" /></th>
              <th scope="col" className={`${cell} w-20`}><Bi en="Unit" ar="الوحدة" /></th>
              <th scope="col" className={`${cell} w-24 text-end`}><Bi en="Received" ar="المستلم" /></th>
              <th scope="col" className={`${cell} w-40`}><Bi en="Remarks" ar="ملاحظات" /></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = pod[i];
              const remark = p ? [p.damaged ? `${p.damaged} damaged` : '', p.returned ? `${p.returned} returned` : '', p.note ?? ''].filter(Boolean).join(', ') : '';
              return (
                <tr key={i}>
                  <td className={`${cell} text-center`}>{i + 1}</td>
                  <td className={cell}>{l.d}</td>
                  <td className={`${cell} num text-end`}>{l.q}</td>
                  <td className={cell}>{l.u}</td>
                  <td className={`${cell} num text-end`}>{done && p ? p.delivered : ''}</td>
                  <td className={cell}>{remark}</td>
                </tr>
              );
            })}
            {Array.from({ length: blankRows }, (_, i) => (
              <tr key={`b${i}`} className="h-8">
                <td className={cell} />
                <td className={cell}>{!lines.length && i === 0 ? <span className="text-ink-2">As per {d.doc_number}</span> : ''}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-ink-2">
          Weight {d.weight_kg.toLocaleString()} kg{d.volume_cbm ? ` · ${d.volume_cbm} cbm` : ''}
          {d.helpers ? ` · ${d.helpers} helper${d.helpers > 1 ? 's' : ''}` : ''}
          {d.equipment !== 'none' ? ` · ${d.equipment === 'crane' ? 'crane truck' : 'forklift'}` : ''}
        </p>
        {d.collect_type !== 'none' && (
          <p className="mt-2 rounded border border-ink/40 p-2 font-semibold">
            <Bi en={d.collect_type === 'documents' ? `Collect documents: ${d.collect_note}` : `Collect ${d.collect_type}: ${money(d.collect_amount)}`} ar={d.collect_type === 'documents' ? 'استلام المستندات' : d.collect_type === 'cash' ? 'تحصيل نقدي' : 'استلام شيك'} />
          </p>
        )}
        {d.notes && <p className="mt-2"><strong>Notes:</strong> {d.notes}</p>}

        <p className="mt-6">Received the above goods in good order and condition, unless noted in the remarks.</p>
        <p lang="ar" dir="rtl">استلمت البضاعة المذكورة أعلاه بحالة جيدة ما لم يذكر خلاف ذلك في الملاحظات.</p>

        <section className="mt-4 grid grid-cols-2 gap-6">
          <div className="rounded border border-ink/40 p-3">
            <p className="font-semibold"><Bi en="Receiver" ar="المستلم" /></p>
            <p className="mt-3">Name / الاسم: {done ? <strong>{d.receiver_name}</strong> : '______________________'}</p>
            <p className="mt-3">Signature / التوقيع:</p>
            {done && q.data?.pod.signature ? <img src={q.data.pod.signature} alt="Receiver's signature" className="h-20" /> : <div className="h-16" />}
            <p>Date and time / التاريخ والوقت: {done && d.delivered_at ? dateTimeIn(d.delivered_at, me.data?.settings?.time_zone || 'Asia/Muscat') : '______________'}</p>
          </div>
          <div className="rounded border border-ink/40 p-3">
            <p className="font-semibold"><Bi en="Company stamp" ar="ختم الشركة" /></p>
            <div className="h-24" />
            <p className="font-semibold"><Bi en="Driver's signature" ar="توقيع السائق" /></p>
            <div className="h-10" />
          </div>
        </section>
        <footer className="mt-6 border-t border-ink/30 pt-2 text-center text-[11px] text-ink-2">
          {d.ref} · printed {new Date().toLocaleString('en-GB')} · follow this delivery at {trackingUrl(d).replace(/^https?:\/\//, '').slice(0, 48)}…
        </footer>
      </main>
    </div>
  );
}
