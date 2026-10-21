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
const TIER_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const DEFAULT_TOLERANCE_NM = 3000;
const DEFAULT_MAX_SUBMISSIONS = 10;
const MIN_POINTS = 10;
const MAX_TARGETS = 200;
const MAX_CELLS = 20;
const SHOW_ENDED_DAYS = 7;
const MAX_VIEW_BYTES = 150000;
const TITLE_PREFIX = '🔎 The Hunt';
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
function layerPointsNm(layer, dims) {
  if (!layer || typeof layer !== 'object') fail(400, 'No annotation layer was sent.');
  let src = layer.source;
  if (Array.isArray(src)) src = src[0];
  const t = src && typeof src === 'object' ? src.transform : null;
  if (t && !isIdentity(t.matrix)) fail(400, 'This layer is moved by a transform. Mark the mergers in a plain annotation layer.');
  const axes = axisScales((t && t.outputDimensions) || dims);
  let ix = ['x', 'y', 'z'].map((n) => axes.findIndex((a) => a.name === n));
  if (ix.some((i) => i < 0)) ix = [0, 1, 2];
  const out = [];
  for (const a of Array.isArray(layer.annotations) ? layer.annotations : []) {
    if (!a || a.type !== 'point' || !Array.isArray(a.point)) continue;
    const p = ix.map((i) => Number(a.point[i]) * axes[i].nmPer);
    if (p.every(Number.isFinite)) out.push(p.map((v) => Math.round(v)));
  }
  return out;
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

/** The answer key from one or more annotation layers, each marked as cuts or merges. */
function keyTargets(key) {
  if (!key || typeof key !== 'object') fail(400, 'No answer key was sent.');
  const parts = Array.isArray(key.layers) ? key.layers : [{ layer: key.layer, kind: key.kind }];
  if (!parts.length) fail(400, 'Pick at least one layer with the places marked.');
  const out = [];
  for (const part of parts) {
    const kind = part && part.kind === 'merge' ? 'merge' : 'cut';
    for (const pt of layerPointsNm(part && part.layer, key.dims)) out.push([pt[0], pt[1], pt[2], kind]);
  }
  return out;
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
  const reach = T.map((t) => P.map((p, pi) => [dist(t, p), pi]).filter(([d]) => d <= tol)
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
    if (T.some((t, ti) => !foundTargets.has(ti) && dist(t, p) <= 2 * tol)) close++;
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
    const near = P.length ? Math.min(...P.map((p) => dist(t, p))) : null;
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

function tierFor(found, th) {
  if (!th || !th.gold || !(found > 0)) return null;
  if (found >= th.gold) return 'gold';
  if (found >= th.silver) return 'silver';
  if (found >= th.bronze) return 'bronze';
  return null;
}

/** The most points one answer may carry: set per hunt, else three per merger (at least ten). */
function maxPoints(h) {
  // Players put one gem on each place (Ames 2026-10-21), so an answer holds as many gems as
  // there are places unless the admin allows spares. The cap stops a player covering the cell.
  return posInt(h && h.max_points) || Math.max(1, posInt(h && h.target_count));
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
    // The cells, like the view, only once the hunt starts: nobody hunts early.
    cells: open ? cells : [], cell_count: cells.length,
    announce_at: h.announce_at, start_at: h.start_at, end_at: h.end_at, phase: p,
    target_count: posInt(h.target_count), spots: { cut: kinds.cut, merge: kinds.merge },
    tolerance_um: Math.round((Number(h.tolerance_nm) || DEFAULT_TOLERANCE_NM) / 100) / 10,
    max_points: maxPoints(h), max_submissions: posInt(h.max_submissions) || DEFAULT_MAX_SUBMISSIONS,
    tiers: thresholds(h), awarded: !!h.awarded_at,
    view: open ? startView(h) : null,
  };
}

/** Best per player (the earliest answer that reached it breaks ties), best first. */
function leaderboard(subs) {
  const best = new Map();
  for (const s of Array.isArray(subs) ? subs : []) {
    const was = best.get(s.user_id);
    const at = ms(s.created_at);
    if (!was || s.found > was.found || (s.found === was.found && at < was.atMs)) best.set(s.user_id, { user_id: s.user_id, found: s.found, at: s.created_at, atMs: at });
  }
  return [...best.values()].sort((a, b) => b.found - a.found || a.atMs - b.atMs)
    .map(({ atMs, ...b }) => b);
}

// ── Notifications ─────────────────────────────────────────────────────────

const NOTE_KINDS = ['announce', 'start', 'end'];

/** The picture a note carries (null for none): set per note in the Admin Hub, one picture can serve several. */
function noteImage(h, kind) {
  const v = h && h.notif_images && h.notif_images[kind];
  return v && v.image_url ? { image_url: v.image_url, thumbnail_url: v.thumbnail_url || v.image_url } : { image_url: null, thumbnail_url: null };
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
      body: `${h.title} starts in ${inWords(start - ms(h.announce_at))} and runs for ${runs}. ${spotWords(kinds)} hidden on ${whereWords(h)}: drop a gold gem on each one you find, and submit. Gold, silver and bronze Achievements go to the best hunters.` });
  }
  rows.push({ kind: 'start', send_at: h.start_at,
    title: `${TITLE_PREFIX} is on: ${h.title}`,
    body: `${spotWords(kinds)} hidden on ${whereWords(h)}. Open the Hunt, drop a gold gem on each one you find, and submit. You have ${runs}.` });
  rows.push({ kind: 'end', send_at: h.end_at,
    title: `${TITLE_PREFIX} is over: ${h.title}`,
    body: 'Time is up. Open the Hunt for the awards ceremony: the gold, silver and bronze hunters get their Achievements now.' });
  return rows.map((r) => ({ ...r, title: r.title.slice(0, 120), ...noteImage(h, r.kind) }));
}

