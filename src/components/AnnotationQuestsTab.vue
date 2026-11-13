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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { play, startPlay } from '../util/play';
import { useProofreadingBackendStore } from '../store';
import { onTextEditAsked } from '../text_edit_links';
import { QUEST_TITLE, QUEST_LEAD, QUEST_GUIDE_URL, QUEST_VIDEO_URL, QUEST_STATUSES, QUEST_SPLIT_MERGED, QUEST_CLAIM_LIMIT, listQuests, claimQuest, releaseQuest, submitQuest, annotationCountInView, dressQuestLayers, layerSnapshot, nameKey, cellTypeForPlayers, type QuestRow } from '../annotation_quests';
import { openStartLink } from '../util/start_link';
import CrosshairHelp from './CrosshairHelp.vue';
import { questWork, setActiveQuest, markQuestOnScreen, questOnScreen, saveQuestWork, loadQuestWork, readSavedQuestWork, markQuestWorkClean } from '../annotation_quests';
import { snapshotDisplay, restoreDisplayAfterLoad, keepDisplayEnabled } from '../util/keep_display';
import { mintShortStateLink } from '../util/state_link';
import { runPanelLap } from '../util/holo_trace';
import { QUEST_STATUS_GUIDE, openQuestExamples } from '../annotation_quest_examples';
import EditableText from './EditableText.vue';
import QuestInstructions from './QuestInstructions.vue';
import { sendWaitingReviews, isQuestReview, reviewSegment, reviewLinkIn, replyToReview } from '../quest_review';
import { startCiliaTutorial } from '../tutorial-cilia';
import { supabase } from '../supabase';
import { currentSegLayer } from '../datasets';
import { Uint64 } from 'neuroglancer/util/uint64';
import { cellAtCrosshair } from '../util/crosshair_cell';
import { ancestorAmong } from '../widgets/pcg_service';

const backend = useProofreadingBackendStore();

/** Admins: the reviews marked "Send Review" go out now (src/quest_review.ts). */
const sendingReviews = ref(false);
async function sendReviews() {
  sendingReviews.value = true; error.value = ''; message.value = '';
  try {
    const out = await sendWaitingReviews();
    const sent = out.results.filter(r => r.sent);
    const left = out.results.filter(r => !r.sent).map(r => `${r.index || 'row ' + r.row} (${r.why})`);
    message.value = !out.checked ? 'No reviews are marked Send Review.'
      : `Sent ${sent.length} of ${out.checked}${sent.length ? ': ' + sent.map(r => r.index || 'row ' + r.row).join(', ') : ''}.${left.length ? ' Not sent: ' + left.join('; ') + '.' : ''}`;
  } catch (e: any) {
    error.value = e?.message || 'The reviews could not be sent.';
  } finally {
    sendingReviews.value = false;
  }
}
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
/** The Cell Library's slim bar (toknow, report 288): only the quest cell you
 *  are on (the active one, else the one you last opened, else your first). */
const props = defineProps<{ slim?: boolean; playEnter?: number }>();

const myKeys = computed(() => new Set([you.value, backend.userName, backend.username].map(nameKey).filter(Boolean)));
const isMine = (r: QuestRow) => !!r.annotator && myKeys.value.has(nameKey(r.annotator));
const isDone = (r: QuestRow) => !!r.status;
const mine = computed(() => rows.value.filter(r => isMine(r) && !isDone(r)));
const mineShown = computed(() => {
  if (!props.slim) return mine.value;
  const pick = mine.value.find(isActive) ?? mine.value.find(r => r.segmentId === current.value) ?? mine.value[0];
  return pick ? [pick] : [];
});
/** When to use the status chosen, in the lab's words (its reference sheet). */
const statusHint = computed(() => QUEST_STATUS_GUIDE[form.value.status] || '');
/** At the limit of cells held at once: Claim waits for a Submit or a Release. */
const atLimit = computed(() => mine.value.length >= QUEST_CLAIM_LIMIT);
/** Cells this player has completed (Ames 2026-10-13: "a count of how many I
 *  have completed"), from the sheet rows that carry their name and a status. */
