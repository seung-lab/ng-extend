// Hits Edge on the live MEC image mask: made-up branches at the places three
// real cells taught us about, each with the answer it should give.
//   node suite.mjs <mec_marks.ts> [W STEP EMPTY AGREE reachNm]
import fs from 'node:fs';
import module from 'node:module';
const [file, W, STEP, EMPTY, AGREE, REACH] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8');
const js = module.stripTypeScriptTypes(src.slice(src.indexOf('export const MEC_IMAGE_MASK'))).replace(/^export /gm, '');
const um = v => v * 1000;
// A branch: points from a to b (um), three strands 0.2 um apart.
const branch = (a, b) => { const out = []; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.1);
  for (let i = 0; i <= n; i++) for (const d of [-0.2, 0, 0.2]) out.push(um(a[0] + (b[0] - a[0]) * i / n + d), um(a[1] + (b[1] - a[1]) * i / n), um(a[2] + (b[2] - a[2]) * i / n));
  return out; };
const cases = [
  { name: '#1285 cut at y 2333 (x 2540, z 210)', want: 1, verts: branch([2540, 2200, 210], [2540, 2333.2, 210]) },
  { name: '#1285 area: lines across the holes, ending 10 um from the edge', want: 0,
    verts: [2400, 2480, 2540, 2560, 2620, 2700].flatMap(x => branch([x, 1810, 210], [x, 2300, 210])) },
  { name: '#1290 soma through damaged section 5480', want: 0, verts: branch([2306.6, 2039, 5400 * 0.045], [2306.6, 2039, 5560 * 0.045]) },
  { name: '#1289 near soma through damaged section 8620', want: 0, verts: branch([2405, 2000, 8560 * 0.045], [2405, 2040, 8680 * 0.045]) },
  { name: '#1289 top end, a few um short of the edge (x 2560, y 2325, z 369)', want: 1, verts: branch([2560, 2265, 369], [2560, 2325, 369]) },
  { name: 'ends 14 to 18 um short of the edge', want: 0,
    verts: [...branch([2440, 2246, 342], [2440, 2306, 342]), ...branch([2600, 2258, 396], [2600, 2318, 396])] },
];
const results = [];
for (const c of cases) {
  const fake = `class Uint64 { tryParseString(){ this.low=1; this.high=0; return true; } }
const EDGE_NM = 5000; const mecLayers = () => new Map(); const MEC_EDGE = {};
globalThis.window = { viewer: { layerManager: { managedLayers: [{ layer: { type: 'segmentation', renderLayers: [{ source: {
  chunks: new Map([['1,0', { fragmentIds: ['a'] }]]), getFragmentKey: () => ({ key: 'k' }),
  fragmentSource: { chunks: new Map([['k', { meshData: { vertexPositions: new Float32Array(${JSON.stringify(c.verts)}) } }]]) } } }] } }] } } };`;
  const api = new Function(fake + js + '; return { maskEdgeSpots, EDGE_TUNING };')();
  if (W) Object.assign(api.EDGE_TUNING, { W: +W, STEP: +STEP, EMPTY: +EMPTY, AGREE: +AGREE });
  const r = await api.maskEdgeSpots('1', [400, 447300], REACH ? +REACH : 6000);
  const ok = c.want ? r.spots.length >= 1 : r.spots.length === 0;
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${r.spots.length} ${r.spots.length === 1 ? 'mark' : 'marks'}` + (r.spots.length ? ` at ${r.spots.slice(0, 4).map(p => p.map(v => (v / 1000).toFixed(0)).join(',')).join(' | ')}` : ''));
}
console.log(`${results.filter(Boolean).length} of ${results.length} pass`);
