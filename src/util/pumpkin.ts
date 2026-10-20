/**
 * The Sandbox pumpkin (Ames 2026-10-20: "Can we make the default neuron in
 * sandbox load with a pumpkin for the soma?", "soma jack o lantern").
 *
 * While the Sandbox's starter cell is on screen in October (and on
 * 1 November), a jack o' lantern sits over its cell body in the 3D view, so
 * its dendrites grow out of the pumpkin. It is a real model in the scene
 * (perspective_view/nge_props.ts, the same path as the Halloween ghost), so
 * a branch in front of it hides it. It keeps its own prop list, so the
 * ghost coming and going leaves it alone.
 *
 * Cost: a check every two seconds of which cells are shown. The model
 * (static/halloween/pumpkin.glb, about 1 MB) is fetched the first time the
 * cell is seen in season. Nothing is redrawn on a timer: the pumpkin stands
 * still, so it is drawn with the rest of the view.
 */
import {setNgeProps, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {loadGlbModel} from './glb';

/** The Sandbox's starter cell (config.ts, pinky_sandbox defaultSegments). */
const CELL = '648518346355727683';
/** Its cell body, in the viewer's coordinates (Ames's position readout). */
const SOMA = [84568, 61611, 1283];
/** Pumpkin height: a little larger than the cell body, so it covers it. */
const HEIGHT_NM = 22000;
const GROUP = 'pumpkin';

/** October, and 1 November, in the player's own time. */
export function pumpkinSeason(now = new Date()): boolean {
  return now.getMonth() === 9 || (now.getMonth() === 10 && now.getDate() === 1);
}

let viewer: any = null;
let mesh: NgePropMesh | null = null;
let loading = false;
let failed = false;
let shown = false;
let prop: NgeProp | null = null;

function cellOnScreen(): boolean {
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    if (!ml?.visible) continue;
    const g = ml.layer?.displayState?.segmentationGroupState?.value;
    if (!g?.visibleSegments) continue;
    for (const s of g.visibleSegments) if (s.toString() === CELL) return true;
  }
  return false;
}

/** Upright in the data: model up is the data's -y (up on screen in the
 *  default view), sized in nanometres, one axis at a time. */
function placement(): mat4 | null {
  const scales = viewer?.coordinateSpace?.value?.scales;
  if (!scales || scales.length < 3) return null;
  const s = [0, 1, 2].map(i => (Number(scales[i]) || 1e-9) / 1e-9);
  const m = mat4.create();
  m[0] = HEIGHT_NM / s[0];
  m[5] = -HEIGHT_NM / s[1];
  m[10] = -HEIGHT_NM / s[2];
  m[12] = SOMA[0];
  m[13] = SOMA[1];
  m[14] = SOMA[2];
  return m;
}

function show(on: boolean) {
  if (on === shown) return;
  if (on) {
    const modelMat = placement();
    if (!mesh || !modelMat) return;
    prop = { mesh, modelMat, alpha: 1, dissolve: 0, seed: 0.37, glow: [0.22, 0.1, 0.02], rim: [1, 0.55, 0.12], shade: 1 };
    setNgeProps([prop], GROUP);
  } else {
    setNgeProps([], GROUP);
    prop = null;
  }
  shown = on;
  (window as any).__ngePumpkin = shown ? { soma: SOMA, heightNm: HEIGHT_NM } : null;
  try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

function check() {
  if (document.hidden) return;
  const want = pumpkinSeason() && cellOnScreen();
  if (want && !mesh) {
    if (!loading && !failed) {
      loading = true;
      loadGlbModel('halloween/pumpkin.glb').then(
        m => { mesh = m; check(); },
        e => { failed = true; console.warn('[pumpkin] the pumpkin could not be loaded:', e?.message); },
      ).finally(() => { loading = false; });
    }
    return;
  }
  show(want);
}

/** Call once the viewer exists. */
export function startPumpkin(v: any) {
  if (viewer) return;
  viewer = v;
  check();
  setInterval(check, 2000);
  document.addEventListener('visibilitychange', check);
}
