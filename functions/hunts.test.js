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

test('tiers default to all, two thirds and one third, and can be set', () => {
  assert.deepEqual(H.thresholds({ target_count: 5 }), { gold: 5, silver: 4, bronze: 2 });
  assert.deepEqual(H.thresholds({ target_count: 3 }), { gold: 3, silver: 2, bronze: 1 });
  assert.deepEqual(H.thresholds({ target_count: 1 }), { gold: 1, silver: 1, bronze: 1 });
  assert.deepEqual(H.thresholds({ target_count: 6, tiers: { gold: 5, silver: 3, bronze: 1 } }), { gold: 5, silver: 3, bronze: 1 });
  // Nonsense is clamped: silver never above gold, bronze at least one.
  assert.deepEqual(H.thresholds({ target_count: 4, tiers: { gold: 9, silver: 9, bronze: 0 } }), { gold: 4, silver: 4, bronze: 2 });
  const th = H.thresholds({ target_count: 5 });
  assert.deepEqual([5, 4, 3, 2, 1, 0].map((f) => H.tierFor(f, th)), ['gold', 'silver', 'bronze', 'bronze', null, null]);
  assert.equal(H.maxPoints({ target_count: 2 }), 10);
  assert.equal(H.maxPoints({ target_count: 7 }), 21);
  assert.equal(H.maxPoints({ target_count: 7, max_points: 12 }), 12);
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
  assert.match(rows[2].body, /awards ceremony/);
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
  assert.deepEqual(f.art, { gold: 'https://x.org/g.png' });
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
    key: async (id) => clone(s.keys[id] || []),
    setKey: async (id, t) => { s.keys[id] = clone(t); },
    submissions: async (id) => clone(s.subs.filter((x) => x.hunt_id === id).map(({ user_id, found, created_at }) => ({ user_id, found, created_at }))),
    allSubmissions: async (id) => clone(s.subs.filter((x) => x.hunt_id === id)),
    mySubmissions: async (id, uid) => clone(s.subs.filter((x) => x.hunt_id === id && x.user_id === uid)),
    addSubmission: async (row) => { const r = { id: s.seq++, created_at: new Date(Date.UTC(2026, 9, 26) + s.subs.length * 1000).toISOString(), ...clone(row) }; s.subs.push(r); return clone(r); },
    patchSubmission: async (id, row) => { Object.assign(s.subs.find((x) => x.id === id), clone(row)); },
    playerCounts: async (ids) => Object.fromEntries(ids.map((id) => [id, new Set(s.subs.filter((x) => x.hunt_id === id).map((x) => x.user_id)).size])),
    names: async (ids) => Object.fromEntries(ids.map((id) => [id, users[id] ? users[id].username : 'Player'])),
    notification: async (id) => clone(s.notes.find((n) => n.id === Number(id)) || null),
    insertNotification: async (row) => { const n = { id: s.seq++, ...clone(row) }; s.notes.push(n); return clone(n); },
    patchNotification: async (id, row) => { const n = s.notes.find((x) => x.id === Number(id)); Object.assign(n, clone(row)); return clone(n); },
    deleteNotification: async (id) => { s.notes = s.notes.filter((n) => n.id !== Number(id)); },
    upsertBadge: async (row) => { let b = s.badges.find((x) => x.slug === row.slug); if (b) Object.assign(b, clone(row)); else { b = { id: s.seq++, ...clone(row) }; s.badges.push(b); } return clone(b); },
    held: async (ids) => new Set(s.awards.filter((a) => ids.includes(a.badge_id)).map((a) => `${a.badge_id}:${a.user_id}`)),
    award: async (rows) => { for (const r of rows) if (!s.awards.some((a) => a.badge_id === r.badge_id && a.user_id === r.user_id)) s.awards.push(clone(r)); },
  };
  return db;
}

function harness() {
  const db = fakeDb();
  const bell = [], chat = [];
  const ctx = (me, now, isAdmin = false) => ({ db, me, isAdmin, now, site: 'https://pyr.example',
    notify: async (rows) => { bell.push(...rows); }, chatAward: async (uid, badge) => { chat.push([uid, badge.name]); } });
  return { db, bell, chat, ctx };
}

const T0 = Date.UTC(2026, 9, 20, 12);
const at = (hours) => new Date(T0 + hours * 3600000);
const KEY = layer([pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)]);   // nm: [4000,4000,4000] [20000,20000,4000] [36000,4000,8000]
const VIEW = { dimensions: DIMS, position: [1000, 1000, 100], layers: [{ type: 'segmentation', name: 'seg', segments: ['648518346350533705'] }, { ...KEY, name: 'Mergers' }] };

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
  await assert.rejects(H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1000, 1000, 100)]), dims: DIMS }, h.ctx(P1, at(30))), /not started/);
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

