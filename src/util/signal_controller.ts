/**
 * Signal Controller (Ames 2026-11-08): a mini game played inside a small
 * piece of real cortex. The player is the signal controller aboard the
 * Starship, parked over a real MICrONS circuit (static/signal/circuit.json,
 * built by scripts/signal-circuit.py from the public release: 13 proofread
 * cells, their real synapses, and the real axon paths between them). Target
 * cells must fire at the right time, in order, or together, and a target
 * cannot be shot: its partners are the controls. A Spark beam makes a cell
 * fire, a Hush beam quiets it, and the circuit does the rest. The cells
 * fight back the way they really do: a Martinotti cell (the Gatekeeper)
 * holds the targets down, a bipolar cell (the Key) holds the Gatekeeper
 * down, and some drivers wake the Gatekeeper as they fire.
 *
 * The cells are drawn by Neuroglancer from the release's own meshes (no sign
 * in); the ship, the beams, the spikes and the sparks that run the axons are
 * drawn inside the 3D view (perspective_view/nge_props.ts), hidden by the
 * cells in front of them, like the intro's Starship. The HUD is a hologram
 * panel after Ames's scifi-ui (cockpit HUD: an objective bracket, the
 * neurons involved as chips, one warm accent for the target).
 *
 * The model is a cartoon on real wiring: each cell sums its excitation (one
 * unit per synapse, leaking away over 1.2 s) against its inhibition (0.6 per
 * synapse, leaking over 0.35 s), fires at a threshold, and rests 0.4 s. A
 * spike runs the real path at 500 um/s, about a thousand times slower than
 * life, so a round trip can be watched. The Gatekeeper, when awake, is a
 * clock: it fires on its own period, inhibition pushes its clock back,
 * excitation pulls it forward.
 *
 * Test sites only for now: the palette (admins), the Intro test panel's
 * bolt, ?signal in the address, or window.pyrSignal.play().
 */
import {setNgeGlow, setNgeProps, type NgeGlow, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {getNgeMeshTint, ngeMeshTintChanged, setNgeMeshTint, type NgeMeshTint} from 'neuroglancer/mesh/nge_tint';
import {makeLayer} from 'neuroglancer/layer';
import {mat4, quat} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {loadGlbModel} from './glb';
import {cameraAxes} from './starship';
import {findDatasetBySegName, switchToDataset} from '../datasets';
import {setStatedColor} from '../widgets/widget_utils';
import {IS_LIVE_SITE} from './toolbar_staging';
import {hideMobileWelcomeRef} from './mobile';

type V3 = [number, number, number];
/** A cell's synapses onto (or from) the release's cells of one type. */
interface Partner { type: string; cls: 'E' | 'I' | 'N'; n: number; }
interface CircuitCell { key: string; root: string; type: 'E' | 'I'; fine: string; mtype: string; label: string; soma: V3; cableUm: number; axonUm: number; synIn?: number; synOut?: number; partners?: {out: Partner[]; in: Partner[]}; }
/** w: the synapses' weight in play (1 as the data has them; a plastic level grows it). */
interface CircuitConn { pre: string; post: string; count: number; axonUm: number; dendriteUm: number; axon: V3[]; dendrite: V3[]; synapse: V3; synapses: V3[]; w?: number; }
interface Circuit { version: number; cells: CircuitCell[]; connections: CircuitConn[]; }

/* ── the rules ── */
const TAU_E = 1.2, TAU_I = 0.35;       // seconds of leak
const E_UNIT = 1.0, I_UNIT = 0.6;      // units per synapse
const REFRACTORY_S = 0.4;
const AP_DELAY_S = 0.35;               // the cell body sparkles first, then the spike leaves (Ames 2026-11-12: "a slight delay between soma particles and the AP leaving the cell")
/** Fast-spiking cells (the basket cell): no wind-up and spikes that run
 *  this many times faster, as perisomatic inhibition does. */
const FAST: Record<string, number> = {B1: 12};   // the clip lands 0.33 s after E1's own excitation: a second E1 spike (0.4 s on) is clipped, E2 then E1 a beat later gets past
const SPEED_UM_S = 200;                // a spike along the real path: about 2,000 times slower than life, slow enough to watch (Ames 2026-11-11: "too fast!"; "the speed is way too fast")
const HUSH_S = 2.5;
const BEAM_S = 0.3;                    // the Spark's flight
const HUSH_BEAM_S = 1.3;               // the Hush's: slow, a ribbon drifting over (Ames 2026-11-11: "slow down the hush beam")
const landS = (b: {hush: boolean}) => b.hush ? HUSH_BEAM_S : BEAM_S;
const MAX_CHARGES = 6, REGEN_S = 1.5, SPARK_COST = 1, HUSH_COST = 2;
/** The Gatekeeper's clock: seconds its next spike moves per unit of input. */
const GATE_PUSH_S = 0.15, GATE_PULL_S = 0.08;
const THRESHOLD: Record<string, number> = {T: 8, E4: 6, I2: 6, S: 6};
const DEFAULT_THRESHOLD = 6;
const SHIP_LENGTH_NM = 26_000;

/* ── the levels ── */
type Goal = {kind: 'fire'; target: string; count: number}
  | {kind: 'sequence'; order: [string, string]; withinS: number; count: number}
  | {kind: 'sync'; targets: [string, string]; withinS: number; count: number}
  /** on the beat: each firing within withinS of the last, or the count starts over */
  | {kind: 'beat'; target: string; withinS: number; count: number}
  /** on its own: a firing to which only the driver's spikes contributed in the last windowS */
  | {kind: 'solo'; target: string; driver: string; windowS: number; count: number};
/** The coach line says one thing at a time, as the level unfolds (Ames
 *  2026-11-08: "what am I supposed to do? it's too complicated"). */
type CoachEvent = 'begin' | 'driver' | 'pulse' | 'hushed' | 'key' | 'hit' | 'miss' | 'go' | 'wait' | 'soon';
interface Level {
  title: string; objective: string; detail: string; brief: string;
  cells: string[]; targets: string[];
  /** The Gatekeeper's own rhythm, if it is awake. */
  gate?: {cell: string; periodS: number};
  hush: boolean; hushBlocked?: string[];
  /** The principle at work, in a sentence or two, behind "The science" in the HUD's foot. */
  science?: string;
  /** Thresholds for this level alone, by cell. */
  theta?: Record<string, number>;
  /** Synapses that grow when their spikes help a target fire (level 9). */
  plastic?: boolean;
  goal: Goal; timeS: number; par: number;
  coach: Partial<Record<CoachEvent, string>>;
  /** Which cells light up as the thing to click, per coach event (Ames
   *  2026-11-08: "it's not clear what I'm trying to click or why"). */
  hint?: Partial<Record<CoachEvent, string[]>>;
}
/** What each cell is for, on its chip and tag. */
const ROLE: Record<string, string> = {T: 'Target', E4: 'Driver', I1: 'Gatekeeper', I2: 'Key', S: 'Switch', B1: 'Clipper'};
const LEVELS: Level[] = [
  // Level 1 is one driver and a rhythm (Ames 2026-11-08: "click some
  // pyramidal neurons to fire downstream at the right frequency"): two quick
  // sparks on E1 add up at the gold cell; slow ones leak away first.
  {title: 'First Light', objective: 'Spike the gold cell', detail: '', timeS: 60, par: 6,
    science: 'Temporal summation: a neuron adds its inputs up, and the charge leaks away in about a second, so spikes that arrive close together reach the threshold where one alone cannot.',
    brief: 'These are real neurons from the brain: an excitatory pyramidal cell (gold) and four of the cells that drive it.\nYour Spark beam fires a cell, and its spike runs down the axon to the gold cell. One spike is not enough on its own, but spikes that arrive close together add up.\nE1 makes the most synapses onto the gold cell, five, so two quick spikes from it are enough on their own. The other drivers carry less and need company.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4'], targets: ['T'], hush: false,
    goal: {kind: 'fire', target: 'T', count: 3},
    coach: {driver: 'Again, right away: the second spike has to land while the first is still there.',
      hit: 'One down. Again: E1 twice, quickly.',
      miss: 'Too slow between clicks: the charge leaked away. Two clicks within half a second.'},
    hint: {begin: ['E1'], driver: ['E1'], hit: ['E1'], miss: ['E1']}},
  // The Gatekeeper's rhythm is slow here on purpose (Ames 2026-11-08: "it's
  // flashing through too much, it's not clear when/why other cells are
  // making it so I have to have a gap"): at 2.2 s the go window was half a
  // second and the light flipped four times a cycle. At 4.2 s one cycle
  // reads as a story: the violet cell winds up and pulses, the pulse runs
  // down its axon, the gold cell turns violet and comes back, go.
  {title: 'The Gatekeeper', objective: 'Spike the gold cell', detail: '3 times, in the gaps between pulses', timeS: 60, par: 6,
    science: 'Inhibition: a Martinotti cell (SST+) synapses onto pyramidal cells’ dendrites. While its inhibition lasts, the same excitation falls short of threshold.',
    brief: 'A new cell, in violet: a Martinotti cell, the Gatekeeper. About every four seconds it pulses, and the pulse runs down its axon and holds the gold cell down for a moment: watch the gold cell turn violet, then come back.\nFire the gold cell three times, in the gaps between pulses. The coach line turns blue when a gap opens.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4', 'I1'], targets: ['T'], hush: false, gate: {cell: 'I1', periodS: 4.2},
    goal: {kind: 'fire', target: 'T', count: 3},
    coach: {begin: 'Watch the violet cell pulse, and the gold cell turn violet as the pulse lands.',
      go: 'Go: click E1 twice, quickly.',
      wait: 'Wait: the Gatekeeper’s pulse is holding the gold cell down.',
      soon: 'Not yet: the Gatekeeper is about to pulse.',
      hit: 'One down. Wait for the next gap.',
      miss: 'The pulse caught it: the charge was still building when the pulse landed. Click twice as soon as the line turns blue.'},
    hint: {go: ['E1'], hit: [], wait: [], soon: []}},
  {title: 'Lights Out', objective: 'Spike the gold cell', detail: '3 times: Inhibit the Gatekeeper first', timeS: 60, par: 12,
    science: 'Disinhibition: silence an inhibitory cell (as optogenetics can) and its targets are released. Quiet the Gatekeeper, and the gold cell fires on less.',
    brief: 'The Gatekeeper pulses every second now; the gaps are nearly gone.\nA new beam: Inhibit quiets a cell for 2.5 s (2 charges). Inhibit the Gatekeeper, then fire the drivers into the quiet.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4', 'I1'], targets: ['T'], hush: true, gate: {cell: 'I1', periodS: 1.0},
    goal: {kind: 'fire', target: 'T', count: 3},
    coach: {begin: 'Choose Inhibit (the button, or Tab), then click the violet cell, I1.',
      wait: 'Choose Inhibit, then click I1 to quiet it.',
      go: 'Go: Spark E1 twice, quickly.',
      hit: 'Again: Inhibit the Gatekeeper, then E1 twice.',
      miss: 'Inhibit first, then two quick sparks inside the 2.5 s.'},
    hint: {begin: ['I1'], wait: ['I1'], go: ['E1'], hit: ['I1']}},
  {title: 'The Key', objective: 'Fire T, then E4', detail: 'within 2 s, twice', timeS: 75, par: 13,
    science: 'The disinhibitory motif: a bipolar cell (VIP+) inhibits the Martinotti cell (SST+) and not the pyramidal cells, so firing it lifts the brake on them. VIP → SST → pyramidal (Pfeffer et al. 2013; Pi et al. 2013).',
    brief: 'The Gatekeeper’s shield blocks your Inhibit beam now. But a bipolar cell (magenta) makes 20 synapses onto the Gatekeeper and none onto the pyramidal cells: a key.\nE4 is a second target, with its own drivers F1, F2 and F3.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4', 'F1', 'F2', 'F3', 'I1', 'I2'], targets: ['T', 'E4'], hush: true, hushBlocked: ['I1'], gate: {cell: 'I1', periodS: 1.0},
    goal: {kind: 'sequence', order: ['T', 'E4'], withinS: 2, count: 2},
    coach: {begin: 'Spark I2, the magenta cell. Its 20 synapses quiet the Gatekeeper for a moment.',
      wait: 'Spark I2 to quiet the Gatekeeper.',
      go: 'Go: E1 twice for the gold cell, then F1, F2 and F3 for E4.',
      hit: 'A sequence! Once more: I2, then the drivers.',
      miss: 'The order is I2 first, then E1 twice, then F1 + F2 + F3.'},
    hint: {begin: ['I2'], wait: ['I2'], go: ['E1', 'F1', 'F2', 'F3'], hit: ['I2']}},
  {title: 'In Sync', objective: 'Fire T and E4 together', detail: 'three times', timeS: 90, par: 18,
    science: 'A chain and a coincidence: a pyramidal cell drives the VIP cell that quiets the SST cell, and two cells fire together only when their inputs land within the window the leak allows.',
    brief: 'A layer 2/3 pyramidal cell, S, sits above the circuit and drives the Key with 10 synapses: a chain of three.\nLand T and E4 within a quarter second of each other, three times.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4', 'F1', 'F2', 'F3', 'G1', 'G2', 'I1', 'I2', 'S'], targets: ['T', 'E4'], hush: true, hushBlocked: ['I1'], gate: {cell: 'I1', periodS: 1.0},
    goal: {kind: 'sync', targets: ['T', 'E4'], withinS: 0.25, count: 3},
    coach: {begin: 'Spark S. It fires the Key, and the Key quiets the Gatekeeper.',
      wait: 'Spark S to start the chain.',
      go: 'Go: all five drivers at once, E1, E2, F1, F2, F3 (the number keys help).',
      hit: 'In sync! Two more.',
      miss: 'Both targets within a quarter second: fire all five drivers together.'},
    hint: {begin: ['S'], wait: ['S'], go: ['E1', 'E2', 'F1', 'F2', 'F3'], hit: ['S']}},
  // Level 6: feedforward inhibition. E1 drives the gold cell and a basket
  // cell, B1 (10 synapses); B1 is fast and inhibits the gold cell (8
  // synapses) right after E1's own excitation lands, so a second E1 spike is
  // clipped. E2 does not wake B1 (5 synapses, under its threshold), so E2
  // first and E1 a beat later land together, before the clip.
  {title: 'The Clipper', objective: 'Spike the gold cell', detail: '3 times, past the Clipper', timeS: 75, par: 8,
    science: 'Feedforward inhibition: the input that excites a pyramidal cell also drives a basket cell (PV+), whose fast perisomatic inhibition arrives a moment later and closes the window. Only inputs that arrive together get through.',
    brief: 'E1 drives the gold cell, and a basket cell, B1, the Clipper. B1 is fast: its inhibition lands right after E1’s excitation and clips what follows.\nE2 does not wake it. E2 first, then E1 a beat later, land together.',
    cells: ['T', 'E1', 'E2', 'B1'], targets: ['T'], hush: false,
    goal: {kind: 'fire', target: 'T', count: 3},
    coach: {begin: 'E1 wakes the Clipper. Spark E2 first, then E1 half a second later, so both land before the clip.',
      driver: 'A spike is on its way.',
      hit: 'Past the Clipper! Again: E2, then E1.',
      miss: 'Clipped. E2 first, then E1 a beat later. Two E1 sparks alone get clipped.'},
    hint: {begin: ['E2', 'E1'], hit: ['E2', 'E1']}},
  // Level 7: convergence. No E1; E2, E3 and E4 carry 4, 3 and 2 synapses,
  // none enough alone; together they cross the threshold.
  {title: 'All at Once', objective: 'Spike the gold cell', detail: '3 times, with the weak drivers together', timeS: 75, par: 9,
    science: 'Convergence: a pyramidal cell needs many inputs at once. No single driver here reaches threshold; three together, within the window the leak allows, do.',
    brief: 'E1 is gone. E2, E3 and E4 carry 4, 3 and 2 synapses: none enough alone.\nSpark all three together, and they add up.',
    cells: ['T', 'E2', 'E3', 'E4'], targets: ['T'], hush: false, theta: {T: 7.6},   // E3's path is the longest: the three land over 0.16 s
    goal: {kind: 'fire', target: 'T', count: 3},
    coach: {begin: 'Spark E2, E3 and E4 together: 4 + 3 + 2.',
      driver: 'One is not enough. All three, together.',
      hit: 'Together! Again.',
      miss: 'They have to land together: spark all three at once.'},
    hint: {begin: ['E2', 'E3', 'E4'], hit: ['E2', 'E3', 'E4']}},
  // Level 8: rhythm. The Gatekeeper pulses every 1.6 s; the gold cell has
  // to fire in three gaps in a row.
  {title: 'On the Beat', objective: 'Spike the gold cell', detail: '3 gaps in a row', timeS: 75, par: 6,
    science: 'Rhythm: inhibitory interneurons pace cortical activity, and excitation gets through in the gaps between their pulses. Staying on the beat is staying in the gaps.',
    brief: 'The Gatekeeper pulses every 1.6 seconds. Spike the gold cell in three gaps in a row: miss a gap and the count starts over.',
    cells: ['T', 'E1', 'E2', 'I1'], targets: ['T'], hush: false, gate: {cell: 'I1', periodS: 1.6},
    goal: {kind: 'beat', target: 'T', withinS: 2.4, count: 3},
    coach: {begin: 'Wait for the gap, then E1 twice. Keep the beat.',
      wait: 'Held down: the next gap.',
      go: 'Go: E1 twice, now.',
      soon: 'The next pulse is close: wait for the gap after it.',
      hit: 'On the beat! The next gap.',
      miss: 'Off the beat. Into the next gap: E1 twice.'},
    hint: {begin: ['E1'], go: ['E1'], hit: ['E1']}},
  // Level 9: plasticity. E4 carries 2 synapses and cannot fire the gold cell
  // alone; each time the gold cell fires with E4's spike having just landed,
  // E4's synapses grow (Hebbian potentiation), until E4 alone can do it.
  {title: 'Wire Together', objective: 'Spike the gold cell with E4 alone', detail: 'twice, after E4 has learned', timeS: 90, par: 14,
    science: 'Hebbian plasticity: synapses that take part in firing a cell grow stronger (cells that fire together wire together: long-term potentiation). Pair a weak input with a strong one, and the weak one learns.',
    brief: 'E4 makes 2 synapses onto the gold cell: alone it can never fire it. Pair it: spark E4, then E1 twice, so E4’s spike lands as the gold cell fires. Each time, E4’s synapses grow.\nOnce they have grown, spark E4 alone, three times quickly.',
    cells: ['T', 'E1', 'E4'], targets: ['T'], hush: false, plastic: true,
    goal: {kind: 'solo', target: 'T', driver: 'E4', windowS: 1.5, count: 2},
    coach: {begin: 'Spark E4, then E1 twice. When the gold cell fires with E4’s help, E4’s synapses grow.',
      driver: 'A spike is on its way.',
      hit: 'E4 did it alone! Once more.',
      miss: 'Pair E4 with E1 first: E4, then E1 twice. Then E4 alone, three times quickly.'},
    hint: {begin: ['E4', 'E1'], hit: ['E4']}},
];

/* ── colours: a cool field, one warm accent (scifi-ui) ── */
const E_COLORS = ['#5fb8ff', '#3f9cf0', '#7ed0ff', '#4fc3e8', '#6aa8ff', '#52d8ff', '#3c8de0', '#86c8ff', '#4ab0ff', '#62c4f4'];
const I_COLOR: Record<string, string> = {I1: '#b68cff', I2: '#e58cff', B1: '#ff7eb6'};
const TARGET_COLOR = '#ffc24a';
const S_COLOR = '#9fd6ff';
const hexRgb = (hex: string): V3 => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** Neuroglancer packs a stated colour as 0xBBGGRR. */
const packRgb = (rgb: V3) => (rgb[0] & 0xff) | ((rgb[1] & 0xff) << 8) | ((rgb[2] & 0xff) << 16);

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const viewerNow = (): any => (window as any).viewer;
function nmPerUnit(): V3 | null {
  const s = viewerNow()?.coordinateSpace?.value?.scales;
  return s && s.length >= 3 ? [0, 1, 2].map(i => (Number(s[i]) || 1e-9) * 1e9) as V3 : null;
}
const LAYER_MARK = 'seg_m1300';
function circuitLayer(): any {
  return (viewerNow()?.layerManager?.managedLayers ?? []).find((m: any) => !m?.archived &&
    String(m?.layer?.dataSources?.[0]?.spec?.url ?? '').includes(LAYER_MARK) && m.layer?.displayState?.segmentationGroupState?.value?.visibleSegments);
}

/* ── a polyline by distance along it ── */
interface Route { pts: V3[]; cum: number[]; length: number; }
function route(pts: V3[]): Route {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  return {pts, cum, length: cum[cum.length - 1]};
}
function along(r: Route, s: number): V3 {
  if (r.pts.length === 1) return r.pts[0];
  s = clamp(s, 0, r.length);
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
  return mix(r.pts[lo], r.pts[hi], (s - r.cum[lo]) / ((r.cum[hi] - r.cum[lo]) || 1));
}

/* ── assets ── */
let circuit: Circuit | null = null;
let shipMesh: NgePropMesh | null = null;
async function loadAssets() {
  if (!circuit) {
    const res = await fetch('signal/circuit.json');
    if (!res.ok) throw new Error(`circuit ${res.status}`);
    circuit = await res.json();
  }
  if (!shipMesh) shipMesh = await loadGlbModel('intro/starship.glb');
}

/* ── the game ── */
interface CellState {
  key: string; spec: CircuitCell; shown: boolean; target: boolean;
  e: number; i: number; theta: number;
  refractoryUntil: number; hushedUntil: number; lastSpike: number; spikes: number;
  /** The Gatekeeper's clock: when it fires next, if it is one. */
  gateNext: number | null; gatePeriod: number;
  color: V3; packed: number; dimmed: boolean;
}
interface Arrival { at: number; post: string; units: number; inhibitory: boolean; conn: CircuitConn; }
/** scale: how large it is drawn (1 in play; the tour's dendrite signals are 2.4, with a halo). */
interface Spark { r: Route; start: number; end: number; inhibitory: boolean; conn: CircuitConn; scale?: number; }
interface Flash { p: V3; at: number; life: number; rgb: V3; size: number; }
interface Beam { from: V3; to: V3; at: number; hush: boolean; cell: string; applied: boolean; scan?: boolean; }
type Phase = 'loading' | 'brief' | 'countdown' | 'playing' | 'done';

let active = false;
let phase: Phase = 'loading';
let levelIndex = 0;
let level: Level = LEVELS[0];
const cells = new Map<string, CellState>();
let conns: CircuitConn[] = [];
let routes = new Map<CircuitConn, Route>();
let arrivals: Arrival[] = [];
let sparks: Spark[] = [];
let flashes: Flash[] = [];
let beams: Beam[] = [];
/** Sparks that landed on a cell still resting from its last spike: it fires
 *  the moment it can. A quick double click is the natural way to fire a
 *  driver twice, and a second click inside the 0.4 s rest used to fizzle
 *  ("E1 is resting"), the charge gone and the rhythm broken for no reason
 *  the player could see. */
interface Queued { cell: string; at: number; }
let queued: Queued[] = [];
let now = 0;              // game seconds since the level began playing
let charges = MAX_CHARGES;
let chargesUsed = 0;
let score = 0;
let progress = 0;
let hushMode = false;
let lastTargetSpike: Record<string, number> = {};
let sequenceArmedAt = -1;
/** On the beat: when the last counted firing was. */
let lastBeatAt = -1;
/** The excitatory arrivals of the last seconds, for a firing on its own and for plasticity. */
let recentIn: {post: string; pre: string; conn: CircuitConn; at: number}[] = [];
let raf = 0;
let lastFrame = 0;
let muted = false;
let center: V3 = [0, 0, 0];
let shipAt: V3 = [0, 0, 0];
let shipFwd: V3 = [0, 0, 1];
let shipAim: V3 | null = null;
let aimUntil = 0;
let prevUp: V3 | null = null;
/** In flight on a visit (far from where it lands), and the barrel roll under way, if any. */
let flying = false;
let roll: {at: number; dur: number} | null = null;
/** The ship's visit to a scanned cell: it flies over, hovers beside the cell
 *  body and projects the card from there, then flies back to its cockpit
 *  spot when the card is closed or the level begins (Ames 2026-11-11: "can
 *  clicking it make the ship fly over and do the projection?"). */
interface Visit { key: string; since: number; lean: number; fired: boolean; }
let visit: Visit | null = null;
/** Two ways to see it (Ames 2026-11-11: "I want to see two versions of the
 *  view: cockpit and ship"): the ship in the scene, flying to the cells it
 *  scans and projecting the card; or from its cockpit, with Pyr's Flight
 *  Mode canopy over the view, the camera gliding up to a scanned cell and
 *  the readout laid around the edges. Kept in localStorage. */
type ViewMode = 'ship' | 'cockpit';
let view: ViewMode = 'ship';
try { if (localStorage.getItem('pyr.signal.view') === 'cockpit') view = 'cockpit'; } catch { /* as it is */ }
if (document.body.classList.contains('nge-mobile')) view = 'cockpit';   // a phone has no room for the ship view (Ames 2026-11-12)
function setView(v: ViewMode) {
  view = v;
  try { localStorage.setItem('pyr.signal.view', v); } catch { /* not kept */ }
  els.view?.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  shipProp.alpha = v === 'cockpit' || document.body.classList.contains('nge-mobile') ? 0 : 1;   // no ship on a phone (Ames 2026-11-12)
  if (v === 'cockpit') showCanopy(); else hideCanopy();
  if (scanKey) showScan(scanKey); else hideScan();
}
/** The cockpit's nose: where its beams leave, low in the middle of the view. */
let cockpitNose: V3 | null = null;
/** The camera's glide in the cockpit view: up to a scanned cell, and home. */
/** seconds: a slow, even glide over so long from where the camera was (fromLook, fromScale); without it, a quick ease. */
interface Glide { look: V3; scale: number; since: number; seconds?: number; fromLook?: V3; fromScale?: number; }
let glide: Glide | null = null;
let homeLook: V3 | null = null, homeScale = 0;
function rememberHome() {
  const v = viewerNow(), nm = nmPerUnit(), look = v && nm && lookNow(v, nm);
  if (!v || !nm || !look || !(v.projectionScale.value > 0)) return;
  homeLook = look;
  homeScale = v.projectionScale.value;
}
/* ── a camera the game can trust. Every write to the viewer's position and
   zoom goes through setLook and setZoom, which refuse a non-finite value;
   the camera's axes are read only when the 3D panel has a size and finite
   matrices (camNow). A glide made from the panel's matrices right after the
   layout switched to 3D (its first frame: no size yet, an identity matrix)
   carried NaN into the position, where it stayed: a black view with the
   dataset box's corner in the middle (Ames 2026-11-12, desktop: "the cells
   load for a sec then go to dots"; the address then held "position":
   [null, null, null]). A glide asked for while the panel has no camera waits
   for the next frame that has one (pendingGlide). ── */
const finite3 = (p: ArrayLike<number> | null | undefined): boolean => !!p && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
function camNow(nm: V3): {right: V3; up: V3; toEye: V3} | null {
  const pp = threeDPanel()?.projectionParameters?.value;
  if (!pp || !(pp.width > 0) || !(pp.height > 0)) return null;
  const cam = cameraAxes(nm);
  return cam && finite3(cam.right) && finite3(cam.up) && finite3(cam.toEye) ? cam : null;
}
/** The camera's look point in nm, or null while it is not a finite place. */
function lookNow(v: any, nm: V3): V3 | null {
  const q = v?.navigationState?.position?.value as Float32Array | undefined;
  return q && finite3(q) ? [q[0] * nm[0], q[1] * nm[1], q[2] * nm[2]] : null;
}
function setLook(v: any, nm: V3, look: V3): boolean {
  if (!finite3(look)) { camRefused('look point', look); return false; }
  v.navigationState.position.value = Float32Array.from([look[0] / nm[0], look[1] / nm[1], look[2] / nm[2]]);
  return true;
}
function setZoom(v: any, scale: number): boolean {
  if (!(Number.isFinite(scale) && scale > 0)) { camRefused('zoom', scale); return false; }
  v.projectionScale.value = scale;
  return true;
}
let camWarned = false;
function camRefused(what: string, value: unknown) {
  if (camWarned) return;
  camWarned = true;
  console.warn(`[signal] refused a non-finite camera ${what}:`, value, new Error().stack);
}
/** True while the viewer's camera is a finite place to look from. */
function camSane(v: any): boolean {
  const q = v?.navigationState?.position?.value as Float32Array | undefined;
  const o = v?.perspectiveNavigationState?.pose?.orientation?.orientation as Float32Array | undefined;
  const sc = v?.projectionScale?.value;
  return !!q && (q.length < 3 || finite3(q)) && (!o || Array.from(o).every(Number.isFinite)) && Number.isFinite(sc) && sc > 0;   // no coordinates yet is not a bad place, only not ready
}
let pendingGlide: (() => void) | null = null;
/** The look point that puts a spot in the middle of the part of the view
 *  the HUD leaves free, at a frame of so many nm (settleFrame's own rule). */
function freeLook(spot: V3, frameNm: number, cam: {right: V3; up: V3; toEye: V3}): V3 {
  const r = threeDPanel()?.element?.getBoundingClientRect?.(), h = panel?.getBoundingClientRect();
  if (!r || !h || r.width <= 0) return spot;
  if (sideHud()) {
    const covered = clamp((h.right + 16 - r.left) / r.width, 0, 0.6), aspect = r.width / Math.max(1, r.height);
    return add(spot, mul(cam.right, covered * frameNm * aspect / 2));
  }
  return sub(spot, mul(cam.up, hudFrac() * frameNm / 2));
}
function glideTo(c: CellState, factor = 0.6) {
  const v = viewerNow(), nm = nmPerUnit(), cam = nm && camNow(nm);
  if (!v || !nm) return;
  if (!cam) { pendingGlide = () => glideTo(c, factor); return; }   // the panel has no camera yet: the next frame that has one
  pendingGlide = null;
  const scale = (homeScale || v.projectionScale.value) * factor;
  const look = freeLook(c.spec.soma, scale * Math.min(nm[0], nm[1], nm[2]), cam);
  if (!finite3(look) || !(scale > 0)) return;
  glide = {look, scale, since: performance.now()};
}
function glideHome() { if (homeLook && homeScale > 0 && finite3(homeLook)) glide = {look: homeLook, scale: homeScale, since: performance.now()}; }
/** Where the game last put the camera, and whether the player has moved it
 *  since: then a step's reset leaves the camera alone, and only a step that
 *  moves it on purpose takes it back (Ames 2026-11-12: "I zoomed out so I
 *  could see all the cells but Replay zooms me back in"). */
let camSet: {look: V3; scale: number} | null = null;
let userCam = false;
function recordCam() {
  const v = viewerNow(), nm = nmPerUnit(), look = v && nm && lookNow(v, nm);
  if (!v || !nm || !look || !(v.projectionScale.value > 0)) return;
  camSet = {look, scale: v.projectionScale.value};
  userCam = false;
}
function watchCam() {
  if (glide || !camSet) return;
  const v = viewerNow(), nm = nmPerUnit(), look = v && nm && lookNow(v, nm);
  if (!v || !nm || !look) return;
  if (len(sub(look, camSet.look)) > viewNm * 0.01 || Math.abs(v.projectionScale.value - camSet.scale) > camSet.scale * 0.02) userCam = true;
}
/** A slow, even glide to a look point and zoom over so many seconds. */
function glideSlow(look: V3, scale: number, seconds: number) {
  const v = viewerNow(), nm = nmPerUnit(), pos = v && nm && lookNow(v, nm);
  if (!v || !nm || !pos || !finite3(look) || !(scale > 0) || !(v.projectionScale.value > 0)) return;
  glide = {look, scale, since: performance.now(), seconds, fromLook: pos, fromScale: v.projectionScale.value};
}
/** The slow glide out to a cell's whole frame; if the panel has no camera
 *  yet, the next frame that has one makes it. */
function glideWhole(c: CellState, seconds: number) {
  const f = wholeCellFrame(c);
  if (f) { pendingGlide = null; glideSlow(f.look, f.scale, seconds); return; }
  if (nmPerUnit() && parts.get(c.spec.root)) pendingGlide = () => glideWhole(c, seconds);
}
/** The frame that shows a cell whole: its dendrites' reach across the view
 *  and the first stretch of its axon, the cell body a little above the
 *  middle so the axon has room below. */
function wholeCellFrame(c: CellState): {look: V3; scale: number} | null {
  const nm = nmPerUnit(), cam = nm && camNow(nm), pr = parts.get(c.spec.root);
  if (!nm || !cam || !pr) return null;
  let reach = 0;
  const span = (p: number[]) => { const d = sub([p[0], p[1], p[2]], c.spec.soma); reach = Math.max(reach, Math.hypot(dot(d, cam.right), dot(d, cam.up))); };
  for (const p of pr.arbor.dend) span(p);
  for (const p of pr.arbor.axon) if (p[3] < 250_000) span(p);
  const frameNm = Math.max(150_000, reach * 2.3);
  return {look: freeLook(sub(c.spec.soma, mul(cam.up, frameNm * 0.08)), frameNm, cam), scale: frameNm / Math.min(nm[0], nm[1], nm[2])};
}
function stepGlide(dt: number) {
  if (!glide) return;
  const v = viewerNow(), nm = nmPerUnit(), pos = v && nm && lookNow(v, nm);
  if (!v || !nm || !pos || !finite3(glide.look) || !(glide.scale > 0) || !(dt >= 0)) { glide = null; return; }
  if (glide.seconds && glide.fromLook && glide.fromScale) {
    // even pace, eased at both ends; the zoom in log space so it looks even too
    const q = clamp((performance.now() - glide.since) / (glide.seconds * 1000), 0, 1), e = q * q * (3 - 2 * q);
    setLook(v, nm, mix(glide.fromLook, glide.look, e));
    setZoom(v, Math.exp(Math.log(glide.fromScale) + (Math.log(glide.scale) - Math.log(glide.fromScale)) * e));
    if (q >= 1) { glide = null; recordCam(); }
    return;
  }
  const k = Math.min(1, dt * 4);
  const next = mix(pos, glide.look, k);
  setLook(v, nm, next);
  const sc = v.projectionScale.value;
  setZoom(v, sc + (glide.scale - sc) * k);
  if ((len(sub(next, glide.look)) < 800 && Math.abs(v.projectionScale.value - glide.scale) < glide.scale * 0.01) || performance.now() - glide.since > 1600) { glide = null; recordCam(); }
}
/** The ship's look, after scifi-ui's goldOnBlue hologram: a cool blue body, a molten gold rim. */
const shipProp: NgeProp = {mesh: null as any, modelMat: mat4.create(), alpha: 1, dissolve: 0, seed: 0.5, glow: [0.03, 0.09, 0.26], rim: [0.85, 0.7, 0.42], shade: 0.8};   // shade 1.1 and a brighter rim were "too overwashed" (Ames 2026-11-12)
const GROUP = 'signal';
/** A faceted sphere: an icosahedron subdivided once, flat-shaded (80 faces). */
function icosphere(): {positions: Float32Array; normals: Float32Array} {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: V3[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V3[]).map(q => norm(q));
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const tris: V3[][] = [];
  for (const [a, b, c] of f) {
    const A = v[a], B = v[b], C = v[c], ab = norm(mix(A, B, 0.5)), bc = norm(mix(B, C, 0.5)), ca = norm(mix(C, A, 0.5));
    tris.push([A, ab, ca], [B, bc, ab], [C, ca, bc], [ab, bc, ca]);
  }
  const positions = new Float32Array(tris.length * 9), normals = new Float32Array(tris.length * 9);
  tris.forEach((tr, i) => {
    const nrm = norm(add(add(tr[0], tr[1]), tr[2]));   // flat: the face's own direction
    tr.forEach((q, j) => { for (let k = 0; k < 3; k++) { positions[i * 9 + j * 3 + k] = q[k]; normals[i * 9 + j * 3 + k] = nrm[k]; } });
  });
  return {positions, normals};
}
let somaProps: NgeProp[] = [];
const somaPropOf = new Map<string, NgeProp>();
/** The low-poly bodies: one faceted sphere a cell, in its colour, 1.1 cell-body radii across. */
function buildSomaProps(): NgeProp[] {
  const nm = nmPerUnit();
  somaProps = []; somaPropOf.clear();
  if (!nm) return somaProps;
  const ico = icosphere();
  let i = 0;
  for (const c of cells.values()) {
    if (!c.shown) continue;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2;
    const ctx = cv.getContext('2d');
    if (ctx) { ctx.fillStyle = `rgb(${c.color.join(',')})`; ctx.fillRect(0, 0, 2, 2); }
    const count = ico.positions.length / 3;
    const mesh: NgePropMesh = {key: {}, positions: ico.positions, normals: ico.normals, uvs: new Float32Array(count * 2), indices: Uint32Array.from({length: count}, (_, k) => k), image: cv};
    const m = mat4.create(), R = SOMA_R_NM * 1.1;
    m[0] = R / nm[0]; m[5] = R / nm[1]; m[10] = R / nm[2];
    m[12] = c.spec.soma[0] / nm[0]; m[13] = c.spec.soma[1] / nm[1]; m[14] = c.spec.soma[2] / nm[2];
    const col: V3 = [c.color[0] / 255, c.color[1] / 255, c.color[2] / 255];
    const prop: NgeProp = {mesh, modelMat: m, alpha: 1, dissolve: 0, seed: (i++ * 0.37) % 1, glow: [col[0] * 0.3, col[1] * 0.3, col[2] * 0.3], rim: [col[0] * 0.5 + 0.5, col[1] * 0.5 + 0.5, col[2] * 0.5 + 0.5], shade: 0.95};
    somaProps.push(prop); somaPropOf.set(c.key, prop);
  }
  return somaProps;
}
/** Each body's look follows its cell: dim when the cell is dimmed, bright when it is lit whole or scanned. */
function shadeSomaProps() {
  for (const c of cells.values()) {
    const prop = somaPropOf.get(c.key);
    if (!prop) continue;
    const col: V3 = [c.color[0] / 255, c.color[1] / 255, c.color[2] / 255];
    const lit = c.target || litWhole.has(c.spec.root) || scanLit === c.key;
    const k = c.dimmed ? 0.28 : lit ? 1.15 : 0.9;
    prop.shade = k;
    prop.glow = [col[0] * 0.3 * k, col[1] * 0.3 * k, col[2] * 0.3 * k];
    prop.rim = c.dimmed ? [col[0] * 0.35, col[1] * 0.35, col[2] * 0.35] : [col[0] * 0.5 + 0.5, col[1] * 0.5 + 0.5, col[2] * 0.5 + 0.5];
  }
}
function syncProps() { setNgeProps([...(phone() ? [] : [shipProp]), ...somaProps], GROUP); }   // no ship on a phone (Ames 2026-11-12: "remove the ship on mobile")
const MAX_GLOW = 24_000;   // room for every synapse of a cell, and an arbor's wave
const glow: NgeGlow = {positions: new Float32Array(MAX_GLOW * 3), colors: new Float32Array(MAX_GLOW * 4), sizesNm: new Float32Array(MAX_GLOW), count: 0, nmRight: [1, 0, 0]};
/** Beacons on the cell bodies, drawn through everything so a body is seen
 *  behind the branches in front of it (Ames 2026-11-11: "it's hard to see
 *  the somas"). */
