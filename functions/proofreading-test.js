'use strict';
// The proofreading test (Ames, 2026-10-10): one Sandbox cell with several
// mistakes on it. A player proofreads it, this module scores the result from
// the chunkedgraph itself (never from the browser's say so), records the
// attempt, puts the cell back for the next player and, on a pass, opens the
// gates: the app's pilot list (in the database function) and the CAVE groups
// that carry edit rights (here). Schema: supabase-proofreading-test.sql.
// Client: src/proofreading-test.ts. Called from ewSecureWrite in index.js.
//
// Everything outside this process goes through `io`, so the tests run it
// against fakes:
//   io.fetch               fetch
//   io.caveToken           a CAVE token: reads and undoes on the sandbox, and
//                          adds members to the test's CAVE groups
//   io.rpc(action, args)   pilot_test_action for the signed in player
//   io.sb(path, init)      Supabase REST as the service role
//   io.onGranted()         after a grant (clears the production access cache)
//   io.notifyAdmins(note)  {title, body} to every admin but the player
const {operationsAfter, remainingOperations} = require('./pcg-history');

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const SANDBOX = {server: 'https://minnie.microns-daf.com', table: 'pinky_nf_v2'};
const AUTH = 'https://global.daf-apis.com/auth/api/v1';
// Viewer voxels on pinky, in nm. Endpoint distances are measured in nm.
const VIEW_NM = [4, 4, 40];
// What each kind expects of its two supervoxels at the start and at the end.
const EXPECT = {cut: ['together', 'apart'], merge: ['apart', 'together'], keep: ['together', 'together'], apart: ['apart', 'apart']};
const ERROR_KINDS = ['cut', 'merge'];
const DAMAGE_KINDS = ['keep', 'apart'];
const SV = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pcgBase(test) {
  if (test.pcg_server !== SANDBOX.server || test.pcg_table !== SANDBOX.table) fail(500, 'The test cell is not on the approved sandbox.');
  return `${test.pcg_server}/segmentation/api/v1/table/${test.pcg_table}`;
}

function caveClient(io) {
  const call = async (url, body) => {
    const r = await io.fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: `Bearer ${io.caveToken}`, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`CAVE answered ${r.status} for ${url.split('?')[0].split('/').slice(-2).join('/')}`);
    return r.json();
  };
  return {get: url => call(url), post: (url, body) => call(url, body)};
}

async function rootOf(get, base, sv) {
  const d = await get(`${base}/node/${sv}/root?int64_as_str=1`);
  const root = String(d && d.root_id);
  if (!SV.test(root)) throw new Error('Invalid CAVE root response');
  return root;
}

/** The current root of every supervoxel the checks name, plus the anchor. */
async function readRoots(test, checks, get) {
  const base = pcgBase(test);
  const svs = [...new Set([test.anchor_supervoxel, ...checks.flatMap(c => [c.supervoxel_a, c.supervoxel_b])]
    .map(sv => String(sv || '')).filter(sv => SV.test(sv)))];
  const roots = {};
  for (let i = 0; i < svs.length; i += 4) {
    const batch = svs.slice(i, i + 4);
    const got = await Promise.all(batch.map(sv => rootOf(get, base, sv)));
    batch.forEach((sv, k) => { roots[sv] = got[k]; });
  }
  return roots;
}

function relationOf(check, roots) {
  const a = roots[check.supervoxel_a], b = roots[check.supervoxel_b];
  if (!a || !b) return null;
  return a === b ? 'together' : 'apart';
}

/** Each graph check against the roots: `when` is 'start' or 'end'. */
function graphResults(checks, roots, when) {
  const idx = when === 'start' ? 0 : 1;
  return checks.filter(c => EXPECT[c.kind]).map(c => {
    const state = relationOf(c, roots);
    const ok = state === EXPECT[c.kind][idx];
    return {id: c.id, ordinal: c.ordinal, kind: c.kind, label: c.label || '', weight: c.weight ?? 1,
      state, ok, point_a: c.point_a || null, point_b: c.point_b || null, seg: segmentOf(c, roots, ok)};
  });
}

/** What the admins' heat map colors for a check (Ames, 2026-10-21): a
 *  mistake's piece as a segment of its own (piece_root, from the key), and
 *  for a real branch cut off, the part that came off, as it was when scored.
 *  Kept with the try; never sent to the player. */
