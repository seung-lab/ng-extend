<script setup lang="ts">
/**
 * Reword one tutorial box (src/tutorial_edits.ts), opened from the pencil on
 * the box. An approver's save shows to players at once; anyone else's is a
 * suggestion that waits in Admin Hub > Tutorial edits.
 */
import { computed, onMounted, ref } from 'vue';
import type { Step } from '../store-pyr';
import { useProofreadingBackendStore } from '../store';
import { codeWording, draftEdit, isApprover, liveEdit, restoreBox, saveTutorialEdit, TUTORIAL_NAMES, wordsToHtml } from '../tutorial_edits';

const props = defineProps<{ tutorial: number; box: number; step: Step }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const backend = useProofreadingBackendStore();

const approver = computed(() => isApprover(backend.userEmail));
const code = computed(() => codeWording(props.step));
const live = computed(() => liveEdit(props.tutorial, props.box, props.step));
const draft = computed(() => draftEdit(props.tutorial, props.box));
const name = computed(() => TUTORIAL_NAMES[props.tutorial] ?? `Tutorial ${props.tutorial}`);

const title = ref('');
const words = ref('');
onMounted(() => {
  // An approver opens on a waiting suggestion, so saving it approves it.
  const start = (approver.value && draft.value) || live.value || code.value;
  title.value = start.title;
  words.value = start.words;
});
const preview = computed(() => wordsToHtml(words.value, code.value.kind));
const changed = computed(() => title.value !== (live.value || code.value).title || words.value !== (live.value || code.value).words);

const busy = ref(false);
const error = ref('');
const done = ref('');
async function save() {
  busy.value = true; error.value = '';
  try {
    const how = await saveTutorialEdit(props.tutorial, props.box, props.step, { title: title.value.trim(), words: words.value.trim() }, backend.userEmail,
      async (ids, t, b) => { for (const id of ids) await backend.createNotification({ title: t, body: b, target_type: 'user', target_id: id }); });
    if (how === 'live') emit('close');
    else done.value = 'Sent. Players see the change once it is approved.';
  } catch (e: any) { error.value = 'Not saved: ' + (e?.message || e); }
  finally { busy.value = false; }
}
async function restore() {
  if (!window.confirm('Put back the original wording of this box for everyone?')) return;
  busy.value = true; error.value = '';
  try { await restoreBox(props.tutorial, props.box); emit('close'); }
  catch (e: any) { error.value = 'Not restored: ' + (e?.message || e); }
  finally { busy.value = false; }
}
const when = (at: string) => at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
</script>

