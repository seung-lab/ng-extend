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

export const CAST_CLASSES: { key: string; name: string; plural: string; color: string }[] = [
  { key: 'BC', name: 'Bipolar cell', plural: 'Bipolar', color: '#f5b84a' },
  { key: 'HC', name: 'Horizontal cell', plural: 'Horizontal', color: '#b48cff' },
  { key: 'AC', name: 'Amacrine cell', plural: 'Amacrine', color: '#ff5fb0' },
  { key: 'RGC', name: 'Ganglion cell', plural: 'Ganglion', color: '#3e96f0' },
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

function frame(t: CastType) {
  const v = viewer();
  if (!v) return;
  v.navigationState.position.value = Float32Array.from([0, 1, 2].map(i => (t.min[i] + t.max[i]) / 2 / VOXEL_UM[i]));
  v.perspectiveNavigationState.pose.orientation.restoreState(castState.view === 'side' ? VIEW_SIDE : VIEW_TOP);
  const ext = castState.view === 'side'
    ? Math.max(t.max[0] - t.min[0], t.max[2] - t.min[2])
    : Math.max(t.max[0] - t.min[0], t.max[1] - t.min[1]);
  v.projectionScale.value = ext * SCALE_PER_UM;
}

let token = 0;
/** Show one type's example cell alone in 3D, framed to it. */
export async function showCastType(t: CastType) {
  const mine = ++token;
  castState.error = '';
  castState.loading = true;
  stopSpin();
  try {
    if (!(await saveMyView())) { castState.loading = false; return; }
    const root = await getRootFromSupervoxel(t.sv);
    if (mine !== token) return;
    if (!root) { castState.error = 'This cell could not be found right now. Try again in a moment.'; return; }
    const v = viewer();
    const seg = currentSegLayer();
    const layer = seg?.layer;
    const group = layer?.displayState?.segmentationGroupState?.value;
    if (!v || !group) { castState.error = 'The retina is still loading. Try again in a moment.'; return; }
    // The cell alone: other layers off, 3D only.
    for (const ml of v.layerManager.managedLayers) if (ml !== seg && ml.visible) ml.setVisible(false);
    if (!seg.visible) seg.setVisible(true);
    v.layout.restoreState('3d');
    v.showPerspectiveSliceViews.value = false;
    v.showAxisLines.value = false;
    group.visibleSegments.clear();
    const id = Uint64.parseString(root);
    const n = parseInt(castClass(t.cls).color.slice(1), 16);
    // neuroglancer packs colors as 0xBBGGRR.
    const packed = ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
    try { setStatedColor(layer.displayState.segmentationColorGroupState.value.segmentStatedColors, id, packed); } catch { /* keeps its own color */ }
    group.visibleSegments.add(id);
    castState.current = t;
    castState.view = startsSide(t) ? 'side' : 'top';
    frame(t);
  } catch (e: any) {
    if (mine === token) castState.error = 'This cell could not be shown: ' + (e?.message || e);
  } finally {
    if (mine === token) castState.loading = false;
  }
}

export function setCastView(view: 'top' | 'side') {
  castState.view = view;
  stopSpin();
  if (castState.current) frame(castState.current);
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
  castState.loading = false;
  try { sessionStorage.removeItem(SAVED_KEY); } catch { /* private window */ }
}

// Going to a cell or a claim from anywhere replaces the screen, so the cast
// no longer has a view to put back (the claim was saved when the cast began).
if (typeof document !== 'undefined') document.addEventListener('nge:leaving-for-cell', () => { if (castState.saved) forgetCast(); });
