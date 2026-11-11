<script setup lang="ts">
/**
 * Step through the practice cell candidates (Ames 2026-11-10: "can you make a branch that lets me step through
 * your proposed candidates?"). Opens with ?practiceCandidates in the address. Each candidate goes to the
 * Sandbox, shows the two pieces either side of the join in two colors as they were at the edit, and puts a
 * point on the join. "As it is now" shows the join supervoxels' roots today instead. Read only: nothing is
 * edited or saved.
 */
import { computed, onMounted, ref } from 'vue';
import { makeLayer } from 'neuroglancer/layer';
import { canonicalDataset, currentDatasetTag, findDatasetBySegName, segLayerName, switchToDataset } from '../datasets';
import { useDragBox } from '../util/drag_box';
import { PRACTICE_CANDIDATES, type PracticeCandidate } from '../practice_candidates';

const OPEN = typeof location !== 'undefined' && /[?&#]practiceCandidates\b/.test(location.href);
const JOIN_LAYER = 'Join';
const SEG = 'pinky_nf_v2';
const COLORS = ['#5aaaff', '#f5d142'];

const open = ref(OPEN);
const index = ref(0);
const now = ref(false);
const busy = ref(false);
const error = ref('');
const boxEl = ref<HTMLElement | null>(null);
const { dragging, posStyle, startDrag } = useDragBox('nge_practice_cands_pos', boxEl);

const list = PRACTICE_CANDIDATES;
const c = computed<PracticeCandidate>(() => list[index.value]);
const kindLabel = (k: PracticeCandidate['kind']) => (k === 'cut' ? 'Cut practice' : 'Merge practice');
const kindHow = (k: PracticeCandidate['kind']) => (k === 'cut'
  ? 'A merger someone cut apart. To use it, you merge the two pieces again here, and learners cut it.'
  : 'A branch a proofreader joined back on. To use it, you cut it off again here, and learners merge it.');
const voxels = ref<number[] | null>(null);

const viewer = (): any => (window as any)['viewer'];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
function managed(name: string): any {
  return (viewer()?.layerManager?.managedLayers ?? []).find((ml: any) => ml.name === name && !ml.archived) ?? null;
}
function nmToVoxels(dims: Record<string, any>): (nm: number[]) => number[] {
  const axes = Object.keys(dims || {});
  return (nm: number[]) => axes.map(a => { const k = ['x', 'y', 'z'].indexOf(a); return k < 0 ? 0 : nm[k] / (Number(dims[a][0]) * 1e9); });
}

async function show() {
  const cand = c.value;
  busy.value = true; error.value = '';
  try {
    const want = findDatasetBySegName(SEG);
    if (!want) throw new Error('This version of Pyr does not have the Sandbox.');
    if (canonicalDataset(currentDatasetTag()) !== SEG) {
      const ok = await switchToDataset(want, { forJump: true });
      if (!ok) throw new Error('Could not switch to the Sandbox.');
      for (let i = 0; i < 40 && canonicalDataset(currentDatasetTag()) !== SEG; i++) await wait(250);
      for (let i = 0; i < 40 && !viewer()?.state; i++) await wait(250);
      await wait(800);
    }
    const v = viewer();
    const state = v?.state?.toJSON?.();
    if (!state?.dimensions) throw new Error('The viewer is not ready yet. Try again in a moment.');
    const segSpec: any = want.layers.find((l: any) => l.type === 'segmentation');
    const cur: any = (state.layers ?? []).find((l: any) => l?.type === 'segmentation') ?? {};
    const ids = now.value ? cand.now : cand.pieces;
    const segmentColors: Record<string, string> = {};
    ids.forEach((id, k) => { segmentColors[id] = COLORS[k % COLORS.length]; });
    const segLayer: any = { type: 'segmentation', name: segLayerName(want), source: segSpec.source, segments: [...ids], segmentColors };
    for (const k of ['tab', 'objectAlpha', 'selectedAlpha', 'notSelectedAlpha', 'meshSilhouetteRendering']) if (cur[k] !== undefined) segLayer[k] = cur[k];
    const toVox = nmToVoxels(state.dimensions);
    const at = toVox(cand.nm);
    voxels.value = at.slice(0, 3).map(x => Math.round(x));
    const layers = [...(state.layers ?? []).filter((l: any) => l?.type === 'image'), segLayer];
    const next = { ...state, layers, position: at };
    delete next.selectedLayer; delete next.selection;
    v.state.restoreState(next);
    // The point goes on once the view has settled (as hunt_from_edits.ts showSession does): a layer added
    // with the restore, or too soon after it, comes back empty.
    const add = () => {
      if (managed(JOIN_LAYER)) return;
      v.layerSpecification.add(makeLayer(v.layerSpecification, JOIN_LAYER, {
        type: 'annotation', source: { url: 'local://annotations' }, tool: 'annotatePoint', annotationColor: '#ff5ad1', pointSize: 6, onTop: true,
        annotations: [{ type: 'point', id: `join-${cand.op}`, point: at, description: `op ${cand.op}` }],
      }));
    };
    let steady = 0;
    for (let i = 0; i < 20 && steady < 3; i++) {
      await wait(250);
      const ml = managed(JOIN_LAYER);
      if ((ml?.layer?.localAnnotations?.toJSON?.() ?? []).length) { steady++; continue; }
      steady = 0;
      if (ml) { try { v.layerManager.removeManagedLayer(ml); } catch { /* gone */ } }
      add();
    }
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    busy.value = false;
  }
}
function step(d: number) { index.value = (index.value + d + list.length) % list.length; show(); }
function toggleNow(e: Event) { now.value = (e.target as HTMLInputElement).checked; show(); }
function goToJoin() {
  try {
    const v = viewer(), p = Array.from<number>(v.navigationState.position.value);
    (voxels.value ?? []).forEach((x, k) => { p[k] = x; });
    v.navigationState.position.value = Float32Array.from(p);
  } catch { /* no viewer */ }
}
async function copy(text: string) { try { await navigator.clipboard.writeText(text); } catch { /* not allowed */ } }

onMounted(async () => {
  if (!open.value) return;
  for (let i = 0; i < 80 && !viewer()?.state?.toJSON?.()?.dimensions; i++) await wait(250);
  show();
});
</script>

<template>
  <div v-if="open" ref="boxEl" class="nge-pcb" :class="{ 'nge-pcb--dragging': dragging }" :style="posStyle" role="dialog" aria-label="Practice cell candidates">
    <div class="nge-pcb-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-pcb-title">Practice candidates</span>
      <span class="nge-pcb-count">{{ index + 1 }} of {{ list.length }}</span>
      <button class="nge-pcb-x" aria-label="Close" @pointerdown.stop @click="open = false">×</button>
    </div>
    <div class="nge-pcb-kind" :class="'nge-pcb-kind--' + c.kind">{{ kindLabel(c.kind) }}</div>
    <p class="nge-pcb-note">{{ c.note }}</p>
    <p class="nge-pcb-how">{{ kindHow(c.kind) }}</p>
    <dl class="nge-pcb-facts">
      <dt>Edit</dt><dd>op {{ c.op }}, user {{ c.user }}, {{ c.date }}</dd>
      <dt>Join</dt><dd>{{ c.kind === 'cut' ? c.edges + ' edges cut' : 'one merge' }}</dd>
      <dt>Pieces</dt>
      <dd>
        <span class="nge-pcb-dot" :style="{ background: COLORS[0] }" /> {{ c.sizes[0].toLocaleString() }} chunks
        <span class="nge-pcb-dot" :style="{ background: COLORS[1] }" /> {{ c.sizes[1].toLocaleString() }} chunks
      </dd>
      <dt>Where</dt>
      <dd><button class="nge-pcb-link" title="Copy" @click="copy((voxels ?? []).join(', '))">{{ (voxels ?? []).join(', ') }}</button></dd>
      <dt>Supervoxels</dt>
      <dd><button class="nge-pcb-link nge-pcb-mono" title="Copy" @click="copy(c.sv.join(', '))">{{ c.sv[0] }}<br>{{ c.sv[1] }}</button></dd>
    </dl>
    <label class="nge-pcb-check"><input type="checkbox" :checked="now" @change="toggleNow" /> As it is now (today's roots)</label>
    <div class="nge-pcb-steps">
      <button class="nge-pcb-btn" :disabled="busy" @click="step(-1)">Previous</button>
      <button class="nge-pcb-btn" :disabled="busy" @click="goToJoin">Go to join</button>
      <button class="nge-pcb-btn" :disabled="busy" @click="step(1)">Next</button>
    </div>
    <p v-if="busy" class="nge-pcb-status">Loading…</p>
    <p v-if="error" class="nge-pcb-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.nge-pcb {
  position: fixed; right: 16px; top: 64px; z-index: 9000;
  width: 330px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
  background: rgba(6, 10, 20, 0.95); border: 1px solid rgba(90, 170, 255, 0.45); border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55); backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; font-size: 13px;
}
.nge-pcb-head { display: flex; align-items: baseline; gap: 8px; cursor: grab; user-select: none; touch-action: none; margin: -12px -14px 0; padding: 12px 14px 2px; }
.nge-pcb--dragging .nge-pcb-head { cursor: grabbing; }
.nge-pcb-title { font-size: 15px; font-weight: 600; color: #8cc4ff; }
.nge-pcb-count { margin-left: auto; color: rgba(220, 230, 245, 0.7); font-size: 12.5px; }
.nge-pcb-x { background: none; border: 0; color: #a9bbd3; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-pcb-kind { align-self: flex-start; padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 12px; }
.nge-pcb-kind--cut { background: rgba(245, 209, 66, 0.16); color: #f5d142; }
.nge-pcb-kind--merge { background: rgba(90, 170, 255, 0.16); color: #8cc4ff; }
.nge-pcb-note { margin: 0; line-height: 1.45; }
.nge-pcb-how { margin: 0; line-height: 1.45; color: rgba(220, 230, 245, 0.7); font-size: 12.5px; }
.nge-pcb-facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 2px 0; font-size: 12.5px; }
.nge-pcb-facts dt { color: #8fa3bf; }
.nge-pcb-facts dd { margin: 0; }
.nge-pcb-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 2px 0 4px; vertical-align: middle; }
.nge-pcb-dot:first-child { margin-left: 0; }
.nge-pcb-link { background: none; border: 0; padding: 0; color: #dce6f5; cursor: copy; text-align: left; font: inherit; }
.nge-pcb-link:hover { color: #fff; text-decoration: underline; }
.nge-pcb-mono { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
.nge-pcb-check { display: flex; gap: 6px; align-items: center; color: #a9bbd3; font-size: 12.5px; }
.nge-pcb-steps { display: flex; gap: 6px; }
.nge-pcb-btn { flex: 1; padding: 6px 8px; border-radius: 7px; cursor: pointer; background: rgba(90, 170, 255, 0.12); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; font: 600 12.5px 'Inter', sans-serif; }
.nge-pcb-btn:hover:not(:disabled), .nge-pcb-btn:focus-visible { background: rgba(90, 170, 255, 0.22); }
.nge-pcb-btn:disabled { opacity: 0.5; cursor: default; }
.nge-pcb-status { margin: 0; color: #a9bbd3; font-size: 12px; }
.nge-pcb-error { margin: 0; color: #ff9b9b; font-size: 12.5px; }
</style>
