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
import { GifWriter } from '../gif_writer';

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
/** The way the cell turns (Nseraf, report 246: "spin on the vertical axis
 *  too"): around the screen's up line, or over the top. */
const AXES = [
  { id: 'side', label: 'Left right', axis: [0, 1, 0] },
  { id: 'over', label: 'Over the top', axis: [1, 0, 0] },
] as const;
/** What a recording is saved as. MP4 plays everywhere (VLC, the forum);
 *  GIF is small and loops; WebM is only used when MP4 cannot be made. */
const FORMATS = [
  { id: 'mp4', label: 'MP4' },
  { id: 'gif', label: 'GIF' },
] as const;
/** Recordings keep the view's own pixels up to this width. */
const MAX_RECORD_WIDTH = 1920;
/** GIFs are smaller: this wide at most, and this many hundredths of a second a frame. */
const GIF_WIDTH = 640;
const GIF_DELAY_CS = 7;
const IDLE_MS = 2500;

const spinning = ref(true);
const speedId = ref<string>('medium');
const axisId = ref<string>('side');
/** Speed changes and fades take this many seconds (Nseraf: "speed up or
 *  slow down gradually", with a number for how long). 0 is at once. */
const changeSeconds = ref(2);
const formatId = ref<string>('mp4');
/** Cells fading: 'in', 'out', or null. */
const fading = ref<'in' | 'out' | null>(null);
const bgId = ref<string>('black');
const watermark = ref(true);
const idle = ref(false);
const recording = ref(false);
const recordProgress = ref(0);
const flash = ref(false);
const note = ref('');
/** Picking the point the spin turns around (Ames: "let them select a point
 *  and it rotates around that"). The 3D view always turns around the view's
 *  centre, so picking a point moves the centre there. */
const picking = ref(false);
const coordText = ref('');

const recordPercent = computed(() => Math.round(recordProgress.value * 100));
const changeSecs = () => Math.max(0, Math.min(60, Number(changeSeconds.value) || 0));

function viewer(): any { return (window as any)['viewer']; }

/** The cell layers on screen, the ones a fade works on. */
function cellLayers(): any[] {
  const v = viewer();
  return Array.from<any>(v?.layerManager?.managedLayers ?? [])
    .filter(ml => ml?.visible && ml?.layer?.displayState?.objectAlpha);
}

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
    position: Array.from(v.navigationState?.position?.value ?? []),
    orientation: Array.from(v.perspectiveNavigationState?.pose?.orientation?.orientation ?? []),
    alphas: cellLayers().map(ml => [ml, ml.layer.displayState.objectAlpha.value]),
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
  document.body.classList.remove('nge-photo-mode', 'nge-photo-picking');
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
    () => { for (const [ml, a] of s.alphas) ml.layer.displayState.objectAlpha.value = a; },
    () => { if (s.position.length) v.navigationState.position.value = Float32Array.from(s.position); },
    () => {
      if (s.orientation.length !== 4) return;
      const o = v.perspectiveNavigationState.pose.orientation;
      o.orientation.set(s.orientation);
      o.changed.dispatch();
    },
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

