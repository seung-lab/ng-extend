<script setup lang="ts">
/**
 * TagModePanel — Scout tag mode, hologram edition.
 *
 * Pick a type (Cut / Extend / Other), then hold T and left-click the spot in
 * 2D or 3D (or use the Tag crosshair button). On a successful drop the form
 * box de-materializes and a success box materializes in its place; clicking
 * the success box plays the same cycle back to the form. The materialize
 * animation and the cursor-fleeing HUD motes are ported verbatim from
 * scifi-ui (hologram.css holodialog-materialize; hologram.js section 10
 * swarm: 150px influence radius, 62px max push, squared falloff).
 *
 * The box is draggable by its header and remembers its position; the default
 * perch overlaps the 2D EM pane, upper left.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useIssueTagStore, useSegmentAnnotationStore, IssueTagType } from '../store';
import { storeToRefs } from 'pinia';
import ScreenshotDialog from 'components/ScreenshotDialog.vue';
import scytheIcon from '../../static/tags/scythe-icon.png';

const emit = defineEmits({ hide: null });
const tagStore = useIssueTagStore();
const { activeSegId } = storeToRefs(useSegmentAnnotationStore());

const TAG_CHOICES: { key: string; tagType: IssueTagType; label: string; hint: string }[] = [
  { key: 'cut',    tagType: 'merger',         label: 'Cut',    hint: 'Wrongly joined here, Grim reaps it apart' },
  { key: 'extend', tagType: 'missing_branch', label: '🌿 Extend', hint: 'A branch looks truncated, keep growing it' },
  { key: 'other',  tagType: 'other',          label: '⚑ Other',   hint: 'Something else, describe it in the note' },
];
const LAST_CHOICE_KEY = 'nge_tag_last_choice_v2';
const selected = ref(localStorage.getItem(LAST_CHOICE_KEY) || 'cut');
const selectedChoice = computed(() => TAG_CHOICES.find(c => c.key === selected.value) ?? TAG_CHOICES[0]);
function choose(key: string) {
  selected.value = key;
  try { localStorage.setItem(LAST_CHOICE_KEY, key); } catch {}
}

const note = ref('');
const annotationLayer = ref('');
const screenshotUrl = ref('');
const showScreenshotDialog = ref(false);
const saving = ref(false);
const flash = ref('');
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** 'form' shows the chooser; 'success' the confirmation. '-out' phases play
 *  the materialize animation in reverse before the swap. */
const phase = ref<'form' | 'form-out' | 'success' | 'success-out'>('form');
const lastTag = ref<{ label: string; pos: number[] } | null>(null);
const SWAP_MS = 500; // reverse-materialize duration before swapping boxes

function annotationLayers(): string[] {
  try {
    const viewer = (window as any)['viewer'];
    return (viewer?.layerManager?.managedLayers ?? [])
      .filter((l: any) => l.layer?.type === 'annotation')
      .map((l: any) => l.name) as string[];
  } catch { return []; }
}

function crosshairPosition(): number[] {
  try {
    const v: any = (window as any)['viewer'];
    const p = v?.navigationState?.position?.value;
    return p ? [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])] : [];
  } catch { return []; }
}

function mousePosition(): number[] {
  try {
    const v: any = (window as any)['viewer'];
    const m = v?.mouseState;
    if (m?.active && m.position?.length >= 3) {
      return [Math.round(m.position[0]), Math.round(m.position[1]), Math.round(m.position[2])];
    }
  } catch {}
  return [];
}

const posLabel = computed(() => {
  const p = crosshairPosition();
  return p.length === 3 ? `${p[0]}, ${p[1]}, ${p[2]}` : 'no position';
});

async function drop(position: number[]) {
  if (saving.value || phase.value !== 'form') return;
  if (position.length !== 3) { showFlash('No position under cursor'); return; }
  const c = selectedChoice.value;
  if (c.tagType === 'other' && !note.value.trim()) { showFlash('Other needs a note'); return; }
  saving.value = true;
  const t = await tagStore.add({
    tagType: c.tagType,
    position,
    segId: activeSegId.value || undefined,
    note: note.value.trim() || undefined,
    annotationLayer: annotationLayer.value || undefined,
    screenshotUrl: screenshotUrl.value || undefined,
  });
  saving.value = false;
  if (!t) { showFlash('Tag failed, try again'); return; }
  note.value = '';
  screenshotUrl.value = '';
  lastTag.value = { label: c.label.replace(/^\S+\s/, ''), pos: position };
  // Form de-materializes, success materializes.
  phase.value = 'form-out';
  setTimeout(() => { phase.value = 'success'; }, SWAP_MS);
}

