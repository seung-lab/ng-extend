<script setup lang="ts">
/**
 * AnnotationQuestsTab.vue
 * The Quests tab of the Cell Library (Ames 2026-10-12): annotating a cell as
 * a quest, apart from completing it. Retina first: find and mark every
 * cilium on a starburst amacrine cell. The lab's Cilia sheet is the record,
 * read and written only by the server (src/annotation_quests.ts). A player
 * takes a cell (their name goes on its row), opens its start view, marks the
 * cilia with annotation points, and submits: the sheet's own status choices,
 * split or merged, a note, and a share link of the view as it is.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { QUEST_TITLE, QUEST_LEAD, QUEST_GUIDE_URL, QUEST_VIDEO_URL, QUEST_STATUSES, QUEST_SPLIT_MERGED, QUEST_CLAIM_LIMIT, listQuests, claimQuest, releaseQuest, submitQuest, annotationCountInView, dressQuestLayers, layerSnapshot, nameKey, cellTypeForPlayers, type QuestRow } from '../annotation_quests';
import { openStartLink } from '../util/start_link';
import { mintShortStateLink } from '../util/state_link';
import { runPanelLap } from '../util/holo_trace';
import { QUEST_STATUS_GUIDE, openQuestExamples } from '../annotation_quest_examples';
import { currentSegLayer } from '../datasets';
import { Uint64 } from 'neuroglancer/util/uint64';
import { cellAtCrosshair } from '../util/crosshair_cell';
import { ancestorAmong } from '../widgets/pcg_service';

const backend = useProofreadingBackendStore();
const rows = ref<QuestRow[]>([]);
const loading = ref(false);
const error = ref('');
/** Segment ID of the row being written, or ''. */
const busy = ref('');
/** Segment ID whose submit form is open, or ''. */
const open = ref('');
const form = ref({ status: '', splitMerged: '', notes: '' });
const points = ref(0);
const message = ref('');
/** The name the sheet carries for this player, from the server. */
const you = ref('');
/** The row last clicked, opened or jumped to (Ames 2026-10-13: "I have no
 *  idea what cell I'm on"). */
const current = ref('');

const myKeys = computed(() => new Set([you.value, backend.userName, backend.username].map(nameKey).filter(Boolean)));
const isMine = (r: QuestRow) => !!r.annotator && myKeys.value.has(nameKey(r.annotator));
const isDone = (r: QuestRow) => !!r.status;
const mine = computed(() => rows.value.filter(r => isMine(r) && !isDone(r)));
/** When to use the status chosen, in the lab's words (its reference sheet). */
const statusHint = computed(() => QUEST_STATUS_GUIDE[form.value.status] || '');
/** At the limit of cells held at once: Claim waits for a Submit or a Release. */
const atLimit = computed(() => mine.value.length >= QUEST_CLAIM_LIMIT);
/** Cells this player has completed (Ames 2026-10-13: "a count of how many I
 *  have completed"), from the sheet rows that carry their name and a status. */
const mineDone = computed(() => rows.value.filter(r => isMine(r) && isDone(r)).length);
const available = computed(() => rows.value.filter(r => !r.annotator && !r.status));
const taken = computed(() => rows.value.filter(r => !!r.annotator && !isMine(r) && !isDone(r)));
const done = computed(() => rows.value.filter(isDone).sort((a, b) => Number(isMine(b)) - Number(isMine(a))));

async function load() {
  loading.value = true;
  error.value = '';
  try { const r = await listQuests(); rows.value = r.rows; if (r.you) you.value = r.you; }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { loading.value = false; }
}
onMounted(() => { if (backend.userId) void load(); });

/** "A5, OFF Starburst": the sheet's index and the cell's type, in the players' words. */
function label(r: QuestRow) {
  const kind = cellTypeForPlayers(r.cellType || r.cellClass);
  return kind ? `${r.index || r.segmentId}, ${kind}` : (r.index || r.segmentId);
}
/** The Instructions box with the lab's steps (Ames 2026-10-13). */
const showHelp = ref(false);
/** The first time a player opens the tab, the Instructions button is lit
 *  once, a few seconds in, so it is not missed (Ames 2026-10-13). Once per
 *  browser: it plays one time and never loops. */
