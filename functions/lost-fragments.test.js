'use strict';
// node --test functions/lost-fragments.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fragmentsAction, cleanAnswer, sheetRow, syncSheet, fragmentPoints, sizePoints } = require('./lost-fragments');

const ANSWER = { fragmentId: '720575940562452709', group: 'smaller', rootId: '720575940565514656', labFlag: 'no flag', labUm3: 153.37,
  fixed: true, ends: true, pointIn: 'dendrite', pt: [20849, 53747, 1111], nucleusId: '', noNucleus: false, note: 'odd tip', caveAnnotationId: 42 };
const ME = { id: 'u-1', display_name: 'Test Player' };

/** A tiny Supabase in memory, answering the REST paths the module uses. */
function fakeDb() {
  const tables = { ew_lost_fragments: [], ew_lost_fragment_claims: [] }; let next = 1;
  const sb = async (path, init = {}) => {
    const [table, q = ''] = path.split('?');
    const rows = tables[table];
    assert.ok(rows, 'unknown table ' + table);
    const p = new URLSearchParams(q);
    const match = r => [...p.entries()].every(([k, v]) => {
      if (['select', 'limit', 'order'].includes(k)) return true;
      if (v === 'is.null') return r[k] == null;
      const [op, ...rest] = v.split('.'); const want = decodeURIComponent(rest.join('.'));
      if (op === 'eq') return String(r[k]) === want;
      if (op === 'neq') return String(r[k]) !== want;
      if (op === 'gt') return String(r[k]) > want;
      if (op === 'lte') return String(r[k]) <= want;
      throw new Error('op ' + op);
    });
    if (!init.method) return rows.filter(match).map(r => ({ ...r }));
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      if (table === 'ew_lost_fragment_claims') {
        if (rows.some(r => r.fragment_id === body.fragment_id)) throw new Error('409 duplicate');
        const r = { claimed_at: new Date().toISOString(), ...body }; rows.push(r); return [{ ...r }];
      }
      const r = { id: next++, sheet_row: null, ...body }; rows.push(r); return [{ ...r }];
    }
    if (init.method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, JSON.parse(init.body))); return hit.map(r => ({ ...r })); }
    if (init.method === 'DELETE') { const hit = rows.filter(match); tables[table] = rows.filter(r => !hit.includes(r)); return hit; }
    throw new Error('unexpected ' + init.method);
  };
  return { rows: tables.ew_lost_fragments, tables, sb };
}
function fakeSheets() {
  const calls = [];
  const sheets = async (path, init) => {
    calls.push({ path, init, values: JSON.parse(init.body).values });
    return /:append/.test(path) ? { updates: { updatedRange: 'Results!A7:P7' } } : {};
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

test('open to every signed in player, and a profile is needed', async () => {
  const { sb } = fakeDb();
  const { OPEN } = require('./lost-fragments');
  assert.equal(OPEN, true);
  await fragmentsAction('fragments.list', {}, { sb, me: ME, isAdmin: false });
  await assert.rejects(fragmentsAction('fragments.list', {}, { sb, me: null, isAdmin: true }), /profile/);
});

test('the first Submit counts, a second updates the same row; the sheet job writes then rewrites its line', async () => {
  const { rows, sb } = fakeDb();
  const { calls, sheets } = fakeSheets();
  const io = { sb, me: ME, isAdmin: true, caveToken: '', caveId: 9 };
  const a = await fragmentsAction('fragments.submit', ANSWER, io);
  assert.equal(a.first, true);
  assert.equal(a.sheet, 'queued');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sheet_dirty, true);
  assert.equal(calls.length, 0, 'Submit itself never touches the sheet');
  assert.deepEqual(await syncSheet({ sb, sheets }), { waiting: 1, written: 1, failed: 0 });
  assert.equal(rows[0].sheet_row, 7);
  assert.equal(rows[0].sheet_dirty, false);
  assert.match(calls[0].path, /Results!A%3AP|Results!A:P|Results%21A%3AP/);
  assert.equal(calls[0].values[0][1], rows[0].player_name, 'the player is named on the line');
  assert.deepEqual(await syncSheet({ sb, sheets }), { waiting: 0, written: 0, failed: 0 }, 'nothing written twice');
  const b = await fragmentsAction('fragments.submit', { ...ANSWER, note: 'changed', caveAnnotationId: null }, io);
  assert.equal(b.first, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].note, 'changed');
  assert.equal(rows[0].cave_annotation_id, 42, 'a resubmit keeps the CAVE row');
  await syncSheet({ sb, sheets });
  assert.match(decodeURIComponent(calls[1].path), /Results!A7:P7/);
  assert.equal(calls[1].init.method, 'PUT');
});

