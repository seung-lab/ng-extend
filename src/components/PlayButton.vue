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
import { play, pressPlay, startPlay, stopPlay, savedKind, canQuest, canViewRetina, mappingWhere, retinaHub, type PlayKind } from '../util/play';
import { ensureIntroStyle, introFrameSvg, introPending } from '../util/intro_tour';
import { useProofreadingBackendStore, useUserPreferencesStore } from '../store';
import EditableText from './EditableText.vue';
import { canonicalDataset, currentDatasetTag } from '../datasets';

const backend = useProofreadingBackendStore();
const signedIn = computed(() => !!backend.userId);
/** The Retina hub (test sites, Ames 2026-11-19) adds Lost Fragments and
 *  Glia Quest beside BC Challenge and Cilia Quest. Those two open their Cell
 *  Library tab; Play's next task loop covers the first two only for now. */
type HubPick = PlayKind | 'glia';
const picked = ref<HubPick>('cells');
const questsOk = computed(() => canQuest());
const hub = computed(() => retinaHub());
const glia1Ok = computed(() => canViewRetina());
/** Glia Quest is on its own branch (claude/muller-glia-quest) until merged here. */
const GLIA_HERE = false;
const okFor = (k: HubPick) => k === 'cells' ? true : k === 'glia' ? glia1Ok.value && GLIA_HERE : questsOk.value;
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
/** When a tutorial or the starship tour was last on screen: the button stays
 *  away a few seconds more, so it does not flash in between the tour and
 *  Get Started. */
let tutorialSeenAt = 0;
function readScreen() {
  onSandbox.value = canonicalDataset(currentDatasetTag()) === 'pinky_nf_v2';
  // The starship tour counts as a tutorial (Ames 2026-11-19: "We do not want
  // the play button to appear while new users are in the rocket ship demo"):
  // Play shows once the player has closed out of the tutorials.
  const now = !!document.querySelector('.introductionStep, .nge-intro, .nge-tour-loading')
    || document.body.classList.contains('nge-intro-on') || introPending();
  if (now) tutorialSeenAt = Date.now();
  tutorialOnScreen.value = now || Date.now() - tutorialSeenAt < 4000;
  boxClosed.value = document.body.classList.contains('nge-cm-closed');
}
const showDock = computed(() => signedIn.value && !hidden.value && !tutorialOnScreen.value
  && (!play.on || (onSandbox.value && boxClosed.value)));

const MAP_LINES = [
  "<b>You</b> fix the cell's 3D shape where the AI got it wrong.",
  '<b>Tools</b> Merge to add missing pieces, Cut to remove wrong ones.',
  '<b>Finish</b> with Complete when the whole cell is right.',
  '<b>Good for</b> players who like fixing shapes and following branches.',
];
const FRAG_LINES = [
  '<b>You</b> tidy up a piece of the retina nobody has traced yet.',
  '<b>Finish</b> by marking its main dendrite or soma, then Submit.',
];
const GLIA_LINES = [
  '<b>Stage 1</b> Is it a Muller glia? Yes or no.',
  '<b>Stage 2</b> Two glia stuck together: Cut them apart.',
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
  picked.value = k && k !== 'cells' && questsOk.value ? k : 'cells';
  ensureIntroStyle();
  await nextTick();
  fw = 0; fh = 0;
  drawFrame();
  try { frameObs = new ResizeObserver(drawFrame); if (cardEl.value) frameObs.observe(cardEl.value); } catch { /* drawn once */ }
});

