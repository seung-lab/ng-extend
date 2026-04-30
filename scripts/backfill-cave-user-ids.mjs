#!/usr/bin/env node
/**
 * backfill-cave-user-ids.mjs
 * --------------------------------------------------------------------
 * Phase B leaderboard groundwork.
 *
 * cave_user_id is captured at middleauth login (see store.captureCaveUserId).
 * That covers anyone who logs in after the column ships. For users who
 * don't log in for a while, this script can fill in their cave_user_id
 * IF you have a master list mapping middleauth_email → CAVE numeric id.
 *
 * Why an automatic server-side backfill is impossible:
 *   CAVE auth tokens are stored in each user's BROWSER localStorage. There
 *   is no central place this script can query the bearer token for an
 *   arbitrary user, so we cannot call /auth/api/v1/user/me on their behalf.
 *
 * Two practical paths:
 *
 *   1. Do nothing — let cave_user_id populate organically as users log in.
 *      The leaderboard will show 0 completions for not-yet-mapped users
 *      until they next authenticate. Acceptable while EW2 is rolling out.
 *
 *   2. Provide a CSV (email,cave_user_id) and run this script with --csv.
 *      The mapping comes from CAVE admin (Forrest/Derrick) — the
 *      AnnotationEngine `users` table or a daf-apis admin endpoint that
 *      a service account can list. As of 2026-04-30 this admin path is
 *      not exposed to end users, so this mode is here for future use.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-cave-user-ids.mjs --csv path/to/mapping.csv
 *
 *   Without --csv: prints how many users still need cave_user_id and exits.
 *
 * CSV format (header optional):
 *   alice@example.com,12345
 *   bob@example.com,67890
 */

import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const csvIdx = process.argv.indexOf('--csv');
const csvPath = csvIdx >= 0 ? process.argv[csvIdx + 1] : null;

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function listMissing() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?select=id,middleauth_email,cave_user_id&cave_user_id=is.null`,
    { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase list failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchUser(userId, caveUserId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({ cave_user_id: caveUserId, updated_at: new Date().toISOString() }),
    });
  if (!res.ok) throw new Error(`PATCH ${userId} failed: ${res.status} ${await res.text()}`);
}

function parseCsv(path) {
  const txt = readFileSync(path, 'utf-8');
  const rows = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^email,\s*cave_user_id/i.test(line)) continue;  // skip header
    const [email, idRaw] = line.split(',').map(s => s?.trim());
    if (!email || !idRaw) continue;
    const id = Number.parseInt(idRaw, 10);
    if (!Number.isFinite(id)) continue;
    rows.push({ email, caveUserId: id });
  }
  return rows;
}

(async () => {
  try {
    const missing = await listMissing();
    console.log(`[backfill] ${missing.length} users without cave_user_id`);

    if (!csvPath) {
      if (missing.length > 0) {
        console.log('[backfill] To fill these in, supply a CSV: --csv path/to/mapping.csv');
        for (const u of missing.slice(0, 10)) console.log(`  - ${u.middleauth_email}`);
        if (missing.length > 10) console.log(`  ...and ${missing.length - 10} more`);
      } else {
        console.log('[backfill] All users already have cave_user_id.');
      }
      return;
    }

    const csvRows = parseCsv(csvPath);
    const byEmail = new Map(csvRows.map(r => [r.email.toLowerCase(), r.caveUserId]));
    console.log(`[backfill] CSV provided ${csvRows.length} mappings.`);

    let updated = 0, skipped = 0;
    for (const u of missing) {
      const caveId = byEmail.get((u.middleauth_email || '').toLowerCase());
      if (!caveId) { skipped++; continue; }
      await patchUser(u.id, caveId);
      updated++;
    }
    console.log(`[backfill] Updated ${updated}, skipped (no CSV match) ${skipped}.`);
  } catch (e) {
    console.error('[backfill] Failed:', e.message);
    process.exit(1);
  }
})();
