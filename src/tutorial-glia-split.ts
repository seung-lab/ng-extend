/**
 * Tutorial 16 : Glia Split Training
 * --------------------------------------------------------------
 * How to split two Müller glia the AI fused into one segment, for Stage 2 of
 * the Müller Glia Quest (Ames 2026-11-19: "fused glia usually have multiple
 * points where the meshes are fused - use find path to find origin - could
 * we make a tutorial for this?"). The plan Ames approved ("Go, build it"):
 *   1. glia or neuron: a Müller glia proofread by Nseraf (Ames 2026-11-20:
 *      "give him a shout out if we use this"), then a rod bipolar cell from
 *      the Meet the cells gallery (Ames: "you can also utilize the Retina
 *      cell gallery"; the gallery has no glia of its own). They sit 250
 *      micrometres apart, so each gets its own box;
 *   2. a real fused pair: Find Path from soma A to soma B shows a join;
 *   3. red points on A's side, blue on B's side, and Preview, which colors
 *      the two sides without cutting;
 *   4. what the real quest asks: cut, Find Path again, Check.
 * NOTHING IS EDITED. The pair is a real Retina segment, so sending a cut is
 * turned off while this tutorial is open (window.__ngeNoCutSubmit, read by
 * submitMulticut in third_party/.../graphene/frontend.ts), and the server
 * holds this pair out of the quest (TRAINING_PAIR in functions/muller-glia.js)
 * so it stays fused for every new player. It records only that the tutorial
 * was finished, and gives no Achievement.
 *
 * Started from the Training button in the quest's Stage 2 and the What is a
 * Müller glia box, by `nge:tutorial-start` with id 16 (startGliaSplitTutorial).
 */
import { Step, useTutorialStore } from './store-pyr';
import { findDatasetByCanonical } from './datasets';
import { stopWatching } from './tutorial-3';
import { cutPreviewShowing } from './util/cut_preview';
import { CAST_TYPES } from './data/retina-cast';
import imgMullerGlia from './images/muller-glia.jpg';

export const GLIA_SPLIT_TUTORIAL = 16;

export function startGliaSplitTutorial() {
  document.dispatchEvent(new CustomEvent('nge:tutorial-start', { detail: { id: GLIA_SPLIT_TUTORIAL } }));
}

// ── The cells ────────────────────────────────────────────────────────────
/** A Müller glia proofread by Nseraf (current on 2026-11-20). Its middle
 *  and depth, in voxels, from its level 2 pieces. */
const NSERAF_GLIA = '720575940558455015';
const NSERAF_AT = [39416, 56319, 1150];
/** The rod bipolar cell (RBC) of the Meet the cells gallery. The gallery
 *  stores its soma supervoxel, not a root: its current root is looked up as
 *  the tutorial starts. */
const GALLERY_BC = CAST_TYPES.find(t => t.type === 'RBC')!;
/** Used until the lookup answers (the RBC example's root on 2026-11-20). */
let bipolarRoot = '720575940549637981';
/** Two glia fused into one segment (sheet rows F1929 and F2397), held out of
 *  the quest. Both columns and both end feet are easy to see in 3D. */
export const TRAINING_PAIR = '720575940552463731';
/** Each soma's thickest glia spot near the sheet's point (CloudVolume, 2026-11-20). */
const SOMA_A = [46842, 31747, 2008];
const SOMA_B = [46002, 32215, 1988];

const COLORS = { glia: '#67f5cb', bipolar: '#f5b84a', pair: '#5fb4ff', a: '#ff5c5c', b: '#5c8cff' };
const DIMENSIONS = { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] };
const VOXEL_UM = [0.016, 0.016, 0.040];
/** Turned a quarter about x, seen from the side: high z at the top. */
const VIEW_SIDE = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const SCALE_PER_UM = 95;

