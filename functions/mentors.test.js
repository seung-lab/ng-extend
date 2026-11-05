'use strict';
// The mentor program's rules (functions/mentors.js), over the in-memory db.
// node --test functions/mentors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {mentorAction, memDb, CELLS_NEEDED, MAX_APPRENTICES, OVERDUE_MS} = require('./mentors');

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = [
  {id: U(1), username: 'ames'}, {id: U(2), username: 'Nseraf'}, {id: U(3), username: 'annkri'},
  {id: U(4), username: 'newbie'}, {id: U(5), username: 'second'}, {id: U(6), username: 'third'},
];
const who = n => users.find(u => u.id === U(n));

function setup() {
  const db = memDb(users);
  const credited = [];
  let clock = Date.parse('2026-11-04T12:00:00Z');
  const call = (n, action, args = {}, {admin = false} = {}) => mentorAction(action, args, {db, me: who(n), isAdmin: admin,
    credit: async (userId, row) => { credited.push({userId, ...row}); }, now: new Date(clock)});
  const admin = (action, args) => call(1, action, args, {admin: true});
  const tick = ms => { clock += ms; };
  return {db, credited, call, admin, tick};
}
const send = (call, n, taskId, extra = {}) => call(n, 'mentor.send', {taskId, dataset: 'pinky100', logDataset: 'pinky100_sandbox', rootId: String(900 + taskId), segmentId: String(800 + taskId), position: [1, 2, 3], link: 'https://x.test/s', done: {coords: '1, 2, 3'}, ...extra});

test('only enrolled players are apprentices, only admins enroll, mentors and apprentices stay apart', async () => {
  const {call, admin} = setup();
  await assert.rejects(send(call, 4, 1), /not in the mentor program/);
  await assert.rejects(call(2, 'mentor.addApprentice', {username: 'newbie'}), /Admins only/);
  await admin('mentor.addMentor', {username: 'nseraf'});
  await assert.rejects(admin('mentor.addApprentice', {username: 'Nseraf'}), /is a mentor/);
  await admin('mentor.addApprentice', {username: 'newbie'});
  await assert.rejects(admin('mentor.addMentor', {username: 'newbie'}), /apprentice right now/);
  const st = await call(4, 'mentor.status');
  assert.equal(st.apprentice.status, 'active');
  assert.equal(st.apprentice.cellsNeeded, CELLS_NEEDED);
  assert.equal(st.mentor, false);
});

