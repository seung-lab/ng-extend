'use strict';
// The Hunt Builder's rules (hunt_build.js), with an in-memory database in place of Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('./hunt_build');

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', username: 'ames' };
const P1 = { id: '22222222-2222-4222-8222-222222222222', username: 'nseraf' };
const P2 = { id: '33333333-3333-4333-8333-333333333333', username: 'annkri' };
const P3 = { id: '44444444-4444-4444-8444-444444444444', username: 'toknow' };
const USERS = [ADMIN, P1, P2, P3];
const CELL = '648518346349539437';
const NEIGHBOR = '648518346349500001';
const CELL2 = '648518346349600002';
const PIECE = '648518346349700003';

function fakeDb() {
  const t = { candidates: [], suggestions: [], tasks: [], hunts: [] };
  let cid = 0, sid = 0, tid = 100;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const db = {
    _t: t,
    candidates: async () => clone([...t.candidates].reverse()),
    candidate: async (id) => clone(t.candidates.find((c) => c.id === id) || null),
    candidatesByStatus: async (st) => clone(t.candidates.filter((c) => st.includes(c.status))),
    protectedCandidates: async () => clone(t.candidates.filter((c) => B.PROTECTED.has(c.status))),
    candidatesForHunt: async (id) => clone(t.candidates.filter((c) => c.hunt_id === id)),
    addCandidate: async (row) => { const c = { id: ++cid, protected_roots: [], helpers: [], merges_each: 2, cuts_each: 2, ...row }; t.candidates.push(c); return clone(c); },
    patchCandidate: async (id, row) => { const c = t.candidates.find((x) => x.id === id); Object.assign(c, clone(row)); return clone(c); },
    suggestion: async (id) => clone(t.suggestions.find((s) => s.id === id) || null),
    suggestionsFor: async (c) => clone(t.suggestions.filter((s) => s.candidate_id === c)),
    suggestionsBy: async (uid, cids) => clone(t.suggestions.filter((s) => s.user_id === uid && cids.includes(s.candidate_id))),
    suggestionCounts: async () => ({}),
    addSuggestion: async (row) => { const s = { id: ++sid, ...clone(row) }; t.suggestions.push(s); return clone(s); },
    patchSuggestion: async (id, row) => { const s = t.suggestions.find((x) => x.id === id); Object.assign(s, clone(row)); return clone(s); },
    tasks: async (ids) => clone(t.tasks.filter((x) => ids.includes(x.id))),
    taskFor: async (ds, root) => clone(t.tasks.find((x) => x.dataset === ds && x.segment_id === root) || null),
    addTask: async (row) => { const x = { id: ++tid, status: 'pending', ...row }; t.tasks.push(x); return clone(x); },
    patchTask: async (id, row) => { Object.assign(t.tasks.find((x) => x.id === id), row); },
    huntTimes: async (ids) => clone(t.hunts.filter((h) => ids.includes(h.id))),
    names: async (ids) => Object.fromEntries(USERS.filter((u) => ids.includes(u.id)).map((u) => [u.id, u.username])),
    usersByName: async (names) => USERS.filter((u) => names.some((n) => n.toLowerCase() === u.username)),
  };
  return db;
}
const notes = [];
const ctx = (db, me, isAdmin = false, now = new Date('2026-10-28T12:00:00Z')) => ({ db, me, isAdmin, now, notify: async (rows) => { notes.push(...rows); } });
const merge = [['111', 1000, 2000, 400], ['222', 1100, 2100, 440]];
const cut = { sources: [['333', 0, 0, 0], ['334', 10, 0, 0]], sinks: [['444', 30, 30, 40]] };

/** A candidate taken to suggestions, with P1 and P2 invited. */
async function openCell(db) {
  const A = ctx(db, ADMIN, true);
  await B.buildAction('build.add', { roots: [CELL] }, A);
  const task = db._t.tasks[0];
  Object.assign(task, { status: 'completed', assigned_to: P3.id, final_segment_id: CELL, supervoxel_id: '999', claim_point_x: 10, claim_point_y: 20, claim_point_z: 30 });
  await B.buildAction('build.list', {}, A);
  await B.buildAction('build.helpers', { id: 1, names: 'nseraf, ANNKRI' }, A);
  await B.buildAction('build.move', { id: 1, to: 'suggesting' }, A);
  return A;
}

