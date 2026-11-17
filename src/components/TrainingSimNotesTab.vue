<script setup lang="ts">
/**
 * TrainingSimNotesTab: Admin Hub > Training Sim notes (Ames 2026-11-17: "a way
 * for a user to leave a note on a skipped cell - where will that note go?").
 * The notes players leave when they skip or complete a sim cell, newest
 * first, with who, when, and a link that opens the cell on the Sandbox.
 * Kept with the play moments (sandbox_play_events), read through
 * ewSandboxMatch's admin only match.notes.
 */
import { ref, onMounted } from 'vue';
import { secureWrite } from '../secure_write';

interface SimNote {
  id: number; at: string; kind: 'skip' | 'complete'; score: number | null; note: string;
  player: string; taskId: number; root: string | null; pointNm: number[] | null;
}
const notes = ref<SimNote[]>([]);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true; error.value = '';
  try { notes.value = (await secureWrite<{ notes: SimNote[] }>('match.notes', { limit: 150 })).notes ?? []; }
  catch (e: any) { error.value = e?.message || 'The notes could not be loaded.'; }
  finally { loading.value = false; }
}
onMounted(load);

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A Sandbox view of the cell as the player left it, at its soma, 2D beside 3D. */
function cellLink(n: SimNote): string | null {
  if (!n.root) return null;
  const at = n.pointNm ? [n.pointNm[0] / 4, n.pointNm[1] / 4, n.pointNm[2] / 40].map(Math.round) : undefined;
  const state = {
    dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] },
    ...(at ? { position: at } : {}),
    crossSectionScale: 1.1, projectionScale: 42000,
    layers: [
      { type: 'image', source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em', name: 'img' },
      { type: 'segmentation', source: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2', name: 'pinky_nf_v2', segments: [n.root] },
    ],
    layout: 'xy-3d',
  };
  return `${location.origin}${location.pathname}#!${encodeURIComponent(JSON.stringify(state))}`;
}
</script>

<template>
  <div class="nge-admin-section nge-simnotes">
    <div class="nge-simnotes-head">
      <p class="nge-simnotes-intro">What players wrote when they skipped or completed a Training Sim cell. Newest first.</p>
      <button class="nge-simnotes-refresh" type="button" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Refresh' }}</button>
    </div>
    <p v-if="error" class="nge-simnotes-error">{{ error }}</p>
    <p v-else-if="!loading && !notes.length" class="nge-simnotes-empty">No notes yet.</p>
    <ul v-else class="nge-simnotes-list">
      <li v-for="n in notes" :key="n.id" class="nge-simnotes-row">
        <div class="nge-simnotes-meta">
          <span class="nge-simnotes-kind" :class="'nge-simnotes-kind--' + n.kind">{{ n.kind === 'skip' ? 'Skipped' : 'Completed' }}</span>
          <b>{{ n.player }}</b>
          <span>{{ when(n.at) }}</span>
          <span v-if="n.kind === 'complete' && n.score != null">score {{ n.score }}%</span>
        </div>
        <p class="nge-simnotes-text">{{ n.note }}</p>
        <div class="nge-simnotes-cell">
          <span>Cell {{ n.root || 'unknown' }}</span>
          <a v-if="cellLink(n)" :href="cellLink(n) || undefined" target="_blank" rel="noopener">Open the cell</a>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.nge-simnotes-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.nge-simnotes-intro { margin: 0; flex: 1; color: #a9c3e0; font-size: 13px; }
.nge-simnotes-refresh { padding: 5px 12px; border: 1px solid rgba(127, 190, 255, .35); border-radius: 6px; background: rgba(74, 158, 255, .12); color: #e6f0ff; font: 600 12px/1 Inter, system-ui, sans-serif; cursor: pointer; }
.nge-simnotes-refresh:disabled { opacity: .5; cursor: default; }
.nge-simnotes-error { color: #ffb3bf; }
.nge-simnotes-empty { color: #8fa6c4; }
.nge-simnotes-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.nge-simnotes-row { padding: 10px 12px; border: 1px solid rgba(127, 190, 255, .18); border-radius: 8px; background: rgba(10, 20, 40, .55); }
.nge-simnotes-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: #8fa6c4; }
.nge-simnotes-meta b { color: #e6f0ff; }
.nge-simnotes-kind { padding: 2px 7px; border-radius: 999px; font-weight: 600; }
.nge-simnotes-kind--skip { background: rgba(255, 210, 120, .14); color: #ffe2a8; }
.nge-simnotes-kind--complete { background: rgba(95, 227, 161, .14); color: #a8f5cd; }
.nge-simnotes-text { margin: 6px 0; color: #e6f0ff; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.nge-simnotes-cell { display: flex; gap: 12px; align-items: center; font: 12px/1.3 ui-monospace, monospace; color: #8fa6c4; }
.nge-simnotes-cell a { font-family: Inter, system-ui, sans-serif; font-weight: 600; color: #7fd8ff; }
</style>
