<script setup lang="ts">
/**
 * Admin Hub, "Cell types": are the cell types the game logged really in
 * CAVE? Compares the game's log with CAVE's table for the dataset on screen,
 * and can send again the saves CAVE never took (Ames 2026-10-12).
 *
 * Nothing is sent until the admin presses the button, and only saves whose
 * own point is in the log are ever sent. The deciding is in
 * src/util/cell_type_check.ts.
 */
import { computed, ref } from 'vue';
import { supabase } from '../supabase';
import { currentDatasetTag, datasetDisplayName } from '../datasets';
import { listCaveCellTypes, resendCellType } from '../widgets/lightbulb_service';
import { isLatestRoots } from '../widgets/pcg_service';
import { currentIdsOf } from '../util/outdated_ids';
import { checkCellTypes, type CheckResult, type CheckedType, type CheckStatus, type LoggedType } from '../util/cell_type_check';

const dataset = ref(currentDatasetTag());
const busy = ref('');
const problem = ref('');
const result = ref<CheckResult | null>(null);
const names = ref<Record<string, string>>({});
const sent = ref<Record<string, 'sent' | string>>({});   // by segId: 'sent', or why not
const sending = ref(false);

const LABEL: Record<CheckStatus, string> = {
  in_cave: 'In CAVE',
  other_type: 'CAVE has another type',
  resend: 'Not in CAVE, can be sent again',
  needs_point: 'Not in CAVE, needs a point of its own',
  tried_again: 'Not in CAVE, tried again on the same spot (the newer one is sent)',
  missing: 'Logged as saved, not in CAVE',
  too_new: 'Too new for CAVE to list yet',
  unknown: 'Could not be checked',
};
const ORDER: CheckStatus[] = ['resend', 'needs_point', 'tried_again', 'missing', 'other_type', 'unknown', 'too_new', 'in_cave'];

async function readLog(tag: string): Promise<LoggedType[]> {
  const out: LoggedType[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('edit_log')
      .select('user_id,timestamp,segment_after,coordinates,metadata')
      .eq('operation', 'set_cell_type').eq('dataset', tag)
      .order('timestamp', { ascending: true }).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`The game's log could not be read: ${error.message}`);
    for (const r of (data || []) as any[]) {
      const segId = String(r.segment_after || r.metadata?.root_id || '');
      const type = String(r.metadata?.cell_type || '');
      if (!/^\d+$/.test(segId) || !type) continue;
      const xyz = typeof r.coordinates === 'string' ? r.coordinates.split(',').map((v: string) => Math.round(Number(v))) : [];
      out.push({
        userId: String(r.user_id || ''), at: new Date(r.timestamp).toISOString(), segId, type,
        point: xyz.length === 3 && xyz.every(Number.isFinite) ? xyz as [number, number, number] : null,
      });
    }
    if (!data || data.length < 1000) return out;
  }
}

async function run() {
  if (busy.value) return;
  problem.value = ''; result.value = null; sent.value = {};
  dataset.value = currentDatasetTag();
  try {
    busy.value = 'Reading CAVE’s table…';
    const cave = await listCaveCellTypes();
    if (cave.problem) { problem.value = cave.problem; return; }
    busy.value = 'Reading the game’s log…';
    const logged = await readLog(dataset.value);
    // Each logged cell's ID now. Cells never edited since are answered in one
    // request; only the edited ones need their history looked up.
    const ids = [...new Set(logged.map(l => l.segId))];
    const current = new Map<string, string[] | null>();
    busy.value = `Checking ${ids.length} cells for edits since…`;
    const flags = new Map<string, boolean>();
    for (let i = 0; i < ids.length; i += 400) {
      const part = await isLatestRoots(ids.slice(i, i + 400)).catch(() => null);
      if (part) for (const [id, latest] of part) flags.set(id, latest);
    }
    const edited: string[] = [];
    for (const id of ids) {
      const latest = flags.get(id);
      if (latest === true) current.set(id, [id]);
      else if (latest === false) edited.push(id);
      else current.set(id, null);
    }
    let done = 0;
    const next = async () => {
      for (;;) {
        const id = edited.pop();
        if (!id) return;
        current.set(id, await currentIdsOf(id));
        busy.value = `Following ${++done} edited cells to the IDs they have now…`;
      }
    };
    await Promise.all([next(), next(), next(), next()]);
    result.value = checkCellTypes(logged, cave.rows, current);
    void loadNames([...new Set(result.value.rows.map(r => r.userId).filter(Boolean))]);
  } catch (e: any) {
    problem.value = e?.message || String(e);
  } finally {
    busy.value = '';
  }
}

