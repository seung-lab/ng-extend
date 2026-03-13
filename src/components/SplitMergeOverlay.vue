<script setup lang="ts">
import { computed } from 'vue';
import { useSplitMergeOverlayStore } from 'src/store';
import { exitGrapheneTool } from '../widgets/graphene_tool_utils';

const store = useSplitMergeOverlayStore();

// Bar stays visible during pendingClose (success hold before exit)
const isVisible = computed(() => store.toolActive !== null || store.pendingClose);
const isMulticut = computed(() => store.toolActive === 'multicut' || store.closingTool === 'multicut');
const isMerge = computed(() => store.toolActive === 'merge' || store.closingTool === 'merge');
const isRedActive = computed(() => store.activeGroup === 'red');
const isBlueActive = computed(() => store.activeGroup === 'blue');
const totalPoints = computed(() => store.redPointCount + store.bluePointCount);

const isSubmitting = computed(() => store.submitting);
const isPendingClose = computed(() => store.pendingClose);
const hasResult = computed(() => store.resultFlash !== '');
const resultIsSuccess = computed(() => store.resultFlash === 'success');
const resultIsError = computed(() => store.resultFlash === 'error');
// Show inline result on bar (merge mode stays open, shows temporary result)
const hasInlineResult = computed(() => hasResult.value && !store.pendingClose);

const contextHint = computed(() => {
  if (store.statusMessage) return store.statusMessage;
  // Show error text in hint area during inline error
  if (hasInlineResult.value && resultIsError.value) return store.resultText;
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
  const multicutEl = document.querySelector('.graphene-multicut');
  if (multicutEl) {
    const icons = multicutEl.querySelectorAll('.neuroglancer-icon');
    if (icons[1]) (icons[1] as HTMLElement).click();
  }
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
      <div v-if="isVisible" class="nge-split-merge-overlay" :class="{
        multicut: isMulticut && !isPendingClose,
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
          <div class="nge-smo-mode-badge split-badge">
            SPLIT MODE
          </div>

          <div class="nge-smo-groups">
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
          </div>

          <div class="nge-smo-hint" :class="{ 'error-hint': hasInlineResult && resultIsError }">{{ contextHint }}</div>

          <div class="nge-smo-actions" v-if="!isSubmitting">
            <button class="nge-smo-action-btn clear-btn" @click="clearPoints" title="Clear all points">Clear</button>
            <span class="nge-smo-key-hint"><kbd>G</kbd> Swap</span>
            <span class="nge-smo-key-hint"><kbd>Enter</kbd> Submit</span>
            <button class="nge-smo-action-btn cancel-btn" @click="cancelTool" title="Exit split mode"><kbd>Esc</kbd> Cancel</button>
          </div>
          <div class="nge-smo-loading-indicator" v-if="isSubmitting">
            <span class="nge-smo-spinner"></span>
          </div>
        </template>

        <!-- MERGE MODE -->
        <template v-else-if="isMerge">
          <div class="nge-smo-mode-badge merge-badge">
            MERGE MODE
          </div>

          <div class="nge-smo-hint merge-hint" :class="{ 'error-hint': hasInlineResult && resultIsError }">{{ contextHint }}</div>

          <div class="nge-smo-actions" v-if="!isSubmitting">
            <span class="nge-smo-key-hint"><kbd>Ctrl+Click</kbd> Set points</span>
            <button class="nge-smo-action-btn cancel-btn" @click="cancelTool" title="Exit merge mode"><kbd>Esc</kbd> Cancel</button>
          </div>
          <div class="nge-smo-loading-indicator" v-if="isSubmitting">
            <span class="nge-smo-spinner"></span>
          </div>
        </template>

      </div>
    </transition>

    <!-- Holographic result flash (shows below bar for inline results during merge) -->
    <transition name="flash-pop">
      <div v-if="hasInlineResult" class="nge-smo-result-flash" :class="{ success: resultIsSuccess, error: resultIsError }">
        <span class="nge-smo-result-icon">{{ resultIsSuccess ? '✓' : '✗' }}</span>
        <span class="nge-smo-result-text">{{ store.resultText }}</span>
        <span v-if="resultIsError" class="nge-smo-result-retry">Press Enter to retry</span>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.nge-split-merge-overlay {
  position: fixed;
  bottom: 28px;  /* Above neuroglancer's status bar */
  left: 0;
  right: 0;
  z-index: 9500;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  height: 48px;
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
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 91;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 28px;
  border-radius: 2px;
  font-family: 'Inter', 'Roboto', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.6px;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;

  /* Holographic glass base */
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);

  /* Persistent scanline texture */
  background-image: repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 2px,
    rgba(0, 0, 0, 0.06) 2px,
    rgba(0, 0, 0, 0.06) 4px
  );
  background-size: 100% 4px;
  animation: holo-scanline-drift 4s linear infinite;
}

