'use strict';
// Cell match (Ames, 2026-11-12): while a player proofreads a Sandbox Cell
// Library cell, how close their cell is to the finished one.
//
// The Sandbox (pinky_nf_v2) and pinky_training are two chunkedgraphs over the
// SAME supervoxels (both read gs://pcg_ws/pinky100_v0/ws/pinky100_ca_com), so a
// supervoxel id is the same piece of tissue in each. A Cell Library task from
// the soma list keeps the supervoxel at its soma; the cell that owns it in
// pinky_training (as of TRUTH.at) is the true cell, the one that owns it in
// the Sandbox is the player's.
//
// Two numbers (Ames 2026-11-12: "one category for cut and one for merge", by
// size), each the share of its own starting error that is fixed, counted in
// supervoxels, never below 0:
//   merge = 1 - missing now / missing at start
//   cut   = 1 - extra now / extra at start
// A cell with nothing extra at the start has nothing to cut (null) until a
// merge brings in a wrong part, then cut reads 0. One number for both,
//   match = 1 - (missing now + extra now) / (missing at start + extra at start),
// is still kept with each score. The match score the player sees (Ames
// 2026-11-13: "Match Score", accuracy only) is how much the two cells match,
// by size: the part they share over everything in either one,
//   score = (true cell - missing now) / (true cell + extra now),
// so it starts where the cell starts and reads 100 when they are the same.
// Beside each, pieces: a missing piece is a Sandbox segment at the
// task's start that belongs to the true cell (MIN_PIECE supervoxels or more);
// an extra piece is a part of the start cell that belongs to another true cell.
// Each piece keeps a few sample supervoxels; a missing piece is found when
// FOUND_SHARE of them are in the player's cell, an extra one removed when
// FOUND_SHARE of them are out.
//
// The key (true cell, start cell, pieces) is built on the first check of a
// cell and kept in sandbox_match_keys (supabase-sandbox-match.sql), which only
// the service role reads: it is an answer key. Served by its own function,
// ewSandboxMatch, never by ewSecureWrite (other checkouts redeploy that one).
//
// Everything outside this process goes through `io`, so the tests use fakes:
//   io.fetch      fetch
//   io.caveToken  a CAVE token that reads both chunkedgraphs
//   io.sb(path, init)  Supabase REST as the service role
//   io.now()      Date.now (optional)

const SANDBOX = {server: 'https://minnie.microns-daf.com', table: 'pinky_nf_v2'};
/** The true cells, frozen at this time so later edits to pinky_training do not
 *  move anyone's score. Bump it (and KEY_VERSION) to take in newer truth. */
const TRUTH = {server: 'https://minnie.microns-daf.com', table: 'pinky_training', at: '2026-11-12T18:00:00Z'};
const KEY_VERSION = '2026-11-12-1';
const DATASET = 'pinky_nf_v2';
const MIN_PIECE = 50;
const SAMPLES = 5;
const FOUND_SHARE = 0.8;
const ROOTS_BATCH = 50000;
const SV = /^\d{1,20}$/;
/** Where a Sandbox supervoxel is, from its id (pinky_nf_v2's graph info: 8 bits
 *  of layer, then 10 bits each of chunk x, y, z; chunks of 512 x 512 x 128
 *  voxels at 8 x 8 x 40 nm from voxel 18096, 15279, 21). The middle of its
 *  chunk, in nm: within about 2 um across and 2.5 um deep of the supervoxel. */
const CHUNK = {bits: 10, size: [512, 512, 128], offset: [18096, 15279, 21], nm: [8, 8, 40]};
function svPointNm(sv) {
  const id = BigInt(sv);
  const at = i => Number((id >> BigInt(64 - 8 - CHUNK.bits * (i + 1))) & BigInt((1 << CHUNK.bits) - 1));
  return [0, 1, 2].map(i => (at(i) * CHUNK.size[i] + CHUNK.size[i] / 2 + CHUNK.offset[i]) * CHUNK.nm[i]);
}
const REVIEW_MAX = 30;

const contact = require('./sandbox-contact');
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

// ── Sets of supervoxels: sorted BigUint64Arrays ────────────────────────────

/** Ids (strings, numbers that came as strings, or bigints) as a sorted, unique set. */
function toSet(ids) {
  const a = new BigUint64Array(ids.length);
  for (let i = 0; i < ids.length; i++) a[i] = BigInt(ids[i]);
  a.sort();
  let n = 0;
  for (let i = 0; i < a.length; i++) if (i === 0 || a[i] !== a[i - 1]) a[n++] = a[i];
  return n === a.length ? a : a.slice(0, n);
}

