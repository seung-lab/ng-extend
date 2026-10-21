<script setup lang="ts">
/**
 * A text the lab can change in the game (src/site_texts.ts): a list of steps
 * or one paragraph. Everyone sees the saved text, or the code's own when none
 * is saved. Admins also get a small Edit button (Celia 2026-10-20).
 */
import { computed, onMounted, ref } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { siteTexts, loadSiteTexts, saveSiteText, resetSiteText, textToHtml, textToSteps, htmlToText } from '../site_texts';

const props = defineProps<{
  textKey: string;
  /** The code's own text, as trusted HTML: a list of steps, or one paragraph. */
  original: string[] | string;
  listClass?: string;
  textClass?: string;
}>();
const emit = defineEmits<{ (e: 'action', name: string): void }>();

const backend = useProofreadingBackendStore();
onMounted(() => { void loadSiteTexts(); });

const isList = computed(() => Array.isArray(props.original));
const saved = computed(() => siteTexts[props.textKey]);
const steps = computed<string[]>(() => saved.value ? textToSteps(saved.value.body) : (props.original as string[]));
const paragraph = computed<string>(() => saved.value
  ? saved.value.body.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(textToHtml).join('<br>')
  : (props.original as string));

const editing = ref(false);
const draft = ref('');
const busy = ref(false);
const error = ref('');
function startEdit() {
  draft.value = saved.value ? saved.value.body
    : isList.value ? (props.original as string[]).map(htmlToText).join('\n\n') : htmlToText(props.original as string);
  error.value = '';
  editing.value = true;
}
async function save() {
  busy.value = true; error.value = '';
  try { await saveSiteText(props.textKey, draft.value.trim()); editing.value = false; }
  catch (e: any) { error.value = 'Not saved: ' + (e?.message || e); }
  finally { busy.value = false; }
}
async function restore() {
  if (!window.confirm('Put back the original text? Your saved version is removed for everyone.')) return;
  busy.value = true; error.value = '';
  try { await resetSiteText(props.textKey); editing.value = false; }
  catch (e: any) { error.value = 'Not restored: ' + (e?.message || e); }
  finally { busy.value = false; }
}
const savedNote = computed(() => {
  const s = saved.value;
  if (!s) return '';
  const when = s.at ? new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return `Edited${s.by ? ' by ' + s.by : ''}${when ? ', ' + when : ''}`;
});
/** Links to an in-game action ([words](#examples)) are clicks, not addresses. */
function onClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-nge-action]') as HTMLElement | null;
  if (!a) return;
  e.preventDefault();
  emit('action', a.dataset.ngeAction || '');
}
</script>

<template>
  <div class="nge-edtext" @click="onClick">
    <template v-if="!editing">
      <ol v-if="isList" :class="listClass"><li v-for="(s, i) in steps" :key="i" v-html="s"></li></ol>
      <div v-else :class="textClass" v-html="paragraph"></div>
      <div v-if="backend.isAdmin" class="nge-edtext-admin">
        <span v-if="savedNote" class="nge-edtext-note">{{ savedNote }}</span>
        <button type="button" class="nge-edtext-btn" title="Change this text for everyone. Admins only." @click.stop="startEdit">Edit</button>
      </div>
    </template>
    <div v-else class="nge-edtext-form" @click.stop>
      <textarea v-model="draft" class="nge-edtext-area" :rows="isList ? 10 : 5" spellcheck="true" maxlength="20000"></textarea>
      <div class="nge-edtext-hint">
        <template v-if="isList">Each step on its own line. </template>**bold** and [link words](https://...).
        <template v-if="textKey.startsWith('quest.')"> [words](#examples) opens the example cells.</template>
      </div>
      <div v-if="error" class="nge-edtext-error">{{ error }}</div>
      <div class="nge-edtext-actions">
        <button type="button" class="nge-edtext-btn nge-edtext-btn--save" :disabled="busy || !draft.trim()" @click="save">{{ busy ? 'Saving…' : 'Save for everyone' }}</button>
        <button type="button" class="nge-edtext-btn" :disabled="busy" @click="editing = false">Cancel</button>
        <button v-if="saved" type="button" class="nge-edtext-btn nge-edtext-btn--quiet" :disabled="busy" title="Remove the saved text and show the original" @click="restore">Restore original</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nge-edtext-admin { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.nge-edtext-note { font-size: 11px; color: rgba(214, 226, 245, 0.55); }
.nge-edtext-btn {
  background: rgba(255, 255, 255, 0.06); color: #d6e2f5; border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px; padding: 2px 9px; font: inherit; font-size: 11.5px; cursor: pointer;
}
.nge-edtext-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
.nge-edtext-btn:disabled { opacity: 0.5; cursor: default; }
.nge-edtext-btn--save { background: #2f6fd6; border-color: #2f6fd6; color: #fff; }
.nge-edtext-btn--save:hover:not(:disabled) { background: #3b7ce6; }
.nge-edtext-btn--quiet { margin-left: auto; }
.nge-edtext-form { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.nge-edtext-area {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 80px;
  background: rgba(0, 0, 0, 0.35); color: #e6edf7; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px;
  padding: 7px 8px; font: 12.5px/1.45 system-ui, sans-serif;
}
.nge-edtext-hint { font-size: 11px; color: rgba(214, 226, 245, 0.6); }
.nge-edtext-error { font-size: 12px; color: #ff9b9b; }
.nge-edtext-actions { display: flex; gap: 6px; align-items: center; }
</style>
