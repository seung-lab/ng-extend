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
import {getNgeMeshTint, setNgeMeshTint, type NgeMeshTint} from 'neuroglancer/mesh/nge_tint';
import {setNgeGlow, type NgeGlow} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {getObjectKey} from 'neuroglancer/segmentation_display_state/base';
/** The Sandbox pyramidal cell: the colors land on it alone. */
const CELL_KEY = getObjectKey(Uint64.parseString('648518346355727683'));
import {cameraAxes, cellDrawn, clearStarship, dockStarship, starshipEta, flyStarship, loadAssets, setHoverHighlight, setStarshipCameraHeld, startIdleTurn, starshipAt, starshipHop, starshipMoving, undockStarship} from './starship';
import {setStatedColor} from '../widgets/widget_utils';
import {IS_LIVE_SITE, simulating} from './toolbar_staging';
import {findDatasetBySegName, switchToDataset} from '../datasets';
import {useTutorialStore} from '../store-pyr';

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
    body: "Pyr is a game where citizen scientists map the brain. Players come from all walks of life. They're helping to advance neuroscience, and they're not neuroscientists! Together they map real neurons, like this one. Want to take a look around?"},
  {key: 'neuron', header: 'This is a neuron', view: {at: 'cell', nm: 260_000},
    callout: {anchor: 'soma', title: 'Pyramidal neuron', stats: [['Cell type', 'Pyramidal'], ['Class', 'Excitatory'], ['Neurotransmitter', 'Glutamate'],
      ['Location', 'Visual cortex, mouse brain'], ['Branch length', 'about 4.5 mm'], ['Input', '3,386 synapses'], ['Output', '59 synapses']]},
    body: 'Neurons are the most famous cells of the brain. Yours has about 86 billion of them, in thousands of varieties, and they all share the same basic parts.'},
  {key: 'soma', callout: {anchor: 'soma', title: 'Soma', stats: [['Contains', 'nucleus, organelles'], ['Size', 'about 20 µm across'], ['For scale', 'a fifth the width of a human hair']]}, part: 1, view: {at: 'soma', nm: 45_000},
    body: 'The cell body. It holds the nucleus and keeps the whole cell alive.'},
  {key: 'dendrites', callout: {anchor: 'dendrite', title: 'Dendrites', stats: [['Input', '3,297 synapses']]}, part: 2, view: {at: 'dendView', nm: 230_000},
    body: 'The branches that listen. They gather signals from other neurons.'},
  {key: 'axon', callout: {anchor: 'axon', title: 'Axon', stats: [['Width', 'about 0.4 µm'], ['Outputs', '59 synapses']]}, part: 3, view: {at: 'axon', nm: 160_000},
    body: "The neuron's long, thin cable. It carries the cell's own signal out to other cells."},
  {key: 'synapse', part: 3, header: 'Synapse', view: {at: 'synapse', nm: 24_000},
    body: 'The connection where two neurons meet and communicate. Signals always travel one way, from an axon to a dendrite: a cell listens with its dendrites and sends with its axon. Here our {axon:axon} passes its signal to the next neuron.'},
  {key: 'allsyn', header: 'All its synapses', view: {at: 'cell', nm: 230_000},
    body: 'Each dot is a synapse. This cell receives {in:3,386 connections} from upstream cells, and the axon contained in this volume has {out:59 outgoing connections}.'},
  {key: 'synapse2', header: 'Signals come in', part: 2, view: {at: 'synapse2', nm: 30_000},
    body: 'Out here near the tip of a {dendrite:dendrite}, {nbr:another neuron\u2019s axon} passes its signal in at a **synapse**, the glow. Thousands of inputs like this one add up, and when enough arrive together, the cell fires.'},
  {key: 'spike', header: 'Action potential', part: 3, view: {at: 'cell', nm: 220_000},
    body: 'A signal comes in along {nbr:the neighbor\u2019s axon}, crosses the **synapse** and runs down the {dendrite:dendrite} to the {soma:soma}. When enough arrive, the cell fires an action potential, a quick electric pulse that races out along its {axon:axon} to the next cell. It lasts about 1 ms (a blink takes 300 times longer) and travels up to 100 m/s, about 220 mph. Here it is slowed down about 5,000 times.'},
  {key: 'connectome', header: 'Connectome', view: {at: 'cell', nm: 260_000},
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
    const rgb = PART_RGB[p], a = 1, k = 1;
    data[i * 4] = Math.round(rgb[0] * k * a); data[i * 4 + 1] = Math.round(rgb[1] * k * a); data[i * 4 + 2] = Math.round(rgb[2] * k * a);
    data[i * 4 + 3] = Math.round(a * 255);
  }
  const m = mat4.create();
  for (let i = 0; i < 3; i++) { m[i * 5] = nm[i] / (g.dims[i] * g.cell); m[12 + i] = -g.origin[i] / (g.dims[i] * g.cell); }
  return {data, dims: g.dims, gridFromGlobal: m, only: CELL_KEY, glow: glowing ? PART_RGB[glowing].map(c => c / 255) as V3 : undefined};
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
function moveCamera(center: V3, viewNm: number, ms = 1600) {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return;
  cancelAnimationFrame(camRaf);
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
  if (!cam || !pe || !panel) return at;
  const r = pe.getBoundingClientRect();
  if (r.height < 50) return at;
  const bottom = Math.min(r.bottom, panel.offsetTop - 10);
  const px = (r.top + bottom) / 2 - (r.top + r.bottom) / 2;   // negative: above the middle
  const k = px * viewNm / r.height;
  return [0, 1, 2].map(i => at[i] + cam.up[i] * k) as V3;
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
  return t.anchors.synapse.map((v, i) => v + up[i] * k + (cam ? cam.toEye[i] * 1500 : 0));
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

/* ── every synapse on the cell, twinkling in ── */
let synRaf = 0;
function runAllSynapses(t: {synIn: number[]; synOut: number[]; synUnit: number}, scale = 1) {
  const nm = nmPerUnit();
  if (!nm || !t.synIn) return;
  const nIn = t.synIn.length / 3, nOut = t.synOut.length / 3, n = nIn + nOut;
  const glow: NgeGlow = {positions: new Float32Array(n * 3), colors: new Float32Array(n * 4), sizesNm: new Float32Array(n), count: n, nmRight: [1 / nm[0], 0, 0]};
  const delay = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const src = j < nIn ? t.synIn : t.synOut, k = (j < nIn ? j : j - nIn) * 3;
    for (let a = 0; a < 3; a++) glow.positions[j * 3 + a] = src[k + a] * t.synUnit / nm[a];
    delay[j] = Math.random() * 1.6;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const sec = (now - t0) / 1000;
    for (let j = 0; j < n; j++) {
      const on = Math.min(1, Math.max(0, (sec - delay[j]) / 0.35));
      if (j < nIn) glow.colors.set([1, 0.86, 0.45, on], j * 4);
      else glow.colors.set([1, 0.36, 0.86, on], j * 4);
      glow.sizesNm[j] = scale * (j < nIn ? 1700 : 3200) * (1 + 0.6 * Math.max(0, 1 - Math.abs(sec - delay[j] - 0.2) * 4));
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
  const MAX = 2400;
  const glow: NgeGlow = {positions: new Float32Array(MAX * 3), colors: new Float32Array(MAX * 4), sizesNm: new Float32Array(MAX), count: 0, nmRight: [1 / nm[0], 0, 0]};
  const T_IN = legIn.ms, T_D0 = T_IN + 250, T_D1 = T_D0 + legD.ms, T_O0 = T_D1 + 1300, T_O1 = T_O0 + AX_MS;
  const T_N0 = T_O0 + dSyn / speed + 250, T_N1 = T_N0 + legN.ms, PERIOD = Math.max(T_O1, T_N1) + 2400;
  const soma = t.anchors.soma, syn2 = t.anchors.synapse2;
  const t0 = performance.now();
  const step = (now: number) => {
    const ms = (now - t0) % PERIOD;
    let n = 0;
    const put = (p: number[], rgb: number[], a: number, size: number) => {
      if (a <= 0.01 || n >= MAX) return;
      glow.positions.set([p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]], n * 3);
      glow.colors.set([rgb[0], rgb[1], rgb[2], Math.min(1, a)], n * 4);
      glow.sizesNm[n] = size; n++;
    };
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
    glow.count = n;
    const cam = cameraAxes(nm);
    if (cam) glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
    setNgeGlow(n ? glow : null, 'intro-spark');
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    sparkRaf = requestAnimationFrame(step);
  };
  sparkRaf = requestAnimationFrame(step);
}
function stopSpark() { cancelAnimationFrame(sparkRaf); setNgeGlow(null, 'intro-spark'); }

/* ── the synapse marker: a soft pulse ── */
let pulseRaf = 0;
function runPulse(at: V3, rgb: [number, number, number] = [0.6, 0.88, 1]) {
  const nm = nmPerUnit();
  if (!nm) return;
  const glow: NgeGlow = {positions: Float32Array.from([at[0] / nm[0], at[1] / nm[1], at[2] / nm[2]]), colors: new Float32Array(4), sizesNm: new Float32Array(1), count: 1, nmRight: [1 / nm[0], 0, 0]};
  const t0 = performance.now();
  const step = (now: number) => {
    const k = 0.5 + 0.5 * Math.sin((now - t0) / 1000 * 4);
    void k;
    glow.colors.set([rgb[0], rgb[1], rgb[2], 1]);
    glow.sizesNm[0] = 3400;
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
.nge-intro { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 0); z-index: 9500; isolation: isolate;
  width: min(620px, calc(100vw - 24px)); box-sizing: border-box; padding: 16px 20px 16px;
  color: #e6f3ff; font: 15px/1.5 'Inter', 'Roboto', sans-serif; opacity: 0; pointer-events: none; }
.nge-intro--in { pointer-events: auto; animation: nge-holo-in 900ms cubic-bezier(.16,1,.3,1) both; }
@keyframes nge-holo-in {
  0% { opacity: 0; transform: translate(-50%, 18px) scaleY(0.04); filter: blur(8px) brightness(2.2) drop-shadow(0 0 0 rgba(80, 180, 255, 0)); }
  35% { opacity: 1; transform: translate(-50%, 6px) scaleY(1.02); filter: blur(3px) brightness(1.6) drop-shadow(0 0 30px rgba(80, 180, 255, 0.6)); }
  100% { opacity: 1; transform: translate(-50%, 0) scaleY(1); filter: blur(0) brightness(1) drop-shadow(0 0 18px rgba(80, 180, 255, 0.28)); } }
.nge-intro--out { animation: nge-holo-out 420ms ease-in both; }
@keyframes nge-holo-out { to { opacity: 0; transform: translate(-50%, 10px) scaleY(0.04); filter: blur(6px) brightness(2); } }
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
.nge-intro-title { margin: 8px 0 4px; font: 700 22px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; color: #fff; text-shadow: 0 0 14px rgba(126, 210, 255, 0.55); }
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
.nge-callout-box .nge-frame path { animation: nge-trace 800ms ease-out both; animation-delay: calc(150ms + var(--i, 0) * 40ms); }
.nge-callout-box .nge-frame circle { animation: nge-node 300ms ease-out both; animation-delay: calc(600ms + var(--i, 0) * 40ms); }
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
.nge-card-key i { width: 11px; height: 11px; border-radius: 50%; background: var(--c); box-shadow: 0 0 8px var(--c); }
.nge-card-key small { color: rgba(200, 230, 255, 0.7); font-size: 12px; text-align: right; white-space: nowrap; }
.nge-card-key b { font-weight: 600; }
.nge-card-key .hd { grid-column: 1 / -1; font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.24em; text-transform: uppercase; color: rgba(126, 202, 255, 0.85); margin-top: 4px; }
.nge-intro-key i { width: 18px; height: 5px; border-radius: 3px; background: var(--c); box-shadow: 0 0 6px var(--c); margin-left: 8px; }
.nge-intro-key i:first-child { margin-left: 0; }
.nge-intro-key i.dot { width: 8px; height: 8px; border-radius: 50%; }
.nge-intro--choice > .nge-intro-row { flex-wrap: wrap; }
.nge-intro--choice .nge-intro-back { order: 0; }
.nge-intro--choice .nge-intro-alt { order: 1; margin-left: auto; }
.nge-intro--choice .nge-intro-go { order: 2; margin-left: 10px; }
.nge-intro--choice .nge-go-label { padding: 0 16px; font-size: 11.5px; letter-spacing: 0.14em; }
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
.nge-intro--waiting { opacity: 0 !important; transform: translate(-50%, 16px) !important; pointer-events: none; }
/* Leaving asks first. */
.nge-intro-confirm { display: none; }
.nge-intro--asking .nge-intro-title, .nge-intro--asking .nge-intro-body, .nge-intro--asking > .nge-intro-row { display: none; }
.nge-intro--asking .nge-intro-confirm { display: block; }
.nge-intro-confirm p { margin: 10px 0 2px; font: 700 18px 'Orbitron', 'Inter', sans-serif; color: #fff; }
.nge-intro-confirm small { display: block; color: #a9c3de; font-size: 13px; }
.nge-intro-leave { background: none; border: 1px solid rgba(255, 140, 170, 0.6); color: #ffc2d2; border-radius: 6px; padding: 8px 16px; cursor: pointer;
  font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-intro-leave:hover { background: rgba(255, 120, 160, 0.14); color: #fff; }
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
  animation: nge-proj-in 520ms cubic-bezier(.2,1,.3,1) both; }
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
.nge-callout-beam { animation: nge-beam 2.4s ease-in-out infinite; }
@keyframes nge-beam { 50% { opacity: 0.65; } }
@media (prefers-reduced-motion: reduce) { .nge-callout-box, .nge-callout-beam { animation: none; } }
.nge-callout-title { display: flex; align-items: center; gap: 10px; margin-top: 3px; font: 700 21px/1.15 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; color: #fff; text-shadow: 0 0 14px rgba(126, 210, 255, 0.55); }
.nge-callout-ic { width: 11px; height: 11px; border-radius: 50%; background: var(--part, #7ecaff); box-shadow: 0 0 10px var(--part, #7ecaff); flex: none; }
.nge-callout-box { isolation: isolate; }
.nge-callout-box .nge-callout-kicker { color: rgba(140, 215, 255, 0.75); }
.nge-callout-box .nge-callout-title { color: #aeeaff; text-shadow: 0 0 12px rgba(80, 190, 255, 0.7); font-size: 15px; gap: 8px; }
.nge-callout-box { min-width: 150px !important; max-width: min(290px, 40vw) !important; padding: 10px 14px 12px !important; }
.nge-callout-box .nge-callout-kicker { font-size: 8.5px; display: flex; align-items: center; gap: 7px; color: #9fdcff; }
.nge-callout-box .nge-callout-stats { gap: 6px 14px; margin-top: 7px; padding-top: 7px; }
.nge-callout-box .nge-callout-stats dt { font-size: 7.5px; }
.nge-callout-box .nge-callout-stats dd { font-size: 12.5px; }
.nge-callout-box .nge-callout-stats .num { font-size: 17px; }
.nge-callout-box .nge-callout-stats .unit { font-size: 10.5px; }
.nge-callout-box .nge-callout-ic { width: 8px; height: 8px; }
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
  return `<svg class="nge-frame" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="rim" pathLength="1" d="${rim}"/>${traces.join('')}${sp}${pads.join('')}</svg>`;
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

function showCallout(anchor: V3, title: string, stats: [string, string][] = [], color = '#7ee0ff', pointAt = true, showDot = true) {
  hideCallout();
  callout = document.createElement('div');
  callout.className = 'nge-callout';
  const rows = stats.length;
  // The box is a hologram the Starship projects: a cone of light from the
  // ship up to it (Ames), and a fine line from it down to the part.
  callout.innerHTML = `<svg aria-hidden="true"><defs><linearGradient id="nge-beam-g" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#c9f6ff" stop-opacity="0.55"/><stop offset="1" stop-color="#7ee0ff" stop-opacity="0.06"/></linearGradient></defs>
    <polygon class="nge-callout-beam" fill="url(#nge-beam-g)"/><line class="nge-callout-pointer" stroke="${color}" stroke-width="1.6" stroke-linecap="round" style="filter: drop-shadow(0 0 4px ${color})"/>
    <circle class="nge-callout-dot" r="4.5" fill="${color}" style="filter: drop-shadow(0 0 6px ${color})"/><circle class="nge-callout-lens" r="3.5" fill="#e6fbff"/></svg>
    <div class="nge-callout-box" style="--part:${color}"><span class="nge-frame-host"></span><div class="nge-callout-kicker"><span class="nge-callout-ic"></span>Pyr scan · ${title}</div>${rows ? `<dl class="nge-callout-stats">${stats.map(([k, v]) => `<div><dt>${STAT_ICON[k] ?? ''}${k}</dt><dd>${statValue(v)}</dd></div>`).join('')}</dl>` : ''}</div>`;
  document.body.appendChild(callout);
  const beam = callout.querySelector('polygon')!, grad = callout.querySelector('linearGradient')!;
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
    callout?.classList.toggle('nge-callout--in', !starshipMoving());
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
        beam.setAttribute('points', side ? `${sx},${sy} ${bx},${by + 8} ${bx},${by + bh - 8}` : `${sx},${sy} ${bx + 6},${by + bh} ${bx + bw - 6},${by + bh}`);
        grad.setAttribute('x1', String(sx)); grad.setAttribute('y1', String(sy));
        grad.setAttribute('x2', String(side ? bx : bx + bw / 2)); grad.setAttribute('y2', String(side ? by + bh / 2 : by + bh));
        lens.setAttribute('cx', String(sx)); lens.setAttribute('cy', String(sy));
        beam.style.display = lens.style.display = '';
      } else {
        beam.style.display = lens.style.display = 'none';
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
    <div class="nge-intro-head"><span class="nge-intro-dot"></span>Transmission received · Pyr<button class="nge-intro-x" type="button" aria-label="Leave the introduction">${X_SVG}</button></div>
    <div class="nge-intro-title"></div><p class="nge-intro-body" aria-live="polite"></p>
    <div class="nge-intro-row"><button class="nge-back nge-intro-back" type="button" aria-label="Back">${CHEV_L}</button>
      <span class="nge-intro-key" hidden><i style="--c:#ffd24d"></i>Soma<i style="--c:#9b72ff"></i>Dendrites<i style="--c:#5ec8ff"></i>Axons<i style="--c:#ffd24d" class="dot"></i>Input synapses<i style="--c:#ff5fd2" class="dot"></i>Output synapses</span>
      <span class="nge-intro-choose" hidden>Choose your next adventure</span>
      <button class="nge-go nge-go--alt nge-intro-alt" type="button" hidden><span class="nge-go-label">Explore a bigger neuron</span></button>
      <button class="nge-go nge-intro-go" type="button"><span class="nge-go-label nge-intro-label"></span><span class="nge-go-chevs" aria-hidden="true"><i></i><i></i><i></i></span></button></div>
    <div class="nge-intro-confirm" role="alertdialog" aria-label="Leave the introduction?"><p>Leave the introduction?</p><small>You can start mapping right away.</small>
      <div class="nge-intro-row"><button class="nge-intro-leave" type="button">Leave</button><button class="nge-go nge-intro-stay" type="button"><span class="nge-go-label">Keep going</span><span class="nge-go-chevs" aria-hidden="true"><i></i><i></i><i></i></span></button></div></div>`;
  document.body.appendChild(panel);
  document.body.classList.add('nge-intro-on');
  requestAnimationFrame(() => panel?.classList.add('nge-intro--in'));
  const titleEl = panel.querySelector('.nge-intro-title') as HTMLElement;
  const bodyEl = panel.querySelector('.nge-intro-body') as HTMLElement;
  const nextEl = panel.querySelector('.nge-intro-go') as HTMLButtonElement;
  const labelEl = panel.querySelector('.nge-intro-label') as HTMLElement;
  const backEl = panel.querySelector('.nge-intro-back') as HTMLButtonElement;
  const altEl = panel.querySelector('.nge-intro-alt') as HTMLButtonElement;
  const stayEl = panel.querySelector('.nge-intro-stay') as HTMLButtonElement;
  const ask = (on: boolean) => {
    panel?.classList.toggle('nge-intro--asking', on);
    (on ? stayEl : nextEl).focus({preventScroll: true});
  };
  (panel.querySelector('.nge-intro-x') as HTMLButtonElement).onclick = () => ask(true);
  (panel.querySelector('.nge-intro-leave') as HTMLButtonElement).onclick = endTour;
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
    const want = i === NEURON ? 'dock' : i === SOMA ? 'soma' : i < DEND ? 'pad' : i < AXON ? 'dend' : i < SYN ? 'axon' : i < SYN2 ? 'syn' : 'syn2';
    const shipMoves = want !== shipAt;
    const zipping = !!callout;
    const shipDelay = zipping ? 440 : 0;
    void from;
    const camDelay = shipDelay + (shipMoves ? 1300 : 0);
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
    bodyEl.textContent = plain(b.body);
    bodyEl.style.minHeight = `${bodyEl.offsetHeight}px`;
    if (panel) (panel.querySelector('.nge-frame-host') as HTMLElement).innerHTML = frameSvg(panel.offsetWidth, panel.offsetHeight, 18);
    // the words wait for the ship: the box steps aside while it flies and
    // comes back with the new message when it has stopped
    if (bodyEl) bodyEl.textContent = '';
    panel?.classList.add('nge-intro--waiting');
    const shown0 = performance.now();
    const reveal = () => {
      if (!active || i !== n) return;
      const flying = starshipMoving() && performance.now() - shown0 < 12000;
      if (flying || performance.now() - shown0 < (shipMoves ? shipDelay + 400 : 250)) { requestAnimationFrame(reveal); return; }
      panel?.classList.remove('nge-intro--waiting');
      type(bodyEl, b.body);
    };
    requestAnimationFrame(reveal);
    hideCallout(true); stopSpark(); stopPulse(); stopAllSynapses();
    // the parts: ones met before this beat stay softly coloured, this one glows
    const shown = new Set<number>();
    for (let k = 0; k < i; k++) { const p = BEATS[k].part; if (p) shown.add(p); }
    cancelAnimationFrame(tintRaf);
    setNgeMeshTint(partsTint(shown));
    // the camera, framing the subject in the open space above the panel
    const camera = () => {
      if (!active || i !== n) return;
      let center: V3 = b.view.at === 'cell' ? cellCenter(t) : b.view.at === 'dendView' ? [307744, 175892, 86080] : t.anchors[b.view.at];
      // welcome: the soma and the ship on it, both well inside the frame
      const pad = t.dendFlight[0];
      if (b.key === 'welcome') center = [0, 1, 2].map(k => (center[k] + pad[k]) / 2) as V3;
      // the action potential: from up close where we are, a slow pull back
      // to the whole cell (no dash across to the axon first)
      const ms = b.key === 'spike' ? 5200 : b.key === 'welcome' ? 2200 : 1800;
      const shipLeft = starshipEta();
      const msNow = b.key === 'spike' ? ms : Math.max(ms, glideMs(framed(center, b.view.nm), b.view.nm, ms), shipLeft + 500);
      if (b.key === 'spike') setTimeout(() => { if (active && i === n) moveCamera(framed(center, b.view.nm), b.view.nm, ms); }, 1300);
      else if (!(b.key === 'welcome' && from < 0)) moveCamera(framed(center, b.view.nm), b.view.nm, msNow);
      setTimeout(() => { if (active && i === n) revealTint(shown, b.part); }, b.key === 'spike' ? 600 : ms * 0.55);
    };
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
    if (b.key === 'synapse') { showCell(t.synapsePartner, PARTNER_COLOR); runPulse(t.anchors.synapse); }
    if (b.key === 'synapse2') { showCell(t.syn2Partner, SYN2_COLOR); runPulse(t.anchors.synapse2, [1, 0.86, 0.45]); }
    if (b.key === 'allsyn') runAllSynapses(t);
    if (b.key === 'spike') runSpark(t);
    if (b.callout) setTimeout(() => { if (active && i === n) showCallout(t.anchors[b.callout!.anchor], b.callout!.title, b.callout!.stats, b.key === 'neuron' ? '#4f8cff' : ANCHOR_HEX[b.callout!.anchor], b.key === 'soma' || b.key === 'synapse', b.key !== 'neuron'); }, shipDelay + 900);
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  };
  /** Off the pad, the ship hovers just above it: over the soma, on the
   *  viewer's side (Ames: the ship was behind the soma). */
  const somaHover = (): number[] => {
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
    const a = nearest(route, starshipAt()), b2 = to ? nearest(route, to) : route.length - 1;
    return route.slice(a, Math.max(a + 1, b2 + 1));
  };
  const moveShip = (from: typeof shipAt, want: typeof shipAt, camLag: number) => {
    {
      const shipAt = from;
      const aEnd = t.axonFlight[t.axonFlight.length - 1];
      if (want === 'soma') {
        if (shipAt === 'dock') undockStarship();
        if (shipAt === 'dend') starshipHop(onward([...t.dendFlight].reverse(), somaHover()), 4);
        else starshipHop([somaHover()], 2.6);
      } else if (shipAt === 'soma' && want === 'pad') starshipHop([t.dendFlight[0]], 2);
      else if (shipAt === 'soma' && want === 'dend') starshipHop(onward(t.dendFlight), 5);
      else if (want === 'dock') {
        // to the right side of the view, just left of where its card sits
        const pr = threeDPanel()?.element?.getBoundingClientRect?.();
        const cardW = Math.min(360, window.innerWidth * 0.42);
        const sx = pr ? (pr.right - cardW - 70 - (pr.left + pr.width / 2)) / (pr.width / 2) : 0.4;
        const nb = BEATS[NEURON];
        const est = glideMs(framed(cellCenter(t), nb.view.nm), nb.view.nm, 1800);
        dockStarship(Math.max(0.15, Math.min(0.75, sx + 0.2)), -0.2, camLag + est);
      } else if (shipAt === 'dock') {
        undockStarship();
        starshipHop([t.dendFlight[0]], 3);
      } else
      if (shipAt === 'dend' && want === 'axon') starshipHop(t.axonFlight, 9);
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
  go(0);
}

/** Start playing Pyr: the Get Started tutorial. */
function startGetStarted() {
  clearStarship();
  stopAllSynapses();
  const t = useTutorialStore();
  t.activeTutorial = 1;
  t.setTutorialStep(0);
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
    <div class="nge-intro-title"></div><p class="nge-intro-body" aria-live="polite"></p><dl class="nge-callout-stats" hidden></dl><div class="nge-card-key" hidden></div>
    <div class="nge-intro-row"><span></span><button class="nge-go nge-intro-go" type="button" hidden><span class="nge-go-label"></span></button></div>`;
  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.add('nge-intro--in'));
  const close = () => { card.classList.add('nge-intro--out'); setTimeout(() => card.remove(), 450); };
  // no X here: its button is the way back from MICrONS (Ames)
  const set = (title: string, body: string, stats: [string, string][] = [], button?: {label: string; go: () => void; keep?: boolean}, keyHtml = '') => {
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
    (card.querySelector('.nge-frame-host') as HTMLElement).innerHTML = frameSvg(card.offsetWidth, card.offsetHeight, 18);
    type(bodyEl, body);
  };
  return {set, close};
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
  ml.setVisible?.(true);
  const g = ml.layer.displayState.segmentationGroupState.value;
  g.visibleSegments.clear();
  g.visibleSegments.add(Uint64.parseString(BIG_NEURON));
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
  card.set('A Martinotti cell',
    'Unlike our pyramidal neuron, this one is inhibitory: its signals tell other cells to quiet down. Proofreaders traced every branch of its axon, which climbs toward the surface of the brain and touches thousands of cells. Spin it around!',
    [['Cell type', 'Martinotti cell'], ['Class', 'Inhibitory'], ['Neurotransmitter', 'GABA'], ['Axon length', 'about 32 mm'],
     ['Input', '6,363 synapses'], ['Output', '8,110 synapses']],
    {label: 'Show its connections', keep: true, go: () => void showConnections(card, ml)});
}

/** Cell types (aibs_metamodel_celltypes_v661) in words and colors:
 *  excitatory warm, inhibitory cool (Ames: partners colored by type). */
const MC_TYPES: Record<string, [string, string]> = {
  '23P': ['Layer 2/3 pyramidal', '#ff9f43'], '4P': ['Layer 4 pyramidal', '#ffd166'], '5P-IT': ['Layer 5 pyramidal', '#ff6b6b'],
  '5P-ET': ['Layer 5 pyramidal, long range', '#ff4d8d'], '5P-NP': ['Layer 5 near-projecting', '#f78fb3'], '6P-IT': ['Layer 6 pyramidal', '#ffa07a'],
  '6P-CT': ['Layer 6 corticothalamic', '#e17055'], 'BC': ['Basket cell', '#4dd0e1'], 'MC': ['Martinotti cell', '#9b8cff'],
  'BPC': ['Bipolar cell', '#7bed9f'], 'NGC': ['Neurogliaform cell', '#a3e4ff'],
};
interface McData { synIn: number[]; synOut: number[]; synUnit: number; partners: {id: string; dir: 'in' | 'out'; synapses: number; type: string}[]; }
/** All its synapses as dots, gold in and blue out, and its strongest
 *  partners drawn in their type's color, with a key. */
async function showConnections(card: ReturnType<typeof transmissionCard>, ml: any) {
  let mc: McData | null = null;
  try { const r = await fetch('intro/microns-mc.json'); if (r.ok) mc = await r.json(); } catch { /* no data */ }
  if (!mc) { card.close(); startGetStarted(); return; }
  runAllSynapses(mc, 3.5);
  const g = ml.layer.displayState.segmentationGroupState.value;
  const colors = ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors;
  const hexNum = (h: string) => parseInt(h.slice(1), 16);
  mc.partners.forEach((p, k) => setTimeout(() => {
    try {
      const seg = Uint64.parseString(p.id);
      g.visibleSegments.add(seg);
      setStatedColor(colors, seg, packed(hexNum((MC_TYPES[p.type] ?? [p.type, '#cccccc'])[1])));
    } catch { /* skip this one */ }
  }, 600 + k * 500));
  const row = (p: McData['partners'][number]) => {
    const [name, color] = MC_TYPES[p.type] ?? [p.type, '#cccccc'];
    return `<i style="--c:${color}"></i><span><b>${name}</b></span><small>${p.synapses} synapses</small>`;
  };
  const outs = mc.partners.filter(p => p.dir === 'out'), ins = mc.partners.filter(p => p.dir === 'in');
  const key = `<span class="hd">It sends to</span>${outs.map(row).join('')}<span class="hd">It hears from</span>${ins.map(row).join('')}`;
  card.set('Its connections',
    'Every dot is a synapse: {in:gold} ones bring signals in, {out:pink} ones carry its signal out. It talks to thousands of cells. Here are the ones it shares the most synapses with, colored by cell type.',
    [], {label: 'Start playing Pyr', go: () => startGetStarted()}, key);
}

/** The whole intro: the Starship flies in and lands, then the tour. */
export function playIntro() {
  endTour();
  clearStarship();
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
  const wanted = () => simulating.value || /[?&]starship\b/.test(location.search);
  const go = async () => {
    if (!wanted() || playedThisLoad) return;
    playedThisLoad = true;
    await Promise.all([loadAssets(), loadTour()]).catch(() => {});
    for (let k = 0; k < 80 && !cellDrawn(); k++) await new Promise(r => setTimeout(r, 250));
    if (wanted()) playIntro();
  };
  setTimeout(go, 1500);
  watch(simulating, on => { if (on) { playedThisLoad = false; void go(); } });
}

(window as any).pyrIntro = {play: playIntro, tour: startIntroTour, end: endTour};
