#!/usr/bin/env node
/**
 * reset-practice-examples.mjs
 * --------------------------------------------------------------------
 * Puts Cut & Merge practice cells back the way they were registered
 * (supabase-tutorial-practice-schema.sql, src/practice.ts).
 *
 * The client undoes its own edits when a user finishes or leaves. This job
 * handles what the client cannot: a closed tab (the claim expires), a
 * client undo that failed (status needs_reset), and a stuck `resetting`
 * row from a crashed run. For each, it undoes every PyChunkedGraph
 * operation in the lineage of both pieces since `baseline_at`, newest
 * first, with CAVE_SERVICE_TOKEN, checks the two supervoxels sit on
 * different roots again, refreshes root_a and root_b, and marks the row
 * ready. Three failures in a row mark it broken for Amy to look at
 * (Admin Hub > Practice cells).
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CAVE_SERVICE_TOKEN     an account with edit rights on the sandbox
 *
 * Usage:
 *   node scripts/reset-practice-examples.mjs [--dry-run] [--id <uuid>]
 */

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const idArgIdx = process.argv.indexOf('--id');
const onlyId = idArgIdx >= 0 ? process.argv[idArgIdx + 1] : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAVE_TOKEN   = process.env.CAVE_SERVICE_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!CAVE_TOKEN) {
  console.error('Missing CAVE_SERVICE_TOKEN — needed to undo edits on CAVE');
  process.exit(1);
}

const STUCK_RESET_MS = 15 * 60 * 1000;
const MAX_FAILURES = 3;

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: supabaseHeaders, ...init });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function patchRow(id, body) {
  if (dryRun) { console.log(`[reset] dry-run PATCH ${id}`, body); return; }
  await sb(`tutorial_practice_examples?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── PCG ────────────────────────────────────────────────────────────────────

const caveHeaders = { Authorization: `Bearer ${CAVE_TOKEN}`, 'Content-Type': 'application/json' };
const base = (ex) => `${ex.pcg_server}/segmentation/api/v1/table/${ex.pcg_table}`;

async function rootOf(ex, sv) {
  const res = await fetch(`${base(ex)}/node/${sv}/root?int64_as_str=1`, { headers: caveHeaders });
  if (!res.ok) throw new Error(`root of ${sv}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.root_id);
}

const pcgLayer = (id) => Math.floor(Number(id) / 2 ** 56);

/** Walk a root down to one of its supervoxels (layer 1). */
async function anySupervoxelOf(ex, rootId) {
  let id = rootId;
  for (let i = 0; i < 12 && pcgLayer(id) > 1; i++) {
    const res = await fetch(`${base(ex)}/node/${id}/children?int64_as_str=1`, { headers: caveHeaders });
    if (!res.ok) throw new Error(`children of ${id}: ${res.status}`);
    const data = await res.json();
    const kids = (data.children_ids ?? data.children ?? []).map(String);
    if (!kids.length) throw new Error(`node ${id} has no children`);
    id = kids[0];
  }
  if (pcgLayer(id) !== 1) throw new Error(`could not reach a supervoxel from ${rootId}`);
  return id;
}

async function ensureSupervoxels(ex) {
  if (ex.supervoxel_a && ex.supervoxel_b) return;
  ex.supervoxel_a = ex.supervoxel_a || await anySupervoxelOf(ex, ex.root_a);
  ex.supervoxel_b = ex.supervoxel_b || await anySupervoxelOf(ex, ex.root_b);
  await patchRow(ex.id, { supervoxel_a: ex.supervoxel_a, supervoxel_b: ex.supervoxel_b });
}

/** Operations in a root's lineage after `since`, newest first. */
async function opsSince(ex, rootId, since) {
  const res = await fetch(`${base(ex)}/root/${rootId}/tabular_change_log`, { headers: caveHeaders });
  if (!res.ok) throw new Error(`tabular_change_log ${rootId}: ${res.status}`);
  const data = await res.json();
  const ids = data.operation_id ?? [];
  const stamps = data.timestamp ?? [];
  const cutoff = new Date(since).getTime();
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const at = new Date(stamps[i]).getTime();
    if (Number.isFinite(at) && at > cutoff) out.push({ operationId: Number(ids[i]), at });
  }
  return out.sort((a, b) => b.at - a.at);
}

async function undo(ex, operationId) {
  if (dryRun) { console.log(`[reset] dry-run undo ${operationId} on ${ex.pcg_table}`); return; }
  const res = await fetch(`${base(ex)}/undo?int64_as_str=1`, {
    method: 'POST', headers: caveHeaders, body: JSON.stringify({ operation_id: operationId }),
  });
  if (!res.ok) throw new Error(`undo ${operationId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// ── Reset one example ──────────────────────────────────────────────────────

async function resetExample(ex) {
  await ensureSupervoxels(ex);
  const roots = new Set([await rootOf(ex, ex.supervoxel_a), await rootOf(ex, ex.supervoxel_b)]);
  const seen = new Set();
  const ops = [];
  for (const r of roots) for (const op of await opsSince(ex, r, ex.baseline_at)) {
    if (!seen.has(op.operationId)) { seen.add(op.operationId); ops.push(op); }
  }
  ops.sort((a, b) => b.at - a.at);
  console.log(`[reset] ${ex.title || ex.id}: ${ops.length} operation(s) since baseline`);
  for (const op of ops) await undo(ex, op.operationId);

  const a = await rootOf(ex, ex.supervoxel_a);
  const b = await rootOf(ex, ex.supervoxel_b);
  // A cut example starts fused; a merge_then_cut example starts separate.
  const wantFused = ex.kind === 'cut';
  if ((a === b) !== wantFused) {
    throw new Error(wantFused ? `after undo the pieces are still apart (${a}, ${b})`
                              : `after undo both supervoxels are on root ${a}`);
  }
  return { a, b };
}

async function main() {
  const now = Date.now();
  let query = 'tutorial_practice_examples?select=*&enabled=eq.true';
  if (onlyId) query += `&id=eq.${encodeURIComponent(onlyId)}`;
  const rows = await sb(query);

  const due = rows.filter(r => {
    if (onlyId) return true;
    if (r.status === 'needs_reset') return true;
    if (r.status === 'in_use' && r.expires_at && new Date(r.expires_at).getTime() < now) return true;
    if (r.status === 'resetting' && new Date(r.updated_at).getTime() < now - STUCK_RESET_MS) return true;
    return false;
  });
  console.log(`[reset] ${rows.length} example(s), ${due.length} due`);

  let failed = 0;
  for (const ex of due) {
    await patchRow(ex.id, { status: 'resetting', claimed_by: null, claimed_at: null, expires_at: null, updated_at: new Date().toISOString() });
    try {
      const { a, b } = await resetExample(ex);
      await patchRow(ex.id, {
        status: 'ready', root_a: a, root_b: b, reset_failures: 0, last_error: null,
        last_reset_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      console.log(`[reset] ${ex.title || ex.id}: ready (roots ${a}, ${b})`);
    } catch (e) {
      failed++;
      const failures = (ex.reset_failures ?? 0) + 1;
      const broken = failures >= MAX_FAILURES;
      console.error(`[reset] ${ex.title || ex.id}: ${e.message}${broken ? ' (marking broken)' : ''}`);
      await patchRow(ex.id, {
        status: broken ? 'broken' : 'needs_reset', reset_failures: failures,
        last_error: String(e.message).slice(0, 500), updated_at: new Date().toISOString(),
      });
    }
  }
  if (failed) process.exit(2);
}

main().catch(e => { console.error('[reset] fatal:', e); process.exit(1); });
