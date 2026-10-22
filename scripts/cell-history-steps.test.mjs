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
  return new Function(js + ';return {parseChangeLog, parseBigJson, sampleEdits, historySteps, editorName, parseLineage, piecesAt, stepView, MAX_HISTORY_STEPS};')();
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

test('lineage: pieces apart, then joined, then a piece cut off', () => {
  // A and B are separate at first. Edit 1 (t=100 s) joins them into C.
  // Edit 2 (t=200 s) cuts C into D (today) and E (thrown away, so not in
  // the lineage). 18 digit ids must not be rounded.
  const A = '864691135000000011', B = '864691135000000022', C = '864691135000000033', D = '864691135000000044';
  const text = `{"directed":true,"nodes":[{"id":${A}},{"id":${B},"timestamp":10.5},{"id":${C},"timestamp":100.0,"operation_id":1},{"id":${D},"timestamp":200,"operation_id":2}],"links":[{"source":${A},"target":${C}},{"source":${B},"target":${C}},{"source":${C},"target":${D}}]}`;
  const L = H.parseLineage(text);
  assert.deepEqual(H.piecesAt(L, 50_000), [A, B].sort());
  assert.deepEqual(H.piecesAt(L, 150_000), [C]);
  assert.deepEqual(H.piecesAt(L, 250_000), [D]);
  // Before B existed, only A.
  assert.deepEqual(H.piecesAt(L, 5_000), [A]);
});

test('lineage: a piece cut off and dropped is never shown after the cut', () => {
  const C = '864691135000000033', D = '864691135000000044', E = '864691135000000055';
  const text = `{"nodes":[{"id":${C},"timestamp":100},{"id":${D},"timestamp":200},{"id":${E},"timestamp":200}],"links":[{"source":${C},"target":${D}},{"source":${C},"target":${E}}]}`;
  const L = H.parseLineage(text, D);
  assert.deepEqual(H.piecesAt(L, 150_000), [C]);
  assert.deepEqual(H.piecesAt(L, 250_000), [D]);
  assert.equal(L.bornAt.has(E), false);
});

test('dates in the web form, and lineage times taken from the edit list', () => {
  const A = '864691135000000011', B = '864691135000000022', C = '864691135000000033';
  // Times written as "Wed, 22 Jan 2026 19:33:00 GMT".
  const rfc = `{"nodes":[{"id":${A},"timestamp":"Thu, 01 Jan 1970 00:00:10 GMT"},{"id":${B},"timestamp":"Thu, 01 Jan 1970 00:00:20 GMT"},{"id":${C},"timestamp":"Thu, 01 Jan 1970 00:01:40 GMT"}],"links":[{"source":${A},"target":${C}},{"source":${B},"target":${C}}]}`;
  assert.deepEqual(H.piecesAt(H.parseLineage(rfc, C), 50_000), [A, B]);
  // No time at all: the operation id's time from the edit list.
  const bare = `{"nodes":[{"id":${A}},{"id":${B}},{"id":${C},"operation_id":7}],"links":[{"source":${A},"target":${C}},{"source":${B},"target":${C}}]}`;
  const L = H.parseLineage(bare, C, new Map([[7, 100_000]]));
  assert.deepEqual(H.piecesAt(L, 50_000), [A, B]);
  assert.deepEqual(H.piecesAt(L, 150_000), [C]);
});

test('change log: the versions each edit touched, 18 digits intact', () => {
  const text = '{"operation_id":{"0":5},"timestamp":{"0":1700000000000},"user_id":{"0":"1"},"is_merge":{"0":true},"before_root_ids":{"0":[864691135000000011,864691135000000022]},"after_root_ids":{"0":[864691135000000033]}}';
  const [e] = H.parseChangeLog(H.parseBigJson(text), 'x');
  assert.deepEqual(e.beforeRoots, ['864691135000000011', '864691135000000022']);
  assert.deepEqual(e.afterRoots, ['864691135000000033']);
});

test('step view: the piece joined on, and the piece cut off, coloured apart', () => {
  // Body: A0 -> A1 -> A2 (long history). Twig T joins at edit J making M.
  // Then edit K cuts M into N (kept) and X (dropped).
  const id = n => String(864691135000000000n + BigInt(n));
  const [A0, A1, A2, T, M, N, X] = [1, 2, 3, 4, 5, 6, 7].map(id);
  const text = `{"nodes":[{"id":${A0}},{"id":${A1},"timestamp":10},{"id":${A2},"timestamp":20},{"id":${T}},{"id":${M},"timestamp":30},{"id":${N},"timestamp":40},{"id":${X},"timestamp":40}],"links":[{"source":${A0},"target":${A1}},{"source":${A1},"target":${A2}},{"source":${A2},"target":${M}},{"source":${T},"target":${M}},{"source":${M},"target":${N}},{"source":${M},"target":${X}}]}`;
  const L = H.parseLineage(text, N);
  const join = { isMerge: true, beforeRoots: [A2, T], afterRoots: [M] };
  const v = H.stepView(L, join, H.piecesAt(L, 35_000));
  assert.deepEqual(v.ids, [A2, T].sort());
  assert.deepEqual(v.added, [T]);
  const cut = { isMerge: false, beforeRoots: [M], afterRoots: [N, X] };
  const w = H.stepView(L, cut, H.piecesAt(L, 45_000));
  assert.deepEqual(w.ids, [N, X].sort());
  assert.deepEqual(w.cut, [X]);
  // Without the edit's versions: just the pieces.
  assert.deepEqual(H.stepView(L, { isMerge: true, beforeRoots: [], afterRoots: [] }, [N]).ids, [N]);
});
