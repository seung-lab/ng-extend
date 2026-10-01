<script setup lang="ts">
/**
 * HighlightModePanel: stage 1 of Highlight mode (docs/highlight-mode-spec.md).
 * Hold H and click two points on a cell (or press "Pick two points" and just
 * click): the stretch between them is marked with a highlighter stroke, so a
 * proofreader can see which branches they have already checked.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { runPanelTrace, runParticleBurst } from '../util/holo_trace';
import { HIGHLIGHT_STYLES, pickUnderMouse, addHighlight, listHighlights, undoHighlight, clearHighlights, type Pick } from '../util/highlight';

const emit = defineEmits({ hide: null });
const panelEl = ref<HTMLElement | null>(null);

const styleKey = ref(HIGHLIGHT_STYLES[0].key);
const first = ref<Pick | null>(null);
const busy = ref(false);
const message = ref('');
const messageBad = ref(false);
const markCount = ref(0);
/** "Pick two points": the next clicks place points without holding H. */
const armed = ref(false);
const hHeld = ref(false);

// The crosshair cursor follows the two ways of placing a point.
watch([armed, hHeld], () => document.body.classList.toggle('nge-highlight-armed', armed.value || hHeld.value));

function say(text: string, bad = false) { message.value = text; messageBad.value = bad; }
function refresh() { markCount.value = listHighlights().length; }
const styleOf = () => HIGHLIGHT_STYLES.find(s => s.key === styleKey.value) ?? HIGHLIGHT_STYLES[0];
const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',');

async function place(x: number, y: number) {
  if (busy.value) return;
  const pick = pickUnderMouse();
  if ('error' in pick) { say(pick.error, true); return; }
  runParticleBurst(x, y, rgbOf(styleOf().color));
  if (!first.value) {
    first.value = pick;
    say('Start placed. Now click where the checked stretch ends.');
    return;
  }
  const a = first.value;
  first.value = null;
  busy.value = true;
  say('Tracing the path…');
  try {
    const n = await addHighlight(a, pick, styleOf());
    say(`Marked ${styleOf().label.toLowerCase()} (${n} points along the branch).`);
    armed.value = false;
  } catch (e: any) {
    say(e?.message || 'Could not mark that stretch.', true);
  } finally {
    busy.value = false;
    refresh();
  }
}

function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'h' || e.key === 'H') {
    e.stopImmediatePropagation();
    e.preventDefault();
    hHeld.value = true;
    document.body.classList.add('nge-highlight-armed');
  } else if (e.key === 'Escape' && (first.value || armed.value)) {
    first.value = null;
    armed.value = false;
    say('Cancelled.');
  }
}
function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'h' || e.key === 'H') {
    if (!isTypingTarget(e)) e.stopImmediatePropagation();
    hHeld.value = false;
    if (!armed.value) document.body.classList.remove('nge-highlight-armed');
  }
}
// Capture phase, like Scout Tag mode: neuroglancer handles mousedown itself.
function onPointerCapture(e: PointerEvent) {
  if ((!hHeld.value && !armed.value) || e.button !== 0) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('.nge-hl-panel')) return;
  // Only clicks on the viewer place points; the rest of the UI works as usual.
  if (!t?.closest?.('.neuroglancer-rendered-data-panel, .neuroglancer-panel')) return;
  e.preventDefault();
  e.stopPropagation();
  void place(e.clientX, e.clientY);
}
function toggleArmed() {
  armed.value = !armed.value;
  document.body.classList.toggle('nge-highlight-armed', armed.value);
  say(armed.value ? 'Click where the checked stretch starts.' : '');
}
function undo() {
  if (first.value) { first.value = null; say('Start point cleared.'); return; }
  say(undoHighlight() ? 'Removed the last mark.' : 'Nothing to undo.');
  refresh();
}
function clearAll() {
  if (!markCount.value) return;
  if (!window.confirm(`Remove all ${markCount.value} highlight marks from this view?`)) return;
  clearHighlights();
  first.value = null;
  say('All marks removed.');
  refresh();
}

onMounted(() => {
  refresh();
  requestAnimationFrame(() => { if (panelEl.value) runPanelTrace(panelEl.value); });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointerdown', onPointerCapture, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('pointerdown', onPointerCapture, true);
  document.body.classList.remove('nge-highlight-armed');
});
</script>

