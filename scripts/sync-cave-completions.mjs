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
 *   - Runs once a day at 1 AM US Eastern (Amy 2026-09-28). It reads the
 *     latest materialized version, which only changes about every other
 *     day, so the old 30-minute schedule mostly re-read unchanged data.
 *     The in-app completion celebration counts a just-completed cell itself.
 *   - Root ids are 18 digits: parsed as TEXT (bigJson). res.json() rounded
 *     them (…216384 stored as …216400), so every mirrored id was wrong.
 *   - After a COMPLETE read of a dataset, mirror rows CAVE no longer has
 *     (rounded ids, deleted annotations) are removed for that dataset.
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
  {
    dataset:         'pinky_sandbox',
    caveServer:      'https://minnie.microns-daf.com',
    datastack:       'pinky_sandbox',
    cellStatusTable: 'eyewire_ii_cell_status_v2',
  },
  // BANC (Ames 2026-10-06, so players' BANC proofreading shows in their
  // per dataset stats; Nseraf has 1,996 marks there). BANC's own table,
  // backbone_proofread: one row per proofread cell, proofread = true, with
  // the proofreader's CAVE user id (schema proofreading_boolstatus_user).
  // It holds about 226,000 rows, nearly all by people who are not EyeWire II
  // players, so `playersOnly` asks CAVE only for rows by CAVE ids that
  // belong to players: a handful of small requests a night, not the table.
  {
    dataset:         'brain_and_nerve_cord',
    caveServer:      'https://cave.fanc-fly.com',
    datastack:       'brain_and_nerve_cord',
    cellStatusTable: 'backbone_proofread',
    schema:          'boolstatus',
    playersOnly:     true,
  },
  // minnie65: the table is created on minnie65_sandbox (aligned_volume
  // minnie65_phase3, shared with minnie65_public) and the app writes
  // completions there — BUT minnie65_sandbox has no materialization running
  // (versions == []), so the sync can't read it yet. Re-enable this row once
  // CAVE materialization is turned on for minnie65_sandbox, else the sync
  // throws "versions endpoint returned empty array" every run.
  // {
  //   dataset:         'minnie65_public',
  //   caveServer:      'https://minnie.microns-daf.com',
  //   datastack:       'minnie65_sandbox',
  //   cellStatusTable: 'eyewire_ii_cell_status_v2',
  // },
  //
  // pni_mec (MEC): blocked on CAVE infrastructure, not on this repo. As of
  // 2026-09-22 hc.himc-cave.com returns 503 from nginx for the whole
  // materialize service (even /materialize/api/versions), and its annotation
  // service answers 400 invalid_table_id for aligned_volume pni_mec while
  // happily answering 200 for minnie's volumes, so pni_mec is not registered
  // there at all. Adding the row now would fail every 30 minutes forever
  // (see trap 3 in docs/HANDOFF-new-dataset.md). Re-check with:
  //   curl -s -H "Authorization: Bearer $CAVE_SERVICE_TOKEN"   //     https://hc.himc-cave.com/materialize/api/v3/datastack/pni_mec/versions
  // A non-empty JSON array is the go signal.
  // {
  //   dataset:         'pni_mec',
  //   caveServer:      'https://hc.himc-cave.com',
  //   datastack:       'pni_mec',
  //   cellStatusTable: 'mec_cell_status_v1',
  // },
];

// One request should hold a whole answer. CAVE's limit/offset paging has no
// stable order: on BANC (2026-10-06) 5,000 row pages returned 274 rows twice
// and skipped 274 others. A single request of 14,738 rows took one second.
// If an answer ever fills this, the run fails loudly instead of paging.
const PAGE_SIZE = 200000;
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const onlyArgIdx = process.argv.indexOf('--datastack');
const onlyDatastack = onlyArgIdx >= 0 ? process.argv[onlyArgIdx + 1] : null;

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
  'Content-Type': 'application/json',
  // Use Prefer: resolution=merge-duplicates so PostgREST UPSERTS
  // (ON CONFLICT update) the row instead of erroring.
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

async function getLatestVersion(caveServer, datastack) {
  const res = await fetch(
    `${caveServer}/materialize/api/v3/datastack/${datastack}/versions`,
    { headers: { Authorization: `Bearer ${CAVE_TOKEN}` } });
  if (!res.ok) throw new Error(`versions ${res.status}: ${await res.text()}`);
  const versions = await res.json();
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('versions endpoint returned empty array');
  }
  return Math.max(...versions);
}

/** CAVE user ids of EyeWire II players (users.cave_user_id). */
async function playerCaveIds() {
  const ids = new Set();
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?select=cave_user_id&cave_user_id=not.is.null&order=cave_user_id&limit=1000&offset=${offset}`,
      { headers: supabaseHeaders });
    if (!res.ok) throw new Error(`players read failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    for (const r of rows) ids.add(Number(r.cave_user_id));
    if (rows.length < 1000) break;
  }
  return [...ids];
}

async function fetchPage(caveServer, datastack, version, table, offset, userIds) {
  // Use the frozen-version /query endpoint so we get a stable snapshot.
  // Live queries can change mid-pagination; frozen does not.
  const url = `${caveServer}/materialize/api/v3/datastack/${datastack}/version/${version}/table/${table}/query?return_pyarrow=false`;
  const body = { limit: PAGE_SIZE, offset,
    ...(userIds ? { filter_in_dict: { [table]: { user_id: userIds } } } : {}) };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CAVE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
  return bigJson(await res.text());
}

