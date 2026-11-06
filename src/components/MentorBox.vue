<script setup lang="ts">
/**
 * MentorBox: one mentor program cell open in the view (src/mentor.ts).
 *
 * A mentor drops notes as points ("cut here", "you missed an extension"),
 * either with Pin at crosshairs or with the annotation tools in
 * the Mentor notes layer (a point's description is its note), writes a note
 * for the whole cell, then sends suggestions or completes the cell, which
 * counts for the apprentice. The apprentice sees the same notes, read only.
 * The look and the dragging are the access review box's (AccessReviewBar.vue).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useDragBox } from '../util/drag_box';
import { useProofreadingBackendStore } from '../store';
import { apprenticeFlag } from '../util/mentor_flag';
import { MENTOR_TIERS } from '../util/mentor_tiers';
const MENTOR_ICON = MENTOR_TIERS[0].image;
import { joinPractice, takeCell, loadQueue, mentorState, openInView, cannotOpen, shortCell as cellLabel, type MentorReview } from '../mentor';
import { resendFromBox, cellColorNote, inView, closeView, hasNotesLayer, readNotesLayer, writeNotesLayer, viewerPosition, flyTo, saveNotes, sendSuggestions,
  completeForApprentice, startMentor, loadMentor, shortCell, replyTo, takeBackReply, type MentorNote, type MentorMessage } from '../mentor';

// An apprentice who completes a cell any other way gets this in the middle
// of the screen, not as small error text (Ames 2026-11-05).
const blocked = ref(false);
const onBlocked = () => { blocked.value = true; };
document.addEventListener('nge:mentor-blocked', onBlocked);
onBeforeUnmount(() => document.removeEventListener('nge:mentor-blocked', onBlocked));
// The test site's practice offer, in the same card (src/mentor.ts offerPractice).
const practiceAsk = ref(false);
const practiceNote = ref('');
const onPracticeOffer = () => { practiceAsk.value = true; practiceNote.value = ''; };
document.addEventListener('nge:mentor-practice-offer', onPracticeOffer);
onBeforeUnmount(() => document.removeEventListener('nge:mentor-practice-offer', onPracticeOffer));
async function startPractice() {
  practiceNote.value = '';
  try {
    await joinPractice();
    practiceAsk.value = false;
    document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'mentoring' } }));
  } catch (e: any) { practiceNote.value = `Could not join: ${e?.message || 'please try again in a moment.'}`; }
}
// Complete asks in the box first (no browser box).
const confirmComplete = ref(false);
function openLibrary() {
  blocked.value = false;
  document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'mine' } }));
}

// Start the program's status read once a player is signed in.
const backend = useProofreadingBackendStore();
watch(() => backend.userId, id => { if (id) startMentor(); }, { immediate: true });

const boxEl = ref<HTMLElement | null>(null);
const { dragging, posStyle, startDrag } = useDragBox('nge_mentor_box_pos', boxEl);

const cur = computed(() => inView.value);
const r = computed(() => cur.value?.review ?? null);
const mentor = computed(() => cur.value?.role === 'mentor');
// An admin reading a cell's notes (Admin Hub, Mentor program): read only.
const adminView = computed(() => cur.value?.role === 'admin');
const canAct = computed(() => mentor.value && r.value?.state === 'looking' && r.value?.mentorId === backend.userId);
/** Only looking (Ames 2026-11-05): a mentor's cell they have not taken yet.
 *  The button takes it, and with a player's first cell, them as an apprentice. */
const preview = computed(() => mentor.value && !!r.value && r.value.state !== 'complete' && r.value.state !== 'suggestions' && !canAct.value);
// Signing up to mentor someone, said plainly (Ames 2026-11-05: "make it clearer
// when they are signing up for being a mentor").
const becoming = computed(() => !!r.value && r.value.mentorId !== backend.userId);
const takeLabel = computed(() => becoming.value ? `Become ${r.value?.apprenticeName || 'this player'}'s mentor` : 'Review this cell');
async function takeIt() {
  const cur = inView.value;
  if (!cur) return;
  busy.value = true; error.value = '';
  try { cur.review = await takeCell(cur.review); said.value = cur.review.mentorId === backend.userId ? 'This cell is yours. Leave notes, then send suggestions or complete it.' : ''; }
  catch (e: any) { error.value = e?.message || 'Could not take that cell.'; }
  finally { busy.value = false; }
}

const notes = ref<MentorNote[]>([]);
const cellNote = ref('');
const newNote = ref('');
const busy = ref(false);
const error = ref('');
const said = ref('');