/** The members of sorted set a that are not in sorted set b. */
function minus(a, b) {
  const out = [];
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    while (j < b.length && b[j] < a[i]) j++;
    if (j >= b.length || b[j] !== a[i]) out.push(a[i]);
  }
  return BigUint64Array.from(out);
}

/** How many members of sorted set a are not in sorted set b. */
function countMinus(a, b) {
  let n = 0, j = 0;
  for (let i = 0; i < a.length; i++) {
    while (j < b.length && b[j] < a[i]) j++;
    if (j >= b.length || b[j] !== a[i]) n++;
  }
  return n;
}

// ── Scoring rules (pure) ───────────────────────────────────────────────────

/** Whole percent of the starting error that is fixed; null when the cell
 *  started with no error at all (nothing to measure). */
function matchPercent({missingNow, extraNow, missingStart, extraStart}) {
  const start = missingStart + extraStart;
  if (!(start > 0)) return null;
  const share = 1 - (missingNow + extraNow) / start;
  return Math.max(0, Math.min(100, Math.floor(share * 100 + 1e-9)));
}

/** The match score: whole percent of the true cell and the player's cell that
 *  they share (shared over the two together), 0 to 100, rounded down. */
function scorePercent({truthSize, missingNow, extraNow}) {
  const all = truthSize + extraNow;
  if (!(all > 0)) return null;
  const share = (truthSize - missingNow) / all;
  return Math.max(0, Math.min(100, Math.floor(share * 100 + 1e-9)));
}

/** One category, merge or cut: whole percent of its starting error fixed.
 *  Nothing wrong at the start: null while it stays so, 0 once something is. */
function partPercent(now, start) {
  if (!(start > 0)) return now > 0 ? 0 : null;
  return Math.max(0, Math.min(100, Math.floor((1 - now / start) * 100 + 1e-9)));
}

/** A deterministic random, so a key built twice samples the same supervoxels. */
function seeded(seed) {
  let s = (Number(BigInt(seed) % 2147483646n) || 1);
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Group supervoxels by the segment each belonged to; keep pieces of at
 *  least `min` supervoxels, biggest first, each with `samples` sample ids. */
function groupPieces(svs, roots, {min = MIN_PIECE, samples = SAMPLES, seed = 1} = {}) {
  const by = new Map();
  for (let i = 0; i < svs.length; i++) {
    const r = String(roots[i]);
    if (r === '0') continue;
    let p = by.get(r);
    if (!p) by.set(r, p = []);
    p.push(svs[i]);
  }
  const rand = seeded(seed);
  const pieces = [];
  for (const [root, list] of by) {
    if (list.length < min) continue;
    const pick = new Set();
    while (pick.size < Math.min(samples, list.length)) pick.add(Math.floor(rand() * list.length));
    pieces.push({root, size: list.length, samples: [...pick].sort((a, b) => a - b).map(i => String(list[i]))});
  }
  return pieces.sort((a, b) => b.size - a.size || (a.root < b.root ? -1 : 1));
}

/** How many pieces are still wrong, given each sample's current root.
 *  missing: wrong while fewer than FOUND_SHARE of its samples are in the cell.
 *  extra:   wrong while fewer than FOUND_SHARE of its samples are out of it. */
function piecesLeft(pieces, rootOf, cellRoot, kind) {
  let left = 0;
  for (const p of pieces || []) {
    const n = p.samples.length;
    if (!n) continue;
    const inside = p.samples.filter(sv => rootOf[sv] === cellRoot).length;
    const done = kind === 'missing' ? inside / n >= FOUND_SHARE : (n - inside) / n >= FOUND_SHARE;
    if (!done) left++;
  }
  return left;
}

// ── The chunkedgraph ───────────────────────────────────────────────────────

const base = g => `${g.server}/segmentation/api/v1/table/${g.table}`;
const tsParam = at => at == null ? '' : `&timestamp=${encodeURIComponent((new Date(at).getTime() / 1000).toFixed(3))}`;

function cave(io) {
  const call = async (url, init = {}, ms = 60000) => {
    const r = await io.fetch(url, {
      ...init,
      headers: {Authorization: `Bearer ${io.caveToken}`, ...(init.headers || {})},
      redirect: 'error', signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) throw new Error(`CAVE answered ${r.status} for ${url.split('?')[0].split('/').slice(-2).join('/')}`);
    return r;
  };
  return {
    /** The root owning one supervoxel, at a time (null = now). */
    async root(g, sv, at = null) {
      const d = await (await call(`${base(g)}/node/${sv}/root?int64_as_str=1${tsParam(at)}`, {}, 20000)).json();
      const root = String(d && d.root_id);
      if (!SV.test(root)) throw new Error('Invalid CAVE root response');
      return root;
    },
    /** Every supervoxel of a root, as a sorted set. A root's leaves never change. */
    async leaves(g, root) {
      const d = await (await call(`${base(g)}/node/${root}/leaves?int64_as_str=1`)).json();
      if (!d || !Array.isArray(d.leaf_ids)) throw new Error('Invalid CAVE leaves response');
      return toSet(d.leaf_ids);
    },
    /** The root of each supervoxel, at a time (null = now), in order. */
    async roots(g, svs, at = null) {
      const out = new Array(svs.length);
      const batches = [];
      for (let i = 0; i < svs.length; i += ROOTS_BATCH) batches.push(i);
      // Three requests at a time.
      for (let k = 0; k < batches.length; k += 3) {
        await Promise.all(batches.slice(k, k + 3).map(async start => {
          const part = svs.slice(start, start + ROOTS_BATCH);
          const body = Buffer.alloc(part.length * 8);
          part.forEach((sv, i) => body.writeBigUInt64LE(BigInt(sv), i * 8));
          const r = await call(`${base(g)}/roots_binary?${tsParam(at).slice(1)}`, {
            method: 'POST', body, headers: {'Content-Type': 'application/octet-stream'},
          });
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length !== part.length * 8) throw new Error('Invalid CAVE roots response');
          for (let i = 0; i < part.length; i++) out[start + i] = buf.readBigUInt64LE(i * 8).toString();
        }));
      }
      return out;
    },
  };
}

// ── Memory between calls (one function instance) ─────────────────────────

/** Small LRU: a cell's supervoxels are about 6 MB. */
function lru(limit) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > limit) m.delete(m.keys().next().value); },
    clear() { m.clear(); },
  };
}
const truthSets = lru(8);
const lastResult = lru(200);
const building = new Map();

