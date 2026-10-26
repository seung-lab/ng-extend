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
  // The cell the Sandbox opens on for Ames now (Ames 2026-10-25: "it is a
  // different cell yes, you can add the fang jack o lantern to it"), soma
  // from Ames's position readout. It sits about 20 um below the purple fang
  // and 12 um across, so this one is smaller (16 um tall) and the two never
  // touch when the whole patch is shown. Kept in its own blue.
  { soma: [84730, 61617, 1260], ids: ['648518346352711309'], heightNm: 16000, dropNm: -2000, model: 'fang-o-lantern', green: 0x3d7fe6 },
];
/** The Sandbox's segmentation layer. */
const SANDBOX_LAYER = 'pinky_nf_v2';
const ROOT_EVERY_MS = 120_000;
const GROUP = 'pumpkin';
/** A trip to the patch in progress (visitPumpkinPatch), across a page load. */
const TRIP_KEY = 'nge-pumpkin-trip';
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

/** The pumpkins drawn right now (indexes into PATCH). */
let shownNow: number[] = [];

/** A pumpkin grows in from nothing over its cell body the first time it
 *  appears, once the cell has drawn (Ames 2026-10-25: "a little loading
 *  indicator like the pumpkins grow after the cell meshes"). Calm screen:
 *  it is simply there. */