// A cell a reviewer sent back counts again once the player sends their
// update (Celia 2026-11-06), as on the leaderboard and profile.
const mineDone = computed(() => rows.value.filter(r => isMine(r) && isDone(r) && !r.held).length);
const mineHeld = computed(() => rows.value.filter(r => isMine(r) && isDone(r) && r.held).length);
// Needs your update (toknow #483, 2026-11-12: "Players can open and update
// annotations more conveniently than open cell from the notification msg"):
// the cells a reviewer sent back sit in their own group at the top, with the
// review, the reviewer's view and the update form right there. The same reply
// as the notification's (src/quest_review.ts).
const needsUpdate = computed(() => rows.value.filter(r => isMine(r) && isDone(r) && r.held));
/** The newest review notification for this cell, if it has reached the bell. */
function reviewNote(r: QuestRow): any {
  const mine = (backend.notifications as any[]).filter(n => isQuestReview(n) && n.target_id === backend.userId && reviewSegment(n.body) === r.segmentId);
  return mine.sort((a, b) => String(b.send_at).localeCompare(String(a.send_at)))[0] || null;
}
function readReview(r: QuestRow) {
  const n = reviewNote(r);
  if (n) document.dispatchEvent(new CustomEvent('nge:open-notification', { detail: { id: n.id } }));
}
function openReviewerView(r: QuestRow) {
  const link = reviewLinkIn(reviewNote(r)?.body);
  current.value = r.segmentId;
  if (link && !openStartLink(link)) window.open(link, '_blank', 'noopener');
}
const updating = ref('');
const upLink = ref('');
const upNotes = ref('');
const upSending = ref(false);
const upError = ref('');
const upLinkOk = computed(() => !upLink.value.trim() || /^https:\/\/[^\s"'<>]+$/i.test(upLink.value.trim()));
function startUpdate(r: QuestRow) {
  updating.value = updating.value === r.segmentId ? '' : r.segmentId;
  upLink.value = ''; upNotes.value = ''; upError.value = '';
}
async function upUseMyView() {
  upError.value = '';
  const link = await Promise.race([mintShortStateLink().catch(() => null), new Promise<null>(res => setTimeout(() => res(null), 8000))]);
  if (link) upLink.value = link;
  else upError.value = 'A link to your view could not be made. Use Share in the top bar and paste the link here.';
}
async function sendUpdate(r: QuestRow) {
  if (upSending.value || !upLinkOk.value || !(upLink.value.trim() || upNotes.value.trim())) return;
  upSending.value = true; upError.value = ''; message.value = '';
  try {
    await replyToReview(r.segmentId, upLink.value.trim(), upNotes.value.trim());
    updating.value = '';
    message.value = `Your update on ${r.index || label(r)} went to the reviewer. It counts again now.`;
    await load();
  } catch (e: any) { upError.value = `Your update was not sent: ${e?.message ?? 'please try again'}`; }
  finally { upSending.value = false; }
}
const available = computed(() => rows.value.filter(r => !r.annotator && !r.status));
const taken = computed(() => rows.value.filter(r => !!r.annotator && !isMine(r) && !isDone(r)));
const done = computed(() => rows.value.filter(r => isDone(r) && !(r.held && isMine(r))).sort((a, b) => Number(isMine(b)) - Number(isMine(a))));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await listQuests(); rows.value = r.rows; if (r.you) you.value = r.you;
    void readSavedQuestWork();
    // Submitted or released somewhere else: it is no longer the one being worked on.
    const a = questWork.active;
    if (a && rows.value.length && !mine.value.some(m => m.segmentId === a.segmentId)) setActiveQuest(null);
  }
  catch (e: any) { error.value = e?.message || String(e); }
  finally { loading.value = false; }
  void playNow();
}
onMounted(() => { if (backend.userId) void load().then(maybePlayTraining); });
/** The first time a new player opens Cilia Quests, Cilia Quest Training
 *  plays by itself (Ames 2026-11-10). Only for a player with no quest held
 *  or done and no finished training, and once per browser. */
const TRAINING_KEY = 'nge-cilia-training-autoplayed';
async function maybePlayTraining() {
  if (props.slim || error.value) return;
  try { if (localStorage.getItem(TRAINING_KEY) === '1') return; } catch { return; }
  if (mine.value.length || mineDone.value || mineHeld.value) return;
  try {
    const { data } = await supabase.from('tutorial_completions')
      .select('tutorial').eq('user_id', backend.userId).eq('tutorial', 14).limit(1);
    if (data?.length) return;
  } catch { /* play it: the record could not be read */ }
  try { localStorage.setItem(TRAINING_KEY, '1'); } catch { return; }
  startTutorial();
}

// ── Play (util/play.ts) ─────────────────────────────────────────────────────
// Asked to play: once the sheet is read, open the quest cell you hold, or
// claim the next open one. Skipped cells go back to the list for others, and
// are not handed straight back to you.
let playWanted = false;
const skippedHere = new Set<string>();
watch(() => props.playEnter, n => { if (n) { playWanted = true; void playNow(); } }, { immediate: true });
const nextOpen = () => available.value.find(r => !skippedHere.has(r.segmentId));
async function playNow() {
  if (!playWanted || loading.value || !rows.value.length || busy.value) return;
  playWanted = false;
  const held = mine.value.find(isActive) ?? mine.value[0];
  if (held) { await openCell(held); message.value = `${held.index || 'Your cell'} is open. Mark the cilium, then press Submit. The next cell will be waiting.`; landed('Your quest cell', held); return; }
  const r = nextOpen();
  if (r) { await take(r); if (mine.value.some(m => m.segmentId === r.segmentId)) landed('Your new quest cell', r); }
  else message.value = 'No quest cells are open right now. Try mapping instead.';
}
/** While Skip hands one cell back and takes the next, the bar says so. */
const skippingQuest = ref(false);
async function playSkip(which?: QuestRow) {
  if (busy.value || skippingQuest.value) return;
  skippingQuest.value = true;
  try {
    const r = which ?? mine.value.find(isActive) ?? mine.value[0];
    if (r) { skippedHere.add(r.segmentId); await letGo(r); }
    const rest = mine.value[0];
    if (rest) { await openCell(rest); landed('Your next quest cell', rest); return; }
    const next = nextOpen();
    if (next) { await take(next); if (mine.value.some(m => m.segmentId === next.segmentId)) landed('Your new quest cell', next); }
    else message.value = 'No more quest cells are open right now.';
  } finally { skippingQuest.value = false; }
}
/** The "Teleport complete" flash over the view (CellLibraryPanel shows it). */
function landed(title: string, r: QuestRow) {
  document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title, cell: label(r) } }));
  // Saved as you arrive, so the bar never says "Not saved yet" (Ames 2026-11-12).
  setTimeout(() => {
    if (!questWork.savedAt[r.segmentId] && questOnScreen(r.segmentId)) void saveQuestWork(r.segmentId);
  }, 5000);
}
const onPlaySkip = () => { void playSkip(); };
onMounted(() => document.addEventListener('nge:play-skip-quest', onPlaySkip));
onUnmounted(() => document.removeEventListener('nge:play-skip-quest', onPlaySkip));

