'use strict';
/**
 * The Hunt (Ames 2026-10-20): a timed event in Pyr. Players search a cell,
 * or several, for mergers, put a point on each one they find, and submit.
 * An admin marks the mergers once, in an ordinary annotation layer, and the
 * game reads them from that view as the answer key. The key stays on the
 * server: a player learns how many of their points found a merger (and how
 * many are close), never which. When the hunt ends the best hunters get
 * gold, silver and bronze special Achievements, made for that hunt.
 *
 * A hunt is a draft until an admin schedules it. Scheduling writes three
 * notifications with future send times (the bell shows a row only once its
 * send time has come, so the announcement, the start and the end arrive on
 * their own); an admin can also announce, start or end it at once. Awards
 * are given once, by whichever request first sees the hunt has ended.
 *
 * Every rule is here and tested (hunts.test.js). functions/index.js only
 * wires the ewHunt function to the database, the bell and chat.
 * Tables: supabase-hunts.sql (server only, no policies for the browser).
 */

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

const TIERS = ['gold', 'silver', 'bronze'];
const TIER_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', fastest: 'Fastest' };
const DEFAULT_TOLERANCE_NM = 3000;
const DEFAULT_MAX_SUBMISSIONS = 10;
const MIN_POINTS = 10;
const MAX_TARGETS = 200;
const MAX_CELLS = 20;
const SHOW_ENDED_DAYS = 7;
const DEFAULT_RESULTS_HOURS = 24;   // "Hunt results" in the top bar this long after the end
/** Players may see the answers once the Hunt is over, unless the Hunt keeps them (its cells are for another Hunt). */
const answersOpen = (h) => !(h && h.tiers && h.tiers.hide_answers);
const resultsHours = (h) => { const v = posIntOf(h && h.tiers && h.tiers.results_hours); return v ? Math.min(v, SHOW_ENDED_DAYS * 24) : DEFAULT_RESULTS_HOURS; };
function posIntOf(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; }
const MAX_VIEW_BYTES = 150000;
const TITLE_PREFIX = '🔎 The Hunt';

/**
 * Until The Hunt is launched in the live game, every Hunt is admins only, whatever its own
 * setting says: players never see it, and no note or results post reaches them or chat.
 * (2026-10-22: the first "test" Hunt, made before test-site Hunts were forced admins only,
 * posted its results to every player's chat; Ames: "players are still getting these".)
 * Launched 2026-10-26: functions/index.js passes huntPublic: true.
 */
const adminsOnly = (h, ctx) => !(ctx && ctx.huntPublic === true) || !!(h && h.admins_only);
const DAY = 86400000;

// ── Points, in nanometres ─────────────────────────────────────────────────

/** Each axis of a neuroglancer coordinate space, as nanometres per unit. */
function axisScales(dims) {
  if (!dims || typeof dims !== 'object' || Array.isArray(dims)) fail(400, 'The view has no dimensions.');
  const names = Object.keys(dims);
  if (names.length < 3) fail(400, 'The view needs x, y and z.');
  return names.map((name) => {
    const d = dims[name];
    const scale = Array.isArray(d) ? Number(d[0]) : NaN;
    if (!(scale > 0) || !Array.isArray(d) || String(d[1]) !== 'm') fail(400, `The view's ${name} axis is not in metres.`);
    return { name, nmPer: scale * 1e9 };
  });
}

/** True when a neuroglancer transform matrix leaves points where they are. */
function isIdentity(matrix) {
  if (!Array.isArray(matrix)) return true;
  return matrix.every((row, i) => Array.isArray(row) && row.every((v, j) => Number(v) === (i === j ? 1 : 0)));
}

/**
 * The point annotations of one annotation layer, as [x, y, z] in nanometres.
 * A layer's points are in its own source's output dimensions when the source
 * names them (a link made elsewhere often does), else in the view's.
 * Lines, boxes and the rest are not points and are left out.
 */
function layerPoints(layer, dims) {
  if (!layer || typeof layer !== 'object') fail(400, 'No annotation layer was sent.');
  let src = layer.source;
  if (Array.isArray(src)) src = src[0];
  const t = src && typeof src === 'object' ? src.transform : null;
  if (t && !isIdentity(t.matrix)) fail(400, 'This layer is moved by a transform. Mark the places in a plain annotation layer.');
  const axes = axisScales((t && t.outputDimensions) || dims);
  let ix = ['x', 'y', 'z'].map((n) => axes.findIndex((a) => a.name === n));
  if (ix.some((i) => i < 0)) ix = [0, 1, 2];
  const out = [];
  for (const a of Array.isArray(layer.annotations) ? layer.annotations : []) {
    if (!a || a.type !== 'point' || !Array.isArray(a.point)) continue;
    const p = ix.map((i) => Number(a.point[i]) * axes[i].nmPer);
    if (!p.every(Number.isFinite)) continue;
    // `at` is the point as the layer holds it, so the game can put the gem back where it was.
    out.push({ id: String(a.id || '').slice(0, 80), nm: p.map((v) => Math.round(v)), at: a.point.slice(0, 4).map(Number) });
  }
  return out;
}
function layerPointsNm(layer, dims) { return layerPoints(layer, dims).map((p) => p.nm); }

/**
 * The places of one key layer, each [x, y, z] in nm (its middle) and, for a place with an area, its shape
 * (Ames 2026-10-26: "large surface area missed extensions or merge origins - this is marked but the hunt
 * didn't credit players bc the surface area is too large"): an ellipsoid { r: radii }, a line { a, b } or a
 * box { lo, hi }, all in nm. A gem counts within the tolerance of the shape, so anywhere inside it.
 */
function layerPlaces(layer, dims) {
  if (!layer || typeof layer !== 'object') fail(400, 'No annotation layer was sent.');
  let src = layer.source;
  if (Array.isArray(src)) src = src[0];
  const t = src && typeof src === 'object' ? src.transform : null;
  if (t && !isIdentity(t.matrix)) fail(400, 'This layer is moved by a transform. Mark the places in a plain annotation layer.');
  const axes = axisScales((t && t.outputDimensions) || dims);
  let ix = ['x', 'y', 'z'].map((n) => axes.findIndex((a) => a.name === n));
  if (ix.some((i) => i < 0)) ix = [0, 1, 2];
  const nm = (v) => (Array.isArray(v) ? ix.map((i) => Math.round(Number(v[i]) * axes[i].nmPer)) : null);
  const ok = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const out = [];
  for (const a of Array.isArray(layer.annotations) ? layer.annotations : []) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'point') { const p = nm(a.point); if (ok(p)) out.push({ nm: p }); continue; }
    if (a.type === 'ellipsoid') {
      const c = nm(a.center), r = nm(a.radii);
      if (ok(c) && ok(r)) out.push({ nm: c, shape: { r: r.map((v) => Math.max(1, Math.abs(v))) } });
      continue;
    }
    if (a.type === 'line' || a.type === 'axis_aligned_bounding_box') {
      const A = nm(a.pointA), B = nm(a.pointB);
      if (!ok(A) || !ok(B)) continue;
      const mid = A.map((v, i) => Math.round((v + B[i]) / 2));
      out.push({ nm: mid, shape: a.type === 'line' ? { a: A, b: B } : { lo: A.map((v, i) => Math.min(v, B[i])), hi: A.map((v, i) => Math.max(v, B[i])) } });
    }
  }
  return out;
}

/** How far a gem is from a place: from its point, or from its shape (0 inside it). */
function placeDist(t, p) {
  const s = t && t[4];
  if (s && typeof s === 'object') {
    if (Array.isArray(s.r)) {
      const q = [0, 1, 2].map((i) => (p[i] - t[i]) / Math.max(1, s.r[i]));
      const n = Math.hypot(q[0], q[1], q[2]);
      if (n <= 1) return 0;
      return dist([0, 1, 2].map((i) => t[i] + (q[i] / n) * Math.max(1, s.r[i])), p);
    }
    if (Array.isArray(s.a) && Array.isArray(s.b)) {
      const ab = [0, 1, 2].map((i) => s.b[i] - s.a[i]), ap = [0, 1, 2].map((i) => p[i] - s.a[i]);
      const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      const u = L ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L)) : 0;
      return dist([0, 1, 2].map((i) => s.a[i] + u * ab[i]), p);
    }
    if (Array.isArray(s.lo) && Array.isArray(s.hi)) return Math.hypot(...[0, 1, 2].map((i) => Math.max(s.lo[i] - p[i], 0, p[i] - s.hi[i])));
  }
  return dist(t, p);
}

// ── Scoring ───────────────────────────────────────────────────────────────

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/*
 * Two kinds of place in an answer key (Ames 2026-10-21: "2 layers, for merge
 * and cut"): a merger, where two cells are joined and a cut is needed, and a
 * place to merge, where a piece of the cell was left off. A key point is
 * [x, y, z, kind]; a point with no kind (keys saved before) is a merger.
 * Scoring looks at x, y and z only: any gem finds either kind.
 */
const kindOf = (t) => (t && t[3] === 'merge' ? 'merge' : 'cut');
function kindCounts(targets) {
  const c = { cut: 0, merge: 0 };
  for (const t of Array.isArray(targets) ? targets : []) c[kindOf(t)]++;
  return c;
}

/** The answer key from one or more annotation layers, each marked as cuts or merges (edge layers are not problems). */
function keyTargets(key) {
  if (!key || typeof key !== 'object') fail(400, 'No answer key was sent.');
  const parts = Array.isArray(key.layers) ? key.layers : [{ layer: key.layer, kind: key.kind }];
  if (!parts.length) fail(400, 'Pick at least one layer with the places marked.');
  const out = [];
  for (const part of parts) {
    if (part && part.kind === 'edge') continue;
    const kind = part && part.kind === 'merge' ? 'merge' : 'cut';
    for (const pl of layerPlaces(part && part.layer, key.dims)) out.push(pl.shape ? [pl.nm[0], pl.nm[1], pl.nm[2], kind, pl.shape] : [pl.nm[0], pl.nm[1], pl.nm[2], kind]);
  }
  return out;
}

/**
 * Edges of the dataset: where a branch runs out of the data, which is no missing extension.
 * The key can mark them (a layer of kind "edge"), and the volume's own bounds (read from the
 * admin's screen with the key) catch the ones nobody marked. Neither counts as a problem: an
 * Extend gem there is answered "Edge of the dataset", with no gem used.
 */
const EDGE_NM = 5000;   // this close to the volume's outer bounds is the edge (2 µm was too tight: Ames's gems at cut off ends landed 1.3 to 4.4 µm from the face)
function keyEdges(key) {
  const parts = key && Array.isArray(key.layers) ? key.layers : [];
  const out = [];
  for (const part of parts) {
    if (!part || part.kind !== 'edge') continue;
    for (const pt of layerPointsNm(part.layer, key.dims)) out.push([pt[0], pt[1], pt[2], 'edge']);
  }
  // Where the cells run out of the data, found by the editor from their meshes (Ames 2026-10-23).
  for (const p of Array.isArray(key && key.auto_edges_nm) ? key.auto_edges_nm.slice(0, 200) : []) {
    if (Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((v) => Number.isFinite(Number(v)))) out.push([Number(p[0]), Number(p[1]), Number(p[2]), 'edge']);
  }
  return out.slice(0, MAX_TARGETS * 4 + 200);
}
function cleanBounds(b) {
  if (!Array.isArray(b) || b.length !== 2) return null;
  const lo = b[0], hi = b[1];
  const ok = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(Number(x)));
  if (!ok(lo) || !ok(hi)) return null;
  const L = lo.map(Number), H = hi.map(Number);
  return L.every((x, i) => H[i] > x) ? [L, H] : null;
}
/** The key row holds the problems, then any edge spots, then the bounds: stored together, read apart. */
function splitKey(raw) {
  const all = Array.isArray(raw) ? raw : [];
  const targets = all.filter((t) => Array.isArray(t) && t[3] !== 'edge');
  const edges = all.filter((t) => Array.isArray(t) && t[3] === 'edge');
  const b = all.find((t) => t && !Array.isArray(t) && typeof t === 'object' && t.bounds_nm);
  return { targets, edges, bounds: b ? cleanBounds(b.bounds_nm) : null };
}
function joinKey(targets, extras) {
  const e = extras || {};
  return [...(targets || []), ...(e.edges || []), ...(e.bounds ? [{ bounds_nm: e.bounds }] : [])];
}
function atEdge(nm, extras, tol) {
  const e = extras || {};
  if ((e.edges || []).some((t) => dist(t, nm) <= tol)) return true;
  const b = e.bounds;
  return !!b && [0, 1, 2].some((i) => nm[i] - b[0][i] <= EDGE_NM || b[1][i] - nm[i] <= EDGE_NM);
}

