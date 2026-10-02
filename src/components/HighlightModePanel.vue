<script setup lang="ts">
/**
 * HighlightModePanel: stage 1 of Highlight mode (docs/highlight-mode-spec.md).
 * Hold H and click two points on a cell (or press "Pick two points" and just
 * click): the stretch between them is marked with a highlighter stroke, so a
 * proofreader can see which branches they have already checked.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { startLoader, type Live } from '../find_path_status';
import { runPanelTrace, runParticleBurst } from '../util/holo_trace';
import { highlightStyles, saveHighlightStyles, applyStyleColor, highlightNameTaken, MAX_HIGHLIGHT_STYLES, pickUnderMouse, addHighlight, listHighlights, undoHighlight, clearHighlights, tintRadiusNm, setTintRadiusNm, showStartMarker, clearStartMarker, type Pick, type HighlightStyle } from '../util/highlight';

const emit = defineEmits({ hide: null });
const panelEl = ref<HTMLElement | null>(null);

// ── Colours: the built in three (any colour you like) and your own ────────
const styles = ref<HighlightStyle[]>(highlightStyles());
const styleKey = ref(styles.value[0].key);
const adding = ref(false);
const newName = ref('');
const newColor = ref('#b388ff');
const addError = ref('');
const isCustom = (s: HighlightStyle) => s.key.startsWith('c_');
function setColor(s: HighlightStyle, e: Event) {
  const hex = (e.target as HTMLInputElement).value;
  styles.value = styles.value.map(x => (x.key === s.key ? { ...x, color: hex } : x));
  saveHighlightStyles(styles.value);
  applyStyleColor({ ...s, color: hex });
}
function startAdding() {
  adding.value = true;
  addError.value = '';
  newName.value = '';
}
function addStyle() {
  const label = newName.value.trim().slice(0, 24);
  if (!label) { addError.value = 'Give the color a name.'; return; }
  if (highlightNameTaken(label, styles.value)) { addError.value = 'That name is already used by a layer or a color.'; return; }
  const s: HighlightStyle = { key: `c_${Date.now().toString(36)}`, label, layer: label, color: newColor.value };
  styles.value = [...styles.value, s];
  saveHighlightStyles(styles.value);
  styleKey.value = s.key;
  adding.value = false;
}
/** Take one of your own colours off the list. Its marks stay in the view. */
function removeStyle(s: HighlightStyle) {
  styles.value = styles.value.filter(x => x.key !== s.key);
  saveHighlightStyles(styles.value);
  if (styleKey.value === s.key) styleKey.value = styles.value[0].key;
}
const first = ref<Pick | null>(null);
const busy = ref(false);
const message = ref('');
const messageBad = ref(false);
const markCount = ref(0);
const hHeld = ref(false);

// ── The path-search loader, across the top of the box while a path is traced
// (the one Find Path shows in the status bar; Ames 2026-10-02).
const loaderEl = ref<HTMLCanvasElement | null>(null);
let loaderLive: Live | null = null;
function stopLoader() {
  if (loaderLive) { cancelAnimationFrame(loaderLive.raf); loaderLive = null; }
}
const traceSecs = ref(0);
let traceTimer: ReturnType<typeof setInterval> | undefined;
// Set at once (not after the next render): Find Path's status line appears
// as soon as the request starts, and it reads this to step aside.
watch(busy, (on) => document.body.classList.toggle('nge-hl-tracing', on), { flush: 'sync' });
watch(busy, (on) => {
  stopLoader();
  if (traceTimer) { clearInterval(traceTimer); traceTimer = undefined; }
  if (!on) return;
  traceSecs.value = 0;
  const t0 = Date.now();
  traceTimer = setInterval(() => { traceSecs.value = Math.round((Date.now() - t0) / 1000); }, 1000);
  requestAnimationFrame(() => {
    const cv = loaderEl.value;
    if (!cv || !busy.value) return;
    loaderLive = { raf: 0, timer: 0 };
    // The full width of the box: the band is part of its top edge.
    startLoader(cv, loaderLive, Math.max(120, Math.round(panelEl.value?.clientWidth ?? 318)), 30);
  });
}, { flush: 'post' });

