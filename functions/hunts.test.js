'use strict';
// The Hunt's rules (hunts.js), with an in-memory database in place of Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./hunts');

const DIMS = { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] };
const pt = (x, y, z) => ({ type: 'point', point: [x, y, z], id: `${x}-${y}-${z}` });
const clone = (o) => JSON.parse(JSON.stringify(o));
const layer = (points, extra = {}) => ({ type: 'annotation', name: 'Hunt', source: 'local://annotations', annotations: points, ...extra });
const ADMIN = { id: '11111111-1111-4111-8111-111111111111', username: 'ames' };
const P1 = { id: '22222222-2222-4222-8222-222222222222', username: 'nseraf' };
const P2 = { id: '33333333-3333-4333-8333-333333333333', username: 'annkri' };
const P3 = { id: '44444444-4444-4444-8444-444444444444', username: 'krzysztof' };
const iso = (t) => new Date(t).toISOString();

// ── Points ────────────────────────────────────────────────────────────────

test('points come out in nanometres, by axis name', () => {
  assert.deepEqual(H.layerPointsNm(layer([pt(100, 200, 30)]), DIMS), [[400, 800, 1200]]);
  // A link whose dimensions are listed z, y, x keeps each value on its axis.
  const zyx = { z: [4e-8, 'm'], y: [4e-9, 'm'], x: [4e-9, 'm'] };
  assert.deepEqual(H.layerPointsNm(layer([pt(30, 200, 100)]), zyx), [[400, 800, 1200]]);
});

test("a layer's own output dimensions win over the view's", () => {
  const l = layer([pt(1000, 1000, 100)], { source: { url: 'local://annotations', transform: { outputDimensions: { x: [1e-9, 'm'], y: [1e-9, 'm'], z: [1e-9, 'm'] } } } });
  assert.deepEqual(H.layerPointsNm(l, DIMS), [[1000, 1000, 100]]);
});

test('lines and boxes are not points; a moved layer is refused', () => {
  const l = layer([pt(1, 1, 1), { type: 'line', pointA: [0, 0, 0], pointB: [1, 1, 1] }, { type: 'axis_aligned_bounding_box', pointA: [0, 0, 0], pointB: [2, 2, 2] }]);
  assert.equal(H.layerPointsNm(l, DIMS).length, 1);
  const moved = layer([pt(1, 1, 1)], { source: { url: 'local://annotations', transform: { matrix: [[1, 0, 0, 5], [0, 1, 0, 0], [0, 0, 1, 0]], outputDimensions: DIMS } } });
  assert.throws(() => H.layerPointsNm(moved, DIMS), /transform/);
  assert.throws(() => H.layerPointsNm(layer([pt(1, 1, 1)]), { x: [4, 'nm'], y: [4, 'nm'], z: [40, 'nm'] }), /metres/);
});

// ── Scoring ───────────────────────────────────────────────────────────────

test('a point finds the merger it is near, once', () => {
  const targets = [[0, 0, 0], [10000, 0, 0]];
  assert.deepEqual(H.score(targets, [[500, 0, 0]], 3000), { found: 1, close: 0 });
  // Two points on the same merger still find one.
  assert.equal(H.score(targets, [[100, 0, 0], [200, 0, 0]], 3000).found, 1);
  // One point between two mergers finds one of them, not both.
  assert.equal(H.score([[0, 0, 0], [2000, 0, 0]], [[1000, 0, 0]], 3000).found, 1);
  assert.equal(H.score(targets, [[0, 0, 0], [10000, 0, 0]], 3000).found, 2);
});

test('the pairing is the largest possible, whatever the order of the points', () => {
  // A is nearest merger 1 but also reaches merger 2; B reaches only merger 1.
  const targets = [[0, 0, 0], [4000, 0, 0]];
  const A = [1000, 0, 0], B = [-2000, 0, 0];
  assert.equal(H.score(targets, [A, B], 3000).found, 2);
  assert.equal(H.score(targets, [B, A], 3000).found, 2);
});

test('close counts points near a merger not yet found, never the ones that found it', () => {
  const targets = [[0, 0, 0], [50000, 0, 0]];
  const r = H.score(targets, [[0, 0, 0], [54000, 0, 0], [90000, 0, 0]], 3000);
  assert.deepEqual(r, { found: 1, close: 1 });
});

// ── Tiers, time, words ────────────────────────────────────────────────────

test('tiers default to all, two thirds and one third; gems count too; each player has a budget of gems', () => {
  assert.deepEqual(H.thresholds({ target_count: 5 }), { gold: 5, silver: 4, bronze: 2 });
  assert.deepEqual(H.thresholds({ target_count: 3 }), { gold: 3, silver: 2, bronze: 1 });
  assert.deepEqual(H.thresholds({ target_count: 1 }), { gold: 1, silver: 1, bronze: 1 });
  assert.deepEqual(H.thresholds({ target_count: 6, tiers: { gold: 5, silver: 3, bronze: 1 } }), { gold: 5, silver: 3, bronze: 1 });
  // Nonsense is clamped: silver never above gold, bronze at least one.
  assert.deepEqual(H.thresholds({ target_count: 4, tiers: { gold: 9, silver: 9, bronze: 0 } }), { gold: 4, silver: 4, bronze: 2 });
  const th = H.thresholds({ target_count: 5 });
  assert.deepEqual([5, 4, 3, 2, 1, 0].map((f) => H.tierFor(f, th)), ['gold', 'silver', 'bronze', 'bronze', null, null]);
  // Gems: the problems and half again, at least two spare; the admin can set it.
  assert.equal(H.maxPoints({ target_count: 3 }), 5);     // the problems and half again, at least 2 spare
  assert.equal(H.maxPoints({ target_count: 20 }), 30);   // was 40 (Ames 2026-10-23: "a little high")
  assert.equal(H.maxPoints({ target_count: 1 }), 3);
  assert.equal(H.maxPoints({ target_count: 7, max_points: 12 }), 12);
  // Gold allows the problems and a third more gems by default; the other medals no limit unless set.
  assert.deepEqual(H.gemLimits({ target_count: 3 }), { gold: 4, silver: 0, bronze: 0 });
  assert.deepEqual(H.gemLimits({ target_count: 3, tiers: { gold_gems: 3, silver_gems: 5, bronze_gems: 99 } }), { gold: 3, silver: 5, bronze: 5 });   // capped at the 5 gems
  const t3 = H.thresholds({ target_count: 3 }), g3 = H.gemLimits({ target_count: 3 });
  assert.equal(H.tierFor(3, t3, 4, g3), 'gold');
  assert.equal(H.tierFor(3, t3, 5, g3), 'silver');   // all found, but too many gems for gold
  assert.equal(H.tierFor(1, t3, 6, g3), 'bronze');
});

test('phases follow the clock; players see a hunt from its announcement to a week after', () => {
  const h = { status: 'scheduled', announce_at: iso(Date.UTC(2026, 9, 24)), start_at: iso(Date.UTC(2026, 9, 25)), end_at: iso(Date.UTC(2026, 9, 28)) };
  const at = (d, hr = 0) => new Date(Date.UTC(2026, 9, d, hr));
  assert.equal(H.phase(h, at(23)), 'announced'); assert.equal(H.visible(h, at(23)), false);
  assert.equal(H.visible(h, at(24, 1)), true);
  assert.equal(H.phase(h, at(26)), 'live');
  assert.equal(H.phase(h, at(28)), 'ended'); assert.equal(H.visible(h, at(30)), true);
  assert.equal(H.visible(h, new Date(Date.UTC(2026, 10, 5))), false);
  assert.equal(H.phase({ ...h, status: 'draft' }, at(26)), 'draft');
  assert.equal(H.phase({ ...h, status: 'cancelled' }, at(26)), 'cancelled');
});

test('the three notes say when, in words, with no dashes', () => {
  const h = { title: 'The Pinky Hunt', target_count: 1, cells: [{ root: '1' }],
    announce_at: iso(Date.UTC(2026, 9, 23, 14)), start_at: iso(Date.UTC(2026, 9, 25, 14)), end_at: iso(Date.UTC(2026, 9, 28, 14)) };
  const rows = H.notificationRows(h);
  assert.deepEqual(rows.map((r) => r.kind), ['announce', 'start', 'end']);
  assert.match(rows[0].body, /starts in 2 days and runs for 3 days\. 1 merger is hidden on one cell/);
  assert.match(rows[1].title, /^🔎 The Hunt is on: The Pinky Hunt$/);
  assert.match(rows[2].body, /see who placed: Gold, Silver, Bronze and the fastest hunter/);
  assert.doesNotMatch(rows[2].body, /ceremony/);
  for (const r of rows) assert.doesNotMatch(r.title + r.body, /[—–]| - /);
  assert.equal(H.notificationRows({ ...h, announce_at: null }).length, 2);
  assert.equal(H.inWords(3600000 * 5), '5 hours');
  assert.equal(H.inWords(60000 * 20), '20 minutes');
});

test("the players' view loses every annotation layer", () => {
  const v = H.stripView({ dimensions: DIMS, layers: [{ type: 'image', name: 'img' }, { type: 'segmentation', name: 'seg', segments: ['1'] }, layer([pt(1, 2, 3)], { name: 'Mergers' })],
    selectedLayer: { layer: 'Mergers', visible: true }, selection: { layers: {} } });
  assert.deepEqual(v.layers.map((l) => l.name), ['img', 'seg']);
  assert.equal(v.selectedLayer, undefined);
  assert.equal(JSON.stringify(v).includes('point'), false);
});

test('fields are cleaned; bad ones are refused', () => {
  assert.throws(() => H.cleanFields({ title: '  ' }), /title/);
  assert.throws(() => H.cleanFields({ tolerance_nm: 5 }), /tolerance/);
  assert.throws(() => H.cleanFields({ dataset: 'x; drop' }), /dataset/);
  const f = H.cleanFields({ title: 'T', cells: [{ root: '648518346350533705', label: 'a' }, { root: 'nope' }, { root: '648518346350533705' }], art: { gold: 'https://x.org/g.png', silver: 'javascript:alert(1)' } });
  assert.deepEqual(f.cells, [{ root: '648518346350533705', label: 'a' }]);
  assert.deepEqual(f.art, { gold: { image_url: 'https://x.org/g.png', thumbnail_url: 'https://x.org/g.png' } });
});

