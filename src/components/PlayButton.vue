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
 * Look (Ames 2026-11-10): the button is teal green and sits below the tabs.
 * The card is the Starship intro's transmission box itself, its own styles
 * and its circuit frame (src/util/intro_tour.ts), with the intro's command
 * key button, tall enough that nothing scrolls. Its words are site texts:
 * admins can Edit them, and Ames gets a note when someone else does.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { play, pressPlay, startPlay, stopPlay, savedKind, canQuest, mappingWhere, type PlayKind } from '../util/play';
import { ensureIntroStyle, introFrameSvg } from '../util/intro_tour';
import { useProofreadingBackendStore, useUserPreferencesStore } from '../store';
import EditableText from './EditableText.vue';
import { canonicalDataset, currentDatasetTag } from '../datasets';

const backend = useProofreadingBackendStore();
const signedIn = computed(() => !!backend.userId);
const picked = ref<PlayKind>('cells');
const questsOk = computed(() => canQuest());
const where = computed(() => mappingWhere());
const busy = ref(false);
/** Settings, Screen: "Show the Play button" (Ames 2026-11-12). */
const prefs = useUserPreferencesStore();
const hidden = computed(() => prefs.prefs.hidePlayButton === true);
// On the Sandbox the button is big (Ames 2026-11-14: in EyeWire players said
// they did not know what to do), and it stays away while a tutorial is on
// screen, where the tutorial says what to do. Both read from the page, as the
// Cut overlay does for the tutorial.
const onSandbox = ref(false);
const tutorialOnScreen = ref(false);
/** The Sandbox's Playing box was closed with its X: Play opens it again
 *  (Ames 2026-11-14: new players want the Play button back). */
const boxClosed = ref(false);
// The Playing box reads this setting from the page: off, the box stays away.
watch(hidden, off => {
  document.body.classList.toggle('nge-play-off', off);
  document.dispatchEvent(new CustomEvent('nge:play-pref'));
}, { immediate: true });
let watchTimer: ReturnType<typeof setInterval> | null = null;
function readScreen() {
  onSandbox.value = canonicalDataset(currentDatasetTag()) === 'pinky_nf_v2';
  tutorialOnScreen.value = !!document.querySelector('.introductionStep');
  boxClosed.value = document.body.classList.contains('nge-cm-closed');
}
const showDock = computed(() => signedIn.value && !hidden.value && !tutorialOnScreen.value
  && (!play.on || (onSandbox.value && boxClosed.value)));

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

// The circuit frame is drawn to the card's real size, and again whenever
// that changes (an Edit box opening, the window narrowing).
const cardEl = ref<HTMLElement | null>(null);
const frameEl = ref<HTMLElement | null>(null);
let frameObs: ResizeObserver | null = null;
let fw = 0, fh = 0;
function drawFrame() {
  const c = cardEl.value, host = frameEl.value;
  if (!c || !host) return;
  const w = c.offsetWidth, h = c.offsetHeight;
  if (!w || !h || (w === fw && h === fh)) return;
  fw = w; fh = h;
  host.innerHTML = introFrameSvg(w, h, 18);
}

watch(() => play.choosing, async open => {
  frameObs?.disconnect(); frameObs = null;
  if (!open) return;
  const k = savedKind();
  picked.value = k === 'quests' && questsOk.value ? 'quests' : 'cells';
  ensureIntroStyle();
  await nextTick();
  fw = 0; fh = 0;
  drawFrame();
  try { frameObs = new ResizeObserver(drawFrame); if (cardEl.value) frameObs.observe(cardEl.value); } catch { /* drawn once */ }
});

function pick(k: PlayKind) { if (k === 'quests' && !questsOk.value) return; picked.value = k; }
async function go() {
  if (busy.value) return;
  busy.value = true;
  try { await startPlay(picked.value); } finally { busy.value = false; }
}
function onButton() {
  // The Playing box was closed: open it again, and play if not playing.
  if (onSandbox.value && boxClosed.value) {
    (window as any).__ngeCellMatch?.openCard?.();
    boxClosed.value = false;
    if (play.on) return;
  }
  // Playing already: back to the task in hand.
  if (play.on) { void startPlay(play.on); return; }
  pressPlay();
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && play.choosing) { e.stopPropagation(); play.choosing = false; } }
onMounted(() => { document.addEventListener('keydown', onKey, true); readScreen(); watchTimer = setInterval(readScreen, 400); });
onUnmounted(() => { document.removeEventListener('keydown', onKey, true); frameObs?.disconnect(); if (watchTimer) clearInterval(watchTimer); });
</script>

