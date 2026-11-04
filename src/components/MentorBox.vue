<script setup lang="ts">
/**
 * MentorBox: one mentor program cell open in the view (src/mentor.ts).
 *
 * A mentor drops notes as points ("cut here", "you missed an extension"),
 * either with Add here (at the view's center) or with the annotation tools in
 * the Mentor notes layer (a point's description is its note), writes a note
 * for the whole cell, then sends suggestions or completes the cell, which
 * counts for the apprentice. The apprentice sees the same notes, read only.
 * The look and the dragging are the access review box's (AccessReviewBar.vue).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useDragBox } from '../util/drag_box';
import { useProofreadingBackendStore } from '../store';
import { inView, closeView, hasNotesLayer, readNotesLayer, writeNotesLayer, viewerPosition, flyTo, saveNotes, sendSuggestions,
  completeForApprentice, startMentor, loadMentor, shortCell, type MentorNote } from '../mentor';

// Start the program's status read once a player is signed in.
const backend = useProofreadingBackendStore();
watch(() => backend.userId, id => { if (id) startMentor(); }, { immediate: true });

const boxEl = ref<HTMLElement | null>(null);
const { dragging, posStyle, startDrag } = useDragBox('nge_mentor_box_pos', boxEl);

const cur = computed(() => inView.value);
const r = computed(() => cur.value?.review ?? null);
const mentor = computed(() => cur.value?.role === 'mentor');
const canAct = computed(() => mentor.value && r.value?.state === 'looking');

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
  error.value = ''; said.value = ''; newNote.value = '';
  cellNote.value = c?.review.cellNote ?? '';
  notes.value = c?.review.notes ?? [];
  if (c) timer = window.setInterval(() => {
    // Before the saved view has loaded, the layer is not there yet: keep the saved list.
    if (hasNotesLayer()) notes.value = readNotesLayer();
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
function remove(id: string) {
  const list = readNotesLayer().filter(n => n.id !== id);
  writeNotesLayer(list);
  notes.value = list;
}

async function run(what: 'save' | 'suggest' | 'complete') {
  if (!r.value) return;
  if (what === 'complete' && !window.confirm(`Complete this cell for ${r.value.apprenticeName}? It counts for them now, and they can still read your notes.`)) return;
  busy.value = true; error.value = ''; said.value = '';
  try {
    if (what === 'save') { await saveNotes(cellNote.value); said.value = 'Saved. Only you see them until you send them.'; }
    else if (what === 'suggest') { await sendSuggestions(cellNote.value); said.value = `Sent. ${r.value.apprenticeName} gets a bell with your suggestions.`; }
    else {
      const out = await completeForApprentice(cellNote.value);
      said.value = out.finished ? `Complete. That was ${r.value.apprenticeName}'s last mentor cell: you both get an Achievement.` : `Complete. It counts for ${r.value.apprenticeName}.`;
    }
  } catch (e: any) { error.value = e?.message || 'That did not go through.'; }
  finally { busy.value = false; }
}
function close() {
  closeView();
  if (!mentor.value) void loadMentor();
}
const STATE: Record<string, string> = {
  waiting: 'Waiting for a mentor.', looking: 'With your mentor.', suggestions: 'Your mentor has suggestions. Fix the cell, then press Complete on it in the Cell Library to send it again.',
  complete: 'Complete. It counts for you.',
};
</script>

<template>
  <div v-if="r" ref="boxEl" class="nge-mbx" :class="{ 'nge-mbx--dragging': dragging }" :style="posStyle" role="dialog" aria-label="Mentor program cell">
    <div class="nge-mbx-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-mbx-title">{{ mentor ? r.apprenticeName : 'Your mentor\'s notes' }}</span>
      <span class="nge-mbx-pos">{{ shortCell(r) }}{{ r.rounds > 1 ? `, try ${r.rounds}` : '' }}</span>
      <button class="nge-mbx-x" title="Close this box and take the notes away" aria-label="Close" @pointerdown.stop @click="close">×</button>
    </div>

    <template v-if="mentor">
      <p class="nge-mbx-how">Look over the cell. Leave notes where something needs work, then send suggestions, or complete it if it is done.</p>
      <p v-if="r.done.notes" class="nge-mbx-quote">{{ r.apprenticeName }}: {{ r.done.notes }}</p>
      <p v-if="r.done.status" class="nge-mbx-meta">Ending: {{ r.done.status }}</p>
    </template>
    <p v-else class="nge-mbx-how">{{ STATE[r.state] }}</p>

    <div class="nge-mbx-notes">
      <div v-for="(n, i) in notes" :key="n.id" class="nge-mbx-note">
        <button class="nge-mbx-fly" title="Fly to this note" @click="flyTo(n.position)"><span class="nge-mbx-dot"></span>{{ i + 1 }}. {{ n.text }}</button>
        <button v-if="canAct" class="nge-mbx-rm" title="Remove this note" @click="remove(n.id)">×</button>
      </div>
      <p v-if="!notes.length" class="nge-mbx-meta">{{ mentor ? 'No notes in the view yet.' : 'No notes in the view.' }}</p>
    </div>

    <template v-if="canAct">
      <div class="nge-mbx-add">
        <input v-model="newNote" maxlength="300" placeholder="A note at the center of the view" @keydown.enter.prevent="addHere" />
        <button class="nge-mbx-btn" :disabled="!newNote.trim()" @click="addHere">Add here</button>
      </div>
      <p class="nge-mbx-meta">Or place points in the Mentor notes layer with the annotation tools. A point's description is its note.</p>
      <textarea v-model="cellNote" class="nge-mbx-text" rows="3" maxlength="2000" placeholder="A note on the whole cell"></textarea>
      <div class="nge-mbx-actions">
        <button class="nge-mbx-btn" :disabled="busy" @click="run('save')">Save notes</button>
        <button class="nge-mbx-btn nge-mbx-btn--suggest" :disabled="busy" @click="run('suggest')">Send suggestions</button>
        <button class="nge-mbx-btn nge-mbx-btn--done" :disabled="busy" @click="run('complete')">Complete</button>
      </div>
    </template>
    <template v-else>
      <p v-if="r.cellNote" class="nge-mbx-quote">{{ r.mentorName || 'Mentor' }}: {{ r.cellNote }}</p>
      <p v-if="mentor" class="nge-mbx-meta">{{ r.state === 'complete' ? 'This cell is complete.' : 'This cell is back with the apprentice.' }}</p>
    </template>

    <p v-if="error" class="nge-mbx-err" role="alert">{{ error }}</p>
    <p v-else-if="said" class="nge-mbx-said" role="status">{{ said }}</p>
  </div>
</template>

<style scoped>
.nge-mbx {
  position: fixed; right: 16px; top: 64px; z-index: 9000;
  width: 380px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(120, 180, 255, 0.45);
  border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; font-size: 15px;
}
.nge-mbx-head { display: flex; align-items: baseline; gap: 8px; cursor: grab; user-select: none; touch-action: none; margin: -12px -14px 0; padding: 12px 14px 4px; }
.nge-mbx--dragging .nge-mbx-head { cursor: grabbing; }
.nge-mbx-title { font-size: 17px; font-weight: 600; color: #9fc8ff; }
.nge-mbx-pos { margin-left: auto; color: rgba(220, 230, 245, 0.7); }
.nge-mbx-x { font: inherit; font-size: 20px; line-height: 1; padding: 0 4px; margin-left: 4px; background: none; border: none; color: rgba(220, 230, 245, 0.7); cursor: pointer; }
.nge-mbx-x:hover { color: #fff; }
.nge-mbx-how { margin: 6px 0; line-height: 1.45; color: rgba(220, 230, 245, 0.8); }
.nge-mbx-meta { margin: 4px 0; font-size: 13px; color: rgba(220, 230, 245, 0.6); }
.nge-mbx-quote { margin: 6px 0; padding: 4px 8px; border-left: 2px solid rgba(255, 255, 255, 0.3); white-space: pre-wrap; overflow-wrap: anywhere; }
.nge-mbx-notes { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; max-height: 30vh; overflow-y: auto; padding: 6px 0; border-top: 1px solid rgba(255, 255, 255, 0.1); border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.nge-mbx-note { display: flex; align-items: flex-start; gap: 6px; }
.nge-mbx-fly { flex: 1; display: inline-flex; align-items: baseline; gap: 6px; font: inherit; color: #dce6f5; background: none; border: none; cursor: pointer; text-align: left; padding: 2px 0; overflow-wrap: anywhere; }
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
.nge-mbx-said { color: rgba(124, 255, 178, 0.9); margin: 8px 0 0; font-size: 14px; }
</style>