/** JSON.parse that keeps 16+ digit integers exact by reading them as strings. */
function bigJson(text) {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

/** Delete this dataset's mirror rows that the full CAVE read did not return. */
async function removeStale(dataset, keep) {
  const url = `${SUPABASE_URL}/rest/v1/cave_completions_mirror?dataset=eq.${encodeURIComponent(dataset)}&select=cave_user_id,segment_id`;
  const res = await fetch(url, { headers: supabaseHeaders });
  if (!res.ok) throw new Error(`mirror read failed: ${res.status} ${await res.text()}`);
  const stale = (bigJson(await res.text())).filter(r => !keep.has(`${r.cave_user_id}|${r.segment_id}`));
  if (!stale.length) return 0;
  if (dryRun) { console.log(`[sync] DRY-RUN would remove ${stale.length} stale rows from ${dataset}`); return stale.length; }
  const byUser = new Map();
  for (const r of stale) (byUser.get(r.cave_user_id) ?? byUser.set(r.cave_user_id, []).get(r.cave_user_id)).push(String(r.segment_id));
  for (const [user, segs] of byUser) {
    for (let i = 0; i < segs.length; i += 100) {
      const chunk = segs.slice(i, i + 100);
      const del = `${SUPABASE_URL}/rest/v1/cave_completions_mirror?dataset=eq.${encodeURIComponent(dataset)}` +
        `&cave_user_id=eq.${user}&segment_id=in.(${chunk.join(',')})`;
      const d = await fetch(del, { method: 'DELETE', headers: supabaseHeaders });
      if (!d.ok) throw new Error(`stale delete failed: ${d.status} ${await d.text()}`);
    }
  }
  return stale.length;
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
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders,
    body: JSON.stringify(deduped),
  });
  if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
}

async function syncDatastack(cfg) {
  console.log(`[sync] === ${cfg.dataset} (${cfg.cellStatusTable}) ===`);
  const version = await getLatestVersion(cfg.caveServer, cfg.datastack);
  console.log(`[sync] latest materialized version: ${version}`);

  let offset = 0;
  let totalRead = 0;
  let totalWritten = 0;
  const seen = new Set();  // cave_user_id|segment_id returned by CAVE this run

  // CAVE rows look like:
  //   { id, valid, created, deleted, superceded_id, pt_position, pt_root_id,
  //     pt_supervoxel_id, tag, user_id }
  // For a 'complete' row the tag matches /^complete($|\|)/.
  // user_id is the per-row CAVE user (bound_tag_user schema).
  // playersOnly: ask for each player's rows, one player per request.
  let chunks = [null];
  if (cfg.playersOnly) {
    const ids = await playerCaveIds();
    chunks = [];
    // One player per request, so each answer is complete (see PAGE_SIZE).
    for (const id of ids) chunks.push([id]);
    console.log(`[sync] ${cfg.dataset}: asking CAVE about ${ids.length} player(s) only`);
    if (!chunks.length) { console.log(`[sync] ${cfg.dataset}: no players with a CAVE id yet`); return; }
  }
  for (const userIds of chunks) {
  offset = 0;
  while (true) {
    let rows;
    try {
      rows = await fetchPage(
        cfg.caveServer, cfg.datastack, version, cfg.cellStatusTable, offset, userIds);
    } catch (e) {
      // A freshly-created table isn't part of the current materialized
      // version until the next materialization run. Treat "table not found
      // for version" as "no completions yet" and skip this datastack
      // gracefully rather than failing the whole job (which would resume the
      // every-30-min failure emails).
      if (/not found for version|not materialized|Analysis table/i.test(e.message)) {
        console.log(`[sync] ${cfg.dataset}: table ${cfg.cellStatusTable} not yet materialized (v${version}) — skipping until next materialization`);
        return;
      }
      throw e;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    totalRead += rows.length;

    const toUpsert = [];
    for (const r of rows) {
      if (cfg.schema === 'boolstatus') {
        // BANC backbone_proofread: the row counts when proofread is true.
        if (!(r.proofread === true || r.proofread === 't')) continue;
      } else {
        const tag = String(r.tag ?? '');
        // Match both bare 'complete' and the legacy 'complete|by:<user>' suffix.
        if (!(tag === 'complete' || tag.startsWith('complete|by:') || tag.startsWith('complete|'))) continue;
      }
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
      seen.add(`${Number(caveUserId)}|${String(segId)}`);
      toUpsert.push({
        cave_user_id: Number(caveUserId),
        dataset: cfg.dataset,
        segment_id: String(segId),
        completed_at: completedAt,
      });
    }
    await upsertBatch(toUpsert);
    totalWritten += toUpsert.length;

    if (rows.length < PAGE_SIZE) break;  // the whole answer
    throw new Error(`${cfg.dataset}: an answer filled ${PAGE_SIZE} rows; paging is not reliable on CAVE, split the request instead`);
  }
  }

  // The loop only ends here after the last page, so the read is complete.
  const removed = await removeStale(cfg.dataset, seen);
  console.log(`[sync] ${cfg.dataset}: read ${totalRead}, upserted ${totalWritten}, removed ${removed} stale`);
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
