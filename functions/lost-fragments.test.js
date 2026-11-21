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
  const tables = { ew_lost_fragments: [], ew_lost_fragment_claims: [], ew_lost_fragment_stash: [], muller_glia_cells: [], muller_glia_answers: [], ew_lost_fragment_pool: [] }; let next = 1;
  const sb = async (path, init = {}) => {
    const [table, q = ''] = path.split('?');
    if (table === 'rpc/lost_fragment_next') {
      const b = JSON.parse(init.body);
      const cut = new Date(Date.now() - 14 * 864e5).toISOString();
      return tables.ew_lost_fragment_pool.filter(p => p.difficulty === b.p_difficulty && p.rank > (b.p_after || 0) && !p.stale
        && !tables.ew_lost_fragments.some(f => f.fragment_id === p.fragment_id)
        && !tables.ew_lost_fragment_claims.some(c => c.fragment_id === p.fragment_id && c.claimed_at > cut && (String(c.user_id) !== String(b.p_user) || c.kept)))
        .sort((x, y) => x.rank - y.rank).slice(0, b.p_n || 5).map(p => ({ ...p }));
    }
    if (table === 'rpc/lost_fragment_counts') {
      const by = {};
      for (const p of tables.ew_lost_fragment_pool) { by[p.difficulty] = by[p.difficulty] || { difficulty: p.difficulty, total: 0, done: 0 }; by[p.difficulty].total++; if (tables.ew_lost_fragments.some(f => f.fragment_id === p.fragment_id)) by[p.difficulty].done++; }
      return Object.values(by);
    }
    const rows = tables[table];
    assert.ok(rows, 'unknown table ' + table);
    const p = new URLSearchParams(q);
    const match = r => [...p.entries()].every(([k, v]) => {
      if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return true;
      if (v === 'is.null') return r[k] == null;
      const [op, ...rest] = v.split('.'); const want = decodeURIComponent(rest.join('.'));
      if (op === 'eq') return String(r[k]) === want;
      if (op === 'neq') return String(r[k]) !== want;
      if (op === 'eq' && (want === 'true' || want === 'false')) return String(!!r[k]) === want;
      if (op === 'gt') return typeof r[k] === 'number' ? r[k] > Number(want) : String(r[k]) > want;
      if (op === 'in') return want.replace(/^\(|\)$/g, '').split(',').includes(String(r[k]));
      if (op === 'lte') return String(r[k]) <= want;
      throw new Error('op ' + op);
    });
    if (!init.method) {
      const hit = rows.filter(match).map(r => ({ ...r }));
      if (p.get('order') === 'rank.asc') hit.sort((x, y) => x.rank - y.rank);
      return hit;
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      if (table === 'ew_lost_fragment_stash') {
        if (rows.some(r => r.root_id === body.root_id)) return [];
        const r = { created_at: new Date().toISOString(), ...body }; rows.push(r); return [{ ...r }];
      }
      if (table === 'muller_glia_cells') {
        if (rows.some(r => r.sheet_index === body.sheet_index)) return [];
        const r = { id: next++, ...body }; rows.push(r); return [{ ...r }];
      }
      if (table === 'muller_glia_answers') {
        const i = rows.findIndex(r => r.cell_id === body.cell_id && r.user_id === body.user_id);
        if (i >= 0) rows[i] = body; else rows.push(body); return [];
      }
      if (table === 'ew_lost_fragment_claims') {
        if (rows.some(r => r.fragment_id === body.fragment_id)) throw new Error('409 duplicate');
        const r = { claimed_at: new Date().toISOString(), kept: false, ...body }; rows.push(r); return [{ ...r }];
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
  assert.equal(cleanAnswer({ ...ANSWER, pointIn: 'soma' }).point_in, 'soma');  // the nucleus step is gone
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

test('stash: another cell goes into Stashed once, and Proofread it too claims it', async () => {
  const { tables, sb } = fakeDb();
  const OTHER_ID = '720575940570249357';
  await assert.rejects(fragmentsAction('fragments.stash', { rootId: OTHER_ID, fromFragmentId: ANSWER.fragmentId }, { sb, me: ME, isAdmin: false }), /crosshairs/);
  await fragmentsAction('fragments.stash', { rootId: OTHER_ID, fromFragmentId: ANSWER.fragmentId, pt: [1, 2, 3] }, { sb, me: ME, isAdmin: false });
  const again = await fragmentsAction('fragments.stash', { rootId: OTHER_ID, fromFragmentId: ANSWER.fragmentId, pt: [4, 5, 6], choice: 'proofread' }, { sb, me: ME, isAdmin: false });
  assert.equal(tables.ew_lost_fragment_stash.length, 1);
  assert.deepEqual(tables.ew_lost_fragment_stash[0].pt, [1, 2, 3]);
  assert.equal(again.claimed, true);
  const list = await fragmentsAction('fragments.list', {}, { sb, me: ME, isAdmin: false });
  assert.equal(list.stash.length, 1);
  assert.equal(list.myClaim, OTHER_ID);
});

test('an answer carries the other cell; the sheet says it in the note column, A to P only', async () => {
  const a = cleanAnswer({ ...ANSWER, group: 'stashed', otherRoot: '720575940570249357', otherStatus: 'stashed', note: 'odd' });
  assert.equal(a.group_key, 'stashed');
  assert.equal(a.other_status, 'stashed');
  const row = sheetRow({ ...a, updated_at: '2026-11-20T12:00:00Z' }, 'P');
  assert.equal(row.length, 16);
  assert.match(row[15], /^odd Part belonged to cell 720575940570249357, stashed for later\.$/);
  assert.equal(cleanAnswer({ ...ANSWER, otherRoot: '720575940570249357', otherStatus: 'nonsense' }).other_root, null);
});

test('an edited fragment stays yours when you land on the next; five at most, then finish or skip one', async () => {
  const { tables, sb } = fakeDb();
  const io = { sb, me: ME, isAdmin: false };
  const ids = ['720575940500000001', '720575940500000002', '720575940500000003', '720575940500000004', '720575940500000005', '720575940500000006'];
  for (const id of ids.slice(0, 5)) {
    assert.equal((await fragmentsAction('fragments.claim', { fragmentId: id }, io)).claimed, true);
    assert.equal((await fragmentsAction('fragments.keep', { fragmentId: id }, io)).kept, true);
  }
  assert.equal(tables.ew_lost_fragment_claims.length, 5);
  const full = await fragmentsAction('fragments.claim', { fragmentId: ids[5] }, io);
  assert.equal(full.claimed, false);
  assert.equal(full.reason, 'full');
  // One of your own: fine, and nothing is let go.
  assert.equal((await fragmentsAction('fragments.claim', { fragmentId: ids[2] }, io)).claimed, true);
  assert.equal(tables.ew_lost_fragment_claims.length, 5);
  await fragmentsAction('fragments.release', { fragmentId: ids[0] }, io);
  assert.equal((await fragmentsAction('fragments.claim', { fragmentId: ids[5] }, io)).claimed, true);
  const list = await fragmentsAction('fragments.list', {}, io);
  assert.equal(list.myClaims.length, 5);
  assert.equal(list.keepLimit, 5);
});

test('progress is saved on the claim like a claimed cell, and work makes it a started one', async () => {
  const { tables, sb } = fakeDb();
  const io = { sb, me: ME, isAdmin: false };
  const F = '720575940500000011', G = '720575940500000012';
  // Only an anchor: claimed, not started.
  let r = await fragmentsAction('fragments.progress', { fragmentId: F, anchorSv: '88123456789012345' }, io);
  assert.deepEqual(r, { saved: true, kept: false });
  assert.equal(tables.ew_lost_fragment_claims[0].anchor_sv, '88123456789012345');
  // A tick: started, and the draft is kept, cleaned.
  r = await fragmentsAction('fragments.progress', { fragmentId: F, draft: { fixed: true, ends: 'yes', point: [1.4, 2, 3], pointOk: true, note: 'tip', where: 'x' } }, io);
  assert.deepEqual(r, { saved: true, kept: true });
  const row = tables.ew_lost_fragment_claims.find(c => c.fragment_id === F);
  assert.equal(row.anchor_sv, '88123456789012345');
  assert.deepEqual(row.draft, { fixed: true, ends: false, where: 'dendrite', point: [1, 2, 3], pointOk: true, note: 'tip', cellType: '', cellTypeCustom: '' });
  // A new ID from a merge: saved too.
  await fragmentsAction('fragments.progress', { fragmentId: F, rootId: '720575940599999999' }, io);
  assert.equal(row.root_id, '720575940599999999');
  // Landing on the next one keeps it.
  assert.equal((await fragmentsAction('fragments.claim', { fragmentId: G }, io)).claimed, true);
  const list = await fragmentsAction('fragments.list', {}, io);
  const mine = list.myClaims.find(c => c.fragment_id === F);
  assert.equal(mine.kept, true);
  assert.equal(mine.root_id, '720575940599999999');
  assert.equal(mine.draft.note, 'tip');
  // Someone else's fragment: not saved.
  const B = { sb, me: { id: 'u-2', display_name: 'B' }, isAdmin: false };
  r = await fragmentsAction('fragments.progress', { fragmentId: F, draft: { fixed: true } }, B);
  assert.equal(r.saved, false);
  assert.equal(r.reason, 'held');
  assert.throws(() => require('./lost-fragments').cleanProgress({ rootId: 'nope' }), /segment ID/);
});

test('the fragment view saves on the claim like a claimed cell', async () => {
  const { tables, sb } = fakeDb();
  const io = { sb, me: ME, isAdmin: false };
  const F = '720575940500000021';
  const link = 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/123';
  const r = await fragmentsAction('fragments.progress', { fragmentId: F, workingLink: link }, io);
  assert.deepEqual(r, { saved: true, kept: false });
  assert.equal(tables.ew_lost_fragment_claims[0].working_link, link);
  const mine = (await fragmentsAction('fragments.list', {}, io)).myClaims[0];
  assert.equal(mine.working_link, link);
  assert.ok(mine.view_at);
  const { cleanProgress } = require('./lost-fragments');
  assert.throws(() => cleanProgress({ workingLink: 'javascript:alert(1)' }), /view link/);
  assert.throws(() => cleanProgress({ workingLink: 'https://x.org/no-state' }), /view link/);
});

test('a glia is labelled, not proofread: an answer of kind glia, and a Glia Quest vote', async () => {
  const { tables, sb } = fakeDb();
  tables.muller_glia_cells = []; tables.muller_glia_answers = [];
  const io = { sb, me: ME, isAdmin: false };
  const F = '720575940500000041';
  await assert.rejects(fragmentsAction('fragments.glia', { fragmentId: F, group: 'glia', pt: [1, 2, 3] }, io), /one glia/);
  const r = await fragmentsAction('fragments.glia', { fragmentId: F, group: 'glia', rootId: '720575940599999941', fused: 'several', count: 3, pt: [10, 20, 30], labFlag: 'glia' }, io);
  assert.deepEqual(r, { saved: true, first: true, quest: true });
  const row = tables.ew_lost_fragments[0];
  assert.equal(row.kind, 'glia');
  assert.equal(row.point_in, 'glia');
  assert.equal(row.glia_fused, 'several');
  assert.equal(row.glia_count, 3);
  assert.equal(row.points, null);
  assert.equal(tables.muller_glia_cells[0].segment_id, '720575940599999941');
  assert.equal(tables.muller_glia_cells[0].stage, 1);
  assert.equal(tables.muller_glia_answers[0].answer, 'yes');
  const sheet = sheetRow({ ...row, updated_at: '2026-11-21T12:00:00Z' }, 'P');
  assert.equal(sheet[9], 'Glia');
  assert.match(sheet[15], /^Glia: several cells fused together, about 3\.$/);
  // Again: the same cell and vote, not a second.
  await fragmentsAction('fragments.glia', { fragmentId: F, group: 'glia', rootId: '720575940599999941', fused: 'one', pt: [10, 20, 30] }, io);
  assert.equal(tables.muller_glia_cells.length, 1);
  assert.equal(tables.muller_glia_answers.length, 1);
  assert.equal(tables.ew_lost_fragments.length, 1);
  // One glia with a point in its trunk: the sheet says so.
  await fragmentsAction('fragments.glia', { fragmentId: F, group: 'glia', fused: 'one', trunk: true, pt: [11, 21, 31] }, io);
  const one = tables.ew_lost_fragments[0];
  assert.equal(one.glia_trunk, true);
  assert.deepEqual(one.pt, [11, 21, 31]);
  assert.match(sheetRow({ ...one, updated_at: '2026-11-21T12:00:00Z' }, 'P')[15], /^Glia: one cell, the point is in its main trunk\.$/);
});

test('the lab list plays from the centre outward, past done, held and edited fragments', async () => {
  const { tables, sb } = fakeDb();
  const mk = (id, rank, difficulty) => ({ fragment_id: id, rank, difficulty, cls: 'orphan', split_from: rank === 2 ? 'I6226' : '', sheet_index: '', likely_soma: difficulty === 'easy',
    vol_ipl_um3: 100, vol_total_um3: 300, dist_um: rank * 10, anchor: [1, 2, rank], stale: false });
  tables.ew_lost_fragment_pool.push(mk('720575940500000101', 5, 'easy'), mk('720575940500000102', 2, 'easy'), mk('720575940500000103', 9, 'easy'), mk('720575940500000104', 1, 'medium'));
  const io = { sb, me: ME, isAdmin: false };
  // Page: by rank, with counts.
  const page = await fragmentsAction('fragments.pool', { difficulty: 'easy' }, io);
  assert.deepEqual(page.rows.map(r => r.rank), [2, 5, 9]);
  assert.equal(page.rows[0].splitFrom, 'I6226');
  assert.deepEqual(page.counts.easy, { total: 3, done: 0 });
  // Next: the most central one.
  assert.equal((await fragmentsAction('fragments.next', { difficulties: ['easy'] }, io)).row.rank, 2);
  // Someone else holds rank 2; rank 5 was edited (not current): rank 9.
  tables.ew_lost_fragment_claims.push({ fragment_id: '720575940500000102', user_id: 'u-2', kept: false, claimed_at: new Date().toISOString() });
  const graph = global.fetch;
  global.fetch = async (url, init) => ({ ok: true, json: async () => ({ is_latest: JSON.parse(init.body).node_ids.map(id => id !== '720575940500000101') }) });
  try {
    const next = await fragmentsAction('fragments.next', { difficulties: ['easy'] }, { ...io, caveToken: 't' });
    assert.equal(next.row.rank, 9);
    assert.equal(tables.ew_lost_fragment_pool.find(p => p.fragment_id === '720575940500000101').stale, true);
  } finally { global.fetch = graph; }
  // Easy all used up: Medium next.
  tables.ew_lost_fragments.push({ fragment_id: '720575940500000103', user_id: 'u-3' });
  assert.equal((await fragmentsAction('fragments.next', { difficulties: ['easy'] }, io)).row.difficulty, 'medium');
  assert.equal((await fragmentsAction('fragments.get', { ids: ['720575940500000104'] }, io)).rows[0].rank, 1);
});
