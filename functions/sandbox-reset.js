'use strict';
// Sandbox cells go back into play once completed (Ames 2026-11-14: "we want
// to re-serve these sandbox cells ... every cell I complete on test is taking
// a cell away from a player").
//
// For a completed Sandbox cell: undo every edit still in effect on it since it
// was handed out (its task's created_at), check that the cell is exactly what
// it was then (the same supervoxels), and add it back to the Cell Library as
// a new pending task. The completed task stays as it was, so the player keeps
// their completed cell, its review and every count made from it.
//
// Anything unexpected (an edit after the completion, a cell that does not come
// back exactly) leaves the cell alone and marks it for an admin.
//
// io:
//   io.fetch      fetch
//   io.caveToken  a CAVE token that may edit the Sandbox (pinky_nf_v2)
//   io.sb(path, init)  Supabase REST as the service role
//   io.log        console-like (optional)

const {operationsAfter, remainingOperations} = require('./pcg-history');

const SANDBOX = 'https://minnie.microns-daf.com/segmentation/api/v1/table/pinky_nf_v2';
const DATASET = 'pinky_nf_v2';
/** The Sandbox's current set of cells (Ames 2026-11-01): older rows are not re-served. */
const SET_SINCE = '2026-11-01T00:00:00Z';
/** Time for the player's review before the cell is reset under them. */
const AFTER_MS = 15 * 60 * 1000;
const PASSES = 8;
const SV = /^\d{1,20}$/;

function cave(io) {
  const call = async (path, body) => {
    const r = await io.fetch(SANDBOX + path, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: `Bearer ${io.caveToken}`, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`CAVE answered ${r.status} for ${path.split('?')[0].split('/').slice(-1)[0]}`);
    return r.json();
  };
  return {
    async root(sv, at = null) {
      const ts = at == null ? '' : `&timestamp=${(new Date(at).getTime() / 1000).toFixed(3)}`;
      const d = await call(`/node/${sv}/root?int64_as_str=1${ts}`);
      const root = String(d.root_id);
      if (!SV.test(root)) throw new Error('Invalid CAVE root');
      return root;
    },
    async leaves(root) {
      const d = await call(`/node/${root}/leaves?int64_as_str=1`);
      if (!d || !Array.isArray(d.leaf_ids)) throw new Error('Invalid CAVE leaves');
      return d.leaf_ids.map(String).sort();
    },
    changeLog: root => call(`/root/${root}/tabular_change_log?filtered=false`),
    async details(ids) {
      const out = {};
      for (let i = 0; i < ids.length; i += 100) Object.assign(out, await call('/operation_details?int64_as_str=1&operation_ids=' + encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))));
      return out;
    },
    undo: id => call('/undo?int64_as_str=1', {operation_id: id}),
  };
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The edits still in effect on the cell since `since`, newest first. */
async function activeOps(cg, sv, since) {
  const root = await cg.root(sv);
  const ops = operationsAfter(await cg.changeLog(root), root, since);
  if (!ops.length) return [];
  return remainingOperations(ops, await cg.details(ops.map(o => o.operationId)));
}

/** Put one completed task's cell back as it was handed out. Returns what was done. */
async function resetCell(io, task, {dryRun = false} = {}) {
  const cg = cave(io);
  const sv = String(task.supervoxel_id || '');
  if (!SV.test(sv)) throw new Error('no soma supervoxel');
  const since = task.created_at;
  const start = await cg.leaves(await cg.root(sv, since));
  let undone = 0, before = '';
  for (let pass = 0; pass < PASSES; pass++) {
    const ops = await activeOps(cg, sv, since);
    const done = task.completed_at ? Date.parse(task.completed_at) : Infinity;
    // Someone edited it after it was completed: leave it for an admin.
    if (ops.some(o => o.at > done + 60000)) return {status: 'needs_review', undone, reason: 'edited after it was completed'};
    // An edit made while nobody held this cell may be another player's work on
    // their own cell next to it: never undo that.
    const stray = (task.windows || []).length ? ops.filter(o => !task.windows.some(([a, b]) => o.at >= a - 60000 && o.at <= b + 60000)) : [];
    if (stray.length) return {status: 'needs_review', undone, reason: `edits made while nobody held it: ${stray.map(o => o.operationId).join(' ')}`};
    if (!ops.length) break;
    if (dryRun) return {status: 'dry_run', undone: 0, wouldUndo: ops.map(o => o.operationId)};
    const now = ops.map(o => o.operationId).join(',');
    // The same operations twice: undoing them changes nothing more (see
    // scripts/reset-practice-examples.mjs).
    if (now === before) break;
    before = now;
    for (const op of ops) { await cg.undo(op.operationId); undone++; }
  }
  const rootNow = await cg.root(sv);
  const nowLeaves = await cg.leaves(rootNow);
  if (!sameSet(nowLeaves, start)) return {status: 'needs_review', undone, reason: `not back to its start (${nowLeaves.length} supervoxels, started with ${start.length})`};
  return {status: 'reset', undone, root: rootNow};
}

