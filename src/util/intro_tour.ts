/**
 * The new player intro (Ames 2026-11-07), after the Starship lands on the
 * Sandbox cell: a "transmission received" panel at the bottom walks through
 * the cell, with hologram callouts on its parts (the look of Ames's render:
 * a thin line from the part to a glassy panel).
 *
 *   1 Welcome to Pyr       2 This is a neuron     3 Soma
 *   4 Dendrites            5 Axon (the ship flies along it)
 *   6 Synapse (its partner cell fades in)
 *   7 A neighbor's axon (a cell that synapses onto this one)
 *   8 Action potential (a spark runs down the axon)
 *   9 The connectome, and Start mapping
 *
 * The parts glow by the mesh tint Highlight mode uses (nge_tint.ts), from a
 * map of the cell's parts worked out from its skeleton and its real
 * synapses (static/intro/sandbox-tour.json). Any Highlight tint the player
 * had is put back when the tour ends.
 *
 * Test sites only for now: it plays for a pretend new player (Intro test
 * panel), or with ?starship in the address, or from the rocket.
 */
import {watch} from 'vue';
import {getNgeMeshTint, setNgeMeshTint, setNgeReveal, type NgeMeshTint} from 'neuroglancer/mesh/nge_tint';
import {setNgeGlow, type NgeGlow} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {makeLayer} from 'neuroglancer/layer';
import {getObjectKey} from 'neuroglancer/segmentation_display_state/base';
/** The Sandbox pyramidal cell: the colors land on it alone. */
const CELL_KEY = getObjectKey(Uint64.parseString('648518346355727683'));
import {cameraAxes, cellDrawn, clearStarship, dockStarship, oneBoundingBox, starshipEta, flyStarship, loadAssets, setHoverHighlight, setStarshipCameraHeld, startIdleTurn, starshipAt, starshipHop, starshipMoving, starshipCruise, undockStarship} from './starship';
import {setStatedColor} from '../widgets/widget_utils';
import starshipIcon from '../images/starship-icon.png';
import {IS_LIVE_SITE, simulating} from './toolbar_staging';
import {findDatasetBySegName, switchToDataset} from '../datasets';
import {useTutorialStore} from '../store-pyr';
import {useProofreadingBackendStore} from '../store';

type V3 = [number, number, number];
interface Tour {
  segment: string;
  grid: {origin: V3; cell: number; dims: V3; rle: number[]};
  anchors: Record<'soma' | 'dendrite' | 'axon' | 'synapse' | 'presyn' | 'synapse2', V3>;
  syn2Partner: string; syn2Flight: number[][];
  synapsePartner: string; presynPartner: string; presynSynapses: number;
  incomingSynapses: number; outgoingSynapses: number;
  axonFlight: number[][]; axonPath: number[][]; dendFlight: number[][];
  apIn: number[][]; apDend: number[][]; apOut: number[][]; apAxon: number[][]; apNext?: number[][];
  synIn: number[]; synOut: number[]; synUnit: number;
}

/* ── the words ── */
interface Beat {
  key: string;
  header?: string;           // the panel's own title
  callout?: {anchor: keyof Tour['anchors']; title: string; stats?: [string, string][]};
  body: string;
  next?: string;
  part?: 1 | 2 | 3;          // soma, dendrite, axon glows
  view: {at: keyof Tour['anchors'] | 'cell' | 'dendView'; nm: number};
}
const BEATS: Beat[] = [
  {key: 'welcome', header: 'Welcome to Pyr!', view: {at: 'soma', nm: 30_000}, next: "Let's go",
    body: "Pyr (pronounced “peer”) is a game from Princeton University that invites citizen scientists to map the brain. Players come from all walks of life. People like you are helping to advance neuroscience by mapping real neurons, like this one. Want to look around?"},
  {key: 'neuron', header: 'This is a neuron', view: {at: 'cell', nm: 200_000},
    callout: {anchor: 'soma', title: 'Pyramidal neuron', stats: [['Class', 'Excitatory'], ['Neurotransmitter', 'Glutamate'],
      ['Location', 'Visual cortex, mouse brain'], ['Branch length', 'about 4.5 mm'], ['Input', '3,386 synapses'], ['Output', '59 synapses']]},
    body: 'Neurons are the most famous cells of the brain. Yours has about 86 billion of them, in thousands of varieties, and they all share the same basic parts.'},
  {key: 'soma', callout: {anchor: 'soma', title: 'Soma', stats: [['Contains', 'nucleus, organelles'], ['Size', 'about 20 µm across'], ['For scale', 'a fifth the width of a human hair']]}, part: 1, view: {at: 'soma', nm: 45_000},
    body: 'The cell body. It holds the nucleus and keeps the whole cell alive.'},
  {key: 'dendrites', callout: {anchor: 'dendrite', title: 'Dendrites', stats: [['Input', '3,297 synapses']]}, part: 2, view: {at: 'dendView', nm: 185_000},
    body: 'The branches that listen. They gather signals from other neurons.'},
  {key: 'axon', callout: {anchor: 'axon', title: 'Axon', stats: [['Width', 'about 0.4 µm'], ['Outputs', '59 synapses']]}, part: 3, view: {at: 'axon', nm: 160_000},
    body: "The {axon:axon}, shown in blue, is the neuron's long, thin cable. It carries the cell's own signal out to other cells."},
  {key: 'synapse', part: 3, header: 'Synapse', view: {at: 'synapse', nm: 40_000},
    body: 'The connection where two neurons meet and communicate. Signals always travel one way, from an axon to a dendrite: a cell listens with its dendrites and sends with its axon. Here our {axon:axon} passes its signal to {down:the dendrite of a downstream cell}.'},
  {key: 'allsyn', header: 'All its synapses', view: {at: 'cell', nm: 230_000},
    body: 'Each dot is a synapse. This cell receives {in:3,386 connections} from upstream cells, and the axon contained in this volume has {out:59 outgoing connections}.'},
  {key: 'synapse2', header: 'Signals come in', part: 2, view: {at: 'synapse2', nm: 30_000},
    body: 'Out here near the tip of a {dendrite:dendrite}, {nbr:another neuron\u2019s axon} passes its signal in at a **synapse**, the glow. Thousands of inputs like this one add up, and when enough arrive together, the cell fires.'},
  {key: 'spike', header: 'Action potential', part: 3, view: {at: 'cell', nm: 220_000},
    body: 'Signals run in to the {cellbody:soma}. When enough arrive, the cell fires a quick electric pulse out its {axon:axon} to {down:the next cell}. It lasts about 1 ms (a blink takes 300 times longer) and can travel 220 mph. Here it is slowed down 5,000 times.'},
  {key: 'connectome', header: 'Connectome', view: {at: 'cell', nm: 340_000},
    body: 'A wiring diagram of the brain that includes all the cells and all the synapses is called a **connectome**. With it, scientists can follow how signals flow, to learn how we see, remember and think, and what goes wrong in brain disorders. This map doesn’t exist for a mammalian brain yet, but we’re getting closer thanks to people like you playing Pyr.'},
];

/* ── colours (cell blue, parts as in the labelled picture) ── */
const PART_RGB: Record<number, V3> = {1: [255, 205, 80], 2: [132, 84, 255], 3: [94, 200, 255]};   // axons blue (Ames): ours sky blue
const SYN2_COLOR = 0x2f6bff;    // the neighbor whose axon feeds the far dendrite, a deeper blue (axons are blue)
const PARTNER_COLOR = 0xffa64d;   // the synapse's partner, orange
const packed = (hex: number) => ((hex >> 16) & 0xff) | (hex & 0xff00) | ((hex & 0xff) << 16);

const viewerNow = (): any => (window as any).viewer;
function nmPerUnit(): V3 | null {
  const s = viewerNow()?.coordinateSpace?.value?.scales;
  return s && s.length >= 3 ? [0, 1, 2].map(i => (Number(s[i]) || 1e-9) * 1e9) as V3 : null;
}

let tour: Tour | null = null;
let labels: Uint8Array | null = null;
async function loadTour() {
  if (tour) return;
  const res = await fetch('intro/sandbox-tour.json');
  if (!res.ok) throw new Error(`tour ${res.status}`);
  tour = await res.json();
  const g = tour!.grid, n = g.dims[0] * g.dims[1] * g.dims[2];
  labels = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < g.rle.length; i += 2) { const v = g.rle[i], k = g.rle[i + 1]; if (v) labels.fill(v, o, o + k); o += k; }
}

/** The tint for one beat: the part being shown glows, parts already met are
 *  a softer shade of their colour. */
let somaDist: Float32Array | null = null;
let somaListens = false;
/** Each grid cell's distance from the soma (nm), for the reveal. */
function distances(): Float32Array | null {
  if (somaDist) return somaDist;
  if (!tour || !labels) return null;
  const g = tour.grid, [dx, dy] = g.dims, c = tour.anchors.soma, d = new Float32Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const x = i % dx, y = Math.floor(i / dx) % dy, z = Math.floor(i / (dx * dy));
    d[i] = Math.hypot(g.origin[0] + (x + 0.5) * g.cell - c[0], g.origin[1] + (y + 0.5) * g.cell - c[1], g.origin[2] + (z + 0.5) * g.cell - c[2]);
  }
  return somaDist = d;
}
let tintRaf = 0;
/** The part colours in from the soma outward (Ames), the parts met before
 *  staying as they are. */
function revealTint(shown: Set<number>, glowing?: number, ms = 1600) {
  cancelAnimationFrame(tintRaf);
  const d = distances();
  if (!glowing || shown.has(glowing) || !d || !labels) { setNgeMeshTint(partsTint(shown, glowing)); return; }
  let far = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === glowing && d[i] > far) far = d[i];
  const t0 = performance.now();
  let lastPut = 0;
  const step = (now: number) => {
    const q = Math.min(1, (now - t0) / ms);
    if (q >= 1 || now - lastPut > 60) {
      lastPut = now;
      setNgeMeshTint(partsTint(shown, glowing, far * (1 - Math.pow(1 - q, 2)) + 1));
      try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    }
    if (q < 1) tintRaf = requestAnimationFrame(step);
  };
  tintRaf = requestAnimationFrame(step);
}
function partsTint(shown: Set<number>, glowing?: number, reach = Infinity): NgeMeshTint | null {
  const nm = nmPerUnit();
  if (!tour || !labels || !nm || (!shown.size && !glowing)) return null;
  const g = tour.grid, n = labels.length, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = labels[i];
    if (!p || (!shown.has(p) && p !== glowing)) continue;
    if (p === glowing && !shown.has(p) && somaDist && somaDist[i] > reach) continue;
    const rgb = PART_RGB[p === 1 && somaListens ? 2 : p], a = 1, k = 1;
    data[i * 4] = Math.round(rgb[0] * k * a); data[i * 4 + 1] = Math.round(rgb[1] * k * a); data[i * 4 + 2] = Math.round(rgb[2] * k * a);
    data[i * 4 + 3] = Math.round(a * 255);
  }
  const m = mat4.create();
  for (let i = 0; i < 3; i++) { m[i * 5] = nm[i] / (g.dims[i] * g.cell); m[12 + i] = -g.origin[i] / (g.dims[i] * g.cell); }
  return {data, dims: g.dims, gridFromGlobal: m, only: CELL_KEY};
}

/* ── camera ── */
let camRaf = 0;
/** How long a glide from where the camera is to here takes (ms): never
 *  quick (Ames), longer the farther it goes, in distance or in zoom. */
function glideMs(center: V3, viewNm: number, ms = 1600): number {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return ms;
  const unit = Math.min(nm[0], nm[1], nm[2]);
  const p0 = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
  const s0 = v.projectionScale.value, s1 = viewNm / unit;
  const span = Math.hypot(center[0] - p0[0], center[1] - p0[1], center[2] - p0[2]) / Math.max(viewNm, s0 * unit);
  return Math.min(6500, Math.max(ms, 2600 + 900 * Math.abs(Math.log(s1 / s0)) + 1400 * Math.min(2, span)));
}
/** Until when the camera is (or is about to be) on the move: holograms wait. */
let camBusyUntil = 0;
function moveCamera(center: V3, viewNm: number, ms = 1600) {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return;
  cancelAnimationFrame(camRaf);
  // a parked ship rides along with the camera: its engines show it (Ames)
  starshipCruise(ms);
  camBusyUntil = performance.now() + ms;
  const unit = Math.min(nm[0], nm[1], nm[2]);
  const p0 = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
  const s0 = v.projectionScale.value, s1 = viewNm / unit;
  ms = glideMs(center, viewNm, ms);
  const t0 = performance.now();
  const step = (now: number) => {
    const q = Math.min(1, (now - t0) / ms), e = 0.5 - 0.5 * Math.cos(Math.PI * q);
    v.navigationState.position.value = Float32Array.from([0, 1, 2].map(i => (p0[i] + (center[i] - p0[i]) * e) / nm[i]));
    v.projectionScale.value = s0 * Math.pow(s1 / s0, e);
    if (q < 1) camRaf = requestAnimationFrame(step);
  };
  camRaf = requestAnimationFrame(step);
}
/** The 3D view's panel. */
function threeDPanel(): any {
  for (const pn of viewerNow()?.display?.panels ?? []) if (pn?.element?.classList?.contains('nge-3d-panel')) return pn;
  return null;
}
/** Where to put the camera so the subject sits in the middle of the open
 *  space above the transmission panel, not behind it (Ames: on a phone the
 *  neuron should be centred in the top two thirds). */
function framed(at: V3, viewNm: number): V3 {
  const nm = nmPerUnit(), pe = threeDPanel()?.element as HTMLElement | undefined;
  const cam = nm && cameraAxes(nm);
  // the tour's panel, or in MICrONS its card (Ames: "the cell is behind the box")
  const box = panel ?? [...document.querySelectorAll<HTMLElement>('section.nge-intro')].find(e => !e.classList.contains('nge-intro--out'));
  if (!cam || !pe || !box) return at;
  const r = pe.getBoundingClientRect();
  if (r.height < 50) return at;
  const bottom = Math.min(r.bottom, box.offsetTop - 10);
  const px = (r.top + bottom) / 2 - (r.top + r.bottom) / 2;   // negative: above the middle
  const k = px * viewNm / r.height;
  return [0, 1, 2].map(i => at[i] + cam.up[i] * k) as V3;
}
/** The camera onto a MICrONS view, in the space above the card, once the
 *  card has its new size; zoomed out to suit that smaller space. */
function frameAboveCard(at: V3, viewNm: number, ms: number) {
  setTimeout(() => {
    const pe = threeDPanel()?.element as HTMLElement | undefined;
    const box = [...document.querySelectorAll<HTMLElement>('section.nge-intro')].find(e => !e.classList.contains('nge-intro--out'));
    const r = pe?.getBoundingClientRect();
    const room = r && box ? Math.max(0.35, Math.min(1, (box.offsetTop - 10 - r.top) / r.height)) : 1;
    const nmWide = viewNm / Math.pow(room, 0.6);
    moveCamera(framed(at, nmWide), nmWide, ms);
  }, 80);
}
function cellCenter(t: Tour): V3 {
  const g = t.grid;
  return [0, 1, 2].map(i => g.origin[i] + g.dims[i] * g.cell * 0.45) as V3;
}

/** A spot just above the synapse as the camera will see it there, so the
 *  ship hovers over it rather than in front of it (Ames). */
function aboveSynapse(t: Tour, viewNm: number): number[] {
  const nm = nmPerUnit(), cam = nm && cameraAxes(nm);
  const up = cam ? cam.up : [0, -1, 0];
  const k = Math.max(5000, viewNm * 0.22);
  return t.anchors.synapse.map((v, i) => v + up[i] * k + (cam ? cam.toEye[i] * 7000 : 0));
}

/** A cell drawn out from a point (nm) with a bright growing edge. */
let growRaf = 0;
function growPartner(id: string, at: number[]) {
  const nm = nmPerUnit();
  if (!nm) return;
  cancelAnimationFrame(growRaf);
  const only = getObjectKey(Uint64.parseString(id));
  const center: [number, number, number] = [at[0] / nm[0], at[1] / nm[1], at[2] / nm[2]];
  const t0 = performance.now(), MS = 2600, FAR = 260_000;
  setNgeReveal({only, center, radiusNm: 0, edgeNm: 5000});
  const step = (now: number) => {
    const q = Math.min(1, (now - t0 - 500) / MS), e = q <= 0 ? 0 : 1 - Math.pow(1 - q, 2.2);
    setNgeReveal({only, center, radiusNm: 1500 + FAR * e, edgeNm: 5000 + 8000 * e});
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    if (q < 1) growRaf = requestAnimationFrame(step); else setNgeReveal(null);
  };
  growRaf = requestAnimationFrame(step);
}

/* ── partner cells ── */
function sandboxLayer(): any {
  return (viewerNow()?.layerManager?.managedLayers ?? []).find((m: any) => !m?.archived &&
    String(m?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/pinky_nf') && m.layer?.displayState?.segmentationGroupState?.value?.visibleSegments);
}
const added: string[] = [];
function showCell(id: string, color: number) {
  const ml = sandboxLayer();
  if (!ml) return;
  try {
    const seg = Uint64.parseString(id);
    const vis = ml.layer.displayState.segmentationGroupState.value.visibleSegments;
    if (!vis.has(seg)) { vis.add(seg); added.push(id); }
    setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, seg, packed(color));
  } catch (e) { console.warn('[intro] could not show', id, e); }
}

function hideCell(id: string) {
  const k = added.indexOf(id), ml = sandboxLayer();
  if (k < 0 || !ml) return;
  try { ml.layer.displayState.segmentationGroupState.value.visibleSegments.delete(Uint64.parseString(id)); added.splice(k, 1); }
  catch (e) { console.warn('[intro] could not hide', id, e); }
}

/** Cells with their somas in the Sandbox volume (the cell library's,
 *  Ames 2026-11-09: "load more cells here so the volume looks more full").
 *  For the connectome step they arrive one after another, in quiet colors so
 *  our cell still stands out. */
const VOLUME_CELLS = [
  '648518346352507922', '648518346355322263', '648518346354165433', '648518346350877093',
  '648518346350988923', '648518346350640640', '648518346351215569', '648518346352237675',
  '648518346350824006', '648518346351633806', '648518346352427106', '648518346351101005',
  '648518346351592104', '648518346351351729', '648518346351358001', '648518346350422378',
  '648518346352305197', '648518346353288383', '648518346352102495', '648518346352001726',
  '648518346353842757', '648518346350456854', '648518346354881654', '648518346352732923',
  '648518346352663201', '648518346351571908', '648518346351443744', '648518346352663969',
  '648518346353109430', '648518346353487295', '648518346353362973', '648518346352484298',
  '648518346351955836', '648518346355028388', '648518346352907351', '648518346354796198',
  '648518346351683171', '648518346351955068', '648518346351320490', '648518346353297649',
  '648518346352484042', '648518346351104593', '648518346351129042', '648518346352616414',
  '648518346352244989', '648518346351984062', '648518346353708822', '648518346353209786',
  '648518346351964146', '648518346351983706', '648518346352737559', '648518346353863286',
  '648518346354547062', '648518346356482371', '648518346354880630', '648518346353298623',
  '648518346353614270', '648518346354828966', '648518346352663457', '648518346351955324',
  '648518346352170608',
];
// vibrant, every one its own (Ames: "just make them have vibrant colors!")
const VOLUME_TINTS = [0xff4f8b, 0x3fd6ff, 0x7dff5a, 0xffc53d, 0xb86bff, 0xff7a3d, 0x3dffc4, 0xff5ff2, 0x5a8bff, 0xd4ff3d, 0xff3d5a, 0x3dff7d];
let crowdTimer = 0;
function fillVolume() {
  clearTimeout(crowdTimer);
  let k = 0;
  const next = () => {
    if (!active || k >= VOLUME_CELLS.length) return;
    showCell(VOLUME_CELLS[k], VOLUME_TINTS[k % VOLUME_TINTS.length]);
    k++;
    crowdTimer = window.setTimeout(next, 260);
  };
  crowdTimer = window.setTimeout(next, 900);
}
function emptyVolume() {
  clearTimeout(crowdTimer);
  for (const id of VOLUME_CELLS) hideCell(id);
}

/* ── every synapse on the cell, twinkling in ── */
let synRaf = 0;
function runAllSynapses(t: {synIn: number[]; synOut: number[]; synUnit: number}, scale = 1, alpha = 1, scanH?: () => number) {
  const nm = nmPerUnit();
  if (!nm || !t.synIn) return;
  const nIn = t.synIn.length / 3, nOut = t.synOut.length / 3, n = nIn + nOut;
  const glow: NgeGlow = {positions: new Float32Array(n * 3), colors: new Float32Array(n * 4), sizesNm: new Float32Array(n), count: n, nmRight: [1 / nm[0], 0, 0]};
  const delay = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const src = j < nIn ? t.synIn : t.synOut, k = (j < nIn ? j : j - nIn) * 3;
    for (let a = 0; a < 3; a++) glow.positions[j * 3 + a] = src[k + a] * t.synUnit / nm[a];
    delay[j] = scanH ? Infinity : Math.random() * 1.6;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const sec = (now - t0) / 1000;
    if (scanH) {
      // shown as the scan passes them: height is -y, up toward the surface
      const h = scanH();
      // only once the bar is past them (Ames: none before the bar)
      for (let j = 0; j < n; j++) if (delay[j] === Infinity && -(glow.positions[j * 3 + 1] * nm[1]) <= h - 6000) delay[j] = sec;
    }
    // dots a steady size on screen: zoomed in they stay dots, not blooms (Ames)
    let zk = 1;
    try {
      const Hn = viewerNow().projectionScale.value * Math.min(nm[0], nm[1], nm[2]);
      // between a steady size in the scene and a steady size on screen: far
      // out they no longer blanket the cell, up close they stay bright dots
      // on the spines (Ames)
      zk = Math.max(0.25, Math.min(1.4, Math.sqrt(Hn / (scale > 1.5 ? 1_000_000 : 230_000))));
      // a little bigger on a phone's small screen (Ames: "hard to see on phone")
      if (isPhone()) zk *= 1.4;
    } catch { /* full size */ }
    for (let j = 0; j < n; j++) {
      const on = Math.min(1, Math.max(0, (sec - delay[j]) / 0.35));
      if (j < nIn) glow.colors.set([1, 0.86, 0.45, on * alpha], j * 4);
      else glow.colors.set([1, 0.36, 0.86, on * alpha], j * 4);
      glow.sizesNm[j] = zk * scale * (j < nIn ? 1700 : 3200) * (1 + 0.6 * Math.max(0, 1 - Math.abs(sec - delay[j] - 0.2) * 4));
    }
    const cam = cameraAxes(nm);
    if (cam) glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
    setNgeGlow(glow, 'intro-syn');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    synRaf = requestAnimationFrame(step);
  };
  synRaf = requestAnimationFrame(step);
}
function stopAllSynapses() { cancelAnimationFrame(synRaf); setNgeGlow(null, 'intro-syn'); }