const CAVE = 'https://minnie.microns-daf.com/segmentation/api/v1/table/stroeh_mouse_retina';
function caveToken(): string | null {
  try { return JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch { return null; }
}
async function lookUpBipolar() {
  const token = caveToken();
  if (!token) return;
  try {
    const r = await fetch(`${CAVE}/node/${GALLERY_BC.sv}/root?int64_as_str=1`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (j?.root_id) bipolarRoot = String(j.root_id);
  } catch { /* the stored root stays */ }
}
/** Is the training pair still one segment? Someone could cut it in play. */
let pairWhole: boolean | null = null;
async function checkPair() {
  const token = caveToken();
  if (!token) return;
  try {
    const r = await fetch(`${CAVE}/is_latest_roots`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_ids: [TRAINING_PAIR] }),
    });
    const j = await r.json();
    pairWhole = Array.isArray(j?.is_latest) ? !!j.is_latest[0] : null;
  } catch { pairWhole = null; }
}

function retinaLayers(segments: string[], colors: Record<string, string>) {
  const dataset = findDatasetByCanonical('stroeh_mouse_retina');
  return (dataset?.layers ?? []).map((l: any) =>
    typeof l?.type === 'string' && l.type.startsWith('segmentation')
      ? { ...l, segments, segmentColors: colors } : { ...l });
}
/** One cell alone in 3D, seen from the side (high z at the top). */
function sideState(root: string, color: string, position: number[], heightUm: number) {
  return {
    dimensions: DIMENSIONS,
    position,
    crossSectionScale: 1.2,
    projectionScale: heightUm * SCALE_PER_UM * 1.5,
    projectionOrientation: VIEW_SIDE,
    layout: '3d',
    showSlices: false,
    layers: retinaLayers([root], { [root]: color }),
    selection: { visible: false },
  };
}
/** Pyr sets its own 3D zoom after a step's view loads: put ours back a few
 *  times while it settles, unless the player has zoomed in the meantime. */
function holdZoom(scale: number) {
  const step = useTutorialStore().getTutorialStep();
  let last: number | null = null;
  for (const ms of [800, 2000, 4000, 7000, 11000]) setTimeout(() => {
    if (!here(step)) return;
    try {
      const z = viewer().perspectiveNavigationState.zoomFactor;
      if (last !== null && Math.abs(z.value - last) > 1 && Math.abs(z.value - scale) > 1 && ms > 4000) return;
      z.value = scale; last = scale;
    } catch { /* not ready */ }
  }, ms);
}
const GLIA_ZOOM = 72 * SCALE_PER_UM * 1.5;
const gliaState = () => sideState(NSERAF_GLIA, COLORS.glia, NSERAF_AT, 72);
const BIPOLAR_ZOOM = () => (GALLERY_BC.max[2] - GALLERY_BC.min[2]) * SCALE_PER_UM * 1.5;
const bipolarState = () => sideState(bipolarRoot, COLORS.bipolar,
  [0, 1, 2].map(i => (GALLERY_BC.min[i] + GALLERY_BC.max[i]) / 2 / VOXEL_UM[i]), GALLERY_BC.max[2] - GALLERY_BC.min[2]);
/** The fused pair, the 2D view on soma A. */
function pairState() {
  return {
    dimensions: DIMENSIONS,
    position: SOMA_A,
    crossSectionScale: 1.0,
    projectionScale: 9000,
    projectionOrientation: VIEW_SIDE,
    layout: 'xy-3d',
    showSlices: false,
    layers: retinaLayers([TRAINING_PAIR], { [TRAINING_PAIR]: COLORS.pair }),
    selection: { visible: false },
  };
}

// ── The viewer ───────────────────────────────────────────────────────────
const viewer = (): any => (window as any).viewer;
function graphState(): any {
  try {
    const seg = (viewer()?.layerManager?.managedLayers ?? [])
      .find((x: any) => (x.layer?.constructor as any)?.type === 'segmentation');
    return seg?.layer?.graphConnection?.value?.state ?? null;
  } catch { return null; }
}
function goTo(p: number[], zoom = 1.0) {
  try {
    const v = viewer();
    v.navigationState.position.value = Float32Array.from(p);
    if (zoom) v.navigationState.zoomFactor.value = zoom;
  } catch { /* the view stays as it is */ }
}
const here = (step: number) => {
  const s = useTutorialStore();
  return s.activeTutorial === GLIA_SPLIT_TUTORIAL && s.getTutorialStep() === step;
};
/** Leave no points or path behind for real play, and no tool on. */
function clearTools() {
  const gs = graphState();
  try { gs?.multicutState?.reset?.(); } catch { /* */ }
  try { gs?.findPathState?.reset?.(); } catch { /* */ }
  const v = viewer();
  try { v?.globalToolBinder?.activeTool_?.cancel?.(); } catch { /* */ }
  try { v?.toolBinder?.activeTool_?.cancel?.(); } catch { /* */ }
}

