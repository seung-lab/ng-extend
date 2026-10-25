<script setup lang="ts">
/**
 * The pumpkin patch "field report" (Ames 2026-10-20): the chat bar's pumpkin
 * button, pressed away from the patch, asks before taking the player there,
 * told as a joke sighting of a new cell type (Ames: "make this a joke like a
 * rare new spooky type of neuron has been spotted").
 *
 * Styled like the streak card (StreakChip.vue, Ames: "style the pumpkin
 * popup like the streak"): the holopanel surface, one lap of light round the
 * border, one scan band, corner brackets, rows that settle in turn, and a
 * pip for each pumpkin, lit one after another. Pumpkin orange instead of the
 * streak's amber. Escape or a click outside says no.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { patchSize, pumpkinHidden } from '../util/pumpkin';

const emit = defineEmits({ yes: null, no: null, smash: null, toggle: null });
/** Off already: the middle button puts them back instead. */
const hidden = pumpkinHidden();
const yesEl = ref<HTMLButtonElement | null>(null);
const sightings = patchSize();
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); emit('no'); } };
onMounted(() => { yesEl.value?.focus(); window.addEventListener('keydown', onKey, true); });
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <teleport to="body">
    <div class="nge-patch-backdrop" @click.self="emit('no')">
      <div class="nge-patch" role="dialog" aria-modal="true" aria-label="Rare cell type spotted">
        <span class="nge-patch-beam" aria-hidden="true"></span>
        <span class="nge-patch-scan" aria-hidden="true"></span>
        <i class="nge-patch-brk tl" aria-hidden="true"></i><i class="nge-patch-brk tr" aria-hidden="true"></i>
        <i class="nge-patch-brk bl" aria-hidden="true"></i><i class="nge-patch-brk br" aria-hidden="true"></i>
        <button class="nge-patch-x" aria-label="Close" title="Close" @click="emit('no')">×</button>

        <div class="nge-patch-row nge-patch-head" style="--i: 0">
          <span class="nge-patch-pumpkin" aria-hidden="true">🎃</span>
          <span>
            <span class="nge-patch-tag">Field report</span>
            <span class="nge-patch-title">Rare cell type spotted!</span>
          </span>
        </div>
        <div class="nge-patch-row nge-patch-pips" style="--i: 1" :title="`${sightings} sightings`">
          <i v-for="n in sightings" :key="n" class="nge-patch-pip" :style="{ '--n': n }"></i>
          <span class="nge-patch-pips-label">{{ sightings }} sightings</span>
        </div>
        <p class="nge-patch-row nge-patch-text" style="--i: 2">
          Proofreaders in the Sandbox report a <b>jack o' lantern neuron</b>. Only ever seen in October.
        </p>
        <div class="nge-patch-row nge-patch-btns" style="--i: 3">
          <!-- Smash the pumpkins (Ames 2026-10-25): off to the patch with a
               hammer; smashed pumpkins stay off until the chat bar's pumpkin
               button brings them back (util/pumpkin.ts). -->
          <button class="nge-patch-hide" @click="emit('smash')">🔨 Smash the pumpkins</button>
          <button class="nge-patch-no" @click="emit('toggle')">{{ hidden ? 'Show the pumpkin' : 'Hide the pumpkin' }}</button>
          <button ref="yesEl" class="nge-patch-yes" @click="emit('yes')">Go to the patch</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style>
@property --patch-beam { syntax: '<angle>'; initial-value: 0deg; inherits: false; }

.nge-patch-backdrop {
  position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.5); animation: nge-patch-fade 240ms ease both;
}
@keyframes nge-patch-fade { from { opacity: 0; } to { opacity: 1; } }