test('a first cell bells each mentor with room once, then the first mentor to take it stays', async () => {
  const {db, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addMentor', {username: 'annkri'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  db._state.notes.length = 0;
  const {review} = await send(call, 4, 1);
  assert.equal(review.state, 'waiting');
  assert.deepEqual(db._state.notes.map(n => n.to).sort(), [U(2), U(3)]);
  assert.deepEqual(db._state.held, [{taskId: 1, userId: U(4)}], 'the claim is held while it waits');
  // A second cell before anyone took the first: no more bells to everyone.
  db._state.notes.length = 0;
  await send(call, 4, 2);
  assert.equal(db._state.notes.length, 0);
  // Nseraf takes the first; the apprentice is now theirs, and the second cell too can only be theirs.
  await call(2, 'mentor.claim', {reviewId: review.id});
  assert.equal((await call(4, 'mentor.status')).apprentice.mentorName, 'Nseraf');
  const q = await call(3, 'mentor.queue');
  const second = q.waiting.find(r => r.taskId === 2);
  assert.ok(second, 'the unclaimed second cell is still in the queue');
  await call(2, 'mentor.claim', {reviewId: second.id});
  await assert.rejects(call(3, 'mentor.claim', {reviewId: second.id}), /Nseraf is looking/);
  // A third cell goes straight to Nseraf with one bell.
  db._state.notes.length = 0;
  const third = (await send(call, 4, 3)).review;
  assert.equal(third.mentorId, U(2));
  assert.deepEqual(db._state.notes.map(n => n.to), [U(2)]);
});

test('a mentor takes at most MAX_APPRENTICES apprentices', async () => {
  const extra = Array.from({length: MAX_APPRENTICES + 1}, (_, i) => ({id: U(100 + i), username: `p${i}`}));
  const db = memDb([...users, ...extra]);
  const call = (n, action, args = {}, admin = false) => mentorAction(action, args, {db, me: typeof n === 'number' ? who(n) : n, isAdmin: admin, credit: async () => {}});
  await call(1, 'mentor.addMentor', {username: 'Nseraf'}, true);
  const reviews = [];
  for (const [i, u] of extra.entries()) {
    await call(1, 'mentor.addApprentice', {username: u.username}, true);
    reviews.push((await call(u, 'mentor.send', {taskId: 10 + i, dataset: 'pinky100', rootId: String(900 + i)})).review);
  }
  for (const r of reviews.slice(0, MAX_APPRENTICES)) await call(2, 'mentor.claim', {reviewId: r.id});
  await assert.rejects(call(2, 'mentor.claim', {reviewId: reviews[MAX_APPRENTICES].id}), new RegExp(`mentoring ${MAX_APPRENTICES}`));
  await call(2, 'mentor.handBack', {apprenticeId: extra[0].id});
  await call(2, 'mentor.claim', {reviewId: reviews[MAX_APPRENTICES].id});
  const q = await call(2, 'mentor.queue');
  assert.equal(q.slots.used, MAX_APPRENTICES);
  assert.equal(q.slots.max, 5);
  assert.ok(q.waiting.some(r => r.id === reviews[0].id), 'the handed back cell is in the queue again');
});

test('suggestions: nothing counts, the apprentice keeps the cell, sends it back to the same mentor', async () => {
  const {db, credited, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  const r = (await send(call, 4, 1)).review;
  await call(2, 'mentor.claim', {reviewId: r.id});
  await assert.rejects(call(2, 'mentor.suggest', {reviewId: r.id, notes: []}), /at least one suggestion/);
  await call(2, 'mentor.saveNotes', {reviewId: r.id, notes: [{id: 'a', position: [10, 20, 30], text: 'Cut here'}, {position: [1, 1], text: 'bad point'}]});
  assert.equal((await db.getReview(r.id)).notes.length, 1, 'a note without a full point is dropped');
  db._state.notes.length = 0;
  const s = await call(2, 'mentor.suggest', {reviewId: r.id, cellNote: 'You missed an extension near the soma.'});
  assert.equal(s.state, 'suggestions');
  assert.equal(s.notes[0].text, 'Cut here', 'notes saved earlier are kept');
  assert.equal(credited.length, 0);
  assert.deepEqual(db._state.notes.map(n => [n.to, n.title]), [[U(4), '🧭 Your mentor has suggestions']]);
  // The apprentice reads the notes, and the mentor cannot complete it while it is theirs.
  const mine = (await call(4, 'mentor.status')).mine;
  assert.equal(mine[0].cellNote, 'You missed an extension near the soma.');
  await assert.rejects(call(2, 'mentor.complete', {reviewId: r.id}), /not waiting for you/);
  db._state.notes.length = 0;
  const again = (await send(call, 4, 1, {rootId: '777'})).review;
  assert.equal(again.id, r.id);
  assert.equal(again.state, 'looking');
  assert.equal(again.rounds, 2);
  assert.equal(again.rootId, '777');
  assert.deepEqual(db._state.notes.map(n => n.to), [U(2)]);
  await assert.rejects(send(call, 4, 1), /already with a mentor/);
});

test('complete credits the apprentice once, at that moment, and finishes their claim', async () => {
  const {db, credited, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  db._state.tasks.set(1, {assigned_to: U(4), status: 'assigned'});
  const r = (await send(call, 4, 1)).review;
  await assert.rejects(call(2, 'mentor.complete', {reviewId: r.id}), /Take a look/);
  await call(2, 'mentor.claim', {reviewId: r.id});
  const out = await call(2, 'mentor.complete', {reviewId: r.id, root: '12345'});
  assert.equal(out.review.state, 'complete');
  assert.equal(db._state.tasks.get(1).status, 'completed');
  assert.equal(db._state.tasks.get(1).assigned_to, U(4));
  assert.equal(credited.length, 1);
  assert.equal(credited[0].userId, U(4), 'the APPRENTICE is credited, not the mentor');
  assert.equal(credited[0].operation, 'complete_task');
  assert.equal(credited[0].task_id, 1);
  assert.equal(credited[0].dataset, 'pinky100_sandbox', 'logged under the dataset the game logs the player\'s own completions in');
  assert.equal(credited[0].metadata.final_segment_id, '12345');
  assert.equal(credited[0].metadata.mentor_id, U(2));
  await assert.rejects(call(2, 'mentor.complete', {reviewId: r.id}), /not waiting/);
  assert.equal(credited.length, 1, 'a second press credits nothing');
  assert.equal((await call(4, 'mentor.status')).apprentice.cellsDone, 1);
});

test('a claim that cannot be completed counts nothing and stays with the mentor', async () => {
  const {db, credited, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  db._state.tasks.set(1, {assigned_to: U(5), status: 'assigned'});
  const r = (await send(call, 4, 1)).review;
  await call(2, 'mentor.claim', {reviewId: r.id});
  await assert.rejects(call(2, 'mentor.complete', {reviewId: r.id}), /current owner/);
  assert.equal(credited.length, 0);
  assert.equal((await db.getReview(r.id)).state, 'looking');
});

test('an admin who mentors someone to the end gets the Mentor Achievement too', async () => {
  const {db, call, admin} = setup();
  await admin('mentor.addApprentice', {username: 'newbie'});
  for (let i = 1; i <= CELLS_NEEDED; i++) {
    const r = (await send(call, 4, i)).review;
    await admin('mentor.claim', {reviewId: r.id});
    await admin('mentor.complete', {reviewId: r.id});
  }
  assert.deepEqual(db._state.awards.map(a => [a.name, a.userId]), [['Apprentice', U(4)], ['Mentor', U(1)]]);
});

test('five cells end the apprenticeship with both Achievements; no sixth can be sent', async () => {
  const {db, credited, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  const ids = [];
  for (let i = 1; i <= CELLS_NEEDED; i++) ids.push((await send(call, 4, i)).review.id);
  await assert.rejects(send(call, 4, 99), /mentor cells are sent/);
  let finished = false;
  for (const id of ids) { await call(2, 'mentor.claim', {reviewId: id}); finished = (await call(2, 'mentor.complete', {reviewId: id})).finished; }
  assert.equal(finished, true);
  assert.equal(credited.length, CELLS_NEEDED);
  const st = await call(4, 'mentor.status');
  assert.equal(st.apprentice.status, 'finished');
  assert.equal(st.mine.length, CELLS_NEEDED, 'the notes stay readable afterwards');
  assert.deepEqual(db._state.awards.map(a => [a.name, a.userId]), [['Apprentice', U(4)], ['Mentor', U(2)]]);
  await assert.rejects(send(call, 4, 100), /not in the mentor program/);
  assert.equal((await call(2, 'mentor.queue')).slots.used, 0, 'the mentor has room again');
});

test('48 hours: an untouched cell goes back to the queue and shows to admins as overdue', async () => {
  const {call, admin, tick} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addMentor', {username: 'annkri'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  const r = (await send(call, 4, 1)).review;
  await call(2, 'mentor.claim', {reviewId: r.id});
  tick(OVERDUE_MS - 1000);
  assert.equal((await admin('mentor.admin')).overdue.length, 0);
  tick(2000);
  const q = await call(3, 'mentor.queue');
  assert.ok(q.waiting.some(x => x.id === r.id), 'back in the queue');
  assert.equal((await call(4, 'mentor.status')).apprentice.mentorId, null, 'and the apprentice is free for another mentor');
  assert.equal((await admin('mentor.admin')).overdue.length, 1);
  await call(3, 'mentor.claim', {reviewId: r.id});
  assert.equal((await call(4, 'mentor.status')).apprentice.mentorName, 'annkri');
});

test('who may see what', async () => {
  const {call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  await admin('mentor.addApprentice', {username: 'second'});
  const r = (await send(call, 4, 1)).review;
  await assert.rejects(call(5, 'mentor.queue'), /Mentors only/);
  await assert.rejects(call(5, 'mentor.review', {reviewId: r.id}), /Not your cell/);
  await assert.rejects(call(5, 'mentor.sheetDone', {reviewId: r.id}), /Not your cell/);
  assert.equal((await call(4, 'mentor.review', {reviewId: r.id})).id, r.id);
  // Admins mentor too: an admin who takes a cell becomes that apprentice's mentor.
  assert.equal((await admin('mentor.status')).mentor, true);
  await admin('mentor.claim', {reviewId: r.id});
  assert.equal((await call(4, 'mentor.status')).apprentice.mentorName, 'ames');
  // ...and a mentor cannot take a cell an admin is looking at.
  await assert.rejects(call(2, 'mentor.claim', {reviewId: r.id}), /ames is looking/);
  await assert.rejects(call(2, 'mentor.addMentor', {username: 'second'}), /Admins only/);
});

test('copy has no dashes and says Achievement, never badge', () => {
  const src = require('fs').readFileSync(require.resolve('./mentors'), 'utf8');
  const strings = src.match(/(['`])(?:(?!\1)[^\\\n]|\\.)*\1/g).filter(s => / /.test(s) && /^['`][A-Z🧭🎉🏆]/u.test(s));
  for (const s of strings) {
    assert.ok(!/ [-–—] |—|–/.test(s), `dash in: ${s}`);
    assert.ok(!/badge/i.test(s), `badge in: ${s}`);
  }
});
