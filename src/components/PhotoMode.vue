<script setup lang="ts">
/**
 * Photo mode (Ames 2026-10-20): one button hides the whole interface, shows
 * the 3D view on the full window and turns it slowly, like a cell on a
 * turntable. A small bar saves a clean picture or a one-turn recording.
 *
 * Every viewer setting it touches (layout, axis lines, scale bar, the 2D
 * slices in 3D, the default annotations, the background, the neuroglancer
 * controls) is written down on the way in and put back on the way out.
 *
 * WebGL throws its picture away after showing it, so a picture or a frame of
 * the recording is drawn and copied in the same breath (as page_capture.ts).
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits({ hide: null });

const BACKGROUNDS = [
  { id: 'black', label: 'Black', rgb: [0, 0, 0] },
  { id: 'night', label: 'Night', rgb: [0.02, 0.04, 0.1] },
  { id: 'grey', label: 'Grey', rgb: [0.16, 0.17, 0.2] },
  { id: 'white', label: 'White', rgb: [1, 1, 1] },
] as const;
const SPEEDS = [
  { id: 'slow', label: 'Slow', turnSeconds: 40 },
  { id: 'medium', label: 'Medium', turnSeconds: 20 },
  { id: 'fast', label: 'Fast', turnSeconds: 9 },
] as const;
/** One full turn of the recording takes this long. */
const RECORD_SECONDS = 6;
const IDLE_MS = 2500;

const spinning = ref(true);
const speedId = ref<string>('medium');
const bgId = ref<string>('black');
const watermark = ref(true);
const idle = ref(false);
const recording = ref(false);
const recordProgress = ref(0);
const flash = ref(false);
const note = ref('');

const recordPercent = computed(() => Math.round(recordProgress.value * 100));

function viewer(): any { return (window as any)['viewer']; }

/* ── setting up and putting back ── */
let saved: Record<string, any> | null = null;

function enter() {
  const v = viewer();
  if (!v) return;
  saved = {
    layout: v.layout?.toJSON?.(),
    axis: v.showAxisLines?.value,
    scaleBar: v.showScaleBar?.value,
    slices: v.showPerspectiveSliceViews?.value,
    annotations: v.showDefaultAnnotations?.value,
    controls: v.uiConfiguration?.showUIControls?.value,
    borders: v.uiConfiguration?.showPanelBorders?.value,
    bg: Array.from(v.perspectiveViewBackgroundColor?.value ?? [0, 0, 0]),
  };
  document.body.classList.add('nge-photo-mode');
  try {
    v.layout.restoreState('3d');
    v.showAxisLines.value = false;
    v.showScaleBar.value = false;
    v.showPerspectiveSliceViews.value = false;
    v.showDefaultAnnotations.value = false;
    v.uiConfiguration.showUIControls.value = false;
    v.uiConfiguration.showPanelBorders.value = false;
  } catch (e) {
    console.warn('[photo mode] could not set up the view:', e);
  }
  const bg = saved.bg as number[];
  const match = BACKGROUNDS.find(b => b.rgb.every((c, i) => Math.abs(c - bg[i]) < 0.01));
  bgId.value = match?.id ?? 'black';
  setBackground(bgId.value);
}

function leave() {
  document.body.classList.remove('nge-photo-mode');
  const v = viewer();
  if (!v || !saved) return;
  const s = saved;
  saved = null;
  const tries: Array<() => void> = [
    () => { if (s.layout !== undefined) v.layout.restoreState(s.layout); },
    () => { v.showAxisLines.value = s.axis; },
    () => { v.showScaleBar.value = s.scaleBar; },
    () => { v.showPerspectiveSliceViews.value = s.slices; },
    () => { v.showDefaultAnnotations.value = s.annotations; },
    () => { v.uiConfiguration.showUIControls.value = s.controls; },
    () => { v.uiConfiguration.showPanelBorders.value = s.borders; },
    () => { v.perspectiveViewBackgroundColor.value = Float32Array.from(s.bg); },
  ];
  for (const t of tries) { try { t(); } catch { /* put back what we can */ } }
}

function setBackground(id: string) {
  bgId.value = id;
  const b = BACKGROUNDS.find(x => x.id === id) ?? BACKGROUNDS[0];
  try { viewer().perspectiveViewBackgroundColor.value = Float32Array.from(b.rgb); } catch { /* no viewer */ }
}

