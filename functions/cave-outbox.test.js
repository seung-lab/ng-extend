'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {outboxAction, cleanItem, caveServerOk, MAX_WAITING} = require('./cave-outbox');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const B = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
// The table in memory, with the same filters restDb applies.
function memDb() {
  const rows = []; let next = 1;
  const match = (r, where) => Object.entries(where).every(([k, v]) => r[k] === v);
  return {
    rows,
    waiting: async (userId, where = {}) => rows.filter(r => r.user_id === userId && r.status === 'waiting' && match(r, where)),
    countWaiting: async userId => rows.filter(r => r.user_id === userId && r.status === 'waiting').length,
    allWaiting: async () => rows.filter(r => r.status === 'waiting'),
    get: async (id, userId) => rows.find(r => r.id === id && r.user_id === userId) || null,
    insert: async row => { const r = {id: next++, status: 'waiting', attempts: 0, created_at: new Date(Date.now() + next).toISOString(), ...row}; rows.push(r); return r; },
    patch: async (id, userId, fields, waitingOnly) => {
      const r = rows.find(x => x.id === id && x.user_id === userId && (!waitingOnly || x.status === 'waiting'));
      if (r) Object.assign(r, fields);
      return r || null;
    },
  };
}
const as = (db, id, isAdmin = false) => (action, args = {}) => outboxAction(action, args, {db, me: {id}, isAdmin});
const item = (over = {}) => ({kind: 'complete', dataset: 'stroeh_mouse_retina', caveServer: 'https://minnie.microns-daf.com', alignedVolume: 'stroeh_mouse_retina',
  datastack: 'stroeh_mouse_retina', table: 'eyewire_ii_cell_status_v2', rootId: '720575940578359340', pt: [100, 200, 300],
  annotation: {pt: {position: [100, 200, 300]}, tag: 'complete'}, ...over});
const rejects = (p, status) => assert.rejects(p, e => e.status === status);

test('a save waits, is listed for its player only, and is marked sent', async () => {
  const db = memDb();
  const added = await as(db, A)('outbox.add', {item: item()});
  assert.equal(added.kind, 'complete'); assert.equal(added.caveServer, 'https://minnie.microns-daf.com');
  assert.equal((await as(db, A)('outbox.mine')).length, 1);
  assert.equal((await as(db, B)('outbox.mine')).length, 0);
  assert.deepEqual(await as(db, B)('outbox.sent', {id: added.id}), {sent: false}, 'another player cannot touch it');
  assert.deepEqual(await as(db, A)('outbox.sent', {id: added.id, annotationId: 77}), {sent: true});
  assert.equal(db.rows[0].annotation_id, 77);
  assert.equal((await as(db, A)('outbox.mine')).length, 0);
  assert.deepEqual(await as(db, A)('outbox.fail', {id: added.id, error: 'x'}), {waiting: false}, 'a sent save is not failed afterwards');
});

test('one waiting save per cell and kind: a newer cell type replaces the older', async () => {
  const db = memDb();
  const ct = over => item({kind: 'cell_type', table: 'eyewire_ii_cell_type_v2', annotation: {pt: {position: [100, 200, 300]}, tag: 'Starburst'}, ...over});
  await as(db, A)('outbox.add', {item: ct()});
  await as(db, A)('outbox.add', {item: ct({annotation: {pt: {position: [100, 200, 300]}, tag: 'ON Starburst'}, replacesId: 12})});
  const mine = await as(db, A)('outbox.mine');
  assert.equal(mine.length, 1); assert.equal(mine[0].annotation.tag, 'ON Starburst'); assert.equal(mine[0].replacesId, 12);
  await as(db, A)('outbox.add', {item: item()});
  assert.equal((await as(db, A)('outbox.mine')).length, 2, 'a completion of the same cell is its own save');
});

