'use strict';
// The Muller Glia Quest rules (functions/muller-glia.js). node --test muller-glia.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {gliaAction, memDb, readUint64, UNLOCK_AFTER} = require('./muller-glia');

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SEG_A = '720575940548399816', SEG_B = '720575940500000001';
function world() {
  const cells = [];
  for (let i = 0; i < 14; i++) cells.push({sheet_index: `F${i}`, segment_id: `7205759405${String(i).padStart(8, '0')}`, soma_coords: `${i},1,1`, guess: 'Muller', stage: 1});
  cells.push({sheet_index: 'F560', segment_id: SEG_A, soma_coords: '40856,35011,2024', stage: 2, pair_segment: SEG_A});
  cells.push({sheet_index: 'E758', segment_id: SEG_A, soma_coords: '39650,34032,421', stage: 2, pair_segment: SEG_A});
  cells.push({sheet_index: 'G1', segment_id: SEG_B, soma_coords: '1,2,3', stage: 2, pair_segment: SEG_B});
  cells.push({sheet_index: 'G2', segment_id: SEG_B, soma_coords: '4,5,6', stage: 2, pair_segment: SEG_B});
  cells.push({sheet_index: 'G3', segment_id: SEG_B, soma_coords: '7,8,9', stage: 2, pair_segment: SEG_B});
  const db = memDb({cells});
  let roots = {};
  const somaRoots = async somas => somas.map(s => roots[s] ?? null);
  const call = (who, action, args = {}, isAdmin = false) => gliaAction(action, args, {db, me: {id: U(who)}, isAdmin, somaRoots});
  return {db, call, setRoots: r => { roots = r; }};
}

test('no profile, no quest', async () => {
  const {db} = world();
  await assert.rejects(gliaAction('glia.status', {}, {db, me: null}), /No Pyr profile/);
  await assert.rejects(gliaAction('glia.status', {}, {db, me: {id: 'x'}}), /No Pyr profile/);
});

test('Stage 1: answers, one per player per cell, change and undo', async () => {
  const {call} = world();
  const {cells} = await call(1, 'glia.next', {n: 3});
  assert.equal(cells.length, 3);
  await assert.rejects(call(1, 'glia.answer', {cellId: cells[0].id, answer: 'maybe'}), /yes, no or not sure/);
  await assert.rejects(call(1, 'glia.answer', {cellId: 999, answer: 'yes'}), /not in the quest/);
  let r = await call(1, 'glia.answer', {cellId: cells[0].id, answer: 'yes'});
  assert.equal(r.answered, 1); assert.equal(r.cell.yes, 1);
  r = await call(1, 'glia.answer', {cellId: cells[0].id, answer: 'no'});
  assert.equal(r.answered, 1); assert.equal(r.cell.yes, 0); assert.equal(r.cell.no, 1);
  assert.ok(!(await call(1, 'glia.next', {n: 20})).cells.some(c => c.id === cells[0].id), 'an answered cell is not offered again');
  assert.equal((await call(1, 'glia.undo', {cellId: cells[0].id})).answered, 0);
  const mine = await call(1, 'glia.mine');
  assert.equal(mine.answers.length, 0);
});

test('verdicts: 3 yes confirms, 2 no flags; then the cell leaves the queue', async () => {
  const {call} = world();
  const id = (await call(1, 'glia.next', {n: 1})).cells[0].id;
  for (const p of [1, 2]) await call(p, 'glia.answer', {cellId: id, answer: 'yes'});
  // the next player is offered the cell closest to a verdict first
  assert.equal((await call(3, 'glia.next', {n: 1})).cells[0].id, id);
  assert.equal((await call(3, 'glia.answer', {cellId: id, answer: 'yes'})).cell.verdict, 'confirmed');
  assert.ok(!(await call(4, 'glia.next', {n: 20})).cells.some(c => c.id === id));
  await assert.rejects(call(4, 'glia.answer', {cellId: id, answer: 'no'}), /already has its answer/);
  // an earlier answerer may still change theirs
  await call(1, 'glia.answer', {cellId: id, answer: 'unsure'});
  const id2 = (await call(5, 'glia.next', {n: 1})).cells[0].id;
  await call(5, 'glia.answer', {cellId: id2, answer: 'no'});
  assert.equal((await call(6, 'glia.answer', {cellId: id2, answer: 'no'})).cell.verdict, 'flagged');
  const st = await call(1, 'glia.status');
  assert.equal(st.flagged, 1);
});