<template>
  <Teleport to="body">
    <div v-if="showDock" class="nge-play-dock" :class="{ 'nge-play-dock--big': onSandbox }">
    <button class="nge-play-btn" @click="onButton"
            title="Play: Pyr teleports you to a neuron to work on. After each one, the next.">
      <svg class="nge-play-icon" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>
      <span>Play</span>
    </button>
    </div>

    <div v-if="play.choosing" class="nge-play-screen" @click.self="play.choosing = false">
      <section ref="cardEl" class="ng-extend nge-play-card nge-intro--in" role="dialog" aria-label="Choose what to play">
        <span class="nge-intro-plate-bg"></span><span ref="frameEl" class="nge-frame-host"></span><span class="nge-intro-ring"></span><span class="nge-intro-scan"></span>
        <div class="nge-intro-head"><span class="nge-intro-dot"></span>Transmission received · Play
          <button class="nge-intro-x" type="button" aria-label="Close" @click="play.choosing = false">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="nge-intro-title">What would you like to do?</div>
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

        <div class="nge-intro-row nge-play-actions">
          <span class="nge-play-note">While you play, the top bar shows what you are playing. Click it to change or stop.</span>
          <button v-if="play.on" class="nge-go nge-go--alt" type="button" @click="stopPlay(); play.choosing = false"><span class="nge-go-label">Stop playing</span></button>
          <button v-else class="nge-go nge-go--alt" type="button" @click="play.choosing = false"><span class="nge-go-label">Not now</span></button>
          <button class="nge-go" type="button" :disabled="busy" @click="go"><span class="nge-go-label">{{ busy ? 'Starting…' : play.on ? 'Play this' : 'Start playing' }}</span></button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style>
/* The button: the site's own pill, as the "Playing" chip in the top bar and
   "Play here" in the Cell Library (Ames 2026-11-12: "doesn't match the site"). */
