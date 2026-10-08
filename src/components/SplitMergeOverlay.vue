<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSplitMergeOverlayStore } from 'src/store';
import { useTutorialStore } from '../store-pyr';
import { exitGrapheneTool } from '../widgets/graphene_tool_utils';
import { currentSegLayer } from '../datasets';
import { Uint64 } from 'neuroglancer/util/uint64';

// Hovering a segment in the Merge Queue lights it up in the 2D and 3D views
// and in the segment list, the way neuroglancer's own merge list does (Nik,
// 2026-10-08). It sets the viewer's hovered segment, nothing more.
function hoverSegment(id: string | null) {
  try {
    const state = (currentSegLayer()?.layer as any)?.displayState?.segmentSelectionState;
    if (!state) return;
    if (id && /^\d+$/.test(id)) state.set(Uint64.parseString(id));
    else state.set(null);
  } catch { /* the layer went away */ }
}

const store = useSplitMergeOverlayStore();

// Bar stays visible during pendingClose (success hold before exit)
const isVisible = computed(() => store.toolActive !== null || store.pendingClose);
// Other floating panels (the chat) sit on the same bottom edge; tell them
// the bar is there (Amy: chat was hidden behind merge mode).
watch(isVisible, v => document.body.classList.toggle('nge-tool-bar-open', v), { immediate: true });
// ...and how tall it is, so the coordinates chip and chat stack above it.
const barEl = ref<HTMLElement | null>(null);
const barSize = new ResizeObserver(() => {
  const h = barEl.value ? Math.round(barEl.value.getBoundingClientRect().height) : 0;
  document.body.style.setProperty('--nge-tool-bar-h', h + 'px');
});
watch(barEl, (el, old) => {
  if (old) barSize.unobserve(old);
  if (el) barSize.observe(el);
  else document.body.style.setProperty('--nge-tool-bar-h', '0px');
});
const isMulticut = computed(() => store.toolActive === 'multicut' || store.closingTool === 'multicut');
const isMerge = computed(() => store.toolActive === 'merge' || store.closingTool === 'merge');
const isRedActive = computed(() => store.activeGroup === 'red');
// A short pulse on the colour pills each time the active colour changes, so
// pressing G visibly does something there (Ames, 2026-10-06).
// "Now press G": red has points, blue has none, and red is still the active
// colour (Ames, 2026-10-07). The G key and the hint keep pulsing until the
// colour is switched.
const needsSwap = computed(() => isMulticut.value && !store.pendingClose
  && store.redPointCount > 0 && store.bluePointCount === 0 && store.activeGroup === 'red');
// The large "Press G" prompt is for learners only: it shows while a step of
// the Merge, Cut or Merger Sandbox tutorial is up (Ames, 2026-10-08). Outside
// a tutorial the small pulsing G key on the bar is the only nudge.
const tutorialStore = useTutorialStore();
const inPracticeTutorial = computed(() => {
  const step = tutorialStore.getTutorialStep();
  return [3, 5, 9].includes(tutorialStore.activeTutorial) && step >= 0 && step < 8;
});
const groupPulse = ref(false);
let groupPulseTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => store.activeGroup, (now, before) => {
  if (!before || now === before) return;
  groupPulse.value = false;
  requestAnimationFrame(() => { groupPulse.value = true; });
  if (groupPulseTimer) clearTimeout(groupPulseTimer);
  groupPulseTimer = setTimeout(() => { groupPulse.value = false; }, 1800);
});
const isBlueActive = computed(() => store.activeGroup === 'blue');
const totalPoints = computed(() => store.redPointCount + store.bluePointCount);

const isSubmitting = computed(() => store.submitting);
const isPendingClose = computed(() => store.pendingClose);
const hasResult = computed(() => store.resultFlash !== '');
const resultIsSuccess = computed(() => store.resultFlash === 'success');
const resultIsError = computed(() => store.resultFlash === 'error');
// Show inline result on bar (merge mode stays open, shows temporary result)
const hasInlineResult = computed(() => hasResult.value && !store.pendingClose);
const hasMergeSegments = computed(() => store.mergeSegments.length > 0);
/** Something is ready to submit: the button pulses (Amy). */
const mergeReady = computed(() => store.mergeSegments.some(p => p.length >= 2));
const cutReady = computed(() => store.redPointCount > 0 && store.bluePointCount > 0);

/** Hand the error to the AI guide (Amy 2026-09-29): it opens and asks. */
function askGuideAboutError() {
  const err = store.resultText;
  document.dispatchEvent(new CustomEvent('nge:ask-guide', { detail: {
    text: `My ${isMulticut.value ? 'split' : 'edit'} failed with this error: "${err}". What does it mean, and what should I do?`,
  } }));
}

