'use strict';
// The mentor program's rules (functions/mentors.js), over the in-memory db.
// node --test functions/mentors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {mentorAction, memDb, memTexts, TEXTS, CELLS_NEEDED, MAX_APPRENTICES, OVERDUE_MS} = require('./mentors');

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
  // The second cell, sent before Nseraf took the first, went with them.
  assert.equal((await call(3, 'mentor.queue')).waiting.length, 0, 'annkri does not see it');
  const second = (await call(2, 'mentor.queue')).yours.find(r => r.taskId === 2);
  assert.ok(second, 'the second cell is Nseraf\'s');
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

test('an admin can be their own apprentice to test alone: no one else is rung, no Mentor Achievement to themself', async () => {
  const {db, credited, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'ames'});
  assert.equal((await admin('mentor.status')).apprentice.status, 'active');
  db._state.notes.length = 0;
  const {review} = await call(1, 'mentor.send', {taskId: 1, dataset: 'pinky100', rootId: '901'}, {admin: true});
  assert.deepEqual(db._state.notes, [], 'a real mentor is not rung by an admin test');
  // A player apprentice still cannot take their own cell.
  await admin('mentor.addApprentice', {username: 'newbie'});
  const own = (await send(call, 4, 2)).review;
  await assert.rejects(call(4, 'mentor.claim', {reviewId: own.id}), /Mentors only|not you/);
  // The admin takes their own and goes through all five.
  await admin('mentor.claim', {reviewId: review.id});
  await admin('mentor.complete', {reviewId: review.id});
  for (let i = 3; i <= CELLS_NEEDED + 1; i++) {
    const r = (await call(1, 'mentor.send', {taskId: 10 + i, dataset: 'pinky100', rootId: String(900 + i)}, {admin: true})).review;
    assert.equal(r.state, 'looking', 'straight back to themself as mentor');
    await admin('mentor.complete', {reviewId: r.id});
  }
  assert.equal(credited.filter(c => c.userId === U(1)).length, CELLS_NEEDED);
  assert.deepEqual(db._state.awards.map(a => [a.name, a.userId]), [['Apprentice', U(1)]]);
});

test('admins change a bell text; the next bell uses it; names in braces are filled in', async () => {
  const db = memDb(users), texts = memTexts();
  const call = (n, action, args = {}, admin = false) => mentorAction(action, args, {db, me: who(n), isAdmin: admin, texts, credit: async () => {}});
  await assert.rejects(call(2, 'mentor.texts'), /Admins only/);
  await assert.rejects(call(2, 'mentor.setText', {key: 'welcome', title: 'x', body: 'y'}), /Admins only/);
  const list = await call(1, 'mentor.texts', {}, true);
  assert.equal(list.length, Object.keys(TEXTS).length);
  assert.deepEqual(list.find(t => t.key === 'welcome').vars, ['needed']);
  await assert.rejects(call(1, 'mentor.setText', {key: 'welcome', title: 'Hi {mentor}', body: 'b'}, true), /cannot use \{mentor\}. It can use \{needed\}/);
  await assert.rejects(call(1, 'mentor.setText', {key: 'nope', title: 'a', body: 'b'}, true), /Unknown message/);
  await call(1, 'mentor.setText', {key: 'welcome', title: '🧭 Hello, new proofreader', body: 'Your first {needed} cells come with a guide.'}, true);
  await call(1, 'mentor.addApprentice', {username: 'newbie'}, true);
  const last = db._state.notes.at(-1);
  assert.deepEqual([last.to, last.title, last.body], [U(4), '🧭 Hello, new proofreader', 'Your first 5 cells come with a guide.']);
  assert.equal((await call(1, 'mentor.texts', {}, true)).find(t => t.key === 'welcome').edited, true);
  // Back to the original: the change is forgotten.
  const d = TEXTS.welcome;
  assert.equal((await call(1, 'mentor.setText', {key: 'welcome', title: d.title, body: d.body}, true)).edited, false);
  assert.deepEqual(texts._m, {});
});

