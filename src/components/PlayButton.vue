<script setup lang="ts">
/**
 * PlayButton.vue: the Play button at the top left of the view, and the card
 * that asks which kind of task to play (Ames 2026-11-09). See util/play.ts.
 *
 * The card compares the two kinds, mapping and annotation, so a player can
 * choose; mapping is picked to begin with ("we want them to check BCs as
 * default but I like choice"). Once chosen, Play goes straight in, and the
 * Play bar in the Cell Library can open the card again.
 *
 * Look (Ames 2026-11-10): the button is teal green and sits below the tabs;
 * the card is the Starship intro's hologram box (src/util/intro_tour.ts,
 * after Ames's scifi-ui): cut corners, a light that runs the border, HUD
 * brackets, a scan line, and the hologram plate button. Its words are site
 * texts: admins can Edit them, and Ames gets a note when someone else does.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { play, pressPlay, startPlay, savedKind, canQuest, mappingWhere, type PlayKind } from '../util/play';
import { useProofreadingBackendStore } from '../store';
import EditableText from './EditableText.vue';

const backend = useProofreadingBackendStore();
const signedIn = computed(() => !!backend.userId);
const picked = ref<PlayKind>('cells');
const questsOk = computed(() => canQuest());
const where = computed(() => mappingWhere());
const busy = ref(false);

const SUB = 'Pyr teleports you to a neuron.';
const MAP_LINES = [
  "<b>You</b> fix the cell's 3D shape where the AI got it wrong.",
  '<b>Tools</b> Merge to add missing pieces, Cut to remove wrong ones.',
  '<b>Finish</b> with Complete when the whole cell is right.',
  '<b>Good for</b> players who like fixing shapes and following branches.',
];
const QUEST_LINES = [
  "<b>You</b> find the cell's cilium, a tiny antenna, and mark it.",
  '<b>Tools</b> Annotation points, in three layers made for the quest.',
  '<b>Finish</b> with Submit and a cilium status.',
  '<b>Good for</b> players who like hunting for small details.',
];

watch(() => play.choosing, open => {
  if (!open) return;
  const k = savedKind();
  picked.value = k === 'quests' && questsOk.value ? 'quests' : 'cells';
});

function pick(k: PlayKind) { if (k === 'quests' && !questsOk.value) return; picked.value = k; }
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
            :title="play.on ? 'Playing: back to the task you are on' : 'Play: Pyr finds you a neuron to work on and takes you there. After each one, the next.'">
      <svg class="nge-play-icon" width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>
      <span>{{ play.on ? 'Playing' : 'Play' }}</span>
    </button>

    <div v-if="play.choosing" class="nge-play-screen" @click.self="play.choosing = false">
      <div class="nge-play-card" role="dialog" aria-label="Choose what to play">
        <div class="nge-play-plate" aria-hidden="true"></div>
        <div class="nge-play-ring" aria-hidden="true"></div>
        <div class="nge-play-scan" aria-hidden="true"></div>
        <i class="nge-play-corner tr" aria-hidden="true"></i><i class="nge-play-corner bl" aria-hidden="true"></i>
        <i class="nge-play-corner tl" aria-hidden="true"></i><i class="nge-play-corner br" aria-hidden="true"></i>

        <button class="nge-play-close" aria-label="Close" @click="play.choosing = false">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <div class="nge-play-kicker"><span class="nge-play-dot"></span>Play</div>
        <div class="nge-play-title">What would you like to do?</div>
        <EditableText text-key="play.sub" :original="SUB" text-class="nge-play-sub" notify label="Play card: the line under the title" />

        <div class="nge-play-options" role="radiogroup" aria-label="Kind of task">
          <div role="radio" tabindex="0" class="nge-play-opt nge-play-opt--map" :class="{ 'nge-play-opt--on': picked === 'cells' }"
               :aria-checked="picked === 'cells' ? 'true' : 'false'"
               @click="pick('cells')" @dblclick="go" @keydown.enter.self="go" @keydown.space.self.prevent="pick('cells')">
            <span class="nge-play-opt-kind">Mapping</span>
            <span class="nge-play-opt-name">Map a neuron</span>
            <span class="nge-play-opt-where">{{ where }}</span>
            <EditableText text-key="play.mapping" :original="MAP_LINES" list-class="nge-play-opt-lines" notify label="Play card: Mapping" />
          </div>
          <div role="radio" :tabindex="questsOk ? 0 : -1" class="nge-play-opt nge-play-opt--note"
               :class="{ 'nge-play-opt--on': picked === 'quests', 'nge-play-opt--off': !questsOk }"
               :aria-disabled="!questsOk ? 'true' : undefined" :aria-checked="picked === 'quests' ? 'true' : 'false'"
               @click="pick('quests')" @dblclick="questsOk && go()" @keydown.enter.self="questsOk && go()" @keydown.space.self.prevent="pick('quests')">
            <span class="nge-play-opt-kind">Annotation</span>
            <span class="nge-play-opt-name">Cilia Quest</span>
            <span class="nge-play-opt-where">Starburst cells on Retina</span>
            <EditableText text-key="play.quests" :original="QUEST_LINES" list-class="nge-play-opt-lines" notify label="Play card: Cilia Quest" />
            <span v-if="!questsOk" class="nge-play-opt-lock">Unlocks with edit access on Retina</span>
          </div>
        </div>

        <div class="nge-play-actions">
          <span class="nge-play-note">You can change this any time from the Play bar.</span>
          <button class="nge-play-go" :disabled="busy" @click="go">
            <span class="nge-play-go-plate">
              <i class="nge-play-tick a"></i><i class="nge-play-tick b"></i>
              {{ busy ? 'Starting…' : 'Start Playing' }}
              <span class="nge-play-chev"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* The button: teal green, below the tabs (Ames 2026-11-10). */
