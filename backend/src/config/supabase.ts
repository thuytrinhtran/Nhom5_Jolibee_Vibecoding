import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const rawUrl = process.env.SUPABASE_URL || '';
// Sanitize URL in case it has trailing slash or /rest/v1 suffix
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY || 
                    process.env.SUPABASE_SERVICE_ROLE_KEY || 
                    process.env.SUPABASE_KEY || 
                    process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase] Warning: SUPABASE_URL or SUPABASE_SECRET_KEY is missing from environment variables.');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Admin client with permanent service_role privileges (never call signInWithPassword on this)
export const supabaseAdmin = supabase;

// Factory for isolated auth client specifically for user authentication calls
export const createAuthClient = (): SupabaseClient => {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

export { supabaseUrl };

export async function userAuthRequest(token: string, endpoint: '/user' | '/reauthenticate', body?: object) {
  const response = await fetch(`${supabaseUrl}/auth/v1${endpoint}`, {
    method: body ? 'PUT' : 'GET',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