// The notes are the Mentor notes layer: read it often, it is local.
let timer: number | undefined;
watch(cur, c => {
  window.clearInterval(timer);
  error.value = ''; said.value = ''; newNote.value = ''; nextCell.value = null; allDone.value = false; confirmComplete.value = false;
  cellNote.value = c?.review.cellNote ?? '';
  notes.value = c?.review.notes ?? [];
  layerNote.value = '';
  if (c) timer = window.setInterval(() => {
    // Before the saved view has loaded, the layer is not there yet: keep the saved list.
    if (!hasNotesLayer()) return;
    if (canAct.value) { notes.value = readNotesLayer(); return; }
    // Not theirs to change (Marissa answered a pin by editing it, 2026-11-06,
    // and it never reached her mentor): put the mentor's notes back, and say where replies go.
    const saved = inView.value?.review.notes ?? [];
    const key = (l: MentorNote[]) => JSON.stringify(l.map(n => [n.id, n.text]));
    if (key(readNotesLayer()) !== key(saved)) {
      writeNotesLayer(saved, true);
      layerNote.value = mentor.value || adminView.value ? 'These notes cannot be changed here.' : 'These are your mentor\'s notes, so they cannot be changed. To answer one, press Reply under it in this box.';
    }
    notes.value = saved;
  }, 1000);
}, { immediate: true });
onBeforeUnmount(() => window.clearInterval(timer));

function addHere() {
  const text = newNote.value.trim();
  const at = viewerPosition();
  if (!text || !at) return;
  const list = [...readNotesLayer(), { id: `n${Date.now().toString(36)}`, position: at, text: text.slice(0, 300) }];
  if (writeNotesLayer(list)) { notes.value = list; newNote.value = ''; }
}
// The conversation (Ames 2026-11-06: replies under pins, one thread per cell).
const layerNote = ref('');
const thread = computed<MentorMessage[]>(() => r.value?.thread ?? []);
const noteIds = computed(() => new Set(notes.value.map(n => n.id)));
const repliesTo = (id: string) => thread.value.filter(m => m.noteId === id);
/** Messages on the whole cell, and replies to a pin since removed. */
const cellMessages = computed(() => thread.value.filter(m => !m.noteId || !noteIds.value.has(m.noteId)));
/** Which side this player writes on now, if any. */
const side = computed<'mentor' | 'apprentice' | null>(() => {
  if (canAct.value) return 'mentor';
  if (cur.value?.role === 'apprentice' && r.value?.state === 'suggestions' && r.value.apprenticeId === backend.userId) return 'apprentice';
  return null;
});
const otherName = computed(() => side.value === 'mentor' ? r.value?.apprenticeName : (r.value?.mentorName || 'your mentor'));
const replyOpen = ref<string | null>(null);
const replyText = ref('');
const wholeText = ref('');
function openReply(id: string) { replyOpen.value = replyOpen.value === id ? null : id; replyText.value = ''; }
async function sendReply(noteId: string | null) {
  const text = (noteId ? replyText.value : wholeText.value).trim();
  if (!text) return;
  busy.value = true; error.value = '';
  try {
    await replyTo(text, noteId);
    if (noteId) { replyText.value = ''; replyOpen.value = null; } else wholeText.value = '';
  } catch (e: any) { error.value = e?.message || 'That reply did not go through.'; }
  finally { busy.value = false; }
}
async function takeBack(id: string) {
  busy.value = true; error.value = '';
  try { await takeBackReply(id); } catch (e: any) { error.value = e?.message || 'Could not take that back.'; }
  finally { busy.value = false; }
}
const whoLabel = (m: MentorMessage) => `${m.name}${(r.value?.rounds ?? 1) > 1 ? `, try ${m.round}` : ''}`;

function remove(id: string) {
  const list = readNotesLayer().filter(n => n.id !== id);
  writeNotesLayer(list);
  notes.value = list;
}

// The next cell for this mentor once one is answered (Ames 2026-11-05: "Can we
// make a Next UI if there is another cell?"): their own first, then any
// nobody has taken, oldest first.
const nextCell = ref<MentorReview | null>(null);
// Nothing else waiting (Ames 2026-11-05: "maybe we need an all done?").
const allDone = ref(false);
async function findNext() {
  allDone.value = false;
  nextCell.value = null;
  try { await loadQueue(); } catch { return; }
  const q = mentorState.queue, here = r.value?.id;
  if (!q) return;
  const mine = q.yours.filter(x => x.id !== here && (x.state === 'waiting' || x.state === 'looking'));
  const open = q.waiting.filter(x => x.id !== here);
  nextCell.value = [...mine, ...open].find(x => !cannotOpen(x)) ?? null;
  allDone.value = !nextCell.value;
}
/** Skip (Ames 2026-11-05): only looking, so nothing to undo; on to the next. */
async function skip() {
  busy.value = true;
  try { await findNext(); } finally { busy.value = false; }
  if (nextCell.value) openNext();
}
function openNext() {
  const n = nextCell.value;
  if (!n) return;
  nextCell.value = null;
  try { openInView(n, 'mentor'); } catch (e: any) { error.value = e?.message || 'That cell could not be opened.'; }
}
/** The next cell to jump to while working (slim mode), from the queue
 *  already loaded: the mentor's own first, then any nobody has taken. */