function segmentOf(c, roots, ok) {
  if (ERROR_KINDS.includes(c.kind)) return c.piece_root && SV.test(String(c.piece_root)) ? String(c.piece_root) : null;
  if (c.kind === 'keep' && !ok) return roots[c.supervoxel_a] || null;
  return null;
}

/** The checks that are not in their start state. */
function wrongAtStart(checks, roots) {
  return graphResults(checks, roots, 'start').filter(r => !r.ok).map(r => `${r.kind} ${r.label || r.ordinal}: ${r.state || 'unknown'}`);
}

/** The player's point annotations, as [x, y, z] viewer voxels. At most 500. */
function cleanAnnotations(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const q = p.slice(0, 3).map(Number);
    if (q.every(n => Number.isFinite(n) && Math.abs(n) < 1e7)) out.push(q);
    if (out.length >= 500) break;
  }
  return out;
}

const nm = p => [p[0] * VIEW_NM[0], p[1] * VIEW_NM[1], p[2] * VIEW_NM[2]];
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Each endpoint check: hit when a point annotation sits within its radius.
 *  `stray` counts the player's points that are near no endpoint. */
function endpointResults(checks, annotations) {
  const ends = checks.filter(c => c.kind === 'endpoint' && Array.isArray(c.point_a));
  const radiusOf = c => (Number(c.radius_nm) > 0 ? Number(c.radius_nm) : 1500);
  const pts = annotations.map(nm);
  // near[e]: the points within this end's radius, nearest first.
  const near = ends.map(c => {
    const here = nm(c.point_a), r = radiusOf(c);
    return pts.map((p, i) => [distance(p, here), i]).filter(([d]) => d <= r).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  });
  // One point marks one end, so two ends close together need two points.
  // A maximum matching (augmenting paths): the player is credited with as
  // many ends as their points can cover, whatever order they placed them in.
  const owner = new Map(); // point index -> end index
  const take = (e, seen) => {
    for (const i of near[e]) {
      if (seen.has(i)) continue;
      seen.add(i);
      if (!owner.has(i) || take(owner.get(i), seen)) { owner.set(i, e); return true; }
    }
    return false;
  };
  const hit = ends.map((_, e) => take(e, new Set()));
  const results = ends.map((c, e) => ({id: c.id, ordinal: c.ordinal, kind: 'endpoint', label: c.label || '', weight: c.weight ?? 1,
    ok: hit[e], radius: radiusOf(c), point_a: c.point_a, point_b: null}));
  // Stray: a point within no end's radius at all.
  const nearAny = new Set(near.flat());
  const stray = pts.filter((_, i) => !nearAny.has(i)).length;
  return {results, stray};
}

/** Pass or fail. Every cut, merge and endpoint check is worth its weight;
 *  keep and apart checks are damage, which fails the test when the test
 *  says so. */
function decide(test, results, stray = 0) {
  const errors = results.filter(r => ERROR_KINDS.includes(r.kind));
  const ends = results.filter(r => r.kind === 'endpoint');
  const damage = results.filter(r => DAMAGE_KINDS.includes(r.kind) && !r.ok);
  const scored = [...errors, ...ends];
  const available = scored.reduce((n, r) => n + (r.weight ?? 1), 0);
  const earned = scored.filter(r => r.ok).reduce((n, r) => n + (r.weight ?? 1), 0);
  // The pass uses the exact share; the number shown is rounded down, so it
  // never says 90 to a player who missed a mark of 90 by a fraction.
  const exact = available ? 100 * earned / available : 100;
  const percent = Math.floor(exact + 1e-9);
  const mark = Number.isFinite(Number(test.pass_mark)) ? Number(test.pass_mark) : 100;
  const passed = exact + 1e-9 >= mark && (!test.damage_fails || damage.length === 0);
  return {passed, found: errors.filter(r => r.ok).length, errors: errors.length, damaged: damage.length, percent,
    endpoints: ends.length, endpointsFound: ends.filter(r => r.ok).length, stray};
}

/** What the player is told, by the test's feedback setting. The answers
 *  (where the misses are) only with 'detail'. */
