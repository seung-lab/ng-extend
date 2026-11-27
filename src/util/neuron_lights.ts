/**
 * Holiday lights draped on a neuron (Ames 2026-11-27, from her picture of
 * white lights hung from branch to branch). In the holidays, while the
 * Sandbox cell 648518346351212485 is on screen, a string of warm white
 * bulbs hangs from one of its dendrites to the next, sagging in a swag
 * between each pair, through the hanging points Ames placed in order.
 *
 * The bulbs are glowing points in the 3D scene (perspective_view/nge_props.ts,
 * as the Starship's trail), so the cell hides any bulb behind it and turning
 * the cell shows the string wrapped around it. They take no clicks.
 *
 * The same switch as the top bar's lights turns them off (userPrefs.hideLights:
 * the bulb button by the chat box, or Settings > Holiday lights).
 *
 * Cost: a look every two seconds at which cells are shown. Nothing is redrawn
 * on a timer: the bulbs hold still, so they are drawn with the rest of the view.
 */
import {setNgeGlow, type NgeGlow} from 'neuroglancer/perspective_view/nge_props';
import {getRootFromSupervoxel, latestDescendants} from '../widgets/pcg_service';
import {useUserPreferencesStore} from '../store';
import {setStatedColor} from '../widgets/widget_utils';
import {holidaySeason} from './season';
import {cameraAxes} from './starship';

/** The cell, and its ids (Sandbox cells get new ids when edited, so the
 *  supervoxel at the first hanging point finds it again after any edit). */
const CELL_IDS = ['648518346351212485'];
/** Where the string hangs from, in order, in the viewer's coordinates
 *  (4 x 4 x 40 nm voxels): Ames's annotation points, first to last. */
const HANG: [number, number, number][] = [
  [80634, 40827, 978], [77109, 45476, 1902], [85711, 48741, 1985], [88115, 51296, 1140],
  [74062, 54988, 853], [60361, 51855, 832], [59941, 54979, 1794], [68231, 58664, 2082],
  [84325, 65492, 1709], [82822, 61723, 1074], [72303, 62305, 549], [60109, 63522, 1188],
  [79704, 68984, 1253],
];
/** Nanometres between bulbs, and each bulb's size. */
const SPACING_NM = 2400;   // Ames 2026-11-27: "a little more spaced apart"
const BULB_NM = 1700;      // and "a little bit larger"
/** How bright each bulb's halo is next to its core. */
const HALO = 0.32;
/** The cell's color while it wears the lights (Ames 2026-11-27: "change the
 *  default color of the neuron to purple?"): purple, so the warm white pops ("looks really nice with purple").
 *  Packed as neuroglancer wants it, 0xBBGGRR. Recoloring it after is left alone. */
const PURPLE = 0x9a42f0;   // the purple Ames tried on it
const packed = (hex: number) => ((hex >> 16) & 0xff) | (hex & 0xff00) | ((hex & 0xff) << 16);
const painted = new Set<string>();
/** How far a swag sags, as a share of the gap it spans. */
const SAG = 0.22;
/** Warm white, as in Ames's picture. */
const WARM: [number, number, number] = [1, 0.9, 0.72];
const SANDBOX_LAYER_URL = '/table/pinky_nf';
const ROOT_EVERY_MS = 120_000;
const GROUP = 'neuron-lights';
const SV_KEY = 'nge.neuronLights.sv';

let viewer: any = null;
let supervoxel: string | null = (() => { try { return localStorage.getItem(SV_KEY); } catch { return null; } })();
let current: string[] = [];
let askedAt = 0;
let glow: NgeGlow | null = null;
let showing = false;

function lightsHidden(): boolean {
  try { return useUserPreferencesStore().prefs.hideLights === true; } catch { return false; }
}

function sandboxLayers(): any[] {
  return (viewer?.layerManager?.managedLayers ?? []).filter((ml: any) => {
    const url: string = ml?.layer?.dataSources?.[0]?.spec?.url ?? '';
    return ml?.visible && !ml.archived && url.includes(SANDBOX_LAYER_URL) && ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  });
}