function pick(k: HubPick) { if (!okFor(k)) return; picked.value = k; }
async function go() {
  if (busy.value || !okFor(picked.value)) return;
  const k = picked.value;
  if (k === 'glia') {
    play.choosing = false;
    document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'quests' } }));
    return;
  }
  busy.value = true;
  try { await startPlay(k); } finally { busy.value = false; }
}
// Pressing Play (Ames 2026-11-17: "a very cool animation that plays when you
// hit it" and a loading one): a launch burst, the key flashing, rings and
// sparks going out from it and a comet running along the label; then, while
// Pyr fetches the cell, a turning arc on the key and a beam sweeping the
// label. The button stays on screen until the cell is up.
const launching = ref(false);
const loading = ref(false);
let launchSeq = 0;
const SPARKS = Array.from({ length: 12 }, (_, i) => ({ a: `${i * 30 + (i % 2 ? 9 : -6)}deg`, d: `${34 + (i % 3) * 12}px`, t: `${(i % 4) * 25}ms` }));
function onButton() {
  if (launching.value || loading.value) return;
  const seq = ++launchSeq;
  launching.value = true;
  setTimeout(() => { if (seq === launchSeq) launching.value = false; }, 800);
  let p: Promise<unknown> | null = null;
  // The Playing box was closed: open it again, and play if not playing.
  const reopened = onSandbox.value && boxClosed.value;
  if (reopened) {
    (window as any).__ngeCellMatch?.openCard?.();
    boxClosed.value = false;
  }
  // Playing already: back to the task in hand.
  if (play.on) { if (!reopened) p = startPlay(play.on); }
  else p = pressPlay();
  if (!p) return;
  loading.value = true;
  const stop = () => { if (seq === launchSeq) loading.value = false; };
  void Promise.race([p.catch(() => false), new Promise(r => setTimeout(r, 20000))]).then(stop);
}
const dockShown = computed(() => showDock.value || launching.value || loading.value);
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && play.choosing) { e.stopPropagation(); play.choosing = false; } }
onMounted(() => { document.addEventListener('keydown', onKey, true); readScreen(); watchTimer = setInterval(readScreen, 400); });
onUnmounted(() => { document.removeEventListener('keydown', onKey, true); frameObs?.disconnect(); if (watchTimer) clearInterval(watchTimer); });
</script>