const MAX_OVER = 128;
const glowOver: NgeGlow = {positions: new Float32Array(MAX_OVER * 3), colors: new Float32Array(MAX_OVER * 4), sizesNm: new Float32Array(MAX_OVER), count: 0, nmRight: [1, 0, 0], through: true};

const thetaOf = (key: string) => level?.theta?.[key] ?? THRESHOLD[key] ?? DEFAULT_THRESHOLD;
const potential = (c: CellState) => c.e - c.i;
/** How hard the Gatekeeper holds a cell now, 0..1: fully while a pulse is
 *  on the wire to it, then as the inhibition it left leaks away. Everything
 *  that shows the hold reads this, so the cell body, its tag, its chip and
 *  the map agree (Ames 2026-11-11: "it is not clear when the gatekeeper is
 *  inhibiting the target"). */
function holdOn(c: CellState): number {
  if (arrivals.some(a => a.inhibitory && a.post === c.key)) return 1;
  return clamp(c.i / 1.5, 0, 1);
}
/** A connection whose arrival can change something: onto a target, the
 *  Gatekeeper or another interneuron. Drivers fire only when they are
 *  sparked, so what lands on them is left out, wire and spark alike (Ames
 *  2026-11-08: "it's flashing through too much"; each pulse used to run
 *  five violet trails, one to every driver, and only the one to the gold
 *  cell meant anything). */
function live(k: CircuitConn): boolean {
  const pre = cells.get(k.pre), post = cells.get(k.post);
  if (!pre?.shown || !post?.shown) return false;
  return post.target || post.gateNext !== null || post.spec.type === 'I';
}

function cellColor(c: CircuitCell, k: number): string {
  if (c.type === 'I') return I_COLOR[c.key] ?? '#b68cff';
  if (c.key === 'S') return S_COLOR;
  return E_COLORS[k % E_COLORS.length];
}

/** Paint a cell in the viewer: its colour, or that colour dimmed while it is
 *  hushed or asleep. */
function paint(c: CellState, dim: boolean, grey = false) {
  const ml = circuitLayer();
  if (!ml) return;
  const lum = 0.299 * c.color[0] + 0.587 * c.color[1] + 0.114 * c.color[2];
  const base: V3 = grey ? [lum, lum, lum] : c.color;   // grey: out of the spotlight, its colour gone
  const rgb: V3 = dim ? mul(base, grey ? 0.45 : 0.32) as V3 : base;
  try { setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, Uint64.parseString(c.spec.root), packRgb([Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])])); } catch { /* colour stays */ }
  c.dimmed = dim;
}

/* ── the score: Ames's "Bioluminescent Sparks" (2026-11-11), a 90 s loop
   that starts at Begin (a click, so the browser allows it) and plays on
   through the levels; the ♪ button mutes it with the sounds. ── */
let music: HTMLAudioElement | null = null;
function ensureMusic(): HTMLAudioElement | null {
  if (!music) {
    try {
      music = new Audio('signal/score.mp3');
      music.loop = true;
      music.volume = 0.45;
      music.preload = 'auto';
    } catch { music = null; }
  }
  return music;
}
let musicWanted = false;
function startMusic() {
  const m = ensureMusic();
  if (!m || muted) return;
  m.muted = false;
  musicWanted = true;
  m.play().then(() => { musicWanted = false; }).catch(() => { /* not allowed yet: the next click tries again (nudgeMusic) */ });
}
/** A click anywhere: the score the browser refused before a gesture starts now. */
function nudgeMusic() { if (musicWanted && !muted && music?.paused) startMusic(); }
function stopMusic() {
  if (!music) return;
  music.pause();
  music.currentTime = 0;
}

/* ── sound, made on the spot ── */
let audio: AudioContext | null = null;
function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!audio) audio = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    if (audio!.state === 'suspended') void audio!.resume();
    return audio;
  } catch { return null; }
}
function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, slideTo?: number, delay = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  const t0 = a.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
const sfx = {
  scan: () => { tone(1320, 0.22, 'sine', 0.045, 2640); tone(660, 0.3, 'triangle', 0.025, 990, 0.08); },
  spark: () => tone(880, 0.14, 'sine', 0.07, 1760),
  hush: () => tone(300, 0.35, 'triangle', 0.07, 90),
  fizzle: () => tone(160, 0.12, 'square', 0.02, 120),
  spike: (inhibitory: boolean) => tone(inhibitory ? 330 : 520, 0.07, 'triangle', 0.05, inhibitory ? 220 : 700),
  target: () => { tone(660, 0.12, 'sine', 0.08); tone(990, 0.16, 'sine', 0.08, undefined, 0.09); },
  goal: () => { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.18, 'sine', 0.07, undefined, k * 0.08)); },
  fail: () => { tone(330, 0.3, 'sawtooth', 0.04, 165); },
  shield: () => tone(200, 0.1, 'square', 0.03, 180),
};

/* ── the HUD ── */
let panel: HTMLElement | null = null;
/** The data and model note, at the foot of the screen (bottom right, clear
 *  of Pyr's chat) rather than in the panel (Ames 2026-11-12). */
let footEl: HTMLElement | null = null;
let els: Record<string, HTMLElement> = {};
let lastHudH = -1;
/** Puts the level's science line in the foot (set when the HUD is built). */
let showScience: () => void = () => { /* no HUD yet */ };
let chipEls = new Map<string, HTMLElement>();
let message = '';
let messageUntil = 0;
/** The layer's mesh resolution before the game coarsened it. */
let savedRenderScale: number | null = null;
let savedDefaultAnnotations: boolean | null = null;