function swatchStyle(rgb: readonly number[]) {
  return { background: `rgb(${rgb.map(c => Math.round(c * 255)).join(',')})` };
}

/* ── the turntable ── */
let raf = 0;
let last = 0;
let pointerDown = false;

function turn(angle: number) {
  try { viewer().perspectiveNavigationState.pose.rotateRelative(Float32Array.from([0, 1, 0]), angle); } catch { /* no viewer */ }
}

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (recording.value) { recordFrame(dt); return; }
  if (!spinning.value || pointerDown || dt === 0) return;
  const sp = SPEEDS.find(s => s.id === speedId.value) ?? SPEEDS[1];
  turn((2 * Math.PI / sp.turnSeconds) * dt);
}

/* ── pictures ── */

/** The part of the viewer's canvas the 3D view covers, in canvas pixels. */
function viewRect(gl: HTMLCanvasElement) {
  const v = viewer();
  const cr = gl.getBoundingClientRect();
  const sx = gl.width / (cr.width || 1);
  const sy = gl.height / (cr.height || 1);
  let best: DOMRect | null = null;
  for (const p of Array.from<any>(v?.display?.panels ?? [])) {
    const r: DOMRect | undefined = p?.element?.getBoundingClientRect?.();
    if (!r || r.width < 2 || r.height < 2) continue;
    if (!best || r.width * r.height > best.width * best.height) best = r;
  }
  if (!best) return { x: 0, y: 0, w: gl.width, h: gl.height };
  const x = Math.max(0, Math.round((best.left - cr.left) * sx));
  const y = Math.max(0, Math.round((best.top - cr.top) * sy));
  const w = Math.min(gl.width - x, Math.round(best.width * sx));
  const h = Math.min(gl.height - y, Math.round(best.height * sy));
  return { x, y, w, h };
}

/** Draw the viewer now and copy it into `ctx` (scaled to fill it). */
function drawInto(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }) {
  const v = viewer();
  const gl: HTMLCanvasElement | undefined = v?.display?.canvas;
  if (!gl) return;
  try { v.display.draw?.(); } catch { /* use whatever is there */ }
  ctx.drawImage(gl, rect.x, rect.y, rect.w, rect.h, 0, 0, ctx.canvas.width, ctx.canvas.height);
  if (watermark.value) stamp(ctx);
}

function stamp(ctx: CanvasRenderingContext2D) {
  const { width: w, height: h } = ctx.canvas;
  const size = Math.max(14, Math.round(Math.min(w, h) * 0.035));
  const light = bgId.value === 'white';
  ctx.save();
  ctx.font = `600 ${size}px Roboto, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.6)';
  ctx.fillText('Pyr', w - size * 0.8, h - size * 0.6);
  ctx.restore();
}

function stampName(ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `pyr-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function say(text: string) {
  note.value = text;
  setTimeout(() => { if (note.value === text) note.value = ''; }, 3000);
}

function savePicture() {
  const gl: HTMLCanvasElement | undefined = viewer()?.display?.canvas;
  if (!gl || !gl.width) { say('The 3D view is not ready yet.'); return; }
  const rect = viewRect(gl);
  const out = document.createElement('canvas');
  out.width = rect.w;
  out.height = rect.h;
  drawInto(out.getContext('2d')!, rect);
  out.toBlob(blob => {
    if (!blob) { say('That picture could not be saved.'); return; }
    download(blob, stampName('png'));
    flash.value = true;
    setTimeout(() => { flash.value = false; }, 350);
    say('Picture saved to your downloads.');
  }, 'image/png');
}

/* ── one-turn recording ── */
let rec: { recorder: MediaRecorder; ctx: CanvasRenderingContext2D; rect: any; turned: number; chunks: Blob[] } | null = null;

function pickMime(): string {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if ((window as any).MediaRecorder?.isTypeSupported?.(m)) return m;
  }
  return '';
}

function recordSpin() {
  if (recording.value) return;
  const gl: HTMLCanvasElement | undefined = viewer()?.display?.canvas;
  if (!gl || !gl.width) { say('The 3D view is not ready yet.'); return; }
  const mime = pickMime();
  if (!mime) { say('This browser cannot record video. Pyr needs Chrome.'); return; }
  const rect = viewRect(gl);
  // Keep files a sensible size: at most 1280 pixels wide, even sizes for the encoder.
  const scale = Math.min(1, 1280 / rect.w);
  const out = document.createElement('canvas');
  out.width = Math.max(2, Math.round(rect.w * scale / 2) * 2);
  out.height = Math.max(2, Math.round(rect.h * scale / 2) * 2);
  const ctx = out.getContext('2d')!;
  drawInto(ctx, rect);
  const stream = out.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    download(new Blob(chunks, { type: 'video/webm' }), stampName('webm'));
    say('Spin saved to your downloads.');
  };
  rec = { recorder, ctx, rect, turned: 0, chunks };
  recordProgress.value = 0;
  recording.value = true;
  recorder.start(250);
}