// ── A whole hunt, with an in-memory database ──────────────────────────────

function fakeDb() {
  const s = { hunts: [], keys: {}, subs: [], notes: [], badges: [], awards: [], seq: 1 };
  const users = { [ADMIN.id]: ADMIN, [P1.id]: P1, [P2.id]: P2, [P3.id]: P3 };
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const db = {
    _s: s,
    hunts: async () => clone(s.hunts),
    visibleHunts: async (since) => clone(s.hunts.filter((h) => h.status === 'scheduled' && Date.parse(h.end_at) >= Date.parse(since))),
    hunt: async (id) => clone(s.hunts.find((h) => h.id === id) || null),
    insertHunt: async (row) => { const h = { id: s.seq++, notif_ids: {}, awarded_at: null, ...clone(row) }; s.hunts.push(h); return clone(h); },
    patchHunt: async (id, row) => { const h = s.hunts.find((x) => x.id === id); Object.assign(h, clone(row)); return clone(h); },
    deleteHunt: async (id) => { s.hunts = s.hunts.filter((h) => h.id !== id); },
    claimAward: async (id, at) => { const h = s.hunts.find((x) => x.id === id); if (!h || h.awarded_at) return null; h.awarded_at = at; return clone(h); },
    key: async (id) => clone(H.splitKey(s.keys[id] || []).targets),
    keyExtras: async (id) => { const k = H.splitKey(s.keys[id] || []); return clone({ edges: k.edges, bounds: k.bounds }); },
    setKey: async (id, t, extras) => {
      const keep = extras || (({ edges, bounds }) => ({ edges, bounds }))(H.splitKey(s.keys[id] || []));
      s.keys[id] = clone(H.joinKey(t, keep));
    },
    submissions: async (id) => clone(s.subs.filter((x) => x.hunt_id === id).map(({ user_id, found, close, created_at }) => ({ user_id, found, close, created_at }))),
    allSubmissions: async (id) => clone(s.subs.filter((x) => x.hunt_id === id)),
    myRun: async (id, uid) => clone([...s.subs].reverse().find((x) => x.hunt_id === id && x.user_id === uid) || null),
    mySubmissions: async (id, uid) => clone(s.subs.filter((x) => x.hunt_id === id && x.user_id === uid)),
    addSubmission: async (row) => { const r = { id: s.seq++, created_at: new Date(Date.UTC(2026, 9, 26) + s.subs.length * 1000).toISOString(), ...clone(row) }; s.subs.push(r); return clone(r); },
    patchSubmission: async (id, row) => { Object.assign(s.subs.find((x) => x.id === id), clone(row)); },
    playerCounts: async (ids) => Object.fromEntries(ids.map((id) => [id, new Set(s.subs.filter((x) => x.hunt_id === id).map((x) => x.user_id)).size])),
    names: async (ids) => Object.fromEntries(ids.map((id) => [id, users[id] ? users[id].username : 'Player'])),
    notification: async (id) => clone(s.notes.find((n) => n.id === Number(id)) || null),
    insertNotification: async (row) => { const n = { id: s.seq++, ...clone(row) }; s.notes.push(n); return clone(n); },
    patchNotification: async (id, row) => { const n = s.notes.find((x) => x.id === Number(id)); Object.assign(n, clone(row)); return clone(n); },
    deleteNotification: async (id) => { s.notes = s.notes.filter((n) => n.id !== Number(id)); },
    huntMedals: async (h) => {
      const tierOf = new Map(s.badges.filter((b) => b.slug.startsWith(`hunt-${h.id}-`)).map((b) => [b.id, b.slug.split('-').pop()]));
      for (const t of ['gold', 'silver', 'bronze', 'fastest']) { const id = h.art && h.art[t] && h.art[t].badge_id; if (id && !tierOf.has(id)) tierOf.set(id, t); }
      return clone(s.awards.filter((a) => tierOf.has(a.badge_id)).map((a) => ({ user_id: a.user_id, tier: tierOf.get(a.badge_id), reason: a.reason || '' })));
    },
    speedAward: async (huntId) => { const b = s.badges.find((x) => x.slug === `hunt-${huntId}-fastest`); const a = b && s.awards.find((x) => x.badge_id === b.id); return a ? clone({ user_id: a.user_id, reason: a.reason }) : null; },
    badgeById: async (id) => clone(s.badges.find((b) => b.id === Number(id)) || null),
    upsertBadge: async (row) => { let b = s.badges.find((x) => x.slug === row.slug); if (b) Object.assign(b, clone(row)); else { b = { id: s.seq++, ...clone(row) }; s.badges.push(b); } return clone(b); },
    held: async (ids) => new Set(s.awards.filter((a) => ids.includes(a.badge_id)).map((a) => `${a.badge_id}:${a.user_id}`)),
    award: async (rows) => { for (const r of rows) if (!s.awards.some((a) => a.badge_id === r.badge_id && a.user_id === r.user_id)) s.awards.push(clone(r)); },
    badgeHolders: async (id) => s.awards.filter((a) => a.badge_id === id).map((a) => ({ user_id: a.user_id })),
    insertReport: async (row) => { const r = { id: s.seq++, status: 'open', created_at: new Date().toISOString(), ...clone(row) }; (s.reports = s.reports || []).push(r); return clone(r); },
    reportsFor: async (huntId, userId) => clone((s.reports || []).filter((r) => r.hunt_id === huntId && (!userId || r.user_id === userId)).reverse()),
    report: async (id) => clone((s.reports || []).find((r) => r.id === id) || null),
    patchReport: async (id, row) => { Object.assign((s.reports || []).find((r) => r.id === id), clone(row)); },
  };
  return db;
}

function harness() {
  const db = fakeDb();
  const bell = [], chat = [];
  const ctx = (me, now, isAdmin = false, huntPublic = true) => ({ db, me, isAdmin, now, huntPublic, site: 'https://pyr.example',
    notify: async (rows) => { bell.push(...rows); }, chatAward: async (uid, badge) => { chat.push([uid, badge.name]); } });
  return { db, bell, chat, ctx };
}

const T0 = Date.UTC(2026, 9, 20, 12);
const at = (hours) => new Date(T0 + hours * 3600000);
const KEY = layer([pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)]);   // nm: [4000,4000,4000] [20000,20000,4000] [36000,4000,8000]
const VIEW = { dimensions: DIMS, position: [1000, 1000, 100], layers: [{ type: 'segmentation', name: 'seg', segments: ['648518346350533705'] }, { ...KEY, name: 'Mergers' }] };

/** Drop gems one at a time, as the game does; the last answer back. */
async function dropAll(id, points, ctx) {
  let r = null;
  for (const [i, p] of points.entries()) r = await H.huntAction('hunt.drop', { id, layer: layer([{ ...p, id: `g${i}-${p.id}` }]), dims: DIMS }, ctx);
  return r;
}

async function makeHunt(h) {
  const admin = h.ctx(ADMIN, at(0), true);
  const draft = await H.huntAction('hunt.save', { fields: { title: 'Pinky Hunt', dataset: 'pinky_nf_v2', description: 'Find them.',
    cells: [{ root: '648518346350533705', label: 'the pyramidal' }], tolerance_nm: 2000,
    announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)) }, key: { layer: KEY, dims: DIMS }, view: VIEW, status: 'draft' }, admin);
  return draft;
}

test('a draft writes no notes; scheduling writes three, at their own times', async () => {
  const h = harness();
  const draft = await makeHunt(h);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.target_count, 3);
  assert.equal(h.db._s.notes.length, 0);
  assert.deepEqual(h.db._s.keys[draft.id].length, 3);
  const sched = await H.huntAction('hunt.save', { id: draft.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  assert.equal(sched.phase, 'announced');
  assert.deepEqual(h.db._s.notes.map((n) => n.send_at), [iso(at(24)), iso(at(48)), iso(at(120))]);
  assert.ok(h.db._s.notes.every((n) => n.target_type === 'all' && n.post_to_chat === true && n.title.startsWith(H.TITLE_PREFIX)));
  // Moving the start moves its note; nothing new is written.
  await H.huntAction('hunt.save', { id: draft.id, fields: { start_at: iso(at(50)) } }, h.ctx(ADMIN, at(2), true));
  assert.equal(h.db._s.notes.length, 3);
  assert.equal(h.db._s.notes[1].send_at, iso(at(50)));
  // The players' view kept no annotation layer.
  assert.equal(JSON.stringify(h.db._s.hunts[0].view).includes('Mergers'), false);
});

test('players see nothing before the announcement, then no view until the start, and never the key', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  assert.equal((await H.huntAction('hunt.current', {}, h.ctx(P1, at(10)))).hunts.length, 0);
  const before = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(30)))).hunts[0];
  assert.equal(before.phase, 'announced');
  assert.equal(before.view, null);
  // The cells come with the view at the start, so nobody hunts early; the count shows before.
  assert.deepEqual(before.cells, []);
  assert.equal(before.cell_count, 1);
  await assert.rejects(H.huntAction('hunt.drop', { id: d.id, layer: layer([pt(1000, 1000, 100)]), dims: DIMS }, h.ctx(P1, at(30))), /not started/);
  const live = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(60)))).hunts[0];
  assert.equal(live.phase, 'live');
  assert.ok(live.view && Array.isArray(live.view.layers));
  assert.deepEqual(live.cells.map((c) => c.root), ['648518346350533705']);
  const text = JSON.stringify(live);
  for (const target of h.db._s.keys[d.id]) assert.equal(text.includes(String(target[0]) + ',' + String(target[1])), false);
  assert.equal(text.includes('targets'), false);
  // Players cannot reach the admin actions.
  await assert.rejects(H.huntAction('hunt.read', { id: d.id }, h.ctx(P1, at(60))), /Admins only/);
  await assert.rejects(H.huntAction('hunt.list', {}, h.ctx(P1, at(60))), /Admins only/);
});