/* ── the action potential spark ── */
let sparkRaf = 0;
/** Send one more action potential, on top of any already running. */
let sparkFire: (() => void) | null = null;
function runSpark(t: Tour) {
  const nm = nmPerUnit();
  if (!nm || !t.apDend || !t.apAxon) return;
  type Leg = {path: V3[]; cum: number[]; ms: number; rgb: [number, number, number]; size: number};
  const leg = (path: number[][], ms: number, rgb: [number, number, number], size: number): Leg => {
    const P = path as V3[], cum = [0];
    for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1], P[k][2] - P[k - 1][2]));
    return {path: P, cum, ms, rgb, size};
  };
  const legIn = leg(t.apIn, 1100, [0.55, 0.7, 1], 2600), legD = leg(t.apDend, 3200, [0.8, 0.7, 1], 3600);
  const legN = leg(t.apNext ?? [t.anchors.synapse], 2200, [1, 0.7, 0.35], 3200);
  const along = (L: Leg, s: number): V3 => {
    const tot = L.cum[L.cum.length - 1]; s = Math.max(0, Math.min(tot, s));
    let k = 1; while (k < L.cum.length - 1 && L.cum[k] < s) k++;
    const q = (s - L.cum[k - 1]) / ((L.cum[k] - L.cum[k - 1]) || 1);
    return [0, 1, 2].map(j => L.path[k - 1][j] + (L.path[k][j] - L.path[k - 1][j]) * q) as V3;
  };
  // the axon as a tree: every point with its distance from the soma; the
  // pulse is a front running out along all of them at once
  const AX = t.apAxon, NA = AX.length;
  let far = 0;
  for (const q of AX) far = Math.max(far, q[3]);
  const s1 = t.anchors.synapse;
  let dSyn = 0, best = Infinity;
  for (const q of AX) { const d = Math.hypot(q[0] - s1[0], q[1] - s1[1], q[2] - s1[2]); if (d < best) { best = d; dSyn = q[3]; } }
  const AX_MS = 3400, speed = far / AX_MS, TRAIL_NM = 7000;
  const MAX = 9000;
  const glow: NgeGlow = {positions: new Float32Array(MAX * 3), colors: new Float32Array(MAX * 4), sizesNm: new Float32Array(MAX), count: 0, nmRight: [1 / nm[0], 0, 0]};
  const T_IN = legIn.ms, T_D0 = T_IN + 250, T_D1 = T_D0 + legD.ms, T_O0 = T_D1 + 1300, T_O1 = T_O0 + AX_MS;
  const T_N0 = T_O0 + dSyn / speed + 250, T_N1 = T_N0 + legN.ms, PERIOD = Math.max(T_O1, T_N1) + 2400;
  const soma = t.anchors.soma, syn2 = t.anchors.synapse2;
  const t0 = performance.now();
  // (each tap of the lightning key adds one, Ames: "send multiple at a time")
  const extra: number[] = [];
  sparkFire = () => { if (extra.length < 8) extra.push(performance.now()); };
  let n = 0;
  const put = (p: number[], rgb: number[], a: number, size: number) => {
      if (a <= 0.01 || n >= MAX) return;
      glow.positions.set([p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]], n * 3);
      glow.colors.set([rgb[0], rgb[1], rgb[2], Math.min(1, a)], n * 4);
      glow.sizesNm[n] = size; n++;
    };
  const draw = (ms: number) => {
    const run = (L: Leg, q: number) => {
      const tot = L.cum[L.cum.length - 1], TRAIL = 16;
      for (let j = 0; j < TRAIL; j++) {
        const s = q * tot - j * tot * 0.012;
        if (s < 0 || q > 1.05) continue;
        const fade = Math.pow(1 - j / TRAIL, 1.5);
        put(along(L, s), j === 0 ? [1, 1, 1] : L.rgb, fade, j === 0 ? L.size * 1.5 : L.size * (1 - j / TRAIL) + 900);
      }
    };
    const pulse = (k: number) => Math.sin(Math.PI * Math.max(0, Math.min(1, k)));
    if (ms < T_IN) run(legIn, ms / T_IN);
    const f2 = pulse((ms - T_IN + 200) / 700);
    put(syn2, [1, 0.86, 0.45], f2, 7000); put(syn2, [1, 1, 1], f2, 2500);
    if (ms >= T_D0 && ms < T_D1 + 200) run(legD, (ms - T_D0) / legD.ms);
    // the soma gathers it in and fires: a bloom you can see from afar
    const fb = pulse((ms - T_D1 + 100) / 1500);
    put(soma, [1, 0.75, 0.25], 0.55 * fb, 95000 * (0.6 + 0.4 * fb));
    put(soma, [1, 0.88, 0.5], 0.85 * fb, 48000);
    put(soma, [1, 1, 0.92], fb, 18000);
    // out along every branch of the axon at once
    if (ms >= T_O0 && ms < T_O1 + 600) {
      const front = (ms - T_O0) * speed;
      for (let k = 0; k < NA; k += 2) {
        const q = AX[k], behind = front - q[3];
        if (behind < 0 || behind > TRAIL_NM) continue;
        const f = 1 - behind / TRAIL_NM;
        put(q, behind < 900 ? [1, 1, 1] : [0.55, 0.88, 1], f * f, behind < 900 ? 3400 : 2400 * f + 800);
      }
    }
    // across the first synapse, and on into the next cell
    const f1 = pulse((ms - T_N0 + 250) / 700);
    put(s1, [1, 0.5, 0.9], f1, 8000); put(s1, [1, 1, 1], f1, 2800);
    if (ms >= T_N0 && ms < T_N1 + 200) run(legN, (ms - T_N0) / legN.ms);
  };
  const step = (now: number) => {
    n = 0;
    draw((now - t0) % PERIOD);
    for (let k = extra.length - 1; k >= 0; k--) {
      const ms = now - extra[k];
      if (ms > PERIOD) extra.splice(k, 1); else draw(ms);
    }
    glow.count = n;
    const cam = cameraAxes(nm);
    if (cam) glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
    setNgeGlow(n ? glow : null, 'intro-spark');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    sparkRaf = requestAnimationFrame(step);
  };
  sparkRaf = requestAnimationFrame(step);
}
function stopSpark() { cancelAnimationFrame(sparkRaf); sparkFire = null; setNgeGlow(null, 'intro-spark'); }

/* ── the synapse marker: a soft pulse ── */
let pulseRaf = 0;
function runPulse(at: V3, rgb: [number, number, number] = [0.6, 0.88, 1]) {
  const nm = nmPerUnit();
  if (!nm) return;
  const glow: NgeGlow = {positions: Float32Array.from([at[0] / nm[0], at[1] / nm[1], at[2] / nm[2]]), colors: new Float32Array(4), sizesNm: new Float32Array(1), count: 1, nmRight: [1 / nm[0], 0, 0]};
  const t0 = performance.now();
  const step = (now: number) => {
    // a small glow, a steady size on screen, gently breathing (Ames: too
    // much glow, it hid the synapse)
    const k = 0.5 + 0.5 * Math.sin((now - t0) / 1000 * 3);
    let Hn = 40_000;
    try { Hn = viewerNow().projectionScale.value * Math.min(nm[0], nm[1], nm[2]); } catch { /* a guess */ }
    glow.colors.set([rgb[0], rgb[1], rgb[2], 0.75 + 0.25 * k]);
    glow.sizesNm[0] = Math.min(3400, Hn * 0.028) * (0.85 + 0.15 * k);
    const cam = cameraAxes(nm);
    if (cam) {
      glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
      // drawn a little toward the viewer, so the membrane it sits on does
      // not slice the light in half (Ames: clipping)
      for (let a = 0; a < 3; a++) glow.positions[a] = (at[a] + cam.toEye[a] * 2400) / nm[a];
    }
    setNgeGlow(glow, 'intro-pulse');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    pulseRaf = requestAnimationFrame(step);
  };
  pulseRaf = requestAnimationFrame(step);
}
function stopPulse() { cancelAnimationFrame(pulseRaf); setNgeGlow(null, 'intro-pulse'); }
/** A signal racing down the axon, again and again: a bright head with a
 *  fading tail (the axon step on phones, Ames: "send an action potential
 *  down it"). */
function runAxonPulse(path: number[][]) {
  stopPulse();
  const nm = nmPerUnit();
  if (!nm || path.length < 2) return;
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]));
  const L = cum[cum.length - 1], TAIL = 18, PERIOD = 2.4, RUN = 1.7;
  const at = (s: number) => {
    let k = 1; while (k < cum.length - 1 && cum[k] < s) k++;
    const f = Math.max(0, Math.min(1, (s - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1)));
    return [0, 1, 2].map(i => path[k - 1][i] + (path[k][i] - path[k - 1][i]) * f);
  };
  const glow: NgeGlow = {positions: new Float32Array(TAIL * 3), colors: new Float32Array(TAIL * 4), sizesNm: new Float32Array(TAIL), count: TAIL, nmRight: [1 / nm[0], 0, 0]};
  const t0 = performance.now();
  const step = (now: number) => {
    const q = ((now - t0) / 1000) % PERIOD / RUN;
    for (let j = 0; j < TAIL; j++) {
      const s = (q - j * 0.012) * L, on = q <= 1 + TAIL * 0.012 && s >= 0 && s <= L;
      const p = at(Math.max(0, Math.min(L, s)));
      glow.positions.set([p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]], j * 3);
      const a = on ? Math.pow(1 - j / TAIL, 1.6) : 0;
      glow.colors.set([j ? 0.45 : 0.9, j ? 0.85 : 0.98, 1, a], j * 4);
      glow.sizesNm[j] = (j ? 3200 : 6000) * (1 - j / TAIL * 0.5);
    }
    const cam = cameraAxes(nm);
    if (cam) glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
    setNgeGlow(glow, 'intro-pulse');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    pulseRaf = requestAnimationFrame(step);
  };
  pulseRaf = requestAnimationFrame(step);
}

