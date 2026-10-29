import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

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