/** Clicking the success box plays the same cycle back to the form. */
function dismissSuccess() {
  if (phase.value !== 'success') return;
  phase.value = 'success-out';
  setTimeout(() => { phase.value = 'form'; }, SWAP_MS);
}

function showFlash(msg: string) {
  flash.value = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash.value = ''; }, 1800);
}

// ── Draggable, position remembered ───────────────────────────────────────────
const POS_KEY = 'nge_tagmode_pos_v1';
const panelPos = ref<{ left: number; top: number }>((() => {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) return saved;
  } catch {}
  // Default perch: upper left, overlapping the 2D EM pane.
  return { left: 16, top: 108 };
})());

let dragOff: { x: number; y: number } | null = null;
function dragStart(e: PointerEvent) {
  dragOff = { x: e.clientX - panelPos.value.left, y: e.clientY - panelPos.value.top };
  window.addEventListener('pointermove', dragMove);
  window.addEventListener('pointerup', dragEnd, { once: true });
}
function dragMove(e: PointerEvent) {
  if (!dragOff) return;
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  panelPos.value = {
    left: Math.min(Math.max(8 - 340, e.clientX - dragOff.x), w - 60),
    top: Math.min(Math.max(44, e.clientY - dragOff.y), h - 60),
  };
}
function dragEnd() {
  window.removeEventListener('pointermove', dragMove);
  dragOff = null;
  try { localStorage.setItem(POS_KEY, JSON.stringify(panelPos.value)); } catch {}
}

// ── T + left click, or the arm-once button ──────────────────────────────────
const tHeld = ref(false);
/** Set by the "Place by click" button: the NEXT viewer click drops the tag. */
const armedOnce = ref(false);
function armOnce() {
  armedOnce.value = !armedOnce.value;
  document.body.classList.toggle('nge-tag-armed', armedOnce.value);
}
function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return;
  if (e.key === 't' || e.key === 'T') {
    tHeld.value = true;
    document.body.classList.add('nge-tag-armed');
  }
  if (e.key === 'Escape') emit('hide');
}
function onKeyUp(e: KeyboardEvent) {
  if (e.key === 't' || e.key === 'T') {
    tHeld.value = false;
    document.body.classList.remove('nge-tag-armed');
  }
}
// pointerdown in the CAPTURE phase: neuroglancer handles mousedown itself
// and a synthetic 'click' may never fire on the canvas, which made T+click
// look dead with no explanation. Capture runs first, and a failed position
// read now says so instead of silently letting the click through.
function onPointerCapture(e: PointerEvent) {
  if ((!tHeld.value && !armedOnce.value) || e.button !== 0) return;
  if ((e.target as HTMLElement)?.closest?.('.nge-tagmode-wrap')) return;
  const pos = mousePosition();
  e.preventDefault();
  e.stopPropagation();
  if (armedOnce.value) { armedOnce.value = false; document.body.classList.remove('nge-tag-armed'); }
  if (pos.length !== 3) { showFlash('No data under cursor, hover the 2D or 3D view'); return; }
  drop(pos);
}

onMounted(() => {
  // Show existing open tags in the volume the moment tag mode opens.
  tagStore.syncTagLayer();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointerdown', onPointerCapture, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('pointerdown', onPointerCapture, true);
  window.removeEventListener('pointermove', dragMove);
  document.body.classList.remove('nge-tag-armed');
});
</script>

