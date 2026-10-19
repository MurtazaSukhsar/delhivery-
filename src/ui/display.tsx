import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, TriangleAlert, X, Info, PackageOpen } from 'lucide-react';
import type { DeliveryStatus } from '../lib/domain';
import type { Band } from '../lib/domain';
import { useToasts } from '../lib/toast';
import { cx } from './controls';

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  accepted: 'Accepted',
  picked_up: 'Picked up',
  arrived: 'Arrived',
  delivered: 'Delivered',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  unassigned: 'bg-canvas text-ink-2 border-line',
  assigned: 'bg-primary-soft text-primary-strong border-primary/25',
  accepted: 'bg-primary-soft text-primary-strong border-primary/25',
  picked_up: 'bg-primary-soft text-primary-strong border-primary/25',
  arrived: 'bg-primary-soft text-primary-strong border-primary/25',
  delivered: 'bg-good-soft text-good border-good/25',
  failed: 'bg-loss-soft text-loss border-loss/25',
  cancelled: 'bg-canvas text-ink-3 border-line line-through',
};

const STATUS_DOT: Record<DeliveryStatus, string> = {
  unassigned: 'bg-ink-3',
  assigned: 'bg-primary',
  accepted: 'bg-primary',
  picked_up: 'bg-primary',
  arrived: 'bg-primary',
  delivered: 'bg-good',
  failed: 'bg-loss',
  cancelled: 'bg-ink-3',
};

export function StatusPill({ status, className }: { status: DeliveryStatus; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLE[status], className)}>
      <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export const BAND_LABEL: Record<Band, string> = {
  good: 'Within expected cost',
  attention: 'Needs attention',
  loss: 'May result in a loss',
};

const BAND_SHORT: Record<Band, string> = { good: 'Within cost', attention: 'Attention', loss: 'Loss risk' };

export function BandBadge({ band, short }: { band: Band; short?: boolean }) {
  const Icon = band === 'good' ? CircleCheck : band === 'attention' ? TriangleAlert : CircleAlert;
  const style = band === 'good' ? 'text-good bg-good-soft' : band === 'attention' ? 'text-attention bg-attention-soft' : 'text-loss bg-loss-soft';
  return (
    <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', style)} title={BAND_LABEL[band]}>
      <Icon size={14} aria-hidden="true" />
      {short ? BAND_SHORT[band] : BAND_LABEL[band]}
    </span>
  );
}

export function UrgentTag({ label = 'Urgent' }: { label?: string }) {
  return <span className="inline-flex items-center rounded-full bg-attention-soft px-2 py-0.5 text-xs font-semibold text-attention">{label}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Header for a section inside a page that already has its own title. */
export function SubHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        {description && <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-base font-semibold">
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden="true">
        {icon ?? <PackageOpen size={22} />}
      </div>
      <p className="font-semibold">{title}</p>
      {body && <p className="max-w-[48ch] text-sm text-ink-2">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'good' | 'attention' | 'loss'; children: ReactNode; className?: string }) {
  const map = {
    info: 'bg-primary-soft text-primary-strong border-primary/20',
    good: 'bg-good-soft text-good border-good/20',
    attention: 'bg-attention-soft text-attention border-attention/25',
    loss: 'bg-loss-soft text-loss border-loss/20',
  };
  const Icon = tone === 'good' ? CircleCheck : tone === 'attention' ? TriangleAlert : tone === 'loss' ? CircleAlert : Info;
  return (
    <div className={cx('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', map[tone], className)}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-4 z-[1000] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg',
            t.tone === 'error' ? 'bg-loss text-white' : 'bg-ink text-white',
          )}
        >
          <span className="pt-0.5">{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-me-1 rounded p-0.5 opacity-80 hover:opacity-100">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Label/value list for detail panels */
export function Facts({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