.nge-play-btn {
  position: fixed;
  top: 72px;
  left: 10px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px 8px 15px;
  border-radius: 999px;
  border: 1px solid rgba(62, 236, 190, 0.7);
  background: linear-gradient(135deg, rgba(8, 72, 64, 0.94), rgba(10, 48, 66, 0.94));
  color: #dcfff4;
  font: 700 14.5px/1 'Orbitron', Inter, system-ui, sans-serif;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  text-shadow: 0 0 8px rgba(62, 236, 190, 0.6);
  box-shadow: 0 0 16px rgba(62, 236, 190, 0.35);
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.1s;
}
.nge-play-btn:hover { box-shadow: 0 0 24px rgba(62, 236, 190, 0.6); border-color: #3eecbe; }
.nge-play-btn:active { transform: scale(0.97); }
.nge-play-icon { color: #3eecbe; filter: drop-shadow(0 0 4px #3eecbe); }
.nge-play-btn--on { border-color: #7dffb0; box-shadow: 0 0 16px rgba(125, 255, 176, 0.45); }
.nge-play-btn--on .nge-play-icon { color: #7dffb0; animation: nge-play-pulse 1.6s ease-in-out infinite; }
@keyframes nge-play-pulse { 50% { opacity: 0.45; } }

/* The card: the Starship intro's hologram box (src/util/intro_tour.ts). */
@property --nge-play-ring { syntax: '<angle>'; inherits: false; initial-value: 45deg; }
.nge-play-screen {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(2, 6, 14, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.nge-play-card {
  position: relative; isolation: isolate;
  width: min(720px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 24px 26px 22px;
  color: #e6f3ff;
  font: 16px/1.5 Inter, system-ui, sans-serif;
  animation: nge-play-in 900ms cubic-bezier(.16,1,.3,1) both;
}
@keyframes nge-play-in {
  0% { opacity: 0; transform: translateY(18px) scaleY(0.04); filter: blur(8px) brightness(2.2); }
  35% { opacity: 1; transform: translateY(6px) scaleY(1.02); filter: blur(3px) brightness(1.6) drop-shadow(0 0 30px rgba(80, 180, 255, 0.6)); }
  100% { opacity: 1; transform: none; filter: drop-shadow(0 0 18px rgba(80, 180, 255, 0.28)); }
}
.nge-play-plate { position: absolute; inset: 0; z-index: -2; pointer-events: none;
  clip-path: polygon(20px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%, 0 20px);
  background: linear-gradient(160deg, rgba(14, 34, 66, 0.96), rgba(6, 12, 28, 0.97) 60%, rgba(22, 14, 48, 0.96));
  box-shadow: inset 0 0 40px rgba(80, 180, 255, 0.10); }
.nge-play-plate::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(135deg, rgba(126, 224, 255, 0.7), rgba(74, 150, 224, 0.2) 40%, rgba(138, 96, 230, 0.55));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-play-plate::after { content: ''; position: absolute; inset: 0; opacity: 0.35;
  background: repeating-linear-gradient(0deg, rgba(126, 224, 255, 0.05) 0 1px, transparent 1px 3px); }
.nge-play-ring { position: absolute; inset: 0; z-index: -1; pointer-events: none; padding: 1.5px; opacity: 0;
  clip-path: polygon(20px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%, 0 20px);
  background: conic-gradient(from var(--nge-play-ring), #c9f6ff 0deg, rgba(126, 224, 255, 0.5) 16deg, transparent 34deg, transparent 180deg,
    #c9f6ff 180deg, rgba(126, 224, 255, 0.5) 196deg, transparent 214deg, transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;
  animation: nge-play-ring 1500ms linear 250ms forwards; }
@keyframes nge-play-ring { 0% { --nge-play-ring: 45deg; opacity: 1; } 60% { opacity: 1; } 100% { --nge-play-ring: 405deg; opacity: 0; } }
.nge-play-scan { position: absolute; left: 0; right: 0; top: 0; height: 2px; pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent, #c9f6ff 20%, #c9f6ff 80%, transparent); box-shadow: 0 0 12px #7ee0ff;
  animation: nge-play-scan 800ms ease-in-out 350ms both; }
@keyframes nge-play-scan { 0% { top: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
.nge-play-corner { position: absolute; width: 14px; height: 14px; border: 2px solid #7ee0ff; pointer-events: none;
  filter: drop-shadow(0 0 4px #7ee0ff); animation: nge-play-corner 600ms cubic-bezier(.2,1.4,.4,1) 450ms both; }
.nge-play-corner.tr { top: -5px; right: -5px; border-left: 0; border-bottom: 0; --dx: 14px; --dy: -14px; }
.nge-play-corner.bl { bottom: -5px; left: -5px; border-right: 0; border-top: 0; --dx: -14px; --dy: 14px; }
.nge-play-corner.tl { top: 6px; left: 6px; width: 8px; height: 8px; border-width: 1px; border-right: 0; border-bottom: 0; --dx: -10px; --dy: -10px; }
.nge-play-corner.br { bottom: 6px; right: 6px; width: 8px; height: 8px; border-width: 1px; border-left: 0; border-top: 0; --dx: 10px; --dy: 10px; }
@keyframes nge-play-corner { from { opacity: 0; transform: translate(var(--dx, 0), var(--dy, 0)); } to { opacity: 1; transform: none; } }

.nge-play-close {
  position: absolute; top: 14px; right: 16px; width: 30px; height: 30px; display: grid; place-items: center; padding: 0;
  border: 1px solid rgba(126, 210, 255, 0.35); border-radius: 50%; background: rgba(126, 210, 255, 0.06); color: #9fc6ea; cursor: pointer;
}
.nge-play-close:hover { color: #fff; border-color: rgba(126, 210, 255, 0.8); background: rgba(126, 210, 255, 0.16); }
.nge-play-kicker { display: flex; align-items: center; gap: 8px; font: 600 12px 'Orbitron', Inter, sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #7ecaff; }
.nge-play-dot { width: 8px; height: 8px; border-radius: 50%; background: #3eecbe; box-shadow: 0 0 8px #3eecbe; animation: nge-play-pulse 1.6s ease-in-out infinite; }
.nge-play-title { margin: 8px 0 2px; font: 700 25px 'Orbitron', Inter, sans-serif; letter-spacing: 0.03em; color: #fff; text-shadow: 0 0 14px rgba(126, 210, 255, 0.55); }
.nge-play-sub { font-size: 17px; color: #d6e8fb; margin-bottom: 4px; }
.nge-play-card > .nge-edtext { margin-bottom: 14px; }
.nge-play-options { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 600px) { .nge-play-options { grid-template-columns: 1fr; } }
.nge-play-opt {
  position: relative; display: flex; flex-direction: column; gap: 4px; text-align: left;
  padding: 16px; cursor: pointer; outline: none;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  background: rgba(126, 224, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  transition: background 0.15s, box-shadow 0.15s;
}
.nge-play-opt:hover:not(.nge-play-opt--off) { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28); }
.nge-play-opt:focus-visible { box-shadow: inset 0 0 0 2px #7ecaff; }
.nge-play-opt--map.nge-play-opt--on { background: rgba(62, 236, 190, 0.09); box-shadow: inset 0 0 0 1.5px #3eecbe, inset 0 0 24px rgba(62, 236, 190, 0.15); }
.nge-play-opt--note.nge-play-opt--on { background: rgba(255, 211, 110, 0.09); box-shadow: inset 0 0 0 1.5px #ffd36e, inset 0 0 24px rgba(255, 211, 110, 0.15); }
.nge-play-opt--off { opacity: 0.55; cursor: not-allowed; }
.nge-play-opt-kind { font: 600 11.5px 'Orbitron', Inter, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; }
.nge-play-opt--map .nge-play-opt-kind { color: #3eecbe; }
.nge-play-opt--note .nge-play-opt-kind { color: #ffd36e; }
.nge-play-opt-name { font-size: 20px; font-weight: 700; color: #fff; }
.nge-play-opt-where { font-size: 14px; color: #8fb4d4; margin-bottom: 6px; }
.nge-play-opt-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.nge-play-opt-lines li { font-size: 15px; line-height: 1.45; color: #cfe0f2; }
.nge-play-opt-lines li b { color: #fff; font-weight: 600; margin-right: 4px; }
.nge-play-opt-lock { margin-top: 6px; font-size: 14px; color: #ffb38a; }
.nge-play-card .nge-edtext-btn { font-size: 12px; }
.nge-play-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; flex-wrap: wrap; }
.nge-play-note { font-size: 14px; color: #8fb0cc; }

/* Start Playing: the intro's hologram plate button. */
.nge-play-go { position: relative; border: 0; padding: 0; background: none; cursor: pointer; margin-left: auto; color: inherit;
  filter: drop-shadow(0 0 10px rgba(74, 150, 224, 0.45)); transition: filter 0.25s, transform 0.2s; }
.nge-play-go:hover:not(:disabled) { filter: drop-shadow(0 0 18px rgba(126, 224, 255, 0.75)); transform: translateY(-1px); }
.nge-play-go:active:not(:disabled) { transform: scale(0.98); }
.nge-play-go:disabled { opacity: 0.6; cursor: default; }
.nge-play-go:focus-visible { outline: 2px solid #7ecaff; outline-offset: 3px; }
.nge-play-go-plate { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 12px; padding: 13px 24px 13px 26px;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  background: linear-gradient(135deg, rgba(74, 150, 224, 0.55) 0%, rgba(74, 150, 224, 0.62) 45%, rgba(138, 96, 230, 0.55) 100%);
  color: #eaf7ff; font: 700 14px 'Orbitron', Inter, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap;
  text-shadow: 0 0 8px rgba(126, 224, 255, 0.8); transition: background 0.3s; }
.nge-play-go:hover .nge-play-go-plate { background: linear-gradient(135deg, rgba(90, 170, 240, 0.72) 0%, rgba(90, 170, 240, 0.78) 45%, rgba(150, 110, 240, 0.7) 100%); }
.nge-play-go-plate::before { content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(135deg, #bff3ff, rgba(126, 224, 255, 0.35) 40%, rgba(180, 150, 255, 0.8));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
.nge-play-go-plate::after { content: ''; position: absolute; top: 0; bottom: 0; left: -70%; width: 50%; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(201, 246, 255, 0.55), transparent); transform: skewX(-20deg);
  animation: nge-play-shine 3.4s ease-in-out infinite; }
@keyframes nge-play-shine { 0%, 50% { left: -70%; } 100% { left: 140%; } }
.nge-play-tick { position: absolute; width: 6px; height: 6px; border: 1px solid #c9f6ff; pointer-events: none; }
.nge-play-tick.a { top: 3px; right: 3px; border-left: 0; border-bottom: 0; }
.nge-play-tick.b { bottom: 3px; left: 3px; border-right: 0; border-top: 0; }
.nge-play-chev { display: inline-flex; color: #c9f6ff; filter: drop-shadow(0 0 4px #7ee0ff); }
.nge-play-chev svg { animation: nge-play-nudge 1.4s ease-in-out infinite; }
@keyframes nge-play-nudge { 50% { transform: translateX(3px); } }
@media (prefers-reduced-motion: reduce) {
  .nge-play-card, .nge-play-ring, .nge-play-scan, .nge-play-corner, .nge-play-go-plate::after, .nge-play-chev svg { animation: none; }
  .nge-play-ring, .nge-play-scan { display: none; }
}
</style>
