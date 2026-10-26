<script setup lang="ts">
/**
 * MecMarkStatus: the lab's marks on the MEC cell in view, in the Cell
 * Library (Ames 2026-10-24: "some way to see cell status overview in here
 * prior to players hitting submit? like maybe click to expand to see #
 * annotations", then "maybe we can have this open up in the cell overview
 * panel itself"). One line under the working claim; open, it is the marking
 * tool too: pick a mark and Ctrl + click the cell to drop it, confirm the soma
 * at the starting point, find the ends at the edge. The same marks as
 * Highlight's lab marks (highlight.ts), in the same layers, so they mix.
 * Counts every point in the lab's layers, placed here, in Highlight or by hand.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { MEC_KINDS, MEC_SOMA, mecCounts, somaState, startXyz, mecKindOfLayer } from '../util/mec_marks';
import { mecStyles, pickUnderMouse, addLabMark, confirmSomaAtStart, goToStart, sharedLabPick, addEdgeMarks, workingRoot, autoEdgeNews, undoHighlight } from '../util/highlight';

const props = defineProps<{ startOpen?: boolean }>();
// Open unless the player closed it (Ames 2026-10-24: "make the Marks open by
// default on MEC claims"); a close is remembered in this browser.
const OPEN_KEY = 'nge_mec_marks_closed';
const open = ref(!!props.startOpen || (() => { try { return localStorage.getItem(OPEN_KEY) !== '1'; } catch { return true; } })());
watch(open, o => { if (!props.startOpen) { try { o ? localStorage.removeItem(OPEN_KEY) : localStorage.setItem(OPEN_KEY, '1'); } catch { /* private mode */ } } });
const counts = ref<Record<string, number>>(mecCounts());
const soma = ref(somaState());
const hasStart = ref(!!startXyz());
const marks = MEC_KINDS.filter(k => k !== MEC_SOMA);
/** The mark a Ctrl + click drops, while one is picked. */
// Shared with the Highlight box, so both always place the same mark.
const armed = sharedLabPick;
const busy = ref(false);
const message = ref('');
const bad = ref(false);
let lastRoot: string | null = null;

let newsShown = '';
/** Share done of a search for the edge (Find, or Pyr's own), or null. */
const autoLooking = ref<number | null>(null);
const looking = ref<number | null>(null);
function read() {
  counts.value = mecCounts(); soma.value = somaState(); hasStart.value = !!startXyz();
  // The search on its own, while it runs.
  autoLooking.value = autoEdgeNews.looking;
  // Hits Edge placed on their own: said here too, once.
  if (autoEdgeNews.last && autoEdgeNews.last !== newsShown) { newsShown = autoEdgeNews.last; say(newsShown); }
}
function say(text: string, isBad = false) { message.value = text; bad.value = isBad; }

const somaLine = () => soma.value.state === 'start' ? 'Confirmed at the starting point'
  : soma.value.state === 'moved' ? `Placed at ${soma.value.xyz!.join(', ')}` : 'Not confirmed yet';
function markLine(key: string, n: number): string {
  if (n) return `${n} placed`;
  if (key === 'mec:ais') return 'None yet. Skip it if the cell has no distinct axon.';
  if (key === 'mec:edge') return 'None yet';
  return 'None yet';
}
const hintOf = (key: string) => MEC_KINDS.find(k => k.key === key)?.hint ?? '';
const labelOf = (key: string) => MEC_KINDS.find(k => k.key === key)?.label ?? '';

function arm(key: string) {
  armed.value = armed.value === key ? null : key;
  say(armed.value ? `Ctrl + click the cell to place ${labelOf(armed.value)}.` : '');
}
// Closing Marks leaves the pick alone: the Highlight box may be using it.

