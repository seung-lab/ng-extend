<script setup lang="ts">
/**
 * Admin Hub > Access requests: requests for one dataset (Ames 2026-10-28).
 * A player asked from a locked dataset card or the note on a view they can't
 * load (dataset_access_request.ts). Add them to that dataset's group in CAVE
 * (HiMC for MEC, and so on), then press Granted: they get a bell saying
 * they're in. Not now tells them too, with your note if you write one.
 */
import { computed, onMounted, ref } from 'vue';
import { listDatasetRequests, decideDatasetRequest, type DatasetRequestRow } from '../dataset_access_request';
import { DATASETS, canonicalDataset } from '../datasets';
/** The datasets whose access matters here (Ames 2026-10-29: "we only care
 *  about Retina and MEC and BANC"; not the sandboxes or public datasets). */
const WATCHED = [
  { cave: 'stroeh-mouse-retina', tag: 'stroeh_mouse_retina', name: 'Retina' },
  { cave: 'HiMC', tag: 'pni_mec', name: 'MEC' },
  { cave: 'BANC', tag: 'brain_and_nerve_cord', name: 'BANC' },
];
type Level = 'edit' | 'view' | 'none';
const LEVEL_WORDS: Record<Level, string> = { edit: 'can edit', view: 'view only', none: 'no access' };
const levelOf = (a: NonNullable<DatasetRequestRow['access']>, cave: string): Level =>
  a.edit.includes(cave) ? 'edit' : a.view.includes(cave) ? 'view' : 'none';
const watchedEdits = (h: NonNullable<DatasetRequestRow['history']>) => h.datasets.filter(d => WATCHED.some(w => w.tag === d.dataset));
/** A Pyr dataset tag by its short name. */
const tagName = (tag: string) => DATASETS.find(d => canonicalDataset(d.id) === tag)?.abbrev || tag;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
/** "3 weeks", "4 months": how long ago. */
function since(iso: string | null): string {
  if (!iso) return '';
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (d < 1) return 'today';
  if (d < 14) return d + (d === 1 ? ' day' : ' days');
  if (d < 61) return Math.floor(d / 7) + ' weeks';
  const m = Math.floor(d / 30.4);
  return m < 24 ? m + ' months' : Math.floor(d / 365) + ' years';
}
import lockIcon from '../images/lock-icon.png';
import unlockIcon from '../images/unlock-icon.png';

const rows = ref<DatasetRequestRow[]>([]);
const loading = ref(false);
const error = ref('');
const busy = ref('');
const notes = ref<Record<string, string>>({});
const showAnswered = ref(false);

async function load() {
  loading.value = true; error.value = '';
  try { rows.value = await listDatasetRequests(); }
  catch (e: any) { error.value = e?.message || 'Could not read the dataset requests.'; }
  finally { loading.value = false; }
}
onMounted(load);

const waiting = computed(() => rows.value.filter(r => !r.mark));
const answered = computed(() => rows.value.filter(r => r.mark));

async function decide(r: DatasetRequestRow, mark: 'granted' | 'declined' | 'waiting', byHand = false) {
  busy.value = r.id; error.value = '';
  try { rows.value = await decideDatasetRequest(r.id, mark, notes.value[r.id] || '', byHand); delete notes.value[r.id]; }
  catch (e: any) { error.value = e?.message || 'That was not saved.'; }
  finally { busy.value = ''; }
}
function openProfile(r: DatasetRequestRow) {
  if (r.userId) document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { userId: r.userId } }));
}
const when = (iso: string | null) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
};
</script>

