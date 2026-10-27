<script setup lang="ts">
/**
 * The Hunt reports queue, docked under the top bar, not over the view (Ames 2026-10-26: "let admins jump to the point
 * from the box; keep the box open"). A report's note, or Go through them in the editor, opens it on the oldest open
 * report, already there (Ames 2026-10-27: "it loads them oldest to newest", "I shouldn't have to click go there
 * again"), with the Hunt's answers drawn in the view ("I also need to be able to see the current Hunt points") and
 * ‹ › and Next to step through them ("a next a la cell library"). Each says what became of it and who dealt with it,
 * and whether an earlier report or the answers have the same spot, so the first hunter to send it gets the credit.
 * Add to the answers or Dismiss, with a note that can go to the hunter ("make it so we can dismiss or add a note").
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { huntCall, huntState, loadHunts, goToHunt, goToSoma, showReportMarker, hideReportMarker, showKeyPlaces, hideKeyPlaces, type KeyPlace } from '../hunt';
import { canonicalDataset, currentDatasetTag } from '../datasets';

interface Report {
  id: number; user_id: string; name: string; kind: 'cut' | 'merge'; nm: number[]; at: number[] | null; note: string; status: 'open' | 'counted' | 'not_real'; t: string;
  admin_note: string; done_by: string; done_at: string | null;
  first: { id: number; name: string; status: string } | null;
  in_key: { n: number; kind: 'cut' | 'merge'; added: boolean; credit: string[] } | null;
}
interface Queue { hunt: { id: number; title: string; dataset: string; phase: string; tolerance_nm: number }; reports: Report[]; places: KeyPlace[] }
const queue = ref<Queue | null>(null);
const idx = ref(0);
const busy = ref('');
const error = ref('');
const done = ref('');
const size = ref<number | ''>('');
const note = ref('');
const tell = ref(false);
const shown = ref(false);   // the view is at this report

const report = computed(() => queue.value?.reports[idx.value] ?? null);
const openCount = computed(() => queue.value?.reports.filter(r => r.status === 'open').length ?? 0);
const nextOpen = computed(() => {
  const list = queue.value?.reports ?? [];
  const after = list.findIndex((r, i) => i > idx.value && r.status === 'open');
  return after >= 0 ? after : list.findIndex((r, i) => i < idx.value && r.status === 'open');
});
const kindWords = (k: string) => (k === 'merge' ? 'missing extension (Merge)' : 'merger (Cut)');
const whenOf = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const statusWords = computed(() => {
  const r = report.value;
  if (!r || r.status === 'open') return '';
  const by = r.done_by ? ` by ${r.done_by}` : '', at = r.done_at ? `, ${whenOf(r.done_at)}` : '';
  const credited = !!r.in_key?.credit.includes(r.name);
  return r.status === 'counted' ? `✓ Added to the answers${by}${at}.${credited ? ` ${r.name} has the credit.` : ''}` : `Dismissed${by}${at}.`;
});
/** With a size: the place of that kind it will make bigger instead of adding one (functions/hunts.js addPlace): the
 *  nearest within the tolerance or within the new ball (Ames 2026-10-27: "I just need to make a larger marked area"). */
const grows = computed(() => {
  const q = queue.value, r = report.value, s = Number(size.value) || 0;
  if (!q || !r || s <= 0) return null;
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let best = Math.max(q.hunt.tolerance_nm || 0, s * 500), hit: KeyPlace | null = null;
  for (const p of q.places) {
    if (p.kind !== r.kind) continue;
    const d = Math.min(dist(p.nm, r.nm), ...(p.shape?.pts ?? []).map(x => dist(x, r.nm)));
    if (d <= best) { best = d; hit = p; }
  }
  return hit;
});
const keyWords = computed(() => {
  const k = report.value?.in_key;
  if (!k) return '';
  const what = k.kind === 'merge' ? 'missing extension' : 'merger';
  return `The answers have a ${what} here: place #${k.n}${k.added ? `, added from ${k.credit.length ? `${k.credit.join(', ')}'s report` : 'a report'}` : ''}.`;
});

