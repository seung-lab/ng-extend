// Comparing the game's log of cell types with CAVE's table (src/util/cell_type_check.ts).
// Run: node --test scripts/cell-type-check.test.mjs   (needs typescript installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/util/cell_type_check.ts', import.meta.url), 'utf8');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cell-type-check-')), 'cell_type_check.mjs');
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2020' } }).outputText);
const { checkCellTypes } = await import(pathToFileURL(out).href);

const log = (segId, type, at, point = null, userId = 'u1') => ({ userId, at, segId, type, point });
const cave = (rootId, type, created = '2026-10-10T00:00:00Z', point = [1, 2, 3]) => ({ rootId, type, point, created });
const ids = (o) => new Map(Object.entries(o));
const one = (r, segId) => r.rows.find(x => x.segId === segId).status;

test('a logged type that CAVE has on the same cell is in CAVE', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-08T10:00:00Z')], [cave('A', 'Bipolar Cell')], ids({ A: ['A'] }));
  assert.equal(one(r, 'A'), 'in_cave');
  assert.equal(r.counts.in_cave, 1);
});
test('a cell edited since is found under the ID it has now', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-08T10:00:00Z')], [cave('A2', 'bipolar cell ')], ids({ A: ['A2'] }));
  assert.equal(one(r, 'A'), 'in_cave');
});
test('a save CAVE never took, with its own point, can be sent again', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-11T08:36:00Z', [10, 20, 30])], [cave('Z', 'Amacrine Cell')], ids({ A: ['A'] }));
  assert.equal(one(r, 'A'), 'resend');
});
test('but not if it was saved again later and CAVE has that', () => {
  const r = checkCellTypes(
    [log('A', 'Bipolar Cell', '2026-10-11T08:36:00Z', [10, 20, 30]), log('A', 'Bipolar Cell', '2026-10-11T09:00:00Z')],
    [cave('A', 'Bipolar Cell', '2026-10-11T09:00:01Z')], ids({ A: ['A'] }));
  assert.equal(r.rows.length, 1);
  assert.equal(one(r, 'A'), 'in_cave');
});
test('nor if CAVE already has a row at that very point', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-11T08:36:00Z', [10, 20, 30])], [cave('0', 'Bipolar Cell', '2026-10-12T00:00:00Z', [10, 20, 30])], ids({ A: null }));
  assert.equal(one(r, 'A'), 'in_cave');
});
test('a point shared by several cells (the batch tool) is never sent again as it is', () => {
  const p = [33523, 54748, 1785];
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-07T07:15:52Z', p), log('B', 'Bipolar Cell', '2026-10-07T07:16:00Z', p)], [], ids({ A: ['A'], B: ['B'] }));
  assert.equal(one(r, 'A'), 'needs_point');
  assert.equal(one(r, 'B'), 'needs_point');
  assert.equal(r.counts.resend, 0);
});
test('the game thought it saved and CAVE has nothing: missing, if CAVE lists rows that late', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-08T10:00:00Z')], [cave('Z', 'x', '2026-10-09T00:00:00Z')], ids({ A: ['A'] }));
  assert.equal(one(r, 'A'), 'missing');
});
test('a save newer than anything CAVE lists cannot be judged yet', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-12T10:00:00Z')], [cave('Z', 'x', '2026-10-09T00:00:00Z')], ids({ A: ['A'] }));
  assert.equal(one(r, 'A'), 'too_new');
  assert.equal(r.caveUpTo, '2026-10-09T00:00:00Z');
});
test('CAVE has a different type on the cell: reported, not overwritten', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-08T10:00:00Z')], [cave('A', 'Amacrine Cell')], ids({ A: ['A'] }));
  assert.equal(one(r, 'A'), 'other_type');
  assert.equal(r.rows[0].caveType, 'Amacrine Cell');
});
test('a cell whose current ID could not be found is unknown, never missing', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-08T10:00:00Z')], [cave('Z', 'x')], ids({ A: null }));
  assert.equal(one(r, 'A'), 'unknown');
});
test('after a cut the type may sit on either piece', () => {
  const r = checkCellTypes([log('A', 'Bipolar Cell', '2026-10-08T10:00:00Z')], [cave('A-piece2', 'Bipolar Cell')], ids({ A: ['A-piece1', 'A-piece2'] }));
  assert.equal(one(r, 'A'), 'in_cave');
});

test('a failed save tried again on the same spot is sent once, the newest', () => {
  const r = checkCellTypes(
    [log('A', 'Bipolar Cell', '2026-10-11T08:38:33Z', [39692, 48892, 1458]), log('A2', 'Bipolar Cell', '2026-10-11T08:46:25Z', [39696, 48892, 1478]),
     log('B', 'Bipolar Cell', '2026-10-11T08:36:40Z', [66272, 56491, 1426])],
    [], ids({ A: ['A'], A2: ['A2'], B: ['B'] }));
  assert.equal(one(r, 'A2'), 'resend');
  assert.equal(one(r, 'A'), 'tried_again');
  assert.equal(one(r, 'B'), 'resend');
  assert.equal(r.counts.resend, 2);
});
test('two different types on the same spot are both kept', () => {
  const r = checkCellTypes(
    [log('A', 'Bipolar Cell', '2026-10-11T08:38:33Z', [100, 100, 100]), log('B', 'Amacrine Cell', '2026-10-11T08:46:25Z', [110, 100, 100])],
    [], ids({ A: ['A'], B: ['B'] }));
  assert.equal(r.counts.resend, 2);
});