test('an edit is kept as the graph would have been sent it, with its middle', () => {
  const m = B.cleanEdit('merge', merge);
  assert.deepEqual(m.edit, merge);
  assert.deepEqual(m.at_nm, [1050, 2050, 420]);
  const c = B.cleanEdit('cut', cut);
  assert.deepEqual(c.at_nm, [13, 10, 13]);
  assert.throws(() => B.cleanEdit('merge', [merge[0]]), /two points/);
  assert.throws(() => B.cleanEdit('merge', [merge[0], merge[0]]), /same piece/);
  assert.throws(() => B.cleanEdit('cut', { sources: cut.sources, sinks: [] }), /red and blue/);
  assert.throws(() => B.cleanEdit('cut', { sources: [['x', 1, 2, 3]], sinks: cut.sinks }), /red and blue/);
  assert.throws(() => B.cleanEdit('split', cut), /merge or a cut/);
});

test('a planted edit is a Hunt place reversed: a merge plants a merger to Cut, a cut a piece to Extend', () => {
  assert.equal(B.placeOf({ kind: 'merge', edit: merge }).kind, 'cut');
  assert.equal(B.placeOf({ kind: 'cut', edit: cut }).kind, 'merge');
  assert.deepEqual(B.placeOf({ kind: 'cut', edit: cut }).nm, [13, 10, 13]);
});

test('Phase 1: a candidate is a task in the Library; Done makes it proofread with its soma', async () => {
  const db = fakeDb();
  const A = ctx(db, ADMIN, true);
  const r = await B.buildAction('build.add', { roots: `${CELL}\n${CELL} ${CELL2} nonsense` }, A);
  assert.equal(r.added, 2);
  assert.equal(db._t.tasks.length, 2);
  assert.equal(db._t.tasks[0].notes, B.TASK_NOTE);
  assert.equal(db._t.tasks[0].dataset, 'pinky_nf_v2');
  // Again: the open candidate is not added twice.
  assert.deepEqual((await B.buildAction('build.add', { roots: [CELL] }, A)).skipped, [CELL]);
  Object.assign(db._t.tasks[0], { status: 'completed', assigned_to: P3.id, final_segment_id: '648518346349539999', supervoxel_id: '999', claim_point_x: 1, claim_point_y: 2, claim_point_z: 3 });
  const l = await B.buildAction('build.list', {}, A);
  const c = l.cells.find((x) => x.id === 1);
  assert.equal(c.status, 'proofread');
  assert.equal(c.root, '648518346349539999');
  assert.equal(c.proofread_by, 'toknow');
  assert.deepEqual(c.start, [1, 2, 3]);
  assert.deepEqual(c.moves, ['suggesting', 'proofreading', 'dropped']);
  // Players never read the list.
  await assert.rejects(B.buildAction('build.list', {}, ctx(db, P1)), /Admins only/);
});

test('suggestions open only with helpers, and the helpers hear', async () => {
  const db = fakeDb();
  const A = ctx(db, ADMIN, true);
  await B.buildAction('build.add', { roots: [CELL] }, A);
  Object.assign(db._t.tasks[0], { status: 'completed', assigned_to: P3.id, final_segment_id: CELL });
  await B.buildAction('build.list', {}, A);
  await assert.rejects(B.buildAction('build.move', { id: 1, to: 'suggesting' }, A), /Invite at least one helper/);
  await assert.rejects(B.buildAction('build.helpers', { id: 1, names: 'nobody' }, A), /No player called nobody/);
  notes.length = 0;
  await B.buildAction('build.helpers', { id: 1, names: ['nseraf'] }, A);
  assert.equal(notes.length, 0, 'not open yet: no note');
  await B.buildAction('build.move', { id: 1, to: 'suggesting' }, A);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user_id, P1.id);
  assert.match(notes[0].title, /Help build a Hunt/);
  await assert.rejects(B.buildAction('build.move', { id: 1, to: 'in_hunt' }, A), /cannot go to in_hunt/);
});

test('a helper suggests two merges and two cuts; a third is refused; take back frees one', async () => {
  const db = fakeDb();
  await openCell(db);
  const H1 = ctx(db, P1);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge, note: 'thin axon' }, H1);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, H1);
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, H1), /your 2 merge suggestions/);
  const r = await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, H1);
  assert.deepEqual(r.used, { merge: 2, cut: 1 });
  await B.buildAction('build.take_back', { id: 2 }, H1);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, H1);
  // Not invited: refused. Another's suggestion: not theirs to take back.
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, ctx(db, P3)), /invited helpers/);
  await assert.rejects(B.buildAction('build.take_back', { id: 1 }, ctx(db, P2)), /No such suggestion/);
  // A helper sees only their own.
  const m = await B.buildAction('build.mine', {}, ctx(db, P2));
  assert.equal(m.cells.length, 1);
  assert.equal(m.cells[0].suggestions.length, 0);
  const m1 = await B.buildAction('build.mine', {}, H1);
  assert.equal(m1.cells[0].suggestions.length, 3);
  assert.equal(m1.cells[0].suggestions[0].note, 'thin axon');
  assert.equal((await B.buildAction('build.mine', {}, ctx(db, P3))).cells.length, 0);
});

