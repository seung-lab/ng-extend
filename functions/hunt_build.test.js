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
/** Another merge, somewhere else (the same edit twice is one suggestion). */
const mergeAt = (k) => [[String(500 + k), 1000 + k, 2000, 400], [String(600 + k), 1100 + k, 2100, 440]];

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
  assert.deepEqual(c.moves, ['suggesting', 'building', 'proofreading', 'dropped']);
  // Players never read the list.
  await assert.rejects(B.buildAction('build.list', {}, ctx(db, P1)), /Admins only/);
});

test('suggestions open to everyone with production access, and anyone invited; they hear', async () => {
  const db = fakeDb();
  const groupNotes = [];
  db.productionGroupId = async () => 42;
  db.insertGroupNote = async (row) => { groupNotes.push(row); return row; };
  const A = ctx(db, ADMIN, true);
  await B.buildAction('build.add', { roots: [CELL] }, A);
  Object.assign(db._t.tasks[0], { status: 'completed', assigned_to: P3.id, final_segment_id: CELL });
  await B.buildAction('build.list', {}, A);
  await assert.rejects(B.buildAction('build.helpers', { id: 1, names: 'nobody' }, A), /No player called nobody/);
  notes.length = 0;
  await B.buildAction('build.helpers', { id: 1, names: ['nseraf'] }, A);
  assert.equal(notes.length, 0, 'not open yet: no note');
  // No invite needed to open.
  await B.buildAction('build.move', { id: 1, to: 'suggesting' }, A);
  assert.equal(groupNotes.length, 1, 'one note to the Production editors group');
  assert.equal(groupNotes[0].target_type, 'group');
  assert.equal(groupNotes[0].target_id, '42');
  assert.equal(notes.length, 1, 'and one to the invited player');
  assert.equal(notes[0].user_id, P1.id);
  // A player with production access suggests without an invite; one without, and not invited, cannot.
  const prod = { ...ctx(db, P3), production: async () => true };
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, prod);
  assert.equal((await B.buildAction('build.guard', {}, prod)).cells[0].helper, true);
  assert.equal((await B.buildAction('build.mine', {}, prod)).cells.length, 1);
  const none = { ...ctx(db, P2), production: async () => false };
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, none), /production access/);
  assert.equal((await B.buildAction('build.guard', {}, none)).cells[0].helper, false);
  // CAVE not answering counts as no access, never as yes.
  const unknown = { ...ctx(db, P2), production: async () => null };
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, unknown), /production access/);
  await assert.rejects(B.buildAction('build.move', { id: 1, to: 'in_hunt' }, A), /cannot go to in_hunt/);
});

test('a helper suggests two merges and two cuts; a third is refused; take back frees one', async () => {
  const db = fakeDb();
  await openCell(db);
  const H1 = ctx(db, P1);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge, note: 'thin axon' }, H1);
  // The same merge again is the one already kept (Ames 2026-10-27: "why does it show 2 mergers?").
  const again = await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, H1);
  assert.equal(again.again, true);
  assert.equal(again.used.merge, 1);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: mergeAt(1) }, H1);
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: mergeAt(2) }, H1), /your 2 merge suggestions/);
  const r = await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, H1);
  assert.deepEqual(r.used, { merge: 2, cut: 1 });
  assert.equal(r.suggestion.status, 'draft', 'a draft until Send');
  await B.buildAction('build.take_back', { id: 2 }, H1);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: mergeAt(3) }, H1);
  // Not invited: refused. Another's suggestion: not theirs to take back.
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, ctx(db, P3)), /production access/);
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
  // Drafts are not in the queue until sent.
  assert.equal((await B.buildAction('build.queue', { id: 1 }, A)).suggestions.length, 0);
  await B.buildAction('build.send', { candidate_id: 1 }, ctx(db, P1));
  await B.buildAction('build.send', { candidate_id: 1 }, ctx(db, P2));
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

