import { createClient, SupabaseClient } from '@supabase/supabase-js';

// These are client-safe (anon key + RLS protect the data).
// Get your anon key from: Supabase Dashboard → Settings → API → anon public
const SUPABASE_URL = 'https://javthknksdcrlhiaaptj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder_replace_with_real_key';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Quick connectivity check — logs result to console on startup. */
supabase.from('users').select('id', { count: 'exact', head: true }).then(
  ({ error, count }) => {
    if (error) {
      console.error('[supabase] Connection FAILED — check anon key & RLS:', error.message);
    } else {
      console.info(`[supabase] Connected OK (${count ?? '?'} users)`);
    }
  },
);