async function load(args: { report_id?: number; id?: number }, keep?: number) {
  const q = await huntCall<Queue>('hunt.report_queue', args);
  queue.value = q;
  const at = keep ? q.reports.findIndex(r => r.id === keep) : -1;
  if (at >= 0) return at;
  const firstOpen = q.reports.findIndex(r => r.status === 'open');
  if (firstOpen >= 0) return firstOpen;
  const asked = q.reports.findIndex(r => r.id === args.report_id);
  return asked >= 0 ? asked : Math.max(0, q.reports.length - 1);
}
async function openQueue(detail: { id?: number; hunt?: number }) {
  queue.value = null; error.value = ''; done.value = ''; shown.value = false;
  busy.value = 'load';
  try { await step(await load(detail.id ? { report_id: detail.id } : { id: detail.hunt })); }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { if (busy.value === 'load') busy.value = ''; }
}
function onOpen(e: Event) {
  const d = (e as CustomEvent).detail || {};
  if (Number(d.id) || Number(d.hunt)) void openQueue({ id: Number(d.id) || undefined, hunt: Number(d.hunt) || undefined });
}
onMounted(() => document.addEventListener('nge:hunt-report', onOpen));
onUnmounted(() => { document.removeEventListener('nge:hunt-report', onOpen); hideReportMarker(); hideKeyPlaces(); });

