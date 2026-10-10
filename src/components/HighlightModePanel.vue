<script setup lang="ts">
/**
 * HighlightModePanel: stage 1 of Highlight mode (docs/highlight-mode-spec.md).
 * Hold H and click two points on a cell (or press "Pick two points" and just
 * click): the stretch between them is marked with a highlighter stroke, so a
 * proofreader can see which branches they have already checked.
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { snapshotPanel, morphIntoSlim, revealWithBeam } from '../util/panel_collapse';
import { startLoader, type Live } from '../find_path_status';
import type { BranchWay } from '../util/branch_tree';
import { runPanelTrace, runParticleBurst, runPanelLap } from '../util/holo_trace';
import { highlightStyles, saveHighlightStyles, applyStyleColor, highlightNameTaken, MAX_HIGHLIGHT_STYLES, pickUnderMouse, addHighlight, addBranchHighlight, NeedsSomaSide, listHighlights, undoHighlight, clearHighlights, tintRadiusNm, setTintRadiusNm, highlightsShown, setHighlightsShown, onLayersChanged, showStartMarker, showEndMarker, clearStartMarker, clearLatestHighlight, type Pick, type HighlightStyle } from '../util/highlight';

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
/** Set while one more click is awaited, to say which side the soma is on. */
const branchWay = ref<BranchWay | null>(null);
const busy = ref(false);
const message = ref('');
const messageBad = ref(false);
/** A small count shown after the message, e.g. "74 points". */
const stat = ref('');
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
/** The band stays open a moment past the trace, for the lightning. */
const bandOn = ref(false);
/** Set by place() when the trace succeeded: the search ends on the bolt. */
let traceOk = false;
/** The trace is done and the band is showing its finish. */
const bandDone = ref(false);
/** What the finish says ("43 points"); it lands in the footer when the band closes. */
const doneStat = ref('');
const closeBand = () => {
  // The band's "Highlight complete" settles into the footer line as it closes.
  if (bandDone.value) say('Highlight complete', false, doneStat.value);
  bandDone.value = false;
  bandOn.value = false;
  stopLoader();
};
watch(busy, (on) => {
  if (traceTimer) { clearInterval(traceTimer); traceTimer = undefined; }
  if (!on) {
    // A finished trace always plays the winning route lighting up (Ames:
    // "it's too satisfying"). A failed or stopped one just closes.
    if (traceOk && loaderLive?.finish) { bandDone.value = true; loaderLive.finish(closeBand); }
    else { if (traceOk) bandDone.value = true; closeBand(); }
    return;
  }
  stopLoader();
  traceOk = false;
  bandDone.value = false;
  bandOn.value = true;
  traceSecs.value = 0;
  const t0 = Date.now();
  traceTimer = setInterval(() => { traceSecs.value = Math.round((Date.now() - t0) / 1000); }, 1000);
  requestAnimationFrame(() => {
    const cv = loaderEl.value;
    if (!cv || !busy.value) return;
    loaderLive = { raf: 0, timer: 0 };
    startLoader(cv, loaderLive, 136, 26);
  });
}, { flush: 'post' });

// ── Slim view (Ames 2026-10-05), like the Scout Tag strip and the slim Cell
// Library: one row with the colours as dots, what to do next, Undo and the
// count, so the box is out of the way while marking. The caret in the header
// shrinks it; the caret on the strip opens it again. Remembered.
const SLIM_KEY = 'nge_highlight_slim';
const slim = ref((() => { try { return localStorage.getItem(SLIM_KEY) === '1'; } catch { return false; } })());
async function setSlim(v: boolean) {
  if (slim.value === v) return;
  const el = panelEl.value;
  const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  try { localStorage.setItem(SLIM_KEY, v ? '1' : '0'); } catch { /* private mode */ }
  if (v) {
    // The box shrinks into the strip, and particles write the strip's parts.
    const ghost = el ? snapshotPanel(el) : null;
    adding.value = false;
    slim.value = true;
    await nextTick();
    clampPos();
    if (ghost && el) morphIntoSlim(ghost, el, Array.from(el.querySelectorAll('.nge-hl-slim > *')));
    return;
  }
  // Hidden until the beam draws it, so the full box never flashes in first.
  if (el && !reduce) el.style.clipPath = 'inset(0 0 100% 0)';
  slim.value = false;
  await nextTick();
  clampPos();
  if (el) revealWithBeam(el);
}
/** The one line the strip has room for. */
const slimStep = computed(() => {
  if (messageBad.value && message.value) return message.value;
  if (branchWay.value) return 'Ctrl + click the soma';
  if (first.value) return 'Now the end';
  if (message.value === 'Highlight complete') return stat.value ? `Done, ${stat.value}` : 'Done';
  return 'Ctrl + click';
});

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
/** Whether your highlights are showing, in 2D and in 3D alike. It is the
 *  highlight layers being switched on, so it follows the layer tabs too. */
