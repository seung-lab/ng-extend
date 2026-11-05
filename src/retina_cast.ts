/**
 * The cast of the retina (Ames 2026-10-24): one proofread example cell of
 * each retinal type, browsed from the Cell Library's Cast tab and shown alone
 * in 3D for the player to turn. The list is src/data/retina-cast.ts.
 *
 * Cell identity: no root id is stored. Each type keeps its example's soma
 * SUPERVOXEL, which never changes, and the root that holds it is looked up
 * when the type is opened. Looking roots up from old segment ids put 33 of
 * 102 film cells on the wrong object (2026-10-22).
 *
 * The player's own view is saved when the cast first takes the screen and put
 * back by "Back to my view". The claim they were working on has its view
 * saved first and stops being the one open, so a cast cell never ends up
 * saved into a claim (the panel supplies that step, setCastClaimHooks).
 */
import { reactive } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { CAST_TYPES } from './data/retina-cast';
import { getRootFromSupervoxel } from './widgets/pcg_service';
import { currentSegLayer } from './datasets';
import { setStatedColor } from './widgets/widget_utils';
import { SCALE_PER_UM, VIEW_SIDE, VIEW_TOP } from './dataset_tour_kit';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CastType = typeof CAST_TYPES[number];
export const CAST = CAST_TYPES;
export const CAST_DATASET = 'stroeh_mouse_retina';

/** Each class with what it does, in a sentence or two (Ames 2026-10-24: "a
 *  little description of what each class of cell does"). */
export const CAST_CLASSES: { key: string; name: string; plural: string; group: string; color: string; about: string }[] = [
  { key: 'BC', name: 'Bipolar cell', plural: 'Bipolar', group: 'bipolar cells', color: '#f5b84a',
    about: 'Bipolar cells stand upright in the retina and carry the signal from the photoreceptors down to the amacrine and ganglion cells. ON types end their axons deeper, OFF types nearer the cell body.' },
  { key: 'HC', name: 'Horizontal cell', plural: 'Horizontal', group: 'horizontal cells', color: '#b48cff',
    about: 'Horizontal cells spread sideways just under the photoreceptors. They compare each spot of light with its surroundings, which sharpens contrast at edges. The mouse has one type.' },
  { key: 'AC', name: 'Amacrine cell', plural: 'Amacrine', group: 'amacrine cells', color: '#ff5fb0',
    about: 'Amacrine cells shape the signal on its way from bipolar cells to ganglion cells, mostly by inhibiting it. They do jobs like telling which way something moves, and they are the most varied class of all.' },
  { key: 'RGC', name: 'Ganglion cell', plural: 'Ganglion', group: 'ganglion cells', color: '#3e96f0',
    about: 'Ganglion cells are the output of the retina. Each type detects one feature of the scene, such as edges, motion or brightness, and sends it to the brain through the optic nerve.' },
];
export const castClass = (key: string) => CAST_CLASSES.find(c => c.key === key) ?? CAST_CLASSES[0];

/** Bipolar and horizontal cells stand upright in the sheet: from the side. */
const startsSide = (t: CastType) => t.cls === 'BC' || t.cls === 'HC';

// Retina voxels are 16 x 16 x 40 nm.
const VOXEL_UM = [0.016, 0.016, 0.040];

export const castState = reactive({
  /** The type on screen, or null. */
  current: null as CastType | null,
  view: 'top' as 'top' | 'side',
  spinning: false,
  loading: false,
  error: '',
  /** A whole group on screen: 'all', or a class key ('BC', ...). */
  group: null as string | null,
  /** Cells found so far while a group loads. */
  found: 0,
  /** The player's own view is saved and can be put back. */
  saved: false,
});

const SAVED_KEY = 'nge-cast-saved-view';
let savedState: any = null;
let savedTask: number | null = null;
try {
  const raw = sessionStorage.getItem(SAVED_KEY);
  if (raw) { const s = JSON.parse(raw); savedState = s.state; savedTask = s.task ?? null; castState.saved = !!savedState; }
} catch { /* private window */ }

interface ClaimHooks {
  /** Save the open claim's view and stop treating it as open. Returns the
   *  claim's task id (to reopen after), or false to stay put. */
  leave(): Promise<number | null | false>;
  /** Make this claim the open one again. */
  reopen(taskId: number): void;
}
let hooks: ClaimHooks | null = null;
export function setCastClaimHooks(h: ClaimHooks) { hooks = h; }

