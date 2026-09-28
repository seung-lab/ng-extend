import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { communityFetch } from './community_fetch';

// These are client-safe: the publishable key is public by design, and RLS
// plus ewSecureWrite (src/secure_write.ts) protect the data.
// Supabase Dashboard → Project Settings → API Keys → Publishable key.
// (Replaced the legacy anon JWT on 2026-09-27; JWT keys are being disabled.)
export const SUPABASE_URL = 'https://javthknksdcrlhiaaptj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_a5r5rfbOuWNoVw0Qb_LtRg_xA4H6Jxb';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: communityFetch } });

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
