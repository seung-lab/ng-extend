// The "Updating the 3D shape" pill (src/util/mesh_updating.ts), with a fake
// viewer: it shows while 3D pieces load after an edit, and goes once loading
// stops moving, even when a last piece never arrives (Ames 2026-11-20: "is
// this stuck? it's been on 98% for some time").
// Run: node scripts/mesh-updating.test.cjs
const path = require('path');
const esbuild = require('esbuild');

const out = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'util', 'mesh_updating.ts')],
  bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18',
});

function el() {
  const kids = [];
  const node = {
    style: {}, className: '', textContent: '', title: '', offsetWidth: 180,
    classList: { add() {}, remove() {} },
    setAttribute() {}, addEventListener() {}, setPointerCapture() {},
    appendChild(k) { kids.push(k); return k; },
    remove() { node.removed = true; },
    querySelector() { return node._count || (node._count = { textContent: '' }); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400 }; },
  };
  Object.defineProperty(node, 'innerHTML', { set() {}, get() { return ''; } });
  return node;
}
const listeners = {};
const made = [];
global.window = {
  innerWidth: 1400, innerHeight: 900,
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  setInterval: (fn, ms) => setInterval(fn, ms),
};
global.document = {
  hidden: false,
  head: { appendChild() {} },
  body: { appendChild(n) { made.push(n); return n; } },
  createElement() { return el(); },
};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.requestAnimationFrame = fn => setTimeout(fn, 0);
global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };

const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);

let need = 50, have = 10;
const panelEl = el(); panelEl.isConnected = true; panelEl.offsetWidth = 600;
const viewer = {
  layerManager: { managedLayers: [{ visible: true, archived: false, layer: { type: 'segmentation', renderLayers: [{ get layerChunkProgressInfo() { return { numVisibleChunksNeeded: need, numVisibleChunksAvailable: have }; } }] } }] },
  display: { panels: [{ element: panelEl, navigationState: {} }] },
};
mod.exports.startMeshUpdating(viewer);

const live = () => made.filter(n => !n.removed);
const shown = () => live().map(n => n._count && n._count.textContent).find(Boolean) || (live().length ? 'on' : '-');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' : ' + JSON.stringify(info) : ''}`); ok ? pass++ : fail++; };

(async () => {
  // 1. Pieces keep arriving: the pill shows and follows the count, then goes.
  for (const fn of listeners['nge-graph-edit']) fn(new CustomEvent('nge-graph-edit', { detail: { kind: 'merge' } }));
  await sleep(1300);
  check('after an edit with pieces loading, the pill shows its count', shown() === '20%', shown());
  for (have = 20; have <= 50; have += 10) await sleep(500);
  have = 50;
  await sleep(1200);
  check('all pieces in: the pill goes', live().length === 0, shown());

  // 2. Stuck at 98% (one piece never comes): the pill goes within a few seconds.
  need = 50; have = 30;
  for (const fn of listeners['nge-graph-edit']) fn(new CustomEvent('nge-graph-edit', { detail: { kind: 'split' } }));
  await sleep(1200);
  have = 49;
  await sleep(600);
  check('stuck at 98%: the pill shows 98% at first', shown() === '98%', shown());
  let goneIn = 0; for (let t = 0; t < 8000 && live().length; t += 100) { await sleep(100); goneIn = t + 100; }
  check('stuck at 98%: the pill is gone within about 4 s of the count stopping', live().length === 0 && goneIn + 600 <= 4200, { goneIn: goneIn + 600 });

  // 3. Slow but moving: the pill stays as long as the count moves.
  need = 50; have = 5;
  for (const fn of listeners['nge-graph-edit']) fn(new CustomEvent('nge-graph-edit', { detail: { kind: 'merge' } }));
  for (let i = 0; i < 14; i++) { await sleep(500); have += 1; }
  check('slow but still moving after 7 s: the pill stays', live().length === 1, shown());
  have = 50;
  await sleep(1200);
  check('then all in: the pill goes', live().length === 0, shown());

  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