/** Completed Sandbox cells due to go back, oldest first. */
async function due(io, now, limit) {
  const before = new Date(now - AFTER_MS).toISOString();
  const tasks = await io.sb(`proofreading_tasks?dataset=eq.${DATASET}&status=eq.completed&created_at=gte.${SET_SINCE}&updated_at=lt.${encodeURIComponent(before)}&select=*&order=updated_at.asc&limit=200`);
  if (!tasks.length) return [];
  const ids = tasks.map(t => t.id).join(',');
  // Done or left for an admin: never again. Failed: again after 6 hours.
  const retry = new Date(now - 6 * 3600 * 1000).toISOString();
  const seen = new Set((await io.sb(`sandbox_cell_resets?task_id=in.(${ids})&select=task_id,status,updated_at`))
    .filter(r => r.status !== 'failed' || r.updated_at > retry).map(r => r.task_id));
  // A cell already back in play (a newer open task on the same soma) is not added twice.
  const svs = [...new Set(tasks.map(t => t.supervoxel_id).filter(Boolean))];
  const open = new Set((await io.sb(`proofreading_tasks?dataset=eq.${DATASET}&status=in.(pending,assigned,in_progress)&supervoxel_id=in.(${svs.map(s => `"${s}"`).join(',')})&select=supervoxel_id`)).map(r => r.supervoxel_id));
  return tasks.filter(t => !seen.has(t.id) && !open.has(t.supervoxel_id)).slice(0, limit);
}

/** When the cell was held (each claim, as [from, to] in ms) and when it was completed. */
async function holds(io, task) {
  const rows = await io.sb(`task_assignments?task_id=eq.${task.id}&select=claimed_at,completed_at,released_at&order=claimed_at.asc`);
  const windows = rows.map(a => [Date.parse(a.claimed_at), Date.parse(a.completed_at || a.released_at || task.updated_at)]).filter(w => w.every(Number.isFinite));
  const done = rows.map(a => a.completed_at).filter(Boolean).sort().pop();
  return {windows, completed_at: done || task.updated_at};
}

/** Re-serve up to `limit` cells. */
async function run(io, {limit = 4, dryRun = false, taskId = null, now = Date.now()} = {}) {
  const log = io.log || console;
  const list = taskId != null
    ? await io.sb(`proofreading_tasks?id=eq.${Number(taskId)}&dataset=eq.${DATASET}&status=eq.completed&select=*`)
    : await due(io, now, limit);
  const out = [];
  for (const task of list) {
    const t = {...task, ...(await holds(io, task))};
    let r;
    try { r = await resetCell(io, t, {dryRun}); } catch (e) { r = {status: 'failed', reason: e.message}; }
    let newTask = null;
    if (r.status === 'reset' && !dryRun) {
      const rows = await io.sb('proofreading_tasks', {
        method: 'POST', headers: {Prefer: 'return=representation'},
        body: JSON.stringify({
          segment_id: r.root, dataset: DATASET, supervoxel_id: task.supervoxel_id, kind: task.kind || 'cell',
          nucleus_coords: task.nucleus_coords, soma_coords: task.soma_coords, priority: task.priority || 0,
          claim_point_x: task.claim_point_x, claim_point_y: task.claim_point_y, claim_point_z: task.claim_point_z,
          source_sheet_url: task.source_sheet_url, status: 'pending',
        }),
      });
      newTask = rows && rows[0] ? rows[0].id : null;
    }
    if (!dryRun) {
      await io.sb('sandbox_cell_resets?on_conflict=task_id', {
        method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify({task_id: task.id, status: r.status, new_task_id: newTask, ops_undone: r.undone || 0, reason: r.reason || null, updated_at: new Date(now).toISOString()}),
      });
    }
    log.log(`[sandbox-reset] task ${task.id}: ${r.status}${r.undone ? `, ${r.undone} undone` : ''}${newTask ? `, back as task ${newTask}` : ''}${r.reason ? ` (${r.reason})` : ''}${r.wouldUndo ? `, would undo ${r.wouldUndo.join(' ')}` : ''}`);
    out.push({taskId: task.id, ...r, newTask});
  }
  return out;
}

module.exports = {run, resetCell, due, holds, sameSet, AFTER_MS, SET_SINCE};