/* ── the point it turns around ── */
function setCentre(pos: ArrayLike<number>): boolean {
  try {
    const p = viewer().navigationState.position;
    const rank = p.value?.length ?? 0;
    if (!rank || pos.length < rank || Array.from(pos).some(n => !Number.isFinite(n))) return false;
    p.value = Float32Array.from(Array.from(pos).slice(0, rank));
    return true;
  } catch { return false; }
}
function startPicking() {
  picking.value = !picking.value;
  document.body.classList.toggle('nge-photo-picking', picking.value);
  if (picking.value) {
    try { coordText.value = Array.from<number>(viewer().navigationState.position.value).map(n => Math.round(n)).join(', '); } catch { /* no viewer */ }
  }
}
function stopPicking() {
  picking.value = false;
  document.body.classList.remove('nge-photo-picking');
}
function useTypedCoords() {
  const nums = coordText.value.split(/[\s,;]+/).filter(Boolean).map(Number);
  if (setCentre(nums)) { stopPicking(); say('Now turning around that point.'); }
  else say('Type three numbers, like 1200, 3400, 560.');
}
/** In picking, a click on a cell makes that spot the centre. */
function onPickClick(e: PointerEvent) {
  if (!picking.value || e.button !== 0) return;
  const t = e.target as HTMLElement | null;
  if (!t || !t.closest('#neuroglancer-container')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const m = viewer()?.mouseState;
  if (m?.active && m.position?.length && setCentre(m.position)) {
    stopPicking();
    say('Now turning around that point.');
  } else {
    say('Click on a cell, not on the background.');
  }
}

/* ── the turntable ── */
let raf = 0;
let last = 0;
let pointerDown = false;
/** How fast it turns now (radians a second), the speed it is heading for,
 *  and how quickly it gets there. */
let rate = 0;
let aim = -1;
let ramp = Infinity;

function turn(angle: number) {
  const a = AXES.find(x => x.id === axisId.value) ?? AXES[0];
  try { viewer().perspectiveNavigationState.pose.rotateRelative(Float32Array.from(a.axis), angle); } catch { /* no viewer */ }
}

function wantedRate(): number {
  if (!spinning.value) return 0;
  const sp = SPEEDS.find(s => s.id === speedId.value) ?? SPEEDS[1];
  return 2 * Math.PI / sp.turnSeconds;
}

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  stepFade(now);
  if (dt === 0) return;
  if (pointerDown) {
    // Dragging turns it by hand; the spin picks up again from still.
    rate = 0;
    aim = -1;
  } else {
    const want = wantedRate();
    if (want !== aim) {
      aim = want;
      const secs = changeSecs();
      ramp = secs > 0 ? Math.abs(want - rate) / secs : Infinity;
    }
    const step = ramp * dt;
    rate = Math.abs(want - rate) <= step ? want : rate + Math.sign(want - rate) * step;
  }
  // A recording ends on exactly one full turn.
  const angle = rec ? Math.min(rate * dt, 2 * Math.PI - rec.turned) : rate * dt;
  if (angle) turn(angle);
  if (recording.value) recordFrame(dt, angle);
}

/* ── cells fading in and out (Nseraf: "for videos of neurons fading in and
 *    out"). Every cell layer on screen fades together. ── */
let fade: { from: number; to: number; start: number; secs: number; layers: any[]; full: Map<any, number> } | null = null;

/** A layer's own see-through setting from before photo mode, as "fully in". */
function fullAlpha(ml: any): number {
  const kept = (saved?.alphas as [any, number][] | undefined)?.find(([m]) => m === ml)?.[1];
  return kept && kept > 0 ? kept : 1;
}

function startFade(dir: 'in' | 'out') {
  const layers = cellLayers();
  if (!layers.length) { say('There are no cells on screen to fade.'); return; }
  const full = new Map(layers.map(ml => [ml, fullAlpha(ml)]));
  const levels = layers.map(ml => ml.layer.displayState.objectAlpha.value / full.get(ml)!);
  const from = Math.max(0, Math.min(1, levels.reduce((a, b) => a + b, 0) / levels.length));
  fade = { from, to: dir === 'in' ? 1 : 0, start: performance.now(), secs: changeSecs(), layers, full };
  fading.value = dir;
  stepFade(performance.now());
}

function stepFade(now: number) {
  if (!fade) return;
  const t = fade.secs > 0 ? Math.min(1, (now - fade.start) / 1000 / fade.secs) : 1;
  const level = fade.from + (fade.to - fade.from) * t * t * (3 - 2 * t);
  for (const ml of fade.layers) {
    try { ml.layer.displayState.objectAlpha.value = level * fade.full.get(ml)!; } catch { /* layer gone */ }
  }
  if (t >= 1) { fade = null; fading.value = null; }
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
/** A recording follows the spin on screen, speed changes and fades included,
 *  until the cell has gone once all the way round. */
type Rec = {
  ctx: CanvasRenderingContext2D; rect: any; turned: number;
  video?: { recorder: MediaRecorder };
  gif?: { writer: GifWriter; since: number };
};
let rec: Rec | null = null;

function pickVideo(): { mime: string; ext: string } | null {
  const can = (m: string) => !!(window as any).MediaRecorder?.isTypeSupported?.(m);
  if (formatId.value === 'mp4') {
    for (const m of ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4']) {
      if (can(m)) return { mime: m, ext: 'mp4' };
    }
  }
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (can(m)) return { mime: m, ext: 'webm' };
  }
  return null;
}