function recordFrame(dt: number) {
  if (!rec || dt === 0) return;
  const full = 2 * Math.PI;
  const step = Math.min(full - rec.turned, (full / RECORD_SECONDS) * dt);
  turn(step);
  rec.turned += step;
  drawInto(rec.ctx, rec.rect);
  recordProgress.value = rec.turned / full;
  if (rec.turned >= full - 1e-6) stopRecording();
}

function stopRecording() {
  if (!rec) return;
  const r = rec;
  rec = null;
  recording.value = false;
  // One more frame so the last angle is in the file.
  setTimeout(() => { if (r.recorder.state !== 'inactive') r.recorder.stop(); }, 120);
}

/* ── the bar fades when the mouse rests ── */
let idleTimer: ReturnType<typeof setTimeout> | null = null;
function wake() {
  idle.value = false;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { idle.value = true; }, IDLE_MS);
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (recording.value) { stopRecording(); return; }
    emit('hide');
  } else if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    spinning.value = !spinning.value;
    wake();
  }
}
function onPointerDown() { pointerDown = true; }
function onPointerUp() { pointerDown = false; }

onMounted(() => {
  enter();
  wake();
  raf = requestAnimationFrame(frame);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('mousemove', wake, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('blur', onPointerUp);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  if (rec) stopRecording();
  if (idleTimer) clearTimeout(idleTimer);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('mousemove', wake, true);
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('pointerup', onPointerUp, true);
  window.removeEventListener('blur', onPointerUp);
  leave();
});
</script>

<template>
  <teleport to="body">
    <div class="nge-photo-flash" :class="{ on: flash }" data-nge-capture-skip></div>
    <div class="nge-photo-bar" :class="{ idle: idle && !recording }" data-nge-capture-skip
         @mouseenter="wake" @pointerdown.stop>
      <span class="nge-photo-title">Photo mode</span>

      <button class="nge-photo-btn" :class="{ on: spinning }" :disabled="recording"
              :title="spinning ? 'Stop the spin (Space)' : 'Spin (Space)'" @click="spinning = !spinning">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4h-4"/>
        </svg>
        {{ spinning ? 'Spinning' : 'Spin' }}
      </button>

      <div class="nge-photo-group" title="Spin speed">
        <button v-for="s in SPEEDS" :key="s.id" class="nge-photo-chip" :class="{ on: speedId === s.id }"
                :disabled="recording" @click="speedId = s.id; spinning = true">{{ s.label }}</button>
      </div>

      <div class="nge-photo-group" title="Background">
        <button v-for="b in BACKGROUNDS" :key="b.id" class="nge-photo-swatch" :class="{ on: bgId === b.id }"
                :title="b.label + ' background'" :aria-label="b.label + ' background'"
                :style="swatchStyle(b.rgb)"
                @click="setBackground(b.id)"></button>
      </div>

      <label class="nge-photo-check" title="A small Pyr mark in the corner of pictures and recordings">
        <input type="checkbox" v-model="watermark" /> Pyr mark
      </label>

      <button class="nge-photo-btn primary" :disabled="recording" title="Save a picture of the 3D view" @click="savePicture">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8h3l2-2.5h8L18 8h3v11H3z"/><circle cx="12" cy="13.5" r="3.8"/>
        </svg>
        Save picture
      </button>

      <button class="nge-photo-btn primary" :class="{ rec: recording }"
              :title="recording ? 'Stop recording (Esc)' : 'Record one full turn as a video'"
              @click="recording ? stopRecording() : recordSpin()">
        <span class="nge-photo-dot"></span>
        <template v-if="recording">Recording {{ recordPercent }}%</template>
        <template v-else>Record spin</template>
      </button>

      <button class="nge-photo-btn" title="Leave photo mode (Esc)" @click="emit('hide')">Exit</button>
    </div>
    <div v-if="note" class="nge-photo-note" data-nge-capture-skip>{{ note }}</div>
    <div class="nge-photo-hint" :class="{ idle }" data-nge-capture-skip>Drag to turn the cell yourself. Esc to leave.</div>
  </teleport>
</template>

<style>
/* The 3D view takes the whole window, above everything else in Pyr. */
body.nge-photo-mode #neuroglancer-container {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  z-index: 2147482000 !important;
  margin: 0 !important;
}
body.nge-photo-mode #neuroglancer-container .neuroglancer-side-panel,
body.nge-photo-mode #neuroglancer-container .neuroglancer-side-panel-drop-zone,
body.nge-photo-mode #neuroglancer-container .neuroglancer-side-panel-column,
body.nge-photo-mode #neuroglancer-container .neuroglancer-display-dimensions-widget,
body.nge-photo-mode #neuroglancer-container .neuroglancer-data-panel-layout-controls,
body.nge-photo-mode #neuroglancer-container .neuroglancer-viewer-top-row,
body.nge-photo-mode #neuroglancer-container .neuroglancer-layer-panel {
  display: none !important;
}
body.nge-photo-mode { cursor: default; }

