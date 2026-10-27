'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {productionGroupStep, syncProductionGroup, RECHECK_MS, _lastChecked} = require('./production-group');

/** A small stand-in for the PostgREST helper: the shapes production-group.js uses. */
function world({group = null} = {}) {
  const state = {groups: group ? [group] : [], members: [], calls: []};
  const sb = async (path, init = {}) => {
    const method = init.method || 'GET';
    state.calls.push(`${method} ${path}`);
    if (path.startsWith('user_groups?name=eq.')) return state.groups.slice(0, 1);
    if (path === 'user_groups' && method === 'POST') { const g = {id: 77, ...JSON.parse(init.body)}; state.groups.push(g); return [g]; }
    if (path.startsWith('user_group_members?on_conflict') && method === 'POST') { state.members.push(JSON.parse(init.body)); return null; }
    if (path.startsWith('user_group_members?group_id=') && method === 'DELETE') { state.members = []; return null; }
    throw new Error('unexpected ' + path);
  };
  return {sb, state};
}
const me = id => ({id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(id).padStart(12, '0')}`});

test('the step: add those with access, take out those without, leave the unknown', () => {
  assert.equal(productionGroupStep(true, false), 'add');
  assert.equal(productionGroupStep(false, true), 'remove');
  assert.equal(productionGroupStep(true, true), null);
  assert.equal(productionGroupStep(false, false), null);
  assert.equal(productionGroupStep(null, true), null);
});

test('a player with access is added, and the group is made the first time', async () => {
  _lastChecked.clear();
  const {sb, state} = world();
  assert.equal(await syncProductionGroup(sb, me(1), [], async () => true), 'add');
  assert.equal(state.groups[0].name, 'Production editors');
  assert.deepEqual(state.members, [{group_id: 77, user_id: me(1).id}]);
});

test('a player who lost access is taken out; one without access never makes the group', async () => {
  _lastChecked.clear();
  const a = world({group: {id: 5}});
  assert.equal(await syncProductionGroup(a.sb, me(2), [5], async () => false), 'remove');
  const b = world();
  assert.equal(await syncProductionGroup(b.sb, me(3), [], async () => false), null);
  assert.equal(b.state.groups.length, 0);
});

test('a failed lookup changes nothing, and a player is looked at once every few hours', async () => {
  _lastChecked.clear();
  const {sb, state} = world({group: {id: 5}});
  assert.equal(await syncProductionGroup(sb, me(4), [5], async () => null), null);
  assert.equal(state.calls.length, 0);
  let asked = 0;
  const ask = async () => { asked++; return true; };
  const t0 = Date.now();
  await syncProductionGroup(sb, me(5), [], ask, t0);
  await syncProductionGroup(sb, me(5), [], ask, t0 + 1000);
  assert.equal(asked, 1);
  await syncProductionGroup(sb, me(5), [], ask, t0 + RECHECK_MS + 1);
  assert.equal(asked, 2);
});

test('a database error never reaches the request', async () => {
  _lastChecked.clear();
  const sb = async () => { throw new Error('supabase 500'); };
  assert.equal(await syncProductionGroup(sb, me(6), [], async () => true), null);
});
