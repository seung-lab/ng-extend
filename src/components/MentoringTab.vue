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
import { mentorState, loadMentor, loadQueue, takeCell, handBack, openInView, cannotOpen, shortCell, ago, practiceOffered, joinPractice, leavePractice, type MentorReview } from '../mentor';

const busy = ref<number | string | null>(null);
const error = ref('');
const q = computed(() => mentorState.queue);
const reviewer = computed(() => mentorState.mentor || mentorState.admin);
const a = computed(() => mentorState.apprentice);

const STATE: Record<MentorReview['state'], string> = {
  waiting: 'Waiting for a mentor', looking: 'With your mentor', suggestions: 'Your mentor has suggestions', complete: 'Complete, it counts for you',
};

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
async function take(r: MentorReview) {
  busy.value = r.id; error.value = '';
  try { const fresh = await takeCell(r); open(fresh, 'mentor'); }
  catch (e: any) { error.value = e?.message || 'Could not take that cell.'; await loadQueue().catch(() => {}); }
  finally { busy.value = null; }
}
async function giveBack(id: string, name: string) {
  if (!window.confirm(`Hand ${name} back? Their cells go back to the queue for another mentor.`)) return;
  busy.value = id; error.value = '';
  try { await handBack(id); } catch (e: any) { error.value = e?.message || 'Could not hand them back.'; }
  finally { busy.value = null; }
}
async function practice(join: boolean) {
  if (!join && !window.confirm('Leave practice? Cells you sent stay where they are; new ones count as usual.')) return;
  busy.value = 'practice'; error.value = '';
  try { await (join ? joinPractice() : leavePractice()); }
  catch (e: any) { error.value = e?.message || 'That did not go through.'; }
  finally { busy.value = null; }
}
const idleLong = (r: MentorReview) => Date.now() - Date.parse(r.touchedAt || r.sentAt) > 48 * 3600 * 1000;
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
    <section v-if="a" class="nge-mt-sec">
      <h4>Your mentor cells <span v-if="a.practice" class="nge-mt-n">practice</span></h4>
      <p class="nge-mt-how" v-if="a.status === 'active'">
        {{ a.cellsDone }} of {{ a.cellsNeeded }} done.
        {{ a.mentorName ? `${a.mentorName} is your mentor.` : 'A mentor takes your first cell when you send it.' }}
        When you complete a claimed cell, it goes to your mentor, who completes it with you or sends suggestions.
      </p>
      <p v-if="a.practice && a.status === 'active'" class="nge-mt-how">
        Practice: nothing you complete is recorded.
        <button class="nge-mt-btn" :disabled="busy === 'practice'" @click="practice(false)">Leave practice</button>
      </p>
      <p class="nge-mt-how" v-else-if="a.status === 'finished'">You finished the mentor program{{ a.mentorName ? ` with ${a.mentorName}` : '' }}. Your mentor's notes stay here.</p>
      <p v-if="!mentorState.mine.length" class="nge-mt-empty">No cells sent yet. Claim a cell, proofread it, and press Complete.</p>
      <div v-for="r in mentorState.mine" :key="r.id" class="nge-mt-row" :class="`nge-mt-row--${r.state}`">
        <div class="nge-mt-main">
          <span class="nge-mt-cell">{{ shortCell(r) }}</span>
          <span class="nge-mt-state">{{ r.state === 'complete' && r.done?.practice ? 'Complete (practice, nothing recorded)' : STATE[r.state] }}</span>
          <span v-if="r.notes.length || r.cellNote" class="nge-mt-meta">{{ r.notes.length }} note{{ r.notes.length === 1 ? '' : 's' }} in the view</span>
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
          Take a cell to look at it. The first cell you take from a new player makes you their mentor for the rest of their {{ mentorState.apprentice?.cellsNeeded || 5 }} cells.
          You are mentoring {{ q.slots.used }} of {{ q.slots.max }}.
        </p>
        <p v-if="!q.waiting.length" class="nge-mt-empty">Nothing is waiting.</p>
        <div v-for="r in q.waiting" :key="r.id" class="nge-mt-row">
          <div class="nge-mt-main">
            <span class="nge-mt-cell">{{ r.apprenticeName }}, {{ shortCell(r) }}</span>
            <span class="nge-mt-meta" :class="{ 'nge-mt-late': idleLong(r) }">sent {{ ago(r.sentAt) }}{{ r.rounds > 1 ? `, try ${r.rounds}` : '' }}</span>
          </div>
          <button class="nge-mt-btn nge-mt-btn--go" :disabled="busy === r.id" :title="cannotOpen(r)" @click="take(r)">{{ busy === r.id ? 'Taking…' : 'Take a look' }}</button>
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
          <button class="nge-mt-btn" :disabled="busy === p.id" title="Another mentor takes them from the queue" @click="giveBack(p.id, p.name)">Hand back</button>
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
.nge-mt-row--suggestions { border-left-color: #f5d142; }
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
.nge-mt-link { font: inherit; font-size: 12px; background: none; border: none; color: #9fd3ff; cursor: pointer; padding: 0; }
</style>