/* ── the panel and the callout ── */
function ensureStyle() {
  if (document.getElementById('nge-intro-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-intro-style';
  st.textContent = `
/* The box, after Ames's scifi-ui hologram panels: a glassy plate with cut
   corners, HUD brackets, a faint circuit board that draws itself in, and a
   build in (a light runs the border, the plate resolves out of a blur, a
   scan line passes down it). */
@property --nge-ring { syntax: '<angle>'; inherits: false; initial-value: 45deg; }
.nge-intro { position: fixed; left: 0; right: 0; margin-inline: auto; bottom: 28px; transform: none; z-index: 9500; isolation: isolate;
  width: min(620px, calc(100vw - 24px)); box-sizing: border-box; padding: 16px 20px 16px;
  color: #e6f3ff; font: 16.5px/1.5 'Inter', 'Roboto', sans-serif; opacity: 0; pointer-events: none; }
.nge-intro--in { pointer-events: auto; animation: nge-holo-in 900ms cubic-bezier(.16,1,.3,1) both; }
@keyframes nge-holo-in {
  0% { opacity: 0; transform: translate(0, 18px) scaleY(0.04); filter: blur(8px) brightness(2.2) drop-shadow(0 0 0 rgba(80, 180, 255, 0)); }
  35% { opacity: 1; transform: translate(0, 6px) scaleY(1.02); filter: blur(3px) brightness(1.6) drop-shadow(0 0 30px rgba(80, 180, 255, 0.6)); }
  100% { opacity: 1; transform: translate(0, 0) scaleY(1); filter: blur(0) brightness(1) drop-shadow(0 0 18px rgba(80, 180, 255, 0.28)); } }
.nge-intro--out { animation: nge-holo-out 420ms ease-in both; }
@keyframes nge-holo-out { to { opacity: 0; transform: translate(0, 10px) scaleY(0.04); filter: blur(6px) brightness(2); } }
/* the plate */
.nge-intro-plate-bg { position: absolute; inset: 0; z-index: -2; pointer-events: none;
  clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  background: linear-gradient(160deg, rgba(14, 34, 66, 0.93), rgba(6, 12, 28, 0.95) 60%, rgba(22, 14, 48, 0.94));
  box-shadow: inset 0 0 40px rgba(80, 180, 255, 0.10); }
.nge-intro-plate-bg::before { display: none; content: ''; position: absolute; inset: 0; padding: 1px;
  clip-path: inherit; background: linear-gradient(135deg, rgba(126, 224, 255, 0.75), rgba(74, 150, 224, 0.25) 40%, rgba(138, 96, 230, 0.6));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
/* fine scan lines across the glass */
.nge-intro-plate-bg::after { content: ''; position: absolute; inset: 0; opacity: 0.35;
  background: repeating-linear-gradient(0deg, rgba(126, 224, 255, 0.05) 0 1px, transparent 1px 3px); }
/* the light that runs the border once as it arrives */
.nge-intro-ring { position: absolute; inset: 0; z-index: -1; pointer-events: none; padding: 1.5px; opacity: 0;
  clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  background: conic-gradient(from var(--nge-ring), #c9f6ff 0deg, rgba(126, 224, 255, 0.5) 16deg, transparent 34deg, transparent 180deg,
    #c9f6ff 180deg, rgba(126, 224, 255, 0.5) 196deg, transparent 214deg, transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-intro--in .nge-intro-ring { animation: nge-ring 1500ms linear 250ms forwards; }
@keyframes nge-ring { 0% { --nge-ring: 45deg; opacity: 1; } 60% { opacity: 1; } 100% { --nge-ring: 405deg; opacity: 0; } }
/* HUD brackets that snap in from outside */
.nge-intro-corner { position: absolute; width: 14px; height: 14px; border: 2px solid #7ee0ff; pointer-events: none;
  filter: drop-shadow(0 0 4px #7ee0ff); opacity: 0; }
.nge-intro-corner.tr { top: -5px; right: -5px; border-left: 0; border-bottom: 0; }
.nge-intro-corner.bl { bottom: -5px; left: -5px; border-right: 0; border-top: 0; }
.nge-intro-corner.tl { top: 6px; left: 6px; width: 8px; height: 8px; border-width: 1px; border-right: 0; border-bottom: 0; }
.nge-intro-corner.br { bottom: 6px; right: 6px; width: 8px; height: 8px; border-width: 1px; border-left: 0; border-top: 0; }
.nge-intro--in .nge-intro-corner { animation: nge-corner 600ms cubic-bezier(.2,1.4,.4,1) 450ms both; }
.nge-intro--in .nge-intro-corner.tr { --dx: 14px; --dy: -14px; } .nge-intro--in .nge-intro-corner.bl { --dx: -14px; --dy: 14px; }
.nge-intro--in .nge-intro-corner.tl { --dx: -10px; --dy: -10px; } .nge-intro--in .nge-intro-corner.br { --dx: 10px; --dy: 10px; }
@keyframes nge-corner { from { opacity: 0; transform: translate(var(--dx, 0), var(--dy, 0)); } to { opacity: 1; transform: none; } }
/* the circuit board: traces draw in, then sparks run along a few of them */
.nge-intro-circuit { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; overflow: visible;
  clip-path: polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px);
  -webkit-mask-image: linear-gradient(100deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.25) 45%, #000 80%);
          mask-image: linear-gradient(100deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.25) 45%, #000 80%); }
.nge-intro-circuit path { fill: none; stroke: rgba(126, 224, 255, 0.34); stroke-width: 1.2; stroke-linecap: round; vector-effect: non-scaling-stroke;
  stroke-dasharray: 1; stroke-dashoffset: 1; }
.nge-intro-circuit circle { fill: rgba(126, 224, 255, 0.55); opacity: 0; }
.nge-intro--in .nge-intro-circuit path { animation: nge-trace 1200ms ease-out both; animation-delay: calc(500ms + var(--i) * 70ms); }
.nge-intro--in .nge-intro-circuit circle { animation: nge-node 300ms ease-out both; animation-delay: calc(1100ms + var(--i) * 70ms); }
@keyframes nge-trace { to { stroke-dashoffset: 0; } }
@keyframes nge-node { to { opacity: 1; } }
.nge-intro-circuit .spark { stroke: #c9f6ff; stroke-width: 2; stroke-dasharray: 0.06 0.94; stroke-dashoffset: 1; opacity: 0;
  filter: drop-shadow(0 0 3px #7ee0ff); }
.nge-intro--in .nge-intro-circuit .spark { animation: nge-spark 3.6s linear infinite; animation-delay: calc(1800ms + var(--i) * 900ms); }
@keyframes nge-spark { 0% { stroke-dashoffset: 1; opacity: 1; } 45% { stroke-dashoffset: 0; opacity: 1; } 46%, 100% { opacity: 0; stroke-dashoffset: 0; } }
/* a scan line passes down the box as it arrives, and again with each new message */
.nge-intro-scan { position: absolute; left: 0; right: 0; top: 0; height: 2px; pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent, #c9f6ff 20%, #c9f6ff 80%, transparent); box-shadow: 0 0 12px #7ee0ff; }
.nge-intro--in .nge-intro-scan { animation: nge-scan 800ms ease-in-out 350ms both; }
.nge-intro--beat .nge-intro-scan { animation: nge-scan2 650ms ease-in-out both; }
@keyframes nge-scan { 0% { top: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
@keyframes nge-scan2 { 0% { top: 0; opacity: 0; } 15% { opacity: 0.8; } 85% { opacity: 0.8; } 100% { top: 100%; opacity: 0; } }
.nge-intro--beat .nge-intro-title { animation: nge-flicker 420ms steps(2, end) both; }
@keyframes nge-flicker { 0% { opacity: 0.2; transform: translateX(-3px); } 30% { opacity: 1; transform: none; } 45% { opacity: 0.5; } 60%, 100% { opacity: 1; } }
body.nge-mobile .nge-intro, .nge-intro--phone { bottom: calc(86px + env(safe-area-inset-bottom)); }
.nge-intro-head { display: flex; align-items: center; gap: 8px; font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; color: #7ecaff; text-transform: uppercase; }
.nge-intro-dot { width: 8px; height: 8px; border-radius: 50%; background: #7ecaff; box-shadow: 0 0 8px #7ecaff; }
@keyframes nge-intro-blink { 50% { opacity: 0.25; } }
.nge-intro-bars { display: none; gap: 2px; align-items: flex-end; margin-left: auto; }
.nge-intro-bars i { width: 3px; background: #7ecaff; border-radius: 1px; animation: nge-intro-bar 1.2s infinite ease-in-out; }
.nge-intro-bars i:nth-child(1) { height: 5px; } .nge-intro-bars i:nth-child(2) { height: 8px; animation-delay: .15s; }
.nge-intro-bars i:nth-child(3) { height: 11px; animation-delay: .3s; } .nge-intro-bars i:nth-child(4) { height: 14px; animation-delay: .45s; }
@keyframes nge-intro-bar { 50% { opacity: 0.35; } }
.nge-intro-title { margin: 8px 0 4px; font: 700 24px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; color: #fff; text-shadow: 0 0 14px rgba(126, 210, 255, 0.55); }
.nge-intro-body { margin: 0; min-height: 3em; color: #d6e8fb; }
.nge-intro-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
.nge-intro-row .nge-intro-hint { margin-left: auto; }
.nge-intro-x { margin-left: auto !important; flex: none; width: 26px; height: 26px; margin: -4px -6px -4px 6px; display: grid; place-items: center; padding: 0;
  border: 1px solid rgba(126, 210, 255, 0.35); border-radius: 50%; background: rgba(126, 210, 255, 0.06); color: #9fc6ea; cursor: pointer; }
.nge-intro-x:hover { color: #fff; border-color: rgba(126, 210, 255, 0.8); background: rgba(126, 210, 255, 0.16); }
.nge-intro-back { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 8px 4px; cursor: pointer;
  color: #8fb6dc; font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; }
.nge-intro-back:hover { color: #e6f3ff; }
.nge-intro-back[hidden] { display: inline-flex; visibility: hidden; }
/* Next: a hologram plate from Ames's scifi-ui (blue into violet on the
   diagonal, cut corners, corner ticks), a light band sweeping across it,
   and a glow that wakes on hover. */
.nge-intro-next { position: relative; border: 0; padding: 0; background: none; cursor: pointer; margin-left: auto; color: inherit;
  filter: drop-shadow(0 0 10px rgba(74, 150, 224, 0.45)); transition: filter 0.25s, transform 0.2s; }
.nge-intro-next:hover { filter: drop-shadow(0 0 18px rgba(126, 224, 255, 0.75)); transform: translateY(-1px); }
.nge-intro-next:active { transform: translateY(0) scale(0.98); }
.nge-intro-plate { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 12px; padding: 12px 22px 12px 24px;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  background: linear-gradient(135deg, rgba(74, 150, 224, 0.55) 0%, rgba(74, 150, 224, 0.62) 45%, rgba(138, 96, 230, 0.55) 100%);
  color: #eaf7ff; font: 700 13px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap;
  text-shadow: 0 0 8px rgba(126, 224, 255, 0.8); transition: background 0.3s; }
.nge-intro-next:hover .nge-intro-plate { background: linear-gradient(135deg, rgba(90, 170, 240, 0.72) 0%, rgba(90, 170, 240, 0.78) 45%, rgba(150, 110, 240, 0.7) 100%); }
/* the hairline frame and corner ticks */
.nge-intro-plate::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(135deg, #bff3ff, rgba(126, 224, 255, 0.35) 40%, rgba(180, 150, 255, 0.8));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-intro-plate::after { content: ''; position: absolute; top: 0; bottom: 0; left: -70%; width: 50%; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(201, 246, 255, 0.55), transparent); transform: skewX(-20deg);
  animation: nge-intro-shine 3.4s ease-in-out infinite; }
@keyframes nge-intro-shine { 0%, 50% { left: -70%; } 100% { left: 140%; } }
.nge-intro-tick { position: absolute; width: 6px; height: 6px; border: 1px solid #c9f6ff; pointer-events: none; }
.nge-intro-tick.a { top: 3px; right: 3px; border-left: 0; border-bottom: 0; }
.nge-intro-tick.b { bottom: 3px; left: 3px; border-right: 0; border-top: 0; }
.nge-intro-chev { display: inline-flex; color: #c9f6ff; filter: drop-shadow(0 0 4px #7ee0ff); }
.nge-intro-chev svg { animation: nge-intro-nudge 1.4s ease-in-out infinite; }
@keyframes nge-intro-nudge { 50% { transform: translateX(3px); } }
.nge-intro-next:focus-visible, .nge-intro-back:focus-visible, .nge-intro-x:focus-visible, .nge-intro-confirm button:focus-visible { outline: 2px solid #7ecaff; outline-offset: 3px; }
/* The frame: branching traces that grow around the edge (Ames). */
.nge-frame-host { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.nge-frame { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; overflow: visible; pointer-events: none; }
.nge-frame path { fill: none; stroke: rgba(126, 224, 255, 0.55); stroke-width: 1.1; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
.nge-frame .rim { stroke: rgba(150, 230, 255, 0.85); stroke-width: 1.2; }
.nge-frame circle { fill: #9fe9ff; opacity: 0; }
.nge-intro--in .nge-frame path { animation: nge-trace 900ms ease-out both; animation-delay: calc(250ms + var(--i, 0) * 45ms); }
.nge-intro--in .nge-frame .rim { animation-duration: 1100ms; animation-delay: 150ms; }
.nge-intro--in .nge-frame circle { animation: nge-node 300ms ease-out both; animation-delay: calc(800ms + var(--i, 0) * 45ms); }
@keyframes nge-trace { to { stroke-dashoffset: 0; } }
@keyframes nge-node { to { opacity: 1; } }
.nge-frame .spark { stroke: #e6fbff; stroke-width: 2.2; stroke-dasharray: 0.05 0.95; opacity: 0; filter: drop-shadow(0 0 3px #7ee0ff); }
.nge-intro--in .nge-frame .spark { animation: nge-spark 6.5s linear infinite; animation-delay: calc(1800ms + var(--i, 0) * 2100ms); }
@keyframes nge-spark { 0% { stroke-dashoffset: 1; opacity: 1; } 40% { stroke-dashoffset: 0; opacity: 1; } 41%, 100% { stroke-dashoffset: 0; opacity: 0; } }
.nge-intro-hint { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: rgba(159, 210, 240, 0.55);
  font: 600 9px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; }
.nge-intro-hint kbd { font: 600 10px 'Inter', sans-serif; padding: 1px 5px; border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 3px; color: #bfe6ff; }
body.nge-mobile .nge-intro-hint, .nge-intro--phone .nge-intro-hint { visibility: hidden; }
.nge-orb { position: relative; display: inline-flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none; cursor: pointer; color: #eaf7ff; }
.nge-orb-label { font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; text-shadow: 0 0 8px rgba(126, 224, 255, 0.9); }
.nge-orb-core { position: relative; width: 44px; height: 44px; flex: none; display: grid; place-items: center; }
.nge-orb-core svg.rings { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.nge-orb-core .r1 { fill: none; stroke: #7ee0ff; stroke-width: 1.6; stroke-dasharray: 18 7 3 7; transform-origin: 22px 22px; animation: nge-spin 6s linear infinite; filter: drop-shadow(0 0 3px #7ee0ff); }
.nge-orb-core .r2 { fill: none; stroke: #b49cff; stroke-width: 1; stroke-dasharray: 2 4; transform-origin: 22px 22px; animation: nge-spin 9s linear infinite reverse; }
.nge-orb-core .r3 { fill: none; stroke: rgba(201, 246, 255, 0.9); stroke-width: 2.2; stroke-dasharray: 10 120; transform-origin: 22px 22px; animation: nge-spin 2.4s linear infinite; }
@keyframes nge-spin { to { transform: rotate(360deg); } }
.nge-orb-core::before { content: ''; position: absolute; inset: 9px; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #e9fbff 0%, #6fd2ff 30%, #3a6fe0 65%, rgba(110, 80, 220, 0.9) 100%);
  box-shadow: 0 0 14px rgba(110, 200, 255, 0.9), 0 0 30px rgba(110, 120, 255, 0.45); animation: nge-pulse 1.8s ease-in-out infinite; }
@keyframes nge-pulse { 50% { box-shadow: 0 0 22px rgba(140, 220, 255, 1), 0 0 42px rgba(130, 120, 255, 0.6); } }
.nge-orb-core .chev { position: relative; color: #04172b; }
.nge-orb:hover .r1 { animation-duration: 1.6s; } .nge-orb:hover .r3 { animation-duration: 0.9s; }
.nge-orb:hover .nge-orb-core::before { filter: brightness(1.2); }
.nge-orb:active .nge-orb-core { transform: scale(0.94); }
.nge-orb--back .nge-orb-core { width: 32px; height: 32px; }
.nge-orb--back .nge-orb-core::before { inset: 7px; background: radial-gradient(circle at 40% 35%, rgba(200, 240, 255, 0.35), rgba(40, 90, 170, 0.35)); box-shadow: 0 0 8px rgba(110, 200, 255, 0.4); animation: none; }
.nge-orb--back .nge-orb-core svg.rings { transform: scale(0.727); transform-origin: 0 0; width: 44px; height: 44px; }
.nge-orb--back .r3 { display: none; }
.nge-orb--back .nge-orb-core .chev { color: #c9f6ff; }
.nge-orb[hidden] { display: inline-flex; visibility: hidden; }
.nge-orb:focus-visible { outline: 2px solid #7ecaff; outline-offset: 3px; border-radius: 22px; }
.nge-callout-box .nge-frame path { stroke: rgba(126, 224, 255, 0.5); }
.nge-frame .pad { fill: rgba(8, 24, 52, 0.9); stroke: #9fe9ff; stroke-width: 1; }
.nge-callout-box .nge-frame { animation: none; }
.nge-callout-box .nge-frame path, .nge-callout-box .nge-frame circle { opacity: 0; }
.nge-callout--in .nge-callout-box .nge-frame path { opacity: 1; animation: nge-trace 800ms ease-out both; animation-delay: calc(450ms + var(--i, 0) * 40ms); }
.nge-callout--in .nge-callout-box .nge-frame circle { opacity: 1; animation: nge-node 300ms ease-out both; animation-delay: calc(900ms + var(--i, 0) * 40ms); }
.nge-callout-box .nge-frame .spark { animation: nge-spark 4.2s linear infinite; animation-delay: calc(1200ms + var(--i, 0) * 1100ms); }
.nge-intro .nge-intro-nav { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
/* Let's go (Ames: reimagined): a command key in two cells. A glass label
   cell with a fine cyan edge, and a bright action cell holding the arrow,
   joined on a slant. Nothing moves until it is touched: then the glass
   fills with light from the arrow's side and the arrow slides on. */
.nge-go { position: relative; isolation: isolate; display: inline-flex; flex-direction: row; align-items: stretch; height: 50px; padding: 0; margin-left: auto;
  border: 0 !important; background: none !important; box-shadow: none !important; cursor: pointer; white-space: nowrap; color: #eaf8ff;
  filter: drop-shadow(0 0 8px rgba(70, 190, 255, 0.35)); transition: filter 0.25s, transform 0.12s; }
.nge-go-label { position: relative; display: flex; align-items: center; padding: 0 22px 0 22px; overflow: hidden;
  font: 700 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.3em; text-transform: uppercase;
  clip-path: polygon(8px 0, 100% 0, calc(100% - 10px) 100%, 0 100%, 0 8px);
  background: linear-gradient(180deg, rgba(126, 224, 255, 0.16), rgba(40, 110, 200, 0.12)); }
.nge-go-label::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(90deg, rgba(126, 224, 255, 0.35), rgba(126, 224, 255, 0.9));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-go-label::after { content: ''; position: absolute; inset: 0; z-index: -1; transform: scaleX(0); transform-origin: 100% 50%;
  background: linear-gradient(270deg, rgba(126, 224, 255, 0.45), rgba(126, 224, 255, 0.08)); transition: transform 0.3s cubic-bezier(.2,.8,.2,1); }
.nge-go-chevs { display: none !important; position: relative; place-items: center; width: 44px; margin-left: -6px;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
  background: linear-gradient(135deg, #c9f6ff 0%, #5fd4ff 45%, #3a8cff 100%); color: #04172b; }
.nge-go-chevs i { display: none; }
.nge-go-chevs::before { content: ''; width: 16px; height: 12px; background: currentColor; transition: transform 0.25s cubic-bezier(.2,.8,.2,1);
  clip-path: polygon(0 40%, 60% 40%, 60% 0, 100% 50%, 60% 100%, 60% 60%, 0 60%); }
.nge-go:hover { filter: drop-shadow(0 0 16px rgba(110, 215, 255, 0.8)); }
.nge-go:hover .nge-go-label::after, .nge-go:focus-visible .nge-go-label::after { transform: scaleX(1); }
.nge-go:hover .nge-go-chevs::before { transform: translateX(3px); }
.nge-go:active { transform: translateY(1px) scale(0.98); }
.nge-go:focus-visible { outline: 2px solid #7ecaff; outline-offset: 4px; }
.nge-go--alt { margin-left: auto; filter: none; }
.nge-go--alt + .nge-go { margin-left: 10px; }
.nge-go--alt .nge-go-label { background: none; color: #bfe6ff; }
.nge-go[hidden] { display: none; }
.nge-intro--choice > .nge-intro-row { flex-wrap: wrap; row-gap: 8px; }
.nge-intro-key { order: -2; flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 2px;
  font: 500 12.5px 'Inter', sans-serif; color: #cfe6ff; }
.nge-intro-key[hidden] { display: none; }
.nge-card-key { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 10px; align-items: center; margin: 10px 0 2px; padding-top: 10px;
  border-top: 1px solid rgba(126, 224, 255, 0.25); font: 500 13.5px/1.3 'Inter', sans-serif; color: #e6f3ff; }
.nge-card-key[hidden] { display: none; }
.nge-callout-stats[hidden] { display: none; }
.nge-step { color: #ffd166; letter-spacing: 0.1em; }
/* large text settings: the words scroll inside the box rather than push it off
   the screen (Ames) */
.nge-intro-body { max-height: 36vh; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(126, 224, 255, 0.6) transparent; padding-right: 4px; }
.nge-intro-body::-webkit-scrollbar { width: 5px; }
.nge-intro-body::-webkit-scrollbar-thumb { background: rgba(126, 224, 255, 0.6); border-radius: 3px; }
.nge-intro-body::-webkit-scrollbar-track { background: rgba(126, 224, 255, 0.08); border-radius: 3px; }
.nge-intro-zap { position: relative; z-index: 2; margin-left: auto; margin-right: 14px; width: 46px; height: 46px; flex: none; display: grid; place-items: center; padding: 0; cursor: pointer;
  border-radius: 50%; border: 1px solid #fff3c4; background: radial-gradient(circle at 40% 35%, #fff1a8, #ffd23f 55%, #f5a623);
  color: #2a1a00; box-shadow: 0 0 16px rgba(255, 210, 70, 0.7); transition: transform 0.15s, box-shadow 0.2s; }
.nge-intro-zap + .nge-intro-go::before { display: none; }
.nge-intro-zap[hidden] { display: none; }
.nge-intro-zap svg { width: 24px; height: 24px; filter: none; }
.nge-intro-zap:hover { transform: scale(1.08); box-shadow: 0 0 22px rgba(255, 210, 90, 0.6); }
.nge-intro-zap--fire { animation: nge-zap-fire 0.6s ease-out; }
@keyframes nge-zap-fire { 0% { transform: scale(0.85); box-shadow: 0 0 0 rgba(255, 230, 140, 0); } 30% { transform: scale(1.15); box-shadow: 0 0 34px rgba(255, 230, 140, 0.95); } 100% { transform: none; } }
.nge-intro-zap + .nge-intro-go { margin-left: 0; }
.nge-callout-kname { display: none; }
.nge-callout-kdot { display: none; width: 8px; height: 8px; border-radius: 50%; background: var(--part, #7ecaff); box-shadow: 0 0 8px var(--part, #7ecaff); flex: none; }
@media (max-width: 820px) {
  /* the last page compact on a phone, so the cells above stay in view */
  .nge-intro { font-size: 17.5px; }
  .nge-intro .nge-intro-title { font-size: 25px; }
  .nge-intro.nge-intro--choice .nge-intro-key { font-size: 11px; gap: 3px 8px; }
  .nge-intro.nge-intro--choice .nge-intro-choose { font-size: 9px; letter-spacing: 0.16em; }
  .nge-intro.nge-intro--choice > .nge-intro-row { flex-wrap: wrap; column-gap: 8px; row-gap: 6px; }
  .nge-intro.nge-intro--choice > .nge-intro-row .nge-go { flex: 1 1 40%; min-width: 0; }
  .nge-intro.nge-intro--choice .nge-go .nge-go-label { font-size: 10px !important; letter-spacing: 0.08em !important; padding: 8px 6px !important; white-space: normal; line-height: 1.35; text-align: center; }
  .nge-intro.nge-intro--choice .nge-go { height: auto !important; min-height: 44px; }
  .nge-intro.nge-intro--choice .nge-go-chevs { display: none !important; }
  .nge-callout-box .nge-callout-title { display: none !important; }
  .nge-callout-box .nge-callout-kdot { display: inline-block; margin-right: 9px; }
  .nge-callout-box .nge-callout-kname { display: inline; }
  .nge-callout-box .nge-callout-stats .grp { display: none !important; }
  .nge-callout-box .nge-callout-stats { border-top: 0 !important; padding-top: 2px !important; margin-top: 4px !important; }
}
/* the whole tour, every screen: no top bars but the Pyr icon, no bottom bar
   (Ames 2026-11-09) */
body.nge-intro-on #extensionBar > :not(.ng-extend-logo), body.nge-intro-on .neuroglancer-layer-panel,
body.nge-intro-on .nge-mobile-nav, body.nge-intro-on [title^="Switch to"], body.nge-intro-on #statusContainer,
body.nge-intro-on .neuroglancer-data-panel-layout-controls,
body.nge-intro-on .nge-stt-tab { display: none !important; }
body.nge-intro-on #extensionBar { background: transparent !important; border: 0 !important; box-shadow: none !important; }
@media (max-width: 820px) {
  /* sharp on phones: no blur or glow filters on the box (they left it soft) */
  /* frosted behind, sharp in front: a blur of what is behind it (not of the
     box itself) and a darker plate, so it reads over the cell (Ames) */
  .nge-callout-box, .nge-callout--in .nge-callout-box { max-width: 58vw !important; min-width: 0 !important; padding: 8px 11px 9px !important;
    backdrop-filter: blur(10px) saturate(1.2) !important; -webkit-backdrop-filter: blur(10px) saturate(1.2) !important; background-color: rgba(6, 18, 40, 0.55) !important; filter: none !important; }
  .nge-callout--in .nge-callout-box { animation-name: nge-co-build-m !important; }
  .nge-callout-box > :not(.nge-frame-host) { filter: none !important; }
  .nge-callout-box .nge-callout-title { font-size: 15px; }
  .nge-callout-box .nge-callout-kicker { font-size: 10px; }
  .nge-callout-box .nge-callout-stats dt { font-size: 8px; }
  .nge-callout-box .nge-callout-stats dd { font-size: 12.5px; }
  .nge-callout-box .nge-callout-stats .num { font-size: 17px; }
  .nge-callout-box .nge-callout-stats { column-gap: 14px; row-gap: 5px; }
  .nge-tour-loading-text { font-size: clamp(13px, 4.6vw, 20px); letter-spacing: 0.14em; padding: 0 16px; text-align: center; }
  .nge-tour-loading-sub { padding: 0 16px; text-align: center; }
  .nge-intro .nge-intro-row { flex-wrap: wrap; row-gap: 10px; }
  .nge-intro .nge-intro-row .nge-go { flex: 1 1 auto; justify-content: center; letter-spacing: 0.16em; }
  /* the wide Next key's circuit trace ran through the back arrow (Ames) */
  .nge-intro .nge-intro-row .nge-go::before { display: none; }
  .nge-intro .nge-intro-row .nge-back { width: 40px; height: 40px; margin-right: 4px; color: rgba(126, 224, 255, 0.85); }
  .nge-intro .nge-intro-row .nge-back .chev { width: 20px; height: 20px; }
}
.nge-card-hint { margin-top: 10px; font: 500 12.5px 'Inter', sans-serif; letter-spacing: 0.03em; color: rgba(190, 228, 255, 0.8); }
.nge-card-hint[hidden] { display: none; }
.nge-card-hint b { font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #9fe9ff; }
.nge-card-hint i { display: inline-block; width: 4px; height: 4px; margin: 0 8px 2px; border-radius: 50%; background: rgba(126, 224, 255, 0.6); }
.nge-tour-loading { position: fixed; inset: 0; z-index: 2147483000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  background: #020612; opacity: 0; transition: opacity 0.6s ease; pointer-events: none; overflow: hidden; }
.nge-tour-loading--in { opacity: 1; }
.nge-tl-stars { position: absolute; inset: 0; width: 100%; height: 100%; }
.nge-tl-core { position: relative; width: 190px; height: 190px; display: grid; place-items: center; margin-bottom: 6px; }
.nge-tl-ring { position: absolute; inset: 0; border-radius: 50%; border: 1.5px dashed rgba(126, 224, 255, 0.55); box-shadow: 0 0 22px rgba(80, 190, 255, 0.25), inset 0 0 22px rgba(80, 190, 255, 0.18);
  animation: nge-tl-spin 9s linear infinite; }
.nge-tl-ring.b { inset: 22px; border: 2px solid transparent; border-top-color: #7ee0ff; border-bottom-color: rgba(255, 209, 102, 0.8); animation: nge-tl-spin 2.6s linear infinite reverse; box-shadow: none; }
.nge-tl-glow { position: absolute; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, rgba(110, 210, 255, 0.45), rgba(40, 120, 255, 0) 70%); animation: nge-tl-pulse 1.6s ease-in-out infinite; }
.nge-tl-ship { position: relative; width: 92px; height: 92px; object-fit: contain; filter: drop-shadow(0 0 14px rgba(110, 210, 255, 0.8)); animation: nge-tl-bob 2.2s ease-in-out infinite; }
@keyframes nge-tl-spin { to { transform: rotate(360deg); } }
@keyframes nge-tl-pulse { 50% { transform: scale(1.18); opacity: 0.7; } }
@keyframes nge-tl-bob { 50% { transform: translateY(-7px) rotate(-3deg); } }
.nge-tour-loading-text { position: relative; font: 700 20px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #e6f6ff;
  text-shadow: 0 0 14px rgba(126, 224, 255, 0.8), 0 0 40px rgba(80, 160, 255, 0.5); }
.nge-tl-bar { position: relative; width: min(340px, 70vw); height: 3px; border-radius: 2px; background: rgba(126, 224, 255, 0.15); overflow: hidden; }
.nge-tl-bar i { position: absolute; top: 0; bottom: 0; width: 34%; background: linear-gradient(90deg, transparent, #9fefff, transparent); box-shadow: 0 0 10px #7ee0ff; animation: nge-tl-scan 1.4s ease-in-out infinite; }
@keyframes nge-tl-scan { 0% { left: -34%; } 100% { left: 100%; } }
.nge-tour-loading-sub { position: relative; font: 500 14px 'Inter', sans-serif; letter-spacing: 0.06em; color: rgba(200, 235, 255, 0.85); }
.nge-tl-swap { animation: nge-tl-type 0.45s ease-out both; }
@keyframes nge-tl-type { from { opacity: 0; filter: blur(3px); transform: translateY(4px); } to { opacity: 1; filter: none; transform: none; } }
.nge-tl-flash { position: absolute; inset: 0; background: radial-gradient(circle at 50% 44%, #fff, rgba(160, 230, 255, 0.6) 30%, rgba(0, 0, 0, 0) 70%); opacity: 0; pointer-events: none; }
.nge-tl-warp .nge-tl-flash { animation: nge-tl-flash 0.9s ease-in both; }
.nge-tl-warp .nge-tl-ship { animation: nge-tl-go 0.7s cubic-bezier(.6,0,.9,.4) both; }
@keyframes nge-tl-flash { 0%, 55% { opacity: 0; } 75% { opacity: 1; } 100% { opacity: 0.9; } }
@keyframes nge-tl-go { to { transform: scale(0.15) translateY(-40px); opacity: 0; filter: drop-shadow(0 0 30px #fff) brightness(3); } }
@media (prefers-reduced-motion: reduce) { .nge-tl-ring, .nge-tl-glow, .nge-tl-ship, .nge-tl-bar i { animation: none !important; } }
.nge-card-key i { width: 11px; height: 11px; border-radius: 50%; background: var(--c); box-shadow: 0 0 8px var(--c); }
.nge-card-key small { color: rgba(200, 230, 255, 0.7); font-size: 12px; text-align: right; white-space: nowrap; }
.nge-card-key b { font-weight: 600; }
.nge-card-key .nge-pt { display: contents; cursor: pointer; font: inherit; color: inherit; text-align: left; }
.nge-card-key .nge-pt > span { text-align: left; }
.nge-pt > * { cursor: pointer; }
.nge-pt:hover b, .nge-pt:focus-visible b { color: #7ee0ff; text-decoration: underline; text-underline-offset: 3px; }
.nge-pt--on b { color: #7ee0ff; }
.nge-pt--on i { outline: 2px solid #fff; outline-offset: 2px; }
.nge-card-key .hd { grid-column: 1 / -1; font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.24em; text-transform: uppercase; color: rgba(126, 202, 255, 0.85); margin-top: 4px; }
.nge-intro-key i { width: 18px; height: 5px; border-radius: 3px; background: var(--c); box-shadow: 0 0 6px var(--c); margin-left: 8px; }
.nge-intro-key i:first-child { margin-left: 0; }
.nge-intro-key i.dot { width: 8px; height: 8px; border-radius: 50%; }
.nge-intro--choice > .nge-intro-row { flex-wrap: wrap; }
.nge-intro--choice .nge-intro-back { order: 0; }
.nge-intro--choice .nge-intro-alt { order: 1; margin-left: auto; }
.nge-intro--choice .nge-intro-go { order: 2; margin-left: 10px; }
.nge-intro.nge-intro--choice .nge-go-label { padding: 0 24px; font-size: 11px; letter-spacing: 0.12em; }
.nge-intro.nge-intro--choice .nge-intro-go { margin-left: 16px; }
.nge-intro.nge-intro--choice .nge-go::before { display: none; }
.nge-intro.nge-intro--choice .nge-intro-alt .nge-go-label { background: linear-gradient(180deg, rgba(126, 224, 255, 0.10), rgba(40, 110, 200, 0.08)); }
.nge-intro.nge-intro--choice .nge-go { height: 40px !important; flex: none; }
.nge-intro-choose { order: -1; flex-basis: 100%; margin-top: 4px; font: 600 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.28em;
  text-transform: uppercase; color: rgba(126, 224, 255, 0.85); }
.nge-intro-choose[hidden] { display: none; }
.nge-intro--choice .nge-go { height: 44px; }
.nge-intro .nge-go { height: 36px !important; min-height: 36px; overflow: visible; }
.nge-intro .nge-go-label { min-height: 100%; box-sizing: border-box; padding: 0 24px; font-size: 12.5px; }
.nge-intro--phone .nge-go { height: 34px !important; min-height: 34px; }
/* a little circuit off the key: a trace out to the left with its pad, and
   one dropping from the right with its own (Ames: "the lil circuit dots") */
.nge-intro .nge-go::before { content: ''; position: absolute; right: calc(100% + 3px); top: 50%; width: 26px; height: 7px; margin-top: -3.5px; pointer-events: none;
  background: radial-gradient(circle at 3.5px 50%, rgba(8, 24, 52, 0.9) 0 1.6px, #9fe9ff 1.7px 2.6px, transparent 3px),
    linear-gradient(rgba(126, 224, 255, 0.55), rgba(126, 224, 255, 0.55)) 6px 50% / 20px 1px no-repeat; }
.nge-intro .nge-go::after { content: ''; position: absolute; right: 18px; top: calc(100% + 2px); width: 7px; height: 13px; pointer-events: none;
  background: linear-gradient(rgba(126, 224, 255, 0.55), rgba(126, 224, 255, 0.55)) 50% 0 / 1px 8px no-repeat,
    radial-gradient(circle at 50% 9.5px, rgba(8, 24, 52, 0.9) 0 1.6px, #9fe9ff 1.7px 2.6px, transparent 3px); }
.nge-intro .nge-go--alt::before, .nge-intro .nge-go--alt::after { display: none; }
.nge-intro .nge-go:hover::before, .nge-intro .nge-go:hover::after { filter: drop-shadow(0 0 4px #7ee0ff); }
.nge-intro-body b { color: #fff; font-weight: 700; }
/* back: just a chevron */
.nge-back { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0 !important; background: none !important; box-shadow: none !important;
  color: rgba(126, 224, 255, 0.55); cursor: pointer; transition: color 0.2s, transform 0.15s; }
.nge-back .chev { color: inherit; width: 16px; height: 16px; }
.nge-back:hover { color: #fff; transform: translateX(-2px); filter: drop-shadow(0 0 6px #7ee0ff); }
.nge-back[hidden] { display: inline-grid; visibility: hidden; }
.nge-back:focus-visible { outline: 2px solid #7ecaff; outline-offset: 2px; border-radius: 4px; }
@media (prefers-reduced-motion: reduce) { .nge-go-label::after, .nge-go-chevs::before { transition: none; } }
.nge-intro { transition: opacity 0.35s, transform 0.35s; }
.nge-intro--waiting { opacity: 0 !important; transform: translate(0, 16px) !important; pointer-events: none; }
/* Leaving asks first. */
.nge-intro-confirm { display: none; }
.nge-intro--asking .nge-intro-title, .nge-intro--asking .nge-intro-body, .nge-intro--asking > .nge-intro-row { display: none; }
.nge-intro--asking .nge-intro-confirm { display: block; }
.nge-intro-confirm p { margin: 10px 0 2px; font: 700 18px 'Orbitron', 'Inter', sans-serif; color: #fff; }
.nge-intro-confirm small { display: block; color: #a9c3de; font-size: 13px; }
.nge-intro-confirm .nge-intro-row { justify-content: flex-end; }
@media (prefers-reduced-motion: reduce) { .nge-intro-plate::after, .nge-intro-chev svg, .nge-intro-circuit .spark { animation: none; }
  .nge-intro--in { animation-duration: 1ms; } }
/* Phones: a smaller panel, so the cell gets the room (Ames 2026-11-08). */
.nge-intro--phone { padding: 10px 14px 12px; font-size: 13.5px; line-height: 1.42; }
.nge-intro--phone .nge-intro-head { font-size: 9.5px; letter-spacing: 0.18em; }
.nge-intro--phone .nge-intro-title { margin: 5px 0 2px; font-size: 17px; }
.nge-intro--phone .nge-intro-row { margin-top: 8px; }
.nge-intro--phone .nge-intro-plate { padding: 9px 26px 9px 20px; font-size: 12px; }
/* and the layer tabs row steps aside while it runs, so the top bar is one line */
body.nge-mobile.nge-intro-on .neuroglancer-layer-panel { display: none !important; }
.nge-callout { position: fixed; left: 0; top: 0; z-index: 9400; pointer-events: none; opacity: 0; transition: opacity 0.4s; }
.nge-callout--in { opacity: 1; }
.nge-callout > svg { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; }
.nge-callout-box { position: fixed; min-width: 200px; max-width: min(380px, 44vw); padding: 15px 20px 17px 20px; isolation: isolate; transform-origin: 50% 100%; backdrop-filter: blur(3px);
  filter: drop-shadow(0 0 16px rgba(80, 180, 255, 0.25));
  opacity: 0; }
.nge-callout--in .nge-callout-box { opacity: 1; animation: nge-co-build 900ms cubic-bezier(.2,.9,.25,1) both; }
@keyframes nge-co-build-m { 0% { clip-path: inset(100% 0 0 0); opacity: 1; } 75% { clip-path: inset(0 0 0 0); } 80% { opacity: 0.7; } 100% { clip-path: inset(0 0 0 0); opacity: 1; } }
@keyframes nge-co-build {
  0% { clip-path: inset(100% 0 0 0); opacity: 1; filter: brightness(2.4) drop-shadow(0 0 18px #9fe9ff); }
  70% { clip-path: inset(0 0 0 0); filter: brightness(1.4) drop-shadow(0 0 16px rgba(80, 180, 255, 0.4)); }
  76% { opacity: 0.65; } 80% { opacity: 1; } 84% { opacity: 0.8; }
  100% { clip-path: inset(0 0 0 0); opacity: 1; filter: drop-shadow(0 0 16px rgba(80, 180, 255, 0.25)); } }
.nge-callout-box > :not(.nge-frame-host) { opacity: 0; }
.nge-callout--in .nge-callout-box > :not(.nge-frame-host) { animation: nge-holo-row 380ms ease-out both; }
.nge-callout--in .nge-callout-box > .nge-callout-stats { animation-delay: 300ms; }
.nge-callout--in .nge-callout-box > .nge-callout-title { animation-delay: 480ms; }
.nge-callout--in .nge-callout-box > .nge-callout-kicker { animation-delay: 580ms; }
@keyframes nge-holo-row { 0% { opacity: 0; transform: translateY(5px); filter: blur(2px) brightness(2); } 60% { opacity: 1; } 100% { opacity: 1; transform: none; filter: none; } }
.nge-callout-box::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; z-index: 2; pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent, #cff6ff, transparent); box-shadow: 0 0 12px #7ee0ff; }
.nge-callout--in .nge-callout-box::after { animation: nge-holo-scan 640ms 0ms cubic-bezier(.2,.9,.25,1) both; }
@keyframes nge-holo-scan { 0% { top: calc(100% - 2px); opacity: 1; } 85% { opacity: 1; } 100% { top: 0; opacity: 0; } }
.nge-callout-beamg { opacity: 0; }
.nge-callout--in .nge-callout-beamg { animation: nge-beam-in 600ms ease-out both; }
@keyframes nge-beam-in { 0% { opacity: 0; } 25% { opacity: 1; } 35% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 1; } }
.nge-beam-edge { stroke: rgba(170, 240, 255, 0.55); stroke-width: 0.9; filter: drop-shadow(0 0 3px #7ee0ff); }
.nge-beam-seam { stroke: #dffaff; stroke-width: 2; filter: drop-shadow(0 0 6px #7ee0ff) drop-shadow(0 0 12px #4fb8ff); }
.nge-beam-scan { mix-blend-mode: screen; animation: nge-beam-breathe 2.4s ease-in-out infinite; }
@keyframes nge-beam-breathe { 50% { opacity: 0.6; } }
.nge-beam-motes circle { filter: drop-shadow(0 0 3px #7ee0ff); }
.nge-co-frame { position: absolute; left: 0; top: 0; z-index: -1; overflow: visible; pointer-events: none; }
.nge-co-frame .tr { fill: none; stroke: rgba(126, 224, 255, 0.55); stroke-width: 1.1; stroke-linecap: round; }
.nge-co-frame .pad { fill: rgba(8, 24, 52, 0.9); stroke: #9fe9ff; stroke-width: 1; }
/* Next: the hologram zips shut toward the ship before it flies (Ames) */
.nge-callout--zip { opacity: 1 !important; transition: none; }
.nge-callout--zip .nge-callout-box { animation: nge-zip 440ms cubic-bezier(.55,0,.8,.2) forwards; }
@keyframes nge-zip { 0% { transform: none; filter: drop-shadow(0 0 16px rgba(80, 180, 255, 0.25)); }
  45% { transform: scale(1, 0.025); filter: brightness(2.6) drop-shadow(0 0 18px #9fe9ff); opacity: 1; }
  100% { transform: scale(0, 0.025); filter: brightness(3) drop-shadow(0 0 18px #9fe9ff); opacity: 0.4; } }
.nge-callout--zip svg > * { transition: opacity 0.3s 0.12s; opacity: 0; }
.nge-callout-stats .num { font: 600 24px/1.05 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.02em; color: #fff; font-variant-numeric: tabular-nums; }
.nge-callout-stats .unit { display: inline; margin-left: 6px; font: 500 12px/1.2 'Inter', sans-serif; letter-spacing: 0.04em; color: rgba(200, 230, 255, 0.75); }
.nge-w-axon { color: #5ec8ff; font-weight: 600; }
.nge-w-dendrite { color: #a98bff; font-weight: 600; }
.nge-w-soma { color: #ffd24d; font-weight: 600; }
.nge-w-in { color: #ffd24d; font-weight: 600; }
.nge-w-nbr { color: #7aa2ff; font-weight: 600; }
.nge-w-out { color: #ff5fd2; font-weight: 600; }
.nge-w-down { color: #ffa64d; font-weight: 600; }
.nge-w-cellbody { color: #a98bff; font-weight: 600; }
@keyframes nge-proj-in { from { transform: scale(0.2, 0.02); opacity: 0; filter: brightness(2.5); } 60% { opacity: 1; } to { transform: none; opacity: 1; filter: none; } }
@keyframes nge-proj-flicker { 0%, 96%, 100% { opacity: 1; } 97% { opacity: 0.55; } 98% { opacity: 0.95; } 99% { opacity: 0.7; } }
.nge-stat-ic { width: 16px; height: 12px; vertical-align: -2px; margin-right: 6px; }
.nge-callout-box > .nge-frame-host { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.nge-callout-box .nge-frame .spark { display: none; }
.nge-callout-kicker { font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.32em; text-transform: uppercase; color: rgba(126, 224, 255, 0.7); }
.nge-callout-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin: 10px 0 0; padding-top: 10px; border-top: 1px solid rgba(126, 224, 255, 0.25); }
.nge-callout-stats > div { min-width: 0; }
.nge-callout-stats dt { color: rgba(126, 202, 255, 0.85); font: 600 9px/1.4 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; }
.nge-callout-stats dd { margin: 2px 0 0; color: #f2fbff; font: 500 15px/1.3 'Inter', sans-serif; letter-spacing: 0.005em; }
.nge-callout-beam { }
@keyframes nge-beam { 50% { opacity: 0.65; } }
@media (prefers-reduced-motion: reduce) { .nge-callout-box, .nge-callout-beam, .nge-callout--in .nge-callout-box, .nge-callout--in .nge-callout-box > *, .nge-callout--in .nge-callout-beamg { animation: none !important; opacity: 1; } }
.nge-callout-title { display: flex; align-items: center; gap: 10px; margin-top: 3px; font: 700 21px/1.15 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; color: #fff; text-shadow: 0 0 14px rgba(126, 210, 255, 0.55); }
.nge-callout-ic { width: 11px; height: 11px; border-radius: 50%; background: var(--part, #7ecaff); box-shadow: 0 0 10px var(--part, #7ecaff); flex: none; }
.nge-callout-box { isolation: isolate; }
.nge-callout-box .nge-callout-kicker { color: rgba(140, 215, 255, 0.75); }
.nge-callout-box .nge-callout-title { color: #aeeaff; text-shadow: 0 0 12px rgba(80, 190, 255, 0.7); font-size: 18px; gap: 9px; }
.nge-callout-box { min-width: 200px !important; max-width: min(380px, 44vw) !important; padding: 13px 18px 15px !important; }
.nge-callout-box .nge-callout-kicker { font-size: 10px; display: flex; align-items: center; gap: 7px; color: #9fdcff; }
.nge-callout-box .nge-callout-stats { gap: 6px 14px; margin-top: 7px; padding-top: 7px; }
.nge-callout-box .nge-callout-stats dt { font-size: 9.5px; }
.nge-callout-box .nge-callout-stats dd { font-size: 15px; }
.nge-callout-box .nge-callout-stats .num { font-size: 22px; }
.nge-callout-box .nge-callout-stats .unit { font-size: 12px; }
.nge-callout-box .nge-callout-ic { width: 10px; height: 10px; }
/* large monitors: the hologram and the panel grow with the screen (Ames) */
@media (min-width: 1700px) {
  .nge-callout-box { max-width: min(460px, 30vw) !important; padding: 16px 22px 18px !important; }
  .nge-callout-box .nge-callout-title { font-size: 22px; }
  .nge-callout-box .nge-callout-kicker { font-size: 11.5px; }
  .nge-callout-box .nge-callout-stats dt { font-size: 11px; }
  .nge-callout-box .nge-callout-stats dd { font-size: 18px; }
  .nge-callout-box .nge-callout-stats .num { font-size: 28px; }
  .nge-callout-box .nge-callout-stats .unit { font-size: 14px; }
  .nge-callout-stats .grp { font-size: 11px; }
  .nge-intro { width: min(720px, calc(100vw - 24px)); font-size: 18px; }
  .nge-intro .nge-intro-title { font-size: 26px; }
}
@media (min-width: 2400px) {
  .nge-callout-box .nge-callout-title { font-size: 26px; }
  .nge-callout-box .nge-callout-stats dd { font-size: 21px; }
  .nge-callout-box .nge-callout-stats .num { font-size: 34px; }
  .nge-intro { width: min(860px, calc(100vw - 24px)); font-size: 20px; }
}
.nge-callout-stats .wide { grid-column: 1 / -1; }
.nge-callout-box .nge-callout-stats { grid-template-columns: auto auto; justify-content: start; column-gap: 26px; row-gap: 9px; }
.nge-callout-box .nge-callout-stats dd { line-height: 1.25; }
.nge-callout-box .nge-callout-kicker { display: block; }
.nge-callout-stats .grp { grid-column: 1 / -1; margin-top: 4px; font: 600 9px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.24em; text-transform: uppercase; color: #c4efff; }
.nge-callout-stats .grp + div dt, .nge-callout-stats .grp + div + div dt { opacity: 0.85; }
.nge-callout-box .nge-callout-stats { border-top-color: rgba(126, 224, 255, 0.3); }
.nge-callout-box .nge-callout-stats dt { color: rgba(120, 200, 255, 0.8); }
.nge-callout-box .nge-callout-stats dd { color: #9fdcff; }
.nge-callout-box .nge-callout-stats .num { color: #c4efff; text-shadow: 0 0 10px rgba(80, 190, 255, 0.55); }
.nge-callout-box .nge-callout-stats .unit { color: rgba(140, 205, 255, 0.75); }
`;
  document.head.appendChild(st);
}

let panel: HTMLElement | null = null;
let callout: HTMLElement | null = null;
let calloutRaf = 0;
let typeTimer: ReturnType<typeof setInterval> | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

const plain = (marked: string) => marked.replace(/\*\*/g, '').replace(/\{\w+:([^}]+)\}/g, '$1');
function type(el: HTMLElement, marked: string) {
  // **word** is bold (Ames: bold "connectome"); typed as plain text, then
  // the emphasis lands when the line is complete
  const text = plain(marked);
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = esc(marked).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\{(\w+):([^}]+)\}/g, '<span class="nge-w-$1">$2</span>');
  const finish = () => { el.innerHTML = html; };
  if (typeTimer) clearInterval(typeTimer);
  el.textContent = '';
  let i = 0;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { finish(); return; }
  typeTimer = setInterval(() => {
    i = Math.min(text.length, i + 2);
    el.textContent = text.slice(0, i);
    if (i >= text.length && typeTimer) { clearInterval(typeTimer); typeTimer = null; finish(); }
  }, 22);
  // a tap on the text finishes it at once
  el.onclick = () => { if (typeTimer) { clearInterval(typeTimer); typeTimer = null; } finish(); };
}