const INTRO_KEY = 'nge-cilia-quest-intro-seen';
const infoEl = ref<HTMLElement | null>(null);
const nudging = ref(false);
function introSeen(): boolean { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return true; } }
function markIntroSeen() { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* a private window */ } }
function toggleHelp() {
  showHelp.value = !showHelp.value;
  nudging.value = false;
  markIntroSeen();
}
let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
let nudgeOffTimer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  if (introSeen()) return;
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    const el = infoEl.value;
    if (!el || showHelp.value) return;
    markIntroSeen();
    nudging.value = true;
    try { runPanelLap(el, 900); } catch { /* the light is decoration */ }
    nudgeOffTimer = setTimeout(() => { nudging.value = false; nudgeOffTimer = null; }, 2600);
  }, 3000);
});
onUnmounted(() => {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  if (nudgeOffTimer) clearTimeout(nudgeOffTimer);
});
function openCell(r: QuestRow) {
  current.value = r.segmentId;
  const before = layerSnapshot();
  if (!openStartLink(r.startLink)) { error.value = 'This cell has no start link in the sheet.'; return; }
  // Once the link's own layers are in: the game's colours, plus the centerline layer.
  void dressQuestLayers(before);
}
/** Show only this cell and go to its soma (Ames 2026-10-13: "hide other
 *  segIDs in view and show only that one"). The layers stay as they are;
 *  every other segment in the view is hidden, whatever the jump preference. */