/**
 * How many mergers a set of points found: each merger can be found once, by
 * one point within the tolerance, and each point can find one merger. The
 * pairing is the largest possible (augmenting paths), so the order the
 * points were placed in never costs a player a find. `close` counts the
 * other points that sit within twice the tolerance of a merger not found:
 * the "you are close" of EyeWire's 2013 Hunt, never saying which.
 */
function score(targets, points, toleranceNm) {
  const { found, close } = match(targets, points, toleranceNm);
  return { found, close };
}

/** The pairing behind score(), with which mergers were found (`hit`, one per merger). */
function match(targets, points, toleranceNm) {
  const tol = Number(toleranceNm) > 0 ? Number(toleranceNm) : DEFAULT_TOLERANCE_NM;
  const T = Array.isArray(targets) ? targets : [];
  const P = Array.isArray(points) ? points : [];
  const reach = T.map((t) => P.map((p, pi) => [placeDist(t, p), pi]).filter(([d]) => d <= tol)
    .sort((a, b) => a[0] - b[0]).map(([, pi]) => pi));
  const owner = new Array(P.length).fill(-1);
  const tryTarget = (ti, seen) => {
    for (const pi of reach[ti]) {
      if (seen.has(pi)) continue;
      seen.add(pi);
      if (owner[pi] < 0 || tryTarget(owner[pi], seen)) { owner[pi] = ti; return true; }
    }
    return false;
  };
  let found = 0;
  for (let ti = 0; ti < T.length; ti++) if (tryTarget(ti, new Set())) found++;
  const foundTargets = new Set(owner.filter((ti) => ti >= 0));
  let close = 0;
  P.forEach((p, pi) => {
    if (owner[pi] >= 0) return;
    if (T.some((t, ti) => !foundTargets.has(ti) && placeDist(t, p) <= 2 * tol)) close++;
  });
  return { found, close, hit: T.map((t, ti) => foundTargets.has(ti)) };
}

/**
 * For an admin's test run only: each merger, whether it was found, and how
 * far the nearest gem was (µm). Players never get this; it is for setting
 * the tolerance.
 */
function testDetail(targets, points, toleranceNm) {
  const T = Array.isArray(targets) ? targets : [];
  const P = Array.isArray(points) ? points : [];
  const m = match(T, P, toleranceNm);
  return T.map((t, ti) => {
    const near = P.length ? Math.min(...P.map((p) => placeDist(t, p))) : null;
    return { kind: kindOf(t), found: m.hit[ti], nearest_um: near == null ? null : Math.round(near / 100) / 10 };
  });
}

// ── Tiers ─────────────────────────────────────────────────────────────────

const posInt = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/** How many finds each tier needs: set per hunt, else all, two thirds and one third. */
function thresholds(h) {
  const n = posInt(h && h.target_count);
  if (!n) return { gold: 0, silver: 0, bronze: 0 };
  const set = (h && h.tiers) || {};
  const gold = Math.min(posInt(set.gold) || n, n);
  const silver = Math.min(posInt(set.silver) || Math.ceil((2 * n) / 3), gold);
  const bronze = Math.max(1, Math.min(posInt(set.bronze) || Math.ceil(n / 3), silver));
  return { gold, silver, bronze };
}

/**
 * The medal for a run: the best tier whose finds it reached, within that tier's gems
 * (Ames 2026-10-21: "awarded Gold, Silver or Bronze based on how many problems were
 * found and how many gems were used"). Gems are not counted when not given.
 */
function tierFor(found, th, gems, gl) {
  if (!th || !th.gold || !(found > 0)) return null;
  for (const t of TIERS) {
    if (found < th[t]) continue;
    if (gl && gl[t] && gems != null && gems > gl[t]) continue;
    return t;
  }
  return null;
}

/** The most points one answer may carry: set per hunt, else three per merger (at least ten). */
/**
 * The gems each player has (Ames 2026-10-21: "The Hunt finishes when you find all the
 * problems or run out of gems"): set per hunt, else the problems and half again, at least two
 * spare (Ames 2026-10-23: twice the problems, 40 for 20, was "a little high").
 */
function maxPoints(h) {
  const n = posInt(h && h.target_count);
  return posInt(h && h.max_points) || Math.max(n + 2, Math.ceil(1.5 * n), 1);
}

/** The most gems each medal allows (0: no limit). Gold by default: the problems and a third more. */
function gemLimits(h) {
  const n = posInt(h && h.target_count);
  const set = (h && h.tiers) || {};
  const budget = maxPoints(h);
  return {
    gold: n ? Math.min(posInt(set.gold_gems) || n + Math.ceil(n / 3), budget) : 0,
    silver: Math.min(posInt(set.silver_gems), budget),
    bronze: Math.min(posInt(set.bronze_gems), budget),
  };
}

// ── Time ──────────────────────────────────────────────────────────────────

const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };

/** draft, cancelled, announced (scheduled, not started), live, or ended. */
function phase(h, now) {
  if (!h || h.status === 'cancelled') return 'cancelled';
  if (h.status !== 'scheduled') return 'draft';
  const t = now.getTime();
  if (t >= ms(h.end_at)) return 'ended';
  if (t >= ms(h.start_at)) return 'live';
  return 'announced';
}

/** Players see a hunt from its announcement until a week after it ends. */
function visible(h, now) {
  const p = phase(h, now);
  const t = now.getTime();
  if (p === 'live') return true;
  if (p === 'announced') return !!h.announce_at && ms(h.announce_at) <= t;
  if (p === 'ended') return t - ms(h.end_at) <= SHOW_ENDED_DAYS * DAY;
  return false;
}

/** A span of time in words, for a notification read whenever it arrives. */
function inWords(span) {
  const h = span / 3600000;
  if (h >= 36) { const d = Math.round(h / 24); return d === 1 ? 'a day' : `${d} days`; }
  if (h >= 1.5) return `${Math.round(h)} hours`;
  if (h >= 0.75) return 'an hour';
  const m = Math.max(1, Math.round(span / 60000));
  return m === 1 ? 'a minute' : `${m} minutes`;
}

// ── What players see ──────────────────────────────────────────────────────

/** "3 mergers are", "2 extensions are", "3 mergers and 2 extensions are" (Ames's words: a merger is cut, an extension merged). */
function spotWords(c) {
  const cut = (c && c.cut) || 0, merge = (c && c.merge) || 0;
  const cw = cut === 1 ? '1 merger' : `${cut} mergers`;
  const mw = merge === 1 ? '1 extension' : `${merge} extensions`;
  if (!merge) return `${cw} ${cut === 1 ? 'is' : 'are'}`;
  if (!cut) return `${mw} ${merge === 1 ? 'is' : 'are'}`;
  return `${cw} and ${mw} are`;
}
/** The kinds of place a hunt hides: counted from its key when the caller has it, else all mergers. */
const kindsOf = (h) => (h && h._kinds) || { cut: posInt(h && h.target_count), merge: 0 };
function whereWords(h) { const c = Array.isArray(h.cells) ? h.cells.length : 0; return c > 1 ? `${c} cells` : 'one cell'; }

/** A hunt as a player may see it: never the key; the view only once it has started. */
function publicHunt(h, now) {
  const p = phase(h, now);
  const kinds = kindsOf(h);
  const open = p === 'live' || p === 'ended';
  const cells = (Array.isArray(h.cells) ? h.cells : []).map((c) => ({ root: String(c.root), label: String(c.label || ''), ...(Array.isArray(c.soma) ? { soma: c.soma } : {}) }));
  return {
    id: h.id, title: h.title, description: h.description || '', dataset: h.dataset, admins_only: !!h.admins_only,
    edges_nm: open ? (h._edges || []).map((e) => [e[0], e[1], e[2]]) : [],
    bounds_nm: open ? h._bounds || null : null,
    edge_nm: EDGE_NM,   // the cells glow within this of the bounds: the same rule that judges an edge
    // The cells, like the view, only once the hunt starts: nobody hunts early.
    cells: open ? cells : [], cell_count: cells.length,
    announce_at: h.announce_at, start_at: h.start_at, end_at: h.end_at, phase: p,
    target_count: posInt(h.target_count), spots: { cut: kinds.cut, merge: kinds.merge },
    tolerance_um: Math.round((Number(h.tolerance_nm) || DEFAULT_TOLERANCE_NM) / 100) / 10,
    max_points: maxPoints(h), max_submissions: posInt(h.max_submissions) || DEFAULT_MAX_SUBMISSIONS,
    tiers: thresholds(h), gem_limits: gemLimits(h), budget: maxPoints(h), awarded: !!h.awarded_at, results_hours: resultsHours(h),
    answers: p === 'ended' && answersOpen(h),
    view: open ? startView(h) : null,
  };
}

/** Best per player (the earliest answer that reached it breaks ties), best first. */
function leaderboard(subs) {
  // Most found first; then fewer gems; then the earlier start. One run per player (older
  // answers, from before gems were judged one by one, count by the same rule).
  const best = new Map();
  for (const s of Array.isArray(subs) ? subs : []) {
    const gems = posInt(s.close);
    const at = ms(s.created_at);
    const was = best.get(s.user_id);
    if (!was || s.found > was.found || (s.found === was.found && (gems < was.gems || (gems === was.gems && at < was.atMs)))) {
      best.set(s.user_id, { user_id: s.user_id, found: s.found, gems, at: s.created_at, atMs: at });
    }
  }
  return [...best.values()].sort((a, b) => b.found - a.found || a.gems - b.gems || a.atMs - b.atMs)
    .map(({ atMs, ...b }) => b);
}

// ── A run: gems dropped one at a time, each judged as it lands ─────────────
// A player's run is one hunt_submissions row: points holds the drops in order
// ({ id, nm, at, hit, t }, hit the key's index or -1), found the hits, close the
// gems used. Only the player's own drops ever go back to them.

function normalizeDrops(points) {
  return (Array.isArray(points) ? points : [])
    .filter((d) => d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.nm) && d.nm.length === 3)
    .map((d) => ({ id: String(d.id || '').slice(0, 80), nm: d.nm.map(Number), at: Array.isArray(d.at) ? d.at.map(Number) : null,
      hit: Number.isInteger(d.hit) ? d.hit : -1, k: d.k === 'cut' || d.k === 'merge' ? d.k : null, t: d.t || null,
      ...(d.rep === true ? { rep: true } : {}), ...(d.rep_no === true ? { rep_no: true } : {}) }));
}

/** One gem: the nearest problem not yet found within the tolerance, or one found already, or a miss. */
/**
 * One gem: the nearest problem of its kind not yet found within the tolerance, or one found
 * already, or a miss. Players drop cut gems and extend gems from two layers (Ames 2026-10-21:
 * "we could give players 2 layers: cut, extend"): a cut gem finds only mergers, an extend gem
 * only missing extensions. A gem of the other kind on a real problem is a miss that says so
 * (`other`). A gem with no kind (from before) finds either.
 */