/** The frame (Ames: "like circuits but SLIGHTLY curved"): a rim with cut
 *  corners whose joints are softly rounded, and circuit traces that run
 *  along the inside of each edge, step in on 45 degree bends with rounded
 *  elbows, and end in small ring pads. Drawn to the box's own size. */
function frameSvg(w: number, h: number, cut = 14): string {
  const c = cut, r = 4;
  // a polyline with each elbow rounded by r
  const soft = (pts: number[][], closed = false): string => {
    const n = pts.length, P = (i: number) => pts[(i + n) % n];
    const lerp = (p: number[], q: number[], d: number) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, k = Math.min(0.5, d / L); return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]; };
    const f = (v: number[]) => `${v[0].toFixed(1)} ${v[1].toFixed(1)}`;
    let d = '';
    const first = closed ? lerp(P(0), P(1), r) : P(0);
    d += `M${f(first)}`;
    const last = closed ? n : n - 1;
    for (let i = 1; i <= last; i++) {
      const cur = P(i);
      if (!closed && i === n - 1) { d += ` L${f(cur)}`; break; }
      const inA = lerp(cur, P(i - 1), r), outB = lerp(cur, P(i + 1), r);
      d += ` L${f(inA)} Q${f(cur)} ${f(outB)}`;
    }
    return d + (closed ? ' Z' : '');
  };
  const rim = soft([[c, 0], [w, 0], [w, h - c], [w - c, h], [0, h], [0, c]], true);
  const traces: string[] = [], pads: string[] = [];
  let k = 0;
  // one trace: leaves the rim at `from`, steps in by `inset` on a 45 degree
  // bend, runs `len` along the edge, and may step in again before its pad
  const trace = (x: number, y: number, dx: number, dy: number, nx: number, ny: number, len: number, inset = 6, second = 0) => {
    const at = (a: number, b: number) => [x + dx * a + nx * b, y + dy * a + ny * b];
    const pts = [at(0, 0), at(inset, inset), at(inset + len, inset)];
    if (second) pts.push(at(inset + len + second, inset + second));
    traces.push(`<path pathLength="1" style="--i:${k}" d="${soft(pts)}"/>`);
    const e = pts[pts.length - 1];
    pads.push(`<circle class="pad" style="--i:${k}" cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="2.1"/>`);
    k++;
    return soft(pts);
  };
  const sparks: string[] = [];
  // top edge: two traces in from the right, one from the left
  sparks.push(trace(w - 18, 0, -1, 0, 0, 1, Math.min(90, w * 0.22), 6, 6));
  trace(w - 26, 0, -1, 0, 0, 1, Math.min(46, w * 0.12), 12);
  trace(c + 14, 0, 1, 0, 0, 1, Math.min(54, w * 0.14), 6);
  // right edge, downward
  sparks.push(trace(w, 16, 0, 1, -1, 0, Math.min(h * 0.35, 46), 6, 5));
  // bottom edge: from the left going right, and from the right going left
  sparks.push(trace(14, h, 1, 0, 0, -1, Math.min(110, w * 0.26), 6, 6));
  trace(22, h, 1, 0, 0, -1, Math.min(52, w * 0.13), 12);
  trace(w - c - 16, h, -1, 0, 0, -1, Math.min(70, w * 0.18), 6);
  // left edge, upward
  trace(0, h - 14, 0, -1, 1, 0, Math.min(h * 0.32, 40), 6);
  const sp = sparks.map((d, n) => `<path class="spark" pathLength="1" style="--i:${n}" d="${d}"/>`).join('');
  return `<svg class="nge-frame" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="rim" pathLength="1" d="${rim}"/>${traces.join('')}${sp}${pads.join('')}</svg>`;
}

