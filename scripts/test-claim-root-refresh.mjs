import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClaimRootRefresher, shouldRefreshClaimRoots} from '../src/util/claim_root_refresh.ts';

const task = (extra = {}) => ({id: 1, dataset: 'retina', segment_id: 'old',
  supervoxel_id: 'sv', status: 'assigned', assigned_to: 'player', notes: 'keep', ...extra});
function setup(initial, resolve) {
  const state = {tasks: initial, dataset: 'retina', writes: [], errors: []};
  state.refresh = createClaimRootRefresher({
    tasks: () => state.tasks, dataset: () => state.dataset, canonicalDataset: x => x,
    resolve, persist: async (t, root, old) => { state.writes.push([t.id, root, old]); return true; },
    onError: e => state.errors.push(e),
  });
  return state;
}
test('updates active claims once per supervoxel, preserving other fields', async () => {
  const s = setup([task(), task({id: 2}), task({id: 3, status: 'completed'}),
    task({id: 4, dataset: 'other'}), task({id: 5, supervoxel_id: null})], async ids => {
    assert.deepEqual(ids, ['sv']); return new Map([['sv', 'new']]);
  });
  await s.refresh(true);
  assert.deepEqual(s.tasks.map(t => t.segment_id), ['new', 'new', 'old', 'old', 'old']);
  assert.equal(s.tasks[0].assigned_to, 'player'); assert.equal(s.tasks[0].notes, 'keep');
  assert.equal(s.writes.length, 2);
});
test('no lookup without active claims; panel refresh includes inactive tasks', async () => {
  let calls = 0;
  const s = setup([task({status: 'completed'})], async () => { calls++; return new Map(); });
  await s.refresh(true); assert.equal(calls, 0);
  await s.refresh(); assert.equal(calls, 1);
});
test('edits during a lookup coalesce and discard its stale result', async () => {
  let finish; let calls = 0;
  const s = setup([task()], async () => {
    calls++;
    if (calls === 1) return new Promise(r => { finish = r; });
    return new Map([['sv', 'latest']]);
  });
  const first = s.refresh(true); await Promise.resolve();
  const next = s.refresh(true); s.refresh(true);
  finish(new Map([['sv', 'stale']]));
  await Promise.all([first, next]);
  assert.equal(calls, 2); assert.deepEqual(s.writes, [[1, 'latest', 'old']]);
});
test('dataset switch prevents applying an in-flight response', async () => {
  let finish;
  const s = setup([task()], () => new Promise(r => { finish = r; }));
  const pending = s.refresh(true); await Promise.resolve(); s.dataset = 'other';
  finish(new Map([['sv', 'wrong']])); await pending;
  assert.equal(s.tasks[0].segment_id, 'old'); assert.equal(s.writes.length, 0);
});
test('task replacement updates current objects but does not overwrite a newer root', async () => {
  let finish;
  const s = setup([task(), task({id: 2})], () => new Promise(r => { finish = r; }));
  const pending = s.refresh(true); await Promise.resolve();
  s.tasks = [task({notes: 'edited'}), task({id: 2, segment_id: 'newer'})];
  finish(new Map([['sv', 'resolved']])); await pending;
  assert.equal(s.tasks[0].notes, 'edited'); assert.equal(s.tasks[0].segment_id, 'resolved');
  assert.equal(s.tasks[1].segment_id, 'newer');
});
test('failed or missing lookup preserves roots and subsequent refresh works', async () => {
  let calls = 0;
  const s = setup([task()], async () => {
    if (++calls === 1) throw new Error('offline');
    return new Map([['sv', calls === 2 ? '0' : 'new']]);
  });
  await s.refresh(true); assert.equal(s.tasks[0].segment_id, 'old');
  await s.refresh(true); assert.equal(s.tasks[0].segment_id, 'old');
  await s.refresh(true); assert.equal(s.tasks[0].segment_id, 'new');
  assert.equal(s.errors.length, 1);
});
test('a rejected write keeps the old root retryable', async () => {
  const tasks = [task()]; let writes = 0;
  const refresh = createClaimRootRefresher({
    tasks: () => tasks, dataset: () => 'retina', canonicalDataset: x => x,
    resolve: async () => new Map([['sv', 'new']]),
    persist: async () => { if (++writes === 1) throw new Error('offline'); return true; },
    onError: () => {},
  });
  await refresh(true); assert.equal(tasks[0].segment_id, 'old');
  await refresh(true); assert.equal(tasks[0].segment_id, 'new');
});
test('zero matching database rows restores the prior local root', async () => {
  const tasks = [task()];
  const refresh = createClaimRootRefresher({
    tasks: () => tasks, dataset: () => 'retina', canonicalDataset: x => x,
    resolve: async () => new Map([['sv', 'new']]),
    persist: async () => false, onError: () => {},
  });
  await refresh(true);
  assert.equal(tasks[0].segment_id, 'old');
});
test('refresh trigger distinguishes replacements, reverted edits, and selections', () => {
  const ids = (...values) => new Set(values);
  assert.equal(shouldRefreshClaimRoots('merge', ids('a', 'b'), ids('c')), true);
  assert.equal(shouldRefreshClaimRoots('multicut', ids('a'), ids('b', 'c')), true);
  assert.equal(shouldRefreshClaimRoots('merge', ids('a'), ids('b')), true);
  assert.equal(shouldRefreshClaimRoots('merge', ids('a', 'b'), ids('b', 'a')), false);
  assert.equal(shouldRefreshClaimRoots(null, ids('a'), ids('b')), false);
  assert.equal(shouldRefreshClaimRoots('merge', ids(), ids('b')), false);
  assert.equal(shouldRefreshClaimRoots('multicut', ids('a'), ids()), false);
});