function viewer(): any { return (window as any)['viewer']; }

async function saveMyView(): Promise<boolean> {
  if (savedState) return true;
  const v = viewer();
  if (!v) return false;
  const task = hooks ? await hooks.leave() : null;
  if (task === false) return false;
  savedState = v.state.toJSON();
  savedTask = task;
  castState.saved = true;
  try { sessionStorage.setItem(SAVED_KEY, JSON.stringify({ state: savedState, task: savedTask })); } catch { /* too big or private: memory still has it */ }
  return true;
}

/** The box holding these types' meshes. */
function boxOf(types: CastType[]) {
  return {
    min: [0, 1, 2].map(i => Math.min(...types.map(t => t.min[i]))),
    max: [0, 1, 2].map(i => Math.max(...types.map(t => t.max[i]))),
  };
}

function frame() {
  const v = viewer();
  const types = shownTypes();
  if (!v || !types.length) return;
  const { min, max } = boxOf(types);
  v.navigationState.position.value = Float32Array.from([0, 1, 2].map(i => (min[i] + max[i]) / 2 / VOXEL_UM[i]));
  v.perspectiveNavigationState.pose.orientation.restoreState(castState.view === 'side' ? VIEW_SIDE : VIEW_TOP);
  const ext = castState.view === 'side'
    ? Math.max(max[0] - min[0], max[2] - min[2])
    : Math.max(max[0] - min[0], max[1] - min[1]);
  v.projectionScale.value = ext * SCALE_PER_UM;
}

// ── Colors ──────────────────────────────────────────────────────────────
// One type alone: the class color. A group together, one class or all of
// them: each type its own shade of its class color, so the types can be told
// apart and each family still reads as its family (Ames 2026-10-24).
function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const f = (k: number) => {
    const a = s * Math.min(l, 1 - l), t = (k + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
}
/** Shades spread around the class color: hue within 50 degrees each way,
 *  lightness stepping through three levels so neighbors differ. */
function shades(cls: string, count: number): string[] {
  const [h, s] = hexToHsl(castClass(cls).color);
  return Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0.5;
    return hslToHex((h - 50 + 100 * t + 360) % 360, Math.max(0.55, s), [0.62, 0.48, 0.74][i % 3]);
  });
}
/** The color each shown type has in the 3D view, by supervoxel (the list's
 *  swatches read it). */
export const castColors = reactive<Record<string, string>>({});

/** What is on screen: one type, or a whole group. */
function shownTypes(): CastType[] {
  if (castState.current) return [castState.current];
  if (castState.group === 'all') return CAST;
  if (castState.group) return CAST.filter(t => t.cls === castState.group);
  return [];
}

