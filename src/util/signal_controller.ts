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
import {mat4} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {loadGlbModel} from './glb';
import {cameraAxes} from './starship';
import {findDatasetBySegName, switchToDataset} from '../datasets';
import {setStatedColor} from '../widgets/widget_utils';
import {IS_LIVE_SITE} from './toolbar_staging';
import {hideMobileWelcomeRef} from './mobile';

type V3 = [number, number, number];
interface CircuitCell { key: string; root: string; type: 'E' | 'I'; fine: string; mtype: string; label: string; soma: V3; cableUm: number; axonUm: number; }
interface CircuitConn { pre: string; post: string; count: number; axonUm: number; dendriteUm: number; axon: V3[]; dendrite: V3[]; synapse: V3; synapses: V3[]; }
interface Circuit { version: number; cells: CircuitCell[]; connections: CircuitConn[]; }

/* ── the rules ── */
const TAU_E = 1.2, TAU_I = 0.35;       // seconds of leak
const E_UNIT = 1.0, I_UNIT = 0.6;      // units per synapse
const REFRACTORY_S = 0.4;
const SPEED_UM_S = 500;                // a spike along the real path
const HUSH_S = 2.5;
const BEAM_S = 0.3;                    // the beam's flight
const MAX_CHARGES = 6, REGEN_S = 1.5, SPARK_COST = 1, HUSH_COST = 2;
/** The Gatekeeper's clock: seconds its next spike moves per unit of input. */
const GATE_PUSH_S = 0.15, GATE_PULL_S = 0.08;
const THRESHOLD: Record<string, number> = {T: 8, E4: 6, I2: 6, S: 6};
const DEFAULT_THRESHOLD = 6;
const SHIP_LENGTH_NM = 26_000;

/* ── the levels ── */
type Goal = {kind: 'fire'; target: string; count: number}
  | {kind: 'sequence'; order: [string, string]; withinS: number; count: number}
  | {kind: 'sync'; targets: [string, string]; withinS: number; count: number};
/** The coach line says one thing at a time, as the level unfolds (Ames
 *  2026-11-08: "what am I supposed to do? it's too complicated"). */
type CoachEvent = 'begin' | 'driver' | 'pulse' | 'hushed' | 'key' | 'hit' | 'miss' | 'go' | 'wait' | 'soon';
interface Level {
  title: string; objective: string; detail: string; brief: string;
  cells: string[]; targets: string[];
  /** The Gatekeeper's own rhythm, if it is awake. */
  gate?: {cell: string; periodS: number};
  hush: boolean; hushBlocked?: string[];
  goal: Goal; timeS: number; par: number;
  coach: Partial<Record<CoachEvent, string>>;
  /** Which cells light up as the thing to click, per coach event (Ames
   *  2026-11-08: "it's not clear what I'm trying to click or why"). */
  hint?: Partial<Record<CoachEvent, string[]>>;
}
/** What each cell is for, on its chip and tag. */
const ROLE: Record<string, string> = {T: 'Target', E4: 'Driver', I1: 'Gatekeeper', I2: 'Key', S: 'Switch'};
const LEVELS: Level[] = [
  // Level 1 is one driver and a rhythm (Ames 2026-11-08: "click some
  // pyramidal neurons to fire downstream at the right frequency"): two quick
  // sparks on E1 add up at the gold cell; slow ones leak away first.
  {title: 'First Light', objective: 'Fire the gold cell', detail: 'click E1 twice, quickly', timeS: 45, par: 2,
    brief: 'These are real neurons from the brain: an excitatory pyramidal cell (gold) and four of the cells that drive it.\nYour Spark beam fires a cell, and its spike runs down the axon to the gold cell. One spike is not enough on its own, but spikes that arrive close together add up.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4'], targets: ['T'], hush: false,
    goal: {kind: 'fire', target: 'T', count: 1},
    coach: {begin: 'Click the lit cell, E1, twice, quickly. Each click fires it; watch the gold cell’s charge bar.',
      driver: 'Again, right away: the second spike has to land while the first is still there.',
      miss: 'Too slow between clicks: the charge leaked away. Two clicks within half a second.'},
    hint: {begin: ['E1'], driver: ['E1'], miss: ['E1']}},
  // The Gatekeeper's rhythm is slow here on purpose (Ames 2026-11-08: "it's
  // flashing through too much, it's not clear when/why other cells are
  // making it so I have to have a gap"): at 2.2 s the go window was half a
  // second and the light flipped four times a cycle. At 4.2 s one cycle
  // reads as a story: the violet cell winds up and pulses, the pulse runs
  // down its axon, the gold cell turns violet and comes back, go.
  {title: 'The Gatekeeper', objective: 'Fire the gold cell 3 times', detail: 'in the gaps between pulses', timeS: 60, par: 6,
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
  {title: 'Hush', objective: 'Fire the gold cell 3 times', detail: 'Hush the Gatekeeper first', timeS: 60, par: 12,
    brief: 'The Gatekeeper pulses every second now; the gaps are nearly gone.\nA new beam: Hush quiets a cell for 2.5 s (2 charges). Hush the Gatekeeper, then fire the drivers into the quiet.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4', 'I1'], targets: ['T'], hush: true, gate: {cell: 'I1', periodS: 1.0},
    goal: {kind: 'fire', target: 'T', count: 3},
    coach: {begin: 'Choose Hush (the button, or Tab), then click the violet cell, I1.',
      wait: 'Choose Hush, then click I1 to quiet it.',
      go: 'Go: Spark E1 twice, quickly.',
      hit: 'Again: Hush the Gatekeeper, then E1 twice.',
      miss: 'Hush first, then two quick sparks inside the 2.5 s.'},
    hint: {begin: ['I1'], wait: ['I1'], go: ['E1'], hit: ['I1']}},
  {title: 'The Key', objective: 'Fire T, then E4', detail: 'within 2 s, twice', timeS: 75, par: 13,
    brief: 'The Gatekeeper’s shield blocks your Hush beam now. But a bipolar cell (magenta) makes 20 synapses onto the Gatekeeper and none onto the pyramidal cells: a key.\nE4 is a second target, with its own drivers F1, F2 and F3.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4', 'F1', 'F2', 'F3', 'I1', 'I2'], targets: ['T', 'E4'], hush: true, hushBlocked: ['I1'], gate: {cell: 'I1', periodS: 1.0},
    goal: {kind: 'sequence', order: ['T', 'E4'], withinS: 2, count: 2},
    coach: {begin: 'Spark I2, the magenta cell. Its 20 synapses quiet the Gatekeeper for a moment.',
      wait: 'Spark I2 to quiet the Gatekeeper.',
      go: 'Go: E1 twice for the gold cell, then F1, F2 and F3 for E4.',
      hit: 'A sequence! Once more: I2, then the drivers.',
      miss: 'The order is I2 first, then E1 twice, then F1 + F2 + F3.'},
    hint: {begin: ['I2'], wait: ['I2'], go: ['E1', 'F1', 'F2', 'F3'], hit: ['I2']}},
  {title: 'In Sync', objective: 'Fire T and E4 together', detail: 'three times', timeS: 90, par: 18,
    brief: 'A layer 2/3 pyramidal cell, S, sits above the circuit and drives the Key with 10 synapses: a chain of three.\nLand T and E4 within a quarter second of each other, three times.',
    cells: ['T', 'E1', 'E2', 'E3', 'E4', 'F1', 'F2', 'F3', 'G1', 'G2', 'I1', 'I2', 'S'], targets: ['T', 'E4'], hush: true, hushBlocked: ['I1'], gate: {cell: 'I1', periodS: 1.0},
    goal: {kind: 'sync', targets: ['T', 'E4'], withinS: 0.25, count: 3},
    coach: {begin: 'Spark S. It fires the Key, and the Key quiets the Gatekeeper.',
      wait: 'Spark S to start the chain.',
      go: 'Go: all five drivers at once, E1, E2, F1, F2, F3 (the number keys help).',
      hit: 'In sync! Two more.',
      miss: 'Both targets within a quarter second: fire all five drivers together.'},
    hint: {begin: ['S'], wait: ['S'], go: ['E1', 'E2', 'F1', 'F2', 'F3'], hit: ['S']}},
];