function feedback(test, decision, results, granted) {
  const out = {passed: decision.passed, feedback: test.feedback};
  if (granted) out.granted = {pilot: !!granted.pilot, groups: (granted.groups || []).map(g => ({id: g.id, ok: !!g.ok}))};
  if (test.feedback === 'none') return out;
  Object.assign(out, {found: decision.found, errors: decision.errors, damaged: decision.damaged, percent: decision.percent,
    endpoints: decision.endpoints, endpointsFound: decision.endpointsFound, stray: decision.stray});
  if (test.feedback === 'detail') {
    out.checks = results.map(r => ({kind: r.kind, label: r.label, ok: r.ok, weight: r.weight ?? 1,
      point: r.ok ? null : (r.kind === 'endpoint' ? r.point_a : (r.point_b || r.point_a))}));
  }
  return out;
}

/** What the admins are told when a player submits (Ames, 2026-10-13). */
function adminNote(me, decision, timedOut = false) {
  const name = String((me && (me.username || me.display_name)) || 'A player').slice(0, 60);
  const bits = [`${decision.found} of ${decision.errors} mistakes fixed`];
  if (decision.endpoints) bits.push(`${decision.endpointsFound} of ${decision.endpoints} branch ends marked`);
  bits.push(decision.damaged ? `${decision.damaged} real part${decision.damaged === 1 ? '' : 's'} of the cell damaged` : 'nothing damaged');
  return {
    title: `Proofreading Test: ${name} ${decision.passed ? 'passed' : 'did not pass'}`,
    body: `${decision.percent} percent. ${bits.join(', ')}.${timedOut ? ' Time ran out.' : ''}`,
  };
}

/** Undo every operation on the cell after the baseline, newest first. The
 *  roots are the current roots of the check supervoxels; every edit that
 *  touched the cell is in one of their histories. Returns how many. */
/** One pass: undo the operations after the baseline still in effect in the
 *  histories of these roots, newest first, until `until` (ms). */
async function undoPass(test, roots, cave, assertLease, until) {
  const base = pcgBase(test);
  const ops = new Map();
  for (const root of new Set(Object.values(roots))) {
    const data = await cave.get(`${base}/root/${root}/tabular_change_log?filtered=false`);
    for (const op of operationsAfter(data, root, test.baseline_at)) ops.set(op.operationId, op);
  }
  if (!ops.size) return {found: 0, undone: 0, signature: '', outOfTime: false};
  const ids = [...ops.keys()], details = {};
  for (let i = 0; i < ids.length; i += 100) {
    Object.assign(details, await cave.get(`${base}/operation_details?int64_as_str=1&operation_ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`));
  }
  const active = remainingOperations([...ops.values()], details);
  const signature = active.map(op => op.operationId).join(',');
  let undone = 0;
  for (const op of active) {
    if (Date.now() > until) return {found: active.length, undone, signature, outOfTime: true};
    await assertLease();
    await cave.post(`${base}/undo?int64_as_str=1`, {operation_id: op.operationId});
    undone++;
  }
  return {found: active.length, undone, signature, outOfTime: false};
}

/**
 * Put the cell back to its start: undo what came after the baseline, then
 * check every graph check is in its start state.
 *
 * In passes (2026-10-19): an edit on a piece that no registered spot sits on
 * can be missing from these histories until the edits around it are undone.
 * A tracer's 63 direct edits on the cell were only partly found by a single
 * pass, which left the cell half reset (src/practice.ts found the same for
 * practice cells). A pass that finds the same edits as the one before is the
 * end: those cannot be undone further.
 *
 * Within `budgetMs`: a long history is put back over several calls rather
 * than running into the function's own time limit. `partial` means time ran
 * out with edits left; calling again carries on.
 */
async function putBack(test, checks, cave, assertLease, budgetMs = Infinity) {
  const until = Date.now() + budgetMs;
  let roots = await readRoots(test, checks, cave.get);
  let undone = 0, last = '';
  for (let pass = 0; pass < 12; pass++) {
    const r = await undoPass(test, roots, cave, assertLease, until);
    undone += r.undone;
    if (r.undone) roots = await readRoots(test, checks, cave.get);
    if (r.outOfTime) return {clean: false, partial: true, undone, left: r.found - r.undone, wrong: wrongAtStart(checks, roots), roots};
    if (!r.found || r.signature === last) break;
    last = r.signature;
  }
  const wrong = wrongAtStart(checks, roots);
  return {clean: wrong.length === 0, partial: false, undone, left: 0, wrong, roots};
}

