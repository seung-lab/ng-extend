// Make a Hunt from a proofread cell: the rules that turn a cell's edits into
// Hunt places (src/util/hunt_history_steps.ts). Synthetic histories only.
//   node --test scripts/hunt-history-steps.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';

const strip = module.stripTypeScriptTypes;
const load = () => {
  const js = strip(fs.readFileSync(new URL('../src/util/hunt_history_steps.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
  return new Function(js + ';return {parseBigJson, parseHistory, parseDetails, undoneOps, cellEdits, sessionStarts, sessionSupervoxels, visibleIn, placesFor, SESSION_GAP_MS};')();
};
const H = load();

// Ids as the graph sends them: 18 digits, past what a JSON number holds.
const S0 = '864691136684022390', S1 = '864691135572849645', S2 = '864691135503555394', S3 = '864691136814060915';
const P1 = '864691135667806772', Q2 = '864691136032186760', Q3 = '864691135601560131', X = '864691135857842222', Y = '864691136086181228', Z = '864691135384283610';
const sv = n => String(97114570682278000n + BigInt(n));
const HOUR = 3600 * 1000, T = 1742953854732;

/** The change log as the server sends it (columns of {index: value}), as text. */
function changeLogText(rows) {
  const col = k => Object.fromEntries(rows.map((r, i) => [i, r[k]]));
  const obj = { operation_id: col('id'), timestamp: col('at'), user_name: col('user'), is_merge: col('merge'),
    before_root_ids: col('before'), after_root_ids: col('after') };
  // Root ids written as bare numbers, as the graph writes them.
  return JSON.stringify(obj).replace(/"(\d{16,})"/g, '$1');
}

const ROWS = [
  { id: 10, at: T, user: 'a', merge: true, before: [S0, P1], after: [S1] },          // the cell grows: join P1 at the start cell
  { id: 11, at: T + 60e3, user: 'a', merge: true, before: [X, Y], after: [Z] },      // a piece being built: not the cell
  { id: 12, at: T + 120e3, user: 'a', merge: false, before: [S1], after: [S2] },     // a cut inside the start cell
  { id: 13, at: T + 2 * HOUR, user: 'b', merge: false, before: [S2], after: [S3] },  // next session: a cut inside P1, joined at op 10
];
const DETAILS = {
  10: { added_edges: [[sv(1), sv(100)]], source_coords: [[100, 100, 10]], sink_coords: [[110, 100, 10]], roots: [S1], operation_status: 0 },
  11: { added_edges: [[sv(200), sv(201)]], source_coords: [[900, 900, 90]], sink_coords: [[901, 900, 90]], roots: [Z], operation_status: 0 },
  12: { removed_edges: [[sv(2), sv(3)], [sv(2), sv(4)]], source_coords: [[500, 500, 50], [502, 500, 50]], sink_coords: [[520, 500, 50]], roots: [S2, Q2], operation_status: 0 },
  13: { removed_edges: [[sv(101), sv(102)]], source_coords: [[300, 300, 30]], sink_coords: [[310, 300, 30]], roots: [S3, Q3], operation_status: 0 },
};
const RES = [8, 8, 40];
const parsed = () => {
  const ops = H.parseHistory(H.parseBigJson(changeLogText(ROWS)), S3);
  const details = H.parseDetails(H.parseBigJson(JSON.stringify(DETAILS)));
  return { ops, details };
};

test('long ids stay exact', () => {
  const j = H.parseBigJson(`{"root_id": ${S0}, "list": [${S1}, ${S2}], "n": 12}`);
  assert.equal(j.root_id, S0);
  assert.deepEqual(j.list, [S1, S2]);
  assert.equal(j.n, 12);
});

test('the change log, oldest first, with its roots as text', () => {
  const { ops } = parsed();
  assert.deepEqual(ops.map(o => o.id), [10, 11, 12, 13]);
  assert.deepEqual(ops[0].before, [S0, P1]);
  assert.equal(ops[0].isMerge, true);
  assert.equal(ops[2].isMerge, false);
  assert.equal(ops[3].user, 'b');
});

test("only the cell's own edits, following the root kept", () => {
  const { ops, details } = parsed();
  const { edits, reaches } = H.cellEdits(ops, details, S0, S3, RES);
  assert.equal(reaches, true);
  assert.deepEqual(edits.map(e => e.op.id), [10, 12, 13]);   // 11 built another piece
  assert.deepEqual(edits.map(e => e.prev), [S0, S1, S2]);
  assert.deepEqual(edits.map(e => e.kind), ['merge', 'cut', 'cut']);
  assert.deepEqual(edits[0].piece, [P1]);                     // the piece joined
  assert.deepEqual(edits[1].piece, [Q2]);                     // the piece cut off
  // The middle of the two sides' points, in nm: sources (100,100,10) and sinks (110,100,10) in 8x8x40 voxels.
  assert.deepEqual(edits[0].nm, [840, 800, 400]);
  assert.equal(edits[0].gapNm, 80);
  const short = H.cellEdits(ops.slice(0, 3), details, S0, S3, RES);
  assert.equal(short.reaches, false);
  assert.deepEqual(edits.map(e => e.failed), [false, false, false]);
  // A cut that separated nothing: the graph made only the root kept, so nothing was fixed yet.
  const idle = H.parseDetails({ ...DETAILS, 12: { ...DETAILS[12], roots: [S2] } });
  assert.equal(H.cellEdits(ops, idle, S0, S3, RES).edits[1].failed, true);
});

test('sessions start after an hour without edits', () => {
  const { ops, details } = parsed();
  const { edits } = H.cellEdits(ops, details, S0, S3, RES);
  assert.deepEqual(H.sessionStarts(edits), [0, 2]);
  assert.deepEqual(new Set(H.sessionSupervoxels(edits, 2)), new Set([sv(101), sv(102)]));
});

test('what a player can see from a start', () => {
  const { ops, details } = parsed();
  const { edits } = H.cellEdits(ops, details, S0, S3, RES);
  // Before op 10: the start cell holds sv 1..4; P1 (sv 100..102) is apart.
  const atStart = new Map([[sv(1), S0], [sv(2), S0], [sv(3), S0], [sv(4), S0], [sv(100), P1], [sv(101), P1], [sv(102), P1]]);
  assert.equal(H.visibleIn(edits[0], atStart, S0), true);    // one side in the cell: an extension
  assert.equal(H.visibleIn(edits[1], atStart, S0), true);    // both sides in the cell: a merger
  assert.equal(H.visibleIn(edits[2], atStart, S0), false);   // inside P1, joined later: never seen
  // From the second session the joined piece is part of the cell, so its merger shows.
  const later = new Map([[sv(101), S2], [sv(102), S2]]);
  assert.equal(H.visibleIn(edits[2], later, S2), true);
  // A join whose two sides are both in the cell already is no missing extension.
  assert.equal(H.visibleIn(edits[0], new Map([[sv(1), S0], [sv(100), S0]]), S0), false);
});

test('undone edits: undo fields, and a cut that removes what a join added', () => {
  const ops = [{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }, { id: 4, at: 4 }];
  const d = H.parseDetails({
    1: { added_edges: [[sv(1), sv(2)]] },
    2: { removed_edges: [[sv(2), sv(1)]] },          // takes back op 1 by hand
    3: { added_edges: [[sv(5), sv(6)]] },
    4: { removed_edges: [[sv(7), sv(8)]], undo_operation_id: '3' },
  });
  assert.deepEqual([...H.undoneOps(ops, d)].sort(), [1, 2, 3, 4]);
  const clean = H.parseDetails({ 1: { added_edges: [[sv(1), sv(2)]] }, 2: { removed_edges: [[sv(3), sv(4)]] } });
  assert.equal(H.undoneOps(ops.slice(0, 2), clean).size, 0);
});

test('places: what is dropped, and one per kind within the tolerance', () => {
  const e = (id, kind, nm, extra = {}) => ({ op: { id, at: id, user: 'u' }, prev: S0, kind, pairs: [], nm, gapNm: 500, undone: false, failed: false, piece: [], ...extra });
  const edits = [
    e(1, 'cut', [0, 0, 0]),
    e(2, 'cut', [2000, 0, 0]),                     // 2 µm from 1: the same spot for a gem
    e(3, 'merge', [1000, 0, 0]),                   // close to 1 but the other kind: kept
    e(4, 'cut', [50000, 0, 0], { undone: true }),
    e(5, 'merge', [90000, 0, 0]),                  // not visible
    e(6, 'cut', [120000, 0, 0]),                   // a crumb
    e(7, 'cut', [150000, 0, 0], { gapNm: 4500 }),  // wide: kept, flagged
  ];
  const visible = new Set([1, 2, 3, 4, 6, 7]);
  const sizes = new Map([[1, 40], [2, 30], [3, 12], [6, 1], [7, 9]]);
  const { places, dropped } = H.placesFor(edits, 0, visible, sizes, 3000);
  assert.deepEqual(places.map(p => p.op), [1, 3, 7]);
  assert.deepEqual(places.map(p => p.kind), ['cut', 'merge', 'cut']);
  assert.deepEqual(places.map(p => p.wide), [false, false, true]);
  assert.deepEqual(dropped, { undone: 1, hidden: 1, tiny: 1, close: 1 });
  // From a later start only the later edits count.
  assert.deepEqual(H.placesFor(edits, 5, visible, sizes, 3000).places.map(p => p.op), [7]);
});