/* ── colours: a cool field, one warm accent (scifi-ui) ── */
const E_COLORS = ['#5fb8ff', '#3f9cf0', '#7ed0ff', '#4fc3e8', '#6aa8ff', '#52d8ff', '#3c8de0', '#86c8ff', '#4ab0ff', '#62c4f4'];
const I_COLOR: Record<string, string> = {I1: '#b68cff', I2: '#e58cff'};
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
interface Spark { r: Route; start: number; end: number; inhibitory: boolean; conn: CircuitConn; }
interface Flash { p: V3; at: number; life: number; rgb: V3; size: number; }
interface Beam { from: V3; to: V3; at: number; hush: boolean; cell: string; applied: boolean; }
type Phase = 'loading' | 'brief' | 'playing' | 'done';

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
let raf = 0;
let lastFrame = 0;
let muted = false;
let center: V3 = [0, 0, 0];
let shipAt: V3 = [0, 0, 0];
let shipFwd: V3 = [0, 0, 1];
let shipAim: V3 | null = null;
let aimUntil = 0;
let prevUp: V3 | null = null;
const shipProp: NgeProp = {mesh: null as any, modelMat: mat4.create(), alpha: 1, dissolve: 0, seed: 0.5, glow: [0.02, 0.04, 0.08], rim: [0.45, 0.85, 1.0], shade: 1.15};
const GROUP = 'signal';
const MAX_GLOW = 1600;
const glow: NgeGlow = {positions: new Float32Array(MAX_GLOW * 3), colors: new Float32Array(MAX_GLOW * 4), sizesNm: new Float32Array(MAX_GLOW), count: 0, nmRight: [1, 0, 0]};

