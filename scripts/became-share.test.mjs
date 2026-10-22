// Which live cells an old cell ID became (src/util/became_share.ts), for the
// Δ menu's "Update to the current ID".
// Run: node --test scripts/became-share.test.mjs   (needs typescript installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/util/became_share.ts', import.meta.url), 'utf8');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'became-share-')), 'became_share.mjs');
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2020' } }).outputText);
const { mainPieces, evenSample } = await import(pathToFileURL(out).href);

const A = '720575940538342067', B = '720575940611111111', C = '720575940622222222', D = '720575940633333333';
const blocks = (counts) => Object.entries(counts).flatMap(([id, n]) => Array(n).fill(id));

test('a cut-off bit joined to another cell is not shown', () => {
  // 90 of 100 blocks are in A now; B and C each took 5 cut-away blocks.
  assert.deepEqual(mainPieces(blocks({ [A]: 90, [B]: 5, [C]: 5 }), [A, B, C]), [A]);
});
test('many small bits merged elsewhere still give just the cell', () => {
  const counts = { [A]: 40 };
  for (let i = 0; i < 12; i++) counts[`72057594070000000${i}`.slice(0, 18)] = 5;
  assert.deepEqual(mainPieces(blocks(counts)), [A]);
});
test('a real split into two big pieces shows both, biggest first', () => {
  assert.deepEqual(mainPieces(blocks({ [B]: 45, [A]: 55 }), [A, B]), [A, B]);
});
test('a piece at exactly a fifth is kept, just under is not', () => {
  assert.deepEqual(mainPieces(blocks({ [A]: 60, [B]: 20, [C]: 19, [D]: 1 })), [A, B]);
});
test('the biggest is kept even when no piece holds a fifth', () => {
  // 13 of 40 blocks in A; the rest in 7s and 6s, each under a fifth.
  assert.deepEqual(mainPieces(blocks({ [A]: 13, [B]: 7, [C]: 7, [D]: 7, '720575940644444444': 6 })), [A]);
});
test('blocks that point at a retired ID are left out when the live ends are known', () => {
  const old = '720575940500000000';
  assert.deepEqual(mainPieces(blocks({ [old]: 70, [A]: 25, [B]: 5 }), [A, B]), [A]);
});
test('nothing usable gives an empty answer, so the caller falls back', () => {
  assert.deepEqual(mainPieces([]), []);
  assert.deepEqual(mainPieces(['0', '0']), []);
  assert.deepEqual(mainPieces(blocks({ [D]: 3 }), [A]), []);
});
test('18 digit ids come back as the same text', () => {
  const big = '864691135123456789';
  assert.deepEqual(mainPieces([big, big]), [big]);
});
test('evenSample keeps everything when small, spreads out when large', () => {
  assert.deepEqual(evenSample([1, 2, 3], 5), [1, 2, 3]);
  const s = evenSample([...Array(10000).keys()], 2000);
  assert.equal(s.length, 2000);
  assert.equal(s[0], 0);
  assert.equal(s[1999], 9995);
  assert.equal(new Set(s).size, 2000);
});

// The whole lookup (currentPiecesOf in src/widgets/pcg_service.ts) against a
// stubbed CAVE: the reported case, an old wrong merger whose cut-off bits
// were joined to other cells.
const pcgSrc = fs.readFileSync(new URL('../src/widgets/pcg_service.ts', import.meta.url), 'utf8')
  .replace("'../util/became_share'", "'./became_share.mjs'");
const pcgOut = path.join(path.dirname(out), 'pcg_service.mjs');
fs.writeFileSync(pcgOut, ts.transpileModule(pcgSrc, { compilerOptions: { module: 'ESNext', target: 'ES2020' } }).outputText);
globalThis.window = {
  localStorage: { getItem: () => null },
  viewer: { layerManager: { managedLayers: [{ layer: { dataSources: [{ spec: { url: 'graphene://middleauth+https://cave.test/segmentation/table/t1' } }] } }] } },
};
const { currentPiecesOf } = await import(pathToFileURL(pcgOut).href);

function stubCave({ lineage, l2, rootOf, failSample = false }) {
  const asked = [];
  globalThis.fetch = async (url, opts = {}) => {
    asked.push(url);
    const json = (body) => ({ ok: true, text: async () => body });
    if (url.endsWith('/lineage_graph')) return json(lineage);
    if (url.includes('/lvl2_graph')) {
      if (failSample) return { ok: false, status: 500 };
      const edges = [];
      for (let i = 1; i < l2.length; i++) edges.push(`["${l2[i - 1]}","${l2[i]}"]`);
      return json(`{"edge_graph":[${edges.join(',')}]}`);
    }
    if (url.endsWith('/roots_binary')) {
      assert.equal(opts.headers['Content-Type'], 'application/octet-stream');
      const ids = Array.from(new BigUint64Array(opts.body), v => v.toString());
      return { ok: true, arrayBuffer: async () => new BigUint64Array(ids.map(id => BigInt(rootOf(id)))).buffer };
    }
    throw Error('unexpected ' + url);
  };
  return asked;
}

const OLD = '720575940538342067', NOW = '720575940699999901';
const ELSEWHERE = ['720575940699999902', '720575940699999903', '720575940699999904'];
const MID = '720575940600000001';
// OLD was cut: MID kept most of it and became NOW; three cut bits were each
// merged into another cell.
const lineage = `{"links":[{"source":"${OLD}","target":"${MID}"},${ELSEWHERE.map(e => `{"source":"${OLD}","target":"${e}"}`).join(',')},{"source":"${MID}","target":"${NOW}"}]}`;
// 3000 blocks, so the sample of 2000 is spread out; every tenth is in a cut-off bit.
const l2 = Array.from({ length: 3000 }, (_, i) => String(160000000000000000n + BigInt(i)));
const rootOf = (id) => { const i = Number(BigInt(id) - 160000000000000000n); return i % 10 === 0 ? ELSEWHERE[i % 3] : NOW; };

test('the reported case: just the cell the ID became, not the bits merged elsewhere', async () => {
  const asked = stubCave({ lineage, l2, rootOf });
  assert.deepEqual(await currentPiecesOf(OLD), [NOW]);
  assert.ok(asked.some(u => u === 'https://cave.test/segmentation/api/v1/table/t1/node/' + OLD + '/lvl2_graph?int64_as_str=1'));
  assert.ok(asked.some(u => u === 'https://cave.test/segmentation/api/v1/table/t1/roots_binary'));
});
test('when the sample cannot be had, every live end is given as before', async () => {
  stubCave({ lineage, l2, rootOf, failSample: true });
  const got = await currentPiecesOf(OLD);
  assert.deepEqual([...got].sort(), [NOW, ...ELSEWHERE].sort());
});
test('one live end needs no sample', async () => {
  const asked = stubCave({ lineage: `{"links":[{"source":"${OLD}","target":"${NOW}"}]}`, l2, rootOf });
  assert.deepEqual(await currentPiecesOf(OLD), [NOW]);
  assert.ok(!asked.some(u => u.endsWith('/roots_binary')));
});
