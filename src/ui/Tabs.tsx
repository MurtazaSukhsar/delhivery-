import { useRef, type KeyboardEvent } from 'react';
import { cx } from './controls';

/** WAI-ARIA tabs with arrow-key navigation. Panels are rendered by the caller with id `${id}-panel`. */
export function Tabs<T extends string>({ id, label, tabs, value, onChange }: { id: string; label: string; tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = tabs.length - 1;
    if (n >= 0) {
      e.preventDefault();
      onChange(tabs[n].value);
      refs.current[n]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-line-2 p-1">
      {tabs.map((t, i) => {
        const sel = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${id}-tab-${t.value}`}
            aria-selected={sel}
            aria-controls={`${id}-panel`}
            tabIndex={sel ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx('whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors', sel ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, value, children }: { id: string; value: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`} tabIndex={0} className="focus:outline-none">
      {children}
    </div>
  );
}