test('every default text uses only its own names, and has no dashes or "badge"', () => {
  for (const [k, d] of Object.entries(TEXTS)) {
    const used = [...`${d.title} ${d.body}`.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
    for (const u of used) assert.ok(d.vars.includes(u), `${k} uses {${u}}`);
    assert.ok(!/ [-–—] |—|–/.test(d.title + d.body), `dash in ${k}`);
    assert.ok(!/badge/i.test(d.title + d.body), `badge in ${k}`);
  }
});

test('graduating celebrates: both Achievement bells match the award pattern of the game, with the picture; a second graduate gives the mentor a plain bell', async () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/util/award_title.ts'), 'utf8');
  const AWARD = new RegExp(src.match(/const AWARD_TITLE = \/(.+)\/u;/)[1], 'u');
  const {db, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  const finish = async n => {
    await admin('mentor.addApprentice', {username: who(n).username});
    for (let i = 1; i <= CELLS_NEEDED; i++) {
      const r = (await send(call, n, n * 100 + i)).review;
      await call(2, 'mentor.claim', {reviewId: r.id});
      await call(2, 'mentor.complete', {reviewId: r.id});
    }
  };
  await finish(4);
  const first = db._state.notes.filter(x => AWARD.test(x.title));
  assert.deepEqual(first.map(x => [x.to, x.title]), [[U(4), 'New Achievement: Apprentice'], [U(2), 'New Achievement: Mentor']]);
  for (const b of first) {
    assert.match(b.body, /^You earned the "(Apprentice|Mentor)" Achievement! /, 'the game reads the name from the quotes');
    assert.ok(b.image, 'with the Achievement picture');
  }
  await finish(5);
  const mentorBells = db._state.notes.filter(x => x.to === U(2) && /finished the mentor program/.test(x.body));
  assert.equal(mentorBells.length, 2);
  assert.ok(!AWARD.test(mentorBells[1].title), 'no second unlock card for the same Achievement');
  assert.equal(mentorBells[1].title, '🧭 second finished the mentor program');
  assert.equal(db._state.awards.filter(a => a.name === 'Mentor').length, 1);
});

test('an Achievement an admin changed in Special Badges is never written over, and its bell carries their picture', async () => {
  const {restDb, APPRENTICE_BADGE} = require('./mentors');
  const calls = [];
  const sb = async (path, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${path.split('?')[0]}`);
    if (path.startsWith('special_badges?slug=eq.')) return [{id: 7, image_url: 'https://art.test/ames.png'}];
    if (path.startsWith('special_badge_awards')) return [{badge_id: 7}];
    return [];
  };
  const out = await restDb(sb).award(APPRENTICE_BADGE, U(4), 'test');
  assert.deepEqual(out, {first: true, image: 'https://art.test/ames.png'});
  assert.ok(!calls.includes('POST special_badges'), `the Achievement was written: ${calls.join(', ')}`);
  // Missing: made once, then read back.
  const calls2 = []; let made = false;
  const sb2 = async (path, opts = {}) => {
    calls2.push(`${opts.method || 'GET'} ${path.split('?')[0]}`);
    if (path.startsWith('special_badges?slug=eq.')) return made ? [{id: 8, image_url: APPRENTICE_BADGE.image_url}] : [];
    if (path.startsWith('special_badges?on_conflict')) { made = true; return []; }
    return [];
  };
  const out2 = await restDb(sb2).award(APPRENTICE_BADGE, U(4), 'test');
  assert.deepEqual(out2, {first: false, image: APPRENTICE_BADGE.image_url});
  assert.equal(calls2.filter(c => c === 'POST special_badges').length, 1);
});

test('the graduation bell carries the picture the Achievement has now', async () => {
  const {db, call, admin} = setup();
  db._state.badgeArt = {'mentor-program-apprentice': 'https://art.test/apprentice.png'};
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  for (let i = 1; i <= CELLS_NEEDED; i++) {
    const r = (await send(call, 4, i)).review;
    await call(2, 'mentor.claim', {reviewId: r.id});
    await call(2, 'mentor.complete', {reviewId: r.id});
  }
  assert.equal(db._state.notes.find(n => n.title === 'New Achievement: Apprentice').image, 'https://art.test/apprentice.png');
});

test('one mentor per apprentice: cells sent before pairing go with them, and another mentor can neither see nor take them', async () => {
  const {db, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addMentor', {username: 'annkri'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  // Three cells sent before anyone took one: all waiting, no mentor.
  const [c1, c2, c3] = [(await send(call, 4, 1)).review, (await send(call, 4, 2)).review, (await send(call, 4, 3)).review];
  await call(2, 'mentor.claim', {reviewId: c1.id});
  assert.equal((await db.getReview(c2.id)).mentor_id, U(2), 'the other waiting cells move to the new mentor');
  assert.equal((await db.getReview(c3.id)).mentor_id, U(2));
  const q = await call(3, 'mentor.queue');
  assert.equal(q.waiting.length, 0, 'annkri does not see them');
  await assert.rejects(call(3, 'mentor.claim', {reviewId: c2.id}), /Nseraf is looking/);
  // Even a cell that somehow has no mentor of its own stays with the apprentice's mentor.
  await db.patchReview(c3.id, {mentor_id: null, mentor_name: null});
  assert.equal((await call(3, 'mentor.queue')).waiting.length, 0);
  await assert.rejects(call(3, 'mentor.claim', {reviewId: c3.id}), /Nseraf is this player's mentor/);
  assert.equal((await call(2, 'mentor.queue')).waiting.length, 1, 'their own mentor still sees it');
  assert.equal(db._state.notes.filter(n => n.title === '🧭 You have a mentor').length, 1, 'one You have a mentor bell');
  // After Hand back, another mentor may take them.
  await call(2, 'mentor.handBack', {apprenticeId: U(4)});
  await call(3, 'mentor.claim', {reviewId: c2.id});
  assert.equal((await call(4, 'mentor.status')).apprentice.mentorName, 'annkri');
});

test('the welcome and You have a mentor bells carry the program picture and say how many cells', async () => {
  const {db, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await admin('mentor.addApprentice', {username: 'newbie'});
  const r = (await send(call, 4, 1)).review;
  await call(2, 'mentor.claim', {reviewId: r.id});
  const welcome = db._state.notes.find(n => n.title === '🧭 Welcome to the mentor program');
  const have = db._state.notes.find(n => n.title === '🧭 You have a mentor');
  assert.match(welcome.image, /mentor-bell\.jpg$/);
  assert.match(have.image, /mentor-bell\.jpg$/);
  assert.equal(have.body, 'Nseraf is your mentor. They will look at your first 5 cells and give you feedback before each one counts.');
});

test('copy has no dashes and says Achievement, never badge', () => {
  const src = require('fs').readFileSync(require.resolve('./mentors'), 'utf8');
  const strings = src.match(/(['`])(?:(?!\1)[^\\\n]|\\.)*\1/g).filter(s => / /.test(s) && /^['`][A-Z🧭🎉🏆]/u.test(s));
  for (const s of strings) {
    assert.ok(!/ [-–—] |—|–/.test(s), `dash in: ${s}`);
    assert.ok(!/badge/i.test(s), `badge in: ${s}`);
  }
});

test('practice: a player joins by themself, the loop rings as usual, and a Complete records nothing', async () => {
  const {db, credited, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await assert.rejects(call(2, 'mentor.join'), /You are a mentor/);
  const joined = await call(4, 'mentor.join');
  assert.equal(joined.apprentice.practice, true);
  await assert.rejects(call(4, 'mentor.join'), /already/);
  db._state.notes.length = 0;
  const {review} = await send(call, 4, 7, {done: {status: 'Complete', coords: '1, 2, 3'}});
  assert.equal(review.done.practice, true);
  assert.deepEqual(db._state.notes.map(n => n.to), [U(2)], 'the first cell rings the mentor');
  await call(2, 'mentor.claim', {reviewId: review.id});
  await call(2, 'mentor.suggest', {reviewId: review.id, notes: [{position: [1, 2, 3], text: 'check this branch'}], cellNote: 'nearly'});
  await send(call, 4, 7);
  db._state.notes.length = 0;
  const out = await call(2, 'mentor.complete', {reviewId: review.id});
  assert.equal(out.practice, true);
  assert.equal(credited.length, 0, 'nothing counts');
  assert.equal(db._state.tasks.size, 0, 'the claim is not completed');
  assert.deepEqual(db._state.released, [{taskId: 7, userId: U(4)}], 'the claim is let go');
  assert.match(db._state.notes[0].title, /practice/);
  assert.equal((await call(4, 'mentor.status')).apprentice.cellsDone, 1);
  await call(4, 'mentor.leave');
  assert.equal((await call(4, 'mentor.status')).apprentice.status, 'left');
  // An admin-added apprentice is not practice and cannot leave alone.
  await admin('mentor.addApprentice', {username: 'second'});
  assert.equal((await call(5, 'mentor.status')).apprentice.practice, false);
  await assert.rejects(call(5, 'mentor.leave'), /Ask an admin/);
});

test('practice: five practice cells finish the loop with no Achievement', async () => {
  const {db, call, admin} = setup();
  await admin('mentor.addMentor', {username: 'Nseraf'});
  await call(4, 'mentor.join');
  for (let i = 1; i <= CELLS_NEEDED; i++) {
    const {review} = await send(call, 4, i);
    if (i === 1) await call(2, 'mentor.claim', {reviewId: review.id});
    const out = await call(2, 'mentor.complete', {reviewId: review.id});
    assert.equal(out.finished, i === CELLS_NEEDED);
  }
  assert.equal(db._state.awards.length, 0);
  assert.equal((await call(4, 'mentor.status')).apprentice.status, 'finished');
});
