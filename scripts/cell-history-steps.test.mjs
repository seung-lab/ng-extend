// Watch it grow: reading a cell's edit list and choosing the slider's steps
// (src/util/cell_history_steps.ts). Synthetic change logs only.
//   node --test scripts/cell-history-steps.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';

const strip = module.stripTypeScriptTypes;
const load = () => {
  const js = strip(fs.readFileSync(new URL('../src/util/cell_history_steps.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
  return new Function(js + ';return {parseChangeLog, sampleEdits, historySteps, editorName, MAX_HISTORY_STEPS};')();
};
const H = load();

test('columns as {index: value} under the root id, sorted oldest first', () => {
  const data = { '864691135': {
    operation_id: { 0: 12, 1: 11 },
    timestamp: { 0: 1700000100000, 1: 1700000000000 },
    user_id: { 0: '355', 1: 42 },
    is_merge: { 0: false, 1: true },
  } };
  const edits = H.parseChangeLog(data, '864691135');
  assert.deepEqual(edits.map(e => e.operationId), [11, 12]);
  assert.equal(edits[0].userId, '42');
  assert.equal(edits[0].isMerge, true);
  assert.equal(edits[1].isMerge, false);
});

test('columns as lists, timestamps in seconds or as text', () => {
  const edits = H.parseChangeLog({
    operation_id: [1, 2], timestamp: [1700000000.5, '2023-11-14 22:14:00'], user_id: ['7', '8'], is_merge: [true, false],
  }, 'x');
  assert.equal(edits[0].at, 1700000000500);
  assert.equal(edits[1].at, Date.parse('2023-11-14T22:14:00Z'));
});

test('a list of rows, and an empty log', () => {
  assert.equal(H.parseChangeLog([{ operation_id: 3, timestamp: 1700000000000, user_id: 1, is_merge: true }], 'x').length, 1);
  assert.deepEqual(H.parseChangeLog({ operation_id: {}, timestamp: {} }, 'x'), []);
  assert.deepEqual(H.historySteps([]), []);
});

test('sampling keeps the first and last edit and never repeats one', () => {
  assert.deepEqual(H.sampleEdits(4, 150), [0, 1, 2, 3]);
  const s = H.sampleEdits(612, 150);
  assert.equal(s.length, 150);
  assert.equal(s[0], 0);
  assert.equal(s[s.length - 1], 611);
  assert.equal(new Set(s).size, s.length);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1]);
});

test('steps: before, between edits, and today', () => {
  const edits = [
    { operationId: 1, at: 1000_000, userId: 'a', isMerge: true },
    { operationId: 2, at: 2000_000, userId: 'b', isMerge: false },
    { operationId: 3, at: 4000_000, userId: 'c', isMerge: true },
  ];
  const steps = H.historySteps(edits);
  assert.deepEqual(steps, [
    { edit: -1, askAt: 999_000 },
    { edit: 0, askAt: 1500_000 },
    { edit: 1, askAt: 3000_000 },
    { edit: 2, askAt: null },
  ]);
  // A sampled history still asks between each edit and the very next one.
  const long = Array.from({ length: 300 }, (_, i) => ({ operationId: i, at: (i + 1) * 1000, userId: '', isMerge: true }));
  const ss = H.historySteps(long, 10);
  assert.equal(ss.length, 11);
  assert.equal(ss[ss.length - 1].askAt, null);
  for (const st of ss.slice(1, -1)) assert.equal(st.askAt, long[st.edit].at + 500);
});

test('names: a Pyr player, else unknown', () => {
  const names = new Map([['42', 'Nseraf']]);
  assert.equal(H.editorName('42', names), 'Nseraf');
  assert.equal(H.editorName('9', names), 'unknown');
  assert.equal(H.editorName('', names), 'unknown');
});