const contextHint = computed(() => {
  if (store.statusMessage) return store.statusMessage;
  // The error lives in the popup only; repeating it here doubled it (Amy 2026-09-29).
  if (isSubmitting.value) return 'Submitting...';
  if (isMulticut.value && !store.pendingClose) {
    if (totalPoints.value === 0) return 'Ctrl+Click on supervoxels to mark them';
    if (store.redPointCount > 0 && store.bluePointCount === 0) return 'Press G to swap to Blue group, then Ctrl+Click';
    if (store.redPointCount > 0 && store.bluePointCount > 0) return 'Ready to submit — press Enter';
    return 'Ctrl+Click to add more points';
  }
  if (isMerge.value && !store.pendingClose) {
    if (store.mergeSubmissionCount === 0) return 'Ctrl+Click on two segments to draw a merge line';
    return `${store.mergeSubmissionCount} merge${store.mergeSubmissionCount !== 1 ? 's' : ''} queued`;
  }
  return '';
});

/** Click the inactive group pill to swap to that group */
function swapGroup() {
  const multicutEl = document.querySelector('.graphene-multicut');
  if (multicutEl) {
    const icons = multicutEl.querySelectorAll('.neuroglancer-icon');
    if (icons[0]) { (icons[0] as HTMLElement).click(); return; }
  }
  // Fallback: dispatch 'g' key to neuroglancer container
  const container = document.getElementById('neuroglancer-container');
  if (container) {
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', bubbles: true }));
  }
}

/** Click NG's Clear button to reset all placed points */
function clearPoints() {
  // Flag the clear FIRST so the DOM scanner doesn't misread the points
  // resetting to 0 as a split submit ("Submitting split...").
  store.markCleared();
  const multicutEl = document.querySelector('.graphene-multicut');
  if (multicutEl) {
    const icons = multicutEl.querySelectorAll('.neuroglancer-icon');
    if (icons[1]) (icons[1] as HTMLElement).click();
  }
}

/** Toggle NG's native auto-submit checkbox */
function toggleAutoSubmit() {
  const mergeEl = document.querySelector('.graphene-merge-segments');
  if (!mergeEl) return;
  const checkbox = mergeEl.querySelector('label input[type="checkbox"]') as HTMLInputElement | null;
  if (checkbox) checkbox.click();
}

/** Press neuroglancer's own Submit icon for the active tool. The keyboard
 *  hint used to be the only "button" here and it was not clickable, which
 *  left mouse users, and anyone in a tutorial, without a way to submit. */
function submitTool(kind: 'multicut' | 'merge') {
  const title = kind === 'multicut' ? 'Submit multicut' : 'Submit merge';
  const icon = document.querySelector(`.neuroglancer-icon[title="${title}"]`) as HTMLElement | null;
  if (icon) { icon.click(); return; }
  // Fallback: the tool's own Enter binding.
  const viewer = (window as any)['viewer'];
  const target = viewer?.element ?? document.getElementById('neuroglancer-container');
  target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
}

/** Exit the current split/merge tool (cancel the operation). */
function cancelTool() {
  exitGrapheneTool();
}

// exitGrapheneTool is imported from ../widgets/graphene_tool_utils
</script>