test('a closing time: helpers can suggest until it, then the cell waits for the admins, still locked', async () => {
  const db = fakeDb();
  const A = ctx(db, ADMIN, true);
  await B.buildAction('build.add', { roots: [CELL] }, A);
  Object.assign(db._t.tasks[0], { status: 'completed', assigned_to: P3.id, final_segment_id: CELL });
  await B.buildAction('build.list', {}, A);
  await B.buildAction('build.helpers', { id: 1, names: 'nseraf' }, A);
  await assert.rejects(B.buildAction('build.move', { id: 1, to: 'suggesting', suggest_until: '2026-10-27T00:00:00Z' }, A), /in the future/);
  notes.length = 0;
  await B.buildAction('build.move', { id: 1, to: 'suggesting', suggest_until: '2026-10-30T19:00:00Z' }, A);
  assert.match(notes[0].body, /Submissions close: Oct 30, 3:00 PM ET./);
  const before = ctx(db, P1, false, new Date('2026-10-30T18:59:00Z')), after = ctx(db, P1, false, new Date('2026-10-30T19:01:00Z'));
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, before);
  await assert.rejects(B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, after), /have closed/);
  assert.equal((await B.buildAction('build.guard', {}, before)).cells[0].helper, true);
  const g = (await B.buildAction('build.guard', {}, after)).cells[0];
  assert.equal(g.helper, false, 'closed: a helper\'s edit is refused, not kept');
  assert.deepEqual(g.protected, [CELL], 'still locked');
  const m = (await B.buildAction('build.mine', {}, after)).cells[0];
  assert.equal(m.open, false);
  assert.equal(m.closes, '2026-10-30T19:00:00.000Z');
  const l = await B.buildAction('build.list', {}, ctx(db, ADMIN, true, new Date('2026-10-30T19:01:00Z')));
  assert.equal(l.cells[0].closed, true);
  // The admin can change it.
  await B.buildAction('build.set', { id: 1, fields: { suggest_until: null } }, A);
  assert.equal(db._t.candidates[0].suggest_until, null);
});

test('from the proofreaders\' own edits: proofread straight to building; the proofread cell stays hidden through the Hunt', async () => {
  const db = fakeDb();
  const A = ctx(db, ADMIN, true);
  await B.buildAction('build.add', { roots: [CELL] }, A);
  Object.assign(db._t.tasks[0], { status: 'completed', assigned_to: P3.id, final_segment_id: CELL2 });
  await B.buildAction('build.list', {}, A);
  assert.ok(db._t.candidates[0].status === 'proofread');
  await B.buildAction('build.move', { id: 1, to: 'building' }, A);
  let g = await B.buildAction('build.guard', {}, ctx(db, P2));
  assert.deepEqual(g.cells[0].veil, [CELL2], 'building: veiled at once');
  db._t.hunts.push({ id: 7, start_at: '2026-11-01T15:00:00Z', end_at: '2026-11-01T17:00:00Z', status: 'scheduled' });
  // Players hunt the cell as it was before proofreading (an old ID); the proofread cell is the answer.
  await B.buildAction('build.link', { id: 1, hunt_id: 7, hunt_root: CELL }, A);
  g = await B.buildAction('build.guard', {}, ctx(db, P2, false, new Date('2026-11-01T15:30:00Z')));
  assert.deepEqual(g.cells[0].veil, [CELL2], 'during the Hunt the proofread cell stays hidden');
  // Nothing was planted: Put it back after the end simply closes it.
  const after = ctx(db, ADMIN, true, new Date('2026-11-01T18:00:00Z'));
  assert.deepEqual((await B.buildAction('build.put_back', { id: 1 }, after)).operations, []);
  await B.buildAction('build.put_back', { id: 1, done: true, undone: [] }, after);
  assert.equal(db._t.candidates[0].status, 'put_back');
});

test('the Cell Library note says Hunt candidate', () => { assert.match(B.TASK_NOTE, /^Hunt candidate:/); });