async function loadNames(userIds: string[]) {
  for (let i = 0; i < userIds.length; i += 100) {
    const { data } = await supabase.from('users').select('id,username,display_name').in('id', userIds.slice(i, i + 100));
    for (const u of (data || []) as any[]) names.value[u.id] = u.username || u.display_name || 'Player';
  }
}

const shown = computed(() => {
  const r = result.value;
  if (!r) return [] as CheckedType[];
  return r.rows.filter(x => x.status !== 'in_cave').sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.at.localeCompare(a.at));
});
const toSend = computed(() => (result.value?.rows ?? []).filter(r => r.status === 'resend' && sent.value[r.segId] !== 'sent'));

async function sendAgain() {
  const rows = toSend.value;
  if (!rows.length || sending.value) return;
  if (!window.confirm(`Save ${rows.length} cell type${rows.length === 1 ? '' : 's'} to CAVE now, at the points the game logged?\n\nCAVE will record YOU as the one who saved them. The game's own log still credits the player.`)) return;
  sending.value = true;
  try {
    for (const r of rows) {
      const res = await resendCellType(r.point!, r.type);
      sent.value = { ...sent.value, [r.segId]: res.ok ? 'sent' : res.problem };
    }
  } finally {
    sending.value = false;
  }
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function copyList() {
  const lines = ['status\tsaved\tplayer\tsegment_id\tcell_type\tpoint',
    ...shown.value.map(r => [LABEL[r.status], r.at, names.value[r.userId] || r.userId, r.segId, r.type, r.point ? r.point.join(', ') : ''].join('\t'))];
  void navigator.clipboard.writeText(lines.join('\n'));
}
</script>

<template>
  <div class="nge-ctc">
    <p class="nge-ctc-lead">
      Compares every cell type in the game's log with CAVE's table for <b>{{ datasetDisplayName(dataset) || dataset }}</b>, the dataset on screen.
      Nothing is changed by checking.
    </p>
    <div class="nge-ctc-actions">
      <button class="nge-admin-primary-btn" :disabled="!!busy || sending" @click="run">{{ busy ? 'Checking…' : result ? 'Check again' : 'Check cell types against CAVE' }}</button>
      <span v-if="busy" class="nge-ctc-busy">{{ busy }}</span>
    </div>
    <div v-if="problem" class="nge-ctc-problem">{{ problem }}</div>

    <template v-if="result">
      <div class="nge-ctc-counts">
        <div v-for="s in ORDER" :key="s" class="nge-ctc-count" :class="`nge-ctc-count--${s}`">
          <b>{{ result.counts[s] }}</b><span>{{ LABEL[s] }}</span>
        </div>
      </div>
      <p class="nge-ctc-note">
        One row per cell: its newest logged type.
        <template v-if="result.caveUpTo">CAVE's list goes up to {{ when(result.caveUpTo) }}. A save after that which CAVE did accept shows as too new until CAVE lists it.</template>
        <template v-else>CAVE listed no rows, so nothing logged can be confirmed yet.</template>
      </p>

      <div v-if="result.counts.resend" class="nge-ctc-send">
        <button class="nge-admin-primary-btn" :disabled="sending || !toSend.length" @click="sendAgain">
          {{ sending ? 'Sending…' : toSend.length ? `Send ${toSend.length} to CAVE again` : 'All sent' }}
        </button>
        <span>Only saves CAVE never took, each at its own logged point. CAVE will record you as the one who saved them.</span>
      </div>

      <div v-if="shown.length" class="nge-ctc-list-head">
        <span>{{ shown.length }} not confirmed in CAVE</span>
        <button class="nge-admin-action-btn" @click="copyList">Copy the list</button>
      </div>
      <div v-else class="nge-ctc-allgood">Every logged cell type is in CAVE.</div>
      <table v-if="shown.length" class="nge-ctc-table">
        <thead><tr><th>Status</th><th>Saved</th><th>Player</th><th>Cell</th><th>Type</th><th>Point</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.segId" :class="`nge-ctc-row--${r.status}`">
            <td>
              {{ LABEL[r.status] }}<template v-if="r.caveType">: {{ r.caveType }}</template>
              <div v-if="sent[r.segId]" class="nge-ctc-sent" :class="{ 'nge-ctc-sent--bad': sent[r.segId] !== 'sent' }">{{ sent[r.segId] === 'sent' ? '✓ Sent to CAVE' : sent[r.segId] }}</div>
            </td>
            <td>{{ when(r.at) }}</td>
            <td>{{ names[r.userId] || '…' }}</td>
            <td class="nge-ctc-id">{{ r.segId }}</td>
            <td>{{ r.type }}</td>
            <td class="nge-ctc-id">{{ r.point ? r.point.join(', ') : '' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.nge-ctc { font: 400 14px/1.45 'Inter', system-ui, sans-serif; color: #e6ecf5; }
.nge-ctc-lead { margin: 0 0 12px; color: rgba(255, 255, 255, 0.82); }
.nge-ctc-actions, .nge-ctc-send { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.nge-ctc-busy, .nge-ctc-send span { font-size: 13px; color: rgba(255, 255, 255, 0.7); }
.nge-ctc-problem { margin: 0 0 12px; padding: 9px 12px; border-radius: 8px; background: rgba(255, 93, 115, 0.14); border: 1px solid rgba(255, 93, 115, 0.4); color: #ffc2cb; }
.nge-ctc-counts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.nge-ctc-count { display: flex; align-items: baseline; gap: 7px; padding: 7px 11px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); }
.nge-ctc-count b { font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; }
.nge-ctc-count span { font-size: 12.5px; color: rgba(255, 255, 255, 0.75); }
.nge-ctc-count--in_cave b { color: #8ee8a0; }
.nge-ctc-count--resend b, .nge-ctc-count--needs_point b, .nge-ctc-count--missing b { color: #ff9c94; }
.nge-ctc-count--other_type b, .nge-ctc-count--unknown b, .nge-ctc-count--tried_again b { color: #ffc857; }
.nge-ctc-note { margin: 0 0 12px; font-size: 12.5px; color: rgba(255, 255, 255, 0.65); }
.nge-ctc-list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 6px 0; font-weight: 600; }
.nge-ctc-allgood { padding: 10px 12px; border-radius: 8px; background: rgba(94, 232, 168, 0.12); border: 1px solid rgba(94, 232, 168, 0.35); color: #b6f3cf; }
.nge-ctc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.nge-ctc-table th { text-align: left; font-weight: 600; font-size: 12px; color: rgba(255, 255, 255, 0.6); padding: 5px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.14); }
.nge-ctc-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); vertical-align: top; }
.nge-ctc-id { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 12px; white-space: nowrap; }
.nge-ctc-row--resend td:first-child, .nge-ctc-row--needs_point td:first-child, .nge-ctc-row--missing td:first-child { color: #ffb1aa; font-weight: 600; }
.nge-ctc-sent { margin-top: 2px; font-size: 12px; font-weight: 600; color: #8ee8a0; }
.nge-ctc-sent--bad { color: #ffc857; }
</style>
