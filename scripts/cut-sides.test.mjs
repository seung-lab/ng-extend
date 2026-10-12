// Which side of a cut each part of a cell falls on (src/util/cut_sides.ts).
// Run: node --test scripts/cut-sides.test.mjs   (needs typescript installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/util/cut_sides.ts', import.meta.url), 'utf8');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cut-sides-')), 'cut_sides.mjs');
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2020' } }).outputText);
const { cutSides, piecesFromPreview, spreadSides, cutSideBlocks, sidesOfGroups, localBlocks, sampleBits, certainPieces, mergeBlocks } = await import(pathToFileURL(out).href);

// A cell shaped like a Y: a trunk t0..t4, then two arms from t4: a0..a3 and b0..b3.
const chain = (ids) => ids.slice(1).map((id, i) => [ids[i], id]);
const trunk = ['t0', 't1', 't2', 't3', 't4'], armA = ['a0', 'a1', 'a2', 'a3'], armB = ['b0', 'b1', 'b2', 'b3'];
const edges = [...chain(trunk), ['t4', 'a0'], ...chain(armA), ['t4', 'b0'], ...chain(armB)];
const points = new Map([...trunk, ...armA, ...armB].map((id, i) => [id, [i * 1000, 0, 0]]));
const sideOf = (r) => { const m = new Map(); for (const l of r.lines) for (const p of [l.a, l.b]) m.set([...points].find(([, q]) => q === p)[0], l.side); return m; };

test('cutting an arm off: the arm is one colour, the rest of the cell the other', () => {
  const r = cutSides(edges, points, new Map([['a1', 'red'], ['a0', 'blue']]));
  const s = sideOf(r);
  for (const id of ['a1', 'a2', 'a3']) assert.equal(s.get(id), 'red', id);
  for (const id of [...trunk, 'a0', ...armB]) assert.equal(s.get(id), 'blue', id);
  assert.equal(r.red, 3); assert.equal(r.blue, 10);
});
test('no line is drawn across the cut', () => {
  const r = cutSides(edges, points, new Map([['a1', 'red'], ['a0', 'blue']]));
  assert.ok(!r.lines.some(l => (l.a === points.get('a0') && l.b === points.get('a1')) || (l.a === points.get('a1') && l.b === points.get('a0'))));
});
test('points far apart: each part takes the nearer colour and they meet in the middle', () => {
  const s = sideOf(cutSides(edges, points, new Map([['a3', 'red'], ['t0', 'blue']])));
  assert.equal(s.get('a2'), 'red'); assert.equal(s.get('t1'), 'blue');
  assert.equal(s.get('b3'), s.get('t4'));   // the other arm goes with whichever side reached the fork
});
test('the colour stops spreading after maxSteps', () => {
  const r = cutSides(edges, points, new Map([['t0', 'red'], ['a3', 'blue']]), 1);
  assert.equal(r.red, 2); assert.equal(r.blue, 2);
});
test('a piece alone on its side still gets a dot', () => {
  const r = cutSides([['x', 'y']], new Map([['x', [0, 0, 0]], ['y', [9, 9, 9]]]), new Map([['x', 'red'], ['y', 'blue']]));
  assert.equal(r.lines.length, 2);
  assert.ok(r.lines.every(l => l.a === l.b));
});
test('a piece with no point is coloured but not drawn, and nothing breaks', () => {
  const pts = new Map(points); pts.delete('a2');
  const r = cutSides(edges, pts, new Map([['a1', 'red'], ['a0', 'blue']]));
  assert.equal(r.red, 3);
  assert.ok(r.lines.length > 0);
});
test('the preview decides each piece by where most of its bits are', () => {
  const pieceOf = new Map([['s1', 'a0'], ['s2', 'a0'], ['s3', 'a0'], ['s4', 'a1'], ['s5', 'a1'], ['s6', 't4'], ['s7', 't4']]);
  const m = piecesFromPreview(['s1', 's4', 's5', 's6'], ['s2', 's3', 's7', 'unknown'], pieceOf);
  assert.equal(m.get('a0'), 'blue');   // 1 red, 2 blue
  assert.equal(m.get('a1'), 'red');
  assert.equal(m.has('t4'), false);    // a tie is left for the spread to decide
});