// ── Keys ───────────────────────────────────────────────────────────────────

async function loadTask(io, taskId) {
  const rows = await io.sb(`proofreading_tasks?id=eq.${taskId}&select=id,dataset,supervoxel_id,created_at,assigned_to,status&limit=1`);
  const t = rows && rows[0];
  if (!t) fail(404, 'That cell is not in the Cell Library.');
  if (t.dataset !== DATASET) fail(400, 'Cell match is only on Sandbox cells.');
  return t;
}

/** Build a cell's key from the two chunkedgraphs. Reads only. */
async function buildKey(io, task) {
  const sv = String(task.supervoxel_id || '');
  if (!SV.test(sv)) return {task_id: task.id, version: KEY_VERSION, truth_at: TRUTH.at, scorable: false, reason: 'no soma supervoxel'};
  const cg = cave(io);
  const startAt = task.created_at;
  const [startRoot, truthRoot] = await Promise.all([cg.root(SANDBOX, sv, startAt), cg.root(TRUTH, sv, TRUTH.at)]);
  const [start, truth] = await Promise.all([cg.leaves(SANDBOX, startRoot), cg.leaves(TRUTH, truthRoot)]);
  truthSets.set(truthRoot, truth);
  const missing = minus(truth, start);
  const extra = minus(start, truth);
  const [missingRoots, extraRoots] = await Promise.all([
    missing.length ? cg.roots(SANDBOX, missing, startAt) : [],
    extra.length ? cg.roots(TRUTH, extra, TRUTH.at) : [],
  ]);
  const missingPieces = groupPieces(missing, missingRoots, {seed: sv});
  // The player's own cell is never an extra piece of itself.
  const extraPieces = groupPieces(extra, extraRoots, {seed: sv}).filter(p => p.root !== truthRoot);
  return {
    task_id: task.id, version: KEY_VERSION, truth_at: TRUTH.at, start_at: startAt,
    start_root: startRoot, truth_root: truthRoot, truth_size: truth.length,
    missing_start: missing.length, extra_start: extra.length,
    missing_pieces: missingPieces, extra_pieces: extraPieces,
    scorable: missing.length + extra.length > 0,
    reason: missing.length + extra.length > 0 ? null : 'no difference from the true cell',
  };
}