function ensureStyle() {
  if (document.getElementById('nge-signal-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-signal-style';
  st.textContent = `
/* The HUD: a hologram plate, as the intro panel (src/util/intro_tour.ts), in
   scifi-ui's cockpit HUD arrangement: objective bracket, the neurons
   involved as chips, the controls, one warm accent for the target. */
.nge-sig { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 9500; isolation: isolate;
  width: min(760px, calc(100vw - 20px)); box-sizing: border-box; padding: 12px 16px 12px;
  color: #e6f3ff; font: 13.5px/1.4 'Inter', 'Roboto', sans-serif; animation: nge-sig-in 700ms cubic-bezier(.16,1,.3,1) both; }
@keyframes nge-sig-in { 0% { opacity: 0; transform: translate(-50%, 16px) scaleY(0.05); filter: blur(6px) brightness(2); } 100% { opacity: 1; transform: translate(-50%, 0); filter: none; } }
.nge-sig--out { animation: nge-sig-out 350ms ease-in both; }
@keyframes nge-sig-out { to { opacity: 0; transform: translate(-50%, 10px) scaleY(0.05); filter: blur(6px); } }
.nge-sig-bg { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px);
  background: linear-gradient(160deg, rgba(14, 34, 66, 0.93), rgba(6, 12, 28, 0.95) 60%, rgba(22, 14, 48, 0.94));
  box-shadow: inset 0 0 40px rgba(80, 180, 255, 0.10); }
.nge-sig-bg::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(135deg, rgba(126, 224, 255, 0.5), rgba(126, 224, 255, 0.16) 45%, rgba(126, 224, 255, 0) 78%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-sig-bg::after { content: ''; position: absolute; inset: 0; opacity: 0.4;
  background: radial-gradient(circle, rgba(255, 210, 122, 0.12) 0.9px, transparent 1.8px) 0 0 / 13px 13px; }
.nge-sig-corner { position: absolute; width: 12px; height: 12px; border: 2px solid #7ee0ff; pointer-events: none; filter: drop-shadow(0 0 4px #7ee0ff); }
.nge-sig-corner.tr { top: -5px; right: -5px; border-left: 0; border-bottom: 0; }
.nge-sig-corner.bl { bottom: -5px; left: -5px; border-right: 0; border-top: 0; }
/* the circuit traces: a bright run along the top and down the left from the
   cut corner, each ending in a node; the border itself fades to nothing
   toward the cut corner at the bottom right (Ames 2026-11-12: "the orange
   border draws attention to the bottom right; fade to 0 there and add
   circuit dots at the ends of the cyan border top left") */
.nge-sig-trace { position: absolute; pointer-events: none; background: linear-gradient(90deg, rgba(126, 224, 255, 0.95), rgba(126, 224, 255, 0.5)); box-shadow: 0 0 5px rgba(126, 224, 255, 0.45); }
.nge-sig-trace.t { top: 0; left: 16px; right: 16px; height: 1px; }
.nge-sig-trace.l { left: 0; top: 16px; bottom: 16px; width: 1px; background: linear-gradient(180deg, rgba(126, 224, 255, 0.95), rgba(126, 224, 255, 0.5)); }
.nge-sig-trace::before, .nge-sig-trace::after { content: ''; position: absolute; width: 5px; height: 5px; border-radius: 50%; background: #7ee0ff; box-shadow: 0 0 6px #7ee0ff, 0 0 2px #fff; }
.nge-sig-trace.t::before { left: -2px; top: -2px; } .nge-sig-trace.t::after { right: -2px; top: -2px; }
.nge-sig-trace.l::before { top: -2px; left: -2px; } .nge-sig-trace.l::after { bottom: -2px; left: -2px; }
/* the head is the Pyr gem, the view switch and two small buttons; the level's
   name sits at the foot (Ames 2026-11-11: "remove (put Level 1 at the
   bottom)", "put the Pyr icon in the ui box") */
.nge-sig-head { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.nge-sig-gem { flex: none; width: 22px; height: 22px; background: var(--nge-pyr-gem) center / contain no-repeat; filter: drop-shadow(0 0 6px rgba(74, 158, 255, 0.4)); }
.nge-sig-view-key { margin-left: auto; font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #7ecaff; }
.nge-sig-view { display: inline-flex; border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 6px; overflow: hidden; }
.nge-sig .nge-sig-view button { padding: 4px 9px; border: 0; border-radius: 0; background: rgba(126, 224, 255, 0.06); color: #9fc6ea; cursor: pointer; font: 700 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-sig .nge-sig-view button[aria-pressed="true"] { background: rgba(126, 224, 255, 0.22); color: #e6f7ff; text-shadow: 0 0 8px rgba(126, 224, 255, 0.6); }
.nge-sig .nge-sig-view button:hover { color: #fff; background: rgba(126, 224, 255, 0.14); }
.nge-sig .nge-sig-share { padding: 4px 9px; border: 1px solid rgba(255, 210, 122, 0.5); border-radius: 6px; background: rgba(255, 210, 122, 0.08); color: #ffd98a; cursor: pointer; font: 700 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-sig .nge-sig-share:hover { background: rgba(255, 210, 122, 0.18); color: #fff; }
.nge-sig-dot { width: 7px; height: 7px; border-radius: 50%; background: #7ecaff; box-shadow: 0 0 8px #7ecaff; animation: nge-sig-blink 1.1s infinite; }
@keyframes nge-sig-blink { 50% { opacity: 0.25; } }
.nge-sig-note .lvl { display: block; margin-bottom: 3px; font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: #7ecaff; }
.nge-sig-x { flex: none; width: 24px; height: 24px; margin: -2px -6px -2px 6px; display: grid; place-items: center; padding: 0;
  border: 1px solid rgba(126, 210, 255, 0.35); border-radius: 50%; background: rgba(126, 210, 255, 0.06); color: #9fc6ea; cursor: pointer; }
.nge-sig-x:hover { color: #fff; border-color: rgba(126, 210, 255, 0.8); }
.nge-sig-mute { flex: none; background: none; border: 0; color: #7ecaff; cursor: pointer; font-size: 13px; padding: 0 4px; }
/* the objective bracket */
.nge-sig-top { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; margin-top: 8px; }
.nge-sig-obj { position: relative; padding: 4px 0 4px 12px; }
.nge-sig-obj::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: linear-gradient(180deg, #ffc24a, rgba(255, 194, 74, 0.1)); box-shadow: 0 0 8px rgba(255, 194, 74, 0.6); }
.nge-sig-obj span { display: block; font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; color: #7ecaff; text-transform: uppercase; }
.nge-sig-obj strong { display: block; font: 700 17px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; color: #fff; text-shadow: 0 0 12px rgba(126, 210, 255, 0.5); }
.nge-sig-obj em { display: block; font-style: normal; color: #ffd98a; font-size: 12.5px; }
.nge-sig-stats { display: grid; grid-template-columns: auto auto auto; gap: 2px 14px; text-align: right; font: 600 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; color: #7ecaff; text-transform: uppercase; }
.nge-sig-stats b { display: block; font: 700 18px 'Orbitron', 'Inter', sans-serif; color: #fff; letter-spacing: 0.02em; }
.nge-sig-stats b.warn { color: #ff9a8a; }
.nge-sig-stats .u, .nge-sig .barlabel .u { text-transform: none; font-size: 0.78em; opacity: 0.75; margin-left: 1px; }
/* the coach: one instruction at a time */
.nge-sig-coach { display: flex; align-items: flex-start; gap: 10px; margin: 10px 0 2px; padding: 8px 12px; border-left: 2px solid #ffc24a;
  background: linear-gradient(90deg, rgba(255, 194, 74, 0.10), rgba(255, 194, 74, 0)); color: #fff; font-size: 14px; line-height: 1.4; }
.nge-sig-coach i { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: #ffc24a; box-shadow: 0 0 8px #ffc24a; }
.nge-sig-coach--new { animation: nge-sig-coach-in 500ms ease-out; }
@keyframes nge-sig-coach-in { 0% { background: rgba(255, 194, 74, 0.35); } 100% { } }
/* go: the line turns to the beam's own light; held: the Gatekeeper's violet
   (the light changes colour, it does not flash: Ames 2026-11-08) */
.nge-sig-coach--go { border-left-color: #7ee0ff; background: linear-gradient(90deg, rgba(126, 224, 255, 0.18), rgba(126, 224, 255, 0)); font-weight: 600; }
.nge-sig-coach--go i { background: #7ee0ff; box-shadow: 0 0 10px #7ee0ff; animation: nge-sig-blink 1.6s infinite; }
.nge-sig-coach--held { border-left-color: #b68cff; background: linear-gradient(90deg, rgba(182, 140, 255, 0.16), rgba(182, 140, 255, 0)); }
.nge-sig-coach--held i { background: #b68cff; box-shadow: 0 0 8px #b68cff; }
/* the cell to click now */
.nge-sig .nge-sig-chip--hint { border-color: #c9f6ff; box-shadow: 0 0 16px rgba(126, 224, 255, 0.55), inset 0 0 12px rgba(126, 224, 255, 0.15); animation: nge-sig-hint 1s ease-in-out infinite; }
@keyframes nge-sig-hint { 50% { box-shadow: 0 0 6px rgba(126, 224, 255, 0.25), inset 0 0 4px rgba(126, 224, 255, 0.08); } }
.ng-extend.nge-sig-tag--hint { border-color: #c9f6ff; color: #fff; background: rgba(20, 60, 110, 0.9); box-shadow: 0 0 16px rgba(126, 224, 255, 0.7); animation: nge-sig-hint 1s ease-in-out infinite; }
/* the neurons involved */
.nge-sig-kicker { margin: 10px 0 4px; font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; color: #7ecaff; text-transform: uppercase; display: flex; gap: 8px; align-items: center; }
.nge-sig-kicker i { width: 14px; height: 1px; background: #7ecaff; box-shadow: 0 0 6px #7ecaff; }
.nge-sig-cells { display: flex; flex-wrap: wrap; gap: 6px; }
/* Selectors carry .nge-sig so the app's own button styles do not win. */
.nge-sig .nge-sig-chip { --c: #5fb8ff; position: relative; display: inline-flex; align-items: stretch; gap: 8px; min-width: 150px;
  margin: 0; padding: 5px 10px 5px 7px; border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--c) 10%, rgba(8, 14, 30, 0.6));
  color: #e6f3ff; cursor: pointer; text-align: left; font: 13px/1.3 'Inter', 'Roboto', sans-serif; line-height: 1.3; transition: transform 0.12s, box-shadow 0.2s; }
.nge-sig .nge-sig-chip:hover { transform: translateY(-1px); box-shadow: 0 0 14px color-mix(in srgb, var(--c) 45%, transparent); }
.nge-sig .nge-sig-chip:focus-visible { outline: 2px solid #7ecaff; outline-offset: 2px; }
.nge-sig .nge-sig-chip .text { display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.nge-sig .nge-sig-chip .key { display: block; font: 700 12.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.08em; color: var(--c); white-space: nowrap; }
.nge-sig .nge-sig-chip .key small { font: 600 9.5px 'Inter', sans-serif; letter-spacing: 0.03em; color: #c9dcf0; margin-left: 7px; }
.nge-sig .nge-sig-chip .syn { display: block; font-size: 10.5px; color: #a9c3de; white-space: nowrap; }
/* a labelled bar, only where a cell's state matters */
.nge-sig .nge-sig-chip .barrow { display: flex; align-items: center; gap: 7px; margin-top: 4px; }
.nge-sig .nge-sig-chip .barlabel { flex: none; min-width: 64px; font: 600 8.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #9fc6ea; }
.nge-sig .nge-sig-chip .bar { position: relative; width: 120px; height: 7px; border-radius: 4px; background: rgba(126, 224, 255, 0.12); overflow: hidden; }
.nge-sig .nge-sig-chip .bar b { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--c); border-radius: 4px; transition: width 0.08s linear; }
.nge-sig .nge-sig-chip .bar b.neg { background: #b68cff; }
.nge-sig .nge-sig-chip--target { --c: #ffc24a; box-shadow: 0 0 16px rgba(255, 194, 74, 0.28); cursor: not-allowed; }
.nge-sig .nge-sig-chip--target .key::after { content: 'TARGET'; margin-left: 8px; font: 700 8px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; color: #ffc24a; vertical-align: 1px; }
.nge-sig .nge-sig-chip--hushed { opacity: 0.55; }
.nge-sig .nge-sig-chip--asleep { opacity: 0.45; }
.nge-sig .nge-sig-chip--asleep .key::after { content: 'ASLEEP'; margin-left: 8px; font: 700 8px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; color: #b68cff; }
.nge-sig .nge-sig-chip--spike { animation: nge-sig-spike 0.45s ease-out; }
@keyframes nge-sig-spike { 0% { background: #fff; box-shadow: 0 0 22px #fff; } 100% { } }
.nge-sig .nge-sig-chip--shake { animation: nge-sig-shake 0.3s; }
@keyframes nge-sig-shake { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
/* controls */
.nge-sig-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.nge-sig-beams { display: inline-flex; border: 1px solid rgba(126, 224, 255, 0.4); border-radius: 6px; overflow: hidden; }
.nge-sig-beam { padding: 6px 12px; border: 0; background: rgba(126, 224, 255, 0.06); color: #9fc6ea; cursor: pointer;
  font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-sig-beam[aria-pressed="true"] { background: rgba(255, 194, 74, 0.22); color: #ffd98a; text-shadow: 0 0 8px rgba(255, 194, 74, 0.6); }
.nge-sig-beam.hush[aria-pressed="true"] { background: rgba(182, 140, 255, 0.25); color: #d9c4ff; text-shadow: 0 0 8px rgba(182, 140, 255, 0.7); }
.nge-sig-beam:disabled { opacity: 0.35; cursor: not-allowed; }
.nge-sig-beam { white-space: nowrap; }
.nge-sig-beam + .nge-sig-beam { border-left: 1px solid rgba(126, 224, 255, 0.35); }
/* what a beam costs, in the charge meter's own pips */
.nge-sig-beam .cost { display: inline-flex; gap: 2px; margin-left: 7px; vertical-align: 1px; }
.nge-sig-beam .cost b { width: 7px; height: 6px; transform: skewX(-18deg); background: currentColor; opacity: 0.65; }
/* the key that switches the beam (Ames 2026-11-08: "I need a shortcut between spark and hush") */
.nge-sig-key { display: inline-block; margin-left: -4px; padding: 1px 6px 0; border: 1px solid rgba(126, 224, 255, 0.45); border-bottom-width: 2px; border-radius: 4px;
  font: 600 9.5px 'Inter', sans-serif; letter-spacing: 0.06em; color: #9fc6ea; background: rgba(126, 224, 255, 0.06); }
.nge-sig-beam .hk { margin-left: 6px; padding: 0 4px; border: 1px solid currentColor; border-radius: 3px; font: 600 8.5px 'Inter', sans-serif; letter-spacing: 0; text-transform: none; opacity: 0.7; vertical-align: 1px; }
@media (hover: none) and (pointer: coarse) { .nge-sig-key, .nge-sig-beam .hk { display: none; } }
.nge-sig-charges { display: inline-flex; gap: 4px; align-items: center; }
.nge-sig-charges i { width: 14px; height: 8px; border: 1px solid rgba(126, 224, 255, 0.5); transform: skewX(-18deg); background: rgba(126, 224, 255, 0.08); }
.nge-sig-charges i.on { background: #7ee0ff; box-shadow: 0 0 6px #7ee0ff; }
.nge-sig-charges i.half { background: linear-gradient(90deg, #7ee0ff 50%, rgba(126, 224, 255, 0.08) 50%); }
.nge-sig-charges span { font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; color: #7ecaff; margin-right: 4px; }
.nge-sig-msg { margin-left: auto; min-height: 1.2em; font-size: 12.5px; color: #ffd98a; text-align: right; }
.nge-sig-note { margin-top: 6px; font-size: 11.5px; color: #8ea6c2; letter-spacing: 0.02em; }
/* the brief and the result, in place of the chips */
.nge-sig-card { margin-top: 10px; }
.nge-sig-card p { margin: 6px 0 10px; color: #d6e8fb; }
.nge-sig-stars { font-size: 22px; letter-spacing: 6px; color: #ffc24a; text-shadow: 0 0 12px rgba(255, 194, 74, 0.7); }
.nge-sig-go { position: relative; border: 0; padding: 0; background: none; cursor: pointer; color: inherit; filter: drop-shadow(0 0 10px rgba(74, 150, 224, 0.45)); transition: filter 0.25s, transform 0.2s; }
/* .nge-sig on the hover selectors: the app's own button:hover paints a square
   behind the plate otherwise (Ames 2026-11-11: "hover state on begin doesn't
   match button shape") */
.nge-sig .nge-sig-go:hover, .nge-sig .nge-sig-go:focus-visible { background: none; filter: drop-shadow(0 0 18px rgba(126, 224, 255, 0.75)); transform: translateY(-1px); }
.nge-sig-plate { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 10px; padding: 10px 20px 10px 22px;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  background: linear-gradient(135deg, rgba(74, 150, 224, 0.55) 0%, rgba(74, 150, 224, 0.62) 45%, rgba(138, 96, 230, 0.55) 100%);
  color: #eaf7ff; font: 700 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap; text-shadow: 0 0 8px rgba(126, 224, 255, 0.8); }
.nge-sig-plate::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(135deg, #bff3ff, rgba(126, 224, 255, 0.35) 40%, rgba(180, 150, 255, 0.8));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
/* the quiet button is a hollow plate, the lit one's shape (Ames 2026-11-11:
   "play it again not starred": it read as plain text beside Next level) */
.nge-sig .nge-sig-quiet { position: relative; background: none; border: 0; border-radius: 0; padding: 10px 20px 10px 22px; color: #bfe0ff; cursor: pointer; white-space: nowrap;
  font: 700 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; transition: background 0.2s, color 0.2s;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
.nge-sig .nge-sig-quiet::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit; pointer-events: none;
  background: linear-gradient(135deg, rgba(126, 224, 255, 0.85), rgba(126, 224, 255, 0.3) 40%, rgba(180, 150, 255, 0.7));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-sig .nge-sig-quiet:hover, .nge-sig .nge-sig-quiet:focus-visible { background: rgba(126, 224, 255, 0.14); color: #fff; }
.nge-sig .nge-sig-recenter { padding: 6px 12px 6px 14px; font-size: 10px; clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
body.nge-signal-on .nge-3d-panel, body.nge-signal-on .nge-3d-panel * { cursor: crosshair !important; }
/* tags on the cell bodies, in the 3D view */
.ng-extend.nge-sig-tag { --c: #5fb8ff; position: fixed; z-index: 9400; transform: translate(-50%, calc(-100% - 16px)); margin: 0; padding: 3px 8px 3px 7px;
  border: 1px solid color-mix(in srgb, var(--c) 70%, transparent); border-radius: 4px; background: rgba(6, 12, 28, 0.74); color: var(--c); cursor: pointer;
  font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.08em; line-height: 1.3; white-space: nowrap; text-shadow: 0 0 6px color-mix(in srgb, var(--c) 60%, transparent); }
.ng-extend.nge-sig-tag::after { content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: 14px; background: var(--c); opacity: 0.85; }
.ng-extend.nge-sig-tag small { font: 600 9px 'Inter', sans-serif; letter-spacing: 0.02em; color: #c9dcf0; margin-left: 6px; }
.ng-extend.nge-sig-tag:hover { background: rgba(10, 24, 50, 0.9); box-shadow: 0 0 12px color-mix(in srgb, var(--c) 50%, transparent); }
.ng-extend.nge-sig-tag--target { --c: #ffc24a; box-shadow: 0 0 12px rgba(255, 194, 74, 0.45); cursor: not-allowed; }
.ng-extend.nge-sig-tag--hushed { opacity: 0.5; }
/* the Gatekeeper's hold on a cell: its tag turns violet and says so */
.ng-extend.nge-sig-tag--held { background: rgba(28, 14, 56, 0.9); box-shadow: 0 0 14px rgba(182, 140, 255, 0.6); }
.ng-extend.nge-sig-tag--held small { color: #e6d6ff; display: inline; }
@media (max-width: 700px) { .ng-extend.nge-sig-tag small { display: none; } }
/* A touch screen: the tag's hit area is a thumb's width, down to the cell body. */
@media (pointer: coarse) { .ng-extend.nge-sig-tag::before { content: ''; position: absolute; inset: -10px -10px -24px; } }
/* Phones (Pyr's mobile mode, body.nge-mobile): the HUD is a short sheet above
   the bottom nav, the chips one row of tappable keys with their bars, the
   cells get the top of the screen (Ames 2026-11-08: "refactor for a phone"). */
body.nge-mobile .nge-sig { bottom: calc(66px + env(safe-area-inset-bottom)); width: calc(100vw - 12px); max-height: 58vh; padding: 8px 10px; font-size: 12px; display: flex; flex-direction: column; }
body.nge-mobile .nge-sig-scroll { min-height: 0; overflow: hidden auto; scrollbar-width: none; }
body.nge-mobile .nge-sig-head { font-size: 9px; letter-spacing: 0.14em; }
/* no progress, time or score during the cinematics, nor the objective's small print (Ames 2026-11-12: "I want this text GONE while we are in the pre-level tours") */
.nge-sig.nge-sig--intro .nge-sig-stats, .nge-sig.nge-sig--intro .nge-sig-obj em { display: none !important; }
/* the fold: the head row alone */
.nge-sig .nge-sig-fold { flex: none; display: inline-flex; align-items: center; padding: 3px 6px; border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 6px; background: rgba(126, 224, 255, 0.06); color: #9fc6ea; cursor: pointer; line-height: 1; }
.nge-sig .nge-sig-fold:hover { color: #fff; background: rgba(126, 224, 255, 0.14); }
.nge-sig .nge-sig-fold svg { transition: transform 0.2s; }
.nge-sig.nge-sig--folded .nge-sig-fold svg { transform: rotate(180deg); }
.nge-sig.nge-sig--folded .nge-sig-scroll > :not(.nge-sig-head) { display: none !important; }
.nge-sig.nge-sig--folded { max-height: none; }
/* a very wide screen (a 4K monitor at its full size): the panel at a readable size */
@media (min-width: 2600px) { .ng-extend.nge-sig { zoom: 1.35; } }
.ng-extend.nge-sig-foot { position: fixed; right: 48px; bottom: 10px; z-index: 9400; margin: 0; text-align: right; font: 10.5px/1.45 'Inter', 'Roboto', sans-serif; color: rgba(142, 166, 194, 0.78); letter-spacing: 0.02em; pointer-events: none; text-shadow: 0 1px 3px #000; }
body.nge-mobile .ng-extend.nge-sig-foot { display: none; }
/* the intro on a phone is just the tour card under the gem, the sound and the close; the objective and the rest come with play (Ames 2026-11-12: "show the cell first with just the text, then the diagram, then add back the box; put the gem during the intro") */
body.nge-mobile .nge-sig.nge-sig--intro .nge-sig-top, body.nge-mobile .nge-sig.nge-sig--intro .nge-sig-data, body.nge-mobile .nge-sig.nge-sig--intro .nge-sig-view, body.nge-mobile .nge-sig.nge-sig--intro .nge-sig-view-key { display: none !important; }
body.nge-mobile .nge-sig.nge-sig--intro .nge-sig-gem { margin-right: auto; }
/* slim and concise on a phone: no Share, no pencil, no data lines in the foot, tighter everywhere */
body.nge-mobile .nge-sig .nge-sig-share, body.nge-mobile .nge-sig .nge-sig-edit, body.nge-mobile .nge-sig .nge-sig-note .txt { display: none !important; }
body.nge-mobile .nge-sig { padding: 6px 10px 6px; font-size: 11.5px; }
body.nge-mobile .nge-sig-obj strong { font-size: 12.5px; }
body.nge-mobile .nge-sig-obj > span { font-size: 8px; }
body.nge-mobile .nge-sig-tour-text { font-size: 12px; line-height: 1.35; margin: 4px 0; }
body.nge-mobile .nge-sig-tour-sub { font-size: 10.5px; margin: 2px 0; }
body.nge-mobile .nge-sig-tour-kicker { font-size: 8.5px; margin-top: 4px; }
body.nge-mobile .nge-sig-go { padding: 7px 14px; font-size: 10px; }
body.nge-mobile .nge-sig-ico { width: 30px; height: 30px; }
body.nge-mobile .nge-sig-row { margin-top: 6px; gap: 6px; }
body.nge-mobile .nge-sig-sci { margin: 4px 0 0; }
body.nge-mobile .nge-sig-note { margin-top: 4px; }
body.nge-mobile .nge-sig-neuron { max-width: 260px; margin: 4px 0 0; }
body.nge-mobile .ng-extend.nge-sig-canopy { font-size: 11px; }
/* the viewer keeps its gestures (a pinch zooms) under the game's overlays */
body.nge-signal-on #neuroglancer-container, body.nge-signal-on .nge-3d-panel { touch-action: none !important; }
body.nge-mobile .nge-sig-x { width: 30px; height: 30px; margin: -4px -6px -4px 4px; }
body.nge-mobile .nge-sig-top { gap: 8px; margin-top: 6px; }
body.nge-mobile .nge-sig-obj { padding: 2px 0 2px 10px; }
body.nge-mobile .nge-sig-obj strong { font-size: 13.5px; }
body.nge-mobile .nge-sig-obj em { font-size: 11.5px; }
body.nge-mobile .nge-sig-stats { gap: 2px 10px; font-size: 8.5px; }
body.nge-mobile .nge-sig-stats b { font-size: 14px; }
body.nge-mobile .nge-sig-coach { margin: 8px 0 0; padding: 7px 10px; font-size: 13px; }
body.nge-mobile .nge-sig-kicker { display: none; }
body.nge-mobile .nge-sig-cells { flex-wrap: nowrap; overflow-x: auto; gap: 6px; margin-top: 8px; padding-bottom: 2px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
body.nge-mobile .nge-sig-cells::-webkit-scrollbar { display: none; }
body.nge-mobile .nge-sig .nge-sig-chip { flex: none; min-width: 44px; min-height: 42px; padding: 5px 9px; touch-action: manipulation; }
body.nge-mobile .nge-sig .nge-sig-chip .key small, body.nge-mobile .nge-sig .nge-sig-chip .syn { display: none; }
body.nge-mobile .nge-sig .nge-sig-chip .barrow { flex-direction: column; align-items: flex-start; gap: 2px; margin-top: 3px; }
body.nge-mobile .nge-sig .nge-sig-chip .barlabel { min-width: 0; font-size: 7.5px; letter-spacing: 0.1em; }
body.nge-mobile .nge-sig .nge-sig-chip .bar { width: 64px; height: 6px; }
/* the cell to tap wears a "Tap" callout; the target says what it is */
.ng-extend.nge-sig-tag .tap { display: none; }
body.nge-mobile .ng-extend.nge-sig-tag--target small { display: inline; }
body.nge-mobile .ng-extend.nge-sig-tag--hint { font-size: 13px; padding: 6px 12px; transform: translate(-50%, calc(-100% - 22px)); }
body.nge-mobile .ng-extend.nge-sig-tag--hint::after { height: 20px; }
body.nge-mobile .ng-extend.nge-sig-tag--hint .tap { display: inline; margin-right: 6px; font: 700 10px 'Inter', sans-serif; letter-spacing: 0.14em; color: #fff; text-transform: uppercase; }
body.nge-mobile .nge-sig .nge-sig-chip--target .key::after { margin-left: 6px; }
body.nge-mobile .nge-sig-row { gap: 6px; margin-top: 8px; }
body.nge-mobile .nge-sig-beam { padding: 9px 9px; touch-action: manipulation; }
body.nge-mobile .nge-sig-charges { gap: 3px; }
body.nge-mobile .nge-sig-charges span { display: none; }
body.nge-mobile .nge-sig-charges i { width: 11px; height: 7px; }
body.nge-mobile .nge-sig-recenter { padding: 7px 6px; font-size: 8px; letter-spacing: 0.08em; }
body.nge-mobile .nge-sig-coach { margin-top: 6px; }
body.nge-mobile .nge-sig-msg { margin-left: 0; width: 100%; min-height: 0; text-align: left; font-size: 12px; }
body.nge-mobile .nge-sig-note { margin-top: 4px; }
body.nge-mobile .nge-sig-note .txt { display: none; }
body.nge-mobile .nge-sig-card p { font-size: 13px; }
body.nge-mobile .nge-sig-go, body.nge-mobile .nge-sig-quiet { touch-action: manipulation; }
/* Wide screens: the HUD stands at the left (Ames 2026-11-11: "move signal
   control to left, more area for control panel"), the cells get the whole
   height and the width to its right. */
@media (min-width: 1000px) {
  .nge-sig { left: 16px; right: auto; bottom: auto; top: 16px; transform: none; width: min(448px, 40vw); max-height: calc(100vh - 140px); display: flex; flex-direction: column; padding: 12px 16px 12px;
    animation-name: nge-sig-in-side; }
  /* Only the content scrolls, and only when it must: the corner brackets
     poke out of the plate, and on the plate itself they made both scrollbars
     appear with everything in view (Ames 2026-11-08). */
  .nge-sig-scroll { min-height: 0; overflow: hidden auto; scrollbar-width: thin; scrollbar-color: rgba(126, 224, 255, 0.35) transparent; margin-right: -8px; padding-right: 8px; }
  @keyframes nge-sig-in-side { 0% { opacity: 0; transform: translateX(-18px) scaleX(0.04); filter: blur(6px) brightness(2); } 100% { opacity: 1; transform: none; filter: none; } }
  .nge-sig--out { animation-name: nge-sig-out-side; }
  @keyframes nge-sig-out-side { to { opacity: 0; transform: translateX(-14px) scaleX(0.04); filter: blur(6px); } }
  .nge-sig-top { grid-template-columns: 1fr auto; gap: 8px; }
  .nge-sig-cells { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .nge-sig .nge-sig-chip { width: 100%; min-width: 0; box-sizing: border-box; }
  .nge-sig .nge-sig-chip .bar { width: 90px; }
  .nge-sig-row { gap: 8px; }
  .nge-sig-msg { margin-left: 0; width: 100%; text-align: left; }
}
/* the circuit map: the level as a little flow chart, live */
.nge-sig-map { margin: 8px 0 0; }
.nge-sig-map svg { display: block; width: 100%; height: auto; overflow: visible; font-family: 'Inter', 'Roboto', sans-serif; }
.nge-sig-map .edge { stroke-width: 1.6; opacity: 0.9; }
.nge-sig-map .edge.faint, .nge-sig-map .head.faint { opacity: 0.22; stroke-width: 1; }
.nge-sig-map .edge.bar { stroke-width: 2.4; }
.nge-sig-map .count { font: 700 9.5px 'Inter', sans-serif; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: rgba(6, 12, 28, 0.9); stroke-width: 3px; }
.nge-sig-map .node { cursor: pointer; outline: none; }
.nge-sig-map .node.target { cursor: not-allowed; }
.nge-sig-map .node .halo { fill: none; stroke: #c9f6ff; stroke-width: 2; opacity: 0; }
.nge-sig-map .node .body { fill: color-mix(in srgb, var(--c) 28%, rgba(8, 14, 30, 0.9)); stroke: var(--c); stroke-width: 1.6; transition: fill 0.15s; }
.nge-sig-map .node.target .body { stroke-width: 2.2; filter: drop-shadow(0 0 6px rgba(255, 194, 74, 0.7)); }
.nge-sig-map .node:hover .body, .nge-sig-map .node:focus-visible .body { fill: color-mix(in srgb, var(--c) 45%, rgba(8, 14, 30, 0.9)); }
.nge-sig-map .node .key { font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; fill: var(--c); text-anchor: middle; pointer-events: none; }
.nge-sig-map .node .role { font: 600 8.5px 'Inter', sans-serif; letter-spacing: 0.04em; fill: #a9c3de; text-anchor: middle; pointer-events: none; }
.nge-sig-map .node.hint .halo { opacity: 1; animation: nge-sig-map-hint 1s ease-in-out infinite; }
.nge-sig-map .node.hint .body { fill: color-mix(in srgb, var(--c) 55%, rgba(8, 14, 30, 0.9)); }
@keyframes nge-sig-map-hint { 50% { opacity: 0.35; stroke-width: 3; } }
.nge-sig-map .node.hushed { opacity: 0.45; }
.nge-sig-map .node.held .body { fill: #5a3f9a; stroke: #b68cff; }
.nge-sig-map .node.spike .body { animation: nge-sig-map-spike 0.5s ease-out; }
@keyframes nge-sig-map-spike { 0% { fill: #fff; filter: drop-shadow(0 0 10px #fff); } }
.nge-sig-map .spark { pointer-events: none; filter: drop-shadow(0 0 4px currentColor); }
.nge-sig-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin: 6px 0 4px; padding-left: 2px; font-size: 11px; line-height: 1.3; color: #a9c3de; }
.nge-sig-legend i { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px var(--c); vertical-align: -0.5px; }
body.nge-mobile .nge-sig-map .node .role { display: none; }
/* no room for the map on a phone (Ames 2026-11-12); the chips carry the wiring */
body.nge-mobile .nge-sig-map { display: none !important; }
body.nge-mobile .nge-sig-legend { font-size: 10px; gap: 3px 10px; }
/* the scan: a hologram card the ship projects over a cell, as the intro's callouts */
.nge-sig-tip { margin: 10px 0 0; font-size: 11.5px; color: #9fc6ea; }
.ng-extend.nge-sig-scan { position: fixed; left: 0; top: 0; z-index: 9450; pointer-events: none; opacity: 0; transition: opacity 0.35s; }
.ng-extend.nge-sig-scan--in { opacity: 1; }
.ng-extend.nge-sig-scan > svg { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; }
/* the close button, over the app's own button rule (the card's root is .ng-extend) */
.nge-sig-scan .nge-sig-x { display: grid; place-items: center; width: 22px; height: 22px; margin: -1px -4px -1px auto; border: 1px solid rgba(126, 210, 255, 0.45); border-radius: 50%; background: rgba(126, 210, 255, 0.08); color: #cfe6ff; cursor: pointer; }
.nge-sig-scan .nge-sig-x:hover { color: #fff; border-color: rgba(126, 210, 255, 0.9); background: rgba(126, 210, 255, 0.16); }
.ng-extend.nge-sig-scan .cone { fill: url(#nge-sig-scan-g); animation: nge-sig-cone 2.4s ease-in-out infinite; }
@keyframes nge-sig-cone { 50% { opacity: 0.6; } }
/* The card reads over the branches: a denser backing with the view blurred
   behind it, larger type with a shadow (Ames 2026-11-11: "hard to read
   contents of box"); and it drags, to clear the cells it covers ("I want to
   be able to move the box"). */
/* The card after scifi-ui's goldOnBlue hologram (js/holo-material.js): a cool
   blue body, a molten gold rim with its halo, gold dots sitting on the
   surface (no scanlines, nothing scrolls), the colour channels pulled apart
   a little at the rim, and every few seconds a short burst where the signal
   degrades and settles (Ames 2026-11-11: "draw inspiration from this
   hologram shader for the UI / ship's hologram"). */
.nge-sig-scan-box { position: fixed; width: 340px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 11px 15px 12px; pointer-events: auto; transform-origin: 50% 100%; cursor: grab; touch-action: none; user-select: none;
  border: 1px solid rgba(255, 210, 122, 0.85); clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  background: radial-gradient(circle, rgba(255, 210, 122, 0.13) 0.9px, transparent 1.8px) 0 0 / 13px 13px, linear-gradient(160deg, rgba(34, 104, 200, 0.62), rgba(8, 30, 72, 0.8) 55%, rgba(14, 44, 98, 0.74));
  backdrop-filter: blur(8px); box-shadow: inset 0 0 0 1px rgba(255, 246, 224, 0.22), inset 0 0 30px rgba(62, 150, 240, 0.35), 0 0 12px rgba(255, 194, 74, 0.35), 0 0 34px rgba(255, 194, 74, 0.14), 0 10px 30px rgba(0, 0, 0, 0.5);
  color: #f2fbff; font: 13.5px/1.4 'Inter', 'Roboto', sans-serif;
  animation: nge-sig-proj-in 320ms cubic-bezier(.2,1,.3,1) both, nge-sig-glitch 7s 2s infinite; }
@property --nge-reveal { syntax: '<percentage>'; inherits: false; initial-value: 100%; }
/* the print: a cover that retreats downward, a hot line at its edge */
.nge-sig-scan-box::before { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: var(--nge-reveal); z-index: 2; pointer-events: none;
  background: linear-gradient(180deg, rgba(255, 244, 214, 0.95), rgba(255, 210, 122, 0.45) 3px, rgba(255, 210, 122, 0.08) 10px, rgba(6, 24, 58, 0.96) 10px);
  animation: nge-sig-reveal 0.9s cubic-bezier(.3,.7,.2,1) 0.12s both; }
@keyframes nge-sig-reveal { from { --nge-reveal: 100%; } to { --nge-reveal: 0%; } }
/* each line settles in after the print passes it */
.nge-sig-scan-box .identity, .nge-sig-scan-box .sign, .nge-sig-scan-box .nge-sig-readouts li, .nge-sig-scan-box .nge-sig-wiring, .nge-sig-scan-box .nge-sig-chart .h, .nge-sig-scan-box .nge-sig-chart .row, .nge-sig-scan-box .prov,
.nge-sig-canopy .identity, .nge-sig-canopy .sign, .nge-sig-canopy .nge-sig-readouts li, .nge-sig-canopy .nge-sig-wiring, .nge-sig-canopy .nge-sig-chart .h, .nge-sig-canopy .nge-sig-chart .row, .nge-sig-canopy .prov {
  animation: nge-sig-row-in 0.45s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(160ms + var(--i, 0) * 55ms); }
@keyframes nge-sig-row-in { 0% { opacity: 0; transform: translateX(-8px); filter: blur(2px) drop-shadow(-2px 0 rgba(255, 70, 70, 0.6)) drop-shadow(2px 0 rgba(70, 150, 255, 0.6)); } 60% { opacity: 1; filter: none; } 100% { opacity: 1; transform: none; filter: none; } }
.nge-sig-chart .bar i { animation: nge-sig-bar-in 0.6s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(320ms + var(--i, 0) * 55ms); transform-origin: left; }
@keyframes nge-sig-bar-in { from { transform: scaleX(0); } }
/* the chromatic split, red one way and blue the other, hugging the rim */
.nge-sig-scan-box::after { content: ''; position: absolute; inset: 0; pointer-events: none; clip-path: inherit; box-shadow: inset 1px 0 0 rgba(255, 90, 90, 0.28), inset -1px 0 0 rgba(90, 170, 255, 0.28); }
.nge-sig-scan-box.dragging { cursor: grabbing; }
.nge-sig-scan-box .nge-sig-x { cursor: pointer; }
@keyframes nge-sig-proj-in { from { transform: scale(0.2, 0.02); opacity: 0; filter: brightness(2.5); } 60% { opacity: 1; } to { transform: none; opacity: 1; filter: none; } }
@keyframes nge-sig-glitch { 0%, 2.4%, 100% { transform: none; filter: none; } 0.6% { transform: translate(1px, 0); filter: drop-shadow(-2px 0 rgba(255, 70, 70, 0.55)) drop-shadow(2px 0 rgba(70, 150, 255, 0.55)); } 1.2% { transform: translate(-1px, 0); } 1.8% { transform: translate(0.5px, 0); filter: drop-shadow(-1px 0 rgba(255, 70, 70, 0.4)) drop-shadow(1px 0 rgba(70, 150, 255, 0.4)); } }
/* The card reads as an instrument (scifi-ui's data-readout: one label, one
   number, one line of provenance): the cell's call sign large, its identity
   in a line, measured numbers as readouts, its wiring in this level, and
   where the numbers come from (Ames 2026-11-11: "We need a better
   typographic layout"). */
.nge-sig-scan-head { display: flex; align-items: center; gap: 9px; padding-bottom: 7px; border-bottom: 1px solid rgba(126, 224, 255, 0.28); }
.nge-sig-scan-head .ic { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--c, #7ecaff); background: color-mix(in srgb, var(--c, #7ecaff) 35%, transparent); box-shadow: 0 0 8px var(--c, #7ecaff); flex: none; }
.nge-sig-scan .key, .nge-sig-canopy .key { font: 700 22px/1 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.08em; color: var(--c, #fff); text-shadow: 0 0 12px color-mix(in srgb, var(--c, #7ecaff) 60%, transparent); }
.nge-sig-scan .role, .nge-sig-canopy .role { font: 600 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: #9fc6ea; }
.nge-sig-scan .nge-sig-x { margin-left: auto; }
.nge-sig-scan .identity, .nge-sig-canopy .identity { margin: 8px 0 0; font-size: 12.5px; color: #dbe9fa; }
.nge-sig-scan .sign, .nge-sig-canopy .sign { margin: 2px 0 0; font-size: 12px; color: #8fb3d6; }
.nge-sig-readouts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 14px; margin: 10px 0 0; padding: 9px 0 0; list-style: none; border-top: 1px solid rgba(126, 224, 255, 0.22); }
.nge-sig-readouts li { display: grid; gap: 2px; }
.nge-sig-readouts b { font: 500 17px/1.1 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.02em; color: #f4f9ff; font-variant-numeric: tabular-nums; }
.nge-sig-readouts b .u { font: 500 11px 'Inter', sans-serif; margin-left: 3px; color: #a9c3de; text-transform: none; }
.nge-sig-readouts .k { font: 600 9px 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #6ba4e6; }
.nge-sig-wiring { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 10px 0 0; padding-top: 9px; border-top: 1px solid rgba(126, 224, 255, 0.22); align-items: baseline; }
.nge-sig-wiring dt { font: 600 9px/1.5 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #6ba4e6; white-space: nowrap; }
.nge-sig-wiring dd { margin: 0; font-size: 12.5px; color: #eaf7ff; }
[data-show] { cursor: pointer; }
.nge-sig-canopy [data-show] { pointer-events: auto; }
.nge-sig-readouts li[data-show]:hover .k, .nge-sig-wiring dt[data-show]:hover, .nge-sig-wiring dd[data-show]:hover { color: #bfe6ff; }
.nge-sig-readouts li.on b, .nge-sig-readouts li.on .k, .nge-sig-wiring dt.on, .nge-sig-wiring dd.on { color: #7ee0ff; text-shadow: 0 0 8px rgba(126, 224, 255, 0.6); }
.nge-sig-chart { margin: 10px 0 0; padding-top: 8px; border-top: 1px solid rgba(126, 224, 255, 0.22); }
.nge-sig-chart .h, .nge-sig-chart .row { display: grid; grid-template-columns: 1fr 66px 66px; gap: 8px; align-items: center; }
.nge-sig-chart .h { margin-bottom: 5px; font: 600 9px 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #6ba4e6; }
.nge-sig-chart .h[data-show] { cursor: pointer; }
.nge-sig-chart .h.on span:first-child { color: #7ee0ff; text-shadow: 0 0 8px rgba(126, 224, 255, 0.6); }
.nge-sig-chart .row { margin: 3px 0; font-size: 11.5px; }
.nge-sig-chart .row .key { font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; color: var(--c); }
.nge-sig-chart .lbl { color: #dbe9fa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-sig-chart .bar { position: relative; display: block; height: 14px; border-radius: 2px; background: rgba(126, 224, 255, 0.08); }
.nge-sig-chart .bar[data-show] { cursor: pointer; }
.nge-sig-chart .bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: #7ee0ff; opacity: 0.75; }
.nge-sig-chart .bar.from i { background: #ffc24a; }
.nge-sig-chart .bar.untyped i { background: #7f97b3; opacity: 0.45; }
.nge-sig-chart .bar em { position: absolute; right: 4px; top: 0; line-height: 14px; font: 600 10px 'Inter', sans-serif; font-style: normal; color: #f4f9ff; text-shadow: 0 1px 2px #000; font-variant-numeric: tabular-nums; }
.nge-sig-chart .bar.on { outline: 1px solid rgba(126, 224, 255, 0.8); outline-offset: 1px; }
.nge-sig-chart .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.nge-sig-chart .two .row { grid-template-columns: 1fr 56px; gap: 6px; }
.nge-sig-chart .sub { margin: 2px 0 4px; font: 600 9px 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #6ba4e6; }
.nge-sig-scan .prov, .nge-sig-canopy .prov { margin: 10px 0 0; padding-top: 7px; border-top: 1px solid rgba(126, 224, 255, 0.22); font-size: 10px; line-height: 1.5; color: #7f97b3; font-variant-numeric: tabular-nums; }
/* The cockpit view: Pyr's Flight Mode canopy over the free part of the 3D
   view, the reticle locked on the scanned cell body, the readout laid around
   the edges (Ames 2026-11-11: "try cockpit view", "I want to see two versions
   of the view: cockpit and ship"). */
.ng-extend.nge-sig-canopy { position: fixed; z-index: 9440; pointer-events: none; color: rgba(216, 238, 255, 0.92); font: 13px/1.4 'Inter', 'Roboto', sans-serif; opacity: 0; transition: opacity 0.4s; }
.ng-extend.nge-sig-canopy--on { opacity: 1; }
.nge-sig-canopy .c { position: absolute; width: 42px; height: 42px; border: 1.4px solid rgba(53, 181, 255, 0.55); filter: drop-shadow(0 0 6px rgba(53, 181, 255, 0.35)); }
.nge-sig-canopy .c.tl { top: 0; left: 0; border-right: 0; border-bottom: 0; }
.nge-sig-canopy .c.tr { top: 0; right: 0; border-left: 0; border-bottom: 0; }
.nge-sig-canopy .c.bl { bottom: 0; left: 0; border-right: 0; border-top: 0; }
.nge-sig-canopy .c.br { bottom: 0; right: 0; border-left: 0; border-top: 0; }
.nge-sig-canopy .top { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; text-transform: uppercase; white-space: nowrap; }
.nge-sig-canopy .top i { width: 7px; height: 7px; border-radius: 50%; background: #35b5ff; box-shadow: 0 0 8px rgba(53, 181, 255, 0.9); animation: nge-sig-blink 1.6s infinite; }
.nge-sig-canopy .top .sub { font: 400 10px 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: none; color: rgba(53, 181, 255, 0.85); }
.nge-sig-canopy svg.lead { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }
.nge-sig-canopy svg.lead line { stroke: rgba(255, 214, 140, 0.75); }
.nge-sig-canopy .reticle { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; opacity: 0.5; transition: opacity 0.3s; }
.nge-sig-canopy--lock .reticle { opacity: 1; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--c, #35b5ff) 60%, transparent)); }
.nge-sig-canopy .reticle .ring { animation: nge-sig-reticle 9s linear infinite; transform-origin: 60px 60px; }
@keyframes nge-sig-reticle { to { transform: rotate(360deg); } }
.nge-sig-canopy .block { position: absolute; padding: 8px 11px; border: 1px solid rgba(255, 210, 122, 0.55); border-radius: 3px;
  background: radial-gradient(circle, rgba(255, 210, 122, 0.12) 0.9px, transparent 1.8px) 0 0 / 13px 13px, linear-gradient(160deg, rgba(34, 104, 200, 0.5), rgba(8, 30, 72, 0.7));
  backdrop-filter: blur(6px); box-shadow: inset 0 0 0 1px rgba(255, 246, 224, 0.14), inset 0 0 22px rgba(62, 150, 240, 0.28), 0 0 10px rgba(255, 194, 74, 0.22); text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); opacity: 0; transition: opacity 0.35s 0.1s; }
.nge-sig-canopy--lock .block { opacity: 1; }
.nge-sig-canopy .block { pointer-events: auto; cursor: grab; touch-action: none; user-select: none; }
.nge-sig-canopy .block.dragging { cursor: grabbing; opacity: 0.92; }
.nge-sig-canopy .id { left: 18px; top: 44px; max-width: 320px; }
.nge-sig-canopy .id .head { display: flex; align-items: baseline; gap: 10px; }
.nge-sig-canopy .id .key { font-size: 34px; }
.nge-sig-canopy .nums { right: 18px; top: 44px; max-width: 280px; }
.nge-sig-canopy .nums .prov { margin-top: 10px; padding-top: 7px; border-top: 1px solid rgba(255, 210, 122, 0.3); text-align: right; }
.nge-sig-canopy .provenance:empty { display: none; }
.nge-sig-canopy .nums .nge-sig-readouts { grid-template-columns: 1fr; gap: 10px; margin: 0; padding: 0; border: 0; text-align: right; }
.nge-sig-canopy .nums .nge-sig-readouts b { font-size: 22px; }
.nge-sig-canopy .wire { left: 18px; bottom: 44px; max-width: min(520px, 62%); }
.nge-sig-canopy .wire .nge-sig-wiring { margin: 0; padding: 0; border: 0; }
.nge-sig-canopy .provenance { right: 18px; bottom: 44px; text-align: right; }
.nge-sig-canopy .provenance .prov { margin: 0; padding: 0; border: 0; }
.nge-sig-canopy .nge-sig-x { position: absolute; top: 10px; right: 12px; pointer-events: auto; display: grid; place-items: center; width: 26px; height: 26px; margin: 0; border: 1px solid rgba(53, 181, 255, 0.4); border-radius: 8px; background: rgba(6, 10, 22, 0.7); color: rgba(216, 238, 255, 0.85); cursor: pointer; opacity: 0; transition: opacity 0.3s; }
.nge-sig-canopy--lock .nge-sig-x { opacity: 1; }
.nge-sig-canopy .nge-sig-x:hover { border-color: rgba(53, 181, 255, 0.8); box-shadow: 0 0 10px rgba(53, 181, 255, 0.35); }
body.nge-mobile .nge-sig-canopy .nums, body.nge-mobile .nge-sig-canopy .wire, body.nge-mobile .nge-sig-canopy .provenance { display: none; }
body.nge-mobile .nge-sig-canopy .id .key { font-size: 26px; }
/* the intro tour: one short line a step, a kicker with the step's number, Next and Skip */
.nge-sig-tour-kicker { display: flex; align-items: center; gap: 8px; font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #7ecaff; }
.nge-sig-tour-kicker i { width: 14px; height: 1px; background: #7ecaff; box-shadow: 0 0 6px #7ecaff; }
.nge-sig-tour-text { margin: 8px 0 0; font-size: 16px; line-height: 1.4; color: #fff; }
.nge-sig-tour-sub { margin: 6px 0 0; font-size: 12.5px; color: #9fc6ea; }
.nge-sig-tour .nge-sig-row { margin-top: 12px; gap: 8px; }
.nge-sig .nge-sig-ico { display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
.nge-sig .nge-sig-ico svg { display: block; }
.nge-sig .nge-sig-parts { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 7px 0 2px; padding: 0; border: 0; background: none; font: 600 10.5px 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #d6e6f8; }
.nge-sig .nge-sig-parts span { display: inline-flex; align-items: center; gap: 7px; }
.nge-sig .nge-sig-parts span::before { content: ''; width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 7px var(--c); }
.nge-sig .nge-sig-fig { margin: 6px 0 0; }
.nge-sig .nge-sig-fig summary { list-style: none; cursor: pointer; font: 600 9px 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #7ee0ff; }
.nge-sig .nge-sig-fig summary::-webkit-details-marker { display: none; }
.nge-sig .nge-sig-fig summary i { display: inline-block; font-style: normal; margin-left: 3px; transition: transform 0.2s; }
.nge-sig .nge-sig-fig[open] summary i { transform: rotate(90deg); }
/* the science: a folded line in the foot */
.nge-sig .nge-sig-sci { margin: 6px 0 2px; }
.nge-sig .nge-sig-sci-btn { padding: 0; border: 0; background: none; color: #7ee0ff; cursor: pointer; font: 600 10.5px 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; }
.nge-sig .nge-sig-sci-btn i { display: inline-block; font-style: normal; margin-left: 3px; transition: transform 0.2s; }
.nge-sig .nge-sig-sci-btn.open i { transform: rotate(90deg); }
.nge-sig .nge-sig-sci-btn:hover { color: #fff; }
.nge-sig .nge-sig-sci-text { margin: 5px 0 0; font: 13px/1.45 'Inter', 'Roboto', sans-serif; color: #d6e6f8; }
.nge-sig .nge-sig-data { display: none; flex: none; align-items: center; padding: 3px 6px; border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 6px; background: rgba(126, 224, 255, 0.06); color: #9fc6ea; cursor: pointer; line-height: 1; }
body.nge-mobile .nge-sig .nge-sig-data { display: inline-flex; }
body.nge-mobile .nge-sig .nge-sig-view, body.nge-mobile .nge-sig .nge-sig-view-key { display: none !important; }
body.nge-mobile .ng-extend.nge-sig-scan { position: fixed !important; z-index: 9600 !important; left: 6px !important; right: 6px !important; top: calc(8px + env(safe-area-inset-top)) !important; width: auto !important; max-height: calc(100vh - var(--nge-hud-h, 45vh) - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important; overflow: hidden auto; transform: none !important; }
body.nge-mobile .ng-extend.nge-sig-scan .nge-sig-scan-box { position: static !important; width: auto !important; max-width: none !important; }
/* the sheet scrolls within itself, with a scroll bar that shows (Ames 2026-11-12: "this needs a scroll bar") */
body.nge-mobile .ng-extend.nge-sig-scan { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(126, 224, 255, 0.7) rgba(6, 12, 28, 0.4); scrollbar-gutter: stable; }
body.nge-mobile .ng-extend.nge-sig-scan::-webkit-scrollbar { width: 7px; }
body.nge-mobile .ng-extend.nge-sig-scan::-webkit-scrollbar-track { background: rgba(6, 12, 28, 0.4); }
body.nge-mobile .ng-extend.nge-sig-scan::-webkit-scrollbar-thumb { background: rgba(126, 224, 255, 0.7); border-radius: 4px; }
/* compact: the header and the synapse counts only; More opens the rest */
body.nge-mobile .nge-sig-scan--compact .identity, body.nge-mobile .nge-sig-scan--compact .sign, body.nge-mobile .nge-sig-scan--compact .nge-sig-wiring, body.nge-mobile .nge-sig-scan--compact .nge-sig-chart, body.nge-mobile .nge-sig-scan--compact .prov, body.nge-mobile .nge-sig-scan--compact .nge-sig-readouts li:nth-child(n+3) { display: none !important; }
body.nge-mobile .nge-sig-scan--compact .nge-sig-scan-box { padding-bottom: 8px; }
body.nge-mobile .nge-sig-more { margin-top: 8px; padding: 6px 12px; font: 700 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-sig .nge-sig-edit { flex: none; padding: 2px 6px; border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 6px; background: rgba(126, 224, 255, 0.06); color: #9fc6ea; cursor: pointer; font-size: 12px; line-height: 1; }
.nge-sig .nge-sig-edit:hover { color: #fff; background: rgba(126, 224, 255, 0.14); }
/* the editor: a card beside the HUD, a section a box */
.ng-extend.nge-sig-editor { position: fixed; z-index: 9520; top: 16px; left: calc(min(448px, 40vw) + 32px); width: 340px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 11px 15px 12px; color: #f2fbff; font: 12.5px/1.4 'Inter', 'Roboto', sans-serif;
  border: 1px solid rgba(255, 210, 122, 0.85); clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  background: radial-gradient(circle, rgba(255, 210, 122, 0.13) 0.9px, transparent 1.8px) 0 0 / 13px 13px, linear-gradient(160deg, rgba(34, 104, 200, 0.7), rgba(8, 30, 72, 0.9));
  backdrop-filter: blur(8px); box-shadow: inset 0 0 0 1px rgba(255, 246, 224, 0.2), 0 0 12px rgba(255, 194, 74, 0.3); }
.nge-sig-editor .head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255, 210, 122, 0.3); font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #ffd98a; }
.nge-sig-editor .head .nge-sig-x { margin-left: auto; display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid rgba(126, 210, 255, 0.45); border-radius: 50%; background: rgba(126, 210, 255, 0.08); color: #cfe6ff; cursor: pointer; }
.nge-sig-editor section { margin-top: 9px; }
.nge-sig-editor h4 { margin: 0 0 4px; font: 600 9px 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #6ba4e6; }
.nge-sig-editor label { display: block; margin: 4px 0; }
.nge-sig-editor label span { display: block; font-size: 10px; color: #8fb3d6; margin-bottom: 2px; }
.nge-sig-editor textarea { display: block; width: 100%; box-sizing: border-box; padding: 5px 7px; border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 3px; background: rgba(6, 12, 28, 0.6); color: #f4f9ff; font: 12.5px/1.4 'Inter', 'Roboto', sans-serif; resize: vertical; }
.nge-sig-editor textarea:focus { outline: none; border-color: rgba(255, 210, 122, 0.8); }
.nge-sig-editor .nge-sig-row { margin-top: 10px; }
.nge-sig-editor .nge-sig-quiet { position: relative; background: none; border: 0; padding: 7px 14px 7px 16px; color: #bfe0ff; cursor: pointer; white-space: nowrap; font: 700 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); outline: 1px solid rgba(126, 224, 255, 0.5); outline-offset: -1px; }
.nge-sig-editor .nge-sig-quiet:hover { background: rgba(126, 224, 255, 0.14); color: #fff; }
.nge-sig-editor .hint { margin: 8px 0 0; font-size: 10px; color: #7f97b3; }
body.nge-mobile .ng-extend.nge-sig-editor { left: 6px; right: 6px; width: auto; top: 8px; }
/* labels the tour pins on parts of a cell (dendrites, cell body, axon) */
.ng-extend.nge-sig-label { position: fixed; z-index: 9400; transform: translate(12px, -50%); padding: 2px 8px; border: 1px solid rgba(255, 224, 160, 0.6); border-radius: 3px; background: rgba(6, 12, 28, 0.78); color: #ffe9b8; font: 600 11px 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; opacity: 0; transition: opacity 0.4s; pointer-events: none; }
.ng-extend.nge-sig-label::before { content: ''; position: absolute; left: -12px; top: 50%; width: 11px; height: 1px; background: rgba(255, 224, 160, 0.7); }
.ng-extend.nge-sig-label--in { opacity: 1; }
/* a message is a glitch in the hologram: it bursts in with its channels
   pulled apart, shivers, settles, holds, and fades */
.ng-extend.nge-sig-pop { position: fixed; z-index: 9470; max-width: 300px; padding: 7px 12px; pointer-events: none; border: 1px solid rgba(255, 210, 122, 0.8); clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  background: radial-gradient(circle, rgba(255, 210, 122, 0.12) 0.9px, transparent 1.8px) 0 0 / 13px 13px, linear-gradient(160deg, rgba(34, 104, 200, 0.66), rgba(8, 30, 72, 0.84));
  backdrop-filter: blur(6px); box-shadow: inset 0 0 0 1px rgba(255, 246, 224, 0.2), 0 0 12px rgba(255, 194, 74, 0.35); color: #fff3d6; font: 600 13px/1.35 'Inter', 'Roboto', sans-serif; text-shadow: 0 0 8px rgba(255, 194, 74, 0.4);
  animation: nge-sig-pop-in 0.5s steps(1, end) both; }
@keyframes nge-sig-pop-in { 0% { opacity: 0; transform: translate(-2px, 0) skewX(-8deg); filter: drop-shadow(-3px 0 rgba(255, 70, 70, 0.7)) drop-shadow(3px 0 rgba(70, 150, 255, 0.7)); } 15% { opacity: 1; transform: translate(2px, 0) skewX(6deg); } 30% { transform: translate(-1px, 0) skewX(-3deg); filter: drop-shadow(-2px 0 rgba(255, 70, 70, 0.5)) drop-shadow(2px 0 rgba(70, 150, 255, 0.5)); } 45% { transform: translate(1px, 0); opacity: 0.6; } 60% { transform: none; opacity: 1; filter: drop-shadow(-1px 0 rgba(255, 70, 70, 0.3)) drop-shadow(1px 0 rgba(70, 150, 255, 0.3)); } 100% { transform: none; opacity: 1; filter: none; } }
.ng-extend.nge-sig-pop--out { animation: nge-sig-pop-out 0.35s ease-in both; }
@keyframes nge-sig-pop-out { to { opacity: 0; transform: translateY(-4px); } }
/* three, two, one, go: in the middle of the free part of the view */
.ng-extend.nge-sig-count { position: fixed; z-index: 9460; transform: translate(-50%, -50%); pointer-events: none; font: 700 96px/1 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; color: #e6f7ff; text-shadow: 0 0 30px rgba(126, 224, 255, 0.8), 0 0 60px rgba(74, 150, 224, 0.5); }
.ng-extend.nge-sig-count.pop { animation: nge-sig-count 0.85s ease-out both; }
@keyframes nge-sig-count { 0% { opacity: 0; transform: translate(-50%, -50%) scale(1.6); filter: blur(6px); } 25% { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: none; } 100% { opacity: 0.15; transform: translate(-50%, -50%) scale(0.9); } }
body.nge-mobile .ng-extend.nge-sig-count { font-size: 64px; }
@media (prefers-reduced-motion: reduce) { .nge-sig-scan-box, .nge-sig-scan-box::before, .nge-sig-scan-box *, .nge-sig-canopy *, .nge-sig-canopy .block, .ng-extend.nge-sig-pop, .ng-extend.nge-sig-scan .cone, .nge-sig-canopy .reticle .ring { animation: none; } }
body.nge-mobile .nge-sig-scan-box { min-width: 0; max-width: calc(100vw - 24px); font-size: 11.5px; }
/* the Intro test panel sits where the HUD now stands: away while the game runs */
body.nge-signal-on .nge-stt, body.nge-signal-on .nge-stt-dock { display: none !important; }
/* Pyr's top bar and the layer tabs are away while the game runs, and the
   viewer takes the window (Ames 2026-11-11: "hide these during the game") */
body.nge-signal-on #extensionBar, body.nge-signal-on .neuroglancer-viewer-top-row, body.nge-signal-on .neuroglancer-layer-panel { display: none !important; }
/* on a phone the bottom nav and the corner layout button go too while the game runs, and the HUD takes the room (Ames 2026-11-12: "on mobile this game is still showing the bottom bar") */
body.nge-signal-on .nge-mobile-nav, body.nge-signal-on .neuroglancer-data-panel-layout-controls { display: none !important; }
body.nge-signal-on.nge-mobile .nge-sig { bottom: calc(8px + env(safe-area-inset-bottom)); max-height: 64vh; }
body.nge-signal-on #neuroglancer-container { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; }
@media (max-width: 700px) { .nge-sig { padding: 10px 12px; font-size: 12.5px; } .nge-sig-obj strong { font-size: 14px; } .nge-sig-stats b { font-size: 15px; }
  .nge-sig .nge-sig-chip .syn { display: none; } .nge-sig .nge-sig-chip { min-width: 0; } .nge-sig .nge-sig-chip .bar { width: 70px; } .nge-sig-note { display: none; } .nge-sig-coach { font-size: 13px; } }
@media (prefers-reduced-motion: reduce) { .nge-sig, .nge-sig-dot, .nge-sig-chip--spike { animation: none; } }
`;
  document.head.appendChild(st);
}

const X_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const BACK_SVG = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2 3.5 6l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REPLAY_SVG = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M8.55 8.55A3.6 3.6 0 1 1 7.8 2.88" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7.0 0.7 7.8 2.88 5.5 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function buildPanel() {
  ensureStyle();
  panel?.remove();
  panel = document.createElement('section');
  panel.className = 'ng-extend nge-sig';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Signal Controller');
  panel.innerHTML = `<span class="nge-sig-bg"></span><i class="nge-sig-corner tr"></i><i class="nge-sig-corner bl"></i><i class="nge-sig-trace t"></i><i class="nge-sig-trace l"></i><div class="nge-sig-scroll">
    <div class="nge-sig-head"><i class="nge-sig-gem" aria-hidden="true"></i><span class="nge-sig-view-key">View</span><span class="nge-sig-view" data-el="view" role="group" aria-label="View"><button type="button" data-view="ship" aria-pressed="true" title="The ship in the scene: it flies to the cells you scan">Ship</button><button type="button" data-view="cockpit" aria-pressed="false" title="From the ship's cockpit: the canopy, the reticle, the readouts">Cockpit</button></span>
      <button class="nge-sig-share" type="button" data-el="share" title="Copy a link to the game">Share</button>
      <button class="nge-sig-edit" type="button" data-el="edit" title="Edit the words on this page">✎</button>
      <button class="nge-sig-data" type="button" data-el="data" title="The cell's data: the last cell you tapped, or the gold cell"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 6h6M4 8.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>
      <button class="nge-sig-fold" type="button" data-el="fold" title="Fold the panel away, or open it again" aria-expanded="true"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="nge-sig-mute" type="button" data-el="mute" title="Sound">♪</button>
      <button class="nge-sig-x" type="button" aria-label="Leave the game" data-el="x">${X_SVG}</button></div>
    <div class="nge-sig-top"><div class="nge-sig-obj"><span>Objective</span><strong data-el="obj"></strong><em data-el="detail"></em></div>
      <div class="nge-sig-stats"><div>Progress<b data-el="progress">0</b></div><div>Time<b data-el="time">0</b></div><div>Score<b data-el="score">0</b></div></div></div>
    <div class="nge-sig-coach" data-el="coach" aria-live="polite"><i></i><span data-el="coachText"></span></div>
    <div class="nge-sig-map" data-el="map"></div>
    <div data-el="body"></div>
    <div class="nge-sig-row" data-el="row"><div class="nge-sig-beams"><button class="nge-sig-beam spark" type="button" data-el="spark" aria-pressed="true" title="Spark: the cell fires. Costs 1 charge. Key: S">Spark<kbd class="hk">S</kbd><i class="cost" aria-label="1 charge"><b></b></i></button><button class="nge-sig-beam hush" type="button" data-el="hush" aria-pressed="false" title="Inhibit: the cell is silent for 2.5 s. Costs 2 charges. Key: I (or H)">Inhibit<kbd class="hk">I</kbd><i class="cost" aria-label="2 charges"><b></b><b></b></i></button></div><kbd class="nge-sig-key" title="Tab (or Space) switches between Spark and Inhibit; S and I pick one">Tab</kbd>
      <div class="nge-sig-charges" data-el="charges"><span>Charge</span></div>
      <button class="nge-sig-quiet nge-sig-recenter" type="button" data-el="recenter" title="Bring the camera back to the circuit">Recenter</button>
      <div class="nge-sig-msg" data-el="msg"></div></div>
    <div class="nge-sig-sci"><button type="button" class="nge-sig-sci-btn" data-el="sci" aria-expanded="false">The science <i>›</i></button><p class="nge-sig-sci-text" data-el="sciText" hidden></p></div>
    <div class="nge-sig-note"><span class="lvl" data-el="lvl"></span></div></div>`;
  document.body.appendChild(panel);
  footEl?.remove();
  footEl = document.createElement('p');
  footEl.className = 'ng-extend nge-sig-foot';
  footEl.innerHTML = 'Data (neurons, synapses): MICrONS public release.<br>Firing is a simple model played 2,000 times slower than real life.';
  document.body.appendChild(footEl);
  els = {};
  panel.querySelectorAll<HTMLElement>('[data-el]').forEach(el => { els[el.dataset.el!] = el; });
  els.x.onclick = () => stopSignalController();
  els.mute.onclick = () => {
    muted = !muted; els.mute.textContent = muted ? '♪̸' : '♪'; els.mute.style.opacity = muted ? '0.5' : '1';
    if (music) music.muted = muted;
    if (!muted) startMusic();   // a click, so the browser allows it: in the tour as in play
  };
  document.addEventListener('pointerdown', nudgeMusic, true);
  // Buttons let go of the focus after a click, so Space keeps switching the
  // beam instead of pressing the last button again.
  els.spark.onclick = () => { setHushMode(false); els.spark.blur(); };
  els.hush.onclick = () => { setHushMode(true); els.hush.blur(); };
  els.view.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.onclick = () => { setView(b.dataset.view as ViewMode); b.blur(); }; });
  els.edit.onclick = () => { toggleEditor(); els.edit.blur(); };
  // the panel folds to its head row for more of the screen, and opens again (Ames 2026-11-12: "a down caret to collapse the box and an up one to re-expand")
  els.fold.onclick = () => { const folded = panel!.classList.toggle('nge-sig--folded'); els.fold.setAttribute('aria-expanded', String(!folded)); els.fold.blur(); };
  // the phone's data icon: the full card for the last cell tapped, else the gold cell (Ames 2026-11-12: "we still want UI icons that let me expand the data the ship was carrying")
  els.data.onclick = () => {
    if (scanEl) { hideScan(); els.data.blur(); return; }   // tapped again: the card goes (Ames 2026-11-12)
    const k = lastTapped && cells.get(lastTapped)?.shown ? lastTapped : level.targets[0];
    if (k) showScan(k, true);
    els.data.blur();
  };
  // the science, folded unless it was open last time
  let sciOpen = false;
  try { sciOpen = localStorage.getItem('pyr.signal.sci') === '1'; } catch { /* folded */ }
  const showSci = () => {
    const t = level.science ?? '';
    els.sci.parentElement!.style.display = t ? '' : 'none';
    els.sciText.textContent = t;
    (els.sciText as HTMLElement).hidden = !sciOpen;
    els.sci.setAttribute('aria-expanded', String(sciOpen));
    els.sci.classList.toggle('open', sciOpen);
  };
  els.sci.onclick = () => { sciOpen = !sciOpen; try { localStorage.setItem('pyr.signal.sci', sciOpen ? '1' : '0'); } catch { /* not kept */ } showSci(); els.sci.blur(); };
  showScience = showSci;
  showSci();
  // Pyr's own Share lives in the top bar, which is away while the game runs
  els.share.onclick = async () => {
    const link = `${location.origin}${location.pathname}?signal`;
    els.share.blur();
    if (touch() && (navigator as any).share) { try { await (navigator as any).share({title: 'Signal Controller', url: link}); return; } catch { /* the copy, then */ } }
    try { await navigator.clipboard.writeText(link); say('Link copied.', 2.2); } catch { say(link, 6); }
  };
  setView(view);
  els.recenter.onclick = () => { frameLevel(); say('Back at the circuit.', 1.5); };
  for (let k = 0; k < MAX_CHARGES; k++) els.charges.appendChild(document.createElement('i'));
}