const CHEV_L = '<svg class="chev" width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M9.5 2L4.5 7l5 5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The colour of each anchor's part, for its icon, beam and dot. */
const ANCHOR_HEX: Record<string, string> = {soma: '#ffd24d', dendrite: '#9b72ff', axon: '#5ec8ff', synapse: '#c9f6ff', presyn: '#ff8f8f'};

/** The 3D panel and a point in nanometres, to a point on screen. */
function toScreen(p: V3): [number, number] | null {
  const nm = nmPerUnit();
  const panelEl = threeDPanel();
  const vp = panelEl?.projectionParameters?.value?.viewProjectionMat;
  if (!vp || !nm) return null;
  const g = [p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]];
  const w = vp[3] * g[0] + vp[7] * g[1] + vp[11] * g[2] + vp[15];
  if (w <= 0) return null;
  const x = (vp[0] * g[0] + vp[4] * g[1] + vp[8] * g[2] + vp[12]) / w, y = (vp[1] * g[0] + vp[5] * g[1] + vp[9] * g[2] + vp[13]) / w;
  const r = panelEl.element.getBoundingClientRect();
  return [r.left + (x + 1) / 2 * r.width, r.top + (1 - y) / 2 * r.height];
}

/** Little marks for the synapse stats: a signal coming in to the cell, or
 *  going out of it. */
const STAT_ICON: Record<string, string> = {
  Input: '<svg class="nge-stat-ic" viewBox="0 0 16 12" aria-hidden="true"><path d="M1 6h8M6 2.5L9.5 6 6 9.5" fill="none" stroke="#ffd24d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.5" cy="6" r="2.6" fill="#ffd24d"/></svg>',
  Output: '<svg class="nge-stat-ic" viewBox="0 0 16 12" aria-hidden="true"><circle cx="3.5" cy="6" r="2.6" fill="#ff5fd2"/><path d="M7 6h8M11.5 2.5L15 6l-3.5 3.5" fill="none" stroke="#ff5fd2" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const PHONE_DROP = ['Contains', 'Location', 'Note', 'Neurotransmitter', 'Class', 'Cell type', 'Branch length', 'All its branches',
  'With the Martinotti cell', 'Hears most from', 'Sends most to'];
function portraitK(): number {
  const pe = threeDPanel()?.element as HTMLElement | undefined;
  const r = pe?.getBoundingClientRect();
  const asp = r && r.height > 50 ? r.width / r.height : window.innerWidth / Math.max(1, window.innerHeight);
  return Math.max(1, Math.min(2.2, 1.5 / asp));
}
function isPhone(): boolean { return window.matchMedia?.('(max-width: 820px)').matches ?? false; }
function showCallout(anchor: V3, title: string, stats: [string, string][] = [], color = '#7ee0ff', pointAt = true, showDot = true) {
  hideCallout();
  pointAt = false;   // no line from the ship to the part: it crossed the ship (Ames)
  callout = document.createElement('div');
  callout.className = 'nge-callout';
  // on phones the hologram is minimal: "Pyr scan", the part's color and
  // its numbers; no title (the panel says it) and no wordy rows (Ames)
  if (isPhone()) stats = stats.filter(([k]) => !PHONE_DROP.includes(k));
  const rows = stats.length;
  // The box is a hologram the Starship projects: a cone of light from the
  // ship up to it (Ames), and a fine line from it down to the part.
  callout.innerHTML = `<svg aria-hidden="true"><defs><linearGradient id="nge-beam-g" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9fefff" stop-opacity="0.42"/><stop offset="0.55" stop-color="#4fb8ff" stop-opacity="0.1"/><stop offset="1" stop-color="#4fb8ff" stop-opacity="0.2"/></linearGradient></defs>
    <defs><pattern id="nge-beam-lines" patternUnits="userSpaceOnUse" width="12" height="7"><rect y="0" width="12" height="1.1" fill="#bff4ff" fill-opacity="0.32"/>
      <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="0 -7" dur="0.5s" repeatCount="indefinite"/></pattern>
      <filter id="nge-beam-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter></defs>
    <g class="nge-callout-beamg"><polygon class="nge-callout-beam" fill="rgba(126, 224, 255, 0.13)"/>
      <line class="nge-beam-edge e1" style="display:none"/><line class="nge-beam-edge e2" style="display:none"/><line class="nge-beam-seam" style="display:none"/><g class="nge-beam-motes"></g></g><line class="nge-callout-pointer" stroke="${color}" stroke-width="1.6" stroke-linecap="round" style="filter: drop-shadow(0 0 4px ${color})"/>
    <circle class="nge-callout-dot" r="4.5" fill="${color}" style="filter: drop-shadow(0 0 6px ${color})"/><circle class="nge-callout-lens" r="3.5" fill="#e6fbff"/></svg>
    <div class="nge-callout-box" style="--part:${color}"><span class="nge-frame-host"></span><div class="nge-callout-kicker"><span class="nge-callout-kdot"></span>Pyr scan<span class="nge-callout-kname">: ${title}</span></div><div class="nge-callout-title"><span class="nge-callout-ic"></span>${title}</div>${rows ? `<dl class="nge-callout-stats">${statsHtml(stats)}</dl>` : ''}</div>`;
  document.body.appendChild(callout);
  const beam = callout.querySelector('polygon')!, grad = callout.querySelector('linearGradient')!;
  const edges = [...callout.querySelectorAll('.nge-beam-edge')] as SVGLineElement[];
  const beams = [...callout.querySelectorAll('polygon.nge-callout-beam')] as SVGPolygonElement[];
  const seam = callout.querySelector('.nge-beam-seam') as SVGLineElement;
  const moteG = callout.querySelector('.nge-beam-motes') as SVGGElement;
  const motes = Array.from({length: 0}, (_, k) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', String(0.8 + Math.random() * 1.4)); c.setAttribute('fill', '#e6fbff'); moteG.appendChild(c);
    return {c, u: k / 18, x: Math.random(), v: 0.25 + Math.random() * 0.35};
  });
  let moteLast = performance.now();
  const line = callout.querySelector('line')!, dot = callout.querySelector('.nge-callout-dot')!, lens = callout.querySelector('.nge-callout-lens') as SVGElement;
  const box = callout.querySelector('.nge-callout-box') as HTMLElement;
  const host = box.querySelector('.nge-frame-host') as HTMLElement;
  // drawn at the box's real size, and again whenever that changes, so the
  // rim never stretches
  let fw = 0, fh = 0;
  const redraw = () => { const w = box.offsetWidth, h = box.offsetHeight; if (w && h && (w !== fw || h !== fh)) { fw = w; fh = h; host.innerHTML = calloutFrame(w, h); } };
  redraw();
  try { new ResizeObserver(redraw).observe(box); } catch { /* drawn once */ }
  let cx = -1, cy = -1, stillSince = 0;
  const step = () => {
    const s = toScreen(anchor);
    const shipNm = starshipAt();
    const ship = shipNm ? toScreen(shipNm) : null;
    // the ship projects its message only once it holds still (Ames)
    // and once the camera has settled too (Ames: "soma box appears while the ship is flying")
    callout?.classList.toggle('nge-callout--in', !starshipMoving() && performance.now() > camBusyUntil);
    if (s && callout) {
      const W = window.innerWidth, panelTop = panel ? panel.getBoundingClientRect().top : window.innerHeight;
      const bw = box.offsetWidth, bh = box.offsetHeight;
      const onScreen = ship && ship[0] > 0 && ship[0] < W && ship[1] > 60 && ship[1] < panelTop;
      let bx: number, by: number;
      if (onScreen) {
        // above the ship, leaning away from the part so the part stays clear
        const lean = ship![0] < s[0] ? -1 : 1;
        if (ship![1] - 90 - bh >= 70) { bx = ship![0] - bw / 2 + lean * 60; by = ship![1] - 90 - bh; }
        else { const r = ship![0] + 60 + bw < W - 10; bx = r ? ship![0] + 60 : ship![0] - 60 - bw; by = ship![1] - bh / 2; }
      } else {
        const right = s[0] < W * 0.55;
        bx = right ? s[0] + 70 : s[0] - 70 - bw;
        by = s[1] - 110 - bh / 2;
      }
      bx = Math.max(10, Math.min(W - bw - 10, bx));
      by = Math.max(70, Math.min(panelTop - bh - 16, by));
      // the box glides after its spot rather than jumping with every bob
      if (cx < 0 || starshipMoving()) { cx = bx; cy = by; stillSince = performance.now(); }
      else if (performance.now() - stillSince < 400) { cx += (bx - cx) * 0.2; cy += (by - cy) * 0.2; }
      bx = cx; by = cy;
      box.style.left = `${bx.toFixed(1)}px`; box.style.top = `${by.toFixed(1)}px`;
      if (onScreen) {
        const [sx, sy] = ship!;
        const side = sx < bx;   // projecting sideways, to the box's near edge
        box.style.transformOrigin = side ? '0% 50%' : '50% 100%';
        const ends = side ? [[bx, by + 8], [bx, by + bh - 8]] : [[bx + 6, by + bh], [bx + bw - 6, by + bh]];
        beams.forEach(b2 => b2.setAttribute('points', `${sx},${sy} ${ends[0][0]},${ends[0][1]} ${ends[1][0]},${ends[1][1]}`));
        seam.setAttribute('x1', String(ends[0][0])); seam.setAttribute('y1', String(ends[0][1])); seam.setAttribute('x2', String(ends[1][0])); seam.setAttribute('y2', String(ends[1][1]));
        const tNow = performance.now(), mdt = Math.min(0.05, (tNow - moteLast) / 1000); moteLast = tNow;
        for (const m of motes) {
          m.u += m.v * mdt; if (m.u > 1) { m.u -= 1; m.x = Math.random(); }
          const ex = ends[0][0] + (ends[1][0] - ends[0][0]) * m.x, ey = ends[0][1] + (ends[1][1] - ends[0][1]) * m.x;
          m.c.setAttribute('cx', (sx + (ex - sx) * m.u).toFixed(1)); m.c.setAttribute('cy', (sy + (ey - sy) * m.u).toFixed(1));
          m.c.setAttribute('opacity', (Math.sin(Math.PI * m.u) * 0.85).toFixed(2));
        }
        edges.forEach((e, k) => { e.setAttribute('x1', String(sx)); e.setAttribute('y1', String(sy)); e.setAttribute('x2', String(ends[k][0])); e.setAttribute('y2', String(ends[k][1])); });

        grad.setAttribute('x1', String(sx)); grad.setAttribute('y1', String(sy));
        grad.setAttribute('x2', String(side ? bx : bx + bw / 2)); grad.setAttribute('y2', String(side ? by + bh / 2 : by + bh));
        lens.setAttribute('cx', String(sx)); lens.setAttribute('cy', String(sy));
        beam.style.display = lens.style.display = '';
        beams.forEach(e => { e.style.display = ''; });
      } else {
        beam.style.display = lens.style.display = 'none';
        edges.forEach(e => { e.style.display = 'none'; }); beams.forEach(e => { e.style.display = 'none'; }); seam.style.display = moteG.style.display = 'none';
      }
      // the ship points its beam at the part; the long parts get just the dot
      if (pointAt && onScreen) {
        line.setAttribute('x1', String(ship![0])); line.setAttribute('y1', String(ship![1]));
        line.setAttribute('x2', String(s[0])); line.setAttribute('y2', String(s[1]));
        line.style.display = '';
      } else line.style.display = 'none';
      dot.setAttribute('cx', String(s[0])); dot.setAttribute('cy', String(s[1]));
      (dot as SVGElement).style.display = showDot ? '' : 'none';
    }
    calloutRaf = requestAnimationFrame(step);
  };
  calloutRaf = requestAnimationFrame(step);
}
function hideCallout(zip = false) {
  cancelAnimationFrame(calloutRaf);
  const c = callout;
  callout = null;
  if (!c) return;
  if (zip && c.classList.contains('nge-callout--in')) { c.classList.add('nge-callout--zip'); setTimeout(() => c.remove(), 460); }
  else c.remove();
}
/** The stats in a scan box. Synapse counts go under one Synapses label as
 *  bare numbers (Ames: "SYNAPSES / INPUT / OUTPUT", no "synapses" below). */
function statsHtml(stats: [string, string][]): string {
  let grouped = false;
  return stats.map(([k, v]) => {
    const m = /^([\d][\d,.]*)\s+synapses$/.exec(v);
    if (m) {
      const head = grouped ? '' : '<div class="grp">Synapses</div>';
      grouped = true;
      return `${head}<div><dt>${STAT_ICON[k] ?? ''}${k.replace(/s$/, '')}</dt><dd><span class="num">${m[1]}</span></dd></div>`;
    }
    return `<div${k === 'Location' || k === 'Hears most from' || k === 'Sends most to' || k === 'For scale' || k === 'Contains' || k === 'Note' || k === 'With the Martinotti cell' ? ' class="wide"' : ''}><dt>${STAT_ICON[k] ?? ''}${isPhone() && (k === 'Input' || k === 'Output') ? `${k} synapses` : k}</dt><dd>${statValue(v)}</dd></div>`;
  }).join('');
}
/** A number set large with its unit beneath ("3,386 synapses"). */
function statValue(v: string): string {
  const m = /^([\d][\d,.]*)\s+(.+)$/.exec(v);
  return m ? `<span class="num">${m[1]}</span><span class="unit">${m[2]}</span>` : v;
}
/** The scan box's glass and rim, the panel's look made simpler: the cut
 *  corners, a fine cyan edge, one short trace at two corners. */