// ── Achievements ──────────────────────────────────────────────────────────

const LINES = {
  gold: 'Two cells walked into a bar, and you told them apart.',
  silver: 'So close to gold, you could merge with it.',
  bronze: 'Every merger you spot is one less cell living a double life.',
};

/** The special Achievement for one tier of one hunt. */
function badgeRow(h, tier, th, site) {
  const n = posInt(h.target_count);
  const k = th[tier];
  const count = k >= n ? `every one of the ${n} mergers found` : `${k} or more of the ${n} mergers found`;
  const a = h.art && h.art[tier];
  const own = typeof a === 'string' ? a : a && a.image_url;
  const art = typeof own === 'string' && /^https:\/\//.test(own) ? own : `${site}/hunt/${tier}.svg`;
  const thumb = a && typeof a === 'object' && typeof a.thumbnail_url === 'string' && /^https:\/\//.test(a.thumbnail_url) && own === art ? a.thumbnail_url : art;
  return {
    slug: `hunt-${h.id}-${tier}`,
    name: `${h.title}: ${TIER_NAME[tier]}`.slice(0, 80),
    description: `${TIER_NAME[tier]} in ${h.title}, ${count}. ${LINES[tier]}`.slice(0, 300),
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
    if (b) out[t] = { name: b.name, image: b.thumbnail_url || b.image_url || `${site}/hunt/${t}.svg` };
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
  if ('tiers' in f) out.tiers = { gold: posInt(f.tiers && f.tiers.gold), silver: posInt(f.tiers && f.tiers.silver), bronze: posInt(f.tiers && f.tiers.bronze) };
  if ('art' in f) {
    // Per tier: { badge_id } (a special Achievement already made), { image_url, thumbnail_url } (the hunt's own,
    // with that picture), or nothing (the hunt's own, with the game's medal). A bare https string is a picture.
    const a = f.art || {};
    const https = (v) => typeof v === 'string' && /^https:\/\/\S{4,800}$/.test(v);
    out.art = {};
    for (const t of TIERS) {
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
    case 'hunt.submit': return submit(args, ctx);
    case 'hunt.list': needAdmin(); return adminList(ctx);
    case 'hunt.read': needAdmin(); return adminRead(args, ctx);
    case 'hunt.save': needAdmin(); return save(args, ctx);
    case 'hunt.now': needAdmin(); return nowAction(args, ctx);
    case 'hunt.cancel': needAdmin(); return cancel(args, ctx);
    case 'hunt.delete': needAdmin(); return remove(args, ctx);
    case 'hunt.award': needAdmin(); return awardAction(args, ctx);
    case 'hunt.rescore': needAdmin(); return rescore(args, ctx);
    case 'hunt.notes': needAdmin(); return notesPreview(args, ctx);
    case 'hunt.test': needAdmin(); return testOpen(args, ctx);
    case 'hunt.test_submit': needAdmin(); return testSubmit(args, ctx);
    default: fail(400, 'Unknown Hunt action.');
  }
}

async function getHunt(db, id) {
  const h = await db.hunt(posInt(id));
  if (!h) fail(404, 'No such Hunt.');
  return h;
}

/** The hunts a player can see, with their own result and the top ten. Ends any hunt whose time is up. */
async function current(ctx) {
  const { db, me, now = new Date() } = ctx;
  const since = new Date(now.getTime() - SHOW_ENDED_DAYS * DAY).toISOString();
  // An admins only hunt (for testing) is never shown to players.
  const rows = (await db.visibleHunts(since)).filter((h) => visible(h, now) && (!h.admins_only || ctx.isAdmin));
  const hunts = [];
  for (const h of rows) {
    if (phase(h, now) === 'ended' && !h.awarded_at) {
      try { const r = await finalize(h, ctx); if (r) h.awarded_at = now.toISOString(); }
      catch (e) { console.warn('[hunt] awards for', h.id, 'failed:', e && e.message); }
    }
    h._kinds = kindCounts(await db.key(h.id));
    const subs = await db.submissions(h.id);
    const board = leaderboard(subs);
    const th = thresholds(h);
    const top = board.slice(0, 10);
    const mineBest = board.find((b) => b.user_id === me.id);
    const names = await db.names([...new Set([...top.map((b) => b.user_id), me.id])]);
    const mine = subs.filter((s) => s.user_id === me.id).length;
    const cap = posInt(h.max_submissions) || DEFAULT_MAX_SUBMISSIONS;
    hunts.push({
      ...publicHunt(h, now), prizes: await prizesFor(h, db, ctx.site),
      you: { best: mineBest ? mineBest.found : 0, submissions: mine, left: Math.max(0, cap - mine), tier: mineBest ? tierFor(mineBest.found, th) : null,
        rank: mineBest ? board.indexOf(mineBest) + 1 : 0 },
      board: top.map((b, i) => ({ rank: i + 1, name: names[b.user_id] || 'Player', found: b.found, at: b.at, tier: tierFor(b.found, th), you: b.user_id === me.id })),
      players: board.length,
      winners: TIERS.reduce((o, t) => { o[t] = board.filter((b) => tierFor(b.found, th) === t).length; return o; }, {}),
    });
  }
  return { now: now.toISOString(), hunts };
}

async function submit(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const h = await getHunt(db, args.id);
  const p = phase(h, now);
  if (p === 'announced') fail(409, 'The Hunt has not started yet.');
  if (p !== 'live') fail(409, 'This Hunt is over.');
  const mine = await db.mySubmissions(h.id, me.id);
  const cap = posInt(h.max_submissions) || DEFAULT_MAX_SUBMISSIONS;
  if (mine.length >= cap) fail(409, `You have sent all ${cap} of your answers for this Hunt.`);
  const points = layerPointsNm(args.layer, args.dims);
  if (!points.length) fail(400, 'Drop a gem on each merger you find, then submit.');
  const most = maxPoints(h);
  if (points.length > most) fail(400, `An answer can have at most ${most} gems. Take some away, then submit again.`);
  const targets = await db.key(h.id);
  const r = score(targets, points, h.tolerance_nm);
  await db.addSubmission({ hunt_id: h.id, user_id: me.id, points, found: r.found, close: r.close });
  const best = Math.max(r.found, ...mine.map((m) => m.found));
  return { found: r.found, of: targets.length, close: r.close, best, points: points.length,
    left: Math.max(0, cap - mine.length - 1), tier: tierFor(best, thresholds(h)) };
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
  return notificationRows(h).map(({ kind, title, body, send_at, image_url, thumbnail_url }) => ({ kind, title, body, send_at, image_url, thumbnail_url }));
}

// ── An admin's test run ───────────────────────────────────────────────────
// Ames 2026-10-21: admins play a hunt to test it, at any time (a draft, a
// scheduled one before its start, a running one). The hunt opens as if it
// were running, for that admin only; answers are scored against the real key
// and never kept, so a test never shows on the board or wins an Achievement.
// Admins can also play a running hunt for real, like anyone.

const TEST_ANSWERS = 99;

async function testOpen(args, ctx) {
  const { db, now = new Date() } = ctx;
  const h = await getHunt(db, args.id);
  const key = await db.key(h.id);
  if (!h.view || !key.length) fail(409, 'Read the answer key and save the Hunt before trying it.');
  h._kinds = kindCounts(key);
  const cells = cleanCells(h.cells);
  return { ...publicHunt(h, now), prizes: await prizesFor(h, db, ctx.site), phase: 'live', test: true, cells, cell_count: cells.length, view: startView(h),
    you: { best: 0, submissions: 0, left: TEST_ANSWERS, tier: null, rank: 0 }, board: [], players: 0, winners: { gold: 0, silver: 0, bronze: 0 } };
}

async function testSubmit(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args.id);
  const points = layerPointsNm(args.layer, args.dims);
  if (!points.length) fail(400, 'Drop a gem on each merger you find, then submit.');
  const most = maxPoints(h);
  if (points.length > most) fail(400, `An answer can have at most ${most} gems. Take some away, then submit again.`);
  const targets = await db.key(h.id);
  const r = score(targets, points, h.tolerance_nm);
  return { found: r.found, of: targets.length, close: r.close, best: r.found, points: points.length, left: TEST_ANSWERS,
    tier: tierFor(r.found, thresholds(h)), test: true, tolerance_um: Math.round((Number(h.tolerance_nm) || DEFAULT_TOLERANCE_NM) / 100) / 10,
    mergers: testDetail(targets, points, h.tolerance_nm) };
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
  const winners = board.map((b) => ({ ...b, tier: tierFor(b.found, th) })).filter((b) => b.tier);
  const counts = { gold: 0, silver: 0, bronze: 0 };
  if (!winners.length) return { awarded: 0, ...counts };
  const badges = {};
  for (const tier of TIERS) {
    if (!winners.some((w) => w.tier === tier)) continue;
    // A special Achievement the admin chose, else (or if it was deleted) the hunt's own.
    const id = chosenBadge(row, tier);
    const chosen = id ? await db.badgeById(id) : null;
    badges[tier] = chosen || await db.upsertBadge(badgeRow(row, tier, th, site));
  }
  const held = await db.held(Object.values(badges).map((b) => b.id));
  const fresh = winners.filter((w) => !held.has(`${badges[w.tier].id}:${w.user_id}`));
  await db.award(winners.map((w) => ({ badge_id: badges[w.tier].id, user_id: w.user_id, awarded_by: row.created_by || null,
    reason: `Found ${w.found} of ${row.target_count} mergers in ${row.title}` })));
  for (const w of winners) counts[w.tier]++;
  if (fresh.length && notify) {
    await notify(fresh.map((w) => ({ user_id: w.user_id, title: `🏅 New Achievement: ${badges[w.tier].name}`,
      body: `${badges[w.tier].description} You found ${w.found} of ${row.target_count}.`, image: badges[w.tier].image_url })));
  }
  // An admins only hunt is a test: no chat line, which every player would see.
  if (chatAward && !row.admins_only) for (const w of fresh) { try { await chatAward(w.user_id, badges[w.tier]); } catch (e) { /* a chat line is a courtesy */ } }
  return { awarded: winners.length, fresh: fresh.length, ...counts };
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
 */
async function syncNotifications(h, ctx) {
  const { db, me, now = new Date() } = ctx;
  const t = now.getTime();
  const ids = { ...(h.notif_ids || {}) };
  if (h.status === 'scheduled' && h.id && !h._kinds) h = { ...h, _kinds: kindCounts(await db.key(h.id)) };
  const wanted = h.status === 'scheduled' ? notificationRows(h) : [];
  const wantedKinds = new Set(wanted.map((r) => r.kind));
  for (const kind of Object.keys(ids)) {
    if (wantedKinds.has(kind)) continue;
    const n = await db.notification(ids[kind]);
    if (n && ms(n.send_at) > t) await db.deleteNotification(ids[kind]);
    if (!n || ms(n.send_at) > t) delete ids[kind];
  }
  for (const row of wanted) {
    // An announcement for a hunt that has already started would only confuse.
    if (row.kind === 'announce' && ms(h.start_at) <= t) continue;
    const existing = ids[row.kind] ? await db.notification(ids[row.kind]) : null;
    const picture = { image_url: row.image_url, thumbnail_url: row.thumbnail_url };
    if (existing && ms(existing.send_at) <= t) {            // already out: the picture only
      if ((existing.image_url || null) !== picture.image_url || (existing.thumbnail_url || null) !== picture.thumbnail_url) await db.patchNotification(existing.id, picture);
      continue;
    }
    const sendAt = ms(row.send_at) <= t ? now.toISOString() : new Date(ms(row.send_at)).toISOString();
    // Admins only (a test): the notes go to the admin who made the hunt, and never to chat.
    const audience = h.admins_only ? { target_type: 'user', target_id: h.created_by || me.id, post_to_chat: false } : { target_type: 'all', target_id: null, post_to_chat: true };
    const fields = { title: row.title, body: row.body, send_at: sendAt, ...audience, ...picture };
    if (existing) await db.patchNotification(existing.id, fields);
    else ids[row.kind] = (await db.insertNotification({ ...fields, created_by: me.id })).id;
  }
  return ids;
}

async function save(args, ctx) {
  const { db, me, now = new Date() } = ctx;
  const fields = cleanFields(args.fields);
  // Saved from a test site: admins only, whatever the box says (the notes stay off the players' bells and chat).
  if (ctx.testSite) fields.admins_only = true;
  const status = args.status === 'scheduled' ? 'scheduled' : args.status === 'draft' ? 'draft' : null;
  let targets = null;
  if (args.key) {
    targets = keyTargets(args.key);
    if (!targets.length) fail(400, 'Those layers have no points. Mark each place with a point.');
    if (targets.length > MAX_TARGETS) fail(400, `At most ${MAX_TARGETS} mergers per Hunt.`);
    fields.target_count = targets.length;
  }
  if (args.view) fields.view = stripView(args.view);
  let h = args.id ? await getHunt(db, args.id) : null;
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
  if (targets) await db.setKey(h.id, targets);
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
async function rescore(args, ctx) {
  const { db } = ctx;
  const h = await getHunt(db, args.id);
  const targets = await db.key(h.id);
  const subs = await db.allSubmissions(h.id);
  let changed = 0;
  for (const s of subs) {
    const r = score(targets, s.points, h.tolerance_nm);
    if (r.found !== s.found || r.close !== s.close) { await db.patchSubmission(s.id, { found: r.found, close: r.close }); changed++; }
  }
  return { rescored: subs.length, changed };
}

/** What the Admin Hub shows for one hunt. */
async function adminView(h, ctx) {
  const { db, now = new Date() } = ctx;
  const board = leaderboard(await db.submissions(h.id));
  const notes = {};
  for (const [kind, id] of Object.entries(h.notif_ids || {})) {
    const n = await db.notification(id);
    if (n) notes[kind] = { id: n.id, send_at: n.send_at, sent: ms(n.send_at) <= now.getTime(),
      title: n.title || '', body: n.body || '', image_url: n.image_url || null, thumbnail_url: n.thumbnail_url || null };
  }
  const { view, ...rest } = h;
  // A start this close to a place gives it away: the Admin Hub warns (twice the tolerance).
  const gap = startGapUm(h, await db.key(h.id));
  const tolUm = (Number(h.tolerance_nm) || DEFAULT_TOLERANCE_NM) / 1000;
  return { ...rest, has_view: !!view, phase: phase(h, now), thresholds: thresholds(h), max_points_used: maxPoints(h),
    players: board.length, notes, start_gap_um: gap, start_on_answer: gap != null && gap <= 2 * tolUm };
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
  const th = thresholds(h);
  const tries = subs.reduce((m, s) => { m[s.user_id] = (m[s.user_id] || 0) + 1; return m; }, {});
  return { ...(await adminView(h, ctx)), view: h.view || null, targets,
    board: board.map((b, i) => ({ rank: i + 1, name: names[b.user_id] || 'Player', user_id: b.user_id, found: b.found, at: b.at,
      tries: tries[b.user_id] || 0, tier: tierFor(b.found, th) })) };
}

// ── The database ──────────────────────────────────────────────────────────

function restDb(sb) {
  const enc = encodeURIComponent;
  const merge = { Prefer: 'resolution=merge-duplicates,return=representation' };
  const one = async (p) => (await p)[0] || null;
  return {
    hunts: () => sb('hunts?select=*&order=start_at.desc.nullslast&limit=200'),
    visibleHunts: (since) => sb(`hunts?status=eq.scheduled&end_at=gte.${enc(since)}&select=*&order=start_at.asc&limit=20`),
    hunt: (id) => one(sb(`hunts?id=eq.${id}&select=*&limit=1`)),
    insertHunt: (row) => one(sb('hunts', { method: 'POST', body: JSON.stringify(row) })),
    patchHunt: (id, row) => one(sb(`hunts?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) })),
    deleteHunt: (id) => sb(`hunts?id=eq.${id}`, { method: 'DELETE' }),
    claimAward: (id, at) => one(sb(`hunts?id=eq.${id}&awarded_at=is.null`, { method: 'PATCH', body: JSON.stringify({ awarded_at: at }) })),
    key: async (id) => { const r = await one(sb(`hunt_keys?hunt_id=eq.${id}&select=targets&limit=1`)); return (r && r.targets) || []; },
    setKey: (id, targets) => sb('hunt_keys?on_conflict=hunt_id', { method: 'POST', headers: merge,
      body: JSON.stringify({ hunt_id: id, targets, updated_at: new Date().toISOString() }) }),
    submissions: (id) => sb(`hunt_submissions?hunt_id=eq.${id}&select=user_id,found,created_at&order=created_at.asc&limit=10000`),
    allSubmissions: (id) => sb(`hunt_submissions?hunt_id=eq.${id}&select=id,points,found,close&limit=10000`),
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
    notification: (id) => one(sb(`notifications?id=eq.${posInt(id)}&select=id,send_at,title,body,image_url,thumbnail_url&limit=1`)),
    insertNotification: (row) => one(sb('notifications', { method: 'POST', body: JSON.stringify(row) })),
    patchNotification: (id, row) => one(sb(`notifications?id=eq.${posInt(id)}`, { method: 'PATCH', body: JSON.stringify(row) })),
    deleteNotification: (id) => sb(`notifications?id=eq.${posInt(id)}`, { method: 'DELETE' }),
    upsertBadge: (row) => one(sb('special_badges?on_conflict=slug', { method: 'POST', headers: merge, body: JSON.stringify(row) })),
    badgeById: (id) => one(sb(`special_badges?id=eq.${posInt(id)}&select=id,name,description,slug,image_url,thumbnail_url&limit=1`)),
    held: async (badgeIds) => {
      if (!badgeIds.length) return new Set();
      const rows = await sb(`special_badge_awards?badge_id=in.(${badgeIds.join(',')})&select=badge_id,user_id&limit=10000`);
      return new Set(rows.map((r) => `${r.badge_id}:${r.user_id}`));
    },
    award: (rows) => (rows.length ? sb('special_badge_awards?on_conflict=badge_id,user_id', { method: 'POST', headers: merge, body: JSON.stringify(rows) }) : []),
  };
}

module.exports = {
  huntAction, restDb, layerPointsNm, keyTargets, startView, startGapUm, kindCounts, spotWords, prizesFor, score, match, testDetail, thresholds, tierFor, maxPoints, phase, visible, inWords,
  publicHunt, leaderboard, notificationRows, badgeRow, stripView, cleanFields, cleanCells, finalize,
  syncNotifications, TITLE_PREFIX, TIERS, DEFAULT_TOLERANCE_NM,
};
