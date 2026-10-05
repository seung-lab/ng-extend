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

import { weekRange, topCompleters } from './weekly-completions.mjs';

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
      ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
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

const HEADERS = {
  apikey: SUPABASE_KEY,
  ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
  'Content-Type': 'application/json',
};
async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** The Cells podium, counted from the app's own log by the same function as
 *  the broadcast (weekly-completions.mjs). The database function counted
 *  from the CAVE mirror, which lags and misses MEC, and left Annkri off the
 *  podium of 2026-09-28. The week's rows are rewritten only when they differ,
 *  so a re-run also corrects a podium that was saved wrong. */
async function snapshotCompletions(weekStartArg) {
  const { weekStart, startISO, endISO } = weekRange(weekStartArg);
  const top = (await topCompleters(path => rest(path), startISO, endISO, 3))
    .map((r, i) => ({ week_start: weekStart, rank: i + 1, user_id: r.user_id, edits: r.count, metric: 'completions' }));
  const saved = await rest(`weekly_winners?select=rank,user_id,edits&week_start=eq.${weekStart}&metric=eq.completions&order=rank`);
  const same = saved.length === top.length && saved.every((s, i) => s.user_id === top[i].user_id && s.edits === top[i].edits);
  if (same) { console.log(`[snapshot] completions: podium for ${weekStart} is already right.`); return; }
  console.log(`[snapshot] completions: ${saved.length ? 'correcting' : 'saving'} the podium for ${weekStart}:`);
  for (const w of top) console.log(`  rank ${w.rank}: user_id=${w.user_id} count=${w.edits}`);
  if (process.env.DRY_RUN === '1') { console.log('[snapshot] DRY RUN, nothing written.'); return; }
  if (!top.length) return;
  await rest(`weekly_winners?week_start=eq.${weekStart}&metric=eq.completions`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  await rest('weekly_winners', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(top) });
}

(async () => {
  const metrics = ['edits'];
  try { await snapshotCompletions(targetWeekStart); }
  catch (e) { console.error('[snapshot] completions: failed:', e.message); process.exitCode = 1; }
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