function calloutFrame(w: number, h: number): string {
  const c = 12, f = (n: number) => n.toFixed(1);
  const rim = `M${c} 0.5 H${f(w - 0.5)} V${f(h - c)} L${f(w - c)} ${f(h - 0.5)} H0.5 V${c} Z`;
  const a = Math.min(64, w * 0.2), b = Math.min(48, w * 0.15);
  return `<svg class="nge-co-frame" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="nge-co-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(30,110,200)" stop-opacity="0.34"/><stop offset="0.6" stop-color="rgb(10,50,120)" stop-opacity="0.42"/><stop offset="1" stop-color="rgb(20,70,160)" stop-opacity="0.36"/></linearGradient>
      <pattern id="nge-co-scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="rgba(126,224,255,0.09)"/></pattern></defs>
    <path d="${rim}" fill="url(#nge-co-bg)"/><path d="${rim}" fill="url(#nge-co-scan)"/>
    <path d="${rim}" fill="none" stroke="rgba(140,225,255,0.75)" stroke-width="1"/>
    <path class="tr" d="M${f(w - 16)} 0.5 l-6 6 h-${f(a)}"/><circle class="pad" cx="${f(w - 22 - a)}" cy="6.5" r="2"/>
    <path class="tr" d="M16 ${f(h - 0.5)} l6 -6 h${f(b)}"/><circle class="pad" cx="${f(22 + b)}" cy="${f(h - 6.5)}" r="2"/></svg>`;
}

/** Some browsers show less than the page's full height (a short window, a
 *  toolbar over the bottom, zoom): lift the panel so it is always seen
 *  (Ames 2026-11-08: a tester's panel ran off the bottom). */
function keepOnScreen(el: HTMLElement) {
  const fit = () => {
    if (!el.isConnected) { window.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('resize', fit); clearInterval(timer); return; }
    const docH = document.documentElement.clientHeight || window.innerHeight;
    const nav = document.querySelector('.nge-mobile-nav') as HTMLElement | null;
    const navH = nav && nav.offsetParent !== null ? nav.getBoundingClientRect().height : 0;
    const visibleBottom = Math.min(window.innerHeight, docH) - navH;
    // placed from the top by its own measured height, so it sits inside
    // the visible window whatever the browser makes of bottom (Firefox)
    const h = el.offsetHeight;
    if (!h) return;
    el.style.bottom = 'auto';
    el.style.top = `${Math.max(8, visibleBottom - 28 - h).toFixed(0)}px`;
    if (!logged) {
      logged = true;
      const r = el.getBoundingClientRect();
      console.warn(`[intro] panel at ${Math.round(r.top)}-${Math.round(r.bottom)} of ${window.innerHeight} (doc ${docH}, vv ${Math.round(window.visualViewport?.height ?? -1)}), ${navigator.userAgent.slice(-40)}`);
    }
  };
  let logged = false;
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  const timer = setInterval(fit, 1000);
  try { new ResizeObserver(fit).observe(el); } catch { /* the timer covers it */ }
  requestAnimationFrame(fit);
}

/* ── running the tour ── */
let active = false;
let savedTint: NgeMeshTint | null = null;

function endTour() {
  if (!active) return;
  active = false;
  hideCallout(); stopSpark(); stopPulse(); stopAllSynapses();
  cancelAnimationFrame(camRaf); cancelAnimationFrame(tintRaf);
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  if (onKey) { window.removeEventListener('keydown', onKey, true); onKey = null; }
  setNgeMeshTint(savedTint);
  setHoverHighlight(true);
  // the partner cells the tour brought in go again
  for (const id of [...added]) hideCell(id);
  setStarshipCameraHeld(false);
  document.body.classList.remove('nge-intro-on');
  if (panel) { const p = panel; p.classList.add('nge-intro--out'); setTimeout(() => p.remove(), 450); panel = null; }
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

export async function startIntroTour() {
  console.warn('[intro] tour starting', active ? '(already running)' : '');
  if (active) return;
  try { await loadTour(); } catch (e) { console.warn('[intro] no tour:', e); return; }
  const t = tour!;
  active = true;
  savedTint = getNgeMeshTint();
  setStarshipCameraHeld(true);
  try { viewerNow().selectedLayer.visible = false; } catch { /* no panel */ }
  ensureStyle();
  panel = document.createElement('section');
  panel.className = 'ng-extend nge-intro' + (window.innerWidth < 700 ? ' nge-intro--phone' : '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Welcome to Pyr');
  const X_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  panel.innerHTML = `<span class="nge-intro-plate-bg"></span><span class="nge-frame-host"></span><span class="nge-intro-ring"></span><span class="nge-intro-scan"></span>
    <div class="nge-intro-head"><span class="nge-intro-dot"></span>Transmission received · Pyr<span class="nge-step"></span><button class="nge-intro-x" type="button" aria-label="Leave the introduction">${X_SVG}</button></div>
    <div class="nge-intro-title"></div><p class="nge-intro-body" aria-live="polite"></p>
    <div class="nge-intro-row"><button class="nge-back nge-intro-back" type="button" aria-label="Back">${CHEV_L}</button>
      <span class="nge-intro-key" hidden><i style="--c:#9b72ff"></i>Soma and dendrites<i style="--c:#5ec8ff"></i>Axons<i style="--c:#ffa64d"></i>Other cells<i style="--c:#ffd24d" class="dot"></i>Input synapses<i style="--c:#ff5fd2" class="dot"></i>Output synapses</span>
      <span class="nge-intro-choose" hidden>Choose your next adventure</span>
      <button class="nge-go nge-go--alt nge-intro-alt" type="button" hidden><span class="nge-go-label">Explore a bigger neuron</span></button>
      <button class="nge-intro-zap" type="button" hidden aria-label="Send an action potential" title="Send an action potential"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4.5 13.5h6.2L9.5 22l9-11.5h-6.2z" fill="currentColor"/></svg></button>
      <button class="nge-go nge-intro-go" type="button"><span class="nge-go-label nge-intro-label"></span><span class="nge-go-chevs" aria-hidden="true"><i></i><i></i><i></i></span></button></div>
    <div class="nge-intro-confirm" role="alertdialog" aria-label="Leave the introduction?"><p>Leave the introduction?</p><small>You can start mapping right away.</small>
      <div class="nge-intro-row"><span style="flex:1"></span><button class="nge-go nge-go--alt nge-intro-leave" type="button"><span class="nge-go-label">Leave</span></button><button class="nge-go nge-intro-stay" type="button"><span class="nge-go-label">Keep going</span><span class="nge-go-chevs" aria-hidden="true"><i></i><i></i><i></i></span></button></div></div>`;
  document.body.appendChild(panel);
  document.body.classList.add('nge-intro-on');
  keepOnScreen(panel);
  {
    // the frame follows the panel's real size: the "Leave the introduction?"
    // question and the last page change its shape (Ames)
    const tp = panel, host = tp.querySelector('.nge-frame-host') as HTMLElement;
    let fw = 0, fh = 0;
    const redrawFrame = () => { const w = tp.offsetWidth, h = tp.offsetHeight; if (w && h && (w !== fw || h !== fh)) { fw = w; fh = h; host.innerHTML = frameSvg(w, h, 18); } };
    try { new ResizeObserver(redrawFrame).observe(tp); } catch { /* drawn on each page */ }
  }
  requestAnimationFrame(() => panel?.classList.add('nge-intro--in'));
  const titleEl = panel.querySelector('.nge-intro-title') as HTMLElement;
  const bodyEl = panel.querySelector('.nge-intro-body') as HTMLElement;
  const nextEl = panel.querySelector('.nge-intro-go') as HTMLButtonElement;
  const labelEl = panel.querySelector('.nge-intro-label') as HTMLElement;
  const backEl = panel.querySelector('.nge-intro-back') as HTMLButtonElement;
  const altEl = panel.querySelector('.nge-intro-alt') as HTMLButtonElement;
  const zapEl = panel.querySelector('.nge-intro-zap') as HTMLButtonElement;
  const stayEl = panel.querySelector('.nge-intro-stay') as HTMLButtonElement;
  const ask = (on: boolean) => {
    panel?.classList.toggle('nge-intro--asking', on);
    (on ? stayEl : nextEl).focus({preventScroll: true});
  };
  // the X asks first; pressed again while it asks, it leaves (Ames: "wouldn't let me click the X")
  // leaving takes the Starship (and its portal and holograms) away too (Ames)
  const leave = () => { endTour(); stopZap(); clearStarship(); };
  (panel.querySelector('.nge-intro-x') as HTMLButtonElement).onclick = () => { if (panel?.classList.contains('nge-intro--asking')) leave(); else ask(true); };
  (panel.querySelector('.nge-intro-leave') as HTMLButtonElement).onclick = leave;
  stayEl.onclick = () => ask(false);

  const indexOf = (key: string) => BEATS.findIndex(b => b.key === key);
  const NEURON = indexOf('neuron'), SOMA = indexOf('soma'), SYN2 = indexOf('synapse2'), DEND = indexOf('dendrites'), AXON = indexOf('axon'), SYN = indexOf('synapse');
  let i = -1;
  let shipAt: 'pad' | 'soma' | 'dend' | 'axon' | 'syn' | 'syn2' | 'dock' = 'pad';
  const go = (n: number) => {
    if (!active || n < 0) return;
    if (n >= BEATS.length) { endTour(); return; }
    const from = i;
    i = n;
    const b = BEATS[i];
    // parked at the side for the whole cell; for the soma it flies in close,
    // engines on, ahead of the camera (Ames: no jets, wrong size when it rode along)
    const want = i === NEURON ? 'dock' : i === SOMA ? 'soma' : i < DEND ? 'pad' : i < AXON ? 'dend' : i < SYN ? 'axon' : i < SYN2 ? 'syn' : 'syn2';
    const shipMoves = want !== shipAt;
    const zipping = !!callout;
    const shipDelay = zipping ? 440 : 0;
    void from;
    // (pulling back for the dendrites the camera goes with the ship from the
    // start, or it climbed out of the frame: Ames)
    const camDelay = shipDelay + (shipMoves ? (want === 'dend' && shipAt === 'soma' ? 350 : 1300) : 0);
    titleEl.textContent = b.header ?? b.callout?.title ?? '';
    if (from >= 0 && panel) { panel.classList.remove('nge-intro--beat'); void panel.offsetWidth; panel.classList.add('nge-intro--beat'); }
    const last = b.key === 'connectome';
    labelEl.textContent = last ? 'Start playing Pyr' : (b.next ?? 'Next');
    altEl.hidden = !last;
    (panel?.querySelector('.nge-intro-choose') as HTMLElement).hidden = !last;
    (panel?.querySelector('.nge-intro-key') as HTMLElement).hidden = !last;
    panel?.classList.toggle('nge-intro--choice', last);
    backEl.hidden = i === 0;
    // Size the panel for the whole text first, so it holds still while the
    // words type in and the camera can frame the cell above it.
    bodyEl.style.minHeight = '';
    // (on phones the neuron step once added its numbers here; Ames took
    // them out again, the panel is long enough)
    const bodyText = b.body;
    const holo = !!b.callout && !(isPhone() && (b.key === 'neuron' || b.key === 'axon'));
    bodyEl.textContent = plain(bodyText);
    bodyEl.style.minHeight = `${Math.min(bodyEl.offsetHeight, window.innerHeight * 0.36)}px`;
    if (panel) (panel.querySelector('.nge-frame-host') as HTMLElement).innerHTML = frameSvg(panel.offsetWidth, panel.offsetHeight, 18);
    // the words wait for the ship: the box steps aside while it flies and
    // comes back with the new message when it has stopped
    if (bodyEl) bodyEl.textContent = '';
    panel?.classList.add('nge-intro--waiting');
    const shown0 = performance.now();
    // staged: the ship stops, its hologram builds in, then the panel comes
    // (Ames: "do we want to stage the load ins of these?")
    let holoAt = 0;
    // the step's number, on the test sites, so testers can name a box (Ames)
    { const st = panel?.querySelector('.nge-step') as HTMLElement | null; if (st) st.textContent = IS_LIVE_SITE ? '' : ` · ${n + 1}`; }
    const reveal = () => {
      if (!active || i !== n) return;
      const now0 = performance.now(), late = now0 - shown0 > 14000;
      const flying = starshipMoving() && now0 - shown0 < 12000;
      if (holo && !late) {
        if (!holoAt && document.querySelector('.nge-callout--in')) holoAt = now0;
        if (!holoAt || now0 - holoAt < 700) { requestAnimationFrame(reveal); return; }
      }
      if (flying || now0 - shown0 < (shipMoves ? shipDelay + 400 : 250)) { requestAnimationFrame(reveal); return; }
      panel?.classList.remove('nge-intro--waiting');
      type(bodyEl, bodyText);
    };
    requestAnimationFrame(reveal);
    hideCallout(true); stopSpark(); stopPulse(); stopAllSynapses();
    // the parts: ones met before this beat stay softly coloured, this one glows
    const shown = new Set<number>();
    for (let k = 0; k < i; k++) { const p = BEATS[k].part; if (p) shown.add(p); }
    cancelAnimationFrame(tintRaf);
    somaListens = i >= indexOf('allsyn');
    setNgeMeshTint(partsTint(shown));
    // the camera, framing the subject in the open space above the panel
    const camera = () => {
      if (!active || i !== n) return;
      let center: V3 = b.view.at === 'cell' ? cellCenter(t) : b.view.at === 'dendView' ? [306000, 200000, 70000] : t.anchors[b.view.at];
      // welcome: the soma and the ship on it, both well inside the frame
      const pad = t.dendFlight[0];
      if (b.key === 'welcome') center = [0, 1, 2].map(k => (center[k] + pad[k]) / 2) as V3;
      // the action potential: from up close where we are, a slow pull back
      // to the whole cell (no dash across to the axon first)
      const ms = b.key === 'spike' ? 5200 : b.key === 'welcome' ? 2200 : 1800;
      const shipLeft = starshipEta();
      // a portrait screen is narrow: pulled back to show the same width as a
      // wide one, so the ship never leaves it (Ames, on a phone)
      // (the axon is narrow: it needs much less, Ames: "zoomed in more")
      const vnm = b.view.nm * (b.key === 'synapse' || b.key === 'synapse2' ? 1 : b.key === 'dendrites' ? portraitK() : Math.min(b.key === 'axon' ? 1.8 : 1.25, portraitK()));
      const msNow = b.key === 'spike' ? ms : Math.max(ms, glideMs(framed(center, vnm), vnm, ms), shipLeft + 500);
      if (b.key === 'spike') setTimeout(() => { if (active && i === n) moveCamera(framed(center, vnm), vnm, ms); }, 1300);
      else if (!(b.key === 'welcome' && from < 0)) moveCamera(framed(center, vnm), vnm, msNow);
      setTimeout(() => { if (active && i === n) revealTint(shown, b.part); }, b.key === 'spike' ? 600 : ms * 0.55);
    };
    camBusyUntil = Math.max(camBusyUntil, performance.now() + camDelay + 120);
    setTimeout(camera, camDelay);
    // the partner cells are there from their beat on, and gone if we step back
    if (i < SYN) hideCell(t.synapsePartner);
    if (i < SYN2) hideCell(t.syn2Partner);
    // what happens in this beat
    // out to the edge of the cell for its stats card, home for the soma,
    // out by the dendrite tips, down the axon, over the synapse
    if (shipMoves) {
      const prev = shipAt;
      shipAt = want;
      setTimeout(() => { if (active) moveShip(prev, want, camDelay - shipDelay); }, shipDelay);
    }
    if (b.key === 'axon' && isPhone()) setTimeout(() => { if (active && i === n) runAxonPulse(t.axonPath); }, shipDelay + 1600);
    if (b.key === 'synapse') {
      // the downstream cell grows out from the synapse, not just appearing (Ames)
      if (from < n) growPartner(t.synapsePartner, t.anchors.synapse);
      showCell(t.synapsePartner, PARTNER_COLOR); runPulse(t.anchors.synapse);
    }
    if (b.key === 'synapse2') { showCell(t.syn2Partner, SYN2_COLOR); runPulse(t.anchors.synapse2, [1, 0.86, 0.45]); }
    // (not on the connectome step: the cells filling the volume say it, Ames)
    if (b.key === 'allsyn') runAllSynapses(t);
    if (b.key === 'connectome') fillVolume(); else emptyVolume();
    if (b.key === 'spike') runSpark(t);
    // a lightning button to send another one (Ames)
    zapEl.hidden = b.key !== 'spike';
    zapEl.onclick = () => {
      if (!active || i !== n) return;
      if (sparkFire) sparkFire(); else runSpark(t);
      zapEl.classList.remove('nge-intro-zap--fire'); void zapEl.offsetWidth; zapEl.classList.add('nge-intro-zap--fire');
    };
    if (holo) setTimeout(() => { if (active && i === n) showCallout(t.anchors[b.callout!.anchor], b.callout!.title, b.callout!.stats, b.key === 'neuron' ? '#4f8cff' : ANCHOR_HEX[b.callout!.anchor], b.key === 'soma' || b.key === 'synapse', b.key !== 'neuron'); }, shipDelay + 900);
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  };
  /** Off the pad, the ship hovers just above it: over the soma, on the
   *  viewer's side (Ames: the ship was behind the soma). */
  const somaHover = (): number[] => {
    // beside the soma and in front of it, not up at the trunk (Ames: it sat at
    // the top edge of the screen)
    const n2 = nmPerUnit(), c2 = n2 && cameraAxes(n2), so = t.anchors.soma;
    // (well out in front, so no branch passes over it: Ames, "branch
    // obstructing ship")
    if (c2) return so.map((x, k) => x + c2.right[k] * (isPhone() ? 9_000 : 12_000) + c2.up[k] * 5_000 + c2.toEye[k] * 24_000);
    const pad = t.dendFlight[0];
    return t.dendFlight.find(q => Math.hypot(q[0] - pad[0], q[1] - pad[1], q[2] - pad[2]) > 4500) ?? pad;
  };
  const nearest = (route: number[][], q: number[] | null) => {
    if (!q) return 0;
    let k = 0, best = Infinity;
    route.forEach((r, j) => { const d = Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]); if (d < best) { best = d; k = j; } });
    return k;
  };
  /** The part of a route from where the ship is now on to `to` (or its end). */
  const onward = (route: number[][], to?: number[]) => {
    const b2 = to ? nearest(route, to) : route.length - 1;
    const q = starshipAt();
    let a = nearest(route, q);
    if (q) {
      // the nearest point ahead: reaching it, the ship keeps going the way the route goes
      let best = Infinity;
      for (let j = 0; j < Math.min(route.length - 1, b2); j++) {
        const r = route[j], n2 = route[j + 1];
        const to2 = [r[0] - q[0], r[1] - q[1], r[2] - q[2]], dir = [n2[0] - r[0], n2[1] - r[1], n2[2] - r[2]];
        const d = Math.hypot(...to2), dl = Math.hypot(...dir) || 1;
        const ahead = (to2[0] * dir[0] + to2[1] * dir[1] + to2[2] * dir[2]) / (d * dl || 1);
        if (ahead > 0.35 && d < best) { best = d; a = j; }
      }
    }
    return route.slice(a, Math.max(a + 1, b2 + 1));
  };
  const moveShip = (from: typeof shipAt, want: typeof shipAt, camLag: number) => {
    {
      const shipAt = from;
      const aEnd = t.axonFlight[t.axonFlight.length - 1];
      if (want === 'soma') {
        if (shipAt === 'dock') undockStarship();
        if (shipAt === 'dend') starshipHop([...onward([...t.dendFlight].reverse(), t.dendFlight[0]), somaHover()], 5);
        else starshipHop([somaHover()], shipAt === 'dock' ? 3.6 : 2.6);
      } else if (shipAt === 'soma' && want === 'pad') starshipHop([t.dendFlight[0]], 2);
      else if (shipAt === 'soma' && want === 'dend') starshipHop(onward(t.dendFlight), 6.5);
      else if (want === 'dock') {
        // to the right side of the view, just left of where its card sits
        const pr = threeDPanel()?.element?.getBoundingClientRect?.();
        const cardW = Math.min(360, window.innerWidth * 0.42);
        const sx = pr ? (pr.right - cardW - 70 - (pr.left + pr.width / 2)) / (pr.width / 2) : 0.4;
        const nb = BEATS[NEURON];
        const est = glideMs(framed(cellCenter(t), nb.view.nm), nb.view.nm, 1800);
        dockStarship(Math.max(0.15, Math.min(0.75, sx + 0.2)), -0.2, Math.max(5200, camLag + est));
      } else if (shipAt === 'dock' && want === 'dend') {
        undockStarship();
        starshipHop(onward(t.dendFlight), 6.5);
      } else if (shipAt === 'dock') {
        undockStarship();
        starshipHop([t.dendFlight[0]], 3);
      } else
      if (shipAt === 'dend' && want === 'axon') starshipHop(t.axonFlight, 10, {from: 0.08, to: 0.42, turns: 2});
      else if (shipAt === 'axon' && want === 'dend') starshipHop([...t.axonFlight].reverse(), 6);
      else if (shipAt === 'syn' && want === 'syn2') starshipHop(t.syn2Flight, 6);
      else if (shipAt === 'syn2' && want === 'syn') starshipHop([...t.syn2Flight].reverse(), 5);
      else if (want === 'syn') starshipHop([aEnd, aboveSynapse(t, BEATS[SYN].view.nm)], 2.2);
      else if (shipAt === 'syn' && want === 'axon') starshipHop([aEnd], 2);
    }
  };
  // the end: choose your own adventure (Ames)
  nextEl.onclick = () => { if (BEATS[i]?.key === 'connectome') { endTour(); startGetStarted(); } else go(i + 1); };
  altEl.onclick = () => { endTour(); void exploreBiggerNeuron(); };
  backEl.onclick = () => go(i - 1);
  // Enter or the right arrow goes on, the left arrow goes back, Escape asks
  // to leave; held here so the viewer does not also move.
  onKey = (e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const asking = !!panel?.classList.contains('nge-intro--asking');
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); ask(!asking); return; }
    if (asking) return;
    if (tgt?.closest?.('.nge-intro button') && (e.key === 'Enter' || e.key === ' ')) return;   // the button clicks itself
    if (e.key === 'Enter' || e.key === 'ArrowRight') { e.stopPropagation(); e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.stopPropagation(); e.preventDefault(); go(i - 1); }
  };
  window.addEventListener('keydown', onKey, true);
  const startKey = pendingStart; pendingStart = null;
  go(startKey ? Math.max(0, indexOf(startKey)) : 0);
}
let pendingStart: string | null = null;
/** For testing (the Intro test panel): straight to "Choose your next
 *  adventure", with the ship already down. */
