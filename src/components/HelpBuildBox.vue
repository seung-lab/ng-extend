<script setup lang="ts">
/**
 * Help build a Hunt (Ames 2026-10-27): an invited helper's box, docked under the top bar. They merge and cut the
 * cell with the normal tools; Pyr keeps each edit as a suggestion and the cell stays as it is (hunt_build.ts).
 * Two merges and two cuts each, with Go there, a note and Take back until an admin acts on one. Opened from the
 * top bar's "Help build a Hunt" pill.
 */
import { computed, ref, watch } from 'vue';
import { useDragBox } from '../util/drag_box';
import reaperIcon from '../images/reaper-icon.png';
import { huntCall } from '../hunt';
import { buildState, loadBuild, openBuildCell, goToNm, onBuildDataset, drawMySuggestions, type MineCell, type MySuggestion } from '../hunt_build';

const pick = ref(0);
// Dragged by its header, and it stays where it was put (util/drag_box.ts, as the Hunt box).
const boxEl = ref<HTMLElement | null>(null);
const { posStyle, dragging, startDrag } = useDragBox('nge-help-build-pos', boxEl);
const busy = ref('');
const error = ref('');
const noteFor = ref<number | null>(null);
const noteText = ref('');

const cell = computed<MineCell | null>(() => buildState.mine[pick.value] ?? buildState.mine[0] ?? null);
watch(() => buildState.mine.length, (n) => { if (pick.value >= n) pick.value = 0; });
const kindWord = (s: MySuggestion) => (s.kind === 'merge' ? 'Merge' : 'Cut');
const detail = (s: MySuggestion) => (s.kind === 'merge' ? 'two pieces joined' : `${(s.edit as any).sources?.length ?? 0} red, ${(s.edit as any).sinks?.length ?? 0} blue points`);
const statusWord = (s: MySuggestion) => (s.status === 'planted' ? '✓ planted' : s.status === 'skipped' ? 'not used' : s.status === 'open' ? 'sent' : s.status === 'draft' ? 'not sent yet' : s.status === 'undone' ? 'not used' : '');
const drafts = computed(() => cell.value?.suggestions.filter(s => s.status === 'draft') ?? []);
/** Just sent: the congrats (Ames 2026-10-27: "a congrats state? we can use a grim reaper image"). */
const sentNow = ref(0);
watch(() => cell.value?.id, () => { sentNow.value = 0; });
async function sendAll() {
  const c = cell.value; if (!c || busy.value || !drafts.value.length) return;
  busy.value = 'send'; error.value = '';
  try {
    const r = await huntCall<{ sent: number }>('build.send', { candidate_id: c.id });
    sentNow.value = r.sent || drafts.value.length;
    buildState.last = '';
    await loadBuild(true); drawMySuggestions();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
const here = computed(() => onBuildDataset());
const closesLine = computed(() => (cell.value?.closes ? new Date(cell.value.closes).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''));

async function open() {
  const c = cell.value; if (!c || busy.value) return;
  busy.value = 'open'; error.value = '';
  try { await openBuildCell(c); }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function takeBack(s: MySuggestion) {
  if (busy.value) return;
  busy.value = `back${s.id}`; error.value = '';
  try { await huntCall('build.take_back', { id: s.id }); await loadBuild(true); drawMySuggestions(); buildState.last = ''; }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
function startNote(s: MySuggestion) { noteFor.value = s.id; noteText.value = s.note || ''; }
async function saveNote(s: MySuggestion) {
  if (busy.value) return;
  busy.value = `note${s.id}`; error.value = '';
  try { await huntCall('build.my_note', { id: s.id, note: noteText.value.trim() }); s.note = noteText.value.trim(); noteFor.value = null; }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
/** The tool bar's own Submit (SplitMergeOverlay.vue), pressed for the helper: the edit goes through the guard and is kept. */
function submitHere() {
  error.value = '';
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.nge-smo-action-btn.submit-btn')].find(b => b.offsetParent !== null);
  if (!btn) { error.value = 'Press Cut or Merge in the tool bar first, then Ctrl + click your points.'; return; }
  btn.click();
}
function close() { buildState.helping = false; }
</script>

<template>
  <aside v-if="buildState.helping && buildState.mine.length" ref="boxEl" class="nge-hb" :class="{ 'nge-hb--dragging': dragging }" :style="posStyle" role="dialog" aria-label="Help build a Hunt">
    <div class="nge-hb-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-hb-title">Help build a Hunt</span>
      <select v-if="buildState.mine.length > 1" v-model.number="pick" class="nge-hb-pick" aria-label="Which cell">
        <option v-for="(c, i) in buildState.mine" :key="c.id" :value="i">Cell …{{ c.root.slice(-6) }}</option>
      </select>
      <span v-else-if="cell" class="nge-hb-id">Cell …{{ cell.root.slice(-6) }}</span>
      <button class="nge-hb-x" aria-label="Close" @click="close">×</button>
    </div>
    <template v-if="cell">
      <!-- Each step spelled out (Ames 2026-10-27: "am I supposed to hit submit cut? instructions unclear") -->
      <ol v-if="cell.open" class="nge-hb-steps">
        <li>Press <b>Cut</b> or <b>Merge</b> in the tool bar, as you normally would.</li>
        <li>Ctrl + click to place your points.</li>
        <li>Press <b>Submit cut / merge</b> below (or Submit in the tool bar). Pyr checks it would work and puts it in your list. The cell does not change.</li>
        <li>When you are done, press <b>Send to the admins</b>.</li>
      </ol>
      <p v-if="cell.open" class="nge-hb-muted">Where yours go stays a secret until the Hunt.<template v-if="cell.closes"> Open until {{ closesLine }}.</template></p>
      <p v-else class="nge-hb-hint">Suggestions for this cell have closed. Thanks for helping! The admins are looking at them now.</p>
      <div class="nge-hb-btnrow">
        <button class="nge-hb-btn nge-hb-btn--open" :disabled="!!busy" @click="open">{{ busy === 'open' ? 'Opening…' : here ? 'Show the cell' : 'Open the cell on the Sandbox' }}</button>
        <button v-if="cell.open" class="nge-hb-btn nge-hb-btn--submit" :disabled="!!busy" title="Saves the cut or merge you are making as your suggestion. Nothing in the cell changes." @click="submitHere">Submit cut / merge</button>
      </div>
      <div class="nge-hb-counts">
        <span><b>Merges</b> {{ cell.used.merge }} of {{ cell.merges_each }}
          <i v-for="n in cell.merges_each" :key="`m${n}`" class="nge-hb-pip" :class="{ 'nge-hb-pip--merge': n <= cell.used.merge }"></i></span>
        <span><b>Cuts</b> {{ cell.used.cut }} of {{ cell.cuts_each }}
          <i v-for="n in cell.cuts_each" :key="`c${n}`" class="nge-hb-pip" :class="{ 'nge-hb-pip--cut': n <= cell.used.cut }"></i></span>
      </div>
      <div v-if="sentNow" class="nge-hb-win" role="status">
        <img class="nge-hb-reaper" :src="reaperIcon" alt="" />
        <div>
          <b class="nge-hb-wintitle">Sent!</b>
          <span class="nge-hb-wintext">{{ sentNow }} {{ sentNow === 1 ? 'suggestion is' : 'suggestions are' }} with the admins. You hear in the bell when one is planted, and every helper with a planted one gets an Achievement when the Hunt ends.</span>
        </div>
      </div>
      <p v-if="buildState.last" class="nge-hb-last" :class="{ 'nge-hb-last--bad': !buildState.lastOk }" role="status">{{ buildState.last }}</p>
      <ul v-if="cell.suggestions.length" class="nge-hb-list">
        <li v-for="s in cell.suggestions" :key="s.id" class="nge-hb-row">
          <i class="nge-hb-dot" :class="`nge-hb-dot--${s.kind}`"></i>
          <span class="nge-hb-what"><b>{{ kindWord(s) }}</b> <span class="nge-hb-sub">· {{ s.note || detail(s) }}</span>
            <span v-if="statusWord(s)" class="nge-hb-st" :class="{ 'nge-hb-st--ok': s.status === 'planted' }">{{ statusWord(s) }}</span></span>
          <span class="nge-hb-acts">
            <button class="nge-hb-link" :disabled="!here" :title="here ? 'Go to it' : 'Open the cell first'" @click="goToNm(s.at)">Go there</button>
            <template v-if="(s.status === 'draft' || s.status === 'open') && cell.open">
              <button class="nge-hb-link" @click="startNote(s)">Note</button>
              <button class="nge-hb-link" :disabled="!!busy" @click="takeBack(s)">{{ busy === `back${s.id}` ? 'Taking back…' : 'Take back' }}</button>
            </template>
          </span>
          <span v-if="noteFor === s.id" class="nge-hb-noterow">
            <input v-model="noteText" class="nge-hb-note" maxlength="300" placeholder="Why this one is a good Hunt error" aria-label="A note for the admins" @keydown.enter="saveNote(s)" />
            <button class="nge-hb-btn nge-hb-btn--small" :disabled="!!busy" @click="saveNote(s)">Save</button>
          </span>
        </li>
      </ul>
      <p v-else class="nge-hb-muted">No suggestions yet. Find a spot where a merger or a missing piece would fool a hunter.</p>
      <button v-if="cell.open && drafts.length" class="nge-hb-btn nge-hb-btn--send" :disabled="!!busy" @click="sendAll">{{ busy === 'send' ? 'Sending…' : `Send to the admins (${drafts.length})` }}</button>
    </template>
    <p v-if="error" class="nge-hb-error" role="alert">{{ error }}</p>
  </aside>
</template>

<style scoped>
.nge-hb { position: fixed; top: 72px; right: 16px; z-index: 925; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; padding: 10px 12px 12px;
  border-radius: 12px; border: 1px solid rgba(245, 209, 66, 0.5); background: linear-gradient(158deg, rgba(10, 17, 32, 0.96), rgba(5, 9, 19, 0.98));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5); color: #e6f0ff; font: 13px/1.45 'Inter', sans-serif; display: flex; flex-direction: column; gap: 8px; }
.nge-hb-head { display: flex; align-items: center; gap: 8px; cursor: grab; touch-action: none; user-select: none; }
.nge-hb--dragging .nge-hb-head { cursor: grabbing; }
.nge-hb-title { flex: 1; font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #f5d142; }
.nge-hb-id { font: 12px 'JetBrains Mono', ui-monospace, monospace; color: #9fb7d9; }
.nge-hb-pick { padding: 2px 6px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.35); color: #e6f0ff; font: 12px 'Inter', sans-serif; }
.nge-hb-x { border: none; background: none; color: #9fb7d9; font-size: 18px; line-height: 1; cursor: pointer; }
.nge-hb-x:hover { color: #fff; }
.nge-hb-hint { margin: 0; padding: 6px 8px; border-left: 3px solid #42d5ec; background: rgba(66, 213, 236, 0.07); border-radius: 0 6px 6px 0; font-size: 12.5px; }
.nge-hb-counts { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #cfdcef; font-variant-numeric: tabular-nums; }
.nge-hb-pip { display: inline-block; width: 14px; height: 5px; margin-left: 3px; border-radius: 3px; background: rgba(90, 170, 255, 0.25); vertical-align: middle; }
.nge-hb-pip--merge { background: #f5d142; }
.nge-hb-pip--cut { background: #9b5cff; }
.nge-hb-last { margin: 0; color: #9ff0bf; font-size: 12.5px; }
.nge-hb-last--bad { color: #ffb3b3; }
.nge-hb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nge-hb-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; align-items: center; padding: 6px 2px; border-top: 1px solid rgba(90, 170, 255, 0.15); }
.nge-hb-dot { width: 9px; height: 9px; border-radius: 50%; }
.nge-hb-dot--merge { background: #f5d142; }
.nge-hb-dot--cut { background: #9b5cff; }
.nge-hb-what { min-width: 0; }
.nge-hb-sub { color: #9fb7d9; font-size: 12px; }
.nge-hb-st { margin-left: 6px; font-size: 11.5px; color: #9fb7d9; }
.nge-hb-st--ok { color: #9ff0bf; }
.nge-hb-acts { grid-column: 2; display: flex; gap: 10px; }
.nge-hb-link { padding: 0; border: none; background: none; cursor: pointer; color: #9fd0ff; font: 12px 'Inter', sans-serif; }
.nge-hb-link:hover:not(:disabled) { color: #fff; text-decoration: underline; }
.nge-hb-link:disabled { opacity: 0.45; cursor: default; }
.nge-hb-noterow { grid-column: 2; display: flex; gap: 6px; }
.nge-hb-note { flex: 1; min-width: 0; padding: 4px 8px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.35); color: #e6f0ff; font: 12px 'Inter', sans-serif; }
.nge-hb-btn { padding: 5px 12px; border-radius: 8px; cursor: pointer; font: 600 12.5px 'Inter', sans-serif; background: rgba(4, 8, 18, 0.6); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; align-self: flex-start; }
.nge-hb-btn:hover:not(:disabled) { border-color: #9fd0ff; }
.nge-hb-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hb-btn--open { background: rgba(90, 170, 255, 0.16); border-color: #5aaaff; }
.nge-hb-btn--submit { background: rgba(245, 209, 66, 0.18); border-color: #f5d142; color: #fff3c4; }
.nge-hb-btnrow { display: flex; flex-wrap: wrap; gap: 8px; }
.nge-hb-btn--send { align-self: stretch; padding: 8px 12px; background: rgba(72, 214, 130, 0.18); border-color: #48d682; color: #dfffea; }
.nge-hb-win { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(245, 209, 66, 0.55);
  background: radial-gradient(120% 140% at 0% 50%, rgba(245, 209, 66, 0.14), rgba(90, 170, 255, 0.06) 60%, transparent); animation: ngeHbWin 0.5s cubic-bezier(.2, 1.4, .4, 1) both; }
.nge-hb-reaper { width: 56px; height: 56px; flex: none; object-fit: contain; filter: drop-shadow(0 0 8px rgba(245, 209, 66, 0.35)); }
.nge-hb-wintitle { display: block; font: 700 14px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; color: #fff8dc; }
.nge-hb-wintext { display: block; margin-top: 2px; font-size: 12px; color: #d9e6f5; }
@keyframes ngeHbWin { 0% { transform: scale(0.92); opacity: 0; } 100% { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .nge-hb-win { animation: none; } }
.nge-hb-steps { margin: 0; padding: 6px 8px 6px 26px; border-left: 3px solid #42d5ec; background: rgba(66, 213, 236, 0.07); border-radius: 0 6px 6px 0; font-size: 12.5px; display: flex; flex-direction: column; gap: 3px; }
.nge-hb-steps b { color: #fff; }
.nge-hb-btn--small { padding: 3px 10px; font-size: 12px; }
.nge-hb-muted { margin: 0; color: #9fb7d9; font-size: 12px; }
.nge-hb-error { margin: 0; color: #ff9b9b; font-size: 12.5px; }
</style>