test(`Stage 2 opens after ${UNLOCK_AFTER} answers, or for admins`, async () => {
  const {call} = world();
  await assert.rejects(call(1, 'glia.pairs'), /opens after/);
  await assert.rejects(call(1, 'glia.check', {pairSegment: SEG_A}), /opens after/);
  assert.equal((await call(9, 'glia.pairs', {}, true)).pairs.length, 2);
  const {cells} = await call(1, 'glia.next', {n: UNLOCK_AFTER});
  for (const c of cells) await call(1, 'glia.answer', {cellId: c.id, answer: 'yes'});
  const st = await call(1, 'glia.status');
  assert.equal(st.unlocked, true);
  const {pairs} = await call(1, 'glia.pairs');
  assert.deepEqual(pairs.map(p => p.glia.length), [2, 3], 'pairs first, then bigger groups');
});

test('Stage 2 check: split only when every soma has its own root; recorded once', async () => {
  const {call, setRoots, db} = world();
  await assert.rejects(call(9, 'glia.check', {pairSegment: 'abc'}, true), /Which segment/);
  await assert.rejects(call(9, 'glia.check', {pairSegment: '720575940599999999'}, true), /not in the quest/);
  setRoots({'40856,35011,2024': SEG_A, '39650,34032,421': SEG_A});
  assert.equal((await call(9, 'glia.check', {pairSegment: SEG_A}, true)).split, false);
  setRoots({'40856,35011,2024': '1'});
  assert.equal((await call(9, 'glia.check', {pairSegment: SEG_A}, true)).unreadable, true);
  setRoots({'40856,35011,2024': '1', '39650,34032,421': '2'});
  const r = await call(9, 'glia.check', {pairSegment: SEG_A}, true);
  assert.equal(r.split, true); assert.deepEqual(r.roots, ['1', '2']);
  assert.equal((await call(8, 'glia.check', {pairSegment: SEG_A}, true)).already, true);
  assert.equal(db._state.splits.length, 1);
  assert.equal(db._state.splits[0].user_id, U(9), 'credit goes to the first to split it');
  assert.deepEqual((await call(9, 'glia.pairs', {}, true)).pairs.map(p => p.segmentId), [SEG_B]);
  // three glia: two apart and one still joined is not done
  setRoots({'1,2,3': '5', '4,5,6': '6', '7,8,9': '6'});
  assert.equal((await call(9, 'glia.check', {pairSegment: SEG_B}, true)).split, false);
});

test('compressed_segmentation reader: one 8x8x8 block, 2 values at 1 bit', () => {
  // channel offset 1; block header at 1: value table at 1+2+? ; built by hand
  const chunk = [8, 8, 8], block = [8, 8, 8];
  const n = 512, bits = 1, words = n * bits / 32; // 16 words of encoded values
  const data = new Uint32Array(1 + 2 + words + 4);
  data[0] = 1;                                     // channel 0 starts at word 1
  const tableOffset = 2 + words;                   // relative to base
  data[1] = (bits << 24) | tableOffset;            // header word 0: bits, table offset
  data[2] = 2;                                     // header word 1: encoded values offset
  const idx = (x, y, z) => x + 8 * (y + 8 * z);
  const set = i => { data[1 + 2 + (i >> 5)] |= 1 << (i & 31); };
  set(idx(3, 4, 5));
  data[1 + tableOffset] = 7; data[1 + tableOffset + 1] = 0;          // value 0 = 7
  data[1 + tableOffset + 2] = 0x89abcdef; data[1 + tableOffset + 3] = 0xa000000; // value 1
  assert.equal(readUint64(data, 1, chunk, block, [0, 0, 0]), '7');
  assert.equal(readUint64(data, 1, chunk, block, [3, 4, 5]), ((0xa000000n << 32n) | 0x89abcdefn).toString());
});

test('the training pair is held out of Stage 2', async () => {
  const {TRAINING_PAIR} = require('./muller-glia');
  const cells = [
    {sheet_index: 'T1', segment_id: TRAINING_PAIR, soma_coords: '1,1,1', stage: 2, pair_segment: TRAINING_PAIR},
    {sheet_index: 'T2', segment_id: TRAINING_PAIR, soma_coords: '2,2,2', stage: 2, pair_segment: TRAINING_PAIR},
  ];
  const db = memDb({cells});
  const ctx = {db, me: {id: U(1)}, isAdmin: true, somaRoots: async s => s.map((_, i) => String(i + 1))};
  assert.equal((await gliaAction('glia.pairs', {}, ctx)).pairs.length, 0);
  await assert.rejects(gliaAction('glia.check', {pairSegment: TRAINING_PAIR}, ctx), /training pair/);
  assert.equal(db._state.splits.length, 0);
});