<template>
  <section class="nge-dsr">
    <div class="nge-dsr-head">
      <img :src="lockIcon" class="nge-dsr-icon" alt="" aria-hidden="true" />
      <h3>Dataset requests</h3>
      <span class="nge-dsr-sub">{{ waiting.length }} waiting</span>
      <button class="nge-dsr-btn nge-dsr-refresh" :disabled="loading" @click="load">Refresh</button>
    </div>
    <p class="nge-dsr-how">
      Players asking for one dataset (not retina, which has its own request below). For MEC, <b>Grant</b> adds them to MEC_Edit in CAVE
      and then tells them they're in. For other datasets, add them to the dataset's group in CAVE yourself, then press <b>Grant</b>.
    </p>
    <p v-if="error" class="nge-dsr-err" role="alert">{{ error }}</p>
    <p v-else-if="!loading && !waiting.length" class="nge-dsr-how">Nobody is waiting.</p>

    <article v-for="r in waiting" :key="r.id" class="nge-dsr-row">
      <div class="nge-dsr-line">
        <button class="nge-dsr-name" :disabled="!r.userId" title="Open their profile" @click="openProfile(r)">{{ r.name || r.email }}</button>
        <span class="nge-dsr-ds">{{ r.label }}<span v-if="r.cave" class="nge-dsr-cave"> · CAVE {{ r.cave }}</span></span>
        <span class="nge-dsr-when">{{ when(r.at) }}</span>
      </div>
      <div class="nge-dsr-meta">{{ r.email }}</div>
      <div v-if="r.access" class="nge-dsr-access">
        <span v-for="w in WATCHED" :key="w.cave" class="nge-dsr-chip"
          :class="'nge-dsr-chip--' + levelOf(r.access, w.cave)">{{ w.name }}: {{ LEVEL_WORDS[levelOf(r.access, w.cave)] }}</span>
      </div>
      <div v-else class="nge-dsr-meta nge-dsr-none">Their CAVE access could not be read.</div>
      <div v-if="r.history" class="nge-dsr-history">
        <span v-if="r.history.joined">On Pyr {{ since(r.history.joined) }} (joined {{ day(r.history.joined) }})</span>
        <span v-if="!watchedEdits(r.history).length" class="nge-dsr-none">No Retina or MEC edits yet</span>
        <span v-for="h in watchedEdits(r.history)" :key="h.dataset"
          :title="'First edit ' + day(h.first) + ', latest ' + day(h.last)">
          {{ tagName(h.dataset) }}: editing {{ since(h.first) }}, last {{ since(h.last) === 'today' ? 'today' : since(h.last) + ' ago' }}
        </span>
      </div>
      <div v-if="r.note" class="nge-dsr-note">“{{ r.note }}”</div>
      <div class="nge-dsr-actions">
        <input v-model="notes[r.id]" class="nge-dsr-input" maxlength="500" placeholder="A note for them (optional)" />
        <button v-if="r.caveGroup" class="nge-dsr-btn nge-dsr-btn--yes" :disabled="busy === r.id"
                :title="`Add them to ${r.caveGroup} in CAVE, then tell them they're in`" @click="decide(r, 'granted')">{{ busy === r.id ? 'Granting…' : `Grant (adds to ${r.caveGroup})` }}</button>
        <button class="nge-dsr-btn" :class="{ 'nge-dsr-btn--yes': !r.caveGroup }" :disabled="busy === r.id"
                :title="r.caveGroup ? 'You already added them in CAVE yourself: just tell them' : 'Add them to the dataset\'s group in CAVE first, then press this to tell them'"
                @click="decide(r, 'granted', true)">{{ r.caveGroup ? 'I added them by hand' : 'Grant' }}</button>
        <button class="nge-dsr-btn" :disabled="busy === r.id" @click="decide(r, 'declined')">Not now</button>
      </div>
    </article>

    <button v-if="answered.length" class="nge-dsr-toggle" @click="showAnswered = !showAnswered">
      {{ showAnswered ? '▾' : '▸' }} Answered ({{ answered.length }})
    </button>
    <template v-if="showAnswered">
      <div v-for="r in answered" :key="r.id" class="nge-dsr-done">
        <button class="nge-dsr-name" :disabled="!r.userId" title="Open their profile" @click="openProfile(r)">{{ r.name || r.email }}</button>
        <span class="nge-dsr-ds">{{ r.label }}</span>
        <span class="nge-dsr-mark" :class="`nge-dsr-mark--${r.mark}`"><img :src="r.mark === 'granted' ? unlockIcon : lockIcon" class="nge-dsr-mark-icon" alt="" aria-hidden="true" />{{ r.mark === 'granted' ? 'Granted' : 'Not now' }}</span>
        <span class="nge-dsr-when">{{ when(r.markedAt) }}{{ r.markedBy ? ` by ${r.markedBy}` : '' }}</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.nge-dsr { margin: 0 0 18px; padding: 12px 14px; border: 1px solid rgba(245, 209, 66, 0.3); border-radius: 10px; background: rgba(245, 209, 66, 0.04); }
