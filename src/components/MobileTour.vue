<script setup lang="ts">
/**
 * MobileTour.vue — the phone-sized tutorial.
 *
 * The desktop tutorials (store-pyr) drive viewer state and side panels the
 * phone layout doesn't have, so mobile gets its own short flow (Amy
 * 2026-08-25): a few steps that point at what a phone CAN do — the cell in
 * 3D, then each bottom-nav system — with a caption card above the nav.
 *
 * Purely a guide: it highlights and explains, never opens panels or edits
 * state, so a visitor can follow it while looking at the real app.
 */
import { computed, onUnmounted, ref, watch } from 'vue';

/** loggedIn: neuron meshes come from CAVE behind middleauth, so a
 *  logged-out visitor's viewer may still be empty — step one must not
 *  claim a neuron is on screen when it isn't (Amy 2026-08-25). */
const props = defineProps<{ show: boolean, loggedIn?: boolean }>();
const emit = defineEmits<{ (e: 'finish'): void }>();

interface Step {
  /** Bottom-nav key to ring, or null to point at the viewer itself. */
  nav: string | null;
  title: string;
  body: string;
}

const STEPS_BASE: Step[] = [
  { nav: null, title: '', body: '' },   // replaced below by the viewer step
  { nav: 'cells', title: 'Cell Library',
    body: 'Browse the catalog of reconstructed neurons and tap any one to bring it into the viewer.' },
  { nav: 'chat', title: 'Chat',
    body: 'The community maps these circuits together. Ask anything — scientists and players are both here.' },
  { nav: 'tags', title: 'Tags',
    body: 'Drop a pin on anything that looks interesting or wrong. Tags are how findings get flagged.' },
  { nav: 'alerts', title: 'Notifs',
    body: 'Badges you earn and replies to your tags land here.' },
  { nav: 'guide', title: 'Guide',
    body: 'Tap Guide any time to reopen the welcome page — and to log in when you want to trace neurons yourself.' },
];

const VIEWER_STEP_IN: Step = {
  nav: null, title: 'A real neuron, in 3D',
  body: 'That shape is real brain tissue reconstructed from electron microscopy. Drag to turn it, pinch to zoom.',
};
const VIEWER_STEP_OUT: Step = {
  nav: null, title: 'The viewer',
  body: 'Neurons render here in 3D — drag to turn, pinch to zoom. Log in from the Guide to load them.',
};
const STEPS = computed<Step[]>(() =>
  [props.loggedIn ? VIEWER_STEP_IN : VIEWER_STEP_OUT, ...STEPS_BASE.slice(1)]);

const GLOW = 'nge-tour-target';
const i = ref(0);
const step = computed(() => STEPS.value[i.value]!);
let ringed: Element | null = null;

function clearRing() {
  if (ringed) { ringed.classList.remove(GLOW); ringed = null; }
}
function ringCurrent() {
  clearRing();
  const key = step.value.nav;
  if (!key) return;
  const el = document.querySelector(`[data-mnav="${key}"]`);
  if (el) { el.classList.add(GLOW); ringed = el; }
}
watch([() => props.show, i], async () => {
  if (!props.show) { clearRing(); return; }
  ringCurrent();
}, { immediate: true });
onUnmounted(clearRing);

function next() {
  if (i.value < STEPS.value.length - 1) i.value++;
  else finish();
}
function back() { if (i.value > 0) i.value--; }
function finish() {
  clearRing();
  i.value = 0;
  emit('finish');
}
</script>

<template>
  <teleport to="body">
    <transition name="nge-mt">
      <div v-if="show" class="nge-mt-card" role="dialog" aria-label="Mobile tour">
        <div class="nge-mt-head">
          <span class="nge-mt-count">{{ i + 1 }} / {{ STEPS.length }}</span>
          <button class="nge-mt-skip" @click="finish">Skip</button>
        </div>
        <div class="nge-mt-title">{{ step.title }}</div>
        <p class="nge-mt-body">{{ step.body }}</p>
        <div class="nge-mt-foot">
          <div class="nge-mt-dots">
            <span v-for="(s, n) in STEPS" :key="n" class="nge-mt-dot"
                  :class="{ 'nge-mt-dot--on': n === i }"></span>
          </div>
          <div class="nge-mt-actions">
            <button v-if="i > 0" class="nge-mt-back" @click="back">Back</button>
            <button class="nge-mt-next" @click="next">
              {{ i === STEPS.length - 1 ? 'Start exploring' : 'Next' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style>
/* Sits just above the bottom nav (56px + safe area) so the ringed nav
   button stays visible while its caption is read. */
.nge-mt-card {
  position: fixed;
  left: 10px;
  right: 10px;
  bottom: calc(64px + env(safe-area-inset-bottom));
  z-index: 10450;
  box-sizing: border-box;
  padding: 14px 16px 12px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(11, 20, 36, 0.98), rgba(7, 13, 26, 0.98));
  border: 1px solid rgba(53, 181, 255, 0.4);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6), 0 0 24px rgba(53, 181, 255, 0.14);
  color: #dfe9ff;
  font-family: 'Roboto', sans-serif;
}
.nge-mt-head { display: flex; align-items: center; justify-content: space-between; }
.nge-mt-count {
  font-family: 'Orbitron', sans-serif; font-size: 9px; font-weight: 600;
  letter-spacing: 1.6px; color: rgba(53, 181, 255, 0.85);
}
.nge-mt-skip {
  background: none; border: none; padding: 6px 2px; cursor: pointer;
  font-family: 'Orbitron', sans-serif; font-size: 9.5px; font-weight: 600;
  letter-spacing: 1.2px; color: rgba(143, 166, 204, 0.8);
}
.nge-mt-title {
  margin: 4px 0 5px; font-family: 'Orbitron', sans-serif;
  font-size: 14px; font-weight: 700; color: #f0f6ff;
}
.nge-mt-body { margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: #aebfdd; }
.nge-mt-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.nge-mt-dots { display: flex; gap: 5px; }
.nge-mt-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: rgba(53, 181, 255, 0.28); transition: background 0.2s, transform 0.2s;
}
.nge-mt-dot--on { background: rgb(53, 181, 255); transform: scale(1.35); }
.nge-mt-actions { display: flex; align-items: center; gap: 8px; }
.nge-mt-back, .nge-mt-next {
  min-height: 40px; padding: 0 16px; border-radius: 9px; cursor: pointer;
  font-family: 'Orbitron', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 1px;
}
.nge-mt-back { background: none; border: 1px solid rgba(53, 181, 255, 0.3); color: #cfe2ff; }
.nge-mt-next {
  border: 1px solid rgba(53, 181, 255, 0.55); color: #eaf6ff;
  background: linear-gradient(180deg, rgba(53, 181, 255, 0.22), rgba(53, 181, 255, 0.08));
  box-shadow: 0 0 14px rgba(53, 181, 255, 0.18);
}
.nge-mt-next:active { box-shadow: 0 0 20px rgba(53, 181, 255, 0.38); }

.nge-mt-enter-active, .nge-mt-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.nge-mt-enter-from, .nge-mt-leave-to { opacity: 0; transform: translateY(12px); }
</style>