.nge-patch {
  position: relative; width: 390px; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 18px 20px 16px;
  border-radius: 12px;
  /* the holopanel surface: dark gradient, a lit top hairline, in pumpkin orange */
  background:
    linear-gradient(180deg, rgba(255, 140, 40, 0.08), transparent 38%),
    linear-gradient(160deg, rgba(18, 12, 8, 0.97), rgba(9, 12, 22, 0.97));
  border: 1px solid rgba(255, 140, 40, 0.38);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6), 0 0 28px rgba(255, 130, 20, 0.14), inset 0 1px 0 rgba(255, 200, 140, 0.24);
  color: #d8e2f0; font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5;
  animation: nge-patch-in 520ms cubic-bezier(.16, 1, .3, 1) both;
}
@keyframes nge-patch-in {
  0%   { opacity: 0; transform: translateY(8px) scale(0.82, 0.55); filter: blur(6px) brightness(2.4); clip-path: inset(40% 0 40% 0 round 12px); }
  20%  { opacity: 1; filter: blur(2px) brightness(1.8); }
  50%  { filter: blur(0) brightness(1.25); clip-path: inset(8% 0 8% 0 round 12px); }
  72%  { transform: translateY(0) scale(1.012); clip-path: inset(0 round 12px); }
  100% { opacity: 1; transform: none; filter: none; clip-path: inset(-40px round 12px); }
}
/* a head of light takes one lap of the border, then it is gone */
.nge-patch-beam {
  position: absolute; inset: -1px; border-radius: inherit; padding: 1.5px; pointer-events: none;
  background: conic-gradient(from var(--patch-beam), transparent 0 62%, rgba(255, 130, 30, 0.35) 78%, rgba(255, 200, 130, 0.95) 94%, #fff 98.5%, transparent 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  filter: drop-shadow(0 0 5px rgba(255, 140, 40, 0.8));
  opacity: 0;
  animation: nge-patch-beam 950ms cubic-bezier(.45, 0, .2, 1) 140ms both;
}
@keyframes nge-patch-beam {
  0% { --patch-beam: 40deg; opacity: 0; } 12% { opacity: 1; } 80% { opacity: 1; } 100% { --patch-beam: 400deg; opacity: 0; }
}
/* one scan band, top to bottom, once */
.nge-patch-scan {
  position: absolute; left: 0; right: 0; top: 0; height: 22%; pointer-events: none; opacity: 0; border-radius: inherit;
  background: linear-gradient(180deg, transparent, rgba(255, 160, 80, 0.16), transparent);
  animation: nge-patch-scan 640ms cubic-bezier(.3, 0, .2, 1) 280ms both;
}
@keyframes nge-patch-scan { 0% { transform: translateY(-100%); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(460%); opacity: 0; } }
/* corner brackets push outward from inside the frame and stay */
.nge-patch-brk { position: absolute; width: 10px; height: 10px; pointer-events: none; border: 0 solid rgba(255, 180, 100, 0.85); opacity: 0; animation: nge-patch-brk 480ms cubic-bezier(.16, 1, .3, 1) 220ms both; }
.nge-patch-brk.tl { left: 0; top: 0; border-width: 1.5px 0 0 1.5px; --bx: -1; --by: -1; border-top-left-radius: 4px; }
.nge-patch-brk.tr { right: 0; top: 0; border-width: 1.5px 1.5px 0 0; --bx: 1; --by: -1; border-top-right-radius: 4px; }
.nge-patch-brk.bl { left: 0; bottom: 0; border-width: 0 0 1.5px 1.5px; --bx: -1; --by: 1; border-bottom-left-radius: 4px; }
.nge-patch-brk.br { right: 0; bottom: 0; border-width: 0 1.5px 1.5px 0; --bx: 1; --by: 1; border-bottom-right-radius: 4px; }
@keyframes nge-patch-brk {
  0% { opacity: 0; transform: translate(calc(var(--bx) * -4px), calc(var(--by) * -4px)); }
  60% { opacity: 1; transform: translate(calc(var(--bx) * 7px), calc(var(--by) * 7px)); }
  100% { opacity: 0.85; transform: translate(calc(var(--bx) * 4px), calc(var(--by) * 4px)); }
}
/* the lines settle as a cascade, each a little later than the one above */
.nge-patch-row { animation: nge-patch-row 420ms cubic-bezier(.16, 1, .3, 1) calc(200ms + var(--i) * 75ms) both; }
@keyframes nge-patch-row { 0% { opacity: 0; transform: translateY(7px); filter: blur(3px); } 100% { opacity: 1; transform: none; filter: none; } }

.nge-patch-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.nge-patch-pumpkin { font-size: 42px; line-height: 1; filter: drop-shadow(0 0 10px rgba(255, 140, 30, 0.55)); animation: nge-patch-bob 2.6s ease-in-out 900ms infinite; }
@keyframes nge-patch-bob { 50% { transform: translateY(-3px) rotate(-5deg); } }
.nge-patch-tag { display: block; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #c98a45; }
.nge-patch-title { display: block; font-size: 20px; font-weight: 700; color: #ffb35c; }

/* sightings: one pip a pumpkin, lit in order */
.nge-patch-pips { display: flex; align-items: center; gap: 5px; margin-bottom: 10px; }
.nge-patch-pip {
  width: 26px; height: 6px; border-radius: 3px;
  background: rgba(255, 160, 80, 0.13); box-shadow: inset 0 0 0 1px rgba(255, 160, 80, 0.16);
  animation: nge-patch-pip 380ms cubic-bezier(.2, 1.5, .4, 1) calc(380ms + var(--n) * 110ms) both;
}
@keyframes nge-patch-pip {
  0% { background: rgba(255, 160, 80, 0.13); transform: scaleY(1); }
  40% { background: #fff0dc; transform: scaleY(2.2); box-shadow: 0 0 10px rgba(255, 150, 60, 0.95); }
  100% { background: linear-gradient(90deg, #ff8a1e, #ffc27a); transform: scaleY(1); box-shadow: 0 0 6px rgba(255, 130, 30, 0.55); }
}
.nge-patch-pips-label { margin-left: 4px; font-size: 13.5px; color: #9fb3cc; font-variant-numeric: tabular-nums; }

.nge-patch-text { margin: 0 0 16px; color: #d4dcea; font-size: 15.5px; }
.nge-patch-text b { color: #ffc27a; font-weight: 600; white-space: nowrap; }
.nge-patch-x {
  position: absolute; top: 8px; right: 10px; z-index: 2; padding: 0 4px; font-size: 20px; line-height: 1;
  color: #b9a48c; background: none; border: 0; cursor: pointer;
}
.nge-patch-x:hover { color: #ffd59a; }
.nge-patch-btns { flex-wrap: wrap; display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
/* a quiet text button on the left, so the two answers keep their place */
.nge-patch-hide {
  /* its own line under the two answers */
  order: 3; flex-basis: 100%; margin-top: 2px; padding: 6px 4px; font: inherit; font-size: 14px; cursor: pointer;
  color: #ffc98a; background: none; border: 0; text-decoration: underline; text-underline-offset: 3px; text-align: right;
}
.nge-patch-hide:hover { color: #ffd59a; }
.nge-patch-hide:focus-visible { outline: 2px solid #ffd59a; outline-offset: 2px; border-radius: 4px; }
.nge-patch-no, .nge-patch-yes { font: inherit; font-size: 15px; padding: 8px 18px; border-radius: 8px; cursor: pointer; }
.nge-patch-no { color: #d8e2f0; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(160, 175, 200, 0.35); }
.nge-patch-no:hover { background: rgba(255, 255, 255, 0.1); }
.nge-patch-yes {
  color: #1a0d00; font-weight: 700; border: 1px solid rgba(255, 210, 150, 0.8);
  background: linear-gradient(180deg, #ffb055, #ff8a1e); box-shadow: 0 0 14px rgba(255, 130, 30, 0.35);
}
.nge-patch-yes:hover { background: linear-gradient(180deg, #ffc070, #ff9a33); }
.nge-patch-no:focus-visible, .nge-patch-yes:focus-visible { outline: 2px solid #ffd59a; outline-offset: 2px; }

/* Reduced motion: the finished card, pips lit, no sweep. */
@media (prefers-reduced-motion: reduce) {
  .nge-patch, .nge-patch-backdrop, .nge-patch-row, .nge-patch-brk, .nge-patch-pumpkin { animation: none; }
  .nge-patch-brk { opacity: 0.85; transform: translate(calc(var(--bx) * 4px), calc(var(--by) * 4px)); }
  .nge-patch-beam, .nge-patch-scan { display: none; }
  .nge-patch-pip { animation: none; background: linear-gradient(90deg, #ff8a1e, #ffc27a); box-shadow: 0 0 6px rgba(255, 130, 30, 0.55); }
}
</style>