const upNext = computed<MentorReview | null>(() => {
  const q = mentorState.queue, here = r.value?.id;
  if (!q || !mentor.value) return null;
  const mine = q.yours.filter(x => x.id !== here && (x.state === 'waiting' || x.state === 'looking'));
  const open = q.waiting.filter(x => x.id !== here);
  return [...mine, ...open].find(x => !cannotOpen(x)) ?? null;
});
function goUpNext() {
  const n = upNext.value;
  if (!n) return;
  try { openInView(n, 'mentor'); } catch (e: any) { error.value = e?.message || 'That cell could not be opened.'; }
}
/** Send the cell back to the mentor from here: the message in the box goes with it. */
async function sendAgain() {
  if (!r.value || busy.value) return;
  busy.value = true; error.value = ''; said.value = '';
  try {
    const out = await resendFromBox(r.value, wholeText.value.trim());
    if (!out.ok) { error.value = out.message; return; }
    wholeText.value = '';
    said.value = `Sent to ${otherName.value}.`;
  } catch (e: any) {
    error.value = e?.message || 'Could not send the cell.';
  } finally { busy.value = false; }
}
const SLIM_KEY = 'pyr-mentor-box-slim';
const slim = ref((() => { try { return localStorage.getItem(SLIM_KEY) === '1'; } catch { return false; } })());
function toggleSlim() {
  slim.value = !slim.value;
  try { localStorage.setItem(SLIM_KEY, slim.value ? '1' : '0'); } catch { /* private window */ }
}
const THANKS = 'Thank you for helping a new citizen scientist!';
async function run(what: 'save' | 'suggest' | 'complete') {
  if (!r.value) return;
  if (what === 'complete' && !confirmComplete.value) { confirmComplete.value = true; return; }
  confirmComplete.value = false;
  busy.value = true; error.value = ''; said.value = '';
  try {
    if (what === 'save') { await saveNotes(cellNote.value); said.value = 'Saved. Only you see them until you send them.'; }
    else if (what === 'suggest') { await sendSuggestions(cellNote.value); said.value = `Sent. ${r.value.apprenticeName} gets a notification with your suggestions. ${THANKS}`; void findNext(); }
    else {
      const out = await completeForApprentice(cellNote.value);
      said.value = r.value.done?.practice
        ? (out.finished ? `Complete. That was ${r.value.apprenticeName}'s last practice cell.` : 'Complete (practice). Nothing was recorded.')
        : out.finished ? `Complete. That was ${r.value.apprenticeName}'s last mentor cell: you both get an Achievement.` : `Complete. It counts for ${r.value.apprenticeName}.`;
      said.value += ` ${THANKS}`;
      void findNext();
    }
  } catch (e: any) { error.value = e?.message || 'That did not go through.'; }
  finally { busy.value = false; }
}
function close() {
  closeView();
  if (!mentor.value) void loadMentor();
}
const STATE: Record<string, string> = {
  waiting: 'Sent. Waiting for a mentor to take it. You get a notification when it is answered.', looking: 'Your mentor is looking at it. You get a notification when they answer.', suggestions: 'Your mentor has suggestions. Fix the cell, then send it again with the button below.',
  complete: 'Complete. It counts for you.',
};
</script>

