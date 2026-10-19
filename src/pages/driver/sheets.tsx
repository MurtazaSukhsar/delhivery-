import { useId, useState, type ReactNode } from 'react';
import { translate, useLang, type Key } from '../../lib/i18n';
import { Dialog } from '../../ui/controls';
import { money } from '../../lib/format';
import type { CollectType, OrderLine, PaymentMethod, PodLine } from '../../lib/domain';
import { photoToDataUrl } from '../../lib/image';
import { SignaturePad } from '../../ui/SignaturePad';

export function BigButton({ children, onClick, tone = 'primary', disabled }: { children: ReactNode; onClick?: () => void; tone?: 'primary' | 'secondary' | 'danger'; disabled?: boolean }) {
  const cls = tone === 'primary' ? 'bg-primary text-white hover:bg-primary-strong' : tone === 'danger' ? 'bg-loss text-white hover:bg-[#931c13]' : 'border border-line bg-surface text-ink hover:border-ink-3';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`min-h-14 w-full rounded-lg px-4 text-lg font-semibold disabled:opacity-55 ${cls}`}>
      {children}
    </button>
  );
}

function ReasonPicker({ legend, keys, value, onChange, other, setOther }: { legend: string; keys: Key[]; value: string; onChange: (k: string) => void; other: string; setOther: (s: string) => void }) {
  const { t } = useLang('driver');
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-col gap-2">
        {[...keys, 'reasonOther' as Key].map((k) => (
          <label key={k} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-line px-4 text-base has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary">
            <input type="radio" name={name} className="h-5 w-5 accent-primary" checked={value === k} onChange={() => onChange(k)} />
            {t(k)}
          </label>
        ))}
      </div>
      {value === 'reasonOther' && (
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor={name + '-o'} className="font-medium">
            {t('describeReason')}
          </label>
          <textarea id={name + '-o'} className="field-input min-h-20 text-base" value={other} onChange={(e) => setOther(e.target.value)} />
        </div>
      )}
    </fieldset>
  );
}

function ReasonDialog({ title, confirm, keys, onClose, onConfirm }: { title: string; confirm: string; keys: Key[]; onClose: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useLang('driver');
  const [k, setK] = useState<string>(keys[0]);
  const [other, setOther] = useState('');
  // Reasons are saved in English so the office reads them the same way whatever language the driver uses.
  const reason = k === 'reasonOther' ? other.trim() : translateEn(k as Key);
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      closeLabel={t('cancel')}
      footer={
        <div className="flex w-full flex-col gap-2">
          <BigButton tone="danger" disabled={!reason} onClick={() => onConfirm(reason)}>
            {confirm}
          </BigButton>
          <BigButton tone="secondary" onClick={onClose}>
            {t('cancel')}
          </BigButton>
        </div>
      }
    >
      <ReasonPicker legend={title} keys={keys} value={k} onChange={setK} other={other} setOther={setOther} />
    </Dialog>
  );
}

const translateEn = (k: Key) => translate('en', k);

export function DeclineDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useLang('driver');
  return <ReasonDialog title={t('declineTitle')} confirm={t('confirmDecline')} keys={['reasonVehicleSmall', 'reasonVehicleProblem', 'reasonNoTime']} onClose={onClose} onConfirm={onConfirm} />;
}

export function FailDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useLang('driver');
  return <ReasonDialog title={t('failTitle')} confirm={t('confirmFailed')} keys={['failUnreachable', 'failClosed', 'failRefused', 'failAddress']} onClose={onClose} onConfirm={onConfirm} />;
}

export interface CompleteValues {
  receiver_name: string;
  collected_amount?: number;
  collected_note?: string;
  pod_lines?: PodLine[];
  pod_note?: string;
  photos?: string[];
  signature?: string;
  payment?: { method: PaymentMethod; amount: number; cheque_no?: string; bank?: string; cheque_date?: string; photo?: string };
}

function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-ink-2">{hint}</p>}
    </div>
  );
}

