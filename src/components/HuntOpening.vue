<script setup lang="ts">
/**
 * Entering the Hunt (Ames 2026-10-23: "can we get a cool opening loading animation?"): while the
 * Hunt opens (a dataset switch, its view, the gem layers), a gold gem turns in two cyan rings over a
 * light bar in the middle of the screen, with the step it is on. It never blocks the view (no clicks),
 * and stays a moment so a quick open does not flash. Driven by huntState.opening (src/hunt.ts).
 */
import { huntState } from '../hunt';
</script>

<template>
  <Transition name="nge-ho">
    <div v-if="huntState.opening" class="nge-ho" role="status" aria-live="polite">
      <div class="nge-ho-stage" aria-hidden="true">
        <span class="nge-ho-ring nge-ho-ring--a"></span>
        <span class="nge-ho-ring nge-ho-ring--b"></span>
        <span class="nge-ho-glow"></span>
        <svg class="nge-ho-gem" viewBox="0 0 24 24" width="64" height="64">
          <path d="M5 9 L9 4 L15 4 L19 9 L12 20 Z" fill="currentColor" />
          <path d="M5 9 H19 M9 4 L12 9 L15 4 M12 9 V20" fill="none" stroke="#6b4c00" stroke-width="0.6" opacity="0.55" />
        </svg>
      </div>
      <div class="nge-ho-title">Entering the Hunt</div>
      <div v-if="huntState.opening.title" class="nge-ho-name">{{ huntState.opening.title }}</div>
      <div class="nge-ho-bar" aria-hidden="true"><span></span></div>
      <div class="nge-ho-step">{{ huntState.opening.step }}</div>
    </div>
  </Transition>
</template>

<style scoped>
.nge-ho {
  position: fixed; inset: 0; z-index: 940; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  background: radial-gradient(closest-side at 50% 50%, rgba(3, 7, 16, 0.78), rgba(3, 7, 16, 0.35) 70%, transparent 100%);
  font-family: 'Inter', system-ui, sans-serif;
}
.nge-ho-stage { position: relative; width: 150px; height: 150px; display: flex; align-items: center; justify-content: center; perspective: 420px; margin-bottom: 6px; }
.nge-ho-ring { position: absolute; inset: 0; border-radius: 50%; }
.nge-ho-ring--a { border: 2px dashed rgba(66, 213, 236, 0.55); animation: nge-ho-spin 7s linear infinite; }
.nge-ho-ring--b { inset: 18px; border: 1px solid rgba(126, 224, 255, 0.35); border-top-color: rgba(230, 248, 255, 0.95); border-right-color: rgba(126, 224, 255, 0.7);
  box-shadow: 0 0 18px rgba(66, 213, 236, 0.25); animation: nge-ho-spin 1.6s linear infinite reverse; }
.nge-ho-glow { position: absolute; width: 90px; height: 90px; border-radius: 50%;
  background: radial-gradient(circle, rgba(245, 209, 66, 0.35), rgba(245, 209, 66, 0) 70%); animation: nge-ho-pulse 1.4s ease-in-out infinite alternate; }
.nge-ho-gem { position: relative; color: #f5d142; filter: drop-shadow(0 0 10px rgba(245, 209, 66, 0.85)) drop-shadow(0 0 26px rgba(245, 209, 66, 0.35));
  transform-style: preserve-3d; animation: nge-ho-turn 1.8s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
.nge-ho-title { font: 700 18px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #f5d142;
  text-shadow: 0 0 14px rgba(245, 209, 66, 0.5), 0 2px 6px rgba(0, 0, 0, 0.9); }
.nge-ho-name { font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #d4ecff; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9); }
.nge-ho-bar { position: relative; width: 220px; height: 2px; margin: 8px 0 2px; border-radius: 2px; overflow: hidden; background: rgba(126, 224, 255, 0.15); }
.nge-ho-bar span { position: absolute; top: 0; bottom: 0; width: 40%; border-radius: 2px;
  background: linear-gradient(90deg, rgba(53, 181, 255, 0), rgba(232, 246, 255, 1) 50%, rgba(53, 181, 255, 0));
  box-shadow: 0 0 10px 1px rgba(53, 181, 255, 0.65); animation: nge-ho-sweep 1.2s ease-in-out infinite; }
.nge-ho-step { font-size: 12.5px; color: rgba(212, 236, 255, 0.85); text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9); min-height: 18px; }

@keyframes nge-ho-spin { to { transform: rotate(360deg); } }
@keyframes nge-ho-turn { 0% { transform: rotateY(0deg) translateY(0); } 50% { transform: rotateY(180deg) translateY(-4px); } 100% { transform: rotateY(360deg) translateY(0); } }
@keyframes nge-ho-pulse { from { transform: scale(0.85); opacity: 0.6; } to { transform: scale(1.15); opacity: 1; } }
@keyframes nge-ho-sweep { from { left: -40%; } to { left: 100%; } }

.nge-ho-enter-active { transition: opacity 0.25s ease, transform 0.35s cubic-bezier(0.2, 1.2, 0.4, 1); }
.nge-ho-leave-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.nge-ho-enter-from { opacity: 0; transform: scale(0.94); }
.nge-ho-leave-to { opacity: 0; transform: scale(1.04); }

@media (prefers-reduced-motion: reduce) {
  .nge-ho-ring--a, .nge-ho-ring--b, .nge-ho-glow, .nge-ho-gem, .nge-ho-bar span { animation: none; }
  .nge-ho-bar span { left: 30%; }
}
</style>