<template>
  <Teleport to="body">
    <transition name="overlay-slide">
      <div v-if="isVisible" ref="barEl" class="nge-split-merge-overlay" :class="{
        'nge-smo-has-banner': needsSwap,
        multicut: isMulticut && !isPendingClose,
        'group-red': isMulticut && !isPendingClose && isRedActive,
        'group-blue': isMulticut && !isPendingClose && isBlueActive,
        merge: isMerge && !isPendingClose,
        submitting: isSubmitting,
        'bar-success': isPendingClose && resultIsSuccess,
        'bar-error': isPendingClose && resultIsError,
        'bar-inline-success': hasInlineResult && resultIsSuccess,
        'bar-inline-error': hasInlineResult && resultIsError,
      }">

        <!-- SUCCESS / ERROR CLOSE STATE — replaces normal content -->
        <template v-if="isPendingClose">
          <div class="nge-smo-mode-badge success-badge">
            {{ resultIsSuccess ? 'SUCCESS' : 'ERROR' }}
          </div>
          <div class="nge-smo-hint success-hint">{{ store.resultText }}</div>
        </template>

        <!-- MULTICUT / SPLIT MODE -->
        <template v-else-if="isMulticut">
          <!-- "Press G": red is placed, blue is empty, red is still on. A
               large prompt above the bar, since the small key on the bar was
               missed and second red points were placed instead (Ames,
               2026-10-08). Clicking it switches too. -->
          <div v-if="needsSwap && inPracticeTutorial" class="nge-smo-swap-banner" @click="swapGroup()" role="status">
            <span class="nge-smo-swap-banner-step">Red is placed</span>
            <span class="nge-smo-swap-banner-main">Now press <kbd>G</kbd> to switch to <b>blue</b></span>
            <span class="nge-smo-swap-banner-sub">then Ctrl+click the other side</span>
          </div>
          <div class="nge-smo-loading-indicator nge-smo-loading-indicator--left" v-if="isSubmitting">
            <span class="nge-smo-spinner"></span>
          </div>
          <div class="nge-smo-mode-badge split-badge">
            CUT MODE
          </div>

          <div class="nge-smo-groups" :class="{ 'nge-smo-groups--pulse': groupPulse }">
            <div class="nge-smo-group red" :class="{ active: isRedActive }"
                 @click="!isRedActive && swapGroup()" :title="isRedActive ? 'Red group (active)' : 'Click to switch to Red'">
              <span class="nge-smo-group-dot red-dot"></span>
              <span class="nge-smo-group-label">RED</span>
              <span class="nge-smo-group-count">{{ store.redPointCount }} pt{{ store.redPointCount !== 1 ? 's' : '' }}</span>
            </div>
            <div class="nge-smo-divider">|</div>
            <div class="nge-smo-group blue" :class="{ active: isBlueActive }"
                 @click="!isBlueActive && swapGroup()" :title="isBlueActive ? 'Blue group (active)' : 'Click to switch to Blue'">
              <span class="nge-smo-group-dot blue-dot"></span>
              <span class="nge-smo-group-label">BLUE</span>
              <span class="nge-smo-group-count">{{ store.bluePointCount }} pt{{ store.bluePointCount !== 1 ? 's' : '' }}</span>
            </div>
            <!-- The swap key sits with the colours it swaps (it used to be
                 far right, among Submit and Cancel). -->
            <span class="nge-smo-key-hint nge-smo-swap-hint" :class="{ 'nge-smo-swap-hint--now': needsSwap }" @click="swapGroup()" title="Switch between red and blue"><kbd>G</kbd> {{ needsSwap ? 'Press G for blue' : 'Swap' }}</span>
          </div>

          <!-- All the cut controls sit together on the left (Ames,
               2026-10-07); the hint takes the rest of the bar. -->
          <div class="nge-smo-actions nge-smo-actions--left" v-if="!isSubmitting">
            <button class="nge-smo-action-btn submit-btn" :class="{ 'is-ready': cutReady }" @click="submitTool('multicut')" title="Submit the cut (or press Enter)">Submit cut</button>
            <button class="nge-smo-action-btn clear-btn" @click="clearPoints" title="Clear all points">Clear</button>
            <button class="nge-smo-action-btn cancel-btn" @click="cancelTool" title="Exit cut mode"><kbd>Esc</kbd> Cancel</button>
          </div>

          <div class="nge-smo-hint nge-smo-hint--left" :class="{ 'error-hint': hasInlineResult && resultIsError, 'nge-smo-hint--now': needsSwap }">{{ contextHint }}</div>
        </template>

        <!-- MERGE MODE -->
        <template v-else-if="isMerge">
          <div class="nge-smo-mode-badge merge-badge">
            MERGE MODE
          </div>
          <!-- Progress sits by the badge, where the eye already is (Amy). -->
          <div class="nge-smo-loading-indicator nge-smo-loading-indicator--left" v-if="isSubmitting">
            <span class="nge-smo-spinner"></span>
          </div>

          <div class="nge-smo-hint merge-hint" :class="{ 'error-hint': hasInlineResult && resultIsError }">{{ contextHint }}</div>

          <div class="nge-smo-actions" v-if="!isSubmitting">
            <label class="nge-smo-auto-submit" title="Auto-submit merges when both points are placed" @click.prevent="toggleAutoSubmit">
              <span class="nge-smo-checkbox" :class="{ checked: store.autoSubmit }">{{ store.autoSubmit ? '☑' : '☐' }}</span>
              auto-submit
            </label>
            <span class="nge-smo-key-hint"><kbd>Ctrl+Click</kbd> Set points</span>
            <button class="nge-smo-action-btn submit-btn" :class="{ 'is-ready': mergeReady }" @click="submitTool('merge')" title="Submit the merge (or press Enter)">Submit merge</button>
            <button class="nge-smo-action-btn cancel-btn" @click="cancelTool" title="Exit merge mode"><kbd>Esc</kbd> Cancel</button>
          </div>
        </template>

      </div>
    </transition>

    <!-- Merge segment queue (vertical list, left side) -->
    <transition name="merge-list-fade">
      <div v-if="isMerge && hasMergeSegments && !isPendingClose" class="nge-smo-merge-panel">
        <div class="nge-smo-merge-panel-header">
          Merge Queue ({{ store.mergeSegments.length }})
        </div>
        <div class="nge-smo-merge-panel-list">
          <div v-for="(pair, i) in store.mergeSegments" :key="i" class="nge-smo-merge-row">
            <span class="nge-smo-merge-num">{{ i + 1 }}.</span>
            <span class="nge-smo-seg-id nge-smo-seg-id--hover" title="Hover to light this segment up in the views"
                  @mouseenter="hoverSegment(pair[0])" @mouseleave="hoverSegment(null)">{{ pair[0] }}</span>
            <span v-if="pair[1]" class="nge-smo-merge-arrow">⇄</span>
            <span v-if="pair[1]" class="nge-smo-seg-id nge-smo-seg-id--hover" title="Hover to light this segment up in the views"
                  @mouseenter="hoverSegment(pair[1])" @mouseleave="hoverSegment(null)">{{ pair[1] }}</span>
            <button class="nge-smo-merge-remove" @click.stop="store.removeMergeSegment(i)" title="Remove this merge pair">×</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Holographic result flash (shows below bar for inline results during merge) -->
    <transition name="flash-pop">
      <div v-if="hasInlineResult" class="nge-smo-result-flash" :class="{ success: resultIsSuccess, error: resultIsError }">
        <span class="nge-smo-result-icon">{{ resultIsSuccess ? '✓' : '✗' }}</span>
        <div class="nge-smo-result-body">
          <span class="nge-smo-result-text">{{ store.resultText }}</span>
          <div v-if="resultIsError" class="nge-smo-result-actions">
            <span class="nge-smo-result-retry">Press Enter to retry</span>
            <button class="nge-smo-result-ask" @click.stop="askGuideAboutError">✦ Ask the AI guide what this means</button>
          </div>
        </div>
        <button v-if="resultIsError" class="nge-smo-result-close" @click.stop="store.dismissResult()" title="Dismiss" aria-label="Dismiss">×</button>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.nge-split-merge-overlay {
  position: fixed;
  /* On the bottom edge (Krzysztof: a bare 28px strip showed under it), and
     lifted above neuroglancer's status bar only while it shows a message. */
  bottom: var(--nge-bottom-bar, 0px);
  transition: bottom 0.2s ease;
  left: 0;
  right: 0;
  z-index: 9500;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  min-height: 48px;
  font-family: 'Inter', 'Roboto', sans-serif;
  font-size: 13px;
  color: #e0e0e0;
  pointer-events: none;
  user-select: none;
}

