import { createClient, SupabaseClient } from '@supabase/supabase-js';

// These are client-safe (anon key + RLS protect the data).
// Get your anon key from: Supabase Dashboard → Settings → API → anon public
const SUPABASE_URL = 'https://javthknksdcrlhiaaptj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphdnRoa25rc2RjcmxoaWFhcHRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzUyOTIsImV4cCI6MjA4ODIxMTI5Mn0.APdwuQ-uudyHISBr7Dj6HTylO7qavJ0HhB32E5X434g';

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
