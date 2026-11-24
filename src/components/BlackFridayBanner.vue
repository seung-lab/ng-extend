<script setup lang="ts">
/**
 * "Black Friday: every quest counts twice" (Ames 2026-11-24). Once per
 * browser on Black Friday (src/util/black_friday.ts), when the player is in
 * the game: a gold band sweeps across with 2× tags falling, then fades. A
 * click ends it early. One popup at a time (popup_queue.ts). Calm screen and
 * reduced motion get the band still, with nothing falling.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { takeTurn } from '../util/popup_queue';
import { BLACK_FRIDAY, isBlackFriday } from '../util/black_friday';

const showing = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let waiting: ReturnType<typeof setInterval> | null = null;
const KEY = `nge-black-friday-${BLACK_FRIDAY}`;

onMounted(() => {
  if (!isBlackFriday()) return;
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  // Only once the player can see it: signed in, and on this tab.
  waiting = setInterval(() => {
    if (document.hidden || document.querySelector('.nge-login-blocker')) return;
    if (waiting) { clearInterval(waiting); waiting = null; }
    void takeTurn('black-friday', () => showing.value, { priority: 6, maxWaitMs: 10 * 60_000 }).then(ok => {
      if (!ok || showing.value) return;
      try { localStorage.setItem(KEY, '1'); } catch { /* shown anyway */ }
      showing.value = true;
      timer = setTimeout(close, 6000);
    });
  }, 2000);
});

function close() {
  showing.value = false;
  if (timer) { clearTimeout(timer); timer = null; }
}
onUnmounted(() => { if (timer) clearTimeout(timer); if (waiting) clearInterval(waiting); });

// 2× tags falling across the band, each with its own pace.
const tags = Array.from({ length: 18 }, (_, i) => ({ x: (i * 53) % 100, delay: (i % 6) * 0.22, dur: 1.8 + ((i * 13) % 9) / 10, size: 13 + ((i * 7) % 8), cyan: i % 3 === 0 }));
</script>

<template>
  <div v-if="showing" class="nge-bf" role="status" @click="close">
    <div class="nge-bf-band">
      <span v-for="(g, i) in tags" :key="i" class="nge-bf-tag" :class="{ 'nge-bf-tag--cyan': g.cyan }"
            :style="{ left: g.x + '%', animationDelay: g.delay + 's', animationDuration: g.dur + 's', fontSize: g.size + 'px' }">2×</span>
      <div class="nge-bf-eyebrow">Black Friday · today only</div>
      <div class="nge-bf-title"><span class="nge-bf-two">2</span> quests for every 1</div>
      <div class="nge-bf-what">Every quest you finish today counts twice on the Quests leaderboard, until midnight Eastern time.</div>
    </div>
  </div>
</template>

<style scoped>
.nge-bf { position: fixed; inset: 0; z-index: 9300; display: flex; align-items: center; justify-content: center; cursor: pointer; background: rgba(2, 6, 16, 0.45); animation: nge-bf-dim 6s ease forwards; }
.nge-bf-band {
  position: relative; overflow: hidden; width: 100%; padding: 28px 16px 26px; text-align: center;
  background: rgba(8, 13, 26, 0.94); border-top: 2px solid rgba(245, 209, 66, 0.85); border-bottom: 2px solid rgba(245, 209, 66, 0.85);
  box-shadow: 0 0 40px rgba(245, 209, 66, 0.25);
  animation: nge-bf-sweep 0.7s cubic-bezier(0.2, 1.2, 0.4, 1);
}
.nge-bf-eyebrow { font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.3em; text-transform: uppercase; color: #9fd0ff; }
.nge-bf-title { margin-top: 6px; font: 800 clamp(28px, 5.5vw, 52px) 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.04em; color: #fff; animation: nge-bf-title 0.9s cubic-bezier(0.2, 1.6, 0.4, 1) 0.15s both; }
.nge-bf-two { display: inline-block; color: #f5d142; text-shadow: 0 0 24px rgba(245, 209, 66, 0.7); animation: nge-bf-pop 1.2s cubic-bezier(0.2, 1.8, 0.4, 1) 0.6s both; }
.nge-bf-what { margin: 8px auto 0; max-width: 40em; font: 15px 'Inter', sans-serif; color: #cfdcef; }
.nge-bf-tag {
  position: absolute; top: -24px; font-family: 'Orbitron', 'Inter', sans-serif; font-weight: 800; color: #f5d142;
  text-shadow: 0 0 6px rgba(245, 209, 66, 0.8); animation: nge-bf-fall linear infinite;
}
.nge-bf-tag--cyan { color: #5fd4ff; text-shadow: 0 0 6px rgba(95, 212, 255, 0.8); }
@keyframes nge-bf-sweep { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
@keyframes nge-bf-title { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes nge-bf-pop { 0% { transform: scale(1); } 40% { transform: scale(1.6) rotate(-8deg); } 100% { transform: scale(1); } }
@keyframes nge-bf-fall { from { transform: translateY(0) rotate(-10deg); opacity: 0.95; } to { transform: translateY(240px) rotate(25deg); opacity: 0; } }
@keyframes nge-bf-dim { 0%, 88% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .nge-bf, .nge-bf-band, .nge-bf-title, .nge-bf-two { animation: none !important; }
  .nge-bf-tag { display: none; }
}
:global(body.nge-calm .nge-bf-band), :global(body.nge-calm .nge-bf-title), :global(body.nge-calm .nge-bf-two) { animation: none !important; }
:global(body.nge-calm .nge-bf-tag) { display: none; }
</style>