// ── The number keys pick a mark too (Ames 2026-10-24: "I want to be able to
// use the numbers to switch between these highlight points as well"). The
// lab's marks live in layers, and a number makes its layer the active one
// (viewer.ts), as a click on its tab does: when that layer is one of the
// lab's, its mark is picked here. Each row shows its key.
const keyOf = ref<Record<string, number>>({});
function readKeys() {
  const out: Record<string, number> = {};
  let n = 0;
  for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (ml.archived) continue;
    ++n;
    const k = mecKindOfLayer(ml.name);
    if (k && n <= 9 && out[k.key] === undefined) out[k.key] = n;
  }
  keyOf.value = out;
}
function onSelectedLayer() {
  const name = (window as any).viewer?.selectedLayer?.layer?.name;
  const k = name ? mecKindOfLayer(name) : undefined;
  if (!k) return;
  open.value = true;
  if (armed.value !== k.key) arm(k.key);
}

// ── Ctrl + click drops the picked mark (as Highlight does). Merge, Cut and
// Find Path keep their own Ctrl + click; with the Highlight box open, it
// places the marks, so nothing is placed twice.
const editToolOpen = () => !!document.querySelector('.graphene-tool-status') || !!document.querySelector('.nge-hl-panel');
const inViewer = (t: HTMLElement | null) =>
  !t?.closest?.('.nge-cl-panel, .nge-mms') && !!t?.closest?.('.neuroglancer-rendered-data-panel, .neuroglancer-panel');
