import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

let toasts: Toast[] = [];
let next = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: Toast['tone'] = 'success') {
  const id = ++next;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
  );
  return { toasts: list, dismiss };
}