function recordSpin() {
  if (recording.value) return;
  const gl: HTMLCanvasElement | undefined = viewer()?.display?.canvas;
  if (!gl || !gl.width) { say('The 3D view is not ready yet.'); return; }
  const gif = formatId.value === 'gif';
  const video = gif ? null : pickVideo();
  if (!gif && !video) { say('This browser cannot record video. Pyr needs Chrome.'); return; }
  const rect = viewRect(gl);
  // Thin branches are one pixel wide on screen. Shrinking the frame (it was
  // capped at 1280 wide) or starving the encoder broke them into dots or lost
  // them (Ames 2026-10-24, a whole class in Meet the cells). So: the view's own
  // size up to 1920 wide, smooth shrinking past that, and bits to match.
  const scale = Math.min(1, (gif ? GIF_WIDTH : MAX_RECORD_WIDTH) / rect.w);
  const out = document.createElement('canvas');
  out.width = Math.max(2, Math.round(rect.w * scale / 2) * 2);
  out.height = Math.max(2, Math.round(rect.h * scale / 2) * 2);
  const ctx = out.getContext('2d', { willReadFrequently: gif })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawInto(ctx, rect);
  const r: Rec = { ctx, rect, turned: 0 };
  if (gif) {
    r.gif = { writer: new GifWriter(out.width, out.height), since: 0 };
    r.gif.writer.addFrame(ctx.getImageData(0, 0, out.width, out.height).data, GIF_DELAY_CS);
  } else {
    const { mime, ext } = video!;
    const stream = out.captureStream(30);
    const bits = Math.max(8_000_000, Math.min(24_000_000, out.width * out.height * 10));
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bits });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      download(new Blob(chunks, { type: mime.split(';')[0] }), stampName(ext));
      say('Spin saved to your downloads.');
    };
    r.video = { recorder };
    recorder.start(250);
  }
  rec = r;
  // A still cell makes no spin: start it turning.
  spinning.value = true;
  recordProgress.value = 0;
  recording.value = true;
}

function recordFrame(dt: number, angle: number) {
  if (!rec) return;
  const full = 2 * Math.PI;
  rec.turned += Math.abs(angle);
  recordProgress.value = Math.min(1, rec.turned / full);
  if (rec.gif) {
    rec.gif.since += dt;
    if (rec.gif.since >= GIF_DELAY_CS / 100) {
      rec.gif.since -= GIF_DELAY_CS / 100;
      drawInto(rec.ctx, rec.rect);
      const c = rec.ctx.canvas;
      rec.gif.writer.addFrame(rec.ctx.getImageData(0, 0, c.width, c.height).data, GIF_DELAY_CS);
    }
  } else {
    drawInto(rec.ctx, rec.rect);
  }
  if (rec.turned >= full - 1e-6) stopRecording();
}

