<script setup lang="ts">
/**
 * A text the lab can change in the game (src/site_texts.ts): a list of steps
 * or one paragraph. Everyone sees the saved text, or the code's own when none
 * is saved. Admins also get a small Edit button (Celia 2026-10-20).
 */
import { computed, onMounted, ref } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { siteTexts, loadSiteTexts, saveSiteText, resetSiteText, textToHtml, textToSteps, htmlToText } from '../site_texts';
import { isApprover } from '../tutorial_edits';
import { supabase } from '../supabase';

const props = defineProps<{
  textKey: string;
  /** The code's own text, as trusted HTML: a list of steps, or one paragraph. */
  original: string[] | string;
  listClass?: string;
  textClass?: string;
  /** Other admins' edits wait for an approver (Ames 2026-10-26, the Hunt's instructions: "If another admin
   *  edits it I want to get a notification to approve first"). The approvers' own go straight out. */
  approval?: boolean;
  /** The text's name in the approvers' note, e.g. "Hunt instructions". */
  label?: string;
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

// A suggestion waiting for approval is kept as its own site text, draft.<key>.
const draftKey = computed(() => `draft.${props.textKey}`.slice(0, 64));
const suggestion = computed(() => (props.approval ? siteTexts[draftKey.value] : undefined));
const approver = computed(() => isApprover(backend.userEmail));
const suggestionSteps = computed<string[]>(() => (suggestion.value ? textToSteps(suggestion.value.body) : []));
const sentNote = ref('');

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
  busy.value = true; error.value = ''; sentNote.value = '';
  try {
    if (props.approval && !approver.value) {
      // Someone else's edit: a suggestion, and the approvers get a note with the text now and as suggested.
      await saveSiteText(draftKey.value, draft.value.trim());
      editing.value = false;
      sentNote.value = 'Sent for approval. Players see it once it is approved.';
      try {
        const { data } = await supabase.from('admins').select('user_id,email');
        const ids = ((data as any[]) || []).filter(a => a.user_id && isApprover(a.email)).map(a => String(a.user_id));
        const now = saved.value ? saved.value.body : (isList.value ? (props.original as string[]).map(htmlToText).join('\n') : htmlToText(props.original as string));
        const quote = (t: string) => t.split(/\r?\n/).filter(l => l.trim()).map(l => `> ${l.trim()}`).join('\n');
        const what = props.label || 'An in-game text';
        for (const id of ids) {
          await backend.createNotification({ title: `📋 Text edit to approve: ${what}`, target_type: 'user', target_id: id,
            body: `**Now:**\n${quote(now)}\n\n**Suggested by ${backend.userName || 'an admin'}:**\n${quote(draft.value.trim())}\n\nOpen it in the game (${what}) to approve or turn it down.` });
        }
      } catch (e) { console.warn('[site texts] could not tell the approvers:', e); }
      return;
    }
    await saveSiteText(props.textKey, draft.value.trim());
    editing.value = false;
  }
  catch (e: any) { error.value = 'Not saved: ' + (e?.message || e); }
  finally { busy.value = false; }
}
async function approve() {
  const s = suggestion.value; if (!s) return;
  busy.value = true; error.value = '';
  try { await saveSiteText(props.textKey, s.body); await resetSiteText(draftKey.value); }
  catch (e: any) { error.value = 'Not approved: ' + (e?.message || e); }
  finally { busy.value = false; }
}
async function turnDown() {
  busy.value = true; error.value = '';
  try { await resetSiteText(draftKey.value); }
  catch (e: any) { error.value = 'Not turned down: ' + (e?.message || e); }
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
      <!-- A suggestion waiting: the approver sees it and decides; other admins see that it waits -->
      <div v-if="suggestion && backend.showAdminUi" class="nge-edtext-suggestion" @click.stop>
        <div class="nge-edtext-suggestion-head">Suggested{{ suggestion.by ? ` by ${suggestion.by}` : '' }}{{ approver ? '' : ': waiting for approval' }}</div>
        <ol v-if="approver && isList" :class="listClass"><li v-for="(s, i) in suggestionSteps" :key="i" v-html="s"></li></ol>
        <div v-if="approver" class="nge-edtext-actions">
          <button type="button" class="nge-edtext-btn nge-edtext-btn--save" :disabled="busy" @click="approve">Approve</button>
          <button type="button" class="nge-edtext-btn" :disabled="busy" @click="turnDown">Turn down</button>
        </div>
      </div>
      <div v-if="sentNote && backend.showAdminUi" class="nge-edtext-note">{{ sentNote }}</div>
      <div v-if="backend.showAdminUi" class="nge-edtext-admin">
        <span v-if="savedNote" class="nge-edtext-note">{{ savedNote }}</span>
        <button type="button" class="nge-edtext-btn" :title="approval && !approver ? 'Suggest a change: it shows once it is approved. Admins only.' : 'Change this text for everyone. Admins only.'" @click.stop="startEdit">{{ approval && !approver ? 'Suggest an edit' : 'Edit' }}</button>
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
        <button type="button" class="nge-edtext-btn nge-edtext-btn--save" :disabled="busy || !draft.trim()" @click="save">{{ busy ? 'Saving…' : approval && !approver ? 'Send for approval' : 'Save for everyone' }}</button>
        <button type="button" class="nge-edtext-btn" :disabled="busy" @click="editing = false">Cancel</button>
        <button v-if="saved && (!approval || approver)" type="button" class="nge-edtext-btn nge-edtext-btn--quiet" :disabled="busy" title="Remove the saved text and show the original" @click="restore">Restore original</button>
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
.nge-edtext-suggestion { margin-top: 6px; padding: 7px 9px; border-radius: 7px; border: 1px dashed rgba(245, 209, 66, 0.55); background: rgba(245, 209, 66, 0.06); display: flex; flex-direction: column; gap: 5px; }
.nge-edtext-suggestion-head { font-size: 11.5px; font-weight: 600; color: #f5d98a; }
</style>