function onPointer(e: PointerEvent) {
  if (!armed.value || busy.value || e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
  if (!inViewer(e.target as HTMLElement | null) || editToolOpen()) return;
  e.preventDefault();
  e.stopPropagation();
  void place();
}
function onContextMenu(e: MouseEvent) {
  if (armed.value && e.ctrlKey && !editToolOpen() && inViewer(e.target as HTMLElement | null)) { e.preventDefault(); e.stopPropagation(); }
}
async function place() {
  const key = armed.value;
  const style = mecStyles().find(s => s.key === key);
  if (!style) return;
  const pick = pickUnderMouse();
  if ('error' in pick) { say(pick.error, true); return; }
  lastRoot = pick.root;
  try {
    await addLabMark(pick, style);
    read();
    say(key === 'mec:soma' ? `Soma placed at ${soma.value.xyz?.join(', ') ?? 'this point'}.` : `${style.label} placed.`);
  } catch (e: any) { say(e?.message || 'Could not place that mark.', true); }
}

async function findEdges() {
  if (busy.value) return;
  busy.value = true;
  looking.value = 0;
  say('');
  try {
    const r = await addEdgeMarks(workingRoot(lastRoot), () => true, (done, total) => { looking.value = total ? done / total : 0; });
    read();
    const had = r.already ? ` ${r.already} already marked.` : '';
    say(r.added ? `Added ${r.added} Hits Edge ${r.added === 1 ? 'mark' : 'marks'}.${had} Check each one.`
      : `Nothing new reaches the edge of the data.${had}`);
  } catch (e: any) { say(e?.message || 'Could not look for the edge.', true); }
  finally { busy.value = false; looking.value = null; }
}
/** Take back the newest mark: one click, or the whole batch Find placed. */
function undoLast() {
  say(undoHighlight() ? 'Removed the last mark.' : 'Nothing to undo.');
  read();
}

async function confirmSoma() {
  try { const p = await confirmSomaAtStart(); read(); say(`Soma confirmed at the starting point, ${p.join(', ')}.`); }
  catch (e: any) { say(e?.message || 'Could not mark the soma.', true); }
}
function lookAtStart() { if (!goToStart()) say("Pyr doesn't know this cell's starting point.", true); }


let timer: ReturnType<typeof setInterval> | undefined;
let stopSelected = () => { /* set on mount */ };
let stopLayers = () => { /* set on mount */ };
onMounted(() => {
  readKeys();
  try {
    const v = (window as any).viewer;
    const sel = v.selectedLayer.changed, lc = v.layerManager.layersChanged;
    sel.add(onSelectedLayer); lc.add(readKeys);
    stopSelected = () => sel.remove(onSelectedLayer);
    stopLayers = () => lc.remove(readKeys);
  } catch { /* no viewer yet */ }
  timer = setInterval(read, 1500);
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('contextmenu', onContextMenu, true);
});
onBeforeUnmount(() => {
  stopSelected();
  stopLayers();
  if (timer) clearInterval(timer);
  window.removeEventListener('pointerdown', onPointer, true);
  window.removeEventListener('contextmenu', onContextMenu, true);
});
</script>

<template>
  <div class="nge-mms" :class="{ 'nge-mms--open': open }">
    <button type="button" class="nge-mms-head" :aria-expanded="open ? 'true' : 'false'" @click="open = !open"
            :title="open ? 'Hide the marks' : 'Mark this cell for the lab, and see what is placed'">
      <svg class="nge-mms-caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="nge-mms-title">Marks</span>
      <span class="nge-mms-chip" :style="{ '--k': MEC_SOMA.color }" :class="{ 'nge-mms-chip--none': soma.state === 'none' }">
        <i></i>Soma {{ soma.state === 'none' ? 'not yet' : '✓' }}
      </span>
      <span v-for="k in marks" :key="k.key" class="nge-mms-chip" :style="{ '--k': k.color }" :class="{ 'nge-mms-chip--none': !counts[k.key] }">
        <i></i>{{ k.label }} {{ counts[k.key] ?? 0 }}
      </span>
    </button>
    <div v-if="open" class="nge-mms-body">
      <p class="nge-mms-how">Pick a mark (or press its number), then Ctrl + click the cell to place it.</p>
      <div class="nge-mms-list" role="radiogroup" aria-label="Mark to place">
        <button type="button" role="radio" class="nge-mms-row" :class="{ 'nge-mms-row--on': armed === MEC_SOMA.key }"
                :aria-checked="armed === MEC_SOMA.key ? 'true' : 'false'" :style="{ '--k': MEC_SOMA.color }" @click="arm(MEC_SOMA.key)">
          <i></i><b>Soma<kbd v-if="keyOf[MEC_SOMA.key]" class="nge-mms-key" :title="`Key ${keyOf[MEC_SOMA.key]}`">{{ keyOf[MEC_SOMA.key] }}</kbd></b><span>{{ somaLine() }}</span>
        </button>
        <div v-if="armed === MEC_SOMA.key" class="nge-mms-sub">
          <template v-if="hasStart">
            <span>The starting point is the nucleus, inside the soma.</span>
            <span class="nge-mms-btns">
              <button type="button" class="nge-mms-btn" @click="lookAtStart">Go to the starting point</button>
              <button type="button" class="nge-mms-btn nge-mms-btn--ok" @click="confirmSoma">{{ soma.state === 'none' ? 'Confirm soma here' : 'Back to the starting point' }}</button>
            </span>
          </template>
          <span v-else>Ctrl + click a colored part of the soma.</span>
        </div>
        <button v-for="k in marks" :key="k.key" type="button" role="radio" class="nge-mms-row" :class="{ 'nge-mms-row--on': armed === k.key }"
                :aria-checked="armed === k.key ? 'true' : 'false'" :style="{ '--k': k.color }" :title="k.hint" @click="arm(k.key)">
          <i></i><b>{{ k.label }}<kbd v-if="keyOf[k.key]" class="nge-mms-key" :title="`Key ${keyOf[k.key]}`">{{ keyOf[k.key] }}</kbd></b><span>{{ markLine(k.key, counts[k.key] ?? 0) }}</span>
        </button>
        <div v-if="armed && armed !== MEC_SOMA.key" class="nge-mms-sub"><span>{{ hintOf(armed) }}</span></div>
      </div>
      <div class="nge-mms-foot">
        <button type="button" class="nge-mms-btn" :disabled="busy || autoLooking !== null" @click="findEdges"
                title="Mark Hits Edge wherever the cell reaches the end of the data, from the lab's image mask.">Find ends at the edge</button>
        <button type="button" class="nge-mms-btn" :disabled="busy" @click="undoLast"
                title="Remove the newest mark. All the Hits Edge marks one search placed go together.">Undo</button>
        <span v-if="looking !== null || autoLooking !== null" class="nge-mms-progress" role="status">
          <span class="nge-mms-bar"><span :style="{ width: Math.round(((looking ?? autoLooking) ?? 0) * 100) + '%' }"></span></span>
          Looking for the edge of the data, {{ Math.round(((looking ?? autoLooking) ?? 0) * 100) }}%
        </span>
        <span v-else class="nge-mms-msg" :class="{ 'nge-mms-msg--bad': bad }" role="status">{{ message || "The lab's sheet gets these counts when you complete the cell." }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nge-mms { margin: 0; padding: 4px 12px 6px 28px; font: 11.5px/1.35 'Inter', 'Segoe UI', sans-serif; color: rgba(220, 230, 245, 0.75); }
.nge-mms-head {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; width: 100%; padding: 3px 0; border: 0; background: none;
  cursor: pointer; text-align: left; font: inherit; color: inherit;
}
.nge-mms-head:hover .nge-mms-title { color: #fff; }
.nge-mms-head:focus-visible, .nge-mms-row:focus-visible, .nge-mms-btn:focus-visible { outline: 1px solid rgba(127, 212, 255, 0.8); outline-offset: 2px; border-radius: 4px; }
.nge-mms-caret { flex-shrink: 0; color: rgba(200, 220, 240, 0.6); transition: transform 0.15s ease; }
.nge-mms--open .nge-mms-caret { transform: rotate(90deg); }
.nge-mms-title { font-weight: 600; color: rgba(220, 230, 245, 0.9); }
.nge-mms-chip { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.nge-mms i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--k); flex-shrink: 0; }
.nge-mms-chip--none { color: rgba(200, 212, 228, 0.42); }
.nge-mms-chip--none i { background: transparent; box-shadow: inset 0 0 0 1.5px var(--k); }
.nge-mms-body { margin: 4px 0 2px; padding: 7px 8px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); }
.nge-mms-key { margin-left: 5px; padding: 0 4px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.22); font: 600 9.5px 'JetBrains Mono', 'Consolas', monospace; color: rgba(230, 238, 250, 0.75); }
.nge-mms-how { margin: 0 0 5px; color: rgba(200, 212, 228, 0.6); }
.nge-mms-list { display: flex; flex-direction: column; gap: 1px; }
.nge-mms-row {
  display: grid; grid-template-columns: 10px 96px 1fr; align-items: baseline; gap: 6px; width: 100%;
  padding: 4px 6px; border: 1px solid transparent; border-radius: 5px; background: none; cursor: pointer;
  text-align: left; font: inherit; color: inherit;
}
.nge-mms-row:hover { background: rgba(255, 255, 255, 0.04); }
.nge-mms-row--on { border-color: var(--k); background: color-mix(in srgb, var(--k) 12%, transparent); color: #fff; }
.nge-mms-row b { font-weight: 600; color: rgba(230, 238, 250, 0.92); }
.nge-mms-sub { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 3px 6px 6px 22px; color: rgba(220, 230, 245, 0.7); }
.nge-mms-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-mms-btn {
  padding: 4px 9px; border-radius: 6px; cursor: pointer; font: 600 11px 'Inter', sans-serif;
  color: #cfe6ff; background: rgba(74, 158, 255, 0.1); border: 1px solid rgba(74, 158, 255, 0.3);
}
.nge-mms-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.2); }
.nge-mms-btn:disabled { opacity: 0.45; cursor: default; }
.nge-mms-btn--ok { color: #2a2205; background: #ffd24d; border-color: #ffd24d; }
.nge-mms-btn--ok:hover:not(:disabled) { background: #ffe07f; }
.nge-mms-progress { display: inline-flex; align-items: center; gap: 7px; flex: 1; min-width: 160px; font-size: 11px; color: rgba(220, 230, 245, 0.75); }
.nge-mms-bar { position: relative; flex: 0 0 70px; height: 4px; border-radius: 2px; background: rgba(255, 154, 60, 0.18); overflow: hidden; }
.nge-mms-bar > span { position: absolute; inset: 0 auto 0 0; background: #ff9a3c; transition: width 0.3s ease; }
@media (prefers-reduced-motion: reduce) { .nge-mms-bar > span { transition: none; } }
.nge-mms-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 7px; }
.nge-mms-msg { flex: 1; min-width: 140px; font-size: 11px; color: rgba(200, 212, 228, 0.55); }
.nge-mms-msg--bad { color: #ff9aa8; }
@media (prefers-reduced-motion: reduce) { .nge-mms-caret { transition: none; } }
</style>