function Stepper({ id, value, max, onChange, label }: { id: string; value: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`${label} −1`} className="h-12 w-12 rounded-lg border border-line text-xl font-semibold" onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <input id={id} dir="ltr" type="number" inputMode="decimal" min={0} max={max} className="field-input num !w-24 min-h-12 text-center text-lg" value={value} onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />
      <button type="button" aria-label={`${label} +1`} className="h-12 w-12 rounded-lg border border-line text-xl font-semibold" onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

/** The drop: who received it, what arrived (line by line), photos, signature and payment. */
export function CompleteDialog({ collect, lines, onClose, onConfirm }: { collect: { type: CollectType; amount: number }; lines: OrderLine[]; onClose: () => void; onConfirm: (v: CompleteValues) => void }) {
  const { t } = useLang('driver');
  const id = useId();
  const [name, setName] = useState('');
  const [pod, setPod] = useState<(PodLine & { open: boolean })[]>(() => lines.map((l) => ({ delivered: l.q, damaged: 0, returned: 0, open: false })));
  const [allGood, setAllGood] = useState(true);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState('');
  const takesMoney = collect.type === 'cash' || collect.type === 'cheque';
  const [method, setMethod] = useState<PaymentMethod>(collect.type === 'cheque' ? 'cheque' : 'cash');
  const [amount, setAmount] = useState(collect.amount ? String(collect.amount) : '');
  const [chequeNo, setChequeNo] = useState('');
  const [bank, setBank] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [chequePhoto, setChequePhoto] = useState('');
  const [docs, setDocs] = useState(false);
  const [err, setErr] = useState<{ field: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setLine = (i: number, patch: Partial<PodLine & { open: boolean }>) => setPod((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const problem = lines.length ? pod.some((p, i) => p.delivered < lines[i].q) : !allGood;

  const addPhoto = async (f: File | undefined, set: (u: string) => void) => {
    if (!f) return;
    setBusy(true);
    try {
      set(await photoToDataUrl(f));
    } catch (e) {
      setErr({ field: 'photo', msg: e instanceof Error ? e.message : 'Photo failed' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!name.trim()) return setErr({ field: 'name', msg: t('receiverRequired') });
    if (problem && !note.trim()) return setErr({ field: 'note', msg: t('problemNoteRequired') });
    if (takesMoney && method === 'cheque' && Number(amount) > 0 && !chequeNo.trim()) return setErr({ field: 'cheque', msg: t('chequeRequired') });
    const paid = takesMoney && Number(amount) > 0;
    onConfirm({
      receiver_name: name.trim(),
      collected_amount: takesMoney ? Number(amount) || 0 : undefined,
      collected_note: collect.type === 'documents' ? (docs ? 'Documents received' : 'Documents not received') : undefined,
      pod_lines: lines.length ? pod.map(({ delivered, damaged, returned }) => ({ delivered, damaged, returned })) : undefined,
      pod_note: note.trim() || undefined,
      photos: photos.length ? photos : undefined,
      signature: signature || undefined,
      payment: paid ? { method, amount: Number(amount), cheque_no: chequeNo.trim() || undefined, bank: bank.trim() || undefined, cheque_date: chequeDate || undefined, photo: chequePhoto || undefined } : undefined,
    });
  };
  const errFor = (f: string) =>
    err?.field === f ? (
      <p id={id + f + 'e'} className="text-base font-medium text-loss">
        {err.msg}
      </p>
    ) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('delivered')}
      closeLabel={t('cancel')}
      footer={
        <div className="flex w-full flex-col gap-2">
          <BigButton onClick={confirm} disabled={busy}>
            {t('confirmDelivered')}
          </BigButton>
          <BigButton tone="secondary" onClick={onClose}>
            {t('cancel')}
          </BigButton>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <Field id={id + 'n'} label={t('receiverName')}>
          <input id={id + 'n'} className="field-input min-h-14 text-lg" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={err?.field === 'name' || undefined} autoComplete="off" />
          {errFor('name')}
        </Field>

        <section aria-labelledby={id + 'w'}>
          <h3 id={id + 'w'} className="mb-2 text-base font-semibold">
            {t('whatArrived')}
          </h3>
          {lines.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {lines.map((l, i) => {
                const p = pod[i];
                const short = p.delivered < l.q;
                return (
                  <li key={i} className={`rounded-lg border p-3 ${short ? 'border-attention bg-attention-soft' : 'border-line'}`}>
                    <p className="font-semibold">{l.d}</p>
                    <p className="text-sm text-ink-2">{t('ordered', { q: l.q, u: l.u })}</p>
                    <div className="mt-2">
                      <label htmlFor={`${id}d${i}`} className="text-sm font-medium">
                        {t('deliveredQty')}
                      </label>
                      <Stepper id={`${id}d${i}`} label={t('deliveredQty')} value={p.delivered} max={l.q - p.damaged - p.returned} onChange={(n) => setLine(i, { delivered: n })} />
                    </div>
                    {!p.open ? (
                      <button type="button" className="mt-2 min-h-11 text-base font-medium text-primary underline" onClick={() => setLine(i, { open: true })}>
                        {t('reportProblem')}
                      </button>
                    ) : (
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        <div>
                          <label htmlFor={`${id}x${i}`} className="text-sm font-medium">
                            {t('damagedQty')}
                          </label>
                          <Stepper id={`${id}x${i}`} label={t('damagedQty')} value={p.damaged} max={l.q - p.returned} onChange={(n) => setLine(i, { damaged: n, delivered: Math.max(0, l.q - n - p.returned) })} />
                        </div>
                        <div>
                          <label htmlFor={`${id}r${i}`} className="text-sm font-medium">
                            {t('returnedQty')}
                          </label>
                          <Stepper id={`${id}r${i}`} label={t('returnedQty')} value={p.returned} max={l.q - p.damaged} onChange={(n) => setLine(i, { returned: n, delivered: Math.max(0, l.q - n - p.damaged) })} />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <label className="flex min-h-14 items-center gap-3 rounded-lg border border-line px-4">
              <input type="checkbox" className="h-6 w-6 accent-primary" checked={allGood} onChange={(e) => setAllGood(e.target.checked)} />
              {t('allGood')}
            </label>
          )}
          {(problem || note) && (
            <div className="mt-3">
              <Field id={id + 'p'} label={t('problemNote')}>
                <textarea id={id + 'p'} className="field-input min-h-20 text-base" value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={err?.field === 'note' || undefined} />
                {errFor('note')}
              </Field>
            </div>
          )}
        </section>

        <section aria-labelledby={id + 'ph'}>
          <h3 id={id + 'ph'} className="mb-2 text-base font-semibold">
            {t('photos')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                <img src={p} alt="" className="h-24 w-24 rounded-lg object-cover" />
                <button type="button" aria-label={t('removePhoto')} className="absolute -end-2 -top-2 h-8 w-8 rounded-full bg-ink text-white" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            {photos.length < 3 && (
              <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line text-center text-sm font-medium text-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary">
                <span aria-hidden="true" className="text-2xl">+</span>
                {t('addPhoto')}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => addPhoto(e.target.files?.[0], (u) => setPhotos((x) => [...x, u]))} />
              </label>
            )}
          </div>
          {errFor('photo')}
        </section>

        <section aria-labelledby={id + 's'}>
          <h3 id={id + 's'} className="mb-1 text-base font-semibold">
            {t('signature')}
          </h3>
          <p className="mb-2 text-sm text-ink-2">{t('signHere')}</p>
          <SignaturePad label={t('signature')} clearLabel={t('clear')} onChange={setSignature} />
        </section>

        {takesMoney && (
          <section aria-labelledby={id + 'm'} className="flex flex-col gap-4">
            <h3 id={id + 'm'} className="text-base font-semibold">
              {t('payment')}
            </h3>
            <fieldset>
              <legend className="sr-only">{t('payment')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'cheque', 'transfer'] as const).map((m) => (
                  <label key={m} className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-line text-center text-base font-medium has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary">
                    <input type="radio" name={id + 'pm'} className="sr-only" checked={method === m} onChange={() => setMethod(m)} />
                    {t(m === 'cash' ? 'payCash' : m === 'cheque' ? 'payCheque' : 'payTransfer')}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field id={id + 'a'} label={t('amountCollected')} hint={t('amountExpected', { amount: money(collect.amount) })}>
              <input id={id + 'a'} dir="ltr" type="number" inputMode="decimal" step="0.001" className="field-input num min-h-14 text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            {method === 'cheque' && (
              <>
                <Field id={id + 'c'} label={t('chequeNo')}>
                  <input id={id + 'c'} dir="ltr" inputMode="numeric" className="field-input num min-h-14 text-lg" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} aria-invalid={err?.field === 'cheque' || undefined} />
                  {errFor('cheque')}
                </Field>
                <Field id={id + 'b'} label={t('chequeBank')}>
                  <input id={id + 'b'} className="field-input min-h-14 text-lg" value={bank} onChange={(e) => setBank(e.target.value)} />
                </Field>
                <Field id={id + 'cd'} label={t('chequeDate')}>
                  <input id={id + 'cd'} type="date" className="field-input min-h-14 text-lg" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
                </Field>
                <div>
                  <p className="mb-1 font-medium">{t('chequePhoto')}</p>
                  {chequePhoto ? (
                    <div className="relative inline-block">
                      <img src={chequePhoto} alt="" className="h-24 rounded-lg object-cover" />
                      <button type="button" aria-label={t('removePhoto')} className="absolute -end-2 -top-2 h-8 w-8 rounded-full bg-ink text-white" onClick={() => setChequePhoto('')}>
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex min-h-12 cursor-pointer items-center rounded-lg border border-line px-4 font-medium text-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary">
                      {t('addPhoto')}
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => addPhoto(e.target.files?.[0], setChequePhoto)} />
                    </label>
                  )}
                </div>
              </>
            )}
          </section>
        )}
        {collect.type === 'documents' && (
          <label className="flex min-h-14 items-center gap-3 rounded-lg border border-line px-4">
            <input type="checkbox" className="h-6 w-6 accent-primary" checked={docs} onChange={(e) => setDocs(e.target.checked)} />
            {t('docsCollected')}
          </label>
        )}
      </div>
    </Dialog>
  );
}

/** A fuel fill-up for today's vehicle. */
export function FuelDialog({ plate, onClose, onSave }: { plate: string; onClose: () => void; onSave: (v: { amount: number; litres?: number; odometer?: number }) => Promise<void> }) {
  const { t } = useLang('driver');
  const id = useId();
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [odo, setOdo] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t('addFuel')} · ${plate}`}
      closeLabel={t('cancel')}
      footer={
        <div className="flex w-full flex-col gap-2">
          <BigButton
            disabled={!(Number(amount) > 0) || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({ amount: Number(amount), litres: litres ? Number(litres) : undefined, odometer: odo ? Number(odo) : undefined });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('save')}
          </BigButton>
          <BigButton tone="secondary" onClick={onClose}>
            {t('cancel')}
          </BigButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field id={id + 'a'} label={t('fuelAmount')}>
          <input id={id + 'a'} dir="ltr" type="number" inputMode="decimal" className="field-input num min-h-14 text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id={id + 'l'} label={t('fuelLitres')}>
          <input id={id + 'l'} dir="ltr" type="number" inputMode="decimal" className="field-input num min-h-14 text-lg" value={litres} onChange={(e) => setLitres(e.target.value)} />
        </Field>
        <Field id={id + 'o'} label={t('odometer')}>
          <input id={id + 'o'} dir="ltr" type="number" inputMode="numeric" className="field-input num min-h-14 text-lg" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
