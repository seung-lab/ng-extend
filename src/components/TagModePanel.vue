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
import { scoutPinSvg } from '../data/toolbar-icons';
import { runPanelTrace, runParticleBurst, runPanelZip, runPanelDraw, runBurstCoalesce } from '../util/holo_trace';

const pinSvg = scoutPinSvg();
const pinSvgBig = scoutPinSvg('#35b5ff', 'width:34px;height:34px;');
// Open hand for the mini strip's right-edge drag grip.
const HAND_SVG = '<svg viewBox="0 0 16 16" fill="none" style="width:1em;height:1em;vertical-align:middle;"><path d="M5.1 7.3V4a1 1 0 0 1 2 0v3M7.1 7V3a1 1 0 0 1 2 0v4M9.1 7V3.7a1 1 0 0 1 2 0V8M11.1 8V5.6a.95.95 0 0 1 1.9 0v3.6c0 2.6-1.8 4.5-4.3 4.5h-.6c-1.5 0-2.6-.6-3.4-1.8L3.2 9.9c-.5-.8-.3-1.5.4-1.9.6-.3 1.3-.1 1.7.5l.8 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const emit = defineEmits({ hide: null });
const wrapEl = ref<HTMLElement | null>(null);
const boxEl = ref<HTMLElement | null>(null);
const submitBtnEl = ref<HTMLElement | null>(null);
const tagStore = useIssueTagStore();
const { activeSegId } = storeToRefs(useSegmentAnnotationStore());

const TAG_CHOICES: { key: string; tagType: IssueTagType; label: string; hint: string }[] = [
  { key: 'cut',    tagType: 'merger',         label: 'Cut',    hint: 'Wrongly joined here, Grim reaps it apart' },
  { key: 'extend', tagType: 'missing_branch', label: '🌿 Extend', hint: 'A branch looks truncated, keep growing it' },
  { key: 'other',  tagType: 'other',          label: '⚑ Other',   hint: 'Something else, describe it in the note' },
];
/** The light carries meaning: blue Cut, green Extend, purple Other. */
const TAG_RGB: Record<string, string> = {
  merger: '53,181,255',
  missing_branch: '96,224,128',
  other: '200,150,255',
};
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
const lastTag = ref<{ label: string; pos: number[]; tagType: string } | null>(null);
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


/** A point placed by T+click or Place-by-click, awaiting Submit. Shown in
 *  the tag layer as a preview so placing gives visible feedback without
 *  saving anything yet (Amy: "place by click should not automatically
 *  submit - it should just place the point"). */
const pendingPos = ref<number[] | null>(null);
/** Screen position of the last placed click, so the submit stream can
 *  launch from the deed itself. */
let placeScreen: { x: number; y: number } | null = null;
function placePoint(pos: number[], screenX?: number, screenY?: number) {
  if (pos.length !== 3) { showFlash('No data under cursor, hover the 2D or 3D view'); return; }
  pendingPos.value = pos;
  tagStore.setTagPreview(pos, selectedChoice.value.tagType);
  placeScreen = screenX != null && screenY != null ? { x: screenX, y: screenY } : null;
  // A spark right where the click landed in the 2D/3D view, so placing a
  // point answers back at the point itself, in the tag type's color.
  if (placeScreen) runParticleBurst(placeScreen.x, placeScreen.y, TAG_RGB[selectedChoice.value.tagType]);
  showFlash('Point placed, hit Submit');
}
function clearPending() {
  pendingPos.value = null;
  tagStore.setTagPreview(null);
}
function submit() {
  drop(pendingPos.value ?? crosshairPosition());
}

