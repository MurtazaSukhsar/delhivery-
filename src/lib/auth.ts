import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { DEMO, DEMO_ROOT, PHONE_LOGIN_DOMAIN, SUPABASE_KEY, SUPABASE_URL } from './config';

/**
 * Sign-in. Real mode: Supabase Auth. Demo mode: the local demo API.
 * Staff sign in with email; drivers (and anyone without email) with phone number.
 */
export interface Session {
  token: string;
  userId: string;
  email: string;
}

export function loginToEmail(login: string) {
  const l = login.trim().toLowerCase();
  if (l.includes('@')) return l;
  let d = l.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '968' + d;
  return `${d}@${PHONE_LOGIN_DOMAIN}`;
}

let session: Session | null = null;
let ready = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let supabase: SupabaseClient | null = null;
const DEMO_KEY = 'dp-demo-session';

function setSession(s: Session | null) {
  session = s;
  ready = true;
  emit();
}

export function initAuth() {
  if (DEMO) {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      setSession(raw ? JSON.parse(raw) : null);
    } catch {
      setSession(null);
    }
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    setSession(null);
    return;
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  supabase.auth.getSession().then(({ data }) => {
    const s = data.session;
    setSession(s ? { token: s.access_token, userId: s.user.id, email: s.user.email ?? '' } : null);
  });
  supabase.auth.onAuthStateChange((_e, s) => setSession(s ? { token: s.access_token, userId: s.user.id, email: s.user.email ?? '' } : null));
}

export async function signIn(login: string, password: string): Promise<void> {
  if (DEMO) {
    const res = await fetch(`${DEMO_ROOT}/dev/login`, { method: 'POST', body: JSON.stringify({ login, password }) }).catch(() => null);
    if (!res) throw new Error('The demo API is not running. Start it with npm run demo.');
    const j = await res.json();
    if (!res.ok) throw new Error('Phone, email or password is incorrect.');
    const s = { token: j.access_token, userId: j.user.id, email: j.user.email };
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
    setSession(s);
    return;
  }
  if (!supabase) throw new Error('The app is not connected to Supabase yet. Fill in .env (see the setup guide).');
  const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Phone, email or password is incorrect.' : error.message);
}

export async function signOut() {
  if (DEMO) {
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch {
      /* ignore */
    }
    setSession(null);
    return;
  }
  await supabase?.auth.signOut();
}

/** Fresh token for each API call (Supabase refreshes it in the background). */
export async function token(): Promise<string | null> {
  if (!DEMO && supabase) {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
  return session?.token ?? null;
}

export function useSession() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (ready ? session : undefined),
  );
}