test('each gem is judged as it lands: right, wrong, or found already; a run ends when all are found or the gems run out', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const p1 = h.ctx(P1, at(60));
  const one = (p, id, c = p1) => H.huntAction('hunt.drop', { id: d.id, layer: layer([{ ...p, id }]), dims: DIMS }, c);
  const r1 = await one(pt(1010, 1000, 100), 'a');      // right: the first merger
  assert.deepEqual(r1.drop, { id: 'a', hit: true, kind: 'cut' });
  assert.deepEqual([r1.run.found, r1.run.of, r1.run.gems_used, r1.run.gems_left, r1.run.done], [1, 3, 1, 4, false]);
  assert.equal(r1.nearest_um, undefined);               // a player never hears how near a miss was
  const r2 = await one(pt(1, 1, 1), 'b');               // wrong
  assert.equal(r2.drop.hit, false);
  assert.equal(r2.run.gems_left, 3);
  const r3 = await one(pt(1020, 1000, 100), 'c');       // the first merger again: no gem used
  assert.equal(r3.drop.already, true);
  assert.equal(r3.run.gems_used, 2);
  await one(pt(5000, 5050, 100), 'd');
  const r5 = await one(pt(9000, 1000, 200), 'e');
  assert.deepEqual([r5.run.found, r5.run.gems_used, r5.run.done, r5.run.tier], [3, 4, true, null]);   // the medal is given at the end
  await assert.rejects(one(pt(2, 2, 2), 'f'), /found them all/);
  // The run is one row, every gem in order.
  const rows = h.db._s.subs.filter((x) => x.user_id === P1.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].found, 3);
  assert.equal(rows[0].close, 4);
  assert.deepEqual(rows[0].points.map((x) => x.id), ['a', 'b', 'd', 'e']);
  // Out of gems: five misses end a run.
  const p2 = h.ctx(P2, at(61));
  for (let i = 0; i < 5; i++) await one(pt(1, i + 1, 1), 'm' + i, p2);
  await assert.rejects(one(pt(1000, 1000, 100), 'late', p2), /used all your gems/);
  // One gem at a time.
  await assert.rejects(H.huntAction('hunt.drop', { id: d.id, layer: layer([pt(1, 1, 1), pt(2, 2, 2)]), dims: DIMS }, h.ctx(P3, at(61))), /one gem at a time/);
  // Your run comes back with the hunt, so the game can put your gems back.
  const cur = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(62)))).hunts[0];
  assert.deepEqual([cur.you.found, cur.you.gems_used, cur.you.done, cur.you.tier, cur.you.rank], [3, 4, true, null, 1]);
  assert.deepEqual(cur.you.drops.map((x) => [x.id, x.hit]), [['a', true], ['b', false], ['d', true], ['e', true]]);
  assert.deepEqual(cur.you.drops[0].at, [1010, 1000, 100]);
  assert.deepEqual(cur.board.map((b) => [b.found, b.gems]), [[3, 4], [0, 5]]);
  assert.equal(cur.board[0].name, 'nseraf');
  assert.equal(cur.budget, 5);
  // The old answer button is gone.
  await assert.rejects(H.huntAction('hunt.submit', { id: d.id, layer: KEY, dims: DIMS }, p1), /judges each gem/);
});

test('at the end the awards are given once, the speed award too, with a bell note each and one results post in chat', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  // Nseraf opens the Hunt at hour 60 and finds all three by 60:30; P2 finds two; P3 one miss.
  await H.huntAction('hunt.start', { id: d.id }, h.ctx(P1, at(60)));
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100)], h.ctx(P1, at(60.25)));
  await dropAll(d.id, [pt(9000, 1000, 200)], h.ctx(P1, at(60.5)));
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100)], h.ctx(P2, at(61)));
  await dropAll(d.id, [pt(1, 1, 1)], h.ctx(P3, at(62)));
  // Before the end, an admin cannot award.
  await assert.rejects(H.huntAction('hunt.award', { id: d.id }, h.ctx(ADMIN, at(100), true)), /not ended/);
  const after = await H.huntAction('hunt.current', {}, h.ctx(P3, at(121)));
  const hunt = after.hunts[0];
  assert.equal(hunt.phase, 'ended'); assert.equal(hunt.awarded, true);
  assert.deepEqual(hunt.winners, { gold: 1, silver: 1, bronze: 0 });
  assert.deepEqual(h.db._s.badges.map((b) => b.slug).sort(), [`hunt-${d.id}-fastest`, `hunt-${d.id}-gold`, `hunt-${d.id}-silver`]);
  assert.equal(h.db._s.badges.find((b) => b.slug.endsWith('gold')).name, 'Pinky Hunt: Gold');
  assert.equal(h.db._s.badges.find((b) => b.slug.endsWith('gold')).image_url, 'https://pyr.example/hunt/gold.png');
  const speed = h.db._s.badges.find((b) => b.slug.endsWith('fastest'));
  assert.equal(speed.image_url, 'https://pyr.example/hunt/fastest.png');
  assert.match(speed.description, /every problem found in 30m 00s/);
  assert.equal(h.db._s.awards.length, 3);
  assert.equal(h.db._s.awards.find((a) => a.badge_id === speed.id).user_id, P1.id);
  assert.deepEqual(h.bell.map((b) => b.title).sort(), ['🏅 New Achievement: Pinky Hunt: Fastest', '🏅 New Achievement: Pinky Hunt: Gold', '🏅 New Achievement: Pinky Hunt: Silver']);
  // Chat hears it once: the results post, to everyone, with the default picture.
  assert.equal(h.chat.length, 0);
  const results = h.db._s.notes.filter((n) => /results/.test(n.title));
  assert.equal(results.length, 1);
  assert.equal(results[0].title, '🔎 The Hunt results: Pinky Hunt');
  assert.ok(results[0].target_type === 'all' && results[0].post_to_chat === true && results[0].image_url === 'https://pyr.example/hunt/gold.png');
  assert.match(results[0].body, /^Congratulations to all 3 hunters who took part! Gold: nseraf\. Silver: .+\. Fastest: nseraf, all 3 in 30m 00s\.$/);
  // The ceremony lists everyone, and who was fastest.
  assert.equal(hunt.board.length, 3);
  assert.equal(hunt.fastest.name, 'nseraf');
  assert.match(hunt.fastest.reason, /All 3 found in 30m 00s, the fastest in Pinky Hunt/);
  // Others opening the game later change nothing.
  await H.huntAction('hunt.current', {}, h.ctx(P1, at(122)));
  await H.huntAction('hunt.current', {}, h.ctx(P2, at(123)));
  assert.equal(h.db._s.awards.length, 3); assert.equal(h.bell.length, 3);
  assert.equal(h.db._s.notes.filter((n) => /results/.test(n.title)).length, 1);
  // No more gems after the end.
  await assert.rejects(H.huntAction('hunt.drop', { id: d.id, layer: layer([pt(1, 1, 1)]), dims: DIMS }, h.ctx(P3, at(125))), /over/);
});

test('one try: opening the Hunt starts a run once; if nobody finds all, the speed award goes to the quickest of those who found the most', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const s1 = await H.huntAction('hunt.start', { id: d.id }, h.ctx(P1, at(60)));
  assert.equal(s1.run.started_at, iso(at(60)));
  const s2 = await H.huntAction('hunt.start', { id: d.id }, h.ctx(P1, at(70)));   // a second open: the clock does not restart
  assert.equal(s2.run.started_at, iso(at(60)));
  assert.equal(h.db._s.subs.filter((x) => x.user_id === P1.id).length, 1);
  // P1: two found in 2 hours. P2: two found in 1 hour. P3: one in 5 minutes.
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100)], h.ctx(P1, at(62)));
  await H.huntAction('hunt.start', { id: d.id }, h.ctx(P2, at(64)));
  await dropAll(d.id, [pt(1000, 1000, 100), pt(1, 1, 1), pt(9000, 1000, 200)], h.ctx(P2, at(65)));
  await H.huntAction('hunt.start', { id: d.id }, h.ctx(P3, at(66)));
  await dropAll(d.id, [pt(1000, 1000, 100)], h.ctx(P3, at(66 + 5 / 60)));
  await H.huntAction('hunt.current', {}, h.ctx(P3, at(121)));
  const speed = h.db._s.badges.find((b) => b.slug === `hunt-${d.id}-fastest`);
  assert.equal(h.db._s.awards.find((a) => a.badge_id === speed.id).user_id, P2.id);
  assert.match(speed.description, /2 of 3 found in 1h 00m, the most of anyone/);
  assert.equal(H.clockWords(252000), '4m 12s');
  // Opening an ended or unstarted hunt does not start a run.
  await assert.rejects(H.huntAction('hunt.start', { id: d.id }, h.ctx(P3, at(130))), /not running/);
});

test('a hunt can be duplicated as a draft, with its key, and on a test site the copy is admins only', async () => {
  const h = harness();
  const d = await makeHunt(h);
  const copy = await H.huntAction('hunt.duplicate', { id: d.id }, { ...h.ctx(ADMIN, at(2), true), testSite: true });
  assert.equal(copy.title, 'Pinky Hunt (copy)');
  assert.equal(copy.status, 'draft');
  assert.equal(copy.admins_only, true);
  assert.deepEqual(h.db._s.keys[copy.id], h.db._s.keys[d.id]);
  assert.deepEqual(copy.cells, h.db._s.hunts[0].cells);
  assert.equal(copy.players, 0);
  await assert.rejects(H.huntAction('hunt.duplicate', { id: d.id }, h.ctx(P1, at(2))), /Admins only/);
});

test('admins can announce, start and end now; ending awards at once', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const a = await H.huntAction('hunt.now', { id: d.id, kind: 'announce' }, h.ctx(ADMIN, at(2), true));
  assert.equal(a.notes.announce.sent, true);
  assert.equal(h.db._s.notes.find((n) => n.id === a.notes.announce.id).send_at, iso(at(2)));
  const s = await H.huntAction('hunt.now', { id: d.id, kind: 'start' }, h.ctx(ADMIN, at(3), true));
  assert.equal(s.phase, 'live'); assert.equal(s.notes.start.sent, true);
  await dropAll(d.id, [pt(1000, 1000, 100)], h.ctx(P1, at(4)));
  const e = await H.huntAction('hunt.now', { id: d.id, kind: 'end' }, h.ctx(ADMIN, at(5), true));
  assert.equal(e.phase, 'ended'); assert.ok(e.awarded_at); assert.equal(e.notes.end.sent, true);
  // Bronze, and the speed award (nobody found all; P1 found the most, the quickest).
  assert.equal(h.db._s.awards.length, 2);
  assert.equal(h.db._s.notes.length, 4);   // the three notes and the results
});