function stopRecording() {
  if (!rec) return;
  const r = rec;
  rec = null;
  recording.value = false;
  if (r.gif) {
    download(r.gif.writer.finish(), stampName('gif'));
    say('Spin saved to your downloads.');
    return;
  }
  // One more frame so the last angle is in the file.
  const recorder = r.video!.recorder;
  setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 120);
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
    if (picking.value) { stopPicking(); return; }
    emit('hide');
  } else if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    spinning.value = !spinning.value;
    wake();
  }
}
function onPointerDown(e: PointerEvent) {
  if (picking.value) { onPickClick(e); return; }
  pointerDown = true;
}
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
    <div class="nge-photo-bar" :class="{ idle: idle && !recording && !picking }" data-nge-capture-skip
         @mouseenter="wake" @pointerdown.stop>
      <span class="nge-photo-title">Photo mode</span>

      <button class="nge-photo-btn" :class="{ on: spinning }"
              :title="spinning ? 'Stop the spin (Space)' : 'Spin (Space)'" @click="spinning = !spinning">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4h-4"/>
        </svg>
        {{ spinning ? 'Spinning' : 'Spin' }}
      </button>

      <div class="nge-photo-group" title="Spin speed">
        <button v-for="s in SPEEDS" :key="s.id" class="nge-photo-chip" :class="{ on: speedId === s.id }"
                @click="speedId = s.id; spinning = true">{{ s.label }}</button>
      </div>

      <div class="nge-photo-group" title="Which way it turns">
        <button v-for="a in AXES" :key="a.id" class="nge-photo-chip" :class="{ on: axisId === a.id }"
                @click="axisId = a.id">{{ a.label }}</button>
      </div>

      <label class="nge-photo-check" title="How many seconds a speed change or a fade takes. 0 is at once.">
        Change over
        <input v-model.number="changeSeconds" class="nge-photo-secs" type="number" min="0" max="60" step="0.5"
               @keydown.stop /> s
      </label>

      <div class="nge-photo-group" title="Fade the cells in or out">
        <button class="nge-photo-chip" :class="{ on: fading === 'in' }" @click="startFade('in')">Fade in</button>
        <button class="nge-photo-chip" :class="{ on: fading === 'out' }" @click="startFade('out')">Fade out</button>
      </div>

      <div class="nge-photo-group" title="Background">
        <button v-for="b in BACKGROUNDS" :key="b.id" class="nge-photo-swatch" :class="{ on: bgId === b.id }"
                :title="b.label + ' background'" :aria-label="b.label + ' background'"
                :style="swatchStyle(b.rgb)"
                @click="setBackground(b.id)"></button>
      </div>

      <button class="nge-photo-btn" :class="{ on: picking }" :disabled="recording"
              title="Choose the point the spin turns around" @click="startPicking">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
        </svg>
        Pick centre
      </button>

      <label class="nge-photo-check" title="A small Pyr mark in the corner of pictures and recordings">
        <input type="checkbox" v-model="watermark" /> Pyr mark
      </label>

      <button class="nge-photo-btn primary" :disabled="recording" title="Save a picture of the 3D view" @click="savePicture">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8h3l2-2.5h8L18 8h3v11H3z"/><circle cx="12" cy="13.5" r="3.8"/>
        </svg>
        Save picture
      </button>

      <div class="nge-photo-group" title="MP4 plays almost anywhere. GIF is smaller and loops, good for the forum.">
        <button v-for="f in FORMATS" :key="f.id" class="nge-photo-chip" :class="{ on: formatId === f.id }"
                :disabled="recording" @click="formatId = f.id">{{ f.label }}</button>
      </div>

      <button class="nge-photo-btn primary" :class="{ rec: recording }"
              :title="recording ? 'Stop recording (Esc)' : 'Record one full turn, as it turns on screen'"
              @click="recording ? stopRecording() : recordSpin()">
        <span class="nge-photo-dot"></span>
        <template v-if="recording">Recording {{ recordPercent }}%</template>
        <template v-else>Record spin</template>
      </button>

      <button class="nge-photo-btn" title="Leave photo mode (Esc)" @click="emit('hide')">Exit</button>
    </div>
    <div v-if="picking" class="nge-photo-pick" data-nge-capture-skip @pointerdown.stop @keydown.stop>
      <span>Click a spot on a cell to turn around it, or type a point:</span>
      <input v-model="coordText" class="nge-photo-coords" placeholder="x, y, z" spellcheck="false"
             @keydown.enter.prevent="useTypedCoords" />
      <button class="nge-photo-btn primary" @click="useTypedCoords">Use point</button>
      <button class="nge-photo-btn" @click="stopPicking">Cancel</button>
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
.nge-photo-secs {
  width: 46px; padding: 3px 5px; border-radius: 7px; border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.35); color: #fff; font: 12px/1.2 Roboto, system-ui, sans-serif;
}
.nge-photo-note {
  position: fixed; left: 50%; bottom: 136px; transform: translateX(-50%);
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
body.nge-photo-picking #neuroglancer-container,
body.nge-photo-picking #neuroglancer-container * { cursor: crosshair !important; }
.nge-photo-pick {
  position: fixed; left: 0; right: 0; bottom: 84px; margin: 0 auto; width: max-content; max-width: calc(100vw - 32px);
  z-index: 2147483000; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center;
  padding: 8px 12px; border-radius: 12px; background: rgba(12, 18, 30, 0.88);
  border: 1px solid rgba(91, 227, 255, 0.35); color: #e8eef8; font: 13px Roboto, system-ui, sans-serif;
}
.nge-photo-coords {
  width: 170px; padding: 5px 8px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.35); color: #fff; font: 13px/1.2 ui-monospace, Consolas, monospace;
}
.nge-photo-flash {
  position: fixed; inset: 0; z-index: 2147483100; pointer-events: none;
  background: #fff; opacity: 0; transition: opacity 0.3s ease;
}
.nge-photo-flash.on { opacity: 0.55; transition: none; }
</style>
