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
import { computed, onMounted, ref } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { QUEST_TITLE, QUEST_STATUSES, QUEST_SPLIT_MERGED, listQuests, claimQuest, releaseQuest, submitQuest, annotationCountInView, nameKey, type QuestRow } from '../annotation_quests';
import { openStartLink } from '../util/start_link';
import { mintShortStateLink } from '../util/state_link';
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

const myKeys = computed(() => new Set([backend.userName, backend.username].map(nameKey).filter(Boolean)));
const isMine = (r: QuestRow) => !!r.annotator && myKeys.value.has(nameKey(r.annotator));
const isDone = (r: QuestRow) => !!r.status;
const mine = computed(() => rows.value.filter(r => isMine(r) && !isDone(r)));
/** Cells this player has submitted (Ames 2026-10-13: "a count of how many I
 *  have completed"), from the sheet rows that carry their name and a status. */
const mineDone = computed(() => rows.value.filter(r => isMine(r) && isDone(r)).length);
const available = computed(() => rows.value.filter(r => !r.annotator && !r.status));
const taken = computed(() => rows.value.filter(r => !!r.annotator && !isMine(r) && !isDone(r)));
const done = computed(() => rows.value.filter(isDone).sort((a, b) => Number(isMine(b)) - Number(isMine(a))));

async function load() {
  loading.value = true;
  error.value = '';
  try { rows.value = await listQuests(); }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { loading.value = false; }
}
onMounted(() => { if (backend.userId) void load(); });

/** "A5, OFF SAC": the sheet's index and the cell's type. */
function label(r: QuestRow) {
  const kind = r.cellType || r.cellClass;
  return kind ? `${r.index || r.segmentId}, ${kind}` : (r.index || r.segmentId);
}
function openCell(r: QuestRow) {
  if (!openStartLink(r.startLink)) error.value = 'This cell has no start link in the sheet.';
}
/** Show only this cell and go to its soma (Ames 2026-10-13: "hide other
 *  segIDs in view and show only that one"). The layers stay as they are;
 *  every other segment in the view is hidden, whatever the jump preference. */
function showOnly(r: QuestRow) {
  error.value = '';
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
  if (!openStartLink(r.link) && !openStartLink(r.startLink)) error.value = 'This cell has no link to open.';
}
async function take(r: QuestRow) {
  busy.value = r.segmentId; error.value = ''; message.value = '';
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
async function send(r: QuestRow) {
  if (!form.value.status || busy.value) return;
  busy.value = r.segmentId; error.value = ''; message.value = '';
  try {
    // The crosshairs may have moved since the check: check once more.
    await runCheck(r);
    if (!check.value.ok) throw new Error(check.value.message);
    // The share link is the view as it is now, with the annotation layers.
    const link = await mintShortStateLink();
    if (!link) throw new Error('A share link of this view could not be made. Sign in and try again.');
    await submitQuest(r.segmentId, { status: form.value.status, splitMerged: form.value.splitMerged, link, notes: form.value.notes });
    open.value = '';
    message.value = `${r.index || 'The cell'} is submitted. Thank you.`;
    await load();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
const pointsLine = computed(() => `${points.value === 1 ? '1 annotation point' : points.value + ' annotation points'} in this view.`);
const noPoints = computed(() => points.value === 0 && form.value.status.startsWith('Cilium annotated'));
</script>

<template>
  <div class="nge-aq">
    <div class="nge-aq-head">
      <div class="nge-aq-title">{{ QUEST_TITLE }}</div>
      <div class="nge-aq-lead">Claim a cell and its view opens with the lab's annotation layers, one for each part of a cilium. Put a point in each layer for what you find, then submit. The cell does not need to be complete.</div>
      <div v-if="backend.userId" class="nge-aq-headrow">
        <button class="nge-aq-btn nge-aq-refresh" :disabled="loading" @click="load" title="Read the quest sheet again">{{ loading ? 'Reading…' : 'Refresh' }}</button>
        <span v-if="rows.length" class="nge-aq-tally" title="Cells you have submitted on this quest">Submitted by you: <b>{{ mineDone }}</b></span>
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
            <div class="nge-aq-row nge-aq-row--mine">
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
                <button class="nge-aq-btn nge-aq-btn--submit" :class="{ 'nge-aq-btn--submit-open': open === r.segmentId }" @click="open === r.segmentId ? (open = '') : startSubmit(r)" title="Send your answer and a share link of this view to the sheet">Submit</button>
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
                <button class="nge-aq-btn nge-aq-btn--send" :disabled="!form.status || !check.ok || busy === r.segmentId" @click="send(r)">{{ busy === r.segmentId ? 'Sending…' : 'Submit to the sheet' }}</button>
              </div>
            </div>
          </template>
        </template>

        <!-- Open: nobody's yet -->
        <div class="nge-aq-section">Open <span class="nge-aq-count">{{ available.length }}</span></div>
        <div v-if="!available.length" class="nge-aq-empty nge-aq-empty--tight">Every cell is taken or done.</div>
        <div v-for="r in available" :key="r.segmentId" class="nge-aq-row">
          <div class="nge-aq-row-left">
            <span class="nge-aq-pip nge-aq-pip--available"></span>
            <div class="nge-aq-row-info">
              <div class="nge-aq-row-name">{{ label(r) }}</div>
              <div class="nge-aq-row-meta">{{ r.soma ? 'Soma at ' + r.soma : 'Open' }}</div>
            </div>
          </div>
          <div class="nge-aq-row-actions">
            <button class="nge-aq-btn nge-aq-btn--jump" @click="showOnly(r)" title="Show only this cell and go to its soma">↗</button>
            <button class="nge-aq-btn nge-aq-btn--take" :disabled="busy === r.segmentId || !!busy" @click="take(r)" title="Put your name on this cell and open its start view">{{ busy === r.segmentId ? 'Claiming…' : 'Claim' }}</button>
          </div>
        </div>

        <!-- Taken by others -->
        <template v-if="taken.length">
          <div class="nge-aq-section">Taken</div>
          <div v-for="r in taken" :key="r.segmentId" class="nge-aq-row nge-aq-row--dim">
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
            <div class="nge-aq-row nge-aq-row--done" :class="{ 'nge-aq-row--mine': isMine(r) }">
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
                <button v-if="isMine(r)" class="nge-aq-btn nge-aq-btn--submit" :class="{ 'nge-aq-btn--submit-open': open === r.segmentId }" @click="open === r.segmentId ? (open = '') : startSubmit(r)" title="Send a new answer for this cell">Again</button>
              </div>
            </div>
            <div v-if="open === r.segmentId" class="nge-aq-form">
              <div class="nge-aq-form-title">Submit {{ r.index || label(r) }} again</div>
              <div class="nge-aq-form-label">Cilium status</div>
              <select v-model="form.status" class="nge-aq-select" @keydown.stop @keyup.stop @keypress.stop>
                <option value="" disabled>Choose one</option>
                <option v-for="s in QUEST_STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
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
                <button class="nge-aq-btn nge-aq-btn--send" :disabled="!form.status || !check.ok || busy === r.segmentId" @click="send(r)">{{ busy === r.segmentId ? 'Sending…' : 'Submit to the sheet' }}</button>
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
