<script setup lang="ts">
/**
 * Admin Hub > Hunts (Ames 2026-10-20). Make a Hunt from a link: open the
 * link (a cell with each merger marked by a point in an annotation layer),
 * read the answer key, the cells and the view from the screen, set the dates,
 * and schedule it. Scheduling writes the three notifications (announcement,
 * start, end) at their own times; each can also be sent now. When it ends,
 * the gold, silver and bronze Achievements are given by themselves.
 * Rules on the server: functions/hunts.js.
 */
import { computed, onMounted, ref } from 'vue';
import ConfirmDialog from 'components/ConfirmDialog.vue';
import { huntCall, keyCandidates, readHuntFromScreen, type KeyCandidate } from '../hunt';
import { openStartLink } from '../util/start_link';
import { datasetAbbrev, findDatasetByCanonical, segLayerName } from '../datasets';

type Tier = 'gold' | 'silver' | 'bronze';
interface AdminHunt {
  id: number; title: string; description: string; dataset: string; cells: { root: string; label: string }[];
  target_count: number; tolerance_nm: number; max_points: number; max_submissions: number;
  tiers: Record<Tier, number>; art: Partial<Record<Tier, string>>; status: string; phase: string;
  announce_at: string | null; start_at: string | null; end_at: string | null; awarded_at: string | null;
  has_view: boolean; thresholds: Record<Tier, number>; players: number;
  notes?: Record<string, { id: number; send_at: string; sent: boolean }>;
}
interface BoardRow { rank: number; name: string; found: number; at: string; tries: number; tier: Tier | null }

const TIERS: Tier[] = ['gold', 'silver', 'bronze'];
const TIER_WORD: Record<Tier, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const PHASE_WORD: Record<string, string> = { draft: 'Draft', announced: 'Scheduled', live: 'Running', ended: 'Over', cancelled: 'Cancelled' };

const list = ref<AdminHunt[]>([]);
const loading = ref(false);
const error = ref('');
const message = ref('');
const busy = ref('');
const editing = ref<AdminHunt | null>(null);
const board = ref<BoardRow[]>([]);
const asking = ref<'' | 'cancel' | 'delete' | 'start' | 'end' | 'announce'>('');
const notInstalled = ref(false);

// The form
const blank = () => ({ title: '', description: '', link: '', tolerance_um: 3, max_points: 0, max_submissions: 10,
  tiers: { gold: 0, silver: 0, bronze: 0 } as Record<Tier, number>, art: { gold: '', silver: '', bronze: '' } as Record<Tier, string>,
  announce: '', start: '', end: '' });
const form = ref(blank());
const candidates = ref<KeyCandidate[]>([]);
const keyLayer = ref('');
const read = ref<null | { key: any; view: any; cells: { root: string; label: string }[]; dataset: string; count: number; layer: string }>(null);

