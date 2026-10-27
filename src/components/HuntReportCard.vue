<script setup lang="ts">
/**
 * A hunter's report, from its note (Ames 2026-10-26: "let admins jump to the point from the box; keep the box
 * open if I jump to it and then let admins mark it to add or ignore from the box"). Docked under the top bar,
 * not over the view: Go there opens the Hunt's view if need be, moves to the spot and rings it; then Add to the
 * key (optionally with a size) or Not real.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { huntCall, huntState, loadHunts, goToHunt, goToSoma, showReportMarker, hideReportMarker } from '../hunt';
import { canonicalDataset, currentDatasetTag } from '../datasets';

interface Report { id: number; hunt_id: number; hunt_title: string; dataset: string; kind: 'cut' | 'merge'; nm: number[]; at: number[] | null; note: string; status: string; name: string; phase: string }
const report = ref<Report | null>(null);
const busy = ref('');
const error = ref('');
const done = ref('');
const size = ref<number | ''>('');
const looked = ref(false);

async function openReport(id: number) {
  report.value = null; error.value = ''; done.value = ''; size.value = ''; looked.value = false;
  busy.value = 'load';
  try { report.value = await huntCall<Report>('hunt.report_get', { report_id: id }); }
  catch (e: any) { error.value = e?.message || String(e); report.value = { id, hunt_id: 0, hunt_title: '', dataset: '', kind: 'cut', nm: [], at: null, note: '', status: 'gone', name: '', phase: '' }; }
  finally { busy.value = ''; }
}
function onOpen(e: Event) { const id = Number((e as CustomEvent).detail?.id); if (id) void openReport(id); }
onMounted(() => document.addEventListener('nge:hunt-report', onOpen));
onUnmounted(() => { document.removeEventListener('nge:hunt-report', onOpen); hideReportMarker(); });

async function goThere() {
  const r = report.value; if (!r?.at || busy.value) return;
  busy.value = 'go'; error.value = '';
  try {
    if (canonicalDataset(currentDatasetTag()) !== canonicalDataset(r.dataset)) {
      if (!huntState.hunts.some(h => h.id === r.hunt_id)) await loadHunts();
      const h = huntState.hunts.find(x => x.id === r.hunt_id);
      if (!h) throw new Error('Open the Hunt first: it is on another dataset.');
      if (await goToHunt(h) === 'switching') return;
    }
    goToSoma(r.at.slice(0, 3));
    showReportMarker(r.at.slice(0, 3));
    looked.value = true;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function add() {
  const r = report.value; if (!r || busy.value) return;
  busy.value = 'add'; error.value = '';
  try {
    const s = Number(size.value) || 0;
    const out = await huntCall<any>('hunt.add_place', { id: r.hunt_id, nm: r.nm, kind: r.kind, report_id: r.id, radius_nm: s > 0 ? s * 500 : 0 });
    const what = r.kind === 'merge' ? 'missing extension' : 'merger';
    done.value = out.enlarged ? `Made the ${what} there bigger in the answers. ${out.changed} ${out.changed === 1 ? 'run' : 'runs'} changed.`
      : `Added to the answers: the key has ${out.target_count} places now. ${out.changed} ${out.changed === 1 ? 'run' : 'runs'} changed.`
        + `${out.laser_later ? ` Laser Eyes for ${out.laser_later} ${out.laser_later === 1 ? 'hunter' : 'hunters'} at the end.` : out.laser ? ` ${out.laser} got Laser Eyes.` : ''}`;
    report.value = { ...r, status: 'counted' };
    hideReportMarker();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function notReal() {
  const r = report.value; if (!r || busy.value) return;
  busy.value = 'no'; error.value = '';
  try {
    await huntCall('hunt.dismiss_report', { id: r.hunt_id, report_id: r.id });
    done.value = 'Marked not real: it is off the list.';
    report.value = { ...r, status: 'not_real' };
    hideReportMarker();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
function close() { report.value = null; hideReportMarker(); }
</script>

<template>
  <aside v-if="report" class="nge-hreport" role="dialog" aria-label="A hunter's report">
    <div class="nge-hreport-head">
      <span class="nge-hreport-kicker">Hunt report</span>
      <span class="nge-hreport-title">{{ report.hunt_title }}</span>
      <button class="nge-hreport-x" aria-label="Close" @click="close">×</button>
    </div>
    <p v-if="busy === 'load'" class="nge-hreport-muted">Loading…</p>
    <template v-else-if="report.name">
      <p class="nge-hreport-what"><b>{{ report.name }}</b> found a {{ report.kind === 'merge' ? 'missing extension (Merge)' : 'merger (Cut)' }}
        <span v-if="report.at" class="nge-hreport-at">at {{ report.at.join(', ') }}</span></p>
      <p v-if="report.note" class="nge-hreport-note">"{{ report.note }}"</p>
      <p v-if="report.status !== 'open' && !done" class="nge-hreport-muted">{{ report.status === 'counted' ? 'Already added to the answers.' : 'Already marked not real.' }}</p>
      <div v-if="report.status === 'open'" class="nge-hreport-actions">
        <button class="nge-hreport-btn" :class="{ 'nge-hreport-btn--primary': !looked }" :disabled="!report.at || !!busy" @click="goThere">{{ busy === 'go' ? 'Going…' : looked ? 'Go there again' : 'Go there' }}</button>
        <label class="nge-hreport-size" title="For a wide face: a gem anywhere within this ball counts">Size <input v-model.number="size" type="number" min="0" max="200" step="0.5" placeholder="a point" /> µm</label>
        <button class="nge-hreport-btn nge-hreport-btn--add" :disabled="!!busy" @click="add">{{ busy === 'add' ? 'Adding…' : 'Add to the key' }}</button>
        <button class="nge-hreport-btn" :disabled="!!busy" @click="notReal">{{ busy === 'no' ? '…' : 'Not real' }}</button>
      </div>
      <p v-if="done" class="nge-hreport-done" role="status">{{ done }}</p>
    </template>
    <p v-if="error" class="nge-hreport-error" role="alert">{{ error }}</p>
  </aside>
</template>

<style scoped>
.nge-hreport { position: fixed; top: 72px; left: 50%; transform: translateX(-50%); z-index: 930; width: min(520px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 10px 14px 12px; border-radius: 12px; border: 1px solid rgba(95, 227, 245, 0.55); background: linear-gradient(158deg, rgba(10, 17, 32, 0.96), rgba(5, 9, 19, 0.98));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), 0 0 16px rgba(95, 227, 245, 0.15); color: #e6f0ff; font: 13px/1.45 'Inter', sans-serif; }
.nge-hreport-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.nge-hreport-kicker { font: 700 10px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #5fe3f5; }
.nge-hreport-title { flex: 1; min-width: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-hreport-x { border: none; background: none; color: #9fb7d9; font-size: 18px; line-height: 1; cursor: pointer; }
.nge-hreport-x:hover { color: #fff; }
.nge-hreport-what, .nge-hreport-note { margin: 0 0 6px; }
.nge-hreport-at { color: #9fb7d9; font-variant-numeric: tabular-nums; }
.nge-hreport-note { color: #cfe9f5; }
.nge-hreport-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nge-hreport-btn { padding: 5px 12px; border-radius: 8px; cursor: pointer; font: 600 12.5px 'Inter', sans-serif; background: rgba(4, 8, 18, 0.6); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; }
.nge-hreport-btn:hover:not(:disabled) { border-color: #9fd0ff; color: #fff; }
.nge-hreport-btn:disabled { opacity: 0.55; cursor: default; }
.nge-hreport-btn--primary { background: rgba(95, 227, 245, 0.14); border-color: #5fe3f5; }
.nge-hreport-btn--add { background: rgba(72, 214, 130, 0.16); border-color: #48d682; }
.nge-hreport-size { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #cfdcef; }
.nge-hreport-size input { width: 64px; padding: 4px 6px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.35); color: #e6f0ff; font: 12px 'Inter', sans-serif; }
.nge-hreport-done { margin: 8px 0 0; color: #9ff0bf; }
.nge-hreport-muted { margin: 0; color: #9fb7d9; }
.nge-hreport-error { margin: 8px 0 0; color: #ff9b9b; }
</style>