const shown = ref(highlightsShown());
function setShown(on: boolean) {
  shown.value = on;
  setHighlightsShown(on);
}

// The crosshair cursor shows while a click would place a point.
const ctrlHeld = ref(false);
watch([ctrlHeld, hHeld], () => document.body.classList.toggle('nge-highlight-armed', ctrlHeld.value || hHeld.value));

function say(text: string, bad = false, count = '') { message.value = text; messageBad.value = bad; stat.value = count; }
function refresh() { markCount.value = listHighlights().length; shown.value = highlightsShown(); }
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
  // One more click was asked for, to say which side the soma is on.
  const way = branchWay.value;
  if (way) {
    branchWay.value = null;
    first.value = null;
    try { showEndMarker(pick); } catch (e) { console.warn('[highlight] end marker failed:', e); }
    await trace(wanted => addBranchHighlight(a, way, styleOf(), pick, wanted), 'pieces');
    return;
  }
  first.value = null;
  try { showEndMarker(pick); } catch (e) { console.warn('[highlight] end marker failed:', e); }
  await trace(wanted => addHighlight(a, pick, styleOf(), wanted), 'points');
}

// ── To soma, and Beyond ───────────────────────────────────────────────────
// With one point placed: To soma marks the way back to the soma, Beyond
// marks every branch on the far side of the point (Krzysztof Kruk's idea,
// after the first EyeWire's highlight parents and children). When the soma
// is not known, one more click on the soma side says which way is which.
async function markBranch(way: BranchWay) {
  const a = first.value;
  if (!a || busy.value) return;
  try {
    first.value = null;
    await trace(wanted => addBranchHighlight(a, way, styleOf(), undefined, wanted), 'pieces', true);
  } catch (e) {
    if (!(e instanceof NeedsSomaSide)) throw e;
    // Keep the point, and wait for the click that orients it.
    first.value = a;
    branchWay.value = way;
    try { showStartMarker(a, styleOf()); } catch { /* shown already */ }
    say('');   // the line under the buttons asks for the soma
  }
}

// The ask for the soma lights up as it arrives: one head of light laps its
// border and a few sparks leave it, in the soma layer's amber. Once.
const askEl = ref<HTMLElement | null>(null);
watch(branchWay, async way => {
  if (!way) return;
  await nextTick();
  const el = askEl.value;
  if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  try {
    runPanelLap(el);
    const r = el.getBoundingClientRect();
    runParticleBurst(r.left + 18, r.top + r.height / 2, '255,210,77');
  } catch (e) { console.warn('[highlight] ask animation failed:', e); }
});

/**
 * Run one marking job behind the search band, with the same limits whatever
 * is being marked. The request has no time limit of its own, so a server
 * that never answers left the panel on "Tracing" for good (Krzysztof
 * 2026-10-02): give up after TRACE_LIMIT_MS, or when the player presses
 * Stop. `passSomaAsk` lets the "soma not known" answer through to the caller.
 */