<template>
  <Teleport to="body">
    <Transition name="nge-play-fade">
    <div v-if="dockShown" class="nge-play-dock" :class="{ 'nge-play-dock--big': onSandbox }">
    <button class="nge-play-btn" :class="{ 'is-launch': launching, 'is-loading': loading && !launching }" @click="onButton"
            :aria-busy="loading" title="Play: Pyr teleports you to a neuron to work on. After each one, the next.">
      <span class="nge-play-key" aria-hidden="true"><svg class="nge-play-icon" viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg></span>
      <span class="nge-play-label"><span class="nge-play-beam" aria-hidden="true"></span><span class="nge-play-word">{{ loading && !launching ? 'Teleporting' : 'Play' }}</span><span v-if="loading && !launching" class="nge-play-dots" aria-hidden="true"><b></b><b></b><b></b></span></span>
      <span class="nge-play-fx" aria-hidden="true">
        <span class="nge-play-arc"></span>
        <span class="nge-play-ring"></span><span class="nge-play-ring nge-play-ring--2"></span>
        <i v-for="(k, i) in SPARKS" :key="i" class="nge-play-spark" :style="{ '--a': k.a, '--d': k.d, '--t': k.t }"></i>
      </span>
      <span class="nge-play-comet" aria-hidden="true"></span>
    </button>
    </div>
    </Transition>

    <div v-if="play.choosing" class="nge-play-screen" @click.self="play.choosing = false">
      <section ref="cardEl" class="ng-extend nge-play-card nge-intro--in" role="dialog" aria-label="Choose what to play">
        <span class="nge-intro-plate-bg"></span><span ref="frameEl" class="nge-frame-host"></span><span class="nge-intro-ring"></span><span class="nge-intro-scan"></span>
        <div class="nge-intro-head"><span class="nge-intro-dot"></span>Transmission received · Play
          <button class="nge-intro-x" type="button" aria-label="Close" @click="play.choosing = false">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="nge-intro-title">What would you like to do?</div>

        <div v-if="!hub" class="nge-play-options" role="radiogroup" aria-label="Kind of task">
          <div role="radio" tabindex="0" class="nge-play-opt nge-play-opt--map" :class="{ 'nge-play-opt--on': picked === 'cells' }"
               :aria-checked="picked === 'cells' ? 'true' : 'false'"
               @click="pick('cells')" @dblclick="go" @keydown.enter.self="go" @keydown.space.self.prevent="pick('cells')">
            <span class="nge-play-opt-kind">Mapping</span>
            <span class="nge-play-opt-name">Map a neuron</span>
            <span class="nge-play-opt-where">{{ where }}</span>
            <EditableText text-key="play.mapping" :original="MAP_LINES" list-class="nge-play-opt-lines" notify quiet label="Play card: Mapping" />
          </div>
          <div role="radio" :tabindex="questsOk ? 0 : -1" class="nge-play-opt nge-play-opt--note"
               :class="{ 'nge-play-opt--on': picked === 'quests', 'nge-play-opt--off': !questsOk }"
               :aria-disabled="!questsOk ? 'true' : undefined" :aria-checked="picked === 'quests' ? 'true' : 'false'"
               @click="pick('quests')" @dblclick="questsOk && go()" @keydown.enter.self="questsOk && go()" @keydown.space.self.prevent="pick('quests')">
            <span class="nge-play-opt-kind">Annotation</span>
            <span class="nge-play-opt-name">Cilia Quest</span>
            <span class="nge-play-opt-where">Starburst cells on Retina</span>
            <EditableText text-key="play.quests" :original="QUEST_LINES" list-class="nge-play-opt-lines" notify quiet label="Play card: Cilia Quest" />
            <span v-if="!questsOk" class="nge-play-opt-lock">Unlocks with edit access on Retina</span>
          </div>
        </div>

        <div v-else class="nge-play-hub" role="radiogroup" aria-label="Kind of task">
          <div class="nge-play-sec nge-play-sec--map" style="grid-column: 1; grid-row: 1">Map neurons</div>
          <div class="nge-play-sec nge-play-sec--note" style="grid-column: 2; grid-row: 1">Find and label</div>
          <div role="radio" tabindex="0" class="nge-play-opt nge-play-opt--map" style="grid-column: 1; grid-row: 2"
               :class="{ 'nge-play-opt--on': picked === 'cells' }" :aria-checked="picked === 'cells' ? 'true' : 'false'"
               @click="pick('cells')" @dblclick="go" @keydown.enter.self="go" @keydown.space.self.prevent="pick('cells')">
            <span class="nge-play-opt-name">BC Challenge</span>
            <span class="nge-play-opt-where">{{ where }}</span>
            <EditableText text-key="play.mapping" :original="MAP_LINES" list-class="nge-play-opt-lines" notify quiet label="Play card: Mapping" />
          </div>
          <div role="radio" :tabindex="questsOk ? 0 : -1" class="nge-play-opt nge-play-opt--map" style="grid-column: 1; grid-row: 3"
               :class="{ 'nge-play-opt--on': picked === 'fragments', 'nge-play-opt--off': !questsOk }"
               :aria-disabled="!questsOk ? 'true' : undefined" :aria-checked="picked === 'fragments' ? 'true' : 'false'"
               @click="pick('fragments')" @dblclick="go" @keydown.enter.self="go" @keydown.space.self.prevent="pick('fragments')">
            <span class="nge-play-opt-name">Lost Fragments</span>
            <span class="nge-play-opt-where">Untraced pieces of Retina</span>
            <EditableText text-key="play.fragments" :original="FRAG_LINES" list-class="nge-play-opt-lines" notify quiet label="Play card: Lost Fragments" />
            <span v-if="!questsOk" class="nge-play-opt-lock">Unlocks with edit access on Retina</span>
          </div>
          <div role="radio" :tabindex="questsOk ? 0 : -1" class="nge-play-opt nge-play-opt--note" style="grid-column: 2; grid-row: 2"
               :class="{ 'nge-play-opt--on': picked === 'quests', 'nge-play-opt--off': !questsOk }"
               :aria-disabled="!questsOk ? 'true' : undefined" :aria-checked="picked === 'quests' ? 'true' : 'false'"
               @click="pick('quests')" @dblclick="go" @keydown.enter.self="go" @keydown.space.self.prevent="pick('quests')">
            <span class="nge-play-opt-name">Cilia Quest</span>
            <span class="nge-play-opt-where">Starburst cells on Retina</span>
            <EditableText text-key="play.quests" :original="QUEST_LINES" list-class="nge-play-opt-lines" notify quiet label="Play card: Cilia Quest" />
            <span v-if="!questsOk" class="nge-play-opt-lock">Unlocks with edit access on Retina</span>
          </div>
          <div role="radio" :tabindex="okFor('glia') ? 0 : -1" class="nge-play-opt nge-play-opt--note" style="grid-column: 2; grid-row: 3"
               :class="{ 'nge-play-opt--on': picked === 'glia', 'nge-play-opt--off': !okFor('glia') }"
               :aria-disabled="!okFor('glia') ? 'true' : undefined" :aria-checked="picked === 'glia' ? 'true' : 'false'"
               @click="pick('glia')" @dblclick="go" @keydown.enter.self="go" @keydown.space.self.prevent="pick('glia')">
            <span class="nge-play-opt-name">Glia Quest</span>
            <span class="nge-play-opt-where">Muller glia on Retina</span>
            <EditableText text-key="play.glia" :original="GLIA_LINES" list-class="nge-play-opt-lines" notify quiet label="Play card: Glia Quest" />
            <span v-if="!GLIA_HERE" class="nge-play-opt-lock">Coming soon</span>
            <span v-else-if="!glia1Ok" class="nge-play-opt-lock">Unlocks with view access on Retina</span>
            <span v-else-if="!questsOk" class="nge-play-opt-note">Stage 1 is open to you. Stage 2 unlocks with edit access.</span>
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
/* A command key, like the intro's Let's go (Ames 2026-11-17: the pill was
   "ugly"): a bright teal key holding the play mark, joined on a slant to a
   glass label with a fine teal edge. Touched, the glass fills with light
   from the key's side and the mark slides on. */
