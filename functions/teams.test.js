'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {teamAction, memDb, TEAM_MAX} = require('./teams');

const U = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const users = [1, 2, 3, 4, 5, 6].map(n => ({id: U(n), username: 'player' + n, display_name: 'Player ' + n}));
function world() {
  const db = memDb(users);
  const credited = [];
  const as = n => (action, args = {}) => teamAction(action, args, {db, me: users[n - 1], credit: async (uid, row) => { credited.push({uid, row}); }});
  return {db, credited, as};
}
const rejects = (p, status) => assert.rejects(p, e => e.status === status);

test('a team is made, a player is invited, accepts, and both see it', async () => {
  const {as, db} = world();
  const t = await as(1)('team.create', {dataset: 'pni_mec', taskId: 12, segmentId: '720575940578359340', anchor: [1, 2, 3], title: 'Big cell'});
  assert.equal(t.mine, 'joined'); assert.equal(t.members.length, 1);
  await as(1)('team.invite', {teamId: t.id, userId: U(2)});
  let two = await as(2)('team.list');
  assert.equal(two.teams.length, 1); assert.equal(two.teams[0].mine, 'invited');
  assert.equal(db._state.notes.filter(n => n.to === U(2) && /invitation/i.test(n.title)).length, 1);
  await as(2)('team.respond', {teamId: t.id, accept: true});
  two = await as(2)('team.list');
  assert.equal(two.teams[0].mine, 'joined');
  assert.deepEqual(two.teams[0].members.map(m => m.name).sort(), ['player1', 'player2']);
});

test('an invitation is private, and a decline is quiet', async () => {
  const {as, db} = world();
  const t = await as(1)('team.create', {dataset: 'd', segmentId: '5'});
  await as(1)('team.invite', {teamId: t.id, userId: U(2)});
  await as(1)('team.invite', {teamId: t.id, userId: U(3)});
  // Player 2, not yet on the team, sees who is on it and themselves, not that player 3 was asked.
  const two = (await as(2)('team.list')).teams[0];
  assert.deepEqual(two.members.map(m => m.name).sort(), ['player1', 'player2']);
  // Someone who was never asked sees nothing at all, and cannot read it.
  assert.equal((await as(4)('team.list')).teams.length, 0);
  await rejects(as(4)('team.marks', {teamId: t.id}), 403);
  await rejects(as(4)('team.messages', {teamId: t.id}), 403);
  const before = db._state.notes.length;
  await as(2)('team.respond', {teamId: t.id, accept: false});
  assert.equal(db._state.notes.length, before, 'nobody is told about a decline');
  assert.equal((await as(2)('team.list')).teams.length, 0);
  assert.deepEqual((await as(1)('team.list')).teams[0].members.map(m => m.name).sort(), ['player1', 'player3']);
});

test('a team is at most four, counting people already asked', async () => {
  const {as} = world();
  const t = await as(1)('team.create', {dataset: 'd', segmentId: '5'});
  for (const n of [2, 3, 4]) await as(1)('team.invite', {teamId: t.id, userId: U(n)});
  assert.equal(TEAM_MAX, 4);
  await rejects(as(1)('team.invite', {teamId: t.id, userId: U(5)}), 409);
  // A decline frees the place.
  await as(4)('team.respond', {teamId: t.id, accept: false});
  await as(1)('team.invite', {teamId: t.id, userId: U(5)});
});

test('only members can invite, and an invited player cannot act as a member yet', async () => {
  const {as} = world();
  const t = await as(1)('team.create', {dataset: 'd', segmentId: '5'});
  await rejects(as(2)('team.invite', {teamId: t.id, userId: U(3)}), 403);
  await as(1)('team.invite', {teamId: t.id, userId: U(2)});
  await rejects(as(2)('team.invite', {teamId: t.id, userId: U(3)}), 403);
  await rejects(as(2)('team.say', {teamId: t.id, text: 'hi'}), 403);
  await rejects(as(2)('team.complete', {teamId: t.id, root: '9'}), 403);
});

test('an open team can be asked to join, and a member lets them in', async () => {
  const {as, db} = world();
  const t = await as(1)('team.create', {dataset: 'd', segmentId: '5', title: 'Starburst'});
  assert.equal((await as(3)('team.list')).open.length, 0);
  await rejects(as(3)('team.request', {teamId: t.id}), 403);
  await as(1)('team.setOpen', {teamId: t.id, open: true});
  assert.equal((await as(3)('team.list')).open.length, 1);
  await as(3)('team.request', {teamId: t.id});
  assert.equal(db._state.notes.filter(n => n.to === U(1)).length, 1);
  const one = (await as(1)('team.list')).teams[0];
  assert.equal(one.members.find(m => m.name === 'player3').state, 'requested');
  await as(1)('team.approve', {teamId: t.id, userId: U(3), accept: true});
  assert.equal((await as(3)('team.list')).teams[0].mine, 'joined');
  // On it now, so it is no longer offered as one to join.
  assert.equal((await as(3)('team.list')).open.length, 0);
});