async function trace(job: (stillWanted: () => boolean) => Promise<number>, unit: string, passSomaAsk = false) {
  busy.value = true;
  say('');   // the band at the foot of the box says it is tracing
  let wanted = true;
  let timer = 0;
  let asked: NeedsSomaSide | null = null;
  const gaveUp = new Promise<never>((_, reject) => {
    stopTrace = () => reject(new Error('Stopped. Nothing was marked.'));
    timer = window.setTimeout(() => reject(new Error('The server took too long. Nothing was marked. Try again, or pick two closer points.')), TRACE_LIMIT_MS);
  });
  try {
    const n = await Promise.race([job(() => wanted), gaveUp]);
    // The band announces it first; closeBand() then writes the footer line.
    doneStat.value = `${n.toLocaleString()} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
    traceOk = n > 0;
    if (!traceOk) say('Highlight complete', false, doneStat.value);
  } catch (e: any) {
    if (passSomaAsk && e instanceof NeedsSomaSide) asked = e;
    else {
      const text = String(e?.message || '');
      say(/HTTP error 0|Network or CORS|Failed to fetch/i.test(text)
        ? 'The server did not answer, so nothing was marked. Try again in a moment.'
        : text || 'Could not mark that stretch.', true);
    }
  } finally {
    wanted = false;
    stopTrace = null;
    clearTimeout(timer);
    busy.value = false;
    if (!asked) clearStartMarker();
    refresh();
  }
  if (asked) throw asked;
}

function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') { ctrlHeld.value = true; return; }
  // Shift+H opens and closes the mode (ExtensionBar): not a held H.
  if (isTypingTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
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
// Merge, Cut and Find Path place their own points with Ctrl+click. With one
// of them open, that click is theirs: this box took it, so merging and
// cutting did nothing while Highlight was open (annkri 2026-10-06). H+click
// still places a highlight point, so both can be used side by side.
const editToolOpen = () => !!document.querySelector('.graphene-tool-status');
let toldAboutH = false;
function onPointerCapture(e: PointerEvent) {
  if (e.button !== 0 || !(e.ctrlKey || e.metaKey || hHeld.value)) return;
  if (!inViewer(e.target as HTMLElement | null)) return;
  if (!hHeld.value && editToolOpen()) {
    if (!toldAboutH) { toldAboutH = true; say('Merge or Cut is open, so Ctrl+click goes to it. Hold H and click to highlight.'); }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  void place(e.clientX, e.clientY);
}
// On a Mac, Ctrl+click also asks for the context menu.
function onContextMenu(e: MouseEvent) {
  if (e.ctrlKey && !editToolOpen() && inViewer(e.target as HTMLElement | null)) { e.preventDefault(); e.stopPropagation(); }
}
/** Drop the start point of the mark being made; finished marks are untouched. */
function cancelPick() {
  first.value = null;
  branchWay.value = null;
  clearStartMarker();
  say('Cancelled. Your finished marks are untouched.');
}
function undo() {
  if (first.value) { first.value = null; branchWay.value = null; clearStartMarker(); say('Start point cleared.'); return; }
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

let stopLayerWatch = () => { /* set on mount */ };
onMounted(() => {
  refresh();
  stopLayerWatch = onLayersChanged(() => { shown.value = highlightsShown(); });
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
  stopLayerWatch();
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
  clearLatestHighlight();
  document.body.classList.remove('nge-highlight-armed');
});
</script>

<template>
  <Teleport to="body">
    <div ref="panelEl" class="nge-hl-panel" :class="{ 'nge-hl-panel--placed': pos, 'nge-hl-panel--dragging': dragging, 'nge-hl-panel--slim': slim }" :style="posStyle" role="dialog" aria-label="Highlight mode">
      <!-- Slim: one row. Drag it by any empty part. -->
      <div v-if="slim" class="nge-hl-slim" title="Drag to move" @mousedown="startDrag">
        <button class="nge-hl-caret" type="button" title="Open the full Highlight box" aria-label="Open the full Highlight box" @click="setSlim(false)">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="nge-hl-dots" role="radiogroup" aria-label="Mark as">
          <button
            v-for="s in styles" :key="s.key" type="button" role="radio" class="nge-hl-dot"
            :class="{ 'nge-hl-dot--on': styleKey === s.key }" :style="{ '--hl': s.color }"
            :aria-checked="styleKey === s.key ? 'true' : 'false'" :title="s.label" :aria-label="s.label"
            @click="styleKey = s.key"
          ></button>
        </span>
        <button v-if="first" class="nge-hl-btn nge-hl-btn--sm nge-hl-btn--armed" type="button" :disabled="busy" @click="cancelPick"
                title="Drop the start point you placed. Finished marks stay. (Esc)">Cancel</button>
        <button v-else-if="busy" class="nge-hl-btn nge-hl-btn--sm" type="button" @click="stopTracing"
                title="Stop waiting for this path. Nothing is marked.">Stop</button>
        <template v-if="first && !busy && !branchWay">
          <button class="nge-hl-btn nge-hl-btn--sm" type="button" title="Mark the way from this point back to the soma." @click="markBranch('toward')">To soma</button>
          <button class="nge-hl-btn nge-hl-btn--sm" type="button" title="Mark every branch beyond this point, away from the soma. Where two cells are wrongly joined, the other cell can be marked too." @click="markBranch('away')">Beyond</button>
        </template>
        <span class="nge-hl-slim-step" :class="{ 'nge-hl-bad': messageBad }" :title="slimStep">{{ busy ? 'Tracing' : slimStep }}</span>
        <button class="nge-hl-btn nge-hl-btn--sm" type="button" :disabled="busy || (!markCount && !first)" @click="undo">Undo</button>
        <span class="nge-hl-count" :title="`${markCount} ${markCount === 1 ? 'mark' : 'marks'}`">{{ markCount }}</span>
        <button class="nge-hl-close" type="button" aria-label="Close" @click="emit('hide')">×</button>
      </div>
      <template v-else>
      <div class="nge-hl-head" title="Drag to move" @mousedown="startDrag">
        <span class="nge-hl-title">Highlight</span>
        <button class="nge-hl-caret" type="button" title="Shrink to a slim strip" aria-label="Shrink to a slim strip" @mousedown.stop @click="setSlim(true)">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="nge-hl-close" aria-label="Close" @click="emit('hide')">×</button>
      </div>
      <p class="nge-hl-how">
        <kbd>Ctrl</kbd> + click where a checked stretch starts, then where it ends.
        After the first click you can also mark <b>to the soma</b> or <b>beyond</b>.
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
      <!-- Show / Hide for every highlight at once, in 2D and 3D (Ames
           2026-10-07: "keep the hide/show highlight slider in highlight").
           The side that is lit is how things are now. -->
      <div class="nge-hl-show3d" title="Hide takes your highlights out of view, in 2D and in 3D. Nothing is deleted. You can also hide one highlight from its own layer tab.">
        <span id="nge-hl-show3d-label">Highlight</span>
        <div class="nge-hl-switch" role="radiogroup" aria-labelledby="nge-hl-show3d-label" :data-on="shown ? 'show' : 'hide'">
          <button type="button" role="radio" :aria-checked="shown ? 'true' : 'false'" :tabindex="shown ? 0 : -1"
                  class="nge-hl-switch-opt" @click="setShown(true)"
                  @keydown.right.prevent.stop="setShown(false)" @keydown.left.prevent.stop="setShown(true)">Show</button>
          <button type="button" role="radio" :aria-checked="shown ? 'false' : 'true'" :tabindex="shown ? -1 : 0"
                  class="nge-hl-switch-opt nge-hl-switch-opt--hide" @click="setShown(false)"
                  @keydown.right.prevent.stop="setShown(false)" @keydown.left.prevent.stop="setShown(true)">Hide</button>
        </div>
      </div>
      <!-- The foot of the box reads like a stats line: what just happened, a
           count or two, quietly (Ames 2026-10-02). -->
      <div class="nge-hl-status">
        <span v-if="message" :class="{ 'nge-hl-bad': messageBad }">{{ message }}</span>
        <span v-else-if="!busy && !bandOn" class="nge-hl-dim">{{ branchWay ? '' : first ? 'Start placed. Ctrl + click the end.' : 'No point placed yet.' }}</span>
        <span v-if="stat && !busy" class="nge-hl-stat">{{ stat }}</span>
        <span class="nge-hl-count">{{ markCount }} {{ markCount === 1 ? 'mark' : 'marks' }}</span>
      </div>
      </template>
      <!-- The path search, as the bottom edge of the box, its label beside it. -->
      <div class="nge-hl-loader-wrap" :class="{ 'nge-hl-loader-wrap--on': bandOn, 'nge-hl-loader-wrap--done': bandDone }" :aria-hidden="bandOn ? 'false' : 'true'">
        <canvas v-if="bandOn" ref="loaderEl" class="nge-hl-loader"></canvas>
        <span v-if="bandOn" class="nge-hl-loader-label"><template v-if="!bandDone">Tracing path <b>{{ traceSecs }}s</b></template><template v-else>Highlight complete</template></span>
      </div>
      <!-- With one point placed: the way back to the soma, or everything
           beyond the point (Krzysztof Kruk's idea, 2026-10-09). -->
      <div v-if="first && !busy && !branchWay" class="nge-hl-branch">
        <span class="nge-hl-branch-label">From here</span>
        <button class="nge-hl-btn" type="button" title="Mark the way from this point back to the soma." @click="markBranch('toward')">To soma</button>
        <button class="nge-hl-btn" type="button" title="Mark every branch beyond this point, away from the soma. Where two cells are wrongly joined, the other cell can be marked too." @click="markBranch('away')">Beyond</button>
      </div>
      <!-- The soma is not on record: one clear ask, lit as it arrives so the
           eye goes to it (Ames 2026-10-10). -->
      <div v-if="first && !busy && branchWay" ref="askEl" class="nge-hl-ask" role="status"
           title="This cell's soma is not on record yet. Your click is kept as a point in a Soma layer, so you are asked once per cell.">
        <span class="nge-hl-ask-gem" aria-hidden="true"></span>
        <span><kbd>Ctrl</kbd> + click the soma</span>
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
/* A band across the foot of the box (it bleeds through the padding and
   takes the box's bottom corners), open only while a path is being traced:
   the search on the left, "Tracing path" and the seconds beside it. */
.nge-hl-loader-wrap {
  display: flex; align-items: center; gap: 10px;
  height: 0; overflow: hidden; padding: 0 14px;
  margin: 0 -14px; border-radius: 0 0 11px 11px;
  background: rgba(20, 12, 36, 0.75);
  transition: height 0.2s ease, margin 0.2s ease;
}
.nge-hl-loader-wrap--on { height: 38px; margin: 10px -14px -12px; border-top: 1px solid rgba(200, 164, 255, 0.28); }
/* The finish: the band takes the success colour and pulses once with the surge. */
.nge-hl-loader-wrap--done { border-top-color: rgba(124, 255, 178, 0.6); animation: nge-hl-done 1.5s ease-out both; }
.nge-hl-loader-wrap--done .nge-hl-loader { border-color: rgba(124, 255, 178, 0.55); transition: border-color 0.4s ease; }
/* Tighter tracking so it fits beside the canvas; the count goes to the footer. */
.nge-hl-loader-wrap--done .nge-hl-loader-label { color: #9dffc9; letter-spacing: 0.08em; text-shadow: 0 0 10px rgba(124, 255, 178, 0.55); }
.nge-hl-loader-wrap--done .nge-hl-loader-label b { color: rgba(200, 235, 215, 0.75); }
@keyframes nge-hl-done {
  0% { background: rgba(20, 12, 36, 0.75); box-shadow: inset 0 0 0 rgba(124, 255, 178, 0); }
  22% { background: rgba(18, 60, 40, 0.9); box-shadow: inset 0 0 26px rgba(124, 255, 178, 0.45); }
  100% { background: rgba(10, 30, 22, 0.75); box-shadow: inset 0 0 10px rgba(124, 255, 178, 0.12); }
}
@media (prefers-reduced-motion: reduce) { .nge-hl-loader-wrap--done { animation: none; } }
.nge-hl-loader { display: block; flex-shrink: 0; border-radius: 13px; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(200, 164, 255, 0.25); }
.nge-hl-loader-label {
  font: 700 10.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #eadcff;
  white-space: nowrap;
}
.nge-hl-loader-label b { margin-left: 6px; color: #c8a4ff; font: 600 11px ui-monospace, 'Consolas', monospace; letter-spacing: 0; text-transform: none; }
.nge-hl-title { font: 600 12px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #9dffc9; }
/* ── Slim view ── */
.nge-hl-caret {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 22px; height: 22px; padding: 0; border-radius: 999px; cursor: pointer;
  color: #9dffc9; background: rgba(124, 255, 178, 0.1); border: 1px solid rgba(124, 255, 178, 0.4);
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.nge-hl-caret:hover { background: rgba(124, 255, 178, 0.22); border-color: rgba(124, 255, 178, 0.75); box-shadow: 0 0 10px rgba(124, 255, 178, 0.35); }
.nge-hl-head .nge-hl-caret { margin-left: auto; }
.nge-hl-head .nge-hl-caret + .nge-hl-close { margin-left: 4px; }
.nge-hl-panel--slim { width: auto; min-width: 0; padding: 7px 10px; }
.nge-hl-slim { display: flex; align-items: center; gap: 8px; cursor: grab; user-select: none; }
.nge-hl-panel--dragging .nge-hl-slim { cursor: grabbing; }
.nge-hl-dots { display: inline-flex; align-items: center; gap: 5px; }
.nge-hl-dot {
  width: 16px; height: 16px; padding: 0; border-radius: 50%; cursor: pointer;
  background: var(--hl); border: 2px solid rgba(6, 10, 20, 0.95);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
  transition: box-shadow 0.12s ease, transform 0.12s ease;
}
.nge-hl-dot:hover { transform: scale(1.12); }
.nge-hl-dot--on { box-shadow: 0 0 0 2px var(--hl), 0 0 10px var(--hl); }
.nge-hl-btn--sm { padding: 3px 8px; font-size: 11px; }
.nge-hl-slim-step {
  max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11.5px; color: #9dffc9;
}
.nge-hl-slim-step.nge-hl-bad { color: #ff9aa8; }
.nge-hl-slim .nge-hl-count { margin-left: 2px; }
.nge-hl-slim .nge-hl-close { margin-left: 0; }
/* The search band keeps to the slim box's own padding, and the box is wide
   enough for it while it shows. */
.nge-hl-panel--slim .nge-hl-loader-wrap { margin: 0 -10px; padding: 0 10px; }
.nge-hl-panel--slim .nge-hl-loader-wrap--on { margin: 7px -10px -7px; min-width: 268px; }
.nge-hl-close { margin-left: auto; background: none; border: none; color: rgba(255, 255, 255, 0.55); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.nge-hl-close:hover { color: #fff; }
.nge-hl-how { margin: 8px 0 10px; font-size: 13px; line-height: 1.45; color: rgba(220, 230, 245, 0.72); }
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
.nge-hl-branch { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.nge-hl-branch-label { flex: 1; font-size: 13px; color: #b9c8da; }
.nge-hl-branch .nge-hl-btn { font-size: 13px; }
.nge-hl-ask {
  position: relative; display: flex; align-items: center; gap: 10px; margin-top: 8px; padding: 9px 12px;
  border-radius: 8px; font-size: 14px; font-weight: 600; color: #ffe9a8;
  background: rgba(255, 210, 77, 0.09); border: 1px solid rgba(255, 210, 77, 0.45);
  animation: nge-hl-ask-in 0.42s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
}
.nge-hl-ask kbd { padding: 0 5px; border-radius: 4px; border: 1px solid rgba(255, 233, 168, 0.4); background: rgba(255, 210, 77, 0.14); font: 600 12px 'JetBrains Mono', 'Consolas', monospace; color: #fff; }
/* A small gem, the soma marker's shape, that settles after one pulse. */
.nge-hl-ask-gem {
  flex: 0 0 auto; width: 12px; height: 12px; transform: rotate(45deg); border-radius: 2px;
  background: #ffd24d; box-shadow: 0 0 10px rgba(255, 210, 77, 0.8);
  animation: nge-hl-ask-gem 0.9s ease-out both;
}
@keyframes nge-hl-ask-in {
  0% { opacity: 0; transform: translateY(6px) scale(0.96); box-shadow: 0 0 0 rgba(255, 210, 77, 0); }
  60% { opacity: 1; box-shadow: 0 0 22px rgba(255, 210, 77, 0.45); }
  100% { opacity: 1; transform: none; box-shadow: 0 0 0 rgba(255, 210, 77, 0); }
}
@keyframes nge-hl-ask-gem {
  0% { transform: rotate(45deg) scale(0.2); opacity: 0; }
  45% { transform: rotate(225deg) scale(1.5); opacity: 1; }
  100% { transform: rotate(405deg) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) { .nge-hl-ask, .nge-hl-ask-gem { animation: none; } }
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
.nge-hl-show3d { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: 11.5px; color: rgba(220, 230, 245, 0.72); user-select: none; }
/* A two way switch in the site's own language (scifi-ui, SCIFIIFY.md): the
   leaderboard's Edits / Cells lettering (Orbitron, tracked, squared corners),
   and the library's mark for "this one is on" (a tinted field with an inner
   glow, keyed off the same aria attribute a screen reader reads, not a class).
   One lit field slides between the two words: it chases to the new state
   rather than jumping, runs once, and under reduced motion simply sits where
   the state is. Both words are always in sight. */
.nge-hl-switch {
  --sw: 124 255 178;                       /* the box's green while marks show */
  position: relative; display: inline-grid; grid-template-columns: 1fr 1fr; flex: 0 0 auto;
  border-radius: 3px; overflow: hidden;
  background: transparent;
  /* Quiet (Ames 2026-10-10: "too bold"): a setting, not a call to action. */
  border: 1px solid rgb(var(--sw) / 0.16);
  transition: border-color 0.2s ease;
}
.nge-hl-switch[data-on="hide"] { --sw: 150 178 214; }   /* hidden is a quieter, cooler state */
.nge-hl-switch::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 50%; pointer-events: none;
  background: rgb(var(--sw) / 0.08);
  box-shadow: inset 0 -1px 0 rgb(var(--sw) / 0.55);
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.2s ease, box-shadow 0.2s ease;
}
.nge-hl-switch[data-on="hide"]::after { transform: translateX(100%); }
.nge-hl-switch-opt {
  position: relative; z-index: 1; min-width: 42px; padding: 3px 9px 4px; border: 0; cursor: pointer; background: transparent;
  font: 500 8.5px 'Orbitron', 'Rajdhani', 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgba(160, 195, 230, 0.42);
  transition: color 0.15s ease;
}
.nge-hl-switch-opt:hover, .nge-hl-switch-opt:focus-visible { color: rgba(214, 232, 250, 0.92); }
.nge-hl-switch-opt[aria-checked="true"] { color: rgba(222, 240, 232, 0.86); }
.nge-hl-switch-opt:focus-visible { outline: 1px solid rgb(var(--sw) / 0.9); outline-offset: -2px; }
.nge-hl-switch-opt:active { transform: translateY(1px); }
@media (prefers-reduced-motion: reduce) { .nge-hl-switch, .nge-hl-switch::after, .nge-hl-switch-opt { transition: none; } }
.nge-hl-status { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; min-height: 18px; font-size: 11px; color: rgba(200, 212, 228, 0.62); }
.nge-hl-dim { color: rgba(200, 212, 228, 0.42); }
.nge-hl-stat { color: rgba(200, 212, 228, 0.4); font-variant-numeric: tabular-nums; }
.nge-hl-bad { color: #ff9aa8; }
.nge-hl-count { margin-left: auto; flex-shrink: 0; color: rgba(200, 212, 228, 0.4); font-variant-numeric: tabular-nums; }
.nge-hl-spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid rgba(124, 255, 178, 0.3); border-top-color: #7cffb2; animation: nge-hl-spin 0.7s linear infinite; }
@keyframes nge-hl-spin { to { transform: rotate(360deg); } }
</style>

<style>
/* While a click will place a highlight point, say so with the cursor. */
body.nge-highlight-armed .neuroglancer-rendered-data-panel { cursor: crosshair !important; }
</style>