// Sending a cut is off while this tutorial is open (see the top of the file).
(window as any).__ngeNoCutSubmit = () => useTutorialStore().activeTutorial === GLIA_SPLIT_TUTORIAL
  && useTutorialStore().getTutorialStep() >= 0
  && useTutorialStore().getTutorialStep() < steps.length
  ? 'Glia Split Training never cuts: this is a real cell. Press Preview to see the cut instead.'
  : '';

document.addEventListener('nge:tutorial-start', (e: Event) => {
  if (Number((e as CustomEvent).detail?.id) !== GLIA_SPLIT_TUTORIAL) return;
  // The Merge or Cut tutorial's checker would write into these boxes.
  stopWatching();
  document.querySelectorAll('.introductionStepAnchor .nge-practice-status, .introductionStepAnchor .nge-practice-helprow').forEach(el => el.remove());
  clearTools();
  void lookUpBipolar();
  void checkPair();
});

// ── Watching the player ──────────────────────────────────────────────────
const note = (kind: 'ok' | 'warn' | '', html: string) => `<div class="nge-hud-note${kind ? ' nge-hud-note--' + kind : ''}">${html}</div>`;
const helpBtn = (what: string, label = 'Help me') => `<button type="button" class="nge-hud-btn nge-hud-btn--sm" data-nge-gs-go="${what}" title="Take me there">${label}</button>`;
const pending = (on: boolean) => { (window as any).__ngeStepPending = on; };

/** While a step shows: read the viewer, write the line, let Next through. */
function watch(read: () => { ok: boolean; html: string }) {
  pending(true);
  const step = useTutorialStore().getTutorialStep();
  let last = '';
  const tick = () => {
    if (!here(step)) { clearInterval(timer); return; }
    const { ok, html } = read();
    if (ok) {
      pending(false);
      document.querySelectorAll('.introductionStep .nge-tut-nudge').forEach(el => el.remove());
    }
    const el = document.querySelector<HTMLElement>('.introductionStep [data-nge-gs-feedback]');
    if (el && html !== last) { el.innerHTML = html; last = html; }
  };
  const timer = setInterval(tick, 400);
  setTimeout(tick, 300);
}

function readPath() {
  if (pairWhole === false) return { ok: true, html: note('warn', 'Someone has already split this pair, so Find Path has no way across. Read on: the steps are the same in the quest.') };
  const fp = graphState()?.findPathState;
  const has = (x: any) => !!x?.value;
  const centroids = fp?.centroids?.value ?? [];
  if (has(fp?.source) && has(fp?.target) && centroids.length) {
    return { ok: true, html: note('ok', `Found it! The white path runs from soma A through the place where the two glia are joined to soma B.`) };
  }
  if (has(fp?.source) && has(fp?.target)) return { ok: false, html: note('', 'Both ends are in. Press <strong>ENTER</strong> to draw the path.') };
  if (has(fp?.source)) return { ok: false, html: note('', `Soma A is marked. Now ${helpBtn('b', 'go to soma B')} and <strong>CTRL+CLICK</strong> on it.`) };
  return { ok: false, html: note('', `Waiting for Find Path. Press <strong>F</strong>, then <strong>CTRL+CLICK</strong> on soma A. Stuck? ${helpBtn('a', 'Go to soma A')}`) };
}
function readPoints() {
  const mc = graphState()?.multicutState;
  const red = mc?.sinks?.size ?? 0, blue = mc?.sources?.size ?? 0;
  if (red && blue) return { ok: true, html: note('ok', `${red} red and ${blue} blue. Both sides are marked.`) };
  if (red) return { ok: false, html: note('', `${red} red. Press <strong>G</strong> for blue, then <strong>CTRL+CLICK</strong> on cell B's side of the join. ${helpBtn('b', 'Go to soma B')}`) };
  if (blue) return { ok: false, html: note('', `${blue} blue. Press <strong>G</strong> for red, then <strong>CTRL+CLICK</strong> on cell A's side of the join. ${helpBtn('a', 'Go to soma A')}`) };
  return { ok: false, html: note('', 'Waiting for your points. Press <strong>C</strong> for Cut Mode, then <strong>CTRL+CLICK</strong> on cell A near the join.') };
}
function readPreview() {
  if (cutPreviewShowing()) return { ok: true, html: note('ok', 'There it is: red is what would stay with cell A, blue what would go with cell B. Nothing was cut.') };
  const mc = graphState()?.multicutState;
  if (!(mc?.sinks?.size && mc?.sources?.size)) return { ok: false, html: note('warn', 'The points are gone. Put a red point on cell A and a blue one on cell B again, then press Preview.') };
  return { ok: false, html: note('', 'Waiting for Preview. Press the <strong>Preview</strong> button on the cut bar at the bottom.') };
}