test('marks are saved a change at a time and both members read the same', async () => {
  const {as} = world();
  const t = await as(1)('team.create', {dataset: 'd', segmentId: '5'});
  await as(1)('team.invite', {teamId: t.id, userId: U(2)}); await as(2)('team.respond', {teamId: t.id, accept: true});
  await as(1)('team.saveMarks', {teamId: t.id, layer: 'Checked', spec: {type: 'annotation', annotationColor: '#3dff9a'}, up: [{id: 'a', type: 'point', point: [1, 2, 3]}, {id: 'b', type: 'point', point: [4, 5, 6]}], del: []});
  await as(2)('team.saveMarks', {teamId: t.id, layer: 'Checked', up: [{id: 'c', type: 'point', point: [7, 8, 9]}], del: ['a']});
  await as(2)('team.saveMarks', {teamId: t.id, layer: 'Problem', spec: {type: 'annotation'}, up: [{id: 'p', type: 'point', point: [0, 0, 0]}], del: []});
  const doc = await as(1)('team.marks', {teamId: t.id});
  assert.deepEqual(Object.keys(doc.layers).sort(), ['Checked', 'Problem']);
  assert.deepEqual(Object.keys(doc.layers.Checked.anns).sort(), ['b', 'c']);
  assert.equal(doc.layers.Checked.spec.annotationColor, '#3dff9a', 'a later save without a spec keeps the first');
});

test('team chat is saved and read in order by members', async () => {
  const {as} = world();
  const t = await as(1)('team.create', {dataset: 'd', segmentId: '5'});
  await as(1)('team.invite', {teamId: t.id, userId: U(2)}); await as(2)('team.respond', {teamId: t.id, accept: true});
  await as(1)('team.say', {teamId: t.id, text: '  I took the axon  '});
  await as(2)('team.say', {teamId: t.id, text: 'dendrites done'});
  await rejects(as(1)('team.say', {teamId: t.id, text: '   '}), 400);
  const m = await as(2)('team.messages', {teamId: t.id});
  assert.deepEqual(m.map(x => x.name + ': ' + x.text), ['player1: I took the axon', 'player2: dendrites done']);
});

test('any member completes: the others are credited once, told, and get a celebration', async () => {
  const {as, db, credited} = world();
  const t = await as(1)('team.create', {dataset: 'pni_mec', segmentId: '5', title: 'Big cell'});
  for (const n of [2, 3]) { await as(1)('team.invite', {teamId: t.id, userId: U(n)}); await as(n)('team.respond', {teamId: t.id, accept: true}); }
  await as(1)('team.invite', {teamId: t.id, userId: U(4)});          // never answers
  await as(2)('team.partDone', {teamId: t.id, done: true});
  const r = await as(2)('team.complete', {teamId: t.id, root: '720575940578359340'});
  assert.deepEqual(r.members.sort(), ['player1', 'player2', 'player3']);
  assert.deepEqual(credited.map(c => c.uid).sort(), [U(1), U(3)], 'everyone but the one who completed it');
  assert.equal(credited[0].row.operation, 'mark_complete');
  assert.equal(credited[0].row.metadata.root_id, '720575940578359340');
  assert.equal(credited[0].row.dataset, 'pni_mec');
  assert.equal(db._state.notes.filter(n => /Team cell complete/.test(n.title)).length, 2);
  // A second completion (a teammate pressing it too) credits nobody again.
  const again = await as(3)('team.complete', {teamId: t.id, root: '720575940578359340'});
  assert.equal(again.already, true);
  assert.equal(credited.length, 2);
  // Each member sees the finished team until they have seen the celebration.
  for (const n of [1, 2, 3]) {
    const mine = (await as(n)('team.list')).teams;
    assert.equal(mine.length, 1); assert.equal(mine[0].status, 'completed'); assert.equal(mine[0].celebrate, true);
    await as(n)('team.seen', {teamId: t.id});
    assert.equal((await as(n)('team.list')).teams.length, 0);
  }
  // The player who never answered has no invitation left.
  assert.equal((await as(4)('team.list')).teams.length, 0);
  // Nothing more can be saved to a finished team.
  await rejects(as(1)('team.saveMarks', {teamId: t.id, layer: 'x', up: [], del: []}), 409);
});

test('one team per claimed cell; leaving hands the team on, and the last to leave closes it', async () => {
  const {as, db} = world();
  const t = await as(1)('team.create', {dataset: 'd', taskId: 7, segmentId: '5'});
  assert.equal((await as(1)('team.create', {dataset: 'd', taskId: 7, segmentId: '5'})).id, t.id, 'the owner gets the same team back');
  await rejects(as(2)('team.create', {dataset: 'd', taskId: 7, segmentId: '5'}), 409);
  await as(1)('team.invite', {teamId: t.id, userId: U(2)}); await as(2)('team.respond', {teamId: t.id, accept: true});
  await as(1)('team.leave', {teamId: t.id});
  assert.equal((await as(2)('team.list')).teams[0].ownerId, U(2));
  await as(2)('team.leave', {teamId: t.id});
  assert.equal(db._state.teams[0].status, 'closed');
  // The cell is free for a new team.
  await as(3)('team.create', {dataset: 'd', taskId: 7, segmentId: '5'});
});

test('bad input is refused', async () => {
  const {as} = world();
  await rejects(as(1)('team.create', {dataset: 'd'}), 400);
  await rejects(as(1)('team.invite', {teamId: 'nope', userId: U(2)}), 400);
  const t = await as(1)('team.create', {dataset: 'd', segmentId: '5'});
  await rejects(as(1)('team.invite', {teamId: t.id, userId: U(1)}), 400);
  await rejects(as(1)('team.invite', {teamId: t.id, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-999999999999'}), 404);
  await rejects(as(1)('team.complete', {teamId: t.id, root: 'abc'}), 400);
  await rejects(as(1)('team.nothing', {}), 400);
});