.nge-play-dock { position: fixed; top: 72px; left: 10px; z-index: 60; display: flex; align-items: center; gap: 6px; }
.nge-play-btn {
  display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 18px 0 14px;
  border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(62, 236, 190, 0.7);
  background: linear-gradient(135deg, rgba(8, 72, 64, 0.94), rgba(10, 48, 66, 0.94));
  color: #dcfff4; font: 700 14px/1 'Orbitron', Inter, system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase;
  text-shadow: 0 0 8px rgba(62, 236, 190, 0.6);
  box-shadow: 0 0 12px rgba(62, 236, 190, 0.3);
  transition: box-shadow 0.15s, background 0.15s;
}
.nge-play-btn:hover { box-shadow: 0 0 18px rgba(62, 236, 190, 0.55); background: linear-gradient(135deg, rgba(10, 90, 78, 0.96), rgba(12, 60, 80, 0.96)); }
.nge-play-btn:focus-visible { outline: 2px solid #3eecbe; outline-offset: 3px; }
.nge-play-icon { color: #3eecbe; }
/* The Sandbox: twice the size, with a slow glow, so a new player sees where to start. */
.nge-play-dock--big { top: 80px; left: 14px; }
.nge-play-dock--big .nge-play-btn { height: 58px; padding: 0 30px 0 24px; gap: 12px; font-size: 22px; letter-spacing: 0.14em;
  animation: nge-play-glow 2.4s ease-in-out infinite; }
.nge-play-dock--big .nge-play-icon { width: 18px; height: 18px; }
@keyframes nge-play-glow { 50% { box-shadow: 0 0 26px rgba(62, 236, 190, 0.7), 0 0 0 4px rgba(62, 236, 190, 0.12); } }
@media (prefers-reduced-motion: reduce) { .nge-play-dock--big .nge-play-btn { animation: none; } }
.nge-play-x { width: 22px; height: 22px; padding: 0; border: 1px solid rgba(62, 236, 190, 0.4); border-radius: 50%;
  background: rgba(6, 20, 30, 0.85); color: #9fe8d4; font: 400 15px/1 Inter, system-ui, sans-serif; cursor: pointer; display: grid; place-items: center; }
.nge-play-x:hover { color: #fff; border-color: #3eecbe; background: rgba(12, 60, 56, 0.95); }
@keyframes nge-play-pulse { 50% { opacity: 0.45; } }

/* The card: the transmission box (intro_tour.ts styles), placed in the
   middle and tall enough for its words, so it never scrolls (Ames). */
.nge-play-screen {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(2, 6, 14, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.nge-play-card {
  position: relative; isolation: isolate; box-sizing: border-box;
  width: min(760px, 100%);
  padding: 18px 24px 20px;
  color: #e6f3ff; font: 16.5px/1.5 'Inter', 'Roboto', sans-serif;
}
/* only a very short window gets a scroll, and then the page does it */
@media (max-height: 640px) { .nge-play-screen { align-items: flex-start; overflow-y: auto; } }
.nge-play-card .nge-intro-x { margin-left: auto; }
.nge-play-sub { font-size: 17px; color: #d6e8fb; }
.nge-play-card > .nge-edtext { margin-bottom: 14px; }
.nge-play-options { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 620px) { .nge-play-options { grid-template-columns: 1fr; } }
.nge-play-opt {
  position: relative; display: flex; flex-direction: column; gap: 4px; text-align: left;
  padding: 14px 16px; cursor: pointer; outline: none;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  background: rgba(126, 224, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(126, 224, 255, 0.22);
  transition: background 0.15s, box-shadow 0.15s;
}
.nge-play-opt:hover:not(.nge-play-opt--off) { box-shadow: inset 0 0 0 1px rgba(126, 224, 255, 0.5); }
.nge-play-opt:focus-visible { box-shadow: inset 0 0 0 2px #7ecaff; }
.nge-play-opt--map.nge-play-opt--on { background: rgba(62, 236, 190, 0.09); box-shadow: inset 0 0 0 1.5px #3eecbe, inset 0 0 24px rgba(62, 236, 190, 0.15); }
.nge-play-opt--note.nge-play-opt--on { background: rgba(255, 211, 110, 0.09); box-shadow: inset 0 0 0 1.5px #ffd36e, inset 0 0 24px rgba(255, 211, 110, 0.15); }
.nge-play-opt--off { opacity: 0.55; cursor: not-allowed; }
.nge-play-opt-kind { font: 600 11.5px 'Orbitron', Inter, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; }
.nge-play-opt--map .nge-play-opt-kind { color: #3eecbe; }
.nge-play-opt--note .nge-play-opt-kind { color: #ffd36e; }
.nge-play-opt-name { font: 700 19px 'Orbitron', Inter, sans-serif; letter-spacing: 0.02em; color: #fff; }
.nge-play-opt-where { font-size: 14px; color: #8fb4d4; margin-bottom: 6px; }
.nge-play-opt-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.nge-play-opt-lines li { font-size: 15px; line-height: 1.45; color: #cfe0f2; }
.nge-play-opt-lines li b { color: #fff; font-weight: 600; margin-right: 4px; }
.nge-play-opt-lock { margin-top: 6px; font-size: 14px; color: #ffb38a; }
.nge-play-card .nge-edtext-btn { font-size: 12px; }
.nge-play-actions { margin-top: 18px; flex-wrap: wrap; row-gap: 10px; }
/* The note on its own line, the two keys together below it on the right (Ames 2026-11-10: they were split across two lines). */
.nge-play-note { flex: 1 0 100%; font-size: 14px; color: #8fb0cc; }
.nge-play-actions .nge-go--alt { margin-left: auto; }
.nge-play-actions .nge-go--alt + .nge-go { margin-left: 10px; }
/* the game's general button rule would make these blocks, flattening the label */
.nge-play-card .nge-go { display: inline-flex; flex-direction: row; align-items: stretch; height: 50px; }
.nge-play-card .nge-go .nge-go-label { display: flex; align-items: center; }
.nge-play-actions .nge-go:disabled { opacity: 0.6; cursor: default; }
</style>