test('a sheet failure keeps the answer waiting for the next run', async () => {
  const { rows, sb } = fakeDb();
  await fragmentsAction('fragments.submit', ANSWER, { sb, me: ME, isAdmin: true });
  const out = await syncSheet({ sb, sheets: async () => { throw new Error('403'); } });
  assert.deepEqual(out, { waiting: 1, written: 0, failed: 1 });
  assert.equal(rows[0].sheet_dirty, true);
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
  assert.equal(line.length, 16, 'A to P only');
  assert.equal(line[15], 'odd tip', 'the note is the last column');
  assert.equal(line[3], "'720575940562452709");
  assert.equal(line[2], 'Small');
  assert.equal(line[9], 'Major dendrite');
});

test('Play claims a fragment until Skip or Submit, one per player, and claims never reach the sheet', async () => {
  const { tables, sb } = fakeDb();
  const { calls, sheets } = fakeSheets();
  const A = { sb, me: ME, isAdmin: true, sheets };
  const B = { sb, me: { id: 'u-2', display_name: 'Other' }, isAdmin: true, sheets };
  const F1 = ANSWER.fragmentId, F2 = '720575940557202527';
  assert.equal((await fragmentsAction('fragments.claim', { fragmentId: F1 }, A)).claimed, true);
  assert.deepEqual(await fragmentsAction('fragments.claim', { fragmentId: F1 }, B), { claimed: false, reason: 'held' });
  const seen = await fragmentsAction('fragments.list', {}, B);
  assert.deepEqual(seen.held, [F1]);
  assert.equal((await fragmentsAction('fragments.list', {}, A)).myClaim, F1);
  // Landing on another lets go of the first.
  await fragmentsAction('fragments.claim', { fragmentId: F2 }, A);
  assert.deepEqual(tables.ew_lost_fragment_claims.map(c => c.fragment_id), [F2]);
  // Skip gives it back.
  await fragmentsAction('fragments.release', { fragmentId: F2 }, A);
  assert.equal(tables.ew_lost_fragment_claims.length, 0);
  assert.equal(calls.length, 0, 'claims and skips write nothing to the sheet');
  // Submit clears the claim, and a done fragment can't be claimed by another.
  await fragmentsAction('fragments.claim', { fragmentId: F1 }, A);
  await fragmentsAction('fragments.submit', ANSWER, A);
  assert.equal(tables.ew_lost_fragment_claims.length, 0);
  assert.deepEqual(await fragmentsAction('fragments.claim', { fragmentId: F1 }, B), { claimed: false, reason: 'done' });
});

test('a claim left alone for two weeks lapses', async () => {
  const { tables, sb } = fakeDb();
  tables.ew_lost_fragment_claims.push({ fragment_id: ANSWER.fragmentId, user_id: 'u-2', claimed_at: new Date(Date.now() - 15 * 864e5).toISOString() });
  assert.equal((await fragmentsAction('fragments.claim', { fragmentId: ANSWER.fragmentId }, { sb, me: ME, isAdmin: true })).claimed, true);
  assert.deepEqual(tables.ew_lost_fragment_claims.map(c => c.user_id), ['u-1']);
});

test('points beta: big fragments pay more than in proportion; edits, growth and the nucleus add', async () => {
  assert.deepEqual([153.29, 400, 1054.57, 1592.08].map(sizePoints), [87, 179, 370, 504]);
  assert.equal(sizePoints(1e9), sizePoints(3000), 'size is capped');
  assert.deepEqual(fragmentPoints({ um3: 400, merges: 3, cuts: 2, um3Added: 12.4, nucleus: true }),
    { size: 179, edits: 40, grown: 12, nucleus: 50, total: 281 });
  assert.equal(fragmentPoints({ um3: 0, merges: 500, cuts: 500 }).edits, 500, 'at most 50 edits count');
  assert.equal(fragmentPoints({ um3: 0, um3Added: 1e6 }).grown, 500, 'growth is capped');
  const { rows, sb } = fakeDb();
  const out = await fragmentsAction('fragments.submit', ANSWER, { sb, me: ME, isAdmin: true });
  assert.equal(out.points.size, sizePoints(rows[0].lab_um3), 'with no CAVE measure, the lab volume sets the size');
  assert.equal(rows[0].points, out.points.total);
  assert.equal(rows[0]._before, undefined, 'the measure helper field is not stored');
});
