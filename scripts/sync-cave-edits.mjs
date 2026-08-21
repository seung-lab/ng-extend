#!/usr/bin/env node
/**
 * sync-cave-edits.mjs
 * --------------------------------------------------------------------
 * CAVE-sourced edit counts (HANDOFF-BUGFIX-WIP.md §3.1).
 *
 * Pulls real PyChunkedGraph operations per user from
 *   GET {caveServer}/segmentation/api/v1/table/{table}/user_operations
 *       ?user_id=&start_time=&end_time=
 * and upserts them into Supabase `cave_edits_mirror`. The leaderboard
 * view (after supabase-cave-edits-view-swap.sql) computes edit counts
 * from this mirror instead of the client-inferred `edit_log`.
 *
 * ⚠️ PERMISSION-GATED: user_operations requires `admin_view` on the
 * auth dataset (verified by scripts/probe-cave-edits.mjs, run 29769718266:
 * control endpoint 200, user_operations 403 missing_permission). Until the
 * CAVE admins grant it to the account behind CAVE_SERVICE_TOKEN, every call
 * here returns 403 and the script exits with a clear message. It is safe to
 * run at any time — reads CAVE, writes only cave_edits_mirror.
 *
 * User iteration: we only mirror operations for users we can attribute,
 * i.e. rows in Supabase `users` with a non-null cave_user_id (captured at
 * middleauth login). New users get picked up on their first sync after
 * login. First run backfills from EPOCH_START; later runs look back
 * LOOKBACK_DAYS to catch stragglers cheaply.
 *
 * Response shape: user_operations returns per-operation records with an
 * operation id, a timestamp, and merge/split discriminator. Exact field
 * names may differ by pychunkedgraph version, so extraction is defensive
 * (see extractOperations) and logs one sample row per table on first
 * sight so a field-name drift is visible in the CI log, not silent.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CAVE_SERVICE_TOKEN
 *
 * Usage:
 *   node scripts/sync-cave-edits.mjs [--dry-run] [--dataset <name>]
 *                                    [--full-backfill]
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAVE_TOKEN   = process.env.CAVE_SERVICE_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!CAVE_TOKEN) {
  console.error('Missing CAVE_SERVICE_TOKEN — needed to call CAVE PCG');
  process.exit(1);
}

// ── PCG tables to mirror ────────────────────────────────────────────
// dataset = the tag stamped on mirror rows. Matches the canonical tags
// the client stamps on Supabase rows (src/datasets.ts canonicalDataset),
// NOT the completions sync's datastack names — the view joins only on
// cave_user_id, but the profile Datasets tab filters by these tags.
// pcgTable = the segmentation table from the graphene layer URL
// (.../segmentation/table/<table>).
const TABLES = [
  {
    dataset:   'stroeh_mouse_retina',
    caveServer:'https://minnie.microns-daf.com',
    pcgTable:  'stroeh_mouse_retina',
  },
  {
    dataset:   'pinky_nf_v2',
    caveServer:'https://minnie.microns-daf.com',
    pcgTable:  'pinky_nf_v2',
  },
  {
    dataset:   'minnie65_public',
    caveServer:'https://minnie.microns-daf.com',
    pcgTable:  'minnie65_public_v117',
  },
];

// First sync backfills from before the earliest dataset existed
// (stroeh's oldest_timestamp is 2025-02-20). Later runs use LOOKBACK_DAYS.
const EPOCH_START   = '2025-01-01T00:00:00Z';
const LOOKBACK_DAYS = 7;

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const fullBackfill = flags.has('--full-backfill');
const onlyArgIdx = process.argv.indexOf('--dataset');
const onlyDataset = onlyArgIdx >= 0 ? process.argv[onlyArgIdx + 1] : null;

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

async function getAttributableUsers() {
  const url = `${SUPABASE_URL}/rest/v1/users?select=id,display_name,cave_user_id&cave_user_id=not.is.null`;
  const res = await fetch(url, { headers: supabaseHeaders });
  if (!res.ok) throw new Error(`users lookup failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  console.log(`[sync-edits] ${rows.length} users with cave_user_id`);
  return rows;
}

/** True when the mirror already has rows (first run → full backfill). */
async function mirrorHasRows() {
  const url = `${SUPABASE_URL}/rest/v1/cave_edits_mirror?select=operation_id&limit=1`;
  const res = await fetch(url, { headers: supabaseHeaders });
  if (!res.ok) throw new Error(`mirror probe failed: ${res.status} ${await res.text()}`);
  return (await res.json()).length > 0;
}

const sampleLogged = new Set();

/**
 * Normalize a user_operations response into
 * [{operation_id, is_merge, timestamp}].
 *
 * Handles both a JSON array of row objects and a column-oriented object
 * ({col: {rowIdx: val}} — the pandas-to_json shape some PCG endpoints
 * return). Field-name candidates cover the pychunkedgraph versions in the
 * wild. Anything unrecognized is skipped and counted, never guessed.
 */