/** "A5, OFF Starburst": the sheet's index and the cell's type, in the players' words. */
function label(r: QuestRow) {
  const kind = cellTypeForPlayers(r.cellType || r.cellClass);
  return kind ? `${r.index || r.segmentId}, ${kind}` : (r.index || r.segmentId);
}
/** The quest's steps as the code has them (Celia, 2026-10-13). An admin can
 *  change them in the game (EditableText, key quest.retina_cilia.steps). The
 *  sentence on the centerline's keys is ours: the polyline tool is new here. */
const QUEST_STEPS: string[] = [
  '<b>Claim</b> a cell. Its view opens with three annotation layers: <b>Basal body, Daughter centriole, and Cilium centerline.</b>',
  `New to Cilia Quests? <a href="#" data-nge-action="tutorial">Try Cilia Quest Training</a>: it walks you through a real example and checks your marks. ` +
    `Use <a href="${QUEST_GUIDE_URL}" target="_blank" rel="noopener">this guide</a> to learn how to locate and annotate cilia.` +
    (QUEST_VIDEO_URL ? ` Check out this <a href="${QUEST_VIDEO_URL}" target="_blank" rel="noopener">training video</a> as well!` : ''),
  `Find the cilium, an appendage that projects from the cell's soma. Annotate its centerline, basal body, and daughter centriole in each of their respective layers. For the centerline, hold <b>Ctrl</b> and click along the cilium, then press <b>Enter</b>.`,
  `Some cells will not have a visible cilium. You may still be able to find their internal basal body and daughter centriole. <a href="#" data-nge-action="examples">Here's a reference</a> for a variety of cilia states you may encounter.`,
  'Press <b>Submit</b>, and choose a cilium status from the list. The lab will receive your view as a share link.',
  'You can hold three cells at a time. <b>Release</b> will send your cell back to the queue.',
];
function onQuestTextAction(name: string) {
  if (name === 'examples') void openQuestExamples();
  if (name === 'tutorial') { showHelp.value = false; startTutorial(); }
}
/** The Cilia Quest tutorial (src/tutorial-cilia.ts, Ames 2026-11-10). */
function startTutorial() {
  nudging.value = false;
  markIntroSeen();
  // The library would sit over the tutorial's boxes; it opens again at the end.
  document.dispatchEvent(new CustomEvent('nge:close-cell-library'));
  startCiliaTutorial();
}
/** The Instructions box with the lab's steps (Ames 2026-10-13), in a box of
 *  its own with room for a picture since 2026-11-06 (QuestInstructions). */
const showHelp = ref(false);
// Open to edit, from Ames's note for an edit (src/text_edit_links.ts).
let stopTextEdit: (() => void) | null = null;
onMounted(() => { stopTextEdit = onTextEditAsked(key => { if (key === 'quest.retina_cilia.steps') showHelp.value = true; }); });
onUnmounted(() => stopTextEdit?.());
/** The first time a player opens the tab, the Instructions button is lit
 *  once, a few seconds in, so it is not missed (Ames 2026-10-13). Once per
 *  browser: it plays one time and never loops. */
// The glow moved to the Tutorial button (2026-11-10), under a new key, so
// players who saw the Instructions glow see this one once too.
const INTRO_KEY = 'nge-cilia-tutorial-intro-seen';
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
/** The quest you are working on (a player's report, 2026-10-14: "Can we have
 *  it indicate which quest is currently active"). */