export function jumpToIntroChoice() {
  endTour();
  clearStarship();
  pendingStart = 'connectome';
  setTimeout(() => { void flyStarship(() => { void startIntroTour(); }, true); }, 150);
}

/** Start playing Pyr: the Get Started tutorial. */
function startGetStarted() {
  synapseMarks(null);
  clearStarship();
  stopAllSynapses();
  stopZap();
  hideCallout();
  // from the start, even for a player who finished it before (Ames: the
  // rocket's tour leads into it for everyone)
  const t = useTutorialStore();
  t.activeTutorial = 1;
  t.tutorialStep1 = -1;
  setTimeout(() => { t.setTutorialStep(0); }, 60);
}

/** The synapses two cells share as annotation points, drawn on top so they
 *  read clearly (Ames: "the synapses are hard to see can you use annotation
 *  points?"). Replaces the last set; none clears it. */
const MARKS = 'Shared synapses';
function synapseMarks(pointsNm: number[][] | null, color = '#ff5fd2') {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v?.layerManager) return;
  for (const m of [...(v.layerManager.managedLayers ?? [])]) if (m?.name === MARKS) { try { v.layerManager.removeManagedLayer(m); } catch { /* gone */ } }
  if (!pointsNm || !pointsNm.length || !nm) return;
  try {
    v.layerSpecification.add(makeLayer(v.layerSpecification, MARKS, {
      type: 'annotation', source: {url: 'local://annotations'},
      annotations: pointsNm.map((q, j) => ({type: 'point', id: `s${j}`, point: [q[0] / nm[0], q[1] / nm[1], q[2] / nm[2]]})),
      annotationColor: color, pointSize: 2.5, onTop: true,
    }));
    setTimeout(() => { try { v.selectedLayer.visible = false; } catch { /* no panel */ } }, 50);
  } catch (e) { console.warn('[intro] synapse marks', e); }
}

/** The public MICrONS release (materialization 1300, flat segmentation with
 *  meshes, no sign in), added once as its own layer. */
const PUBLIC_MICRONS = 'precomputed://gs://iarpa_microns/minnie/minnie65/seg_m1300';
async function publicMicronsLayer(): Promise<any> {
  const v = viewerNow();
  const find = () => (v.layerManager?.managedLayers ?? []).find((m: any) => !m?.archived && String(m?.layer?.dataSources?.[0]?.spec?.url ?? m?.initialSpecification?.source ?? '').includes('seg_m1300'));
  let ml = find();
  if (!ml) {
    try { v.layerSpecification.add(makeLayer(v.layerSpecification, 'MICrONS public', {type: 'segmentation', source: PUBLIC_MICRONS, segments: [BIG_NEURON]})); } catch (e) { console.warn('[intro] public MICrONS layer', e); return null; }
  }
  for (let k = 0; k < 80; k++) {
    ml = find();
    if (ml?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments) { ml.setVisible?.(true); return ml; }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

/** Explore a bigger neuron: over to MICrONS, a cubic millimetre of mouse
 *  visual cortex, to a neuron whose whole axon has been traced
 *  (864691135212863360: proofread, axon fully extended, the same since the
 *  v117 release Pyr shows). */
const BIG_NEURON = '864691135212863360';
const BIG_NEURON_NM: V3 = [1070976, 819008, 1007600];
/** A transmission card on its own (for MICrONS): the panel's look, a title,
 *  words, stats and buttons. Returns a way to change it and to close it. */
function transmissionCard() {
  ensureStyle();
  const card = document.createElement('section');
  card.className = 'ng-extend nge-intro' + (window.innerWidth < 700 ? ' nge-intro--phone' : '');
  card.setAttribute('role', 'dialog');
  card.innerHTML = `<span class="nge-intro-plate-bg"></span><span class="nge-frame-host"></span><span class="nge-intro-scan"></span>
    <div class="nge-intro-head"><span class="nge-intro-dot"></span>Transmission received · Pyr</div>
    <div class="nge-intro-title"></div><p class="nge-intro-body" aria-live="polite"></p><dl class="nge-callout-stats" hidden></dl><div class="nge-card-key" hidden></div><div class="nge-card-hint" hidden></div>
    <div class="nge-intro-row"><button class="nge-back nge-card-back" type="button" aria-label="Back" hidden>${CHEV_L}</button><span style="flex:1"></span>
      <button class="nge-go nge-go--alt nge-card-alt" type="button" hidden><span class="nge-go-label"></span></button>
      <button class="nge-go nge-intro-go" type="button" hidden><span class="nge-go-label"></span></button></div>`;
  document.body.appendChild(card);
  keepOnScreen(card);
  // the frame follows the card's real size (it was drawn once, before the
  // text and buttons settled, so it came out too small: Ames)
  const frameHost = card.querySelector('.nge-frame-host') as HTMLElement;
  let fw = 0, fh = 0;
  const redrawFrame = () => { const w = card.offsetWidth, h = card.offsetHeight; if (w && h && (w !== fw || h !== fh)) { fw = w; fh = h; frameHost.innerHTML = frameSvg(w, h, 18); } };
  try { new ResizeObserver(redrawFrame).observe(card); } catch { /* drawn on each set */ }
  requestAnimationFrame(() => card.classList.add('nge-intro--in'));
  const close = () => { card.classList.add('nge-intro--out'); setTimeout(() => card.remove(), 450); };
  // no X here: its button is the way back from MICrONS (Ames)
  const set = (title: string, body: string, stats: [string, string][] = [], button?: {label: string; go: () => void; keep?: boolean}, keyHtml = '',
    extra: {alt?: {label: string; go: () => void}; back?: () => void; hint?: boolean} = {}) => {
    // how to look around, where the cell is the player's to explore (Ames)
    const hintEl = card.querySelector('.nge-card-hint') as HTMLElement;
    hintEl.hidden = !extra.hint;
    if (extra.hint) {
      const touch = window.matchMedia?.('(pointer: coarse)').matches;
      hintEl.innerHTML = touch ? '<b>Pinch</b> to zoom <i></i> <b>Drag</b> to turn' : '<b>Scroll</b> to zoom <i></i> <b>Drag</b> to turn <i></i> <b>Right drag</b> to move';
    }
    const backEl = card.querySelector('.nge-card-back') as HTMLButtonElement;
    backEl.hidden = !extra.back; backEl.style.visibility = extra.back ? 'visible' : 'hidden'; backEl.onclick = () => extra.back?.();
    const altEl = card.querySelector('.nge-card-alt') as HTMLButtonElement;
    altEl.hidden = !extra.alt;
    if (extra.alt) { (altEl.querySelector('.nge-go-label') as HTMLElement).textContent = extra.alt.label; altEl.onclick = () => extra.alt!.go(); }
    const key = card.querySelector('.nge-card-key') as HTMLElement;
    key.hidden = !keyHtml; key.innerHTML = keyHtml;
    (card.querySelector('.nge-intro-title') as HTMLElement).textContent = title;
    const bodyEl = card.querySelector('.nge-intro-body') as HTMLElement;
    bodyEl.style.minHeight = ''; bodyEl.textContent = plain(body);
    const dl = card.querySelector('.nge-callout-stats') as HTMLElement;
    dl.hidden = !stats.length;
    dl.innerHTML = stats.map(([k, v]) => `<div><dt>${STAT_ICON[k] ?? ''}${k}</dt><dd>${statValue(v)}</dd></div>`).join('');
    const btn = card.querySelector('.nge-intro-go') as HTMLButtonElement;
    btn.hidden = !button;
    if (button) { (btn.querySelector('.nge-go-label') as HTMLElement).textContent = button.label; btn.onclick = () => { if (!button.keep) close(); button.go(); }; }
    fw = fh = 0; redrawFrame();
    type(bodyEl, body);
    requestAnimationFrame(redrawFrame);
  };
  return {set, close, el: card};
}

/** Is any of the big neuron's mesh on the graphics card yet? */
function bigNeuronDrawn(ml: any): boolean {
  for (const rl of ml?.layer?.renderLayers ?? []) {
    const src = rl?.source;
    if (!src?.chunks?.get || !src.fragmentSource?.chunks) continue;
    for (const ch of src.fragmentSource.chunks.values?.() ?? []) if (ch?.state === 0) return true;
  }
  return false;
}

async function exploreBiggerNeuron() {
  clearStarship();
  const v = viewerNow();
  const ds = findDatasetBySegName('minnie65_public');
  if (!v || !ds) return;
  // MICrONS is a much bigger piece of brain and this cell is enormous, so it
  // takes a while to arrive: say so while it does (Ames)
  const card = transmissionCard();
  card.set('Warping to MICrONS', 'Loading a much bigger piece of brain: a cubic millimeter of mouse visual cortex, and one of the most complete neurons in it. Big cells take a moment to arrive.');
  if (!(await switchToDataset(ds, {forJump: true}))) { card.close(); return; }
  try { v.selectedLayer.visible = false; } catch { /* no panel */ }
  let ml: any = null;
  for (let k = 0; k < 60 && !ml; k++) {
    ml = (v.layerManager?.managedLayers ?? []).find((m: any) => !m?.archived &&
      String(m?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/minnie65_public') && m.layer?.displayState?.segmentationGroupState?.value?.visibleSegments);
    if (!ml) await new Promise(r => setTimeout(r, 250));
  }
  if (!ml) { card.close(); return; }
  // the dataset's own cells step aside (they need a sign in); the tour draws
  // from the public release instead
  try { ml.layer.displayState.segmentationGroupState.value.visibleSegments.clear(); ml.setVisible?.(false); } catch { /* leave it */ }
  ml = await publicMicronsLayer();
  if (!ml) { card.close(); return; }
  const g = ml.layer.displayState.segmentationGroupState.value;
  g.visibleSegments.clear();
  g.visibleSegments.add(Uint64.parseString(BIG_NEURON));
  // a pale blue-white, so the gold and pink synapses show on it (Ames)
  try { setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, Uint64.parseString(BIG_NEURON), packed(0xcfdcff)); } catch { /* its own color */ }
  oneBoundingBox();
  setTimeout(oneBoundingBox, 3000);
  const nm = nmPerUnit();
  try { v.layout.restoreState('3d'); } catch { /* keep the layout */ }
  try { v.showAxisLines.value = false; } catch { /* keep them */ }
  if (nm) {
    // centred a little above the cell body: its axon climbs toward the surface
    const c: V3 = [BIG_NEURON_NM[0], BIG_NEURON_NM[1] - 180_000, BIG_NEURON_NM[2]];
    v.navigationState.position.value = Float32Array.from(c.map((x, i) => x / nm[i]));
    v.projectionScale.value = 1_000_000 / Math.min(nm[0], nm[1], nm[2]);
  }
  startIdleTurn();
  for (let k = 0; k < 120 && !bigNeuronDrawn(ml); k++) await new Promise(r => setTimeout(r, 250));
  // the Starship came along: it parks beside the big cell
  void flyStarship(undefined, true, 5);
  showMartinotti(card, ml);
}
function showMartinotti(card: ReturnType<typeof transmissionCard>, ml: any) {
  stopAllSynapses();
  try {
    const g = ml.layer.displayState.segmentationGroupState.value;
    g.visibleSegments.clear(); g.visibleSegments.add(Uint64.parseString(BIG_NEURON));
  } catch { /* leave it */ }
  const nm = nmPerUnit();
  card.set('A Martinotti cell',
    'Unlike our pyramidal neuron, this one is inhibitory: its signals tell other cells to quiet down. Proofreaders traced every branch of its axon, which climbs toward the surface of the brain and touches thousands of cells. Spin it around!',
    [], {label: 'Show its connections', keep: true, go: () => void showConnections(card, ml)}, '', {hint: true});
  // its stats are a hologram from the Axon Runner (Ames)
  showCallout(BIG_NEURON_NM as unknown as V3, 'Martinotti cell',
    [['Class', 'Inhibitory'], ['Neurotransmitter', 'GABA'], ['All its branches', 'about 36 mm'], ['For scale', 'as long as a paper clip, packed into a speck the size of a grain of sand'], ['Input', '6,363 synapses'], ['Output', '8,110 synapses']],
    '#cfdcff', false, false);
  if (nm) frameAboveCard([BIG_NEURON_NM[0], BIG_NEURON_NM[1] - 180_000, BIG_NEURON_NM[2]], 1_000_000, 2600);
}

/** Cell types (aibs_metamodel_celltypes_v661) in words and colors:
 *  excitatory warm, inhibitory cool (Ames: partners colored by type). */
const MC_TYPES: Record<string, [string, string]> = {
  '23P': ['Layer 2/3 pyramidal', '#ff9f43'], '4P': ['Layer 4 pyramidal', '#ffd166'], '5P-IT': ['Layer 5 pyramidal', '#ff6b6b'],
  '5P-ET': ['Layer 5 pyramidal, long range', '#ff4d8d'], '5P-NP': ['Layer 5 near-projecting', '#f78fb3'], '6P-IT': ['Layer 6 pyramidal', '#ffa07a'],
  '6P-CT': ['Layer 6 corticothalamic', '#e17055'], 'BC': ['Basket cell', '#4dd0e1'], 'MC': ['Martinotti cell', '#9b8cff'],
  'BPC': ['Bipolar cell', '#7bed9f'], 'NGC': ['Neurogliaform cell', '#a3e4ff'],
};
type TopTypes = {in: [string, number][]; out: [string, number][]; in_typed: number; out_typed: number};
/** Its top partner types, in words, from enough typed synapses to say (Ames). */
function topTypeStats(tt: TopTypes | undefined): [string, string][] {
  if (!tt) return [];
  const say = (t: [string, number]) => `${(MC_TYPES[t[0]]?.[0] ?? t[0])} (${t[1]}%)`;
  const rows: [string, string][] = [];
  if (tt.in_typed >= 50 && tt.in.length) rows.push(['Hears most from', say(tt.in[0])]);
  if (tt.out_typed >= 50 && tt.out.length) rows.push(['Sends most to', say(tt.out[0])]);
  return rows;
}
interface McData { topTypes?: TopTypes; synIn: number[]; synUnit: number; synOut: number[];
  partners: {id: string; dir: 'in' | 'out'; synapses: number; type: string; cls?: string; soma: number[];
    shared?: number[][]; inputs?: number | null; outputs?: number | null; cable_mm?: number | null; topTypes?: TopTypes}[]; }

/* ── the sweep: the ship flies over the synapses two cells share and lights
   each with a quick laser zap as it passes (Ames) ── */
let zapRaf = 0;
/** The scan through a set of synapses: a hologram bar at the height getY()
 *  gives (or none while it is null), lighting each synapse as it passes with
 *  a burst of sparks; each stays as a small glowing dot, a steady size on
 *  screen (Ames: "little particle sparks ... to draw attention to smaller
 *  dots", not big annotation circles). */
function runBarScan(points: V3[], rgb: [number, number, number], getY: () => number | null) {
  stopZap();
  const nm = nmPerUnit();
  if (!nm || !points.length) return;
  const lo = [0, 1, 2].map(i => Math.min(...points.map(q => q[i])));
  const hi = [0, 1, 2].map(i => Math.max(...points.map(q => q[i])));
  const c = [0, 1, 2].map(i => (lo[i] + hi[i]) / 2);
  const half = Math.max(60_000, (hi[0] - lo[0]) / 2 + 40_000);
  const n = points.length, N = 200, SP = 10, MAX = n * (2 + SP) + N * 2;
  const glow: NgeGlow = {positions: new Float32Array(MAX * 3), colors: new Float32Array(MAX * 4), sizesNm: new Float32Array(MAX), count: 0, nmRight: [1 / nm[0], 0, 0]};
  const lit = new Float64Array(n);
  // each synapse's sparks fly out in their own directions
  const dirs = points.map(() => Array.from({length: SP}, () => { const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1); return [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)]; }));
  let barY = -Infinity;
  const step = (now: number) => {
    const cam = cameraAxes(nm);
    let Hn = 500_000;
    try { Hn = viewerNow().projectionScale.value * Math.min(nm[0], nm[1], nm[2]); } catch { /* a guess */ }
    const px = Hn / Math.max(400, window.innerHeight);   // nm a screen pixel
    const y = getY();
    if (y !== null) barY = y;
    let k = 0;
    const put = (p: number[], rgba: number[], size: number) => { if (k >= MAX) return; glow.positions.set([p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]], k * 3); glow.colors.set(rgba, k * 4); glow.sizesNm[k] = size; k++; };
    for (let j = 0; j < n; j++) {
      const p = points[j];
      if (!lit[j] && y !== null && p[1] >= y + 3000) lit[j] = now;
      if (!lit[j]) continue;
      const age = (now - lit[j]) / 1000, f = Math.max(0, 1 - age / 0.5);
      // the dot: small and bright, with a soft halo
      put(p, [rgb[0], rgb[1], rgb[2], 0.35], px * 16);
      put(p, [Math.min(1, rgb[0] + 0.3 * f), Math.min(1, rgb[1] + 0.3 * f), Math.min(1, rgb[2] + 0.3 * f), 1], px * (6 + 10 * f));
      // the sparks
      if (age < 0.9) for (const d of dirs[j]) {
        const r = px * 70 * (1 - Math.pow(1 - Math.min(1, age / 0.9), 2.4));
        put([p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r], [1, 0.95, 0.9, (1 - age / 0.9) * 0.95], px * 4.5);
      }
    }
    if (y !== null && cam) {
      const right = cam.right, at = (u: number, dy: number) => [c[0] + right[0] * half * u, barY + dy, c[2] + right[2] * half * u];
      const flick = 0.85 + 0.15 * Math.sin(now / 45);
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1) * 2 - 1, edge = 1 - Math.pow(Math.abs(u), 3);
        put(at(u, 0), [0.8, 0.98, 1, 0.9 * edge * flick], px * 3);
        put(at(u, px * 10), [0.3, 0.75, 1, 0.2 * edge], px * 16);
      }
    }
    glow.count = k;
    if (cam) glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
    setNgeGlow(glow, 'intro-zap');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    zapRaf = requestAnimationFrame(step);
  };
  zapRaf = requestAnimationFrame(step);
}
function stopZap() { cancelAnimationFrame(zapRaf); setNgeGlow(null, 'intro-zap'); }
/** All its synapses as small dots, gold in and pink out, and its strongest
 *  partners in their type's color. Each partner can be visited from the
 *  card (Ames: explore a few upstream and downstream partners before going
 *  back to play), without the segment panel. */
