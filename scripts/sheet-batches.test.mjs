import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextBatch} from './sheet-batches.mjs';

const batch = {sheetId: 'NEW', size: 2, whenLeft: 1, skipIndexes: ['3']};
const cells = [1, 2, 3, 4, 5].map(i => ({index: String(i), point: [i, i, i]}));
const task = (i, status = 'pending', assigned_to = null, url = 'x/NEW/edit') => ({status, assigned_to, source_sheet_url: url, notes: `Sheet #${i}`, claim_point_x: i, claim_point_y: i, claim_point_z: i});

test('an empty library is due, in the sheet order, without skipped rows', () => {
  const r = nextBatch(cells, [], batch);
  assert.equal(r.due, true);
  assert.deepEqual(r.candidates.map(c => c.index), ['1', '2', '4', '5']);
});
test('not due while more than whenLeft cells are unclaimed', () => {
  assert.equal(nextBatch(cells, [task(1), task(2)], batch).due, false);
});
test('claimed, completed and hidden cells count as added, and not as unclaimed', () => {
  const r = nextBatch(cells, [task(1, 'assigned', 'a'), task(2, 'completed', 'a'), task(4, 'skipped')], batch);
  assert.equal(r.unclaimed, 0);
  assert.equal(r.due, true);
  assert.deepEqual(r.candidates.map(c => c.index), ['5']);
});
test('a moved claim point still counts as added, by its note', () => {
  const r = nextBatch(cells, [{...task(1), claim_point_x: 99}], batch);
  assert.equal(r.candidates.some(c => c.index === '1'), false);
});
test('tasks from other sources do not hold the batch back', () => {
  const r = nextBatch(cells, [task(1, 'pending', null, 'x/OLD/edit'), task(2, 'pending', null, 'x/OLD/edit'), {status: 'pending', assigned_to: null, notes: 'Hunt cell'}], batch);
  assert.equal(r.unclaimed, 0);
  assert.equal(r.candidates[0].index, '1');
});
test('a finished list is never due', () => {
  assert.equal(nextBatch([cells[0]], [task(1, 'completed', 'a')], batch).due, false);
});