/** 'YYYY-MM-DDTHH:mm' in this computer's time zone. */
function toLocalInput(iso: string | null | undefined): string {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  const d = new Date(t), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null { if (!v) return null; const t = new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function local(iso: string | null | undefined): string {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function datasetName(canon: string) { const ds = findDatasetByCanonical(canon); return ds ? datasetAbbrev(segLayerName(ds)) : canon; }

async function refresh() {
  loading.value = true; error.value = '';
  try {
    list.value = await huntCall<AdminHunt[]>('hunt.list');
    notInstalled.value = false;
  } catch (e: any) {
    const m = e?.message || String(e);
    // No tables yet (the server says so), or no ewHunt function at all (the request never lands).
    if (/not set up yet|Failed to fetch|NetworkError|Load failed/i.test(m)) notInstalled.value = true;
    error.value = m;
  } finally { loading.value = false; }
}
onMounted(refresh);

function startNew() {
  const start = new Date(); start.setDate(start.getDate() + 2); start.setHours(15, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 3);
  const announce = new Date(start); announce.setDate(announce.getDate() - 1);
  editing.value = { id: 0 } as AdminHunt;
  form.value = { ...blank(), announce: toLocalInput(announce.toISOString()), start: toLocalInput(start.toISOString()), end: toLocalInput(end.toISOString()) };
  read.value = null; board.value = []; message.value = ''; error.value = '';
  scan();
}

async function open(h: AdminHunt) {
  busy.value = 'open'; error.value = ''; message.value = '';
  try {
    const full = await huntCall<AdminHunt & { board: BoardRow[] }>('hunt.read', { id: h.id });
    editing.value = full; board.value = full.board || [];
    form.value = { title: full.title, description: full.description || '', link: '', tolerance_um: Math.round(full.tolerance_nm / 100) / 10,
      max_points: full.max_points || 0, max_submissions: full.max_submissions || 10,
      tiers: { gold: full.tiers?.gold || 0, silver: full.tiers?.silver || 0, bronze: full.tiers?.bronze || 0 },
      art: { gold: full.art?.gold || '', silver: full.art?.silver || '', bronze: full.art?.bronze || '' },
      announce: toLocalInput(full.announce_at), start: toLocalInput(full.start_at), end: toLocalInput(full.end_at) };
    read.value = null;
    scan();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

function close() { editing.value = null; read.value = null; board.value = []; message.value = ''; void refresh(); }

function scan() {
  candidates.value = keyCandidates();
  if (!candidates.value.some(c => c.name === keyLayer.value)) keyLayer.value = candidates.value[0]?.name || '';
}

function openLink() {
  error.value = ''; message.value = '';
  if (!openStartLink(form.value.link.trim())) { error.value = 'That is not a view link (it needs a #! part). Copy the share link of the view.'; return; }
  message.value = 'Opening the link. When the cell and the marked mergers are on screen, read the key below.';
  setTimeout(scan, 2500); setTimeout(scan, 6000);
}

function useScreen() {
  error.value = ''; message.value = '';
  try {
    if (!keyLayer.value) throw new Error('Pick the layer with the mergers marked.');
    const r = readHuntFromScreen(keyLayer.value);
    const count = candidates.value.find(c => c.name === keyLayer.value)?.points ?? 0;
    if (!r.cells.length) throw new Error('No cell is shown. Show the cell (or cells) the mergers are on, then read again.');
    read.value = { ...r, count, layer: keyLayer.value };
    message.value = `Read ${count === 1 ? '1 merger' : `${count} mergers`} from "${keyLayer.value}", ${r.cells.length === 1 ? '1 cell' : `${r.cells.length} cells`}, on ${datasetName(r.dataset)}. Save to keep them.`;
  } catch (e: any) { error.value = e?.message || String(e); }
}

const isNew = computed(() => !editing.value?.id);
const phase = computed(() => editing.value?.phase || 'draft');
const scheduled = computed(() => phase.value === 'announced' || phase.value === 'live' || phase.value === 'ended');
const keyNeeded = computed(() => isNew.value && !read.value);
const defaultsFor = computed(() => {
  const n = read.value?.count ?? editing.value?.target_count ?? 0;
  return n ? { gold: n, silver: Math.ceil((2 * n) / 3), bronze: Math.ceil(n / 3), points: Math.max(10, 3 * n) } : null;
});

async function save(status?: 'draft' | 'scheduled') {
  if (busy.value) return;
  busy.value = 'save'; error.value = ''; message.value = '';
  try {
    const f = form.value;
    const fields: Record<string, any> = {
      title: f.title, description: f.description, tolerance_nm: Math.round(Number(f.tolerance_um) * 1000),
      max_points: Number(f.max_points) || 0, max_submissions: Number(f.max_submissions) || 10,
      tiers: f.tiers, art: f.art,
      announce_at: fromLocalInput(f.announce), start_at: fromLocalInput(f.start), end_at: fromLocalInput(f.end),
    };
    const args: Record<string, any> = { fields };
    if (editing.value?.id) args.id = editing.value.id;
    if (read.value) { args.key = read.value.key; args.view = read.value.view; fields.cells = read.value.cells; fields.dataset = read.value.dataset; }
    if (status) args.status = status;
    const h = await huntCall<AdminHunt>('hunt.save', args);
    editing.value = { ...h }; read.value = null;
    message.value = status === 'scheduled' ? 'Scheduled. The notes go out at their times.' : 'Saved.';
    void refresh();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

async function act(action: 'hunt.now' | 'hunt.cancel' | 'hunt.delete' | 'hunt.award' | 'hunt.rescore', extra: Record<string, any> = {}) {
  const h = editing.value; if (!h?.id || busy.value) return;
  asking.value = ''; busy.value = action; error.value = ''; message.value = '';
  try {
    const r = await huntCall<any>(action, { id: h.id, ...extra });
    if (action === 'hunt.delete') { close(); return; }
    if (action === 'hunt.award') message.value = `Awards: ${r?.gold ?? 0} gold, ${r?.silver ?? 0} silver, ${r?.bronze ?? 0} bronze${r?.fresh ? `, ${r.fresh} new` : ''}.`;
    else if (action === 'hunt.rescore') message.value = `Scored ${r?.rescored ?? 0} answers again; ${r?.changed ?? 0} changed.`;
    else message.value = 'Done.';
    await open(r && r.id ? r : h);
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}

const notes = computed(() => {
  const n = editing.value?.notes || {};
  return (['announce', 'start', 'end'] as const).map(k => ({ kind: k, word: k === 'announce' ? 'Announcement' : k === 'start' ? 'Start' : 'End and awards', note: n[k] || null }));
});
</script>

<template>
  <section class="nge-hunts-admin">
    <header class="nge-hunts-head">
      <h3>Hunts</h3>
      <p class="nge-hunts-lead">A timed merger hunt: players drop gold gems on the mergers of a cell and submit; gold, silver and bronze Achievements go to the best hunters when it ends.</p>
    </header>

    <p v-if="notInstalled" class="nge-hunts-warn">The Hunt is not set up on the server yet: run <code>supabase-hunts.sql</code> in Supabase, then deploy the <code>ewHunt</code> function.</p>
    <p v-if="error && !notInstalled" class="nge-hunts-error" role="alert">{{ error }}</p>
    <p v-if="message" class="nge-hunts-msg" role="status">{{ message }}</p>

    <!-- The list -->
    <template v-if="!editing">
      <button class="nge-hunts-btn nge-hunts-btn--primary" @click="startNew">New Hunt</button>
      <p v-if="loading" class="nge-hunts-muted">Loading…</p>
      <p v-else-if="!list.length && !notInstalled" class="nge-hunts-muted">No Hunts yet.</p>
      <ul class="nge-hunts-list">
        <li v-for="h in list" :key="h.id" @click="open(h)" @keydown.enter="open(h)" tabindex="0">
          <span class="nge-hunts-chip" :class="`nge-hunts-chip--${h.phase}`">{{ PHASE_WORD[h.phase] || h.phase }}</span>
          <span class="nge-hunts-name">{{ h.title }}</span>
          <span class="nge-hunts-meta">{{ h.target_count }} mergers · {{ h.players }} {{ h.players === 1 ? 'player' : 'players' }}<template v-if="h.start_at"> · {{ local(h.start_at) }}</template></span>
        </li>
      </ul>
    </template>

    <!-- One hunt -->
    <template v-else>
      <button class="nge-hunts-back" @click="close">← All Hunts</button>
      <div class="nge-hunts-title-row">
        <span class="nge-hunts-chip" :class="`nge-hunts-chip--${phase}`">{{ PHASE_WORD[phase] || phase }}</span>
        <strong>{{ editing.title || 'New Hunt' }}</strong>
      </div>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>1. The answer key</legend>
        <p class="nge-hunts-help">Paste a share link of the cell with every merger marked by a point in an annotation layer, open it, then read it from the screen. The players start from the same view, with every annotation layer taken out.</p>
        <div class="nge-hunts-row">
          <input v-model="form.link" class="nge-hunts-input" placeholder="https://… #!…" aria-label="View link" />
          <button class="nge-hunts-btn" :disabled="!form.link.trim()" @click="openLink">Open the link</button>
        </div>
        <div class="nge-hunts-row">
          <select v-model="keyLayer" class="nge-hunts-input" aria-label="Layer with the mergers" @focus="scan">
            <option v-if="!candidates.length" value="">No annotation layer with points on screen</option>
            <option v-for="c in candidates" :key="c.name" :value="c.name">{{ c.name }} ({{ c.points }} {{ c.points === 1 ? 'point' : 'points' }})</option>
          </select>
          <button class="nge-hunts-btn" :disabled="!keyLayer" @click="useScreen">Read from the screen</button>
          <button class="nge-hunts-btn nge-hunts-btn--quiet" title="Look again for annotation layers" @click="scan">↻</button>
        </div>
        <p v-if="!isNew && !read" class="nge-hunts-muted">Saved key: {{ editing.target_count }} {{ editing.target_count === 1 ? 'merger' : 'mergers' }} on {{ editing.cells?.length || 0 }} {{ (editing.cells?.length || 0) === 1 ? 'cell' : 'cells' }}, {{ datasetName(editing.dataset) }}. Read again to replace it<template v-if="editing.players"> (every answer is scored again)</template>.</p>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>2. The words</legend>
        <label>Title <input v-model="form.title" class="nge-hunts-input" maxlength="80" placeholder="The Pinky Merger Hunt" /></label>
        <label>Description <textarea v-model="form.description" class="nge-hunts-input" rows="3" maxlength="1500" placeholder="What players are looking for, and any hint."></textarea></label>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>3. When</legend>
        <p class="nge-hunts-help">In your own time zone. Players see it in theirs.</p>
        <div class="nge-hunts-grid">
          <label>Announce <input v-model="form.announce" type="datetime-local" class="nge-hunts-input" /></label>
          <label>Start <input v-model="form.start" type="datetime-local" class="nge-hunts-input" /></label>
          <label>End <input v-model="form.end" type="datetime-local" class="nge-hunts-input" /></label>
        </div>
      </fieldset>

      <fieldset class="nge-hunts-group" :disabled="!!busy">
        <legend>4. Scoring and prizes</legend>
        <div class="nge-hunts-grid">
          <label>Tolerance (µm) <input v-model.number="form.tolerance_um" type="number" min="0.1" max="100" step="0.5" class="nge-hunts-input" /></label>
          <label>Gems per answer <input v-model.number="form.max_points" type="number" min="0" class="nge-hunts-input" :placeholder="defaultsFor ? `auto: ${defaultsFor.points}` : 'auto'" /></label>
          <label>Answers per player <input v-model.number="form.max_submissions" type="number" min="1" class="nge-hunts-input" /></label>
        </div>
        <p class="nge-hunts-help">A gem counts when it is within the tolerance of a merger. Mergers each player must find for each medal (0 means the default: all, two thirds, one third).</p>
        <div class="nge-hunts-grid">
          <label v-for="t in TIERS" :key="t">{{ TIER_WORD[t] }} <input v-model.number="form.tiers[t]" type="number" min="0" class="nge-hunts-input" :placeholder="defaultsFor ? `default ${defaultsFor[t]}` : '0'" /></label>
        </div>
        <details class="nge-hunts-art">
          <summary>Achievement art (optional)</summary>
          <p class="nge-hunts-help">An https image for each medal. Left empty, the game's own gold, silver and bronze medals are used.</p>
          <label v-for="t in TIERS" :key="t">{{ TIER_WORD[t] }} <input v-model="form.art[t]" class="nge-hunts-input" placeholder="https://…" /></label>
        </details>
      </fieldset>

      <div class="nge-hunts-actions">
        <button class="nge-hunts-btn" :disabled="!!busy || keyNeeded || !form.title.trim()" @click="save('draft')" v-if="!scheduled">Save draft</button>
        <button class="nge-hunts-btn nge-hunts-btn--primary" :disabled="!!busy || keyNeeded || !form.title.trim()" @click="save(scheduled ? undefined : 'scheduled')">
          {{ busy === 'save' ? 'Saving…' : scheduled ? 'Save changes' : 'Schedule' }}
        </button>
        <span v-if="keyNeeded" class="nge-hunts-muted">Read the answer key first.</span>
      </div>

      <!-- Notes and controls for a scheduled hunt -->
      <fieldset v-if="scheduled" class="nge-hunts-group">
        <legend>Notifications</legend>
        <ul class="nge-hunts-notes">
          <li v-for="n in notes" :key="n.kind">
            <span class="nge-hunts-note-word">{{ n.word }}</span>
            <span v-if="n.note" :class="n.note.sent ? 'nge-hunts-sent' : 'nge-hunts-due'">{{ n.note.sent ? 'sent' : 'goes out' }} {{ local(n.note.send_at) }}</span>
            <span v-else class="nge-hunts-muted">none</span>
          </li>
        </ul>
        <div class="nge-hunts-actions">
          <button v-if="phase === 'announced'" class="nge-hunts-btn" :disabled="!!busy" @click="asking = 'announce'">Announce now</button>
          <button v-if="phase === 'announced'" class="nge-hunts-btn" :disabled="!!busy" @click="asking = 'start'">Start now</button>
          <button v-if="phase === 'live'" class="nge-hunts-btn" :disabled="!!busy" @click="asking = 'end'">End now and give the awards</button>
          <button v-if="phase === 'ended'" class="nge-hunts-btn" :disabled="!!busy" @click="act('hunt.award')">Give the awards again</button>
          <button v-if="editing.players" class="nge-hunts-btn nge-hunts-btn--quiet" :disabled="!!busy" @click="act('hunt.rescore')">Score again</button>
          <button v-if="phase !== 'ended'" class="nge-hunts-btn nge-hunts-btn--danger" :disabled="!!busy" @click="asking = 'cancel'">Cancel the Hunt</button>
        </div>
      </fieldset>
      <div v-else-if="!isNew" class="nge-hunts-actions">
        <button class="nge-hunts-btn nge-hunts-btn--danger" :disabled="!!busy" @click="asking = 'delete'">Delete</button>
      </div>

      <!-- Results -->
      <fieldset v-if="board.length" class="nge-hunts-group">
        <legend>Hunters ({{ board.length }})</legend>
        <table class="nge-hunts-board">
          <thead><tr><th>#</th><th>Player</th><th>Best</th><th>Answers</th><th>Medal</th></tr></thead>
          <tbody>
            <tr v-for="b in board" :key="b.rank"><td>{{ b.rank }}</td><td>{{ b.name }}</td><td>{{ b.found }} / {{ editing.target_count }}</td><td>{{ b.tries }}</td><td>{{ b.tier ? TIER_WORD[b.tier] : '' }}</td></tr>
          </tbody>
        </table>
      </fieldset>

      <ConfirmDialog v-if="asking === 'announce'" title="Announce the Hunt now?" text="The announcement goes to every player now, instead of at its time." yes="Announce now" @yes="act('hunt.now', { kind: 'announce' })" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'start'" title="Start the Hunt now?" text="It starts for every player now, and the start notification goes out." yes="Start now" @yes="act('hunt.now', { kind: 'start' })" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'end'" title="End the Hunt now?" text="Answers stop now. The end notification goes out and the gold, silver and bronze Achievements are given." yes="End and award" @yes="act('hunt.now', { kind: 'end' })" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'cancel'" title="Cancel the Hunt?" text="Players stop seeing it. Notifications not sent yet are taken back; any already sent stay." yes="Cancel the Hunt" @yes="act('hunt.cancel')" @no="asking = ''" />
      <ConfirmDialog v-if="asking === 'delete'" title="Delete this Hunt?" text="The Hunt, its key and every answer are deleted for good." yes="Delete for good" @yes="act('hunt.delete')" @no="asking = ''" />
    </template>
  </section>
</template>

<style scoped>
.nge-hunts-admin { display: flex; flex-direction: column; gap: 12px; color: #dbe7f7; font-size: 14px; }
.nge-hunts-head h3 { margin: 0; font: 600 16px 'Inter', sans-serif; color: #fff; }
.nge-hunts-lead, .nge-hunts-help { margin: 4px 0 0; color: #a9bbd3; font-size: 13px; line-height: 1.45; }
.nge-hunts-warn { padding: 8px 10px; border-radius: 8px; background: rgba(245, 209, 66, 0.1); border: 1px solid rgba(245, 209, 66, 0.45); }
.nge-hunts-error { color: #ff9c9c; margin: 0; }
.nge-hunts-msg { color: #b8f5cf; margin: 0; }
.nge-hunts-muted { color: #8fa3bf; margin: 0; }
.nge-hunts-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.nge-hunts-list li { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; cursor: pointer; background: rgba(90, 170, 255, 0.05); border: 1px solid rgba(90, 170, 255, 0.18); }
.nge-hunts-list li:hover, .nge-hunts-list li:focus-visible { background: rgba(90, 170, 255, 0.12); }
.nge-hunts-name { flex: 1; min-width: 0; color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-hunts-meta { color: #8fa3bf; font-size: 12.5px; white-space: nowrap; }
.nge-hunts-chip { flex: none; padding: 1px 8px; border-radius: 999px; font: 600 11px 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; background: rgba(169, 187, 211, 0.15); color: #cfdcef; }
.nge-hunts-chip--announced { background: rgba(90, 170, 255, 0.18); color: #9fd0ff; }
.nge-hunts-chip--live { background: rgba(245, 209, 66, 0.2); color: #f8e08a; }
.nge-hunts-chip--ended { background: rgba(124, 255, 178, 0.14); color: #b8f5cf; }
.nge-hunts-chip--cancelled { background: rgba(255, 120, 120, 0.14); color: #ffb3b3; }
.nge-hunts-back { align-self: flex-start; background: none; border: none; color: #9fd0ff; cursor: pointer; padding: 0; font-size: 13px; }
.nge-hunts-title-row { display: flex; gap: 10px; align-items: center; color: #fff; font-size: 16px; }
.nge-hunts-group { border: 1px solid rgba(90, 170, 255, 0.2); border-radius: 10px; padding: 10px 12px 12px; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.nge-hunts-group legend { padding: 0 6px; color: #9fd0ff; font-size: 12.5px; font-weight: 600; letter-spacing: 0.04em; }
.nge-hunts-group label { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: #a9bbd3; }
.nge-hunts-row { display: flex; gap: 8px; align-items: center; }
.nge-hunts-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.nge-hunts-input { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.3); color: #e6f0ff; font: 13.5px 'Inter', sans-serif; }
.nge-hunts-row .nge-hunts-input { flex: 1; }
.nge-hunts-btn { flex: none; padding: 6px 12px; border-radius: 7px; cursor: pointer; background: rgba(90, 170, 255, 0.12); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; font: 600 13px 'Inter', sans-serif; }
.nge-hunts-btn:hover:not(:disabled), .nge-hunts-btn:focus-visible { background: rgba(90, 170, 255, 0.22); }
.nge-hunts-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hunts-btn--primary { background: rgba(245, 209, 66, 0.16); border-color: rgba(245, 209, 66, 0.65); color: #fff3c4; align-self: flex-start; }
.nge-hunts-btn--primary:hover:not(:disabled) { background: rgba(245, 209, 66, 0.28); }
.nge-hunts-btn--quiet { background: none; }
.nge-hunts-btn--danger { border-color: rgba(255, 120, 120, 0.5); color: #ffc4c4; background: rgba(255, 120, 120, 0.08); }
.nge-hunts-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.nge-hunts-art summary { cursor: pointer; color: #9fd0ff; font-size: 13px; }
.nge-hunts-art label { margin-top: 6px; }
.nge-hunts-notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.nge-hunts-notes li { display: flex; gap: 10px; }
.nge-hunts-note-word { width: 120px; color: #cfdcef; }
.nge-hunts-sent { color: #b8f5cf; }
.nge-hunts-due { color: #9fd0ff; }
.nge-hunts-board { border-collapse: collapse; width: 100%; font-size: 13px; }
.nge-hunts-board th, .nge-hunts-board td { text-align: left; padding: 3px 6px; border-bottom: 1px solid rgba(90, 170, 255, 0.12); }
.nge-hunts-board th { color: #8fa3bf; font-weight: 600; }
</style>
