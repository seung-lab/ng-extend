// The fine picture of a cut (src/util/cut_fine.ts).
// Run: node --test scripts/cut-fine.test.mjs   (needs typescript installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/util/cut_fine.ts', import.meta.url), 'utf8');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cut-fine-')), 'cut_fine.mjs');
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2020' } }).outputText);
const { buildFineGrid } = await import(pathToFileURL(out).href);

const RED = [255, 64, 64], BLUE = [64, 110, 255];
// A straight branch along x, 3 voxels thick, in a volume of 10 nm voxels.
// The volume read is x 40..60 (20 voxels); the cut is at x = 52.
function branch({ cutAt = 52, from = 40, to = 60 } = {}) {
  const dims = [to - from, 5, 5];
  const labels = new Uint8Array(dims[0] * dims[1] * dims[2]);
  for (let z = 1; z < 4; z++) for (let y = 1; y < 4; y++) for (let x = 0; x < dims[0]; x++) {
    labels[x + dims[0] * (y + dims[1] * z)] = from + x < cutAt ? 1 : 2;
  }
  return { originNm: [from * 10, 0, 0], voxelNm: [10, 10, 10], dims, labels };
}
const colourAt = (g, xNm, yNm = 25, zNm = 25) => {
  const c = [xNm, yNm, zNm].map((v, i) => Math.floor((v - g.loNm[i]) / g.cellNm[i]));
  if (c.some((v, i) => v < 0 || v >= g.dims[i])) return 'outside';
  const k = 4 * (c[0] + g.dims[0] * (c[1] + g.dims[1] * c[2]));
  if (g.data[k + 3] === 0) return 'none';
  return g.data[k] === RED[0] ? 'red' : 'blue';
};

test('near the points every voxel has the side the server gave its supervoxel', () => {
  const g = buildFineGrid(branch(), [], RED, BLUE);
  assert.equal(colourAt(g, 515), 'red');    // x = 51, just before the cut
  assert.equal(colourAt(g, 525), 'blue');   // x = 52, just after
  assert.equal(colourAt(g, 405), 'red');
  assert.equal(colourAt(g, 595), 'blue');
});
test('the edge of the cut is one voxel wide, not a pale stretch', () => {
  const g = buildFineGrid(branch(), [[0, 0, 0, 1000, 50, 50]], RED, BLUE);
  for (let x = 405; x < 600; x += 10) assert.equal(colourAt(g, x), x < 520 ? 'red' : 'blue', 'x ' + x);
});
test('the rest of a pale block is filled from the nearest exact colour', () => {
  // the pale block runs x 0..1000 nm; the server only answered for x 400..600
  const g = buildFineGrid(branch(), [[0, 0, 0, 1000, 50, 50]], RED, BLUE);
  assert.equal(colourAt(g, 55), 'red');     // far left of the cut
  assert.equal(colourAt(g, 955), 'blue');   // far right
  assert.ok(g.filled.red > 0 && g.filled.blue > 0);
});
test('outside the pale blocks the colour only reaches a couple of cells, for the surface', () => {
  const g = buildFineGrid(branch(), [], RED, BLUE);
  // the branch is y 10..40; one cell out is coloured, the grid's far corner is not reached from x
  assert.equal(colourAt(g, 505, 5), 'red');
  const none = buildFineGrid(branch({ from: 40, to: 60 }), [[0, 0, 0, 1000, 50, 50]].slice(0, 0), RED, BLUE);
  assert.equal(colourAt(none, 385), 'outside');
});
test('a region with nothing marked gives no picture at all', () => {
  const v = branch(); v.labels.fill(0);
  assert.equal(buildFineGrid(v, [[0, 0, 0, 1000, 50, 50]], RED, BLUE), null);
});
test('a pale stretch too long for the grid is held at a larger cell, still in the right place', () => {
  const g = buildFineGrid(branch(), [[0, 0, 0, 40_000_000, 50, 50]], RED, BLUE);
  assert.ok(g.dims[0] * g.dims[1] * g.dims[2] <= 5e6);
  assert.ok(g.cellNm[0] > 10);
  assert.equal(colourAt(g, 50), 'red');
  assert.equal(colourAt(g, 39_000_000), 'blue');
});
test('the numbers say how much is exact and how much is carried', () => {
  const g = buildFineGrid(branch(), [[0, 0, 0, 1000, 50, 50]], RED, BLUE);
  assert.equal(g.exact.red, 12 * 9);   // x 40..51, 3 x 3 thick
  assert.equal(g.exact.blue, 8 * 9);
});
