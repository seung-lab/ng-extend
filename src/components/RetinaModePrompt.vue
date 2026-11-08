<script setup lang="ts">
/**
 * Asks once, of every player who has claimed or completed a Retina cell
 * (bipolar cells and the rest; Cilia Quests are their own table and do not
 * count), whether their Retina claims open with Highlight (one Checked layer)
 * or with the five annotation layers (Ames 2026-11-08). The answer is the
 * retinaAnnotationLayers setting (Profile, Settings, Jumping and views);
 * retinaModeAsked keeps it from asking again, on any computer.
 */
import { ref, watch } from 'vue';
import { supabase } from '../supabase';
import { useUserPreferencesStore, useProofreadingBackendStore } from '../store';
import { RETINA_DATASET } from '../util/retina_layers';

const GUIDE = 'https://connectome.quest/blog/guide-to-mapping-bipolar-cells-bcs/';
const prefs = useUserPreferencesStore();
const backend = useProofreadingBackendStore();

const show = ref(false);
const annotations = ref(false);
const info = ref(false);
let checkedFor = '';

/** Has this player ever held or finished a Retina cell? A claim keeps
 *  assigned_to while held and once completed; the completions list covers
 *  the rest. */
async function hasRetinaCell(uid: string): Promise<boolean> {
  const held = await supabase.from('proofreading_tasks').select('id', { count: 'exact', head: true })
    .eq('dataset', RETINA_DATASET).eq('assigned_to', uid);
  if ((held.count ?? 0) > 0) return true;
  const done = await supabase.from('ew_cell_completions').select('user_id', { count: 'exact', head: true })
    .eq('user_id', uid).ilike('dataset', '%retina%');
  return (done.count ?? 0) > 0;
}

watch(() => [backend.userId, prefs.accountLoaded] as const, async ([uid, loaded]) => {
  if (!uid || !loaded || checkedFor === uid) return;
  checkedFor = uid;
  if (prefs.prefs.retinaModeAsked) return;
  try {
    if (!(await hasRetinaCell(uid))) return;
  } catch { checkedFor = ''; return; }
  // Let the game finish opening first.
  setTimeout(() => {
    if (prefs.prefs.retinaModeAsked) return;
    annotations.value = prefs.prefs.retinaAnnotationLayers === true;
    show.value = true;
  }, 5000);
}, { immediate: true });

function save() {
  prefs.save({ retinaAnnotationLayers: annotations.value, retinaModeAsked: true });
  show.value = false;
}
function openSettings() {
  save();
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'settings' } }));
}
</script>

<template>
  <transition name="nge-rmp">
    <div v-if="show" class="ng-extend nge-rmp" role="dialog" aria-labelledby="nge-rmp-title">
      <div class="nge-rmp-head">
        <h2 id="nge-rmp-title" class="nge-rmp-title">Retina cells: how should they open?</h2>
        <button type="button" class="nge-rmp-info" :aria-expanded="info" aria-label="About this choice" title="About this choice" @click="info = !info">i</button>
      </div>
      <p v-if="info" class="nge-rmp-note">
        Pyr now opens Retina cells with Highlight for new players.
        <a :href="GUIDE" target="_blank" rel="noopener">Guide to mapping bipolar cells</a>
      </p>
      <p class="nge-rmp-text">Pyr can now open your bipolar cells and other Retina cells with Highlight or with the annotation layers. Please choose below.</p>
      <div class="nge-rmp-choice" role="radiogroup" aria-label="Retina cells open with">
        <button type="button" role="radio" :aria-checked="!annotations" class="nge-rmp-opt" :class="{ 'nge-rmp-opt--on': !annotations }" @click="annotations = false">
          <span class="nge-rmp-opt-name">Highlight</span>
          <span class="nge-rmp-opt-sub">One Checked layer to mark with</span>
        </button>
        <button type="button" role="radio" :aria-checked="annotations" class="nge-rmp-opt" :class="{ 'nge-rmp-opt--on': annotations }" @click="annotations = true">
          <span class="nge-rmp-opt-name">Annotation layers</span>
          <span class="nge-rmp-opt-sub">Soma, True End, Can't Fix, Hits Edge, Notes</span>
        </button>
      </div>
      <p class="nge-rmp-where">
        You can change this any time in
        <button type="button" class="nge-rmp-link" @click="openSettings">Profile, Settings, Jumping and views</button>.
      </p>
      <div class="nge-rmp-actions">
        <button type="button" class="nge-hud-btn nge-rmp-save" @click="save">Save</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.nge-rmp {
  position: fixed; top: 58px; right: 16px; z-index: 9400;
  width: 380px; max-width: calc(100vw - 32px);
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px 18px; border-radius: 10px;
  border: 1px solid rgba(74, 150, 224, 0.4); background: rgba(8, 13, 24, 0.97);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 0 40px rgba(74, 150, 224, 0.12);
  color: rgba(226, 238, 251, 0.92); font-family: 'Roboto', 'Inter', sans-serif; font-size: 14px; line-height: 1.45;
}
.nge-rmp-head { display: flex; align-items: center; gap: 10px; }
.nge-rmp-title {
  flex: 1; margin: 0; font-family: 'Orbitron', 'Inter', sans-serif; font-size: 13px; font-weight: 600;
  letter-spacing: 0.08em; color: #7ecaff;
}
.nge-rmp-info {
  flex: none; width: 22px; height: 22px; border-radius: 50%; padding: 0; cursor: pointer;
  border: 1px solid rgba(126, 202, 255, 0.55); background: transparent; color: #7ecaff;
  font: 600 12px/1 Georgia, serif; text-transform: none;
}
.nge-rmp-info[aria-expanded='true'], .nge-rmp-info:hover { background: rgba(126, 202, 255, 0.14); }
.nge-rmp-note {
  margin: 0; padding: 8px 10px; border-radius: 6px; background: rgba(74, 150, 224, 0.1);
  border: 1px solid rgba(74, 150, 224, 0.25); font-size: 13px;
}
.nge-rmp-note a { display: inline-block; margin-top: 2px; color: #8fd0ff; }
.nge-rmp-text, .nge-rmp-where { margin: 0; }
.nge-rmp-where { font-size: 13px; color: rgba(226, 238, 251, 0.72); }
.nge-rmp-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nge-rmp-opt {
  display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
  padding: 9px 10px; border-radius: 8px; font: inherit; color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.03);
}
.nge-rmp-opt:hover { border-color: rgba(126, 202, 255, 0.5); }
.nge-rmp-opt--on { border-color: #4aa8ff; background: rgba(74, 168, 255, 0.14); box-shadow: 0 0 0 1px #4aa8ff inset; }
.nge-rmp-opt-name { font-weight: 600; color: #e8f3ff; }
.nge-rmp-opt-sub { font-size: 12px; color: rgba(226, 238, 251, 0.65); }
.nge-rmp-link {
  padding: 0; border: 0; background: none; cursor: pointer; font: inherit; color: #8fd0ff; text-decoration: underline;
}
.nge-rmp-actions { display: flex; justify-content: flex-end; }
.nge-rmp-enter-active { transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-rmp-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.nge-rmp-enter-from, .nge-rmp-leave-to { opacity: 0; transform: translateY(-10px); }
@media (prefers-reduced-motion: reduce) {
  .nge-rmp-enter-active, .nge-rmp-leave-active { transition: opacity 0.2s; }
  .nge-rmp-enter-from, .nge-rmp-leave-to { transform: none; }
}
</style>
