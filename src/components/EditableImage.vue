<script setup lang="ts">
/**
 * A picture the lab can change in the game, as EditableText does for words
 * (Ames 2026-11-06: "retain the edit button and add an 'add image'"). The
 * site text `textKey` holds the picture's address in our own uploads, or
 * "none"; without one the code's own picture shows. Admins get Add image or
 * Change image, Remove image, and Use original. Ames is told of every change
 * by the server, before and after (functions/edit-notify.js).
 */
import { computed, onMounted, ref } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { siteTexts, loadSiteTexts, saveSiteText, resetSiteText, pictureFor } from '../site_texts';
import { secureUpload } from '../secure_upload';

const props = defineProps<{ textKey: string; original: string; alt: string; imgClass?: string }>();
const emit = defineEmits<{ (e: 'zoom', url: string): void }>();

const backend = useProofreadingBackendStore();
onMounted(() => { void loadSiteTexts(); });

const url = computed(() => pictureFor(props.textKey, props.original));
const saved = computed(() => siteTexts[props.textKey]);
const busy = ref(false);
const error = ref('');
const fileEl = ref<HTMLInputElement | null>(null);
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function pick() { error.value = ''; fileEl.value?.click(); }
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!TYPES.includes(file.type)) { error.value = 'Use a PNG, JPEG, GIF or WebP picture.'; return; }
  if (file.size > 3 * 1024 * 1024) { error.value = 'Pictures must be under 3 MB.'; return; }
  busy.value = true; error.value = '';
  try { await saveSiteText(props.textKey, await secureUpload(file, 'instructions')); }
  catch (err: any) { error.value = 'Not saved: ' + (err?.message || err); }
  finally { busy.value = false; }
}
async function remove() {
  if (!window.confirm('Remove this picture for everyone?')) return;
  busy.value = true; error.value = '';
  // With no picture of its own in the code, removing is going back to the code.
  try { if (props.original) await saveSiteText(props.textKey, 'none'); else await resetSiteText(props.textKey); }
  catch (err: any) { error.value = 'Not removed: ' + (err?.message || err); }
  finally { busy.value = false; }
}
async function useOriginal() {
  busy.value = true; error.value = '';
  try { await resetSiteText(props.textKey); }
  catch (err: any) { error.value = 'Not restored: ' + (err?.message || err); }
  finally { busy.value = false; }
}
const savedNote = computed(() => {
  const s = saved.value;
  if (!s) return '';
  const when = s.at ? new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return `Changed${s.by ? ' by ' + s.by : ''}${when ? ', ' + when : ''}`;
});
</script>

<template>
  <div class="nge-edimg">
    <img v-if="url" :src="url" :alt="alt" :class="imgClass" title="Click to see it full size" @click="emit('zoom', url)" />
    <button v-else-if="backend.showAdminUi" type="button" class="nge-edimg-empty" :disabled="busy" @click="pick">
      <span class="nge-edimg-plus" aria-hidden="true">+</span>{{ busy ? 'Uploading…' : 'Add image' }}
    </button>
    <div v-if="backend.showAdminUi" class="nge-edimg-admin">
      <span v-if="savedNote" class="nge-edimg-note">{{ savedNote }}</span>
      <button v-if="url" type="button" class="nge-edimg-btn" :disabled="busy" title="Upload a picture to show here for everyone. Admins only." @click="pick">{{ busy ? 'Uploading…' : 'Change image' }}</button>
      <button v-if="url" type="button" class="nge-edimg-btn" :disabled="busy" title="Show no picture here. Admins only." @click="remove">Remove image</button>
      <button v-if="saved && original && url !== original" type="button" class="nge-edimg-btn" :disabled="busy" title="Show the picture that came with the game" @click="useOriginal">Use original</button>
    </div>
    <div v-if="error" class="nge-edimg-error" role="alert">{{ error }}</div>
    <input ref="fileEl" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="nge-edimg-file" @change="onFile" />
  </div>
</template>

<style scoped>
.nge-edimg-file { display: none; }
.nge-edimg-empty {
  width: 100%; aspect-ratio: 16 / 10;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  border: 1px dashed rgba(126, 202, 255, 0.45); border-radius: 8px;
  background: rgba(126, 202, 255, 0.05); color: #9fd8ff;
  font: 600 13px/1 'Inter', sans-serif; cursor: pointer;
}
.nge-edimg-empty:hover:not(:disabled) { background: rgba(126, 202, 255, 0.12); color: #eaf6ff; }
.nge-edimg-plus { font-size: 26px; font-weight: 400; }
.nge-edimg-admin { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.nge-edimg-note { font-size: 11px; color: rgba(214, 226, 245, 0.55); margin-right: auto; }
/* EditableText's Edit button, so the two read as one set. */
.nge-edimg-btn {
  background: rgba(255, 255, 255, 0.06); color: #d6e2f5; border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px; padding: 2px 9px; font: inherit; font-size: 11.5px; cursor: pointer;
}
.nge-edimg-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
.nge-edimg-btn:disabled { opacity: 0.5; cursor: default; }
.nge-edimg-error { margin-top: 6px; font-size: 12px; color: #ff9b9b; }
</style>