function judgeDrop(targets, drops, nm, tol, kind) {
  const taken = new Set(drops.filter((d) => d.hit >= 0).map((d) => d.hit));
  let hit = -1, best = Infinity, already = false, nearest = Infinity, other = null;
  targets.forEach((t, i) => {
    const d = placeDist(t, nm);
    const mine = !kind || kindOf(t) === kind;
    if (!taken.has(i) && mine) nearest = Math.min(nearest, d);
    if (d > tol) return;
    if (taken.has(i)) { if (mine) already = true; return; }
    if (!mine) { other = kindOf(t); return; }
    if (d < best) { best = d; hit = i; }
  });
  return { hit, already: hit < 0 && already, other: hit < 0 && !already ? other : null,
    nearest_um: Number.isFinite(nearest) ? Math.round(nearest / 100) / 10 : null };
}

/** The drops judged again in order (a new key or tolerance); a gem on a problem found already is a miss. */
function replay(targets, drops, tol) {
  const out = [];
  for (const d of drops) out.push({ ...d, hit: judgeDrop(targets, out, d.nm, tol, d.k).hit });
  return out;
}

const tolOf = (h) => (Number(h && h.tolerance_nm) > 0 ? Number(h.tolerance_nm) : DEFAULT_TOLERANCE_NM);

/** What a player sees of their own run (with its clock, given the run row). */
function runView(h, drops, targets, run) {
  const budget = maxPoints(h);
  const found = drops.filter((d) => d.hit >= 0).length;
  const used = drops.length;
  const kinds = kindCounts(targets);
  const foundBy = { cut: 0, merge: 0 };
  for (const d of drops) if (d.hit >= 0) foundBy[kindOf(targets[d.hit])]++;
  return {
    budget, found, of: targets.length, gems_used: used, gems_left: Math.max(0, budget - used),
    found_by: foundBy, of_by: kinds,
    started_at: (run && run.created_at) || null, time_ms: run ? runClock(run, drops) : null,
    done: (targets.length > 0 && found >= targets.length) || used >= budget,
    tier: null,   // the medals are places, given and shown at the end
    drops: drops.map((d) => ({ id: d.id, at: d.at, hit: d.hit >= 0, kind: d.hit >= 0 ? kindOf(targets[d.hit]) : null, k: d.k,
      ...(d.rep ? { rep: true } : {}), ...(d.rep_no ? { rep_no: true } : {}) })),
  };
}

/**
 * A run's clock (Ames 2026-10-21: the speed award, "it should only let them try one time"):
 * it starts when the player first opens the Hunt (hunt.start makes the run then; a run made
 * by a first gem starts at that gem) and stops at their last find. One run each, never reset.
 */