.nge-dsr-head { display: flex; align-items: center; gap: 10px; }
/* The padlocks (Ames 2026-10-28): closed by the heading, open on a grant. */
.nge-dsr-icon { width: 34px; height: 34px; object-fit: contain; margin: -4px -2px -4px 0; filter: drop-shadow(0 0 6px rgba(80, 200, 255, 0.35)); }
.nge-dsr-mark { display: inline-flex; align-items: center; gap: 4px; }
.nge-dsr-mark-icon { width: 16px; height: 16px; object-fit: contain; }
.nge-dsr-head h3 { margin: 0; font-size: 1.05rem; color: #f5d142; }
.nge-dsr-sub { color: #b6c4d4; font-size: 0.9rem; }
.nge-dsr-refresh { margin-left: auto; }
.nge-dsr-how { color: #b6c4d4; font-size: 0.9rem; margin: 6px 0 10px; }
.nge-dsr-err { color: #f5d142; }
.nge-dsr-row { padding: 10px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.nge-dsr-line { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.nge-dsr-name { font: inherit; font-weight: 600; color: #9fd3ff; background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.nge-dsr-name:disabled { color: #e4ecf5; text-decoration: none; cursor: default; }
.nge-dsr-ds { color: #e4ecf5; }
.nge-dsr-cave { color: #8fa3b8; font-size: 0.85rem; }
.nge-dsr-when { margin-left: auto; color: #8fa3b8; font-size: 0.85rem; }
.nge-dsr-meta { color: #8fa3b8; font-size: 0.85rem; margin-top: 2px; }
.nge-dsr-note { color: #e4ecf5; margin-top: 4px; white-space: pre-wrap; }
/* What they can already do (Ames 2026-10-29). */
.nge-dsr-access { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 6px; font-size: 0.85rem; }
.nge-dsr-chip { padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.2); color: #cfd8e6; }
.nge-dsr-chip--edit { border-color: rgba(124, 255, 178, 0.55); color: #7CFFB2; }
.nge-dsr-chip--none { border-style: dashed; color: #8fa3b8; }
.nge-dsr-history { display: flex; flex-wrap: wrap; gap: 2px 14px; margin-top: 4px; font-size: 0.85rem; color: #b6c4d4; }
.nge-dsr-none { color: #8fa3b8; font-style: italic; }
.nge-dsr-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.nge-dsr-input { flex: 1 1 200px; font: inherit; font-size: 0.9rem; padding: 5px 8px; border: 1px solid #74859a; border-radius: 6px; background: #152434; color: #f1f5f9; }
.nge-dsr-btn { font: inherit; font-size: 0.9rem; padding: 5px 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.06); color: #e4ecf5; cursor: pointer; }
.nge-dsr-btn:disabled { opacity: 0.5; cursor: default; }
.nge-dsr-btn--yes { border-color: #7CFFB2; color: #7CFFB2; background: rgba(124, 255, 178, 0.12); }
.nge-dsr-btn--small { font-size: 0.8rem; padding: 2px 8px; }
.nge-dsr-toggle { font: inherit; font-size: 0.9rem; color: #b6c4d4; background: none; border: none; padding: 8px 0 4px; cursor: pointer; }
.nge-dsr-done { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 4px 0; font-size: 0.9rem; }
.nge-dsr-mark--granted { color: #7CFFB2; }
.nge-dsr-mark--declined { color: #f5d142; }
</style>