async function showConnections(card: ReturnType<typeof transmissionCard>, ml: any) {
  let mc: McData | null = null;
  try { const r = await fetch('intro/microns-mc.json'); if (r.ok) mc = await r.json(); } catch { /* no data */ }
  if (!mc) { card.close(); startGetStarted(); return; }
  const data = mc;
  const v = viewerNow();
  const g = ml.layer.displayState.segmentationGroupState.value;
  const colors = ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors;
  const hexNum = (h: string) => parseInt(h.slice(1), 16);
  const typeOf = (p: McData['partners'][number]) => MC_TYPES[p.type] ?? [p.type, '#cccccc'];
  const hidePanel = () => { try { v.selectedLayer.visible = false; } catch { /* no panel */ } };
  const show = (ids: string[]) => {
    try {
      g.visibleSegments.clear();
      g.visibleSegments.add(Uint64.parseString(BIG_NEURON));
      for (const id of ids) {
        const p = data.partners.find(q => q.id === id)!;
        const seg = Uint64.parseString(id);
        g.visibleSegments.add(seg);
        setStatedColor(colors, seg, packed(hexNum(typeOf(p)[1])));
      }
    } catch { /* leave it */ }
    hidePanel(); setTimeout(hidePanel, 400);
  };
  const row = (p: McData['partners'][number], k: number, on = -1) => {
    const [name, color] = typeOf(p);
    return `<button class="nge-pt${k === on ? ' nge-pt--on' : ''}" type="button" data-k="${k}"><i style="--c:${color}"></i><span><b>${name}</b></span><small>${p.synapses} synapses</small></button>`;
  };
  const listHtml = (on = -1) => {
    const idx = data.partners.map((p, k) => [p, k] as const);
    return `<span class="hd">It sends to</span>${idx.filter(([p]) => p.dir === 'out').map(([p, k]) => row(p, k, on)).join('')}` +
      `<span class="hd">It hears from</span>${idx.filter(([p]) => p.dir === 'in').map(([p, k]) => row(p, k, on)).join('')}`;
  };
  const wire = () => card.el.querySelectorAll<HTMLButtonElement>('.nge-pt').forEach(b => { b.onclick = () => visit(Number(b.dataset.k)); });
  const play = {label: 'Start playing Pyr', go: () => startGetStarted()};
  let token = 0;
  const cardAway = (away: boolean) => { card.el.style.transition = 'opacity 0.5s'; card.el.style.opacity = away ? '0' : ''; card.el.style.pointerEvents = away ? 'none' : ''; };
  // where its synapses are: across (x), up (-y) and deep (z), in nm
  const bounds = (() => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], c = [0, 0, 0];
    let n = 0;
    for (const src of [data.synIn, data.synOut]) for (let j = 0; j < src.length; j += 3) {
      for (let a = 0; a < 3; a++) { const x = src[j + a] * data.synUnit; lo[a] = Math.min(lo[a], x); hi[a] = Math.max(hi[a], x); c[a] += x; }
      n++;
    }
    return {lo, hi, c: c.map(x => x / Math.max(1, n))};
  })();
  // partners counted from the public synapse table (v1300): the distinct
  // cells on the other side of its synapses (some are pieces still being traced)
  const scanStats: [string, string][] = [['Input', '6,363 synapses'], ['Output', '8,110 synapses'], ['Cells it hears from', '5,195'], ['Cells it sends to', '3,660']];
  const listText = 'Every dot is a synapse: {in:gold} ones bring signals in, {out:pink} ones carry its signal out. It connects with about 8,700 cells. Want to meet a few? These are some of the cells it shares the most synapses with. Tap one to visit it.';
  const overview = (scan = true) => {
    const my = ++token;
    stopZap(); hideCallout(); synapseMarks(null);
    // just the Martinotti cell: its partners only when one is chosen
    show([]);
    const top: V3 = [bounds.c[0], bounds.lo[1] - 40_000, bounds.c[2]];
    const backToList = () => {
      card.set('Its connections', listText, [], play, listHtml(), {back: () => { token++; cardAway(false); stopZap(); showMartinotti(card, ml); }});
      wire();
    };
    if (!scan) {
      runAllSynapses(data, 2.2, 0.55);
      dockStarship(0.72, -0.05, 3000);
      backToList();
      return;
    }
    cardAway(true);
    frameAboveCard([bounds.c[0], (bounds.lo[1] + bounds.hi[1]) / 2, bounds.c[2]], Math.max(900_000, (bounds.hi[1] - bounds.lo[1]) * 1.25), 2600);
    const nm = nmPerUnit(), cam0 = nm && cameraAxes(nm);
    const toEye = cam0 ? cam0.toEye : [0, 0, 1];
    const front = (q: number[]): V3 => q.map((x, i) => x + toEye[i] * 60_000) as V3;
    const bottom: V3 = [bounds.c[0], bounds.hi[1] + 40_000, bounds.c[2]];
    // over to below the cell, then straight up it, scanning
    undockStarship();
    starshipHop([front(bottom), front([bottom[0], (bottom[1] + top[1]) / 2, bottom[2]]), front(top)], 11);
    let rising = false, scanAt = -Infinity, parking = false;
    const shipH = () => { const s2 = starshipAt(); return s2 ? -s2[1] : -Infinity; };
    runAllSynapses(data, 2.2, 0.75, () => {
      const h = shipH();
      if (!rising && h <= -bottom[1] + 30_000) rising = true;
      if (rising) scanAt = Math.max(scanAt, h);
      return scanAt;
    });
    // the scanner: a bright line across the cell at the ship's height
    const scanRaf = () => {
      if (token !== my) { setNgeGlow(null, 'intro-zap'); return; }
      const n3 = nmPerUnit(), cam = n3 && cameraAxes(n3), s2 = starshipAt();
      if (n3 && cam && s2 && rising && starshipMoving()) {
        // a hologram scan: a fine bright line across the cell at the ship's
        // height, a soft band of light under it, and a faint fan of light from
        // the ship out to its ends (Ames: not a line of dots)
        const N = 260, F = 60, half = (bounds.hi[0] - bounds.lo[0]) / 2 + 30_000;
        const M = N * 2 + F * 2;
        const glow: NgeGlow = {positions: new Float32Array(M * 3), colors: new Float32Array(M * 4), sizesNm: new Float32Array(M), count: M, nmRight: [cam.right[0] / n3[0], cam.right[1] / n3[1], cam.right[2] / n3[2]]};
        let c = 0;
        const put = (p: number[], rgba: number[], size: number) => { glow.positions.set([p[0] / n3[0], p[1] / n3[1], p[2] / n3[2]], c * 3); glow.colors.set(rgba, c * 4); glow.sizesNm[c] = size; c++; };
        const flick = 0.85 + 0.15 * Math.sin(performance.now() / 45);
        const at = (u: number, dy: number) => [bounds.c[0] + cam.right[0] * half * u, s2[1] + dy, bounds.c[2] + cam.right[2] * half * u];
        for (let k = 0; k < N; k++) {
          const u = k / (N - 1) * 2 - 1, edge = 1 - Math.pow(Math.abs(u), 3);
          put(at(u, 0), [0.8, 0.98, 1, 0.9 * edge * flick], 3200);
          put(at(u, 9000), [0.3, 0.75, 1, 0.22 * edge], 16000);
        }
        for (const end of [-1, 1]) for (let k = 0; k < F; k++) {
          const w = (k + 1) / F, e = at(end, 0);
          put([0, 1, 2].map(i => s2[i] + (e[i] - s2[i]) * w), [0.55, 0.9, 1, 0.16 * (1 - w * 0.5)], 4000);
        }
        glow.count = c;
        setNgeGlow(glow, 'intro-zap');
      } else setNgeGlow(null, 'intro-zap');
      if (rising && !starshipMoving() && !parking) {
        // at the top: it pulls over to the empty top right corner, then
        // shows the cell's stats there (Ames)
        setNgeGlow(null, 'intro-zap');
        parking = true;
        dockStarship(0.8, 0.42, 2600);
        const whenParked = () => {
          if (token !== my) return;
          if (starshipMoving()) { requestAnimationFrame(whenParked); return; }
          showCallout(top, 'Martinotti cell', [...scanStats, ...topTypeStats(data.topTypes)], '#cfdcff', false, false);
          setTimeout(() => { if (token === my) { backToList(); cardAway(false); } }, 1600);
        };
        setTimeout(whenParked, 300);
        return;
      }
      requestAnimationFrame(scanRaf);
    };
    requestAnimationFrame(scanRaf);
    card.set('Scanning its synapses', 'The Axon Runner is mapping every synapse on this cell.', [], undefined, '', {back: () => { token++; cardAway(false); stopZap(); showMartinotti(card, ml); }});
  };
  const visit = (k: number) => {
    const my = ++token;
    cardAway(false);
    const p = data.partners[k];
    const [name] = typeOf(p);
    show([p.id]);
    stopAllSynapses();
    // the camera takes in both cell bodies
    const a = BIG_NEURON_NM, b = p.soma as unknown as V3;
    const mid: V3 = [0, 1, 2].map(i => (a[i] + b[i]) / 2) as V3;
    const span = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    frameAboveCard(mid, Math.max(500_000, span * 1.8 + 350_000), 2800);
    // the ship sweeps the synapses they share, nearest first, zapping each,
    // and ends over the partner's cell body, where it shows its stats
    const pts = (p.shared ?? []).map(q => q as V3);
    const order: V3[] = [];
    {
      const left = [...pts];
      let at = starshipAt() ?? (BIG_NEURON_NM as V3);
      while (left.length) {
        let bi = 0, bd = Infinity;
        left.forEach((q, j) => { const d = Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]); if (d < bd) { bd = d; bi = j; } });
        at = left.splice(bi, 1)[0]; order.push(at);
      }
    }
    synapseMarks(null);
    stopZap();
    hideCallout();
    // the ship swoops up through the synapses the two cells share with its
    // scan bar, lighting each as it passes with a burst of sparks, then goes
    // back to the side to show the cell's stats (Ames)
    let scanned = false, rising = false;
    const pl = [0, 1, 2].map(i => Math.min(...pts.map(q => q[i]))), ph = [0, 1, 2].map(i => Math.max(...pts.map(q => q[i])));
    const pc = [0, 1, 2].map(i => (pl[i] + ph[i]) / 2);
    const n4 = nmPerUnit(), c4 = n4 && cameraAxes(n4), eye = c4 ? c4.toEye : [0, 0, 1];
    const fr = (q: number[]): V3 => q.map((x, i) => x + eye[i] * 50_000) as V3;
    const low: V3 = [pc[0], ph[1] + 30_000, pc[2]], high: V3 = [pc[0], pl[1] - 30_000, pc[2]];
    undockStarship();
    starshipHop([fr(low), fr([pc[0], pc[1], pc[2]]), fr(high)], Math.min(9, Math.max(5, 3 + (ph[1] - pl[1]) / 60_000)));
    runBarScan(pts, p.dir === 'out' ? [1, 0.36, 0.86] : [1, 0.86, 0.45], () => {
      const sp = starshipAt();
      if (!sp) return null;
      if (!rising && sp[1] >= low[1] - 25_000) rising = true;
      return rising && starshipMoving() ? sp[1] : null;
    });
    const backToSide = () => {
      if (token !== my) return;
      if (!rising || starshipMoving()) { requestAnimationFrame(backToSide); return; }
      dockStarship(0.78, 0.1, 2600);
      scanned = true;
    };
    setTimeout(backToSide, 800);
    const shownAt = performance.now();
    const statsWhenStill = () => {
      if (token !== my || !card.el.isConnected) return;
      if (!scanned || starshipMoving() || performance.now() - shownAt < 600) { requestAnimationFrame(statsWhenStill); return; }
      if (starshipMoving() || performance.now() - shownAt < 600) { requestAnimationFrame(statsWhenStill); return; }
      const inhib = ['BC', 'MC', 'BPC', 'NGC'].includes(p.type);
      const stats: [string, string][] = [['Class', inhib ? 'Inhibitory' : 'Excitatory']];
      if (p.cable_mm) stats.push(['Branch length', `about ${p.cable_mm < 10 ? p.cable_mm.toFixed(1) : Math.round(p.cable_mm)} mm`]);
      if (p.inputs != null) stats.push(['Input', `${p.inputs.toLocaleString('en-US')} synapses`]);
      if (p.outputs != null) stats.push(['Output', `${p.outputs.toLocaleString('en-US')} synapses`]);
      stats.push(['With the Martinotti cell', `${p.synapses}`], ...topTypeStats(p.topTypes));
      // pyramidal axons here are mostly not traced to the end yet
      if (!inhib) stats.push(['Note', 'its axon is still being traced']);
      showCallout(p.soma as unknown as V3, name, stats, typeOf(p)[1], false, false);
    };
    requestAnimationFrame(statsWhenStill);
    const out = p.dir === 'out';
    const body = out
      ? `This ${name.toLowerCase()} cell is downstream: the Martinotti cell's axon makes ${p.synapses} synapses onto it, telling it to quiet down.`
      : `This ${name.toLowerCase()} cell is upstream: its axon makes ${p.synapses} synapses onto the Martinotti cell${['BC', 'MC', 'BPC', 'NGC'].includes(p.type) ? ', quieting it in turn' : ', exciting it'}.`;
    const next = (k + 1) % data.partners.length;
    card.set(name, body, [], play, listHtml(k),
      {back: () => overview(false), alt: {label: 'Next cell', go: () => visit(next)}});
    wire();
  };
  overview();
}

/** The rocket by the chat box (Ames 2026-11-08): the prototype tour, offered
 *  to every player to try and give feedback on. */
export function showTourInvite() {
  if (document.querySelector('.nge-tour-invite')) return;
  const card = transmissionCard();
  card.el.classList.add('nge-tour-invite');
  card.set('Try the new tour of Pyr',
    "This is the prototype new tour that people will see when opening Pyr for the first time. Want to try it and give us feedback? It's supposed to be fun, beautiful, cool, and informative. Thanks for testing it! There are still some bugs but feel free to submit issues/ideas via bug report! -Amy",
    [], {label: 'Start the tour', go: () => playIntro()}, '', {alt: {label: 'Not now', go: () => card.close()}});
}

/** The whole intro: the Starship flies in and lands, then the tour. */
/** A loading screen while the Sandbox and the cell arrive, until the cell
 *  starts to grow (Ames: "start the tour ... just stays black for a while"). */
function showTourLoading() {
  ensureStyle();
  document.querySelector('.nge-tour-loading')?.remove();
  const el = document.createElement('div');
  el.className = 'ng-extend nge-tour-loading';
  // a launch: a warp starfield, the Axon Runner idling inside two hologram
  // rings, status lines and a scan bar, then a jump to light speed into the
  // neuron (Ames: the first one was "not cool enough")
  el.innerHTML = `<canvas class="nge-tl-stars"></canvas>
    <div class="nge-tl-core"><span class="nge-tl-ring a"></span><span class="nge-tl-ring b"></span><span class="nge-tl-glow"></span>
      <img class="nge-tl-ship" src="${starshipIcon}" alt=""></div>
    <div class="nge-tour-loading-text">Warming up the Axon Runner</div>
    <div class="nge-tl-bar"><i></i></div>
    <div class="nge-tour-loading-sub">Charging thrusters</div>
    <span class="nge-tl-flash"></span>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('nge-tour-loading--in'));
  const sub = el.querySelector('.nge-tour-loading-sub') as HTMLElement;
  const lines = ['Charging thrusters', 'Plotting a course into the cortex', 'Loading your first neuron', 'Aligning the hologram projector', 'Almost there'];
  let li = 0;
  const lineTimer = setInterval(() => {
    li = Math.min(lines.length - 1, li + 1);
    sub.classList.remove('nge-tl-swap'); void sub.offsetWidth; sub.textContent = lines[li]; sub.classList.add('nge-tl-swap');
  }, 1900);
  // the starfield
  const cv = el.querySelector('canvas') as HTMLCanvasElement, cx = cv.getContext('2d');
  const stars = Array.from({length: 420}, () => ({a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.2 + Math.random() * 0.8, h: Math.random() < 0.15}));
  let speed = 0.12, raf = 0, last = performance.now();
  const draw = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const W = cv.width = el.clientWidth, H = cv.height = el.clientHeight;
    if (!cx) return;
    const ox = W / 2, oy = H * 0.44, R = Math.hypot(W, H) * 0.6;
    cx.fillStyle = '#020612'; cx.fillRect(0, 0, W, H);
    for (const st of stars) {
      st.r += dt * speed * st.s * (0.4 + st.r * 2.2);
      if (st.r > 1) { st.r = 0.02 + Math.random() * 0.05; st.a = Math.random() * Math.PI * 2; }
      const r1 = st.r * R, r0 = Math.max(0, r1 - (8 + speed * 260) * st.s * st.r);
      const c = Math.cos(st.a), sn = Math.sin(st.a);
      cx.strokeStyle = st.h ? `rgba(255, 210, 120, ${Math.min(1, st.r * 1.6)})` : `rgba(150, 225, 255, ${Math.min(1, st.r * 1.8)})`;
      cx.lineWidth = 0.6 + st.r * 2.2 * st.s;
      cx.beginPath(); cx.moveTo(ox + c * r0, oy + sn * r0); cx.lineTo(ox + c * r1, oy + sn * r1); cx.stroke();
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  const done = () => {
    window.removeEventListener('nge-intro-ready', done);
    clearTimeout(timer); clearInterval(lineTimer);
    // the jump: the stars stretch to light speed, a flash, and we are there
    sub.textContent = 'Engage!';
    el.classList.add('nge-tl-warp');
    const t0 = performance.now();
    const ramp = () => {
      const q = Math.min(1, (performance.now() - t0) / 700);
      speed = 0.12 + q * q * 3.2;
      if (q < 1) requestAnimationFrame(ramp);
    };
    ramp();
    setTimeout(() => el.classList.remove('nge-tour-loading--in'), 650);
    setTimeout(() => { cancelAnimationFrame(raf); el.remove(); }, 1300);
  };
  const timer = setTimeout(done, 45_000);
  // (listening only once the new flight is under way: the one it replaces
  // says "ready" as it stops, which ended this screen at once)
  setTimeout(() => window.addEventListener('nge-intro-ready', done), 600);
}

export function playIntro() {
  endTour();
  clearStarship();
  document.body.classList.add('nge-intro-on');
  showTourLoading();
  setTimeout(() => { void flyStarship(() => { void startIntroTour(); }); }, 150);
}

/**
 * Test sites only for now (never the live site): the intro plays by itself
 * for a pretend new player (the Intro test panel's "Pretend I am a new
 * player"), on load and the moment the box is ticked, or with ?starship in
 * the address. It waits for the cell to be drawn first, for up to twenty
 * seconds.
 */
let playedThisLoad = false;
export function startStarshipIntro() {
  if (IS_LIVE_SITE) return;
  // the cell turns slowly from the moment it shows, before anything flies
  setTimeout(startIdleTurn, 1200);
  // On the intro's own preview it plays by itself, once per browser, for the
  // testers Ames invites (2026-11-08: "opened the link but still no rocket")
  const PREVIEW_SEEN = 'pyr-intro-preview-seen';
  let firstVisit = false;
  if (location.hostname.startsWith('claude-starship-intro-dot-')) {
    try { firstVisit = !localStorage.getItem(PREVIEW_SEEN); } catch { /* no storage */ }
  }
  const wanted = () => simulating.value || firstVisit || /[?&]starship\b/.test(location.search);
  const signedIn = () => { try { return !!useProofreadingBackendStore().userId; } catch { return false; } };
  const go = async () => {
    if (!wanted() || playedThisLoad) return;
    playedThisLoad = true;
    await Promise.all([loadAssets(), loadTour()]).catch(() => {});
    // a new tester is still signing in: wait for that however long it takes
    // (up to fifteen minutes), then for the cell a little
    for (let k = 0; k < 3600 && !signedIn() && !cellDrawn(); k++) await new Promise(r => setTimeout(r, 250));
    if (!signedIn() && !cellDrawn()) { playedThisLoad = false; return; }
    for (let k = 0; k < 80 && !cellDrawn(); k++) await new Promise(r => setTimeout(r, 250));
    if (wanted()) {
      try { localStorage.setItem(PREVIEW_SEEN, '1'); } catch { /* no storage */ }
      firstVisit = false;
      playIntro();
    }
  };
  setTimeout(go, 1500);
  watch(simulating, on => { if (on) { playedThisLoad = false; void go(); } });
}

(window as any).pyrIntro = {play: playIntro, tour: startIntroTour, end: endTour};