/** Roots for these supervoxels, a few lookups at a time. */
async function rootsOf(types: CastType[], mine: number): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(types.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < types.length && mine === token) {
      const i = next++;
      out[i] = await getRootFromSupervoxel(types[i].sv);
      castState.found = out.filter(Boolean).length;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

let token = 0;
/** Put these types on screen, each in its color, in their own places in the
 *  retina, framed together. */
async function display(types: CastType[], colorOf: (t: CastType) => string, setUp: () => void) {
  const mine = ++token;
  castState.error = '';
  castState.loading = true;
  castState.found = 0;
  stopSpin();
  try {
    if (!(await saveMyView())) { castState.loading = false; return; }
    const roots = await rootsOf(types, mine);
    if (mine !== token) return;
    const missing = roots.filter(r => !r).length;
    if (missing === types.length) {
      castState.error = types.length === 1
        ? 'This cell could not be found right now. Try again in a moment.'
        : 'These cells could not be found right now. Try again in a moment.';
      return;
    }
    const v = viewer();
    const seg = currentSegLayer();
    const layer = seg?.layer;
    const group = layer?.displayState?.segmentationGroupState?.value;
    if (!v || !group) { castState.error = 'The retina is still loading. Try again in a moment.'; return; }
    // The cells alone: other layers off, 3D only.
    for (const ml of v.layerManager.managedLayers) if (ml !== seg && ml.visible) ml.setVisible(false);
    if (!seg.visible) seg.setVisible(true);
    v.layout.restoreState('3d');
    v.showPerspectiveSliceViews.value = false;
    v.showAxisLines.value = false;
    group.visibleSegments.clear();
    for (const k of Object.keys(castColors)) delete castColors[k];
    const colors = layer.displayState.segmentationColorGroupState?.value?.segmentStatedColors;
    types.forEach((t, i) => {
      const root = roots[i];
      if (!root) return;
      const hex = colorOf(t);
      castColors[t.sv] = hex;
      const id = Uint64.parseString(root);
      const n = parseInt(hex.slice(1), 16);
      // neuroglancer packs colors as 0xBBGGRR.
      const packed = ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
      try { if (colors) setStatedColor(colors, id, packed); } catch { /* keeps its own color */ }
      group.visibleSegments.add(id);
    });
    setUp();
    frame();
    if (missing) castState.error = `${missing} of ${types.length} cells could not be found right now.`;
  } catch (e: any) {
    if (mine === token) castState.error = 'The cells could not be shown: ' + (e?.message || e);
  } finally {
    if (mine === token) castState.loading = false;
  }
}

/** Show one type's example cell alone in 3D, framed to it. */
export function showCastType(t: CastType) {
  return display([t], x => castClass(x.cls).color, () => {
    castState.current = t;
    castState.group = null;
    castState.view = startsSide(t) ? 'side' : 'top';
  });
}

/** Show every example of a class ('BC', ...) or of all classes ('all') at
 *  once, each where it sits in the retina. */
export function showCastGroup(key: string) {
  const types = key === 'all' ? CAST : CAST.filter(t => t.cls === key);
  const shadeOf = new Map<CastType, string>();
  for (const c of CAST_CLASSES) {
    const mine = types.filter(t => t.cls === c.key);
    shades(c.key, mine.length).forEach((hex, i) => shadeOf.set(mine[i], hex));
  }
  return display(types, t => shadeOf.get(t) ?? castClass(t.cls).color, () => {
    castState.current = null;
    castState.group = key;
    castState.view = key === 'BC' || key === 'HC' ? 'side' : 'top';
  });
}

export function setCastView(view: 'top' | 'side') {
  castState.view = view;
  stopSpin();
  frame();
}

// Spin: turn about the screen's upright axis until the player stops it or
// takes hold of the cell.
let raf = 0;
function spinStep() {
  try { viewer()?.perspectiveNavigationState.pose.rotateRelative(Float32Array.from([0, 1, 0]), 0.012); } catch { /* viewer gone */ }
  raf = requestAnimationFrame(spinStep);
}
function onGrab(e: Event) { if ((e.target as HTMLElement)?.tagName === 'CANVAS') stopSpin(); }
export function stopSpin() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  castState.spinning = false;
  document.removeEventListener('pointerdown', onGrab, true);
  document.removeEventListener('wheel', onGrab, true);
}
export function toggleSpin() {
  if (castState.spinning) return stopSpin();
  castState.spinning = true;
  document.addEventListener('pointerdown', onGrab, true);
  document.addEventListener('wheel', onGrab, true);
  raf = requestAnimationFrame(spinStep);
}

/** Put the player's own view back, and reopen the claim they were on. */
export function backToMyView() {
  token++;
  stopSpin();
  const v = viewer();
  if (v && savedState) v.state.restoreState(savedState);
  if (savedTask && hooks) hooks.reopen(savedTask);
  savedState = null;
  savedTask = null;
  castState.saved = false;
  castState.current = null;
  castState.group = null;
  for (const k of Object.keys(castColors)) delete castColors[k];
  castState.error = '';
  castState.loading = false;
  try { sessionStorage.removeItem(SAVED_KEY); } catch { /* private window */ }
}

/** Something else took the screen (a claim, a jump, a dataset switch): the
 *  cast steps aside without restoring anything. */
export function forgetCast() {
  token++;
  stopSpin();
  savedState = null;
  savedTask = null;
  castState.saved = false;
  castState.current = null;
  castState.group = null;
  castState.loading = false;
  try { sessionStorage.removeItem(SAVED_KEY); } catch { /* private window */ }
}

// Going to a cell or a claim from anywhere replaces the screen, so the cast
// no longer has a view to put back (the claim was saved when the cast began).
if (typeof document !== 'undefined') document.addEventListener('nge:leaving-for-cell', () => { if (castState.saved) forgetCast(); });
