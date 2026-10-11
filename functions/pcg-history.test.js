const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const ours = require('./pcg-history');

// The server's copy must behave exactly like the practice reset job's.
test('pcg-history matches scripts/practice-reset-policy.mjs', async () => {
  const theirs = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'practice-reset-policy.mjs')).href);
  const baseline = '2026-10-10T20:00:00Z';
  const base = Date.parse(baseline);
  const records = {R: [
    {operation_id: 10, timestamp: base - 1000},            // before the baseline
    {operation_id: 11, timestamp: base + 1000},
    {operation_id: 12, timestamp: '2026-10-10 20:00:02'},   // naive stamp, read as UTC
    {operation_id: 13, timestamp: (base + 3000) / 1000},    // seconds
  ]};
  const columns = {operation_id: {0: 11, 1: 12}, timestamp: {0: base + 1000, 1: base + 2000}};
  for (const data of [records, columns, JSON.stringify(records.R)]) {
    assert.deepEqual(ours.operationsAfter(data, 'R', baseline), theirs.operationsAfter(data, 'R', baseline));
  }
  assert.deepEqual(ours.operationsAfter(records, 'R', baseline).map(o => o.operationId), [13, 12, 11]);
  const ops = ours.operationsAfter(records, 'R', baseline);
  const details = {11: {operation_status: 0}, 12: {operation_status: 0, undo_operation_id: 11}, 13: {operation_status: 0}};
  assert.deepEqual(ours.remainingOperations(ops, details), theirs.remainingOperations(ops, details));
  assert.deepEqual(ours.remainingOperations(ops, details).map(o => o.operationId), [13], 'an undo and its target cancel out');
  assert.throws(() => ours.remainingOperations(ops, {11: {operation_status: 0}}), /Missing/);
  for (const v of [1791680205861, 1791680205, '1791680205.5', '2026-10-10T20:16:45Z', '2026-10-10 20:16:45']) assert.equal(ours.parsePcgStamp(v), theirs.parsePcgStamp(v));
});