test('block by block: one colour per block, and "both" where the cut passes through one', () => {
  const side = spreadSides(edges, new Map([['a1', 'red'], ['a0', 'blue']]));
  assert.equal(side.size, 13);
  // t0..t4 and b0..b3 each in a block of their own; a0 and a1 share one; a2 and a3 share one.
  const box = (k) => [k * 100, 0, 0, k * 100 + 100, 100, 100];
  const boxes = new Map([...trunk, ...armB].map((id, i) => [id, box(i)]));
  boxes.set('a0', box(50)); boxes.set('a1', box(50)); boxes.set('a2', box(51)); boxes.set('a3', box(51));
  const blocks = cutSideBlocks(side, boxes);
  assert.equal(blocks.length, 11);
  const at = (k) => blocks.find(b => b.box[0] === k * 100).side;
  assert.equal(at(50), 'both');
  assert.equal(at(51), 'red');
  assert.equal(at(0), 'blue');
});
test('a piece with no block is left out and nothing breaks', () => {
  const blocks = cutSideBlocks(new Map([['x', 'red'], ['y', 'blue']]), new Map([['x', [0, 0, 0, 1, 1, 1]]]));
  assert.deepEqual(blocks, [{ box: [0, 0, 0, 1, 1, 1], side: 'red' }]);
});

test('the side of a group comes from the points it holds, not from its place in the list', () => {
  const g = sidesOfGroups([['b1', 'b2', 'bp'], ['r1', 'rp', 'r2']], ['rp'], ['bp']);
  assert.equal(g.how, 'points');
  assert.deepEqual(g.red, ['r1', 'rp', 'r2']);
  assert.deepEqual(g.blue, ['b1', 'b2', 'bp']);
});
test('more than two groups: each goes with its points, and one with no points is left out', () => {
  const g = sidesOfGroups([['rp', 'a'], ['x', 'y'], ['bp'], ['rp2']], ['rp', 'rp2'], ['bp']);
  assert.deepEqual(g.red, ['rp', 'a', 'rp2']);
  assert.deepEqual(g.blue, ['bp']);
  assert.equal(g.groups[1].size, 2);
});
test('a group holding points of both colours says nothing', () => {
  const g = sidesOfGroups([['rp', 'bp', 'a'], ['b']], ['rp'], ['bp']);
  assert.equal(g.how, 'none');
});
test('no group holds a point: two groups are taken in order, any other number is not guessed', () => {
  assert.equal(sidesOfGroups([['a'], ['b']], ['rp'], ['bp']).how, 'order');
  assert.deepEqual(sidesOfGroups([['a'], ['b']], ['rp'], ['bp']).red, ['a']);
  assert.equal(sidesOfGroups([['a'], ['b'], ['c']], ['rp'], ['bp']).how, 'none');
});
test('near the cut: a block of one side is that colour, a block with both is where the cut passes', () => {
  const B = (k) => [k, 0, 0, k + 1, 1, 1];
  const boxes = new Map([['r1', B(0)], ['r2', B(0)], ['r3', B(1)], ['b1', B(1)], ['b2', B(2)]]);
  const blocks = localBlocks(['r1', 'r2', 'r3'], ['b1', 'b2', 'nobox'], boxes);
  const at = (k) => blocks.find(b => b.box[0] === k).side;
  assert.equal(at(0), 'red'); assert.equal(at(1), 'both'); assert.equal(at(2), 'blue');
});
test('the sample takes a few of each side from each block', () => {
  const B = (k) => [k, 0, 0, k + 1, 1, 1];
  const boxes = new Map(); const red = [], blue = [];
  for (let i = 0; i < 50; i++) { red.push('r' + i); boxes.set('r' + i, B(i % 2)); blue.push('b' + i); boxes.set('b' + i, B(5)); }
  const s = sampleBits(red, blue, boxes, 2);
  assert.equal(s.length, 6);   // 2 red from each of two blocks, 2 blue from one
});
test('a piece seen on both sides has the cut inside it and starts nothing', () => {
  const pieceOf = new Map([['r1', 'P'], ['b1', 'P'], ['r2', 'Q'], ['b2', 'R']]);
  const k = certainPieces(['r1', 'r2'], ['b1', 'b2'], pieceOf);
  assert.equal(k.has('P'), false); assert.equal(k.get('Q'), 'red'); assert.equal(k.get('R'), 'blue');
});
test('the points in one block: that block is pale, never one colour', () => {
  // red and blue points close together in block 1, the cut somewhere in it
  const B = (k) => [k, 0, 0, k + 1, 1, 1];
  const boxes = new Map([['rp', B(1)], ['bp', B(1)], ['r1', B(0)], ['b1', B(2)]]);
  const g = sidesOfGroups([['rp', 'r1'], ['bp', 'b1']], ['rp'], ['bp']);
  const near = localBlocks(g.red, g.blue, boxes);
  const far = [{ box: B(1), side: 'red' }, { box: B(9), side: 'blue' }];
  const all = mergeBlocks(far, near);
  const at = (k) => all.find(b => b.box[0] === k).side;
  assert.equal(at(1), 'both'); assert.equal(at(0), 'red'); assert.equal(at(2), 'blue'); assert.equal(at(9), 'blue');
});
