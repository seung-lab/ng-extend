<script setup lang="ts">
/**
 * MentorAdmin: Admin Hub > Access, Mentor program (a proof of concept,
 * src/mentor.ts). Admins pick the mentors and, for now, add apprentices by
 * hand: a test site shares the live data, so no new player is enrolled
 * without an admin choosing them. Cells left 24 hours show here, and an admin
 * can take any of them in the Cell Library's Mentoring tab.
 */
import { onMounted, ref } from 'vue';
import { adminList, addMentor, removeMentor, addApprentice, removeApprentice, mentorState, loadMentor, shortCell, ago, type Apprentice, type MentorReview } from '../mentor';

const data = ref<{ mentors: { id: string; name: string }[]; apprentices: Apprentice[]; overdue: MentorReview[]; cellsNeeded: number; maxApprentices: number } | null>(null);
const mentorName = ref('');
const apprenticeName = ref('');
const busy = ref(false);
const error = ref('');
const said = ref('');
const open = ref(false);

async function load() {
  error.value = '';
  try { data.value = await adminList(); }
  catch (e: any) { error.value = /unknown action|Failed to fetch|\(404\)/i.test(e?.message || '') ? 'The mentor program is not installed yet (SQL and the ewMentor function).' : (e?.message || 'Could not load.'); }
}
onMounted(async () => { if (!mentorState.loaded) await loadMentor(); if (mentorState.installed) { open.value = true; await load(); } });

async function act(fn: () => Promise<any>, done: string) {
  busy.value = true; error.value = ''; said.value = '';
  try { await fn(); said.value = done; await load(); }
  catch (e: any) { error.value = e?.message || 'That did not go through.'; }
  finally { busy.value = false; }
}
function onToggle(e: Event) { open.value = (e.target as HTMLDetailsElement).open; if (open.value && !data.value) void load(); }
const addM = () => { const n = mentorName.value.trim(); if (n) void act(() => addMentor(n), `${n} is a mentor.`).then(() => { mentorName.value = ''; }); };
const addA = () => { const n = apprenticeName.value.trim(); if (n) void act(() => addApprentice(n), `${n} is an apprentice and got a welcome bell.`).then(() => { apprenticeName.value = ''; }); };
</script>

<template>
  <details class="nge-madm" :open="open" @toggle="onToggle">
    <summary>Mentor program <span v-if="data?.overdue.length" class="nge-madm-late">{{ data.overdue.length }} waiting over a day</span></summary>
    <p class="nge-madm-how">
      A proof of concept. An apprentice's next {{ data?.cellsNeeded ?? 5 }} cells go to a mentor before they count.
      Mentors take cells in Cell Library, Mentoring, at most {{ data?.maxApprentices ?? 5 }} apprentices each. Admins can mentor too. For now apprentices are added here by hand.
    </p>
    <p v-if="error" class="nge-madm-err" role="alert">{{ error }}</p>
    <p v-else-if="said" class="nge-madm-said" role="status">{{ said }}</p>
    <template v-if="data">
      <div v-if="data.overdue.length" class="nge-madm-block">
        <h4>Waiting over a day</h4>
        <div v-for="r in data.overdue" :key="r.id" class="nge-madm-row">
          <span>{{ r.apprenticeName }}, {{ shortCell(r) }}, {{ r.mentorName ? `with ${r.mentorName}` : 'not taken' }}, sent {{ ago(r.sentAt) }}</span>
        </div>
        <p class="nge-madm-how">Take any of these in Cell Library, Mentoring.</p>
      </div>
      <div class="nge-madm-block">
        <h4>Mentors</h4>
        <div v-for="m in data.mentors" :key="m.id" class="nge-madm-row">
          <span>{{ m.name }}</span>
          <button class="nge-madm-btn" :disabled="busy" @click="act(() => removeMentor(m.id), `${m.name} is no longer a mentor. Their apprentices went back to the queue.`)">Remove</button>
        </div>
        <div class="nge-madm-add">
          <input v-model="mentorName" placeholder="Username" @keydown.enter.prevent="addM" />
          <button class="nge-madm-btn" :disabled="busy || !mentorName.trim()" @click="addM">Add mentor</button>
        </div>
      </div>
      <div class="nge-madm-block">
        <h4>Apprentices</h4>
        <div v-for="a in data.apprentices" :key="a.id" class="nge-madm-row">
          <span>{{ a.name }}: {{ a.cellsDone }} of {{ a.cellsNeeded }}, {{ a.status === 'active' ? (a.mentorName ? `mentor ${a.mentorName}` : 'no mentor yet') : a.status }}</span>
          <button v-if="a.status === 'active'" class="nge-madm-btn" :disabled="busy" @click="act(() => removeApprentice(a.id), `${a.name} left the program. Their cells count normally from now on.`)">Remove</button>
        </div>
        <div class="nge-madm-add">
          <input v-model="apprenticeName" placeholder="Username" @keydown.enter.prevent="addA" />
          <button class="nge-madm-btn" :disabled="busy || !apprenticeName.trim()" @click="addA">Add apprentice</button>
        </div>
      </div>
    </template>
  </details>
</template>

<style scoped>
.nge-madm { margin: 0 0 14px; padding: 8px 12px; border: 1px solid rgba(120, 180, 255, 0.3); border-radius: 8px; background: rgba(120, 180, 255, 0.04); color: #dce6f5; font-size: 14px; }
.nge-madm summary { cursor: pointer; font-weight: 600; color: #9fc8ff; }
.nge-madm-late { margin-left: 8px; font-weight: 400; color: #f5d142; }
.nge-madm-how { margin: 6px 0; color: rgba(220, 230, 245, 0.75); line-height: 1.45; }
.nge-madm-block { margin: 10px 0 0; }
.nge-madm h4 { margin: 0 0 4px; font-size: 13px; color: rgba(220, 230, 245, 0.85); }
.nge-madm-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.nge-madm-row span { flex: 1; overflow-wrap: anywhere; }
.nge-madm-add { display: flex; gap: 6px; margin-top: 6px; }
.nge-madm-add input { flex: 1; min-width: 0; font: inherit; color: #fff; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; padding: 4px 7px; }
.nge-madm-btn { font: inherit; font-size: 13px; padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #dce6f5; cursor: pointer; white-space: nowrap; }
.nge-madm-btn:disabled { opacity: 0.5; cursor: default; }
.nge-madm-err { color: #f5d142; margin: 6px 0; }
.nge-madm-said { color: rgba(124, 255, 178, 0.9); margin: 6px 0; }
</style>