<template>
  <Teleport to="body">
    <div ref="wrapEl" class="nge-tagmode-wrap" :class="{ 'nge-tagmode-wrap--armed': tHeld || armedOnce }" :style="{ left: panelPos.left + 'px', top: panelPos.top + 'px' }">

      <!-- Form box -->
      <div
        v-if="phase === 'form' || phase === 'form-out'"
        class="nge-tagmode"
        :class="{ 'nge-holo-out': phase === 'form-out' }"
      >
        <div class="nge-tagmode-head" @pointerdown.prevent="dragStart">
          <span class="nge-tagmode-title">⚑ SCOUT TAG MODE</span>
          <button class="nge-tagmode-close" title="Exit tag mode (Esc)" @pointerdown.stop @click="emit('hide')">×</button>
        </div>
        <div class="nge-tagmode-hint">
          Pick a type, then <b>hold T and click</b> the spot, or use <b>Place by click</b>. <b>Submit</b> tags the crosshair.
        </div>
        <div class="nge-tagmode-chips">
          <button
            v-for="c in TAG_CHOICES" :key="c.key"
            class="nge-tagmode-chip"
            :class="{
              'nge-tagmode-chip--active': selected === c.key,
              'nge-tagmode-chip--cut': c.key === 'cut',
              'nge-tagmode-chip--ext': c.key === 'extend',
            }"
            :title="c.hint"
            @click="choose(c.key)"
          ><img v-if="c.key === 'cut'" :src="scytheIcon" class="nge-tagmode-chip-img" alt="" /><template v-else>{{ c.key === 'extend' ? '🌿 ' : '⚑ ' }}</template>{{ c.key === 'cut' ? ' Cut' : c.label.replace(/^\S+\s/, '') }}</button>
        </div>
        <input
          v-model="note"
          class="nge-tagmode-note"
          :placeholder="selectedChoice.tagType === 'other' ? 'Describe it…' : 'Optional note…'"
          @keydown.stop @keyup.stop @keypress.stop
        />
        <div class="nge-tagmode-extras">
          <select v-if="annotationLayers().length" v-model="annotationLayer" class="nge-tagmode-select">
            <option value="">No annotation layer</option>
            <option v-for="l in annotationLayers()" :key="l" :value="l">📐 {{ l }}</option>
          </select>
          <button class="nge-tagmode-shot" @click="showScreenshotDialog = true">
            {{ screenshotUrl ? '🖼 Attached ✓' : '📸 Screenshot' }}
          </button>
        </div>
        <div class="nge-tagmode-foot">
          <span class="nge-tagmode-pos">crosshair: <b>{{ posLabel }}</b></span>
          <button class="nge-tagmode-btn" :disabled="saving" @click="drop(crosshairPosition())">
            ⚑ Tag crosshair
          </button>
        </div>
        <div v-if="flash" class="nge-tagmode-flash">{{ flash }}</div>
      </div>

      <!-- Success box: click to play the cycle back to the form -->
      <div
        v-else
        class="nge-tagmode nge-tagmode--success"
        :class="{ 'nge-holo-out': phase === 'success-out' }"
        @click="dismissSuccess"
        title="Click to keep scouting"
      >
        <div class="nge-tagmode-success-glyph">⚑</div>
        <div class="nge-tagmode-success-title">{{ lastTag?.label }} candidate tagged</div>
        <div class="nge-tagmode-success-pos">{{ lastTag?.pos.join(', ') }}</div>
        <div class="nge-tagmode-success-hint">logged for the Scythes · click to keep scouting</div>
      </div>
    </div>
    <screenshot-dialog
      :show="showScreenshotDialog"
      mode="attach"
      @close="showScreenshotDialog = false"
      @attached="p => { screenshotUrl = p.url; showScreenshotDialog = false; }"
    />
  </Teleport>
</template>

<style scoped>
/* Armed (T held): the panel glows and the page cursor becomes a crosshair,
   so there is no doubt the next click drops a tag. */
:global(body.nge-tag-armed) { cursor: crosshair; }
.nge-tagmode-wrap--armed .nge-tagmode {
  border-color: rgba(245, 209, 66, 0.85);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55), 0 0 18px rgba(245, 209, 66, 0.35);
}
.nge-tagmode-wrap {
  position: fixed;
  z-index: 10005;
  width: 340px;
  max-width: calc(100vw - 24px);
}

/* ── The box. Materialize ported verbatim from scifi-ui hologram.css:
      "it arrives blurred, overbright and slightly too large, and settles
      through a soft overshoot at 60 per cent". The reverse plays the same
      curve backwards for the swap. ── */
