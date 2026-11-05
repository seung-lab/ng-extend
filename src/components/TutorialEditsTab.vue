<script setup lang="ts">
/**
 * Admin Hub > Tutorial edits (Ames 2026-10-25): suggestions from admins
 * waiting for approval, and every box players now see reworded. Only the
 * approvers (tutorial_edits.ts) approve, turn down or put back.
 */
import { computed, onMounted, ref } from 'vue';
import { useProofreadingBackendStore } from '../store';
import { allEdits, approveDraft, isApprover, loadSiteTexts, rejectDraft, restoreBox, wordsToHtml, type EditRow } from '../tutorial_edits';

const backend = useProofreadingBackendStore();
const approver = computed(() => isApprover(backend.userEmail));
onMounted(() => { void loadSiteTexts(true); });
const waiting = computed(() => allEdits('draft'));
const live = computed(() => allEdits('live'));

const busy = ref('');
const error = ref('');
async function act(row: EditRow, what: 'approve' | 'reject' | 'restore') {
  if (what === 'restore' && !window.confirm(`Put back the original wording of ${row.name}, box ${row.box + 1}?`)) return;
  busy.value = `${row.tutorial}.${row.box}`; error.value = '';
  try {
    if (what === 'approve') await approveDraft(row.tutorial, row.box);
    else if (what === 'reject') await rejectDraft(row.tutorial, row.box);
    else await restoreBox(row.tutorial, row.box);
  } catch (e: any) { error.value = 'That did not work: ' + (e?.message || e); }
  finally { busy.value = ''; }
}
const when = (at: string) => at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const html = (words: string, kind: 'text' | 'html') => wordsToHtml(words, kind);
</script>

<template>
  <div class="nge-admin-section nge-tutedits">
    <p class="nge-tutedits-intro">Admins reword a tutorial box with the pencil on it. {{ approver ? 'Your own edits go straight to players; other admins\' wait here for you.' : 'Your edits wait here until Ames approves them.' }}</p>
    <div v-if="error" class="nge-tutedits-error">{{ error }}</div>

    <h3 class="nge-tutedits-h">Waiting for approval <span class="nge-tutedits-count">{{ waiting.length }}</span></h3>
    <p v-if="!waiting.length" class="nge-tutedits-empty">Nothing waiting.</p>
    <div v-for="row in waiting" :key="'d' + row.tutorial + '.' + row.box" class="nge-tutedits-card">
      <div class="nge-tutedits-where">{{ row.name }}, box {{ row.box + 1 }} <span class="nge-tutedits-by">{{ row.edit.by || 'An admin' }}, {{ when(row.edit.at) }}</span></div>
      <div class="nge-tutedits-cols">
        <div class="nge-tutedits-col nge-tutedits-col--old"><div class="nge-tutedits-label">Now</div><div class="nge-tutedits-title">{{ row.edit.from.title }}</div><div v-html="html(row.edit.from.words, row.edit.kind)"></div></div>
        <div class="nge-tutedits-col nge-tutedits-col--new"><div class="nge-tutedits-label">Suggested</div><div class="nge-tutedits-title">{{ row.edit.title }}</div><div v-html="html(row.edit.words, row.edit.kind)"></div></div>
      </div>
      <div v-if="approver" class="nge-tutedits-actions">
        <button type="button" class="nge-tutedits-btn nge-tutedits-btn--go" :disabled="!!busy" @click="act(row, 'approve')">Approve</button>
        <button type="button" class="nge-tutedits-btn" :disabled="!!busy" @click="act(row, 'reject')">Turn down</button>
      </div>
    </div>

    <h3 class="nge-tutedits-h">What players see now <span class="nge-tutedits-count">{{ live.length }}</span></h3>
    <p v-if="!live.length" class="nge-tutedits-empty">No box has been reworded yet.</p>
    <div v-for="row in live" :key="'l' + row.tutorial + '.' + row.box" class="nge-tutedits-card">
      <div class="nge-tutedits-where">{{ row.name }}, box {{ row.box + 1 }} <span class="nge-tutedits-by">{{ row.edit.by || 'An admin' }}, {{ when(row.edit.at) }}</span></div>
      <div class="nge-tutedits-cols">
        <div class="nge-tutedits-col nge-tutedits-col--old"><div class="nge-tutedits-label">Original</div><div class="nge-tutedits-title">{{ row.edit.from.title }}</div><div v-html="html(row.edit.from.words, row.edit.kind)"></div></div>
        <div class="nge-tutedits-col nge-tutedits-col--new"><div class="nge-tutedits-label">Shown</div><div class="nge-tutedits-title">{{ row.edit.title }}</div><div v-html="html(row.edit.words, row.edit.kind)"></div></div>
      </div>
      <div v-if="approver" class="nge-tutedits-actions">
        <button type="button" class="nge-tutedits-btn" :disabled="!!busy" @click="act(row, 'restore')">Put back the original</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nge-tutedits { display: flex; flex-direction: column; gap: 10px; }
.nge-tutedits-intro, .nge-tutedits-empty { margin: 0; color: #9fb3cc; font-size: 12.5px; }
.nge-tutedits-error { color: #ff9b9b; font-size: 12px; }
.nge-tutedits-h { margin: 8px 0 0; font-size: 13px; color: #dce6f5; display: flex; align-items: center; gap: 8px; }
.nge-tutedits-count { font-size: 11px; padding: 0 7px; border-radius: 999px; background: rgba(126, 202, 255, 0.15); color: #7ecaff; }
.nge-tutedits-card { border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 10px 12px; background: rgba(255, 255, 255, 0.025); }
.nge-tutedits-where { font-weight: 600; color: #fff; font-size: 13px; margin-bottom: 8px; }
.nge-tutedits-by { font-weight: 400; color: #8ea2bd; font-size: 11.5px; margin-left: 6px; }
.nge-tutedits-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 640px) { .nge-tutedits-cols { grid-template-columns: 1fr; } }
.nge-tutedits-col { font-size: 12.5px; line-height: 1.45; color: #cfdcef; padding: 8px 10px; border-radius: 6px; min-width: 0; overflow-wrap: anywhere; }
.nge-tutedits-col :deep(p) { margin: 0 0 6px; }
.nge-tutedits-col :deep(a) { color: #7ecaff; }
.nge-tutedits-col--old { background: rgba(255, 255, 255, 0.03); color: #9fb3cc; }
.nge-tutedits-col--new { background: rgba(126, 224, 255, 0.07); }
.nge-tutedits-label { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #7ecaff; margin-bottom: 4px; }
.nge-tutedits-title { font-weight: 600; margin-bottom: 4px; }
.nge-tutedits-actions { display: flex; gap: 6px; margin-top: 8px; }
.nge-tutedits-btn {
  background: rgba(255, 255, 255, 0.06); color: #d6e2f5; border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px; padding: 3px 12px; font: inherit; font-size: 12px; cursor: pointer;
}
.nge-tutedits-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
.nge-tutedits-btn:disabled { opacity: 0.5; cursor: default; }
.nge-tutedits-btn--go { background: #2f8a4e; border-color: #2f8a4e; color: #fff; }
.nge-tutedits-btn--go:hover:not(:disabled) { background: #37a05b; }
</style>