test('a claim on a Hunt candidate is let go after 24 hours, and the player hears', async () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const rows = [
    { task_id: 101, user_id: P1.id, claimed_at: '2026-10-27T11:59:00Z', status: 'active' },
    { task_id: 102, user_id: P2.id, claimed_at: '2026-10-27T12:30:00Z', status: 'active' },
  ];
  assert.deepEqual(B.staleClaims(rows, now).map((a) => a.task_id), [101]);
  const db = fakeDb();
  const A = ctx(db, ADMIN, true, now);
  await B.buildAction('build.add', { roots: [CELL, CELL2] }, A);
  const released = [];
  db.activeAssignments = async () => rows;
  db.releaseClaim = async (taskId, userId) => { released.push([taskId, userId]); return true; };
  notes.length = 0;
  assert.equal(await B.releaseStale(A, true), 1);
  assert.deepEqual(released, [[101, P1.id]]);
  assert.equal(notes[0].user_id, P1.id);
  assert.match(notes[0].title, /let go/);
  // Not more than once every 5 minutes on its own.
  assert.equal(await B.releaseStale(A), 0);
});

test('each suggestion reaches the admins with a link to it in the queue; the queue opens at it', async () => {
  const db = fakeDb();
  db.adminUserIds = async () => [ADMIN.id];
  const A = await openCell(db);
  notes.length = 0;
  const r = await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut, note: 'hard one' }, ctx(db, P1));
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: merge }, ctx(db, P1));
  assert.equal(notes.filter((x) => x.user_id === ADMIN.id).length, 0, 'not until Send');
  const sent = await B.buildAction('build.send', { candidate_id: 1 }, ctx(db, P1));
  assert.equal(sent.sent, 2);
  assert.equal(notes.filter((x) => x.user_id === ADMIN.id).length, 1, 'one note for the whole set');
  const n = notes.find((x) => x.user_id === ADMIN.id);
  assert.match(n.title, /^💡 Hunt suggestion: cell …539437$/);
  assert.ok(n.body.includes(`[Go there](#nge-build-suggestion=${r.suggestion.id})`));
  assert.match(n.body, /nseraf sent 1 merge and 1 cut/);
  const q = await B.buildAction('build.queue', { suggestion_id: r.suggestion.id }, A);
  assert.equal(q.cell.id, 1);
  await assert.rejects(B.buildAction('build.queue', { suggestion_id: 999 }, A), /No such suggestion/);
});