const isActive = (r: QuestRow) => questWork.active?.segmentId === r.segmentId;
/** Go to the cell's soma, with nothing else changed. */
function goToSoma(r: QuestRow) {
  try {
    const xyz = (r.soma.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (xyz.length === 3) (window as any)['viewer'].navigationState.position.value = Float32Array.from(xyz);
  } catch { /* the view stays where it is */ }
}
/** Open a quest cell to work on it (player report 2026-10-14: "If you lay
 *  down points and then reopen the Quest you are on it will remove your
 *  work"). The quest already on screen is not reloaded, only gone to. Another
 *  quest on screen is saved first. A cell with saved work opens on it; one
 *  without, on the lab's Start Link. */
async function openCell(r: QuestRow) {
  current.value = r.segmentId;
  error.value = '';
  if (isActive(r) && questOnScreen(r.segmentId)) {
    goToSoma(r);
    message.value = `You are on ${r.index || 'this cell'}. Your work is as you left it.`;
    return;
  }
  const was = questWork.active;
  if (was && was.segmentId !== r.segmentId && questOnScreen(was.segmentId)) {
    const ok = await saveQuestWork(was.segmentId);
    if (!ok && !window.confirm(`Your work on ${was.index || 'your current quest'} could not be saved. Open ${r.index || 'this cell'} anyway? Anything not saved would be lost.`)) return;
  }
  questWork.opening = r.segmentId;
  try {
    let saved: any = null;
    try { saved = await loadQuestWork(r.segmentId); } catch (e: any) { console.warn('[quests] could not read saved work:', e); }
    setActiveQuest({ segmentId: r.segmentId, index: r.index, label: label(r) });
    markQuestOnScreen(r.segmentId);
    const before = layerSnapshot();
    if (saved) {
      const snap = keepDisplayEnabled() ? snapshotDisplay() : null;
      try { (window as any)['viewer'].state.restoreState(saved); }
      catch (e: any) { error.value = `Your saved work could not be opened: ${e?.message || e}`; return; }
      restoreDisplayAfterLoad(snap);
      message.value = `Your saved work on ${r.index || 'this cell'} is back.`;
    } else if (!openStartLink(r.startLink)) {
      error.value = 'This cell has no start link in the sheet.';
      return;
    }
    // Once the layers are in: the game's colours, plus the centerline layer.
    await dressQuestLayers(before);
    markQuestWorkClean();
  } finally {
    questWork.opening = '';
  }
}
/** Save now (the work is also saved as annotations are placed). */
async function saveNow(r: QuestRow) {
  error.value = '';
  if (!questOnScreen(r.segmentId)) { error.value = `${r.index || 'This cell'} is not on screen. Press Open first.`; return; }
  if (await saveQuestWork(r.segmentId)) message.value = `Your work on ${r.index || 'this cell'} is saved.`;
}
/** "Saved: 2:02 pm", or what is happening to it. */
function savedLine(r: QuestRow): string {
  if (questWork.saving === r.segmentId) return 'Saving your work…';
  if (isActive(r) && questWork.error) return questWork.error;
  const at = questWork.savedAt[r.segmentId];
  if (at) {
    const d = new Date(at);
    const today = d.toDateString() === new Date().toDateString();
    // Shorter (Ames 2026-11-12): "Saved: 10:55 pm".
    return 'Saved: ' + (today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase() : d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
  }
  return isActive(r) ? 'Not saved yet' : 'Yours to annotate';
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
    await openCell(r);
    message.value = `${r.index || 'The cell'} is yours. Mark what you find in its layers, then press Submit.`;
    await load();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
/** How many more cells "Claim next" would take: up to the limit, as many as are open. */
const nextRoom = computed(() => Math.min(QUEST_CLAIM_LIMIT - mine.value.length, available.value.length));
/** Claim the next open cells in the sheet's order, up to the limit, in one
 *  press (toknow, report 213). A cell someone else took a moment ago is
 *  passed over for the one after it. The first one claimed opens. */
async function takeNext() {
  const want = nextRoom.value;
  if (want <= 0 || busy.value) return;
  busy.value = 'next'; error.value = ''; message.value = '';
  const got: QuestRow[] = [];
  let problem = '';
  try {
    for (const r of available.value.slice(0, want + 5)) {
      if (got.length >= want) break;
      try { await claimQuest(r.segmentId); got.push(r); }
      catch (e: any) { problem = e?.message || String(e); }
    }
    if (got.length) {
      current.value = got[0].segmentId;
      await openCell(got[0]);
      const names = got.map(r => r.index || r.segmentId).join(', ');
      message.value = got.length === 1
        ? `${names} is yours. Mark what you find in its layers, then press Submit.`
        : `${names} are yours. ${got[0].index || 'The first'} is open. Mark what you find in its layers, then press Submit.`;
    } else error.value = problem || 'No cell could be claimed. Try again.';
    await load();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
async function letGo(r: QuestRow) {
  busy.value = r.segmentId; error.value = ''; message.value = '';
  try {
    await releaseQuest(r.segmentId);
    if (open.value === r.segmentId) open.value = '';
    if (isActive(r)) { setActiveQuest(null); markQuestOnScreen(null); }
    message.value = `${r.index || 'The cell'} is open for someone else.`;
    await load();
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
/** The crosshairs must sit inside this cell, as Complete asks (Ames
 *  2026-10-13), so the share link opens on it. The sheet's ID may be older
 *  than the cell: an edited cell's current root is accepted when the sheet's
 *  ID is in its history. */
const check = ref<{ busy: boolean; ok: boolean; message: string; other?: boolean }>({ busy: false, ok: false, message: '' });
/** Crosshairs inside another segment are allowed with a reason in Notes
 *  (Jingkai_Li, report 415: the daughter centriole was in another segment,
 *  so the crosshairs on it never passed). Empty space too (Jingkai_Li, report
 *  510: the basal body sat where there is no segment). */
const explained = computed(() => !!check.value.other && !!form.value.notes.trim());
const canSubmit = computed(() => check.value.ok || explained.value);
async function runCheck(r: QuestRow) {
  check.value = { busy: true, ok: false, message: 'Checking the crosshairs…' };
  try {
    const at = await cellAtCrosshair();
    if (!at.root && at.supervoxel === '0') { check.value = { busy: false, ok: false, other: true, message: "The crosshairs are on empty space, not inside a cell. If that's on purpose (for example, the basal body sits where there is no segment), say why in Notes, then Submit." }; return; }
    if (!at.root) { check.value = { busy: false, ok: false, message: at.problem || 'Could not check the crosshairs.' }; return; }
    if (at.root === r.segmentId) { check.value = { busy: false, ok: true, message: 'The crosshairs are inside this cell.' }; return; }
    const hit = await ancestorAmong(at.root, [r.segmentId]);
    if (hit) { check.value = { busy: false, ok: true, message: `The crosshairs are inside this cell. It has been edited since the sheet was made, so its ID is now ${at.root}.` }; return; }
    check.value = { busy: false, ok: false, other: true, message: `The crosshairs are inside ${at.root}, not this cell. If that's on purpose, say why in Notes (for example, the daughter centriole is in another segment), then Submit.` };
  } catch (e: any) { check.value = { busy: false, ok: false, message: `Could not check the crosshairs: ${e?.message || e}` }; }
}
/** Slim bar: the row opens or folds the Submit form (Ames 2026-11-12). */
function onSlimRowClick(r: QuestRow, e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
  if (open.value === r.segmentId) open.value = ''; else startSubmit(r);
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
    if (!canSubmit.value) throw new Error(check.value.message);
    // The work is kept with the cell too, should it be needed again.
    if (questOnScreen(r.segmentId)) await saveQuestWork(r.segmentId);
    // The share link is the view as it is now, with the annotation layers.
    const link = await mintShortStateLink();
    if (!link) throw new Error('A share link of this view could not be made. Sign in and try again.');
    const placed = points.value;
    const at = mine.value.findIndex(m => m.segmentId === r.segmentId);
    const afterThis = [...mine.value.slice(at + 1), ...mine.value.slice(0, Math.max(at, 0))];
    await submitQuest(r.segmentId, { status: form.value.status, splitMerged: form.value.splitMerged, link, notes: form.value.notes });
    open.value = '';
    if (isActive(r)) { setActiveQuest(null); markQuestOnScreen(null); }
    message.value = `${r.index || 'The cell'} is submitted. Thank you.`;
    await load();
    // The celebration: a toast with the counts, and confetti (AchievementToast.vue).
    document.dispatchEvent(new CustomEvent('nge:quest-complete', { detail: { index: r.index, points: placed, done: mineDone.value, origin } }));
    // On to your next claimed cell (toknow, report 326), the one after this in
    // your list. With none left, the view stays where it is.
    const next = afterThis.find(x => mine.value.some(m => m.segmentId === x.segmentId));
    if (next) {
      message.value = `${r.index || 'The cell'} is submitted. Thank you. Opening ${label(next)}.`;
      try { await openCell(next); } catch (e) { console.warn('[quests] the next cell did not open:', e); }
    } else if (play.on === 'quests') {
      // Playing: the next open cell is claimed and opened (Ames 2026-11-09).
      const fresh = nextOpen();
      busy.value = '';
      if (fresh) { await take(fresh); message.value = `${r.index || 'The cell'} is submitted. Thank you. ${fresh.index || 'The next cell'} is yours now.`; }
    }
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = ''; }
}
const noPoints = computed(() => points.value === 0 && form.value.status.startsWith('Cilium annotated'));
</script>

<template>
  <div class="nge-aq" :class="{ 'nge-aq--slim': slim }">
    <div v-if="!slim" class="nge-aq-head">
      <div class="nge-aq-titlerow">
        <div class="nge-aq-title">{{ QUEST_TITLE }}</div>
        <span class="nge-aq-titlebtns">
          <button ref="infoEl" class="nge-aq-info nge-aq-info--tut" :class="{ 'nge-aq-info--nudge': nudging }" @click="startTutorial" title="Cilia Quest Training: learn on an example cell, with your marks checked">
            <span class="nge-aq-info-i" aria-hidden="true">▶</span><span class="nge-aq-info-word">Training</span>
          </button>
          <button class="nge-aq-info" :class="{ 'nge-aq-info--open': showHelp }" @click="toggleHelp" title="How to do a Cilia Quest">
            <span class="nge-aq-info-i" aria-hidden="true">i</span><span class="nge-aq-info-word">Instructions</span>
          </button>
        </span>
      </div>
      <EditableText text-key="quest.retina_cilia.lead" :original="QUEST_LEAD" text-class="nge-aq-lead" @action="onQuestTextAction" />
      <QuestInstructions v-if="showHelp" :lead="QUEST_LEAD" :steps="QUEST_STEPS" @close="showHelp = false" @action="onQuestTextAction" />
      <div v-if="backend.userId" class="nge-aq-headrow">
        <button v-if="!play.on && available.length" class="nge-aq-play" @click="startPlay('quests')"
                title="Play: claims a quest cell for you and opens it. After Submit, the next one.">
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>Play here
        </button>
        <button class="nge-aq-btn nge-aq-refresh" :disabled="loading" @click="load" title="Read the quest sheet again">{{ loading ? 'Reading…' : 'Refresh' }}</button>
        <span v-if="rows.length" class="nge-aq-tally" title="Cells you have submitted on this quest">Submitted by you: <b>{{ mineDone }}</b></span>
        <span v-if="mineHeld" class="nge-aq-tally nge-aq-tally--held" title="A reviewer sent these back. Send your update from Needs your update below, and they count again.">Waiting on your update: <b>{{ mineHeld }}</b></span>
        <span v-if="rows.length" class="nge-aq-tally" :class="{ 'nge-aq-tally--full': atLimit }" :title="`You can hold ${QUEST_CLAIM_LIMIT} cells at a time`">Holding <b>{{ mine.length }}</b> of {{ QUEST_CLAIM_LIMIT }}</span>
        <button v-if="backend.showAdminUi" class="nge-aq-btn" :disabled="sendingReviews" @click="sendReviews"
                title="Admins: send every review marked Send Review in the sheet now. Pyr also does this at 8 am and 4 pm Eastern.">{{ sendingReviews ? 'Sending…' : 'Send waiting reviews now' }}</button>
      </div>
    </div>

    <div v-if="!backend.userId" class="nge-aq-empty">Sign in to take a quest.</div>
    <template v-else>
      <div v-if="error" class="nge-aq-error">{{ error }}</div>
      <div v-if="loading && !rows.length" class="nge-aq-empty">Reading the quest sheet…</div>
      <template v-else-if="rows.length">
        <!-- Needs your update: cells a reviewer sent back (toknow #483) -->
        <template v-if="needsUpdate.length">
          <div class="nge-aq-section nge-aq-section--update">Needs your update <span class="nge-aq-count">{{ needsUpdate.length }}</span></div>
          <template v-for="r in needsUpdate" :key="r.segmentId">
            <div class="nge-aq-row nge-aq-row--mine nge-aq-row--update" :class="{ 'nge-aq-row--current': current === r.segmentId }">
              <div class="nge-aq-row-left">
                <span class="nge-aq-pip nge-aq-pip--update"></span>
                <div class="nge-aq-row-info">
                  <div class="nge-aq-row-name">{{ label(r) }}</div>
                  <div class="nge-aq-row-held">{{ reviewNote(r) ? 'A reviewer asked for an update.' : 'A review is on its way to your notifications.' }}</div>
                </div>
              </div>
              <div class="nge-aq-row-actions">
                <button class="nge-aq-btn nge-aq-btn--jump" @click="showOnly(r)" title="Show only this cell and go to its soma">↗</button>
                <button v-if="reviewNote(r)" class="nge-aq-btn" @click="readReview(r)" title="Read the reviewer's notes">Review</button>
                <button v-if="reviewLinkIn(reviewNote(r)?.body)" class="nge-aq-btn" @click="openReviewerView(r)" title="Open the view the reviewer sent, to fix your annotations in it">Reviewer's view</button>
                <button v-else class="nge-aq-btn" @click="viewDone(r)" title="Open your submitted view, to fix your annotations in it">Open</button>
                <button v-if="reviewNote(r)" class="nge-aq-btn nge-aq-btn--submit" :class="{ 'nge-aq-btn--submit-open': updating === r.segmentId }" @click="startUpdate(r)" title="Send the reviewer your updated view and notes">Send update</button>
              </div>
            </div>
            <div v-if="updating === r.segmentId" class="nge-aq-form">
              <div class="nge-aq-form-title">Your update on {{ r.index || label(r) }}</div>
              <div class="nge-aq-form-label">Link to your updated view</div>
              <div class="nge-aq-update-link">
                <input v-model="upLink" class="nge-aq-notes nge-aq-update-input" placeholder="https://…" @keydown.stop @keyup.stop @keypress.stop />
                <button class="nge-aq-btn" @click="upUseMyView" title="Use a share link of the view on screen now">Use my view</button>
              </div>
              <div v-if="!upLinkOk" class="nge-aq-form-msg nge-aq-form-msg--bad">The link must be a single https link.</div>
              <div class="nge-aq-form-label">Notes for the reviewer</div>
              <textarea v-model="upNotes" class="nge-aq-notes" rows="2" maxlength="1000" placeholder="What you changed" @keydown.stop @keyup.stop @keypress.stop></textarea>
              <div v-if="upError" class="nge-aq-form-msg nge-aq-form-msg--bad">{{ upError }}</div>
              <div class="nge-aq-form-actions">
                <button class="nge-aq-btn" @click="updating = ''">Cancel</button>
                <button class="nge-aq-btn nge-aq-btn--submit" :disabled="upSending || !upLinkOk || !(upLink.trim() || upNotes.trim())" @click="sendUpdate(r)">{{ upSending ? 'Sending…' : 'Send update' }}</button>
              </div>
            </div>
          </template>
        </template>
        <!-- Yours: taken, not yet submitted -->
        <div v-if="slim && !mineShown.length" class="nge-aq-empty nge-aq-empty--tight">{{ skippingQuest ? 'Finding your next cell…' : 'No quest cell of yours yet. Open the full view to claim one.' }}</div>
        <template v-if="mineShown.length">
          <div v-if="!slim" class="nge-aq-section">Yours</div>
          <template v-for="r in mineShown" :key="r.segmentId">
            <div class="nge-aq-row nge-aq-row--mine" :class="{ 'nge-aq-row--current': current === r.segmentId && !isActive(r), 'nge-aq-row--active': isActive(r), 'nge-aq-row--clickable': slim }"
                 :title="slim ? (open === r.segmentId ? 'Click to fold the form away' : 'Click to submit this quest') : undefined"
                 @click="slim && onSlimRowClick(r, $event)">
              <div class="nge-aq-row-left">
                <span v-if="!slim" class="nge-aq-pip nge-aq-pip--claimed"></span>
                <div class="nge-aq-row-info">
                  <div class="nge-aq-row-name" :title="slim ? `Cell ${r.segmentId}` : undefined">{{ label(r) }}<span v-if="isActive(r) && !slim" class="nge-aq-active-pill" title="The quest you are working on">Active</span></div>
                  <!-- Slim view: the essentials on one line (toknow, report 387).
                       The cell ID is the name's tooltip; the save line sits with the buttons. -->
                  <div v-if="!slim" class="nge-aq-row-meta nge-aq-cellid" title="This quest's cell, as the segment list shows it">Cell {{ r.segmentId }}</div>
                  <div v-if="!slim" class="nge-aq-row-meta nge-aq-saved" :class="{ 'nge-aq-saved--bad': isActive(r) && !!questWork.error && questWork.saving !== r.segmentId }">
                    <span>{{ savedLine(r) }}</span>
                    <button v-if="isActive(r)" class="nge-aq-save" :disabled="questWork.saving === r.segmentId" @click="saveNow(r)" title="Save your work on this quest now. It is also saved as you place annotations.">Save now</button>
                  </div>
                </div>
              </div>
              <div class="nge-aq-row-actions">
                <span v-if="slim" class="nge-aq-saved nge-aq-saved--slim" :class="{ 'nge-aq-saved--bad': isActive(r) && !!questWork.error && questWork.saving !== r.segmentId }" :title="savedLine(r)">
                  <span>{{ savedLine(r) }}</span>
                  <button v-if="isActive(r)" class="nge-aq-save" :disabled="questWork.saving === r.segmentId" @click="saveNow(r)" title="Save your work on this quest now. It is also saved as you place annotations.">Save</button>
                </span>
                <!-- Submit shows on the slim bar too (Kim_OZ 2026-11-12: players did not know the row opens it). -->
                <!-- One "go to it" button, Open (Ames 2026-11-10: "why is there a jump and an open button?"),
                     then Skip (or Release), then Submit last, in green. -->
                <button v-if="!(slim && isActive(r))" class="nge-aq-btn" @click="openCell(r)" :title="isActive(r) ? 'Go to this cell. Your work stays as it is.' : 'Open this cell with your saved work, or its start view'">Open</button>
                <button v-if="play.on !== 'quests'" class="nge-aq-btn nge-aq-btn--release" :disabled="busy === r.segmentId" @click="letGo(r)" title="Take your name off this cell">Release</button>
                <button v-else class="nge-aq-btn nge-aq-btn--skip" :disabled="!!busy || skippingQuest" @click="playSkip(r)" title="Not this one: it goes back on the list, and Pyr takes you to your next quest cell">Skip</button>
                <button class="nge-aq-btn nge-aq-btn--submit" :class="{ 'nge-aq-btn--submit-open': open === r.segmentId }" @click="open === r.segmentId ? (open = '') : startSubmit(r)" title="Submit this quest: your answer and a share link of this view go to the sheet">Submit</button>
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
              <textarea v-model="form.notes" class="nge-aq-notes" rows="1" placeholder="Anything the reviewers should know" @keydown.stop @keyup.stop @keypress.stop></textarea>
              <div class="nge-aq-form-msg" :class="{ 'nge-aq-form-msg--bad': !canSubmit && !check.busy, 'nge-aq-form-msg--ok': canSubmit }">
                <span><span v-if="canSubmit && !check.busy" class="nge-aq-tick" aria-hidden="true">✓</span>{{ check.message }}<CrosshairHelp v-if="!canSubmit && !check.busy" /></span>
                <button class="nge-aq-recheck" :disabled="check.busy" @click="recount(r)" title="Check the crosshairs and count the annotation points again">Check again</button>
              </div>
              <div class="nge-aq-form-msg nge-aq-form-facts" :class="{ 'nge-aq-form-msg--bad': noPoints }">
                <span title="The share link is made from the view as it is when you submit">Share link: current view</span>
                <span>Annotation points: {{ points }}</span>
              </div>
              <div class="nge-aq-form-actions">
                <button class="nge-aq-btn" @click="open = ''">Not now</button>
                <button class="nge-aq-btn nge-aq-btn--send" :disabled="!form.status || !canSubmit || busy === r.segmentId" @click="send(r, $event)">{{ busy === r.segmentId ? 'Submitting…' : play.on === 'quests' ? 'Submit and next' : 'Submit' }}</button>
              </div>
            </div>
          </template>
        </template>

        <template v-if="!slim">
        <!-- Open: nobody's yet -->
        <div class="nge-aq-section">Open <span class="nge-aq-count">{{ available.length }}</span>
          <button v-if="nextRoom > 0" class="nge-aq-btn nge-aq-btn--take nge-aq-btn--next" :disabled="!!busy" @click="takeNext"
                  :title="`Claim the next ${nextRoom === 1 ? 'open cell' : nextRoom + ' open cells'} in the list. The first one opens.`">{{ busy === 'next' ? 'Claiming…' : `Claim next ${nextRoom}` }}</button>
        </div>
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
                  <div v-if="r.held && isMine(r)" class="nge-aq-row-held">A review is waiting for your update. Open it from your notifications.</div>
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
              <textarea v-model="form.notes" class="nge-aq-notes" rows="1" placeholder="Anything the reviewers should know" @keydown.stop @keyup.stop @keypress.stop></textarea>
              <div class="nge-aq-form-msg" :class="{ 'nge-aq-form-msg--bad': !canSubmit && !check.busy, 'nge-aq-form-msg--ok': canSubmit }">
                <span><span v-if="canSubmit && !check.busy" class="nge-aq-tick" aria-hidden="true">✓</span>{{ check.message }}<CrosshairHelp v-if="!canSubmit && !check.busy" /></span>
                <button class="nge-aq-recheck" :disabled="check.busy" @click="recount(r)" title="Check the crosshairs and count the annotation points again">Check again</button>
              </div>
              <div class="nge-aq-form-msg nge-aq-form-facts" :class="{ 'nge-aq-form-msg--bad': noPoints }">
                <span title="The share link is made from the view as it is when you submit">Share link: current view</span>
                <span>Annotation points: {{ points }}</span>
              </div>
              <div class="nge-aq-form-actions">
                <button class="nge-aq-btn" @click="open = ''">Not now</button>
                <button class="nge-aq-btn nge-aq-btn--send" :disabled="!form.status || !canSubmit || busy === r.segmentId" @click="send(r, $event)">{{ busy === r.segmentId ? 'Submitting…' : 'Submit' }}</button>
              </div>
            </div>
          </template>
        </template>
        </template>
      </template>
      <div v-else-if="!loading && !error" class="nge-aq-empty">The quest sheet has no cells yet.</div>
      <div v-if="message && !slim" class="nge-aq-msg">{{ message }}</div>
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
:deep(.nge-aq-lead) { font-size: 14px; line-height: 1.5; color: #b3c0d3; }
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
.nge-aq-titlebtns { display: inline-flex; gap: 6px; flex-shrink: 0; }
.nge-aq-info--tut .nge-aq-info-i { font-size: 8px; padding-left: 1px; }
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
/* The quest being worked on: Highlight's green, the colour key's (player report 2026-10-14). */
.nge-aq-row--active { background: rgba(124, 255, 178, 0.09); box-shadow: inset 3px 0 0 #7CFFB2; }
.nge-aq-row--active:hover { background: rgba(124, 255, 178, 0.13); }
/* The slim bar is always the cell in hand: no green edge, and the Submit form
   runs the full width under it, past the fold arrow (Ames 2026-11-12). */
.nge-aq--slim .nge-aq-row--active { box-shadow: none; background: transparent; }
/* Hover on the slim bar: a soft light that sweeps in from the left (Ames 2026-11-12). */
.nge-aq--slim .nge-aq-row--clickable {
  background-image: linear-gradient(90deg, rgba(124, 255, 178, 0.10), rgba(124, 255, 178, 0.03) 60%, rgba(124, 255, 178, 0) 100%);
  background-repeat: no-repeat; background-size: 0% 100%; border-radius: 8px;
  transition: background-size 0.45s ease-out;
}
.nge-aq--slim .nge-aq-row--clickable:hover { background-color: transparent; background-size: 100% 100%; }
@media (prefers-reduced-motion: reduce) { .nge-aq--slim .nge-aq-row--clickable { transition: none; } }
.nge-aq--slim .nge-aq-form { margin: 6px 0 4px -40px; }
.nge-aq-row--clickable { cursor: pointer; }
.nge-aq-active-pill { display: inline-block; margin-left: 8px; padding: 0 8px; border-radius: 999px; font: 700 11px/18px 'Inter', 'Roboto', sans-serif; letter-spacing: 0.04em; color: #08140e; background: #7CFFB2; vertical-align: 2px; }
.nge-aq-cellid { font-family: 'JetBrains Mono', 'Consolas', monospace; color: #b4c8de; user-select: text; }
.nge-aq-saved { display: flex; align-items: baseline; gap: 8px; color: #8fb3cf; }
.nge-aq-saved > span { overflow: hidden; text-overflow: ellipsis; }
.nge-aq-saved--bad { color: #ff9a9a; }
.nge-aq-save { flex-shrink: 0; padding: 0; border: none; background: none; font: 600 13px 'Inter', 'Roboto', sans-serif; color: #7ecaff; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.nge-aq-save:hover { color: #d6efff; }
.nge-aq-save:disabled { opacity: 0.5; cursor: default; }
.nge-aq-row-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.nge-aq-pip { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #556; }
.nge-aq-pip--available { background: #4a6; }
.nge-aq-pip--claimed { background: #fa4; }
.nge-aq-pip--done { background: #4af; }
.nge-aq-row-info { min-width: 0; flex: 1; }
.nge-aq-row-name { font-size: 15px; font-weight: 600; color: #e4e8f2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-aq-row-held { font-size: 12px; color: #ffd27a; margin-top: 2px; }
.nge-aq-section--update { color: #ffd27a; }
.nge-aq-row--update { border-left: 2px solid #ffd27a; }
.nge-aq-pip--update { background: #ffd27a; }
.nge-aq-update-link { display: flex; gap: 6px; align-items: center; }
.nge-aq-update-input { flex: 1; min-width: 0; resize: none; }
.nge-aq-tally--held b { color: #ffd27a; }
.nge-aq-row-meta { font-size: 13px; color: #93a0b6; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nge-aq-row-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: 8px; align-items: center; }
.nge-aq-saved--slim { align-items: center; margin-right: 6px; font-size: 12px; max-width: 160px; white-space: nowrap; }
.nge-aq-saved--slim .nge-aq-save { font-size: 12px; }
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
/* "Claim next 3": in the Open heading, at its right end, in the buttons' own face */
.nge-aq-btn--next { margin-left: auto; padding: 3px 10px; font-family: 'Inter', sans-serif; font-size: 12px; letter-spacing: 0; text-transform: none; }
.nge-aq-btn--submit { border-color: rgba(68, 170, 255, 0.25); color: #4af; }
.nge-aq-btn--submit:hover { background: rgba(68, 170, 255, 0.12); }
.nge-aq-btn--submit-open { background: rgba(68, 170, 255, 0.16); border-color: rgba(68, 170, 255, 0.55); }
.nge-aq-btn--release { border-color: rgba(255, 170, 68, 0.2); color: #a86; }
.nge-aq-btn--skip { border-color: rgba(140, 160, 200, 0.3); color: #b4c0d6; }
.nge-aq-btn--skip:hover:not(:disabled) { background: rgba(140, 160, 200, 0.12); color: #e4e8f2; }
/* Submit: green, the thing to do (Ames 2026-11-10). */
.nge-aq-btn--submit, .nge-aq-btn--submit-open { color: #d6ffe6; border-color: rgba(61, 220, 132, 0.6); background: rgba(61, 220, 132, 0.18); }
.nge-aq-btn--submit:hover { background: rgba(61, 220, 132, 0.3); }
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
/* One line to start, smaller; the corner drags it taller (Ames 2026-11-12). */
.nge-aq-notes {
  resize: vertical; min-height: 2em; width: 100%; box-sizing: border-box;
  font-family: inherit; font-size: 13px; color: #dde;
  padding: 6px 8px; border-radius: 6px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(120, 140, 255, 0.2);
}
.nge-aq-notes:focus { outline: none; border-color: rgba(68, 170, 255, 0.5); }
.nge-aq-form-msg { font-size: 14px; line-height: 1.4; color: #bcd; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nge-aq-form-msg--bad { color: #f98; }
.nge-aq-form-msg--ok { color: #6d9; }
.nge-aq-tick { font-weight: 700; margin-right: 6px; }
.nge-aq-form-facts { flex-direction: column; align-items: flex-start; gap: 2px; }
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

/* Play here (util/play.ts) */
.nge-aq-play {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid #ffd36e;
  background: linear-gradient(135deg, rgba(140, 100, 20, 0.8), rgba(74, 58, 168, 0.8));
  color: #fff; font: 700 11.5px/1 Inter, system-ui, sans-serif; letter-spacing: 0.05em; text-transform: uppercase;
  box-shadow: 0 0 12px rgba(255, 211, 110, 0.3);
}
.nge-aq-play:hover { box-shadow: 0 0 18px rgba(255, 211, 110, 0.5); }
</style>