// ── Drag the box by its header; it remembers where it was put ─────────────
const POS_KEY = 'nge_highlight_panel_pos';
const pos = ref<{ x: number; y: number } | null>((() => {
  try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && isFinite(p.x) && isFinite(p.y) ? p : null; } catch { return null; }
})());
const dragging = ref(false);
const posStyle = computed(() => (pos.value ? { left: pos.value.x + 'px', top: pos.value.y + 'px', bottom: 'auto' } : {}));
function clampPos() {
  const el = panelEl.value;
  if (!el || !pos.value) return;
  const x = Math.max(8, Math.min(pos.value.x, window.innerWidth - el.offsetWidth - 8));
  const y = Math.max(44, Math.min(pos.value.y, window.innerHeight - el.offsetHeight - 8));
  if (x !== pos.value.x || y !== pos.value.y) pos.value = { x, y };
}
function startDrag(e: MouseEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
  const el = panelEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  dragging.value = true;
  e.preventDefault();
  const move = (ev: MouseEvent) => { pos.value = { x: ev.clientX - dx, y: ev.clientY - dy }; clampPos(); };
  const up = () => {
    dragging.value = false;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    try { if (pos.value) localStorage.setItem(POS_KEY, JSON.stringify(pos.value)); } catch { /* private mode */ }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/** How far from the path the surface tint reaches, in micrometres. */
const tintUm = ref(tintRadiusNm() / 1000);
function onTintInput(e: Event) {
  tintUm.value = Number((e.target as HTMLInputElement).value);
  setTintRadiusNm(tintUm.value * 1000);
}

// The crosshair cursor shows while a click would place a point.
const ctrlHeld = ref(false);
watch([ctrlHeld, hHeld], () => document.body.classList.toggle('nge-highlight-armed', ctrlHeld.value || hHeld.value));

function say(text: string, bad = false) { message.value = text; messageBad.value = bad; }
function refresh() { markCount.value = listHighlights().length; }
const styleOf = () => styles.value.find(s => s.key === styleKey.value) ?? styles.value[0];
const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',');

const TRACE_LIMIT_MS = 60000;
let stopTrace: (() => void) | null = null;
function stopTracing() { stopTrace?.(); }

async function place(x: number, y: number) {
  if (busy.value) return;
  const pick = pickUnderMouse();
  if ('error' in pick) { say(pick.error, true); return; }
  runParticleBurst(x, y, rgbOf(styleOf().color));
  if (!first.value) {
    first.value = pick;
    try { showStartMarker(pick, styleOf()); } catch (e) { console.warn('[highlight] start marker failed:', e); }
    say('Start placed. Now click where the checked stretch ends.');
    return;
  }
  const a = first.value;
  first.value = null;
  busy.value = true;
  say('Tracing the path…');
  // The path request has no time limit of its own, so a server that never
  // answers left the panel on "Tracing" for good (Krzysztof 2026-10-02).
  // Give up after TRACE_LIMIT_MS, or when the player presses Stop.
  let wanted = true;
  let timer = 0;
  const gaveUp = new Promise<never>((_, reject) => {
    stopTrace = () => reject(new Error('Stopped. Nothing was marked.'));
    timer = window.setTimeout(() => reject(new Error('The server took too long to trace that path. Nothing was marked. Try again, or pick two closer points.')), TRACE_LIMIT_MS);
  });
  try {
    const n = await Promise.race([addHighlight(a, pick, styleOf(), () => wanted), gaveUp]);
    say(`Marked ${styleOf().label.toLowerCase()} (${n} points along the branch).`);
  } catch (e: any) {
    const text = String(e?.message || '');
    say(/HTTP error 0|Network or CORS|Failed to fetch/i.test(text)
      ? 'The server did not answer, so nothing was marked. Try again in a moment.'
      : text || 'Could not mark that stretch.', true);
  } finally {
    wanted = false;
    stopTrace = null;
    clearTimeout(timer);
    busy.value = false;
    clearStartMarker();
    refresh();
  }
}

function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld.value = true; return; }
  if (isTypingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'h' || e.key === 'H') {
    e.stopImmediatePropagation();
    e.preventDefault();
    hHeld.value = true;
  } else if (e.key === 'Escape' && first.value) {
    cancelPick();
  }
}
function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld.value = false; return; }
  if (e.key === 'h' || e.key === 'H') {
    if (!isTypingTarget(e)) e.stopImmediatePropagation();
    hHeld.value = false;
  }
}
const onBlur = () => { ctrlHeld.value = false; hHeld.value = false; };
const inViewer = (t: HTMLElement | null) =>
  !t?.closest?.('.nge-hl-panel') && !!t?.closest?.('.neuroglancer-rendered-data-panel, .neuroglancer-panel');
