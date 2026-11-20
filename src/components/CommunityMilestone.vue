<script setup lang="ts">
/**
 * The community milestone celebration (Ames 2026-11-20): when everyone together
 * passes a big milestone, the banner drops in at the top with confetti and
 * Nurro flies across, once per browser. A click on the X closes it; the
 * milestone's notification brings it back, quietly. Lost Fragments milestones
 * use it too. See util/community_milestones.ts for what counts and when.
 *
 * The box is the starship intro's hologram callout (util/intro_tour.ts
 * calloutFrame): cut corners, blue glass with scan lines, circuit traces
 * (Ames: "make the box cooler! like the pyr rockethip intro boxes").
 * CONGRATS! is the headline, its letters springing in; the countdown is a
 * small line at the bottom (Ames: "make the congrats bigger and more exciting
 * and a fun text animation! and then the countdown thing at the bottom is
 * more a secondary element").
 *
 * On a test site, ?cmMilestone=cells:5000 (edits, players, fragments too)
 * shows it, to look at; ?lfMilestone=500 still shows a Lost Fragments one.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import ConfettiCelebration from 'components/ConfettiCelebration.vue';
import { useProofreadingBackendStore } from '../store';
import { secureWrite } from '../secure_write';
import { ON_TEST_SITE } from '../hunt';
import { fragmentTester } from '../util/play';
import { flyNurroAcross } from '../util/nurro_fly';
import { fragmentsDone, setFragmentsDone } from '../util/fragment_milestones';
import {
  celebration, communityCounts, loadCommunityMilestones, markSeen, milestoneParts,
  nextMilestoneAfter, reopen, type Track,
} from '../util/community_milestones';

const backend = useProofreadingBackendStore();
const confetti = ref<InstanceType<typeof ConfettiCelebration> | null>(null);
const boxEl = ref<HTMLElement | null>(null);
const frame = ref('');
let preview = false;

const fmt = (n: number) => n.toLocaleString('en-US');
const LETTERS = [...'CONGRATS!'];
/** When CONGRATS! is done: the last letter lands at 700 + 8 x 70 + 620 ms and
 *  the light's sweep ends at 2,600 ms (the CSS below). */
const NURRO_AFTER_MS = 2700;
const shown = computed(() => celebration.value);
const parts = computed(() => shown.value ? milestoneParts(shown.value.track, shown.value.value) : ['', '', '']);
const done = computed(() => {
  const c = shown.value;
  if (!c) return 0;
  const n = c.track === 'fragments' ? fragmentsDone.value : communityCounts.value[c.track];
  return Math.max(n ?? 0, c.value);
});
const next = computed(() => shown.value ? nextMilestoneAfter(shown.value.track, done.value) : 0);
const toGo = computed(() => Math.max(0, next.value - done.value));
/** How far along to the next milestone. */
const progress = computed(() => next.value > 0 ? Math.min(1, done.value / next.value) : 0);

