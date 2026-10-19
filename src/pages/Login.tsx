import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signIn, signOut, useSession } from '../lib/auth';
import { post } from '../lib/api';
import { queryClient } from '../lib/queries';
import { CONFIGURED, DEMO, DEMO_ROOT } from '../lib/config';
import { UserRound, Crown, Building2, Truck } from 'lucide-react';
import { Button, TextField } from '../ui/controls';
import { Notice } from '../ui/display';
import { BrandMark } from '../ui/BrandMark';

interface DemoAccount {
  role: string;
  login: string;
  password: string;
}

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation() as { state?: { error?: string } };
  const session = useSession();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(loc.state?.error ?? '');
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => {
    if (!DEMO) return;
    fetch(`${DEMO_ROOT}/dev/accounts`)
      .then((r) => r.json())
      .then(setAccounts)
      .catch(() => setError('The demo API is not running. Start it with: npm run demo'));
  }, []);

  // Someone arrived here with an account problem: sign them out so they can try another account.
  useEffect(() => {
    if (loc.state?.error && session) void signOut();
  }, [loc.state, session]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void doSignIn(login, password);
  }

  async function doSignIn(login: string, password: string) {
    if (!login.trim() || !password) return setError('Enter your email or phone number and your password.');
    setBusy(true);
    setError('');
    try {
      await signIn(login, password);
      queryClient.clear();
      void post('/session', { device: navigator.userAgent.slice(0, 120) }).catch(() => undefined);
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  const iconFor = (role: string) => (role.startsWith('Platform') ? Crown : role.startsWith('Admin') ? Building2 : role.startsWith('Driver') ? Truck : UserRound);

  return (
    <main className="min-h-dvh">
      <section className="flex min-h-dvh items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <BrandMark size={36} />
            <span className="text-lg font-semibold">Farwings Delivery</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-2">Office staff sign in with email. Drivers use their phone number.</p>
          {!CONFIGURED && (
            <Notice tone="attention" className="mt-4">
              The app is not connected yet. Add your Supabase details to <code>.env</code> (see SETUP.md), or run <code>npm run demo</code> to try it with sample data.
            </Notice>
          )}
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
            <TextField label="Email or phone number" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
            <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <Notice tone="loss">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" busy={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-4 text-sm text-ink-2">Forgot your password? Ask your administrator to set a new one.</p>

          {DEMO && accounts.length > 0 && (
            <div className="mt-8 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
              <h2 className="text-sm font-semibold">Try the demo</h2>
              <p className="mt-0.5 text-xs text-ink-2">Sample data. Click an account to sign in at once.</p>
              <ul className="mt-3 flex flex-col gap-1">
                {accounts.map((a) => {
                  const I = iconFor(a.role);
                  return (
                    <li key={a.login}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setLogin(a.login);
                          setPassword(a.password);
                          void doSignIn(a.login, a.password);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start text-sm transition-colors hover:bg-primary-soft disabled:opacity-60"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                          <I size={16} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium leading-tight">{a.role}</span>
                          <span className="num block truncate text-xs text-ink-2">{a.login}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