test('the opening note counts in words and carries the Help build button', async () => {
  const db = fakeDb();
  const groupNotes = [];
  db.productionGroupId = async () => 42;
  db.insertGroupNote = async (row) => { groupNotes.push(row); return row; };
  const A = ctx(db, ADMIN, true);
  await B.buildAction('build.add', { roots: [CELL], settings: { merges_each: 1, cuts_each: 2 } }, A);
  Object.assign(db._t.tasks[0], { status: 'completed', assigned_to: P3.id, final_segment_id: CELL });
  await B.buildAction('build.list', {}, A);
  await B.buildAction('build.move', { id: 1, to: 'suggesting' }, A);
  assert.ok(groupNotes[0].body.includes('You may submit:' + String.fromCharCode(10, 10) + '* 1 merge' + String.fromCharCode(10) + '* 2 cuts'), groupNotes[0].body);
  assert.ok(groupNotes[0].body.startsWith('Help build a Hunt on the Sandbox!'));
  assert.match(groupNotes[0].body, /\[Help build\]\(#nge-help-build\)/);
});

test('drafts a helper never sent count as sent when planting starts', async () => {
  const db = fakeDb();
  db.adminUserIds = async () => [ADMIN.id];
  const A = await openCell(db);
  await B.buildAction('build.suggest', { candidate_id: 1, kind: 'cut', edit: cut }, ctx(db, P1));
  notes.length = 0;
  await B.buildAction('build.move', { id: 1, to: 'planting' }, A);
  assert.equal(db._t.suggestions[0].status, 'open');
  assert.ok(notes.some((x) => x.user_id === ADMIN.id && /nseraf sent 1 cut/.test(x.body)));
  assert.equal((await B.buildAction('build.queue', { id: 1 }, A)).suggestions.length, 1);
});

test('two at once cannot pass the limit', async () => {
  const db = fakeDb();
  await openCell(db);
  const H1 = ctx(db, P1);
  const out = await Promise.allSettled([1, 2, 3].map((k) => B.buildAction('build.suggest', { candidate_id: 1, kind: 'merge', edit: mergeAt(k) }, H1)));
  const kept = db._t.suggestions.filter((x) => x.kind === 'merge' && x.status !== 'taken_back');
  assert.ok(kept.length <= 2, `kept ${kept.length}`);
  assert.ok(out.some((o) => o.status === 'rejected'));
});

test('the Hunt Builder notes carry the scythe', async () => {
  const db = fakeDb();
  const groupNotes = [];
  db.productionGroupId = async () => 42;
  db.insertGroupNote = async (row) => { groupNotes.push(row); return row; };
  const A = { ...ctx(db, ADMIN, true), site: 'https://pyr.test' };
  await B.buildAction('build.add', { roots: [CELL] }, A);
  Object.assign(db._t.tasks[0], { status: 'completed', assigned_to: P3.id, final_segment_id: CELL });
  await B.buildAction('build.list', {}, A);
  await B.buildAction('build.helpers', { id: 1, names: 'nseraf' }, A);
  notes.length = 0;
  await B.buildAction('build.move', { id: 1, to: 'suggesting' }, A);
  assert.equal(groupNotes[0].image_url, 'https://pyr.test/hunt/scythe.png');
  assert.equal(groupNotes[0].thumbnail_url, 'https://pyr.test/hunt/scythe-128.png');
  assert.equal(notes[0].image, 'https://pyr.test/hunt/scythe.png');
});

test('the Hunt Maker Achievement wears the scythe unless an admin picked one', () => {
  const H = require('./hunts');
  const row = H.makerBadgeRow({ id: 9, title: 'Split Happens', created_by: null }, 'https://pyr.test');
  assert.equal(row.slug, 'hunt-9-maker');
  assert.equal(row.name, 'Split Happens: Hunt Maker');
  assert.equal(row.image_url, 'https://pyr.test/hunt/maker.png');
  assert.equal(row.thumbnail_url, 'https://pyr.test/hunt/maker-128.png');
});

test('the planted note shows Nurro planting', () => {
  assert.equal(B.noteArt({ site: 'https://pyr.test' }, 'planted'), 'https://pyr.test/hunt/planted.jpg');
  assert.equal(B.noteArt({ site: 'https://pyr.test' }, 'planted', true), 'https://pyr.test/hunt/planted-128.jpg');
  assert.equal(B.noteArt({ site: 'https://pyr.test' }, 'open', true), 'https://pyr.test/hunt/scythe-128.png');
});

test('a put back cell can be proofread again: its task is Available under its ID now', async () => {
  const db = fakeDb();
  const A = await openCell(db);
  await B.buildAction('build.move', { id: 1, to: 'planting' }, A);
  await B.buildAction('build.put_back', { id: 1, done: true, undone: [], cell_root: CELL2 }, A);
  assert.equal(db._t.candidates[0].status, 'put_back');
  const l = await B.buildAction('build.list', {}, A);
  assert.deepEqual(l.cells[0].moves, ['proofreading']);
  await B.buildAction('build.move', { id: 1, to: 'proofreading' }, A);
  const c = db._t.candidates[0], task = db._t.tasks[0];
  assert.equal(c.status, 'proofreading');
  assert.equal(c.proofread_by, null);
  assert.deepEqual(c.protected_roots, []);
  assert.equal(task.status, 'pending');
  assert.equal(task.assigned_to, null);
  assert.equal(task.segment_id, CELL2);
  assert.equal((await B.buildAction('build.guard', {}, ctx(db, P2))).cells.length, 0, 'not guarded any more');
});