function copyCoords() {
  const p = pendingPos.value ?? crosshairPosition();
  if (p.length !== 3) return;
  try {
    navigator.clipboard.writeText(p.join(', '));
    showFlash('Coordinates copied');
  } catch { showFlash('Copy failed'); }
}

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
  clearPending();
  const label = c.label.replace(/^\S+\s/, '');
  lastTag.value = { label, pos: position, tagType: c.tagType };
  // The success box takes the form box's exact footprint so the swap reads
  // as one panel changing faces, not two different boxes.
  const fb = boxEl.value?.getBoundingClientRect();
  if (fb) successSize.value = { width: fb.width + 'px', minHeight: fb.height + 'px' };
  // Two waves (Amy's spec): Submit fires particles from the panel, then a
  // second wave fires from the placed point, and both sets coalesce along
  // the border together. Colored by tag type.
  const br = wrapEl.value?.getBoundingClientRect();
  const rgb = TAG_RGB[c.tagType];
  const secondOrigin = placeScreen;
  placeScreen = null;
  let total = 0;
  if (br) {
    const getRect = () => wrapEl.value?.getBoundingClientRect() ?? null;
    // Wave 1 fires from the Submit button itself (Amy 2026-08-17); wave 2
    // from the placed point, unchanged.
    const sb = submitBtnEl.value?.getBoundingClientRect();
    const w1x = sb ? sb.left + sb.width / 2 : br.left + br.width / 2;
    const w1y = sb ? sb.top + sb.height / 2 : br.top + br.height / 2;
    total = runBurstCoalesce(w1x, w1y, getRect, rgb);
    if (secondOrigin) {
      setTimeout(() => runBurstCoalesce(secondOrigin.x, secondOrigin.y, getRect, rgb), 180);
    }
  }
  if (collapsed.value) {
    // The mini strip has no room for the success box; the flash plus the
    // light landing on the strip's border does the job.
    showFlash(`✓ ${label} candidate tagged`);
    return;
  }
  // The success box keeps its own border hidden until the light hands off.
  successFrameless.value = true;
  setTimeout(() => { successFrameless.value = false; }, total ? Math.round(total * 0.86) : 0);
  // Form de-materializes, success materializes.
  phase.value = 'form-out';
  setTimeout(() => { phase.value = 'success'; }, SWAP_MS);
}
const successFrameless = ref(false);
const successSize = ref<{ width: string; minHeight: string } | null>(null);

/** Clicking the success box celebrates, sends a +1 to the profile, and
 *  plays the cycle back to the form. */
function dismissSuccess() {
  if (phase.value !== 'success') return;
  const r = wrapEl.value?.getBoundingClientRect();
  if (r) {
    runParticleBurst(r.left + r.width / 2, r.top + r.height / 2,
      TAG_RGB[lastTag.value?.tagType ?? 'merger']);
    // The +1 comet to the profile is shelved for now (Amy 2026-08-17), it
    // read as an unidentified object shooting off the box.
  }
  phase.value = 'success-out';
  setTimeout(() => { phase.value = 'form'; }, SWAP_MS);
}

function showFlash(msg: string) {
  flash.value = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash.value = ''; }, 1800);
}

// ── Collapsed corner strip ───────────────────────────────────────────────────
const COLLAPSED_KEY = 'nge_tagmode_collapsed_v1';
const collapsed = ref(localStorage.getItem(COLLAPSED_KEY) === '1');
/** True while the expand beam is drawing the box; suppresses the pop-in
 *  materialize (its blur flash read as a glitch between the two boxes) and
 *  holds the panel invisible until the light has drawn its frame. */