<template>
  <Teleport to="body">
    <div ref="panelEl" class="nge-hl-panel" role="dialog" aria-label="Highlight mode">
      <div class="nge-hl-head">
        <span class="nge-hl-title">Highlight</span>
        <span class="nge-hl-test">test</span>
        <button class="nge-hl-close" aria-label="Close" @click="emit('hide')">×</button>
      </div>
      <p class="nge-hl-how">
        Mark a stretch of a cell you have checked. Hold <kbd>H</kbd> and click where it starts, then where it ends.
      </p>
      <div class="nge-hl-styles" role="radiogroup" aria-label="Mark as">
        <button
          v-for="s in HIGHLIGHT_STYLES" :key="s.key" role="radio" :aria-checked="styleKey === s.key ? 'true' : 'false'"
          class="nge-hl-style" :class="{ 'nge-hl-style--on': styleKey === s.key }" :style="{ '--hl': s.color }"
          @click="styleKey = s.key"
        ><span class="nge-hl-swatch"></span>{{ s.label }}</button>
      </div>
      <div class="nge-hl-actions">
        <button class="nge-hl-btn nge-hl-btn--main" :class="{ 'nge-hl-btn--armed': armed }" :disabled="busy" @click="toggleArmed">
          {{ armed ? (first ? 'Click the end…' : 'Click the start…') : 'Pick two points' }}
        </button>
        <button class="nge-hl-btn" :disabled="busy || (!markCount && !first)" @click="undo">Undo</button>
        <button class="nge-hl-btn" :disabled="busy || !markCount" @click="clearAll">Clear all</button>
      </div>
      <div class="nge-hl-status">
        <span v-if="busy" class="nge-hl-spin"></span>
        <span v-if="message" :class="{ 'nge-hl-bad': messageBad }">{{ message }}</span>
        <span v-else class="nge-hl-dim">{{ first ? 'Start placed.' : 'No point placed yet.' }}</span>
        <span class="nge-hl-count">{{ markCount }} {{ markCount === 1 ? 'mark' : 'marks' }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-hl-panel {
  position: fixed; left: 16px; bottom: 56px; z-index: 9000;
  width: 320px; max-width: calc(100vw - 24px); box-sizing: border-box;
  padding: 12px 14px 12px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(61, 255, 154, 0.35);
  border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55), 0 0 18px rgba(61, 255, 154, 0.1);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5;
  animation: nge-hl-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes nge-hl-in { from { opacity: 0; transform: translateY(8px); filter: blur(6px); } to { opacity: 1; transform: none; filter: blur(0); } }
@media (prefers-reduced-motion: reduce) { .nge-hl-panel { animation: none; } }
.nge-hl-head { display: flex; align-items: center; gap: 8px; }
.nge-hl-title { font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #9dffc9; }
.nge-hl-test { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; color: #ffd27a; background: rgba(255, 210, 122, 0.12); }
.nge-hl-close { margin-left: auto; background: none; border: none; color: rgba(255, 255, 255, 0.55); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-hl-close:hover { color: #fff; }
.nge-hl-how { margin: 8px 0 10px; font-size: 12px; line-height: 1.45; color: rgba(220, 230, 245, 0.72); }
.nge-hl-how kbd { padding: 0 5px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.08); font: 600 11px 'JetBrains Mono', 'Consolas', monospace; color: #fff; }
.nge-hl-styles { display: flex; gap: 6px; flex-wrap: wrap; }
.nge-hl-style {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
  font-size: 11.5px; color: #c9d6ea; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.14);
}
.nge-hl-style--on { color: #fff; border-color: var(--hl); background: color-mix(in srgb, var(--hl) 16%, transparent); box-shadow: 0 0 10px color-mix(in srgb, var(--hl) 35%, transparent); }
.nge-hl-swatch { width: 14px; height: 5px; border-radius: 3px; background: var(--hl); box-shadow: 0 0 6px var(--hl); }
.nge-hl-actions { display: flex; gap: 6px; margin-top: 10px; }
.nge-hl-btn {
  padding: 5px 10px; border-radius: 7px; cursor: pointer; font: 600 11.5px 'Inter', sans-serif;
  color: #cfe6ff; background: rgba(74, 158, 255, 0.1); border: 1px solid rgba(74, 158, 255, 0.3);
}
.nge-hl-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.2); }
.nge-hl-btn:disabled { opacity: 0.4; cursor: default; }
.nge-hl-btn--main { flex: 1; color: #06140c; background: #7cffb2; border-color: #7cffb2; }
.nge-hl-btn--main:hover:not(:disabled) { background: #a5ffca; }
.nge-hl-btn--armed { background: #ffd24d; border-color: #ffd24d; }
.nge-hl-status { display: flex; align-items: center; gap: 6px; margin-top: 9px; min-height: 18px; font-size: 11.5px; color: #cfe0f5; }
.nge-hl-dim { color: rgba(220, 230, 245, 0.45); }
.nge-hl-bad { color: #ff9aa8; }
.nge-hl-count { margin-left: auto; flex-shrink: 0; color: rgba(220, 230, 245, 0.55); font-variant-numeric: tabular-nums; }
.nge-hl-spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid rgba(124, 255, 178, 0.3); border-top-color: #7cffb2; animation: nge-hl-spin 0.7s linear infinite; }
@keyframes nge-hl-spin { to { transform: rotate(360deg); } }
</style>

<style>
/* While a click will place a highlight point, say so with the cursor. */
body.nge-highlight-armed .neuroglancer-rendered-data-panel { cursor: crosshair !important; }
</style>