const GROW_MS = 750;
function grow(prop: NgeProp, full: mat4) {
  const set = (f: number) => { for (const c of [0, 1, 2]) for (const r of [0, 1, 2]) prop.modelMat[c * 4 + r] = full[c * 4 + r] * f; };
  if (document.body.classList.contains('nge-calm')) { set(1); return; }
  set(0);
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / GROW_MS);
    // ease out with a little overshoot: it swells, then settles
    const k = 1.7;
    set(1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2));
    try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function show(which: number[]) {
  shownNow = which;
  updateHint();
  const key = which.join(',');
  if (key === shownKey) return;
  const props: NgeProp[] = [];
  for (const i of which) {
    const st = states[i];
    if (!st.prop) {
      const mesh = meshes[PATCH[i].model];
      const modelMat = placement(PATCH[i]);
      if (!mesh || !modelMat) continue;
      st.prop = { mesh, modelMat: mat4.clone(modelMat), alpha: 1, dissolve: 0, seed: 0.37 + i * 0.11, glow: [0.22, 0.1, 0.02], rim: [1, 0.55, 0.12], shade: 1 };
      grow(st.prop, modelMat);
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

/** The field report's Hide the pumpkin: off (or back on), whatever it was. */
export function setPumpkinHidden(hidden: boolean) {
  try { useUserPreferencesStore().save({ hidePumpkin: hidden }); } catch { return; }
  check();
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
export async function visitPumpkinPatch(smash = false): Promise<boolean> {
  // A trip that has to switch datasets can lose the page on the way; it is
  // noted here so the new page finishes it (startPumpkin).
  try { sessionStorage.setItem(TRIP_KEY, JSON.stringify({ smash, at: Date.now() })); } catch { /* fine */ }
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
      try { sessionStorage.removeItem(TRIP_KEY); } catch { /* fine */ }
      if (smash) startSmashing();
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
  // A trip to the patch that switched datasets, cut short by the page
  // loading again: finish it here.
  try {
    const trip = JSON.parse(sessionStorage.getItem(TRIP_KEY) || 'null');
    sessionStorage.removeItem(TRIP_KEY);
    if (trip && Date.now() - trip.at < 60_000 && pumpkinSeason()) setTimeout(() => { visitPumpkinPatch(!!trip.smash); }, 1500);
  } catch { /* fine */ }
}

// ── Smash the pumpkins (Ames 2026-10-25: "it gives you a hammer and when
// you click the pumpkins explode into pieces and then they are toggled off
// until you click the pumpkin icon again") ─────────────────────────────────
//
// The field report's Smash the pumpkins takes the player to the patch with a
// hammer for a cursor over the 3D view. A click on a pumpkin breaks it into
// pieces that fly apart and fall (NgeProp.shatter). When every pumpkin on
// screen is smashed, or the player stops (Done or Escape) after smashing at
// least one, the pumpkins are switched off (hidePumpkin), and the chat
// bar's pumpkin button puts them back. A click that misses every pumpkin
// goes to the viewer as usual, so the view can still be turned.

const SMASH_MS = 1300;
let smashing = false;
const smashed = new Set<number>();
let flying = 0;
let hint: HTMLDivElement | null = null;
let hintLabel: HTMLSpanElement | null = null;
let againBtn: HTMLButtonElement | null = null;
let smashFrom = 0;
/** Every pumpkin smashed: the bar stays up with Again? (Ames 2026-10-25:
 *  "keep that chip up at the top and after player finishes offer again?"). */
let finished = false;

/** The hammer bar: "growing" with a count while the pumpkins are still on
 *  their way (the cells load first), then the instruction. After 15 s it
 *  stops waiting for one that never comes. */
function updateHint() {
  if (!hint || !hintLabel) return;
  if (againBtn) againBtn.hidden = !finished;
  if (finished) {
    hintLabel.textContent = '💥 All smashed!';
    hint.classList.remove('nge-hammer-hint--growing');
    return;
  }
  const n = shownNow.length, all = PATCH.length;
  const ready = n >= all || (n > 0 && performance.now() - smashFrom > 15_000);
  hintLabel.textContent = ready ? '🔨 Click a pumpkin to smash it' : `🌱 The pumpkins are growing, ${n} of ${all}`;
  hint.classList.toggle('nge-hammer-hint--growing', !ready);
}

const HAMMER = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text x="2" y="32" font-size="30">🔨</text></svg>')}") 8 8, crosshair`;

function ensureStyle() {
  if (document.getElementById('nge-hammer-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-hammer-style';
  st.textContent = `
body.nge-pumpkin-hammer .nge-3d-panel, body.nge-pumpkin-hammer .nge-3d-panel * { cursor: ${HAMMER} !important; }
.nge-hammer-hint {
  position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 20000;
  display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 16px; border-radius: 999px;
  font: 600 14px/1.2 Inter, system-ui, sans-serif; color: #ffe2bf;
  background: rgba(26, 14, 4, 0.92); border: 1px solid rgba(255, 150, 50, 0.6);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 18px rgba(255, 140, 30, 0.25);
}
.nge-hammer-hint--growing span { animation: nge-hammer-grow 1.1s ease-in-out infinite alternate; }
@keyframes nge-hammer-grow { from { opacity: 0.55; } to { opacity: 1; } }
.nge-hammer-hint button {
  font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 999px; cursor: pointer;
  color: #1c0d00; background: linear-gradient(180deg, #ffb35c, #ff8a1f); border: 0;
}`;
  document.head.appendChild(st);
}

/** Screen position and size of pumpkin i in a 3D panel, or null. */
function onPanel(i: number, panel: any): { x: number; y: number; r: number } | null {
  const prop = states[i].prop;
  const m = panel?.projectionParameters?.value?.viewProjectionMat;
  const el: HTMLElement | undefined = panel?.element;
  if (!prop || !m || !el) return null;
  const rect = el.getBoundingClientRect();
  const project = (mx: number, my: number, mz: number) => {
    const mm = prop.modelMat;
    const wx = mm[0] * mx + mm[4] * my + mm[8] * mz + mm[12];
    const wy = mm[1] * mx + mm[5] * my + mm[9] * mz + mm[13];
    const wz = mm[2] * mx + mm[6] * my + mm[10] * mz + mm[14];
    const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
    if (cw <= 0) return null;
    const cx = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / cw;
    const cy = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / cw;
    return { x: rect.left + (cx + 1) / 2 * rect.width, y: rect.top + (1 - cy) / 2 * rect.height };
  };
  const c = project(0, 0, 0), e = project(0.55, 0, 0), t = project(0, 0.55, 0);
  if (!c || !e || !t) return null;
  return { x: c.x, y: c.y, r: Math.max(Math.hypot(e.x - c.x, e.y - c.y), Math.hypot(t.x - c.x, t.y - c.y), 14) };
}

/** A short crunch, made on the spot: no sound file to load. */
function crunch() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ac: AudioContext = new AC();
    const len = Math.floor(ac.sampleRate * 0.35);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 3);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ac.createGain();
    g.gain.value = 0.35;
    src.connect(f).connect(g).connect(ac.destination);
    src.start();
    src.onended = () => { ac.close(); };
  } catch { /* no sound */ }
}

function smash(i: number) {
  const prop = states[i].prop;
  if (!prop || smashed.has(i)) return;
  smashed.add(i);
  flying++;
  crunch();
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / SMASH_MS);
    prop.shatter = 0.02 + 0.98 * t;
    prop.alpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
    try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    if (t < 1) { requestAnimationFrame(step); return; }
    flying--;
    if (smashing && !finished && flying === 0 && shownNow.length && shownNow.every(k => smashed.has(k))) allSmashed();
  };
  requestAnimationFrame(step);
}

/** After a hit, the rest of that click (mouseup, click) is the hammer's too,
 *  so the viewer does not also select or move. */
let swallowUntil = 0;
function swallow(e: Event) {
  if (performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); }
}
function onHammerDown(e: MouseEvent) {
  if (!smashing || e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest?.('.nge-3d-panel')) return;
  let best = -1, bestD = Infinity;
  for (const panel of viewer?.display?.panels ?? []) {
    if (!panel?.element?.contains?.(target)) continue;
    for (const i of shownNow) {
      if (smashed.has(i)) continue;
      const at = onPanel(i, panel);
      if (!at) continue;
      const d = Math.hypot(e.clientX - at.x, e.clientY - at.y);
      if (d < at.r * 1.15 && d < bestD) { best = i; bestD = d; }
    }
  }
  if (best < 0) return;  // a miss: the viewer gets the click
  e.preventDefault();
  e.stopPropagation();
  swallowUntil = performance.now() + 600;
  smash(best);
}
function onHammerKey(e: KeyboardEvent) {
  if (smashing && e.key === 'Escape') { e.stopPropagation(); stopSmashing(); }
}