const drawingIn = ref(false);
function setCollapsed(v: boolean) {
  collapsed.value = v;
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch {}
  if (v) {
    // Collapse: the zip races up the slim strip.
    requestAnimationFrame(() => { if (wrapEl.value) runPanelZip(wrapEl.value, 'up'); });
    return;
  }
  // Expand: no pop. The beam draws the frame AND acts as a mask, the box
  // content is revealed exactly as far down as the beam has travelled.
  drawingIn.value = true;
  requestAnimationFrame(() => {
    const box = boxEl.value;
    if (box) box.style.clipPath = 'inset(0 0 100% 0)';
    const total = wrapEl.value ? runPanelDraw(wrapEl.value, 'down', frac => {
      const b = boxEl.value;
      if (!b) return;
      if (frac >= 1) {
        b.style.clipPath = '';
        drawingIn.value = false;
      } else {
        b.style.clipPath = `inset(0 0 ${((1 - frac) * 100).toFixed(2)}% 0)`;
      }
    }) : 0;
    if (!total) { if (box) box.style.clipPath = ''; drawingIn.value = false; }
  });
}
function miniChoose(key: string) {
  choose(key);
  // Other requires a note, and the strip has no note field.
  if (key === 'other') setCollapsed(false);
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
    // Swallow the key in the capture phase: neuroglancer's tool binder also
    // listens for T (Add cube) and was stealing the press, so T+click opened
    // the cube tool's status bar instead of arming the tag click.
    e.preventDefault();
    e.stopImmediatePropagation();
    tHeld.value = true;
    document.body.classList.add('nge-tag-armed');
  }
  if (e.key === 'Escape') emit('hide');
}
function onKeyUp(e: KeyboardEvent) {
  if (e.key === 't' || e.key === 'T') {
    if (!isTypingTarget(e)) e.stopImmediatePropagation();
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
  placePoint(pos, e.clientX, e.clientY);
}

onMounted(() => {
  // Show existing open tags in the volume the moment tag mode opens
  // (overrides the ambient showScoutTags preference while open).
  tagStore.setTagModeActive(true);
  // Cell Library's opening beam, running the panel boundary once.
  requestAnimationFrame(() => { if (wrapEl.value) runPanelTrace(wrapEl.value); });
  // Capture phase so the T press never reaches neuroglancer's key bindings.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointerdown', onPointerCapture, true);
});
onBeforeUnmount(() => {
  clearPending();
  tagStore.setTagModeActive(false);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('pointerdown', onPointerCapture, true);
  window.removeEventListener('pointermove', dragMove);
  document.body.classList.remove('nge-tag-armed');
});
</script>

<template>
  <Teleport to="body">
    <div ref="wrapEl" class="nge-tagmode-wrap" :class="{ 'nge-tagmode-wrap--armed': tHeld || armedOnce }" :style="{ left: panelPos.left + 'px', top: panelPos.top + 'px' }">

      <!-- Collapsed corner strip: chips + place + submit, nothing else -->
      <div v-if="collapsed" class="nge-tagmode-mini">
        <span class="nge-tagmode-mini-grip" title="Drag" @pointerdown.prevent="dragStart" v-html="pinSvg"></span>
        <button
          v-for="c in TAG_CHOICES" :key="c.key"
          class="nge-tagmode-mini-chip"
          :class="{ 'nge-tagmode-mini-chip--active': selected === c.key }"
          :title="c.hint"
          @click="miniChoose(c.key)"
        ><img v-if="c.key === 'cut'" :src="scytheIcon" class="nge-tagmode-chip-img" alt="" />{{ c.key === 'cut' ? 'Cut' : c.key === 'extend' ? 'Extend' : 'Other' }}</button>
        <button
          class="nge-tagmode-mini-act"
          :class="{ 'nge-tagmode-mini-act--on': armedOnce || tHeld }"
          :title="armedOnce ? 'Click the data to place the point' : 'Place point with next click'"
          @click="armOnce"
        ><span class="nge-tagmode-pin" v-html="pinSvg"></span></button>
        <button class="nge-tagmode-mini-act nge-tagmode-mini-submit" :disabled="saving" title="Submit tag" @click="submit">✓</button>
        <button class="nge-tagmode-mini-act" title="Expand panel" @click="setCollapsed(false)">▴</button>
        <button class="nge-tagmode-mini-act nge-tagmode-mini-close" title="Exit tag mode (Esc)" @click="emit('hide')">×</button>
        <span class="nge-tagmode-mini-hand" title="Drag to move" @pointerdown.prevent="dragStart" v-html="HAND_SVG"></span>
        <div v-if="flash" class="nge-tagmode-flash nge-tagmode-flash--mini">{{ flash }}</div>
      </div>

      <!-- Form box -->
      <div
        v-else-if="phase === 'form' || phase === 'form-out'"
        ref="boxEl"
        class="nge-tagmode"
        :class="{ 'nge-holo-out': phase === 'form-out', 'nge-tagmode--drawing': drawingIn }"
      >
        <div class="nge-tagmode-head" @pointerdown.prevent="dragStart">
          <span class="nge-tagmode-title"><span class="nge-tagmode-pin" v-html="pinSvg"></span> SCOUT TAG MODE</span>
          <button class="nge-tagmode-close" title="Collapse to corner strip" @pointerdown.stop @click="setCollapsed(true)">▾</button>
          <button class="nge-tagmode-close" title="Exit tag mode (Esc)" @pointerdown.stop @click="emit('hide')">×</button>
        </div>
        <div class="nge-tagmode-hint">
          Pick a type, then <b>hold T and click</b> the spot (or arm <b>Place by click</b>) to set the point. <b>Submit</b> saves it.
        </div>
        <div class="nge-tagmode-chips">
          <button
            v-for="c in TAG_CHOICES" :key="c.key"
            class="nge-tagmode-chip"
            :class="{
              'nge-tagmode-chip--active': selected === c.key,
              'nge-tagmode-chip--cut': c.key === 'cut',
              'nge-tagmode-chip--ext': c.key === 'extend',
              'nge-tagmode-chip--other': c.key === 'other',
            }"
            :title="c.hint"
            @click="choose(c.key)"
          ><img v-if="c.key === 'cut'" :src="scytheIcon" class="nge-tagmode-chip-img" alt="" /><template v-else-if="c.key === 'extend'">🌿 </template>{{ c.key === 'cut' ? ' Cut' : c.label.replace(/^\S+\s/, '') }}</button>
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
          <div class="nge-tagmode-coords" :class="{ 'nge-tagmode-pos--pending': pendingPos }">
            <span class="nge-tagmode-coords-label">{{ pendingPos ? 'point' : 'coordinates' }}:</span>
            <span class="nge-tagmode-coords-vals"
              :title="pendingPos ? 'Placed point, Submit saves it (click again to move)' : 'Crosshair position'"
            ><b>({{ (pendingPos ?? crosshairPosition()).join(', ') }})</b>
              <button class="nge-tagmode-copy" title="Copy coordinates" @click="copyCoords">⧉</button>
            </span>
          </div>
          <div class="nge-tagmode-actions-row">
            <button
              class="nge-tagmode-arm"
              :class="{ 'nge-tagmode-arm--on': armedOnce }"
              @click="armOnce"
            >
              <template v-if="armedOnce">Click the spot…</template>
              <template v-else><span class="nge-tagmode-pin" v-html="pinSvg"></span> Click to tag</template>
            </button>
            <button ref="submitBtnEl" class="nge-tagmode-btn" :disabled="saving" :title="pendingPos ? 'Save the placed point' : 'Tag the crosshair position'" @click="submit">
              Submit
            </button>
          </div>
        </div>
        <div v-if="flash" class="nge-tagmode-flash">{{ flash }}</div>
      </div>

      <!-- Success box: click to play the cycle back to the form -->
      <div
        v-else
        class="nge-tagmode nge-tagmode--success"
        :class="{ 'nge-holo-out': phase === 'success-out', 'nge-tagmode--frameless': successFrameless }"
        :style="successSize"
        @click="dismissSuccess"
        title="Click to keep scouting"
      >
        <div class="nge-tagmode-success-glyph" v-html="pinSvgBig"></div>
        <div class="nge-tagmode-success-title">{{ lastTag?.label }} candidate tagged</div>
        <div class="nge-tagmode-success-pos">({{ lastTag?.pos.join(', ') }})</div>
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
/* Expanding from the slim strip: the pop-in materialize is suppressed and
   the beam acts as a mask, a clip-path driven from the draw's progress
   unrolls the finished box downward in step with the light. */
