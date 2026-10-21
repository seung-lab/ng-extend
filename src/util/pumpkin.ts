/**
 * The Sandbox pumpkin patch (Ames 2026-10-20: "Can we make the default
 * neuron in sandbox load with a pumpkin for the soma?", "soma jack o
 * lantern", "Do we need a couple more pumpkins?").
 *
 * In October (and on 1 November), a jack o' lantern sits over the cell body
 * of each patch cell in the Sandbox while that cell is on screen, so its
 * dendrites grow out of the pumpkin. They are real models in the scene
 * (perspective_view/nge_props.ts, the same path as the Halloween ghost), so
 * a branch in front of one hides it. They keep their own prop list, so the
 * ghost coming and going leaves them alone.
 *
 * The chat bar's pumpkin button (ChatPanel.vue) takes a player to the patch
 * from anywhere, and on a patch cell turns the pumpkins off and on (the
 * hidePumpkin preference, also in Settings and the palette).
 *
 * Cost: a check every two seconds of which cells are shown. Each model
 * (static/halloween/pumpkin.glb, creep-o-lantern.glb, fang-o-lantern.glb,
 * up to about 1 MB each)
 * is fetched the first time a cell wearing it is seen in season. Nothing is redrawn on a timer: pumpkins
 * stand still, so they are drawn with the rest of the view.
 */
