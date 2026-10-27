<script setup lang="ts">
/**
 * Admin Hub > Hunts > Hunt builder (Ames 2026-10-27; rules in functions/hunt_build.js): the candidate cells, one
 * row each, with their status and the next step. Players proofread a candidate through the Cell Library; invited
 * helpers suggest merges and cuts; admins plant them (BuildQueueCard), then make the Hunt from the planted edits
 * (Make a Hunt from a proofread cell, "Planted errors"), and Put it back after the Hunt.
 */
import { computed, onMounted, ref } from 'vue';
import { huntCall } from '../hunt';
import { putBack, openBuildCell } from '../hunt_build';
import { etNaiveToUtcIso, utcIsoToEtNaive } from '../util/et_time';

interface Row {
  id: number; root: string; status: string; task: { status: string; who: string | null; since: string } | null;
  proofread_by: string | null; proofread_at: string | null; helpers: { id: string; name: string }[];
  merges_each: number; cuts_each: number; counts: Record<string, number>; hunt_id: number | null; admin_note: string;
  moves: string[]; start: number[] | null; created_at: string; anchor_sv?: string | null;
  suggest_until: string | null; closed: boolean; proofread_root: string | null; hunt_root: string | null;
}
const emit = defineEmits<{ (e: 'make', id: number): void }>();

const rows = ref<Row[]>([]);
const paste = ref('');
const busy = ref('');
const error = ref('');
const message = ref('');
const notInstalled = ref(false);
const open = ref<number | null>(null);
const helpersText = ref('');
const sendBackNote = ref('');
/** When suggestions close, Eastern, as the Hunts tab's times (Ames 2026-10-27: "after that period (set time) ends they go to admin"). */
const closeAt = ref('');

const STATUS_WORD: Record<string, string> = {
  proofreading: 'Proofreading', proofread: 'Proofread', suggesting: 'Suggestions open', planting: 'Planting',
  building: 'Building · veiled', in_hunt: 'In a Hunt', put_back: 'Put back', dropped: 'Dropped',
};
const MOVE_WORD: Record<string, string> = {
  suggesting: 'Open suggestions', proofreading: 'Send back', dropped: 'Drop', planting: 'Close suggestions, start planting',
  building: 'Finish planting', proofread: 'Back to proofread',
};
/**
 * The stages in order, each with what happens there (Ames 2026-10-27: "a step through here that lets me see all the
 * stages in hover tooltip"). The strip on top counts the cells at each; a row's chip shows its stage's words.
 */
const STAGES: { key: string; word: string; tip: string }[] = [
  { key: 'proofreading', word: 'Proofreading', tip: 'Players claim it in the Cell Library, where it is tagged Hunt candidate and listed first, and proofread it fully. Pressing Done moves it on.' },
  { key: 'proofread', word: 'Proofread', tip: 'You look it over. Send it back with a note, open suggestions, or build the Hunt straight from the proofreaders\' own edits.' },
  { key: 'suggesting', word: 'Suggestions', tip: 'Everyone with production access (and anyone you invite) merges and cuts with the normal tools; Pyr keeps each edit as a suggestion and the cell stays as it is. Locked: out of the Cell Library, no claims, other players\' edits refused. Closes at the time you set.' },
  { key: 'planting', word: 'Planting', tip: 'You go through the suggestions, oldest first: Plant it makes the helper\'s edit for real, or Skip. Veiled: players cannot see the cell in Pyr from here on.' },
  { key: 'building', word: 'Building', tip: 'Make the Hunt: the planted edits reversed, or the proofreaders\' edits. Set its words and times and save. Still veiled. Best done close to the Hunt.' },
  { key: 'in_hunt', word: 'In a Hunt', tip: 'At the start the veil lifts for the cell players hunt only: pieces a planted cut made, and the proofread cell, stay hidden. Helpers get their Achievement at the end.' },
  { key: 'put_back', word: 'Put back', tip: 'After the Hunt ends, Put it back undoes every planting, so the cell is as it was proofread.' },
];
const stageIndex = (status: string) => STAGES.findIndex(st => st.key === status);
const stageTip = (r: Row) => {
  const i = stageIndex(r.status);
  if (r.status === 'dropped') return 'Dropped: off the list. Bring it back to proofread it again.';
  return i < 0 ? '' : `Stage ${i + 1} of ${STAGES.length}, ${STAGES[i].word}. ${r.closed ? 'Suggestions have closed: helpers cannot add more. ' : ''}${STAGES[i].tip}`;
};
const stageCount = (key: string) => rows.value.filter(r => r.status === key).length;
const etLine = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '');
const statusWord = (r: Row) => (r.closed ? 'Suggestions closed' : STATUS_WORD[r.status] || r.status);
const moveWord = (r: Row, to: string) => (r.status === 'planting' && to === 'suggesting' ? 'Reopen suggestions' : r.status === 'building' && to === 'planting' ? 'Back to planting'
  : r.status === 'proofread' && to === 'building' ? 'Build from the proofreaders\' edits'
  : r.status === 'building' && to === 'proofread' ? 'Back to proofread'
  : r.status === 'dropped' && to === 'proofreading' ? 'Bring back' : MOVE_WORD[to] || to);