/** The saved key, or a new one when there is none or it is from older truth. */
async function keyFor(io, task) {
  // A database that cannot be read (the SQL not run yet) only costs a rebuild.
  const rows = await io.sb(`sandbox_match_keys?task_id=eq.${task.id}&select=*&limit=1`).catch(() => null);
  const saved = rows && rows[0];
  if (saved && saved.version === KEY_VERSION) return saved;
  if (building.has(task.id)) return building.get(task.id);
  const p = (async () => {
    const key = await buildKey(io, task);
    await io.sb('sandbox_match_keys?on_conflict=task_id', {
      method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
      body: JSON.stringify({...key, built_at: new Date((io.now || Date.now)()).toISOString()}),
    }).catch(e => console.warn('[sandbox-match] key not saved', task.id, e.message));
    return key;
  })();
  building.set(task.id, p);
  try { return await p; } finally { building.delete(task.id); }
}

// ── The check ──────────────────────────────────────────────────────────────

/** Score the cell of one Sandbox task as it is now. */
async function check(io, {taskId, me, isAdmin}) {
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) fail(400, 'Which cell?');
  if (!me) fail(403, 'Sign in to Pyr to see your cell match.');
  const task = await loadTask(io, id);
  if (task.assigned_to !== me.id && !isAdmin) fail(403, 'Cell match is shown on your own claimed cells.');
  const key = await keyFor(io, task);
  if (!key.scorable) return {taskId: id, scorable: false};
  const cg = cave(io);
  const root = await cg.root(SANDBOX, String(task.supervoxel_id));
  const memo = `${id}:${root}`;
  let result = lastResult.get(memo);
  if (!result) {
    let truth = truthSets.get(key.truth_root);
    if (!truth) { truth = await cg.leaves(TRUTH, key.truth_root); truthSets.set(key.truth_root, truth); }
    const cell = await cg.leaves(SANDBOX, root);
    const missingNow = countMinus(truth, cell);
    const extraNow = countMinus(cell, truth);
    const samples = [...new Set([...key.missing_pieces, ...key.extra_pieces].flatMap(p => p.samples))];
    const got = samples.length ? await cg.roots(SANDBOX, samples) : [];
    const rootOf = Object.fromEntries(samples.map((sv, i) => [sv, got[i]]));
    result = {
      taskId: id, scorable: true, root,
      match: matchPercent({missingNow, extraNow, missingStart: key.missing_start, extraStart: key.extra_start}),
      score: scorePercent({truthSize: truth.length, missingNow, extraNow}),
      // Where the cell started (Ames 2026-11-13: "how much have I done?").
      startScore: scorePercent({truthSize: truth.length, missingNow: key.missing_start, extraNow: key.extra_start}),
      merge: partPercent(missingNow, key.missing_start),
      cut: partPercent(extraNow, key.extra_start),
      missing: {left: piecesLeft(key.missing_pieces, rootOf, root, 'missing'), total: key.missing_pieces.length},
      extra: {left: piecesLeft(key.extra_pieces, rootOf, root, 'extra'), total: key.extra_pieces.length},
    };
    lastResult.set(memo, result);
  }
  // The player's merges and cuts on this cell, from the edit log.
  const edits = await countEdits(io, id, me.id).catch(e => { console.warn('[sandbox-match] no edit count', id, e.message); return null; });
  result = {...result, edits};
  // Keeping the score never stands between the player and their number.
  await io.sb('rpc/sandbox_match_record', {method: 'POST', body: JSON.stringify({
    p_user: me.id, p_task: id, p_match: result.match, p_root: root,
    p_missing_left: result.missing.left, p_missing_total: result.missing.total,
    p_extra_left: result.extra.left, p_extra_total: result.extra.total,
  })}).catch(e => console.warn('[sandbox-match] score not kept', id, e.message));
  return result;
}