function setHushMode(on: boolean) {
  if (on && !level.hush) { say('Inhibit is not yours yet.'); return; }
  hushMode = on;
  els.spark.setAttribute('aria-pressed', String(!on));
  els.hush.setAttribute('aria-pressed', String(on));
}

function say(text: string, seconds = 2.6, at?: string) {
  popup(text, seconds, at);
  message = text;
  messageUntil = performance.now() + seconds * 1000;
  if (els.msg) els.msg.textContent = text;
}

/* ── the coach: one instruction at a time ── */
const coached = new Set<CoachEvent>();
let lastMissCoach = -Infinity;
/** Targets' latest excitatory arrival that has not fired them yet. */
const pendingExcitation = new Map<string, number>();
/** The cells lit up as the thing to click right now. */
let hints = new Set<string>();
type GoState = 'go' | 'wait' | 'soon';
let lastGo: GoState | null = null;
let coachHoldUntil = 0;   // game seconds: a hit or miss line stays this long before go/wait take over
/** On a touch screen there are no keys to name, and a tap is a tap. */
function adapt(text: string): string {
  if (!touch()) return text;
  return text.replace(' (the button, or Tab)', ' (the button)').replace(' (the number keys help)', '')
    .replace(/\bClick\b/g, 'Tap').replace(/\bclicks\b/g, 'taps').replace(/\bclick\b/g, 'tap');
}
function setCoachText(text: string, event: CoachEvent) {
  if (!els.coachText) return;
  els.coachText.textContent = adapt(text);
  els.coach.classList.toggle('nge-sig-coach--go', event === 'go');
  els.coach.classList.toggle('nge-sig-coach--held', event === 'wait');
  // A new instruction flashes in; the go/wait light only changes colour.
  els.coach.classList.remove('nge-sig-coach--new');
  if (event !== 'go' && event !== 'wait' && event !== 'soon') { void els.coach.offsetWidth; els.coach.classList.add('nge-sig-coach--new'); }
  const h = level.hint?.[event];
  if (h) hints = new Set(h);
}
function coach(event: CoachEvent) {
  if (phase !== 'playing') return;   // the tour's demonstrations spike cells too
  const text = level.coach[event];
  if (!text) return;
  // The first-time events say their piece once; hits and misses can repeat.
  if (event !== 'hit' && event !== 'miss') { if (coached.has(event)) return; coached.add(event); }
  if (event === 'hit' || event === 'miss') { coachHoldUntil = now + 3; lastGo = null; }
  // The opening line stays long enough to read, and to see the first pulse
  // (at 1.2 s) land; the first go follows it.
  if (event === 'begin') coachHoldUntil = now + 3;
  setCoachText(text, event);
}
/** Travel time of a spike along a connection, in seconds. */
function travelS(pre: string, post: string, fallback: number): number {
  const k = conns.find(c => c.pre === pre && c.post === post);
  const fast = FAST[pre] ?? 1;
  return k ? (fast > 1 ? 0.05 : AP_DELAY_S) + routes.get(k)!.length / 1000 / (SPEED_UM_S * fast) : fallback;
}
/** In the levels with the Gatekeeper, the coach line is a three-colour
 *  light. Violet, wait: a pulse is on its way to the target or holding it
 *  down. Amber, not yet: the next pulse lands too soon for sparks fired now,
 *  two clicks 0.35 s apart, each a 0.3 s beam and a spike's run down the
 *  driver's axon, to get there first. Blue, go. (Ames 2026-11-08: the old
 *  two-state light said go while the pulse was still in flight, a trap, and
 *  flipped four times a cycle.) */
function updateGoWait() {
  if (phase !== 'playing' || !level.gate || !level.coach.go || now < coachHoldUntil) return;
  const gate = cells.get(level.gate.cell);
  const target = cells.get(level.targets[0]);
  if (!gate || !target) return;
  // the chain to the Gatekeeper comes first in the Key and Switch levels
  if (level.hint?.wait?.some(k => k !== gate.key && (cells.get(k)?.lastSpike ?? -1) < 0) && !coached.has('key')) return;
  const inFlight = arrivals.some(a => a.inhibitory && a.post === target.key);
  const held = inFlight || target.i >= 1.5;
  let nextLanding = Infinity;
  if (gate.gateNext !== null) nextLanding = Math.max(gate.gateNext, gate.hushedUntil) + travelS(gate.key, target.key, 0.7);
  const driverTravel = Math.max(0.45, ...(level.hint?.go ?? []).map(k => travelS(k, target.key, 0.45)));
  const lead = BEAM_S + REFRACTORY_S + 0.1 + driverTravel + 0.35;   // the second spike's landing, with a margin
  const state: GoState = held ? 'wait' : nextLanding - now <= lead ? 'soon' : 'go';
  if (state === lastGo) return;
  lastGo = state;
  const event: CoachEvent = state === 'soon' && !level.coach.soon ? 'wait' : state;
  setCoachText(level.coach[event]!, event);
}

/** What a cell is for, for its chip: "Driver · 5 syn → T". */
function roleOf(c: CellState): string {
  if (c.target) return 'Target';
  if (ROLE[c.key]) return ROLE[c.key];
  return c.spec.type === 'I' ? 'Interneuron' : 'Driver';
}
/** How many of the cell's spikes, as close together as it can fire them
 *  (REFRACTORY_S apart), spike the cell it drives on their own: its
 *  synapses' charge, leaking at TAU_E, against the threshold. Null when six
 *  are not enough (Ames 2026-11-11: "show the number of APs required to
 *  spike the target, like 2 clicks for E1, 3 clicks for E2"). */
function sparksToFire(count: number, post: CellState): number | null {
  const k = Math.exp(-REFRACTORY_S / TAU_E);
  let charge = 0;
  for (let i = 1; i <= 6; i++) { charge = charge * k + count * E_UNIT; if (charge >= post.theta) return i; }
  return null;
}
const WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
/** The cell it drives hardest, when that is a target. */
function drives(c: CellState): CircuitConn | undefined {
  if (c.spec.type === 'I') return undefined;
  return conns.filter(k => k.pre === c.key && cells.get(k.post)?.target && cells.get(k.post)?.shown).sort((a, b) => b.count - a.count)[0];
}
/** The kind of cell, one word: "pyramidal", "bipolar", "Martinotti". */
function typeWord(c: CellState): string { return (c.spec.label || '').replace(/\s*cell$/i, '').replace(/^pyramidal$/i, 'pyramidal'); }
/** A tag's second line: the role and the kind of cell, since the call sign
 *  says the job and not the kind (Ames 2026-11-11: "is the key cell the
 *  bipolar cell? make some indicator for cell type"). */
function tagLine(c: CellState): string { const t = typeWord(c); return t ? `${roleOf(c)} · ${t === 'Martinotti' ? t : t.toLowerCase()}` : roleOf(c); }
function chipLine(c: CellState): string {
  const outs = conns.filter(k => k.pre === c.key && cells.get(k.post)?.shown)
    .sort((a, b) => Number(cells.get(b.post)!.target) - Number(cells.get(a.post)!.target) || b.count - a.count);
  const role = roleOf(c);
  if (c.target || !outs.length) return role;
  const d = drives(c);
  const wt = d?.w ?? 1;
  const need = d ? sparksToFire(d.count * wt, cells.get(d.post)!) : null;
  const sparks = !d ? '' : need ? ` · ${need} spark${need > 1 ? 's' : ''}` : ' · with others';
  const weight = d && wt > 1.05 ? ` ×${wt.toFixed(1)}` : '';
  return `${role} · ${outs[0].count} syn${weight} → ${outs[0].post}${sparks}`;
}

/* ── the circuit map: a little flow chart of the level ──
   Ames 2026-11-11: "more visuals of cells, instant color coding, maybe a
   little flow chart or other stat that will help me instantly understand
   what I'm seeing and what to do". The level's cells as nodes in their own
   colours, drivers down the left with arrows into the targets at the right
   (synapse counts on the arrows), the Gatekeeper and the chain that quiets
   it across the top with bar-ended inhibitory links. It is live: the cell
   to click pulses, a hushed cell dims, the target turns violet while held,
   and every spike runs its arrow in time with the 3D view. Nodes are
   buttons: clicking one fires the beam at that cell. */
const MAP_W = 400;
interface MapNode { x: number; y: number; r: number; }
let mapNodes = new Map<string, MapNode>();
let mapEdges = new Map<CircuitConn, {x1: number; y1: number; x2: number; y2: number}>();
let mapNodeEls = new Map<string, SVGGElement>();
let mapSparkEls: SVGCircleElement[] = [];
const MAP_SPARKS = 24;
function buildMap() {
  const el = els.map;
  if (!el) return;
  const shown = level.cells.filter(k => cells.get(k)?.shown);
  const isTarget = (k: string) => level.targets.includes(k);
  const gate = level.gate && shown.includes(level.gate.cell) ? level.gate.cell : null;
  const key = shown.includes('I2') ? 'I2' : null;
  const sw = shown.includes('S') ? 'S' : null;
  const targets = level.targets.filter(k => shown.includes(k));
  const drivers = shown.filter(k => !isTarget(k) && k !== gate && k !== key && k !== sw);
  // each driver sits under the target it feeds most
  const mainTarget = (d: string) => { let best: string | null = null, n = 0; for (const c of conns) if (c.pre === d && targets.includes(c.post) && c.count > n) { n = c.count; best = c.post; } return best; };
  const byTarget = new Map<string | null, string[]>();
  for (const d of drivers) { const t = mainTarget(d); if (!byTarget.has(t)) byTarget.set(t, []); byTarget.get(t)!.push(d); }
  mapNodes = new Map();
  // 46 px a row: the role under a node cleared the next node by 3 px at 38 (Ames 2026-11-11: "spacing, alignment, design!")
  const R = 13, RT = 16, ROW = 46, XL = 48, XR = MAP_W - 48;
  const top = [sw, key, gate].filter(Boolean) as string[];
  let y = 26;
  if (top.length) {
    // the chain that quiets the Gatekeeper, across the top, the Gatekeeper
    // itself above the targets
    const xs = top.length === 1 ? [XR - 70] : top.length === 2 ? [XR - 160, XR - 70] : [XR - 250, XR - 160, XR - 70];
    top.forEach((k, i) => mapNodes.set(k, {x: xs[i], y, r: R}));
    y += 50;
  }
  for (const t of targets) {
    const ds = byTarget.get(t) ?? [];
    const y0 = y;
    for (const d of ds) { mapNodes.set(d, {x: XL, y, r: R}); y += ROW; }
    const yT = ds.length ? (y0 + y - ROW) / 2 : y;
    mapNodes.set(t, {x: XR, y: yT, r: RT});
    if (!ds.length) y += ROW;
  }
  for (const d of byTarget.get(null) ?? []) { mapNodes.set(d, {x: XL, y, r: R}); y += ROW; }
  const H = y - ROW + 34;
  // edges: the real connections among the cells shown, where they matter
  mapEdges = new Map();
  const rgb = (k: string) => `rgb(${cells.get(k)!.color.join(',')})`;
  let edgesSvg = '';
  for (const k of conns) {
    if (!live(k)) continue;
    const a = mapNodes.get(k.pre), b = mapNodes.get(k.post);
    if (!a || !b) continue;
    const pre = cells.get(k.pre)!, post = cells.get(k.post)!;
    const inhib = pre.spec.type === 'I';
    // strong: into a target, or along the chain that quiets the Gatekeeper; faint: a driver nudging the Gatekeeper
    const strong = post.target || inhib || (post.spec.type === 'I' && k.count >= 8);
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const x1 = a.x + ux * (a.r + 3), y1 = a.y + uy * (a.r + 3), x2 = b.x - ux * (b.r + (inhib ? 6 : 9)), y2 = b.y - uy * (b.r + (inhib ? 6 : 9));
    mapEdges.set(k, {x1, y1, x2, y2});
    const col = rgb(k.pre);
    const cls = `edge${strong ? '' : ' faint'}${inhib ? ' inhib' : ''}`;
    edgesSvg += `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}"/>`;
    const px = -uy, py = ux;   // across the line
    if (inhib) {
      // the bar of an inhibitory link, across the line at its end
      edgesSvg += `<line class="edge inhib bar${strong ? '' : ' faint'}" x1="${(x2 - px * 6).toFixed(1)}" y1="${(y2 - py * 6).toFixed(1)}" x2="${(x2 + px * 6).toFixed(1)}" y2="${(y2 + py * 6).toFixed(1)}" stroke="${col}"/>`;
    } else {
      // an arrowhead, in the line's own colour
      const tx = x2 + ux * 8, ty = y2 + uy * 8;
      edgesSvg += `<path class="head${strong ? '' : ' faint'}" d="M${tx.toFixed(1)} ${ty.toFixed(1)} L${(x2 - ux * 1 + px * 4).toFixed(1)} ${(y2 - uy * 1 + py * 4).toFixed(1)} L${(x2 - ux * 1 - px * 4).toFixed(1)} ${(y2 - uy * 1 - py * 4).toFixed(1)} z" fill="${col}"/>`;
    }
    if (strong) {
      // the synapse count, beside the line past its middle (at the end the
      // counts of arrows meeting one target bunch up)
      const lx = x1 + (x2 - x1) * 0.58 - uy * 9, ly = y1 + (y2 - y1) * 0.58 + ux * 9;
      edgesSvg += `<text class="count" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${col}">${k.count}</text>`;
    }
  }
  let nodesSvg = '';
  for (const [k, n] of mapNodes) {
    const c = cells.get(k)!;
    const role = roleOf(c);
    nodesSvg += `<g class="node${c.target ? ' target' : ''}" data-cell="${k}" transform="translate(${n.x},${n.y})" style="--c:${rgb(k)}" tabindex="0" role="button" aria-label="${c.target ? `${k}, the target` : `Fire the beam at ${k}`}">
      <circle class="halo" r="${n.r + 7}"/><circle class="body" r="${n.r}"/><text class="key" dy="0.36em">${k}</text><text class="role" y="${n.r + 13}">${role}</text></g>`;
  }
  let sparksSvg = '';
  for (let i = 0; i < MAP_SPARKS; i++) sparksSvg += '<circle class="spark" r="3.5" opacity="0"/>';
  el.innerHTML = `<svg viewBox="0 0 ${MAP_W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="false">${edgesSvg}${nodesSvg}${sparksSvg}</svg>
    <div class="nge-sig-legend">${[targets.length ? '<i style="--c:#ffc24a"></i>target' : '', drivers.length ? '<i style="--c:#5fb8ff"></i>drivers, excitatory →' : '',
      gate ? '<i style="--c:#b68cff"></i>Gatekeeper, inhibitory ⊣' : '', key ? '<i style="--c:#e58cff"></i>Key, inhibitory ⊣' : '', shown.includes('B1') ? '<i style="--c:#ff7eb6"></i>Clipper, inhibitory ⊣' : ''].filter(Boolean).join('')}</div>`;
  mapNodeEls = new Map();
  el.querySelectorAll<SVGGElement>('g.node').forEach(g => {
    const k = g.dataset.cell!;
    mapNodeEls.set(k, g);
    const act = () => { if (phase === 'playing') shoot(k); else tourClick(k); };
    g.addEventListener('click', act);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  });
  mapSparkEls = [...el.querySelectorAll<SVGCircleElement>('circle.spark')];
}
/** The map, each frame: who to click, who is hushed, the hold on the
 *  target, and the spikes on their way along the arrows. */
function updateMap() {
  if (!mapNodeEls.size) return;
  for (const [k, g] of mapNodeEls) {
    const c = cells.get(k)!;
    g.classList.toggle('hint', hints.has(k));
    g.classList.toggle('hushed', now < c.hushedUntil);
    g.classList.toggle('held', holdOn(c) > 0.3);
  }
  let i = 0;
  for (const s of sparks) {
    if (i >= mapSparkEls.length) break;
    const e = mapEdges.get(s.conn);
    if (!e) continue;
    const q = clamp((now - s.start) / (s.end - s.start), 0, 1);
    const el = mapSparkEls[i++];
    el.setAttribute('cx', (e.x1 + (e.x2 - e.x1) * q).toFixed(1));
    el.setAttribute('cy', (e.y1 + (e.y2 - e.y1) * q).toFixed(1));
    el.setAttribute('fill', s.inhibitory ? '#cfaeff' : '#fff4cc');
    el.setAttribute('opacity', now < s.end ? '1' : String(Math.max(0, 1 - (now - s.end) / 0.3)));
  }
  for (; i < mapSparkEls.length; i++) mapSparkEls[i].setAttribute('opacity', '0');
}
function mapFlash(key: string) {
  const g = mapNodeEls.get(key);
  if (!g) return;
  g.classList.remove('spike'); void (g as any).getBBox?.(); g.classList.add('spike');
}

function showChips() {
  const body = els.body;
  buildMap();
  // On a phone the map has the sheet to itself before Begin; in play the
  // chips and the controls need the room.
  els.map.style.display = phone() ? 'none' : '';
  body.innerHTML = '<div class="nge-sig-kicker"><i></i>Neurons involved</div><div class="nge-sig-cells"></div>';
  const wrap = body.querySelector('.nge-sig-cells')!;
  chipEls.clear();
  const order = level.cells.slice().sort((a, b) => {
    const ca = cells.get(a)!, cb = cells.get(b)!;
    return Number(cb.target) - Number(ca.target) || (ca.spec.type === 'I' ? 1 : 0) - (cb.spec.type === 'I' ? 1 : 0) || a.localeCompare(b);
  });
  for (const key of order) {
    const c = cells.get(key)!;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'nge-sig-chip' + (c.target ? ' nge-sig-chip--target' : '');
    el.style.setProperty('--c', `rgb(${c.color.join(',')})`);
    const outs = conns.filter(k => k.pre === key && cells.get(k.post)?.shown).sort((a, b) => b.count - a.count).map(k => `${k.count} synapses onto ${k.post}`).join(', ');
    el.title = `${c.spec.label} (${c.spec.fine}${c.spec.mtype ? ', ' + c.spec.mtype : ''}), ${c.spec.cableUm.toLocaleString()} µm of cable${outs ? '. ' + outs : ''}`;
    // Only the cells whose state matters carry a bar: a target's charge
    // toward firing, the Gatekeeper's time to its next pulse. Drivers fire
    // the moment they are sparked, so they show none (Ames 2026-11-08:
    // "what do all the bars mean?").
    const bar = c.target ? '<span class="barrow"><span class="barlabel">charge</span><span class="bar"><b></b></span></span>'
      : c.gateNext !== null ? '<span class="barrow"><span class="barlabel">pulses in</span><span class="bar"><b class="neg"></b></span></span>' : '';
    el.innerHTML = `<span class="text"><span class="key">${key}<small>${c.spec.label}</small></span><span class="syn">${chipLine(c)}</span>${bar}</span>`;
    el.onclick = () => { shoot(key); el.blur(); };
    wrap.appendChild(el);
    chipEls.set(key, el);
  }
  els.row.style.display = '';
}

/* ── a cell's parts (static/signal/cell-<root>.json, from signal-circuit.py
   --parts-only): its axon and dendrite arbors as points with their path
   distance from the soma, every 3 µm, and every synapse it makes and
   receives in the release, by position. A wave drawn at one path distance
   runs down every branch at once (Ames 2026-11-11: "axon animation is cool,
   it should propagate out and down all the branches"); the Synapses row
   shows them all ("synapses, can we see all 3,000?"). ── */
/** dendPaths: each dendrite tip's way in to the cell body, as indices into dend from the tip end (signal-circuit.py --paths-only). */
interface CellParts { arbor: {axon: number[][]; dend: number[][]; dendPaths?: number[][]}; syn: {out: number[][]; in: number[][]}; axonMax: number; dendMax: number; }
const parts = new Map<string, CellParts>();
const partsPending = new Map<string, Promise<CellParts | null>>();
function loadParts(root: string): Promise<CellParts | null> {
  const have = parts.get(root);
  if (have) return Promise.resolve(have);
  const pending = partsPending.get(root);
  if (pending) return pending;
  const p = fetch(`signal/cell-${root}.json`).then(r => r.ok ? r.json() : null).then((j: CellParts | null) => {
    if (j) { j.axonMax = j.arbor.axon.reduce((m, q) => Math.max(m, q[3]), 0); j.dendMax = j.arbor.dend.reduce((m, q) => Math.max(m, q[3]), 0); parts.set(root, j); }
    partsPending.delete(root);
    return j;
  }).catch(() => { partsPending.delete(root); return null; });
  partsPending.set(root, p);
  return p;
}
/** Every spike runs a wave down the whole axon, violet for an inhibitory
 *  cell, at 1.5 mm a second (Ames 2026-11-11: "visualize the purple pulse,
 *  I can't really tell when it's happening"); the sparks along the real
 *  paths still time the arrivals. */
function arborWave(key: string, inhibitory: boolean) {
  const c = cells.get(key);
  const pr = c && parts.get(c.spec.root);
  if (!pr || !pr.arbor.axon.length) return;
  // the wave runs at the model's conduction speed, so its band and the sparks along the real paths keep step
  const fast = FAST[key] ?? 1;
  waves.push({root: c!.spec.root, part: 'axon', start: performance.now() / 1000 + (fast > 1 ? 0.05 : AP_DELAY_S), seconds: clamp(pr.axonMax / (SPEED_UM_S * 1000 * fast), 0.5, 12), inward: false, rgb: inhibitory ? [0.8, 0.55, 1] : [1, 0.95, 0.7]});
}
/** Signals coming in one dendrite at a time (Ames 2026-11-11: "signals do
 *  not come in from all the dendrites at once: one signal per every fourth
 *  dendrite, in random order, slower"): a share of the cell's dendrite tips
 *  in random order, up to `cap`, each a slow pulse from the synapse farthest
 *  out on that dendrite (its tip when none is near) in to the cell body,
 *  `each` seconds on the way and `gap` seconds apart. Returns when the last
 *  lands, or 0 when the cell has no dendrite paths. */
function demoDendrites(key: string, share = 0.25, each = 2.5, gap = 0.5, cap = 10, rgb: V3 = [1, 0.95, 0.7], alive?: () => boolean): number {
  const c = cells.get(key);
  const pr = c && parts.get(c.spec.root);
  const paths = pr?.arbor.dendPaths;
  if (!c || !pr || !paths?.length) return 0;
  const pick = paths.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, clamp(Math.round(paths.length * share), 2, cap));
  const syn = pr.syn.in, dend = pr.arbor.dend, soma = c.spec.soma;
  pick.forEach((i, k) => {
    const idx = paths[i];
    let from = -1;
    for (let j = 0; j < idx.length && from < 0; j++) {
      const p = dend[idx[j]];
      if (!p) break;
      for (const q of syn) if (Math.abs(q[0] - p[0]) < 3000 && Math.abs(q[1] - p[1]) < 3000 && Math.abs(q[2] - p[2]) < 3000) { from = j; break; }
    }
    const pts = idx.slice(Math.max(0, from)).map(ii => [dend[ii][0], dend[ii][1], dend[ii][2]] as V3);
    if (pts.length < 2) return;
    pts.push(soma);
    setTimeout(() => {
      if (!active || !demo || (alive && !alive())) return;
      flashes.push({p: pts[0], at: now, life: 0.9, rgb, size: 16_000});
      sparks.push({r: route(pts), start: now, end: now + each, inhibitory: false, conn: NO_CONN, scale: 2.4});
    }, k * gap * 1000);
  });
  return (pick.length - 1) * gap + each;
}
/** A cell lit from its cell body outward (Ames 2026-11-11: "load highlight
 *  on the cells from soma outward"): the mesh beyond a radius growing from
 *  the cell body is drawn dim (the haze's `reveal`, per cell, set each
 *  frame) while waves of light run out over the axon and the dendrites at
 *  the same pace. */
interface Reveal { root: string; soma: V3; at: number; seconds: number; reach: number; }
let reveals: Reveal[] = [];
function revealCell(key: string, seconds = 1.4, rgb: V3 = [0.85, 0.97, 1]): boolean {
  const c = cells.get(key);
  const pr = c && parts.get(c.spec.root);
  const nm = nmPerUnit();
  if (!c || !pr || !nm) return false;
  if (hazeTint) {   // the mesh lit outward; without meshes (the low-poly look) the waves alone
    let reach = 0;
    for (const pts of [pr.arbor.axon, pr.arbor.dend]) for (const p of pts) reach = Math.max(reach, len(sub([p[0], p[1], p[2]], c.spec.soma)));
    reveals = reveals.filter(r => r.root !== c.spec.root);
    reveals.push({root: c.spec.root, soma: c.spec.soma, at: performance.now() / 1000, seconds, reach: reach * 1.05 + 20_000});
    if (!hazeTint.reveal) hazeTint.reveal = new Map();
    hazeTint.revealNm = [nm[0], nm[1], nm[2]];
    hazeTint.reveal.set(c.spec.root, [c.spec.soma[0] / nm[0], c.spec.soma[1] / nm[1], c.spec.soma[2] / nm[2], 5000]);   // from the first frame, only the body
  }
  demoWave(key, 'axon', seconds, false, rgb);
  demoWave(key, 'dend', seconds, false, rgb);
  return true;
}
function stepReveals() {
  if (!reveals.length) return;
  const nm = nmPerUnit(), tint = hazeTint;
  if (!nm || !tint?.reveal) { reveals = []; return; }
  const t = performance.now() / 1000;
  for (const r of reveals) {
    const q = clamp((t - r.at) / r.seconds, 0, 1);
    if (q >= 1) { tint.reveal.delete(r.root); continue; }
    tint.reveal.set(r.root, [r.soma[0] / nm[0], r.soma[1] / nm[1], r.soma[2] / nm[2], Math.max(5000, r.reach * q)]);
  }
  reveals = reveals.filter(r => t < r.at + r.seconds);
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}
function clearReveals() { reveals = []; hazeTint?.reveal?.clear(); }
/** A target's firing: a gold burst from its cell body, sparks flying out,
 *  a ring widening, the body lit (Ames 2026-11-11: "the gold cell needs to
 *  glow gold or sparkle from soma when you successfully activate it"). */
interface Burst { p: V3; dirs: V3[]; at: number; life: number; rgb: V3; sparkle?: boolean; scale?: number; }
let bursts: Burst[] = [];
/** A sparkle from a cell body as it fires: particles flying out and slowing,
 *  each with its own glint (Ames 2026-11-11: "I want particle sparkle from
 *  the soma when cell sends AP"). Every spike has one; a target's firing has
 *  its burst besides. */
function sparkleAt(p: V3, rgb: V3, count = 28, scale = 1) {
  const dirs: V3[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = 0.45 + Math.random() * 1.1;
    dirs.push([r * Math.cos(th) * sp, r * Math.sin(th) * sp, u * sp]);
  }
  bursts.push({p, dirs, at: performance.now() / 1000, life: 1.1, rgb, sparkle: true, scale});
}
function burstAt(p: V3, rgb: V3) {
  const dirs: V3[] = [];
  for (let i = 0; i < 36; i++) { const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u); dirs.push([r * Math.cos(th), r * Math.sin(th), u]); }
  bursts.push({p, dirs, at: performance.now() / 1000, life: 1.3, rgb});
}
/** A wave of light over an arbor: out from the soma down every branch of
 *  the axon, or in from the dendrites' tips to the soma. */
interface Wave { root: string; part: 'axon' | 'dend'; start: number; seconds: number; inward: boolean; rgb: V3; }
let waves: Wave[] = [];
function demoWave(key: string, part: 'axon' | 'dend', seconds: number, inward: boolean, rgb: V3): boolean {
  const c = cells.get(key);
  const pr = c && parts.get(c.spec.root);
  if (!pr || !pr.arbor[part].length) return false;
  waves.push({root: c!.spec.root, part, start: performance.now() / 1000, seconds, inward, rgb});
  return true;
}

/* ── a message as a glitch in the hologram: a small card that bursts in by
   the cell it is about (else at the top of the free part of the view),
   holds, and fades (Ames 2026-11-11: "error message should be more like a
   glitch in the hologram as a popup"). ── */
interface Pop { el: HTMLElement; p: V3 | null; until: number; }
let pops: Pop[] = [];
function popup(text: string, seconds: number, at?: string) {
  if (!active) return;
  const c = at ? cells.get(at) : undefined;
  for (const o of pops) if (o.el.textContent === text) o.el.remove();   // the same line again: once
  pops = pops.filter(o => o.el.isConnected);
  const el = document.createElement('div');
  el.className = 'ng-extend nge-sig-pop';
  el.textContent = text;
  if (c) el.style.setProperty('--c', `rgb(${c.color.join(',')})`);
  document.body.appendChild(el);
  pops.push({el, p: c?.spec.soma ?? null, until: performance.now() + seconds * 1000});
}
function placePops() {
  if (!pops.length) return;
  const t = performance.now();
  const r = threeDPanel()?.element?.getBoundingClientRect?.(), hud = panel?.getBoundingClientRect();
  for (const o of pops) {
    if (t > o.until) { o.el.classList.add('nge-sig-pop--out'); if (t > o.until + 400) o.el.remove(); continue; }
    if (!r) continue;
    const s = o.p ? toScreen(o.p) : null;
    const w = o.el.offsetWidth, h = o.el.offsetHeight;
    let x: number, y: number;
    if (s) { x = s[0] - w / 2; y = s[1] - 70 - h; }
    else { const left = sideHud() && hud ? hud.right + 12 : r.left; x = (left + r.right) / 2 - w / 2; y = r.top + 56; }
    if (hud && sideHud()) x = Math.max(x, hud.right + 8); else if (hud) y = Math.min(y, hud.top - h - 8);
    const card = document.querySelector('.nge-sig-scan-box')?.getBoundingClientRect();
    if (card && x < card.right + 8 && x + w > card.left - 8 && y < card.bottom + 8 && y + h > card.top - 8) y = card.bottom + 12;
    x = clamp(x, r.left + 8, r.right - w - 8); y = clamp(y, r.top + 8, r.bottom - h - 8);
    o.el.style.left = `${x}px`; o.el.style.top = `${y}px`;
  }
  pops = pops.filter(o => o.el.isConnected);
}
function clearPops() { for (const o of pops) o.el.remove(); pops = []; }

/* ── Ames's edits: the tour's lines and the objective can be rewritten in
   place (the ✎ on a box), kept in this browser and copied out as JSON to
   be baked in (Ames 2026-11-11: "BE SPECIFIC, give me an edit button for
   these boxes"). ── */
let copyEdits: Record<string, string> = {};
try { copyEdits = JSON.parse(localStorage.getItem('pyr.signal.copy') || '{}'); } catch { copyEdits = {}; }
const copyOf = (key: string, fallback: string) => copyEdits[key] ?? fallback;
function saveCopy(key: string, text: string) {
  if (!text.trim()) delete copyEdits[key]; else copyEdits[key] = text.trim();
  try { localStorage.setItem('pyr.signal.copy', JSON.stringify(copyEdits)); } catch { /* not kept */ }
}
/** The editor: one ✎ in the HUD's head opens a card with a section for each
 *  box on the page (the objective, the tour's current step); a change is
 *  kept as it is typed and shows at once (Ames 2026-11-11: "one edit pencil
 *  for the whole page that has sections for each box"). */
let editorEl: HTMLElement | null = null;
function toggleEditor() {
  if (editorEl) { editorEl.remove(); editorEl = null; return; }
  editorEl = document.createElement('div');
  editorEl.className = 'ng-extend nge-sig-editor';
  document.body.appendChild(editorEl);
  refreshEditor();
}
function applyCopy(key: string) {
  if (key === `obj.${levelIndex}`) els.obj.textContent = copyOf(key, level.objective);
  else if (key === `detail.${levelIndex}`) { const t = adapt(copyOf(key, level.detail)); els.detail.textContent = t; els.detail.style.display = t ? '' : 'none'; }
  else if (key === `tour.${levelIndex}.${tourAt}.text`) { const el = els.body.querySelector('.nge-sig-tour-text'); if (el) el.textContent = adapt(copyOf(key, tourSteps[tourAt]?.text ?? '')); }
  else if (key === `tour.${levelIndex}.${tourAt}.sub`) { const el = els.body.querySelector('.nge-sig-tour-sub'); if (el) el.textContent = adapt(copyOf(key, tourSteps[tourAt]?.sub ?? '')); }
}
function refreshEditor() {
  if (!editorEl) return;
  const field = (key: string, label: string, fallback: string) => `<label><span>${label}</span><textarea data-key="${key}" rows="2">${esc(copyOf(key, fallback))}</textarea></label>`;
  let sections = `<section><h4>Objective</h4>${field(`obj.${levelIndex}`, 'Objective', level.objective)}${field(`detail.${levelIndex}`, 'Under it', level.detail)}</section>`;
  const st = phase === 'brief' && tourSteps.length ? tourSteps[tourAt] : null;
  if (st) sections += `<section><h4>Step ${tourAt + 1} · ${esc(st.kicker)}</h4>${field(`tour.${levelIndex}.${tourAt}.text`, 'Line', st.text)}${st.sub !== undefined ? field(`tour.${levelIndex}.${tourAt}.sub`, 'Under it', st.sub) : ''}</section>`;
  editorEl.innerHTML = `<div class="head"><b>Edit the words</b><button type="button" class="nge-sig-x" aria-label="Close">${X_SVG}</button></div>${sections}
    <div class="nge-sig-row"><button class="nge-sig-quiet" type="button" data-act="copy">Copy my edits</button><button class="nge-sig-quiet" type="button" data-act="reset">Reset this level</button></div>
    <section><h4>View</h4><div class="nge-sig-row"><button class="nge-sig-quiet" type="button" data-act="view" title="The camera's look point, zoom and turn, for a step to use">Copy view</button></div></section>
    <p class="hint">Edits live in this browser. Copy them, or the view, and paste them to Claude to bake them in.</p>`;
  (editorEl.querySelector('.nge-sig-x') as HTMLButtonElement).onclick = () => toggleEditor();
  editorEl.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(t => {
    t.oninput = () => { saveCopy(t.dataset.key!, t.value); applyCopy(t.dataset.key!); };
    t.onkeydown = e => e.stopPropagation();
  });
  editorEl.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => {
    b.onclick = async () => {
      if (b.dataset.act === 'copy') {
        const text = JSON.stringify(copyEdits, null, 2);
        try { await navigator.clipboard.writeText(text); say('Your edits are copied. Paste them to Claude to bake them in.', 3.5); } catch { say(text, 8); }
      } else if (b.dataset.act === 'view') {
        const v = viewerNow(), nm = nmPerUnit();
        if (!v || !nm) return;
        const look = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => Math.round(x * nm[i]));
        const o = v.perspectiveNavigationState?.pose?.orientation?.orientation;
        const text = JSON.stringify({level: levelIndex + 1, step: phase === 'brief' ? tourAt + 1 : null, view, look, scale: Math.round(v.projectionScale.value), orientation: o ? Array.from(o as Float32Array).map(x => Math.round(x * 10_000) / 10_000) : null});
        try { await navigator.clipboard.writeText(text); say('The view is copied. Paste it to Claude.', 3); } catch { say(text, 8); }
      } else {
        for (const k of Object.keys(copyEdits)) if (k === `obj.${levelIndex}` || k === `detail.${levelIndex}` || k.startsWith(`tour.${levelIndex}.`)) delete copyEdits[k];
        saveCopy('', '');
        for (const k of [`obj.${levelIndex}`, `detail.${levelIndex}`, `tour.${levelIndex}.${tourAt}.text`, `tour.${levelIndex}.${tourAt}.sub`]) applyCopy(k);
        refreshEditor();
      }
    };
  });
}

/* ── the intro tour: level 1 opens as a cinematic (Ames 2026-11-11: "make
   the text more like an interactive tour… as little text as possible"):
   Neuron 101 on the gold cell (dendrites in, cell body, axon out), the ship
   at the gold cell, its four drivers lit in turn, a spark run down an axon,
   one spike leaking and two adding up to a firing, why E1, the scan, then
   Begin. Each step plays on the cells themselves (the model runs during the
   tour, `demo`, with the coach and the scoring held off) and waits for
   Next. After Begin the play UI comes up with its controls named, then
   three, two, one, go. ── */
/** click: what a click on a cell does during the step; the scan unless 'spark'. html: a figure under the words. */
interface TourStep { kicker: string; text: string; sub?: string; html?: string; click?: 'spark'; play?: (alive: () => boolean) => Promise<void>; }
/** The parts of a neuron, colour-coded as the labels in the view and the
 *  signals are: dendrites gold, the cell body pale gold, the axon cyan. */
const DENDRITE_C = '#c678ff', SOMA_C = '#fff0c2', AXON_C = '#4fb0ff';   // purple dendrites, a blue axon (Ames 2026-11-12: "not orange and blue")
/** The key to the parts painted on the cell in Neuron 101 (the cartoon it
 *  replaces: Ames 2026-11-12, "this is so ugly, we have to do better or remove it"). */