function lastFindAt(drops) {
  let at = null;
  for (const d of drops) if (d.hit >= 0 && d.t) at = d.t;
  return at;
}
function runClock(run, drops) {
  const a = ms(run && run.created_at), b = ms(lastFindAt(drops));
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

/** "4m 12s", "1h 03m", "52s". */
function clockWords(msTime) {
  const sec = Math.max(0, Math.round(Number(msTime) / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(x).padStart(2, '0')}s`;
  return `${x}s`;
}


/**
 * The speed award (Ames 2026-10-21): "for the fastest player to get all points (or fastest
 * with highest accuracy if no one finds all)". The quickest run that found every problem;
 * if none did, the quickest of the runs that found the most. Ties: the earlier finish.
 */
function speedWinner(runs, n) {
  const timed = runs.map((r) => ({ ...r, ms: runClock(r, r.drops) })).filter((r) => r.found > 0 && r.ms != null);
  if (!timed.length) return null;
  const top = Math.max(...timed.map((r) => r.found));
  const pool = timed.filter((r) => (n > 0 && top >= n ? r.found >= n : r.found === top));
  pool.sort((a, b) => a.ms - b.ms || ms(lastFindAt(a.drops)) - ms(lastFindAt(b.drops)));
  return pool[0] ? { ...pool[0], all: n > 0 && pool[0].found >= n } : null;
}

/** Judge one gem against a run, and keep it (save) unless it lands on a problem found already. */
async function dropInto(h, targets, drops, args, ctx, save, extras) {
  const before = runView(h, drops, targets);
  // The same gem sent again (a slow answer, a retry): its first answer, nothing new kept. Before the
  // checks below, so the last gem of a run sent twice is never refused (and taken off the screen).
  const again = Array.isArray(args.layer && args.layer.annotations) && args.layer.annotations.length === 1
    ? drops.find((x) => x.id === String(args.layer.annotations[0].id || '')) : null;
  if (again) return { drop: { id: again.id, hit: again.hit >= 0, kind: again.hit >= 0 ? kindOf(targets[again.hit]) : null, repeat: true }, run: before, nm: again.nm };
  const pts = layerPoints(args.layer, args.dims);
  if (pts.length !== 1) fail(400, 'Drop one gem at a time.');
  const g = pts[0];
  const kind = args.kind === 'cut' || args.kind === 'merge' ? args.kind : null;
  const j = judgeDrop(targets, drops, g.nm, tolOf(h), kind);
  // A gem on a place found already uses no gem, so it is answered even with none left (and stays gold).
  if (j.already) return { drop: { id: g.id, already: true }, run: before, nearest_um: j.nearest_um };
  // An Extend gem where the branch leaves the data: the edge of the dataset, no gem used (it stays, in its own color).
  if (j.hit < 0 && !j.other && kind === 'merge' && atEdge(g.nm, extras, tolOf(h))) return { drop: { id: g.id, edge: true }, run: before, nearest_um: j.nearest_um };
  if (targets.length && before.found >= targets.length) fail(409, 'You found them all. Your Hunt is done.');
  if (drops.length >= before.budget) fail(409, 'You have used all your gems. Your Hunt is done.');
  const d = { id: g.id, nm: g.nm, at: g.at, hit: j.hit, k: kind, t: (ctx.now || new Date()).toISOString() };
  const next = [...drops, d];
  if (save) await save(next, next.filter((x) => x.hit >= 0).length);
  return { drop: { id: d.id, hit: d.hit >= 0, kind: d.hit >= 0 ? kindOf(targets[d.hit]) : null, ...(j.other ? { other: j.other } : {}) },
    run: runView(h, next, targets), nearest_um: j.nearest_um, nm: d.nm };
}

// ── Notifications ─────────────────────────────────────────────────────────

const NOTE_KINDS = ['announce', 'start', 'end'];

/** The picture a note carries (null for none): set per note in the Admin Hub, one picture can serve several. */
function noteImage(h, kind) {
  const v = h && h.notif_images && h.notif_images[kind];
  if (v && v.image_url) return { image_url: v.image_url, thumbnail_url: v.thumbnail_url || v.image_url };
  // A Hunt's note always has a picture (Ames 2026-10-21: "a default image that appears for hunts
  // vs default being no picture"): the Hunt's gold medal, until a picture is chosen.
  const site = h && h._site;
  return site ? { image_url: `${site}/hunt/gold.png`, thumbnail_url: `${site}/hunt/gold-128.png` } : { image_url: null, thumbnail_url: null };
}

/** The three notes a scheduled hunt sends, each at its own time. */
function notificationRows(h) {
  const start = ms(h.start_at), end = ms(h.end_at);
  const kinds = kindsOf(h);
  const runs = inWords(end - start);
  const rows = [];
  if (h.announce_at) {
    rows.push({ kind: 'announce', send_at: h.announce_at,
      title: `${TITLE_PREFIX} is coming: ${h.title}`,
      body: `${h.title} starts in ${inWords(start - ms(h.announce_at))} and runs for ${runs}. ${spotWords(kinds)} hidden on ${whereWords(h)}. Drop a gem on each one you find: every gem is judged as it lands, and you have ${maxPoints(h)}. Gold, silver and bronze Achievements go to the best hunters.` });
  }
  rows.push({ kind: 'start', send_at: h.start_at,
    title: `${TITLE_PREFIX} is on: ${h.title}`,
    body: `${spotWords(kinds)} hidden on ${whereWords(h)}. Open the Hunt and Ctrl + Click to drop a gem on each one you find. You have ${maxPoints(h)} gems and ${runs}.` });
  rows.push({ kind: 'end', send_at: h.end_at,
    title: `${TITLE_PREFIX} is over: ${h.title}`,
    body: 'Time is up. Open the Hunt to see who placed: Gold, Silver, Bronze and the fastest hunter get their Achievements now.' });
  // An admins only Hunt's notes read exactly as the real ones (Ames 2026-10-21: "don't need all this ADMINS
  // TEST stuff, we need to nail the real UI"); who gets them is what differs.
  return rows.map((r) => ({ ...r, title: r.title.slice(0, 120), ...noteImage(h, r.kind) }));
}

// ── Achievements ──────────────────────────────────────────────────────────

const LINES = {
  fastest: 'You spotted them all first. Takes one to know one.',
  // Celia's lines (2026-10-26). Gold has two: each Hunt takes one (lineFor).
  gold: ['Legend of the hidden merger.', 'You have 24/24 karat vision!'],
  silver: 'Scientists praise you, werewolves fear you!',
  bronze: 'Splitting + merging = one strong alloy!',
  laser: 'Nothing gets past those eyes, not even the answer key.',
};
/** A medal's line: one of its lines, the same for every winner of one Hunt. */
function lineFor(tier, h) {
  const l = LINES[tier];
  return Array.isArray(l) ? l[posInt(h && h.id) % l.length] : l;
}

/** The special Achievement for one tier of one hunt. */
function badgeRow(h, tier, th, site) {
  const n = posInt(h.target_count);
  const k = th[tier], g = gemLimits(h)[tier];
  const count = `${k >= n ? `all ${n} found` : `${k} or more of the ${n} found`}${g ? ` with ${g} gems or fewer` : ''}`;
  const a = h.art && h.art[tier];
  const own = typeof a === 'string' ? a : a && a.image_url;
  // Ames's medals (2026-10-21: "the badges that we will use consistently for hunt"), unless a picture was set.
  const art = typeof own === 'string' && /^https:\/\//.test(own) ? own : `${site}/hunt/${tier}.png`;
  const thumb = own === art ? (a && typeof a === 'object' && typeof a.thumbnail_url === 'string' && /^https:\/\//.test(a.thumbnail_url) ? a.thumbnail_url : art) : `${site}/hunt/${tier}-128.png`;
  return {
    slug: `hunt-${h.id}-${tier}`,
    name: `${h.title}: ${TIER_NAME[tier]}`.slice(0, 80),
    description: `${TIER_NAME[tier]} in ${h.title}: ${count}. ${lineFor(tier, h)}`.slice(0, 300),
    image_url: art, thumbnail_url: thumb, created_by: h.created_by || null,
  };
}

/** The special Achievement an admin chose for a tier (Admin Hub > Special Badges), if any. */
const chosenBadge = (h, tier) => posInt(h && h.art && h.art[tier] && typeof h.art[tier] === 'object' && h.art[tier].badge_id);

/** What each medal gives, for the panel: the Achievement's name and picture. */
async function prizesFor(h, db, site) {
  const th = thresholds(h);
  const out = {};
  for (const t of TIERS) {
    const id = chosenBadge(h, t);
    const b = id && db.badgeById ? await db.badgeById(id) : null;
    if (b) out[t] = { name: b.name, image: b.thumbnail_url || b.image_url || `${site}/hunt/${t}-128.png` };
    else { const r = badgeRow(h, t, th, site); out[t] = { name: r.name, image: r.thumbnail_url }; }
  }
  return out;
}

// ── Input from the Admin Hub ──────────────────────────────────────────────

const ROOT = /^\d{5,24}$/;
function cleanCells(cells) {
  if (!Array.isArray(cells)) return [];
  const seen = new Set();
  return cells.map((c) => {
    const out = { root: String(c && c.root || ''), label: String(c && c.label || '').slice(0, 60) };
    // The cell's soma, in the view's voxel coordinates (as the coordinate bar shows them): players start there.
    const soma = Array.isArray(c && c.soma) && c.soma.length === 3 && c.soma.every((v) => v !== '' && v != null) ? c.soma.map(Number) : null;
    if (soma && soma.every(Number.isFinite)) out.soma = soma.map((v) => Math.round(v * 10) / 10);
    return out;
  }).filter((c) => ROOT.test(c.root) && !seen.has(c.root) && seen.add(c.root)).slice(0, MAX_CELLS);
}

/** Which entries of a view's position are x, y and z (by the names of its dimensions). */
function xyzIndex(view) {
  const names = Object.keys((view && view.dimensions) || {});
  const ix = ['x', 'y', 'z'].map((n) => names.indexOf(n));
  return ix.some((i) => i < 0) ? [0, 1, 2] : ix;
}

/**
 * The view players start from (Ames 2026-10-21: "when I click start it took me to
 * the coords of the answer"): the admin's link is often centered on a merger, so
 * the view moves to the first cell's soma when one is set.
 */
function startView(h) {
  if (!h || !h.view) return null;
  const first = (Array.isArray(h.cells) ? h.cells : []).find((c) => Array.isArray(c.soma) && c.soma.length === 3);
  if (!first) return h.view;
  const pos = Array.isArray(h.view.position) ? h.view.position.slice() : [0, 0, 0];
  xyzIndex(h.view).forEach((k, i) => { pos[k] = first.soma[i]; });
  return { ...h.view, position: pos };
}

/** How far the players' start is from the nearest place in the key (µm), so the Admin Hub can warn. */
function startGapUm(h, targets) {
  const v = startView(h);
  if (!v || !Array.isArray(v.position) || !targets.length) return null;
  let axes; try { axes = axisScales(v.dimensions); } catch (e) { return null; }
  const ix = xyzIndex(v);
  const p = ix.map((k) => Number(v.position[k]) * ((axes[k] && axes[k].nmPer) || 1));
  if (!p.every(Number.isFinite)) return null;
  return Math.round(Math.min(...targets.map((t) => dist(t, p))) / 100) / 10;
}

/** The view players start from: the admin's view without a single annotation layer. */
function stripView(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail(400, 'No view was sent.');
  const layers = (Array.isArray(state.layers) ? state.layers : []).filter((l) => l && l.type !== 'annotation');
  const names = new Set(layers.map((l) => l.name));
  const view = { ...state, layers };
  if (view.selectedLayer && !names.has(view.selectedLayer.layer)) delete view.selectedLayer;
  delete view.selection;
  if (Buffer.byteLength(JSON.stringify(view)) > MAX_VIEW_BYTES) fail(413, 'That view is too large to save.');
  return view;
}

const DATE_FIELDS = ['announce_at', 'start_at', 'end_at'];
function cleanDate(v) {
  if (v == null || v === '') return null;
  const t = ms(v);
  if (!Number.isFinite(t)) fail(400, 'A date could not be read.');
  return new Date(t).toISOString();
}

function cleanFields(f) {
  const out = {};
  if (!f || typeof f !== 'object') return out;
  if ('title' in f) { const t = String(f.title || '').trim(); if (!t) fail(400, 'Give the Hunt a title.'); out.title = t.slice(0, 80); }
  if ('description' in f) out.description = String(f.description || '').slice(0, 1500);
  if ('dataset' in f) { const d = String(f.dataset || ''); if (!/^[a-z0-9_]{2,60}$/.test(d)) fail(400, 'Unknown dataset.'); out.dataset = d; }
  if ('cells' in f) out.cells = cleanCells(f.cells);
  if ('tolerance_nm' in f) { const t = Math.round(Number(f.tolerance_nm)); if (!(t >= 100 && t <= 100000)) fail(400, 'Give a tolerance between 0.1 and 100 µm.'); out.tolerance_nm = t; }
  if ('max_points' in f) out.max_points = Math.min(posInt(f.max_points), 1000);
  if ('max_submissions' in f) out.max_submissions = Math.min(posInt(f.max_submissions) || DEFAULT_MAX_SUBMISSIONS, 1000);
  if ('tiers' in f) {
    const t = f.tiers || {};
    out.tiers = { gold: posInt(t.gold), silver: posInt(t.silver), bronze: posInt(t.bronze),
      gold_gems: posInt(t.gold_gems), silver_gems: posInt(t.silver_gems), bronze_gems: posInt(t.bronze_gems),
      results_hours: Math.min(posInt(t.results_hours), SHOW_ENDED_DAYS * 24), hide_answers: !!t.hide_answers };
  }
  if ('art' in f) {
    // Per tier: { badge_id } (a special Achievement already made), { image_url, thumbnail_url } (the hunt's own,
    // with that picture), or nothing (the hunt's own, with the game's medal). A bare https string is a picture.
    const a = f.art || {};
    const https = (v) => typeof v === 'string' && /^https:\/\/\S{4,800}$/.test(v);
    out.art = {};
    for (const t of [...TIERS, 'fastest']) {
      const v = a[t];
      if (https(v)) out.art[t] = { image_url: v, thumbnail_url: v };
      else if (v && typeof v === 'object' && posInt(v.badge_id)) out.art[t] = { badge_id: posInt(v.badge_id) };
      else if (v && typeof v === 'object' && https(v.image_url)) out.art[t] = { image_url: v.image_url, thumbnail_url: https(v.thumbnail_url) ? v.thumbnail_url : v.image_url };
    }
  }
  if ('notif_images' in f) {
    // { announce: { image_url, thumbnail_url }, start: ..., end: ... }; a note left out has no picture.
    const a = f.notif_images || {};
    const https = (v) => typeof v === 'string' && /^https:\/\/\S{4,800}$/.test(v);
    out.notif_images = {};
    for (const k of NOTE_KINDS) {
      const v = a[k];
      if (v && https(v.image_url)) out.notif_images[k] = { image_url: v.image_url, thumbnail_url: https(v.thumbnail_url) ? v.thumbnail_url : v.image_url };
    }
  }
  if ('admins_only' in f) out.admins_only = !!f.admins_only;
  for (const k of DATE_FIELDS) if (k in f) out[k] = cleanDate(f[k]);
  return out;
}

function checkDates(h) {
  if (!h.start_at || !h.end_at) fail(400, 'Set when the Hunt starts and ends.');
  if (ms(h.end_at) <= ms(h.start_at)) fail(400, 'The Hunt must end after it starts.');
  if (h.announce_at && ms(h.announce_at) > ms(h.start_at)) fail(400, 'Announce the Hunt before it starts.');
}

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * ctx: { db, me, isAdmin, now, site,
 *        notify(rows)        bell notes to single players: [{user_id, title, body, image}]
 *        chatAward(userId, badge)  the chat line for a special award }
 */
async function huntAction(action, args, ctx) {
  const { me, isAdmin } = ctx;
  if (!me) fail(403, 'Sign in and create your Pyr profile first.');
  const needAdmin = () => { if (!isAdmin) fail(403, 'Admins only.'); };
  args = args || {};
  switch (action) {
    case 'hunt.current': return current(ctx);
    case 'hunt.board': return liveBoard(args, ctx);
    case 'hunt.answers': return answers(args, ctx);
    case 'hunt.drop': return drop(args, ctx);
    case 'hunt.start': return startRun(args, ctx);
    case 'hunt.submit': fail(410, 'The Hunt now judges each gem as it lands. Reload Pyr for the new Hunt box.'); break;
    case 'hunt.list': needAdmin(); return adminList(ctx);
    case 'hunt.read': needAdmin(); return adminRead(args, ctx);
    case 'hunt.save': needAdmin(); return save(args, ctx);
    case 'hunt.now': needAdmin(); return nowAction(args, ctx);
    case 'hunt.cancel': needAdmin(); return cancel(args, ctx);
    case 'hunt.delete': needAdmin(); return remove(args, ctx);
    case 'hunt.award': needAdmin(); return awardAction(args, ctx);
    case 'hunt.rescore': needAdmin(); return rescore(args, ctx);
    case 'hunt.notes': needAdmin(); return notesPreview(args, ctx);
    case 'hunt.duplicate': needAdmin(); return duplicate(args, ctx);
    case 'hunt.run': needAdmin(); return adminRun(args, ctx);
    case 'hunt.count_it': needAdmin(); return countIt(args, ctx);
    case 'hunt.report': return reportGem(args, ctx);
    case 'hunt.reports': needAdmin(); return reportsAction(args, ctx);
    case 'hunt.dismiss_report': needAdmin(); return dismissReport(args, ctx);
    case 'hunt.add_place': needAdmin(); return addPlaceAction(args, ctx);
    case 'hunt.test': needAdmin(); return testOpen(args, ctx);
    case 'hunt.test_drop': needAdmin(); return testDrop(args, ctx);
    default: fail(400, 'Unknown Hunt action.');
  }
}

async function getHunt(db, id) {
  const h = await db.hunt(posInt(id));
  if (!h) fail(404, 'No such Hunt.');
  return h;
}

/**
 * The top ten of a running Hunt and nothing else, for the box to ask again while it runs (Ames
 * 2026-10-26: each player saw only their own row move; Krzysztof's board had no row for her).
 * The same rows as hunt.current gives while the Hunt runs, from far fewer reads.
 */
async function liveBoard(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const h = await getHunt(db, args && args.id);
  if (h.status !== 'scheduled' || (adminsOnly(h, ctx) && !ctx.isAdmin)) fail(404, 'No such Hunt.');
  if (phase(h, now) !== 'live') fail(409, 'This Hunt is not running.');
  const board = leaderboard(await db.submissions(h.id));
  const top = board.slice(0, 10);
  const mine = board.find((b) => b.user_id === me.id);
  const names = await db.names([...new Set([...top.map((b) => b.user_id), me.id])]);
  return {
    id: h.id, rank: mine ? board.indexOf(mine) + 1 : 0,
    board: top.map((b, i) => ({ rank: i + 1, name: names[b.user_id] || 'Player', found: b.found, gems: b.gems, at: b.at, tier: null, you: b.user_id === me.id, fastest: false })),
  };
}

/**
 * The answers, once the Hunt is over (Ames 2026-10-26: "should we show players the answer to the hunt at the
 * end", yes, unless the Hunt keeps them): every merger and extension, in nanometres, and which this player found.
 */
async function answers(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const h = await getHunt(db, args && args.id);
  if (h.status !== 'scheduled' || (adminsOnly(h, ctx) && !ctx.isAdmin)) fail(404, 'No such Hunt.');
  if (phase(h, now) !== 'ended') fail(409, 'The answers show once the Hunt is over.');
  if (!answersOpen(h)) fail(403, 'This Hunt keeps its answers.');
  const key = await db.key(h.id);
  const run = await db.myRun(h.id, me.id);
  const drops = run && Array.isArray(run.points) && !run.points.some((x) => Array.isArray(x)) ? normalizeDrops(run.points) : [];
  const found = new Set(drops.filter((d) => d.hit >= 0).map((d) => d.hit));
  return { id: h.id, took_part: !!run, places: key.map((t, i) => ({ at: [t[0], t[1], t[2]], kind: kindOf(t), found: found.has(i) })) };
}

/** The hunts a player can see, with their own result and the top ten. Ends any hunt whose time is up. */
async function current(ctx) {
  const { db, me, now = new Date() } = ctx;
  const since = new Date(now.getTime() - SHOW_ENDED_DAYS * DAY).toISOString();
  // An admins only hunt (for testing) is never shown to players, and the database leaves those out for
  // them. For admins, a test Hunt goes once its results window is over (Ames 2026-10-26: "this takes a
  // long time to load": 17 Hunts, 146 reads one after another, 9 s, for an admin).
  const players = !ctx.isAdmin;
  const rows = (await db.visibleHunts(since, { players })).filter((h) => visible(h, now) && (!adminsOnly(h, ctx) || ctx.isAdmin)
    && !(h.admins_only && phase(h, now) === 'ended' && now.getTime() - Date.parse(h.end_at) > resultsHours(h) * 3600000));
  // Each Hunt's reads go together, and the Hunts together.
  const hunts = await Promise.all(rows.map((h) => huntForPlayer(h, ctx)));
  return { now: now.toISOString(), hunts };
}

/** One Hunt as hunt.current gives it: the player's own run, the board, the medals once given. */
async function huntForPlayer(h, ctx) {
  const { db, me, now = new Date() } = ctx;
  {
    if (phase(h, now) === 'ended' && !h.awarded_at) {
      try { const r = await finalize(h, ctx); if (r) h.awarded_at = now.toISOString(); }
      catch (e) { console.warn('[hunt] awards for', h.id, 'failed:', e && e.message); }
    }
    const open = phase(h, now) !== 'announced';
    const [key, ex, subs, run, prizes] = await Promise.all([
      db.key(h.id),
      open && db.keyExtras ? db.keyExtras(h.id) : null,
      db.submissions(h.id),
      open ? db.myRun(h.id, me.id) : null,
      prizesFor(h, db, ctx.site),
    ]);
    h._kinds = kindCounts(key);
    if (ex) { h._edges = ex.edges; h._bounds = ex.bounds; }
    const board = leaderboard(subs);
    const top = board.slice(0, 10);
    const mineBest = board.find((b) => b.user_id === me.id);
    const ended = phase(h, now) === 'ended';
    const [names0, medals, allRuns] = await Promise.all([
      db.names([...new Set([...top.map((b) => b.user_id), me.id])]),
      // The medals, from the awards once they are given (never before).
      ended && h.awarded_at && db.huntMedals ? db.huntMedals(h) : [],
      ended && board.length && db.allSubmissions ? db.allSubmissions(h.id) : null,
    ]);
    const names = { ...names0 };
    const runDrops = run && Array.isArray(run.points) && !run.points.some((x) => Array.isArray(x)) ? normalizeDrops(run.points) : null;
    const mine = runView(h, runDrops || [], key, runDrops ? run : null);
    // At the ceremony everyone who took part is listed (Ames 2026-10-21); while it runs, the top ten.
    const medalOf = new Map(medals.filter((m) => m.tier !== 'fastest').map((m) => [m.user_id, m.tier]));
    const speed = medals.find((m) => m.tier === 'fastest') || null;
    const order = { gold: 0, silver: 1, bronze: 2 };
    let clockOf = new Map();
    if (allRuns) {
      const runs = allRuns.filter((x) => Array.isArray(x.points) && !x.points.some((p) => Array.isArray(p)));
      clockOf = new Map(runs.map((x) => [x.user_id, runClock(x, normalizeDrops(x.points))]));
    }
    const clock = (b) => { const v = clockOf.get(b.user_id); return v == null ? Infinity : v; };
    const ranked = ended ? [...board].sort((a, b) => ((order[medalOf.get(a.user_id)] ?? 9) - (order[medalOf.get(b.user_id)] ?? 9))
      || (clock(a) - clock(b)) || (b.found - a.found) || (a.gems - b.gems)) : board;
    const shown = ended ? ranked.slice(0, 200) : top;
    if (ended) { const more = await db.names([...new Set([...shown.map((b) => b.user_id), ...(speed ? [speed.user_id] : [])])]); Object.assign(names, more); }
    return {
      ...publicHunt(h, now), prizes,
      you: { ...mine, best: mineBest ? mineBest.found : 0, submissions: run ? 1 : 0,
        tier: medalOf.get(me.id) || null, rank: mineBest ? ranked.indexOf(mineBest) + 1 : 0 },
      board: shown.map((b, i) => ({ rank: i + 1, name: names[b.user_id] || 'Player', found: b.found, gems: b.gems, at: b.at, tier: medalOf.get(b.user_id) || null, you: b.user_id === me.id,
        fastest: !!speed && speed.user_id === b.user_id })),
      fastest: speed ? { name: names[speed.user_id] || 'Player', reason: speed.reason || '', you: speed.user_id === me.id } : null,
      players: board.length,
      winners: TIERS.reduce((o, t) => { o[t] = medals.filter((m) => m.tier === t).length; return o; }, {}),
    };
  }
}

/** The player opened the Hunt: their run, and its clock, start now (once; a second call changes nothing). */
async function startRun(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const h = await getHunt(db, args.id);
  if (adminsOnly(h, ctx) && !ctx.isAdmin) fail(404, 'No such Hunt.');
  if (phase(h, now) !== 'live') fail(409, 'The Hunt is not running.');
  const targets = await db.key(h.id);
  let run = await db.myRun(h.id, me.id);
  if (!run || !Array.isArray(run.points) || run.points.some((x) => Array.isArray(x))) {
    run = await db.addSubmission({ hunt_id: h.id, user_id: me.id, points: [], found: 0, close: 0, created_at: now.toISOString() });
  }
  return { run: runView(h, normalizeDrops(run.points), targets, run) };
}

async function drop(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const h = await getHunt(db, args.id);
  if (adminsOnly(h, ctx) && !ctx.isAdmin) fail(404, 'No such Hunt.');
  const p = phase(h, now);
  if (p === 'announced') fail(409, 'The Hunt has not started yet.');
  if (p !== 'live') fail(409, 'This Hunt is over.');
  const targets = await db.key(h.id);
  const extras = db.keyExtras ? await db.keyExtras(h.id) : null;
  const run = await db.myRun(h.id, me.id);
  const fresh = !run || !Array.isArray(run.points) || run.points.some((x) => Array.isArray(x));   // an answer from before is not a run
  const drops = fresh ? [] : normalizeDrops(run.points);
  let row = fresh ? null : run, kept = drops;
  const r = await dropInto(h, targets, drops, args, ctx, async (next, found) => {
    kept = next;
    if (fresh) row = await db.addSubmission({ hunt_id: h.id, user_id: me.id, points: next, found, close: next.length, created_at: (ctx.now || new Date()).toISOString() });
    else await db.patchSubmission(run.id, { points: next, found, close: next.length });
  }, extras);
  // A player hears right or wrong, and what is left; never how near a miss was.
  return { drop: r.drop, run: row ? runView(h, kept, targets, row) : r.run };
}

/** One hunter's gems, for the Admin Hub: where each landed, its kind, right or wrong. */
async function adminRun(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args.id);
  const run = await db.myRun(h.id, String(args.user_id || ''));
  const drops = run && Array.isArray(run.points) && !run.points.some((x) => Array.isArray(x)) ? normalizeDrops(run.points) : [];
  return { user_id: args.user_id, drops: drops.map((d) => ({ id: d.id, at: d.at, hit: d.hit >= 0, k: d.k, t: d.t, rep: !!d.rep })) };
}

/**
 * Count it (Ames 2026-10-21: "a way for admins to manually correct a mistake (or award an extra
 * point). Sometimes on EW1 hunts someone would find a (real) error that was not an official error"):
 * a hunter's missed gem becomes a place in the answer key (of the kind of that gem), and every run
 * is judged again, so whoever else found it gets it too. After the end, Give the awards again.
 */
async function countIt(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args.id);
  const run = await db.myRun(h.id, String(args.user_id || ''));
  const drops = run && Array.isArray(run.points) ? normalizeDrops(run.points) : [];
  const d = drops.find((x) => x.id === String(args.drop_id || ''));
  if (!d) fail(404, 'That gem is not in this hunter\'s run.');
  if (d.hit >= 0) fail(409, 'That gem already found a problem.');
  return addPlace(h, d.nm, d.k, ctx);
}

/**
 * A place the key missed, added by an admin from its coordinates (Ames 2026-10-26: "I want to be able to add
 * coords for missing cut or merge and label them as merge or cut"): into the key, everyone judged again, and
 * Laser Eyes to each hunter whose gem now finds it.
 */
async function addPlaceAction(args, ctx) {
  const h = await getHunt(ctx.db, args && args.id);
  const nm = Array.isArray(args && args.nm) ? args.nm.slice(0, 3).map(Number) : [];
  if (nm.length !== 3 || !nm.every((v) => Number.isFinite(v) && Math.abs(v) < 1e10)) fail(400, 'Give x, y and z.');
  if (args.kind !== 'cut' && args.kind !== 'merge') fail(400, 'Say whether it is a merger (Cut) or a missing extension (Extend).');
  const radius = Math.max(0, Math.min(Number(args.radius_nm) || 0, 100000));
  return addPlace(h, nm, args.kind, ctx, radius);
}

/**
 * A hunter says their missed gem is on a real problem the key missed (Ames 2026-10-26: "in this view I want
 * a 'found an unlabeled cut/merge' type button"). The gem is marked reported in their run and every admin
 * hears of it; Count it (from the editor's Reported list) then makes it count, with Laser Eyes.
 */
async function reportGem(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const h = await getHunt(db, args && args.id);
  if (h.status !== 'scheduled' || (adminsOnly(h, ctx) && !ctx.isAdmin)) fail(404, 'No such Hunt.');
  if (phase(h, now) === 'announced') fail(409, 'The Hunt has not started yet.');
  const run = await db.myRun(h.id, me.id);
  const drops = run && Array.isArray(run.points) && !run.points.some((x) => Array.isArray(x)) ? normalizeDrops(run.points) : [];
  const d = drops.find((x) => x.id === String((args && args.drop_id) || ''));
  if (!d) fail(404, 'That gem is not in your Hunt.');
  if (d.hit >= 0) fail(409, 'That gem found a problem already.');
  if (d.rep) return { reported: true, drop_id: d.id, again: true };
  const next = drops.map((x) => (x.id === d.id ? { ...x, rep: true } : x));
  await db.patchSubmission(run.id, { points: next });
  if (ctx.notify && db.adminUserIds) {
    const admins = await db.adminUserIds();
    const name = ((await db.names([me.id])) || {})[me.id] || 'A hunter';
    const what = d.k === 'merge' ? 'missing extension' : 'merger';
    const at = (d.at || []).slice(0, 3).map((v) => Math.round(Number(v))).join(', ');
    if (admins.length) {
      await ctx.notify(admins.map((u) => ({ user_id: u, title: `🔎 Hunt report: ${h.title}`.slice(0, 120),
        body: `${name} says their gem is on a real ${what} the answers missed${at ? `, at ${at}` : ''}. Admin Hub > Hunts > ${h.title}: Reported by hunters, to check it and Count it.` })));
    }
  }
  return { reported: true, drop_id: d.id };
}

/** Every reported gem still a miss in a Hunt, for the editor (the newest first). */
async function reportsAction(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args && args.id);
  const runs = db.allSubmissions ? await db.allSubmissions(h.id) : [];
  const out = [];
  for (const r of runs) {
    if (!Array.isArray(r.points) || r.points.some((p) => Array.isArray(p))) continue;
    for (const d of normalizeDrops(r.points)) if (d.rep && d.hit < 0) out.push({ user_id: r.user_id, drop_id: d.id, k: d.k, at: d.at, t: d.t });
  }
  const names = out.length ? await db.names([...new Set(out.map((x) => x.user_id))]) : {};
  return { reports: out.map((x) => ({ ...x, name: names[x.user_id] || 'Player' })).sort((a, b) => String(b.t).localeCompare(String(a.t))) };
}

/** Not a problem after all: off the Reported list; the hunter's box says it was checked. */
async function dismissReport(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args && args.id);
  const run = await db.myRun(h.id, String((args && args.user_id) || ''));
  const drops = run && Array.isArray(run.points) && !run.points.some((x) => Array.isArray(x)) ? normalizeDrops(run.points) : [];
  const d = drops.find((x) => x.id === String((args && args.drop_id) || ''));
  if (!d) fail(404, 'That gem is not in this hunter\'s run.');
  const next = drops.map((x) => (x.id === d.id ? (({ rep, ...rest }) => ({ ...rest, rep_no: true }))(x) : x));
  await db.patchSubmission(run.id, { points: next });
  return reportsAction({ id: h.id }, ctx);
}

/**
 * Into the key at nm, of kind; every run judged again; Laser Eyes to whoever now finds it. With a radius it is a
 * sphere, and at a place of that kind the key has already, it makes that place bigger instead (a wide face the
 * key marked with a point: Ames 2026-10-26), with no Laser Eyes: the place was in the key all along.
 */
async function addPlace(h, nm, kind, ctx, radius = 0) {
  const { db } = ctx;
  const targets = await db.key(h.id);
  const tol = tolOf(h);
  const k = kind === 'merge' ? 'merge' : 'cut';
  const place = radius > 0 ? [nm[0], nm[1], nm[2], k, { r: [radius, radius, radius] }] : [nm[0], nm[1], nm[2], k];
  if (radius > 0) {
    const same = targets.findIndex((t) => kindOf(t) === k && placeDist(t, nm) <= tol);
    if (same >= 0) {
      const next = targets.map((t, i) => (i === same ? place : t));
      await db.setKey(h.id, next);
      const row = await db.patchHunt(h.id, { target_count: next.length, updated_at: (ctx.now || new Date()).toISOString() });
      const r = await rescore({ id: h.id }, ctx);
      return { ...(await adminView(row, ctx)), counted: true, enlarged: true, rescored: r.rescored, changed: r.changed, laser: 0 };
    }
  }
  if (targets.length >= MAX_TARGETS) fail(400, `At most ${MAX_TARGETS} places per Hunt.`);
  if (targets.some((t) => placeDist(t, nm) <= tol / 4)) fail(409, 'The key already has a place there. Give it a size to make that place bigger.');
  const next = [...targets, place];
  await db.setKey(h.id, next);
  const row = await db.patchHunt(h.id, { target_count: next.length, updated_at: (ctx.now || new Date()).toISOString() });
  const r = await rescore({ id: h.id }, ctx);
  const laser = await awardLaserEyes(row || h, next.length - 1, ctx);
  return { ...(await adminView(row, ctx)), counted: true, rescored: r.rescored, changed: r.changed, laser: laser.length };
}

/** A copy of a hunt, as a draft: its key, view, cells, words and settings; no notes, no answers. */
async function duplicate(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const h = await getHunt(db, args.id);
  const keep = ['description', 'dataset', 'cells', 'view', 'target_count', 'tolerance_nm', 'max_points', 'max_submissions', 'tiers', 'art', 'notif_images',
    'announce_at', 'start_at', 'end_at'];
  const row = { title: `${h.title} (copy)`.slice(0, 80), status: 'draft', created_by: me.id, notif_ids: {}, updated_at: now.toISOString() };
  for (const k of keep) if (h[k] !== undefined) row[k] = h[k];
  const canFlag = db.hasAdminsOnly ? await db.hasAdminsOnly() : true;
  if (canFlag) row.admins_only = ctx.testSite ? true : !!h.admins_only;
  const copy = await db.insertHunt(row);
  await db.setKey(copy.id, await db.key(h.id), db.keyExtras ? await db.keyExtras(h.id) : undefined);
  return adminView(copy, ctx);
}

/** The notes as they would go out with the form as it is (for the Admin Hub's Preview); nothing is saved. */
async function notesPreview(args, ctx) {
  const base = args.id ? await getHunt(ctx.db, args.id) : {};
  const h = { ...base, ...cleanFields(args.fields || {}) };
  if (!base.id) h.target_count = Math.min(posInt(args.target_count), MAX_TARGETS);
  if (args.kinds && typeof args.kinds === 'object') h._kinds = { cut: Math.min(posInt(args.kinds.cut), MAX_TARGETS), merge: Math.min(posInt(args.kinds.merge), MAX_TARGETS) };
  else if (base.id) h._kinds = kindCounts(await ctx.db.key(base.id));
  if (!h.title) h.title = 'Untitled Hunt';
  if (!h.start_at || !h.end_at) fail(400, 'Set when the Hunt starts and ends first.');
  if (ctx.site) h._site = ctx.site;
  return notificationRows(h).map(({ kind, title, body, send_at, image_url, thumbnail_url }) => ({ kind, title, body, send_at, image_url, thumbnail_url }));
}

// ── An admin's test run ───────────────────────────────────────────────────
// Ames 2026-10-21: admins play a hunt to test it, at any time (a draft, a
// scheduled one before its start, a running one). The hunt opens as if it
// were running, for that admin only; answers are scored against the real key
// and never kept, so a test never shows on the board or wins an Achievement.
// Admins can also play a running hunt for real, like anyone.


async function testOpen(args, ctx) {
  const { db, now = new Date() } = ctx;
  const h = await getHunt(db, args.id);
  const key = await db.key(h.id);
  if (!h.view || !key.length) fail(409, 'Read the answer key and save the Hunt before trying it.');
  h._kinds = kindCounts(key);
  const cells = cleanCells(h.cells);
  const ex = db.keyExtras ? await db.keyExtras(h.id) : { edges: [], bounds: null };
  return { ...publicHunt(h, now), edges_nm: (ex.edges || []).map((e) => [e[0], e[1], e[2]]), bounds_nm: ex.bounds || null, prizes: await prizesFor(h, db, ctx.site), phase: 'live', test: true, cells, cell_count: cells.length, view: startView(h),
    you: { ...runView(h, [], key), best: 0, submissions: 0, rank: 0 }, board: [], players: 0, winners: { gold: 0, silver: 0, bronze: 0 } };
}

/** A test run's gem: judged against the real key with the admin's earlier gems (sent back by the game), never kept. */
async function testDrop(args, ctx) {
  const h = await getHunt(ctx.db, args.id);
  const targets = await ctx.db.key(h.id);
  const extras = ctx.db.keyExtras ? await ctx.db.keyExtras(h.id) : null;
  // The earlier gems are judged again from where they are, not taken on the game's word.
  const drops = replay(targets, normalizeDrops(args.prev).slice(0, 1000), tolOf(h));
  const r = await dropInto(h, targets, drops, args, ctx, null, extras);
  return { ...r, test: true, tolerance_um: Math.round(tolOf(h) / 100) / 10 };
}

/** Award the gold, silver and bronze Achievements of an ended hunt, once. */
async function finalize(h, ctx, { force = false } = {}) {
  const { db, now = new Date(), site, notify, chatAward } = ctx;
  if (phase(h, now) !== 'ended') fail(409, 'The Hunt has not ended yet.');
  let row = h;
  if (!force) {
    row = await db.claimAward(h.id, now.toISOString());
    if (!row) return null;   // another request is giving the awards
  }
  const board = leaderboard(await db.submissions(row.id));
  const th = thresholds(row);
  const counts = { gold: 0, silver: 0, bronze: 0, fastest: 0 };
  // Each hunter's medal by the thresholds (finds, within the medal's gems); the speed award from every run's clock.
  const gl = gemLimits(row);
  const winners = board.map((b) => ({ ...b, tier: tierFor(b.found, th, b.gems, gl) })).filter((b) => b.tier);
  const n = posInt(row.target_count);
  const runs = (await db.allSubmissions(row.id)).filter((x) => Array.isArray(x.points) && !x.points.some((p) => Array.isArray(p)))
    .map((x) => ({ user_id: x.user_id, created_at: x.created_at, found: x.found, drops: normalizeDrops(x.points) }));
  const speed = speedWinner(runs, n);
  if (speed) winners.push({ user_id: speed.user_id, found: speed.found, gems: speed.drops.length, tier: 'fastest', time: clockWords(speed.ms), all: speed.all });
  await postResults(row, board, winners, speed, ctx);
  if (!winners.length) return { awarded: 0, ...counts };
  const badges = {};
  for (const tier of [...TIERS, 'fastest']) {
    if (!winners.some((w) => w.tier === tier)) continue;
    // A special Achievement the admin chose, else (or if it was deleted) the hunt's own.
    const id = chosenBadge(row, tier);
    const chosen = id ? await db.badgeById(id) : null;
    badges[tier] = chosen || await db.upsertBadge(tier === 'fastest' ? speedBadgeRow(row, winners.find((w) => w.tier === 'fastest'), site) : badgeRow(row, tier, th, site));
  }
  const held = await db.held(Object.values(badges).map((b) => b.id));
  const fresh = winners.filter((w) => !held.has(`${badges[w.tier].id}:${w.user_id}`));
  await db.award(winners.map((w) => ({ badge_id: badges[w.tier].id, user_id: w.user_id, awarded_by: row.created_by || null,
    reason: w.tier === 'fastest' ? `${w.all ? `All ${row.target_count}` : `${w.found} of ${row.target_count}`} found in ${w.time}, the fastest in ${row.title}`
      : `${TIER_NAME[w.tier]} in ${row.title}: ${w.found} of ${row.target_count} found with ${w.gems} gems` })));
  for (const w of winners) counts[w.tier]++;
  if (fresh.length && notify) {
    await notify(fresh.map((w) => ({ user_id: w.user_id, title: `🏅 New Achievement: ${badges[w.tier].name}`,
      body: `You earned the "${badges[w.tier].name}" award! ${w.tier === 'fastest' ? badges[w.tier].description : `${badges[w.tier].description} You found ${w.found} of ${row.target_count} with ${w.gems} ${w.gems === 1 ? 'gem' : 'gems'}.`}`,
      image: badges[w.tier].image_url })));
  }
  // Chat hears the results once, in the results post (postResults), not a line per winner.
  return { awarded: winners.length, fresh: fresh.length, ...counts };
}

/** Laser Eyes for this Hunt (Ames 2026-10-26): a problem the answer key missed, found. Ames's mask. */
function laserBadgeRow(h, site) {
  return {
    slug: `hunt-${h.id}-laser`,
    name: `${h.title}: Laser Eyes`.slice(0, 80),
    description: `Laser Eyes in ${h.title}: a problem the answer key missed, found. ${LINES.laser}`.slice(0, 300),
    image_url: `${site}/hunt/laser.png`, thumbnail_url: `${site}/hunt/laser-128.png`, created_by: h.created_by || null,
  };
}

/**
 * Laser Eyes to everyone whose gem found a place Count it just added (Ames 2026-10-26: "use this
 * achievement for anyone who found a missing hunt cut or extension, and it increments - max award one
 * time per hunt"): one Achievement per Hunt, given once to each finder; the profile counts them up.
 */
async function awardLaserEyes(h, index, ctx) {
  const { db, notify } = ctx;
  if (!db.allSubmissions || !db.upsertBadge || !db.award) return [];
  const runs = await db.allSubmissions(h.id);
  const finders = [...new Set(runs.filter((r) => Array.isArray(r.points) && !r.points.some((p) => Array.isArray(p))
    && normalizeDrops(r.points).some((d) => d.hit === index)).map((r) => r.user_id))];
  if (!finders.length) return [];
  const badge = await db.upsertBadge(laserBadgeRow(h, ctx.site || ''));
  const had = new Set(db.badgeHolders ? (await db.badgeHolders(badge.id)).map((r) => r.user_id) : []);
  const fresh = finders.filter((u) => !had.has(u));
  if (!fresh.length) return [];
  await db.award(fresh.map((u) => ({ badge_id: badge.id, user_id: u, awarded_by: (ctx.me && ctx.me.id) || null,
    reason: `Found a problem the answer key missed in ${h.title}` })));
  if (notify) {
    await notify(fresh.map((u) => ({ user_id: u, title: `🏅 New Achievement: ${badge.name}`,
      body: `You earned the "${badge.name}" award! ${badge.description}`, image: badge.image_url })));
  }
  return fresh;
}

/** The speed award's Achievement for this hunt (its own; the cheetah art, or a picture set for it). */
function speedBadgeRow(h, w, site) {
  const a = h.art && h.art.fastest;
  const own = typeof a === 'string' ? a : a && a.image_url;
  const art = typeof own === 'string' && /^https:\/\//.test(own) ? own : `${site}/hunt/fastest.png`;
  const what = w ? (w.all ? `every problem found in ${w.time}` : `${w.found} of ${posInt(h.target_count)} found in ${w.time}, the most of anyone`) : 'the quickest run';
  return {
    slug: `hunt-${h.id}-fastest`,
    name: `${h.title}: Fastest`.slice(0, 80),
    description: `Fastest in ${h.title}: ${what}. ${LINES.fastest}`.slice(0, 300),
    image_url: art, thumbnail_url: own === art ? art : `${site}/hunt/fastest-128.png`, created_by: h.created_by || null,
  };
}

function listNames(names, ids, max = 6) {
  const list = ids.map((id) => names[id] || 'Player');
  return list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}

/**
 * The results, once, when a hunt ends (Ames 2026-10-21: "Awards should post to chat",
 * "Congratulations to all who participated!"): a note to everyone that also posts in chat,
 * or, for an admins only hunt, a note to each admin and nothing in chat.
 */
async function postResults(row, board, winners, speed, ctx) {
  const { db, me, now = new Date() } = ctx;
  if (!db.insertNotification) return;
  const names = await db.names([...new Set([...winners.map((w) => w.user_id)])]);
  const by = (t) => winners.filter((w) => w.tier === t).map((w) => w.user_id);
  const parts = [];
  for (const t of TIERS) { const ids = by(t); if (ids.length) parts.push(`${TIER_NAME[t]}: ${listNames(names, ids)}.`); }
  if (speed) parts.push(`Fastest: ${names[speed.user_id] || 'Player'}, ${speed.all ? `all ${posInt(row.target_count)}` : `${speed.found}`} in ${clockWords(speed.ms)}.`);
  const who = board.length === 1 ? '1 hunter' : `${board.length} hunters`;
  const body = board.length
    ? `Congratulations to all ${who} who took part!${parts.length ? ' ' + parts.join(' ') : ''}`
    : 'Nobody hunted this time. The next Hunt is yours.';
  const test = adminsOnly(row, ctx);   // who gets it: admins only, never chat (the words are the real ones)
  const base = { title: `${TITLE_PREFIX} results: ${row.title}`.slice(0, 120), body,
    send_at: now.toISOString(), ...(ctx.site ? { image_url: `${ctx.site}/hunt/gold.png`, thumbnail_url: `${ctx.site}/hunt/gold-128.png` } : { image_url: null, thumbnail_url: null }),
    created_by: (me && me.id) || row.created_by || null };
  try {
    if (!test) await db.insertNotification({ ...base, target_type: 'all', target_id: null, post_to_chat: true });
    else {
      const admins = db.adminUserIds ? await db.adminUserIds() : [];
      for (const uid of (admins.length ? admins : [row.created_by]).filter(Boolean)) await db.insertNotification({ ...base, target_type: 'user', target_id: uid, post_to_chat: false });
    }
  } catch (e) { console.warn('[hunt] results note failed:', e && e.message); }
}

async function awardAction(args, ctx) {
  const now = ctx.now || new Date();
  const h = await getHunt(ctx.db, args.id);
  // Refuse before marking anything: a mark set too early would skip the real awards.
  if (phase(h, now) !== 'ended') fail(409, 'The Hunt has not ended yet.');
  if (!h.awarded_at) await ctx.db.patchHunt(h.id, { awarded_at: now.toISOString() });
  return finalize(h, ctx, { force: true });
}

/**
 * Write, move or clear the hunt's three notes so they match its times. Notes
 * already sent keep their words and time; only a changed picture reaches them,
 * so a picture added late (or a wrong one) can still be put right.
 *
 * An everyone hunt has one note of each kind, to all players, posted in chat.
 * An admins only hunt (a test) has one of each kind for every admin, never in
 * chat (Ames 2026-10-21: "Celia said she didn't get a notif of this hunt"), so
 * notif_ids holds a list for it.
 */
async function syncNotifications(h, ctx) {
  const { db, me, now = new Date() } = ctx;
  const t = now.getTime();
  const ids = { ...(h.notif_ids || {}) };
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  if (h.status === 'scheduled' && h.id && !h._kinds) h = { ...h, _kinds: kindCounts(await db.key(h.id)) };
  if (ctx.site && !h._site) h = { ...h, _site: ctx.site };
  const wanted = h.status === 'scheduled' ? notificationRows(h) : [];
  const wantedKinds = new Set(wanted.map((r) => r.kind));
  for (const kind of Object.keys(ids)) {
    if (wantedKinds.has(kind)) continue;
    const keep = [];
    for (const id of list(ids[kind])) {
      const n = await db.notification(id);
      if (n && ms(n.send_at) > t) await db.deleteNotification(id);
      else if (n) keep.push(id);
    }
    if (keep.length) ids[kind] = keep.length === 1 ? keep[0] : keep; else delete ids[kind];
  }
  let admins = null;
  for (const row of wanted) {
    // An announcement for a hunt that has already started would only confuse.
    if (row.kind === 'announce' && ms(h.start_at) <= t) continue;
    const existing = (await Promise.all(list(ids[row.kind]).map((id) => db.notification(id)))).filter(Boolean);
    const picture = { image_url: row.image_url, thumbnail_url: row.thumbnail_url };
    if (existing.some((n) => ms(n.send_at) <= t)) {          // already out: the picture only
      for (const n of existing) {
        if ((n.image_url || null) !== picture.image_url || (n.thumbnail_url || null) !== picture.thumbnail_url) await db.patchNotification(n.id, picture);
      }
      continue;
    }
    const sendAt = ms(row.send_at) <= t ? now.toISOString() : new Date(ms(row.send_at)).toISOString();
    const base = { title: row.title, body: row.body, send_at: sendAt, ...picture };
    if (!adminsOnly(h, ctx)) {
      const fields = { ...base, target_type: 'all', target_id: null, post_to_chat: true };
      const one = existing.find((n) => n.target_type === 'all' || n.target_type == null);
      for (const n of existing) if (n !== one) await db.deleteNotification(n.id);
      ids[row.kind] = one ? (await db.patchNotification(one.id, fields), one.id) : (await db.insertNotification({ ...fields, created_by: me.id })).id;
    } else {
      // Every admin gets this one (the admin who made it, if the admin list cannot be read).
      if (!admins) admins = db.adminUserIds ? await db.adminUserIds() : [];
      const to = [...new Set([...(admins.length ? admins : [h.created_by || me.id])].filter(Boolean))];
      for (const n of existing) await db.deleteNotification(n.id);
      const made = [];
      for (const uid of to) made.push((await db.insertNotification({ ...base, target_type: 'user', target_id: uid, post_to_chat: false, created_by: me.id })).id);
      ids[row.kind] = made.length === 1 ? made[0] : made;
    }
  }
  return ids;
}

async function save(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const fields = cleanFields(args.fields);
  const status = args.status === 'scheduled' ? 'scheduled' : args.status === 'draft' ? 'draft' : null;
  // Until hunts.admins_only exists (Ames runs the SQL), the flag is not written. A test site then
  // saves drafts and tries them, but cannot schedule: a scheduled test would reach every player.
  const canFlag = db.hasAdminsOnly ? await db.hasAdminsOnly() : true;
  if (!canFlag) delete fields.admins_only;
  let targets = null, extras = null;
  if (args.key) {
    targets = keyTargets(args.key);
    extras = { edges: keyEdges(args.key), bounds: cleanBounds(args.key.bounds_nm) };
    if (!targets.length) fail(400, 'Those layers have no points. Mark each place with a point.');
    if (targets.length > MAX_TARGETS) fail(400, `At most ${MAX_TARGETS} mergers per Hunt.`);
    fields.target_count = targets.length;
  }
  if (args.view) fields.view = stripView(args.view);
  let h = args.id ? await getHunt(db, args.id) : null;
  // Saved from a test site: admins only, whatever the box says (the notes stay off the players' bells and chat).
  if (ctx.testSite && canFlag) fields.admins_only = true;
  if (ctx.testSite && !canFlag && (status || (h && h.status)) === 'scheduled') {
    fail(409, 'A test site keeps every Hunt admins only, and the database needs one more line for that (hunts.admins_only, in supabase-hunts.sql). Until it is run, save drafts here and use Try it yourself.');
  }
  const was = h ? phase(h, now) : 'draft';
  if (h && was === 'ended' && h.awarded_at && (targets || 'tolerance_nm' in fields)) fail(409, 'The awards have been given. Re-score from the list instead.');
  const next = { ...(h || {}), ...fields, ...(status ? { status } : {}) };
  if (!next.title) fail(400, 'Give the Hunt a title.');
  if (!next.dataset) fail(400, 'Open the link first, so the Hunt knows its dataset.');
  if (next.status === 'scheduled') {
    checkDates(next);
    if (!h || was === 'draft' || was === 'cancelled') if (ms(next.end_at) <= now.getTime()) fail(400, 'The Hunt must end in the future.');
    const keyCount = targets ? targets.length : h ? (await db.key(h.id)).length : 0;
    if (!posInt(next.target_count) || !keyCount) fail(400, 'Read the answer key from a view before scheduling.');
    if (!next.view) fail(400, 'Read the view before scheduling, so players have a place to start.');
  }
  fields.updated_at = now.toISOString();
  if (status) fields.status = status;
  if (!h) h = await db.insertHunt({ title: next.title, dataset: next.dataset, status: next.status || 'draft', created_by: me.id, ...fields });
  else h = await db.patchHunt(h.id, fields);
  if (targets) await db.setKey(h.id, targets, extras);
  if (h.status === 'scheduled' || (h.notif_ids && Object.keys(h.notif_ids).length)) {
    const ids = await syncNotifications(h, ctx);
    h = await db.patchHunt(h.id, { notif_ids: ids });
  }
  // A new key or tolerance changes what every answer so far found.
  if ((targets || 'tolerance_nm' in fields) && args.id) await rescore({ id: h.id }, ctx);
  return adminView(h, ctx);
}

/** Announce, start or end a scheduled hunt now. */
async function nowAction(args, ctx) {
  const { db, now = new Date() } = ctx;
  let h = await getHunt(db, args.id);
  if (h.status !== 'scheduled') fail(409, 'Schedule the Hunt first.');
  if (ctx.testSite && !h.admins_only) fail(409, 'This Hunt goes to every player. Save it here first, which makes it admins only, or run it from the live game.');
  const p = phase(h, now);
  const iso = now.toISOString();
  const kind = String(args.kind || '');
  if (kind === 'announce') {
    if (p !== 'announced') fail(409, 'The Hunt has already started.');
    h = await db.patchHunt(h.id, { announce_at: iso });
  } else if (kind === 'start') {
    if (p !== 'announced') fail(409, 'The Hunt has already started.');
    h = await db.patchHunt(h.id, { start_at: iso, ...(h.announce_at && ms(h.announce_at) > now.getTime() ? { announce_at: iso } : {}) });
  } else if (kind === 'end') {
    if (p !== 'live') fail(409, 'Only a running Hunt can be ended.');
    h = await db.patchHunt(h.id, { end_at: iso });
  } else fail(400, 'Announce, start or end.');
  const ids = await syncNotifications(h, ctx);
  h = await db.patchHunt(h.id, { notif_ids: ids });
  if (kind === 'end') { try { await finalize(h, ctx); h = await db.hunt(h.id); } catch (e) { console.warn('[hunt] awards failed:', e && e.message); } }
  return adminView(h, ctx);
}

async function cancel(args, ctx) {
  const { db, now = new Date() } = ctx;
  let h = await getHunt(db, args.id);
  if (phase(h, now) === 'ended') fail(409, 'This Hunt is over already.');
  h = await db.patchHunt(h.id, { status: 'cancelled', updated_at: now.toISOString() });
  const ids = await syncNotifications(h, ctx);
  h = await db.patchHunt(h.id, { notif_ids: ids });
  return adminView(h, ctx);
}

async function remove(args, ctx) {
  const { db, now = new Date() } = ctx;
  const h = await getHunt(db, args.id);
  const p = phase(h, now);
  if (p !== 'draft' && p !== 'cancelled') fail(409, 'Cancel the Hunt before deleting it.');
  await syncNotifications({ ...h, status: 'cancelled' }, ctx);
  await db.deleteHunt(h.id);
  return { deleted: h.id };
}

/** Score every answer again (after the key or the tolerance changed). */
/** Judge every run again (after the key or the tolerance changed). */
async function rescore(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args.id);
  const targets = await db.key(h.id);
  const subs = await db.allSubmissions(h.id);
  let changed = 0;
  for (const s of subs) {
    if (!Array.isArray(s.points) || s.points.some((x) => Array.isArray(x))) {   // an answer from before gems were judged one by one
      const r = score(targets, s.points, h.tolerance_nm);
      if (r.found !== s.found) { await db.patchSubmission(s.id, { found: r.found }); changed++; }
      continue;
    }
    const next = replay(targets, normalizeDrops(s.points), tolOf(h));
    const found = next.filter((d) => d.hit >= 0).length;
    if (found !== s.found || JSON.stringify(next.map((d) => d.hit)) !== JSON.stringify(normalizeDrops(s.points).map((d) => d.hit))) {
      await db.patchSubmission(s.id, { points: next, found, close: next.length }); changed++;
    }
  }
  return { rescored: subs.length, changed };
}

/** What the Admin Hub shows for one hunt. */
async function adminView(h, ctx) {
  const { db, now = new Date() } = ctx;
  const board = leaderboard(await db.submissions(h.id));
  const notes = {};
  for (const [kind, v] of Object.entries(h.notif_ids || {})) {
    const n = await db.notification(Array.isArray(v) ? v[0] : v);
    if (n) notes[kind] = { id: n.id, send_at: n.send_at, sent: ms(n.send_at) <= now.getTime(),
      title: n.title || '', body: n.body || '', image_url: n.image_url || null, thumbnail_url: n.thumbnail_url || null };
  }
  const { view, ...rest } = h;
  // A start this close to a place gives it away: the Admin Hub warns (twice the tolerance).
  const gap = startGapUm(h, await db.key(h.id));
  const tolUm = (Number(h.tolerance_nm) || DEFAULT_TOLERANCE_NM) / 1000;
  const extras = db.keyExtras ? await db.keyExtras(h.id) : null;
  return { ...rest, has_view: !!view, phase: phase(h, now), thresholds: thresholds(h), max_points_used: maxPoints(h),
    players: board.length, notes, start_gap_um: gap, start_on_answer: gap != null && gap <= 2 * tolUm,
    edge_count: extras ? extras.edges.length : 0, has_bounds: !!(extras && extras.bounds) };
}

async function adminList(ctx) {
  const { db, now = new Date() } = ctx;
  const rows = await db.hunts();
  const counts = await db.playerCounts(rows.map((h) => h.id));
  return rows.map((h) => {
    const { view, ...rest } = h;
    return { ...rest, has_view: !!view, phase: phase(h, now), thresholds: thresholds(h), players: counts[h.id] || 0 };
  });
}

async function adminRead(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args.id);
  const targets = await db.key(h.id);
  const subs = await db.submissions(h.id);
  const board = leaderboard(subs);
  const names = await db.names(board.map((b) => b.user_id));
  const th = thresholds(h), gl = gemLimits(h);
  const extras = db.keyExtras ? await db.keyExtras(h.id) : { edges: [] };
  return { ...(await adminView(h, ctx)), view: h.view || null, targets, edges: extras.edges || [],
    board: board.map((b, i) => ({ rank: i + 1, name: names[b.user_id] || 'Player', user_id: b.user_id, found: b.found, at: b.at,
      gems: b.gems, tier: tierFor(b.found, th, b.gems, gl) })) };
}

// ── The database ──────────────────────────────────────────────────────────

const adminsOnlyColumn = { ok: false, at: 0 };
function restDb(sb) {
  const enc = encodeURIComponent;
  const merge = { Prefer: 'resolution=merge-duplicates,return=representation' };
  const one = async (p) => (await p)[0] || null;
  const rawKey = async (id) => { const r = await one(sb(`hunt_keys?hunt_id=eq.${id}&select=targets&limit=1`)); return (r && r.targets) || []; };
  return {
    hunts: () => sb('hunts?select=*&order=start_at.desc.nullslast&limit=200'),
    // Newest first, so the newest Hunt is never the one left out (it was oldest first, 20 at most: Hunt 21
    // would have been missing); back in start order for the box. A player's list has no admins only Hunts.
    visibleHunts: async (since, o = {}) => (await sb(`hunts?status=eq.scheduled&end_at=gte.${enc(since)}${o.players ? '&admins_only=eq.false' : ''}&select=*&order=start_at.desc&limit=50`)).reverse(),
    hunt: (id) => one(sb(`hunts?id=eq.${id}&select=*&limit=1`)),
    insertHunt: (row) => one(sb('hunts', { method: 'POST', body: JSON.stringify(row) })),
    patchHunt: (id, row) => one(sb(`hunts?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) })),
    deleteHunt: (id) => sb(`hunts?id=eq.${id}`, { method: 'DELETE' }),
    claimAward: (id, at) => one(sb(`hunts?id=eq.${id}&awarded_at=is.null`, { method: 'PATCH', body: JSON.stringify({ awarded_at: at }) })),
    key: async (id) => splitKey(await rawKey(id)).targets,
    keyExtras: async (id) => { const k = splitKey(await rawKey(id)); return { edges: k.edges, bounds: k.bounds }; },
    setKey: async (id, targets, extras) => {
      const keep = extras || (({ edges, bounds }) => ({ edges, bounds }))(splitKey(await rawKey(id)));
      return sb('hunt_keys?on_conflict=hunt_id', { method: 'POST', headers: merge,
        body: JSON.stringify({ hunt_id: id, targets: joinKey(targets, keep), updated_at: new Date().toISOString() }) });
    },
    submissions: (id) => sb(`hunt_submissions?hunt_id=eq.${id}&select=user_id,found,close,created_at&order=created_at.asc&limit=10000`),
    myRun: (id, uid) => one(sb(`hunt_submissions?hunt_id=eq.${id}&user_id=eq.${encodeURIComponent(uid)}&select=id,points,found,close,created_at&order=id.desc&limit=1`)),
    allSubmissions: (id) => sb(`hunt_submissions?hunt_id=eq.${id}&select=id,user_id,points,found,close,created_at&limit=10000`),
    mySubmissions: (id, uid) => sb(`hunt_submissions?hunt_id=eq.${id}&user_id=eq.${uid}&select=found,close,created_at&limit=1000`),
    addSubmission: (row) => one(sb('hunt_submissions', { method: 'POST', body: JSON.stringify(row) })),
    patchSubmission: (id, row) => sb(`hunt_submissions?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) }),
    playerCounts: async (ids) => {
      if (!ids.length) return {};
      const rows = await sb(`hunt_submissions?hunt_id=in.(${ids.join(',')})&select=hunt_id,user_id&limit=50000`);
      const seen = {};
      for (const r of rows) (seen[r.hunt_id] = seen[r.hunt_id] || new Set()).add(r.user_id);
      return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size]));
    },
    names: async (ids) => {
      const list = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
      if (!list.length) return {};
      const rows = await sb(`users?id=in.(${list.map(enc).join(',')})&select=id,username,display_name`);
      return Object.fromEntries(rows.map((u) => [u.id, u.username || u.display_name || 'Player']));
    },
    notification: (id) => one(sb(`notifications?id=eq.${posInt(id)}&select=id,send_at,title,body,image_url,thumbnail_url,target_type,target_id&limit=1`)),
    // The admins (kept by email) as player ids, for an admins only hunt's notes.
    adminUserIds: async () => {
      const emails = (await sb('admins?select=email')).map((a) => String(a.email || '').toLowerCase()).filter(Boolean);
      if (!emails.length) return [];
      const list = emails.map((e) => '"' + e.replace(/["\\]/g, '') + '"').join(',');
      return (await sb('users?select=id&middleauth_email=in.(' + encodeURIComponent(list) + ')')).map((u) => u.id);
    },
    insertNotification: (row) => one(sb('notifications', { method: 'POST', body: JSON.stringify(row) })),
    patchNotification: (id, row) => one(sb(`notifications?id=eq.${posInt(id)}`, { method: 'PATCH', body: JSON.stringify(row) })),
    deleteNotification: (id) => sb(`notifications?id=eq.${posInt(id)}`, { method: 'DELETE' }),
    upsertBadge: (row) => one(sb('special_badges?on_conflict=slug', { method: 'POST', headers: merge, body: JSON.stringify(row) })),
    // Is the hunts.admins_only column there yet? Asked once (again a minute later while it is not).
    hasAdminsOnly: async () => {
      if (adminsOnlyColumn.ok || Date.now() - adminsOnlyColumn.at < 60000) return adminsOnlyColumn.ok;
      try { await sb('hunts?select=admins_only&limit=0'); adminsOnlyColumn.ok = true; } catch (e) { adminsOnlyColumn.ok = false; }
      adminsOnlyColumn.at = Date.now();
      return adminsOnlyColumn.ok;
    },
    huntMedals: async (h) => {
      const own = ['gold', 'silver', 'bronze', 'fastest'].map((t) => `hunt-${posInt(h.id)}-${t}`);
      const badges = await sb(`special_badges?slug=in.(${own.map(enc).join(',')})&select=id,slug`);
      const tierOf = new Map(badges.map((b) => [b.id, b.slug.split('-').pop()]));
      // A special Achievement chosen for a medal can be held for other things too: its awards for this hunt name it.
      for (const t of ['gold', 'silver', 'bronze', 'fastest']) { const id = posInt(h.art && h.art[t] && h.art[t].badge_id); if (id && !tierOf.has(id)) tierOf.set(id, t); }
      if (!tierOf.size) return [];
      const awards = await sb(`special_badge_awards?badge_id=in.(${[...tierOf.keys()].join(',')})&select=badge_id,user_id,reason&limit=1000`);
      return awards.filter((a) => badges.some((b) => b.id === a.badge_id) || String(a.reason || '').includes(h.title))
        .map((a) => ({ user_id: a.user_id, tier: tierOf.get(a.badge_id), reason: a.reason || '' }));
    },
    speedAward: async (huntId) => {
      const b = await one(sb(`special_badges?slug=eq.${encodeURIComponent(`hunt-${posInt(huntId)}-fastest`)}&select=id&limit=1`));
      if (!b) return null;
      return one(sb(`special_badge_awards?badge_id=eq.${b.id}&select=user_id,reason&limit=1`));
    },
    badgeById: (id) => one(sb(`special_badges?id=eq.${posInt(id)}&select=id,name,description,slug,image_url,thumbnail_url&limit=1`)),
    held: async (badgeIds) => {
      if (!badgeIds.length) return new Set();
      const rows = await sb(`special_badge_awards?badge_id=in.(${badgeIds.join(',')})&select=badge_id,user_id&limit=10000`);
      return new Set(rows.map((r) => `${r.badge_id}:${r.user_id}`));
    },
    award: (rows) => (rows.length ? sb('special_badge_awards?on_conflict=badge_id,user_id', { method: 'POST', headers: merge, body: JSON.stringify(rows) }) : []),
    badgeHolders: (badgeId) => sb(`special_badge_awards?badge_id=eq.${posInt(badgeId)}&select=user_id&limit=10000`),
  };
}

module.exports = {
  huntAction, restDb, speedWinner, clockWords, runClock, layerPoints, layerPointsNm, keyTargets, judgeDrop, replay, gemLimits, runView, startView, startGapUm, kindCounts, spotWords, prizesFor, score, match, testDetail, thresholds, tierFor, maxPoints, phase, visible, inWords,
  publicHunt, leaderboard, notificationRows, badgeRow, stripView, cleanFields, cleanCells, finalize,
  syncNotifications, TITLE_PREFIX, TIERS, DEFAULT_TOLERANCE_NM, resultsHours,
  keyEdges, cleanBounds, splitKey, joinKey, atEdge, EDGE_NM, placeDist, layerPlaces,
};
