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
import {getRootFromSupervoxel} from '../widgets/pcg_service';
import {setStatedColor} from '../widgets/widget_utils';
import {useUserPreferencesStore} from '../store';

/** The cell is known by its ids, and by what is at its cell body now:
 *  Sandbox cells are edited all the time, which gives them new ids. The
 *  supervoxel at the soma never changes, so once read it finds the cell's
 *  current id from the server. */
const KNOWN_CELLS = ['648518346355727683', '648518346353862024'];

const ROOT_EVERY_MS = 120_000;
/** Its cell body, in the viewer's coordinates (Ames's position readout). */
const SOMA = [71942, 54909, 1162];
/** Moved down (data +y) from the soma, in nanometres, so the cell body sits
 *  high inside and its branches leave through the eyes and mouth. */
const DROP_NM = 3500;
/** The supervoxel read at the soma is kept per point, so moving the point
 *  reads it again. */
const SV_KEY = `nge.pumpkin.sv.${SOMA.join(',')}`;
/** Pumpkin height: a little larger than the cell body, so it covers it. */
const HEIGHT_NM = 32000;
const GROUP = 'pumpkin';
/** The pumpkin's cell is painted vine green when the pumpkin first appears
 *  in a visit (Ames: "default the cell to #52cb85"); recolouring it after
 *  that is left alone. Packed as neuroglancer wants it, 0xBBGGRR. */
const CELL_HEX = 0x52cb85;
const CELL_PACKED = ((CELL_HEX >> 16) & 0xff) | (CELL_HEX & 0xff00) | ((CELL_HEX & 0xff) << 16);
const painted = new Set<string>();

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

let supervoxel: string | null = (() => { try { return localStorage.getItem(SV_KEY); } catch { return null; } })();
let liveRoot: string | null = null;
let rootAskedAt = 0;

/** The Sandbox's segmentation layers that are showing cells. */
function sandboxLayers(): any[] {
  return (viewer?.layerManager?.managedLayers ?? []).filter((ml: any) => {
    const url: string = ml?.layer?.dataSources?.[0]?.spec?.url ?? '';
    return ml?.visible && url.includes('/table/pinky_nf') && ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  });
}

/** Read the supervoxel at the soma, once the data there has been loaded. */
function readSupervoxel(layers: any[]) {
  if (supervoxel) return;
  const p = Float32Array.from(SOMA);
  for (const ml of layers) for (const rl of ml.layer.renderLayers ?? []) {
    try {
      const got = rl.getValueAt?.(p);
      const sv = got == null ? '' : String(Array.isArray(got) ? got[0] : got);
      if (sv && sv !== '0' && Math.floor(Number(sv) / 2 ** 56) === 1) {
        supervoxel = sv;
        try { localStorage.setItem(SV_KEY, sv); } catch { /* private window */ }
        return;
      }
    } catch { /* not loaded yet */ }
  }
}

function cellOnScreen(): boolean {
  const layers = sandboxLayers();
  if (!layers.length) return false;
  readSupervoxel(layers);
  const now = Date.now();
  if (supervoxel && now - rootAskedAt > ROOT_EVERY_MS) {
    rootAskedAt = now;
    getRootFromSupervoxel(supervoxel).then(r => { if (r) liveRoot = r; }).catch(() => { /* keep the last one */ });
  }
  const wanted = new Set(KNOWN_CELLS);
  if (liveRoot) wanted.add(liveRoot);
  for (const ml of layers) {
    for (const s of ml.layer.displayState.segmentationGroupState.value.visibleSegments) {
      const id = s.toString();
      if (!wanted.has(id)) continue;
      if (!painted.has(id)) {
        painted.add(id);
        try { setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, s, CELL_PACKED); } catch { /* colour stays */ }
      }
      return true;
    }
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
  m[13] = SOMA[1] + DROP_NM / s[1];
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
  (window as any).__ngePumpkin = shown ? { soma: SOMA, heightNm: HEIGHT_NM, supervoxel, liveRoot } : null;
  try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

/** Settings, or the palette's Hide the Pumpkin. */
function hiddenByPlayer(): boolean {
  try { return useUserPreferencesStore().prefs.hidePumpkin === true; } catch { return false; }
}

function check() {
  if (document.hidden) return;
  const want = pumpkinSeason() && !hiddenByPlayer() && cellOnScreen();
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