test('answers are scored, capped and counted; the best answer counts', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled', fields: { max_submissions: 3 } }, h.ctx(ADMIN, at(1), true));
  const p1 = h.ctx(P1, at(60));
  const r1 = await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1010, 1000, 100)]), dims: DIMS }, p1);
  assert.deepEqual({ found: r1.found, of: r1.of, best: r1.best, left: r1.left, tier: r1.tier }, { found: 1, of: 3, best: 1, left: 2, tier: 'bronze' });
  const r2 = await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1000, 1000, 100), pt(5000, 5050, 100), pt(9000, 1000, 200)]), dims: DIMS }, p1);
  assert.equal(r2.found, 3); assert.equal(r2.tier, 'gold');
  // A worse answer later does not lower the best.
  const r3 = await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1, 1, 1)]), dims: DIMS }, p1);
  assert.equal(r3.found, 0); assert.equal(r3.best, 3); assert.equal(r3.left, 0);
  await assert.rejects(H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1, 1, 1)]), dims: DIMS }, p1), /all 3/);
  // Too many points, or none, is refused before it counts.
  const many = layer(Array.from({ length: 11 }, (_, i) => pt(i * 100, 0, 0)));
  await assert.rejects(H.huntAction('hunt.submit', { id: d.id, layer: many, dims: DIMS }, h.ctx(P2, at(61))), /at most 10 gems/);
  await assert.rejects(H.huntAction('hunt.submit', { id: d.id, layer: layer([]), dims: DIMS }, h.ctx(P2, at(61))), /Drop a gem/);
  assert.equal(h.db._s.subs.filter((s) => s.user_id === P2.id).length, 0);
  const cur = (await H.huntAction('hunt.current', {}, h.ctx(P1, at(62)))).hunts[0];
  assert.deepEqual(cur.you, { best: 3, submissions: 3, left: 0, tier: 'gold', rank: 1 });
  assert.equal(cur.board[0].name, 'nseraf');
});

test('at the end the awards are given once, to each tier, with a bell note and a chat line', async () => {
  const h = harness();
  const d = await makeHunt(h);
  await H.huntAction('hunt.save', { id: d.id, status: 'scheduled' }, h.ctx(ADMIN, at(1), true));
  await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000, 1000, 200)]), dims: DIMS }, h.ctx(P1, at(60)));
  await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1000, 1000, 100), pt(5000, 5000, 100)]), dims: DIMS }, h.ctx(P2, at(61)));
  await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1, 1, 1)]), dims: DIMS }, h.ctx(P3, at(62)));
  // Before the end, an admin cannot award.
  await assert.rejects(H.huntAction('hunt.award', { id: d.id }, h.ctx(ADMIN, at(100), true)), /not ended/);
  const after = await H.huntAction('hunt.current', {}, h.ctx(P3, at(121)));
  const hunt = after.hunts[0];
  assert.equal(hunt.phase, 'ended'); assert.equal(hunt.awarded, true);
  assert.deepEqual(hunt.winners, { gold: 1, silver: 1, bronze: 0 });
  assert.deepEqual(h.db._s.badges.map((b) => b.slug).sort(), [`hunt-${d.id}-gold`, `hunt-${d.id}-silver`]);
  assert.equal(h.db._s.badges.find((b) => b.slug.endsWith('gold')).name, 'Pinky Hunt: Gold');
  assert.equal(h.db._s.badges.find((b) => b.slug.endsWith('gold')).image_url, 'https://pyr.example/hunt/gold.svg');
  assert.equal(h.db._s.awards.length, 2);
  assert.deepEqual(h.bell.map((b) => b.title).sort(), ['🏅 New Achievement: Pinky Hunt: Gold', '🏅 New Achievement: Pinky Hunt: Silver']);
  assert.equal(h.chat.length, 2);
  // Others opening the game later change nothing.
  await H.huntAction('hunt.current', {}, h.ctx(P1, at(122)));
  await H.huntAction('hunt.current', {}, h.ctx(P2, at(123)));
  assert.equal(h.db._s.awards.length, 2); assert.equal(h.bell.length, 2); assert.equal(h.chat.length, 2);
  // An admin's Award again is idempotent: no second note.
  const again = await H.huntAction('hunt.award', { id: d.id }, h.ctx(ADMIN, at(124), true));
  assert.equal(again.fresh, 0); assert.equal(h.bell.length, 2);
  // The submit window is closed.
  await assert.rejects(H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1, 1, 1)]), dims: DIMS }, h.ctx(P3, at(125))), /over/);
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
  await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1000, 1000, 100)]), dims: DIMS }, h.ctx(P1, at(4)));
  const e = await H.huntAction('hunt.now', { id: d.id, kind: 'end' }, h.ctx(ADMIN, at(5), true));
  assert.equal(e.phase, 'ended'); assert.ok(e.awarded_at); assert.equal(e.notes.end.sent, true);
  assert.equal(h.db._s.awards.length, 1);
  assert.equal(h.db._s.notes.length, 3);
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
  await H.huntAction('hunt.submit', { id: d.id, layer: layer([pt(1000, 1000, 100)]), dims: DIMS }, h.ctx(P1, at(60)));
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
  assert.match(g.description, /^Gold in Pinky Hunt, every one of the 5 mergers found\. /);
  const s = H.badgeRow(hunt, 'silver', th, 'https://pyr.example');
  assert.equal(s.image_url, 'https://pyr.example/hunt/silver.svg');
  assert.match(s.description, /4 or more of the 5 mergers/);
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
  assert.ok(/drop a gold gem/.test(view.notes.start.body));
  // After the announcement is out, a new picture still reaches it; its words and time stay.
  const sent = clone(h.db._s.notes[0]);
  await H.huntAction('hunt.save', { id: d.id, fields: { notif_images: { announce: B, end: B }, title: 'Renamed Hunt' } }, h.ctx(ADMIN, at(30), true));
  assert.equal(h.db._s.notes[0].image_url, B.image_url);
  assert.equal(h.db._s.notes[0].title, sent.title);
  assert.equal(h.db._s.notes[0].send_at, sent.send_at);
  // The start note is not out yet: it takes the new title and loses its picture.
  assert.equal(h.db._s.notes[1].image_url, null);
  assert.ok(h.db._s.notes[1].title.endsWith('Renamed Hunt'));
});