/* ── Scan beam — bright line that sweeps top→bottom on entry ── */
.nge-smo-result-flash::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  top: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.1) 10%,
    currentColor 35%,
    rgba(255, 255, 255, 0.95) 50%,
    currentColor 65%,
    rgba(255, 255, 255, 0.1) 90%,
    transparent 100%
  );
  filter: blur(0.5px);
  box-shadow: 0 0 8px currentColor, 0 0 16px currentColor;
  animation: holo-scanbeam 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
  animation-delay: 0.15s;
  opacity: 0;
}

/* ── Holographic edge frame — breathing border glow ── */
.nge-smo-result-flash::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 2px;
  border: 1px solid transparent;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.25) 0%,
    transparent 30%,
    transparent 70%,
    rgba(255, 255, 255, 0.12) 100%
  ) border-box;
  -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: holo-edge-breathe 2.5s ease-in-out infinite;
  animation-delay: 0.8s;
  opacity: 0;
}

/* ── SUCCESS ── */
.nge-smo-result-flash.success {
  background-color: rgba(6, 32, 20, 0.88);
  border: 1px solid rgba(0, 255, 140, 0.35);
  color: #a0ffd4;
  box-shadow:
    0 0 30px rgba(0, 220, 120, 0.25),
    0 0 60px rgba(0, 220, 120, 0.08),
    inset 0 1px 0 rgba(0, 255, 140, 0.15),
    inset 0 0 30px rgba(0, 220, 120, 0.04);
  text-shadow:
    0 0 8px rgba(0, 220, 120, 0.7),
    0 0 20px rgba(0, 220, 120, 0.25);
}

/* ── ERROR ── */
.nge-smo-result-flash.error {
  background-color: rgba(40, 6, 6, 0.88);
  border: 1px solid rgba(255, 80, 80, 0.35);
  color: #ffb0b0;
  box-shadow:
    0 0 30px rgba(255, 60, 60, 0.25),
    0 0 60px rgba(255, 60, 60, 0.08),
    inset 0 1px 0 rgba(255, 80, 80, 0.15),
    inset 0 0 30px rgba(255, 60, 60, 0.04);
  text-shadow:
    0 0 8px rgba(255, 60, 60, 0.7),
    0 0 20px rgba(255, 60, 60, 0.25);
}

.nge-smo-result-icon {
  font-size: 20px;
  filter: drop-shadow(0 0 6px currentColor);
  animation: holo-icon-stabilize 0.7s ease-out forwards;
}