// ── The hologram frame, drawn to the box's own size ─────────────────────────
function frameSvg(w: number, h: number): string {
  const c = 12, f = (n: number) => n.toFixed(1);
  const rim = `M${c} 0.5 H${f(w - 0.5)} V${f(h - c)} L${f(w - c)} ${f(h - 0.5)} H0.5 V${c} Z`;
  const a = Math.min(64, w * 0.2), b = Math.min(48, w * 0.15), sr = Math.min(h * 0.3, 34), sl = Math.min(h * 0.3, 30);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="nge-cm-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(30,110,200)" stop-opacity="0.34"/><stop offset="0.6" stop-color="rgb(10,50,120)" stop-opacity="0.42"/><stop offset="1" stop-color="rgb(20,70,160)" stop-opacity="0.36"/></linearGradient>
      <pattern id="nge-cm-scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="rgba(126,224,255,0.09)"/></pattern></defs>
    <path d="${rim}" fill="rgba(8,20,44,0.86)"/><path d="${rim}" fill="url(#nge-cm-bg)"/><path d="${rim}" fill="url(#nge-cm-scan)"/>
    <path d="${rim}" fill="none" stroke="rgba(140,225,255,0.75)" stroke-width="1"/>
    <path class="tr" d="M${f(w - 16)} 0.5 l-6 6 h-${f(a)}"/><circle class="pad" cx="${f(w - 22 - a)}" cy="6.5" r="2"/>
    <path class="tr" d="M${f(w - 0.5)} 18 l-6 6 v${f(sr)}"/><circle class="pad" cx="${f(w - 6.5)}" cy="${f(24 + sr)}" r="2"/>
    <path class="tr" d="M16 ${f(h - 0.5)} l6 -6 h${f(b)}"/><circle class="pad" cx="${f(22 + b)}" cy="${f(h - 6.5)}" r="2"/>
    <path class="tr" d="M0.5 ${f(h - 16)} l6 -6 v-${f(sl)}"/><circle class="pad" cx="6.5" cy="${f(h - 22 - sl)}" r="2"/></svg>`;
}
let fw = 0, fh = 0;
function redraw() {
  const el = boxEl.value;
  if (!el) return;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (w && h && (w !== fw || h !== fh)) { fw = w; fh = h; frame.value = frameSvg(w, h); }
}
let ro: ResizeObserver | null = null;
watch(boxEl, (el) => {
  ro?.disconnect(); ro = null; fw = fh = 0;
  if (!el) return;
  redraw();
  try { ro = new ResizeObserver(redraw); ro.observe(el); } catch { /* drawn once */ }
  // The lettering's web font can land after the box: draw again then.
  void document.fonts?.ready.then(redraw);
});

// ── Showing ─────────────────────────────────────────────────────────────────
watch(celebration, async (c, old) => {
  if (!c || (old && old.track === c.track && old.value === c.value)) return;
  await nextTick();
  if (!c.confetti) return;
  // Two bursts, then a third from the banner. Nurro flies across once
  // CONGRATS! has built in and its light has swept by, about 2.7 s (Ames:
  // "Nurro should always fly across when there is a celebration", then
  // "congrats it builds in and after the animation finishes then Nurro flies by").
  setTimeout(() => confetti.value?.trigger('champions', 1.4), 150);
  setTimeout(() => { if (celebration.value === c) void flyNurroAcross(); }, NURRO_AFTER_MS);
  setTimeout(() => confetti.value?.trigger('cyan', 1), 900);
  setTimeout(() => confetti.value?.trigger('champions', 0.8, { x: window.innerWidth / 2, y: 110 }), 1800);
});
function close() {
  const c = celebration.value;
  if (c && !preview) markSeen(c.track, c.value);
  celebration.value = null;
}

/** From a notification: #nge-milestone=cells:5000. */
function onReopen(e: Event) {
  const d = (e as CustomEvent<{ track?: string; value?: number }>).detail || {};
  const t = d.track as Track;
  if (!['cells', 'edits', 'players', 'fragments'].includes(t) || !(Number(d.value) > 0)) return;
  reopen(t, Number(d.value));
}

// ── Asking the server ───────────────────────────────────────────────────────
let loadedFor = '';
let timer = 0;
function loadCommunity() {
  if (!backend.userId) return;
  loadedFor = backend.userId;
  void loadCommunityMilestones().catch(() => undefined);
}
/** Lost Fragments' count, for the players who can play it. */
let askedFragments = false;
async function askFragments() {
  if (askedFragments || !backend.userId || !(backend.isAdmin || fragmentTester())) return;
  askedFragments = true;
  try {
    const res = await secureWrite<{ mine: unknown[]; others: string[] }>('fragments.list');
    setFragmentsDone((res.mine || []).length + (res.others || []).length);
  } catch { askedFragments = false; }
}
watch(() => [backend.userId, backend.isAdmin], () => {
  if (backend.userId && backend.userId !== loadedFor) loadCommunity();
  void askFragments();
});

onMounted(() => {
  document.addEventListener('nge:milestone', onReopen);
  loadCommunity();
  void askFragments();
  // The server checks hourly; look again now and then, so a milestone reached
  // while someone plays arrives in the same session. Two tiny tables.
  timer = window.setInterval(loadCommunity, 20 * 60 * 1000);
  if (ON_TEST_SITE) {
    const q = new URLSearchParams(location.search);
    const cm = (q.get('cmMilestone') || '').match(/^(cells|edits|players|fragments):(\d+)$/);
    const lf = Number(q.get('lfMilestone'));
    const pick: [Track, number] | null = cm ? [cm[1] as Track, Number(cm[2])] : lf > 0 ? ['fragments', lf] : null;
    if (pick && pick[1] > 0) {
      preview = true;
      if (pick[0] === 'fragments' && (fragmentsDone.value == null || fragmentsDone.value < pick[1])) fragmentsDone.value = pick[1];
      setTimeout(() => { celebration.value = { track: pick[0], value: pick[1], confetti: true }; }, 1200);
    }
  }
});
onUnmounted(() => {
  document.removeEventListener('nge:milestone', onReopen);
  clearInterval(timer);
  ro?.disconnect();
});
</script>

<template>
  <ConfettiCelebration ref="confetti" />
  <transition name="nge-cm" type="transition">
    <div v-if="shown" :key="shown.track + shown.value" ref="boxEl" class="nge-cm" role="status" aria-live="polite"
         :aria-label="'Congrats! ' + parts.join('')">
      <span class="nge-cm-frame" v-html="frame"></span>
      <div class="nge-cm-kicker"><i></i>Pyr community<i></i></div>
      <div class="nge-cm-congrats" aria-hidden="true"><span
        v-for="(ch, i) in LETTERS" :key="i" :class="{ 'nge-cm-bang': ch === '!' }" :style="{ '--i': i }">{{ ch }}</span></div>
      <div class="nge-cm-sub">{{ parts[0] }}<b>{{ parts[1] }}</b>{{ parts[2] }}</div>
      <div class="nge-cm-next">
        <span>{{ fmt(toGo) }} to go until {{ fmt(next) }}.</span>
        <div class="nge-cm-bar" aria-hidden="true"><div class="nge-cm-fill" :style="{ '--w': (progress * 100).toFixed(1) + '%' }" /></div>
      </div>
      <button class="nge-cm-close" title="Close" aria-label="Close" @click="close">
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
  </transition>
</template>

<style scoped>
.nge-cm { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 10600;
  width: min(520px, calc(100vw - 32px)); box-sizing: border-box; padding: 18px 48px 16px 48px; isolation: isolate;
  color: #e6f3ff; text-align: center; backdrop-filter: blur(3px);
  filter: drop-shadow(0 0 16px rgba(80, 180, 255, 0.35)) drop-shadow(0 12px 30px rgba(0, 0, 0, 0.45));
  animation: nge-cm-build 900ms cubic-bezier(.2,.9,.25,1) both; }
.nge-cm-frame { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.nge-cm-frame :deep(svg) { position: absolute; left: 0; top: 0; overflow: visible; }
.nge-cm-frame :deep(.tr) { fill: none; stroke: rgba(126, 224, 255, 0.55); stroke-width: 1.1; stroke-linecap: round; }
.nge-cm-frame :deep(.pad) { fill: rgba(8, 24, 52, 0.9); stroke: #9fe9ff; stroke-width: 1; }
/* The intro boxes' build: the hologram fills in from the bottom with a flash. */
@keyframes nge-cm-build {
  0% { clip-path: inset(100% 0 0 0); filter: brightness(2.4) drop-shadow(0 0 18px #9fe9ff); }
  70% { clip-path: inset(0 0 0 0); filter: brightness(1.4) drop-shadow(0 0 16px rgba(80, 180, 255, 0.4)); }
  76% { opacity: 0.65; } 80% { opacity: 1; } 84% { opacity: 0.8; }
  100% { clip-path: inset(0 0 0 0); opacity: 1; filter: drop-shadow(0 0 16px rgba(80, 180, 255, 0.35)) drop-shadow(0 12px 30px rgba(0, 0, 0, 0.45)); } }

.nge-cm-kicker { display: flex; justify-content: center; align-items: center; gap: 8px; font: 600 10.5px 'Orbitron', Inter, sans-serif; letter-spacing: 0.32em; text-transform: uppercase; color: #9fdcff; }
.nge-cm-kicker i { width: 8px; height: 8px; border-radius: 50%; background: #ffd35a; box-shadow: 0 0 10px #ffd35a; }

/* CONGRATS! Each letter springs up in turn, a light sweeps across, then a gentle bob. */
.nge-cm-congrats { position: relative; display: inline-block; margin-top: 6px; font: 900 clamp(34px, 9vw, 52px)/1.05 'Orbitron', Inter, sans-serif; letter-spacing: 0.06em; }
.nge-cm-congrats span { display: inline-block; opacity: 0;
  background: linear-gradient(180deg, #ffffff 0%, #c9f6ff 35%, #5fd4ff 70%, #3a8cff 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 10px rgba(95, 212, 255, 0.65));
  animation: nge-cm-pop 620ms cubic-bezier(.3,1.7,.5,1) both, nge-cm-bob 2.4s ease-in-out infinite;
  animation-delay: calc(700ms + var(--i) * 70ms), calc(1500ms + var(--i) * 90ms); }
.nge-cm-congrats span.nge-cm-bang { background: linear-gradient(180deg, #fff6c8, #ffd35a 60%, #f5b82a); -webkit-background-clip: text; background-clip: text; filter: drop-shadow(0 0 12px rgba(255, 211, 90, 0.7)); }
@keyframes nge-cm-pop { 0% { opacity: 0; transform: translateY(26px) scale(0.4) rotate(-8deg); } 60% { opacity: 1; } 100% { opacity: 1; transform: none; } }
@keyframes nge-cm-bob { 0%, 100% { transform: none; } 50% { transform: translateY(-3px); } }
.nge-cm-congrats::after { content: ''; position: absolute; inset: -6px -20px; pointer-events: none; transform: translateX(-120%);
  background: linear-gradient(100deg, transparent 35%, rgba(255, 255, 255, 0.75) 50%, transparent 65%); mix-blend-mode: overlay;
  animation: nge-cm-sweep 1100ms 1500ms ease-in-out both; }
@keyframes nge-cm-sweep { to { transform: translateX(120%); } }

.nge-cm-sub { margin-top: 8px; font: 500 17px/1.35 Inter, sans-serif; color: #dff4ff; animation: nge-cm-rise 500ms 1350ms ease-out both; }
.nge-cm-sub b { font: 700 19px Orbitron, Inter, sans-serif; color: #ffd35a; text-shadow: 0 0 10px rgba(255, 211, 90, 0.4); }
@keyframes nge-cm-rise { from { opacity: 0; transform: translateY(6px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }

/* The countdown: small and quiet, at the bottom. */
.nge-cm-next { display: flex; align-items: center; gap: 10px; margin: 14px -22px 0; padding-top: 9px; border-top: 1px solid rgba(126, 224, 255, 0.2);
  font: 500 12px Inter, sans-serif; color: #7fa9cc; text-align: left; animation: nge-cm-rise 500ms 1700ms ease-out both; }
.nge-cm-bar { position: relative; flex: 1; min-width: 60px; height: 4px; border-radius: 2px; background: rgba(126, 224, 255, 0.12); overflow: hidden; }
.nge-cm-fill { position: absolute; inset: 0 auto 0 0; width: var(--w); background: linear-gradient(90deg, #3a8cff, #5fd4ff); animation: nge-cm-fill 900ms 1900ms ease-out both; }
@keyframes nge-cm-fill { from { width: 0; } }

.nge-cm-close { position: absolute; top: 12px; right: 14px; width: 26px; height: 26px; display: grid; place-items: center; padding: 0; cursor: pointer;
  border: 1px solid rgba(126, 224, 255, 0.45); background: rgba(126, 224, 255, 0.08); color: #c9f6ff;
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
.nge-cm-close:hover { background: rgba(126, 224, 255, 0.22); color: #fff; }
.nge-cm-close:focus-visible { outline: 2px solid #7ecaff; outline-offset: 3px; }

.nge-cm-leave-active { transition: opacity 0.35s ease, transform 0.35s ease; animation: none; }
.nge-cm-leave-to { opacity: 0; transform: translate(-50%, -16px) scaleY(0.6); }
@media (prefers-reduced-motion: reduce) {
  .nge-cm, .nge-cm *, .nge-cm-congrats::after { animation: none !important; opacity: 1; }
  .nge-cm-congrats::after { display: none; }
}
</style>
