<script setup lang="ts">
/**
 * My Cells: every cell a player has claimed or completed, grouped by dataset
 * (Amy 2026-09-28). Cheap by design:
 *   - ONE query when the tab first opens (the 100 most recent claims and
 *     completions across all datasets), cached until the profile closes;
 *   - "Show more" pages through what is already loaded;
 *   - "Load more" asks the server again only for that one dataset, and only
 *     once its loaded rows run out.
 * On your own profile, cells from this device's cell history (typed or marked
 * cells that were never Cell Library claims) are merged in at no cost.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { supabase } from '../supabase';
import { useCellHistoryStore } from '../store';
import { canonicalDataset, currentDatasetTag, datasetDisplayName, findDatasetByCanonical, switchToDataset } from '../datasets';

const props = defineProps<{ userId: string | null; isSelf: boolean }>();
const emit = defineEmits<{ (e: 'jumped'): void }>();

const FIRST = 100;
const MORE = 50;
const STEP = 10;

interface Row {
  key: string;
  segId: string;          // the id to show and jump to (final id once completed)
  status: 'completed' | 'claimed' | 'history';
  cellType?: string;
  when: string;           // ISO
  pos?: [number, number, number];
}
interface Group { dataset: string; rows: Row[]; serverRows: number; serverDone: boolean; shown: number; loading: boolean; }

const groups = reactive(new Map<string, Group>());
const loading = ref(false);
const error = ref('');

function groupFor(ds: string): Group {
  let g = groups.get(ds);
  if (!g) { g = { dataset: ds, rows: [], serverRows: 0, serverDone: false, shown: STEP, loading: false }; groups.set(ds, g); }
  return g;
}

function taskRow(t: any): Row {
  const done = t.status === 'completed';
  const x = t.claim_point_x, y = t.claim_point_y, z = t.claim_point_z;
  return {
    key: 't' + t.id,
    segId: (done && t.final_segment_id) || t.segment_id || '',
    status: done ? 'completed' : 'claimed',
    when: t.updated_at,
    pos: x != null && y != null && z != null ? [x, y, z] : undefined,
  };
}

function addRows(ds: string, rows: Row[]) {
  const g = groupFor(ds);
  const seen = new Set(g.rows.map(r => r.segId));
  for (const r of rows) if (r.segId && !seen.has(r.segId)) { g.rows.push(r); seen.add(r.segId); }
  g.rows.sort((a, b) => b.when.localeCompare(a.when));
}

const SELECT = 'id,dataset,segment_id,status,final_segment_id,updated_at,claim_point_x,claim_point_y,claim_point_z';

async function loadFirst() {
  if (!props.userId) return;
  loading.value = true; error.value = '';
  const { data, error: e } = await supabase.from('proofreading_tasks').select(SELECT)
    .eq('assigned_to', props.userId).in('status', ['assigned', 'in_progress', 'completed'])
    .order('updated_at', { ascending: false }).limit(FIRST);
  loading.value = false;
  if (e) { error.value = 'Could not load cells. Try again in a moment.'; return; }
  const byDs = new Map<string, any[]>();
  for (const t of data ?? []) {
    const ds = canonicalDataset(t.dataset) || t.dataset || 'unknown';
    (byDs.get(ds) ?? byDs.set(ds, []).get(ds)!).push(t);
  }
  const all = (data ?? []).length < FIRST;  // fewer than asked: nothing more anywhere
  for (const [ds, ts] of byDs) {
    addRows(ds, ts.map(taskRow));
    const g = groupFor(ds); g.serverRows = ts.length; g.serverDone = all;
  }
  if (props.isSelf) {
    const history = useCellHistoryStore();
    for (const c of history.cells) {
      const ds = canonicalDataset(c.dataset) || 'unknown';
      addRows(ds, [{
        key: 'h' + c.segId, segId: c.segId, status: c.isComplete ? 'completed' : 'history',
        cellType: c.cellType || undefined, when: c.updatedAt, pos: c.claimPoint ?? c.position,
      }]);
      const g = groupFor(ds); if (!byDs.has(ds)) g.serverDone = g.serverDone || all;
    }
  }
}

async function loadMoreFromServer(g: Group) {
  if (!props.userId || g.loading || g.serverDone) return;
  g.loading = true;
  const variants = Array.from(new Set([g.dataset, ...(g.dataset === 'stroeh_mouse_retina' ? ['eyewire_ii'] : [])]));
  const { data, error: e } = await supabase.from('proofreading_tasks').select(SELECT)
    .eq('assigned_to', props.userId).in('dataset', variants).in('status', ['assigned', 'in_progress', 'completed'])
    .order('updated_at', { ascending: false }).range(g.serverRows, g.serverRows + MORE - 1);
  g.loading = false;
  if (e) { error.value = 'Could not load more. Try again in a moment.'; return; }
  const ts = data ?? [];
  addRows(g.dataset, ts.map(taskRow));
  g.serverRows += ts.length;
  if (ts.length < MORE) g.serverDone = true;
}

async function showMore(g: Group) {
  if (g.shown < g.rows.length) { g.shown += STEP; return; }
  await loadMoreFromServer(g);
  g.shown += STEP;
}

const current = computed(() => canonicalDataset(currentDatasetTag()));
const ordered = computed(() => Array.from(groups.values())
  .filter(g => g.rows.length)
  .sort((a, b) => (a.dataset === current.value ? -1 : b.dataset === current.value ? 1 : 0)
    || (b.rows[0]?.when ?? '').localeCompare(a.rows[0]?.when ?? '')));

function label(ds: string) {
  const d = findDatasetByCanonical(ds);
  return d?.label || datasetDisplayName(ds) || ds;
}
function shortId(id: string) { return id.length > 10 ? `${id.slice(0, 5)}…${id.slice(-5)}` : id; }
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

async function jump(g: Group, r: Row) {
  if (g.dataset !== current.value) {
    const ds = findDatasetByCanonical(g.dataset);
    if (!ds || !(await switchToDataset(ds))) { error.value = `Could not switch to ${label(g.dataset)}.`; return; }
    await new Promise(res => setTimeout(res, 800));  // let the new layers mount
  }
  useCellHistoryStore().jumpToCell(r.segId, r.pos);
  emit('jumped');
}

onMounted(loadFirst);
</script>

<template>
  <div class="nge-mycells">
    <div v-if="loading" class="nge-mycells-note">Loading cells…</div>
    <div v-else-if="error" class="nge-mycells-note nge-mycells-note--bad">{{ error }}</div>
    <div v-else-if="!ordered.length" class="nge-mycells-note">No cells yet. Claim one in the Cell Library to start.</div>

    <section v-for="g in ordered" :key="g.dataset" class="nge-mycells-group">
      <header class="nge-mycells-head">
        <span class="nge-mycells-ds">{{ label(g.dataset) }}</span>
        <span v-if="g.dataset === current" class="nge-mycells-here">current</span>
        <span class="nge-mycells-count">{{ g.rows.length }}{{ g.serverDone ? '' : '+' }}</span>
      </header>
      <button v-for="r in g.rows.slice(0, g.shown)" :key="r.key" class="nge-mycells-row" @click="jump(g, r)"
              :title="`Jump to ${r.segId}`">
        <span class="nge-mycells-pip" :class="'nge-mycells-pip--' + r.status">{{ r.status === 'completed' ? '✓' : r.status === 'claimed' ? '●' : '○' }}</span>
        <span class="nge-mycells-id">{{ shortId(r.segId) }}</span>
        <span class="nge-mycells-status">{{ r.status === 'completed' ? 'Completed' : r.status === 'claimed' ? 'Claimed' : (r.cellType || 'Viewed') }}</span>
        <span class="nge-mycells-when">{{ ago(r.when) }}</span>
      </button>
      <button v-if="g.shown < g.rows.length || !g.serverDone" class="nge-mycells-more" :disabled="g.loading" @click="showMore(g)">
        {{ g.loading ? 'Loading…' : 'Show more' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.nge-mycells { display: flex; flex-direction: column; gap: 18px; padding: 4px 2px 12px; }
.nge-mycells-note { color: #9ab; font-size: 0.9em; padding: 12px 4px; }
.nge-mycells-note--bad { color: #f98; }
.nge-mycells-group { display: flex; flex-direction: column; gap: 2px; }
.nge-mycells-head {
  display: flex; align-items: baseline; gap: 10px; padding: 0 4px 6px;
  border-bottom: 1px solid rgba(120, 170, 255, 0.18); margin-bottom: 4px;
}
.nge-mycells-ds { color: #8cf; font-weight: 600; letter-spacing: 0.04em; }
.nge-mycells-here { font-size: 0.72em; color: #6d9; border: 1px solid rgba(102, 221, 153, 0.4); border-radius: 8px; padding: 0 6px; }
.nge-mycells-count { margin-left: auto; color: #789; font-size: 0.85em; }
.nge-mycells-row {
  display: grid; grid-template-columns: 22px 1fr 1fr 70px; align-items: center; gap: 8px;
  background: none; border: 0; border-radius: 6px; padding: 6px 8px; color: #dde; text-align: left;
  cursor: pointer; font: inherit;
}
.nge-mycells-row:hover { background: rgba(120, 170, 255, 0.08); }
.nge-mycells-pip { text-align: center; }
.nge-mycells-pip--completed { color: #6d9; }
.nge-mycells-pip--claimed { color: #fb6; }
.nge-mycells-pip--history { color: #789; }
.nge-mycells-id { font-family: 'Courier New', monospace; color: #9cf; }
.nge-mycells-status { color: #bcd; font-size: 0.92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-mycells-when { color: #789; font-size: 0.85em; text-align: right; }
.nge-mycells-more {
  align-self: flex-start; margin: 4px 8px 0; background: none; color: #8cf;
  border: 1px solid rgba(120, 170, 255, 0.35); border-radius: 6px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 0.85em;
}
.nge-mycells-more:hover:not(:disabled) { background: rgba(120, 170, 255, 0.1); }
.nge-mycells-more:disabled { opacity: 0.5; cursor: default; }
</style>
