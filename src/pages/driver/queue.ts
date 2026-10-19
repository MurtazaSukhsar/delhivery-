import { useSyncExternalStore } from 'react';
import { post, ApiFailure } from '../../lib/api';
import { toast } from '../../lib/toast';
import type { DeliveryStatus, DriverUpdate } from '../../lib/domain';

/**
 * Offline-first driver updates.
 * Every tap becomes an update with its own client id, saved on the phone first.
 * When there is a connection the whole queue goes to POST /driver/sync in order.
 * The server skips client ids it has already applied, so resending after a
 * dropped connection never applies an update twice.
 */

export type QueuedUpdate = DriverUpdate & { offline: boolean };

const KEY = 'dp-driver-queue';
const SIM = 'dp-driver-sim-offline';

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the update still lives in memory */
  }
}

interface State {
  queue: QueuedUpdate[];
  browserOnline: boolean;
  simulatedOffline: boolean;
  flushing: boolean;
}
let state: State = {
  queue: read<QueuedUpdate[]>(KEY, []),
  browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  simulatedOffline: read<boolean>(SIM, false),
  flushing: false,
};
const listeners = new Set<() => void>();
function setState(p: Partial<State>) {
  state = { ...state, ...p };
  if ('queue' in p) write(KEY, state.queue);
  if ('simulatedOffline' in p) write(SIM, state.simulatedOffline);
  listeners.forEach((l) => l());
}
export const isOnline = () => state.browserOnline && !state.simulatedOffline;

export function useQueue() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

export function setSimulatedOffline(v: boolean) {
  setState({ simulatedOffline: v });
}

const rid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Save an update on the phone. Returns whether it is waiting for a connection. */
export function enqueue(u: Omit<DriverUpdate, 'client_id' | 'at'>): 'sending' | 'queued' {
  const item: QueuedUpdate = { ...u, client_id: rid(), at: new Date().toISOString(), offline: !isOnline() };
  setState({ queue: [...state.queue, item] });
  return isOnline() ? 'sending' : 'queued';
}

/** Send everything waiting. Calls onDone after the server has the updates. */
export async function flush(onDone?: () => void) {
  if (state.flushing || !isOnline() || state.queue.length === 0) return;
  // Up to 100 updates, but keep each request small when photos are attached.
  const batch: QueuedUpdate[] = [];
  let size = 0;
  for (const q of state.queue.slice(0, 100)) {
    const n = JSON.stringify(q).length;
    if (batch.length && size + n > 2_500_000) break;
    batch.push(q);
    size += n;
  }
  setState({ flushing: true });
  try {
    const res = await post<{ results: { client_id: string; ok: boolean; error?: string }[] }>('/driver/sync', { updates: batch });
    const sent = new Set(batch.map((b) => b.client_id));
    // Rejected updates (for example the office took the delivery back meanwhile) are
    // dropped so they cannot block the rest; the driver is told why.
    for (const r of res.results) if (!r.ok && r.error) toast(r.error, 'error');
    setState({ queue: state.queue.filter((q) => !sent.has(q.client_id)) });
    onDone?.();
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 0) {
      // No signal even though the phone thinks it is online: keep everything; the app retries.
    } else if (e instanceof ApiFailure && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
      // The whole batch was refused; keeping it would block the phone forever.
      toast(e.message, 'error');
      const sent = new Set(batch.map((b) => b.client_id));
      setState({ queue: state.queue.filter((q) => !sent.has(q.client_id)) });
    }
  } finally {
    setState({ flushing: false });
  }
  // More than 100 waiting: send the next batch, but only if this one went through.
  const progressed = !batch.some((b) => state.queue.includes(b));
  if (progressed && state.queue.length && isOnline()) void flush(onDone);
}

export const RESULT: Record<DriverUpdate['action'], DeliveryStatus | 'removed'> = {
  accept: 'accepted',
  decline: 'removed',
  pickup: 'picked_up',
  arrive: 'arrived',
  deliver: 'delivered',
  fail: 'failed',
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setState({ browserOnline: true }));
  window.addEventListener('offline', () => setState({ browserOnline: false }));
}