.nge-photo-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 22px;
  margin: 0 auto;
  width: max-content;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 14px;
  background: rgba(12, 18, 30, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  color: #e8eef8;
  font: 13px/1.2 Roboto, system-ui, sans-serif;
  transition: opacity 0.5s ease, transform 0.5s ease;
  white-space: nowrap;
  max-width: calc(100vw - 32px);
  flex-wrap: wrap;
  justify-content: center;
}
.nge-photo-bar.idle { opacity: 0; transform: translateY(10px); }
.nge-photo-bar.idle:hover { opacity: 1; transform: none; }
.nge-photo-title { font-weight: 600; letter-spacing: 0.02em; color: #9fdcff; margin-right: 2px; }
.nge-photo-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: inherit; font: inherit; cursor: pointer;
}
.nge-photo-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
.nge-photo-btn:disabled { opacity: 0.45; cursor: default; }
.nge-photo-btn.on { border-color: rgba(91, 227, 255, 0.6); color: #5be3ff; }
.nge-photo-btn.primary { background: rgba(53, 181, 255, 0.2); border-color: rgba(53, 181, 255, 0.45); }
.nge-photo-btn.primary:hover:not(:disabled) { background: rgba(53, 181, 255, 0.34); }
.nge-photo-btn.rec { background: rgba(255, 70, 90, 0.25); border-color: rgba(255, 90, 110, 0.6); }
.nge-photo-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5468; }
.nge-photo-btn.rec .nge-photo-dot { animation: nge-photo-blink 1s infinite; }
@keyframes nge-photo-blink { 50% { opacity: 0.25; } }
.nge-photo-group { display: inline-flex; gap: 4px; align-items: center; }
.nge-photo-chip {
  padding: 4px 8px; border-radius: 7px; border: 1px solid transparent;
  background: transparent; color: #b8c4d6; font: inherit; font-size: 12px; cursor: pointer;
}
.nge-photo-chip:hover:not(:disabled) { color: #fff; background: rgba(255, 255, 255, 0.08); }
.nge-photo-chip.on { color: #fff; border-color: rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.1); }
.nge-photo-swatch {
  width: 18px; height: 18px; border-radius: 50%; padding: 0; cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.25);
}
.nge-photo-swatch.on { border-color: #5be3ff; box-shadow: 0 0 0 2px rgba(91, 227, 255, 0.3); }
.nge-photo-check { display: inline-flex; align-items: center; gap: 5px; color: #b8c4d6; cursor: pointer; font-size: 12px; }
.nge-photo-note {
  position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%);
  z-index: 2147483000; padding: 7px 14px; border-radius: 10px;
  background: rgba(12, 18, 30, 0.85); color: #e8eef8; font: 13px Roboto, system-ui, sans-serif;
}
.nge-photo-hint {
  position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
  z-index: 2147483000; color: rgba(232, 238, 248, 0.7);
  font: 12px Roboto, system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  transition: opacity 0.6s ease; pointer-events: none;
}
.nge-photo-hint.idle { opacity: 0; }
.nge-photo-flash {
  position: fixed; inset: 0; z-index: 2147483100; pointer-events: none;
  background: #fff; opacity: 0; transition: opacity 0.3s ease;
}
.nge-photo-flash.on { opacity: 0.55; transition: none; }
</style>
