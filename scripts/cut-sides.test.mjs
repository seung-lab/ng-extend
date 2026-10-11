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
const { cutSides, piecesFromPreview } = await import(pathToFileURL(out).href);

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
