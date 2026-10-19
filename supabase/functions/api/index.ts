// Supabase Edge Function entry point. Deploy with:  supabase functions deploy api --no-verify-jwt
// (the function checks the signed-in user itself, see _shared/core.ts → actorFrom)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from '../_shared/app.ts';
import type { AppMeta, AuthProvider, Deps, FileStore } from '../_shared/core.ts';
import { ApiError } from '../_shared/core.ts';
import { GoogleSheetsClient } from '../_shared/sheets/client.ts';

function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys);
    return parsed.default ?? Object.values(parsed)[0];
  }
  throw new Error('No Supabase secret key available to the function.');
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

const auth: AuthProvider = {
  async getUser(token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: (data.user.email ?? '').toLowerCase(), app_metadata: (data.user.app_metadata ?? {}) as AppMeta };
  },
  async createUser({ email, password, app_metadata }) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata });
    if (error || !data.user) {
      const msg = error?.message ?? '';
      if (/already|registered|exists/i.test(msg)) throw new ApiError(400, 'An account with this email or phone already exists.');
      throw new ApiError(400, `Could not create the login: ${msg}`);
    }
    return data.user.id;
  },
  async updateUser(id, patch) {
    // Merge app_metadata ourselves so no existing flag is lost.
    const { data: cur } = await admin.auth.admin.getUserById(id);
    const attrs: Record<string, unknown> = {};
    if (patch.password) attrs.password = patch.password;
    if (patch.email) attrs.email = patch.email;
    if (patch.app_metadata) attrs.app_metadata = { ...(cur.user?.app_metadata ?? {}), ...patch.app_metadata };
    if (patch.banned != null) attrs.ban_duration = patch.banned ? '876000h' : 'none';
    const { error } = await admin.auth.admin.updateUserById(id, attrs);
    if (error) throw new ApiError(400, `Could not update the login: ${error.message}`);
  },
};

// Delivery photos, signatures and cheque photos: a private Supabase Storage bucket, shown through signed links.
const BUCKET = 'delivery-proof';
let bucketChecked = false;
const files: FileStore = {
  async put(path, data, contentType) {
    if (!bucketChecked) {
      await admin.storage.createBucket(BUCKET, { public: false }); // returns an error if it already exists, which is fine
      bucketChecked = true;
    }
    const { error } = await admin.storage.from(BUCKET).upload(path, data, { contentType, upsert: false });
    if (error) throw new ApiError(502, `Could not save the photo: ${error.message}`);
  },
  async url(path) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error || !data) throw new ApiError(502, 'Could not open the photo.');
    return data.signedUrl;
  },
};

const deps: Deps = {
  sheets: new GoogleSheetsClient(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}'),
  auth,
  files,
  platformSheetId: Deno.env.get('PLATFORM_SHEET_ID') ?? '',
  superAdminEmails: (Deno.env.get('SUPER_ADMIN_EMAILS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  phoneLoginDomain: Deno.env.get('PHONE_LOGIN_DOMAIN') ?? 'phone.delivery.local',
};

Deno.serve((req) => handle(req, deps));