<template>
  <div v-if="practiceAsk" class="nge-mblk" @click.self="practiceAsk = false">
    <div class="nge-mblk-card" role="dialog" aria-labelledby="nge-mprac-title">
      <span class="nge-mblk-corner nge-mblk-corner--tl" aria-hidden="true"></span>
      <span class="nge-mblk-corner nge-mblk-corner--br" aria-hidden="true"></span>
      <div class="nge-mblk-kicker">Mentor program test</div>
      <h2 id="nge-mprac-title" class="nge-mblk-title">Practice as a new player?</h2>
      <p class="nge-mblk-text">The next cells you complete go to a mentor, who sends you feedback. Nothing you complete is recorded.</p>
      <p v-if="practiceNote" class="nge-mbx-err" role="alert">{{ practiceNote }}</p>
      <div class="nge-mblk-actions">
        <button class="nge-mblk-btn" @click="practiceAsk = false">Not now</button>
        <button class="nge-mblk-btn nge-mblk-btn--go" @click="startPractice">Practice as a new player</button>
      </div>
    </div>
  </div>
  <div v-if="blocked" class="nge-mblk" @click.self="blocked = false">
    <div class="nge-mblk-card" role="alertdialog" aria-labelledby="nge-mblk-title" aria-describedby="nge-mblk-text">
      <span class="nge-mblk-corner nge-mblk-corner--tl" aria-hidden="true"></span>
      <span class="nge-mblk-corner nge-mblk-corner--br" aria-hidden="true"></span>
      <div class="nge-mblk-kicker">Mentor program</div>
      <h2 id="nge-mblk-title" class="nge-mblk-title">Your mentor takes a second look first</h2>
      <p id="nge-mblk-text" class="nge-mblk-text">For your first {{ apprenticeFlag.cellsNeeded }} cells, complete a claimed cell from the Cell Library. It goes to your mentor, who completes it with you or sends suggestions.</p>
      <div class="nge-mblk-actions">
        <button class="nge-mblk-btn" @click="blocked = false">OK</button>
        <button class="nge-mblk-btn nge-mblk-btn--go" @click="openLibrary">Open the Cell Library</button>
      </div>
    </div>
  </div>
  <div v-if="r" ref="boxEl" class="nge-mbx" :class="{ 'nge-mbx--dragging': dragging }" :style="posStyle" role="dialog" aria-label="Mentor program cell">
    <div class="nge-mbx-bar" title="Drag to move" @pointerdown="startDrag">
      <!-- Slim on the left, as the Cell Library's (Ames 2026-11-06: "slim should be the ^ and down"). -->
      <button class="nge-mbx-caret" :class="{ 'nge-mbx-caret--on': slim }" :title="slim ? 'Show the whole box' : 'Slim the box'" :aria-label="slim ? 'Show the whole box' : 'Slim the box'" :aria-pressed="slim" @pointerdown.stop @click="toggleSlim">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path :d="slim ? 'M2.5 4.5 6 8l3.5-3.5' : 'M2.5 7.5 6 4l3.5 3.5'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <img :src="MENTOR_ICON" alt="" class="nge-mbx-bar-icon" />
      <span class="nge-mbx-bar-label">{{ mentor ? 'Mentor Mode' : adminView ? 'Mentor notes, admin view' : 'Mentor notes' }}</span>
      <button class="nge-mbx-x" title="Close this box and take the notes away" aria-label="Close" @pointerdown.stop @click="close">×</button>
    </div>
    <div v-if="!slim || mentor || adminView || (side === 'apprentice' && r.state === 'suggestions' && r.taskId != null)" class="nge-mbx-head" title="Drag to move" @pointerdown="startDrag">
      <!-- The apprentice's box has no title line: the bar says Mentor notes (Ames 2026-11-06). -->
      <span v-if="mentor || adminView" class="nge-mbx-title">{{ mentor ? r.apprenticeName : `${r.apprenticeName}${r.mentorName ? `, with ${r.mentorName}` : ''}` }}</span>
      <!-- Slim: the apprentice's send sits on this line (Ames 2026-11-06: "more compact"). -->
      <button v-if="slim && side === 'apprentice' && r.state === 'suggestions' && r.taskId != null" class="nge-mbx-btn nge-mbx-btn--done nge-mbx-btn--headsend" title="Opens this cell's Complete form in the Cell Library, which checks the crosshairs and sends it" @pointerdown.stop @click="sendAgain">{{ busy ? 'Sending…' : `Send to ${otherName}` }}</button>
      <span v-if="!slim" class="nge-mbx-pos" title="The cell's segment ID" @pointerdown.stop>{{ r.rootId || r.segmentId }}{{ r.rounds > 1 ? `, try ${r.rounds}` : '' }}</span>
    </div>

    <!-- Slim (Ames 2026-11-06): pin a note, send suggestions or complete,
         and on to the next cell, in a box that leaves the view free. -->
    <template v-if="slim">
      <!-- The notes stay in slim (Ames 2026-11-06): one line each, click to fly there. -->
      <div v-if="notes.length" class="nge-mbx-notes nge-mbx-notes--slim">
        <button v-for="(n, i) in notes" :key="n.id" class="nge-mbx-fly" title="Fly to this note" @click="flyTo(n.position)"><span class="nge-mbx-dot"></span>{{ i + 1 }}. {{ n.text }}</button>
      </div>
      <template v-if="canAct">
        <div class="nge-mbx-add">
          <input v-model="newNote" maxlength="300" placeholder="A note to pin at the crosshairs" @keydown.enter.prevent="addHere" />
          <button class="nge-mbx-btn" :disabled="!newNote.trim()" title="Pins the note where the crosshairs are, the center of the view" @click="addHere">Pin</button>
        </div>
        <div class="nge-mbx-actions">
          <button class="nge-mbx-btn nge-mbx-btn--suggest" :disabled="busy" @click="run('suggest')">Send suggestions</button>
          <button v-if="!confirmComplete" class="nge-mbx-btn nge-mbx-btn--done" :disabled="busy" @click="run('complete')">Complete</button>
          <button v-if="upNext && !nextCell" class="nge-mbx-btn nge-mbx-btn--next" :disabled="busy" :title="`Next cell: ${upNext.apprenticeName}, ${cellLabel(upNext)}. This one stays yours.`" @click="goUpNext">Next cell ›</button>
        </div>
      </template>
      <div v-else-if="preview" class="nge-mbx-actions">
        <button class="nge-mbx-btn" :disabled="busy" title="Leave this cell for another mentor and look at the next one" @click="skip">Skip</button>
        <button class="nge-mbx-btn nge-mbx-btn--done" :disabled="busy" @click="takeIt">{{ busy ? 'Taking…' : takeLabel }}</button>
      </div>
      <template v-else-if="side === 'apprentice'">
        <div class="nge-mbx-add">
          <input v-model="wholeText" maxlength="1000" :placeholder="`A message for ${otherName}`" @keydown.enter.prevent="sendReply(null)" />
          <button class="nge-mbx-btn" :disabled="busy || !wholeText.trim()" @click="sendReply(null)">Add</button>
        </div>
      </template>
      <p v-else class="nge-mbx-meta">{{ shortCell(r) }}: {{ r.state === 'complete' ? 'This cell is complete.' : mentor ? 'This cell is back with the apprentice.' : STATE[r.state] }}</p>
    </template>
    <template v-else>
    <template v-if="mentor">
      <!-- Before they take the apprentice on, what a mentor is for (Ames 2026-11-06). -->
      <p v-if="preview && becoming" class="nge-mbx-how">Mentors help new players with their first {{ apprenticeFlag.cellsNeeded }} production access cells by double checking that everything looks good.</p>
      <p v-else class="nge-mbx-how">Look over the cell. Leave notes where something needs work, then send suggestions, or complete it if it is done.</p>
      <p v-if="r.done.notes && !thread.length" class="nge-mbx-quote">{{ r.apprenticeName }}: {{ r.done.notes }}</p>
      <p v-if="r.done.status" class="nge-mbx-meta">Ending: {{ r.done.status }}</p>
    </template>
    <template v-else-if="adminView">
      <p class="nge-mbx-how">Read only. {{ { waiting: 'Waiting for a mentor.', looking: 'With the mentor.', suggestions: 'Back with the apprentice, with suggestions.', complete: 'Complete.' }[r.state] }}</p>
      <p v-if="r.done.notes && !thread.length" class="nge-mbx-quote">{{ r.apprenticeName }}: {{ r.done.notes }}</p>
    </template>
    <p v-else class="nge-mbx-how">{{ r.state === 'complete' && r.done?.practice ? 'Complete. This was practice, so nothing was recorded.' : STATE[r.state] }}</p>

    <div v-if="notes.length || !mentor" class="nge-mbx-notes">
      <div v-for="(n, i) in notes" :key="n.id" class="nge-mbx-pin">
        <div class="nge-mbx-note">
          <button class="nge-mbx-fly" title="Fly to this note" @click="flyTo(n.position)"><span class="nge-mbx-dot"></span>{{ i + 1 }}. {{ n.text }}</button>
          <button v-if="side" class="nge-mbx-replylink" :aria-expanded="replyOpen === n.id" @click="openReply(n.id)">Reply</button>
          <button v-if="canAct" class="nge-mbx-rm" title="Remove this note" @click="remove(n.id)">×</button>
        </div>
        <div v-for="m in repliesTo(n.id)" :key="m.id" class="nge-mbx-msg nge-mbx-msg--reply" :class="`nge-mbx-msg--${m.by}`">
          <span class="nge-mbx-who">{{ whoLabel(m) }}</span>
          <span class="nge-mbx-said-text">{{ m.text }}</span>
          <span v-if="!m.sent" class="nge-mbx-unsent">Not sent yet</span>
          <button v-if="!m.sent && side === m.by" class="nge-mbx-rm" title="Take this reply back" @click="takeBack(m.id)">×</button>
        </div>
        <div v-if="replyOpen === n.id && side" class="nge-mbx-add nge-mbx-add--reply">
          <input v-model="replyText" maxlength="1000" :placeholder="`Reply to note ${i + 1}`" @keydown.enter.prevent="sendReply(n.id)" />
          <button class="nge-mbx-btn" :disabled="busy || !replyText.trim()" @click="sendReply(n.id)">Add reply</button>
        </div>
      </div>
      <p v-if="!notes.length && !mentor && r.state !== 'waiting' && r.state !== 'looking'" class="nge-mbx-meta">No notes in the view.</p>
    </div>
    <p v-if="layerNote" class="nge-mbx-said" role="status">{{ layerNote }}</p>

    <div v-if="cellMessages.length" class="nge-mbx-thread" aria-label="Messages on this cell">
      <div v-for="m in cellMessages" :key="m.id" class="nge-mbx-msg" :class="`nge-mbx-msg--${m.by}`">
        <span class="nge-mbx-who">{{ whoLabel(m) }}{{ m.noteId ? ', on a note since removed' : '' }}</span>
        <span class="nge-mbx-said-text">{{ m.text }}</span>
        <span v-if="!m.sent" class="nge-mbx-unsent">Not sent yet</span>
        <button v-if="!m.sent && side === m.by" class="nge-mbx-rm" title="Take this back" @click="takeBack(m.id)">×</button>
      </div>
    </div>
    <template v-if="side === 'apprentice'">
      <div class="nge-mbx-add">
        <input v-model="wholeText" maxlength="1000" :placeholder="`A message for ${otherName}`" @keydown.enter.prevent="sendReply(null)" />
        <button class="nge-mbx-btn" :disabled="busy || !wholeText.trim()" @click="sendReply(null)">Add</button>
      </div>
      <p class="nge-mbx-meta">Answer a note with Reply under it. Your replies go to {{ otherName }} when you send the cell again.</p>
      <button v-if="r.state === 'suggestions' && r.taskId != null" class="nge-mbx-btn nge-mbx-btn--done nge-mbx-btn--send" title="Checks the crosshairs are inside the cell, saves the view and sends it, with your replies and the message above" :disabled="busy" @click="sendAgain">{{ busy ? 'Sending…' : `Send to ${otherName} again` }}</button>
    </template>

    <div v-if="preview" class="nge-mbx-preview">
      <template v-if="becoming">
        <p class="nge-mbx-ask">Become {{ r.apprenticeName }}'s mentor?</p>
        <ul class="nge-mbx-terms">
          <li>You look at each of their mentor cells, leave notes, and send suggestions or complete it.</li>
          <li>Answer each cell within a day, or it goes to another mentor.</li>
          <li>They get a notification saying you are their mentor.</li>
        </ul>
        <p class="nge-mbx-meta">You are only looking now. Nothing changes until you press the button.</p>
      </template>
      <p v-else class="nge-mbx-meta">{{ r.apprenticeName }} is yours. Press the button to review this cell.</p>
      <div class="nge-mbx-actions nge-mbx-actions--preview">
        <button class="nge-mbx-btn" :disabled="busy" title="Leave this cell for another mentor and look at the next one" @click="skip">Skip</button>
        <button class="nge-mbx-btn nge-mbx-btn--done" :disabled="busy" @click="takeIt">{{ busy ? 'Taking…' : takeLabel }}</button>
      </div>
    </div>
    <template v-if="canAct">
      <div class="nge-mbx-add">
        <input v-model="newNote" maxlength="300" placeholder="A note to pin at the crosshairs" @keydown.enter.prevent="addHere" />
        <button class="nge-mbx-btn" :disabled="!newNote.trim()" title="Pins the note where the crosshairs are, the center of the view" @click="addHere">Pin at crosshairs</button>
      </div>
      <p class="nge-mbx-meta">Or place points in the Mentor notes layer with the annotation tools. A point's description is its note.</p>
      <textarea v-model="cellNote" class="nge-mbx-text" rows="3" maxlength="2000" placeholder="A note on the whole cell"></textarea>
      <p class="nge-mbx-meta">Your notes and replies go to {{ r.apprenticeName }} when you send suggestions or complete.</p>
      <div class="nge-mbx-actions">
        <button class="nge-mbx-btn" :disabled="busy" @click="run('save')">Save notes</button>
        <button class="nge-mbx-btn nge-mbx-btn--suggest" :disabled="busy" @click="run('suggest')">Send suggestions</button>
        <button v-if="!confirmComplete" class="nge-mbx-btn nge-mbx-btn--done" :disabled="busy" @click="run('complete')">Complete</button>
      </div>
    </template>
    <template v-else>
      <p v-if="r.cellNote && !thread.length" class="nge-mbx-quote">{{ r.mentorName || 'Mentor' }}: {{ r.cellNote }}</p>
      <p v-if="mentor && !preview" class="nge-mbx-meta">{{ r.state === 'complete' ? 'This cell is complete.' : 'This cell is back with the apprentice.' }}</p>
    </template>
    </template>

    <div v-if="confirmComplete && canAct" class="nge-mbx-confirm" role="group" aria-label="Confirm complete">
      <p class="nge-mbx-confirm-q">{{ r.done?.practice
        ? `Complete this practice cell for ${r.apprenticeName}? Nothing is recorded, the cell is free again, and they can still read your notes.`
        : `Complete this cell for ${r.apprenticeName}? It counts for them now, and they can still read your notes.` }}</p>
      <div class="nge-mbx-actions">
        <button class="nge-mbx-btn" :disabled="busy" @click="confirmComplete = false">Cancel</button>
        <button class="nge-mbx-btn nge-mbx-btn--done" :disabled="busy" @click="run('complete')">{{ busy ? 'Completing…' : 'Yes, complete' }}</button>
      </div>
    </div>
    <p v-if="error" class="nge-mbx-err" role="alert">{{ error }}</p>
    <p v-else-if="said" class="nge-mbx-said" role="status">{{ said }}</p>
    <div v-if="allDone && mentor && !nextCell" class="nge-mbx-alldone" role="status">
      <span>All done. Nothing else is waiting for you. Thank you!</span>
      <button class="nge-mbx-btn" @click="close">Close</button>
    </div>
    <button v-if="nextCell && mentor" class="nge-mbx-btn nge-mbx-next" @click="openNext">Next cell: {{ nextCell.apprenticeName }}, {{ cellLabel(nextCell) }}</button>
  </div>