const PARTS_KEY = `<p class="nge-sig-parts"><span style="--c:${DENDRITE_C}">Dendrites</span><span style="--c:${SOMA_C}">Cell body</span><span style="--c:${AXON_C}">Axon</span></p>`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
let demo = false;          // the model runs outside play, for the tour's demonstrations
let tourAt = 0, tourToken = 0;
let tourLabels: {el: HTMLElement; p: V3}[] = [];
function tourLabel(text: string, p: V3, color?: string) {
  const el = document.createElement('span');
  el.className = 'ng-extend nge-sig-label';
  el.textContent = text;
  if (color) { el.style.color = color; el.style.borderColor = color; }
  el.style.display = 'none';
  document.body.appendChild(el);
  tourLabels.push({el, p});
  requestAnimationFrame(() => el.classList.add('nge-sig-label--in'));
}
function clearTourLabels() { for (const l of tourLabels) l.el.remove(); tourLabels = []; }
function placeTourLabels() {
  if (!tourLabels.length) return;
  const r = threeDPanel()?.element?.getBoundingClientRect?.();
  for (const l of tourLabels) {
    const s = toScreen(l.p);
    if (!s || !r || s[0] < r.left || s[0] > r.right || s[1] < r.top || s[1] > r.bottom) { l.el.style.display = 'none'; continue; }
    l.el.style.display = '';
    l.el.style.left = `${s[0]}px`; l.el.style.top = `${s[1]}px`;
  }
}
/** A spark from the ship at a cell, as the player's would be. */
function demoSpark(key: string) { fireAt(key, false, true); }
/** An Inhibit from the ship at a cell: the violet ribbon, the cell quiet for a while (or its shield's answer). */
function demoHush(key: string) { fireAt(key, true, true); }
const NO_CONN = {} as CircuitConn;   // a spark with no edge on the map
/** A pulse of light along a path, over so many seconds. */
function demoPulse(path: V3[], seconds: number) {
  sparks.push({r: route(path), start: now, end: now + seconds, inhibitory: false, conn: NO_CONN});
}
/** What the tour clears between steps: labels, lit cells, the ship's visit, the camera. */
/** The tour's slow turn around a cell: radians a second about the view's up. */
let orbit = 0;
function stepOrbit(dt: number, cam: {right: V3; up: V3; toEye: V3}) {
  if (!orbit) return;
  const nm = nmPerUnit(), o = viewerNow()?.perspectiveNavigationState?.pose?.orientation;
  if (!nm || !o?.orientation) return;
  const axis = norm([cam.up[0] / nm[0], cam.up[1] / nm[1], cam.up[2] / nm[2]]);
  const r = quat.setAxisAngle(quat.create(), axis, orbit * dt);
  quat.multiply(o.orientation, r, o.orientation);
  quat.normalize(o.orientation, o.orientation);
  o.changed.dispatch();
}
/** The cells the tour has faded, to look at one. */
let tourDim = new Set<string>();
function dimOthers(key: string) {
  for (const c of cells.values()) if (c.shown && c.key !== key) { tourDim.add(c.key); paint(c, true); }
}
function undim(key: string) {
  const c = cells.get(key);
  if (c?.shown && tourDim.has(key)) { tourDim.delete(key); if (now >= c.hushedUntil) paint(c, false); }
}
function undimAll() {
  for (const k of tourDim) { const c = cells.get(k); if (c?.shown && now >= c.hushedUntil) paint(c, false); }
  tourDim.clear();
}
function tourReset() { clearTourLabels(); hints = new Set(); endVisit(); if (!userCam) glideHome(); orbit = 0; undimAll(); lightWhole([]); clearReveals(); hidePartsTint(); }
let tourSteps: TourStep[] = [];
const TOURS: Record<number, TourStep[]> = {};
TOURS[0] = [
  // The gold cell first, whole, the others grey, a sweep of light down it;
  // the ship goes and lands on it (Ames 2026-11-11: "this should be step 1").
  {kicker: 'A real neuron', text: 'A real pyramidal cell, from a mouse’s brain. Your target.',
    play: async alive => {
      dimOthers('T');
      await sleep(300); if (!alive()) return;
      const t = cells.get('T');
      if (!t) return;
      revealCell('T', 1.6, [1, 0.95, 0.75]);
      const s = toScreen(t.spec.soma), r = threeDPanel()?.element?.getBoundingClientRect?.();
      visit = {key: 'T', since: now, lean: s && r && s[0] > r.left + r.width / 2 ? -1 : 1, fired: true};   // the ship goes and lands; no card
      if (view === 'cockpit') glideTo(t, 0.7);
      hints = new Set(['T']);
    }},
  // The gold cell alone, close up (Ames 2026-11-11: "start with just the
  // gold cell and the others grey, then you can add them"). The labels sit
  // on its own parts: "dendrites" a third of the way along its longest
  // dendrite path from the synapse end, clear of the other cell bodies;
  // "axon" a third of the way down its axon. The signals come in one
  // dendrite at a time, slowly, from synapses far out (Ames 2026-11-11:
  // "signals do not come in from all the dendrites at once: one signal per
  // every fourth dendrite, in random order, slower").
  {kicker: 'Neuron 101', text: 'Signals come in through the dendrites. The cell body adds them up. With enough, a spike leaves down the axon.', sub: 'That spike is an action potential. It runs one way only.', html: PARTS_KEY,
    play: async alive => {
      const t = cells.get('T');
      if (!t) return;
      dimOthers('T');
      if (!parts.get(t.spec.root)) await loadParts(t.spec.root);
      if (!alive()) return;
      showPartsTint('T');   // its dendrites coral and its axon cyan, on the cell itself
      const inConn = conns.filter(k => k.post === 'T' && k.dendrite.length > 1).sort((a, b) => b.dendriteUm - a.dendriteUm)[0];
      const inPath = inConn?.dendrite;                                                 // a synapse to the cell body
      const outPath = conns.find(k => k.pre === 'T' && k.axon.length > 1)?.axon;      // the cell body to a synapse
      glideTo(t, 0.45);
      await sleep(900); if (!alive()) return;
      if (inPath) tourLabel('dendrites', inPath[Math.floor(inPath.length * 0.35)], DENDRITE_C);
      await sleep(500); if (!alive()) return;
      const landing = demoDendrites('T', 0.25, 2.5, 0.5, 10, [1, 0.95, 0.7], alive);
      if (!landing && !demoWave('T', 'dend', 2.4, true, [1, 0.95, 0.7]) && inPath) demoPulse(inPath, 2.2);
      // the camera draws back slowly as the signals come in, until the whole
      // cell is in view for the spike and the axon (Ames 2026-11-11: "when I
      // hit play do a slow camera zoom out"; "zoom out to here")
      glideWhole(t, Math.max(4, (landing || 2.4) + 1.5));
      await sleep((landing || 2.4) * 1000 + 150); if (!alive()) return;
      tourLabel('cell body', t.spec.soma, SOMA_C);
      flashes.push({p: t.spec.soma, at: now, life: 0.7, rgb: [1, 0.85, 0.4], size: 24_000});
      sparkleAt(t.spec.soma, [1, 0.9, 0.5], 44, 1.4);
      sfx.spike(false);
      await sleep(500); if (!alive()) return;
      if (outPath) tourLabel('axon', outPath[Math.floor(outPath.length * 0.35)], AXON_C);
      // the spike runs out at the model's conduction speed, in the axon's colour
      const axonS = clamp((parts.get(t.spec.root)?.axonMax ?? 0) / (SPEED_UM_S * 1000), 3, 8);
      if (!demoWave('T', 'axon', axonS, false, [0.7, 0.95, 1]) && outPath) demoPulse(outPath, 2.6);
    }},
  // one driver at a time, whole, lit from its cell body outward; the gold
  // cell and the rest grey; then all of them (Ames 2026-11-11: "step through
  // these 1 at a time, dim the yellow and show these full cells"; "I want to
  // see all the branches when they are highlighted"; "load highlight on the
  // cells from soma outward")
  {kicker: 'Its drivers', text: 'Four cells drive it: E1, E2, E3, E4. E is for excitatory.',
    play: async alive => {
      const all = ['E1', 'E2', 'E3', 'E4'];
      for (const k of all) {
        for (const c of cells.values()) if (c.shown && c.key !== k) { tourDim.add(c.key); paint(c, true); }
        undim(k);
        lightWhole([k]);
        hints = new Set([k]);
        const c = cells.get(k);
        if (!revealCell(k, 1.4) && c) flashes.push({p: c.spec.soma, at: now, life: 0.6, rgb: [0.8, 0.95, 1], size: 18_000});
        sfx.scan();
        await sleep(1900); if (!alive()) return;
      }
      undimAll();
      lightWhole(all);
      hints = new Set(all);
    }},
  // From here a click on a cell is the spark itself, not the scan (Ames
  // 2026-11-11: "this should not fly the ship over, it should do the photon
  // beam to activate the cell").
  {kicker: 'Spark', text: 'Spark a cell: its spike runs down the axon to the gold cell.', click: 'spark',
    play: async alive => { lightWhole(['E1']); await sleep(400); if (!alive()) return; hints = new Set(['E1']); demoSpark('E1'); }},
  {kicker: 'Add up', text: 'One spike alone leaks away. Two spikes close together add up and make the gold cell spike.', click: 'spark',
    play: async alive => {
      lightWhole(['E1']);
      await sleep(400); if (!alive()) return;
      demoSpark('E1');
      await sleep(2600); if (!alive()) return;   // the one spike's charge leaks away
      demoSpark('E1');
      await sleep(320); if (!alive()) return;
      demoSpark('E1');
    }},
  {kicker: 'Why E1', text: 'E1 makes five synapses onto the gold cell, the most. Two quick sparks from E1 add up past its threshold. E2 needs three, E3 five, and E4 alone can never do it: pair it with another driver.', click: 'spark',
    play: async alive => { lightWhole(['E1']); await sleep(100); if (alive()) hints = new Set(['E1']); }},
  {kicker: 'Scan', text: 'Click any cell to scan it. The letters are call signs: E excitatory, I inhibitory, T target.',
    play: async alive => { await sleep(300); if (alive()) scan('E2'); }},
  {kicker: 'Ready', text: 'Spike the gold cell three times: E1 twice, quickly, each time. Like this.', click: 'spark',
    play: async alive => {
      lightWhole(['E1']);
      hints = new Set(['E1']);
      await sleep(700); if (!alive()) return;
      demoSpark('E1'); await sleep(320); if (!alive()) return; demoSpark('E1');
    }},
];
/* Level 2 (Ames 2026-11-11: "each level that introduces more has a cinematic
   tour: here it should fly to Martinotti, fade others, Martinotti spinning,
   loads in some stats in the ship hologram, any visualizations on cell;
   animate the gold cell firing, the purple AP reaching it and it stops"). */
TOURS[1] = [
  {kicker: 'The Gatekeeper', text: 'A new cell, in purple: a Martinotti cell, the Gatekeeper. It inhibits the gold cell, through 17 synapses.',
    play: async alive => {
      const g = cells.get('I1');
      if (!g) return;
      dimOthers('I1');
      lightWhole(['I1']);
      revealCell('I1', 1.6, [0.9, 0.8, 1]);
      glideTo(g, 0.55);
      orbit = 0.22;
      await sleep(700); if (!alive()) return;
      scan('I1');
      await sleep(2600); if (!alive()) return;
      if (scanKey === 'I1') toggleShow('axon');
    }},
  // Only the gold cell and the purple one, the rest grey. The gold cell keeps
  // firing: excitation lands on synapses far out on its dendrites and runs in
  // to the cell body, it fires, the spike runs out down every branch of its
  // axon. When the Gatekeeper fires (on its own clock, every 4.2 s, its
  // pulse running down every branch of its axon too), the gold cell stops
  // and wears the violet until the hold leaks away (Ames 2026-11-11: "show
  // only the gold cell and the purple cell, period… the animation can start
  // from various synapses that are found on its dendrites, preferably ones
  // that are farther away from the soma… when the purple cell fires, the
  // yellow cell stops pulsing and has some purple glow around it").
  {kicker: 'The pulse', text: 'Every 4 seconds it pulses, stopping the gold target cell.', sub: 'Violet while it is held; gold again when it can be excited.',
    play: async alive => {
      const t = cells.get('T'), g = cells.get('I1');
      if (!t || !g) return;
      for (const c of cells.values()) if (c.shown && c.key !== 'T' && c.key !== 'I1') { tourDim.add(c.key); paint(c, true); }
      lightWhole(['I1']);
      hints = new Set(['T']);
      const pr = parts.get(t.spec.root) ?? await loadParts(t.spec.root);
      if (!alive()) return;
      // the synapses onto it farthest from the cell body, a quarter of them
      const far = pr ? pr.syn.in.map(q => ({p: [q[0], q[1], q[2]] as V3, d: len(sub([q[0], q[1], q[2]], t.spec.soma))})).sort((a, b) => b.d - a.d).slice(0, Math.max(20, Math.floor(pr.syn.in.length / 4))) : [];
      while (alive()) {
        if (holdOn(t) > 0.3) { await sleep(120); continue; }   // held: it stays quiet, in violet (the Gatekeeper's own spike ran its wave)
        // one dendrite at a time, from synapses far out; the whole-tree wave when the cell has no dendrite paths
        let landing = demoDendrites('T', 0.2, 2.0, 0.4, 5, [1, 0.9, 0.55], alive);   // unhurried (Ames 2026-11-11: "slow the pulse")
        if (!landing) {
          for (let i = 0; i < 6 && far.length; i++) { const q = far[Math.floor(Math.random() * far.length)]; flashes.push({p: q.p, at: now, life: 0.55, rgb: [1, 0.9, 0.5], size: 7000}); }
          demoWave('T', 'dend', 0.9, true, [1, 0.9, 0.55]);
          landing = 0.9;
        }
        await sleep(landing * 1000); if (!alive()) return;
        if (holdOn(t) > 0.3) continue;
        spike('T');   // its own wave runs out down the axon at the conduction speed
        await sleep(3000);
      }
    }},
  {kicker: 'Ready', text: 'Use the partner cells to spike the gold cell in the gaps: not while the Gatekeeper is inhibiting it. The coach line turns blue when a gap opens.', click: 'spark'},
];
/* Level 3: the Hush, shown with the ship (Ames 2026-11-11: "visualize the
   hush sequence using the ship and animations"): the Gatekeeper on its fast
   clock, the violet beam quieting it, the sparks into the quiet. */
const dimTo = (keep: string[]) => { for (const c of cells.values()) if (c.shown && !keep.includes(c.key)) { tourDim.add(c.key); paint(c, true); } };
TOURS[2] = [
  {kicker: 'No gaps', text: 'The Gatekeeper pulses every second now. The gaps are gone.',
    play: async alive => { dimTo(['T', 'I1']); lightWhole(['I1']); hints = new Set(['I1']); await sleep(50); if (!alive()) return; }},
  {kicker: 'The Inhibit beam', text: 'A new beam: Inhibit. It quiets a cell for 2.5 seconds, for 2 charges.',
    play: async alive => {
      dimTo(['T', 'I1']);
      lightWhole(['I1']);
      hints = new Set(['I1']);
      await sleep(700); if (!alive()) return;
      demoHush('I1');
    }},
  {kicker: 'Into the quiet', text: 'While it is quiet, spike the gold cell: E1 twice, quickly.',
    play: async alive => {
      dimTo(['T', 'I1', 'E1']);
      lightWhole(['I1', 'E1']);
      hints = new Set(['I1']);
      await sleep(400); if (!alive()) return;
      demoHush('I1');
      await sleep(800); if (!alive()) return;
      hints = new Set(['E1']);
      demoSpark('E1'); await sleep(320); if (!alive()) return; demoSpark('E1');
    }},
  {kicker: 'Ready', text: 'Inhibit the Gatekeeper, then spike the gold cell through its partners. Three times.', click: 'spark'},
];
/** The tour step from which the map shows (level 1 keeps it until the drivers are introduced). */
const MAP_FROM: Record<number, number> = {0: 2, 1: 2, 2: 3, 3: 2, 4: 1, 5: 2, 6: 1, 7: 1, 8: 2};   // the cell first, the diagram later (Ames 2026-11-12)
/* Level 6: the Clipper, its clip, and the way past it. */
TOURS[5] = [
  {kicker: 'The Clipper', text: 'A basket cell, B1, in pink: fast, and wired to the gold cell’s body. E1 wakes it with 10 synapses, and its inhibition lands right after E1’s own excitation.',
    play: async alive => {
      dimTo(['T', 'E1', 'B1']); lightWhole(['B1']); hints = new Set(['B1']);
      const b = cells.get('B1');
      if (b) glideTo(b, 0.7);
      revealCell('B1', 1.4, [1, 0.6, 0.8]);
      const k = conns.find(x => x.pre === 'B1' && x.post === 'T');
      if (k) showGems(k.synapses, '#ff7eb6');
      await sleep(1800); if (!alive()) return;
      demoSpark('E1'); await sleep(400); if (!alive()) return; demoSpark('E1');   // clipped
    }},
  {kicker: 'Past it', text: 'E2 does not wake the Clipper. Spark E2 first, then E1 a beat later: both land before the clip, and the gold cell fires.',
    play: async alive => {
      dimTo(['T', 'E1', 'E2', 'B1']); hints = new Set(['E2', 'E1']);
      await sleep(600); if (!alive()) return;
      demoSpark('E2'); await sleep(450); if (!alive()) return; demoSpark('E1');
    }},
  {kicker: 'Ready', text: 'Spike the gold cell three times: E2, then E1 half a second later, each time.', click: 'spark'},
];
/* Level 7: not enough alone, enough together. */
TOURS[6] = [
  {kicker: 'Not enough', text: 'E1 is gone. E2, E3 and E4 carry 4, 3 and 2 synapses. Two E3 sparks: the charge falls short.',
    play: async alive => {
      dimTo(['T', 'E3']); hints = new Set(['E3']);
      await sleep(600); if (!alive()) return;
      demoSpark('E3'); await sleep(400); if (!alive()) return; demoSpark('E3');
    }},
  {kicker: 'All at once', text: 'E2, E3 and E4 together: 4 + 3 + 2, and the gold cell fires.',
    play: async alive => {
      dimTo(['T', 'E2', 'E3', 'E4']); hints = new Set(['E2', 'E3', 'E4']);
      await sleep(600); if (!alive()) return;
      demoSpark('E2'); demoSpark('E3'); demoSpark('E4');
    }},
  {kicker: 'Ready', text: 'Three times: the three drivers together, each time.', click: 'spark'},
];
/* Level 8: the beat. */
TOURS[7] = [
  {kicker: 'The beat', text: 'The Gatekeeper pulses every 1.6 seconds. Every pulse holds the gold cell for a moment; between them is a gap.',
    play: async alive => { dimTo(['T', 'I1']); lightWhole(['I1']); hints = new Set(['I1']); await sleep(50); if (!alive()) return; }},
  {kicker: 'Ready', text: 'Spike the gold cell in three gaps in a row: E1 twice in each. Miss a gap, and the count starts over.', click: 'spark'},
];
/* Level 9: a weak synapse learns. */
TOURS[8] = [
  {kicker: 'Weak', text: 'E4 makes 2 synapses onto the gold cell. Three quick sparks: still not enough.',
    play: async alive => {
      dimTo(['T', 'E4']); hints = new Set(['E4']);
      await sleep(600); if (!alive()) return;
      demoSpark('E4'); await sleep(400); if (!alive()) return; demoSpark('E4'); await sleep(400); if (!alive()) return; demoSpark('E4');
    }},
  {kicker: 'Pair it', text: 'Spark E4, then E1 twice. The gold cell fires with E4’s spike just landed, and E4’s synapses grow: cells that fire together wire together.',
    play: async alive => {
      dimTo(['T', 'E1', 'E4']); hints = new Set(['E4', 'E1']);
      await sleep(600); if (!alive()) return;
      demoSpark('E4'); await sleep(500); if (!alive()) return; demoSpark('E1'); await sleep(400); if (!alive()) return; demoSpark('E1');
    }},
  {kicker: 'Ready', text: 'Pair E4 with E1 until its synapses have grown, then spark E4 alone, three times quickly. Twice.', click: 'spark'},
];
/* Level 4 (Ames 2026-11-11: "Do we maybe need a demo here? This got a lot
   more complicated"): the shield, the Key, the second target. */
TOURS[3] = [
  {kicker: 'The shield', text: 'The Gatekeeper pulses every second now, and its shield blocks your Inhibit beam.',
    play: async alive => {
      dimTo(['T', 'I1']); lightWhole(['I1']); hints = new Set(['I1']);
      await sleep(900); if (!alive()) return;
      demoHush('I1');   // the shield answers
    }},
  {kicker: 'The Key', text: 'I2, in magenta, is a bipolar cell. It makes 20 synapses onto the Gatekeeper and has the power to stop (inhibit) it.',
    play: async alive => {
      const k = conns.find(x => x.pre === 'I2' && x.post === 'I1');
      dimTo(['I2', 'I1']); lightWhole(['I2', 'I1']); hints = new Set(['I2']);
      const key = cells.get('I2');
      if (key) glideTo(key, 0.7);
      revealCell('I2', 1.4, [1, 0.65, 1]);
      if (k) showGems(k.synapses, '#ff8fd1');
      await sleep(1800); if (!alive()) return;
      demoSpark('I2');
    }},
  {kicker: 'Two targets', text: 'E4 is a second target, in gold too, with its own drivers: F1, F2 and F3.',
    play: async alive => {
      dimTo(['E4', 'F1', 'F2', 'F3']); lightWhole(['E4']); hints = new Set(['F1', 'F2', 'F3']);
      revealCell('E4', 1.4, [1, 0.95, 0.75]);
      await sleep(50); if (!alive()) return;
    }},
  {kicker: 'Ready', text: 'Spark the Key first. Then E1 twice for the gold cell, and F1, F2 and F3 for E4, within 2 seconds of each other. Twice.', click: 'spark'},
];
/* Level 5: the chain, S to the Key to the Gatekeeper, and two targets in sync. */
TOURS[4] = [
  {kicker: 'A chain', text: 'S, a layer 2/3 pyramidal cell, sits above the circuit. It drives the Key with 10 synapses, and the Key quiets the Gatekeeper: a chain of three.',
    play: async alive => {
      dimTo(['S', 'I2', 'I1']); lightWhole(['S', 'I2', 'I1']); hints = new Set(['S']);
      const sc = cells.get('S');
      if (sc) glideTo(sc, 0.8);
      revealCell('S', 1.4, [0.8, 0.9, 1]);
      await sleep(1800); if (!alive()) return;
      demoSpark('S');
    }},
  {kicker: 'In sync', text: 'Two targets, five drivers: E1 and E2 for the gold cell, F1, F2 and F3 for E4. Land both within a quarter second of each other.',
    play: async alive => {
      dimTo(['T', 'E4', 'E1', 'E2', 'F1', 'F2', 'F3']); lightWhole(['T', 'E4']); hints = new Set(['E1', 'E2', 'F1', 'F2', 'F3']);
      await sleep(50); if (!alive()) return;
    }},
  {kicker: 'Ready', text: 'Spark S, then all five drivers together. Three times.', click: 'spark'},
];
function showTour(steps: TourStep[]) {
  panel?.classList.add('nge-sig--intro');
  tourSteps = steps;
  phase = 'brief'; demo = true;
  els.row.style.display = 'none';
  buildMap();
  tourAt = 0;
  renderTourStep();
}
/** A step's figure: open the first time it is seen in this browser, folded
 *  after that behind "Diagram" (Ames 2026-11-12: "show the diagram just one
 *  time then collapse it"). */
function figureHtml(html: string): string { return `<div class="nge-sig-fig">${html}</div>`; }
function renderTourStep() {
  const step = tourSteps[tourAt], last = tourAt === tourSteps.length - 1;
  tourReset();
  // the map joins once the drivers are introduced (Ames 2026-11-11: "we don't need this in every box")
  els.map.style.display = tourAt >= (MAP_FROM[levelIndex] ?? 0) ? '' : 'none';
  const textKey = `tour.${levelIndex}.${tourAt}.text`, subKey = `tour.${levelIndex}.${tourAt}.sub`;
  els.body.innerHTML = `<div class="nge-sig-card nge-sig-tour"><div class="nge-sig-tour-kicker"><i></i>${tourAt + 1} / ${tourSteps.length} · ${step.kicker}</div>
    <p class="nge-sig-tour-text" data-copy="${textKey}">${adapt(copyOf(textKey, step.text))}</p>${step.sub ? `<p class="nge-sig-tour-sub" data-copy="${subKey}">${adapt(copyOf(subKey, step.sub))}</p>` : ''}${step.html ? figureHtml(step.html) : ''}
    <div class="nge-sig-row">${tourAt ? `<button class="nge-sig-quiet nge-sig-ico" type="button" data-act="back" title="Back" aria-label="Back">${BACK_SVG}</button>` : ''}<button class="nge-sig-go" type="button" data-act="next"><span class="nge-sig-plate">${last ? 'Begin ›' : 'Next ›'}</span></button>${step.play ? `<button class="nge-sig-quiet nge-sig-ico" type="button" data-act="replay" title="Replay" aria-label="Replay">${REPLAY_SVG}</button>` : ''}</div></div>`;
  els.body.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => {
    b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'skip') { tourAt = tourSteps.length - 1; renderTourStep(); }
      else if (act === 'back') { tourAt = Math.max(0, tourAt - 1); renderTourStep(); }
      else if (act === 'replay') renderTourStep();
      else if (last) beginPlay();
      else { tourAt++; renderTourStep(); }
    };
  });
  refreshEditor();
  const token = ++tourToken;
  void step.play?.(() => token === tourToken && active && phase === 'brief');
  updateHud();
}

function showBrief() {
  const steps = TOURS[levelIndex];
  if (steps) { showTour(steps); return; }
  panel?.classList.add('nge-sig--intro');
  tourSteps = [];
  phase = 'brief'; demo = false;
  els.row.style.display = 'none';
  buildMap();
  els.map.style.display = '';
  els.body.innerHTML = `<div class="nge-sig-card">${adapt(level.brief).split('\n').map(p => `<p>${p}</p>`).join('')}
    <button class="nge-sig-go" type="button"><span class="nge-sig-plate">Begin ›</span></button></div>`;
  (els.body.querySelector('.nge-sig-go') as HTMLButtonElement).onclick = () => beginPlay();
  updateHud();
}

function showResult(won: boolean) {
  phase = 'done';
  els.row.style.display = 'none';
  const stars = won ? (chargesUsed <= level.par ? 3 : chargesUsed <= level.par * 1.6 ? 2 : 1) : 0;
  const next = levelIndex + 1 < LEVELS.length;
  els.body.innerHTML = `<div class="nge-sig-card"><div class="nge-sig-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
    <p>${won ? `Signal delivered in ${chargesUsed} charge${chargesUsed === 1 ? '' : 's'} (par ${level.par}; a spark costs one, a hush two).` : 'Time’s up. The circuit held.'}</p>
    <div class="nge-sig-row">${won && next ? '<button class="nge-sig-go" type="button" data-act="next"><span class="nge-sig-plate">Next level ›</span></button>' : ''}
      ${won ? '<button class="nge-sig-quiet" type="button" data-act="again">Play it again</button>' : '<button class="nge-sig-go" type="button" data-act="again"><span class="nge-sig-plate">Try again ›</span></button>'}
      ${won && !next ? '<span style="color:#ffd98a">That is every level so far. More circuits are coming.</span>' : ''}</div></div>`;
  els.body.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => {
    b.onclick = () => { if (b.dataset.act === 'next') void startLevel(levelIndex + 1); else void startLevel(levelIndex); };
  });
  if (won) sfx.goal(); else sfx.fail();
}

function updateHud() {
  if (!panel) return;
  els.lvl.textContent = `Level ${levelIndex + 1} · ${level.title}`;
  { const t = copyOf(`obj.${levelIndex}`, level.objective); if (els.obj.textContent !== t) els.obj.textContent = t; }
  { const t = adapt(copyOf(`detail.${levelIndex}`, level.detail)); if (els.detail.textContent !== t) els.detail.textContent = t; const show = t ? '' : 'none'; if (els.detail.style.display !== show) els.detail.style.display = show; }
  const total = level.goal.count;
  els.progress.textContent = `${progress} / ${total}`;
  const left = phase === 'playing' ? Math.max(0, level.timeS - now) : level.timeS;
  els.time.innerHTML = `${Math.ceil(left)}<span class="u">s</span>`;
  els.time.classList.toggle('warn', phase === 'playing' && left < 10);
  els.score.textContent = String(score);
  const pips = els.charges.querySelectorAll('i');
  pips.forEach((p, k) => { p.className = charges >= k + 1 ? 'on' : charges > k + 0.5 ? 'half' : ''; });
  (els.hush as HTMLButtonElement).disabled = !level.hush;
  if (message && performance.now() > messageUntil) { message = ''; els.msg.textContent = ''; }
  els.coach.style.display = (phase === 'playing' || phase === 'countdown') && els.coachText.textContent ? '' : 'none';
  updateMap();
  for (const [key, el] of chipEls) {
    const c = cells.get(key)!;
    const hushed = now < c.hushedUntil;
    el.classList.toggle('nge-sig-chip--hushed', hushed);
    el.classList.toggle('nge-sig-chip--hint', hints.has(key));
    if (level.plastic) { const syn = el.querySelector('.syn'); if (syn && syn.textContent !== chipLine(c)) syn.textContent = chipLine(c); }   // a grown weight shows
    const bar = el.querySelector('.bar b') as HTMLElement | null;
    const label = el.querySelector('.barlabel') as HTMLElement | null;
    if (!bar || !label) continue;
    if (c.gateNext !== null) {
      // The Gatekeeper's bar is a fuse: the seconds to its next pulse, running
      // down (Ames 2026-11-08: "next pulse, what does it mean?").
      const left = Math.max(0, c.gateNext - now);
      bar.style.width = hushed ? `${Math.round(clamp((c.hushedUntil - now) / HUSH_S, 0, 1) * 100)}%` : `${Math.round(clamp(left / c.gatePeriod, 0, 1) * 100)}%`;
      label.innerHTML = hushed ? `inhibited ${Math.max(0, c.hushedUntil - now).toFixed(1)}<span class="u"> s</span>` : `pulses in ${left.toFixed(1)}<span class="u"> s</span>`;
      continue;
    }
    const v = clamp(potential(c) / c.theta, -1, 1), h = holdOn(c);
    bar.classList.toggle('neg', h > 0.3 || v < 0);
    bar.style.width = `${Math.round((h > 0.3 ? h : Math.abs(v)) * 100)}%`;
    label.textContent = h > 0.3 || v < -0.05 ? 'held down' : 'charge';
  }
}

/* ── the haze: everything grey but the cell bodies and the wires that matter ── */
/** The mesh tint (Highlight mode's, mesh/nge_tint.ts) marks the whole frame
 *  in its "dim" colour, so every branch is drawn as a dark grey of its cell,
 *  then clears a sphere around each cell body and a tube along each real
 *  path between the level's cells. What is left in colour is the circuit:
 *  the somas and the wires between them (Ames 2026-11-08: "the cells look
 *  all jumbled together"). */
let savedTint: NgeMeshTint | null = null;
let hazeOn = false;
const DIM: V3 = [0.5, 0.5, 0.5];
/** Each cell's own mark in the haze: colours far from each other and from
 *  the grey (the mesh shader matches to 0.2). */
const OWN_MARKS: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1], [0, 0, 0], [1, 0.5, 0], [0.5, 0, 1], [0, 1, 0.5], [0.5, 1, 0], [1, 0, 0.5], [0, 0.5, 1]];
function buildHaze(): NgeMeshTint | null {
  const nm = nmPerUnit();
  if (!nm) return null;
  const shown = level.cells.map(k => cells.get(k)!);
  const pts: V3[] = shown.map(c => c.spec.soma);
  const used = conns.filter(live);
  for (const k of used) { pts.push(...(k.axon as V3[]), ...(k.dendrite as V3[])); }
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  // The frame around the cell bodies, with room, and everything the paths reach.
  const PAD = 320_000;
  for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], center[i] - PAD); hi[i] = Math.max(hi[i], center[i] + PAD); lo[i] -= 20_000; hi[i] += 20_000; }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const cell = clamp(extent / 150, 3000, 6000);
  const dims = [0, 1, 2].map(i => Math.min(200, Math.ceil((hi[i] - lo[i]) / cell))) as V3;
  const n = dims[0] * dims[1] * dims[2];
  const data = new Uint8Array(n * 4);
  // premultiplied dim grey, alpha 0.85
  const A = 0.85, g = Math.round(DIM[0] * A * 255), a = Math.round(A * 255);
  for (let i = 0; i < n; i++) { data[i * 4] = g; data[i * 4 + 1] = g; data[i * 4 + 2] = g; data[i * 4 + 3] = a; }
  // Each cell's marks are in a colour of its own (OWN_MARKS), and the mesh
  // shader lights a cell only where the map holds ITS colour: a tube
  // cleared along one cell's wire used to light every other branch passing
  // through it, banding the cells with lit stripes (Ames 2026-11-11: "weird
  // striping on the E cells"). Where two cells' marks meet, and at the
  // synapses themselves, the voxel is cleared for all.
  const own = new Map<string, [number, number, number]>();
  shown.forEach((c, i) => own.set(c.spec.root, OWN_MARKS[i % OWN_MARKS.length]));
  const carve = (p: V3, radius: number, rgb: [number, number, number] | null) => {
    const r = Math.ceil(radius / cell);
    const c = [0, 1, 2].map(i => Math.floor((p[i] - lo[i]) / cell));
    const mr = rgb ? rgb.map(v => Math.round(v * A * 255)) : null;
    for (let z = Math.max(0, c[2] - r); z <= Math.min(dims[2] - 1, c[2] + r); z++)
      for (let y = Math.max(0, c[1] - r); y <= Math.min(dims[1] - 1, c[1] + r); y++)
        for (let x = Math.max(0, c[0] - r); x <= Math.min(dims[0] - 1, c[0] + r); x++) {
          const dx = (x + 0.5) * cell + lo[0] - p[0], dy = (y + 0.5) * cell + lo[1] - p[1], dz = (z + 0.5) * cell + lo[2] - p[2];
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const o = ((z * dims[1] + y) * dims[0] + x) * 4;
          if (data[o + 3] === 0) continue;                                       // cleared for all already
          if (!mr) { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0; continue; }
          const grey = data[o] === g && data[o + 1] === g && data[o + 2] === g;
          const mine = data[o] === mr[0] && data[o + 1] === mr[1] && data[o + 2] === mr[2];
          if (grey) { data[o] = mr[0]; data[o + 1] = mr[1]; data[o + 2] = mr[2]; }
          else if (!mine) { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0; }   // another cell's mark: lit for both
        }
  };
  for (const c of shown) carve(c.spec.soma, 24_000, own.get(c.spec.root)!);
  for (const k of used) {
    const pre = own.get(cells.get(k.pre)!.spec.root)!, post = own.get(cells.get(k.post)!.spec.root)!;
    if (k.axon.length) { const ra = route(k.axon as V3[]); for (let s = 0; s <= ra.length; s += cell * 0.5) carve(along(ra, s), 7000, pre); }
    if (k.dendrite.length) { const rd = route(k.dendrite as V3[]); for (let s = 0; s <= rd.length; s += cell * 0.5) carve(along(rd, s), 7000, post); }
    for (const q of k.synapses) carve(q as V3, 5000, null);
  }
  const m = mat4.create();
  for (let i = 0; i < 3; i++) { m[i * 5] = nm[i] / (dims[i] * cell); m[12 + i] = -lo[i] / (dims[i] * cell); }
  // The target is lit whole, in its own colour; the haze is for the others
  // (Ames 2026-11-08: "the target cell all the way lit up and just the
  // others with this lantern mode").
  const skip = skipSet();
  // On a phone the other branches are all but black: the cell bodies and
  // the wires between them are the whole picture (Ames 2026-11-10:
  // "confusing, I couldn't tell which cells I was supposed to be hitting").
  // the hazed branches a little darker, so the bodies behind them show (Ames 2026-11-11: "it's hard to see the somas")
  return {data, dims, gridFromGlobal: m, dim: DIM, dimLevel: phone() ? 0.07 : 0.24, skip, own};
}
let hazeTint: NgeMeshTint | null = null;
/** Cells lit whole, every branch in colour, beyond the targets: what the
 *  tour highlights, and a scanned cell (Ames 2026-11-11: "I want to see all
 *  the branches when they are highlighted"; "when I click here it should
 *  show the whole cell and fade others"). The haze's skip set is changed in
 *  place, so the map is not rebuilt. */
let litWhole = new Set<string>();
let scanLit: string | null = null;
function lightWhole(keys: string[]) {
  litWhole = new Set(keys.map(k => cells.get(k)?.spec.root).filter((r): r is string => !!r));
  refreshSkip();
}
function skipSet(): Set<string> {
  const s = new Set<string>(litWhole);
  for (const k of level.targets) { const c = cells.get(k); if (c) s.add(c.spec.root); }
  const sc = scanLit ? cells.get(scanLit) : undefined;
  if (sc) s.add(sc.spec.root);
  return s;
}
function refreshSkip() {
  if (!hazeTint?.skip) return;
  const want = skipSet();
  hazeTint.skip.clear();
  for (const r of want) hazeTint.skip.add(r);
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}
function applyHaze() {
  if (!hazeOn) { savedTint = getNgeMeshTint(); hazeOn = true; ngeMeshTintChanged.add(keepHaze); }
  try { hazeTint = buildHaze(); setNgeMeshTint(hazeTint); } catch (e) { console.warn('[signal] no haze:', e); }
}
/** Highlight mode rebuilds its own map 120 ms after any change to the layers
 *  or the coordinate space (src/util/highlight.ts, scheduleTint), and the
 *  dataset switch brings several: it replaced the haze with an empty map, so
 *  every branch came back in full colour (seen on the test site, 2026-11-08).
 *  While the game runs, the haze goes straight back on; what Highlight wanted
 *  is kept for when the game ends. */
function keepHaze() {
  if (!hazeOn || !hazeTint || partsTintOn) return;
  const now = getNgeMeshTint();
  if (now === hazeTint) return;
  savedTint = now;
  setNgeMeshTint(hazeTint);
}
/* ── the parts painted on the cell: the dendrites and the axon along their
   arbor points in a tint map of their own (Highlight mode's mechanism: the
   mesh takes the map's colour where it is marked), the cell body left in the
   cell's colour; it stands in for the haze while Neuron 101 plays (Ames
   2026-11-12: "when I said label dendrites I meant on the cell, not in a
   cartoon; we have highlight mode"). The skeleton's compartments say which
   is which (the parts files: axon from compartment 2, dendrites from 3 and 4). ── */
