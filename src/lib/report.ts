import { post, ApiFailure } from './api';

/**
 * Sends crashes in the web app to the platform administrator's Problems list,
 * so a client does not have to describe what went wrong. Known server replies
 * (wrong password, missing field) and being offline are not crashes and are skipped.
 */
let sent = 0;
const seen = new Set<string>();

export function reportProblem(error: unknown, page = window.location.pathname) {
  if (error instanceof ApiFailure) return;
  const message = error instanceof Error ? error.message : String(error);
  if (!message || sent >= 5 || seen.has(message)) return;
  seen.add(message);
  sent++;
  post('/client-error', { message, page, stack: error instanceof Error ? error.stack : '' }).catch(() => {});
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportProblem(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportProblem(e.reason));
}
