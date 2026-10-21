<script setup lang="ts">
/**
 * Each gem's answer, on the spot where it was dropped (Ames 2026-10-21: "needs
 * better UI UX fun animation for submission and result of got it vs didn't").
 * While the server judges it, a gem spins where the Ctrl + Click landed; then a
 * right gem bursts into gold sparks with "Got it!", a wrong one cracks and fades
 * gray, and a gem on a problem found already gets a soft blue ring. The Hunt box
 * says the same in words. With Calm screen or reduced motion: no motion, just
 * the gem and its word. Nothing here catches the mouse.
 */
import { computed, ref, watch } from 'vue';
import { huntState } from '../hunt';

const shown = ref<null | { key: number; x: number; y: number; result: string; head: string; sub: string }>(null);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const pending = computed(() => {
  const p = huntState.pending;
  return p && p.x != null && p.y != null ? { x: p.x, y: p.y, gem: p.gem } : null;
});

watch(() => huntState.news?.at, () => {
  const n = huntState.news;
  if (!n || n.x == null || n.y == null) return;
  const head = n.result === 'hit' ? 'Got it!' : n.result === 'miss' ? 'Not there' : n.result === 'already' ? 'Found already' : 'No gem';
  const sub = n.result === 'hit' ? (n.kind === 'merge' ? 'Missing extension' : 'Merger') : n.result === 'miss' && n.other ? (n.other === 'merge' ? 'Needs an extension' : 'Needs a cut') : '';
  shown.value = { key: n.at, x: n.x, y: n.y, result: n.result, head, sub };
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { shown.value = null; }, n.result === 'hit' ? 1900 : 1500);
});

// Twelve sparks, evenly round, a little uneven in reach.
const sparks = Array.from({ length: 12 }, (_, i) => ({ a: (i / 12) * 360, d: 46 + ((i * 37) % 22) }));
</script>

<template>
  <div class="nge-gemfx" aria-hidden="true">
    <div v-if="pending && !shown" class="nge-gemfx-spot" :style="{ left: pending.x + 'px', top: pending.y + 'px' }">
      <svg class="nge-gemfx-spin" :class="`nge-gemfx-spin--${pending.gem}`" viewBox="0 0 24 24" width="26" height="26"><path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/></svg>
    </div>
    <div v-if="shown" :key="shown.key" class="nge-gemfx-spot" :class="`nge-gemfx--${shown.result}`" :style="{ left: shown.x + 'px', top: shown.y + 'px' }">
      <span v-if="shown.result === 'hit'" class="nge-gemfx-ring"></span>
      <template v-if="shown.result === 'hit'">
        <span v-for="(s, i) in sparks" :key="i" class="nge-gemfx-spark" :style="{ '--a': s.a + 'deg', '--d': s.d + 'px' }"></span>
      </template>
      <span v-if="shown.result === 'already'" class="nge-gemfx-ring nge-gemfx-ring--blue"></span>
      <svg class="nge-gemfx-gem" viewBox="0 0 24 24" width="30" height="30">
        <path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor"/>
        <path v-if="shown.result === 'miss'" d="M10 5 L12.5 10 L10.5 13 L13 18" fill="none" stroke="#0b1020" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
      <span class="nge-gemfx-word">{{ shown.head }}<small v-if="shown.sub">{{ shown.sub }}</small></span>
    </div>
  </div>
</template>

