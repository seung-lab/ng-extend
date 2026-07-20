#!/usr/bin/env node
/**
 * probe-cave-edits.mjs
 * --------------------------------------------------------------------
 * DIAGNOSTIC ONLY — this script never writes anything, anywhere.
 *
 * WHY THIS EXISTS
 * Edit counts must come from CAVE (real PyChunkedGraph operations), not be
 * inferred client-side from segment-selection changes. To build that sync we
 * need the authoritative PCG endpoint that returns a USER's operations.
 *
 * This repo only has per-ROOT change logs today:
 *   GET /segmentation/api/v1/table/{table}/root/{root}/change_log
 *   GET /segmentation/api/v1/table/{table}/root/{root}/tabular_change_log
 * Those can't answer "how many edits has user X made" without enumerating
 * every root in the dataset.
 *
 * Rather than guess a production API path and build a stats pipeline on top of
 * it, this probe asks the live server which candidate endpoints actually exist
 * and what shape they return. Run it, read the output, THEN write the real
 * sync script against whatever it proves.
 *
 * Required env:
 *   CAVE_SERVICE_TOKEN                      (bearer for CAVE)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (only to look up a real
 *                                            users.cave_user_id to probe with;
 *                                            omit and pass --user-id instead)
 *
 * Usage:
 *   CAVE_SERVICE_TOKEN=... node scripts/probe-cave-edits.mjs --user-id 1234
 *   CAVE_SERVICE_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/probe-cave-edits.mjs
 *
 * Flags:
 *   --user-id <n>   probe with this CAVE user id (skips the Supabase lookup)
 *   --table <name>  PCG table to probe (default: stroeh_mouse_retina)
 *   --days <n>      lookback window for time-ranged endpoints (default 30)
 */