document.addEventListener('click', (e) => {
  const go = (e.target as HTMLElement | null)?.closest?.('[data-nge-gs-go]') as HTMLElement | null;
  if (!go) return;
  e.preventDefault();
  goTo(go.dataset.ngeGsGo === 'b' ? SOMA_B : SOMA_A, 1.0);
}, true);

// ── The boxes ────────────────────────────────────────────────────────────
const MIDDLE = { element: 'body', x: 0.5, y: 0.5 };
const OVER_3D = { element: '.neuroglancer-rendered-data-panel.nge-3d-panel', x: 0.5, y: 0.03 };
const BOX_W = '400px';
/** Beside a lone cell in the middle of the 3D view, not over it. */
const RIGHT = { element: 'body', x: 0.8, y: 0.12 };
const chip = (name: string, color: string) => `<span class="nge-hud-chip" style="border-color:${color};color:${color}">${name}</span>`;
const GLIA = chip('Müller glia', COLORS.glia), BC = chip('Bipolar cell', COLORS.bipolar);
const A = `<span class="nge-hud-chip nge-cq-go" data-nge-gs-go="a" title="Go to soma A" style="border-color:${COLORS.a};color:${COLORS.a}">Soma A</span>`;
const B = `<span class="nge-hud-chip nge-cq-go" data-nge-gs-go="b" title="Go to soma B" style="border-color:${COLORS.b};color:${COLORS.b}">Soma B</span>`;