.nge-play-btn {
  --h: 38px; --cut: 7px;
  position: relative; isolation: isolate; display: inline-flex; align-items: stretch; height: var(--h); padding: 0;
  border: 0; background: none; cursor: pointer; color: #e4fff7;
  filter: drop-shadow(0 0 7px rgba(62, 236, 190, 0.35)); transition: filter 0.25s, transform 0.12s;
}
.nge-play-key {
  position: relative; z-index: 1; display: grid; place-items: center; width: calc(var(--h) + 4px);
  clip-path: polygon(var(--cut) 0, 100% 0, calc(100% - 10px) 100%, 0 100%, 0 var(--cut));
  background: linear-gradient(135deg, #d4fff2 0%, #5ef0c6 45%, #19b9a0 100%); color: #032a24;
}
.nge-play-icon { position: relative; z-index: 1; width: 40%; height: 40%; }
/* Hovered, a shine sweeps across the key once; pressed, the key brightens.
   The mark stays put (Ames 2026-11-17 chose this over darkening). */
.nge-play-key { overflow: hidden; transition: filter 0.2s; }
.nge-play-key::after { content: ''; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%; pointer-events: none;
  background: linear-gradient(100deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0)); transform: skewX(-20deg); }
.nge-play-btn:hover .nge-play-key::after, .nge-play-btn:focus-visible .nge-play-key::after { animation: nge-play-shine 0.6s ease-out; }
.nge-play-btn:active .nge-play-key { filter: brightness(1.35); transition-duration: 0.05s; }
@keyframes nge-play-shine { to { left: 120%; } }
.nge-play-label {
  position: relative; display: flex; align-items: center; margin-left: -6px; padding: 0 20px 0 18px; overflow: hidden;
  font: 700 13px/1 'Orbitron', 'Inter', system-ui, sans-serif; letter-spacing: 0.3em; text-transform: uppercase;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%);
  background: linear-gradient(180deg, rgba(110, 245, 205, 0.16), rgba(20, 120, 110, 0.14)), rgba(4, 16, 22, 0.78);
}
.nge-play-label::before {
  content: ''; position: absolute; inset: 0; padding: 1px; clip-path: inherit;
  background: linear-gradient(90deg, rgba(94, 240, 198, 0.9), rgba(94, 240, 198, 0.35));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;
}
.nge-play-label::after {
  content: ''; position: absolute; inset: 0; z-index: -1; transform: scaleX(0); transform-origin: 0 50%;
  background: linear-gradient(90deg, rgba(94, 240, 198, 0.45), rgba(94, 240, 198, 0.06)); transition: transform 0.3s cubic-bezier(.2,.8,.2,1);
}
.nge-play-btn:hover { filter: drop-shadow(0 0 14px rgba(94, 240, 198, 0.75)); }
.nge-play-btn:hover .nge-play-label::after, .nge-play-btn:focus-visible .nge-play-label::after { transform: scaleX(1); }
.nge-play-btn:active { transform: translateY(1px) scale(0.98); }
.nge-play-btn:focus-visible { outline: 2px solid #5ef0c6; outline-offset: 4px; }
/* The Sandbox: larger, with a slow glow, so a new player sees where to start. */
.nge-play-dock--big { top: 80px; left: 14px; }
.nge-play-dock--big .nge-play-btn { --h: 52px; --cut: 9px; animation: nge-play-glow 2.6s ease-in-out infinite; }
.nge-play-dock--big .nge-play-label { font-size: 17px; padding: 0 28px 0 22px; }
@keyframes nge-play-glow { 50% { filter: drop-shadow(0 0 18px rgba(94, 240, 198, 0.8)); } }
@media (prefers-reduced-motion: reduce) { .nge-play-dock--big .nge-play-btn, .nge-play-key::after { animation: none !important; } }

/* -- Pressing Play: the launch -- */
.nge-play-word { position: relative; }
.nge-play-fx { position: absolute; left: calc((var(--h) + 4px) / 2); top: 50%; width: 0; height: 0; pointer-events: none; z-index: 3; }
.nge-play-ring { position: absolute; left: calc(var(--h) * -0.5); top: calc(var(--h) * -0.5); width: var(--h); height: var(--h);
  border-radius: 50%; border: 2px solid #8ff7d8; opacity: 0; box-sizing: border-box; }
.nge-play-spark { position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 8px #8ff7d8, 0 0 16px #5ef0c6; opacity: 0; }
.nge-play-comet { position: absolute; top: 50%; left: 0; width: 46px; height: 4px; margin-top: -2px; border-radius: 2px; opacity: 0; z-index: 3; pointer-events: none;
  background: linear-gradient(90deg, rgba(94, 240, 198, 0), #eafff8 80%, #fff); box-shadow: 0 0 10px #5ef0c6, 0 0 20px rgba(94, 240, 198, 0.7); }
.nge-play-btn.is-launch { animation: nge-play-kick 0.5s cubic-bezier(.2,.8,.2,1); }
.nge-play-btn.is-launch .nge-play-key { animation: nge-play-keyflash 0.55s ease-out; }
.nge-play-btn.is-launch .nge-play-icon { animation: nge-play-iconpop 0.55s cubic-bezier(.2,.8,.2,1); }
.nge-play-btn.is-launch .nge-play-label::after { transform: scaleX(1); animation: nge-play-fill 0.75s ease-out both; }
.nge-play-btn.is-launch .nge-play-ring { animation: nge-play-ring 0.65s cubic-bezier(.1,.7,.3,1) both; }
.nge-play-btn.is-launch .nge-play-ring--2 { animation-delay: 0.12s; border-width: 1px; }
.nge-play-btn.is-launch .nge-play-spark { animation: nge-play-spark 0.6s cubic-bezier(.1,.7,.3,1) var(--t) both; }
.nge-play-btn.is-launch .nge-play-comet { animation: nge-play-comet 0.5s cubic-bezier(.5,0,.2,1) 0.06s both; }
@keyframes nge-play-kick { 0% { transform: scale(1); } 18% { transform: scale(0.94); } 55% { transform: scale(1.05); } 100% { transform: scale(1); } }
@keyframes nge-play-keyflash { 0% { filter: brightness(1); } 20% { filter: brightness(2.2) saturate(0.6); } 100% { filter: brightness(1); } }
@keyframes nge-play-iconpop { 0% { transform: none; } 25% { transform: scale(0.7); } 50% { transform: scale(1.25); } 100% { transform: none; } }
@keyframes nge-play-fill { 0% { opacity: 0; } 25% { opacity: 1; filter: brightness(1.8); } 100% { opacity: 0.35; } }
@keyframes nge-play-ring { 0% { opacity: 0.95; transform: scale(0.5); } 100% { opacity: 0; transform: scale(2.8); } }
@keyframes nge-play-spark { 0% { opacity: 1; transform: rotate(var(--a)) translateX(6px) scale(1.2); } 100% { opacity: 0; transform: rotate(var(--a)) translateX(var(--d)) scale(0.3); } }
@keyframes nge-play-comet { 0% { opacity: 0; left: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; left: calc(100% - 20px); } }

/* -- While the cell loads -- */
.nge-play-arc { position: absolute; left: calc(var(--h) * -0.36); top: calc(var(--h) * -0.36); width: calc(var(--h) * 0.72); height: calc(var(--h) * 0.72);
  box-sizing: border-box; border-radius: 50%; border: 2px solid transparent; border-top-color: #032a24; border-right-color: rgba(3, 42, 36, 0.4); opacity: 0; }
.nge-play-btn.is-loading { cursor: progress; animation: nge-play-glow 1.3s ease-in-out infinite; }
.nge-play-btn.is-loading .nge-play-arc { opacity: 1; animation: nge-play-spin 0.8s linear infinite; }
.nge-play-btn.is-loading .nge-play-icon { animation: nge-play-throb 0.8s ease-in-out infinite; }
.nge-play-btn.is-loading .nge-play-label { letter-spacing: 0.2em; }
.nge-play-beam { position: absolute; top: 0; bottom: 0; left: -45%; width: 45%; opacity: 0;
  background: linear-gradient(90deg, rgba(94, 240, 198, 0), rgba(94, 240, 198, 0.5), rgba(94, 240, 198, 0)); }
.nge-play-btn.is-loading .nge-play-beam { opacity: 1; animation: nge-play-beam 1.1s cubic-bezier(.4,0,.6,1) infinite; }
.nge-play-dots { position: relative; display: inline-flex; gap: 3px; margin-left: 4px; }
.nge-play-dots b { width: 3px; height: 3px; border-radius: 50%; background: currentColor; animation: nge-play-dot 0.9s ease-in-out infinite; }
.nge-play-dots b:nth-child(2) { animation-delay: 0.15s; }
.nge-play-dots b:nth-child(3) { animation-delay: 0.3s; }
@keyframes nge-play-spin { to { transform: rotate(360deg); } }
@keyframes nge-play-throb { 50% { transform: scale(0.8); opacity: 0.7; } }
@keyframes nge-play-beam { to { left: 100%; } }
@keyframes nge-play-dot { 0%, 100% { opacity: 0.25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
.nge-play-fade-leave-active { transition: opacity 0.3s, transform 0.3s; }
.nge-play-fade-leave-to { opacity: 0; transform: translateX(-8px); }
@media (prefers-reduced-motion: reduce) {
  .nge-play-btn.is-launch, .nge-play-btn.is-launch *, .nge-play-btn.is-loading, .nge-play-btn.is-loading * { animation: none !important; }
  .nge-play-btn.is-loading .nge-play-arc { opacity: 0; }
}
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
/* The Retina hub: Map neurons on the left, Find and label on the right. */
.nge-play-hub { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
@media (max-width: 620px) { .nge-play-hub { grid-template-columns: 1fr; } .nge-play-hub > * { grid-column: 1 !important; grid-row: auto !important; } }
.nge-play-sec { font: 600 11.5px 'Orbitron', Inter, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; padding-left: 2px; }
.nge-play-sec--map { color: #3eecbe; }
.nge-play-sec--note { color: #7ecaff; }
.nge-play-hub .nge-play-opt { padding: 11px 14px; gap: 2px; }
.nge-play-hub .nge-play-opt-name { font-size: 17px; }
.nge-play-hub .nge-play-opt-where { font-size: 13px; margin-bottom: 4px; }
.nge-play-hub .nge-play-opt-lines li { font-size: 14px; line-height: 1.4; }
.nge-play-hub .nge-play-opt--note.nge-play-opt--on { background: rgba(126, 202, 255, 0.09); box-shadow: inset 0 0 0 1.5px #7ecaff, inset 0 0 24px rgba(126, 202, 255, 0.15); }
.nge-play-opt-note { margin-top: 6px; font-size: 13.5px; color: #9fd6ff; }
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