/** How many merges and cuts this player made on this cell. */
// Most edits are logged with no task (Ames 2026-11-14, "0 edits" after a good
// cut): the game sets the task only at the moment of claiming, so an edit on a
// claim taken up again (a reload, Play into it) has none. So an edit counts if
// it names this task, or names none and is the player's own Sandbox edit made
// while they held this claim.
async function countEdits(io, taskId, userId) {
  const uid = encodeURIComponent(userId);
  const held = await io.sb(`task_assignments?task_id=eq.${taskId}&user_id=eq.${uid}&select=claimed_at,completed_at,released_at&order=claimed_at.desc&limit=1`);
  const a = Array.isArray(held) ? held[0] : null;
  const q = (t) => encodeURIComponent(t);
  let match;
  if (a && a.claimed_at) {
    const end = a.completed_at || a.released_at;
    match = `or=(task_id.eq.${taskId},and(task_id.is.null,timestamp.gte.${q(a.claimed_at)}${end ? `,timestamp.lte.${q(end)}` : ''}))`;
  } else match = `task_id=eq.${taskId}`;
  const rows = await io.sb(`edit_log?${match}&user_id=eq.${uid}&dataset=eq.pinky_nf_v2&operation=in.(merge,split)&success=eq.true&select=id`);
  return Array.isArray(rows) ? rows.length : null;
}

/** After Complete (Ames 2026-11-12: "show me what I missed"): the check, plus
 *  every piece still wrong. A missed piece is the Sandbox segment it is in now
 *  (drawn on its own); a merger still attached is a point near it (it is part
 *  of the player's cell, so it has no segment of its own). Biggest first. */
async function review(io, {taskId, me, isAdmin, withSamples = false}) {
  const result = await check(io, {taskId, me, isAdmin});
  if (!result.scorable) return result;
  const key = await keyFor(io, await loadTask(io, Number(taskId)));
  const cell = result.root;
  const samples = [...new Set([...key.missing_pieces, ...key.extra_pieces].flatMap(p => p.samples))];
  const got = samples.length ? await cave(io).roots(SANDBOX, samples) : [];
  const rootOf = Object.fromEntries(samples.map((sv, i) => [sv, got[i]]));
  const missed = [];
  for (const p of key.missing_pieces) {
    if (piecesLeft([p], rootOf, cell, 'missing') === 0) continue;
    const outside = p.samples.filter(sv => rootOf[sv] !== cell && rootOf[sv] !== '0');
    if (!outside.length) continue;
    const count = {};
    for (const sv of outside) count[rootOf[sv]] = (count[rootOf[sv]] || 0) + 1;
    const root = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    missed.push({root, size: p.size, pointNm: svPointNm(outside.find(sv => rootOf[sv] === root)), ...(withSamples ? {samples: outside} : {})});
  }
  const mergers = [];
  for (const p of key.extra_pieces) {
    if (piecesLeft([p], rootOf, cell, 'extra') === 0) continue;
    const inside = p.samples.find(sv => rootOf[sv] === cell);
    if (inside) mergers.push({size: p.size, pointNm: svPointNm(inside), ...(withSamples ? {samples: p.samples.filter(sv => rootOf[sv] === cell)} : {})});
  }
  return {...result, missed: missed.slice(0, REVIEW_MAX), mergers: mergers.slice(0, REVIEW_MAX)};
}

/** The chunk a supervoxel is in: its place to about 4 µm, from its id alone. */
const chunkOf = (sv) => BigInt(sv) >> BigInt(64 - 8 - 3 * CHUNK.bits);
/** The chunk of `places` nearest any chunk of `from`, as a point in nm: where
 *  a piece meets the cell, to the size of a chunk. */