test('cancelling takes back the notes not yet sent; deleting needs a cancel first', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  await assert.rejects(H.huntAction('hunt.delete', { id: d.id }, h.ctx(ADMIN, at(30), true)), /Cancel/);
  const c = await H.huntAction('hunt.cancel', { id: d.id }, h.ctx(ADMIN, at(30), true));
  assert.equal(c.phase, 'cancelled');
  // The announcement went out at hour 24 and stays; start and end are gone.
  assert.deepEqual(h.db._s.notes.map((n) => n.send_at), [iso(at(24))]);
  await H.huntAction('hunt.delete', { id: d.id }, h.ctx(ADMIN, at(31), true));
  assert.equal(h.db._s.hunts.length, 0);
});

test('scheduling needs a key, a view, and an end in the future', async () => {
  const h = harness();
  const admin = h.ctx(ADMIN, at(0), true);
  await assert.rejects(H.huntAction('hunt.save', { fields: { title: 'X', dataset: 'pinky_nf_v2', start_at: iso(at(1)), end_at: iso(at(2)) }, status: 'scheduled' }, admin), /answer key/);
  await assert.rejects(H.huntAction('hunt.save', { fields: { title: 'X', dataset: 'pinky_nf_v2', start_at: iso(at(2)), end_at: iso(at(1)) }, key: { layer: KEY, dims: DIMS }, view: VIEW, status: 'scheduled' }, admin), /end after it starts/);
  await assert.rejects(H.huntAction('hunt.save', { fields: { title: 'X', dataset: 'pinky_nf_v2', start_at: iso(at(-5)), end_at: iso(at(-1)) }, key: { layer: KEY, dims: DIMS }, view: VIEW, status: 'scheduled' }, admin), /future/);
  await assert.rejects(H.huntAction('hunt.save', { fields: { title: 'X', dataset: 'pinky_nf_v2' }, key: { layer: layer([]), dims: DIMS } }, admin), /no points/);
});

test('a new key re-scores every answer so far', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  await dropAll(d.id, [pt(1000, 1000, 100)], h.ctx(P1, at(60)));
  assert.equal(h.db._s.subs[0].found, 1);
  // The admin moves the first merger far away: that answer no longer finds it.
  await H.huntAction('hunt.save', { id: d.id, key: { layer: layer([pt(90000, 90000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)]), dims: DIMS } }, h.ctx(ADMIN, at(61), true));
  assert.equal(h.db._s.subs[0].found, 0);
});

test('the Achievement lines are jokes with counts, and use the art set for the hunt', () => {
  const hunt = { id: 7, title: 'Pinky Hunt', target_count: 5, art: { gold: 'https://art.example/g.png' } };
  const th = H.thresholds(hunt);
  const g = H.badgeRow(hunt, 'gold', th, 'https://pyr.example');
  assert.equal(g.image_url, 'https://art.example/g.png');
  assert.match(g.description, /^Gold in Pinky Hunt: all 5 found with 7 gems or fewer\. /);
  const s = H.badgeRow(hunt, 'silver', th, 'https://pyr.example');
  assert.equal(s.image_url, 'https://pyr.example/hunt/silver.png');
  assert.match(s.description, /^Silver in Pinky Hunt: 4 or more of the 5 found\. /);
  for (const r of [g, s]) assert.doesNotMatch(r.name + r.description, /[—–]|badge/i);
});

test('each note can carry its own picture, one picture can serve several, and a sent note takes a changed picture only', async () => {
  const h = harness();
  const d = await makeHunt(h);
  const A = { image_url: 'https://img.example/a.png', thumbnail_url: 'https://img.example/a-t.png' };
  const B = { image_url: 'https://img.example/b.png', thumbnail_url: 'https://img.example/b-t.png' };
  // Only https pictures are kept; a note left out has none.
  const f = H.cleanFields({ notif_images: { announce: A, start: { image_url: 'javascript:alert(1)' }, end: { image_url: 'https://img.example/c.png' }, other: A } });
  assert.deepEqual(f.notif_images, { announce: A, end: { image_url: 'https://img.example/c.png', thumbnail_url: 'https://img.example/c.png' } });
  // The same picture for the announcement and the start, another for the end.
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { notif_images: { announce: A, start: A, end: B } } }, h.ctx(ADMIN, at(1), true));
  assert.deepEqual(h.db._s.notes.map((n) => n.image_url), [A.image_url, A.image_url, B.image_url]);
  assert.deepEqual(h.db._s.notes.map((n) => n.thumbnail_url), [A.thumbnail_url, A.thumbnail_url, B.thumbnail_url]);
  // The admin sees each note's words and picture, to preview it.
  const view = await H.huntAction('hunt.read', { id: d.id }, h.ctx(ADMIN, at(2), true));
  assert.equal(view.notes.start.image_url, A.image_url);
  assert.ok(/drop a gem on each one you find/.test(view.notes.start.body));
  // After the announcement is out, a new picture still reaches it; its words and time stay.
  const sent = clone(h.db._s.notes[0]);
  await H.huntAction('hunt.save', { id: d.id, fields: { notif_images: { announce: B, end: B }, title: 'Renamed Hunt' } }, h.ctx(ADMIN, at(30), true));
  assert.equal(h.db._s.notes[0].image_url, B.image_url);
  assert.equal(h.db._s.notes[0].title, sent.title);
  assert.equal(h.db._s.notes[0].send_at, sent.send_at);
  // The start note is not out yet: it takes the new title, and the Hunt's default picture.
  assert.equal(h.db._s.notes[1].image_url, 'https://pyr.example/hunt/gold.png');
  assert.ok(h.db._s.notes[1].title.endsWith('Renamed Hunt'));
});

test('an admin can try any hunt: it opens as running, each gem is judged against the real key, and nothing is kept', async () => {
  const h = harness();
  const d = await makeHunt(h);   // a draft: players see nothing
  const admin = h.ctx(ADMIN, at(1), true);
  await assert.rejects(H.huntAction('hunt.test', { id: d.id }, h.ctx(P1, at(1))), /Admins only/);
  await assert.rejects(H.huntAction('hunt.test_drop', { id: d.id, layer: layer([pt(1, 1, 1)]), dims: DIMS }, h.ctx(P1, at(1))), /Admins only/);
  const t = await H.huntAction('hunt.test', { id: d.id }, admin);
  assert.equal(t.test, true);
  assert.equal(t.phase, 'live');
  assert.ok(t.view && Array.isArray(t.view.layers) && !JSON.stringify(t.view).includes('Mergers'));
  assert.deepEqual(t.cells.map((c) => c.root), ['648518346350533705']);
  assert.deepEqual([t.you.found, t.you.gems_left, t.you.done], [0, 5, false]);
  // A right gem, then one 2.5 µm off the third merger (tolerance 2 µm): the admin hears how near.
  const a = await H.huntAction('hunt.test_drop', { id: d.id, layer: layer([{ ...pt(1000, 1000, 100), id: 't1' }]), dims: DIMS, prev: [] }, admin);
  assert.equal(a.drop.hit, true);
  assert.equal(a.test, true);
  const b = await H.huntAction('hunt.test_drop', { id: d.id, layer: layer([{ ...pt(9625, 1000, 200), id: 't2' }]), dims: DIMS, prev: [{ id: 't1', nm: a.nm, hit: 0 }] }, admin);
  assert.equal(b.drop.hit, false);
  assert.equal(b.nearest_um, 2.5);
  assert.deepEqual([b.run.found, b.run.gems_used], [1, 2]);
  // The game's word is not taken for earlier gems: a "hit" far from every problem is judged again.
  const c = await H.huntAction('hunt.test_drop', { id: d.id, layer: layer([{ ...pt(5000, 5000, 100), id: 't3' }]), dims: DIMS, prev: [{ id: 'x', nm: [1, 1, 1], hit: 0 }] }, admin);
  assert.deepEqual([c.run.found, c.run.gems_used], [1, 2]);
  assert.equal(h.db._s.subs.length, 0);
  // A hunt with no key yet cannot be tried.
  const empty = await H.huntAction('hunt.save', { fields: { title: 'Empty', dataset: 'pinky_nf_v2' }, status: 'draft' }, admin);
  await assert.rejects(H.huntAction('hunt.test', { id: empty.id }, admin), /answer key/);
});

test('the Admin Hub can preview the notes with the form as it is, before anything is saved', async () => {
  const h = harness();
  const fields = { title: 'Preview Hunt', cells: [{ root: '648518346350533705' }], announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)),
    notif_images: { start: { image_url: 'https://img.example/s.png' } } };
  const rows = await H.huntAction('hunt.notes', { fields, target_count: 4 }, h.ctx(ADMIN, at(1), true));
  assert.deepEqual(rows.map((r) => r.kind), ['announce', 'start', 'end']);
  assert.ok(/4 mergers are hidden on one cell/.test(rows[1].body));
  assert.deepEqual(rows.map((r) => r.image_url), ['https://pyr.example/hunt/gold.png', 'https://img.example/s.png', 'https://pyr.example/hunt/gold.png']);
  assert.equal(h.db._s.hunts.length + h.db._s.notes.length, 0);
  await assert.rejects(H.huntAction('hunt.notes', { fields }, h.ctx(P1, at(1))), /Admins only/);
});