// Ctrl+click (Cmd+click on a Mac) or H+click places a point. A plain click
// or drag is left alone, so the view can be turned and moved between the
// two points (Ames 2026-10-01). Capture phase: neuroglancer handles
// mousedown itself, and Ctrl+click is otherwise its "annotate" gesture.
function onPointerCapture(e: PointerEvent) {
  if (e.button !== 0 || !(e.ctrlKey || e.metaKey || hHeld.value)) return;
  if (!inViewer(e.target as HTMLElement | null)) return;
  e.preventDefault();
  e.stopPropagation();
  void place(e.clientX, e.clientY);
}
// On a Mac, Ctrl+click also asks for the context menu.
function onContextMenu(e: MouseEvent) {
  if (e.ctrlKey && inViewer(e.target as HTMLElement | null)) { e.preventDefault(); e.stopPropagation(); }
}
/** Drop the start point of the mark being made; finished marks are untouched. */
function cancelPick() {
  first.value = null;
  clearStartMarker();
  say('Cancelled. Your finished marks are untouched.');
}
function undo() {
  if (first.value) { first.value = null; clearStartMarker(); say('Start point cleared.'); return; }
  say(undoHighlight() ? 'Removed the last mark.' : 'Nothing to undo.');
  refresh();
}
function clearAll() {
  if (!markCount.value) return;
  if (!window.confirm(`Remove all ${markCount.value} highlight marks from this view?`)) return;
  clearHighlights();
  first.value = null;
  clearStartMarker();
  say('All marks removed.');
  refresh();
}

onMounted(() => {
  refresh();
  requestAnimationFrame(() => { if (panelEl.value) runPanelTrace(panelEl.value); });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointerdown', onPointerCapture, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', clampPos);
  requestAnimationFrame(clampPos);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('pointerdown', onPointerCapture, true);
  window.removeEventListener('contextmenu', onContextMenu, true);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('resize', clampPos);
  stopLoader();
  if (traceTimer) clearInterval(traceTimer);
  document.body.classList.remove('nge-hl-tracing');
  clearStartMarker(true);
  document.body.classList.remove('nge-highlight-armed');
});
</script>

