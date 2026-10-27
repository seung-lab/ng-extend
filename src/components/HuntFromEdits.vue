<script setup lang="ts">
/**
 * Admin Hub > Hunts > 1. The answer key: "Or make it from a proofread cell"
 * (Ames 2026-10-26: "I need to be able to see the coords marked before we
 * do the hunt"). Paste a proofread cell, pick when players start from, and
 * the cell as it was then is on screen with every place a numbered point:
 * Mergers in gold, Extensions in purple. The editor reads those two layers
 * as its key. "Check them in the viewer" closes the Admin Hub (it covers
 * the view) for the box over the viewer, HuntPlacesBox.vue.
 * The state lives in util/hunt_from_edits.ts (fromEdits), so it outlasts
 * the Admin Hub closing. The rules: util/hunt_history_steps.ts.
 */
import { computed, ref } from 'vue';
import { currentDatasetTag, canonicalDataset } from '../datasets';
import { HISTORY_SOURCES, sourceFor, readCellHistory, showSession, somaVoxels, setFinishedCell, fromEdits, keepHistory, pickedSession } from '../util/hunt_from_edits';
import type { Place } from '../util/hunt_history_steps';
import HuntPlacesList from 'components/HuntPlacesList.vue';

const props = defineProps<{ toleranceUm: number }>();
const emit = defineEmits<{
  (e: 'shown', v: { root: string; soma: number[] | null; places: number }): void;
  (e: 'check'): void;
}>();

if (!fromEdits.dataset) fromEdits.dataset = sourceFor(currentDatasetTag())?.canon ?? HISTORY_SOURCES[0].canon;
const busy = ref('');
const error = ref('');
const tolNm = computed(() => Math.max(100, Math.round((Number(props.toleranceUm) || 3) * 1000)));
const history = computed(() => fromEdits.history);
const session = computed(() => pickedSession());

const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const kindsLine = (places: Place[]) => {
  const c = places.filter(p => p.kind === 'cut').length, m = places.length - c;
  return places.length ? [c ? count(c, 'merger', 'mergers') : '', m ? count(m, 'extension', 'extensions') : ''].filter(Boolean).join(', ') : 'nothing to find';
};

