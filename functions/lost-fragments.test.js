'use strict';
// node --test functions/lost-fragments.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fragmentsAction, cleanAnswer, sheetRow } = require('./lost-fragments');

const ANSWER = { fragmentId: '720575940562452709', group: 'smaller', rootId: '720575940565514656', labFlag: 'no flag', labUm3: 153.37,
  fixed: true, ends: true, pointIn: 'dendrite', pt: [20849, 53747, 1111], nucleusId: '', noNucleus: false, note: 'odd tip', caveAnnotationId: 42 };
const ME = { id: 'u-1', display_name: 'Test Player' };

/** A tiny ew_lost_fragments in memory, answering the REST paths the module uses. */
function fakeDb() {
  const rows = []; let next = 1;
  const sb = async (path, init = {}) => {
    const [table, q = ''] = path.split('?');
    assert.equal(table, 'ew_lost_fragments');
    const p = new URLSearchParams(q);
    const match = r => [...p.entries()].every(([k, v]) => {
      if (['select', 'limit'].includes(k)) return true;
      if (v === 'is.null') return r[k] == null;
      return String(r[k]) === decodeURIComponent(v.replace(/^eq\./, ''));
    });
    if (!init.method) return rows.filter(match).map(r => ({ ...r }));
    if (init.method === 'POST') { const r = { id: next++, sheet_row: null, ...JSON.parse(init.body) }; rows.push(r); return [{ ...r }]; }
    if (init.method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, JSON.parse(init.body))); return hit.map(r => ({ ...r })); }
    throw new Error('unexpected ' + init.method);
  };
  return { rows, sb };
}
function fakeSheets() {
  const calls = [];
  const sheets = async (path, init) => {
    calls.push({ path, init, values: JSON.parse(init.body).values });
    return /:append/.test(path) ? { updates: { updatedRange: 'Results!A7:T7' } } : {};
  };
  return { calls, sheets };
}

test('answers are checked before anything is saved', () => {
  assert.throws(() => cleanAnswer({ ...ANSWER, fragmentId: 'x' }), /fragment ID/);
  assert.throws(() => cleanAnswer({ ...ANSWER, fixed: false }), /both checks/);
  assert.throws(() => cleanAnswer({ ...ANSWER, pt: null }), /crosshairs/);
  assert.throws(() => cleanAnswer({ ...ANSWER, pointIn: 'soma' }), /nucleus ID/);
  assert.equal(cleanAnswer({ ...ANSWER, pointIn: 'soma', noNucleus: true }).point_in, 'soma');
  assert.throws(() => cleanAnswer({ ...ANSWER, note: 'x'.repeat(2001) }), /too long/);
  assert.equal(cleanAnswer({ ...ANSWER, labFlag: '<b>' }).lab_flag, '');
});

test('only admins and the testers may send', async () => {
  const { sb } = fakeDb();
  await assert.rejects(fragmentsAction('fragments.submit', ANSWER, { sb, me: ME, isAdmin: false }), /not open to you/);
  await assert.rejects(fragmentsAction('fragments.list', {}, { sb, me: null, isAdmin: true }), /profile/);
});

test('the first Submit counts, a second updates the same row and sheet line', async () => {
  const { rows, sb } = fakeDb();
  const { calls, sheets } = fakeSheets();
  const io = { sb, me: ME, isAdmin: true, caveToken: '', caveId: 9, sheets };
  const a = await fragmentsAction('fragments.submit', ANSWER, io);
  assert.equal(a.first, true);
  assert.equal(a.sheet, 'saved');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sheet_row, 7);
  assert.match(calls[0].path, /Results!A%3AT|Results!A:T|Results%21A%3AT/);
  const b = await fragmentsAction('fragments.submit', { ...ANSWER, note: 'changed', caveAnnotationId: null }, io);
  assert.equal(b.first, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].note, 'changed');
  assert.equal(rows[0].cave_annotation_id, 42, 'a resubmit keeps the CAVE row');
  assert.match(decodeURIComponent(calls[1].path), /Results!A7:T7/);
  assert.equal(calls[1].init.method, 'PUT');
});

test('a sheet failure keeps the answer', async () => {
  const { rows, sb } = fakeDb();
  const out = await fragmentsAction('fragments.submit', ANSWER, { sb, me: ME, isAdmin: true, sheets: async () => { throw new Error('403'); } });
  assert.equal(out.sheet, 'failed');
  assert.equal(rows.length, 1);
});

test('list gives my answers and the fragments others have', async () => {
  const { rows, sb } = fakeDb();
  rows.push({ id: 1, user_id: 'u-2', fragment_id: '720575940557202527', pt: [1, 2, 3] });
  rows.push({ id: 2, user_id: 'u-1', fragment_id: '720575940562452709', pt: [1, 2, 3] });
  const out = await fragmentsAction('fragments.list', {}, { sb, me: ME, isAdmin: true });
  assert.deepEqual(out.mine.map(r => r.fragment_id), ['720575940562452709']);
  assert.deepEqual(out.others, ['720575940557202527']);
});

test('the sheet line keeps IDs as text and leaves the lab columns alone', () => {
  const row = { ...cleanAnswer(ANSWER), merges: 2, cuts: 1, um3_added: 1.4, um3_removed: 0, updated_at: '2026-11-19T22:41:00Z' };
  const line = sheetRow(row, 'Test Player');
  assert.equal(line.length, 20, 'A to T only');
  assert.equal(line[3], "'720575940562452709");
  assert.equal(line[2], 'Smaller');
  assert.equal(line[9], 'Major dendrite');
});