const who = (r: Row) => r.proofread_by || r.task?.who || '';
const countsLine = (r: Row) => {
  const c = r.counts || {};
  const parts = [c.planted ? `${c.planted} planted` : '', c.skipped ? `${c.skipped} skipped` : '', c.open ? `${c.open} open` : ''].filter(Boolean);
  return parts.length ? `${parts.join(', ')}${c.helpers ? ` from ${c.helpers} ${c.helpers === 1 ? 'helper' : 'helpers'}` : ''}` : '';
};
const live = computed(() => rows.value.filter(r => r.status !== 'put_back' && r.status !== 'dropped'));
const past = computed(() => rows.value.filter(r => r.status === 'put_back' || r.status === 'dropped'));

async function load() {
  busy.value = 'load'; error.value = '';
  try { rows.value = (await huntCall<{ cells: Row[] }>('build.list')).cells || []; notInstalled.value = false; }
  catch (e: any) { if (/not set up/.test(String(e?.message))) notInstalled.value = true; else error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
onMounted(load);

async function add() {
  if (!paste.value.trim() || busy.value) return;
  busy.value = 'add'; error.value = ''; message.value = '';
  try {
    const r = await huntCall<{ added: number; skipped: string[]; cells: Row[] }>('build.add', { roots: paste.value });
    rows.value = r.cells; paste.value = '';
    message.value = `Added ${r.added} ${r.added === 1 ? 'cell' : 'cells'} to the Cell Library on the Sandbox, each marked Hunt candidate.${r.skipped.length ? ` Already here: ${r.skipped.length}.` : ''}`;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
function toggle(r: Row) {
  open.value = open.value === r.id ? null : r.id;
  helpersText.value = r.helpers.map(h => h.name).join(', ');
  sendBackNote.value = '';
  closeAt.value = r.suggest_until ? utcIsoToEtNaive(r.suggest_until) : '';
}
async function move(r: Row, to: string) {
  if (busy.value) return;
  busy.value = `move${r.id}`; error.value = ''; message.value = '';
  try {
    const until = closeAt.value ? etNaiveToUtcIso(closeAt.value) : null;
    const out = await huntCall<{ cells: Row[] }>('build.move', { id: r.id, to, note: to === 'proofreading' ? sendBackNote.value.trim() : '', ...(to === 'suggesting' ? { suggest_until: until } : {}) });
    rows.value = out.cells;
    message.value = to === 'suggesting' ? `Suggestions are open${until ? ` until ${etLine(until)}` : ''} to everyone with production access${r.helpers.length ? `, and ${r.helpers.length} invited` : ''}. They have a note in the bell. The cell is out of the Library and its edits are kept as suggestions now.`
      : to === 'building' && r.status === 'proofread' ? 'The cell is locked and hidden from players now. Make the Hunt from the proofreaders\' edits when you are ready.'
      : to === 'planting' ? 'Suggestions are closed and the cell is veiled: players can\'t see it in Pyr now. Go through them to plant.'
      : to === 'building' ? 'Planting is done. Make the Hunt from it when you are ready.'
      : to === 'proofreading' && r.status === 'proofread' ? 'Sent back to the proofreader, with your note.' : `Done: ${STATUS_WORD[to] || to}.`;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function saveHelpers(r: Row) {
  if (busy.value) return;
  busy.value = `help${r.id}`; error.value = ''; message.value = '';
  try { rows.value = (await huntCall<{ cells: Row[] }>('build.helpers', { id: r.id, names: helpersText.value })).cells; message.value = 'Helpers saved.'; }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function saveCounts(r: Row) {
  if (busy.value) return;
  busy.value = `set${r.id}`; error.value = '';
  try {
    rows.value = (await huntCall<{ cells: Row[] }>('build.set', { id: r.id, fields: { merges_each: r.merges_each, cuts_each: r.cuts_each, suggest_until: closeAt.value ? etNaiveToUtcIso(closeAt.value) : null } })).cells;
    message.value = closeAt.value ? `Saved. Suggestions close ${etLine(etNaiveToUtcIso(closeAt.value))}.` : 'Saved. Suggestions stay open until you close them.';
  }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
function goThrough(r: Row) { document.dispatchEvent(new CustomEvent('nge:build-queue', { detail: { id: r.id } })); }
async function look(r: Row) {
  error.value = '';
  try { await openBuildCell({ root: r.root, start: r.start }); document.dispatchEvent(new CustomEvent('nge:hunt-check')); }
  catch (e: any) { error.value = e?.message || String(e); }
}
async function doPutBack(r: Row) {
  if (busy.value) return;
  busy.value = `back${r.id}`; error.value = ''; message.value = '';
  try {
    const out: any = await putBack(r.id, r.anchor_sv ?? null, s => { message.value = s; });
    rows.value = out.cells || rows.value;
    message.value = out.left ? `${out.left} ${out.left === 1 ? 'planting' : 'plantings'} could not be undone (the graph refused). Check the cell, then try again.`
      : 'Put back: every planting is undone and the cell is as it was proofread.';
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
</script>

<template>
  <fieldset class="nge-hb-admin" :disabled="busy === 'load'">
    <legend>Hunt builder · Sandbox</legend>
    <p class="nge-hb-admin-help">Players help build a Hunt. Add cells that need full proofreading: each goes in the Cell Library marked <b>Hunt candidate</b>. When it is proofread, either build the Hunt from the proofreaders' own edits, or open suggestions to everyone with production access until a closing time: their merges and cuts are kept, never sent. Then plant the ones you like, finish planting, and make the Hunt. From planting (or building) on, players can't see the cell in Pyr until the Hunt starts.</p>
    <ol class="nge-hb-stages" aria-label="The stages, in order">
      <li v-for="(st, i) in STAGES" :key="st.key" class="nge-hb-stage" :class="{ 'nge-hb-stage--some': stageCount(st.key) }" tabindex="0" :aria-describedby="`nge-hb-tip-${st.key}`">
        <span class="nge-hb-stage-n">{{ i + 1 }}</span>
        <span class="nge-hb-stage-word">{{ st.word }}</span>
        <span v-if="stageCount(st.key)" class="nge-hb-stage-count">{{ stageCount(st.key) }}</span>
        <span :id="`nge-hb-tip-${st.key}`" class="nge-hb-stage-tip" role="tooltip"><b>{{ i + 1 }}. {{ st.word }}</b> {{ st.tip }}</span>
      </li>
    </ol>
    <p v-if="notInstalled" class="nge-hb-admin-warn">The Hunt Builder is not set up yet: run <code>supabase-hunt-build.sql</code> in Supabase.</p>
    <div class="nge-hb-admin-add">
      <input v-model="paste" class="nge-hb-admin-input" placeholder="Paste Sandbox cell IDs" aria-label="Sandbox cell IDs to add" @keydown.enter="add" />
      <button class="nge-hb-admin-btn nge-hb-admin-btn--primary" :disabled="!!busy || !paste.trim()" @click="add">{{ busy === 'add' ? 'Adding…' : 'Add candidates' }}</button>
    </div>
    <p v-if="error" class="nge-hb-admin-error" role="alert">{{ error }}</p>
    <p v-if="message" class="nge-hb-admin-msg" role="status">{{ message }}</p>
    <p v-if="busy === 'load'" class="nge-hb-admin-muted">Loading…</p>
    <p v-else-if="!rows.length && !notInstalled" class="nge-hb-admin-muted">No Hunt cells yet.</p>

    <ul class="nge-hb-admin-list">
      <li v-for="r in live" :key="r.id" class="nge-hb-admin-row" :class="{ 'nge-hb-admin-row--open': open === r.id }">
        <button class="nge-hb-admin-line" :aria-expanded="open === r.id" @click="toggle(r)">
          <span class="nge-hb-admin-id">…{{ r.root.slice(-6) }}</span>
          <span class="nge-hb-admin-chip" :class="[`nge-hb-admin-chip--${r.status}`, { 'nge-hb-admin-chip--closed': r.closed }]" :title="stageTip(r)">{{ statusWord(r) }}</span>
          <span class="nge-hb-admin-who">{{ r.status === 'proofreading' ? (r.task?.who ? `${r.task.who} is on it` : 'Waiting for a proofreader') : who(r) }}</span>
          <span class="nge-hb-admin-counts">{{ countsLine(r) }}</span>
        </button>
        <div v-if="open === r.id" class="nge-hb-admin-body">
          <p class="nge-hb-admin-muted">Cell <code>{{ r.root }}</code><template v-if="r.proofread_at"> · proofread {{ when(r.proofread_at) }} by {{ r.proofread_by || 'a player' }}</template><template v-if="r.hunt_id"> · Hunt #{{ r.hunt_id }}</template></p>
          <template v-if="['proofread', 'suggesting'].includes(r.status)">
            <label class="nge-hb-admin-field">Also invite (optional: everyone with production access can already suggest) <input v-model="helpersText" class="nge-hb-admin-input" placeholder="names of players without production access" aria-label="Also invite, by name" /></label>
            <div class="nge-hb-admin-actions">
              <button class="nge-hb-admin-btn" :disabled="!!busy" @click="saveHelpers(r)">{{ busy === `help${r.id}` ? 'Saving…' : 'Save helpers' }}</button>
              <label class="nge-hb-admin-num">Merges each <input v-model.number="r.merges_each" type="number" min="0" max="10" /></label>
              <label class="nge-hb-admin-num">Cuts each <input v-model.number="r.cuts_each" type="number" min="0" max="10" /></label>
              <label class="nge-hb-admin-num">Suggestions close (ET) <input v-model="closeAt" type="datetime-local" class="nge-hb-admin-when" aria-label="When suggestions close, Eastern time" /></label>
              <button class="nge-hb-admin-btn" :disabled="!!busy" @click="saveCounts(r)">Save</button>
            </div>
            <p v-if="r.status === 'suggesting'" class="nge-hb-admin-muted">{{ r.closed ? `Closed ${etLine(r.suggest_until)}: helpers can't add more. The cell stays locked; start planting when you are ready.` : r.suggest_until ? `Open until ${etLine(r.suggest_until)}.` : 'Open until you close them.' }}</p>
          </template>
          <label v-if="r.status === 'proofread'" class="nge-hb-admin-field">Note if you send it back <input v-model="sendBackNote" class="nge-hb-admin-input" maxlength="500" placeholder="The axon past the bend still needs work" /></label>
          <div class="nge-hb-admin-actions">
            <button v-if="r.status !== 'proofreading'" class="nge-hb-admin-btn" :disabled="!!busy" @click="look(r)">Look at it</button>
            <button v-if="['suggesting', 'planting', 'building', 'in_hunt'].includes(r.status)" class="nge-hb-admin-btn nge-hb-admin-btn--gold" :disabled="!!busy" @click="goThrough(r)">Go through the suggestions</button>
            <button v-if="r.status === 'building'" class="nge-hb-admin-btn nge-hb-admin-btn--primary" :disabled="!!busy" @click="emit('make', r.id)">Make the Hunt</button>
            <button v-if="r.status === 'in_hunt' || r.status === 'building' || r.status === 'planting'" class="nge-hb-admin-btn" :disabled="!!busy"
                    :title="r.status === 'in_hunt' ? 'After the Hunt ends: undo every planting, so the cell is as it was proofread' : 'Undo every planting now'" @click="doPutBack(r)">{{ busy === `back${r.id}` ? 'Putting back…' : 'Put it back' }}</button>
            <button v-for="to in r.moves" :key="to" class="nge-hb-admin-btn" :class="{ 'nge-hb-admin-btn--primary': to === 'suggesting' || to === 'planting' || to === 'building' }"
                    :disabled="!!busy" @click="move(r, to)">{{ busy === `move${r.id}` ? 'Saving…' : moveWord(r, to) }}</button>
          </div>
        </div>
      </li>
    </ul>
    <details v-if="past.length" class="nge-hb-admin-past">
      <summary>Put back and dropped ({{ past.length }})</summary>
      <ul class="nge-hb-admin-list">
        <li v-for="r in past" :key="r.id" class="nge-hb-admin-row">
          <span class="nge-hb-admin-line nge-hb-admin-line--static">
            <span class="nge-hb-admin-id">…{{ r.root.slice(-6) }}</span>
            <span class="nge-hb-admin-chip">{{ STATUS_WORD[r.status] }}</span>
            <span class="nge-hb-admin-who">{{ who(r) }}</span>
            <button v-if="r.status === 'dropped'" class="nge-hb-admin-btn nge-hb-admin-btn--small" :disabled="!!busy" @click="move(r, 'proofreading')">Bring back</button>
          </span>
        </li>
      </ul>
    </details>
  </fieldset>
</template>

<style scoped>
.nge-hb-admin { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px; padding: 10px 12px 12px; border-radius: 10px; border: 1px solid rgba(245, 209, 66, 0.35); min-width: 0; }
.nge-hb-admin legend { padding: 0 6px; font: 700 11px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #f5d142; }
.nge-hb-stages { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.nge-hb-stage { position: relative; display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 4px; border-radius: 999px; cursor: help;
  border: 1px solid rgba(90, 170, 255, 0.22); color: #8fa3bf; font: 600 11.5px 'Inter', sans-serif; outline: none; }
.nge-hb-stage:not(:last-child)::after { content: ''; position: absolute; right: -5px; top: 50%; width: 5px; height: 1px; background: rgba(90, 170, 255, 0.35); }
.nge-hb-stage--some { color: #e6f0ff; border-color: rgba(245, 209, 66, 0.5); background: rgba(245, 209, 66, 0.07); }
.nge-hb-stage-n { display: inline-grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; font-size: 10.5px; background: rgba(90, 170, 255, 0.16); color: #cfe4ff; }
.nge-hb-stage--some .nge-hb-stage-n { background: #f5d142; color: #1d1600; }
.nge-hb-stage-count { padding: 0 6px; border-radius: 999px; font-size: 10.5px; background: rgba(245, 209, 66, 0.2); color: #fff3c4; font-variant-numeric: tabular-nums; }
.nge-hb-stage-tip { position: absolute; left: 0; top: calc(100% + 6px); z-index: 5; width: 260px; padding: 8px 10px; border-radius: 8px; pointer-events: none;
  background: rgba(6, 11, 22, 0.98); border: 1px solid rgba(245, 209, 66, 0.45); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
  color: #cfdcef; font: 400 12px/1.45 'Inter', sans-serif; opacity: 0; visibility: hidden; transition: opacity 0.12s; }
.nge-hb-stage-tip b { color: #fff3c4; }
.nge-hb-stage:nth-child(n+5) .nge-hb-stage-tip { left: auto; right: 0; }
.nge-hb-stage:hover .nge-hb-stage-tip, .nge-hb-stage:focus-visible .nge-hb-stage-tip { opacity: 1; visibility: visible; }
.nge-hb-stage:focus-visible { border-color: #9fd0ff; }
@media (prefers-reduced-motion: reduce) { .nge-hb-stage-tip { transition: none; } }
.nge-hb-admin-help { margin: 0; color: #a9bbd3; font-size: 12.5px; line-height: 1.45; }
.nge-hb-admin-warn { margin: 0; color: #f8e08a; font-size: 12.5px; }
.nge-hb-admin-add, .nge-hb-admin-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.nge-hb-admin-input { flex: 1; min-width: 160px; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.3); color: #e6f0ff; font: 13px 'Inter', sans-serif; }
.nge-hb-admin-field { display: flex; flex-direction: column; gap: 3px; color: #8fa3bf; font-size: 11.5px; }
.nge-hb-admin-num { display: inline-flex; align-items: center; gap: 5px; color: #cfdcef; font-size: 12px; }
.nge-hb-admin-num input { width: 48px; padding: 4px 6px; border-radius: 6px; background: rgba(4, 8, 18, 0.8); border: 1px solid rgba(90, 170, 255, 0.3); color: #e6f0ff; font: 12px 'Inter', sans-serif; }
.nge-hb-admin-btn { padding: 5px 12px; border-radius: 7px; cursor: pointer; background: rgba(90, 170, 255, 0.1); border: 1px solid rgba(90, 170, 255, 0.4); color: #e6f0ff; font: 600 12.5px 'Inter', sans-serif; white-space: nowrap; }
.nge-hb-admin-btn:hover:not(:disabled) { background: rgba(90, 170, 255, 0.2); }
.nge-hb-admin-btn:disabled { opacity: 0.5; cursor: default; }
.nge-hb-admin-btn--primary { background: rgba(90, 170, 255, 0.22); border-color: #5aaaff; }
.nge-hb-admin-btn--gold { background: rgba(245, 209, 66, 0.16); border-color: rgba(245, 209, 66, 0.65); color: #fff3c4; }
.nge-hb-admin-btn--small { padding: 3px 9px; font-size: 12px; margin-left: auto; }
.nge-hb-admin-error { margin: 0; color: #ffb3b3; font-size: 12.5px; }
.nge-hb-admin-msg { margin: 0; color: #9ff0bf; font-size: 12.5px; }
.nge-hb-admin-muted { margin: 0; color: #8fa3bf; font-size: 12.5px; }
.nge-hb-admin-muted code, .nge-hb-admin-warn code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; }
.nge-hb-admin-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nge-hb-admin-row { border-top: 1px solid rgba(90, 170, 255, 0.15); }
.nge-hb-admin-row--open { background: rgba(90, 170, 255, 0.05); border-radius: 6px; }
.nge-hb-admin-line { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; padding: 7px 6px; text-align: left;
  background: none; border: none; color: #e6f0ff; font: 12.5px 'Inter', sans-serif; cursor: pointer; }
.nge-hb-admin-line--static { cursor: default; display: flex; }
.nge-hb-admin-id { font: 12px 'JetBrains Mono', ui-monospace, monospace; color: #cfdcef; }
.nge-hb-admin-chip { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #9fb7d9; border: 1px solid rgba(90, 170, 255, 0.3); white-space: nowrap; }
.nge-hb-admin-chip--proofreading { color: #9fd0ff; border-color: rgba(90, 170, 255, 0.5); }
.nge-hb-admin-chip--proofread { color: #7fe6f5; border-color: rgba(66, 213, 236, 0.5); }
.nge-hb-admin-chip--suggesting { color: #c8a4ff; border-color: rgba(155, 92, 255, 0.55); }
.nge-hb-admin-chip--planting { color: #f5d142; border-color: rgba(245, 209, 66, 0.55); }
.nge-hb-admin-chip--building { color: #5aaaff; border-color: rgba(90, 170, 255, 0.6); }
.nge-hb-admin-chip--closed { color: #ffe9a8; border-color: rgba(245, 209, 66, 0.45); }
.nge-hb-admin-when { width: auto !important; }
.nge-hb-admin-chip--in_hunt { color: #9ff0bf; border-color: rgba(72, 214, 130, 0.5); }
.nge-hb-admin-who { min-width: 0; color: #a9bbd3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-hb-admin-counts { color: #8fa3bf; font-size: 11.5px; white-space: nowrap; }
.nge-hb-admin-body { display: flex; flex-direction: column; gap: 8px; padding: 2px 6px 10px; }
.nge-hb-admin-past summary { cursor: pointer; color: #8fa3bf; font-size: 12px; }
</style>
