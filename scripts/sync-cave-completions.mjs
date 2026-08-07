#!/usr/bin/env node
/**
 * sync-cave-completions.mjs
 * --------------------------------------------------------------------
 * Phase B leaderboard backbone.
 *
 * Pulls cell-completion annotations from CAVE's materialized
 * `cell_status` tables across every datastack we know about, and
 * upserts them into the Supabase `cave_completions_mirror` table.
 * The leaderboard view (user_edit_counts) joins this mirror against
 * users.cave_user_id to produce 24h / 7d / all-time completion counts.
 *
 * Why a mirror instead of querying CAVE directly from the leaderboard:
 *   - Postgres can't reach out to CAVE per-request without pg_net + a
 *     lot of trust (and CAVE's materializer is rate-sensitive).
 *   - CAVE materializations only run on a cron (every other day on
 *     stroeh). Querying them on every leaderboard load is wasteful.
 *   - A 30-min sync gives us "near-live" data with bounded cost.
 *
 * Endpoints used (per datastack):
 *   POST {caveServer}/materialize/api/v3/datastack/{ds}/query?return_pyarrow=false
 *     body: { table: "<cellStatusTable>", limit: <N> }
 *
 *   The materializer's /query endpoint also accepts pagination via
 *   `offset`; we paginate in PAGE_SIZE-row chunks so unbounded growth
 *   doesn't blow up memory or hit hard server limits.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CAVE_SERVICE_TOKEN          (long-lived bearer, see workflow notes)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CAVE_SERVICE_TOKEN=... \
 *     node scripts/sync-cave-completions.mjs
 *
 *   Optional flags:
 *     --datastack <name>   only sync this one datastack
 *     --dry-run            don't write to Supabase, just log counts
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAVE_TOKEN   = process.env.CAVE_SERVICE_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!CAVE_TOKEN) {
  console.error('Missing CAVE_SERVICE_TOKEN — needed to call CAVE materializer');
  process.exit(1);
}

// ── Datastacks to mirror ────────────────────────────────────────────
// Mirrors the production rows in src/config.ts CAVE_CONFIGS_BY_DATASET.
// Only datastacks with a real, user_id-capable cell_status table are
// listed — pinky_sandbox and minnie65_public still write to the shared
// cell_status_dev table that has no user_id, so they're excluded until
// they migrate to a per-dataset *_v2 table.
const DATASTACKS = [
  {
    dataset:         'stroeh_mouse_retina',
    caveServer:      'https://minnie.microns-daf.com',
    datastack:       'stroeh_mouse_retina',
    cellStatusTable: 'eyewire_ii_cell_status_v2',
  },
  // Add more datastacks here as they migrate to bound_tag_user / *_v2 tables.
  // Example future row:
  // {
  //   dataset:         'pinky_sandbox',
  //   caveServer:      'https://minnie.microns-daf.com',
  //   datastack:       'pinky_sandbox',
  //   cellStatusTable: 'eyewire_ii_cell_status_v2',
  // },
];

const PAGE_SIZE = 5000;
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const onlyArgIdx = process.argv.indexOf('--datastack');
const onlyDatastack = onlyArgIdx >= 0 ? process.argv[onlyArgIdx + 1] : null;

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  // Use Prefer: resolution=merge-duplicates so PostgREST UPSERTS
  // (ON CONFLICT update) the row instead of erroring.
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 10_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function backoffMs(attempt, retryAfter) {
  // Honour Retry-After when the server sends a plain seconds value.
  const seconds = Number(retryAfter);
  if (retryAfter && Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, RETRY_MAX_MS);
  }
  const exponential = RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.min(exponential + Math.floor(Math.random() * 250), RETRY_MAX_MS);
}

// CAVE's materializer and Supabase both hiccup occasionally: a 503 from
// nginx, a 429, a dropped connection. Those clear well inside the 30-minute
// sync cadence, so a failed run is a false alarm that still costs a red X
// and an email. Retry them briefly instead.
//
// Client errors are deliberately NOT retried. A 401/403 means
// CAVE_SERVICE_TOKEN expired (they last ~6 months) and a 400 means the query
// is wrong; both need a person, and failing fast is the signal that gets one.
async function fetchWithRetry(label, url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      // Network-level failure (DNS, TLS, connection reset). Always transient.
      lastError = new Error(`${label} network error: ${e.message}`);
      if (attempt === RETRY_ATTEMPTS) break;
      const wait = backoffMs(attempt, null);
      console.warn(`[sync] ${label} ${e.message}, retrying in ${wait}ms (attempt ${attempt}/${RETRY_ATTEMPTS})`);
      await sleep(wait);
      continue;
    }
    if (res.ok) {
      if (attempt > 1) console.log(`[sync] ${label} recovered on attempt ${attempt}`);
      return res;
    }
    // Read the body here so the caller never has to; a Response body can
    // only be consumed once.
    const body = (await res.text()).slice(0, 500);
    lastError = new Error(`${label} ${res.status}: ${body}`);
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt === RETRY_ATTEMPTS) break;
    const wait = backoffMs(attempt, res.headers.get('retry-after'));
    console.warn(`[sync] ${label} ${res.status}, retrying in ${wait}ms (attempt ${attempt}/${RETRY_ATTEMPTS})`);
    await sleep(wait);
  }
  throw lastError;
}

async function getLatestVersion(caveServer, datastack) {
  const res = await fetchWithRetry(
    'versions',
    `${caveServer}/materialize/api/v3/datastack/${datastack}/versions`,
    { headers: { Authorization: `Bearer ${CAVE_TOKEN}` } });
  const versions = await res.json();
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('versions endpoint returned empty array');
  }
  return Math.max(...versions);
}

async function fetchPage(caveServer, datastack, version, table, offset) {
  // Use the frozen-version /query endpoint so we get a stable snapshot.
  // Live queries can change mid-pagination; frozen does not.
  const url = `${caveServer}/materialize/api/v3/datastack/${datastack}/version/${version}/table/${table}/query?return_pyarrow=false`;
  const body = { limit: PAGE_SIZE, offset };
  const res = await fetchWithRetry('query', url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CAVE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function upsertBatch(rows) {
  if (rows.length === 0) return;
  // Dedupe within the batch by the (cave_user_id, dataset, segment_id) PK.
  // CAVE materializer can return multiple cell_status rows per segment
  // (re-completions, root id reassignments after merges, etc). Postgres
  // ON CONFLICT DO UPDATE rejects duplicates within a single statement
  // ("cannot affect row a second time"), so we keep the most-recent
  // completed_at per PK and drop the rest.
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.cave_user_id}|${r.dataset}|${r.segment_id}`;
    const prev = byKey.get(k);
    if (!prev || (r.completed_at && r.completed_at > prev.completed_at)) {
      byKey.set(k, r);
    }
  }
  const deduped = [...byKey.values()];
  if (dryRun) {
    console.log(`[sync] DRY-RUN would upsert ${deduped.length} rows (deduped from ${rows.length})`);
    return;
  }
  const url = `${SUPABASE_URL}/rest/v1/cave_completions_mirror?on_conflict=cave_user_id,dataset,segment_id`;
  await fetchWithRetry('upsert', url, {
    method: 'POST',
    headers: supabaseHeaders,
    body: JSON.stringify(deduped),
  });
}

async function syncDatastack(cfg) {
  console.log(`[sync] === ${cfg.dataset} (${cfg.cellStatusTable}) ===`);
  const version = await getLatestVersion(cfg.caveServer, cfg.datastack);
  console.log(`[sync] latest materialized version: ${version}`);

  let offset = 0;
  let totalRead = 0;
  let totalWritten = 0;

  // CAVE rows look like:
  //   { id, valid, created, deleted, superceded_id, pt_position, pt_root_id,
  //     pt_supervoxel_id, tag, user_id }
  // For a 'complete' row the tag matches /^complete($|\|)/.
  // user_id is the per-row CAVE user (bound_tag_user schema).
  while (true) {
    const rows = await fetchPage(
      cfg.caveServer, cfg.datastack, version, cfg.cellStatusTable, offset);
    if (!Array.isArray(rows) || rows.length === 0) break;
    totalRead += rows.length;

    const toUpsert = [];
    for (const r of rows) {
      const tag = String(r.tag ?? '');
      // Match both bare 'complete' and the legacy 'complete|by:<user>' suffix.
      if (!(tag === 'complete' || tag.startsWith('complete|by:') || tag.startsWith('complete|'))) continue;
      const caveUserId = r.user_id;
      const segId = r.pt_root_id;
      // Without a user_id we can't attribute the completion — skip it.
      if (caveUserId === null || caveUserId === undefined) continue;
      if (segId === null || segId === undefined) continue;
      // CAVE materializer can return `created` as either an ISO 8601
      // string OR a Unix-epoch millisecond integer depending on the
      // table version. Normalize to ISO before inserting (Postgres
      // TIMESTAMPTZ rejects the bare ms integer with 22008).
      const rawTs = r.created ?? r.valid_at ?? Date.now();
      const completedAt = (typeof rawTs === 'number' || /^\d{10,}$/.test(String(rawTs)))
        ? new Date(Number(rawTs)).toISOString()
        : String(rawTs);
      toUpsert.push({
        cave_user_id: Number(caveUserId),
        dataset: cfg.dataset,
        segment_id: String(segId),
        completed_at: completedAt,
      });
    }
    await upsertBatch(toUpsert);
    totalWritten += toUpsert.length;

    if (rows.length < PAGE_SIZE) break;  // last page
    offset += PAGE_SIZE;
  }

  console.log(`[sync] ${cfg.dataset}: read ${totalRead}, upserted ${totalWritten}`);
}

(async () => {
  const targets = onlyDatastack
    ? DATASTACKS.filter(d => d.dataset === onlyDatastack)
    : DATASTACKS;
  if (targets.length === 0) {
    console.error(`No matching datastack for --datastack=${onlyDatastack}`);
    process.exit(1);
  }
  let failed = 0;
  for (const cfg of targets) {
    try {
      await syncDatastack(cfg);
    } catch (e) {
      console.error(`[sync] ${cfg.dataset} failed:`, e.message);
      failed++;
    }
  }
  if (failed > 0) {
    console.error(`[sync] ${failed} datastack(s) failed`);
    process.exit(1);
  }
  console.log('[sync] done');
})();