test('an answer key can come from two layers, one of places to cut and one of places to merge; any gem finds either', async () => {
  const h = harness();
  const admin = h.ctx(ADMIN, at(0), true);
  const cuts = layer([pt(1000, 1000, 100), pt(5000, 5000, 100)]);
  const merges = layer([pt(9000, 1000, 200)]);
  const d = await H.huntAction('hunt.save', { fields: { title: 'Two Kinds', dataset: 'pinky_nf_v2', cells: [{ root: '648518346350533705' }],
    announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)) },
    key: { layers: [{ layer: cuts, kind: 'cut' }, { layer: merges, kind: 'merge' }], dims: DIMS }, view: VIEW, status: 'scheduled' }, admin);
  assert.equal(d.target_count, 3);
  assert.deepEqual(H.kindCounts(h.db._s.keys[d.id]), { cut: 2, merge: 1 });
  assert.ok(/2 mergers and 1 extension are hidden on one cell/.test(h.db._s.notes[1].body), h.db._s.notes[1].body);
  const live = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(60)))).hunts[0];
  assert.deepEqual(live.spots, { cut: 2, merge: 1 });
  assert.ok(!JSON.stringify(live).includes('36000'));   // still no key coordinates
  // The extension is found like the mergers, and a right gem says which kind it found.
  const r = await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)], h.ctx(P1, at(61)));
  assert.equal(r.run.found, 3);
  assert.equal(r.drop.kind, 'merge');
  assert.equal(H.spotWords({ cut: 0, merge: 2 }), '2 extensions are');
  assert.equal(H.spotWords({ cut: 1, merge: 0 }), '1 merger is');
});

test('a medal can give a special Achievement an admin made, instead of the one the hunt makes', async () => {
  const h = harness();
  h.db._s.badges.push({ id: 900, slug: 'pumpkin-king', name: 'Pumpkin King', description: 'Carved it.', image_url: 'https://img.example/pk.png', thumbnail_url: 'https://img.example/pk-t.png' });
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { art: { gold: { badge_id: 900 }, silver: { image_url: 'https://img.example/s.png' } } } }, h.ctx(ADMIN, at(1), true));
  const live = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(60)))).hunts[0];
  assert.deepEqual(live.prizes.gold, { name: 'Pumpkin King', image: 'https://img.example/pk-t.png' });
  assert.deepEqual(live.prizes.silver, { name: 'Pinky Hunt: Silver', image: 'https://img.example/s.png' });
  assert.deepEqual(live.prizes.bronze, { name: 'Pinky Hunt: Bronze', image: 'https://pyr.example/hunt/bronze-128.png' });
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)], h.ctx(P1, at(61)));   // all 3: gold
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100)], h.ctx(P2, at(62)));   // 2: silver
  await H.huntAction('hunt.current', {}, h.ctx(P3, at(121)));
  const gold = h.db._s.awards.find((a) => a.user_id === P1.id);
  assert.equal(gold.badge_id, 900);
  assert.ok(!h.db._s.badges.some((b) => b.slug === `hunt-${d.id}-gold`));
  const silver = h.db._s.badges.find((b) => b.slug === `hunt-${d.id}-silver`);
  assert.equal(silver.image_url, 'https://img.example/s.png');
  assert.ok(h.bell.some((n) => n.user_id === P1.id && /Pumpkin King/.test(n.title)));
});

test('an admins only hunt is a test: players never see it, its notes go to the admin alone, and nothing reaches chat', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { admins_only: true } }, h.ctx(ADMIN, at(1), true));
  assert.ok(h.db._s.notes.length === 3 && h.db._s.notes.every((n) => n.target_type === 'user' && n.target_id === ADMIN.id && n.post_to_chat === false));
  assert.equal((await H.huntAction('hunt.current', {}, h.ctx(P1, at(60)))).hunts.length, 0);
  const seen = (await H.huntAction('hunt.current', {}, h.ctx(ADMIN, at(60), true))).hunts[0];
  assert.equal(seen.admins_only, true);
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)], h.ctx(ADMIN, at(61), true));
  await H.huntAction('hunt.current', {}, h.ctx(ADMIN, at(121), true));
  assert.equal(h.db._s.awards.length, 2);   // gold and the speed award
  assert.equal(h.chat.length, 0);
  // Turned off again before the notes go out, they go to everyone.
  await H.huntAction('hunt.save', { id: d.id, fields: { admins_only: false, start_at: iso(at(130)), end_at: iso(at(140)) } }, h.ctx(ADMIN, at(122), true));
});

test('players start at the soma when one is set, never on the answer; the Admin Hub is warned when the start is near a place', async () => {
  const h = harness();
  const d = await makeHunt(h);   // VIEW is centered on the first merger
  const read1 = await H.huntAction('hunt.read', { id: d.id }, h.ctx(ADMIN, at(1), true));
  assert.equal(read1.start_on_answer, true);
  assert.equal(read1.start_gap_um, 0);
  // The soma, in the view's voxels: [3000, 3000, 150] is 8 µm and more from every merger.
  const saved = await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { cells: [{ root: '648518346350533705', label: 'the pyramidal', soma: [3000, 3000, '150'] }] } }, h.ctx(ADMIN, at(1), true));
  assert.equal(saved.start_on_answer, false);
  assert.ok(saved.start_gap_um > 6, String(saved.start_gap_um));
  const live = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(60)))).hunts[0];
  assert.deepEqual(live.view.position, [3000, 3000, 150]);
  assert.deepEqual(live.cells[0].soma, [3000, 3000, 150]);
  const t = await H.huntAction('hunt.test', { id: d.id }, h.ctx(ADMIN, at(60), true));
  assert.deepEqual(t.view.position, [3000, 3000, 150]);
  // A soma with a blank is not kept.
  assert.deepEqual(H.cleanCells([{ root: '648518346350533705', soma: [1, '', 3] }]), [{ root: '648518346350533705', label: '' }]);
});

test('from a test site every Hunt is admins only, and an everyone Hunt cannot be started from there', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));   // from the live game
  assert.ok(h.db._s.notes.every((n) => n.target_type === 'all'));
  const fromTest = { ...h.ctx(ADMIN, at(2), true), testSite: true };
  await assert.rejects(H.huntAction('hunt.now', { id: d.id, kind: 'start' }, fromTest), /goes to every player/);
  // Saved on the test site, even with the box off, it becomes admins only and its notes go to the admin alone.
  const saved = await H.huntAction('hunt.save', { id: d.id, fields: { admins_only: false } }, fromTest);
  assert.equal(saved.admins_only, true);
  assert.ok(h.db._s.notes.every((n) => n.target_type === 'user' && n.target_id === ADMIN.id && n.post_to_chat === false));
  await H.huntAction('hunt.now', { id: d.id, kind: 'start' }, fromTest);
  assert.equal((await H.huntAction('hunt.current', {}, h.ctx(P1, at(3)))).hunts.length, 0);
});

test('before the admins_only column exists, a test site saves drafts and tries them, but cannot schedule', async () => {
  const h = harness();
  h.db.hasAdminsOnly = async () => false;
  const fromTest = { ...h.ctx(ADMIN, at(0), true), testSite: true };
  const d = await H.huntAction('hunt.save', { fields: { title: 'Draft', dataset: 'pinky_nf_v2', cells: [{ root: '648518346350533705' }],
    announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)), admins_only: true }, key: { layer: KEY, dims: DIMS }, view: VIEW, status: 'draft' }, fromTest);
  assert.equal(d.status, 'draft');
  assert.equal('admins_only' in h.db._s.hunts[0], false);   // never written to a column that is not there
  const t = await H.huntAction('hunt.test', { id: d.id }, fromTest);
  assert.equal(t.test, true);
  await assert.rejects(H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, fromTest), /one more line/);
  assert.equal(h.db._s.notes.length, 0);
  // From the live game it schedules as before.
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  assert.equal(h.db._s.notes.length, 3);
});

test('cut gems find mergers and extend gems find missing extensions; the wrong kind on a real problem is a miss that says so', async () => {
  const h = harness();
  const admin = h.ctx(ADMIN, at(0), true);
  const d = await H.huntAction('hunt.save', { fields: { title: 'Two Kinds', dataset: 'pinky_nf_v2', cells: [{ root: '648518346350533705' }],
    announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)) },
    key: { layers: [{ layer: layer([pt(1000, 1000, 100), pt(5000, 5000, 100)]), kind: 'cut' }, { layer: layer([pt(9000, 1000, 200)]), kind: 'merge' }], dims: DIMS },
    view: VIEW, status: 'scheduled' }, admin);
  const p1 = h.ctx(P1, at(60));
  const one = (p, id, kind) => H.huntAction('hunt.drop', { id: d.id, kind, layer: layer([{ ...p, id }]), dims: DIMS }, p1);
  const wrong = await one(pt(9000, 1000, 200), 'a', 'cut');      // a cut gem on the extension
  assert.deepEqual(wrong.drop, { id: 'a', hit: false, kind: null, other: 'merge' });
  assert.equal(wrong.run.gems_used, 1);
  const right = await one(pt(9000, 1000, 200), 'b', 'merge');    // an extend gem there
  assert.deepEqual(right.drop, { id: 'b', hit: true, kind: 'merge' });
  assert.deepEqual([right.run.found_by, right.run.of_by], [{ cut: 0, merge: 1 }, { cut: 2, merge: 1 }]);
  const cut = await one(pt(1000, 1000, 100), 'c', 'cut');
  assert.equal(cut.drop.hit, true);
  const cur = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(61)))).hunts[0];
  assert.deepEqual(cur.you.drops.map((x) => [x.id, x.k, x.hit]), [['a', 'cut', false], ['b', 'merge', true], ['c', 'cut', true]]);
  // A new key judges each gem again by its own kind.
  await H.huntAction('hunt.save', { id: d.id, key: { layers: [{ layer: layer([pt(1000, 1000, 100), pt(5000, 5000, 100)]), kind: 'cut' }, { layer: layer([pt(9000, 1000, 200)]), kind: 'cut' }], dims: DIMS } }, h.ctx(ADMIN, at(62), true));
  assert.deepEqual(h.db._s.subs[0].points.map((x) => x.hit >= 0), [true, false, true]);
});