let partsTintOn = false;
function showPartsTint(key: string) {
  const c = cells.get(key), nm = nmPerUnit();
  const pr = c && parts.get(c.spec.root);
  if (!c || !pr || !nm || holoMode) return;
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const pts of [pr.arbor.axon, pr.arbor.dend]) for (const q of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); }
  if (!(lo[0] < hi[0])) return;
  for (let i = 0; i < 3; i++) { lo[i] -= 20_000; hi[i] += 20_000; }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const cell = clamp(extent / 180, 2500, 6000);
  const dims = [0, 1, 2].map(i => Math.min(220, Math.ceil((hi[i] - lo[i]) / cell))) as V3;
  const data = new Uint8Array(dims[0] * dims[1] * dims[2] * 4);
  const A = 0.9;
  const mark = (q: number[], radius: number, rgb: V3 | null) => {
    const r = Math.ceil(radius / cell), cc = [0, 1, 2].map(i => Math.floor((q[i] - lo[i]) / cell));
    for (let z = Math.max(0, cc[2] - r); z <= Math.min(dims[2] - 1, cc[2] + r); z++)
      for (let y = Math.max(0, cc[1] - r); y <= Math.min(dims[1] - 1, cc[1] + r); y++)
        for (let x = Math.max(0, cc[0] - r); x <= Math.min(dims[0] - 1, cc[0] + r); x++) {
          const dx = (x + 0.5) * cell + lo[0] - q[0], dy = (y + 0.5) * cell + lo[1] - q[1], dz = (z + 0.5) * cell + lo[2] - q[2];
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const o = ((z * dims[1] + y) * dims[0] + x) * 4;
          if (!rgb) { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0; continue; }
          data[o] = Math.round(rgb[0] * A * 255); data[o + 1] = Math.round(rgb[1] * A * 255); data[o + 2] = Math.round(rgb[2] * A * 255); data[o + 3] = Math.round(A * 255);
        }
  };
  const d255 = hexRgb(DENDRITE_C), a255 = hexRgb(AXON_C);
  const dc: V3 = [d255[0] / 255, d255[1] / 255, d255[2] / 255], ac: V3 = [a255[0] / 255, a255[1] / 255, a255[2] / 255];
  for (const q of pr.arbor.dend) mark(q, 6500, dc);
  for (const q of pr.arbor.axon) mark(q, 6500, ac);
  mark(c.spec.soma, SOMA_R_NM * 1.7, null);   // the cell body in the cell's own colour
  const m = mat4.create();
  for (let i = 0; i < 3; i++) { m[i * 5] = nm[i] / (dims[i] * cell); m[12 + i] = -lo[i] / (dims[i] * cell); }
  partsTintOn = true;
  setNgeMeshTint({data, dims, gridFromGlobal: m, glow: ac});   // plain colour marks; the axon's colour glows
}
function hidePartsTint() {
  if (!partsTintOn) return;
  partsTintOn = false;
  if (hazeOn) { try { hazeTint = buildHaze(); setNgeMeshTint(hazeTint); } catch (e) { console.warn('[signal] no haze:', e); } }
}
function clearHaze() {
  partsTintOn = false;
  if (!hazeOn) return;
  ngeMeshTintChanged.remove(keepHaze);
  hazeOn = false; hazeTint = null;
  setNgeMeshTint(savedTint);
  savedTint = null;
}

/* ── tags on the cell bodies ── */
let tagEls = new Map<string, HTMLElement>();
function threeDPanel(): any {
  for (const pn of viewerNow()?.display?.panels ?? []) if (pn?.element?.classList?.contains('nge-3d-panel')) return pn;
  return null;
}
/** A point in nanometres to the screen, through the 3D panel's projection. */
function toScreen(p: V3): [number, number] | null {
  const nm = nmPerUnit(), pn = threeDPanel();
  const vp = pn?.projectionParameters?.value?.viewProjectionMat;
  if (!vp || !nm) return null;
  const g = [p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]];
  const w = vp[3] * g[0] + vp[7] * g[1] + vp[11] * g[2] + vp[15];
  if (w <= 0) return null;
  const x = (vp[0] * g[0] + vp[4] * g[1] + vp[8] * g[2] + vp[12]) / w, y = (vp[1] * g[0] + vp[5] * g[1] + vp[9] * g[2] + vp[13]) / w;
  const r = pn.element.getBoundingClientRect();
  return [r.left + (x + 1) / 2 * r.width, r.top + (1 - y) / 2 * r.height];
}
function makeTags() {
  for (const el of tagEls.values()) el.remove();
  tagEls.clear();
  for (const key of level.cells) {
    const c = cells.get(key)!;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ng-extend nge-sig-tag' + (c.target ? ' nge-sig-tag--target' : '');
    el.style.setProperty('--c', `rgb(${c.color.join(',')})`);
    el.innerHTML = `<b class="tap">Tap</b>${key}<small>${tagLine(c)}</small>`;
    el.title = c.target ? `${key}: the target` : `Fire the beam at ${key}`;
    el.onclick = () => { if (phase === 'playing') shoot(key); else tourClick(key); el.blur(); };
    el.style.display = 'none';
    document.body.appendChild(el);
    tagEls.set(key, el);
  }
}
function placeTags() {
  if (!tagEls.size) return;
  const pn = threeDPanel();
  const r = pn?.element?.getBoundingClientRect();
  const hud = panel?.getBoundingClientRect();
  const behindHud = (x: number, y: number) => !!hud && x > hud.left - 8 && x < hud.right + 8 && y > hud.top - 40 && y < hud.bottom + 8;
  for (const [key, el] of tagEls) {
    const c = cells.get(key)!;
    const s = c.shown ? toScreen(c.spec.soma) : null;
    if (!s || !r || s[0] < r.left + 20 || s[0] > r.right - 20 || s[1] < r.top + 40 || s[1] > r.bottom - 10 || behindHud(s[0], s[1])) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = `${s[0]}px`;
    el.style.top = `${s[1]}px`;
    el.classList.toggle('nge-sig-tag--hushed', now < c.hushedUntil);
    el.classList.toggle('nge-sig-tag--hint', hints.has(key));
    const held = holdOn(c) > 0.5;
    if ((el.dataset.held === '1') !== held) {
      el.dataset.held = held ? '1' : '0';
      el.classList.toggle('nge-sig-tag--held', held);
      el.style.setProperty('--c', held ? 'rgb(182,140,255)' : `rgb(${c.color.join(',')})`);
      const small = el.querySelector('small');
      if (small) small.textContent = held ? 'Held down' : tagLine(c);
    }
  }
}
function clearTags() {
  for (const el of tagEls.values()) el.remove();
  tagEls.clear();
}

