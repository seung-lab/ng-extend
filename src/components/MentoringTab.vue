<script setup lang="ts">
/**
 * Mentoring (Cell Library): the mentor program, a proof of concept (Nseraf,
 * triage report 317; Ames 2026-11-04). src/mentor.ts.
 *
 * An apprentice sees their mentor cells and how many are done. A mentor sees
 * the cells nobody has taken (oldest first) and their own, takes one, and
 * opens it in the view with the review box (MentorBox.vue). Nobody matches
 * anyone: the first mentor to take an apprentice's cell stays with them.
 */
import { computed, onMounted, ref } from 'vue';
import { cellsSubmitted, stillShown, mentorState, loadMentor, loadQueue, handBack, openInView, cannotOpen, shortCell, ago, practiceOffered, joinPractice, leavePractice, type MentorReview } from '../mentor';

const busy = ref<number | string | null>(null);
const error = ref('');
const q = computed(() => mentorState.queue);
const reviewer = computed(() => mentorState.mentor || mentorState.admin);
const a = computed(() => mentorState.apprentice);
const submitted = computed(() => Math.max(cellsSubmitted(), a.value?.cellsDone ?? 0));

const STATE: Record<MentorReview['state'], string> = {
  waiting: 'Waiting for a mentor', looking: 'With your mentor', suggestions: 'Your mentor has suggestions', complete: 'Complete, it counts for you',
};
/** The apprentice's cells, as a status anyone can read at a glance (Ames
 *  2026-11-05: "can we make it clearer the status here?"): numbered in the
 *  order sent, the one waiting on the player first, then those with the
 *  mentor, then the completed ones, newest first. */
const ORDER: Record<MentorReview['state'], number> = { suggestions: 0, looking: 1, waiting: 2, complete: 3 };
const myCells = computed(() => {
  const sent = [...mentorState.mine].sort((x, y) => Date.parse(x.sentAt) - Date.parse(y.sentAt) || x.id - y.id);
  return sent.map((r, i) => ({ r, n: i + 1 }))
    .filter(x => stillShown(x.r))
    .sort((x, y) => ORDER[x.r.state] - ORDER[y.r.state] || Date.parse(y.r.decidedAt || y.r.sentAt) - Date.parse(x.r.decidedAt || x.r.sentAt));
});
function pill(r: MentorReview): string {
  if (r.state === 'suggestions') return 'Your turn: suggestions';
  if (r.state === 'looking') return r.mentorName ? `With ${r.mentorName}` : 'With your mentor';
  if (r.state === 'waiting') return 'Waiting for a mentor';
  return r.done?.practice ? 'Complete, practice' : 'Complete';
}
function rowHint(r: MentorReview): string {
  if (r.state === 'suggestions') return 'Open it to see the notes, fix the cell, then press Complete on it to send it again.';
  if (r.state === 'looking') return 'Your mentor is looking at it.';
  if (r.state === 'waiting') return 'A mentor takes it soon.';
  return r.done?.practice ? 'Practice, nothing was recorded.' : 'It counts for you.';
}

async function refresh() {
  error.value = '';
  try { await loadMentor(); if (reviewer.value) await loadQueue(); }
  catch (e: any) { error.value = e?.message || 'Could not load the mentor program.'; }
}
onMounted(refresh);

function open(r: MentorReview, role: 'mentor' | 'apprentice') {
  error.value = '';
  try { openInView(r, role); } catch (e: any) { error.value = e?.message || 'That cell cannot be opened here.'; }
}
/** A look first (Ames 2026-11-05: "that should not let me claim to be their
 *  mentor"): the cell opens in the view and nothing is taken until the box's
 *  own button is pressed. */
function take(r: MentorReview) { open(r, 'mentor'); }
// Asked in the row, never the browser's own box (Ames 2026-11-05).
const asking = ref<string | null>(null);
async function giveBack(id: string) {
  asking.value = null;
  busy.value = id; error.value = '';
  try { await handBack(id); } catch (e: any) { error.value = e?.message || 'Could not hand them back.'; }
  finally { busy.value = null; }
}
async function practice(join: boolean) {
  asking.value = null;
  busy.value = 'practice'; error.value = '';
  try { await (join ? joinPractice() : leavePractice()); }
  catch (e: any) { error.value = e?.message || 'That did not go through.'; }
  finally { busy.value = null; }
}
const idleLong = (r: MentorReview) => Date.now() - Date.parse(r.touchedAt || r.sentAt) > 24 * 3600 * 1000;
</script>