/* Mode-specific backgrounds */
.nge-split-merge-overlay.multicut {
  background: linear-gradient(
    90deg,
    rgba(180, 30, 30, 0.88) 0%,
    rgba(20, 14, 40, 0.92) 40%,
    rgba(20, 14, 40, 0.92) 60%,
    rgba(30, 30, 180, 0.88) 100%
  );
  border-top: 2px solid rgba(255, 60, 60, 0.5);
  backdrop-filter: blur(8px);
}

.nge-split-merge-overlay.merge {
  background: linear-gradient(
    90deg,
    rgba(15, 140, 80, 0.88) 0%,
    rgba(20, 14, 40, 0.92) 30%,
    rgba(20, 14, 40, 0.92) 100%
  );
  border-top: 2px solid rgba(0, 220, 120, 0.5);
  backdrop-filter: blur(8px);
}

/* ── Submitting state — bar pulses with energy ── */
.nge-split-merge-overlay.submitting {
  animation: bar-submitting-pulse 1.4s ease-in-out infinite;
}

/* ── Success close state — bar transforms to green before holographic exit ── */
.nge-split-merge-overlay.bar-success {
  background: linear-gradient(
    90deg,
    rgba(0, 180, 80, 0.92) 0%,
    rgba(0, 200, 100, 0.88) 30%,
    rgba(0, 180, 90, 0.90) 70%,
    rgba(0, 200, 100, 0.88) 100%
  ) !important;
  border-top: 2px solid rgba(0, 255, 140, 0.7) !important;
  backdrop-filter: blur(8px);
  box-shadow: 0 0 30px rgba(0, 220, 120, 0.3), inset 0 0 20px rgba(0, 255, 140, 0.05);
  transition: background 0.4s ease, border-color 0.3s ease, box-shadow 0.4s ease;
}

.nge-split-merge-overlay.bar-error {
  background: linear-gradient(
    90deg,
    rgba(180, 30, 30, 0.92) 0%,
    rgba(160, 20, 20, 0.90) 50%,
    rgba(180, 30, 30, 0.92) 100%
  ) !important;
  border-top: 2px solid rgba(255, 80, 80, 0.7) !important;
  backdrop-filter: blur(8px);
  box-shadow: 0 0 30px rgba(255, 60, 60, 0.3), inset 0 0 20px rgba(255, 80, 80, 0.05);
}