/* ── the scene: cells, camera, ship ── */
function closeSidePanel() {
  if (!active) return;
  try { const v = viewerNow(); if (v?.selectedLayer?.visible) v.selectedLayer.visible = false; } catch { /* panel stays */ }
}
async function openCircuit(): Promise<any> {
  if (!circuitLayer()) {
    const ds = findDatasetBySegName('microns_signal');
    if (!ds || !(await switchToDataset(ds, {forJump: true}))) throw new Error('the circuit did not open');
  }
  for (let tries = 0; tries < 60; tries++) {
    const ml = circuitLayer();
    if (ml) {
      // The dataset switch opens the Segments side panel (and again a
      // moment later, as it settles); the game wants the whole screen.
      for (const ms of [0, 400, 1200, 2600, 4500]) setTimeout(closeSidePanel, ms);
      return ml;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('no circuit layer');
}

/** Has this cell's mesh started to draw? Read from the mesh layer's own
 *  chunks. The release's meshes are multiscale: a manifest per cell in
 *  source.chunks (keyed by the cell id), then fragments in
 *  fragmentSource.chunks keyed "<cell>/<lod>:<index>"; it counts once the
 *  manifest is here and a fragment is on the graphics card. The Sandbox's
 *  single scale meshes (a manifest with fragmentIds) are read as the
 *  Starship reads them. */
function meshDrawn(ml: any, root: string): boolean {
  const seg = Uint64.parseString(root);
  const key = `${seg.low},${seg.high}`;
  const GPU_MEMORY = 0;  // neuroglancer's ChunkState.GPU_MEMORY
  for (const rl of ml.layer.renderLayers ?? []) {
    const src = rl?.source;
    if (!src?.chunks?.get || !src.fragmentSource?.chunks) continue;
    const manifest = src.chunks.get(key);
    if (!manifest) continue;
    const ids: string[] | undefined = manifest.fragmentIds;
    if (ids && typeof src.getFragmentKey === 'function') {
      if (!ids.length) continue;
      let drawn = 0;
      for (const id of ids) if (src.fragmentSource.chunks.get(src.getFragmentKey(key, id).key)?.state === GPU_MEMORY) drawn++;
      if (drawn / ids.length >= 0.5) return true;
      continue;
    }
    const prefix = `${key}/`;
    for (const [k, c] of src.fragmentSource.chunks as Map<string, any>) if (k.startsWith(prefix) && c?.state === GPU_MEMORY) return true;
  }
  return false;
}

function frameLevel() {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return;
  const shown = level.cells.map(k => cells.get(k)!.spec.soma);
  center = [0, 1, 2].map(i => shown.reduce((a, p) => a + p[i], 0) / shown.length) as V3;
  let span = 0;
  for (const p of shown) span = Math.max(span, len(sub(p, center)));
  try { v.layout.restoreState('3d'); } catch { /* keep the layout */ }
  try { v.showAxisLines.value = false; } catch { /* keep them */ }
  // The 3D view as the ship's placing assumes: a perspective camera, with
  // its near plane close in (a saved view can carry a narrow depth range,
  // which would clip the ship: it rides close to the eye).
  try { if (v.orthographicProjection?.value) v.orthographicProjection.value = false; } catch { /* as it is */ }
  try { const dr = v.perspectiveNavigationState?.depthRange; if (dr && dr.value > 0) dr.value = -50; } catch { /* as it is */ }
  // the dataset's box is drawn as a hologram by the game (drawBox), not as
  // Neuroglancer's blue lines
  try { if (savedDefaultAnnotations === null) savedDefaultAnnotations = !!v.showDefaultAnnotations.value; v.showDefaultAnnotations.value = false; } catch { /* as it is */ }
  // In close on the cell bodies: the rest of each cell is there, greyed, as
  // context (the haze), so the frame need not hold it all.
  viewNm = Math.max(200_000, span * 2.0 + 70_000);
  setLook(v, nm, center);
  const unit = Math.min(nm[0], nm[1], nm[2]);
  setZoom(v, viewNm / unit);
  // Looking down into the cortex from the pia, the way a two photon
  // microscope does (Ames 2026-11-08: "sort of like I am being a 2p
  // microscope"): the eye toward data -y, screen up along +z.
  // On a phone the view is from the side, the pia at the top, so the cell
  // bodies spread down the tall screen instead of sitting over one another
  // (Ames 2026-11-10: "couldn't tap the right cell").
  v.projectionOrientation.restoreState(phone() ? [0, 0, 0, 1] : [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  needsFrame = true;
  glide = null;
  shipAt = add(center, [0, -viewNm * 0.4, 0]);
  shipFwd = norm(sub(center, shipAt));
}
/** The level's frame: how much of the cortex shows top to bottom, in nm. */
let viewNm = 260_000;
/** Set by frameLevel: the next frame with a camera puts the circuit in the
 *  open space above the HUD. */
let needsFrame = false;
function settleFrame(cam: {right: V3; up: V3; toEye: V3}) {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return;
  needsFrame = false;
  if (phone()) {
    // A phone stands upright and the HUD lies along the bottom: the circuit
    // has to fit the width, and sit in the part of the height the HUD
    // leaves free, so the frame is set from the screen's own shape.
    const r = threeDPanel()?.element?.getBoundingClientRect?.();
    const P = r && r.height > 0 ? r.height : 700, Wpx = r && r.width > 0 ? r.width : 375;
    const frac = hudFrac();
    // The cell bodies are what a thumb taps, so their box fills the free
    // area (the part of the height above the HUD), the branches around them
    // as context, with room above the top body for its "Tap" callout and a
    // margin each side; never closer than 120 µm. The box is centred, not
    // the mean of the bodies: one body far from the rest (E1, the first to
    // tap) was sitting at the top edge with its callout cut off.
    const TOP = 64, BOT = 24, SIDE = 28;   // px
    let loR = Infinity, hiR = -Infinity, loU = Infinity, hiU = -Infinity;
    for (const k of level.cells) {
      const d = sub(cells.get(k)!.spec.soma, center);
      const x = dot(d, cam.right), y = dot(d, cam.up);
      loR = Math.min(loR, x); hiR = Math.max(hiR, x); loU = Math.min(loU, y); hiU = Math.max(hiU, y);
    }
    const W = hiR - loR + 30_000, H = hiU - loU + 30_000;   // the bodies, 15 µm of radius each side
    const freeH = Math.max(120, (1 - frac) * P - TOP - BOT), freeW = Math.max(120, Wpx - 2 * SIDE);
    // further out than the bodies alone, so the arbors show too (Ames 2026-11-12: "too far in")
    viewNm = Math.max(200_000, H * P / freeH, W * P / freeW) * 1.4;
    setZoom(v, viewNm / Math.min(nm[0], nm[1], nm[2]));
    // The box's middle goes to the middle of the free area: that many px
    // above the panel's centre, so the look point sits that far below it.
    const nmPerPx = viewNm / P;
    const boxMid = add(center, add(mul(cam.right, (loR + hiR) / 2), mul(cam.up, (loU + hiU) / 2)));
    const freeMidPx = (TOP + (1 - frac) * P - BOT) / 2 - P / 2;   // down the screen is positive
    const look = add(boxMid, mul(cam.up, freeMidPx * nmPerPx));
    setLook(v, nm, look);
    return;
  }
  if (sideHud()) {
    // The HUD stands at the left: the circuit centres in the width it leaves
    // free, and a little above the middle.
    const r = threeDPanel()?.element?.getBoundingClientRect?.();
    const h = panel?.getBoundingClientRect();
    const covered = r && h && r.width > 0 ? clamp((h.right + 16 - r.left) / r.width, 0, 0.6) : 0;
    const aspect = r && r.height > 0 ? r.width / r.height : 1.5;
    const look = sub(sub(center, mul(cam.right, -covered * viewNm * aspect / 2)), mul(cam.up, viewNm * 0.03));
    setLook(v, nm, look);
    return;
  }
  // The HUD takes the bottom third, so the camera looks a little below the
  // circuit and the cells sit above.
  const look = sub(center, mul(cam.up, viewNm * 0.1));
  setLook(v, nm, look);
}
/** On a wide screen the HUD stands at the right, leaving the whole height
 *  for the cells; on a phone it lies along the bottom. */
const sideHud = () => window.innerWidth >= 1000;
/** A phone: Pyr's own mobile mode (body.nge-mobile, src/util/mobile.ts). */
const phone = () => document.body.classList.contains('nge-mobile');
/** The low-poly look: no meshes at all; each cell a faceted body in its
 *  colour with its arbors as a dust of light and the wires between the cells
 *  as beaded lines, all from the parts files, behind `?signal&holo` on any
 *  device (Ames 2026-11-11: "a simplified visual version like low poly mini
 *  neurons, stylized for the mobile version"; 2026-11-12: "a little too low
 *  poly; let me try the original version on my phone", so phones keep the
 *  meshes unless asked). */
const HOLO_FLAG = (() => { try { return new URLSearchParams(location.search).has('holo'); } catch { return false; } })();
let holoMode = false;
/** The cell last tapped or clicked, for the phone's data icon. */
let lastTapped: string | null = null;
/** A touch screen is the main pointer: no keys to name, "tap" not "click". */
const touch = () => !!window.matchMedia?.('(pointer: coarse)').matches;
/** The share of the 3D view's height the HUD covers when it lies along the
 *  bottom (none when it stands at the side). */
function hudFrac(): number {
  if (sideHud() || !panel) return 0;
  const r = threeDPanel()?.element?.getBoundingClientRect?.();
  if (!r || r.height <= 0) return 0;
  return clamp((r.bottom - panel.getBoundingClientRect().top) / r.height, 0, 0.7);
}
/** The ship rides with the camera, low in the foreground like a cockpit:
 *  it stays in view however the player turns the cells, and its beams
 *  leave from the player's own side. */
/** The ship's length in nm, set with its spot: a fixed share of the screen,
 *  whatever the level's spread or the zoom. */
let shipLenNm = SHIP_LENGTH_NM;
function cockpitSpot(cam: {right: V3; up: V3; toEye: V3}): {spot: V3; len: number; nose: V3} | null {
  const v = viewerNow(), nm = nmPerUnit();
  const inv = threeDPanel()?.projectionParameters?.value?.invViewProjectionMat;
  if (!v || !nm || !inv) return null;
  // Neuroglancer's perspective camera is 45° tall (perspective_view/panel.ts).
  // The eye is read from the panel's own projection: at any depth the
  // frustum's half-height is depth·tan 22.5°, so a point on the view's axis
  // is as deep as the frame's top edge is far from it there, and the eye is
  // that far back along the axis. (It was once worked out from
  // projectionScale and the voxel size; the matrix holds whatever the view
  // state or the dataset's units are.)
  const tanHalf = Math.tan(Math.PI / 8);
  const back = (a: number, b: number, c: number): V3 => {
    const g = inv[3] * a + inv[7] * b + inv[11] * c + inv[15];
    return [0, 1, 2].map(i => (inv[i] * a + inv[i + 4] * b + inv[i + 8] * c + inv[i + 12]) / g * nm[i]) as V3;
  };
  const o = back(0, 0, 0.5), halfHAtO = len(sub(back(0, 1, 0.5), o)), halfWAtO = len(sub(back(1, 0, 0.5), o));
  if (!(halfHAtO > 0)) return null;
  const eye = add(o, mul(cam.toEye, halfHAtO / tanHalf)), aspect = halfWAtO / halfHAtO;
  const look = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
  const eyeDist = Math.max(1, dot(sub(eye, look), cam.toEye));
  // The ship sits four tenths of the way out from the eye, in front of the
  // tissue in most frames, placed in screen terms: low and to the left,
  // clear of the HUD. It had been 26 µm long and 300 µm deep, lost among
  // the branches once a level spread out (Ames 2026-11-08: "I don't see the
  // spaceship").
  const d = eyeDist * 0.4;
  const halfH = d * tanHalf, halfW = halfH * aspect;
  // On a phone the ship sits just above the HUD's edge, at the left; with
  // the HUD standing at the left it rides low right, clear of it.
  const sx = sideHud() ? 0.6 : phone() ? -0.55 : -0.6;
  const sy = sideHud() ? -0.5 : phone() ? Math.min(-0.1, -1 + 2 * hudFrac() + 0.45) : -0.25;
  // its length: three tenths of the view's shorter half-extent (15% of the
  // height on a wide screen; it was half, then four tenths, "too large",
  // Ames 2026-11-11). The cockpit's nose: low in the middle of the view,
  // three tenths of the way out from the eye.
  const d2 = eyeDist * 0.3, halfH2 = d2 * tanHalf;
  const nose = add(sub(eye, mul(cam.toEye, d2)), mul(cam.up, -0.92 * halfH2));
  return {spot: add(add(sub(eye, mul(cam.toEye, d)), mul(cam.right, sx * halfW)), mul(cam.up, sy * halfH)), len: Math.min(halfH, halfW) * 0.14, nose};   // 0.22 was "too large" (Ames 2026-11-12)
}
/** Where the ship lands on a visit: on the near side of the cell body (a
 *  soma is some 12 µm across), a touch to the side it came from, so it sits
 *  among the branches with whatever is in front of it in front (Ames
 *  2026-11-11: "the ship doesn't seem to be properly nested within the 3D
 *  space… small enough to land on the soma"). */
const SOMA_R_NM = 7000, VISIT_LEN_NM = 5500;
function visitSpot(cam: {right: V3; up: V3; toEye: V3}, c: CellState, lean: number): V3 {
  return add(add(c.spec.soma, mul(cam.toEye, SOMA_R_NM)), mul(cam.right, lean * 1500));
}

/** The model's own length along its nose (+z), so it can be sized in nm. */
let shipModelLength = 0;
/** The engines' contrails: particles streaming back from the two nozzles, a
 *  trickle at rest and a stream in flight (Ames 2026-11-12: "it doesn't have
 *  its contrails!"). The nozzles sit at the back, a third of the way out to
 *  each side, as in the Starship intro. */
let shipModelZLo = 0, shipModelXHi = 0, lastShipAt: V3 | null = null, trailDebt = 0;
interface Trail { p: V3; v: V3; at: number; life: number; }
let trail: Trail[] = [];
function placeShip(cam: {right: V3; up: V3; toEye: V3}, dt: number) {
  const nm = nmPerUnit();
  if (!nm || !shipMesh) return;
  if (!shipModelLength) {
    let zLo = Infinity, zHi = -Infinity, xHi = 0;
    for (let i = 2; i < shipMesh.positions.length; i += 3) { zLo = Math.min(zLo, shipMesh.positions[i]); zHi = Math.max(zHi, shipMesh.positions[i]); xHi = Math.max(xHi, Math.abs(shipMesh.positions[i - 2])); }
    shipModelLength = (zHi - zLo) || 1; shipModelZLo = zLo; shipModelXHi = xHi;
  }
  const cockpit = cockpitSpot(cam);
  cockpitNose = cockpit?.nose ?? null;
  const vc = visit ? cells.get(visit.key) : undefined;
  const spot = vc ? visitSpot(cam, vc, visit!.lean) : cockpit?.spot ?? null;
  // its size: a fixed share of the screen at the cockpit; on a visit a craft
  // smaller than the cell body it lands on, 5.5 µm long
  const wantLen = vc ? VISIT_LEN_NM : cockpit?.len ?? shipLenNm;
  shipLenNm += (wantLen - shipLenNm) * Math.min(1, dt * 4);
  const scale = shipLenNm / shipModelLength;
  if (spot) {
    if (vc) {
      // on a visit it turns first, then flies at a steady pace and eases in
      // to land; it used to leap most of the way while still turning (Ames
      // 2026-11-11: "ship is facing wrong direction while flying")
      // The way is lifted toward the eye, up to three tenths of the view
      // until it is near, so it flies over the cells and comes down onto the
      // cell body, never through the branches (Ames 2026-11-11: "make sure
      // the ship never drives through the neuron").
      const left = len(sub(spot, shipAt));
      const goal = add(spot, mul(cam.toEye, Math.min(viewNm * 0.3, left * 0.8)));
      const dir = sub(goal, shipAt), dist = len(dir);
      flying = left > viewNm * 0.06;
      if (dist > 1) {
        const aligned = dot(shipFwd, mul(dir, 1 / dist));
        let v = Math.min(dist, Math.min(viewNm * 0.32 * dt, Math.max(left * 3 * dt, viewNm * 0.02 * dt)));
        if (aligned < 0.8 && dist > viewNm * 0.03) v *= 0.12;
        shipAt = add(shipAt, mul(dir, v / dist));
      }
    } else { shipAt = mix(shipAt, spot, Math.min(1, dt * 5)); flying = false; }
  }
  // a visit: the scan fires once the ship is there (or after 1.8 s, if the
  // way is long); from the cockpit, once the camera's glide has ended
  const there = !visit ? false : view === 'cockpit' ? !glide : (len(sub(shipAt, spot ?? shipAt)) < viewNm * 0.02 || now - visit.since > 1.8);
  if (visit && vc && !visit.fired && there) fireScan();
  // on the way it points where it is going; landed, it sits across the cell
  // body's surface, its belly to the cell (its up is the way to the eye)
  const landed = !!vc && !!spot && len(sub(shipAt, spot)) < viewNm * 0.03;
  const aimAt = vc ? (landed ? add(shipAt, mul(cam.right, visit!.lean)) : spot!) : shipAim && performance.now() < aimUntil ? shipAim : center;
  const want = norm(sub(aimAt, shipAt));
  shipFwd = norm(mix(shipFwd, want, Math.min(1, dt * (vc ? 12 : 7))));
  const upRef = landed ? cam.toEye : cam.up;
  let up = norm(sub(upRef, mul(shipFwd, dot(upRef, shipFwd))));
  if (prevUp) up = norm(mix(prevUp, up, Math.min(1, dt * 6)));
  prevUp = up;
  // the occasional barrel roll in flight (Ames 2026-11-11): a full turn
  // about its own length over 0.9 s, about one in every four seconds of
  // flying, and only with room to finish before it lands
  if (flying && view === 'ship' && !roll && vc && len(sub(spot ?? shipAt, shipAt)) > viewNm * 0.35 && Math.random() < dt * 0.25) roll = {at: performance.now(), dur: 900};
  if (roll) {
    const q = (performance.now() - roll.at) / roll.dur;
    if (q >= 1) roll = null;
    else { const a = (q < 0.5 ? 2 * q * q : 1 - 2 * (1 - q) * (1 - q)) * Math.PI * 2; up = norm(add(mul(up, Math.cos(a)), mul(cross(shipFwd, up), Math.sin(a)))); }
  }
  const fwd = norm(sub(shipFwd, mul(up, dot(shipFwd, up))));
  const right = norm(cross(up, fwd));
  const bob = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : viewNm * 0.004 * Math.sin(performance.now() / 1000 * 1.3);
  const at = add(shipAt, mul(up, bob));
  if (shipProp.alpha > 0 && view === 'ship') {
    const moved = lastShipAt ? len(sub(at, lastShipAt)) : 0;
    trailDebt += dt * 10 + moved / (shipLenNm * 0.04);
    const tail = add(at, mul(fwd, shipModelZLo * scale)), tNow = performance.now() / 1000;
    while (trailDebt >= 1 && trail.length < 600) {
      trailDebt -= 1;
      for (const sideSign of [1, -1]) {
        const p0 = add(add(tail, mul(right, sideSign * shipModelXHi * 0.3 * scale)), mul(up, (Math.random() - 0.5) * shipLenNm * 0.03));
        const v = add(add(mul(fwd, -shipLenNm * (0.5 + Math.random() * 0.4)), mul(right, (Math.random() - 0.5) * shipLenNm * 0.12)), mul(up, (Math.random() - 0.5) * shipLenNm * 0.12));
        trail.push({p: p0, v, at: tNow, life: 0.45 + Math.random() * 0.45});
      }
    }
  }
  lastShipAt = at;
  const m = shipProp.modelMat, axes = [right, up, fwd];
  for (let col = 0; col < 3; col++) for (let k = 0; k < 3; k++) m[col * 4 + k] = axes[col][k] * scale / nm[k];
  for (let k = 0; k < 3; k++) m[12 + k] = at[k] / nm[k];
  shipProp.eye = [dot(right, cam.toEye), dot(up, cam.toEye), dot(fwd, cam.toEye)];
}
const shipNose = (): V3 => view === 'cockpit' && cockpitNose ? cockpitNose : add(shipAt, mul(shipFwd, shipLenNm * 0.5));

/** The dataset's box as a hologram in the background (Ames 2026-11-11:
 *  "make the boundary box more like a hologram in the background instead of
 *  a blue outline"): dotted light along its twelve edges, brackets at the
 *  corners, a faint grid on its far face. The bounds are the viewer's own
 *  (the union of its layers'), in nm. */
function boxBounds(nm: V3): [V3, V3] | null {
  const b = viewerNow()?.coordinateSpace?.value?.bounds;
  if (!b?.lowerBounds || !b?.upperBounds) return null;
  const lo = [0, 1, 2].map(i => b.lowerBounds[i] * nm[i]) as V3, hi = [0, 1, 2].map(i => b.upperBounds[i] * nm[i]) as V3;
  if (lo.some(x => !isFinite(x)) || hi.some(x => !isFinite(x))) return null;
  return [lo, hi];
}
function drawBox(cam: {right: V3; up: V3; toEye: V3}, put: (p: V3, rgba: [number, number, number, number], size: number) => void) {
  const nm = nmPerUnit();
  const bb = nm && boxBounds(nm);
  if (!bb) return;
  const [lo, hi] = bb;
  const corner = (m: number): V3 => [m & 1 ? hi[0] : lo[0], m & 2 ? hi[1] : lo[1], m & 4 ? hi[2] : lo[2]];
  const R = 0.5, G = 0.8, B = 1;
  const N = 120;
  for (let m = 0; m < 8; m++) for (const bit of [1, 2, 4]) {
    if (m & bit) continue;
    const a = corner(m), b = corner(m | bit);
    for (let k = 0; k <= N; k++) {
      const u = k / N, bracket = u < 0.05 || u > 0.95;
      if (bracket) put(mix(a, b, u), [1, 0.76, 0.3, 0.55], 3200); else put(mix(a, b, u), [R, G, B, 0.11], 2400);
    }
  }
  // the far face: the one whose outward normal points away from the eye the most
  let far = 0, best = Infinity;
  for (let f = 0; f < 6; f++) { const d = (f & 1 ? 1 : -1) * cam.toEye[f >> 1]; if (d < best) { best = d; far = f; } }
  const axis = far >> 1, at = far & 1 ? hi[axis] : lo[axis];
  const u = (axis + 1) % 3, w = (axis + 2) % 3;
  const LINES = 6, M = 60;
  for (let i = 1; i < LINES; i++) for (const [p, q] of [[u, w], [w, u]]) {
    const fixed = lo[p] + (hi[p] - lo[p]) * i / LINES;
    for (let k = 0; k <= M; k++) {
      const pt: V3 = [0, 0, 0];
      pt[axis] = at; pt[p] = fixed; pt[q] = lo[q] + (hi[q] - lo[q]) * k / M;
      put(pt, [R, G, B, 0.07], 2600);
    }
  }
}

/* ── the model ── */
function resetCells() {
  for (const c of cells.values()) {
    c.shown = level.cells.includes(c.key);
    c.target = level.targets.includes(c.key);
    c.e = 0; c.i = 0; c.theta = thetaOf(c.key);
    c.refractoryUntil = -1; c.hushedUntil = -1; c.lastSpike = -1; c.spikes = 0;
    c.gateNext = null; c.gatePeriod = 1;
    const eIndex = level.cells.filter(k => cells.get(k)!.spec.type === 'E').indexOf(c.key);
    for (const k of conns) k.w = 1;
    c.color = hexRgb(c.target ? TARGET_COLOR : cellColor(c.spec, Math.max(0, eIndex)));
  }
  if (level.gate) {
    const g = cells.get(level.gate.cell);
    if (g) { g.gatePeriod = level.gate.periodS; g.gateNext = 1.2; }
  }
  arrivals = []; sparks = []; flashes = []; beams = []; queued = [];
  lastTargetSpike = {}; sequenceArmedAt = -1;
}

function spike(key: string, byBeam = false) {
  const c = cells.get(key);
  if (!c || !c.shown) return;
  if (now < c.refractoryUntil || now < c.hushedUntil) { if (byBeam) { sfx.fizzle(); say(`${key} is ${now < c.hushedUntil ? 'inhibited' : 'resting'}.`, 2.6, key); } return; }
  c.e = 0; c.i = 0; c.refractoryUntil = now + REFRACTORY_S; c.lastSpike = now; c.spikes++;
  if (c.gateNext !== null) c.gateNext = now + c.gatePeriod;
  if (level.plastic && c.target && phase === 'playing') {
    // cells that fire together wire together: the synapses whose spikes just
    // helped grow (Hebbian potentiation), up to 2.2 times
    const grown = new Set<string>();
    for (const r of recentIn) if (r.post === key && now - r.at < 1.2 && !grown.has(r.pre)) { r.conn.w = Math.min(2.2, (r.conn.w ?? 1) + 0.4); grown.add(r.pre); }
    const g = level.goal;
    if (g.kind === 'solo' && grown.has(g.driver)) { const k = conns.find(x => x.pre === g.driver && x.post === key); if (k) say(`${g.driver}’s synapses onto ${key} grew: ×${(k.w ?? 1).toFixed(1)}.`, 2.6, g.driver); }
  }
  const inhibitory = c.spec.type === 'I';
  flashes.push({p: c.spec.soma, at: now, life: 0.55, rgb: c.target ? [1, 0.85, 0.4] : inhibitory ? [0.85, 0.7, 1] : [0.8, 0.95, 1], size: c.target ? 22_000 : 16_000});
  arborWave(key, inhibitory);
  if (c.target) burstAt(c.spec.soma, [1, 0.85, 0.4]);
  sparkleAt(c.spec.soma, c.target ? [1, 0.9, 0.5] : inhibitory ? [0.85, 0.7, 1] : [0.85, 0.97, 1], c.target ? 36 : 26, c.target ? 1.3 : 1);
  chipEls.get(key)?.classList.remove('nge-sig-chip--spike');
  void chipEls.get(key)?.offsetWidth;
  chipEls.get(key)?.classList.add('nge-sig-chip--spike');
  mapFlash(key);
  if (c.target) sfx.target(); else sfx.spike(inhibitory);
  if (byBeam) {
    if (key === 'I2' || key === 'S') coach('key');
    else if (!c.target && !inhibitory) coach('driver');
  }
  // its spikes set out along the real paths to every partner on screen
  for (const k of conns) {
    if (k.pre !== key || !live(k)) continue;
    const r = routes.get(k)!;
    const fast = FAST[key] ?? 1, leave = now + (fast > 1 ? 0.05 : AP_DELAY_S);
    const travel = r.length / 1000 / (SPEED_UM_S * fast);
    sparks.push({r, start: leave, end: leave + travel, inhibitory, conn: k});
    arrivals.push({at: leave + travel, post: k.post, units: k.count * (k.w ?? 1) * (inhibitory ? I_UNIT : E_UNIT), inhibitory, conn: k});
  }
  if (c.target) onTargetSpike(key);
}

function onTargetSpike(key: string) {
  lastTargetSpike[key] = now;
  if (phase !== 'playing') return;   // a firing in the tour's demonstration counts for nothing
  const g = level.goal;
  let hit = false;
  if (g.kind === 'fire') hit = key === g.target;
  else if (g.kind === 'sequence') {
    if (key === g.order[0]) { sequenceArmedAt = now; say(`${g.order[0]} fired. Now ${g.order[1]}, within ${g.withinS} s.`); }
    else if (key === g.order[1] && sequenceArmedAt >= 0 && now - sequenceArmedAt <= g.withinS) { hit = true; sequenceArmedAt = -1; }
    else if (key === g.order[1]) say(`${g.order[1]} fired first. The order is ${g.order[0]} then ${g.order[1]}.`);
  } else if (g.kind === 'sync') {
    const other = g.targets[0] === key ? g.targets[1] : g.targets[0];
    if (g.targets.includes(key) && lastTargetSpike[other] !== undefined && now - lastTargetSpike[other] <= g.withinS) { hit = true; lastTargetSpike[other] = -Infinity; }
  } else if (g.kind === 'beat') {
    if (key === g.target) {
      if (progress > 0 && lastBeatAt >= 0 && now - lastBeatAt > g.withinS) { progress = 0; say('The beat broke. From the top.', 2.6); }
      lastBeatAt = now; hit = true;
    }
  } else if (g.kind === 'solo') {
    if (key === g.target) {
      const helpers = [...new Set(recentIn.filter(r => r.post === key && now - r.at <= g.windowS).map(r => r.pre))];
      if (helpers.length && helpers.every(q => q === g.driver)) hit = true;
      else if (helpers.includes(g.driver)) { /* the pairing: the growth has its own line */ }
      else say(`${g.driver} took no part in that.`, 2.6, g.driver);
    }
  }
  pendingExcitation.delete(key);
  if (!hit) { score += 25; return; }
  progress++;
  score += 100;
  say(progress >= g.count ? 'Signal delivered!' : `${progress} of ${g.count}. Keep going.`);
  if (progress >= g.count) setTimeout(() => { if (active && phase === 'playing') showResult(true); }, 900);
  else coach('hit');
}

function arrive(a: Arrival) {
  const c = cells.get(a.post);
  if (!c || !c.shown) return;
  const burst = (p: V3) => flashes.push({p, at: now, life: 0.4, rgb: a.inhibitory ? [0.75, 0.55, 1] : [1, 0.95, 0.7], size: 6000});
  for (const p of a.conn.synapses.slice(0, 6)) burst(p);
  if (now < c.hushedUntil) return;
  if (c.gateNext !== null) {
    // the Gatekeeper's clock: inhibition pushes it back, excitation pulls it in
    c.gateNext = a.inhibitory ? c.gateNext + a.units * GATE_PUSH_S : Math.max(now + 0.15, c.gateNext - a.units * GATE_PULL_S);
    return;
  }
  if (a.inhibitory) { c.i += a.units; if (c.target) { coach('pulse'); lastGo = null; } }
  else { c.e += a.units; if (c.target) pendingExcitation.set(c.key, now); recentIn.push({post: a.post, pre: a.conn.pre, conn: a.conn, at: now}); }
}

/** A beam at a cell, the player's or the tour's: the shields answer either
 *  way (a target; a cell the level shields against the Inhibit beam); the
 *  player's costs a charge. */
function fireAt(key: string, hush: boolean, demo: boolean): boolean {
  const c = cells.get(key);
  if (!c || !c.shown) return false;
  lastTapped = key;
  if (c.target) { sfx.shield(); say('Shielded. Signal it using partner cells.', 2.6, key); shake(key); return false; }
  if (hush && level.hushBlocked?.includes(key)) { sfx.shield(); say(`${key}’s shield blocks the Inhibit beam. Find another way.`, 2.6, key); shake(key); return false; }
  if (!demo) {
    const cost = hush ? HUSH_COST : SPARK_COST;
    if (charges < cost) { sfx.fizzle(); say('Not enough charge.'); return false; }
    charges -= cost; chargesUsed += cost;
  }
  shipAim = c.spec.soma; aimUntil = performance.now() + 1500;
  beams.push({from: shipNose(), to: c.spec.soma, at: now, hush, cell: key, applied: false});
  if (hush) sfx.hush(); else sfx.spark();
  return true;
}
function shoot(key: string) { if (phase === 'playing') fireAt(key, hushMode, false); }
function shake(key: string) {
  const el = chipEls.get(key);
  if (!el) return;
  el.classList.remove('nge-sig-chip--shake'); void el.offsetWidth; el.classList.add('nge-sig-chip--shake');
}

/* ── the scan: before Begin (and after the level), the beam reads a cell ──
   Ames 2026-11-11: "before I begin it should still let me shoot a beam, it
   should pop out stats on the cells like the UI of the rocket ship in Pyr".
   A cyan beam from the ship to the cell, and on landing a hologram card the
   ship projects, as the intro's callouts (src/util/intro_tour.ts): a cone
   of light from the ship's nose up to the card, a fine line from the card
   down to the cell body. The card is the cell's record: what it is, its job
   here, its cable, and its real synapses onto and from the other cells of
   the level. */
let scanEl: HTMLElement | null = null;
let scanKey: string | null = null;
/** Where the player dragged the card to, if they did: the screen position of its top left corner. */
let scanPin: [number, number] | null = null;
function scan(key: string) {
  if (phase !== 'brief' && phase !== 'done') return;
  const c = cells.get(key);
  if (!c || !c.shown) return;
  hideScan();
  // the ship goes to whichever side of the cell has more screen
  const s = toScreen(c.spec.soma), r = threeDPanel()?.element?.getBoundingClientRect?.();
  const lean = s && r && s[0] > r.left + r.width / 2 ? -1 : 1;
  const there = visit?.key === key && visit.fired;
  lastTapped = key;
  visit = {key, since: now, lean: there ? visit!.lean : lean, fired: false};
  // the cell whole, every branch in colour, the others faded (Ames
  // 2026-11-11: "when I click here it should show the whole cell and fade others")
  scanLit = key;
  for (const o of cells.values()) if (o.shown) paint(o, o.key !== key, o.key !== key);
  refreshSkip();
  gemsFor(key);
  if (view === 'cockpit') glideTo(c);
  if (there) fireScan();   // already hovering here: the beam again, at once
}
/* ── the synapses between a scanned cell and the target, as Pyr gems: a
   local annotation layer with the Pyr point marker, as Highlight's start
   marker is drawn (Ames 2026-11-11: "highlight the synapses between the cell
   and target, use Pyr gem annotations") ── */
const GEM_LAYER = 'Signal synapses';
function gemLayer(): any { return (viewerNow()?.layerManager?.managedLayers ?? []).find((m: any) => m.name === GEM_LAYER && !m.archived); }
function showGems(points: V3[], color: string) {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return;
  const pts = points.map(p => [p[0] / nm[0], p[1] / nm[1], p[2] / nm[2]]);
  const managed = gemLayer();
  if (!managed) {
    try {
      v.layerSpecification.add(makeLayer(v.layerSpecification, GEM_LAYER, {type: 'annotation', source: 'local://annotations', annotations: pts.map((q, i) => ({type: 'point', id: `syn-${i}`, point: q, description: 'A synapse between the cells'})), annotationColor: color, pointMarker: 'pyr', pointSize: 1.5, onTop: true}));
    } catch (e) { console.warn('[signal] no gem layer:', e); }
    return;
  }
  const src = managed.layer?.localAnnotations;
  if (!src) return;
  try { managed.layer.annotationDisplayState.color.restoreState(color); } catch { /* keeps its colour */ }
  src.clear();
  pts.forEach((q, i) => { try { src.add({id: `syn-${i}`, type: 0, point: Float32Array.from(q), properties: [], description: 'A synapse between the cells'}, true).dispose(); } catch { /* skipped */ } });
}
function clearGems(remove = false) {
  const managed = gemLayer();
  if (!managed) return;
  if (remove) { try { viewerNow()?.layerManager?.removeManagedLayer(managed); } catch { /* stays */ } return; }
  try { managed.layer?.localAnnotations?.clear(); } catch { /* stays */ }
}
/** The synapses between a cell and the level's targets, either way round. */
function gemsFor(key: string) {
  const c = cells.get(key);
  if (!c) return;
  const pts: V3[] = [];
  for (const k of conns) {
    const other = k.pre === key ? k.post : k.post === key ? k.pre : null;
    if (!other) continue;
    const oc = cells.get(other);
    if (!oc?.shown || !(oc.target || c.target)) continue;
    pts.push(...k.synapses);
  }
  if (pts.length) showGems(pts, '#ffc24a'); else clearGems();
}
/** The scan's fade undone: each cell as the tour or its hush would have it. */
function unfadeScan() {
  for (const o of cells.values()) if (o.shown) paint(o, tourDim.has(o.key) || now < o.hushedUntil);
}
/** A click on a cell during the tour: in a step about sparking it is the
 *  spark itself (Ames 2026-11-11: "this should not fly the ship over, it
 *  should do the photon beam to activate the cell"); otherwise the scan. */
function tourClick(key: string) {
  if (phone()) {
    // on a phone a tap is the beam in every step (the data icon opens the
    // card); in level 1's first two steps the gold cell itself spikes, to
    // show what one looks like (Ames 2026-11-12: "if I tap the target
    // shouldn't it trigger an AP?")
    const c = cells.get(key);
    if (phase === 'brief' && levelIndex === 0 && tourAt <= 1 && c?.target) { lastTapped = key; spike(key); return; }
    fireAt(key, hushMode, true);
    return;
  }
  if (phase !== 'brief' || tourSteps[tourAt]?.click !== 'spark') { scan(key); return; }
  fireAt(key, hushMode, true);   // the beam chosen, the shields answering, as in play
}
/** The scan beam, from the ship's nose to the cell it is visiting. */
function fireScan() {
  const c = visit && cells.get(visit.key);
  if (!visit || !c) return;
  visit.fired = true;
  beams.push({from: shipNose(), to: c.spec.soma, at: now, hush: false, cell: c.key, applied: false, scan: true});
  sfx.scan();
}
/** The card goes, and the ship flies back to its cockpit spot. */
function endVisit() { hideScan(); visit = null; if (view === 'cockpit') glideHome(); }
/** The level's call sign, spelled out: E1 is "E for excitatory, driver 1",
 *  not a name from the data (Ames 2026-11-11: "E1 E2 E3 are these names of
 *  cell type or what?"). */
function callSign(c: CellState): string {
  const k = c.key, n = k.slice(1);
  if (k === 'T') return 'T is for target: the cell to fire';
  if (k === 'S') return 'S is for Switch: the layer 2/3 cell that starts the chain';
  if (c.target) return `${k[0]} is for excitatory: driver ${n} of the gold cell, and here a target of its own`;
  if (k[0] === 'E') return `E is for excitatory: driver ${n} of the gold cell`;
  if (k[0] === 'F') return `F is for excitatory too: driver ${n} of E4`;
  if (k[0] === 'G') return 'G is for excitatory too: a cell the Gatekeeper also holds';
  if (k[0] === 'I') return `I is for inhibitory: ${ROLE[k] ? `the ${ROLE[k]}` : 'an interneuron'}`;
  return k;
}
/** The release's cell types, said plainly (aibs_metamodel_celltypes_v661). */
const TYPE_NAMES: Record<string, string> = {'23P': 'L2/3 pyramidal', '4P': 'L4 pyramidal', '5P-IT': 'L5 IT pyramidal', '5P-ET': 'L5 ET pyramidal', '5P-NP': 'L5 NP pyramidal',
  '6P-IT': 'L6 IT pyramidal', '6P-CT': 'L6 CT pyramidal', BC: 'basket', BPC: 'bipolar', MC: 'Martinotti', NGC: 'neurogliaform', OPC: 'OPC', oligo: 'oligodendrocyte', astrocyte: 'astrocyte', microglia: 'microglia', pericyte: 'pericyte'};
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** The cell's record, laid out as a readout: who it is, measured numbers,
 *  its wiring in this level, and where the numbers come from (scifi-ui's
 *  data-readout rule: one label, one number, one line of provenance; a unit
 *  never inside an uppercased label). */
/** What the card lights on the cell: the synapses onto it, the synapses it
 *  makes, every branch, the axon with a wave running out, the dendrite
 *  paths in; each on its own, any together (Ames 2026-11-11: "I want to be
 *  able to click either or and both"; "cable could just highlight all the
 *  branches"). */
type ShowWhat = 'synIn' | 'synOut' | 'cable' | 'axon' | 'in';
interface Readout { key: string; role: string; identity: string; sign: string; stats: {label: string; value: string; unit?: string; show?: ShowWhat}[]; wiring: {label: string; text: string; show?: ShowWhat}[];
  local: {key: string; color: V3; from: number; to: number}[]; partners?: {out: Partner[]; in: Partner[]}; provenance: string; }
/** What the scanned cell is showing on itself, from a click on its card. */
let showing = new Set<ShowWhat>();
function toggleShow(what: ShowWhat | 'synapses') {
  if (what === 'synapses') {   // Drives: every synapse, both ways
    const both = showing.has('synIn') && showing.has('synOut');
    if (both) { showing.delete('synIn'); showing.delete('synOut'); } else { showing.add('synIn'); showing.add('synOut'); }
  } else if (showing.has(what)) showing.delete(what); else showing.add(what);
  for (const el of document.querySelectorAll<HTMLElement>('.nge-sig-scan [data-show], .nge-sig-canopy [data-show]')) {
    const w = el.dataset.show;
    el.classList.toggle('on', w === 'synapses' ? showing.has('synIn') && showing.has('synOut') : showing.has(w as ShowWhat));
  }
  if (scanKey && (what === 'synIn' || what === 'synOut' || what === 'synapses') && (showing.has('synIn') || showing.has('synOut'))) frameSynapses(scanKey);
}
/** The camera drawn back (or in) so every synapse the card lights fits the
 *  view: the ones onto the cell, the ones it makes, or both. */
function frameSynapses(key: string) {
  const c = cells.get(key), nm = nmPerUnit(), cam = nm && camNow(nm), pr = c && parts.get(c.spec.root);
  if (!c || !nm || !cam || !pr) return;
  const pts: number[][] = [...(showing.has('synIn') ? pr.syn.in : []), ...(showing.has('synOut') ? pr.syn.out : [])];
  if (!pts.length) return;
  const mid: V3 = [0, 0, 0];
  for (const q of pts) { mid[0] += q[0] / pts.length; mid[1] += q[1] / pts.length; mid[2] += q[2] / pts.length; }
  let ex = 0, ey = 0;
  for (const q of pts) { const d = sub([q[0], q[1], q[2]], mid); ex = Math.max(ex, Math.abs(dot(d, cam.right))); ey = Math.max(ey, Math.abs(dot(d, cam.up))); }
  const r = threeDPanel()?.element?.getBoundingClientRect?.(), aspect = r && r.height > 0 ? r.width / r.height : 1.6;
  const frameNm = Math.max(120_000, 2.3 * ey, 2.3 * ex / aspect);
  glideSlow(freeLook(mid, frameNm, cam), frameNm / Math.min(nm[0], nm[1], nm[2]), 1.4);
}
/** For a driver's job line: the sparks it needs on its own to spike its target. */
function sparksLine(c: CellState): string {
  const d = drives(c);
  if (!d) return '';
  const need = sparksToFire(d.count, cells.get(d.post)!);
  if (!need) return ` Alone it cannot spike ${d.post}: pair it with another driver.`;
  return need === 1 ? ` One spark spikes ${d.post}.` : ` ${WORDS[need]} sparks, quickly, spike ${d.post}.`;
}
function readoutOf(c: CellState): Readout {
  const s = c.spec;
  const identity = `${s.label}${s.fine ? ` · ${s.fine}` : ''}${s.mtype ? ` · ${s.mtype}` : ''} · ${s.type === 'I' ? 'inhibitory' : 'excitatory'}`;
  const job = c.target ? `Target: fires at a charge of ${c.theta}. Each synapse that fires onto it adds 1, and the charge leaks away in about a second.`
    : c.gateNext !== null ? `Gatekeeper: pulses every ${c.gatePeriod} s, holds the targets down`
    : s.type === 'I' ? `${roleOf(c)}: quiets what it reaches`
    : `${roleOf(c)}: fires when your beam hits it.${sparksLine(c)}`;
  const stats: Readout['stats'] = [];
  // every synapse the cell makes and receives in the release (synapses_pni_2, materialization 1300)
  if (s.synIn !== undefined && s.synOut !== undefined) stats.push({label: 'synapses in', value: fmt(s.synIn), show: 'synIn'}, {label: 'synapses out', value: fmt(s.synOut), show: 'synOut'});
  stats.push({label: 'cable', value: fmt(s.cableUm), unit: 'µm', show: 'cable'}, {label: 'axon', value: fmt(s.axonUm), unit: 'µm', show: 'axon'});
  const wiring: Readout['wiring'] = [{label: 'Job', text: job}];
  // the level's cells it is wired to, synapses from each and onto each
  const local = new Map<string, {key: string; color: V3; from: number; to: number}>();
  for (const k of conns) {
    const other = k.pre === c.key ? k.post : k.post === c.key ? k.pre : null;
    const oc = other ? cells.get(other) : undefined;
    if (!other || !oc?.shown) continue;
    const row = local.get(other) ?? {key: other, color: oc.color, from: 0, to: 0};
    if (k.pre === c.key) row.to += k.count; else row.from += k.count;
    local.set(other, row);
  }
  return {key: c.key, role: roleOf(c), identity, sign: callSign(c), stats, wiring,
    local: [...local.values()].sort((a, b) => b.from + b.to - a.from - a.to), partners: s.partners,
    provenance: `MICrONS minnie65 · materialization 1300 · cell ${s.root}`};
}
/** The build-in's order for the lines of a card or the canopy, and the
 *  numbers counting up to their values. */
function buildIn(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.identity, .sign, .nge-sig-readouts li, .nge-sig-wiring, .nge-sig-chart .h, .nge-sig-chart .row, .prov').forEach((el, i) => el.style.setProperty('--i', String(i)));
  root.querySelectorAll<HTMLElement>('.nge-sig-chart .bar i').forEach((el, i) => el.style.setProperty('--i', String(i)));
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll<HTMLElement>('.nge-sig-readouts .n').forEach((el, i) => {
    const target = Number((el.dataset.n ?? '').replace(/,/g, ''));
    if (!isFinite(target)) return;
    const t0 = performance.now() + 180 + i * 55, dur = 750;
    const tick = () => {
      if (!el.isConnected) return;
      const q = clamp((performance.now() - t0) / dur, 0, 1), e = 1 - Math.pow(1 - q, 3);
      el.textContent = Math.round(target * e).toLocaleString('en-US');
      if (q < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/** The charts: the level's partners with a bar from each and to each, and
 *  the cell's partners across the release by type, to and from. */
function chartsHtml(r: Readout): string {
  let html = '';
  if (r.local.length) {
    const max = Math.max(1, ...r.local.map(x => Math.max(x.from, x.to)));
    const bar = (nn: number, cls: string, show: ShowWhat) => `<span class="bar ${cls}" data-show="${show}" title="Light them on the cell"><i style="width:${Math.round(nn / max * 100)}%"></i><em>${nn ? fmt(nn) : ''}</em></span>`;
    html += `<div class="nge-sig-chart local"><div class="h"><span>Local partners</span><span>from</span><span>to</span></div>${r.local.map(x =>
      `<div class="row"><b class="key" style="--c:rgb(${x.color.join(',')})">${esc(x.key)}</b>${bar(x.from, 'from', 'in')}${bar(x.to, 'to', 'axon')}</div>`).join('')}</div>`;
  }
  if (r.partners) {
    const list = (items: Partner[], cls: string) => {
      const typed = items.filter(x => x.type !== 'other').slice(0, 5), untyped = items.find(x => x.type === 'other');
      const rows = untyped ? [...typed, untyped] : typed;
      const max = Math.max(1, ...rows.map(x => x.n));
      return rows.map(x => `<div class="row"><span class="lbl">${esc(x.type === 'other' ? 'untyped' : TYPE_NAMES[x.type] ?? x.type)}</span><span class="bar ${cls}${x.type === 'other' ? ' untyped' : ''}"><i style="width:${Math.round(x.n / max * 100)}%"></i><em>${fmt(x.n)}</em></span></div>`).join('');
    };
    html += `<div class="nge-sig-chart drives"><div class="h" data-show="synapses" title="Light every synapse on the cell"><span>Drives</span></div><div class="two"><div><div class="sub">To</div>${list(r.partners.out, 'to')}</div><div><div class="sub">From</div>${list(r.partners.in, 'from')}</div></div></div>`;
  }
  return html;
}
function readoutParts(r: Readout) {
  return {
    id: `<b class="key">${esc(r.key)}</b><span class="role">${esc(r.role)}</span>`,
    identity: `<p class="identity">${esc(r.identity)}</p><p class="sign">${esc(r.sign)}</p>`,
    stats: `<ul class="nge-sig-readouts">${r.stats.map(x => `<li${x.show ? ` data-show="${x.show}" title="Light them on the cell"` : ''}><b><span class="n" data-n="${x.value}">${x.value}</span>${x.unit ? `<span class="u">${x.unit}</span>` : ''}</b><span class="k">${esc(x.label)}</span></li>`).join('')}</ul>`,
    wiring: `<dl class="nge-sig-wiring">${r.wiring.map(w => `<dt${w.show ? ` data-show="${w.show}"` : ''}>${esc(w.label)}</dt><dd${w.show ? ` data-show="${w.show}" title="Light them on the cell"` : ''}>${esc(w.text)}</dd>`).join('')}</dl>`,
    charts: chartsHtml(r),
    provenance: `<p class="prov">${esc(r.provenance)}<br>Click a bar, a number or Drives to light it on the cell.</p>`,
  };
}
/* ── the cockpit's canopy ── */
let canopyEl: HTMLElement | null = null;
/** The cockpit's blocks can be dragged where the player likes and stay
 *  there, kept as fractions of the canopy so a resized window keeps them in
 *  the same place (Ames 2026-11-12: "make it so I can drag and drop the box
 *  and it saves"). */
const CANOPY_POS_KEY = 'pyr.signal.canopy';
let canopyPos: Record<string, [number, number]> = {};
try { canopyPos = JSON.parse(localStorage.getItem(CANOPY_POS_KEY) || '{}') || {}; } catch { canopyPos = {}; }
let canopyDragged = false, canopySized = '';
function canopyDrag(block: HTMLElement, name: string) {
  let start: {x: number; y: number; left: number; top: number} | null = null, moved = false;
  block.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.target as HTMLElement | null)?.closest?.('button')) return;
    start = {x: e.clientX, y: e.clientY, left: block.offsetLeft, top: block.offsetTop}; moved = false;
    try { block.setPointerCapture(e.pointerId); } catch { /* no capture */ }
  });
  block.addEventListener('pointermove', e => {
    if (!start || !canopyEl) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;   // a click stays a click
    moved = true; block.classList.add('dragging');
    const w = canopyEl.clientWidth, h = canopyEl.clientHeight;
    block.style.left = `${clamp(start.left + dx, 0, Math.max(0, w - block.offsetWidth))}px`;
    block.style.top = `${clamp(start.top + dy, 0, Math.max(0, h - block.offsetHeight))}px`;
    block.style.right = 'auto'; block.style.bottom = 'auto';
  });
  const end = (e: PointerEvent) => {
    if (!start) return;
    try { block.releasePointerCapture(e.pointerId); } catch { /* none */ }
    start = null; block.classList.remove('dragging');
    if (!moved || !canopyEl) return;
    canopyDragged = true; setTimeout(() => { canopyDragged = false; }, 0);   // the click that follows a drag is not a click on a bar
    const w = Math.max(1, canopyEl.clientWidth), h = Math.max(1, canopyEl.clientHeight);
    canopyPos[name] = [block.offsetLeft / w, block.offsetTop / h];
    try { localStorage.setItem(CANOPY_POS_KEY, JSON.stringify(canopyPos)); } catch { /* not kept */ }
  };
  block.addEventListener('pointerup', end); block.addEventListener('pointercancel', end);
}
/** The saved places, once the canopy has its size, and again when it changes or is refilled. */
function placeCanopyBlocks(force = false) {
  if (!canopyEl) return;
  const w = canopyEl.clientWidth, h = canopyEl.clientHeight, key = `${w}x${h}`;
  if (!force && key === canopySized) return;
  canopySized = key;
  for (const block of canopyEl.querySelectorAll<HTMLElement>('.block')) {
    const at = canopyPos[block.dataset.name || ''];
    if (!at || block.classList.contains('dragging')) continue;
    block.style.left = `${clamp(at[0] * w, 0, Math.max(0, w - block.offsetWidth))}px`;
    block.style.top = `${clamp(at[1] * h, 0, Math.max(0, h - block.offsetHeight))}px`;
    block.style.right = 'auto'; block.style.bottom = 'auto';
  }
}
function showCanopy() {
  if (canopyEl) return;
  canopyEl = document.createElement('div');
  canopyEl.className = 'ng-extend nge-sig-canopy';
  canopyEl.innerHTML = `<i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
    <div class="top"><i></i>Cockpit · Signal Control<span class="sub"></span></div>
    <svg class="lead" aria-hidden="true"><line stroke="rgba(160,225,255,0.7)" stroke-width="1" stroke-dasharray="3 3"/></svg>
    <svg class="reticle" viewBox="0 0 120 120" aria-hidden="true"><g class="ring"><circle cx="60" cy="60" r="26" fill="none" stroke="var(--c, rgba(53,181,255,0.55))" stroke-width="1.2" stroke-dasharray="30 11"/></g><circle cx="60" cy="60" r="1.8" fill="rgba(216,238,255,0.9)"/><path d="M60 22 v12 M60 86 v12 M22 60 h12 M86 60 h12" stroke="var(--c, rgba(53,181,255,0.75))" stroke-width="1.4"/><path d="M42 42 l6 6 M78 42 l-6 6 M42 78 l6 -6 M78 78 l-6 -6" stroke="rgba(53,181,255,0.3)" stroke-width="1"/></svg>
    <div class="block id" data-name="id"></div><div class="block nums" data-name="nums"></div><div class="block wire" data-name="wire"></div><div class="block provenance" data-name="provenance"></div>
    <button type="button" class="nge-sig-x" aria-label="Close">${X_SVG}</button>`;
  document.body.appendChild(canopyEl);
  (canopyEl.querySelector('.nge-sig-x') as HTMLButtonElement).onclick = () => endVisit();
  canopyEl.onclick = e => { if (canopyDragged) return; const t = (e.target as HTMLElement | null)?.closest?.('[data-show]') as HTMLElement | null; if (t) toggleShow(t.dataset.show as ShowWhat | 'synapses'); };
  canopySized = '';
  canopyEl.querySelectorAll<HTMLElement>('.block').forEach(b => canopyDrag(b, b.dataset.name || ''));
  requestAnimationFrame(() => canopyEl?.classList.add('nge-sig-canopy--on'));
}
function hideCanopy() { canopyEl?.remove(); canopyEl = null; }
function fillCanopy(c: CellState, parts: ReturnType<typeof readoutParts>) {
  if (!canopyEl) showCanopy();
  const el = canopyEl!;
  el.style.setProperty('--c', `rgb(${c.color.join(',')})`);
  el.querySelector('.id')!.innerHTML = `<div class="head">${parts.id}</div>${parts.identity}`;
  el.querySelector('.nums')!.innerHTML = parts.stats + parts.provenance;
  el.querySelector('.wire')!.innerHTML = parts.wiring + parts.charts;
  el.querySelector('.provenance')!.innerHTML = '';
  buildIn(el);
  el.classList.add('nge-sig-canopy--lock');
  placeCanopyBlocks(true);
}
function clearCanopy() { canopyEl?.classList.remove('nge-sig-canopy--lock'); canopyEl?.style.removeProperty('--c'); }
/** The canopy each frame: over the free part of the 3D view, the reticle on
 *  the scanned cell body (else at the centre), a leader from it to the
 *  identity block. */
function placeCanopy() {
  if (!canopyEl) return;
  const r = threeDPanel()?.element?.getBoundingClientRect?.();
  if (!r) { canopyEl.style.display = 'none'; return; }
  canopyEl.style.display = '';
  const hud = panel?.getBoundingClientRect();
  const left = sideHud() && hud ? hud.right + 12 : r.left + 8, top = r.top + 8, right = r.right - 8;
  const bottom = !sideHud() && hud ? Math.min(r.bottom - 8, hud.top - 8) : r.bottom - 8;
  canopyEl.style.left = `${left}px`; canopyEl.style.top = `${top}px`;
  canopyEl.style.width = `${Math.max(100, right - left)}px`; canopyEl.style.height = `${Math.max(100, bottom - top)}px`;
  placeCanopyBlocks();
  const sub = canopyEl.querySelector('.sub')!, want = phase === 'playing' ? '' : adapt('click a cell to scan it');
  if (sub.textContent !== want) sub.textContent = want;
  const ret = canopyEl.querySelector('.reticle') as HTMLElement, lead = canopyEl.querySelector('.lead line') as SVGLineElement;
  const c = scanKey ? cells.get(scanKey) : null;
  const s = c && toScreen(c.spec.soma);
  if (s) {
    ret.style.left = `${s[0] - left}px`; ret.style.top = `${s[1] - top}px`;
    const id = canopyEl.querySelector('.id') as HTMLElement;
    lead.setAttribute('x1', String(s[0] - left)); lead.setAttribute('y1', String(s[1] - top - 36));
    lead.setAttribute('x2', String(id.offsetLeft + id.offsetWidth / 2)); lead.setAttribute('y2', String(id.offsetTop + id.offsetHeight));
    lead.style.display = '';
  } else {
    ret.style.left = '50%'; ret.style.top = '50%';
    lead.style.display = 'none';
  }
}
function showScan(key: string, full = false) {
  const c = cells.get(key);
  if (!c) return;
  hideScan(true);   // the spotlight stays: the card used to take it away as it opened (Ames 2026-11-12: "then all the others fade back so I can't see")
  scanKey = key;
  const parts = readoutParts(readoutOf(c));
  flashes.push({p: c.spec.soma, at: now, life: 0.6, rgb: [0.7, 0.95, 1], size: 20_000});
  if (view === 'cockpit' && !full) { fillCanopy(c, parts); return; }
  scanEl = document.createElement('div');
  scanEl.className = 'ng-extend nge-sig-scan';
  scanEl.style.setProperty('--c', `rgb(${c.color.join(',')})`);
  scanEl.innerHTML = `<svg aria-hidden="true"><defs><linearGradient id="nge-sig-scan-g" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff0cc" stop-opacity="0.5"/><stop offset="1" stop-color="#ffc24a" stop-opacity="0.04"/></linearGradient></defs>
    <polygon class="cone"/><line class="pointer" stroke="rgba(255,214,140,0.8)" stroke-width="1" stroke-dasharray="3 3"/><circle class="dot" r="4" fill="#ffe3a6"/><circle class="lens" r="3.5" fill="#fff6e0"/></svg>
    <div class="nge-sig-scan-box"><header class="nge-sig-scan-head"><span class="ic"></span>${parts.id}<button type="button" class="nge-sig-x" aria-label="Close">${X_SVG}</button></header>${parts.identity}${parts.stats}${parts.wiring}${parts.charts}${parts.provenance}</div>`;
  document.body.appendChild(scanEl);
  (scanEl.querySelector('.nge-sig-x') as HTMLButtonElement).onclick = () => endVisit();
  // the card drags, to clear the cells it covers (Ames 2026-11-11: "I want
  // to be able to move the box bc it covers up the neurons some")
  const box = scanEl.querySelector('.nge-sig-scan-box') as HTMLElement;
  box.onpointerdown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement | null)?.closest?.('button, [data-show]')) return;
    e.preventDefault(); e.stopPropagation();
    const r = box.getBoundingClientRect();
    const start = {x: e.clientX, y: e.clientY, left: r.left, top: r.top};
    let moved = false;
    try { box.setPointerCapture(e.pointerId); } catch { /* the moves still reach the box while the pointer is over it */ }
    box.onpointermove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      box.classList.add('dragging');
      scanPin = [start.left + dx, start.top + dy];
    };
    box.onpointerup = box.onpointercancel = () => { box.classList.remove('dragging'); box.onpointermove = box.onpointerup = box.onpointercancel = null; };
  };
  box.onclick = e => { const t = (e.target as HTMLElement | null)?.closest?.('[data-show]') as HTMLElement | null; if (t) toggleShow(t.dataset.show as ShowWhat | 'synapses'); };
  buildIn(box);
  if (phone()) {
    // on a phone the card opens compact: the name and the two synapse counts
    // (tap one to light them, the view stays in sight), and More for the
    // rest (Ames 2026-11-12: "maybe with that button it loads synapse counts
    // at top, and a More button which gives me the rest of the cell's data")
    scanEl.classList.add('nge-sig-scan--compact');
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'nge-sig-quiet nge-sig-more'; more.textContent = 'More ›';
    more.onclick = () => { const compact = scanEl?.classList.toggle('nge-sig-scan--compact'); more.textContent = compact ? 'More ›' : 'Less ‹'; more.blur(); };
    box.appendChild(more);
  }
  requestAnimationFrame(() => scanEl?.classList.add('nge-sig-scan--in'));
}
function hideScan(keepLit = false) {
  scanEl?.remove();
  scanEl = null; scanKey = null; scanPin = null; showing = new Set();
  if (scanLit && !keepLit) { scanLit = null; unfadeScan(); refreshSkip(); }
  clearGems();
  clearCanopy();
}
/** The card each frame: docked at the top right of the view (Ames
 *  2026-11-11: "put the box here"), or where it was dragged to; the cone
 *  from the ship's nose when the ship is on screen; always clear of the HUD. */
function placeScan() {
  if (!scanEl || !scanKey) return;
  const c = cells.get(scanKey);
  const s = c && toScreen(c.spec.soma);
  const r = threeDPanel()?.element?.getBoundingClientRect?.();
  if (!s || !r) { scanEl.style.display = 'none'; return; }
  scanEl.style.display = '';
  const box = scanEl.querySelector('.nge-sig-scan-box') as HTMLElement;
  const cone = scanEl.querySelector('polygon')!, grad = scanEl.querySelector('linearGradient')!;
  const line = scanEl.querySelector('line')!, dot = scanEl.querySelector('.dot')!, lens = scanEl.querySelector('.lens') as SVGElement;
  const hud = panel?.getBoundingClientRect();
  const ship = toScreen(shipNose());
  const bw = box.offsetWidth, bh = box.offsetHeight;
  const onScreen = !!ship && ship[0] > r.left && ship[0] < r.right && ship[1] > r.top + 40 && ship[1] < r.bottom;
  let bx: number, by: number;
  if (scanPin) [bx, by] = scanPin;
  else { bx = r.right - bw - Math.max(24, r.width * 0.15); by = r.top + Math.max(24, r.height * 0.11); }
  bx = clamp(bx, r.left + 10, r.right - bw - 10);
  by = clamp(by, r.top + 10, r.bottom - bh - 16);
  if (!scanPin && hud && bx < hud.right + 10 && bx + bw > hud.left - 10 && by < hud.bottom + 10 && by + bh > hud.top - 10) {
    // off the HUD: to its right, or above it when it lies along the bottom
    if (sideHud()) bx = Math.min(hud.right + 12, r.right - bw - 10); else by = Math.max(r.top + 10, hud.top - bh - 12);
  }
  box.style.left = `${bx}px`; box.style.top = `${by}px`;
  if (onScreen) {
    const [sx, sy] = ship!;
    // the cone's base: the card's edge that faces the ship
    const base = sy > by + bh ? [bx + 6, by + bh, bx + bw - 6, by + bh] : sy < by ? [bx + 6, by, bx + bw - 6, by]
      : sx < bx ? [bx, by + 6, bx, by + bh - 6] : [bx + bw, by + 6, bx + bw, by + bh - 6];
    cone.setAttribute('points', `${sx},${sy} ${base[0]},${base[1]} ${base[2]},${base[3]}`);
    grad.setAttribute('x1', String(sx)); grad.setAttribute('y1', String(sy));
    grad.setAttribute('x2', String((base[0] + base[2]) / 2)); grad.setAttribute('y2', String((base[1] + base[3]) / 2));
    lens.setAttribute('cx', String(sx)); lens.setAttribute('cy', String(sy));
    (cone as SVGElement).style.display = lens.style.display = '';
  } else {
    (cone as SVGElement).style.display = lens.style.display = 'none';
  }
  // the line to the cell body leaves from the card's edge that faces it
  const lx = s[1] > by + bh || s[1] < by ? clamp(s[0], bx, bx + bw) : s[0] < bx ? bx : bx + bw;
  const ly = s[1] > by + bh ? by + bh : s[1] < by ? by : clamp(s[1], by, by + bh);
  line.setAttribute('x1', String(s[0])); line.setAttribute('y1', String(s[1]));
  line.setAttribute('x2', String(lx)); line.setAttribute('y2', String(ly));
  dot.setAttribute('cx', String(s[0])); dot.setAttribute('cy', String(s[1]));
}
/** Between levels the beams still fly and land: the scan, and the glow. */
function idleStep(dt: number) {
  now += dt;
  for (const b of beams) {
    if (b.applied || now < b.at + landS(b)) continue;
    b.applied = true;
    if (b.scan) showScan(b.cell);
  }
  beams = beams.filter(b => now < b.at + landS(b) + 0.25);
  sparks = sparks.filter(s => now < s.end + 0.3);
  flashes = flashes.filter(f => now < f.at + f.life);
}

function stepModel(dt: number) {
  now += dt;
  charges = Math.min(MAX_CHARGES, charges + dt / REGEN_S);
  // The leak for this frame first, so what arrives in this frame counts in
  // full toward the threshold below (on a slow frame the leak is large).
  const kE = Math.exp(-dt / TAU_E), kI = Math.exp(-dt / TAU_I);
  for (const c of cells.values()) if (c.shown) { c.e *= kE; c.i *= kI; }
  // beams land
  for (const b of beams) {
    if (b.applied || now < b.at + landS(b)) continue;
    b.applied = true;
    if (b.scan) { showScan(b.cell); continue; }
    const c = cells.get(b.cell)!;
    if (b.hush) {
      c.hushedUntil = now + HUSH_S;
      if (c.gateNext !== null) c.gateNext = now + HUSH_S + c.gatePeriod * 0.5;
      c.e = 0; c.i = 0;
      paint(c, true);
      flashes.push({p: c.spec.soma, at: now, life: 0.6, rgb: [0.7, 0.5, 1], size: 20_000});
      coach('hushed');
    } else if (now < c.refractoryUntil && now >= c.hushedUntil) queued.push({cell: b.cell, at: c.refractoryUntil});
    else spike(b.cell, true);
  }
  const ready = queued.filter(q => q.at <= now);
  queued = queued.filter(q => q.at > now);
  for (const q of ready) spike(q.cell, true);
  // A target that was fed but did not fire: say what went wrong, now and then.
  for (const [key, at] of pendingExcitation) {
    if (now - at < 2.5) continue;
    pendingExcitation.delete(key);
    if (now - lastMissCoach > 8) { lastMissCoach = now; coach('miss'); }
  }
  updateGoWait();
  beams = beams.filter(b => now < b.at + landS(b) + 0.25);
  // spikes arrive
  const due = arrivals.filter(a => a.at <= now);
  arrivals = arrivals.filter(a => a.at > now);
  for (const a of due) arrive(a);
  recentIn = recentIn.filter(r => now - r.at < 4);
  // plastic synapses settle back slowly when unused
  if (level.plastic) for (const k of conns) if (k.w && k.w > 1) k.w = 1 + (k.w - 1) * Math.exp(-dt / 40);
  sparks = sparks.filter(s => now < s.end + 0.3);
  flashes = flashes.filter(f => now < f.at + f.life);
  // thresholds, and the Gatekeeper's clock
  for (const c of cells.values()) {
    if (!c.shown) continue;
    if (c.dimmed && now >= c.hushedUntil && !tourDim.has(c.key) && !(scanLit && c.key !== scanLit)) paint(c, false);
    if (now < c.hushedUntil) continue;
    if (c.gateNext !== null) { if (now >= c.gateNext) spike(c.key); continue; }
    if (potential(c) >= c.theta && now >= c.refractoryUntil) spike(c.key);
  }
  if (now >= level.timeS && phase === 'playing') showResult(false);
}

/* ── drawing: everything glows through one buffer ── */
function writeGlow(cam: {right: V3; up: V3; toEye: V3}) {
  const nm = nmPerUnit();
  if (!nm) return;
  let n = 0;
  const put = (p: V3, rgba: [number, number, number, number], size: number) => {
    if (n >= MAX_GLOW) return;
    glow.positions[n * 3] = p[0] / nm[0]; glow.positions[n * 3 + 1] = p[1] / nm[1]; glow.positions[n * 3 + 2] = p[2] / nm[2];
    glow.colors.set(rgba, n * 4);
    glow.sizesNm[n] = size;
    n++;
  };
  // target reticles: a slow ring of light around each target's soma; the
  // ring and the soma turn violet while a pulse holds the cell down, so the
  // Gatekeeper's hold is seen on the cell itself (Ames 2026-11-08: "it's not
  // clear when/why other cells are making it so I have to have a gap")
  const spin = performance.now() / 1000;
  const VIOLET: V3 = [0.7, 0.45, 1];
  for (const c of cells.values()) {
    if (!c.shown || !c.target) continue;
    // the hold, from the moment the pulse is on the wire to it until the
    // inhibition has leaked away (Ames 2026-11-11: "it is not clear when the
    // gatekeeper is inhibiting the target"): the ring turns violet, a second,
    // wider violet ring closes around the cell body, and the body itself is
    // shrouded once the pulse has landed
    const held = holdOn(c);
    const ring = mix([1, 0.76, 0.3], VIOLET, held);
    const R = phone() ? viewNm * 0.045 : 14_000;
    for (let k = 0; k < 14; k++) {
      const a = spin * 0.9 + k / 14 * Math.PI * 2;
      const p = add(c.spec.soma, add(mul(cam.right, Math.cos(a) * R), mul(cam.up, Math.sin(a) * R)));
      put(p, [ring[0], ring[1], ring[2], 0.35 + 0.25 * Math.sin(a * 3 + spin * 4)], 2200);
    }
    if (held > 0.05) {
      const R2 = R * (1.9 - 0.3 * held);
      for (let k = 0; k < 12; k++) {
        const a = -spin * 1.4 + k / 12 * Math.PI * 2;
        put(add(c.spec.soma, add(mul(cam.right, Math.cos(a) * R2), mul(cam.up, Math.sin(a) * R2))), [VIOLET[0], VIOLET[1], VIOLET[2], 0.7 * held], 3200);
      }
      put(c.spec.soma, [VIOLET[0], VIOLET[1], VIOLET[2], 0.55 * clamp(c.i / 3, 0, 1)], 20_000);
    }
    // and a soft pulse when it is close to firing
    const q = clamp(potential(c) / c.theta, 0, 1);
    if (q > 0.3) put(c.spec.soma, [1, 0.8, 0.4, 0.25 * q], 12_000 + 8000 * q);
  }
  // the Gatekeeper winds up before each pulse: a violet glow that grows over
  // the last 1.2 s, so the pulse is seen coming
  for (const c of cells.values()) {
    if (!c.shown || c.gateNext === null || now < c.hushedUntil) continue;
    const q = clamp(1 - (c.gateNext - now) / 1.2, 0, 1);
    if (q > 0) put(c.spec.soma, [VIOLET[0], VIOLET[1], VIOLET[2], 0.06 + 0.34 * q * q], 9000 + 9000 * q);
  }
  // the cells to click now: a quick ring of white light around each
  for (const key of hints) {
    const c = cells.get(key);
    if (!c?.shown) continue;
    const R = phone() ? viewNm * 0.055 : 17_000, pulse = 0.5 + 0.5 * Math.sin(spin * 6);
    for (let k = 0; k < 10; k++) {
      const a = -spin * 1.8 + k / 10 * Math.PI * 2;
      put(add(c.spec.soma, add(mul(cam.right, Math.cos(a) * R), mul(cam.up, Math.sin(a) * R))), [0.85, 1, 1, 0.45 + 0.4 * pulse], 2600);
    }
  }
  // a spark waiting on a resting cell: a gold ember on the soma until it fires
  for (const q of queued) {
    const c = cells.get(q.cell);
    if (c?.shown) put(c.spec.soma, [1, 0.82, 0.35, 0.55], 9000);
  }
  // hushed cells: a violet shroud
  for (const c of cells.values()) {
    if (!c.shown || now >= c.hushedUntil) continue;
    const k = (c.hushedUntil - now) / HUSH_S;
    put(c.spec.soma, [0.55, 0.35, 0.9, 0.35 * k + 0.1], 16_000);
  }
  // sparks along the paths, with a trail
  for (const s of sparks) {
    const q = clamp((now - s.start) / (s.end - s.start), 0, 1);
    const head = q * s.r.length, sc = s.scale ?? 1;
    const rgb: V3 = s.inhibitory ? [0.8, 0.55, 1] : [1, 0.95, 0.7];
    const gone = now < s.end ? 1 : Math.max(0, 1 - (now - s.end) / 0.3);
    for (let j = 0; j < 10; j++) {
      const d = head - j * 2200 * sc;
      if (d < 0) break;
      const fade = Math.pow(1 - j / 10, 1.5) * gone;
      put(along(s.r, d), [rgb[0], rgb[1], rgb[2], 0.9 * fade], (j === 0 ? 4200 : 2600 * (1 - j / 10) + 900) * sc);
    }
    if (sc > 1) {   // a large one wears a halo and a white-hot core, so it reads against a lit cell
      const h = along(s.r, head);
      put(h, [rgb[0], rgb[1], rgb[2], 0.3 * gone], 13_000 * sc);
      put(h, [1, 1, 0.97, 0.95 * gone], 2600 * sc);
    }
  }
  // what the card's clicked row names, on the cell itself: its synapses with
  // the other cells here (the marks the data has, up to ten a connection),
  // the axon paths out of it with pulses running out, or the dendrite paths
  // in with pulses running in
  // waves over an arbor: a band of light at one path distance from the soma,
  // on every branch at once, fading behind the front
  const tNow = performance.now() / 1000;
  waves = waves.filter(w => tNow < w.start + w.seconds + 0.3);
  for (const w of waves) {
    const pr = parts.get(w.root);
    if (!pr) continue;
    const pts = pr.arbor[w.part], maxD = (w.part === 'axon' ? pr.axonMax : pr.dendMax) || 1;
    const q = clamp((tNow - w.start) / w.seconds, 0, 1);
    const front = w.inward ? maxD * (1 - q) : maxD * q, band = clamp(maxD * 0.05, 14_000, 70_000);
    for (const p of pts) {
      const gap = w.inward ? p[3] - front : front - p[3];
      if (gap < -band * 0.25 || gap > band) continue;
      const k = gap < 0 ? 1 + gap / (band * 0.25) : 1 - gap / band;
      put([p[0], p[1], p[2]], [w.rgb[0], w.rgb[1], w.rgb[2], 0.75 * k], 2600 + 2200 * k);
    }
  }
  // a target's burst: sparks out from the cell body, a ring widening, the body lit
  bursts = bursts.filter(b => tNow < b.at + b.life);
  for (const b of bursts) {
    const age = tNow - b.at, q = age / b.life, sc = b.scale ?? 1;
    if (b.sparkle) {
      // particles flying out and slowing, each twinkling at its own beat, the body lit
      b.dirs.forEach((d, i) => {
        const tw = 0.55 + 0.45 * Math.sin(tNow * 23 + i * 1.7);
        put(add(b.p, mul(d, 24_000 * sc * age * (1.5 - q))), [b.rgb[0], b.rgb[1], b.rgb[2], 0.95 * (1 - q) * tw], (1500 + 1500 * tw) * sc * (1 - q * 0.6));
      });
      put(b.p, [1, 0.98, 0.9, 0.45 * (1 - q)], 12_000 * sc * (1 - q * 0.5));
      continue;
    }
    for (const d of b.dirs) put(add(b.p, mul(d, 30_000 * age * (1.4 - q))), [b.rgb[0], b.rgb[1], b.rgb[2], 0.9 * (1 - q)], 3400 * (1 - q) + 800);
    const R = 8000 + 40_000 * q;
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; put(add(b.p, add(mul(cam.right, Math.cos(a) * R), mul(cam.up, Math.sin(a) * R))), [b.rgb[0], b.rgb[1], b.rgb[2], 0.6 * (1 - q)], 2600); }
    put(b.p, [1, 0.95, 0.7, 0.8 * (1 - q)], 30_000 * (1 - q * 0.5));
  }
  if (trail.length) {
    const tNow = performance.now() / 1000;
    trail = trail.filter(k => tNow - k.at < k.life);
    for (const k of trail) {
      const age = tNow - k.at, q = age / k.life;
      put(add(k.p, mul(k.v, age)), [0.55 + 0.3 * q, 0.85, 1, 0.5 * (1 - q)], shipLenNm * (0.025 + 0.07 * q));
    }
  }
  if (showing.size && scanKey) {
    const t = performance.now() / 1000;
    const sc = cells.get(scanKey), pr = sc && parts.get(sc.spec.root);
    if (pr) {
      // every synapse the cell receives (gold) and makes (cyan) in the release
      // at least a few pixels each whatever the zoom (zoomed out to a whole cell they were under two), in colours no cell wears: magenta in, mint out
      const vh = threeDPanel()?.element?.clientHeight || 900, nmPx = ((viewerNow()?.projectionScale?.value ?? 30_000) * Math.min(nm[0], nm[1], nm[2])) / vh;
      const dotNm = Math.max(1700, nmPx * 3.6);
      const all = (list: number[][], rgb: V3) => { for (let j = 0; j < list.length; j++) { const p = list[j]; put([p[0], p[1], p[2]], [rgb[0], rgb[1], rgb[2], 0.55 + 0.25 * Math.sin(t * 3 + j * 0.7)], dotNm); } };
      if (showing.has('synIn')) all(pr.syn.in, [1, 0.45, 0.85]);
      if (showing.has('synOut')) all(pr.syn.out, [0.55, 1, 0.75]);
      if (showing.has('cable')) {
        // every branch: the cell is lit whole (the haze skips it), with a faint dust of light along the axon (cyan) and the dendrites (gold); no wave
        const dust = (pts: number[][], rgb: V3) => { for (let j = 0; j < pts.length; j += 3) put([pts[j][0], pts[j][1], pts[j][2]], [rgb[0], rgb[1], rgb[2], 0.1 + 0.05 * Math.sin(t * 2 + j * 0.3)], 1800); };
        dust(pr.arbor.axon, [0.6, 0.95, 1]); dust(pr.arbor.dend, [1, 0.85, 0.4]);
      }
    }
    const arborAxon = !!(pr && showing.has('axon') && pr.arbor.axon.length);
    if (pr && arborAxon) {
      // the whole axon, faint, and a wave running out from the soma down every branch, over and over
      const pts = pr.arbor.axon, maxD = pr.axonMax || 1;
      for (let j = 0; j < pts.length; j += 5) put([pts[j][0], pts[j][1], pts[j][2]], [0.6, 0.95, 1, 0.14], 2000);
      const front = (t * SPEED_UM_S * 1000) % (maxD * 1.3), band = clamp(maxD * 0.04, 15_000, 60_000);   // at the conduction speed (Ames 2026-11-11: "pulsing VERY quickly")
      for (const p of pts) { const gap = front - p[3]; if (gap < 0 || gap > band) continue; const k2 = 1 - gap / band; put([p[0], p[1], p[2]], [1, 1, 1, 0.9 * k2], 2600 + 2000 * k2); }
    }
    for (const k of conns) {
      const out = k.pre === scanKey, inn = k.post === scanKey;
      if (!(out || inn) || !cells.get(out ? k.post : k.pre)?.shown) continue;
      if ((out && showing.has('synOut')) || (inn && showing.has('synIn'))) {
        const rgb: V3 = out ? [0.6, 0.95, 1] : [1, 0.85, 0.4];
        for (const [j, p] of k.synapses.entries()) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 4 + j);
          put(p, [rgb[0], rgb[1], rgb[2], 0.5 + 0.4 * pulse], 4000 + 1500 * pulse);
          put(p, [rgb[0], rgb[1], rgb[2], 0.18], 10_000);
        }
      }
      if ((!arborAxon && showing.has('axon') && out) || (showing.has('in') && inn)) {
        const path = out ? k.axon : k.dendrite;
        const r = route(path), rgb: V3 = out ? [0.6, 0.95, 1] : [1, 0.85, 0.4];
        const N = Math.max(8, Math.min(80, Math.round(r.length / 2500)));
        for (let j = 0; j <= N; j++) put(along(r, r.length * j / N), [rgb[0], rgb[1], rgb[2], 0.3], 2200);
        for (let j = 0; j < 2; j++) {
          const q = ((t * 0.3 + j / 2) % 1) * r.length;
          put(along(r, q), [1, 1, 1, 0.9], 4200);
          put(along(r, Math.max(0, q - 3000)), [rgb[0], rgb[1], rgb[2], 0.5], 3200);
        }
      }
    }
  }
  // the scanner: while the ship reads a cell, a thin cyan beam from its nose
  // sweeps across the cell body, a pulse running down it, and the body
  // shimmers (Ames 2026-11-11: "the ship should have like a little scanner beam")
  if (visit?.fired && scanEl) {
    const c = cells.get(visit.key);
    if (c?.shown) {
      const t = performance.now() / 1000;
      const from = shipNose(), to = add(add(add(c.spec.soma, mul(cam.toEye, SOMA_R_NM * 0.8)), mul(cam.right, Math.sin(t * 2.2) * 6000)), mul(cam.up, Math.cos(t * 1.7) * 4500));
      const N = 40;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const wave = 0.5 + 0.5 * Math.sin((u * 3 - t * 1.6) * Math.PI * 2);
        put(mix(from, to, u), [0.6, 0.95, 1, 0.1 + 0.3 * wave * wave], 1200 + 1400 * wave);
      }
      put(to, [0.7, 0.97, 1, 0.3], 7000);
      put(c.spec.soma, [0.7, 0.97, 1, 0.18 + 0.1 * Math.sin(t * 5)], 14_000);
    }
  }
  // the beams: a line of light from the ship's nose, its head racing to the cell
  for (const b of beams) {
    const q = clamp((now - b.at) / landS(b), 0, 1);
    const after = Math.max(0, now - b.at - landS(b));
    const fade = Math.max(0, 1 - after / 0.25);
    const rgb: V3 = b.scan ? [0.6, 0.95, 1] : b.hush ? [0.7, 0.45, 1] : [1, 0.82, 0.35];
    if (!b.hush && !b.scan) {
      // a spark: a friendly stream of particles from the nose, a gentle helix
      // flowing to the cell (nothing shot at it), and the cell lighting up
      // over the beam's time in its own colour with a white-hot core, then
      // its spike (Ames 2026-11-12: "a particle beam that looks friendly")
      const c = cells.get(b.cell), col: V3 = c ? [c.color[0] / 255, c.color[1] / 255, c.color[2] / 255] : rgb;
      const d = sub(b.to, b.from), L = len(d);
      if (L > 1) {
        const dir = mul(d, 1 / L), side = norm(cross(dir, cam.toEye)), lift = norm(cross(side, dir));
        const age = now - b.at, N2 = 40, rad = Math.max(2500, L * 0.012), dotNm2 = Math.max(1800, L * 0.0075);
        for (let k = 0; k < N2; k++) {
          const u = (k / N2 + age / landS(b) * 0.85) % 1;   // flowing toward the cell, behind the stream's front
          if (u > q) continue;
          const ph = k * 1.9 + age * 8, rr = rad * (1 - u * 0.55);
          const pp = add(add(add(b.from, mul(dir, u * L)), mul(side, Math.cos(ph) * rr)), mul(lift, Math.sin(ph) * rr));
          const warm = k % 5 === 0;
          put(pp, warm ? [1, 0.92, 0.65, 0.85 * fade] : [0.62, 0.9, 1, 0.7 * fade], dotNm2 * (0.75 + 0.35 * Math.sin(ph * 1.3)));
        }
      }
      const swell = q * q;
      put(b.to, [col[0], col[1], col[2], 0.45 * swell * fade], 34_000 * (0.4 + 0.6 * swell));
      put(b.to, [1, 0.97, 0.85, 0.9 * swell * fade], 7000 + 15_000 * swell);
      continue;
    }
    if (b.hush) {
      // the Hush: a slow, wide violet ribbon from the ship's nose, wavering
      // as it goes, its soft head settling over the cell
      const tt = performance.now() / 1000, N2 = 40;
      for (let k = 0; k <= N2; k++) {
        const u = k / N2;
        if (u > q + 0.01) break;
        const sway = Math.sin(u * 9 - tt * 6) * 2600 * (1 - u * 0.5), lift = Math.cos(u * 7 + tt * 4) * 1800;
        const pp = add(add(mix(b.from, b.to, u), mul(cam.right, sway)), mul(cam.up, lift));
        const nearHead = Math.exp(-Math.pow((q - u) * 6, 2));
        put(pp, [0.62, 0.42, 1, (0.1 + 0.35 * nearHead) * fade], 3200 + 5000 * nearHead);
      }
      put(mix(b.from, b.to, q), [0.75, 0.55, 1, 0.5 * fade], 16_000 + 10_000 * q);
      if (q >= 1) put(b.to, [0.7, 0.5, 1, 0.7 * fade], 26_000);
      continue;
    }
    const N = 48;
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      if (u > q + 0.02) break;
      const p = mix(b.from, b.to, u);
      const nearHead = Math.exp(-Math.pow((q - u) * 9, 2));
      put(p, [rgb[0], rgb[1], rgb[2], (0.18 + 0.75 * nearHead) * fade], 1500 + 3000 * nearHead);
    }
    if (q >= 1) put(b.to, [rgb[0], rgb[1], rgb[2], 0.8 * fade], 18_000 * (1 - fade * 0.4));
  }
  // flashes: somas firing, synapses receiving
  for (const f of flashes) {
    const k = clamp((now - f.at) / f.life, 0, 1);
    put(f.p, [f.rgb[0], f.rgb[1], f.rgb[2], 0.9 * Math.pow(1 - k, 1.4)], f.size * (0.6 + 0.9 * k));
  }
  if (holoMode) {
    // the low-poly look: each cell's arbors as a dust of light in its colour
    // (brighter lit whole or scanned, faint dimmed), every few points so the
    // whole level fits the budget, and the wires between the cells as beaded
    // lines in the sending cell's colour
    shadeSomaProps();
    let total = 0;
    for (const c of cells.values()) { const pr = c.shown ? parts.get(c.spec.root) : undefined; if (pr) total += pr.arbor.axon.length + pr.arbor.dend.length; }
    const every = Math.max(1, Math.ceil(total / 9000)), dot = Math.max(2600, viewNm * 0.0065);
    for (const c of cells.values()) {
      const pr = c.shown ? parts.get(c.spec.root) : undefined;
      if (!pr) continue;
      const lit = c.target || litWhole.has(c.spec.root) || scanLit === c.key;
      const a = c.dimmed ? 0.1 : lit ? 0.55 : 0.3;
      const col: V3 = [c.color[0] / 255, c.color[1] / 255, c.color[2] / 255];
      for (const pts of [pr.arbor.axon, pr.arbor.dend]) for (let j = 0; j < pts.length; j += every) put([pts[j][0], pts[j][1], pts[j][2]], [col[0], col[1], col[2], a], dot);
    }
    for (const k of conns) {
      if (!live(k)) continue;
      const pre = cells.get(k.pre)!, post = cells.get(k.post)!, r = routes.get(k);
      if (!r) continue;
      const cp: V3 = [pre.color[0] / 255, pre.color[1] / 255, pre.color[2] / 255], cq: V3 = [post.color[0] / 255, post.color[1] / 255, post.color[2] / 255];
      const axonLen = route(k.axon as V3[]).length;
      for (let d = 0; d <= r.length; d += 5000) { const col = d <= axonLen ? cp : cq; put(along(r, d), [col[0], col[1], col[2], pre.dimmed && post.dimmed ? 0.12 : 0.45], dot * 1.3); }
    }
  }
  drawBox(cam, put);
  glow.count = n;
  glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
  setNgeGlow(n ? glow : null, GROUP);
  // the beacons: a soft orb in the cell's colour on each body, fainter on a
  // dimmed cell, with a small core, through the branches
  let m = 0;
  const over = (p: V3, rgba: [number, number, number, number], size: number) => {
    if (m >= MAX_OVER) return;
    glowOver.positions[m * 3] = p[0] / nm[0]; glowOver.positions[m * 3 + 1] = p[1] / nm[1]; glowOver.positions[m * 3 + 2] = p[2] / nm[2];
    glowOver.colors[m * 4] = rgba[0] * rgba[3]; glowOver.colors[m * 4 + 1] = rgba[1] * rgba[3]; glowOver.colors[m * 4 + 2] = rgba[2] * rgba[3]; glowOver.colors[m * 4 + 3] = rgba[3];
    glowOver.sizesNm[m] = size;
    m++;
  };
  for (const c of cells.values()) {
    if (!c.shown) continue;
    const k = c.dimmed ? (scanLit && c.key !== scanLit ? 0.95 : 0.4) : 1, col: V3 = [c.color[0] / 255, c.color[1] / 255, c.color[2] / 255];   // in a scan the others' bodies stay bright, only their branches dim
    over(c.spec.soma, [col[0], col[1], col[2], 0.2 * k], SOMA_R_NM * 2.6);
    over(c.spec.soma, [col[0] * 0.5 + 0.5, col[1] * 0.5 + 0.5, col[2] * 0.5 + 0.5, 0.22 * k], SOMA_R_NM * 1.2);
  }
  glowOver.count = m;
  glowOver.nmRight = glow.nmRight;
  setNgeGlow(m ? glowOver : null, GROUP + '-over');
}

