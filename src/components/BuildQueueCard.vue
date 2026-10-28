<script setup lang="ts">
/**
 * The Hunt Builder's suggestions queue (Ames 2026-10-27), modeled on the Hunt reports queue (HuntReportCard.vue):
 * docked under the top bar, never over the view; the oldest open suggestion first, already there, with the
 * helper's own points; ‹ › and Next; a note for each; who suggested it. Plant it sends the helper's edit to the
 * graph for real (hunt_build.ts plantSuggestion); Skip; Undo while the cell is still being built.
 * Opened by Admin Hub > Hunts > Hunt builder (event nge:build-queue, { id }).
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { huntCall } from '../hunt';
import { useProofreadingBackendStore } from '../store';
import { showSuggestion, showPlanted, hideSuggestion, previewCut, plantSuggestion, undoPlanting, type QueueCell, type QueueSuggestion } from '../hunt_build';

interface Queue { cell: QueueCell; suggestions: QueueSuggestion[] }
const queue = ref<Queue | null>(null);
const idx = ref(0);
const busy = ref('');
const error = ref('');
const done = ref('');
const note = ref('');
const piece = ref<number | null>(null);
const preview = ref('');

const sug = computed(() => queue.value?.suggestions[idx.value] ?? null);
const openCount = computed(() => queue.value?.suggestions.filter(s => s.status === 'open').length ?? 0);
const planting = computed(() => queue.value?.cell.status === 'planting');
const nextOpen = computed(() => {
  const list = queue.value?.suggestions ?? [];
  const after = list.findIndex((s, i) => i > idx.value && s.status === 'open');
  return after >= 0 ? after : list.findIndex((s, i) => i < idx.value && s.status === 'open');
});
const celebrate = computed(() => !!queue.value?.suggestions.length && openCount.value === 0 && (queue.value?.suggestions.some(s => s.done_by) ?? false));
const tally = computed(() => {
  const l = queue.value?.suggestions ?? [];
  return { planted: l.filter(s => s.status === 'planted').length, skipped: l.filter(s => s.status === 'skipped').length, all: l.length };
});
const whenOf = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const pointsLine = computed(() => {
  const s = sug.value; if (!s) return '';
  if (s.kind === 'merge') return 'two points: the cell, and the piece to join';
  const e: any = s.edit;
  return `${e.sources?.length ?? 0} red, ${e.sinks?.length ?? 0} blue points`;
});
const statusWords = computed(() => {
  const s = sug.value; if (!s || s.status === 'open') return '';
  const by = s.done_by ? ` by ${s.done_by}` : '', at = s.done_at ? `, ${whenOf(s.done_at)}` : '';
  return s.status === 'planted' ? `✓ Planted${by}${at}. ${s.name} has the credit.` : s.status === 'skipped' ? `Skipped${by}${at}.` : s.status === 'undone' ? `Planted, then undone${by}${at}.` : `Put back${by}${at}.`;
});
// A merge joins whole objects: a big piece means a whole neighbor would come too (the design's warning).
const bigPiece = computed(() => sug.value?.kind === 'merge' && (piece.value ?? 0) > 300);

const GEM_COLORS = ['#5fe3f5', '#5aaaff', '#9b5cff', '#48d682', '#f5d142', '#9fd0ff'];
const burst = Array.from({ length: 18 }, (_, i) => ({
  '--a': `${(i / 18) * 360 + (i % 3) * 7}deg`, '--d': `${70 + (i % 4) * 26}px`, '--t': `${(i % 5) * 0.05}s`, '--s': `${0.7 + (i % 3) * 0.25}`, color: GEM_COLORS[i % GEM_COLORS.length],
}));

/** The bell notes for these suggestions, marked read: going through them here is reading them (as Hunt reports). */
function markNotesRead(ids: number[]) {
  if (!ids.length) return;
  const backend = useProofreadingBackendStore();
  const want = new Set(ids);
  const notes = (backend.notifications as any[]).filter(n => {
    const m = String(n.body || '').match(/#nge-build-suggestion=(\d+)/);
    return m && want.has(Number(m[1])) && !n.read;
  }).map(n => n.id);
  if (notes.length) void backend.markAllNotificationsRead(notes);
}
async function load(id: number, keep?: number, suggestion?: number) {
  const q = await huntCall<Queue>('build.queue', id ? { id } : { suggestion_id: suggestion });
  markNotesRead(q.suggestions.filter(s => s.status !== 'open').map(s => s.id));
  if (suggestion) keep = suggestion;
  queue.value = q;
  const at = keep ? q.suggestions.findIndex(s => s.id === keep) : -1;
  if (at >= 0) return at;
  const first = q.suggestions.findIndex(s => s.status === 'open');
  return first >= 0 ? first : Math.max(0, q.suggestions.length - 1);
}
async function openQueue(id: number, suggestion?: number) {
  queue.value = null; error.value = ''; done.value = '';
  busy.value = 'load';
  try { await step(await load(id, undefined, suggestion)); }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { if (busy.value === 'load') busy.value = ''; }
}
function onOpen(e: Event) {
  const d = (e as CustomEvent).detail || {};
  if (Number(d.id) || Number(d.suggestion)) void openQueue(Number(d.id) || 0, Number(d.suggestion) || undefined);
}
onMounted(() => document.addEventListener('nge:build-queue', onOpen));
onUnmounted(() => { document.removeEventListener('nge:build-queue', onOpen); hideSuggestion(); });

async function step(i: number) {
  const list = queue.value?.suggestions ?? [];
  if (i < 0 || i >= list.length) return;
  idx.value = i; done.value = ''; error.value = ''; preview.value = ''; piece.value = null;
  note.value = list[i].admin_note || '';
  markNotesRead([list[i].id]);
  busy.value = '';
  await goThere();
}
async function goThere() {
  const q = queue.value, s = sug.value; if (!q || !s || busy.value === 'go') return;
  busy.value = 'go'; error.value = '';
  try {
    // Planted: the cell as it is now, with what the planting made; otherwise the suggestion on the cell before it.
    if (s.status === 'planted') await showPlanted(q.cell.root, s);
    else piece.value = (await showSuggestion(q.cell, s)).pieceL2;
  }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function doPreview() {
  const s = sug.value; if (!s || busy.value) return;
  if (s.kind === 'merge') { preview.value = piece.value == null ? 'The piece to join is shown in violet beside the cell.' : `The piece to join (violet) has ${piece.value} level 2 ${piece.value === 1 ? 'chunk' : 'chunks'}.`; return; }
  busy.value = 'preview'; error.value = '';
  try {
    const p = await previewCut(s.edit);
    preview.value = p.illegal ? 'The graph says this cut would not separate anything as it is. Skip it, or plant and check.'
      : `The cut would leave ${p.sides[0] ?? 0} supervoxels on the red side and ${p.sides[1] ?? 0} on the blue side. Nothing has changed yet.`;
  } catch (e: any) { error.value = `No preview: ${e?.message || e}`; }
  finally { busy.value = ''; }
}
async function plant() {
  const q = queue.value, s = sug.value; if (!q || !s || busy.value) return;
  busy.value = 'plant'; error.value = '';
  try {
    const out = await plantSuggestion(q.cell, s, note.value.trim()) as Queue;
    queue.value = out;
    idx.value = Math.max(0, out.suggestions.findIndex(x => x.id === s.id));
    done.value = `Planted. ${s.name} hears it in the bell (never where). The view shows the cell now${s.kind === 'cut' ? ', and the piece taken off in violet' : ''}.`;
    const now = out.suggestions.find(x => x.id === s.id);
    if (now) await showPlanted(out.cell.root, now);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function skip() {
  const s = sug.value; if (!s || busy.value) return;
  busy.value = 'skip'; error.value = '';
  try {
    const out = await huntCall<Queue>('build.skip', { id: s.id, note: note.value.trim() });
    queue.value = out; idx.value = Math.max(0, out.suggestions.findIndex(x => x.id === s.id));
    done.value = 'Skipped.'; hideSuggestion();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function undo() {
  const q = queue.value, s = sug.value; if (!q || !s || busy.value) return;
  busy.value = 'undo'; error.value = '';
  try {
    const out = await undoPlanting(q.cell, s) as Queue;
    queue.value = out; idx.value = Math.max(0, out.suggestions.findIndex(x => x.id === s.id));
    done.value = 'Undone in the graph.';
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function saveNote() {
  const s = sug.value; if (!s || busy.value) return;
  busy.value = 'note'; error.value = '';
  try {
    const out = await huntCall<Queue>('build.note', { id: s.id, note: note.value.trim() });
    queue.value = out; idx.value = Math.max(0, out.suggestions.findIndex(x => x.id === s.id));
    done.value = 'Note saved. Only the admins see it.';
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
function close() { queue.value = null; error.value = ''; hideSuggestion(); }
</script>

<template>
  <aside v-if="queue || error || busy === 'load'" class="nge-bq" role="dialog" aria-label="Hunt suggestions">
    <div class="nge-bq-head">
      <span class="nge-bq-kicker">Suggestions</span>
      <span class="nge-bq-title">Hunt cell {{ queue ? `…${queue.cell.root.slice(-6)}` : '' }}</span>
      <span v-if="queue && !planting" class="nge-bq-state">{{ queue.cell.status === 'suggesting' ? 'Still taking suggestions' : queue.cell.status }}</span>
      <button class="nge-bq-x" aria-label="Close" @click="close">×</button>
    </div>
    <p v-if="busy === 'load'" class="nge-bq-muted">Loading…</p>
    <template v-else-if="queue && sug">
      <div class="nge-bq-nav">
        <button class="nge-bq-arrow" :disabled="idx === 0 || !!busy" aria-label="The suggestion before" @click="step(idx - 1)">‹</button>
        <span class="nge-bq-count">{{ idx + 1 }} of {{ queue.suggestions.length }}, oldest first</span>
        <button class="nge-bq-arrow" :disabled="idx >= queue.suggestions.length - 1 || !!busy" aria-label="The suggestion after" @click="step(idx + 1)">›</button>
        <span class="nge-bq-open" :class="{ 'nge-bq-open--none': !openCount }">{{ openCount ? `${openCount} open` : 'All done' }}</span>
      </div>
      <p class="nge-bq-what"><span class="nge-bq-chip" :class="`nge-bq-chip--${sug.kind}`">{{ sug.kind === 'merge' ? 'Merge' : 'Cut' }}</span>
        from <b>{{ sug.name }}</b> <span class="nge-bq-when">{{ whenOf(sug.t) }} · {{ pointsLine }}</span></p>
      <p v-if="sug.note" class="nge-bq-note">"{{ sug.note }}"</p>
      <p v-if="sug.kind === 'merge' && piece != null && !bigPiece && sug.status === 'open'" class="nge-bq-muted">The piece to join, in violet, has {{ piece }} level 2 {{ piece === 1 ? 'chunk' : 'chunks' }}.</p>
      <p v-if="bigPiece" class="nge-bq-flag">The piece to join is big ({{ piece }} chunks): a merge joins whole objects, so all of it comes along. You can still plant it, or cut a smaller piece off it first.</p>
      <p v-if="statusWords" class="nge-bq-status" :class="{ 'nge-bq-status--ok': sug.status === 'planted' }">{{ statusWords }}</p>
      <p v-if="!planting && sug.status === 'open'" class="nge-bq-muted">Close the suggestions and start planting (in the Hunt builder list) to plant.</p>
      <p v-else-if="planting" class="nge-bq-veil">Veiled: players can't see this cell in Pyr until the Hunt starts.</p>
      <div class="nge-bq-actions">
        <button class="nge-bq-btn" :disabled="!!busy" @click="goThere">{{ busy === 'go' ? 'Going…' : 'Go there again' }}</button>
        <button v-if="sug.status === 'open' && sug.kind === 'cut'" class="nge-bq-btn" :disabled="!!busy" title="Asks the graph what the cut would take off, before anything changes" @click="doPreview">{{ busy === 'preview' ? 'Asking…' : 'Preview the cut' }}</button>
        <button v-if="sug.status === 'open'" class="nge-bq-btn nge-bq-btn--plant" :disabled="!!busy || !planting" @click="plant">{{ busy === 'plant' ? 'Planting…' : `Plant it (${sug.kind})` }}</button>
        <button v-if="sug.status === 'open'" class="nge-bq-btn" :disabled="!!busy" @click="skip">{{ busy === 'skip' ? 'Skipping…' : 'Skip' }}</button>
        <button v-if="sug.status === 'planted' && (planting || queue.cell.status === 'building')" class="nge-bq-btn" :disabled="!!busy" @click="undo">{{ busy === 'undo' ? 'Undoing…' : 'Undo' }}</button>
      </div>
      <p v-if="preview" class="nge-bq-preview">{{ preview }}</p>
      <div class="nge-bq-noterow">
        <input v-model="note" class="nge-bq-noteinput" maxlength="300" placeholder="A note (optional), only admins see it" aria-label="A note on this suggestion" />
        <button v-if="note.trim() && note.trim() !== sug.admin_note" class="nge-bq-btn nge-bq-btn--small" :disabled="!!busy" @click="saveNote">{{ busy === 'note' ? 'Saving…' : 'Save note' }}</button>
      </div>
      <p v-if="done && !celebrate" class="nge-bq-done" role="status">{{ done }}</p>
      <div v-if="celebrate" class="nge-bq-win" role="status">
        <span class="nge-bq-burst" aria-hidden="true">
          <svg v-for="(g, i) in burst" :key="i" class="nge-bq-gem" :style="g" viewBox="0 0 24 24" width="14" height="14"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
        </span>
        <b class="nge-bq-wintitle">Every suggestion checked!</b>
        <span class="nge-bq-wintext">{{ tally.all }} {{ tally.all === 1 ? 'suggestion' : 'suggestions' }}: {{ tally.planted }} planted, {{ tally.skipped }} skipped. Next: Finish planting in the Hunt builder list, then Make the Hunt.</span>
      </div>
      <div class="nge-bq-foot">
        <span class="nge-bq-legend"><i class="nge-bq-dot nge-bq-dot--merge"></i>merge points <i class="nge-bq-dot nge-bq-dot--red"></i>red <i class="nge-bq-dot nge-bq-dot--blue"></i>blue <i class="nge-bq-dot nge-bq-dot--piece"></i>piece to join</span>
        <button class="nge-bq-btn nge-bq-btn--next" :disabled="nextOpen < 0 || !!busy" @click="step(nextOpen)">Next open ›</button>
      </div>
    </template>
    <p v-else-if="queue" class="nge-bq-muted">No suggestions on this cell yet.</p>
    <p v-if="error" class="nge-bq-error" role="alert">{{ error }}</p>
  </aside>
</template>

<style scoped>
.nge-bq { position: fixed; top: 72px; left: 50%; transform: translateX(-50%); z-index: 930; width: min(580px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 10px 14px 12px; border-radius: 12px; border: 1px solid rgba(245, 209, 66, 0.55); background: linear-gradient(158deg, rgba(10, 17, 32, 0.96), rgba(5, 9, 19, 0.98));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), 0 0 16px rgba(245, 209, 66, 0.12); color: #e6f0ff; font: 13px/1.45 'Inter', sans-serif; }
.nge-bq-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.nge-bq-kicker { font: 700 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #f5d142; }
.nge-bq-title { flex: 1; min-width: 0; font-weight: 700; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; }
.nge-bq-state { font-size: 11.5px; color: #9fb7d9; }
.nge-bq-x { border: none; background: none; color: #9fb7d9; font-size: 18px; line-height: 1; cursor: pointer; }
.nge-bq-x:hover { color: #fff; }
.nge-bq-nav { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 12px; color: #9fb7d9; }
.nge-bq-arrow { width: 24px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer; font: 700 15px/1 'Inter', sans-serif; background: rgba(4, 8, 18, 0.6); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; }
.nge-bq-arrow:hover:not(:disabled) { border-color: #9fd0ff; }
.nge-bq-arrow:disabled { opacity: 0.35; cursor: default; }
.nge-bq-count { font-variant-numeric: tabular-nums; }
.nge-bq-open { margin-left: auto; padding: 1px 8px; border-radius: 999px; font-weight: 700; color: #cdefff; background: rgba(90, 170, 255, 0.16); border: 1px solid rgba(90, 170, 255, 0.4); }
.nge-bq-open--none { color: #9ff0bf; background: rgba(72, 214, 130, 0.12); border-color: rgba(72, 214, 130, 0.45); }
.nge-bq-what, .nge-bq-note, .nge-bq-flag, .nge-bq-status, .nge-bq-veil, .nge-bq-muted { margin: 0 0 6px; }
.nge-bq-chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 700; font-size: 11.5px; margin-right: 4px; }
.nge-bq-chip--merge { color: #f5d142; border: 1px solid rgba(245, 209, 66, 0.55); }
.nge-bq-chip--cut { color: #c8a4ff; border: 1px solid rgba(155, 92, 255, 0.6); }
.nge-bq-when { font-size: 11.5px; color: #8299bb; }
.nge-bq-note { color: #cfe9f5; }
.nge-bq-flag { padding: 4px 8px; border-radius: 7px; font-size: 12px; color: #ffe9a8; background: rgba(245, 209, 66, 0.08); border: 1px solid rgba(245, 209, 66, 0.35); }
.nge-bq-status { font-weight: 600; color: #cfdcef; }
.nge-bq-status--ok { color: #9ff0bf; }
.nge-bq-veil { font-size: 12px; color: #7fe6f5; }
.nge-bq-muted { color: #9fb7d9; font-size: 12px; }
.nge-bq-actions, .nge-bq-noterow, .nge-bq-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nge-bq-noterow { margin-top: 8px; }
.nge-bq-foot { margin-top: 8px; justify-content: space-between; }
.nge-bq-btn { padding: 5px 12px; border-radius: 8px; cursor: pointer; font: 600 12.5px 'Inter', sans-serif; background: rgba(4, 8, 18, 0.6); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; }
.nge-bq-btn:hover:not(:disabled) { border-color: #9fd0ff; color: #fff; }
.nge-bq-btn:disabled { opacity: 0.5; cursor: default; }
.nge-bq-btn--small { padding: 4px 10px; font-size: 12px; }
.nge-bq-btn--plant { background: rgba(245, 209, 66, 0.18); border-color: #f5d142; color: #fff3c4; }
.nge-bq-btn--next { margin-left: auto; }
.nge-bq-preview { margin: 6px 0 0; font-size: 12px; color: #cfe9f5; }
.nge-bq-noteinput { flex: 1; min-width: 180px; padding: 5px 8px; border-radius: 7px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.35); color: #e6f0ff; font: 12px 'Inter', sans-serif; }
.nge-bq-legend { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 11px; color: #8299bb; }
.nge-bq-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 4px; }
.nge-bq-dot--merge { background: #f5d142; }
.nge-bq-dot--red { background: #ff5a6e; }
.nge-bq-dot--blue { background: #5aaaff; }
.nge-bq-dot--piece { background: #9b5cff; }
.nge-bq-done { margin: 8px 0 0; color: #9ff0bf; }
.nge-bq-error { margin: 8px 0 0; color: #ff9b9b; }
.nge-bq-win { position: relative; margin: 10px 0 0; padding: 12px 14px; border-radius: 10px; text-align: center; overflow: visible;
  border: 1px solid rgba(245, 209, 66, 0.6); background: radial-gradient(120% 140% at 50% 0%, rgba(245, 209, 66, 0.16), rgba(90, 170, 255, 0.08) 60%, transparent);
  animation: ngeBqWin 0.6s cubic-bezier(.2, 1.4, .4, 1) both; }
.nge-bq-wintitle { display: block; font: 700 15px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.06em; color: #fff8dc; text-shadow: 0 0 14px rgba(245, 209, 66, 0.6); }
.nge-bq-wintext { display: block; margin-top: 4px; font-size: 12px; color: #d9e6f5; }
.nge-bq-burst { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.nge-bq-gem { position: absolute; left: -7px; top: -7px; opacity: 0; filter: drop-shadow(0 0 6px currentColor); animation: ngeBqGem 1.4s cubic-bezier(.15, .8, .3, 1) var(--t) both; }
@keyframes ngeBqWin { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes ngeBqGem {
  0% { opacity: 0; transform: rotate(var(--a)) translateY(0) scale(0.3); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--a)) translateY(calc(-1 * var(--d))) rotate(200deg) scale(var(--s)); }
}
@media (prefers-reduced-motion: reduce) { .nge-bq-win, .nge-bq-gem { animation: none; } .nge-bq-gem { display: none; } }
</style>
