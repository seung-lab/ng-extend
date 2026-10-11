// The rule for carrying a Δ menu mark over to a cell's new ID (src/util/mark_follow.ts).
// Run: node --test scripts/mark-follow.test.mjs   (needs typescript installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/util/mark_follow.ts', import.meta.url), 'utf8');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mark-follow-')), 'mark_follow.mjs');
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2020' } }).outputText);
const { markToCarry } = await import(pathToFileURL(out).href);

const A = '720575940000000001', B = '720575940000000002', C = '720575940000000003', X = '720575940000000009';
// History: A was merged into to give B. Later B was cut into C (the cell) and X (the piece removed).
const history = { [B]: [A], [C]: [A, B], [X]: [A, B] };
const look = (over = {}) => ({
  asked: 0,
  async ancestorAmong(root, candidates) { this.asked++; return candidates.find(c => (history[root] || []).includes(c)) ?? null; },
  async rootOfSupervoxel(sv) { return { sv_in_cell: C, sv_in_piece: X }[sv] ?? null; },
  async liveEnds(root) { return root === A || root === B ? [C, X] : [root]; },
  ...over,
});

test('a mark follows the cell through a merge', async () => {
  const l = look({ async liveEnds() { return [B]; }, async rootOfSupervoxel() { return B; } });
  assert.equal(await markToCarry(B, { [A]: { isComplete: false, cellType: 'Bipolar Cell' } }, l), A);
  assert.equal(await markToCarry(B, { [A]: { isComplete: true, cellType: '', sv: 'sv1' } }, l), A);
});
test('after a cut, the mark goes to the piece holding the spot it was made on', async () => {
  const marks = { [A]: { isComplete: true, cellType: 'Bipolar Cell', sv: 'sv_in_cell' } };
  assert.equal(await markToCarry(C, marks, look()), A);
  assert.equal(await markToCarry(X, marks, look()), null);
});
test('after a cut with no spot on record, neither piece takes the mark', async () => {
  const marks = { [A]: { isComplete: true, cellType: 'Bipolar Cell' } };
  assert.equal(await markToCarry(C, marks, look()), null);
  assert.equal(await markToCarry(X, marks, look()), null);
});
test('an unrelated cell takes nothing', async () => {
  assert.equal(await markToCarry('720575940000000777', { [A]: { isComplete: true, cellType: 'x' } }, look()), null);
});
test('a cell with its own mark, or no marks kept at all, asks nothing', async () => {
  const l = look();
  assert.equal(await markToCarry(B, { [B]: { isComplete: false, cellType: '' }, [A]: { isComplete: true, cellType: 'x' } }, l), null);
  assert.equal(await markToCarry(B, {}, l), null);
  assert.equal(await markToCarry(B, { [A]: { isComplete: false, cellType: '' } }, l), null);
  assert.equal(l.asked, 0);
});
test('a history that could not be read carries nothing', async () => {
  assert.equal(await markToCarry(B, { [A]: { isComplete: true, cellType: 'x' } }, look({ async ancestorAmong() { return undefined; } })), null);
});
