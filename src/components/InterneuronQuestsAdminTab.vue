<script setup lang="ts">
/**
 * Admin Hub > Interneurons (Ames 2026-10-28). The list of giant MEC
 * interneurons players take on as long term quests, and the active time on
 * every MEC claim, so the lab can estimate how long these cells take.
 *
 * Adding cells: paste one cell a line, as a root ID, a root ID and its soma
 * point, or a point alone (looked up in the segmentation, so MEC must be the
 * open dataset). Rules on the server: supabase-interneuron-quests.sql.
 */
import { computed, onMounted, ref } from 'vue';
import { secureWrite } from '../secure_write';
import { canonicalDataset, currentDatasetTag } from '../datasets';
import { supervoxelAtPlace } from '../util/crosshair_cell';
import { getRootFromSupervoxel } from '../widgets/pcg_service';

const DATASET = 'pni_mec';

interface Quest { id: number; segment_id: string; status: string; notes: string | null; final_segment_id: string | null; nucleus_coords: string | null; holder: string | null; active_seconds: number; players: number }
interface TimeRow { task_id: number; segment_id: string; kind: string; status: string; mine: boolean; player: string; active_seconds: number; days: number; beats: number; edits: number; views_saved: number; milestones: number[]; first_at: string; last_at: string }
interface Line { root?: string; point?: number[]; supervoxel?: string; note?: string; text: string; problem?: string }

const quests = ref<Quest[]>([]);
const times = ref<TimeRow[]>([]);
const loading = ref(false);
const error = ref('');
const message = ref('');
const pasted = ref('');
const adding = ref(false);
const removing = ref<number | null>(null);
const onlyQuests = ref(false);

async function call<T = any>(operation: string, args: Record<string, any>): Promise<T> {
  return secureWrite<T>('quest.admin', { operation, args });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await call<{ quests: Quest[]; times: TimeRow[] }>('report', { dataset: DATASET });
    quests.value = r?.quests ?? [];
    times.value = r?.times ?? [];
  } catch (e: any) {
    error.value = /unknown action|pilot_quest_admin|could not find the function|\(404\)/i.test(String(e?.message))
      ? 'Interneuron quests are not switched on yet: the database part (supabase-interneuron-quests.sql) and the server function need to go in first.'
      : e?.message || 'Could not load the quests.';
  } finally { loading.value = false; }
}
onMounted(load);

/** One pasted line: a root ID, a root ID and a point, or a point. A note may follow a #. */
function parseLine(text: string): Line | null {
  const [body, ...rest] = text.split('#');
  const note = rest.join('#').trim().slice(0, 200) || undefined;
  const nums = (body.match(/\d+(?:\.\d+)?/g) ?? []);
  if (!nums.length) return null;
  const root = nums.find(n => /^\d{15,20}$/.test(n));
  const coords = nums.filter(n => n !== root).map(Number);
  const point = coords.length === 3 ? coords : undefined;
  if (!root && !point) return { text, problem: 'needs a root ID or three coordinates' };
  if (coords.length && !point) return { text, problem: 'a point has three numbers' };
  return { text, root, point, note };
}
const lines = computed(() => pasted.value.split(/\r?\n/).map(t => t.trim()).filter(Boolean).map(parseLine).filter((l): l is Line => !!l));
const needsLookup = computed(() => lines.value.some(l => !l.problem && !l.root));

async function add() {
  if (adding.value || !lines.value.length) return;
  adding.value = true;
  error.value = '';
  message.value = '';
  try {
    const todo = lines.value.map(l => ({ ...l }));
    // A point alone: read the supervoxel there, then its cell.
    if (todo.some(l => !l.problem && !l.root)) {
      if (canonicalDataset(currentDatasetTag()) !== DATASET) {
        error.value = 'Open MEC first: a line with only a point is looked up in its segmentation.';
        return;
      }
      for (const l of todo) {
        if (l.problem || l.root || !l.point) continue;
        const sv = await supervoxelAtPlace(l.point);
        if (!sv || sv === '0') { l.problem = 'no cell at that point'; continue; }
        const root = await getRootFromSupervoxel(sv);
        if (!root) { l.problem = 'could not look up the cell there'; continue; }
        l.root = root;
        l.supervoxel = sv;
      }
    }
    const good = todo.filter(l => !l.problem && l.root);
    const cells = good.map(l => ({ segment_id: l.root, point: l.point, supervoxel_id: l.supervoxel, note: l.note }));
    if (!cells.length) { error.value = 'No line could be read.'; return; }
    const r = await call<{ added: number; changed: number; already: number; bad: string[] }>('add', { dataset: DATASET, cells });
    const bad = todo.filter(l => l.problem);
    const parts = [
      r.added ? `${r.added} added` : '',
      r.changed ? `${r.changed} already in the Cell Library, now quests` : '',
      r.already ? `${r.already} already on the list` : '',
      bad.length ? `${bad.length} not read: ${bad.map(l => `"${l.text}" (${l.problem})`).join(', ')}` : '',
    ].filter(Boolean);
    message.value = parts.join('. ') + '.';
    // Keep only the lines that need another look.
    pasted.value = bad.map(l => l.text).join('\n');
    await load();
  } catch (e: any) {
    error.value = e?.message || 'Could not add the cells.';
  } finally { adding.value = false; }
}