.nge-tagmode {
  position: relative;
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(245, 209, 66, 0.35);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(245, 209, 66, 0.08);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: 'Inter', 'Segoe UI', sans-serif;
  animation: nge-holo-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.nge-holo-out {
  animation: nge-holo-materialize 0.5s cubic-bezier(0.16, 1, 0.3, 1) reverse both;
}
/* Softened from the scifi-ui original: the brightness(3) overbright flash
   read as an error strobe on a large panel (Amy). Keep the blur settle and
   the soft overshoot; drop the flash. Oddly satisfying, not alarming. */
@keyframes nge-holo-materialize {
  0%   { opacity: 0; transform: scale(1.025) translateY(-8px); filter: blur(14px); }
  60%  { opacity: 1; transform: scale(0.995); filter: blur(0); }
  100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
}
@media (prefers-reduced-motion: reduce) {
  .nge-tagmode, .nge-holo-out { animation: none; }
}

.nge-tagmode-head { display: flex; align-items: center; cursor: grab; }
.nge-tagmode-head:active { cursor: grabbing; }
.nge-tagmode-title {
  flex: 1;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #f5d142;
  user-select: none;
}
.nge-tagmode-close {
  background: none; border: none; color: #889; font-size: 18px;
  line-height: 1; cursor: pointer; padding: 0 2px;
}
.nge-tagmode-close:hover { color: #fff; }
.nge-tagmode-hint { font-size: 11px; color: rgba(255, 255, 255, 0.55); line-height: 1.45; }
.nge-tagmode-hint b { color: #f5d142; font-weight: 600; }
.nge-tagmode-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-tagmode-chip {
  padding: 5px 12px;
  border-radius: 12px;
  font-size: 12.5px;
  cursor: pointer;
  background: rgba(245, 209, 66, 0.06);
  border: 1px solid rgba(245, 209, 66, 0.28);
  color: #dcb;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.nge-tagmode-chip--cut { background: rgba(224, 96, 96, 0.08); border-color: rgba(224, 96, 96, 0.3); color: #eaa; }
.nge-tagmode-chip--ext { background: rgba(96, 192, 96, 0.08); border-color: rgba(96, 192, 96, 0.3); color: #9d9; }
.nge-tagmode-chip-img { width: 15px; height: 15px; vertical-align: -3px; margin-right: 3px; }
.nge-tagmode-chip--active {
  background: rgba(245, 209, 66, 0.18);
  border-color: rgba(245, 209, 66, 0.65);
  color: #ffe9a0;
}
.nge-tagmode-note {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #dde;
  font-size: 12px;
  padding: 6px 9px;
}
.nge-tagmode-note:focus { outline: none; border-color: rgba(245, 209, 66, 0.45); }
.nge-tagmode-extras { display: flex; gap: 8px; }
.nge-tagmode-select {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #dde;
  font-size: 11.5px;
  padding: 5px 7px;
  color-scheme: dark;
}
.nge-tagmode-shot {
  background: rgba(120, 140, 255, 0.1);
  border: 1px solid rgba(120, 140, 255, 0.3);
  border-radius: 6px;
  color: #bcd;
  font-size: 11.5px;
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.nge-tagmode-shot:hover { background: rgba(120, 140, 255, 0.2); }
.nge-tagmode-foot { display: flex; align-items: center; gap: 8px; }
.nge-tagmode-actions-row { display: flex; gap: 8px; }
.nge-tagmode-arm {
  flex: 1;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12px;
  cursor: pointer;
  background: rgba(120, 140, 255, 0.1);
  border: 1px solid rgba(120, 140, 255, 0.35);
  color: #cdf;
}
.nge-tagmode-arm--on {
  background: rgba(245, 209, 66, 0.18);
  border-color: rgba(245, 209, 66, 0.65);
  color: #ffe9a0;
  animation: nge-arm-pulse 1.2s ease-in-out infinite;
}
@keyframes nge-arm-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 209, 66, 0.25); }
  50%      { box-shadow: 0 0 0 5px rgba(245, 209, 66, 0.06); }
}
.nge-tagmode-pos { flex: 1; font-size: 11px; color: rgba(255, 255, 255, 0.65); }
.nge-tagmode-pos b { color: #ffb454; font-weight: 600; }
.nge-tagmode-btn {
  padding: 6px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(245, 209, 66, 0.14);
  border: 1px solid rgba(245, 209, 66, 0.45);
  color: #ffe9a0;
}
.nge-tagmode-btn:hover { background: rgba(245, 209, 66, 0.24); }
.nge-tagmode-btn:disabled { opacity: 0.5; cursor: default; }
.nge-tagmode-flash { font-size: 12px; color: #f5d142; text-align: center; }

/* ── Success box ── */
.nge-tagmode--success {
  align-items: center;
  gap: 4px;
  padding: 20px 16px;
  cursor: pointer;
  border-color: rgba(96, 192, 96, 0.4);
}
.nge-tagmode-success-glyph { font-size: 30px; color: #f5d142; }
.nge-tagmode-success-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #d9f5d9;
}
.nge-tagmode-success-pos { font-size: 11.5px; color: #ffb454; }
.nge-tagmode-success-hint { font-size: 10.5px; color: rgba(255, 255, 255, 0.45); margin-top: 4px; }

</style>