export const steps: Step[] = [
  {
    part: 'Glia or neuron',
    title: 'Glia Split Training',
    image: imgMullerGlia,
    modal: true,
    position: MIDDLE,
    width: '560px',
    text: `The AI sometimes fuses two **Müller glia** into one segment. In Stage 2 of the Müller Glia Quest you split them apart.

This training shows you how on a real fused pair, but **nothing you do here is sent**: you practice every step and see the result without cutting. It takes about five minutes.`,
    nextLabel: 'Start',
  },
  {
    part: 'Glia or neuron',
    title: 'A Müller glia',
    get state() { return gliaState(); },
    position: RIGHT,
    width: BOX_W,
    html: `This ${GLIA} was proofread by <strong>Nseraf</strong>. Thank you, Nseraf!
<ul>
<li>It is a thick, bushy <strong>column</strong> spanning the whole depth of the retina.</li>
<li>Its wide <strong>end foot</strong> sits at the bottom, against the inner surface.</li>
<li>Fine, lacy side branches fill the space around the neurons.</li>
</ul>
<p>Drag to turn it. Fused glia look like two of these columns in one color.</p>`,
    onEnter() { holdZoom(GLIA_ZOOM); },
  } as Step,
  {
    part: 'Glia or neuron',
    title: 'A neuron, for comparison',
    get state() { return bipolarState(); },
    position: RIGHT,
    width: BOX_W,
    html: `This is a rod ${BC} (RBC) from the <strong>Meet the cells</strong> gallery. It also stands upright, but it is thin and tidy: a few neat dendrites at the top and one axon that ends in a single layer.
<p>No end foot, no lacy column. If a cell looks like this, it is a neuron, not a glia.</p>`,
    onEnter() { holdZoom(BIPOLAR_ZOOM()); },
  } as Step,
  {
    part: 'Find the join',
    title: 'Two glia, one segment',
    get state() { return pairState(); },
    position: OVER_3D,
    width: BOX_W,
    html: `This segment is two Müller glia. In 3D you can see <strong>two columns</strong> and <strong>two end feet</strong>, joined near the top.
<p>Each glia has its own soma: ${A} and ${B}. Click one to go there in the 2D view.</p>
<p>Fused glia usually join in <strong>more than one place</strong>, and the joins are hard to spot by eye. Find Path finds them for you.</p>`,
  } as Step,
  {
    part: 'Find the join',
    title: 'Find Path from A to B',
    position: OVER_3D,
    width: BOX_W,
    html: `<p>Press <strong>F</strong> for Find Path. <strong>CTRL+CLICK</strong> on ${A}, then on ${B}, and press <strong>ENTER</strong>.</p>
<p>The path has to cross from one glia into the other somewhere: that crossing is a join.</p>
<div data-nge-gs-feedback></div>`,
    onEnter() { goTo(SOMA_A, 1.0); watch(readPath); },
  },
  {
    part: 'Find the join',
    title: 'Follow the path',
    position: OVER_3D,
    width: BOX_W,
    html: `Turn the 3D view and follow the white path from ${A}. Where it leaves one column and enters the other is the join.
<p>Zoom in there in 2D (<strong>CTRL</strong> and the mouse wheel). The two glia touch, and the AI joined them through the contact.</p>`,
  },
  {
    part: 'Practice the cut',
    title: 'Red on A, blue on B',
    position: OVER_3D,
    width: BOX_W,
    html: `<p>Press <strong>C</strong> for Cut Mode. <strong>CTRL+CLICK</strong> 2 or 3 <strong style="color:${COLORS.a}">red</strong> points on cell A's side of the join. Press <strong>G</strong>, then put 2 or 3 <strong style="color:${COLORS.b}">blue</strong> points on cell B's side.</p>
<p>Keep the points near the join but not on it, and on each cell's own branch.</p>
<div data-nge-gs-feedback></div>`,
    onEnter() { watch(readPoints); },
  },
  {
    part: 'Practice the cut',
    title: 'Preview, not cut',
    position: OVER_3D,
    width: BOX_W,
    html: `<p>Press <strong>Preview</strong> on the cut bar. Pyr asks the server what the cut <em>would</em> do and colors the cell in 3D without changing it.</p>
<p>In training, Submit is turned off: this is a real cell.</p>
<div data-nge-gs-feedback></div>`,
    onEnter() { watch(readPreview); },
  },
  {
    part: 'Practice the cut',
    title: 'More than one join',
    position: OVER_3D,
    width: BOX_W,
    html: `Look at the colors. If some of cell B's column is still red, or A's is blue, the two glia are joined somewhere else too.
<p>That is why the quest says: after each cut, <strong>run Find Path again</strong>. If a path still crosses from A to B, there is another join. Cut it the same way, and repeat until no path is left.</p>`,
  },
  {
    part: 'Practice the cut',
    title: 'In the real quest',
    position: MIDDLE,
    modal: true,
    width: '520px',
    html: `<ol>
<li>Open a merged pair in Stage 2 and visit each soma with <strong>Cell A</strong> and <strong>Cell B</strong>.</li>
<li><strong>Find Path</strong> from soma A to soma B to find a join.</li>
<li><strong>Cut</strong> there: red on A's side, blue on B's side. Preview first if you are unsure.</li>
<li>Find Path again. Repeat until no path is left.</li>
<li>Press <strong>Check</strong>. Pyr asks the server which cell each soma is in now.</li>
</ol>
<p>Your cuts in the quest are real edits, so take your time.</p>`,
    onEnter: clearTools,
    nextLabel: 'Open Müller Glia Quest',
    notNowLabel: 'Not now',
  },
];
