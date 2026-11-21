'use strict';
// node --test functions/nicknames.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { nicknamesAction } = require('./nicknames');

function fakeDb() {
  const rows = []; let next = 1;
  const sb = async (path, init = {}) => {
    const [table, q = ''] = path.split('?');
    assert.equal(table, 'ew_cell_nicknames');
    const p = new URLSearchParams(q);
    const match = r => [...p.entries()].every(([k, v]) => {
      if (['select', 'limit', 'order'].includes(k)) return true;
      const [op, ...rest] = v.split('.'); const want = decodeURIComponent(rest.join('.'));
      if (op === 'eq') return String(r[k]) === want;
      throw new Error('op ' + op);
    });
    if (!init.method) return rows.filter(match).map(r => ({ ...r }));
    if (init.method === 'POST') { const r = { id: next++, ...JSON.parse(init.body) }; rows.push(r); return [{ ...r }]; }
    if (init.method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, JSON.parse(init.body))); return hit; }
    if (init.method === 'DELETE') { const hit = rows.filter(match); hit.forEach(h => rows.splice(rows.indexOf(h), 1)); return hit; }
    throw new Error(init.method);
  };
  return { rows, sb };
}
const A = '720575940500000031', B = '720575940599999931';

test('a nickname is the player\'s own, follows new IDs, and clears', async () => {
  const { rows, sb } = fakeDb();
  const me = { id: 'u-1' }, other = { id: 'u-2' };
  let r = await nicknamesAction('nicknames.set', { segId: A, nickname: '  cell I merged   a branch into ', anchorSv: '88123', ids: [B, 'junk'] }, { sb, me });
  assert.equal(r.saved, true);
  assert.equal(rows[0].nickname, 'cell I merged a branch into');
  assert.deepEqual(rows[0].ids, [A, B]);
  assert.equal(rows[0].anchor_sv, '88123');
  r = await nicknamesAction('nicknames.track', { segId: A, ids: ['720575940512345678'] }, { sb, me });
  assert.deepEqual(r.ids, [A, B, '720575940512345678']);
  // Renamed: the anchor stays.
  await nicknamesAction('nicknames.set', { segId: A, nickname: 'branch home' }, { sb, me });
  assert.equal(rows[0].nickname, 'branch home');
  assert.equal(rows[0].anchor_sv, '88123');
  assert.equal(rows.length, 1);
  // Only yours.
  assert.equal((await nicknamesAction('nicknames.list', {}, { sb, me: other })).nicknames.length, 0);
  assert.equal((await nicknamesAction('nicknames.list', {}, { sb, me })).nicknames[0].nickname, 'branch home');
  await assert.rejects(nicknamesAction('nicknames.set', { segId: A, nickname: 'x'.repeat(81) }, { sb, me }), /80 characters/);
  await assert.rejects(nicknamesAction('nicknames.set', { segId: 'nope', nickname: 'x' }, { sb, me }), /segment ID/);
  r = await nicknamesAction('nicknames.set', { segId: A, nickname: '' }, { sb, me });
  assert.equal(r.deleted, true);
  assert.equal(rows.length, 0);
});