test('an admins only hunt sends each note to every admin, never to chat; turned to everyone, one note each again', async () => {
  const h = harness();
  h.db.adminUserIds = async () => [ADMIN.id, P2.id];   // Ames and Celia
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { admins_only: true } }, h.ctx(ADMIN, at(1), true));
  assert.equal(h.db._s.notes.length, 6);
  assert.deepEqual([...new Set(h.db._s.notes.map((n) => n.target_id))].sort(), [ADMIN.id, P2.id].sort());
  assert.ok(h.db._s.notes.every((n) => n.target_type === 'user' && n.post_to_chat === false));
  const row = h.db._s.hunts[0];
  assert.ok(Array.isArray(row.notif_ids.start) && row.notif_ids.start.length === 2);
  // Moving the start moves both start notes (made again), and the admin view still shows it.
  const v = await H.huntAction('hunt.save', { id: d.id, fields: { start_at: iso(at(50)) } }, h.ctx(ADMIN, at(2), true));
  assert.equal(h.db._s.notes.filter((n) => n.send_at === iso(at(50))).length, 2);
  assert.equal(v.notes.start.send_at, iso(at(50)));
  // Back to everyone, before any note went out: one note of each kind, to all, in chat.
  await H.huntAction('hunt.save', { id: d.id, fields: { admins_only: false } }, h.ctx(ADMIN, at(3), true));
  assert.equal(h.db._s.notes.length, 3);
  assert.ok(h.db._s.notes.every((n) => n.target_type === 'all' && n.post_to_chat === true));
});

test('medals by thresholds (Ames 2026-10-23): everyone who finds them all within the gold gems wins Gold, several can; none shows before the end', async () => {
  const h = harness();
  const d = await makeHunt(h);   // 3 mergers: Gold all 3 within 4 gems; Silver 2; Bronze 1
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const P4 = { id: '55555555-5555-4555-8555-555555555555', username: 'p4' };
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)], h.ctx(P2, at(60)));            // all, 3 gems: Gold
  await dropAll(d.id, [pt(2, 2, 2), pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)], h.ctx(P4, at(61))); // all, 4 gems: Gold too
  await dropAll(d.id, [pt(1, 1, 1), pt(3, 3, 3), pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)], h.ctx(P1, at(62)));   // all, 5 gems: over Gold's 4, Silver
  await dropAll(d.id, [pt(1000, 1000, 100), pt(5000, 5000, 100)], h.ctx(P3, at(63)));   // 2 of 3: Silver
  const live = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(70)))).hunts[0];
  assert.ok(live.board.every((b) => b.tier === null) && live.you.tier === null);
  const end = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(121)))).hunts[0];
  const medal = (uid) => { const a = h.db._s.awards.find((x) => x.user_id === uid && !/fastest/.test(h.db._s.badges.find((b) => b.id === x.badge_id).slug)); return a ? h.db._s.badges.find((b) => b.id === a.badge_id).slug.split('-').pop() : null; };
  assert.deepEqual([medal(P2.id), medal(P4.id), medal(P1.id), medal(P3.id)], ['gold', 'gold', 'silver', 'silver']);
  assert.deepEqual(end.winners, { gold: 2, silver: 2, bronze: 0 });
  assert.equal(end.you.tier, 'silver');
  assert.match(h.db._s.awards.find((a) => a.user_id === P2.id && !/fastest/.test(h.db._s.badges.find((b) => b.id === a.badge_id).slug)).reason, /^Gold in Pinky Hunt: 3 of 3 found with 3 gems/);
});

test('Count it: an admin turns a hunter\'s miss on a real error into a place in the key, and everyone is judged again', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  // A real error the key missed, at [20000, 20000, 100] (voxels); P1 and P2 both put a gem there.
  await dropAll(d.id, [pt(20000, 20000, 100)], h.ctx(P1, at(60)));
  await dropAll(d.id, [pt(20010, 20000, 100)], h.ctx(P2, at(61)));
  const admin = h.ctx(ADMIN, at(62), true);
  await assert.rejects(H.huntAction('hunt.run', { id: d.id, user_id: P1.id }, h.ctx(P2, at(62))), /Admins only/);
  const run = await H.huntAction('hunt.run', { id: d.id, user_id: P1.id }, admin);
  assert.equal(run.drops.length, 1);
  assert.equal(run.drops[0].hit, false);
  const after = await H.huntAction('hunt.count_it', { id: d.id, user_id: P1.id, drop_id: run.drops[0].id }, admin);
  assert.equal(after.target_count, 4);
  assert.equal(h.db._s.keys[d.id].length, 4);
  assert.deepEqual(h.db._s.subs.map((x) => x.found), [1, 1]);   // both get it
  await assert.rejects(H.huntAction('hunt.count_it', { id: d.id, user_id: P1.id, drop_id: run.drops[0].id }, admin), /already found/);
  await assert.rejects(H.huntAction('hunt.count_it', { id: d.id, user_id: P1.id, drop_id: 'nope' }, admin), /not in this hunter/);
  // Laser Eyes (Ames 2026-10-26): both finders get this Hunt's, once, with a bell note each.
  assert.equal(after.laser, 2);
  const laser = h.db._s.badges.find((b) => b.slug === `hunt-${d.id}-laser`);
  assert.ok(laser && laser.name === 'Pinky Hunt: Laser Eyes' && /\/hunt\/laser\.png$/.test(laser.image_url), JSON.stringify(laser));
  assert.deepEqual(h.db._s.awards.filter((a) => a.badge_id === laser.id).map((a) => a.user_id).sort(), [P1.id, P2.id].sort());
  assert.equal(h.bell.filter((n) => /Laser Eyes/.test(n.title)).length, 2);
  // A second place the key missed in the same Hunt: no second Laser Eyes for the same hunters.
  await dropAll(d.id, [pt(30000, 30000, 100)], h.ctx(P1, at(63)));
  const run2 = await H.huntAction('hunt.run', { id: d.id, user_id: P1.id }, admin);
  const again = await H.huntAction('hunt.count_it', { id: d.id, user_id: P1.id, drop_id: run2.drops.find((x) => !x.hit).id }, h.ctx(ADMIN, at(64), true));
  assert.equal(again.laser, 0);
  assert.equal(h.db._s.awards.filter((a) => a.badge_id === laser.id).length, 2);
  assert.equal(h.bell.filter((n) => /Laser Eyes/.test(n.title)).length, 2);
});

test('places with an area: a gem anywhere inside an ellipsoid, along a line or in a box counts, within the tolerance (Ames 2026-10-26)', async () => {
  const ell = [1000, 1000, 1000, 'merge', { r: [6000, 6000, 600] }];
  assert.equal(H.placeDist(ell, [6000, 1000, 1000]), 0);                         // inside, 5 µm from the middle
  assert.ok(Math.abs(H.placeDist(ell, [9000, 1000, 1000]) - 2000) < 1);          // 2 µm beyond its edge
  const line = [5000, 0, 0, 'cut', { a: [0, 0, 0], b: [10000, 0, 0] }];
  assert.equal(H.placeDist(line, [8000, 0, 0]), 0);
  assert.equal(H.placeDist(line, [8000, 1500, 0]), 1500);
  const box = [5000, 5000, 500, 'merge', { lo: [0, 0, 0], hi: [10000, 10000, 1000] }];
  assert.equal(H.placeDist(box, [9000, 9000, 500]), 0);
  assert.equal(H.placeDist(box, [12000, 5000, 500]), 2000);
  assert.equal(H.placeDist([0, 0, 0, 'cut'], [3000, 4000, 0]), 5000);            // a point, as before
  // Read from a key layer: ellipsoid, line and box annotations, in voxels (4, 4, 40 nm).
  const layerOf = (annotations) => ({ type: 'annotation', source: 'local://annotations', annotations });
  const places = H.layerPlaces(layerOf([
    { type: 'ellipsoid', id: 'e', center: [100, 100, 10], radii: [1000, 500, 5] },
    { type: 'line', id: 'l', pointA: [0, 0, 0], pointB: [100, 0, 0] },
    { type: 'axis_aligned_bounding_box', id: 'b', pointA: [10, 20, 3], pointB: [0, 0, 1] },
    { type: 'point', id: 'p', point: [1, 2, 3] }]), DIMS);
  assert.deepEqual(places, [
    { nm: [400, 400, 400], shape: { r: [4000, 2000, 200] } },
    { nm: [200, 0, 0], shape: { a: [0, 0, 0], b: [400, 0, 0] } },
    { nm: [20, 40, 80], shape: { lo: [0, 0, 40], hi: [40, 80, 120] } },
    { nm: [4, 8, 120] }]);
  // A Hunt whose key has a wide place: a gem 4 µm from its middle counts (a point would need 3 µm).
  const h = harness();
  const draft = await H.huntAction('hunt.save', { fields: { title: 'Wide Hunt', dataset: 'pinky_nf_v2', cells: [{ root: '648518346350533705' }], tolerance_nm: 3000,
    announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)) },
    key: { layers: [{ layer: layerOf([{ type: 'ellipsoid', id: 'w', center: [5000, 5000, 100], radii: [2000, 2000, 50] }]), kind: 'merge' }], dims: DIMS }, view: VIEW, status: 'draft' }, h.ctx(ADMIN, at(0), true));
  await H.huntAction('hunt.save', { id: draft.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const hit = await H.huntAction('hunt.drop', { id: draft.id, kind: 'merge', layer: layer([{ ...pt(6750, 5000, 100), id: 'w1' }]), dims: DIMS }, h.ctx(P1, at(50)));
  assert.equal(hit.drop.hit, true);   // 7 µm from the middle, inside the 8 µm ellipsoid
});

