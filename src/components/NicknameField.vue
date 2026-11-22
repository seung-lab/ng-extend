<script setup lang="ts">
/**
 * The Nickname box (Nseraf, report 602; Ames 2026-11-21: "Nickname it is"):
 * your own name for a cell, not a cell type. Only you see it. It saves as you
 * type and follows the cell through merges and cuts (util/nicknames.ts).
 * In the Lost Fragments checklist and the Cell Library's Complete form.
 */
import { ref, watch, onUnmounted } from 'vue';
import { nicknameOf, setNickname, NICKNAME_MAX } from '../util/nicknames';

const props = defineProps<{
  /** The cell's first ID: the listed ID of a claim or fragment. */
  segKey: string;
  /** Its other IDs now (after edits). */
  ids?: (string | null | undefined)[];
  /** A supervoxel inside it, when known. */
  anchor?: string | null;
  dataset?: string;
  /** Lost Fragments' look, or the Cell Library's. */
  look?: 'orph' | 'cl';
}>();

const text = ref('');
const state = ref<'' | 'saving' | 'saved' | 'local'>('');
function current() { return nicknameOf(props.segKey) || [...(props.ids || [])].map(i => nicknameOf(i)).find(Boolean) || ''; }
// Declared before the immediate watch below, which calls flush() at once
// (synapse123 report 616, Nseraf 617: "Cannot access before initialization").
let timer: ReturnType<typeof setTimeout> | undefined;
let pendingKey = '';
watch(() => props.segKey, () => { flush(); text.value = current(); state.value = ''; }, { immediate: true });
function onInput() {
  pendingKey = props.segKey;
  state.value = 'saving';
  clearTimeout(timer);
  timer = setTimeout(flush, 800);
}
function flush() {
  clearTimeout(timer);
  if (!pendingKey) return;
  const key = pendingKey; pendingKey = '';
  const value = text.value;
  void setNickname(key, value, { ids: props.ids, anchor: props.anchor, dataset: props.dataset })
    .then(ok => { if (key === props.segKey) state.value = ok ? 'saved' : 'local'; });
}
onUnmounted(flush);
</script>

<template>
  <div class="nge-nick" :class="'nge-nick--' + (look || 'cl')">
    <label class="nge-nick-label">
      <b>Nickname</b> <span class="nge-nick-sub">only you see this</span>
      <span v-if="state === 'saving'" class="nge-nick-state">Saving…</span>
      <span v-else-if="state === 'saved'" class="nge-nick-state nge-nick-state--ok">Saved</span>
      <span v-else-if="state === 'local'" class="nge-nick-state" title="Pyr could not reach the server, so it is kept in this browser for now.">Saved in this browser</span>
    </label>
    <input v-model="text" class="nge-nick-input" :maxlength="NICKNAME_MAX" placeholder="e.g. cell I merged a branch into"
           aria-label="Nickname, only you see this"
           title="Your own name for this cell. It is not a cell type and never goes to the lab. It shows instead of the number in My Cells and the side panel, and follows the cell through merges and cuts."
           @input="onInput" @blur="flush" @keydown.stop @keyup.stop @keypress.stop />
  </div>
</template>

<style scoped>
.nge-nick { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.nge-nick-label { display: flex; align-items: baseline; gap: 6px; font-size: 13px; color: #e6f0ff; }
.nge-nick-sub { font-size: 12px; color: #9fb4cc; font-weight: 400; }
.nge-nick-state { margin-left: auto; font-size: 11.5px; color: #9fb4cc; }
.nge-nick-state--ok { color: #6fe0b0; }
.nge-nick-input {
  width: 100%; box-sizing: border-box; padding: 6px 9px; border-radius: 6px;
  background: rgba(10, 20, 40, 0.7); border: 1px solid rgba(127, 190, 255, 0.28); color: #e6f0ff;
  font: 13px Inter, sans-serif; outline: none;
}
.nge-nick-input::placeholder { color: #6f86a3; }
.nge-nick-input:focus { border-color: rgba(126, 224, 255, 0.7); box-shadow: 0 0 10px rgba(74, 158, 255, 0.25); }
.nge-nick--cl .nge-nick-label { font-size: 12px; }
</style>