/* Inline flash on bar (merge mode — tool stays open) */
.nge-split-merge-overlay.bar-inline-success {
  border-top-color: rgba(0, 255, 140, 0.7) !important;
  box-shadow: 0 0 20px rgba(0, 220, 120, 0.2);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.nge-split-merge-overlay.bar-inline-error {
  border-top-color: rgba(255, 80, 80, 0.7) !important;
  box-shadow: 0 0 20px rgba(255, 60, 60, 0.2);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

/* Mode badge */
.nge-smo-mode-badge {
  padding: 4px 14px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 1.2px;
  white-space: nowrap;
  flex-shrink: 0;
}

.split-badge {
  background: rgba(200, 40, 40, 0.6);
  border: 1px solid rgba(255, 80, 80, 0.7);
  color: #ff9090;
  text-shadow: 0 0 8px rgba(255, 60, 60, 0.6);
  animation: pulse-split 2s ease-in-out infinite;
}

.merge-badge {
  background: rgba(15, 160, 90, 0.6);
  border: 1px solid rgba(0, 220, 120, 0.7);
  color: #80ffc0;
  text-shadow: 0 0 8px rgba(0, 220, 120, 0.6);
  animation: pulse-merge 2s ease-in-out infinite;
}

.success-badge {
  background: rgba(0, 200, 100, 0.7);
  border: 1px solid rgba(0, 255, 140, 0.8);
  color: #e0fff0;
  text-shadow: 0 0 12px rgba(0, 255, 140, 0.8);
  animation: pulse-success 1s ease-in-out infinite;
  font-size: 15px;
  letter-spacing: 2px;
}

.success-hint {
  color: #c0ffe0 !important;
  font-style: normal !important;
  font-weight: 500;
  text-shadow: 0 0 6px rgba(0, 220, 120, 0.4);
}

/* Loading spinner */
.nge-smo-loading-indicator {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.nge-smo-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: rgba(255, 255, 255, 0.8);
  border-radius: 50%;
  animation: smo-spin 0.8s linear infinite;
}

/* Group indicators */
/* Which colour is being placed, at a glance: the whole bar takes the active
   colour (it used to be red on the left and blue on the right whatever the
   state), the active pill grows, the other one fades back. */
.nge-split-merge-overlay.multicut.group-red {
  background: linear-gradient(90deg, rgba(190, 28, 28, 0.92) 0%, rgba(96, 16, 22, 0.92) 45%, rgba(24, 12, 20, 0.94) 100%);
  border-top: 2px solid rgba(255, 70, 70, 0.85);
}
.nge-split-merge-overlay.multicut.group-blue {
  background: linear-gradient(90deg, rgba(34, 48, 200, 0.92) 0%, rgba(20, 26, 110, 0.92) 45%, rgba(12, 14, 34, 0.94) 100%);
  border-top: 2px solid rgba(90, 120, 255, 0.9);
}
.nge-split-merge-overlay.multicut { transition: background 0.35s ease, border-color 0.35s ease; }
.nge-smo-group.active { transform: scale(1.08); }
.nge-smo-group.active .nge-smo-group-label { font-size: 13px; color: #fff; }
.nge-smo-group.active .nge-smo-group-count { color: #fff; }
.nge-smo-group:not(.active) { opacity: 0.38; }
.nge-smo-swap-hint { margin: 0 0 0 4px; cursor: pointer; pointer-events: auto; opacity: 0.9; }
.nge-smo-swap-banner {
  position: fixed; left: 50%; bottom: calc(var(--nge-tool-bar-h, 66px) + 22px); transform: translateX(-50%);
  z-index: 9000; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 14px 28px 16px; border-radius: 14px; cursor: pointer; pointer-events: auto; text-align: center;
  background: linear-gradient(160deg, rgba(30, 44, 150, 0.96), rgba(14, 20, 70, 0.97));
  border: 2px solid #8fa6ff; color: #fff; font-family: Inter, system-ui, sans-serif;
  animation: nge-smo-banner-in 0.35s cubic-bezier(0.2, 1.3, 0.4, 1) both, nge-smo-banner-pulse 1.3s ease-out 0.35s infinite;
}
.nge-smo-swap-banner-step { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; color: #ff9a9a; }
.nge-smo-swap-banner-main { font-size: 24px; font-weight: 700; line-height: 1.25; }
.nge-smo-swap-banner-main b { color: #9db4ff; }
.nge-smo-swap-banner-main kbd {
  display: inline-block; min-width: 38px; padding: 2px 10px; margin: 0 4px; border-radius: 8px;
  background: #4f7dff; border: 2px solid #dbe4ff; color: #fff; font: inherit; font-size: 26px; text-align: center;
  box-shadow: 0 3px 0 #2a48b0;
}
.nge-smo-swap-banner-sub { font-size: 14px; color: rgba(225, 232, 255, 0.85); }
@keyframes nge-smo-banner-in { from { opacity: 0; margin-bottom: -14px; } to { opacity: 1; margin-bottom: 0; } }
@keyframes nge-smo-banner-pulse {
  0% { box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6), 0 0 0 0 rgba(120, 150, 255, 0.75); }
  100% { box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6), 0 0 0 22px rgba(120, 150, 255, 0); }
}
@media (prefers-reduced-motion: reduce) { .nge-smo-swap-banner { animation: none; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); } }
/* "Now press G": the key lights up blue and pulses until it is pressed. */
.nge-smo-swap-hint--now { opacity: 1; color: #fff; font-weight: 600; }
.nge-smo-swap-hint--now kbd {
  background: #4f7dff !important; border-color: #b9caff !important; color: #fff !important;
  transform: scale(1.25); animation: nge-smo-swap-now 0.9s ease-out infinite;
}
.nge-smo-hint--now { color: #fff; font-weight: 600; font-style: normal; }
@keyframes nge-smo-swap-now {
  0% { box-shadow: 0 0 0 0 rgba(120, 150, 255, 0.9); }
  100% { box-shadow: 0 0 0 14px rgba(120, 150, 255, 0); }
}
@media (prefers-reduced-motion: reduce) { .nge-smo-swap-hint--now kbd { animation: none; box-shadow: 0 0 0 3px rgba(120, 150, 255, 0.8); } }
.nge-smo-groups--pulse .nge-smo-group.active { animation: nge-smo-group-pulse 0.6s ease-out 3; }
.nge-smo-groups--pulse .nge-smo-swap-hint kbd { animation: nge-smo-group-pulse 0.6s ease-out 3; }
@keyframes nge-smo-group-pulse {
  0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.75); }
  100% { box-shadow: 0 0 0 14px rgba(255, 255, 255, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .nge-smo-groups--pulse .nge-smo-group.active, .nge-smo-groups--pulse .nge-smo-swap-hint kbd { animation: none; }
}

.nge-smo-groups {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.nge-smo-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 20px;
  transition: all 0.2s ease;
  opacity: 0.5;
  pointer-events: auto;
  cursor: pointer;
}

.nge-smo-group:not(.active):hover {
  opacity: 0.8;
}

.nge-smo-group.active {
  opacity: 1;
  cursor: default;
}

.nge-smo-group.red.active {
  background: rgba(255, 50, 50, 0.25);
  box-shadow: 0 0 12px rgba(255, 50, 50, 0.4), inset 0 0 8px rgba(255, 50, 50, 0.15);
  border: 1px solid rgba(255, 80, 80, 0.6);
}

.nge-smo-group.blue.active {
  background: rgba(50, 80, 255, 0.25);
  box-shadow: 0 0 12px rgba(50, 80, 255, 0.4), inset 0 0 8px rgba(50, 80, 255, 0.15);
  border: 1px solid rgba(80, 100, 255, 0.6);
}

.nge-smo-group:not(.active) {
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.nge-smo-group-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.red-dot { background: #ff4444; box-shadow: 0 0 6px rgba(255, 50, 50, 0.8); }
.blue-dot { background: #4466ff; box-shadow: 0 0 6px rgba(50, 80, 255, 0.8); }

.nge-smo-group-label {
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.nge-smo-group-count {
  font-size: 13px;
  font-weight: 500;
  color: #ccc;
}

.nge-smo-divider {
  color: rgba(255, 255, 255, 0.2);
  font-size: 18px;
}

/* Context hint */
.nge-smo-hint {
  flex: 1;
  text-align: center;
  font-size: 13px;
  color: #aaa;
  font-style: italic;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merge-hint {
  color: #80d8a8;
}

/* Actions & keyboard shortcuts */
.nge-smo-actions--left { margin-left: 14px; }
.nge-smo-hint--left { text-align: left; padding-left: 18px; }
.nge-smo-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 12px;
  color: #888;
  pointer-events: auto;
}

.nge-smo-action-btn {
  pointer-events: auto;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #ccc;
  font-family: 'Inter', 'Roboto', sans-serif;
  font-size: 12px;
  padding: 3px 10px;
  transition: all 0.15s ease;
  margin-right: 4px;
}

.nge-smo-action-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}

.nge-smo-action-btn:active {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(0.96);
}

.nge-smo-action-btn.submit-btn {
  background: rgba(0, 200, 100, 0.22);
  border-color: rgba(0, 220, 120, 0.55);
  color: #e6ffef;
  font-weight: 600;
}
.nge-smo-action-btn.submit-btn:hover {
  background: rgba(0, 220, 120, 0.38);
  border-color: rgba(0, 240, 140, 0.8);
}
.nge-smo-action-btn.submit-btn.is-ready {
  animation: nge-smo-submit-pulse 1.1s ease-in-out infinite;
}
@keyframes nge-smo-submit-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(0, 220, 120, 0.0); background: rgba(0, 200, 100, 0.22); }
  50%      { box-shadow: 0 0 14px 4px rgba(0, 220, 120, 0.55); background: rgba(0, 220, 120, 0.42); }
}

.nge-smo-key-hint {
  margin-right: 8px;
}

.nge-smo-key-hint:last-child {
  margin-right: 0;
}

.nge-smo-key-hint kbd,
.nge-smo-actions kbd {
  display: inline-block;
  padding: 2px 7px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-family: 'Inter', 'Roboto', monospace;
  font-size: 11px;
  color: #ccc;
  line-height: 1.4;
}

/* ── Merge segment vertical panel (left side) ── */
.nge-smo-merge-panel {
  position: fixed;
  bottom: calc(56px + var(--nge-bottom-bar, 0px));
  left: 12px;
  z-index: 9501;
  min-width: 200px;
  max-width: 420px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: rgba(10, 18, 28, 0.92);
  border: 1px solid rgba(0, 220, 120, 0.25);
  border-radius: 8px;
  backdrop-filter: blur(12px);
  pointer-events: auto;
  font-family: 'Inter', 'Roboto', sans-serif;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.nge-smo-merge-panel-header {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #80ffc0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(0, 220, 120, 0.15);
}

.nge-smo-merge-panel-list {
  overflow-y: auto;
  max-height: 300px;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 220, 120, 0.3) transparent;
}

.nge-smo-merge-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  transition: background 0.15s ease;
}
.nge-smo-merge-row:hover {
  background: rgba(0, 220, 120, 0.08);
}
.nge-smo-seg-id--hover { cursor: default; border-radius: 3px; transition: background 0.12s ease, color 0.12s ease; }
.nge-smo-seg-id--hover:hover { background: rgba(0, 220, 120, 0.22); color: #ffffff; }

.nge-smo-merge-num {
  font-size: 10px;
  color: rgba(0, 220, 120, 0.5);
  min-width: 18px;
}

.nge-smo-seg-id {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 10px;
  color: #90e8c0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}

.nge-smo-merge-arrow {
  color: rgba(0, 220, 120, 0.5);
  font-size: 10px;
}

.nge-smo-merge-remove {
  margin-left: auto;
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  opacity: 0.6;
  color: #f66;
  transition: opacity 0.15s ease;
  pointer-events: auto;
}
.nge-smo-merge-row:hover .nge-smo-merge-remove {
  opacity: 0.7;
}
.nge-smo-merge-remove:hover {
  opacity: 1 !important;
}

/* Merge panel transition */
.merge-list-fade-enter-active,
.merge-list-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.merge-list-fade-enter-from,
.merge-list-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* ── Auto-submit checkbox ── */
.nge-smo-auto-submit {
  display: flex;
  align-items: center;
  gap: 4px;
  pointer-events: auto;
  cursor: pointer;
  color: #aaa;
  font-size: 12px;
  margin-right: 8px;
  white-space: nowrap;
  transition: color 0.15s ease;
}

.nge-smo-auto-submit:hover {
  color: #80ffc0;
}

.nge-smo-checkbox {
  font-size: 14px;
  color: #666;
  transition: color 0.15s ease;
}

.nge-smo-checkbox.checked {
  color: #80ffc0;
  text-shadow: 0 0 6px rgba(0, 220, 120, 0.5);
}

/* Error hint styling */
.nge-smo-hint.error-hint {
  color: #ffb0b0;
  font-style: normal;
  text-shadow: 0 0 6px rgba(255, 60, 60, 0.4);
}

/* Animations */
@keyframes pulse-split {
  0%, 100% { box-shadow: 0 0 8px rgba(255, 60, 60, 0.3); }
  50% { box-shadow: 0 0 16px rgba(255, 60, 60, 0.6); }
}

@keyframes pulse-merge {
  0%, 100% { box-shadow: 0 0 8px rgba(0, 220, 120, 0.3); }
  50% { box-shadow: 0 0 16px rgba(0, 220, 120, 0.6); }
}

@keyframes pulse-success {
  0%, 100% { box-shadow: 0 0 8px rgba(0, 255, 140, 0.4); }
  50% { box-shadow: 0 0 20px rgba(0, 255, 140, 0.8); }
}

@keyframes bar-submitting-pulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.25); }
}

@keyframes smo-spin {
  to { transform: rotate(360deg); }
}

/* ═══════════════════════════════════════════════════════════════
   HOLOGRAPHIC RESULT FLASH — ILM-grade sci-fi materialization
   Entry:  beam line → vertical expand → glitch resolve → settle
   Idle:   scanline overlay + breathing edge glow + ambient hum
   Exit:   destabilize → chromatic split → collapse → vanish
   ═══════════════════════════════════════════════════════════════ */

.nge-smo-result-flash {
  position: fixed;
  bottom: calc(44px + var(--nge-bottom-bar, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 9600;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 32px;
  border-radius: 12px;
  font-family: 'Inter', 'Roboto', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.4px;
  pointer-events: none;
  user-select: none;
  /* The whole error, wrapped, never cut off with an ellipsis (Amy 2026-09-29). */
  white-space: normal;
  max-width: min(640px, 92vw);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
}

/* ── Subtle glow shimmer on entry ── */
.nge-smo-result-flash::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 50%);
  pointer-events: none;
}
.nge-smo-result-flash::after { display: none; }

/* ── SUCCESS ── */
.nge-smo-result-flash.success {
  background-color: rgba(8, 30, 22, 0.92);
  border: 1px solid rgba(0, 220, 120, 0.25);
  color: #a0ffd4;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px rgba(0, 220, 120, 0.15);
  text-shadow: 0 0 6px rgba(0, 220, 120, 0.4);
  animation: smo-result-glow-green 2s ease-in-out infinite;
}

/* ── ERROR ── */
.nge-smo-result-flash.error {
  background-color: rgba(35, 10, 10, 0.92);
  border: 1px solid rgba(255, 100, 100, 0.2);
  color: #ffb8b8;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px rgba(255, 80, 80, 0.1);
  text-shadow: 0 0 6px rgba(255, 80, 80, 0.3);
  animation: smo-result-shake 0.4s ease-out;
}

.nge-smo-result-icon {
  font-size: 20px;
  filter: drop-shadow(0 0 4px currentColor);
}

.nge-smo-result-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.nge-smo-result-text {
  line-height: 1.4;
  overflow-wrap: anywhere;
  user-select: text;
}
.nge-smo-result-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.nge-smo-result-ask {
  pointer-events: auto;
  background: rgba(120, 170, 255, 0.12);
  border: 1px solid rgba(120, 170, 255, 0.45);
  border-radius: 8px;
  color: #cfe2ff;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  padding: 5px 12px;
  cursor: pointer;
}
.nge-smo-result-ask:hover { background: rgba(120, 170, 255, 0.24); }
.nge-smo-result-close {
  pointer-events: auto;
  align-self: flex-start;
  margin: -6px -18px 0 4px;
  background: none;
  border: none;
  color: inherit;
  font-size: 20px;
  line-height: 1;
  padding: 2px 6px;
  opacity: 0.7;
  cursor: pointer;
}
.nge-smo-result-close:hover { opacity: 1; }

.nge-smo-result-retry {
  font-size: 12px;
  font-weight: 400;
  font-style: italic;
  margin-left: 6px;
  opacity: 0;
  animation: smo-retry-fade-in 0.4s ease-out 0.8s forwards;
}

/* ═══ SMOOTH RESULT KEYFRAMES ═══════════════════════════════ */

/* Entry: gentle slide up + fade in */
@keyframes smo-result-enter {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(16px) scale(0.96);
  }
  60% {
    opacity: 1;
    transform: translateX(-50%) translateY(-2px) scale(1.01);
  }
  100% {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}

/* Exit: gentle fade down */
@keyframes smo-result-exit {
  0% {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(10px) scale(0.97);
  }
}

/* Success: subtle breathing glow */
@keyframes smo-result-glow-green {
  0%, 100% { box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 0 20px rgba(0,220,120,0.12); }
  50%      { box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 0 28px rgba(0,220,120,0.2); }
}

/* Error: satisfying micro-shake then settle */
@keyframes smo-result-shake {
  0%   { transform: translateX(-50%); }
  20%  { transform: translateX(calc(-50% + 6px)); }
  40%  { transform: translateX(calc(-50% - 4px)); }
  60%  { transform: translateX(calc(-50% + 2px)); }
  80%  { transform: translateX(calc(-50% - 1px)); }
  100% { transform: translateX(-50%); }
}

/* Retry text fades in gently */
@keyframes smo-retry-fade-in {
  0%   { opacity: 0; }
  100% { opacity: 0.6; }
}

/* ═══ VUE TRANSITION HOOKS ═══════════════════════════════════ */

.flash-pop-enter-active {
  animation: smo-result-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.flash-pop-leave-active {
  animation: smo-result-exit 0.35s ease-in forwards;
}

/* ═══ MAIN BAR TRANSITION — horizontal wipe materialization ══ */
.overlay-slide-enter-active {
  animation: bar-materialize 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.overlay-slide-leave-active {
  animation: bar-dematerialize 0.3s ease-in forwards;
}

@keyframes bar-materialize {
  0% {
    clip-path: inset(0 100% 0 0);
    opacity: 0;
    filter: brightness(2) saturate(0);
  }
  40% {
    opacity: 0.8;
    filter: brightness(1.3) saturate(0.6);
  }
  70% {
    clip-path: inset(0 5% 0 0);
    filter: brightness(1.05) saturate(0.9);
  }
  100% {
    clip-path: inset(0 0% 0 0);
    opacity: 1;
    filter: brightness(1) saturate(1);
  }
}

@keyframes bar-dematerialize {
  0% {
    clip-path: inset(0 0% 0 0);
    opacity: 1;
  }
  60% {
    clip-path: inset(0 0 0 70%);
    opacity: 0.5;
    filter: brightness(1.5) saturate(0.3);
  }
  100% {
    clip-path: inset(0 0 0 100%);
    opacity: 0;
    filter: brightness(2) saturate(0);
  }
}
/* Progress by the mode badge instead of the far right. */
.nge-smo-loading-indicator--left { margin: 0 0 0 10px; order: 0; }
</style>