async function remove(q: Quest) {
  if (removing.value) return;
  removing.value = q.id;
  error.value = '';
  try { await call('remove', { id: q.id }); await load(); }
  catch (e: any) { error.value = e?.message || 'Could not take it off the list.'; }
  finally { removing.value = null; }
}

function hours(s: number): string {
  if (!s) return '0';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
const STATUS: Record<string, string> = { pending: 'Open', assigned: 'Claimed', in_progress: 'Claimed', completed: 'Finished', skipped: 'Off the list' };
const shownTimes = computed(() => (onlyQuests.value ? times.value.filter(t => t.kind === 'interneuron') : times.value));

/** What a finished cell took: the claims completed, with their time. */
const finished = computed(() => {
  const done = shownTimes.value.filter(t => t.status === 'completed' && t.mine).map(t => t.active_seconds).sort((a, b) => a - b);
  if (!done.length) return null;
  const mid = done.length % 2 ? done[(done.length - 1) / 2] : (done[done.length / 2 - 1] + done[done.length / 2]) / 2;
  return { n: done.length, median: mid, mean: done.reduce((a, b) => a + b, 0) / done.length };
});

function downloadCsv() {
  const head = ['task_id', 'root_id', 'kind', 'status', 'finished_by_this_player', 'player', 'active_hours', 'days', 'heartbeats', 'edits', 'views_saved', 'milestones_hours', 'first', 'last'];
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = shownTimes.value.map(t => [t.task_id, t.segment_id, t.kind, t.status, t.status === 'completed' && t.mine ? 'yes' : '', t.player,
    (t.active_seconds / 3600).toFixed(2), t.days, t.beats, t.edits, t.views_saved, (t.milestones || []).join(' '), t.first_at, t.last_at]);
  const csv = [head, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `pyr-mec-active-time-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
</script>

<template>
  <section class="nge-iq">
    <div class="nge-iq-top">
      <h2>Interneuron quests</h2>
      <span class="nge-iq-sub">MEC. A player holds one at a time, beside their other claims, and it never expires.</span>
      <button class="nge-iq-btn nge-iq-refresh" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Refresh' }}</button>
    </div>
    <p v-if="error" class="nge-iq-err">{{ error }}</p>

    <h3>Add cells</h3>
    <p class="nge-iq-how">
      One cell a line: a root ID, a root ID and its soma point, or a soma point alone
      (x, y, z as Pyr shows them; a point alone is looked up in the segmentation, so open MEC first).
      A note for players may follow a #. A cell already in the Cell Library becomes a quest.
    </p>
    <textarea v-model="pasted" class="nge-iq-paste" rows="6" spellcheck="false"
              placeholder="720575940612345678, 123456, 234567, 3456 # big basket cell&#10;720575940698765432&#10;98765, 87654, 2345"
              @keydown.stop @keyup.stop @keypress.stop />
    <div class="nge-iq-row">
      <span class="nge-iq-sub">{{ lines.length }} line{{ lines.length === 1 ? '' : 's' }}<template v-if="needsLookup">, points looked up when you add</template></span>
      <button class="nge-iq-btn nge-iq-primary" :disabled="adding || !lines.length" @click="add">{{ adding ? 'Adding…' : 'Add to the list' }}</button>
    </div>
    <p v-if="message" class="nge-iq-msg">{{ message }}</p>

    <h3>The list <span class="nge-iq-sub">{{ quests.filter(q => q.status === 'pending').length }} open of {{ quests.filter(q => q.status !== 'skipped').length }}</span></h3>
    <p v-if="!quests.length && !loading" class="nge-iq-sub">No quests yet.</p>
    <table v-else class="nge-iq-table">
      <thead><tr><th>Cell</th><th>State</th><th>Held by</th><th>Active time</th><th>Players</th><th></th></tr></thead>
      <tbody>
        <tr v-for="q in quests" :key="q.id" :class="{ 'nge-iq-off': q.status === 'skipped' }">
          <td><code>{{ q.segment_id }}</code><div v-if="q.notes" class="nge-iq-note">{{ q.notes }}</div></td>
          <td>{{ STATUS[q.status] || q.status }}</td>
          <td>{{ q.holder || '' }}</td>
          <td>{{ hours(q.active_seconds) }}</td>
          <td>{{ q.players || '' }}</td>
          <td><button v-if="q.status === 'pending'" class="nge-iq-btn" :disabled="removing === q.id" @click="remove(q)">{{ removing === q.id ? 'Taking off…' : 'Take off' }}</button></td>
        </tr>
      </tbody>
    </table>

    <h3>Active time per claim</h3>
    <p class="nge-iq-how">
      Counted while the claimed cell is on screen, Pyr is in front, and the player used the mouse or keys in the last
      5 minutes. Kept per claim (cell and player), across visits and devices. Every MEC claim counts, not only quests.
    </p>
    <div class="nge-iq-row">
      <label class="nge-iq-sub"><input v-model="onlyQuests" type="checkbox" /> Quests only</label>
      <span v-if="finished" class="nge-iq-sub">Finished cells: {{ finished.n }}, median {{ hours(finished.median) }}, mean {{ hours(Math.round(finished.mean)) }}</span>
      <button class="nge-iq-btn" :disabled="!shownTimes.length" @click="downloadCsv">Download CSV</button>
    </div>
    <p v-if="!shownTimes.length && !loading" class="nge-iq-sub">No time counted yet.</p>
    <table v-else class="nge-iq-table">
      <thead><tr><th>Cell</th><th>Player</th><th>State</th><th>Active time</th><th>Days</th><th>Edits</th><th>Views saved</th><th>Last</th></tr></thead>
      <tbody>
        <tr v-for="t in shownTimes" :key="t.task_id + t.player">
          <td><code>{{ t.segment_id }}</code><span v-if="t.kind === 'interneuron'" class="nge-iq-tag">quest</span></td>
          <td>{{ t.player }}</td>
          <td>{{ t.status === 'completed' && t.mine ? 'Finished' : t.mine ? (STATUS[t.status] || t.status) : 'Let go' }}</td>
          <td>{{ hours(t.active_seconds) }}</td>
          <td>{{ t.days }}</td>
          <td>{{ t.edits }}</td>
          <td>{{ t.views_saved }}</td>
          <td>{{ new Date(t.last_at).toLocaleDateString() }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.nge-iq { font-size: 1rem; line-height: 1.5; color: #f1f5f9; padding: 16px; }
.nge-iq h2 { font-size: 1.25rem; margin: 0; }
.nge-iq h3 { font-size: 1.05rem; margin: 18px 0 4px; }
.nge-iq-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.nge-iq-sub { color: #9fb0c4; font-size: 0.9rem; font-weight: normal; }
.nge-iq-how { color: #b6c4d4; margin: 4px 0 8px; font-size: 0.92rem; }
.nge-iq-err { color: #f5d142; }
.nge-iq-msg { color: #7CFFB2; }
.nge-iq-refresh { margin-left: auto; }
.nge-iq-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 6px 0; }
.nge-iq-row .nge-iq-btn:last-child { margin-left: auto; }
.nge-iq-btn { font: inherit; font-size: 0.9rem; padding: 4px 12px; border-radius: 6px; border: 1px solid #3b4b5e; background: #152434; color: #c9d6e6; cursor: pointer; }
.nge-iq-btn:disabled { opacity: 0.5; cursor: default; }
.nge-iq-primary { border-color: #9fd3ff; color: #fff; background: #183049; }
.nge-iq-paste { width: 100%; box-sizing: border-box; font: 0.9rem/1.4 ui-monospace, monospace; background: #0f1b28; color: #e4ecf5; border: 1px solid #2f4155; border-radius: 8px; padding: 8px; }
.nge-iq-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.nge-iq-table th { text-align: left; color: #9fb0c4; font-weight: 600; border-bottom: 1px solid #2f4155; padding: 4px 8px; }
.nge-iq-table td { border-bottom: 1px solid #1c2c3d; padding: 4px 8px; vertical-align: top; }
.nge-iq-off { opacity: 0.5; }
.nge-iq-note { color: #9fb0c4; font-size: 0.85rem; }
.nge-iq-tag { margin-left: 6px; font-size: 0.75rem; padding: 0 6px; border-radius: 6px; background: rgba(196, 140, 255, 0.14); color: #d3b0ff; }
</style>