const thetaOf = (key: string) => THRESHOLD[key] ?? DEFAULT_THRESHOLD;
const potential = (c: CellState) => c.e - c.i;
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
function paint(c: CellState, dim: boolean) {
  const ml = circuitLayer();
  if (!ml) return;
  const rgb: V3 = dim ? mul(c.color, 0.32) as V3 : c.color;
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
function startMusic() {
  const m = ensureMusic();
  if (!m || muted) return;
  m.muted = false;
  m.play().catch(() => { /* not allowed yet: the next click tries again */ });
}
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
let els: Record<string, HTMLElement> = {};
let chipEls = new Map<string, HTMLElement>();
let message = '';
let messageUntil = 0;
/** The layer's mesh resolution before the game coarsened it. */
let savedRenderScale: number | null = null;

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
  background: linear-gradient(135deg, rgba(126, 224, 255, 0.75), rgba(74, 150, 224, 0.25) 40%, rgba(138, 96, 230, 0.6));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-sig-bg::after { content: ''; position: absolute; inset: 0; opacity: 0.3;
  background: repeating-linear-gradient(0deg, rgba(126, 224, 255, 0.05) 0 1px, transparent 1px 3px); }
.nge-sig-corner { position: absolute; width: 12px; height: 12px; border: 2px solid #7ee0ff; pointer-events: none; filter: drop-shadow(0 0 4px #7ee0ff); }
.nge-sig-corner.tr { top: -5px; right: -5px; border-left: 0; border-bottom: 0; }
.nge-sig-corner.bl { bottom: -5px; left: -5px; border-right: 0; border-top: 0; }
.nge-sig-head { display: flex; align-items: center; gap: 8px; font: 600 10.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.2em; color: #7ecaff; text-transform: uppercase; }
.nge-sig-dot { width: 7px; height: 7px; border-radius: 50%; background: #7ecaff; box-shadow: 0 0 8px #7ecaff; animation: nge-sig-blink 1.1s infinite; }
@keyframes nge-sig-blink { 50% { opacity: 0.25; } }
.nge-sig-head .lvl { margin-left: auto; color: #e6f3ff; }
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
/* what a beam costs, in the charge meter's own pips */
.nge-sig-beam .cost { display: inline-flex; gap: 2px; margin-left: 7px; vertical-align: 1px; }
.nge-sig-beam .cost b { width: 7px; height: 6px; transform: skewX(-18deg); background: currentColor; opacity: 0.65; }
/* the key that switches the beam (Ames 2026-11-08: "I need a shortcut between spark and hush") */
.nge-sig-key { display: inline-block; margin-left: -4px; padding: 1px 6px 0; border: 1px solid rgba(126, 224, 255, 0.45); border-bottom-width: 2px; border-radius: 4px;
  font: 600 9.5px 'Inter', sans-serif; letter-spacing: 0.06em; color: #9fc6ea; background: rgba(126, 224, 255, 0.06); }
@media (hover: none) and (pointer: coarse) { .nge-sig-key { display: none; } }
.nge-sig-charges { display: inline-flex; gap: 4px; align-items: center; }
.nge-sig-charges i { width: 14px; height: 8px; border: 1px solid rgba(126, 224, 255, 0.5); transform: skewX(-18deg); background: rgba(126, 224, 255, 0.08); }
.nge-sig-charges i.on { background: #7ee0ff; box-shadow: 0 0 6px #7ee0ff; }
.nge-sig-charges i.half { background: linear-gradient(90deg, #7ee0ff 50%, rgba(126, 224, 255, 0.08) 50%); }
.nge-sig-charges span { font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.18em; color: #7ecaff; margin-right: 4px; }
.nge-sig-msg { margin-left: auto; min-height: 1.2em; font-size: 12.5px; color: #ffd98a; text-align: right; }
.nge-sig-note { margin-top: 6px; font-size: 10.5px; color: #7f97b3; letter-spacing: 0.02em; }
/* the brief and the result, in place of the chips */
.nge-sig-card { margin-top: 8px; }
.nge-sig-card p { margin: 6px 0 10px; color: #d6e8fb; }
.nge-sig-stars { font-size: 22px; letter-spacing: 6px; color: #ffc24a; text-shadow: 0 0 12px rgba(255, 194, 74, 0.7); }
.nge-sig-go { position: relative; border: 0; padding: 0; background: none; cursor: pointer; color: inherit; filter: drop-shadow(0 0 10px rgba(74, 150, 224, 0.45)); transition: filter 0.25s, transform 0.2s; }
.nge-sig-go:hover { filter: drop-shadow(0 0 18px rgba(126, 224, 255, 0.75)); transform: translateY(-1px); }
.nge-sig-plate { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 10px; padding: 10px 20px 10px 22px;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  background: linear-gradient(135deg, rgba(74, 150, 224, 0.55) 0%, rgba(74, 150, 224, 0.62) 45%, rgba(138, 96, 230, 0.55) 100%);
  color: #eaf7ff; font: 700 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap; text-shadow: 0 0 8px rgba(126, 224, 255, 0.8); }
.nge-sig-plate::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(135deg, #bff3ff, rgba(126, 224, 255, 0.35) 40%, rgba(180, 150, 255, 0.8));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-sig-quiet { background: none; border: 1px solid rgba(126, 210, 255, 0.35); color: #9fc6ea; border-radius: 6px; padding: 8px 14px; cursor: pointer; font: 600 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
.nge-sig-quiet:hover { color: #fff; border-color: rgba(126, 210, 255, 0.8); }
.nge-sig-recenter { padding: 5px 10px; font-size: 10px; }
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
@media (max-width: 700px) { .ng-extend.nge-sig-tag small { display: none; } }
/* A touch screen: the tag's hit area is a thumb's width, down to the cell body. */
@media (pointer: coarse) { .ng-extend.nge-sig-tag::before { content: ''; position: absolute; inset: -10px -10px -24px; } }
/* Phones (Pyr's mobile mode, body.nge-mobile): the HUD is a short sheet above
   the bottom nav, the chips one row of tappable keys with their bars, the
   cells get the top of the screen (Ames 2026-11-08: "refactor for a phone"). */
body.nge-mobile .nge-sig { bottom: calc(66px + env(safe-area-inset-bottom)); width: calc(100vw - 12px); max-height: 58vh; padding: 8px 10px; font-size: 12px; display: flex; flex-direction: column; }
body.nge-mobile .nge-sig-scroll { min-height: 0; overflow: hidden auto; scrollbar-width: none; }
body.nge-mobile .nge-sig-head { font-size: 9px; letter-spacing: 0.14em; }
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
body.nge-mobile .nge-sig-note { display: none; }
body.nge-mobile .nge-sig-card p { font-size: 13px; }
body.nge-mobile .nge-sig-go, body.nge-mobile .nge-sig-quiet { touch-action: manipulation; }
/* Wide screens: the HUD stands at the left (Ames 2026-11-11: "move signal
   control to left, more area for control panel"), the cells get the whole
   height and the width to its right. */
@media (min-width: 1000px) {
  .nge-sig { left: 16px; right: auto; bottom: auto; top: 64px; transform: none; width: min(448px, 40vw); max-height: calc(100vh - 110px); display: flex; flex-direction: column; padding: 12px 16px 12px;
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
.nge-sig-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 4px 0 2px; font-size: 10.5px; color: #a9c3de; }
.nge-sig-legend i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px var(--c); vertical-align: 0; }
body.nge-mobile .nge-sig-map .node .role { display: none; }
body.nge-mobile .nge-sig-legend { font-size: 10px; gap: 3px 10px; }
/* the Intro test panel sits where the HUD now stands: away while the game runs */
body.nge-signal-on .nge-stt, body.nge-signal-on .nge-stt-dock { display: none !important; }
@media (max-width: 700px) { .nge-sig { padding: 10px 12px; font-size: 12.5px; } .nge-sig-obj strong { font-size: 14px; } .nge-sig-stats b { font-size: 15px; }
  .nge-sig .nge-sig-chip .syn { display: none; } .nge-sig .nge-sig-chip { min-width: 0; } .nge-sig .nge-sig-chip .bar { width: 70px; } .nge-sig-note { display: none; } .nge-sig-coach { font-size: 13px; } }
@media (prefers-reduced-motion: reduce) { .nge-sig, .nge-sig-dot, .nge-sig-chip--spike { animation: none; } }
`;
  document.head.appendChild(st);
}

const X_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function buildPanel() {
  ensureStyle();
  panel?.remove();
  panel = document.createElement('section');
  panel.className = 'ng-extend nge-sig';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Signal Controller');
  panel.innerHTML = `<span class="nge-sig-bg"></span><i class="nge-sig-corner tr"></i><i class="nge-sig-corner bl"></i><div class="nge-sig-scroll">
    <div class="nge-sig-head"><span class="nge-sig-dot"></span>Signal Control · MICrONS cortex<span class="lvl" data-el="lvl"></span>
      <button class="nge-sig-mute" type="button" data-el="mute" title="Sound">♪</button>
      <button class="nge-sig-x" type="button" aria-label="Leave the game" data-el="x">${X_SVG}</button></div>
    <div class="nge-sig-top"><div class="nge-sig-obj"><span>Objective</span><strong data-el="obj"></strong><em data-el="detail"></em></div>
      <div class="nge-sig-stats"><div>Progress<b data-el="progress">0</b></div><div>Time<b data-el="time">0</b></div><div>Score<b data-el="score">0</b></div></div></div>
    <div class="nge-sig-coach" data-el="coach" aria-live="polite"><i></i><span data-el="coachText"></span></div>
    <div class="nge-sig-map" data-el="map"></div>
    <div data-el="body"></div>
    <div class="nge-sig-row" data-el="row"><div class="nge-sig-beams"><button class="nge-sig-beam spark" type="button" data-el="spark" aria-pressed="true" title="Spark: the cell fires. Costs 1 charge.">Spark<i class="cost" aria-label="1 charge"><b></b></i></button><button class="nge-sig-beam hush" type="button" data-el="hush" aria-pressed="false" title="Hush: the cell is silent for 2.5 s. Costs 2 charges.">Hush<i class="cost" aria-label="2 charges"><b></b><b></b></i></button></div><kbd class="nge-sig-key" title="Tab (or Space) switches between Spark and Hush">Tab</kbd>
      <div class="nge-sig-charges" data-el="charges"><span>Charge</span></div>
      <button class="nge-sig-quiet nge-sig-recenter" type="button" data-el="recenter" title="Bring the camera back to the circuit">Recenter</button>
      <div class="nge-sig-msg" data-el="msg"></div></div>
    <div class="nge-sig-note">Real wiring, real synapse counts (MICrONS public release). The firing is a simple model, played about a thousand times slower than life.</div></div>`;
  document.body.appendChild(panel);
  els = {};
  panel.querySelectorAll<HTMLElement>('[data-el]').forEach(el => { els[el.dataset.el!] = el; });
  els.x.onclick = () => stopSignalController();
  els.mute.onclick = () => {
    muted = !muted; els.mute.textContent = muted ? '♪̸' : '♪'; els.mute.style.opacity = muted ? '0.5' : '1';
    if (music) music.muted = muted;
    if (!muted && (phase === 'playing' || phase === 'done')) startMusic();
  };
  // Buttons let go of the focus after a click, so Space keeps switching the
  // beam instead of pressing the last button again.
  els.spark.onclick = () => { setHushMode(false); els.spark.blur(); };
  els.hush.onclick = () => { setHushMode(true); els.hush.blur(); };
  els.recenter.onclick = () => { frameLevel(); say('Back at the circuit.', 1.5); };
  for (let k = 0; k < MAX_CHARGES; k++) els.charges.appendChild(document.createElement('i'));
}

function setHushMode(on: boolean) {
  if (on && !level.hush) { say('Hush is not yours yet.'); return; }
  hushMode = on;
  els.spark.setAttribute('aria-pressed', String(!on));
  els.hush.setAttribute('aria-pressed', String(on));
}

function say(text: string, seconds = 2.6) {
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
  return k ? routes.get(k)!.length / 1000 / SPEED_UM_S : fallback;
}
/** In the levels with the Gatekeeper, the coach line is a three-colour
 *  light. Violet, wait: a pulse is on its way to the target or holding it
 *  down. Amber, not yet: the next pulse lands too soon for sparks fired now,
 *  two clicks 0.35 s apart, each a 0.3 s beam and a spike's run down the
 *  driver's axon, to get there first. Blue, go. (Ames 2026-11-08: the old
 *  two-state light said go while the pulse was still in flight, a trap, and
 *  flipped four times a cycle.) */
function updateGoWait() {
  if (!level.gate || !level.coach.go || now < coachHoldUntil) return;
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
function chipLine(c: CellState): string {
  const outs = conns.filter(k => k.pre === c.key && cells.get(k.post)?.shown)
    .sort((a, b) => Number(cells.get(b.post)!.target) - Number(cells.get(a.post)!.target) || b.count - a.count);
  const role = roleOf(c);
  if (c.target || !outs.length) return role;
  return `${role} · ${outs[0].count} syn → ${outs[0].post}`;
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
  const R = 13, RT = 16, ROW = 38, XL = 48, XR = MAP_W - 48;
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
      gate ? '<i style="--c:#b68cff"></i>Gatekeeper, inhibitory ⊣' : '', key ? '<i style="--c:#e58cff"></i>Key, inhibitory ⊣' : ''].filter(Boolean).join('')}</div>`;
  mapNodeEls = new Map();
  el.querySelectorAll<SVGGElement>('g.node').forEach(g => {
    const k = g.dataset.cell!;
    mapNodeEls.set(k, g);
    g.addEventListener('click', () => { if (phase === 'playing') shoot(k); });
    g.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && phase === 'playing') { e.preventDefault(); shoot(k); } });
  });
  mapSparkEls = [...el.querySelectorAll<SVGCircleElement>('circle.spark')];
}
/** The map, each frame: who to click, who is hushed, the hold on the
 *  target, and the spikes on their way along the arrows. */
function updateMap() {
  if (!mapNodeEls.size) return;
  for (const [k, g] of mapNodeEls) {
    const c = cells.get(k)!;
    g.classList.toggle('hint', phase === 'playing' && hints.has(k));
    g.classList.toggle('hushed', now < c.hushedUntil);
    g.classList.toggle('held', c.target && c.i > 0.6);
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

function showBrief() {
  phase = 'brief';
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
    <p>${won ? `Signal delivered! ${chargesUsed} charge${chargesUsed === 1 ? '' : 's'} used (par ${level.par}).` : 'Time’s up. The circuit held.'}</p>
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
  els.obj.textContent = level.objective;
  els.detail.textContent = adapt(level.detail);
  const total = level.goal.count;
  els.progress.textContent = `${progress} / ${total}`;
  const left = phase === 'playing' ? Math.max(0, level.timeS - now) : level.timeS;
  els.time.textContent = `${Math.ceil(left)}s`;
  els.time.classList.toggle('warn', phase === 'playing' && left < 10);
  els.score.textContent = String(score);
  const pips = els.charges.querySelectorAll('i');
  pips.forEach((p, k) => { p.className = charges >= k + 1 ? 'on' : charges > k + 0.5 ? 'half' : ''; });
  (els.hush as HTMLButtonElement).disabled = !level.hush;
  if (message && performance.now() > messageUntil) { message = ''; els.msg.textContent = ''; }
  els.coach.style.display = phase === 'playing' && els.coachText.textContent ? '' : 'none';
  updateMap();
  for (const [key, el] of chipEls) {
    const c = cells.get(key)!;
    const hushed = now < c.hushedUntil;
    el.classList.toggle('nge-sig-chip--hushed', hushed);
    el.classList.toggle('nge-sig-chip--hint', hints.has(key));
    const bar = el.querySelector('.bar b') as HTMLElement | null;
    const label = el.querySelector('.barlabel') as HTMLElement | null;
    if (!bar || !label) continue;
    if (c.gateNext !== null) {
      // The Gatekeeper's bar is a fuse: the seconds to its next pulse, running
      // down (Ames 2026-11-08: "next pulse, what does it mean?").
      const left = Math.max(0, c.gateNext - now);
      bar.style.width = hushed ? `${Math.round(clamp((c.hushedUntil - now) / HUSH_S, 0, 1) * 100)}%` : `${Math.round(clamp(left / c.gatePeriod, 0, 1) * 100)}%`;
      label.textContent = hushed ? `hushed ${Math.max(0, c.hushedUntil - now).toFixed(1)} s` : `pulses in ${left.toFixed(1)} s`;
      continue;
    }
    const v = clamp(potential(c) / c.theta, -1, 1);
    bar.classList.toggle('neg', v < 0);
    bar.style.width = `${Math.round(Math.abs(v) * 100)}%`;
    label.textContent = v < -0.05 ? 'held down' : 'charge';
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
  const carve = (p: V3, radius: number) => {
    const r = Math.ceil(radius / cell);
    const c = [0, 1, 2].map(i => Math.floor((p[i] - lo[i]) / cell));
    for (let z = Math.max(0, c[2] - r); z <= Math.min(dims[2] - 1, c[2] + r); z++)
      for (let y = Math.max(0, c[1] - r); y <= Math.min(dims[1] - 1, c[1] + r); y++)
        for (let x = Math.max(0, c[0] - r); x <= Math.min(dims[0] - 1, c[0] + r); x++) {
          const dx = (x + 0.5) * cell + lo[0] - p[0], dy = (y + 0.5) * cell + lo[1] - p[1], dz = (z + 0.5) * cell + lo[2] - p[2];
          if (dx * dx + dy * dy + dz * dz <= radius * radius) data[((z * dims[1] + y) * dims[0] + x) * 4 + 3] = 0;
        }
  };
  for (const c of shown) carve(c.spec.soma, 24_000);
  for (const k of used) {
    const r = routes.get(k)!;
    for (let s = 0; s <= r.length; s += cell * 0.5) carve(along(r, s), 7000);
  }
  const m = mat4.create();
  for (let i = 0; i < 3; i++) { m[i * 5] = nm[i] / (dims[i] * cell); m[12 + i] = -lo[i] / (dims[i] * cell); }
  // The target is lit whole, in its own colour; the haze is for the others
  // (Ames 2026-11-08: "the target cell all the way lit up and just the
  // others with this lantern mode").
  const skip = new Set(level.targets.map(k => cells.get(k)!.spec.root));
  // On a phone the other branches are all but black: the cell bodies and
  // the wires between them are the whole picture (Ames 2026-11-10:
  // "confusing, I couldn't tell which cells I was supposed to be hitting").
  return {data, dims, gridFromGlobal: m, dim: DIM, dimLevel: phone() ? 0.07 : undefined, skip};
}
let hazeTint: NgeMeshTint | null = null;
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
  if (!hazeOn || !hazeTint) return;
  const now = getNgeMeshTint();
  if (now === hazeTint) return;
  savedTint = now;
  setNgeMeshTint(hazeTint);
}
function clearHaze() {
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
    el.innerHTML = `<b class="tap">Tap</b>${key}<small>${roleOf(c)}</small>`;
    el.title = c.target ? `${key}: the target` : `Fire the beam at ${key}`;
    el.onclick = () => { shoot(key); el.blur(); };
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
    el.classList.toggle('nge-sig-tag--hint', phase === 'playing' && hints.has(key));
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
  // In close on the cell bodies: the rest of each cell is there, greyed, as
  // context (the haze), so the frame need not hold it all.
  viewNm = Math.max(200_000, span * 2.0 + 70_000);
  v.navigationState.position.value = Float32Array.from(center.map((c, i) => c / nm[i]));
  const unit = Math.min(nm[0], nm[1], nm[2]);
  v.projectionScale.value = viewNm / unit;
  // Looking down into the cortex from the pia, the way a two photon
  // microscope does (Ames 2026-11-08: "sort of like I am being a 2p
  // microscope"): the eye toward data -y, screen up along +z.
  // On a phone the view is from the side, the pia at the top, so the cell
  // bodies spread down the tall screen instead of sitting over one another
  // (Ames 2026-11-10: "couldn't tap the right cell").
  v.projectionOrientation.restoreState(phone() ? [0, 0, 0, 1] : [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  needsFrame = true;
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
    viewNm = Math.max(120_000, H * P / freeH, W * P / freeW);
    v.projectionScale.value = viewNm / Math.min(nm[0], nm[1], nm[2]);
    // The box's middle goes to the middle of the free area: that many px
    // above the panel's centre, so the look point sits that far below it.
    const nmPerPx = viewNm / P;
    const boxMid = add(center, add(mul(cam.right, (loR + hiR) / 2), mul(cam.up, (loU + hiU) / 2)));
    const freeMidPx = (TOP + (1 - frac) * P - BOT) / 2 - P / 2;   // down the screen is positive
    const look = add(boxMid, mul(cam.up, freeMidPx * nmPerPx));
    v.navigationState.position.value = Float32Array.from(look.map((c, i) => c / nm[i]));
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
    v.navigationState.position.value = Float32Array.from(look.map((c, i) => c / nm[i]));
    return;
  }
  // The HUD takes the bottom third, so the camera looks a little below the
  // circuit and the cells sit above.
  const look = sub(center, mul(cam.up, viewNm * 0.1));
  v.navigationState.position.value = Float32Array.from(look.map((c, i) => c / nm[i]));
}
/** On a wide screen the HUD stands at the right, leaving the whole height
 *  for the cells; on a phone it lies along the bottom. */
const sideHud = () => window.innerWidth >= 1000;
/** A phone: Pyr's own mobile mode (body.nge-mobile, src/util/mobile.ts). */
const phone = () => document.body.classList.contains('nge-mobile');
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
function cockpitSpot(cam: {right: V3; up: V3; toEye: V3}): V3 | null {
  const v = viewerNow(), nm = nmPerUnit();
  if (!v || !nm) return null;
  const look = Array.from(v.navigationState.position.value as Float32Array).map((x, i) => x * nm[i]) as V3;
  // Neuroglancer's perspective camera is 45° tall, its eye 1.21 frame
  // heights from the look point, its near plane a tenth of the way back
  // (perspective_view/panel.ts). The ship sits four tenths of the way out
  // from the eye, in front of the tissue in most frames, placed in screen
  // terms: low and to the left, clear of the HUD. It had been 26 µm long
  // and 300 µm deep, lost among the branches once a level spread out (Ames
  // 2026-11-08: "I don't see the spaceship").
  const tanHalf = Math.tan(Math.PI / 8);
  const eyeDist = v.projectionScale.value * Math.min(nm[0], nm[1], nm[2]) / (2 * tanHalf);
  const d = eyeDist * 0.4;
  const r = threeDPanel()?.element?.getBoundingClientRect?.();
  const aspect = r && r.height > 0 ? r.width / r.height : window.innerWidth / Math.max(1, window.innerHeight);
  const halfH = d * tanHalf, halfW = halfH * aspect;
  // half the view's shorter half-extent: on an upright phone, a quarter of the width
  shipLenNm = Math.min(halfH, halfW) * 0.5;
  // On a phone the ship sits just above the HUD's edge, at the left; with
  // the HUD standing at the left it rides low right, clear of it.
  const sx = sideHud() ? 0.6 : phone() ? -0.55 : -0.6;
  const sy = sideHud() ? -0.5 : phone() ? Math.min(-0.1, -1 + 2 * hudFrac() + 0.45) : -0.25;
  return add(add(add(look, mul(cam.toEye, eyeDist - d)), mul(cam.right, sx * halfW)), mul(cam.up, sy * halfH));
}

/** The model's own length along its nose (+z), so it can be sized in nm. */
let shipModelLength = 0;
function placeShip(cam: {right: V3; up: V3; toEye: V3}, dt: number) {
  const nm = nmPerUnit();
  if (!nm || !shipMesh) return;
  if (!shipModelLength) {
    let zLo = Infinity, zHi = -Infinity;
    for (let i = 2; i < shipMesh.positions.length; i += 3) { zLo = Math.min(zLo, shipMesh.positions[i]); zHi = Math.max(zHi, shipMesh.positions[i]); }
    shipModelLength = (zHi - zLo) || 1;
  }
  const spot = cockpitSpot(cam);
  const scale = shipLenNm / shipModelLength;
  if (spot) shipAt = mix(shipAt, spot, Math.min(1, dt * 5));
  const want = shipAim && performance.now() < aimUntil ? norm(sub(shipAim, shipAt)) : norm(sub(center, shipAt));
  shipFwd = norm(mix(shipFwd, want, Math.min(1, dt * 7)));
  let up = norm(sub(cam.up, mul(shipFwd, dot(cam.up, shipFwd))));
  if (prevUp) up = norm(mix(prevUp, up, Math.min(1, dt * 6)));
  prevUp = up;
  const fwd = norm(sub(shipFwd, mul(up, dot(shipFwd, up))));
  const right = norm(cross(up, fwd));
  const bob = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : viewNm * 0.004 * Math.sin(performance.now() / 1000 * 1.3);
  const at = add(shipAt, mul(up, bob));
  const m = shipProp.modelMat, axes = [right, up, fwd];
  for (let col = 0; col < 3; col++) for (let k = 0; k < 3; k++) m[col * 4 + k] = axes[col][k] * scale / nm[k];
  for (let k = 0; k < 3; k++) m[12 + k] = at[k] / nm[k];
  shipProp.eye = [dot(right, cam.toEye), dot(up, cam.toEye), dot(fwd, cam.toEye)];
}
const shipNose = (): V3 => add(shipAt, mul(shipFwd, shipLenNm * 0.5));

/* ── the model ── */
function resetCells() {
  for (const c of cells.values()) {
    c.shown = level.cells.includes(c.key);
    c.target = level.targets.includes(c.key);
    c.e = 0; c.i = 0; c.theta = thetaOf(c.key);
    c.refractoryUntil = -1; c.hushedUntil = -1; c.lastSpike = -1; c.spikes = 0;
    c.gateNext = null; c.gatePeriod = 1;
    const eIndex = level.cells.filter(k => cells.get(k)!.spec.type === 'E').indexOf(c.key);
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
  if (now < c.refractoryUntil || now < c.hushedUntil) { if (byBeam) { sfx.fizzle(); say(`${key} is ${now < c.hushedUntil ? 'hushed' : 'resting'}.`); } return; }
  c.e = 0; c.i = 0; c.refractoryUntil = now + REFRACTORY_S; c.lastSpike = now; c.spikes++;
  if (c.gateNext !== null) c.gateNext = now + c.gatePeriod;
  const inhibitory = c.spec.type === 'I';
  flashes.push({p: c.spec.soma, at: now, life: 0.55, rgb: c.target ? [1, 0.85, 0.4] : inhibitory ? [0.85, 0.7, 1] : [0.8, 0.95, 1], size: c.target ? 22_000 : 16_000});
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
    const travel = r.length / 1000 / SPEED_UM_S;
    sparks.push({r, start: now, end: now + travel, inhibitory, conn: k});
    arrivals.push({at: now + travel, post: k.post, units: k.count * (inhibitory ? I_UNIT : E_UNIT), inhibitory, conn: k});
  }
  if (c.target) onTargetSpike(key);
}

function onTargetSpike(key: string) {
  lastTargetSpike[key] = now;
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
  else { c.e += a.units; if (c.target) pendingExcitation.set(c.key, now); }
}

function shoot(key: string) {
  if (phase !== 'playing') return;
  const c = cells.get(key);
  if (!c || !c.shown) return;
  if (c.target) { sfx.shield(); say('Shielded. Fire it through its partners.'); shake(key); return; }
  if (hushMode && level.hushBlocked?.includes(key)) { sfx.shield(); say(`${key}’s shield blocks the Hush beam. Find another way.`); shake(key); return; }
  const cost = hushMode ? HUSH_COST : SPARK_COST;
  if (charges < cost) { sfx.fizzle(); say('Not enough charge.'); return; }
  charges -= cost; chargesUsed += cost;
  shipAim = c.spec.soma; aimUntil = performance.now() + 1500;
  beams.push({from: shipNose(), to: c.spec.soma, at: now, hush: hushMode, cell: key, applied: false});
  if (hushMode) sfx.hush(); else sfx.spark();
}
function shake(key: string) {
  const el = chipEls.get(key);
  if (!el) return;
  el.classList.remove('nge-sig-chip--shake'); void el.offsetWidth; el.classList.add('nge-sig-chip--shake');
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
    if (b.applied || now < b.at + BEAM_S) continue;
    b.applied = true;
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
  beams = beams.filter(b => now < b.at + BEAM_S + 0.25);
  // spikes arrive
  const due = arrivals.filter(a => a.at <= now);
  arrivals = arrivals.filter(a => a.at > now);
  for (const a of due) arrive(a);
  sparks = sparks.filter(s => now < s.end + 0.3);
  flashes = flashes.filter(f => now < f.at + f.life);
  // thresholds, and the Gatekeeper's clock
  for (const c of cells.values()) {
    if (!c.shown) continue;
    if (c.dimmed && now >= c.hushedUntil) paint(c, false);
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
    const held = clamp(c.i / 3, 0, 1);
    const ring = mix([1, 0.76, 0.3], VIOLET, held);
    const R = phone() ? viewNm * 0.045 : 14_000;
    for (let k = 0; k < 14; k++) {
      const a = spin * 0.9 + k / 14 * Math.PI * 2;
      const p = add(c.spec.soma, add(mul(cam.right, Math.cos(a) * R), mul(cam.up, Math.sin(a) * R)));
      put(p, [ring[0], ring[1], ring[2], 0.35 + 0.25 * Math.sin(a * 3 + spin * 4)], 2200);
    }
    if (held > 0.05) put(c.spec.soma, [VIOLET[0], VIOLET[1], VIOLET[2], 0.5 * held], 18_000);
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
  if (phase === 'playing') for (const key of hints) {
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
    const head = q * s.r.length;
    const rgb: V3 = s.inhibitory ? [0.8, 0.55, 1] : [1, 0.95, 0.7];
    for (let j = 0; j < 10; j++) {
      const d = head - j * 2200;
      if (d < 0) break;
      const fade = Math.pow(1 - j / 10, 1.5) * (now < s.end ? 1 : Math.max(0, 1 - (now - s.end) / 0.3));
      put(along(s.r, d), [rgb[0], rgb[1], rgb[2], 0.9 * fade], j === 0 ? 4200 : 2600 * (1 - j / 10) + 900);
    }
  }
  // the beams: a line of light from the ship's nose, its head racing to the cell
  for (const b of beams) {
    const q = clamp((now - b.at) / BEAM_S, 0, 1);
    const after = Math.max(0, now - b.at - BEAM_S);
    const fade = Math.max(0, 1 - after / 0.25);
    const rgb: V3 = b.hush ? [0.7, 0.45, 1] : [1, 0.82, 0.35];
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
  glow.count = n;
  glow.nmRight = [cam.right[0] / nm[0], cam.right[1] / nm[1], cam.right[2] / nm[2]];
  setNgeGlow(n ? glow : null, GROUP);
}

/* ── the loop ── */
function frame(ts: number) {
  if (!active) return;
  // Game time follows the clock even on a slow machine (a frame may take a
  // quarter second with these cells on screen); only a long stall is cut.
  const dt = Math.min(0.25, lastFrame ? (ts - lastFrame) / 1000 : 0);
  lastFrame = ts;
  const nm = nmPerUnit();
  const cam = nm && cameraAxes(nm);
  if (cam) {
    if (needsFrame) settleFrame(cam);
    if (phase === 'playing') stepModel(dt);
    placeShip(cam, dt);
    writeGlow(cam);
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  }
  placeTags();
  closeSidePanel();
  // Once a second: the level's cells stay on, whatever else happens to the
  // layer's segment list (a stray key, another panel), and the layer stays shown.
  if ((frameCount++ & 63) === 0) keepCellsOn();
  updateHud();
  raf = requestAnimationFrame(frame);
}
let frameCount = 0;
function keepCellsOn() {
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
  if (!hit && finger) {
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
function onPointerDown(e: PointerEvent) {
  if (!active) return;
  if (e.pointerType !== 'mouse') {
    fingers++;
    tapStart = null;
    if (fingers === 1 && phase === 'playing' && (e.target as HTMLElement | null)?.closest?.('.nge-3d-panel')) {
      tapStart = {id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now()};
    }
    return;
  }
  if (phase !== 'playing' || e.button !== 0) return;
  if (!(e.target as HTMLElement | null)?.closest?.('.nge-3d-panel')) return;
  const hit = cellAt(e.clientX, e.clientY, false);
  if (!hit) return;
  e.preventDefault(); e.stopPropagation();
  swallowUntil = performance.now() + 500;
  shoot(hit.key);
}
function onPointerUp(e: PointerEvent) {
  if (e.pointerType === 'mouse') return;
  fingers = Math.max(0, fingers - 1);
  const t = tapStart;
  if (!t || t.id !== e.pointerId) return;
  tapStart = null;
  if (e.type === 'pointercancel' || !active || phase !== 'playing') return;
  if (performance.now() - t.t > 500 || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 14) return;
  const hit = cellAt(e.clientX, e.clientY, true);
  if (!hit) return;
  e.preventDefault(); e.stopPropagation();
  swallowUntil = performance.now() + 500;
  shoot(hit.key);
}
function onKey(e: KeyboardEvent) {
  if (!active) return;
  if (e.key === 'Escape') { e.stopPropagation(); stopSignalController(); return; }
  if (phase !== 'playing') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === 'Tab' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setHushMode(!hushMode); return; }
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
  els.spark.setAttribute('aria-pressed', 'true'); els.hush.setAttribute('aria-pressed', 'false');
  els.row.style.display = 'none';
  els.body.innerHTML = '<div class="nge-sig-card"><p data-el="loading">Loading the cells…</p></div>';
  updateHud();
  const ml = await openCircuit();
  // These are whole cells with millimetres of axon each; a slightly coarser
  // mesh level keeps the frame rate up for the beams and sparks.
  try { const rs = ml.layer.displayState.renderScaleTarget; if (rs && savedRenderScale === null) { savedRenderScale = rs.value; rs.value = Math.max(rs.value, phone() ? 3 : 2); } } catch { /* as it is */ }
  const g = ml.layer.displayState.segmentationGroupState.value;
  const want = new Set(level.cells.map(k => cells.get(k)!.spec.root));
  for (const s of [...g.visibleSegments]) if (!want.has(s.toString())) g.visibleSegments.delete(s);
  for (const c of cells.values()) {
    if (!c.shown) continue;
    const seg = Uint64.parseString(c.spec.root);
    if (!g.visibleSegments.has(seg)) g.visibleSegments.add(seg);
    paint(c, false);
  }
  frameLevel();
  if (!active) return;
  setNgeProps([shipProp], GROUP);
  applyHaze();
  makeTags();
  // wait for most of the cells to draw, up to half a minute
  const loading = els.body.querySelector('[data-el="loading"]') as HTMLElement | null;
  for (let k = 0; k < 120 && active && phase === 'loading'; k++) {
    const drawn = level.cells.filter(key => meshDrawn(ml, cells.get(key)!.spec.root)).length;
    if (loading) loading.textContent = `Loading the cells… ${drawn} of ${level.cells.length}`;
    if (drawn >= Math.ceil(level.cells.length * 0.8)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (!active || phase !== 'loading') return;
  showBrief();
}

function beginPlay() {
  phase = 'playing';
  now = 0; lastFrame = 0;
  coached.clear(); lastMissCoach = -Infinity; pendingExcitation.clear(); hints.clear(); lastGo = null; coachHoldUntil = 0;
  closeSidePanel();
  showChips();
  // On a phone the HUD's height changes with its content: the frame is set
  // again for the sheet the level is played with.
  if (phone()) needsFrame = true;
  coach('begin');
  startMusic();
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
    window.addEventListener('mousedown', swallow, true);
    window.addEventListener('mouseup', swallow, true);
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
  window.removeEventListener('mousedown', swallow, true);
  window.removeEventListener('mouseup', swallow, true);
  window.removeEventListener('click', swallow, true);
  window.removeEventListener('dblclick', onDoubleClick, true);
  window.removeEventListener('keydown', onKey, true);
  for (const c of cells.values()) if (c.dimmed) paint(c, false);
  stopMusic();
  clearHaze();
  clearTags();
  if (savedRenderScale !== null) { try { circuitLayer().layer.displayState.renderScaleTarget.value = savedRenderScale; } catch { /* as it is */ } savedRenderScale = null; }
  setNgeGlow(null, GROUP);
  setNgeProps([], GROUP);
  document.body.classList.remove('nge-signal-on');
  if (panel) { const p = panel; p.classList.add('nge-sig--out'); setTimeout(() => p.remove(), 400); panel = null; }
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

(window as any).pyrSignal = {play: playSignalController, stop: stopSignalController, levels: LEVELS, music: () => music};