test('the guard: protected from suggestions on, veiled from planting on, helpers marked, no suggestions leak', async () => {
  const db = fakeDb();
  const A = await openCell(db);
  let g = await B.buildAction('build.guard', {}, ctx(db, P3));
  assert.equal(g.cells.length, 1);
  assert.deepEqual(g.cells[0].protected, [CELL]);
  assert.deepEqual(g.cells[0].veil, [], 'suggesting: not veiled yet');
  assert.equal(g.cells[0].helper, false);
  assert.equal(g.cells[0].suggestions, undefined);
  assert.equal(g.cells[0].helpers, undefined);
  assert.equal((await B.buildAction('build.guard', {}, ctx(db, P1))).cells[0].helper, true);
  await B.buildAction('build.move', { id: 1, to: 'planting' }, A);
  g = await B.buildAction('build.guard', {}, ctx(db, P1));
  assert.deepEqual(g.cells[0].veil, [CELL]);
  assert.equal(g.cells[0].helper, false, 'planting: helpers are players again');
});

test('planting: the queue is oldest first; Plant it keeps the operation and protects every ID it touched', async () => {
  const db = fakeDb();
  const A = await openCell(db);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, ctx(db, P1, false, new Date('2026-10-28T12:05:00Z')));
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, ctx(db, P2, false, new Date('2026-10-28T12:01:00Z')));
  let q = await B.buildAction('build.queue', { id: 1 }, A);
  assert.deepEqual(q.suggestions.map((s) => s.name), ['annkri', 'nseraf']);
  await assert.rejects(B.buildAction('build.plant', { id: 1, operation_id: 77, new_roots: [CELL2] }, A), /start planting first/);
  await B.buildAction('build.move', { id: 1, to: 'planting' }, A);
  // Suggestions are closed now.
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, ctx(db, P1)), /not taking suggestions/);
  notes.length = 0;
  q = await B.buildAction('build.plant', { id: 1, operation_id: 77, before_roots: [CELL, NEIGHBOR], new_roots: [CELL2] }, A);
  assert.equal(q.suggestions.find((s) => s.id === 1).status, 'planted');
  assert.equal(q.cell.root, CELL2);
  assert.deepEqual(q.cell.protected.sort(), [CELL, NEIGHBOR, CELL2].sort());
  assert.equal(notes[0].user_id, P1.id);
  assert.doesNotMatch(notes[0].body, /\d{5}/, 'the note never says where');
  await assert.rejects(B.buildAction('build.plant', { id: 1, operation_id: 78 }, A), /dealt with already/);
  // The cut: the piece cut off is protected; the cell's ID after it is what the caller says.
  q = await B.buildAction('build.plant', { id: 2, operation_id: 79, before_roots: [CELL2], new_roots: ['648518346349800004', PIECE], cell_root: '648518346349800004' }, A);
  assert.equal(q.cell.root, '648518346349800004');
  assert.ok(q.cell.protected.includes(PIECE));
  // The key: reversed, with who suggested each.
  const p = await B.buildAction('build.planted', { id: 1 }, A);
  assert.deepEqual(p.places.map((x) => [x.kind, x.user, x.op]), [['cut', 'nseraf', 77], ['merge', 'annkri', 79]]);
});

test('skip and undo; undo is refused once the cell is in a Hunt', async () => {
  const db = fakeDb();
  const A = await openCell(db);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, ctx(db, P1));
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, ctx(db, P1));
  await B.buildAction('build.move', { id: 1, to: 'planting' }, A);
  let q = await B.buildAction('build.skip', { id: 2, note: 'too easy' }, A);
  assert.equal(q.suggestions[1].status, 'skipped');
  assert.equal(q.suggestions[1].admin_note, 'too easy');
  await B.buildAction('build.plant', { id: 1, operation_id: 80, new_roots: [CELL2] }, A);
  q = await B.buildAction('build.undo', { id: 1, new_roots: ['648518346349900005'] }, A);
  assert.equal(q.suggestions[0].status, 'undone');
  assert.equal(q.cell.root, '648518346349900005');
  assert.ok(q.cell.protected.includes(CELL2), 'old IDs stay protected');
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, ctx(db, P1)).catch(() => null);
  assert.equal((await B.buildAction('build.planted', { id: 1 }, A)).places.length, 0);
});