<template>
  <Teleport to="body">
    <div ref="panelEl" class="nge-hl-panel" :class="{ 'nge-hl-panel--placed': pos, 'nge-hl-panel--dragging': dragging }" :style="posStyle" role="dialog" aria-label="Highlight mode">
      <!-- The search, as the top edge of the box, above the title. -->
      <div class="nge-hl-loader-wrap" :class="{ 'nge-hl-loader-wrap--on': busy }" :aria-hidden="busy ? 'false' : 'true'">
        <canvas v-if="busy" ref="loaderEl" class="nge-hl-loader"></canvas>
        <span v-if="busy" class="nge-hl-loader-label">Tracing path <b>{{ traceSecs }}s</b></span>
      </div>
      <div class="nge-hl-head" title="Drag to move" @mousedown="startDrag">
        <span class="nge-hl-title">Highlight</span>
        <button class="nge-hl-close" aria-label="Close" @click="emit('hide')">×</button>
      </div>
      <p class="nge-hl-how">
        Mark a stretch of a cell you have checked: <kbd>Ctrl</kbd> + click where it starts, then where it ends.
        Turn and move the view freely in between. The surface of that stretch takes the color.
      </p>
      <div class="nge-hl-styles" role="radiogroup" aria-label="Mark as">
        <span
          v-for="s in styles" :key="s.key" role="radio" tabindex="0" :aria-checked="styleKey === s.key ? 'true' : 'false'"
          class="nge-hl-style" :class="{ 'nge-hl-style--on': styleKey === s.key }" :style="{ '--hl': s.color }"
          @click="styleKey = s.key" @keydown.enter.prevent="styleKey = s.key" @keydown.space.prevent="styleKey = s.key"
        >
          <label class="nge-hl-swatch" :title="`Change the color of ${s.label}`" @click.stop>
            <input type="color" :value="s.color" :aria-label="`Color of ${s.label}`" @input="setColor(s, $event)" />
          </label>
          {{ s.label }}
          <button v-if="isCustom(s) && styleKey === s.key" class="nge-hl-style-x" type="button"
                  :title="`Remove ${s.label} from your colors (marks already made stay)`" :aria-label="`Remove ${s.label}`"
                  @click.stop="removeStyle(s)">×</button>
        </span>
        <button v-if="!adding && styles.length < MAX_HIGHLIGHT_STYLES" class="nge-hl-style nge-hl-style--add" type="button"
                title="Add a color of your own" @click="startAdding">+ Add</button>
      </div>
      <div v-if="adding" class="nge-hl-add">
        <label class="nge-hl-swatch nge-hl-swatch--big" :style="{ '--hl': newColor }" title="Pick the color">
          <input type="color" v-model="newColor" aria-label="New color" />
        </label>
        <input v-model="newName" class="nge-hl-add-name" type="text" maxlength="24" placeholder="Name, e.g. Axon"
               @keydown.stop @keydown.enter.prevent="addStyle" @keydown.esc.prevent="adding = false" />
        <button class="nge-hl-btn" type="button" @click="addStyle">Add</button>
        <button class="nge-hl-btn" type="button" @click="adding = false">Cancel</button>
        <div v-if="addError" class="nge-hl-add-error">{{ addError }}</div>
      </div>
      <div class="nge-hl-actions">
        <button v-if="first" class="nge-hl-btn nge-hl-btn--main nge-hl-btn--armed" :disabled="busy" @click="cancelPick"
                title="Drop the start point you placed. Finished marks stay. (Esc)">Cancel this mark</button>
        <button v-else-if="busy" class="nge-hl-btn nge-hl-btn--main" @click="stopTracing"
                title="Stop waiting for this path. Nothing is marked.">Stop tracing</button>
        <span v-else class="nge-hl-step">Ctrl + click the start</span>
        <button class="nge-hl-btn" :disabled="busy || (!markCount && !first)" @click="undo">Undo</button>
        <button class="nge-hl-btn" :disabled="busy || !markCount" @click="clearAll">Clear all</button>
      </div>
      <label class="nge-hl-width" title="How far out from the middle of the branch the color reaches. Wider covers thick branches and their spines; narrower keeps the color off neighboring branches.">
        <span>Color reach</span>
        <input type="range" min="0.5" max="8" step="0.5" :value="tintUm" @input="onTintInput" />
        <span class="nge-hl-width-val">{{ tintUm }} <span class="nge-hl-unit">µm</span></span>
      </label>
      <div class="nge-hl-status">
        <span v-if="busy" class="nge-hl-spin"></span>
        <span v-if="message" :class="{ 'nge-hl-bad': messageBad }">{{ message }}</span>
        <span v-else class="nge-hl-dim">{{ first ? 'Start placed. Ctrl + click the end.' : 'No point placed yet.' }}</span>
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
.nge-hl-head { display: flex; align-items: center; gap: 8px; cursor: grab; user-select: none; }
.nge-hl-panel--dragging .nge-hl-head { cursor: grabbing; }
/* Once dragged, it sits where it was put (no slide-in from the corner). */
.nge-hl-panel--placed { animation: none; }
/* A band across the very top of the box (it bleeds through the padding and
   takes the box's top corners), open only while a path is being traced. */