/** To a report: its own note and size, and the view goes there at once. */
async function step(i: number) {
  const list = queue.value?.reports ?? [];
  if (i < 0 || i >= list.length) return;
  idx.value = i; done.value = ''; error.value = ''; size.value = ''; tell.value = false;
  note.value = list[i].admin_note || '';
  busy.value = '';
  await goThere();
}
async function goThere() {
  const q = queue.value, r = report.value; if (!q || !r?.at || busy.value === 'go') return;
  busy.value = 'go'; error.value = '';
  try {
    if (canonicalDataset(currentDatasetTag()) !== canonicalDataset(q.hunt.dataset)) {
      if (!huntState.hunts.some(h => h.id === q.hunt.id)) await loadHunts();
      const h = huntState.hunts.find(x => x.id === q.hunt.id);
      if (!h) throw new Error('Open the Hunt first: it is on another dataset.');
      if (await goToHunt(h) === 'switching') return;
    }
    goToSoma(r.at.slice(0, 3));
    showKeyPlaces(q.places);
    if (r.status === 'open') showReportMarker(r.at.slice(0, 3)); else hideReportMarker();
    shown.value = true;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
/** After a change: the queue again (who has what, the answers), on the same report, and the answers redrawn. */
async function refresh(id: number) {
  const q = queue.value; if (!q) return;
  idx.value = await load({ id: q.hunt.id }, id);
  if (shown.value) showKeyPlaces(queue.value!.places);
}
async function add() {
  const q = queue.value, r = report.value; if (!q || !r || busy.value) return;
  busy.value = 'add'; error.value = '';
  try {
    const s = Number(size.value) || 0;
    const out = await huntCall<any>('hunt.add_place', { id: q.hunt.id, nm: r.nm, kind: r.kind, report_id: r.id, radius_nm: s > 0 ? s * 500 : 0, note: note.value.trim(), tell: tell.value });
    const what = r.kind === 'merge' ? 'missing extension' : 'merger';
    done.value = out.enlarged ? `Made the ${what} there bigger in the answers. ${out.changed} ${out.changed === 1 ? 'run' : 'runs'} changed.`
      : `Added to the answers: the key has ${out.target_count} places now. ${out.changed} ${out.changed === 1 ? 'run' : 'runs'} changed.`
        + `${out.laser_later ? ` Laser Eyes for ${out.laser_later} ${out.laser_later === 1 ? 'hunter' : 'hunters'} at the end.` : out.laser ? ` ${out.laser} got Laser Eyes.` : ''}`
        + ` ${r.name} hears it in the bell${tell.value && note.value.trim() ? ', with your note' : ''}.`;
    hideReportMarker();
    await refresh(r.id);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function dismiss() {
  const q = queue.value, r = report.value; if (!q || !r || busy.value) return;
  busy.value = 'no'; error.value = '';
  try {
    await huntCall('hunt.dismiss_report', { id: q.hunt.id, report_id: r.id, note: note.value.trim(), tell: tell.value });
    done.value = `Dismissed.${tell.value ? ` ${r.name} has a note in the bell.` : ''}`;
    hideReportMarker();
    await refresh(r.id);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function saveNote() {
  const r = report.value; if (!r || busy.value || !note.value.trim()) return;
  busy.value = 'note'; error.value = '';
  try {
    queue.value = await huntCall<Queue>('hunt.report_note', { report_id: r.id, note: note.value.trim(), tell: tell.value });
    idx.value = Math.max(0, queue.value.reports.findIndex(x => x.id === r.id));
    done.value = tell.value ? `Note saved, and sent to ${r.name}.` : 'Note saved. Only the admins see it.';
    tell.value = false;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
function toFirst() {
  const f = report.value?.first; if (!f) return;
  const i = queue.value?.reports.findIndex(x => x.id === f.id) ?? -1;
  if (i >= 0) void step(i);
}
function close() { queue.value = null; hideReportMarker(); hideKeyPlaces(); }
</script>

<template>
  <aside v-if="queue || error || busy === 'load'" class="nge-hreport" role="dialog" aria-label="Hunt reports">
    <div class="nge-hreport-head">
      <span class="nge-hreport-kicker">Hunt reports</span>
      <span class="nge-hreport-title">{{ queue?.hunt.title || '' }}</span>
      <button class="nge-hreport-x" aria-label="Close" @click="close(); error = ''">×</button>
    </div>
    <p v-if="busy === 'load'" class="nge-hreport-muted">Loading…</p>
    <template v-else-if="queue && report">
      <div class="nge-hreport-nav">
        <button class="nge-hreport-arrow" :disabled="idx === 0 || !!busy" aria-label="The report before" title="The report before" @click="step(idx - 1)">‹</button>
        <span class="nge-hreport-count">{{ idx + 1 }} of {{ queue.reports.length }}, oldest first</span>
        <button class="nge-hreport-arrow" :disabled="idx >= queue.reports.length - 1 || !!busy" aria-label="The report after" title="The report after" @click="step(idx + 1)">›</button>
        <span class="nge-hreport-open" :class="{ 'nge-hreport-open--none': !openCount }">{{ openCount ? `${openCount} open` : 'All done' }}</span>
      </div>
      <p class="nge-hreport-what"><b>{{ report.name }}</b> found a {{ kindWords(report.kind) }}
        <span v-if="report.at" class="nge-hreport-at">at {{ report.at.join(', ') }}</span>
        <span class="nge-hreport-when">{{ whenOf(report.t) }}</span></p>
      <p v-if="report.note" class="nge-hreport-note">"{{ report.note }}"</p>
      <p v-if="report.first" class="nge-hreport-flag">Same spot as <button class="nge-hreport-link" @click="toFirst">{{ report.first.name }}'s report</button>, sent first{{ report.first.status === 'counted' ? ' and added' : report.first.status === 'not_real' ? ' and dismissed' : '' }}.</p>
      <p v-if="keyWords" class="nge-hreport-flag nge-hreport-flag--key">{{ keyWords }}</p>
      <p v-if="statusWords" class="nge-hreport-status" :class="{ 'nge-hreport-status--added': report.status === 'counted' }">{{ statusWords }}</p>
      <p v-if="report.admin_note && report.status !== 'open'" class="nge-hreport-adminnote">Note: "{{ report.admin_note }}"</p>
      <div v-if="report.status === 'open'" class="nge-hreport-actions">
        <button class="nge-hreport-btn" :disabled="!report.at || !!busy" @click="goThere">{{ busy === 'go' ? 'Going…' : 'Go there again' }}</button>
        <label class="nge-hreport-size" title="How wide, across. A place of this kind already near it is made this big (the button says which); otherwise a new place this big is added. A gem anywhere in it counts.">Size <input v-model.number="size" type="number" min="0" max="200" step="0.5" placeholder="a point" /> <span class="nge-hreport-unit">µm</span></label>
        <button class="nge-hreport-btn nge-hreport-btn--add" :disabled="!!busy" @click="add">{{ busy === 'add' ? 'Adding…' : grows ? `Make place #${grows.n} bigger` : 'Add to the answers' }}</button>
        <button class="nge-hreport-btn" :disabled="!!busy" @click="dismiss">{{ busy === 'no' ? 'Dismissing…' : 'Dismiss' }}</button>
      </div>
      <div class="nge-hreport-noterow">
        <input v-model="note" class="nge-hreport-noteinput" maxlength="300" :placeholder="report.status === 'open' ? 'A note (optional), kept with the report' : 'A note, kept with the report'" aria-label="A note on this report" />
        <label class="nge-hreport-tell" :title="`Send the note, and what you decided, to ${report.name} in the bell. Adding it always tells them; the note goes only with this ticked.`"><input v-model="tell" type="checkbox" /> Send to {{ report.name }}</label>
        <button v-if="report.status !== 'open' || (note.trim() && note.trim() !== report.admin_note)" class="nge-hreport-btn nge-hreport-btn--small" :disabled="!!busy || !note.trim()" @click="saveNote">{{ busy === 'note' ? 'Saving…' : 'Save note' }}</button>
      </div>
      <p v-if="done" class="nge-hreport-done" role="status">{{ done }}</p>
      <div class="nge-hreport-foot">
        <span class="nge-hreport-legend"><i class="nge-hreport-dot nge-hreport-dot--cut"></i>merger <i class="nge-hreport-dot nge-hreport-dot--merge"></i>extension <i class="nge-hreport-dot nge-hreport-dot--added"></i>added from a report <i class="nge-hreport-dot nge-hreport-dot--here"></i>this report</span>
        <button class="nge-hreport-btn nge-hreport-btn--next" :class="{ 'nge-hreport-btn--primary': report.status !== 'open' }" :disabled="nextOpen < 0 || !!busy" @click="step(nextOpen)">Next open ›</button>
      </div>
    </template>
    <p v-else-if="queue" class="nge-hreport-muted">No reports in this Hunt.</p>
    <p v-if="error" class="nge-hreport-error" role="alert">{{ error }}</p>
  </aside>
</template>

<style scoped>
.nge-hreport { position: fixed; top: 72px; left: 50%; transform: translateX(-50%); z-index: 930; width: min(580px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 10px 14px 12px; border-radius: 12px; border: 1px solid rgba(95, 227, 245, 0.55); background: linear-gradient(158deg, rgba(10, 17, 32, 0.96), rgba(5, 9, 19, 0.98));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), 0 0 16px rgba(95, 227, 245, 0.15); color: #e6f0ff; font: 13px/1.45 'Inter', sans-serif; }
.nge-hreport-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.nge-hreport-kicker { font: 700 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #5fe3f5; }
.nge-hreport-title { flex: 1; min-width: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-hreport-x { border: none; background: none; color: #9fb7d9; font-size: 18px; line-height: 1; cursor: pointer; }
.nge-hreport-x:hover { color: #fff; }
.nge-hreport-nav { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 12px; color: #9fb7d9; }
.nge-hreport-arrow { width: 24px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer; font: 700 15px/1 'Inter', sans-serif; background: rgba(4, 8, 18, 0.6); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; }
.nge-hreport-arrow:hover:not(:disabled) { border-color: #9fd0ff; }
.nge-hreport-arrow:disabled { opacity: 0.35; cursor: default; }
.nge-hreport-count { font-variant-numeric: tabular-nums; }
.nge-hreport-open { margin-left: auto; padding: 1px 8px; border-radius: 999px; font-weight: 700; color: #cdefff; background: rgba(90, 170, 255, 0.16); border: 1px solid rgba(90, 170, 255, 0.4); }
.nge-hreport-open--none { color: #9ff0bf; background: rgba(72, 214, 130, 0.12); border-color: rgba(72, 214, 130, 0.45); }
.nge-hreport-what, .nge-hreport-note, .nge-hreport-flag, .nge-hreport-status, .nge-hreport-adminnote { margin: 0 0 6px; }
.nge-hreport-at { color: #9fb7d9; font-variant-numeric: tabular-nums; }
.nge-hreport-when { margin-left: 6px; font-size: 11.5px; color: #8299bb; }
.nge-hreport-note { color: #cfe9f5; }
.nge-hreport-flag { padding: 4px 8px; border-radius: 7px; font-size: 12px; color: #ffe9a8; background: rgba(245, 209, 66, 0.08); border: 1px solid rgba(245, 209, 66, 0.35); }
.nge-hreport-flag--key { color: #d6c6ff; background: rgba(155, 92, 255, 0.1); border-color: rgba(155, 92, 255, 0.45); }
.nge-hreport-link { padding: 0; border: none; background: none; cursor: pointer; font: inherit; font-weight: 700; color: inherit; text-decoration: underline; }
.nge-hreport-status { font-weight: 600; color: #cfdcef; }
.nge-hreport-status--added { color: #9ff0bf; }
.nge-hreport-adminnote { color: #cfe9f5; font-size: 12px; }
.nge-hreport-actions, .nge-hreport-noterow, .nge-hreport-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nge-hreport-noterow { margin-top: 8px; }
.nge-hreport-foot { margin-top: 8px; justify-content: space-between; }
.nge-hreport-btn { padding: 5px 12px; border-radius: 8px; cursor: pointer; font: 600 12.5px 'Inter', sans-serif; background: rgba(4, 8, 18, 0.6); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; }
.nge-hreport-btn:hover:not(:disabled) { border-color: #9fd0ff; color: #fff; }
.nge-hreport-btn:disabled { opacity: 0.55; cursor: default; }
.nge-hreport-btn--small { padding: 4px 10px; font-size: 12px; }
.nge-hreport-btn--primary { background: rgba(95, 227, 245, 0.14); border-color: #5fe3f5; }
.nge-hreport-btn--add { background: rgba(72, 214, 130, 0.16); border-color: #48d682; }
.nge-hreport-btn--next { margin-left: auto; }
.nge-hreport-size { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #cfdcef; }
.nge-hreport-size input { width: 64px; padding: 4px 6px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.35); color: #e6f0ff; font: 12px 'Inter', sans-serif; }
.nge-hreport-unit { text-transform: none; }
.nge-hreport-noteinput { flex: 1; min-width: 180px; padding: 5px 8px; border-radius: 7px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.35); color: #e6f0ff; font: 12px 'Inter', sans-serif; }
.nge-hreport-tell { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #cfdcef; white-space: nowrap; cursor: pointer; }
.nge-hreport-legend { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 11px; color: #8299bb; }
.nge-hreport-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 4px; }
.nge-hreport-dot--cut { background: #f5d142; }
.nge-hreport-dot--merge { background: #9b5cff; }
.nge-hreport-dot--added { background: #48d682; }
.nge-hreport-dot--here { background: #42d5ec; }
.nge-hreport-done { margin: 8px 0 0; color: #9ff0bf; }
.nge-hreport-muted { margin: 0; color: #9fb7d9; }
.nge-hreport-error { margin: 8px 0 0; color: #ff9b9b; }
</style>