<template>
  <div class="nge-mt">
    <p v-if="error" class="nge-mt-err" role="alert">{{ error }}</p>

    <!-- Practice: a tester marks themself as a new player (test site only) -->
    <section v-if="practiceOffered() && (!a || a.status !== 'active') && !mentorState.mentor" class="nge-mt-sec">
      <h4>Try it as a new player</h4>
      <p class="nge-mt-how">Practice the mentor program from the new player's side. Your next {{ mentorState.apprentice?.cellsNeeded || 5 }} cells go to a mentor when you press Complete. Nothing you complete is recorded, and each cell is free again once your mentor completes it.</p>
      <button class="nge-mt-btn nge-mt-btn--go" :disabled="busy === 'practice'" @click="practice(true)">{{ busy === 'practice' ? 'Joining…' : 'Practice as a new player' }}</button>
    </section>

    <!-- The apprentice -->
    <section v-if="a && (a.status === 'active' || myCells.length)" class="nge-mt-sec">
      <h4>Your mentor cells <span v-if="a.practice" class="nge-mt-n">practice</span></h4>
      <!-- Submitted and reviewed, as the Sent to your mentor screen counts them (Ames 2026-11-06):
           reviewed cells filled, submitted ones waiting for review ringed in gold. -->
      <div class="nge-mt-progress" :aria-label="`${submitted} of ${a.cellsNeeded} submitted, ${a.cellsDone} of ${a.cellsNeeded} reviewed`">
        <span v-for="i in a.cellsNeeded" :key="i" class="nge-mt-dot" :class="{ 'nge-mt-dot--done': i <= a.cellsDone, 'nge-mt-dot--sent': i > a.cellsDone && i <= submitted }"></span>
        <span class="nge-mt-progress-text"><b>{{ submitted }}</b>/{{ a.cellsNeeded }} submitted</span>
        <span class="nge-mt-progress-text"><b>{{ a.cellsDone }}</b>/{{ a.cellsNeeded }} reviewed</span>
      </div>
      <p class="nge-mt-how" v-if="a.status === 'active'">
        {{ a.mentorName ? `${a.mentorName} is your mentor.` : 'A mentor takes your first cell when you send it.' }}
        When you complete a claimed cell, it goes to your mentor, who completes it with you or sends suggestions. Admins can read mentor notes.
      </p>
      <p v-if="a.practice && a.status === 'active'" class="nge-mt-how">
        Practice: nothing you complete is recorded.
        <button v-if="asking !== 'leave'" class="nge-mt-btn" :disabled="busy === 'practice'" @click="asking = 'leave'">Leave practice</button>
        <span v-else class="nge-mt-ask">Leave practice? Cells you sent stay where they are; new ones count as usual.
          <button class="nge-mt-btn" @click="asking = null">Cancel</button>
          <button class="nge-mt-btn nge-mt-btn--go" @click="practice(false)">Leave</button>
        </span>
      </p>
      <p class="nge-mt-how" v-else-if="a.status === 'finished'">You finished the mentor program{{ a.mentorName ? ` with ${a.mentorName}` : '' }}. Completed cells stay here for a week; your mentor's notes stay on each cell in My Cells.</p>
      <p v-if="!myCells.length" class="nge-mt-empty">{{ mentorState.mine.length ? 'Nothing waiting. Claim your next cell, proofread it, and press Complete.' : 'No cells sent yet. Claim a cell, proofread it, and press Complete.' }}</p>
      <div v-for="{ r, n } in myCells" :key="r.id" class="nge-mt-row" :class="`nge-mt-row--${r.state}`">
        <div class="nge-mt-main">
          <span class="nge-mt-cell">Cell {{ n }}</span>
          <span class="nge-mt-pill" :class="`nge-mt-pill--${r.state}`">{{ pill(r) }}</span>
          <span class="nge-mt-meta">{{ shortCell(r) }}<template v-if="r.notes.length">, {{ r.notes.length }} note{{ r.notes.length === 1 ? '' : 's' }} in the view</template></span>
          <span class="nge-mt-hint">{{ rowHint(r) }}</span>
        </div>
        <p v-if="r.cellNote && (r.state === 'suggestions' || r.state === 'complete')" class="nge-mt-quote">{{ r.mentorName || 'Mentor' }}: {{ r.cellNote }}</p>
        <button class="nge-mt-btn" :title="cannotOpen(r) || 'Open this cell with the notes'" @click="open(r, 'apprentice')">Open</button>
      </div>
    </section>

    <!-- Mentors and admins -->
    <template v-if="reviewer && q">
      <section class="nge-mt-sec">
        <h4>Waiting for a mentor <span class="nge-mt-n">{{ q.waiting.length }}</span></h4>
        <p class="nge-mt-how" v-if="mentorState.mentor">
          Take a look at a cell first. Nothing changes until you press Become their mentor in its box. Then you look at all of that player's mentor cells, and answer each within a day, or it goes back here for another mentor.
          You are mentoring {{ q.slots.used }} of {{ q.slots.max }}<template v-if="q.cellsReviewed">, and have reviewed {{ q.cellsReviewed }} cell{{ q.cellsReviewed === 1 ? '' : 's' }}</template>. Admins can read mentor notes.
        </p>
        <p v-if="!q.waiting.length" class="nge-mt-empty">Nothing is waiting.</p>
        <div v-for="r in q.waiting" :key="r.id" class="nge-mt-row">
          <div class="nge-mt-main">
            <span class="nge-mt-cell">{{ r.apprenticeName }}, {{ shortCell(r) }}</span>
            <span class="nge-mt-meta" :class="{ 'nge-mt-late': idleLong(r) }">sent {{ ago(r.sentAt) }}{{ r.rounds > 1 ? `, try ${r.rounds}` : '' }}</span>
          </div>
          <button class="nge-mt-btn nge-mt-btn--go" :disabled="busy === r.id" :title="cannotOpen(r)" @click="take(r)">Take a look</button>
        </div>
      </section>

      <section class="nge-mt-sec">
        <h4>Yours <span class="nge-mt-n">{{ q.yours.length }}</span></h4>
        <p v-if="!q.yours.length" class="nge-mt-empty">No cells with you right now.</p>
        <div v-for="r in q.yours" :key="r.id" class="nge-mt-row" :class="`nge-mt-row--${r.state}`">
          <div class="nge-mt-main">
            <span class="nge-mt-cell">{{ r.apprenticeName }}, {{ shortCell(r) }}</span>
            <span class="nge-mt-meta">{{ r.state === 'suggestions' ? 'with the apprentice, your suggestions sent' : `sent ${ago(r.sentAt)}` }}{{ r.rounds > 1 ? `, try ${r.rounds}` : '' }}</span>
          </div>
          <button class="nge-mt-btn nge-mt-btn--go" :disabled="r.state === 'suggestions'" :title="cannotOpen(r)" @click="open(r, 'mentor')">Open</button>
        </div>
      </section>

      <section v-if="q.apprentices.length" class="nge-mt-sec">
        <h4>Your apprentices</h4>
        <div v-for="p in q.apprentices" :key="p.id" class="nge-mt-row">
          <div class="nge-mt-main">
            <span class="nge-mt-cell">{{ p.name }}</span>
            <span class="nge-mt-meta">{{ p.cellsDone }} of {{ p.cellsNeeded }} done</span>
          </div>
          <button v-if="asking !== p.id" class="nge-mt-btn" :disabled="busy === p.id" title="Another mentor takes them from the queue" @click="asking = p.id">Hand back</button>
          <span v-else class="nge-mt-ask">Hand {{ p.name }} back? Their cells go to another mentor.
            <button class="nge-mt-btn" @click="asking = null">Cancel</button>
            <button class="nge-mt-btn nge-mt-btn--go" @click="giveBack(p.id)">Hand back</button>
          </span>
        </div>
      </section>
    </template>
    <button class="nge-mt-link" @click="refresh">Refresh</button>
  </div>