function nearestChunkNm(from, places) {
  const mine = new Map();
  for (const sv of places) { const c = chunkOf(sv); if (!mine.has(c)) mine.set(c, sv); }
  const theirs = [...new Set([...from].map(chunkOf))];
  let best = null, bestD = Infinity;
  for (const [, sv] of mine) {
    const a = svPointNm(sv);
    for (const c of theirs) {
      const b = svPointNm(c << BigInt(64 - 8 - 3 * CHUNK.bits));
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
  }
  return best;
}

/** Hint (Ames 2026-11-14: "add a hint that jumps me to the next spot"; then
 *  "it should take you to the spot of where the next issue originated, like
 *  the end of the branch, not immediately reveal the piece... If from there I
 *  still can't find it, it could then offer the branch"). Pieces still wrong,
 *  biggest first; the nth hint is about the nth piece. Step 1 gives only the
 *  place on the player's own cell where the trouble starts (a missing
 *  branch's end, or where a wrong part joins), to the size of a chunk. Step 2
 *  shows the piece itself. Each hint is recorded with its step. */
async function hint(io, {taskId, me, isAdmin, n, step, idleSecs}) {
  const r = await review(io, {taskId, me, isAdmin, withSamples: true});
  if (!r.scorable) return {taskId: r.taskId, scorable: false};
  const all = [
    ...(r.missed || []).map(p => ({kind: 'merge', root: p.root, size: p.size, pointNm: p.pointNm, samples: p.samples})),
    ...(r.mergers || []).map(p => ({kind: 'cut', size: p.size, pointNm: p.pointNm, samples: p.samples})),
  ].filter(p => p.pointNm).sort((a, b) => b.size - a.size);
  const i = all.length ? (Math.max(0, Math.floor(Number(n) || 0)) % all.length) : -1;
  const reveal = Number(step) === 2;
  let piece = null;
  if (i >= 0) {
    const p = all[i];
    // Where it meets the player's cell, to the voxel (Ames 2026-11-14: the
    // pin sat "in empty space on the wrong cell"). A missing branch meets
    // the cell the player has; a wrong part meets the true part of the cell.
    let at = null;
    try {
      const cg = cave(io);
      const key = await keyFor(io, await loadTask(io, Number(taskId)));
      let truth = truthSets.get(key.truth_root);
      if (!truth) { truth = await cg.leaves(TRUTH, key.truth_root); truthSets.set(key.truth_root, truth); }
      const cell = await cg.leaves(SANDBOX, r.root);
      if (p.kind === 'merge') at = await contact.meetingNm({fetchImpl: io.fetch, cell, piece: minus(truth, cell), near: p.samples || []});
      else {
        const wrong = minus(cell, truth);
        at = await contact.meetingNm({fetchImpl: io.fetch, cell: minus(cell, wrong), piece: wrong, near: p.samples || []});
      }
    } catch (e) { console.warn('[sandbox-match] hint place', e.message); }
    if (reveal) piece = {kind: p.kind, size: p.size, pointNm: at || p.pointNm, ...(p.root ? {root: p.root} : {})};
    else piece = {kind: p.kind, size: p.size, nearNm: at || p.pointNm};
  }
  await record(io, {taskId: r.taskId, me, kind: 'hint', idleSecs, score: r.score,
    detail: piece ? {n: i, step: reveal ? 2 : 1, kind: piece.kind, size: piece.size, left: all.length} : {left: 0}}).catch(() => {});
  return {taskId: r.taskId, scorable: true, left: all.length, n: i, step: reveal ? 2 : 1, piece};
}

const EVENT_KINDS = new Set(['opened', 'hint_offered', 'complete', 'skip']);
/** A moment on a Sandbox cell (opened, Hint offered, Complete, Skip), for the lab. */
async function event(io, {taskId, me, isAdmin, kind, idleSecs, score}) {
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) fail(400, 'Which cell?');
  if (!me) fail(403, 'Sign in first.');
  if (!EVENT_KINDS.has(kind)) fail(400, 'Unknown moment.');
  const task = await loadTask(io, id);
  if (task.assigned_to !== me.id && !isAdmin) fail(403, 'Only on your own claimed cells.');
  await record(io, {taskId: id, me, kind, idleSecs, score});
  return {ok: true};
}

async function record(io, {taskId, me, kind, idleSecs, score, detail}) {
  const n = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : null);
  await io.sb('sandbox_play_events', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify({
    user_id: me.id, task_id: Number(taskId), kind, idle_secs: n(idleSecs, 86400 * 7), score: n(score, 100), detail: detail || {},
  })});
}

async function handle({action, args, me, isAdmin, io}) {
  if (action === 'match.check') return check(io, {taskId: args && args.taskId, me, isAdmin});
  if (action === 'match.review') return review(io, {taskId: args && args.taskId, me, isAdmin});
  if (action === 'match.hint') return hint(io, {taskId: args && args.taskId, me, isAdmin, n: args && args.n, step: args && args.step, idleSecs: args && args.idleSecs});
  if (action === 'match.event') return event(io, {taskId: args && args.taskId, me, isAdmin, kind: args && args.kind, idleSecs: args && args.idleSecs, score: args && args.score});
  fail(400, `unknown action ${action}`);
}

module.exports = {
  handle, check, review, hint, event, nearestChunkNm, buildKey, keyFor, svPointNm,
  toSet, minus, countMinus, matchPercent, scorePercent, partPercent, groupPieces, piecesLeft, cave,
  _reset() { truthSets.clear(); lastResult.clear(); building.clear(); },
  SANDBOX, TRUTH, KEY_VERSION, MIN_PIECE, SAMPLES, FOUND_SHARE,
};
