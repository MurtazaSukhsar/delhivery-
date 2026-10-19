import { API_URL, DEMO, SUPABASE_KEY } from './config';
import { token } from './auth';

export class ApiFailure extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  if (!API_URL) throw new ApiFailure(0, 'The app is not connected to its server yet. See the setup guide.');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!DEMO && SUPABASE_KEY) headers.apikey = SUPABASE_KEY;
  if (opts.auth !== false) {
    const t = await token();
    if (t) headers.authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFailure(0, 'Cannot reach the server. Check the internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFailure(res.status, (data as { error?: string }).error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