<style scoped>
.nge-gemfx { position: fixed; inset: 0; pointer-events: none; z-index: 9400; }
.nge-gemfx-spot { position: absolute; width: 0; height: 0; }
.nge-gemfx-spin, .nge-gemfx-gem, .nge-gemfx-ring, .nge-gemfx-spark, .nge-gemfx-word { position: absolute; }
.nge-gemfx-spin { left: -13px; top: -13px; animation: nge-gemfx-spin 0.9s linear infinite; filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.35)); }
.nge-gemfx-spin--cut { color: #e06060; }
.nge-gemfx-spin--merge { color: #5aaaff; }
.nge-gemfx-gem { left: -15px; top: -15px; }
.nge-gemfx-word {
  left: 0; top: -30px; transform: translate(-50%, -100%); white-space: nowrap; text-align: center;
  font: 700 18px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9);
}
.nge-gemfx-word small { display: block; font: 600 12px 'Inter', sans-serif; letter-spacing: 0; opacity: 0.9; }

.nge-gemfx--hit .nge-gemfx-gem { color: #f5d142; filter: drop-shadow(0 0 10px rgba(245, 209, 66, 0.9)); animation: nge-gemfx-pop 0.55s cubic-bezier(0.2, 1.7, 0.4, 1); }
.nge-gemfx--hit .nge-gemfx-word { color: #f5d142; animation: nge-gemfx-rise 1.9s ease-out forwards; }
.nge-gemfx-ring { left: -18px; top: -18px; width: 36px; height: 36px; border-radius: 50%; border: 3px solid #f5d142; animation: nge-gemfx-ring 0.8s ease-out forwards; }
.nge-gemfx-ring--blue { border-color: #5aaaff; }
.nge-gemfx-spark {
  left: -3px; top: -3px; width: 6px; height: 6px; background: #f5d142; border-radius: 1px;
  transform: rotate(var(--a)) translateX(0) rotate(45deg); box-shadow: 0 0 6px rgba(245, 209, 66, 0.9);
  animation: nge-gemfx-spark 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
}
.nge-gemfx--miss .nge-gemfx-gem { color: #7d8799; animation: nge-gemfx-crack 1.5s ease-in forwards; }
.nge-gemfx--miss .nge-gemfx-word { color: #c9d2e0; animation: nge-gemfx-rise 1.5s ease-out forwards; }
.nge-gemfx--already .nge-gemfx-gem { color: #5aaaff; animation: nge-gemfx-fade 1.5s ease-in forwards; }
.nge-gemfx--already .nge-gemfx-word { color: #9fd0ff; animation: nge-gemfx-rise 1.5s ease-out forwards; }
.nge-gemfx--refused .nge-gemfx-gem { color: #e06060; animation: nge-gemfx-fade 1.5s ease-in forwards; }
.nge-gemfx--refused .nge-gemfx-word { color: #ffb3b3; animation: nge-gemfx-rise 1.5s ease-out forwards; }

@keyframes nge-gemfx-spin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
@keyframes nge-gemfx-pop { 0% { transform: scale(0.4); } 60% { transform: scale(1.5); } 100% { transform: scale(1); } }
@keyframes nge-gemfx-ring { 0% { transform: scale(0.4); opacity: 1; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes nge-gemfx-spark { 0% { transform: rotate(var(--a)) translateX(0) rotate(45deg); opacity: 1; } 100% { transform: rotate(var(--a)) translateX(var(--d)) rotate(45deg) scale(0.3); opacity: 0; } }
@keyframes nge-gemfx-rise { 0% { transform: translate(-50%, -80%); opacity: 0; } 15% { opacity: 1; } 80% { opacity: 1; } 100% { transform: translate(-50%, -160%); opacity: 0; } }
@keyframes nge-gemfx-crack { 0% { transform: rotate(0); opacity: 1; } 15% { transform: rotate(-12deg); } 30% { transform: rotate(10deg); } 45% { transform: rotate(-6deg); } 100% { transform: rotate(0) translateY(14px) scale(0.8); opacity: 0; } }
@keyframes nge-gemfx-fade { 0% { opacity: 1; } 100% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .nge-gemfx-spin, .nge-gemfx-gem, .nge-gemfx-ring, .nge-gemfx-spark, .nge-gemfx-word { animation: none !important; }
  .nge-gemfx-spark, .nge-gemfx-ring { display: none; }
  .nge-gemfx-word { transform: translate(-50%, -100%); }
}
:global(body.nge-calm) .nge-gemfx-spin, :global(body.nge-calm) .nge-gemfx-gem, :global(body.nge-calm) .nge-gemfx-word { animation: none !important; }
:global(body.nge-calm) .nge-gemfx-spark, :global(body.nge-calm) .nge-gemfx-ring { display: none; }
</style>
