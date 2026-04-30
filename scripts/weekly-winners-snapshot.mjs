#!/usr/bin/env node
/**
 * weekly-winners-snapshot.mjs
 * Captures the top-3 contributors for the previous Mon→Sun week and
 * writes them into the `weekly_winners` table — once for the edits
 * metric and once for completions. Idempotent: snapshot_weekly_winners()
 * uses ON CONFLICT DO NOTHING so re-runs for the same week are safe.
 *
 * Runs via GitHub Actions cron (Monday 00:05 UTC) or manually:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/weekly-winners-snapshot.mjs
 *
 * Optional argument — pass a YYYY-MM-DD week-start date to backfill a
 * specific week (must be a Monday):
 *   node scripts/weekly-winners-snapshot.mjs 2026-04-21
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const targetWeekStart = process.argv[2] || null;

async function callSnapshot(weekStart, metric) {
  const body = {};
  if (weekStart) body.target_week_start = weekStart;
  body.target_metric = metric;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/snapshot_weekly_winners`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC failed: ${res.status} ${text}`);
  }
  return res.json();
}

(async () => {
  const metrics = ['edits', 'completions'];
  let failed = 0;
  for (const metric of metrics) {
    try {
      const winners = await callSnapshot(targetWeekStart, metric);
      if (!winners || winners.length === 0) {
        console.log(targetWeekStart
          ? `[snapshot] ${metric}: no new rows for ${targetWeekStart} (already captured or no activity).`
          : `[snapshot] ${metric}: no new rows for the previous week (already captured or no activity).`);
        continue;
      }
      console.log(`[snapshot] ${metric}: captured ${winners.length} winners:`);
      for (const w of winners) {
        console.log(`  rank ${w.rank}: user_id=${w.user_id} count=${w.edits}`);
      }
    } catch (e) {
      console.error(`[snapshot] ${metric}: failed:`, e.message);
      failed++;
    }
  }
  if (failed > 0) process.exit(1);
})();
