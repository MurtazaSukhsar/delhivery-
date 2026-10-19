import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check, X } from 'lucide-react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong border border-primary shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:border-ink-3 hover:bg-canvas shadow-[0_1px_1px_rgb(15_23_42/0.04)]',
  ghost: 'bg-transparent text-ink hover:bg-canvas border border-transparent',
  danger: 'bg-surface text-loss border border-loss/40 hover:bg-loss-soft',
  quiet: 'bg-transparent text-primary hover:underline border border-transparent px-0',
};

const sizes: Record<Size, string> = {
  sm: 'text-sm px-2.5 py-1 min-h-8 gap-1.5',
  md: 'text-sm px-3.5 py-2 min-h-10 gap-2',
  lg: 'text-base px-4 py-2.5 min-h-12 gap-2',
  xl: 'text-lg px-5 py-3 min-h-14 gap-3 font-semibold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors active:translate-y-px disabled:opacity-55 whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon && <span aria-hidden="true" className="shrink-0 inline-flex">{icon}</span>}
      {children}
    </button>
  );
});

export function IconButton({ label, icon, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 hover:bg-canvas hover:text-ink', className)}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

interface FieldShell {
  label: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  required?: boolean;
}

function Shell({ id, label, hint, error, className, required, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-loss" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={id + '-hint'} className="text-xs text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={id + '-err'} className="text-xs font-medium text-loss">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: ReactNode, error?: string) =>
  [error ? id + '-err' : '', hint && !error ? id + '-hint' : ''].filter(Boolean).join(' ') || undefined;

export function TextField({ label, hint, error, className, required, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className} required={required}>
      <input id={id} className="field-input" aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)} required={required} {...rest} />
    </Shell>
  );
}

export function NumberField({ label, hint, error, className, value, onValue, step = '0.001', suffix, ...rest }: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onValue: (n: number) => void; suffix?: string }) {
  const id = useId();
  // While typing, show exactly what was typed (so clearing the box and typing "50" gives 50, not 050, and "0." stays).
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className} required={rest.required}>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          {...rest}
          className={cx('field-input num', suffix && 'pe-14')}
          value={raw ?? (Number.isFinite(value) ? value : '')}
          onChange={(e) => {
            setRaw(e.target.value);
            onValue(e.target.value === '' ? 0 : Number(e.target.value));
          }}
          onBlur={(e) => {
            setRaw(null);
            rest.onBlur?.(e);
          }}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy(id, hint, error)}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-ink-2">{suffix}</span>}
      </div>
    </Shell>
  );
}

export function SelectField({ label, hint, error, className, children, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className} required={rest.required}>
      <select id={id} className="field-input" aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>
        {children}
      </select>
    </Shell>
  );
}

export function TextArea({ label, hint, error, className, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className} required={rest.required}>
      <textarea id={id} className="field-input min-h-20" aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Shell>
  );
}

export function Checkbox({ label, hint, checked, onChange, className }: { label: ReactNode; hint?: string; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <input id={id} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? id + '-h' : undefined} />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && (
          <p id={id + '-h'} className="text-xs text-ink-2">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/** Segmented choice built on radio inputs, so arrow keys work natively. */
export function Segmented<T extends string>({ legend, value, options, onChange, className, size = 'md' }: { legend: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string; size?: 'md' | 'lg' }) {
  const name = useId();
  return (
    <fieldset className={cx('flex flex-col gap-1', className)}>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="inline-flex flex-wrap rounded-lg border border-line bg-canvas p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'relative flex cursor-pointer items-center justify-center rounded-[5px] px-3 font-medium text-ink-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary',
              size === 'lg' ? 'min-h-12 text-base flex-1' : 'min-h-9 text-sm',
              value === o.value && 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Native <dialog>: focus trap, Esc to close and inert background come for free. */
export function Dialog({ open, onClose, title, children, footer, wide, labelledBy, closeLabel = 'Close' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; labelledBy?: string; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={labelledBy ?? titleId}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line-2 px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <IconButton label={closeLabel} icon={<X size={20} />} onClick={onClose} className="-me-2 -mt-1" />
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line-2 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  active?: boolean;
  tone?: 'danger';
}

/** Small accessible dropdown menu: closes on outside click, Esc and after choosing. */
export function Dropdown({ trigger, items, up, end, className, triggerClassName, label }: { trigger: ReactNode; items: MenuItem[]; up?: boolean; end?: boolean; className?: string; triggerClassName?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={box} className={cx('relative', className)}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className={triggerClassName}>
        {trigger}
      </button>
      {open && (
        <ul role="menu" className={cx('absolute z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]', up ? 'bottom-full mb-2' : 'top-full mt-2', end ? 'end-0' : 'start-0')}>
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm', it.tone === 'danger' ? 'text-loss hover:bg-loss-soft' : 'text-ink hover:bg-canvas', it.active && 'bg-primary-soft font-medium text-primary-strong')}
              >
                {it.icon && <span aria-hidden="true" className="shrink-0">{it.icon}</span>}
                <span className="flex-1">{it.label}</span>
                {it.active && <Check size={16} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