function readSupervoxel(layers: any[]) {
  if (supervoxel) return;
  const p = Float32Array.from(HANG[0]);
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

async function resolveCurrent() {
  askedAt = Date.now();
  try {
    if (supervoxel) { const r = await getRootFromSupervoxel(supervoxel); if (r) { current = [r]; return; } }
    const ends = await latestDescendants(CELL_IDS[0]);
    if (ends?.length) current = ends;
  } catch { /* keep the last answer */ }
}

function cellOnScreen(layers: any[]): boolean {
  readSupervoxel(layers);
  if (Date.now() - askedAt > ROOT_EVERY_MS) void resolveCurrent();
  const wanted = new Set([...CELL_IDS, ...current]);
  for (const ml of layers) for (const s of ml.layer.displayState.segmentationGroupState.value.visibleSegments) {
    const id = s.toString();
    if (!wanted.has(id)) continue;
    if (!painted.has(id)) {
      painted.add(id);
      try { setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, s, packed(PURPLE)); } catch { /* color stays */ }
    }
    return true;
  }
  return false;
}

/** Nanometres per viewer unit on each axis. */
function nmPerUnit(): [number, number, number] | null {
  const scales = viewer?.coordinateSpace?.value?.scales;
  if (!scales || scales.length < 3) return null;
  return [0, 1, 2].map(i => (Number(scales[i]) || 1e-9) / 1e-9) as [number, number, number];
}

/** The bulbs along every swag, in viewer coordinates. Down is the data's +y. */
function buildGlow(per: [number, number, number]): NgeGlow {
  const pts: number[] = [];
  const bright: number[] = [];
  for (let i = 0; i + 1 < HANG.length; i++) {
    const a = HANG[i].map((v, k) => v * per[k]), b = HANG[i + 1].map((v, k) => v * per[k]);
    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(2, Math.round(span / SPACING_NM));
    const sag = span * SAG;
    for (let j = i === 0 ? 0 : 1; j <= n; j++) {
      const t = j / n;
      const p = [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * t);
      p[1] += sag * 4 * t * (1 - t);
      pts.push(p[0] / per[0], p[1] / per[1], p[2] / per[2]);
      // a little uneven, as real bulbs are
      bright.push(0.78 + 0.22 * (((pts.length / 3) * 0.618) % 1));
    }
  }
  // Each bulb twice: a bright core, and a wide soft halo around it
  // (Ames 2026-11-27: "these need more glow").
  const bulbs = pts.length / 3, count = bulbs * 2;
  const positions = new Float32Array(count * 3);
  positions.set(pts, 0);
  positions.set(pts, bulbs * 3);
  const colors = new Float32Array(count * 4), sizes = new Float32Array(count);
  for (let i = 0; i < bulbs; i++) {
    const b = bright[i];
    colors.set([WARM[0] * b, WARM[1] * b, WARM[2] * b, 1], i * 4);
    sizes[i] = BULB_NM * (0.85 + 0.3 * b);
    colors.set([WARM[0] * b * HALO, WARM[1] * b * HALO, WARM[2] * b * HALO, HALO], (bulbs + i) * 4);
    sizes[bulbs + i] = BULB_NM * 3.6;
  }
  return {positions, colors, sizesNm: sizes, count, nmRight: [1 / per[0], 0, 0]};
}

/** Keep the bulbs' size on screen right as the view turns. */
function aim() {
  if (!glow) return;
  const per = nmPerUnit();
  const cam = per && cameraAxes(per);
  if (!per || !cam) return;
  glow.nmRight = [cam.right[0] / per[0], cam.right[1] / per[1], cam.right[2] / per[2]];
}

function check() {
  if (document.hidden || !viewer) return;
  const want = holidaySeason() && !lightsHidden() && cellOnScreen(sandboxLayers());
  if (want === showing) { if (want) aim(); return; }
  showing = want;
  if (want) {
    const per = nmPerUnit();
    if (!per) { showing = false; return; }
    glow = glow ?? buildGlow(per);
    aim();
    setNgeGlow(glow, GROUP);
  } else {
    setNgeGlow(null, GROUP);
  }
  (window as any).__ngeNeuronLights = showing ? glow?.count ?? 0 : 0;
  try { viewer.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

/** Call once the viewer exists. */
export function startNeuronLights(v: any) {
  if (viewer) return;
  viewer = v;
  check();
  setInterval(check, 2000);
  document.addEventListener('visibilitychange', check);
  // Turning the view: the bulbs keep their size.
  try { v.projectionOrientation.changed.add(() => { if (showing) aim(); }); } catch { /* sizes from the last look */ }
  // The lights switch: off or on at once, not at the next look.
  try { useUserPreferencesStore().$subscribe(() => check()); } catch { /* the next look catches it */ }
}
