// Highlight mode's "To soma" and "Beyond": which pieces of a cell lie on
// which side of a click (src/util/branch_tree.ts). Synthetic cells only.
//   node --test scripts/branch-tree.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';

const strip = module.stripTypeScriptTypes;
const load = () => {
  const js = strip(fs.readFileSync(new URL('../src/util/branch_tree.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
  return new Function(js + ';return {branchSegments, nearestPiece};')();
};

// A small cell. S is the soma.
//
//        d - e          h
//        |              |
//  S - a - b - c    S - f - g
//
// plus a loop b - x - c (two branches that touch).
const P = { S: [0, 0, 0], a: [10, 0, 0], b: [20, 0, 0], c: [30, 0, 0], d: [10, 10, 0], e: [20, 10, 0],
  f: [0, 10, 0], g: [0, 20, 0], h: [5, 15, 0], x: [25, 5, 0] };
const graph = (drop = []) => ({
  edges: [['S', 'a'], ['a', 'b'], ['b', 'c'], ['a', 'd'], ['d', 'e'], ['S', 'f'], ['f', 'g'], ['f', 'h'], ['b', 'x'], ['x', 'c']],
  points: new Map(Object.entries(P).filter(([k]) => !drop.includes(k))),
});
const key = seg => seg.map(p => p.join(',')).join(' > ');
const pieces = (segs, g = graph()) => {
  const name = p => [...g.points].find(([, q]) => q.join() === p.join())?.[0] ?? 'click';
  return new Set(segs.flatMap(s => s.map(name)));
};

test('to soma is the way back, and only that', { skip: typeof strip !== 'function' }, () => {
  const { branchSegments } = load();
  const r = branchSegments(graph(), 'e', 'S', 'toward');
  assert.deepEqual(r.segments.map(key), ['20,10,0 > 10,10,0', '10,10,0 > 10,0,0', '10,0,0 > 0,0,0']);
  assert.equal(r.pieces, 4);
  // It starts at the click and ends at the soma point when they are given.
  const withEnds = branchSegments(graph(), 'e', 'S', 'toward', [21, 11, 0], [-1, 0, 0]);
  assert.equal(key(withEnds.segments[0]), '21,11,0 > 20,10,0');
  assert.equal(key(withEnds.segments.at(-1)), '0,0,0 > -1,0,0');
});

test('beyond is everything past the point, and nothing on the soma side', { skip: typeof strip !== 'function' }, () => {
  const { branchSegments } = load();
  const r = branchSegments(graph(), 'a', 'S', 'away');
  assert.deepEqual([...pieces(r.segments)].sort(), ['a', 'b', 'c', 'd', 'e', 'x']);
  assert.equal(r.pieces, 6);
  // The other branch off the soma is untouched.
  for (const other of ['S', 'f', 'g', 'h']) assert.equal(pieces(r.segments).has(other), false);
  // A loop does not draw anything twice or run forever.
  assert.equal(new Set(r.segments.map(key)).size, r.segments.length);
  // From farther out, less.
  assert.deepEqual([...pieces(branchSegments(graph(), 'd', 'S', 'away').segments)].sort(), ['d', 'e']);
  // The reference need not be the soma: any piece on the soma side orients it the same way.
  assert.deepEqual([...pieces(branchSegments(graph(), 'd', 'f', 'away').segments)].sort(), ['d', 'e']);
  // Turned round, "beyond" is the other side.
  assert.deepEqual([...pieces(branchSegments(graph(), 'a', 'e', 'away').segments)].sort(), ['S', 'a', 'b', 'c', 'f', 'g', 'h', 'x']);
});

test('it says so when there is nothing to mark', { skip: typeof strip !== 'function' }, () => {
  const { branchSegments } = load();
  assert.throws(() => branchSegments(graph(), 'e', 'S', 'away'), /tip of its branch/);
  assert.throws(() => branchSegments(graph(), 'S', 'S', 'toward'), /already at the soma/);
  assert.throws(() => branchSegments(graph(), 'a', 'a', 'away'), /same small piece/);
  assert.throws(() => branchSegments(graph(), 'nowhere', 'S', 'toward'), /not on a mapped part/);
  const split = graph(); split.edges = split.edges.filter(e => e.join() !== 'S,f');
  assert.throws(() => branchSegments(split, 'g', 'S', 'toward'), /No connection/);
});

test('a piece with no position is bridged, not a gap', { skip: typeof strip !== 'function' }, () => {
  const { branchSegments, nearestPiece } = load();
  const g = graph(['d']);
  assert.deepEqual(branchSegments(g, 'e', 'S', 'toward').segments.map(key), ['20,10,0 > 10,0,0', '10,0,0 > 0,0,0']);
  const away = branchSegments(g, 'a', 'S', 'away');
  assert.ok(away.segments.map(key).includes('10,0,0 > 20,10,0'));   // a straight to e, over the missing d
  assert.equal(away.pieces, 6);
  assert.deepEqual(nearestPiece(graph(), [29, 1, 0]), { id: 'c', distNm: Math.hypot(1, 1) });
});