test('a hunter sends a problem the answers missed by its coordinates and kind; Add to the key counts it, with Laser Eyes for them (Ames 2026-10-26)', async () => {
  const h = harness();
  h.db.adminUserIds = async () => [ADMIN.id];
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  await assert.rejects(H.huntAction('hunt.report_place', { id: d.id, nm: [1, 2, 3], kind: 'cut' }, h.ctx(P1, at(30))), /not started/);
  await assert.rejects(H.huntAction('hunt.report_place', { id: d.id, nm: [1, 2], kind: 'cut' }, h.ctx(P1, at(50))), /x, y and z/);
  await assert.rejects(H.huntAction('hunt.report_place', { id: d.id, nm: [1, 2, 3], kind: 'edge' }, h.ctx(P1, at(50))), /merger \(Cut\) or a missing extension/);
  const r = await H.huntAction('hunt.report_place', { id: d.id, nm: [120000, 120000, 4000], at: [30000, 30000, 100], kind: 'merge', note: 'thin branch stops' }, h.ctx(P1, at(50)));
  assert.deepEqual([r.reported, r.open], [true, 1]);
  assert.match(h.bell[0].body, /^nseraf found a missing extension the answers missed, at 30000, 30000, 100: "thin branch stops"\./);
  assert.equal(h.db._s.subs.length, 0);   // no gem used
  const list = await H.huntAction('hunt.reports', { id: d.id }, h.ctx(ADMIN, at(51), true));
  assert.deepEqual(list.reports.map((x) => [x.name, x.k, x.note, !!x.report_id]), [['nseraf', 'merge', 'thin branch stops', true]]);
  // Add to the key from the report: in the key, counted, and Laser Eyes for the hunter who sent it.
  const added = await H.huntAction('hunt.add_place', { id: d.id, nm: list.reports[0].nm, kind: 'merge', report_id: list.reports[0].report_id }, h.ctx(ADMIN, at(52), true));
  assert.deepEqual([added.target_count, added.laser], [4, 1]);
  assert.ok(h.db._s.awards.some((a) => a.user_id === P1.id));
  assert.deepEqual((await H.huntAction('hunt.reports', { id: d.id }, h.ctx(ADMIN, at(53), true))).reports, []);
  // Not real: off the list.
  const r2 = await H.huntAction('hunt.report_place', { id: d.id, nm: [5, 5, 5], kind: 'cut' }, h.ctx(P2, at(54)));
  const left = await H.huntAction('hunt.dismiss_report', { id: d.id, report_id: r2.id }, h.ctx(ADMIN, at(55), true));
  assert.deepEqual(left.reports, []);
  assert.equal(h.db._s.reports.find((x) => x.id === r2.id).status, 'not_real');
});

test('a hunter reports a missed gem as a real problem: the admins hear, the editor lists it, Count it makes it count (Ames 2026-10-26)', async () => {
  const h = harness();
  h.db.adminUserIds = async () => [ADMIN.id];
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  await H.huntAction('hunt.drop', { id: d.id, kind: 'cut', layer: layer([{ ...pt(20000, 20000, 100), id: 'r1' }]), dims: DIMS }, h.ctx(P1, at(60)));
  await H.huntAction('hunt.drop', { id: d.id, kind: 'cut', layer: layer([{ ...pt(1000, 1000, 100), id: 'r2' }]), dims: DIMS }, h.ctx(P1, at(61)));
  await assert.rejects(H.huntAction('hunt.report', { id: d.id, drop_id: 'r2' }, h.ctx(P1, at(62))), /found a problem already/);
  await assert.rejects(H.huntAction('hunt.report', { id: d.id, drop_id: 'r1' }, h.ctx(P2, at(62))), /not in your Hunt/);
  const r = await H.huntAction('hunt.report', { id: d.id, drop_id: 'r1' }, h.ctx(P1, at(62)));
  assert.equal(r.reported, true);
  assert.deepEqual(h.bell.map((n) => [n.user_id, n.title]), [[ADMIN.id, '🔎 Hunt report: Pinky Hunt']]);
  assert.match(h.bell[0].body, /^nseraf says their gem is on a real merger the answers missed, at 20000, 20000, 100\./);
  assert.equal((await H.huntAction('hunt.report', { id: d.id, drop_id: 'r1' }, h.ctx(P1, at(63)))).again, true);
  assert.equal(h.bell.length, 1);                                   // once
  const you = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(64)))).hunts[0].you;
  assert.deepEqual(you.drops.filter((x) => x.rep).map((x) => x.id), ['r1']);
  await assert.rejects(H.huntAction('hunt.reports', { id: d.id }, h.ctx(P1, at(64))), /Admins only/);
  const list = await H.huntAction('hunt.reports', { id: d.id }, h.ctx(ADMIN, at(64), true));
  assert.deepEqual(list.reports.map((x) => [x.name, x.drop_id, x.k]), [['nseraf', 'r1', 'cut']]);
  // Count it: it counts for them, Laser Eyes, and it leaves the list.
  const c = await H.huntAction('hunt.count_it', { id: d.id, user_id: P1.id, drop_id: 'r1' }, h.ctx(ADMIN, at(65), true));
  assert.equal(c.laser, 1);
  assert.equal(h.db._s.subs[0].found, 2);
  assert.deepEqual((await H.huntAction('hunt.reports', { id: d.id }, h.ctx(ADMIN, at(66), true))).reports, []);
  // Not real: dismissed, off the list, and their box knows it was checked.
  await H.huntAction('hunt.drop', { id: d.id, kind: 'merge', layer: layer([{ ...pt(30000, 30000, 300), id: 'r3' }]), dims: DIMS }, h.ctx(P1, at(67)));
  await H.huntAction('hunt.report', { id: d.id, drop_id: 'r3' }, h.ctx(P1, at(68)));
  const left = await H.huntAction('hunt.dismiss_report', { id: d.id, user_id: P1.id, drop_id: 'r3' }, h.ctx(ADMIN, at(69), true));
  assert.deepEqual(left.reports, []);
  const you2 = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(70)))).hunts[0].you;
  assert.deepEqual(you2.drops.filter((x) => x.rep_no).map((x) => x.id), ['r3']);
});

test('Add a place the key missed, by its coordinates and kind: everyone judged again, Laser Eyes to whoever finds it (Ames 2026-10-26)', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  // P1 put an Extend gem on a missing extension the key does not have, at [20000, 20000, 100] voxels = [80000, 80000, 4000] nm.
  await H.huntAction('hunt.drop', { id: d.id, kind: 'merge', layer: layer([{ ...pt(20000, 20000, 100), id: 'x1' }]), dims: DIMS }, h.ctx(P1, at(60)));
  const admin = h.ctx(ADMIN, at(62), true);
  await assert.rejects(H.huntAction('hunt.add_place', { id: d.id, nm: [80000, 80000, 4000], kind: 'merge' }, h.ctx(P2, at(62))), /Admins only/);
  await assert.rejects(H.huntAction('hunt.add_place', { id: d.id, nm: [80000, 80000], kind: 'merge' }, admin), /x, y and z/);
  await assert.rejects(H.huntAction('hunt.add_place', { id: d.id, nm: [80000, 80000, 4000], kind: 'edge' }, admin), /merger \(Cut\) or a missing extension/);
  const r = await H.huntAction('hunt.add_place', { id: d.id, nm: [80100, 80000, 4000], kind: 'merge' }, admin);
  assert.deepEqual([r.target_count, r.laser], [4, 1]);
  assert.deepEqual(h.db._s.keys[d.id].slice(-1)[0], [80100, 80000, 4000, 'merge']);
  assert.equal(h.db._s.subs[0].found, 1);
  assert.equal(h.bell.filter((n) => /Laser Eyes/.test(n.title)).length, 1);
  await assert.rejects(H.huntAction('hunt.add_place', { id: d.id, nm: [80000, 80000, 4000], kind: 'merge' }, admin), /already has a place there/);
  // A merger nobody has a gem on: in the key, no Laser Eyes yet.
  const r2 = await H.huntAction('hunt.add_place', { id: d.id, nm: [200000, 200000, 8000], kind: 'cut' }, admin);
  assert.deepEqual([r2.target_count, r2.laser], [5, 0]);
  // A wide face the key marked with a point: a size makes that place bigger, and the gem near it now counts.
  await H.huntAction('hunt.drop', { id: d.id, kind: 'cut', layer: layer([{ ...pt(51500, 50000, 200), id: 'c9' }]), dims: DIMS }, h.ctx(P2, at(63)));
  assert.equal(h.db._s.subs.find((x) => x.user_id === P2.id).found, 0);   // 6 µm from the point: a miss
  const big = await H.huntAction('hunt.add_place', { id: d.id, nm: [200000, 200000, 8000], kind: 'cut', radius_nm: 8000 }, admin);
  assert.deepEqual([big.enlarged, big.target_count, big.laser], [true, 5, 0]);
  assert.deepEqual(h.db._s.keys[d.id].slice(-1)[0], [200000, 200000, 8000, 'cut', { r: [8000, 8000, 8000] }]);
  assert.equal(h.db._s.subs.find((x) => x.user_id === P2.id).found, 1);
});

test('before The Hunt is launched, a Hunt set for everyone stays admins only: hidden from players, every note and the results to admins, never chat', async () => {
  const h = harness();
  h.db.adminUserIds = async () => [ADMIN.id, P2.id];
  const d = await makeHunt(h);
  const pre = (me, t, isAdmin = false) => h.ctx(me, at(t), isAdmin, false);   // not launched
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { admins_only: false } }, pre(ADMIN, 1, true));
  assert.equal(h.db._s.hunts[0].admins_only, false);
  assert.ok(h.db._s.notes.length === 6 && h.db._s.notes.every((n) => n.target_type === 'user' && n.post_to_chat === false));
  // Players see nothing and cannot play; an admin can.
  assert.deepEqual((await H.huntAction('hunt.current', {}, pre(P1, 60))).hunts, []);
  await assert.rejects(H.huntAction('hunt.drop', { id: d.id, point: pt(1000, 1000, 100), drop_id: 'x' }, pre(P1, 60)), /No such Hunt/);
  await dropAll(d.id, [pt(1000, 1000, 100)], pre(ADMIN, 61, true));
  // The end: the results go to the admins, never to everyone or chat.
  const end = await H.huntAction('hunt.current', {}, pre(ADMIN, 121, true));
  assert.equal(end.hunts[0].awarded, true);
  const results = h.db._s.notes.filter((n) => /results/.test(n.title));
  assert.ok(results.length === 2 && results.every((n) => n.target_type === 'user' && n.post_to_chat === false), JSON.stringify(results.map((n) => [n.target_type, n.post_to_chat])));
  assert.ok(!h.db._s.notes.some((n) => n.target_type === 'all' || n.post_to_chat), 'nothing to all players or chat');
});

