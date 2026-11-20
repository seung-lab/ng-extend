<script setup lang="ts">
/**
 * The Lost Fragments milestone banner and confetti (Ames 2026-11-20): at 500
 * fragments completed by everyone, then every 1,000, a banner drops in at the
 * top of the site with confetti and a countdown to the next one. See
 * util/fragment_milestones.ts for the counting.
 *
 * On a test site, ?lfMilestone=500 (or any milestone) shows it, to look at.
 */
import { computed, onMounted, ref, watch } from 'vue';
import ConfettiCelebration from 'components/ConfettiCelebration.vue';
import { useProofreadingBackendStore } from '../store';
import { secureWrite } from '../secure_write';
import { ON_TEST_SITE } from '../hunt';
import { fragmentTester } from '../util/play';
import {
  fragmentsDone, milestoneToShow, nextMilestone, markMilestoneSeen, setFragmentsDone,
} from '../util/fragment_milestones';

const backend = useProofreadingBackendStore();
const confetti = ref<InstanceType<typeof ConfettiCelebration> | null>(null);
const shown = ref<number | null>(null);
let preview = false;

const fmt = (n: number) => n.toLocaleString('en-US');
const done = computed(() => Math.max(fragmentsDone.value ?? 0, shown.value ?? 0));
const next = computed(() => nextMilestone(done.value));
const toGo = computed(() => Math.max(0, next.value - done.value));
/** How far along to the next milestone. */
const progress = computed(() => next.value > 0 ? Math.min(1, done.value / next.value) : 0);

function show(m: number) {
  shown.value = m;
  // Two bursts, then a third from the banner, so it reads as a party.
  setTimeout(() => confetti.value?.trigger('champions', 1.4), 150);
  setTimeout(() => confetti.value?.trigger('cyan', 1), 900);
  setTimeout(() => confetti.value?.trigger('champions', 0.8, { x: window.innerWidth / 2, y: 90 }), 1700);
}
function close() {
  if (shown.value != null && !preview) markMilestoneSeen(shown.value);
  shown.value = null;
  milestoneToShow.value = null;
}
watch(milestoneToShow, (m) => { if (m && shown.value == null) show(m); });

/** Ask the server once a player who can play Lost Fragments is signed in. */
let asked = false;
async function askCount() {
  if (asked || !backend.userId || !(backend.isAdmin || fragmentTester())) return;
  asked = true;
  try {
    const res = await secureWrite<{ mine: unknown[]; others: string[] }>('fragments.list');
    setFragmentsDone((res.mine || []).length + (res.others || []).length);
  } catch { asked = false; }
}
watch(() => [backend.userId, backend.isAdmin], () => { void askCount(); });
onMounted(() => {
  void askCount();
  if (ON_TEST_SITE) {
    const p = Number(new URLSearchParams(location.search).get('lfMilestone'));
    if (p > 0) {
      preview = true;
      if (fragmentsDone.value == null || fragmentsDone.value < p) fragmentsDone.value = p;
      setTimeout(() => show(p), 1200);
    }
  }
});
</script>

<template>
  <ConfettiCelebration ref="confetti" />
  <transition name="nge-lfm">
    <div v-if="shown != null" class="nge-lfm" role="status" aria-live="polite">
      <div class="nge-lfm-kicker">Lost Fragments</div>
      <div class="nge-lfm-title">Congrats! Together we just completed {{ fmt(shown) }} Lost Fragments.</div>
      <div class="nge-lfm-count">
        <span class="nge-lfm-num">{{ fmt(toGo) }}</span> to go until {{ fmt(next) }}.
      </div>
      <div class="nge-lfm-bar" aria-hidden="true"><div class="nge-lfm-fill" :style="{ width: (progress * 100).toFixed(1) + '%' }" /></div>
      <button class="nge-lfm-close" title="Close" aria-label="Close" @click="close">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
  </transition>
</template>

<style scoped>
.nge-lfm { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 10600;
  width: min(520px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 44px 16px 20px;
  background: linear-gradient(160deg, rgba(14, 30, 64, 0.97), rgba(8, 16, 38, 0.97));
  border: 1px solid rgba(111, 196, 255, 0.55); border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(74, 158, 255, 0.15), 0 0 32px rgba(74, 158, 255, 0.25);
  color: #e6f0ff; font: 400 14px/1.4 Inter, system-ui, sans-serif; text-align: left; }
.nge-lfm-kicker { font: 700 11px/1 'Orbitron', Inter, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #8fd6ff; margin-bottom: 8px; }
.nge-lfm-title { font: 700 18px/1.3 Inter, system-ui, sans-serif; color: #ffffff; }
.nge-lfm-count { margin-top: 10px; color: #b9d4f2; }
.nge-lfm-num { font: 700 16px/1 'Orbitron', Inter, sans-serif; color: #ffd35a; }
.nge-lfm-bar { margin-top: 10px; height: 6px; border-radius: 3px; background: rgba(127, 190, 255, 0.15); overflow: hidden; }
.nge-lfm-fill { height: 100%; min-width: 4px; border-radius: 3px; background: linear-gradient(90deg, #4a9eff, #6fe0ff); transition: width 0.6s ease; }
.nge-lfm-close { position: absolute; top: 10px; right: 10px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid rgba(127, 190, 255, 0.3); border-radius: 6px; background: transparent; color: #a9c3e0; cursor: pointer; }
.nge-lfm-close:hover { border-color: rgba(143, 214, 255, 0.7); color: #fff; background: rgba(74, 158, 255, 0.15); }
.nge-lfm-enter-active, .nge-lfm-leave-active { transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.2, 1.3, 0.4, 1); }
.nge-lfm-enter-from, .nge-lfm-leave-to { opacity: 0; transform: translate(-50%, -24px); }
</style>