test('an admin can try any hunt: it opens as running, is scored against the real key, and nothing is kept', async () => {
  const h = harness();
  const d = await makeHunt(h);   // a draft: players see nothing
  await assert.rejects(H.huntAction('hunt.test', { id: d.id }, h.ctx(P1, at(1))), /Admins only/);
  await assert.rejects(H.huntAction('hunt.test_submit', { id: d.id, layer: KEY, dims: DIMS }, h.ctx(P1, at(1))), /Admins only/);
  const t = await H.huntAction('hunt.test', { id: d.id }, h.ctx(ADMIN, at(1), true));
  assert.equal(t.test, true);
  assert.equal(t.phase, 'live');
  assert.ok(t.view && Array.isArray(t.view.layers) && !JSON.stringify(t.view).includes('Mergers'));
  assert.deepEqual(t.cells.map((c) => c.root), ['648518346350533705']);
  // Two gems on mergers, one 2.5 µm off the third (tolerance 2 µm).
  const gems = layer([pt(1000, 1000, 100), pt(5000, 5000, 100), pt(9000 + 625, 1000, 200)]);
  const r = await H.huntAction('hunt.test_submit', { id: d.id, layer: gems, dims: DIMS }, h.ctx(ADMIN, at(1), true));
  assert.equal(r.found, 2);
  assert.equal(r.of, 3);
  assert.equal(r.test, true);
  assert.deepEqual(r.mergers.map((m) => m.found), [true, true, false]);
  assert.deepEqual(r.mergers.map((m) => m.nearest_um), [0, 0, 2.5]);
  assert.equal(h.db._s.subs.length, 0);
  // A hunt with no key yet cannot be tried.
  const empty = await H.huntAction('hunt.save', { fields: { title: 'Empty', dataset: 'pinky_nf_v2' }, status: 'draft' }, h.ctx(ADMIN, at(1), true));
  await assert.rejects(H.huntAction('hunt.test', { id: empty.id }, h.ctx(ADMIN, at(1), true)), /answer key/);
});

test('the Admin Hub can preview the notes with the form as it is, before anything is saved', async () => {
  const h = harness();
  const fields = { title: 'Preview Hunt', cells: [{ root: '648518346350533705' }], announce_at: iso(at(24)), start_at: iso(at(48)), end_at: iso(at(120)),
    notif_images: { start: { image_url: 'https://img.example/s.png' } } };
  const rows = await H.huntAction('hunt.notes', { fields, target_count: 4 }, h.ctx(ADMIN, at(1), true));
  assert.deepEqual(rows.map((r) => r.kind), ['announce', 'start', 'end']);
  assert.ok(/4 mergers are hidden on one cell/.test(rows[1].body));
  assert.deepEqual(rows.map((r) => r.image_url), [null, 'https://img.example/s.png', null]);
  assert.equal(h.db._s.hunts.length + h.db._s.notes.length, 0);
  await assert.rejects(H.huntAction('hunt.notes', { fields }, h.ctx(P1, at(1))), /Admins only/);
});
