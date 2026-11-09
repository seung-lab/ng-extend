<script setup lang="ts">
/**
 * PlayButton.vue: the Play button at the top left of the view, and the card
 * that asks which kind of task to play (Ames 2026-11-09). See util/play.ts.
 *
 * The card compares the two kinds, mapping and annotation, so a player can
 * choose; mapping is picked to begin with ("we want them to check BCs as
 * default but I like choice"). Once chosen, Play goes straight in, and the
 * Play bar in the Cell Library can open the card again.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { play, pressPlay, startPlay, savedKind, canQuest, mappingWhere, type PlayKind } from '../util/play';
import { useProofreadingBackendStore } from '../store';

const backend = useProofreadingBackendStore();
const signedIn = computed(() => !!backend.userId);
const picked = ref<PlayKind>('cells');
const questsOk = computed(() => canQuest());
const where = computed(() => mappingWhere());
const busy = ref(false);

watch(() => play.choosing, open => {
  if (!open) return;
  const k = savedKind();
  picked.value = k === 'quests' && questsOk.value ? 'quests' : 'cells';
});

async function go() {
  if (busy.value) return;
  busy.value = true;
  try { await startPlay(picked.value); } finally { busy.value = false; }
}
function onButton() {
  // Playing already: back to the task in hand.
  if (play.on) { void startPlay(play.on); return; }
  pressPlay();
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && play.choosing) { e.stopPropagation(); play.choosing = false; } }
onMounted(() => document.addEventListener('keydown', onKey, true));
onUnmounted(() => document.removeEventListener('keydown', onKey, true));
</script>

<template>
  <Teleport to="body">
    <button v-if="signedIn" class="nge-play-btn" :class="{ 'nge-play-btn--on': !!play.on }" @click="onButton"
            :title="play.on ? 'Playing: back to the task you are on' : 'Play: Pyr finds you a task, claims it and takes you there. After each one, the next.'">
      <svg class="nge-play-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>
      <span>{{ play.on ? 'Playing' : 'Play' }}</span>
    </button>

    <div v-if="play.choosing" class="nge-play-screen" @click.self="play.choosing = false">
      <div class="nge-play-card" role="dialog" aria-label="Choose what to play">
        <button class="nge-play-close" aria-label="Close" @click="play.choosing = false">×</button>
        <div class="nge-play-kicker">Play</div>
        <div class="nge-play-title">What would you like to do?</div>
        <div class="nge-play-sub">Pyr claims a task for you and takes you there. When you finish one, the next is waiting.</div>
        <div class="nge-play-options" role="radiogroup" aria-label="Kind of task">
          <button type="button" role="radio" class="nge-play-opt nge-play-opt--map" :class="{ 'nge-play-opt--on': picked === 'cells' }"
                  :aria-checked="picked === 'cells' ? 'true' : 'false'" @click="picked = 'cells'" @dblclick="go">
            <span class="nge-play-opt-kind">Mapping</span>
            <span class="nge-play-opt-name">Map a neuron</span>
            <span class="nge-play-opt-where">{{ where }}</span>
            <span class="nge-play-opt-line"><b>You</b> fix the cell's 3D shape where the AI got it wrong.</span>
            <span class="nge-play-opt-line"><b>Tools</b> Merge to add missing pieces, Cut to remove wrong ones.</span>
            <span class="nge-play-opt-line"><b>Finish</b> with Complete when the whole cell is right.</span>
            <span class="nge-play-opt-line"><b>Good for</b> players who like fixing shapes and following branches.</span>
          </button>
          <button type="button" role="radio" class="nge-play-opt nge-play-opt--note" :class="{ 'nge-play-opt--on': picked === 'quests', 'nge-play-opt--off': !questsOk }"
                  :disabled="!questsOk" :aria-checked="picked === 'quests' ? 'true' : 'false'" @click="picked = 'quests'" @dblclick="go">
            <span class="nge-play-opt-kind">Annotation</span>
            <span class="nge-play-opt-name">Cilia Quest</span>
            <span class="nge-play-opt-where">Starburst cells on Retina</span>
            <span class="nge-play-opt-line"><b>You</b> find the cell's cilium, a tiny antenna, and mark it.</span>
            <span class="nge-play-opt-line"><b>Tools</b> Annotation points, in three layers made for the quest.</span>
            <span class="nge-play-opt-line"><b>Finish</b> with Submit and a cilium status.</span>
            <span class="nge-play-opt-line"><b>Good for</b> players who like hunting for small details.</span>
            <span v-if="!questsOk" class="nge-play-opt-lock">Unlocks with edit access on Retina</span>
          </button>
        </div>
        <div class="nge-play-actions">
          <span class="nge-play-note">You can change this any time from the Play bar.</span>
          <button class="nge-play-go" :disabled="busy" @click="go">
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>
            {{ busy ? 'Starting…' : picked === 'quests' ? 'Play Cilia Quests' : 'Play mapping' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.nge-play-btn {
  position: fixed;
  top: 56px;
  left: 10px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px 6px 11px;
  border-radius: 999px;
  border: 1px solid rgba(95, 216, 255, 0.55);
  background: linear-gradient(135deg, rgba(20, 60, 90, 0.92), rgba(40, 30, 90, 0.92));
  color: #dff6ff;
  font: 600 12.5px/1 Inter, system-ui, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 0 14px rgba(95, 216, 255, 0.25);
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.1s;
}
.nge-play-btn:hover { box-shadow: 0 0 20px rgba(95, 216, 255, 0.5); border-color: #5fd8ff; }
.nge-play-btn:active { transform: scale(0.97); }
.nge-play-icon { color: #5fd8ff; }
.nge-play-btn--on { border-color: #7dffb0; box-shadow: 0 0 14px rgba(125, 255, 176, 0.35); }
.nge-play-btn--on .nge-play-icon { color: #7dffb0; animation: nge-play-pulse 1.6s ease-in-out infinite; }
@keyframes nge-play-pulse { 50% { opacity: 0.45; } }

.nge-play-screen {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(2, 6, 14, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.nge-play-card {
  position: relative;
  width: min(640px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 22px 22px 18px;
  border-radius: 14px;
  border: 1px solid rgba(95, 216, 255, 0.35);
  background: linear-gradient(160deg, rgba(10, 22, 40, 0.98), rgba(18, 14, 42, 0.98));
  box-shadow: 0 0 40px rgba(95, 216, 255, 0.15);
  color: #d8e8f8;
  font-family: Inter, system-ui, sans-serif;
}
.nge-play-close {
  position: absolute; top: 10px; right: 12px;
  background: none; border: none; color: #8aa4c0; font-size: 20px; cursor: pointer;
}
.nge-play-close:hover { color: #fff; }
.nge-play-kicker { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #5fd8ff; }
.nge-play-title { font-size: 19px; font-weight: 700; margin: 4px 0 4px; color: #fff; }
.nge-play-sub { font-size: 13px; color: #a9bdd4; margin-bottom: 14px; }
.nge-play-options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { .nge-play-options { grid-template-columns: 1fr; } }
.nge-play-opt {
  display: flex; flex-direction: column; gap: 6px; text-align: left;
  padding: 14px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: inherit; font: inherit;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.nge-play-opt:hover:not(:disabled) { border-color: rgba(255, 255, 255, 0.25); }
.nge-play-opt--map.nge-play-opt--on { border-color: #5fd8ff; background: rgba(95, 216, 255, 0.08); box-shadow: 0 0 16px rgba(95, 216, 255, 0.2); }
.nge-play-opt--note.nge-play-opt--on { border-color: #ffd36e; background: rgba(255, 211, 110, 0.08); box-shadow: 0 0 16px rgba(255, 211, 110, 0.2); }
.nge-play-opt--off { opacity: 0.55; cursor: not-allowed; }
.nge-play-opt-kind { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; }
.nge-play-opt--map .nge-play-opt-kind { color: #5fd8ff; }
.nge-play-opt--note .nge-play-opt-kind { color: #ffd36e; }
.nge-play-opt-name { font-size: 16px; font-weight: 700; color: #fff; }
.nge-play-opt-where { font-size: 12px; color: #8fa8c4; margin-bottom: 4px; }
.nge-play-opt-line { font-size: 12.5px; line-height: 1.4; color: #c6d6e8; }
.nge-play-opt-line b { color: #fff; font-weight: 600; margin-right: 3px; }
.nge-play-opt-lock { margin-top: 4px; font-size: 12px; color: #ffb38a; }
.nge-play-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.nge-play-note { font-size: 12px; color: #8aa0b8; }
.nge-play-go {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border-radius: 999px; cursor: pointer;
  border: 1px solid #5fd8ff;
  background: linear-gradient(135deg, #1b6f9a, #4a3aa8);
  color: #fff; font: 700 13px/1 Inter, system-ui, sans-serif; letter-spacing: 0.04em;
  box-shadow: 0 0 16px rgba(95, 216, 255, 0.35);
}
.nge-play-go:disabled { opacity: 0.6; cursor: default; }
</style>