test('un-marking a completion still waiting cancels it', async () => {
  const db = memDb();
  await as(db, A)('outbox.add', {item: item()});
  assert.deepEqual(await as(db, B)('outbox.cancel', {kind: 'complete', dataset: 'stroeh_mouse_retina', rootId: '720575940578359340'}), {cancelled: 0});
  assert.deepEqual(await as(db, A)('outbox.cancel', {kind: 'complete', dataset: 'stroeh_mouse_retina', rootId: '720575940578359340'}), {cancelled: 1});
  assert.equal((await as(db, A)('outbox.mine')).length, 0);
});

test('a failed try is counted and the save keeps waiting', async () => {
  const db = memDb();
  const added = await as(db, A)('outbox.add', {item: item()});
  await as(db, A)('outbox.fail', {id: added.id, error: 'CAVE 503'});
  await as(db, A)('outbox.fail', {id: added.id, error: 'CAVE 503'});
  assert.equal(db.rows[0].attempts, 2); assert.equal(db.rows[0].last_error, 'CAVE 503'); assert.equal(db.rows[0].status, 'waiting');
});

test('the browser is only ever pointed at a CAVE server the game uses', () => {
  assert.ok(caveServerOk('https://minnie.microns-daf.com'));
  assert.ok(caveServerOk('https://hc.himc-cave.com'));
  for (const s of ['http://minnie.microns-daf.com', 'https://evil.example.com', 'https://minnie.microns-daf.com.evil.com', 'https://user@minnie.microns-daf.com',
    'https://minnie.microns-daf.com/annotation', 'https://minnie.microns-daf.com?x=1', 'javascript:alert(1)', 42]) assert.ok(!caveServerOk(s), String(s));
});

test('items that are not a save the game makes are refused', () => {
  const no = over => assert.throws(() => cleanItem(item(over), A), e => e.status === 400);
  no({kind: 'delete'});
  no({caveServer: 'https://evil.example.com'});
  no({rootId: '12ab'});
  no({pt: [1, 2]});
  no({pt: [1, 2, NaN]});
  no({annotation: {pt: {position: [9, 9, 9]}, tag: 'complete'}});          // a point that is not the item's
  no({annotation: {pt: {position: [100, 200, 300]}, tag: 'Starburst'}});   // a completion not tagged complete
  no({annotation: {pt: {position: [100, 200, 300]}, tag: 'complete', nested: {a: 1}}});
  no({table: 'x; drop table users'});
  no({replacesId: -4, kind: 'cell_type', annotation: {pt: {position: [100, 200, 300]}, tag: 'Starburst'}});
  assert.equal(cleanItem(item({replacesId: 9}), A).replaces_id, null, 'only a cell type replaces an old row');
  assert.equal(cleanItem(item({annotation: {pt: {position: [100, 200, 300]}, tag: 'complete|by:ames'}}), A).annotation.tag, 'complete|by:ames');
});

test('a player cannot fill the table', async () => {
  const db = memDb();
  for (let i = 0; i < MAX_WAITING; i++) db.rows.push({id: 1000 + i, user_id: A, status: 'waiting', kind: 'complete', dataset: 'd', root_id: String(i)});
  await rejects(as(db, A)('outbox.add', {item: item()}), 429);
  await as(db, B)('outbox.add', {item: item()});
});

test('the summary is for admins, and counts players and the oldest', async () => {
  const db = memDb();
  await as(db, A)('outbox.add', {item: item()});
  await as(db, A)('outbox.add', {item: item({rootId: '1'})});
  await as(db, B)('outbox.add', {item: item({kind: 'cell_type', annotation: {pt: {position: [100, 200, 300]}, tag: 'AC'}})});
  await rejects(as(db, A)('outbox.summary'), 403);
  const s = await as(db, A, true)('outbox.summary');
  assert.equal(s.waiting, 3); assert.equal(s.players, 2); assert.deepEqual(s.byKind, {complete: 2, cell_type: 1});
  assert.equal(s.oldest, db.rows[0].created_at);
});