test('the same gem sent twice (a slow answer) gets its first answer: nothing new kept, never "found already", and the last gem is never refused', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const send = (p, id, t) => H.huntAction('hunt.drop', { id: d.id, kind: 'cut', layer: layer([{ ...p, id }]), dims: DIMS }, h.ctx(P1, at(t)));
  const first = await send(pt(1000, 1000, 100), 'gold1', 60);
  assert.equal(first.drop.hit, true);
  const again = await send(pt(1000, 1000, 100), 'gold1', 60.01);
  assert.deepEqual([again.drop.hit, again.drop.repeat, !!again.drop.already], [true, true, false]);
  assert.equal(h.db._s.subs[0].points.length, 1);
  assert.equal(again.run.gems_used, 1);
  // The last two finds; then the last one again, after the run is complete: its answer, not "all found".
  await send(pt(5000, 5000, 100), 'gold2', 61);
  const last = await send(pt(9000, 1000, 200), 'gold3', 62);
  assert.equal(last.run.done, true);
  const lastAgain = await send(pt(9000, 1000, 200), 'gold3', 62.01);
  assert.deepEqual([lastAgain.drop.hit, lastAgain.drop.repeat], [true, true]);
  assert.equal(h.db._s.subs[0].points.length, 3);
});

test('a gem on a place found already is answered even with no gems left, so it stays (Ames: "leave ALL my gems")', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { max_points: 2 } }, h.ctx(ADMIN, at(1), true));
  const send = (p, id, t) => H.huntAction('hunt.drop', { id: d.id, kind: 'cut', layer: layer([{ ...p, id }]), dims: DIMS }, h.ctx(P1, at(t)));
  await send(pt(1000, 1000, 100), 'a', 60);
  await send(pt(1, 1, 1), 'b', 61);   // a miss: both gems used
  const near = await send(pt(1010, 1000, 100), 'c', 62);
  assert.equal(near.drop.already, true);
  await assert.rejects(send(pt(30000, 30000, 100), 'd', 63), /used all your gems/);
  assert.equal(h.db._s.subs[0].points.length, 2);
});

test('edges of the dataset: an Extend gem where a branch leaves the data uses no gem; marked edges and the volume bounds both count, and neither is a problem', async () => {
  const h = harness();
  const admin = h.ctx(ADMIN, at(0), true);
  // One missing extension; one edge spot marked; the volume 200 x 200 x 20 µm.
  const d = await H.huntAction('hunt.save', { fields: { title: 'Edge Hunt', dataset: 'pinky_nf_v2', cells: [{ root: '648518346350533705' }], tolerance_nm: 2000,
    announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)) },
    key: { layers: [{ layer: layer([pt(1000, 1000, 100)]), kind: 'merge' }, { layer: layer([pt(20000, 20000, 100)]), kind: 'edge' }], dims: DIMS, bounds_nm: [[0, 0, 0], [200000, 200000, 20000]],
      auto_edges_nm: [[150000, 150000, 19500]] },   // where a cell runs out of the data, found by the editor from its mesh
    view: VIEW, status: 'draft' }, admin);
  assert.equal(d.target_count, 1);
  assert.deepEqual([d.edge_count, d.has_bounds], [2, true]);   // the marked spot and the one found from the mesh
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  // Players see the marked edges once the Hunt is open, never before (Ames: "show where the edges [are]").
  assert.deepEqual((await H.huntAction('hunt.current', {}, h.ctx(P1, at(30)))).hunts[0].edges_nm, []);
  const open = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(50)))).hunts[0];
  assert.deepEqual(open.edges_nm, [[80000, 80000, 4000], [150000, 150000, 19500]]);
  // The cells glow within edge_nm of the bounds, the margin that judges an edge (one rule for both).
  assert.deepEqual([open.bounds_nm, open.edge_nm], [[[0, 0, 0], [200000, 200000, 20000]], H.EDGE_NM]);
  const send = (p, id, kind, t) => H.huntAction('hunt.drop', { id: d.id, kind, layer: layer([{ ...p, id }]), dims: DIMS }, h.ctx(P1, at(t)));
  const marked = await send(pt(20000, 20000, 100), 'e1', 'merge', 60);
  assert.deepEqual([marked.drop.edge, marked.run.gems_used], [true, 0]);
  const cutThere = await send(pt(20000, 20000, 100), 'c1', 'cut', 61);   // a Cut gem at an edge is judged as a cut: a miss
  assert.deepEqual([!!cutThere.drop.edge, cutThere.drop.hit, cutThere.run.gems_used], [false, false, 1]);
  const bound = await send(pt(100, 30000, 100), 'e2', 'merge', 62);        // 400 nm from the volume's side
  assert.deepEqual([bound.drop.edge, bound.run.gems_used], [true, 1]);
  const inside = await send(pt(30000, 30000, 250), 'm1', 'merge', 63);     // far from any edge: a miss
  assert.deepEqual([!!inside.drop.edge, inside.drop.hit], [false, false]);
  const real = await send(pt(1000, 1000, 100), 'x1', 'merge', 64);         // the real extension still counts
  assert.equal(real.drop.hit, true);
  assert.equal(h.db._s.subs[0].points.length, 3);                          // the edge gems are not kept as gems
  // Count it on the miss keeps the edges and the bounds.
  await H.huntAction('hunt.count_it', { id: d.id, user_id: P1.id, drop_id: 'm1' }, h.ctx(ADMIN, at(65), true));
  const ex = await h.db.keyExtras(d.id);
  assert.deepEqual([(await h.db.key(d.id)).length, ex.edges.length, !!ex.bounds], [2, 2, true]);
});

test('hunt.board: the running board alone, the same rows as hunt.current, refused before and after (Ames 2026-10-26)', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  await assert.rejects(H.huntAction('hunt.board', { id: d.id }, h.ctx(P1, at(30))), /not running/);
  const drop = (who, p, id, t) => H.huntAction('hunt.drop', { id: d.id, kind: 'cut', layer: layer([{ ...p, id }]), dims: DIMS }, h.ctx(who, at(t)));
  await drop(P1, pt(1000, 1000, 100), 'a1', 50);
  await drop(P2, pt(1000, 1000, 100), 'b1', 51);
  await drop(P2, pt(5000, 5000, 100), 'b2', 52);
  await drop(P3, pt(30000, 30000, 300), 'c1', 53);
  for (const who of [P1, P2, P3]) {
    const cur = (await H.huntAction('hunt.current', {}, h.ctx(who, at(60)))).hunts[0];
    const b = await H.huntAction('hunt.board', { id: d.id }, h.ctx(who, at(60)));
    assert.deepEqual(b.board, cur.board);
    assert.equal(b.rank, cur.you.rank);
  }
  const b = await H.huntAction('hunt.board', { id: d.id }, h.ctx(P1, at(60)));
  assert.deepEqual(b.board.map((r) => [r.rank, r.found, r.you]), [[1, 2, false], [2, 1, true], [3, 0, false]]);
  await assert.rejects(H.huntAction('hunt.board', { id: d.id }, h.ctx(P1, at(121))), /not running/);
  await assert.rejects(H.huntAction('hunt.board', { id: 999 }, h.ctx(P1, at(60))), /No such Hunt/);
});

test('hunt.answers: every place once the Hunt is over, which you found, never before, and not when the Hunt keeps them (Ames 2026-10-26)', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  await H.huntAction('hunt.drop', { id: d.id, kind: 'cut', layer: layer([{ ...pt(5000, 5000, 100), id: 'a1' }]), dims: DIMS }, h.ctx(P1, at(50)));
  await assert.rejects(H.huntAction('hunt.answers', { id: d.id }, h.ctx(P1, at(60))), /once the Hunt is over/);
  assert.equal((await H.huntAction('hunt.current', {}, h.ctx(P1, at(60)))).hunts[0].answers, false);
  const a = await H.huntAction('hunt.answers', { id: d.id }, h.ctx(P1, at(121)));
  assert.equal(a.took_part, true);
  assert.deepEqual(a.places.map((p) => [p.kind, p.found]), [['cut', false], ['cut', true], ['cut', false]]);
  assert.deepEqual(a.places[1].at, [20000, 20000, 4000]);   // nanometres
  const other = await H.huntAction('hunt.answers', { id: d.id }, h.ctx(P2, at(121)));
  assert.deepEqual([other.took_part, other.places.filter((p) => p.found).length], [false, 0]);
  assert.equal((await H.huntAction('hunt.current', {}, h.ctx(P1, at(121)))).hunts[0].answers, true);
  // A Hunt that keeps its answers (its cells are for another Hunt).
  await H.huntAction('hunt.save', { id: d.id, fields: { tiers: { gold: 3, silver: 2, bronze: 1, hide_answers: true } } }, h.ctx(ADMIN, at(122), true));
  await assert.rejects(H.huntAction('hunt.answers', { id: d.id }, h.ctx(P1, at(123))), /keeps its answers/);
  assert.equal((await H.huntAction('hunt.current', {}, h.ctx(P1, at(123)))).hunts[0].answers, false);
});

test('"Hunt results" stays in the top bar 24 hours after the end unless the Hunt says (Ames 2026-10-23)', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const cur = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(121)))).hunts[0];
  assert.equal(cur.results_hours, 24);
  await H.huntAction('hunt.save', { id: d.id, fields: { tiers: { results_hours: 6 } } }, h.ctx(ADMIN, at(122), true));
  assert.equal(H.resultsHours(h.db._s.hunts[0]), 6);
  assert.equal(H.resultsHours({ tiers: { results_hours: 999 } }), 168);
});

test('at the end the board goes by medal, then the quicker clock within each medal; the Achievement note names the award (Ames 2026-10-23)', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  const all = [pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)];
  await H.huntAction('hunt.start', { id: d.id }, h.ctx(P2, at(50)));      // opens early, finds all at 60: 10 hours
  await dropAll(d.id, all, h.ctx(P2, at(60)));
  await H.huntAction('hunt.start', { id: d.id }, h.ctx(P3, at(58)));      // opens at 58, finds all at 59: 1 hour
  await dropAll(d.id, all, h.ctx(P3, at(59)));
  await dropAll(d.id, all.slice(0, 2), h.ctx(P1, at(61)));                // 2 of 3: Silver
  const end = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(121)))).hunts[0];
  assert.deepEqual(end.board.map((b) => [b.name, b.tier]), [['krzysztof', 'gold'], ['annkri', 'gold'], ['nseraf', 'silver']]);
  assert.ok(h.bell.every((n) => /^You earned the ".+" award! /.test(n.body)), JSON.stringify(h.bell.map((n) => n.body)));
});