.nge-tagmode--drawing {
  animation: none;
}
/* Success box while the burst particles are still carrying its border. */
.nge-tagmode--frameless {
  border-color: transparent !important;
  box-shadow: none !important;
}
.nge-tagmode > * { transition: opacity 0.28s ease; }
.nge-tagmode { transition: border-color 0.3s ease, box-shadow 0.3s ease, background 0.3s ease; }
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
.nge-tagmode-pin { display: inline-flex; vertical-align: -2px; }
.nge-tagmode-pin svg { filter: drop-shadow(0 0 4px rgba(53, 181, 255, 0.55)); }

/* ── Collapsed corner strip ── */
.nge-tagmode-mini {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  /* Extra room on the right so the cursor has somewhere calm to land. */
  padding: 5px 14px 5px 7px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(4, 6, 14, 0.94) 0%, rgba(8, 12, 24, 0.92) 100%);
  border: 1px solid rgba(53, 181, 255, 0.35);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5), 0 0 12px rgba(53, 181, 255, 0.12);
  backdrop-filter: blur(8px);
}
.nge-tagmode-mini-grip {
  display: inline-flex;
  cursor: grab;
  padding: 2px 3px;
  font-size: 14px;
  user-select: none;
}
.nge-tagmode-mini-grip:active { cursor: grabbing; }
.nge-tagmode-mini-chip {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 10px;
  letter-spacing: 0.06em;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: #cfe3ff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.nge-tagmode-mini-chip--active {
  border-color: rgba(53, 181, 255, 0.8);
  background: rgba(53, 181, 255, 0.14);
  color: #fff;
  box-shadow: 0 0 8px rgba(53, 181, 255, 0.25);
}
.nge-tagmode-mini-act {
  font-size: 13px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: #cfe3ff;
  cursor: pointer;
}
.nge-tagmode-mini-act--on {
  border-color: rgba(53, 181, 255, 0.9);
  background: rgba(53, 181, 255, 0.2);
  animation: nge-arm-pulse 1.1s ease-in-out infinite;
}
.nge-tagmode-mini-close { color: #a8b6cf; }
.nge-tagmode-mini-close:hover { color: #fff; border-color: rgba(224, 96, 96, 0.5); background: rgba(224, 96, 96, 0.12); }
.nge-tagmode-mini-hand {
  display: inline-flex;
  margin-left: 2px;
  padding: 3px 4px;
  color: #8ea3c4;
  cursor: grab;
  user-select: none;
}
.nge-tagmode-mini-hand:hover { color: #cfe3ff; }
.nge-tagmode-mini-hand:active { cursor: grabbing; }
.nge-tagmode-mini-submit { color: #7dffb0; border-color: rgba(125, 255, 176, 0.35); }
.nge-tagmode-mini-submit:hover { background: rgba(125, 255, 176, 0.12); }
.nge-tagmode-mini-act:disabled { opacity: 0.5; cursor: default; }
.nge-tagmode-flash--mini {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  white-space: nowrap;
}
.nge-tagmode-pos--pending b { color: #35b5ff; }

/* "coordinates:" label with the values small on one line beneath. */
.nge-tagmode-coords { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.nge-tagmode-coords-label {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(160, 185, 220, 0.75);
}
.nge-tagmode-coords-vals {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  white-space: nowrap;
  color: #cfe0f5;
}
.nge-tagmode-coords-vals b { font-weight: 600; color: #e9c46a; }
.nge-tagmode-pos--pending .nge-tagmode-coords-vals b { color: #35b5ff; }
.nge-tagmode-copy {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 5px;
  color: #8ea3c4;
  font-size: 12px;
  line-height: 1;
  padding: 2px 5px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.nge-tagmode-copy:hover { color: #d8ecff; border-color: rgba(53, 181, 255, 0.5); }
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
/* Type colors match the light: blue Cut, green Extend, purple Other. */
.nge-tagmode-chip--cut { background: rgba(53, 181, 255, 0.08); border-color: rgba(53, 181, 255, 0.35); color: #9fd6ff; }
.nge-tagmode-chip--cut.nge-tagmode-chip--active { background: rgba(53, 181, 255, 0.2); border-color: rgba(53, 181, 255, 0.75); color: #d8efff; }
.nge-tagmode-chip--ext { background: rgba(96, 224, 128, 0.08); border-color: rgba(96, 224, 128, 0.32); color: #9fe8b0; }
.nge-tagmode-chip--ext.nge-tagmode-chip--active { background: rgba(96, 224, 128, 0.2); border-color: rgba(96, 224, 128, 0.7); color: #d9ffe3; }
.nge-tagmode-chip--other { background: rgba(200, 150, 255, 0.08); border-color: rgba(200, 150, 255, 0.32); color: #d9bdfa; }
.nge-tagmode-chip--other.nge-tagmode-chip--active { background: rgba(200, 150, 255, 0.2); border-color: rgba(200, 150, 255, 0.7); color: #f0e2ff; }
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
  white-space: nowrap;
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
/* The flash is a holo pill now, not a bare yellow string. */
.nge-tagmode-flash {
  align-self: center;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #cfe9ff;
  background: rgba(6, 12, 24, 0.9);
  border: 1px solid rgba(53, 181, 255, 0.45);
  border-radius: 999px;
  padding: 5px 14px;
  box-shadow: 0 0 14px rgba(53, 181, 255, 0.2), inset 0 0 10px rgba(53, 181, 255, 0.07);
  animation: nge-flash-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes nge-flash-in {
  0%   { opacity: 0; transform: translateY(4px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── Success box ── */
.nge-tagmode--success {
  align-items: center;
  /* Matches the form box's measured footprint (successSize), so include
     border and padding in that width or the right edge walks off. */
  box-sizing: border-box;
  justify-content: center;
  gap: 10px;
  padding: 20px 16px;
  cursor: pointer;
  border-color: rgba(96, 192, 96, 0.4);
}
.nge-tagmode-success-glyph { line-height: 1; filter: drop-shadow(0 0 8px rgba(53, 181, 255, 0.6)); }
.nge-tagmode-success-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #d9f5d9;
}
.nge-tagmode-success-pos { font-size: 11.5px; color: #ffb454; }
.nge-tagmode-success-hint { font-size: 10.5px; color: rgba(255, 255, 255, 0.45); margin-top: 4px; }

</style>
