// Settings come from .env (see .env.example). In demo mode (npm run demo) the app
// talks to the local demo API instead of Supabase and Google Sheets.
const env = import.meta.env;

export const DEMO = env.MODE === 'demo' || env.VITE_DEMO === '1';
export const SUPABASE_URL = (env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_KEY = (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
export const API_URL = DEMO ? (env.VITE_DEMO_API_URL as string | undefined) ?? 'http://localhost:8787/api' : (env.VITE_API_URL as string | undefined) ?? (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/api` : '');
export const DEMO_ROOT = API_URL.replace(/\/api$/, '');
export const PHONE_LOGIN_DOMAIN = (env.VITE_PHONE_LOGIN_DOMAIN as string | undefined) ?? 'phone.delivery.local';

export const CONFIGURED = DEMO || (!!SUPABASE_URL && !!SUPABASE_KEY);