function showOnly(r: QuestRow) {
  error.value = '';
  current.value = r.segmentId;
  try {
    const viewer: any = (window as any)['viewer'];
    const groupState = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value;
    if (!viewer || !groupState?.visibleSegments) { error.value = 'No segmentation layer is open.'; return; }
    const seg = Uint64.parseString(r.segmentId);
    groupState.visibleSegments.clear();
    groupState.visibleSegments.add(seg);
    const xyz = (r.soma.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (xyz.length === 3) viewer.navigationState.position.value = Float32Array.from(xyz);
  } catch (e: any) { error.value = `Could not show this cell: ${e?.message || e}`; }
}
function viewDone(r: QuestRow) {
  current.value = r.segmentId;
  if (!openStartLink(r.link) && !openStartLink(r.startLink)) error.value = 'This cell has no link to open.';
}
async function take(r: QuestRow) {
  busy.value = r.segmentId; error.value = ''; message.value = '';
  current.value = r.segmentId;
  try {
    await claimQuest(r.segmentId);
    message.value = `${r.index || 'The cell'} is yours. Mark what you find in its layers, then press Submit.`;
    openCell(r);
    await load();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function letGo(r: QuestRow) {
  busy.value = r.segmentId; error.value = ''; message.value = '';
  try {
    await releaseQuest(r.segmentId);
    if (open.value === r.segmentId) open.value = '';
    message.value = `${r.index || 'The cell'} is open for someone else.`;
    await load();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
/** The crosshairs must sit inside this cell, as Complete asks (Ames
 *  2026-10-13), so the share link opens on it. The sheet's ID may be older
 *  than the cell: an edited cell's current root is accepted when the sheet's
 *  ID is in its history. */
const check = ref<{ busy: boolean; ok: boolean; message: string }>({ busy: false, ok: false, message: '' });
async function runCheck(r: QuestRow) {
  check.value = { busy: true, ok: false, message: 'Checking the crosshairs…' };
  try {
    const at = await cellAtCrosshair();
    if (!at.root) { check.value = { busy: false, ok: false, message: at.problem || 'Could not check the crosshairs.' }; return; }
    if (at.root === r.segmentId) { check.value = { busy: false, ok: true, message: 'The crosshairs are inside this cell.' }; return; }
    const hit = await ancestorAmong(at.root, [r.segmentId]);
    if (hit) { check.value = { busy: false, ok: true, message: `The crosshairs are inside this cell. It has been edited since the sheet was made, so its ID is now ${at.root.slice(-6)}.` }; return; }
    check.value = { busy: false, ok: false, message: `The crosshairs are inside ${at.root.slice(-6)}, which is not this cell. Move them into the cell and check again.` };
  } catch (e: any) { check.value = { busy: false, ok: false, message: `Could not check the crosshairs: ${e?.message || e}` }; }
}
function startSubmit(r: QuestRow) {
  open.value = r.segmentId;
  form.value = { status: r.status || '', splitMerged: r.splitMerged || '', notes: r.notes || '' };
  points.value = annotationCountInView();
  void runCheck(r);
}
function recount(r: QuestRow) { points.value = annotationCountInView(); void runCheck(r); }
async function send(r: QuestRow, e?: Event) {
  if (!form.value.status || busy.value) return;
  // Where the confetti starts: the Complete button itself (Ames 2026-10-13).
  let origin: { x: number; y: number } | undefined;
  try { const b = (e?.currentTarget as HTMLElement | null)?.getBoundingClientRect(); if (b) origin = { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } catch { /* no button */ }
  busy.value = r.segmentId; error.value = ''; message.value = '';
  // The confetti goes on the click itself (Ames 2026-10-13: it took too long
  // to appear); the card with the counts follows once the sheet has it.
  document.dispatchEvent(new CustomEvent('nge:quest-confetti', { detail: { origin } }));
  try {
    // The crosshairs may have moved since the check: check once more.
    await runCheck(r);
    if (!check.value.ok) throw new Error(check.value.message);
    // The share link is the view as it is now, with the annotation layers.
    const link = await mintShortStateLink();
    if (!link) throw new Error('A share link of this view could not be made. Sign in and try again.');
    const placed = points.value;
    await submitQuest(r.segmentId, { status: form.value.status, splitMerged: form.value.splitMerged, link, notes: form.value.notes });
    open.value = '';
    message.value = `${r.index || 'The cell'} is submitted. Thank you.`;
    await load();
    // The celebration: a toast with the counts, and confetti (AchievementToast.vue).
    document.dispatchEvent(new CustomEvent('nge:quest-complete', { detail: { index: r.index, points: placed, done: mineDone.value, origin } }));
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
const pointsLine = computed(() => `${points.value === 1 ? '1 annotation point' : points.value + ' annotation points'} in this view.`);
const noPoints = computed(() => points.value === 0 && form.value.status.startsWith('Cilium annotated'));
</script>

<template>
  <div class="nge-aq">
    <div class="nge-aq-head">
      <div class="nge-aq-titlerow">
        <div class="nge-aq-title">{{ QUEST_TITLE }}</div>
        <button ref="infoEl" class="nge-aq-info" :class="{ 'nge-aq-info--open': showHelp, 'nge-aq-info--nudge': nudging }" @click="toggleHelp" title="How to do a Cilia Quest">
          <span class="nge-aq-info-i" aria-hidden="true">i</span><span class="nge-aq-info-word">Instructions</span>
        </button>
      </div>
      <div class="nge-aq-lead">{{ QUEST_LEAD }}</div>
      <div v-if="showHelp" class="nge-aq-help">
        <div class="nge-aq-help-head">
          <span>How to do a Cilia Quest</span>
          <button class="nge-aq-help-close" @click="showHelp = false" title="Close">×</button>
        </div>
        <!-- The lab's own steps (Celia, 2026-10-13). The sentence on the
             centerline's keys is ours: the polyline tool is new here. -->
        <ol class="nge-aq-help-steps">
          <li><b>Claim</b> a cell. Its view opens with three annotation layers: <b>Basal body, Daughter centriole, and Cilium centerline.</b></li>
          <li>Use <a :href="QUEST_GUIDE_URL" target="_blank" rel="noopener">this guide</a> to learn how to locate and annotate cilia.<template v-if="QUEST_VIDEO_URL"> Check out this <a :href="QUEST_VIDEO_URL" target="_blank" rel="noopener">training video</a> as well!</template></li>
          <li>Find the cilium, an appendage that projects from the cell's soma. Annotate its centerline, basal body, and daughter centriole in each of their respective layers. For the centerline, hold <b>Ctrl</b> and click along the cilium, then press <b>Enter</b>.</li>
          <li>Some cells will not have a visible cilium. You may still be able to find their internal basal body and daughter centriole. <a href="#" title="Opens three real example cells, annotated by the lab, in a new tab" @click.prevent="openQuestExamples()">Here's a reference</a> for a variety of cilia states you may encounter.</li>
          <li>Press <b>Submit</b>, and choose a cilium status from the list. The lab will receive your view as a share link.</li>
          <li>You can hold three cells at a time. <b>Release</b> will send your cell back to the queue.</li>
        </ol>
      </div>
      <div v-if="backend.userId" class="nge-aq-headrow">
        <button class="nge-aq-btn nge-aq-refresh" :disabled="loading" @click="load" title="Read the quest sheet again">{{ loading ? 'Reading…' : 'Refresh' }}</button>
        <span v-if="rows.length" class="nge-aq-tally" title="Cells you have submitted on this quest">Submitted by you: <b>{{ mineDone }}</b></span>
        <span v-if="rows.length" class="nge-aq-tally" :class="{ 'nge-aq-tally--full': atLimit }" :title="`You can hold ${QUEST_CLAIM_LIMIT} cells at a time`">Holding <b>{{ mine.length }}</b> of {{ QUEST_CLAIM_LIMIT }}</span>
      </div>
    </div>

    <div v-if="!backend.userId" class="nge-aq-empty">Sign in to take a quest.</div>
    <template v-else>
      <div v-if="error" class="nge-aq-error">{{ error }}</div>
      <div v-if="loading && !rows.length" class="nge-aq-empty">Reading the quest sheet…</div>
      <template v-else-if="rows.length">
        <!-- Yours: taken, not yet submitted -->
        <template v-if="mine.length">
          <div class="nge-aq-section">Yours</div>
          <template v-for="r in mine" :key="r.segmentId">
            <div class="nge-aq-row nge-aq-row--mine" :class="{ 'nge-aq-row--current': current === r.segmentId }">
              <div class="nge-aq-row-left">
                <span class="nge-aq-pip nge-aq-pip--claimed"></span>
                <div class="nge-aq-row-info">
                  <div class="nge-aq-row-name">{{ label(r) }}</div>
                  <div class="nge-aq-row-meta">Yours to annotate</div>
                </div>
              </div>
              <div class="nge-aq-row-actions">
                <button class="nge-aq-btn nge-aq-btn--jump" @click="showOnly(r)" title="Show only this cell and go to its soma">↗</button>
                <button class="nge-aq-btn" @click="openCell(r)" title="Open this cell's start view, with its layers">Open</button>
                <button class="nge-aq-btn nge-aq-btn--submit" :class="{ 'nge-aq-btn--submit-open': open === r.segmentId }" @click="open === r.segmentId ? (open = '') : startSubmit(r)" title="Submit this quest: your answer and a share link of this view go to the sheet">Submit</button>
                <button class="nge-aq-btn nge-aq-btn--release" :disabled="busy === r.segmentId" @click="letGo(r)" title="Take your name off this cell">Release</button>
              </div>
            </div>
            <div v-if="open === r.segmentId" class="nge-aq-form">
              <div class="nge-aq-form-title">Submit {{ r.index || label(r) }}</div>
              <div class="nge-aq-form-label">Cilium status</div>
              <select v-model="form.status" class="nge-aq-select" @keydown.stop @keyup.stop @keypress.stop>
                <option value="" disabled>Choose one</option>
                <option v-for="s in QUEST_STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
              <div v-if="statusHint" class="nge-aq-status-hint">{{ statusHint }}</div>
              <div class="nge-aq-form-label">Cilium split or merged?</div>
              <div class="nge-aq-pills">
                <button v-for="s in QUEST_SPLIT_MERGED" :key="s" class="nge-aq-pill" :class="{ 'nge-aq-pill--on': form.splitMerged === s }" @click="form.splitMerged = form.splitMerged === s ? '' : s">{{ s }}</button>
              </div>
              <div class="nge-aq-form-label">Notes</div>
              <textarea v-model="form.notes" class="nge-aq-notes" rows="2" placeholder="Anything the reviewers should know" @keydown.stop @keyup.stop @keypress.stop></textarea>
              <div class="nge-aq-form-msg" :class="{ 'nge-aq-form-msg--bad': !check.ok && !check.busy, 'nge-aq-form-msg--ok': check.ok }">
                <span>{{ check.message }}</span>
                <button class="nge-aq-recheck" :disabled="check.busy" @click="recount(r)" title="Check the crosshairs and count the annotation points again">Check again</button>
              </div>
              <div class="nge-aq-form-msg" :class="{ 'nge-aq-form-msg--bad': noPoints }">
                <span>{{ pointsLine }} The share link is made from the view as it is now.</span>
              </div>
              <div class="nge-aq-form-actions">
                <button class="nge-aq-btn" @click="open = ''">Not now</button>
                <button class="nge-aq-btn nge-aq-btn--send" :disabled="!form.status || !check.ok || busy === r.segmentId" @click="send(r, $event)">{{ busy === r.segmentId ? 'Submitting…' : 'Submit' }}</button>
              </div>
            </div>
          </template>
        </template>

        <!-- Open: nobody's yet -->
        <div class="nge-aq-section">Open <span class="nge-aq-count">{{ available.length }}</span></div>
        <div v-if="!available.length" class="nge-aq-empty nge-aq-empty--tight">Every cell is taken or done.</div>
        <div v-for="r in available" :key="r.segmentId" class="nge-aq-row" :class="{ 'nge-aq-row--current': current === r.segmentId }">
          <div class="nge-aq-row-left">
            <span class="nge-aq-pip nge-aq-pip--available"></span>
            <div class="nge-aq-row-info">
              <div class="nge-aq-row-name">{{ label(r) }}</div>
              <div class="nge-aq-row-meta">{{ r.soma ? 'Soma at ' + r.soma : 'Open' }}</div>
            </div>
          </div>
          <div class="nge-aq-row-actions">
            <button class="nge-aq-btn nge-aq-btn--jump" @click="showOnly(r)" title="Show only this cell and go to its soma">↗</button>
            <button class="nge-aq-btn nge-aq-btn--take" :disabled="busy === r.segmentId || !!busy || atLimit" @click="take(r)"
                    :title="atLimit ? `You hold ${QUEST_CLAIM_LIMIT} quests already. Submit or release one first.` : 'Put your name on this cell and open its start view'">{{ busy === r.segmentId ? 'Claiming…' : 'Claim' }}</button>
          </div>
        </div>

        <!-- Taken by others -->
        <template v-if="taken.length">
          <div class="nge-aq-section">Taken</div>
          <div v-for="r in taken" :key="r.segmentId" class="nge-aq-row nge-aq-row--dim" :class="{ 'nge-aq-row--current': current === r.segmentId }">
            <div class="nge-aq-row-left">
              <span class="nge-aq-pip nge-aq-pip--claimed"></span>
              <div class="nge-aq-row-info">
                <div class="nge-aq-row-name">{{ label(r) }}</div>
                <div class="nge-aq-row-meta">{{ r.annotator }}</div>
              </div>
            </div>
            <div class="nge-aq-row-actions">
              <button class="nge-aq-btn nge-aq-btn--jump" @click="showOnly(r)" title="Show only this cell and go to its soma">↗</button>
            </div>
          </div>
        </template>

        <!-- Submitted -->
        <template v-if="done.length">
          <div class="nge-aq-section">Submitted <span class="nge-aq-count">{{ done.length }}</span></div>
          <template v-for="r in done" :key="r.segmentId">
            <div class="nge-aq-row nge-aq-row--done" :class="{ 'nge-aq-row--mine': isMine(r), 'nge-aq-row--current': current === r.segmentId }">
              <div class="nge-aq-row-left">
                <span class="nge-aq-pip nge-aq-pip--done"></span>
                <div class="nge-aq-row-info">
                  <div class="nge-aq-row-name">{{ label(r) }}</div>
                  <div class="nge-aq-row-meta">{{ r.status }}{{ r.annotator ? ', ' + (isMine(r) ? 'you' : r.annotator) : '' }}{{ r.date ? ', ' + r.date : '' }}</div>
                </div>
              </div>
              <div class="nge-aq-row-actions">
                <button class="nge-aq-btn nge-aq-btn--jump" @click="showOnly(r)" title="Show only this cell and go to its soma">↗</button>
                <button class="nge-aq-btn" @click="viewDone(r)" title="Open the submitted view">View</button>
                <button v-if="isMine(r)" class="nge-aq-btn nge-aq-btn--submit" :class="{ 'nge-aq-btn--submit-open': open === r.segmentId }" @click="open === r.segmentId ? (open = '') : startSubmit(r)" title="Submit this cell again with a new answer">Again</button>
              </div>
            </div>
            <div v-if="open === r.segmentId" class="nge-aq-form">
              <div class="nge-aq-form-title">Submit {{ r.index || label(r) }} again</div>
              <div class="nge-aq-form-label">Cilium status</div>
              <select v-model="form.status" class="nge-aq-select" @keydown.stop @keyup.stop @keypress.stop>
                <option value="" disabled>Choose one</option>
                <option v-for="s in QUEST_STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
              <div v-if="statusHint" class="nge-aq-status-hint">{{ statusHint }}</div>
              <div class="nge-aq-form-label">Cilium split or merged?</div>
              <div class="nge-aq-pills">
                <button v-for="s in QUEST_SPLIT_MERGED" :key="s" class="nge-aq-pill" :class="{ 'nge-aq-pill--on': form.splitMerged === s }" @click="form.splitMerged = form.splitMerged === s ? '' : s">{{ s }}</button>
              </div>
              <div class="nge-aq-form-label">Notes</div>
              <textarea v-model="form.notes" class="nge-aq-notes" rows="2" placeholder="Anything the reviewers should know" @keydown.stop @keyup.stop @keypress.stop></textarea>
              <div class="nge-aq-form-msg" :class="{ 'nge-aq-form-msg--bad': !check.ok && !check.busy, 'nge-aq-form-msg--ok': check.ok }">
                <span>{{ check.message }}</span>
                <button class="nge-aq-recheck" :disabled="check.busy" @click="recount(r)" title="Check the crosshairs and count the annotation points again">Check again</button>
              </div>
              <div class="nge-aq-form-msg" :class="{ 'nge-aq-form-msg--bad': noPoints }">
                <span>{{ pointsLine }} The share link is made from the view as it is now.</span>
              </div>
              <div class="nge-aq-form-actions">
                <button class="nge-aq-btn" @click="open = ''">Not now</button>
                <button class="nge-aq-btn nge-aq-btn--send" :disabled="!form.status || !check.ok || busy === r.segmentId" @click="send(r, $event)">{{ busy === r.segmentId ? 'Submitting…' : 'Submit' }}</button>
              </div>
            </div>
          </template>
        </template>
      </template>
      <div v-else-if="!loading && !error" class="nge-aq-empty">The quest sheet has no cells yet.</div>
      <div v-if="message" class="nge-aq-msg">{{ message }}</div>
    </template>
  </div>
</template>

<style scoped>
/* The Cell Library's own rows, pips and buttons, with their values, so the
   Quests tab reads as part of the same panel. */
.nge-aq { display: flex; flex-direction: column; }
.nge-aq-head { padding: 10px 12px 8px; border-bottom: 1px solid rgba(120, 140, 255, 0.08); display: flex; flex-direction: column; gap: 5px; }
/* Sizes are in px (Ames 2026-10-13: "font is so tiny"): the panel's em
   chain made them smaller than they looked in the stylesheet. */
.nge-aq-title { font-family: 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; font-size: 14px; font-weight: 700; color: #eef; }
.nge-aq-lead { font-size: 14px; line-height: 1.5; color: #b3c0d3; }
.nge-aq-headrow { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
.nge-aq-refresh { align-self: flex-start; }
.nge-aq-tally { font-size: 13px; color: #a9b8cc; }
.nge-aq-tally b { color: #a6ffd6; font-weight: 700; }
.nge-aq-tally--full b { color: #ffd24d; }
/* The (i) and its box, drawn as the Cell Library's own instructions box. */
/* the name on the left, Instructions at the right edge (Ames 2026-10-13: "move Instructions to the right") */
.nge-aq-titlerow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nge-aq-info {
  position: relative;
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 10px 0 4px; border-radius: 999px;
  font: 600 12.5px/1 'Inter', sans-serif; letter-spacing: 0.02em; color: #9fd8ff;
  background: rgba(126, 202, 255, 0.08); border: 1px solid rgba(126, 202, 255, 0.45);
  cursor: pointer; transition: background 0.15s, color 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.nge-aq-info-i {
  width: 16px; height: 16px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font: 700 11px/1 'Inter', sans-serif; color: #06111f; background: #7ecaff;
}
.nge-aq-info:hover, .nge-aq-info--open { color: #eaf6ff; background: rgba(126, 202, 255, 0.2); border-color: #7ecaff; box-shadow: 0 0 10px rgba(126, 202, 255, 0.4); }
/* The one time nudge: lit, with a glow that swells and settles once. */
.nge-aq-info--nudge { color: #eaf6ff; border-color: #7ecaff; background: rgba(126, 202, 255, 0.22); animation: nge-aq-info-nudge 2.4s ease-out 1 both; }
@keyframes nge-aq-info-nudge {
  0%   { box-shadow: 0 0 0 0 rgba(126, 202, 255, 0.0); transform: scale(1); }
  18%  { box-shadow: 0 0 0 5px rgba(126, 202, 255, 0.35), 0 0 22px rgba(126, 202, 255, 0.7); transform: scale(1.08); }
  45%  { box-shadow: 0 0 0 2px rgba(126, 202, 255, 0.2), 0 0 14px rgba(126, 202, 255, 0.5); transform: scale(1); }
  100% { box-shadow: 0 0 10px rgba(126, 202, 255, 0.4); transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) { .nge-aq-info--nudge { animation: none; box-shadow: 0 0 0 2px rgba(126, 202, 255, 0.5); } }
.nge-aq-help {
  margin: 4px 0 2px;
  padding: 10px 12px 8px;
  border-radius: 10px;
  background: rgba(66, 213, 236, 0.06);
  border: 1px solid rgba(66, 213, 236, 0.28);
  animation: nge-aq-help-in 0.2s ease-out both;
}
@keyframes nge-aq-help-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .nge-aq-help { animation: none; } }
.nge-aq-help-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: #7ee8ff; margin-bottom: 6px;
}
.nge-aq-help-close { background: none; border: none; color: #8aa; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-aq-help-close:hover { color: #fff; }
.nge-aq-help-steps { margin: 0; padding-left: 20px; font-size: 13.5px; line-height: 1.5; color: #cfdcef; }
.nge-aq-help-steps li { margin: 4px 0; padding-left: 2px; }
.nge-aq-help-steps li::marker { color: #42d5ec; font-weight: 700; }
.nge-aq-help-steps b { color: #fff; font-weight: 600; }
.nge-aq-help-steps a { color: #7ecaff; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.nge-aq-help-steps a:hover { color: #fff; }
.nge-aq-section {
  padding: 10px 12px 4px;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(100, 200, 255, 0.8);
  display: flex; align-items: center; gap: 6px;
}
.nge-aq-count { font-family: 'Inter', sans-serif; font-size: 13px; letter-spacing: 0; color: #8bf; }
.nge-aq-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(120, 140, 255, 0.04);
  transition: background 0.1s;
}
.nge-aq-row:hover { background: rgba(74, 158, 255, 0.04); }
.nge-aq-row--mine { background: rgba(74, 158, 255, 0.06); }
.nge-aq-row--done { opacity: 0.8; }
/* The row last clicked, opened or jumped to, marked as the Cell Library marks
   the cell you last jumped to. */
.nge-aq-row--current { background: rgba(0, 220, 160, 0.10); box-shadow: inset 3px 0 0 rgba(0, 230, 160, 0.9); }
.nge-aq-row--current:hover { background: rgba(0, 220, 160, 0.14); }
.nge-aq-row--dim { opacity: 0.65; }
.nge-aq-row-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.nge-aq-pip { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #556; }
.nge-aq-pip--available { background: #4a6; }
.nge-aq-pip--claimed { background: #fa4; }
.nge-aq-pip--done { background: #4af; }
.nge-aq-row-info { min-width: 0; flex: 1; }
.nge-aq-row-name { font-size: 15px; font-weight: 600; color: #e4e8f2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-aq-row-meta { font-size: 13px; color: #93a0b6; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-aq-row-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: 8px; }
.nge-aq-btn {
  padding: 5px 11px;
  border: 1px solid rgba(120, 140, 255, 0.15);
  border-radius: 5px;
  background: transparent;
  color: #8bf;
  font-size: 13px; font-weight: 600; font-family: inherit;
  cursor: pointer; white-space: nowrap;
  transition: all 0.12s;
}
.nge-aq-btn:hover { background: rgba(74, 158, 255, 0.1); }
.nge-aq-btn:disabled { opacity: 0.45; cursor: default; }
.nge-aq-btn--jump { font-size: 13px; padding: 4px 8px; color: #889; }
.nge-aq-btn--jump:hover { color: #bbf; }
.nge-aq-btn--take { border-color: rgba(68, 170, 102, 0.25); color: #4a6; }
.nge-aq-btn--take:hover:not(:disabled) { background: rgba(68, 170, 102, 0.12); }
.nge-aq-btn--submit { border-color: rgba(68, 170, 255, 0.25); color: #4af; }
.nge-aq-btn--submit:hover { background: rgba(68, 170, 255, 0.12); }
.nge-aq-btn--submit-open { background: rgba(68, 170, 255, 0.16); border-color: rgba(68, 170, 255, 0.55); }
.nge-aq-btn--release { border-color: rgba(255, 170, 68, 0.2); color: #a86; }
.nge-aq-btn--release:hover:not(:disabled) { background: rgba(255, 170, 68, 0.08); }
.nge-aq-btn--send { border-color: rgba(68, 170, 255, 0.55); color: #fff; background: rgba(68, 170, 255, 0.2); }
.nge-aq-btn--send:hover:not(:disabled) { background: rgba(68, 170, 255, 0.3); }
/* The submit form, as the Complete form is drawn. */
.nge-aq-form {
  margin: 2px 6px 8px;
  padding: 10px 12px;
  border: 1px solid rgba(68, 170, 255, 0.3);
  border-radius: 8px;
  background: rgba(10, 24, 44, 0.85);
  display: flex; flex-direction: column; gap: 6px;
}
.nge-aq-form-title { color: #8cf; font-weight: 600; font-size: 15px; letter-spacing: 0.03em; }
.nge-aq-form-label { color: #9ab; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
/* The status dropdown, drawn as the Cell Library draws its own: dark popup
   (color-scheme), the OS arrow replaced by a chevron. */
.nge-aq-select {
  width: 100%; box-sizing: border-box;
  padding: 7px 28px 7px 10px;
  border: 1px solid rgba(120, 140, 255, 0.2); border-radius: 6px;
  background: rgba(10, 10, 30, 0.5); color: #dde;
  font-size: 14px; font-family: inherit;
  color-scheme: dark; appearance: none; -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' fill='none' stroke='%238fa6c8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 8px center; background-size: 12px;
  cursor: pointer;
}
.nge-aq-select option { background: #0c1020; color: #cfdcef; }
/* when to use the status chosen, in the lab's words */
.nge-aq-status-hint { font-size: 13px; line-height: 1.45; color: #a9c4dd; padding: 2px 2px 0; }
.nge-aq-select:hover { border-color: rgba(74, 158, 255, 0.35); }
.nge-aq-select:focus { outline: none; border-color: rgba(68, 170, 255, 0.5); }
.nge-aq-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-aq-pill {
  padding: 5px 12px; border-radius: 999px; cursor: pointer;
  font: 500 13.5px Inter, system-ui, sans-serif; color: #b9c8e0;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.14);
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  text-align: left;
}
.nge-aq-pill:hover { background: rgba(68, 170, 255, 0.1); border-color: rgba(68, 170, 255, 0.4); }
.nge-aq-pill--on { color: #fff; background: rgba(68, 170, 255, 0.2); border-color: #4af; box-shadow: 0 0 10px rgba(68, 170, 255, 0.3); }
.nge-aq-notes {
  resize: vertical; min-height: 2.6em; width: 100%; box-sizing: border-box;
  font-family: inherit; font-size: 14px; color: #dde;
  padding: 6px 8px; border-radius: 6px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(120, 140, 255, 0.2);
}
.nge-aq-notes:focus { outline: none; border-color: rgba(68, 170, 255, 0.5); }
.nge-aq-form-msg { font-size: 14px; line-height: 1.4; color: #bcd; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nge-aq-form-msg--bad { color: #f98; }
.nge-aq-form-msg--ok { color: #6d9; }
.nge-aq-recheck {
  margin-left: auto; background: none;
  border: 1px solid rgba(160, 190, 220, 0.3); border-radius: 4px;
  color: #bcd; font-size: 13px; padding: 2px 9px; cursor: pointer;
}
.nge-aq-recheck:hover:not(:disabled) { border-color: rgba(160, 190, 220, 0.6); }
.nge-aq-recheck:disabled { opacity: 0.5; cursor: default; }
.nge-aq-form-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px; }
.nge-aq-empty { padding: 24px 16px; text-align: center; color: #93a0b6; font-size: 14px; }
.nge-aq-empty--tight { padding: 8px 16px 10px; }
.nge-aq-error { margin: 8px 12px 0; padding: 8px 10px; border-radius: 6px; font-size: 14px; line-height: 1.4; color: #ffb0b0; background: rgba(255, 80, 80, 0.08); border: 1px solid rgba(255, 90, 90, 0.25); }
.nge-aq-msg { margin: 8px 12px; padding: 8px 10px; border-radius: 6px; font-size: 14px; line-height: 1.4; color: #a6ffd6; background: rgba(0, 220, 120, 0.08); border: 1px solid rgba(0, 220, 120, 0.25); }
</style>