.nge-hl-loader-wrap {
  position: relative; height: 0; overflow: hidden;
  margin: -12px -14px 0; border-radius: 11px 11px 0 0;
  background: rgba(20, 12, 36, 0.75);
  transition: height 0.2s ease, margin 0.2s ease;
}
.nge-hl-loader-wrap--on { height: 30px; margin-bottom: 10px; border-bottom: 1px solid rgba(200, 164, 255, 0.28); }
/* Closed, it must not eat the box's top padding. */
.nge-hl-loader-wrap:not(.nge-hl-loader-wrap--on) { margin: 0; }
.nge-hl-loader { display: block; }
.nge-hl-loader-label {
  position: absolute; right: 26px; top: 50%; transform: translateY(-50%);
  padding: 1px 7px; border-radius: 999px; background: rgba(10, 6, 20, 0.7);
  font: 600 9.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #dcc8ff;
  pointer-events: none;
}
.nge-hl-loader-label b { color: #fff; font-weight: 700; text-transform: none; }
.nge-hl-title { font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #9dffc9; }
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
.nge-hl-style { user-select: none; }
/* The swatch is the color picker: click it to change the color. */
.nge-hl-swatch { position: relative; display: inline-block; width: 14px; height: 10px; border-radius: 3px; background: var(--hl); box-shadow: 0 0 6px var(--hl); cursor: pointer; overflow: hidden; }
.nge-hl-swatch:hover { outline: 1px solid rgba(255, 255, 255, 0.7); outline-offset: 1px; }
.nge-hl-swatch input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; padding: 0; border: 0; }
.nge-hl-swatch--big { width: 26px; height: 24px; border-radius: 6px; flex-shrink: 0; }
.nge-hl-style-x { margin-left: 2px; padding: 0 2px; border: 0; background: none; color: rgba(255, 255, 255, 0.6); font-size: 13px; line-height: 1; cursor: pointer; }
.nge-hl-style-x:hover { color: #ff9aa8; }
.nge-hl-style--add { border-style: dashed; color: #9dffc9; }
.nge-hl-style--add:hover { background: rgba(124, 255, 178, 0.1); border-color: rgba(124, 255, 178, 0.5); }
.nge-hl-add { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding: 8px; border-radius: 8px; border: 1px dashed rgba(124, 255, 178, 0.3); background: rgba(124, 255, 178, 0.04); }
.nge-hl-add-name { flex: 1; min-width: 90px; padding: 4px 8px; border-radius: 6px; font: 12px 'Inter', sans-serif; color: #e6f0ff; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.16); outline: none; }
.nge-hl-add-name:focus { border-color: rgba(124, 255, 178, 0.6); }
.nge-hl-add-error { flex-basis: 100%; font-size: 11px; color: #ff9aa8; }
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
.nge-hl-step { flex: 1; align-self: center; font-size: 11.5px; color: #9dffc9; }
.nge-hl-width { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 11.5px; color: rgba(220, 230, 245, 0.72); }
.nge-hl-width input { flex: 1; min-width: 0; accent-color: #7cffb2; }
.nge-hl-width-val { width: 52px; text-align: right; font-variant-numeric: tabular-nums; color: #dce6f5; }
.nge-hl-unit { text-transform: none; }
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