.nge-smo-result-text {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nge-smo-result-retry {
  font-size: 12px;
  font-weight: 400;
  font-style: italic;
  margin-left: 6px;
  opacity: 0;
  animation: holo-retry-fade-in 0.4s ease-out 1.2s forwards;
}

/* ═══ HOLOGRAPHIC KEYFRAMES ═══════════════════════════════════ */

/* Entry: beam line expands outward, content resolves through glitch */
@keyframes holo-materialize {
  0% {
    clip-path: inset(48% 35% 48% 35%);
    opacity: 0;
    filter: brightness(4) saturate(0) blur(2px);
    transform: translateX(-50%);
  }
  8% {
    opacity: 1;
    filter: brightness(3) saturate(0) blur(1px);
  }
  /* Beam line visible — thin horizontal slit */
  16% {
    clip-path: inset(46% 8% 46% 8%);
    filter: brightness(2.5) saturate(0) blur(0.5px);
  }
  /* Expanding — scanlines visible through the opening */
  30% {
    clip-path: inset(30% 2% 30% 2%);
    filter: brightness(1.6) saturate(0.4) blur(0px);
    transform: translateX(-50%);
  }
  48% {
    clip-path: inset(12% 0% 12% 0%);
    filter: brightness(1.2) saturate(0.7);
  }
  /* Content nearly full — first glitch hit */
  60% {
    clip-path: inset(2% 0% 2% 0%);
    filter: brightness(1) saturate(1);
    transform: translateX(-50%);
  }
  /* Chromatic glitch sequence */
  66% {
    clip-path: inset(0);
    transform: translateX(calc(-50% + 3px));
    filter: brightness(1.4) hue-rotate(-10deg);
    text-shadow: -3px 0 rgba(255, 0, 80, 0.7), 3px 0 rgba(0, 200, 255, 0.7);
  }
  72% {
    transform: translateX(calc(-50% - 4px));
    filter: brightness(0.8) hue-rotate(8deg);
    text-shadow: 2px 0 rgba(255, 0, 80, 0.5), -2px 0 rgba(0, 200, 255, 0.5);
  }
  78% {
    transform: translateX(calc(-50% + 1px));
    filter: brightness(1.3) hue-rotate(-3deg);
    text-shadow: -1px 0 rgba(255, 0, 80, 0.3), 1px 0 rgba(0, 200, 255, 0.3);
  }
  /* Stabilize */
  88% {
    filter: brightness(1.05) hue-rotate(0deg);
    text-shadow: none;
  }
  100% {
    clip-path: inset(0);
    opacity: 1;
    filter: brightness(1) saturate(1) blur(0px);
    transform: translateX(-50%);
  }
}

/* Scan beam sweeps top → bottom during materialization */
@keyframes holo-scanbeam {
  0%   { top: 0%;   opacity: 0.9; height: 2px; }
  40%  { opacity: 1; height: 3px; }
  100% { top: 100%; opacity: 0;   height: 1px; }
}

/* Scanline texture drifts upward slowly (CRT / hologram feel) */
@keyframes holo-scanline-drift {
  0%   { background-position: 0 0; }
  100% { background-position: 0 -40px; }
}

/* Edge glow pulses after materialization */
@keyframes holo-edge-breathe {
  0%, 100% { opacity: 0.2; }
  50%      { opacity: 0.6; }
}

/* Icon resolves from static */
@keyframes holo-icon-stabilize {
  0%   { opacity: 0; transform: scale(1.8); filter: blur(4px) drop-shadow(0 0 12px currentColor); }
  40%  { opacity: 1; transform: scale(0.9); filter: blur(0px) drop-shadow(0 0 8px currentColor); }
  60%  { transform: scale(1.1); }
  80%  { transform: scale(0.97); }
  100% { transform: scale(1); filter: drop-shadow(0 0 6px currentColor); }
}

/* Retry text materializes late */
@keyframes holo-retry-fade-in {
  0%   { opacity: 0; transform: translateX(-4px); filter: blur(2px); }
  60%  { opacity: 0.8; filter: blur(0); }
  100% { opacity: 0.65; transform: translateX(0); }
}

/* Exit: destabilize → chromatic split → collapse to beam → vanish */
@keyframes holo-destabilize {
  0% {
    clip-path: inset(0);
    opacity: 1;
    filter: brightness(1) saturate(1);
    transform: translateX(-50%);
  }
  /* Flicker unstable */
  15% {
    opacity: 0.7;
    filter: brightness(1.5) saturate(0.6);
    transform: translateX(calc(-50% - 2px));
    text-shadow: -2px 0 rgba(255, 0, 80, 0.6), 2px 0 rgba(0, 200, 255, 0.6);
  }
  25% {
    opacity: 1;
    filter: brightness(0.8);
    transform: translateX(calc(-50% + 3px));
  }
  35% {
    filter: brightness(1.8) saturate(0.3);
    transform: translateX(calc(-50% - 1px));
    text-shadow: -3px 0 rgba(255, 0, 80, 0.4), 3px 0 rgba(0, 200, 255, 0.4);
  }
  /* Begin collapse */
  50% {
    clip-path: inset(15% 3% 15% 3%);
    filter: brightness(2) saturate(0.1);
    text-shadow: none;
    transform: translateX(-50%);
  }
  70% {
    clip-path: inset(35% 10% 35% 10%);
    filter: brightness(2.5) saturate(0) blur(0.5px);
    opacity: 0.7;
  }
  85% {
    clip-path: inset(46% 25% 46% 25%);
    filter: brightness(3) saturate(0) blur(1px);
    opacity: 0.4;
  }
  100% {
    clip-path: inset(50% 45% 50% 45%);
    filter: brightness(4) saturate(0) blur(2px);
    opacity: 0;
    transform: translateX(-50%);
  }
}

/* ═══ VUE TRANSITION HOOKS ═══════════════════════════════════ */

.flash-pop-enter-active {
  animation: holo-materialize 0.75s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.flash-pop-leave-active {
  animation: holo-destabilize 0.55s ease-in forwards;
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
</style>