<template>
  <Teleport to="body">
    <div class="nge-tutedit-back" @mousedown.self="emit('close')" @keydown.stop>
      <div class="nge-tutedit" role="dialog" aria-label="Edit this tutorial box">
        <div class="nge-tutedit-head">
          <span class="nge-tutedit-where">{{ name }}, box {{ box + 1 }}</span>
          <button type="button" class="nge-tutedit-x" aria-label="Close" @click="emit('close')">×</button>
        </div>
        <p v-if="!approver" class="nge-tutedit-note">Your change goes to Ames for approval. Players keep seeing the current wording until then.</p>
        <p v-if="draft && approver" class="nge-tutedit-note nge-tutedit-note--wait">{{ draft.by || 'An admin' }} suggested this wording ({{ when(draft.at) }}). Saving approves it.</p>
        <p v-else-if="draft" class="nge-tutedit-note">A suggestion by {{ draft.by || 'an admin' }} is already waiting. Yours replaces it.</p>
        <p v-if="live" class="nge-tutedit-note">Edited by {{ live.by || 'an admin' }}, {{ when(live.at) }}.</p>

        <label class="nge-tutedit-label">Title</label>
        <input v-model="title" class="nge-tutedit-input" maxlength="200" spellcheck="true" />
        <label class="nge-tutedit-label">Words</label>
        <textarea v-model="words" class="nge-tutedit-area" rows="9" spellcheck="true"></textarea>
        <div class="nge-tutedit-hint">
          <template v-if="code.kind === 'text'">**bold**, *slanted*, [link words](https://...), and a blank line between paragraphs.</template>
          <template v-else>This box is written in HTML. Keep the tags as they are and change the words between them.</template>
        </div>
        <label class="nge-tutedit-label">How it will look</label>
        <div class="nge-tutedit-preview"><div class="nge-tutedit-preview-title">{{ title }}</div><div v-html="preview"></div></div>

        <div v-if="error" class="nge-tutedit-error">{{ error }}</div>
        <div v-if="done" class="nge-tutedit-done">{{ done }}</div>
        <div class="nge-tutedit-actions">
          <button v-if="!done" type="button" class="nge-tutedit-btn nge-tutedit-btn--save" :disabled="busy || !words.trim() || (!changed && !(approver && draft))" @click="save">
            {{ busy ? 'Saving…' : approver ? 'Save for everyone' : 'Send for approval' }}</button>
          <button type="button" class="nge-tutedit-btn" :disabled="busy" @click="emit('close')">{{ done ? 'Close' : 'Cancel' }}</button>
          <button v-if="approver && live && !done" type="button" class="nge-tutedit-btn nge-tutedit-btn--quiet" :disabled="busy" @click="restore">Put back the original</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-tutedit-back {
  position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center;
  background: rgba(2, 6, 14, 0.55);
}
.nge-tutedit {
  width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 6px; padding: 14px 16px 16px;
  background: #0d1526; color: #dce6f5; border: 1px solid rgba(126, 202, 255, 0.35); border-radius: 10px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6); font: 13px/1.45 'Roboto', system-ui, sans-serif;
}
.nge-tutedit-head { display: flex; align-items: center; justify-content: space-between; }
.nge-tutedit-where { font-weight: 600; color: #fff; }
.nge-tutedit-x { background: none; border: 0; color: #9fb3cc; font-size: 20px; cursor: pointer; line-height: 1; }
.nge-tutedit-x:hover { color: #fff; }
.nge-tutedit-note { margin: 0; font-size: 12px; color: #9fb3cc; }
.nge-tutedit-note--wait { color: #ffd27a; }
.nge-tutedit-label { margin-top: 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #7ecaff; }
.nge-tutedit-input, .nge-tutedit-area {
  width: 100%; box-sizing: border-box; background: rgba(0, 0, 0, 0.35); color: #e6edf7;
  border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; padding: 6px 8px; font: 12.5px/1.45 system-ui, sans-serif;
}
.nge-tutedit-area { resize: vertical; min-height: 120px; }
.nge-tutedit-hint { font-size: 11px; color: rgba(214, 226, 245, 0.6); }
.nge-tutedit-preview { padding: 8px 10px; border: 1px dashed rgba(126, 202, 255, 0.3); border-radius: 6px; background: rgba(255, 255, 255, 0.03); }
.nge-tutedit-preview-title { font-weight: 600; color: #fff; margin-bottom: 4px; }
.nge-tutedit-preview :deep(p) { margin: 0 0 6px; }
.nge-tutedit-preview :deep(a) { color: #7ecaff; }
.nge-tutedit-error { color: #ff9b9b; font-size: 12px; }
.nge-tutedit-done { color: #8be0a4; font-size: 12px; }
.nge-tutedit-actions { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
.nge-tutedit-btn {
  background: rgba(255, 255, 255, 0.06); color: #d6e2f5; border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px; padding: 4px 12px; font: inherit; font-size: 12px; cursor: pointer;
}
.nge-tutedit-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
.nge-tutedit-btn:disabled { opacity: 0.5; cursor: default; }
.nge-tutedit-btn--save { background: #2f6fd6; border-color: #2f6fd6; color: #fff; }
.nge-tutedit-btn--save:hover:not(:disabled) { background: #3b7ce6; }
.nge-tutedit-btn--quiet { margin-left: auto; }
</style>