async function find() {
  if (busy.value) return;
  error.value = '';
  keepHistory(null); fromEdits.pick = -1; fromEdits.selected = '';
  setFinishedCell(null, false); fromEdits.finished = false;
  try {
    busy.value = 'Starting';
    const h = await readCellHistory(fromEdits.dataset, fromEdits.root, tolNm.value, s => { busy.value = s; });
    keepHistory(h);
    await choose(h.best);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

async function choose(i: number) {
  const h = fromEdits.history;
  if (!h || !h.sessions[i]) return;
  fromEdits.pick = i; fromEdits.selected = '';
  error.value = '';
  busy.value = 'Putting the cell on screen';
  try {
    await showSession(h, h.sessions[i]);
    if (fromEdits.finished) setFinishedCell(h, true);
    emit('shown', { root: h.sessions[i].beforeRoot, soma: somaVoxels(h), places: h.sessions[i].places.length });
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

function finished(e: Event) { fromEdits.finished = (e.target as HTMLInputElement).checked; setFinishedCell(fromEdits.history, fromEdits.finished); }

const droppedLine = computed(() => {
  const d = session.value?.dropped;
  if (!d) return '';
  // What happened, in the proofreaders' terms (Ames 2026-10-26: "what does this mean?").
  const parts = [
    d.hidden ? `${count(d.hidden, 'fix', 'fixes')} in pieces not yet part of the cell` : '',
    d.closeCut ? `${count(d.closeCut, 'cut', 'cuts')} on the same spot as another (one gem finds both)` : '',
    d.closeMerge ? `${count(d.closeMerge, 'join', 'joins')} on the same spot as another (one gem finds both)` : '',
    d.idle ? `${count(d.idle, 'cut', 'cuts')} that separated nothing` : '',
    d.tiny ? `${count(d.tiny, 'tiny piece', 'tiny pieces')} (a spine or a crumb)` : '',
    d.undone ? `${count(d.undone, 'edit', 'edits')} taken back` : '',
    d.failed ? `${count(d.failed, 'edit', 'edits')} that did not go through` : '',
  ].filter(Boolean);
  return parts.length ? `Left out: ${parts.join(', ')}.` : '';
});
const onDataset = computed(() => canonicalDataset(currentDatasetTag()) === fromEdits.dataset);
</script>

<template>
  <div class="nge-hfe">
    <div class="nge-hfe-head">Or make it from a proofread cell</div>
    <p class="nge-hfe-help">Paste a cell from the proofread list. Each cut the proofreaders made becomes a merger to find, each join an extension. Players start from the cell as it was before the edits you pick, so check every place in the viewer first.</p>
    <div class="nge-hfe-row">
      <select v-model="fromEdits.dataset" class="nge-hfe-input nge-hfe-ds" aria-label="Dataset" :disabled="!!busy">
        <option v-for="s in HISTORY_SOURCES" :key="s.canon" :value="s.canon">{{ s.label }}</option>
      </select>
      <input v-model="fromEdits.root" class="nge-hfe-input nge-hfe-root" placeholder="864691136814060915" aria-label="Proofread cell ID" :disabled="!!busy" @keydown.enter="find" />
      <button class="nge-hfe-btn" :disabled="!!busy || !fromEdits.root.trim()" @click="find">Find the edits</button>
    </div>
    <p v-if="!onDataset && !history" class="nge-hfe-muted">Opening it switches to {{ sourceFor(fromEdits.dataset)?.label }}.</p>
    <p v-if="busy" class="nge-hfe-busy" role="status">{{ busy }}…</p>
    <p v-if="error" class="nge-hfe-error" role="alert">{{ error }}</p>

    <template v-if="history">
      <p class="nge-hfe-muted">{{ history.source.label }}, proofread<template v-if="history.status">: {{ history.status }}</template>. {{ count(history.cellEdits, 'edit', 'edits') }} on the cell itself, {{ history.totalEdits }} in its whole history.</p>
      <p v-if="!history.reaches" class="nge-hfe-warn">The cell's edits did not lead all the way to this ID, so some may be missing. Check the places by hand.</p>

      <div class="nge-hfe-label">Players start from the cell as it was</div>
      <div class="nge-hfe-sessions" role="radiogroup" aria-label="When players start from">
        <button v-for="(s, i) in history.sessions" :key="s.at" type="button" role="radio" :aria-checked="i === fromEdits.pick"
                class="nge-hfe-session" :class="{ 'nge-hfe-session--on': i === fromEdits.pick, 'nge-hfe-session--empty': !s.places.length }"
                :disabled="!!busy" @click="choose(i)">
          <span>Before {{ day(s.at) }}</span>
          <span class="nge-hfe-session-count">{{ kindsLine(s.places) }}</span>
          <span class="nge-hfe-session-after">{{ count(s.editsAfter, 'edit', 'edits') }} after</span>
        </button>
      </div>

      <template v-if="session">
        <HuntPlacesList />
        <p v-if="droppedLine" class="nge-hfe-muted">{{ droppedLine }}</p>
        <label class="nge-hfe-check"><input type="checkbox" :checked="fromEdits.finished" @change="finished" /> Show the finished cell (only you see it)</label>
        <button class="nge-hfe-btn nge-hfe-btn--look" :disabled="!!busy" @click="emit('check')">Check them in the viewer</button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.nge-hfe { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px; border: 1px dashed rgba(90, 170, 255, 0.3); border-radius: 8px; }
.nge-hfe-head { color: #9fd0ff; font-size: 12.5px; font-weight: 600; }
.nge-hfe-help { margin: 0; color: #a9bbd3; font-size: 12.5px; line-height: 1.45; }
.nge-hfe-row { display: flex; gap: 6px; align-items: center; }
.nge-hfe-input { box-sizing: border-box; padding: 6px 8px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.3); color: #e6f0ff; font: 13px 'Inter', sans-serif; }
.nge-hfe-ds { flex: none; max-width: 140px; }
.nge-hfe-root { flex: 1; min-width: 0; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
.nge-hfe-btn { flex: none; padding: 6px 12px; border-radius: 7px; cursor: pointer; background: rgba(90, 170, 255, 0.12); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; font: 600 13px 'Inter', sans-serif; white-space: nowrap; }
.nge-hfe-btn:hover:not(:disabled), .nge-hfe-btn:focus-visible { background: rgba(90, 170, 255, 0.22); }
.nge-hfe-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hfe-btn--look { align-self: flex-start; margin-top: 4px; background: rgba(245, 209, 66, 0.16); border-color: rgba(245, 209, 66, 0.65); color: #fff3c4; }
.nge-hfe-btn--look:hover:not(:disabled) { background: rgba(245, 209, 66, 0.28); }
.nge-hfe-muted { margin: 0; color: #8fa3bf; font-size: 12.5px; line-height: 1.4; }
.nge-hfe-busy { margin: 0; color: #9fd0ff; font-size: 12.5px; }
.nge-hfe-error { margin: 0; color: #ffb3b3; font-size: 12.5px; }
.nge-hfe-warn { margin: 0; color: #f8e08a; font-size: 12px; }
.nge-hfe-label { margin-top: 4px; color: #8fa3bf; font-size: 11.5px; }
.nge-hfe-sessions { display: flex; flex-direction: column; gap: 2px; }
.nge-hfe-session { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: baseline; text-align: left; padding: 5px 8px; border-radius: 6px;
  background: none; border: 1px solid transparent; color: #c9d6ea; font: 12.5px 'Inter', sans-serif; cursor: pointer; }
.nge-hfe-session:hover:not(:disabled) { background: rgba(90, 170, 255, 0.08); }
.nge-hfe-session--on { background: rgba(245, 209, 66, 0.1); border-color: rgba(245, 209, 66, 0.45); color: #fff3c4; }
.nge-hfe-session--empty { color: #7d8799; }
.nge-hfe-session-count { justify-self: end; }
.nge-hfe-session-after { color: #8fa3bf; font-size: 11.5px; }
.nge-hfe-check { display: flex; flex-direction: row !important; gap: 6px; align-items: center; color: #a9bbd3; font-size: 12.5px; margin-top: 4px; }
</style>