const CAVE_TOKEN   = process.env.CAVE_SERVICE_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CAVE_TOKEN) {
  console.error('Missing CAVE_SERVICE_TOKEN — needed to call CAVE.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const argVal = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

// stroeh is the EyeWire II production segmentation. The PCG *table* name comes
// from the graphene layer URL (.../segmentation/table/<table>), which for
// stroeh is the same string as the datastack.
const CAVE_SERVER = argVal('--server', 'https://minnie.microns-daf.com');
const PCG_TABLE   = argVal('--table', 'stroeh_mouse_retina');
const DAYS        = Number(argVal('--days', '30'));

const endTime   = new Date();
const startTime = new Date(endTime.getTime() - DAYS * 24 * 60 * 60 * 1000);
const isoStart  = startTime.toISOString();
const isoEnd    = endTime.toISOString();

async function getCaveUserId() {
  const explicit = argVal('--user-id');
  if (explicit) return explicit;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('No --user-id given and no Supabase creds to look one up.');
    process.exit(1);
  }
  const url = `${SUPABASE_URL}/rest/v1/users?select=cave_user_id,display_name&cave_user_id=not.is.null&limit=5`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) {
    console.error(`Supabase lookup failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const rows = await res.json();
  if (!rows.length) {
    console.error('No users have a cave_user_id yet — pass --user-id explicitly.');
    process.exit(1);
  }
  console.log(`[probe] candidate users from Supabase: ${rows.map(r => `${r.display_name}=${r.cave_user_id}`).join(', ')}`);
  return String(rows[0].cave_user_id);
}

/**
 * Per-request timeout.
 *
 * Without this a single unresponsive endpoint hangs the whole probe — which is
 * exactly what happened on the first CI run: an endpoint never answered and the
 * job sat for minutes until it was cancelled. A probe must always terminate and
 * report, since "no response" is itself a useful result.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/** GET a URL and summarise the outcome without dumping a huge body. */
async function probe(label, url) {
  process.stdout.write(`\n[probe] ${label}\n        GET ${url}\n`);
  let res;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${CAVE_TOKEN}` },
      signal: ac.signal,
    });
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    console.log(timedOut
      ? `        ✗ TIMEOUT after ${REQUEST_TIMEOUT_MS / 1000}s (endpoint did not respond)`
      : `        ✗ network error: ${e.message}`);
    return { label, url, ok: false, status: timedOut ? 'timeout' : 'network-error' };
  } finally {
    clearTimeout(timer);
  }
  const body = await res.text();
  if (!res.ok) {
    console.log(`        ✗ ${res.status} ${res.statusText} — ${body.slice(0, 180).replace(/\s+/g, ' ')}`);
    return { label, url, ok: false, status: res.status };
  }
  let json = null;
  try { json = JSON.parse(body); } catch { /* not json */ }
  if (json === null) {
    console.log(`        ⚠ ${res.status} but body is not JSON — ${body.slice(0, 180)}`);
    return { label, url, ok: true, status: res.status, shape: 'non-json' };
  }
  // Describe the shape so we can see whether it's columnar (arrays keyed by
  // column) or row-oriented, and which columns are available.
  let shape;
  if (Array.isArray(json)) {
    shape = `array[${json.length}]` + (json.length ? ` of ${JSON.stringify(Object.keys(json[0])).slice(0, 200)}` : '');
  } else {
    const keys = Object.keys(json);
    const sample = keys.slice(0, 12).map(k => {
      const v = json[k];
      return Array.isArray(v) ? `${k}[${v.length}]` : `${k}:${typeof v}`;
    });
    shape = `object{${sample.join(', ')}}${keys.length > 12 ? ` …+${keys.length - 12} more` : ''}`;
  }
  console.log(`        ✓ ${res.status} — ${shape}`);
  console.log(`        sample: ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
  return { label, url, ok: true, status: res.status, shape };
}

(async () => {
  const userId = await getCaveUserId();
  const base = `${CAVE_SERVER}/segmentation/api/v1/table/${PCG_TABLE}`;

  console.log('='.repeat(72));
  console.log(`CAVE edit-source probe`);
  console.log(`  server : ${CAVE_SERVER}`);
  console.log(`  table  : ${PCG_TABLE}`);
  console.log(`  user   : ${userId}`);
  console.log(`  window : ${isoStart} → ${isoEnd}`);
  console.log('='.repeat(72));

  const results = [];

  // The shapes below are the plausible per-user operation endpoints exposed by
  // pychunkedgraph across versions. We try each and report; whichever answers
  // with operation ids + timestamps + is_merge is the one to build on.
  results.push(await probe(
    'user_operations (query params)',
    `${base}/user_operations?user_id=${userId}&start_time=${isoStart}&end_time=${isoEnd}`));

  results.push(await probe(
    'user_operations (no time window)',
    `${base}/user_operations?user_id=${userId}`));

  results.push(await probe(
    'change_log filtered by user',
    `${base}/change_log?user_id=${userId}&start_time=${isoStart}&end_time=${isoEnd}`));

  results.push(await probe(
    'change_log (whole table, time-windowed)',
    `${base}/change_log?start_time=${isoStart}&end_time=${isoEnd}`));

  results.push(await probe(
    'operations',
    `${base}/operations?user_id=${userId}&start_time=${isoStart}&end_time=${isoEnd}`));

  results.push(await probe(
    'user/{id}/operations (path form)',
    `${base}/user/${userId}/operations`));

  // Known-good control: proves the token, server and table name are all valid,
  // so a wall of 404s above means "endpoint absent", not "probe misconfigured".
  results.push(await probe(
    'CONTROL — oldest_timestamp (expected to work)',
    `${base}/oldest_timestamp`));

  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'}  ${String(r.status).padEnd(14)} ${r.label}`);
  }
  const usable = results.filter(r => r.ok && r.label !== 'CONTROL — oldest_timestamp (expected to work)'
                                   && !r.label.startsWith('CONTROL'));
  console.log('');
  if (usable.length) {
    console.log(`→ ${usable.length} candidate endpoint(s) responded. Build the sync on the one`);
    console.log('  whose shape includes operation id + timestamp + merge/split flag.');
  } else {
    console.log('→ No per-user endpoint responded. Fall back plan: enumerate operations from');
    console.log('  the per-root tabular_change_log over the roots we know about, or ask the');
    console.log('  CAVE admins which endpoint exposes user operations on this deployment.');
  }
  console.log('='.repeat(72));
})();