</template>

<style scoped>
.nge-mt { padding: 6px 10px 12px; color: #dce6f5; font-size: 13px; }
.nge-mt-sec { margin: 0 0 14px; }
.nge-mt h4 { margin: 4px 0 6px; font-size: 13px; font-weight: 600; color: #9fc8ff; letter-spacing: 0.02em; }
.nge-mt-n { color: rgba(220, 230, 245, 0.6); font-weight: 400; margin-left: 4px; }
.nge-mt-how { margin: 0 0 8px; line-height: 1.45; color: rgba(220, 230, 245, 0.75); }
.nge-mt-empty { margin: 0 0 6px; color: rgba(220, 230, 245, 0.55); }
.nge-mt-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 8px; padding: 6px 8px; margin-bottom: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08); border-left: 3px solid rgba(120, 180, 255, 0.5); border-radius: 6px; background: rgba(255, 255, 255, 0.03); }
.nge-mt-row--suggestions { border-left-color: #f5d142; background: rgba(245, 209, 66, 0.06); }
.nge-mt-row--waiting { border-left-color: rgba(220, 230, 245, 0.35); }
.nge-mt-pill { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid; white-space: nowrap; }
.nge-mt-pill--waiting { color: rgba(220, 230, 245, 0.75); border-color: rgba(220, 230, 245, 0.3); }
.nge-mt-pill--looking { color: #9fc8ff; border-color: rgba(120, 180, 255, 0.55); background: rgba(120, 180, 255, 0.1); }
.nge-mt-pill--suggestions { color: #f5d142; border-color: rgba(245, 209, 66, 0.6); background: rgba(245, 209, 66, 0.12); }
.nge-mt-pill--complete { color: #9fe8c0; border-color: rgba(124, 255, 178, 0.45); background: rgba(124, 255, 178, 0.08); }
.nge-mt-hint { flex-basis: 100%; font-size: 12px; color: rgba(220, 230, 245, 0.6); }
.nge-mt-progress { display: flex; align-items: center; gap: 7px; margin: 2px 0 8px; }
.nge-mt-dot { width: 11px; height: 11px; border-radius: 50%; border: 2px solid rgba(159, 200, 255, 0.5); }
.nge-mt-dot--sent { border-color: #f5d142; }
.nge-mt-dot--done { background: #7fb6ff; border-color: #7fb6ff; }
.nge-mt-progress-text { margin-left: 6px; font-size: 13px; color: rgba(220, 230, 245, 0.85); }
.nge-mt-progress-text b { color: #f5d142; }
.nge-mt-row--complete { border-left-color: rgba(124, 255, 178, 0.6); }
.nge-mt-main { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; min-width: 0; }
.nge-mt-cell { font-weight: 600; overflow-wrap: anywhere; }
.nge-mt-state { color: rgba(220, 230, 245, 0.85); }
.nge-mt-meta { color: rgba(220, 230, 245, 0.55); font-size: 12px; }
.nge-mt-late { color: #f5d142; }
.nge-mt-quote { grid-column: 1 / -1; margin: 2px 0 0; padding: 2px 8px; border-left: 2px solid rgba(255, 255, 255, 0.25); white-space: pre-wrap; color: rgba(220, 230, 245, 0.85); }
.nge-mt-row > .nge-mt-btn { grid-column: 2; grid-row: 1; }
.nge-mt-btn { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #dce6f5; cursor: pointer; white-space: nowrap; }
.nge-mt-btn:hover:not(:disabled) { background: rgba(120, 180, 255, 0.12); }
.nge-mt-btn:disabled { opacity: 0.5; cursor: default; }
.nge-mt-btn--go { border-color: rgba(120, 180, 255, 0.5); color: #9fc8ff; }
.nge-mt-err { color: #f5d142; margin: 0 0 8px; }
.nge-mt-ask { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: rgba(220, 230, 245, 0.85); }
.nge-mt-link { font: inherit; font-size: 12px; background: none; border: none; color: #9fd3ff; cursor: pointer; padding: 0; }
</style>