/* ── the loop ── */
function frame(ts: number) {
  if (!active) return;
  try { frameBody(ts); } catch (e) { console.warn('[signal] frame:', e); }
  raf = requestAnimationFrame(frame);
}
function frameBody(ts: number) {
  // Game time follows the clock even on a slow machine (a frame may take a
  // quarter second with these cells on screen); only a long stall is cut.
  const dt = Math.min(0.25, lastFrame ? (ts - lastFrame) / 1000 : 0);
  lastFrame = ts;
  const nm = nmPerUnit();
  const v0 = viewerNow();
  if (v0 && nm && phase !== 'loading' && level?.cells?.length && !camSane(v0)) {
    // a camera that is no finite place (a stale address, a frame that slipped through): back to the circuit
    if (!camWarned) { camWarned = true; console.warn('[signal] the camera was not a finite place; back to the circuit'); }
    glide = null; pendingGlide = null;
    try { v0.projectionOrientation.restoreState(phone() ? [0, 0, 0, 1] : [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]); } catch { /* as it is */ }
    frameLevel();
  }
  const cam = nm && camNow(nm);
  if (cam) {
    if (needsFrame) { settleFrame(cam); rememberHome(); recordCam(); }
    if (pendingGlide) { const g = pendingGlide; pendingGlide = null; g(); }
    if (phase === 'playing' || demo) stepModel(dt); else idleStep(dt);
    placeShip(cam, dt);
    stepGlide(dt);
    watchCam();
    stepOrbit(dt, cam);
    stepReveals();
    writeGlow(cam);
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  }
  placeTags();
  placeScan();
  placeCanopy();
  placeTourLabels();
  placePops();
  closeSidePanel();
  // Once a second: the level's cells stay on, whatever else happens to the
  // layer's segment list (a stray key, another panel), and the layer stays shown.
  if ((frameCount++ & 63) === 0) keepCellsOn();
  // the HUD's height, for the phone's card to keep above it
  const hudH = panel?.offsetHeight ?? 0;
  if (hudH !== lastHudH) { lastHudH = hudH; document.body.style.setProperty('--nge-hud-h', `${hudH}px`); }
  updateHud();
}
let frameCount = 0;
function keepCellsOn() {
  if (holoMode) return;   // the low-poly look shows no mesh
  const ml = circuitLayer();
  if (!ml) return;
  try {
    if (ml.visible === false) ml.setVisible?.(true);
    const g = ml.layer.displayState.segmentationGroupState.value;
    for (const c of cells.values()) {
      if (!c.shown) continue;
      const seg = Uint64.parseString(c.spec.root);
      if (!g.visibleSegments.has(seg)) { g.visibleSegments.add(seg); paint(c, c.dimmed); }
    }
  } catch { /* next time */ }
}

/* ── picking a cell in the 3D view ── */
let swallowUntil = 0;
/** The click after a shot stays out of the layer's own click actions. */
function swallow(e: Event) { if (performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); } }
/** Neuroglancer's double click toggles a segment off, and two quick sparks
 *  on a cell are the whole point of level 1 (Ames 2026-11-08: "double
 *  clicking is removing the meshes from view"): in the 3D view the double
 *  click never reaches it while the game is on. */
function onDoubleClick(e: MouseEvent) {
  if (!active) return;
  if ((e.target as HTMLElement | null)?.closest?.('.nge-3d-panel')) { e.preventDefault(); e.stopPropagation(); }
}
/** The cell at a point of the 3D view: Neuroglancer's hovered segment, or
 *  for a finger (no hover) the cell under it picked now, the way
 *  Neuroglancer's own click actions do (the position is set and the pick is
 *  forced; it blocks on the graphics card for a moment), else the nearest
 *  cell body within a thumb's width. */
function cellAt(x: number, y: number, finger: boolean): CellState | undefined {
  if (finger) {
    try { threeDPanel()?.handleMouseMove?.(x, y); viewerNow()?.mouseState?.updateUnconditionally?.(); } catch { /* no pick: the cell bodies below */ }
  }
  const sel = circuitLayer()?.layer?.displayState?.segmentSelectionState;
  const root = sel?.hasSelectedSegment ? sel.selectedSegment.toString() : null;
  let hit = root ? [...cells.values()].find(c => c.shown && c.spec.root === root) : undefined;
  if (!hit && (finger || holoMode)) {
    let best = 48 * 48;
    for (const c of cells.values()) {
      if (!c.shown) continue;
      const s = toScreen(c.spec.soma);
      if (!s) continue;
      const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
      if (d < best) { best = d; hit = c; }
    }
  }
  return hit;
}
/** A finger fires a cell with a tap: down, still, and up within half a
 *  second, one finger. A drag turns the view and a pinch zooms it, and
 *  neither fires anything (Ames 2026-11-10: "couldn't tap the right cell").
 *  A mouse fires on the press, as before. */
let tapStart: {id: number; x: number; y: number; t: number} | null = null;
let fingers = 0;
/** A mouse press on a cell: a shot if the mouse lifts where it pressed (a
 *  click), the view's own drag if it moves. Firing on the press, and keeping
 *  the press from Neuroglancer, had locked the view: nearly every press in
 *  the frame lands on some branch of a cell (Ames 2026-11-11: "I need to be
 *  able to move/interact with the 3D scene, it seems locked"). */
let mouseStart: {x: number; y: number; key: string; t: number} | null = null;
function onPointerDown(e: PointerEvent) {
  if (!active) return;
  if (e.pointerType !== 'mouse') {
    fingers++;
    tapStart = null;
    if (fingers === 1 && (phase === 'playing' || phase === 'brief' || phase === 'done') && (e.target as HTMLElement | null)?.closest?.('.nge-3d-panel')) {
      tapStart = {id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now()};
    }
    return;
  }
  mouseStart = null;
  if ((phase !== 'playing' && phase !== 'brief' && phase !== 'done') || e.button !== 0) return;
  if (!(e.target as HTMLElement | null)?.closest?.('.nge-3d-panel')) return;
  const hit = cellAt(e.clientX, e.clientY, false);
  if (!hit) return;
  mouseStart = {x: e.clientX, y: e.clientY, key: hit.key, t: performance.now()};
}
function onPointerUp(e: PointerEvent) {
  if (e.pointerType === 'mouse') {
    const m = mouseStart;
    mouseStart = null;
    if (!m || e.type === 'pointercancel' || !active || (phase !== 'playing' && phase !== 'brief' && phase !== 'done')) return;
    if (performance.now() - m.t > 500 || Math.hypot(e.clientX - m.x, e.clientY - m.y) > 6) return;
    swallowUntil = performance.now() + 400;   // the click that follows is the game's, not the layer's
    if (phase === 'playing') shoot(m.key); else tourClick(m.key);
    return;
  }
  fingers = Math.max(0, fingers - 1);
  const t = tapStart;
  if (!t || t.id !== e.pointerId) return;
  tapStart = null;
  if (e.type === 'pointercancel' || !active || (phase !== 'playing' && phase !== 'brief' && phase !== 'done')) return;
  if (performance.now() - t.t > 500 || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 14) return;
  const hit = cellAt(e.clientX, e.clientY, true);
  if (!hit) return;
  e.preventDefault(); e.stopPropagation();
  swallowUntil = performance.now() + 500;
  if (phase === 'playing') shoot(hit.key); else tourClick(hit.key);
}
function onKey(e: KeyboardEvent) {
  if (!active) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === 'Escape') { e.stopPropagation(); stopSignalController(); return; }
  if (phase !== 'playing') return;
  if (e.key === 'Tab' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setHushMode(!hushMode); return; }
  if (e.key === 'h' || e.key === 'H' || e.key === 'i' || e.key === 'I') { e.preventDefault(); e.stopPropagation(); if (level.hush) setHushMode(true); return; }
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); e.stopPropagation(); setHushMode(false); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= 9) {
    const key = [...chipEls.keys()][n - 1];
    if (key) { e.preventDefault(); e.stopPropagation(); shoot(key); }
  }
}

/* ── levels ── */
async function startLevel(index: number) {
  levelIndex = clamp(index, 0, LEVELS.length - 1);
  level = LEVELS[levelIndex];
  phase = 'loading';
  now = 0; charges = MAX_CHARGES; chargesUsed = 0; progress = 0; hushMode = false;
  if (levelIndex === 0) score = 0;
  resetCells();
  clearTags();
  endVisit();
  for (const k of level.cells) { const c = cells.get(k); if (c) void loadParts(c.spec.root); }   // arbors and synapses, for the tour and the card
  els.spark.setAttribute('aria-pressed', 'true'); els.hush.setAttribute('aria-pressed', 'false');
  els.row.style.display = 'none';
  els.body.innerHTML = '<div class="nge-sig-card"><p data-el="loading">Loading the cells…</p></div>';
  updateHud();
  const ml = await openCircuit();
  holoMode = HOLO_FLAG;   // opt in only, on any device (Ames 2026-11-12: "a little too low poly; let me try the original version on my phone")
  // These are whole cells with millimetres of axon each; a slightly coarser
  // mesh level keeps the frame rate up for the beams and sparks. In the
  // low-poly look no mesh is shown at all.
  try { const rs = ml.layer.displayState.renderScaleTarget; if (rs && savedRenderScale === null) { savedRenderScale = rs.value; rs.value = Math.max(rs.value, phone() ? 3 : 2); } } catch { /* as it is */ }
  const g = ml.layer.displayState.segmentationGroupState.value;
  const want = new Set(holoMode ? [] : level.cells.map(k => cells.get(k)!.spec.root));
  for (const s of [...g.visibleSegments]) if (!want.has(s.toString())) g.visibleSegments.delete(s);
  for (const c of cells.values()) {
    if (!c.shown) continue;
    const seg = Uint64.parseString(c.spec.root);
    if (!holoMode && !g.visibleSegments.has(seg)) g.visibleSegments.add(seg);
    paint(c, false);
  }
  frameLevel();
  if (!active) return;
  somaProps = []; somaPropOf.clear();
  if (holoMode) buildSomaProps();
  syncProps();
  if (!holoMode) applyHaze();
  makeTags();
  showScience();
  const loading = els.body.querySelector('[data-el="loading"]') as HTMLElement | null;
  if (holoMode) {
    // the parts files are the picture: wait for them, up to eight seconds
    await Promise.race([Promise.all(level.cells.map(key => loadParts(cells.get(key)!.spec.root))), new Promise(r => setTimeout(r, 8000))]);
  } else {
    // wait for most of the cells to draw, up to half a minute
    for (let k = 0; k < 120 && active && phase === 'loading'; k++) {
      const drawn = level.cells.filter(key => meshDrawn(ml, cells.get(key)!.spec.root)).length;
      if (loading) loading.textContent = `Loading the cells… ${drawn} of ${level.cells.length}`;
      if (drawn >= Math.ceil(level.cells.length * 0.8)) break;
      await new Promise(r => setTimeout(r, 250));
    }
  }
  if (!active || phase !== 'loading') return;
  showBrief();
}

function beginPlay() {
  // The play UI comes up with its controls named, then three, two, one, go
  // (Ames 2026-11-11: "after click it loads the UI and shows them what the
  // buttons are and then start the countdown").
  phase = 'countdown'; demo = false;
  panel?.classList.remove('nge-sig--intro');   // the box comes back with play
  now = 0; lastFrame = 0;
  beams = []; flashes = []; sparks = []; arrivals = []; queued = [];
  endVisit(); clearTourLabels(); orbit = 0; undimAll(); lightWhole([]); hidePartsTint();
  // the tour's demonstrations left charge and spikes behind
  for (const c of cells.values()) { c.e = 0; c.i = 0; c.refractoryUntil = -1; c.hushedUntil = -1; c.lastSpike = -1; c.spikes = 0; if (c.gateNext !== null) c.gateNext = 1.2; }
  coached.clear(); lastMissCoach = -Infinity; pendingExcitation.clear(); hints.clear(); lastGo = null; coachHoldUntil = 0;
  lastBeatAt = -1; recentIn = [];
  closeSidePanel();
  showChips();
  // On a phone the HUD's height changes with its content: the frame is set
  // again for the sheet the level is played with.
  if (phone()) needsFrame = true;
  setCoachText(level.hush ? 'Your beams: Spark fires a cell, Inhibit quiets one. S and I pick one, Tab switches. Each shot costs a charge. Click a cell here, or in the view.'
    : 'Spark is your beam: it fires the cell you click, here or in the view. Each shot costs a charge.', 'begin');
  startMusic();
  updateHud();
  void runCountdown();
}
async function runCountdown() {
  const token = ++tourToken;
  const el = document.createElement('div');
  el.className = 'ng-extend nge-sig-count';
  document.body.appendChild(el);
  const r = threeDPanel()?.element?.getBoundingClientRect?.(), hud = panel?.getBoundingClientRect();
  const left = r ? (sideHud() && hud ? hud.right : r.left) : 0, right = r ? r.right : window.innerWidth;
  const top = r ? r.top : 0, bottom = r ? (!sideHud() && hud ? hud.top : r.bottom) : window.innerHeight;
  el.style.left = `${(left + right) / 2}px`; el.style.top = `${(top + bottom) / 2}px`;
  for (const t of ['3', '2', '1', 'Go']) {
    if (token !== tourToken || !active || phase !== 'countdown') { el.remove(); return; }
    el.textContent = t;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (t === 'Go') sfx.spark(); else sfx.spike(false);
    await sleep(t === 'Go' ? 650 : 850);
  }
  el.remove();
  if (token !== tourToken || !active || phase !== 'countdown') return;
  phase = 'playing'; now = 0; lastFrame = 0;
  // the opening line, where the level has one; else the line clears and the
  // level's first cells to click light up
  if (level.coach.begin) coach('begin'); else { setCoachText('', 'begin'); hints = new Set(level.hint?.begin ?? []); }
  updateHud();
}

/** Open the game (admins on the palette, the Intro test panel, ?signal). */
export async function playSignalController(levelAt = 0) {
  if (active) return;
  active = true;
  try {
    buildPanel();
    els.row.style.display = 'none';
    els.body.innerHTML = '<div class="nge-sig-card"><p>Receiving the circuit…</p></div>';
    document.body.classList.add('nge-signal-on');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 0);   // the viewer takes the window
    // On a phone, Pyr's welcome sheet would cover the game.
    if (phone()) hideMobileWelcomeRef.value++;
    ensureMusic();   // starts loading now, so Begin starts it at once
    await loadAssets();
    if (!active) return;
    shipProp.mesh = shipMesh!;
    cells.clear();
    for (const c of circuit!.cells) {
      cells.set(c.key, {key: c.key, spec: c, shown: false, target: false, e: 0, i: 0, theta: thetaOf(c.key), refractoryUntil: -1, hushedUntil: -1, lastSpike: -1, spikes: 0,
        gateNext: null, gatePeriod: 1, color: hexRgb(cellColor(c, 0)), packed: 0, dimmed: false});
    }
    conns = circuit!.connections;
    routes = new Map(conns.map(k => [k, route([...k.axon, ...k.dendrite])]));
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('click', swallow, true);
    window.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('keydown', onKey, true);
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
    await startLevel(levelAt);
  } catch (e: any) {
    console.warn('[signal] could not start:', e?.message ?? e);
    say(`Could not start: ${e?.message ?? e}`, 8);
    if (els.body) els.body.innerHTML = `<div class="nge-sig-card"><p>The circuit could not be opened (${e?.message ?? e}).</p></div>`;
  }
}

/** Put the controls away. The cells stay on screen to look at. */
export function stopSignalController() {
  if (!active) return;
  active = false;
  cancelAnimationFrame(raf);
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('pointerup', onPointerUp, true);
  window.removeEventListener('pointercancel', onPointerUp, true);
  tapStart = null; fingers = 0;
  window.removeEventListener('click', swallow, true);
  window.removeEventListener('dblclick', onDoubleClick, true);
  window.removeEventListener('keydown', onKey, true);
  for (const c of cells.values()) if (c.dimmed) paint(c, false);
  stopMusic();
  document.removeEventListener('pointerdown', nudgeMusic, true);
  clearHaze();
  clearTags();
  endVisit();
  if (savedRenderScale !== null) { try { circuitLayer().layer.displayState.renderScaleTarget.value = savedRenderScale; } catch { /* as it is */ } savedRenderScale = null; }
  setNgeGlow(null, GROUP);
  setNgeGlow(null, GROUP + '-over');
  setNgeProps([], GROUP);
  somaProps = []; somaPropOf.clear();
  hideCanopy();
  editorEl?.remove(); editorEl = null;
  litWhole = new Set(); scanLit = null; clearReveals(); clearGems(true); roll = null; flying = false;
  demo = false; tourToken++; clearTourLabels(); clearPops(); orbit = 0; tourDim.clear();
  document.querySelector('.nge-sig-count')?.remove();
  glide = null; cockpitNose = null;
  if (savedDefaultAnnotations !== null) { try { viewerNow().showDefaultAnnotations.value = savedDefaultAnnotations; } catch { /* as it is */ } savedDefaultAnnotations = null; }
  document.body.classList.remove('nge-signal-on');
  setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
  if (panel) { const p = panel; p.classList.add('nge-sig--out'); setTimeout(() => p.remove(), 400); panel = null; }
  footEl?.remove(); footEl = null;
  try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

/** Test sites only: ?signal in the address opens the game once the viewer
 *  is up (and ?signal=3 opens at level 3). */
export function startSignalController() {
  if (IS_LIVE_SITE) return;
  const m = /[?&]signal(?:=(\d+))?\b/.exec(location.search);
  if (!m) return;
  const at = m[1] ? clamp(Number(m[1]) - 1, 0, LEVELS.length - 1) : 0;
  const go = async () => {
    for (let k = 0; k < 80 && !viewerNow()?.layerManager; k++) await new Promise(r => setTimeout(r, 250));
    void playSignalController(at);
  };
  setTimeout(go, 1500);
}

(window as any).pyrSignal = {play: playSignalController, stop: stopSignalController, levels: LEVELS, music: () => music,
  state: () => ({phase, now, visit, view, demo, tourAt, showing, gliding: !!glide, parts: [...parts.keys()], waves: waves.length, ship: {at: shipAt, len: shipLenNm, nose: toScreen(shipNose())}, pin: scanPin,
    hold: [...cells.values()].filter(c => c.shown).map(c => [c.key, Number(holdOn(c).toFixed(2))]),
    spikes: [...cells.values()].filter(c => c.shown).map(c => [c.key, c.spikes]), progress, weights: conns.filter(k => (k.w ?? 1) !== 1).map(k => [k.pre, k.post, Number((k.w ?? 1).toFixed(2))])}),
  /** Checks only: run the model forward by so many seconds (the next drawn frame shows the result). */
  step: (seconds: number) => { for (let k = 0; k < seconds / 0.05; k++) if (phase === 'playing' || demo) stepModel(0.05); }};   // in play, or in a tour's demonstration
