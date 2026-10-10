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

test('a mark starts at the click, never behind it', { skip: typeof strip !== 'function' }, () => {
  const { branchSegments } = load();
  // The click is on piece b, at x = 23: b's own point (x = 20) is on the soma side of it.
  const beyond = branchSegments(graph(), 'b', 'S', 'away', [23, 0, 0]);
  for (const [p, q] of beyond.segments) assert.ok(p[0] >= 23 && q[0] >= 23, 'beyond must not run back toward the soma: ' + key([p, q]));
  assert.ok(beyond.segments.some(s => key(s) === '23,0,0 > 30,0,0'));
  // The same click, to soma: b's point IS on the way, so the mark goes through it.
  assert.equal(key(branchSegments(graph(), 'b', 'S', 'toward', [23, 0, 0]).segments[0]), '23,0,0 > 20,0,0');
  // A click on the soma side of b's point (x = 17): to soma must not start by going out to x = 20.
  const back = branchSegments(graph(), 'b', 'S', 'toward', [17, 0, 0]);
  assert.equal(key(back.segments[0]), '17,0,0 > 10,0,0');
  for (const [p, q] of back.segments) assert.ok(p[0] <= 17 && q[0] <= 17);
  // And beyond from there does take in b's own point, which lies beyond the click.
  assert.equal(key(branchSegments(graph(), 'b', 'S', 'away', [17, 0, 0]).segments[0]), '17,0,0 > 20,0,0');
});

test('where there are two ways back, the shorter one in distance is taken', { skip: typeof strip !== 'function' }, () => {
  const { branchSegments } = load();
  // Two ways from the soma S to t: through one far away piece (3 pieces, about
  // 1000 long), or along four near ones (5 pieces, 40 long). Fewest pieces
  // would go through the far one.
  const g = { edges: [['S', 'far'], ['far', 't'], ['S', 'p'], ['p', 'q'], ['q', 'r'], ['r', 't'], ['t', 'u']],
    points: new Map(Object.entries({ S: [0, 0, 0], far: [500, 0, 0], p: [0, 10, 0], q: [0, 20, 0], r: [0, 30, 0], t: [0, 40, 0], u: [0, 50, 0] })) };
  const toSoma = branchSegments(g, 'u', 'S', 'toward');
  assert.equal(toSoma.pieces, 6);                                   // u, t, r, q, p, S
  assert.ok(!toSoma.segments.some(s => key(s).includes('500,0,0')));
  // "Beyond" p is everything whose shorter way back is through p: q, r, t and u, not the far piece.
  assert.deepEqual([...new Set(branchSegments(g, 'p', 'S', 'away').segments.flat().map(x => x.join()))].sort(),
    ['0,10,0', '0,20,0', '0,30,0', '0,40,0', '0,50,0']);
  // Move the far piece in close (41 long) and bend the near way out (56 long): now it is through the far piece.
  g.points.set('far', [0, 20, 5]);
  g.points.set('q', [15, 20, 0]);
  assert.equal(branchSegments(g, 'u', 'S', 'toward').pieces, 4);    // u, t, far, S
  // A piece with no position does not block the way or stop the walk.
  g.points.delete('q');
  assert.ok(branchSegments(g, 'q', 'S', 'toward', [15, 20, 0]).pieces >= 3);
});