/** How long one start may spend putting the cell back before it hands the
 *  rest to the next call (the function itself stops at 120 s). */
const RESET_BUDGET_MS = 75000;

/** Add the player to each CAVE group the test names. 422 means already a
 *  member, which is as good. */
async function grantGroups(test, who, io) {
  const out = [];
  for (const gid of (Array.isArray(test.cave_groups) ? test.cave_groups : [])) {
    const id = Number(gid);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (who.caveId == null || !Number.isInteger(Number(who.caveId))) { out.push({id, ok: false, error: 'no CAVE user id'}); continue; }
    try {
      const r = await io.fetch(`${AUTH}/group/${id}/user`, {
        method: 'POST', headers: {Authorization: `Bearer ${io.caveToken}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({user_id: Number(who.caveId)}), redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      out.push({id, ok: r.ok || r.status === 422, status: r.status, already: r.status === 422});
    } catch (e) { out.push({id, ok: false, error: String(e && e.message).slice(0, 200)}); }
  }
  return out;
}

async function loadTest(io, id) {
  const rows = await io.sb(`proofreading_tests?id=eq.${id}&select=*&limit=1`);
  if (!rows || !rows[0]) fail(404, 'Test not found');
  return rows[0];
}
async function loadChecks(io, id) {
  const rows = await io.sb(`proofreading_test_checks?test_id=eq.${id}&select=*&order=ordinal`);
  return Array.isArray(rows) ? rows : [];
}

// ─── What the admins see (Admin Hub > Test tries, Ames 2026-10-21) ─────────

/** Admins only. The list is short; emails compare without case. */
async function assertAdmin(io, who) {
  const mine = String((who && who.email) || '').trim().toLowerCase();
  const rows = mine ? await io.sb('admins?select=email') : [];
  if (!(rows || []).some(a => String(a.email || '').trim().toLowerCase() === mine)) fail(403, 'Only admins can see the tries.');
}

/** Write what the admins see of a try (supabase-proofreading-test-tries.sql
 *  adds the columns). Never stands between a player and their result. */
async function keepTry(io, attempt, fields) {
  const n = Number(attempt);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { await io.sb(`proofreading_test_attempts?id=eq.${n}`, {method: 'PATCH', body: JSON.stringify(fields)}); return true; }
  catch (e) { console.warn('[test] try', n, 'was not kept:', e && e.message); return false; }
}

/**
 * The try before this one, when its player went without submitting (the
 * hold ran out with the page closed: Kim, 2026-10-21). Nothing has put the
 * cell back since, so it is still as they left it: its root and each
 * mistake's state are kept on that try before the undo. Not a score, since
 * the branch ends they marked never reached the server. Only when that try
 * was handed a clean cell, so nobody else's edits are counted as theirs.
 */
async function keepUnfinished(io, test, checks, cave, currentAttempt) {
  const rows = await io.sb(`proofreading_test_attempts?test_id=eq.${test.id}&id=neq.${Number(currentAttempt) || 0}&select=id,outcome,started_at,end_root&order=id.desc&limit=1`);
  const last = rows && rows[0];
  if (!last || last.outcome !== 'expired' || last.end_root) return false;
  if (!test.last_reset_at || !last.started_at || Date.parse(test.last_reset_at) < Date.parse(last.started_at)) return false;
  const roots = await readRoots(test, checks, cave.get);
  const results = graphResults(checks, roots, 'end');
  const errors = results.filter(r => ERROR_KINDS.includes(r.kind));
  return keepTry(io, last.id, {end_root: roots[String(test.anchor_supervoxel)] || null, checks: results,
    found: errors.filter(r => r.ok).length, errors: errors.length, damaged: results.filter(r => DAMAGE_KINDS.includes(r.kind) && !r.ok).length});
}

const TRY_COLUMNS = 'id,test_id,started_at,submitted_at,outcome,found,errors,damaged,percent,timed_out,error';
const TRY_KEPT = 'end_root,ends_found,ends_total';
const TRY_PLAYER = 'player:users(username,cave_user_id)';

/** Every try, newest first, and the test as it stands: its key in counts
 *  and who holds the cell. No answers beyond counts. */
async function listTries(io, args) {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(args.limit)) || 100));
  let rows, kept = true;
  try { rows = await io.sb(`proofreading_test_attempts?select=${TRY_COLUMNS},${TRY_KEPT},${TRY_PLAYER}&order=id.desc&limit=${limit}`); }
  catch (e) {
    // Before supabase-proofreading-test-tries.sql: the tries, without their cells.
    kept = false;
    rows = await io.sb(`proofreading_test_attempts?select=${TRY_COLUMNS},${TRY_PLAYER}&order=id.desc&limit=${limit}`);
  }
  const tests = (await io.sb('proofreading_tests?select=id,title,enabled,status,pass_mark,time_limit_minutes,claimed_by,claimed_at,deadline_at&order=created_at.desc')) || [];
  // The line, first in line first (before supabase-proofreading-test.sql adds it: none).
  let line = [];
  try {
    line = ((await io.sb('proofreading_test_queue?select=user_id,test_id,joined_at,called_at,player:users(username)&order=joined_at')) || [])
      .map(({player, ...r}) => ({...r, username: (player && player.username) || null}));
  } catch (e) { line = []; }
  const t = tests.find(x => x.enabled) || tests[0] || null;
  let test = null, key = null;
  if (t) {
    const checks = (await io.sb(`proofreading_test_checks?test_id=eq.${t.id}&select=kind,weight`)) || [];
    const scored = checks.filter(c => ERROR_KINDS.includes(c.kind) || c.kind === 'endpoint');
    key = {mistakes: checks.filter(c => ERROR_KINDS.includes(c.kind)).length, ends: checks.filter(c => c.kind === 'endpoint').length,
      protect: checks.filter(c => DAMAGE_KINDS.includes(c.kind)).length, points: scored.reduce((n, c) => n + (c.weight ?? 1), 0)};
    let holder = null;
    if (t.claimed_by) {
      const u = await io.sb(`users?id=eq.${t.claimed_by}&select=username&limit=1`);
      holder = (u && u[0] && u[0].username) || 'a player';
    }
    test = {id: t.id, title: t.title, enabled: !!t.enabled, status: t.status, pass_mark: t.pass_mark, time_limit_minutes: t.time_limit_minutes,
      holder, claimed_at: t.claimed_at || null, deadline_at: t.deadline_at || null};
  }
  return {kept, test, key, line, tries: (rows || []).map(r => {
    const {player, ...rest} = r;
    return {...rest, username: (player && player.username) || null, cave_user_id: player ? player.cave_user_id ?? null : null};
  })};
}

/** One try in full: each check's result with a place to look, the points
 *  the player placed, and their cell. */
async function oneTry(io, args) {
  const n = Number(args.attempt);
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Unknown try');
  const rows = await io.sb(`proofreading_test_attempts?id=eq.${n}&select=*,${TRY_PLAYER}&limit=1`);
  const a = rows && rows[0];
  if (!a) fail(404, 'That try was not found');
  const test = await loadTest(io, a.test_id);
  const ends = a.endpoints && typeof a.endpoints === 'object' ? a.endpoints : {};
  return {
    id: a.id, test_id: a.test_id, started_at: a.started_at, submitted_at: a.submitted_at, outcome: a.outcome,
    found: a.found, errors: a.errors, damaged: a.damaged, percent: a.percent, timed_out: !!a.timed_out, error: a.error || null,
    username: (a.player && a.player.username) || null, cave_user_id: a.player ? a.player.cave_user_id ?? null : null,
    end_root: a.end_root || null, dataset: test.dataset, state_url: test.state_url,
    checks: (Array.isArray(a.checks) ? a.checks : []).map(c => ({kind: c.kind, label: c.label || '', ok: !!c.ok, weight: c.weight ?? 1,
      point: c.kind === 'endpoint' ? (c.point_a || null) : (c.point_b || c.point_a || null),
      // The heat map: the piece to color, and how near an end a point must be.
      seg: c.seg && SV.test(String(c.seg)) ? String(c.seg) : null,
      ...(c.kind === 'endpoint' ? {radius: Number(c.radius) > 0 ? Number(c.radius) : 1500} : {})})),
    given: Array.isArray(ends.given) ? ends.given.slice(0, 500) : [],
    stray: typeof ends.stray === 'number' ? ends.stray : null,
  };
}

/**
 * One request from the signed in player.
 *   test.status                      the test, their tries, whether they may start
 *   test.start      {id?}            claim the cell, put it back to its start, hand it over
 *   test.heartbeat  {id, session}    keep the hold
 *   test.submit     {id, session, annotations}   score, grant, put back, record
 *   test.abandon    {id, session}    put back, record
 *   test.queueJoin  {id?}            join the line for the cell
 *   test.queueLeave {id?}            leave it
 *   test.queueRemove {user}          admins: take a player out of the line
 *   test.tries      {limit?}         admins: every try, newest first, and the line
 *   test.try        {attempt}        admins: one try in full, with the player's cell
 */
async function handle({action, args, who, me, io}) {
  if (!who || !me || !me.id) fail(401, 'Sign in and create your Pyr profile first.');
  args = args || {};
  const rpc = (a, extra) => io.rpc(a, extra || {});
  const idOf = v => { const s = String(v || ''); if (!UUID.test(s)) fail(400, 'Unknown test'); return s; };
  const sessionOf = v => { const s = String(v || ''); if (!UUID.test(s)) fail(400, 'Unknown test session'); return s; };

  if (action === 'test.status') return rpc('status', args.id ? {id: idOf(args.id)} : {});

  // Admins (Admin Hub > Test tries, Ames 2026-10-21): every try, and one try
  // in full with the player's cell as they left it.
  if (action === 'test.tries') { await assertAdmin(io, who); return listTries(io, args); }
  if (action === 'test.try') { await assertAdmin(io, who); return oneTry(io, args); }

  // The line (Ames, 2026-10-21): the rules are in the database function.
  if (action === 'test.queueJoin') return rpc('queue_join', args.id ? {id: idOf(args.id)} : {});
  if (action === 'test.queueLeave') return rpc('queue_leave', args.id ? {id: idOf(args.id)} : {});
  if (action === 'test.queueRemove') {
    await assertAdmin(io, who);
    const user = String(args.user || '');
    if (!UUID.test(user)) fail(400, 'Unknown player');
    return rpc('queue_remove', {user});
  }

  if (action === 'test.start') {
    const claim = await rpc('claim', args.id ? {id: idOf(args.id)} : {});
    if (!claim || !claim.test) fail(409, 'There is no test to take right now');
    const id = claim.test.id, session = claim.session;
    const [full, checks] = await Promise.all([loadTest(io, id), loadChecks(io, id)]);
    if (!checks.length) {
      await rpc('record', {id, session, outcome: 'error', clean: true, error: 'no checks registered'}).catch(() => {});
      fail(503, 'This test has nothing to check yet.');
    }
    // The cell's root as it is now: the saved view names the root it had at
    // registration, which a resumed session's own edits have replaced.
    let root = null, deadline = claim.deadline_at || null;
    // Put back under this claim already (a reload mid test): the player's
    // own edits stay. Otherwise whatever was done since the baseline comes
    // off before the cell is shown, carrying on from an earlier call that
    // ran out of time.
    const cleanedForThisClaim = !!(full.last_reset_at && full.claimed_at && Date.parse(full.last_reset_at) >= Date.parse(full.claimed_at));
    if (!claim.resumed || !cleanedForThisClaim) {
      const cave = caveClient(io);
      try { await keepUnfinished(io, full, checks, cave, claim.attempt); }
      catch (e) { console.warn('[test] the last unfinished try was not kept:', e && e.message); }
      let put;
      try { put = await putBack(full, checks, cave, () => rpc('heartbeat', {id, session}), io.resetBudgetMs ?? RESET_BUDGET_MS); }
      catch (e) {
        await rpc('record', {id, session, outcome: 'error', clean: false, error: String(e && e.message).slice(0, 300)}).catch(() => {});
        fail(503, 'The test cell could not be put back to its start. Try again in a few minutes.');
      }
      // Out of time with edits left: the claim stays, and the page calls
      // again to carry on.
      if (put.partial) return {resetting: true, left: put.left, undone: put.undone, test: claim.test, session, attempt: claim.attempt};
      if (!put.clean) {
        await rpc('record', {id, session, outcome: 'error', clean: false, error: 'Not at its start after the undo: ' + put.wrong.join('; ').slice(0, 300)}).catch(() => {});
        fail(503, 'The test cell is not in its starting state. An admin has been told; try again later.');
      }
      // Always marked, so a reload knows the cell was put back under this
      // claim. The clock starts here, when the cell is handed over.
      const cleaned = await rpc('cleaned', {id, session});
      if (cleaned && cleaned.deadline_at) deadline = cleaned.deadline_at;
      root = put.roots[full.anchor_supervoxel] || null;
    } else {
      try { root = await rootOf(caveClient(io).get, pcgBase(full), full.anchor_supervoxel); } catch (e) { root = null; }
    }
    return {test: claim.test, session, attempt: claim.attempt, resumed: !!claim.resumed, root,
      // When the time limit on this try runs out (null: no limit).
      deadline,
      // Things to fix are the cuts and merges; a keep or apart check is
      // something not to break, and is not counted for the player.
      checks: checks.filter(c => ERROR_KINDS.includes(c.kind)).length, endpoints: checks.filter(c => c.kind === 'endpoint').length};
  }

  const id = idOf(args.id), session = sessionOf(args.session);
  if (action === 'test.heartbeat') return rpc('heartbeat', {id, session});

  if (action === 'test.submit' || action === 'test.abandon') {
    // The hold must still be theirs.
    try { await rpc('heartbeat', {id, session}); }
    catch (e) { if (action === 'test.abandon') return {ended: true}; throw e; }
    const [full, checks] = await Promise.all([loadTest(io, id), loadChecks(io, id)]);
    const cave = caveClient(io);
    const lease = () => rpc('heartbeat', {id, session});
    let decision = null, results = [], granted = null, endpoints = null, endRoot = null;
    // Scored after the time limit: the player's page submits by itself when
    // the clock reaches zero, and the database allows a short grace for it.
    const timedOut = !!full.deadline_at && Date.now() >= Date.parse(full.deadline_at);
    if (action === 'test.submit') {
      const roots = await readRoots(full, checks, cave.get);
      endRoot = roots[String(full.anchor_supervoxel)] || null;
      const annotations = cleanAnnotations(args.annotations);
      const ends = endpointResults(checks, annotations);
      results = [...graphResults(checks, roots, 'end'), ...ends.results];
      decision = decide(full, results, ends.stray);
      endpoints = {given: annotations, hit: ends.results.filter(r => r.ok).length, stray: ends.stray};
      if (decision.passed) granted = {pilot: !!full.grant_pilot, groups: await grantGroups(full, who, io)};
    }
    // The cell goes back for the next player, whatever happened.
    let clean = false, error = null;
    try {
      const put = await putBack(full, checks, cave, lease);
      clean = put.clean;
      if (!clean) error = 'Not at its start after the undo: ' + put.wrong.join('; ');
    } catch (e) { error = String(e && e.message).slice(0, 300); }
    const recorded = await rpc('record', decision
      ? {id, session, outcome: decision.passed ? 'pass' : 'fail', found: decision.found, errors: decision.errors, damaged: decision.damaged,
        percent: decision.percent, checks: results, endpoints, granted, clean, error, timed_out: timedOut}
      : {id, session, outcome: 'abandoned', clean, error});
    // The player's cell as they left it, for the admins: a root id names
    // that set of supervoxels for good, after the undos too.
    if (decision) await keepTry(io, recorded && recorded.attempt, {end_root: endRoot, ends_found: decision.endpointsFound, ends_total: decision.endpoints});
    if (decision && decision.passed) { try { if (io.onGranted) io.onGranted(); } catch (e) { /* the cache clears itself in time */ } }
    // A notice to the admins never stands between a player and their result.
    if (decision && io.notifyAdmins) { try { await io.notifyAdmins(adminNote(me, decision, timedOut)); } catch (e) { console.warn('[test] the admins were not told:', e && e.message); } }
    return decision ? {...feedback(full, decision, results, granted), timedOut} : {ended: true, clean};
  }
  fail(400, 'Unknown test action');
}

module.exports = {handle, keepUnfinished, listTries, oneTry, adminNote, decide, feedback, graphResults, endpointResults, cleanAnnotations, wrongAtStart, readRoots, putBack, undoPass, grantGroups, RESET_BUDGET_MS, EXPECT};