function extractOperations(payload, tableLabel) {
  let rows = [];
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && typeof payload === 'object') {
    const cols = Object.keys(payload);
    if (cols.length && typeof payload[cols[0]] === 'object') {
      const rowIds = Object.keys(payload[cols[0]] ?? {});
      rows = rowIds.map(ri => Object.fromEntries(cols.map(c => [c, payload[c]?.[ri]])));
    }
  }
  if (rows.length && !sampleLogged.has(tableLabel)) {
    sampleLogged.add(tableLabel);
    console.log(`[sync-edits] sample ${tableLabel} row: ${JSON.stringify(rows[0]).slice(0, 400)}`);
  }
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const opId = r.operation_id ?? r.id ?? r.operation ?? null;
    const ts   = r.timestamp ?? r.date ?? r.created ?? r.time ?? null;
    // is_merge appears directly on tabular_change_log rows; some versions
    // instead expose added/removed edge counts.
    let isMerge = r.is_merge;
    if (isMerge === undefined && r.added_edges !== undefined) isMerge = !!r.added_edges;
    if (opId == null || ts == null || isMerge === undefined) { skipped++; continue; }
    const iso = (typeof ts === 'number' || /^\d{10,}$/.test(String(ts)))
      ? new Date(Number(ts)).toISOString()
      : String(ts);
    out.push({ operation_id: Number(opId), is_merge: !!isMerge, timestamp: iso });
  }
  if (skipped) console.warn(`[sync-edits] ${tableLabel}: skipped ${skipped} rows with unrecognized fields`);
  return out;
}

async function fetchUserOperations(cfg, caveUserId, startIso, endIso) {
  const url = `${cfg.caveServer}/segmentation/api/v1/table/${cfg.pcgTable}` +
    `/user_operations?user_id=${caveUserId}` +
    `&start_time=${encodeURIComponent(startIso)}&end_time=${encodeURIComponent(endIso)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CAVE_TOKEN}` } });
  if (res.status === 403) {
    const body = await res.text();
    const err = new Error(`403 on user_operations — the admin_view grant has not landed yet. ${body.slice(0, 200)}`);
    err.permissionGated = true;
    throw err;
  }
  if (res.status === 404) return null; // table has no PCG or endpoint absent
  if (!res.ok) throw new Error(`user_operations ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function upsertBatch(rows) {
  if (!rows.length) return;
  // Dedupe on the (dataset, operation_id) PK within the batch.
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.dataset}|${r.operation_id}`, r);
  const deduped = [...byKey.values()];
  if (dryRun) {
    console.log(`[sync-edits] DRY-RUN would upsert ${deduped.length} rows`);
    return;
  }
  const url = `${SUPABASE_URL}/rest/v1/cave_edits_mirror?on_conflict=dataset,operation_id`;
  const res = await fetch(url, { method: 'POST', headers: supabaseHeaders, body: JSON.stringify(deduped) });
  if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
}

(async () => {
  const targets = onlyDataset ? TABLES.filter(t => t.dataset === onlyDataset) : TABLES;
  if (!targets.length) {
    console.error(`No matching dataset for --dataset=${onlyDataset}`);
    process.exit(1);
  }

  const users = await getAttributableUsers();
  if (!users.length) { console.log('[sync-edits] nothing to do'); return; }

  const backfill = fullBackfill || !(await mirrorHasRows());
  const endIso = new Date().toISOString();
  const startIso = backfill
    ? EPOCH_START
    : new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`[sync-edits] window ${startIso} → ${endIso} (${backfill ? 'FULL BACKFILL' : `${LOOKBACK_DAYS}d lookback`})`);

  let failed = 0;
  for (const cfg of targets) {
    console.log(`[sync-edits] === ${cfg.dataset} (${cfg.pcgTable}) ===`);
    let tableTotal = 0;
    for (const u of users) {
      try {
        const payload = await fetchUserOperations(cfg, u.cave_user_id, startIso, endIso);
        if (payload == null) { console.log(`[sync-edits] ${cfg.dataset}: endpoint 404 — skipping table`); break; }
        const ops = extractOperations(payload, `${cfg.dataset}`);
        if (ops.length) {
          await upsertBatch(ops.map(op => ({
            cave_user_id: Number(u.cave_user_id),
            dataset: cfg.dataset,
            ...op,
          })));
          tableTotal += ops.length;
          console.log(`[sync-edits] ${cfg.dataset}: ${u.display_name ?? u.cave_user_id} → ${ops.length} ops`);
        }
      } catch (e) {
        if (e.permissionGated) {
          // Known waiting state, not a malfunction: the cron now runs every
          // 30 minutes and a red X each time just spams Amy's inbox. Exit 0
          // with a loud log; the day the admin_view grant lands, the same
          // cron starts syncing with no further changes.
          console.error(`[sync-edits] ${e.message}`);
          console.error('[sync-edits] WAITING on the admin_view grant (HANDOFF-BUGFIX-WIP.md 3.1). Exiting green so the cron does not page anyone until then.');
          process.exit(0);
        }
        failed++;
        console.error(`[sync-edits] ${cfg.dataset} user ${u.cave_user_id}: ${e.message}`);
      }
    }
    console.log(`[sync-edits] ${cfg.dataset}: upserted ${tableTotal} operations`);
  }
  if (failed) {
    console.error(`[sync-edits] completed with ${failed} per-user failures`);
    process.exit(1);
  }
  console.log('[sync-edits] done');
})();