/** Hand the player the hammer. */
export function startSmashing() {
  if (smashing) return;
  smashing = true;
  ensureStyle();
  document.body.classList.add('nge-pumpkin-hammer');
  // pointerdown and mousedown both: neuroglancer listens for mousedown
  window.addEventListener('pointerdown', onHammerDown, true);
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('mouseup', swallow, true);
  window.addEventListener('click', swallow, true);
  window.addEventListener('keydown', onHammerKey, true);
  hint = document.createElement('div');
  hint.className = 'nge-hammer-hint';
  hint.setAttribute('role', 'status');
  const label = document.createElement('span');
  hintLabel = label;
  smashFrom = performance.now();
  againBtn = document.createElement('button');
  againBtn.type = 'button';
  againBtn.textContent = 'Again?';
  againBtn.hidden = true;
  againBtn.addEventListener('click', () => smashAgain());
  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = 'Done';
  done.addEventListener('click', () => stopSmashing());
  hint.append(label, againBtn, done);
  document.body.appendChild(hint);
  updateHint();
}

/** The last pumpkin is down: they are off (hidePumpkin), whole again behind
 *  the scenes, and the bar offers another round. */
function allSmashed() {
  finished = true;
  setPumpkinHidden(true);
  for (const i of smashed) { const p = states[i].prop; if (p) { p.shatter = 0; p.alpha = 1; } }
  smashed.clear();
  updateHint();
}

/** Again?: the pumpkins grow back and the hammer stays. */
function smashAgain() {
  if (!smashing) return;
  finished = false;
  smashFrom = performance.now();
  for (let i = 0; i < PATCH.length; i++) {
    const prop = states[i].prop, full = placement(PATCH[i]);
    if (prop && full) grow(prop, full);
  }
  setPumpkinHidden(false);
  updateHint();
}

/** Put the hammer away. Pumpkins smashed: all of them off until the chat
 *  bar's pumpkin button brings them back, whole again. */
export function stopSmashing() {
  if (!smashing) return;
  smashing = false;
  document.body.classList.remove('nge-pumpkin-hammer');
  window.removeEventListener('pointerdown', onHammerDown, true);
  window.removeEventListener('mousedown', swallow, true);
  window.removeEventListener('mouseup', swallow, true);
  window.removeEventListener('click', swallow, true);
  window.removeEventListener('keydown', onHammerKey, true);
  hint?.remove();
  hint = null;
  hintLabel = null;
  againBtn = null;
  finished = false;
  const any = smashed.size > 0;
  const finish = () => {
    // off first, so the pieces never flash back whole
    if (any) setPumpkinHidden(true);
    for (const i of smashed) { const p = states[i].prop; if (p) { p.shatter = 0; p.alpha = 1; } }
    smashed.clear();
  };
  // let pieces still in the air land first
  if (flying > 0) setTimeout(finish, SMASH_MS); else finish();
}

/** The field report's Smash the pumpkins. */
export function smashPumpkins() { visitPumpkinPatch(true); }