import {reactive} from 'vue';
import {setNgeProps, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {loadGlbModel} from './glb';
import {getRootFromSupervoxel, latestDescendants} from '../widgets/pcg_service';
import {setStatedColor} from '../widgets/widget_utils';
import {useUserPreferencesStore} from '../store';
import {findDatasetBySegName, switchToDataset} from '../datasets';

interface PatchCell {
  /** Its cell body, in the viewer's coordinates (Ames's position readout). */
  soma: [number, number, number];
  /** Ids it is known by. Sandbox cells are edited all the time, which gives
   *  them new ids, so the supervoxel at the soma (which never changes) is
   *  also read once its data is loaded, and the server asked for the cell
   *  it belongs to now. */
  ids: string[];
  heightNm: number;
  /** Moved down (data +y) from the soma, so the cell body sits high inside
   *  and the branches leave through the eyes and mouth. */
  dropNm: number;
  /** The supervoxel at the soma, when known. It never changes, so it finds
   *  the cell's current id after any edit, in every browser. */
  sv?: string;
  /** Which model (static/halloween/<model>.glb). */
  model: Model;
  /** The cell's colour while it wears the pumpkin: a different one for
   *  each (Ames: "let's vary the green of the pumpkins", then her picks). */
  green: number;
}
type Model = 'pumpkin' | 'creep-o-lantern' | 'fang-o-lantern';
const PATCH: PatchCell[] = [
  // The Sandbox's starter cell (config.ts), on the same cell body as the cell
  // the Sandbox opened on for Ames (648518346353862024). That one was edited
  // and the server could not trace it (lineage_graph 500), so the trip turns
  // on 648518346355727683 first (Ames 2026-10-21: "can we just use an old
  // segID or something").
  { soma: [71942, 54909, 1162], ids: ['648518346355727683', '648518346353862024'], heightNm: 32000, dropNm: 3500, model: 'pumpkin', green: 0x52cb85 },
  // Far enough from the others that no two pumpkins touch (Ames: "The other
  // two are too close", then "how about this as the 3rd one").
  { soma: [92944, 56926, 1164], ids: ['648518346352449202'], heightNm: 32000, dropNm: 3500, model: 'creep-o-lantern', green: 0x2ac6a7 },
  // A soma picked from the EM (Ames: "You can choose another soma in the
  // volume"); 648518346355866943 is its cell. Purple, Ames's choice.
  // The fang-o-lantern is wide for its height (about 1.35 to 1), so it is
  // shorter to come out the same width (Ames: "that pumpkin is too big").
  // Raised over its cell body (Ames: "fang needs to be higher up").
  { soma: [81640, 56504, 1162], ids: ['648518346355866943'], heightNm: 22000, dropNm: -3000, model: 'fang-o-lantern', green: 0x6736b0 },
];
/** The Sandbox's segmentation layer. */
const SANDBOX_LAYER = 'pinky_nf_v2';
const ROOT_EVERY_MS = 120_000;
const GROUP = 'pumpkin';
/** A patch cell is painted its green when its pumpkin first appears in a
 *  visit (Ames: "default the cell to #52cb85"); recolouring it after that
 *  is left alone. Packed as neuroglancer wants it, 0xBBGGRR. */
const packed = (hex: number) => ((hex >> 16) & 0xff) | (hex & 0xff00) | ((hex & 0xff) << 16);

/** October, and 1 November, in the player's own time. */
export function pumpkinSeason(now = new Date()): boolean {
  return now.getMonth() === 9 || (now.getMonth() === 10 && now.getDate() === 1);
}

interface PatchState { supervoxel: string | null; current: string[]; askedAt: number; painted: Set<string>; prop: NgeProp | null; meshSeen: boolean }
const svKey = (c: PatchCell) => `nge.pumpkin.sv.${c.soma.join(',')}`;
const states: PatchState[] = PATCH.map(c => ({
  supervoxel: c.sv ?? (() => { try { return localStorage.getItem(svKey(c)); } catch { return null; } })(),
  current: [], askedAt: 0, painted: new Set(), prop: null, meshSeen: false,
}));
/** Share of a cell's mesh pieces that must be drawn before its pumpkin
 *  shows (Ames: "the pumpkins load before the neurons"). */
const MESH_SHARE = 0.6;
const GPU_MEMORY = 0;  // neuroglancer's ChunkState.GPU_MEMORY

/** Has enough of this cell's mesh arrived to be seen? Read from the mesh
 *  layer's own chunks, the same test as its isReady. The Sandbox always has
 *  meshes, so no mesh layer yet (the layer still loading, or no sign in)
 *  means wait, not go. */
function meshDrawn(ml: any, seg: any): boolean {
  for (const rl of ml.layer.renderLayers ?? []) {
    const src = rl?.source;
    if (!src?.chunks?.get || !src.fragmentSource?.chunks?.get || typeof src.getFragmentKey !== 'function') continue;
    const key = `${seg.low},${seg.high}`;
    const manifest = src.chunks.get(key);
    const ids: string[] = manifest?.fragmentIds ?? [];
    if (!ids.length) continue;
    let drawn = 0;
    for (const id of ids) if (src.fragmentSource.chunks.get(src.getFragmentKey(key, id).key)?.state === GPU_MEMORY) drawn++;
    if (drawn / ids.length >= MESH_SHARE) return true;
  }
  return false;
}

let viewer: any = null;
const meshes: Partial<Record<Model, NgePropMesh>> = {};
const loading = new Set<Model>();
const failed = new Set<Model>();
let shownKey = '';
let quickCheck: ReturnType<typeof setTimeout> | null = null;

/** The Sandbox's segmentation layers that are showing cells. */
function sandboxLayers(): any[] {
  return (viewer?.layerManager?.managedLayers ?? []).filter((ml: any) => {
    const url: string = ml?.layer?.dataSources?.[0]?.spec?.url ?? '';
    return ml?.visible && !ml.archived && url.includes('/table/pinky_nf') && ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  });
}

/** Read the supervoxel at a soma, once the data there has been loaded. */
function readSupervoxel(c: PatchCell, st: PatchState, layers: any[]) {
  if (st.supervoxel) return;
  const p = Float32Array.from(c.soma);
  for (const ml of layers) for (const rl of ml.layer.renderLayers ?? []) {
    try {
      const got = rl.getValueAt?.(p);
      const sv = got == null ? '' : String(Array.isArray(got) ? got[0] : got);
      if (sv && sv !== '0' && Math.floor(Number(sv) / 2 ** 56) === 1) {
        st.supervoxel = sv;
        try { localStorage.setItem(svKey(c), sv); } catch { /* private window */ }
        return;
      }
    } catch { /* not loaded yet */ }
  }
}

/** The cell's ids now. Sandbox cells are edited all the time (the default
 *  cell most of all), and an edit gives a cell a new id, so the trip would
 *  otherwise turn on an id that no longer draws (Ames: "I only see 2
 *  neurons!"). Best: the root of the supervoxel at the soma. Otherwise: the
 *  newest descendants of the id written here. Both read ids as text, so
 *  they are not rounded. */
async function resolveCurrent(c: PatchCell, st: PatchState): Promise<void> {
  st.askedAt = Date.now();
  try {
    if (st.supervoxel) {
      const r = await getRootFromSupervoxel(st.supervoxel);
      if (r) { st.current = [r]; return; }
    }
    if (c.ids.length) {
      const ends = await latestDescendants(c.ids[0]);
      if (ends?.length) st.current = ends;
    }
  } catch { /* keep the last answer */ }
}

/** Is this patch cell on screen? Paints it green the first time, and notes
 *  once its mesh has been drawn. */
function onScreen(c: PatchCell, st: PatchState, layers: any[]): boolean {
  readSupervoxel(c, st, layers);
  if (Date.now() - st.askedAt > ROOT_EVERY_MS) resolveCurrent(c, st);
  const wanted = new Set([...c.ids, ...st.current]);
  for (const ml of layers) {
    for (const s of ml.layer.displayState.segmentationGroupState.value.visibleSegments) {
      const id = s.toString();
      if (!wanted.has(id)) continue;
      if (!st.painted.has(id)) {
        st.painted.add(id);
        try { setStatedColor(ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors, s, packed(c.green)); } catch { /* colour stays */ }
      }
      if (!st.meshSeen) { try { st.meshSeen = meshDrawn(ml, s); } catch { /* look again next time */ } }
      return true;
    }
  }
  return false;
}

/** Upright in the data: model up is the data's -y (up on screen in the
 *  default view), sized in nanometres, one axis at a time. */
function placement(c: PatchCell): mat4 | null {
  const scales = viewer?.coordinateSpace?.value?.scales;
  if (!scales || scales.length < 3) return null;
  const s = [0, 1, 2].map(i => (Number(scales[i]) || 1e-9) / 1e-9);
  const m = mat4.create();
  m[0] = c.heightNm / s[0];
  m[5] = -c.heightNm / s[1];
  m[10] = -c.heightNm / s[2];
  m[12] = c.soma[0];
  m[13] = c.soma[1] + c.dropNm / s[1];
  m[14] = c.soma[2];
  return m;
}

function show(which: number[]) {
  const key = which.join(',');
  if (key === shownKey) return;
  const props: NgeProp[] = [];
  for (const i of which) {
    const st = states[i];
    if (!st.prop) {
      const mesh = meshes[PATCH[i].model];
      const modelMat = placement(PATCH[i]);
      if (!mesh || !modelMat) continue;
      st.prop = { mesh, modelMat, alpha: 1, dissolve: 0, seed: 0.37 + i * 0.11, glow: [0.22, 0.1, 0.02], rim: [1, 0.55, 0.12], shade: 1 };
    }
    props.push(st.prop);
  }
  setNgeProps(props, GROUP);
  shownKey = key;
  (window as any).__ngePumpkin = which.length ? which.map(i => ({ soma: PATCH[i].soma, heightNm: PATCH[i].heightNm, supervoxel: states[i].supervoxel, current: states[i].current })) : null;
  try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}

/** How many pumpkins are in the patch (the field report's sightings). */
export function patchSize(): number { return PATCH.length; }

/** For the chat bar's pumpkin button (ChatPanel.vue). `here`: a patch cell
 *  is on screen in season, its pumpkin hidden or not. */
export const pumpkinUi = reactive({ here: false });

/** Settings, the chat button or the palette's Hide the Pumpkin. */
export function pumpkinHidden(): boolean {
  try { return useUserPreferencesStore().prefs.hidePumpkin === true; } catch { return false; }
}

/** The chat button and the palette: hide the pumpkins, or bring them back. */
export function togglePumpkin() {
  try { useUserPreferencesStore().save({ hidePumpkin: !pumpkinHidden() }); } catch { return; }
  check();
}

/** The chat button away from the patch: go to the Sandbox, the 3D view on
 *  its own, every patch cell on, framed so all the pumpkins show (Ames:
 *  "make 3D full screen and make sure to put the segments on", "I want to
 *  see all 3 pumpkins"). */
export async function visitPumpkinPatch(): Promise<boolean> {
  const centre = [0, 1, 2].map(k => PATCH.reduce((a, c) => a + c.soma[k], 0) / PATCH.length);
  try { if (pumpkinHidden()) useUserPreferencesStore().save({ hidePumpkin: false }); } catch { /* fine */ }
  if (!viewer?.layerManager?.managedLayers?.some((ml: any) => !ml?.archived && String(ml?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/pinky_nf'))) {
    const ds = findDatasetBySegName(SANDBOX_LAYER);
    if (!ds || !(await switchToDataset(ds, {forJump: true}))) return false;
  }
  // Wait for the Sandbox layer, then show the cell and centre on its soma.
  for (let tries = 0; tries < 40; tries++) {
    const ml = (viewer?.layerManager?.managedLayers ?? []).find((m: any) => !m?.archived &&
      String(m?.layer?.dataSources?.[0]?.spec?.url ?? '').includes('/table/pinky_nf') && m.layer?.displayState?.segmentationGroupState?.value?.visibleSegments);
    if (ml) {
      // Each cell's id now, asked once the Sandbox layer is up (the server
      // lookup goes to that layer's table). A few seconds at most.
      await Promise.race([
        Promise.all(PATCH.map((c, i) => resolveCurrent(c, states[i]))),
        new Promise(r => setTimeout(r, 4000)),
      ]);
      try {
        ml.setVisible?.(true);
        const g = ml.layer.displayState.segmentationGroupState.value;
        // Only the pumpkin cells (Ames: "remove the blue mesh").
        g.visibleSegments.clear();
        PATCH.forEach((cell, i) => {
          const ids = states[i].current.length ? states[i].current : cell.ids.slice(0, 1);
          for (const id of ids) {
            const seg = Uint64.parseString(id);
            if (!g.visibleSegments.has(seg)) g.visibleSegments.add(seg);
          }
        });
        viewer.layout.restoreState('3d');
        // Looking at the faces: the models face the data's -z.
        viewer.projectionOrientation.restoreState([0, 0, 0, 1]);
        viewer.navigationState.position.value = Float32Array.from(centre);
        viewer.projectionScale.value = PATCH.length > 1 ? 70000 : 40000;  // every pumpkin in view
      } catch (e) { console.warn('[pumpkin] could not open the patch:', e); return false; }
      setTimeout(check, 300);
      return true;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function check() {
  if (document.hidden) return;
  const layers = pumpkinSeason() ? sandboxLayers() : [];
  const here = layers.length ? PATCH.map((c, i) => onScreen(c, states[i], layers) ? i : -1).filter(i => i >= 0) : [];
  pumpkinUi.here = here.length > 0;
  // A pumpkin waits for its cell's mesh; look again soon while one waits.
  const waiting = here.some(i => !states[i].meshSeen);
  if (waiting && !quickCheck) quickCheck = setTimeout(() => { quickCheck = null; check(); }, 400);
  const want = pumpkinHidden() ? [] : here.filter(i => states[i].meshSeen);
  // Fetch each model the first time it is wanted; show the rest meanwhile.
  for (const i of want) {
    const model = PATCH[i].model;
    if (meshes[model] || loading.has(model) || failed.has(model)) continue;
    loading.add(model);
    loadGlbModel(`halloween/${model}.glb`).then(
      m => { meshes[model] = m; shownKey = ''; check(); },
      e => { failed.add(model); console.warn(`[pumpkin] the ${model} could not be loaded:`, e?.message); },
    ).finally(() => { loading.delete(model); });
  }
  show(want.filter(i => meshes[PATCH[i].model]));
}

/** Call once the viewer exists. */
export function startPumpkin(v: any) {
  if (viewer) return;
  viewer = v;
  check();
  setInterval(check, 2000);
  document.addEventListener('visibilitychange', check);
}