</template>

<style scoped>
.nge-mblk { position: fixed; inset: 0; z-index: 10050; display: grid; place-items: center; padding: 16px; background: rgba(2, 6, 14, 0.55); backdrop-filter: blur(2px); }
.nge-mblk-card { position: relative; width: min(460px, 100%); box-sizing: border-box; padding: 18px 20px 16px; border-radius: 12px;
  background: linear-gradient(180deg, rgba(14, 24, 44, 0.98), rgba(8, 14, 28, 0.98)); border: 1px solid rgba(120, 180, 255, 0.45);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(120, 180, 255, 0.08) inset;
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; }
.nge-mblk-corner { position: absolute; width: 12px; height: 12px; border-color: rgba(159, 200, 255, 0.8); border-style: solid; }
.nge-mblk-corner--tl { top: 6px; left: 6px; border-width: 1px 0 0 1px; }
.nge-mblk-corner--br { bottom: 6px; right: 6px; border-width: 0 1px 1px 0; }
.nge-mblk-kicker { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9fc8ff; }
.nge-mblk-title { margin: 6px 0 8px; font-size: 19px; font-weight: 600; color: #eef4fb; line-height: 1.3; }
.nge-mblk-text { margin: 0; font-size: 15px; line-height: 1.5; color: rgba(220, 230, 245, 0.85); }
.nge-mblk-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.nge-mblk-btn { font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 7px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #dce6f5; cursor: pointer; }
.nge-mblk-btn:hover { background: rgba(120, 180, 255, 0.12); }
.nge-mblk-btn--go { border-color: rgba(120, 180, 255, 0.6); color: #9fc8ff; }
.nge-mbx {
  /* In front of the Cell Library (10010) (Ames 2026-11-06: "mentor notes should be in front"). */
  position: fixed; right: 16px; top: 64px; z-index: 10012;
  width: 380px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(120, 180, 255, 0.45);
  border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; font-size: 15px;
}
.nge-mbx-bar { display: flex; align-items: center; gap: 8px; cursor: grab; user-select: none; touch-action: none; margin: -12px -14px 8px; padding: 7px 10px 7px 12px;
  border-bottom: 1px solid rgba(120, 180, 255, 0.3); border-radius: 12px 12px 0 0;
  /* Stays at the top while the box scrolls (Ames 2026-11-06: "keep a header bar"), so opaque. */
  position: sticky; top: -12px; z-index: 3;
  background: linear-gradient(90deg, rgba(120, 180, 255, 0.16), rgba(245, 209, 66, 0.08)), #0a1020; }
.nge-mbx--dragging .nge-mbx-bar { cursor: grabbing; }
.nge-mbx-bar-icon { width: 26px; height: 26px; object-fit: contain; }
.nge-mbx-bar-label { flex: 1; font-family: 'Orbitron', 'Inter', sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #cfe3ff; }
.nge-mbx-head { display: flex; align-items: baseline; gap: 8px; cursor: grab; user-select: none; touch-action: none; padding: 0 0 4px; }
.nge-mbx--dragging .nge-mbx-head { cursor: grabbing; }
.nge-mbx-title { font-size: 17px; font-weight: 600; color: #9fc8ff; }
.nge-mbx-title ~ .nge-mbx-pos { margin-left: auto; }
/* With no name before it (the apprentice's box), the ID is on the left (Ames 2026-11-06). */
.nge-mbx-pos { margin-left: 0; color: rgba(220, 230, 245, 0.7); font-variant-numeric: tabular-nums; user-select: text; cursor: text; }
.nge-mbx-caret { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; flex-shrink: 0; margin-right: 2px;
  border-radius: 999px; cursor: pointer; color: #9fdcff; background: rgba(100, 200, 255, 0.12); border: 1px solid rgba(100, 200, 255, 0.4); }
.nge-mbx-caret:hover { background: rgba(100, 200, 255, 0.22); border-color: rgba(100, 200, 255, 0.75); color: #d4f0ff; }
.nge-mbx-caret--on { background: rgba(79, 207, 255, 0.26); border-color: #4fcfff; color: #e6f7ff; }
.nge-mbx-btn--send { margin-top: 8px; }
.nge-mbx-notes--slim { margin: 4px 0 6px; padding: 4px 0; max-height: 18vh; }
.nge-mbx-btn--headsend { padding: 3px 10px; font-size: 13px; }
.nge-mbx-btn--next { margin-left: auto; }
.nge-mbx-x { font: inherit; font-size: 20px; line-height: 1; padding: 0 4px; margin-left: 4px; background: none; border: none; color: rgba(220, 230, 245, 0.7); cursor: pointer; }
.nge-mbx-x:hover { color: #fff; }
.nge-mbx-how { margin: 6px 0; line-height: 1.45; color: rgba(220, 230, 245, 0.8); }
.nge-mbx-meta { margin: 4px 0; font-size: 13px; color: rgba(220, 230, 245, 0.6); }
.nge-mbx-quote { margin: 6px 0; padding: 4px 8px; border-left: 2px solid rgba(255, 255, 255, 0.3); white-space: pre-wrap; overflow-wrap: anywhere; }
.nge-mbx-notes { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; max-height: 30vh; overflow-y: auto; overflow-x: hidden; padding: 6px 0; border-top: 1px solid rgba(255, 255, 255, 0.1); border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.nge-mbx-note { display: flex; align-items: flex-start; gap: 6px; }
.nge-mbx-pin { display: flex; flex-direction: column; gap: 3px; }
.nge-mbx-replylink { flex: 0 0 auto; font: inherit; font-size: 13px; color: #9fc8ff; background: none; border: none; cursor: pointer; padding: 3px 2px; }
.nge-mbx-replylink:hover { text-decoration: underline; text-underline-offset: 3px; }
.nge-mbx-thread { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
.nge-mbx-msg { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 4px 8px; border-left: 2px solid rgba(159, 200, 255, 0.7); background: rgba(120, 180, 255, 0.06); border-radius: 0 6px 6px 0; overflow-wrap: anywhere; }
.nge-mbx-msg--mentor { border-left-color: #ffd166; background: rgba(255, 209, 102, 0.06); }
.nge-mbx-msg--reply { margin-left: 15px; font-size: 14px; }
.nge-mbx-who { font-size: 12px; font-weight: 600; color: #9fc8ff; }
.nge-mbx-msg--mentor .nge-mbx-who { color: #ffd166; }
.nge-mbx-said-text { flex: 1 1 100%; white-space: pre-wrap; color: #dce6f5; }
.nge-mbx-unsent { font-size: 12px; color: rgba(220, 230, 245, 0.6); }
.nge-mbx-msg .nge-mbx-rm { margin-left: auto; }
.nge-mbx-add--reply { margin-left: 15px; }
/* A block, so a long note wraps in the box (Ames 2026-11-06: "def not horizontal scroll"). */
.nge-mbx-fly { flex: 1; min-width: 0; display: block; font: inherit; color: #dce6f5; background: none; border: none; cursor: pointer; text-align: left; padding: 2px 0 2px 16px; text-indent: -16px; white-space: normal; overflow-wrap: anywhere; }
.nge-mbx-fly .nge-mbx-dot { display: inline-block; margin-right: 6px; text-indent: 0; vertical-align: 1px; }
.nge-mbx-fly:hover { text-decoration: underline; text-underline-offset: 3px; }
.nge-mbx-dot { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: #ffd166; transform: translateY(-1px); }
.nge-mbx-rm { font: inherit; font-size: 16px; line-height: 1; background: none; border: none; color: rgba(220, 230, 245, 0.55); cursor: pointer; }
.nge-mbx-rm:hover { color: #fff; }
.nge-mbx-add { display: flex; gap: 6px; }
.nge-mbx-add input, .nge-mbx-text { font: inherit; font-size: 14px; color: #fff; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; padding: 5px 7px; box-sizing: border-box; }
.nge-mbx-add input { flex: 1; min-width: 0; }
.nge-mbx-text { display: block; width: 100%; resize: vertical; margin-top: 6px; }
.nge-mbx-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.nge-mbx-btn { font: inherit; font-size: 14px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #dce6f5; cursor: pointer; }
.nge-mbx-btn:disabled { opacity: 0.5; cursor: default; }
.nge-mbx-btn--suggest { border-color: #f5d142; color: #f5d142; background: rgba(245, 209, 66, 0.1); margin-left: auto; }
.nge-mbx-btn--done { border-color: #7CFFB2; color: #7CFFB2; background: rgba(124, 255, 178, 0.1); }
.nge-mbx-err { color: #f5d142; margin: 8px 0 0; }
.nge-mbx-confirm { margin-top: 10px; padding: 10px 12px; border: 1px solid rgba(124, 255, 178, 0.35); border-radius: 8px; background: rgba(124, 255, 178, 0.06); }
.nge-mbx-confirm-q { margin: 0; font-size: 14px; line-height: 1.45; }
.nge-mbx-confirm .nge-mbx-actions { justify-content: flex-end; margin-top: 8px; }
.nge-mbx-preview { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.nge-mbx-ask { margin: 0; font-size: 16px; font-weight: 600; color: #eef4fb; }
.nge-mbx-terms li { list-style: none; position: relative; }
.nge-mbx-terms li::before { content: '•'; position: absolute; left: -14px; color: #9fc8ff; }
.nge-mbx .nge-mbx-terms { margin: 0; padding: 0 0 0 18px !important; display: flex; flex-direction: column; gap: 3px; font-size: 14px; line-height: 1.45; color: rgba(220, 230, 245, 0.85); }
.nge-mbx-said { color: rgba(124, 255, 178, 0.9); margin: 8px 0 0; font-size: 14px; }
.nge-mbx-actions--preview { margin-top: 0; }
.nge-mbx-alldone { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(124, 255, 178, 0.35); background: rgba(124, 255, 178, 0.06); color: #c9f5dc; font-size: 14px; }
.nge-mbx-next { margin-top: 10px; border-color: rgba(120, 180, 255, 0.6); color: #9fc8ff; background: rgba(120, 180, 255, 0.1); }
</style>