test('in a Hunt: the veil lifts for the cell alone at the start; put back after the end', async () => {
  const db = fakeDb();
  const A = await openCell(db);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, ctx(db, P1));
  await B.buildAction('build.move', { id: 1, to: 'planting' }, A);
  await B.buildAction('build.plant', { id: 1, operation_id: 90, before_roots: [CELL], new_roots: [CELL2, PIECE], cell_root: CELL2 }, A);
  await assert.rejects(B.buildAction('build.link', { id: 1, hunt_id: 5 }, A), /Building/);
  await B.buildAction('build.move', { id: 1, to: 'building' }, A);
  await assert.rejects(B.buildAction('build.link', { id: 1, hunt_id: 5 }, A), /No such Hunt/);
  db._t.hunts.push({ id: 5, start_at: '2026-11-01T15:00:00Z', end_at: '2026-11-01T17:00:00Z', status: 'scheduled' });
  await B.buildAction('build.link', { id: 1, hunt_id: 5 }, A);
  const veil = async (at) => (await B.buildAction('build.guard', {}, ctx(db, P2, false, new Date(at)))).cells[0].veil.sort();
  assert.deepEqual(await veil('2026-11-01T14:59:00Z'), [CELL, CELL2, PIECE].sort());
  // Planted cuts show only the original segment (Ames 2026-10-27): the piece stays hidden.
  assert.deepEqual(await veil('2026-11-01T15:01:00Z'), [CELL, PIECE].sort());
  await assert.rejects(B.buildAction('build.put_back', { id: 1 }, ctx(db, ADMIN, true, new Date('2026-11-01T16:00:00Z'))), /not ended/);
  const after = ctx(db, ADMIN, true, new Date('2026-11-01T18:00:00Z'));
  const ops = await B.buildAction('build.put_back', { id: 1 }, after);
  assert.deepEqual(ops.operations, [90]);
  const done = await B.buildAction('build.put_back', { id: 1, done: true, undone: [90], cell_root: '648518346349999999' }, after);
  assert.equal(done.left, 0);
  assert.equal(db._t.candidates[0].status, 'put_back');
  assert.equal((await B.buildAction('build.guard', {}, ctx(db, P2))).cells.length, 0, 'put back: nothing guarded');
  // The makers: whoever had one planted.
  assert.deepEqual(await B.makersOf(db, 5), [P1.id]);
});

test('claims on a protected cell are refused, by its ID or any it had', () => {
  const cands = [{ status: 'planting', root: CELL2, protected_roots: [CELL, NEIGHBOR] }, { status: 'put_back', root: PIECE, protected_roots: [] }];
  assert.match(B.claimRefusal(cands, CELL), /being made into a Hunt/);
  assert.match(B.claimRefusal(cands, NEIGHBOR), /being made into a Hunt/);
  assert.equal(B.claimRefusal(cands, PIECE), null);
  assert.equal(B.claimRefusal(cands, 'abc'), null);
});

test('claimGuard reads a task\'s cell and never blocks when the tables are missing', async () => {
  const sb = async (path) => {
    if (path.startsWith('proofreading_tasks')) return [{ segment_id: CELL }];
    if (path.startsWith('hunt_candidates')) return [{ status: 'suggesting', root: CELL, protected_roots: [] }];
    return [];
  };
  assert.match(await B.claimGuard(sb, 'claim', { id: 7 }), /cannot be claimed/);
  assert.match(await B.claimGuard(sb, 'claim_cell', { segment_id: CELL }), /cannot be claimed/);
  assert.equal(await B.claimGuard(sb, 'release', { id: 7 }), null);
  const missing = async (path) => { if (path.startsWith('hunt_candidates')) throw new Error('supabase 404'); return []; };
  assert.equal(await B.claimGuard(missing, 'claim_cell', { segment_id: CELL }), null);
});

test('settings are clamped', () => {
  assert.deepEqual(B.cleanSettings({ merges_each: 3, cuts_each: '0', admin_note: 'x' }), { merges_each: 3, cuts_each: 0, admin_note: 'x' });
  assert.throws(() => B.cleanSettings({ merges_each: 11 }), /Between 0 and 10/);
});
