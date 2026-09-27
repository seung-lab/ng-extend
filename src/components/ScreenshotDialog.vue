<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';

const props = withDefaults(defineProps<{
  show: boolean;
  /** 'download' (default) saves to disk; 'attach' uploads to Firebase Storage
   *  and emits the public URL via the `attached` event. */
  mode?: 'download' | 'attach';
}>(), { mode: 'download' });
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'attached', payload: { url: string }): void;
}>();

/** Cloud Function that mints short-lived signed PUT URLs for screenshot
 *  uploads. Implementation lives at ytho-4bff2 (see firebase-screenshot-
 *  upload-draft.md). Update this endpoint after deploying. */
// NOTE: the signScreenshotUpload Cloud Function is no longer used. It minted a
// v4 signed upload URL, which needs the runtime service account to sign via the
// IAM signBlob API — a permission it never had, so it returned 500 on every
// request. Uploads now go directly to Supabase Storage (see uploadBlob).

// The preview is sized to fill the stage (the area under the pen toolbar) at
// the OUTPUT aspect, so what you see is the frame you will get. Its backing
// store is the CSS size times devicePixelRatio (capped at 2) so the image and
// the pen marks stay sharp at the larger size.
const MAX_DPR = 2;
const STAGE_PAD = 22;   // room around the frame for the corner brackets

const PRESETS = [
  { label: '720p', w: 1280, h: 720 },
  { label: '1080p', w: 1920, h: 1080 },
  { label: '1440p', w: 2560, h: 1440 },
  { label: '4K', w: 3840, h: 2160 },
];

const width = ref(1920);
const height = ref(1080);
const transparent = ref(false);
const hideBoundingBox = ref(false);
const showScaleBar = ref(true);
const busy = ref(false);
const errorMsg = ref('');

// Captured source frame (with toggles applied) — kept in 2D canvas form,
// alongside the per-source-pixel physical size in nanometers (computed at
// capture time so preview and download draw identical scale bars).
type SourceFrame = { canvas: HTMLCanvasElement; sw: number; sh: number; nmPerPx: number | null };
const sourceRef = ref<SourceFrame | null>(null);
// Image rect within the preview canvas after letterboxing, in BACKING pixels
// of the preview canvas (not CSS pixels).
const imgRect = ref({ x: 0, y: 0, w: 1, h: 1 });

const previewEl = ref<HTMLCanvasElement | null>(null);
const markupEl = ref<HTMLCanvasElement | null>(null);
const stageEl = ref<HTMLDivElement | null>(null);
// CSS size of the preview frame, fitted into the stage at the output aspect.
const frameCss = ref({ w: 0, h: 0 });

// Pen state. Strokes store points in 0..1 range relative to imgRect, and
// the stroke width as a fraction of the image height, so they survive a
// dialog resize and render at the same relative weight at any output
// resolution (the preview is WYSIWYG for the downloaded PNG).
type Stroke = { color: string; size: number; points: { u: number; v: number }[] };
const strokes = ref<Stroke[]>([]);
const PEN_COLORS = ['#ff4d4d', '#ffd24d', '#5be3ff', '#ffffff'];
const penColor = ref(PEN_COLORS[0]);
const penSize = ref(3);
let drawing = false;

function close() {
  if (busy.value) return;
  errorMsg.value = '';
  emit('close');
}

function preset(w: number, h: number) {
  width.value = w;
  height.value = h;
}
function isPreset(w: number, h: number) {
  return width.value === w && height.value === h;
}

function previewDpr() {
  return Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
}

/** Aspect of the requested output, falling back to 16:9 while the width or
 *  height field is empty or invalid mid edit. */
function outputAspect(): number {
  const w = Number(width.value);
  const h = Number(height.value);
  if (w > 0 && h > 0 && isFinite(w / h)) return clamp(w / h, 0.1, 10);
  return 16 / 9;
}

/** Fit the preview frame into the stage at the output aspect. Returns true
 *  when the frame size changed (the canvases then need a redraw). */
function layoutFrame(): boolean {
  const st = stageEl.value;
  if (!st) return false;
  const availW = Math.max(0, st.clientWidth - STAGE_PAD * 2);
  const availH = Math.max(0, st.clientHeight - STAGE_PAD * 2);
  const aspect = outputAspect();
  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }
  const next = { w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) };
  const prev = frameCss.value;
  if (prev.w === next.w && prev.h === next.h) return false;
  frameCss.value = next;
  return true;
}

let relayoutRaf = 0;
function scheduleRelayout() {
  if (relayoutRaf) return;
  relayoutRaf = requestAnimationFrame(() => {
    relayoutRaf = 0;
    if (!props.show) return;
    if (layoutFrame()) renderPreview();
  });
}

/** Read viewer's current zoom-per-pixel and convert to nanometers per source
 *  canvas pixel. Mirrors what neuroglancer's perspective_view/panel.ts does:
 *  physicalSizePerPixel = zoomFactor / canvasHeight (in canonical base units,
 *  meters), so multiply by 1e9 to land in nm. Falls back to the slice-view
 *  navigation state for layouts without a perspective panel. */
function computeNmPerPx(viewer: any, sh: number): number | null {
  if (!sh) return null;
  const persp = viewer?.perspectiveNavigationState ?? viewer?.navigationState;
  const zoom = persp?.zoomFactor?.value;
  if (typeof zoom !== 'number' || !isFinite(zoom) || zoom <= 0) return null;
  return (zoom / sh) * 1e9;
}

/** Capture a 2D canvas of the viewer's WebGL output with the given toggles
 *  applied. Restores viewer state synchronously after capturing — the user
 *  may see one frame of the override state before the next paint, which is
 *  acceptable because the dialog overlay covers most of the viewport. */
function captureSource(opts: { hideBoundingBox: boolean; showScaleBar: boolean }):
    SourceFrame | null {
  const viewer: any = (window as any)['viewer'];
  const sourceCanvas: HTMLCanvasElement | undefined = viewer?.display?.canvas;
  if (!sourceCanvas) return null;
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  if (!sw || !sh) return null;

  const prevDefAnn = viewer.showDefaultAnnotations?.value;
  const prevScale = viewer.showScaleBar?.value;
  let touchedDefAnn = false;
  let touchedScale = false;

  try {
    if (opts.hideBoundingBox && prevDefAnn !== false) {
      viewer.showDefaultAnnotations.value = false;
      touchedDefAnn = true;
    }
    // We draw a custom overlay regardless, but flip ng's native flag too so
    // slice-view layouts honor "off" (otherwise ng would still render a
    // native bar inside slice panels).
    if (typeof prevScale === 'boolean' && opts.showScaleBar !== prevScale) {
      viewer.showScaleBar.value = opts.showScaleBar;
      touchedScale = true;
    }

    if (typeof viewer.display.draw === 'function') {
      viewer.display.draw();
    }
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(sourceCanvas, 0, 0);
    return { canvas: out, sw, sh, nmPerPx: computeNmPerPx(viewer, sh) };
  } catch (e) {
    console.error('captureSource failed:', e);
    return null;
  } finally {
    if (touchedDefAnn) viewer.showDefaultAnnotations.value = prevDefAnn;
    if (touchedScale) viewer.showScaleBar.value = prevScale;
    if (typeof viewer.display.scheduleRedraw === 'function') {
      viewer.display.scheduleRedraw();
    }
  }
}

/** Pick a "nice" round physical length close to a target, using the same
 *  significand set neuroglancer's own scale bar uses. */
const ALLOWED_SIGNIFICANDS = [1, 1.5, 2, 3, 5, 7.5, 10];
function pickNicePhysicalLength(targetNm: number): number {
  if (targetNm <= 0 || !isFinite(targetNm)) return 1;
  const exponent = Math.floor(Math.log10(targetNm));
  const ten = 10 ** exponent;
  const targetSig = targetNm / ten;
  let bestSig = 1;
  for (const sig of ALLOWED_SIGNIFICANDS) {
    if (Math.abs(sig - targetSig) < Math.abs(bestSig - targetSig)) bestSig = sig;
  }
  return bestSig * ten;
}

function formatPhysicalLabel(nm: number): string {
  if (nm >= 1e9) return `${stripTrailingZero(nm / 1e9)} m`;
  if (nm >= 1e6) return `${stripTrailingZero(nm / 1e6)} mm`;
  if (nm >= 1e3) return `${stripTrailingZero(nm / 1e3)} µm`;
  if (nm >= 1) return `${stripTrailingZero(nm)} nm`;
  return `${stripTrailingZero(nm * 1e3)} pm`;
}
function stripTrailingZero(n: number): string {
  return Number(n.toFixed(3)).toString();
}

/** Draw a scale bar at the bottom-right of the given image rect in `ctx`.
 *  Sizes scale with rect.h so it stays readable from preview through 4K. */
function drawScaleBarOverlay(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    nmPerSourcePx: number,
    sourceH: number) {
  const s = rect.h / sourceH;                // source-px → target-px
  const fontSize = clamp(Math.round(rect.h * 0.024), 11, 56);
  const barH     = clamp(Math.round(rect.h * 0.005), 2, 12);
  const margin   = clamp(Math.round(rect.h * 0.024), 8, 56);
  const innerPad = Math.max(6, Math.round(fontSize * 0.45));

  const targetTargetPx = rect.w * 0.18;
  const targetSourcePx = targetTargetPx / s;
  const targetNm = targetSourcePx * nmPerSourcePx;
  if (!(targetNm > 0) || !isFinite(targetNm)) return;

  const chosenNm = pickNicePhysicalLength(targetNm);
  const barTargetPx = (chosenNm / nmPerSourcePx) * s;
  const label = formatPhysicalLabel(chosenNm);

  ctx.save();
  ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const tw = ctx.measureText(label).width;
  const blockW = Math.max(barTargetPx, tw) + innerPad * 2;
  const blockH = fontSize + barH + innerPad * 1.6;
  const blockX = rect.x + rect.w - margin - blockW;
  const blockY = rect.y + rect.h - margin - blockH;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(blockX, blockY, blockW, blockH);

  const barX = blockX + (blockW - barTargetPx) / 2;
  const barY = blockY + blockH - innerPad - barH;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(barX, barY, barTargetPx, barH);
  ctx.fillText(label, blockX + blockW / 2, barY - Math.round(fontSize * 0.3));

  ctx.restore();
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/** Render the captured source onto the preview canvas, letterboxed.
 *  Updates imgRect so markup coordinates can be mapped correctly. */
function renderPreview() {
  const cv = previewEl.value;
  if (!cv) return;
  const dpr = previewDpr();
  const PW = Math.max(1, Math.round(frameCss.value.w * dpr));
  const PH = Math.max(1, Math.round(frameCss.value.h * dpr));
  // Assigning width/height always clears the canvas, which is fine: the whole
  // frame is redrawn below.
  cv.width = PW;
  cv.height = PH;
  const ctx = cv.getContext('2d')!;

  if (transparent.value) {
    drawCheckerboard(ctx, PW, PH, Math.round(12 * dpr));
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, PW, PH);
  }

  const src = sourceRef.value;
  if (!src) {
    imgRect.value = { x: 0, y: 0, w: PW, h: PH };
    renderMarkup();
    return;
  }

  const { sw, sh, canvas: srcCanvas } = src;
  const sourceAspect = sw / sh;
  const targetAspect = PW / PH;
  let dw = PW, dh = PH, dx = 0, dy = 0;
  if (sourceAspect > targetAspect) {
    dh = Math.round(PW / sourceAspect);
    dy = Math.round((PH - dh) / 2);
  } else {
    dw = Math.round(PH * sourceAspect);
    dx = Math.round((PW - dw) / 2);
  }
  imgRect.value = { x: dx, y: dy, w: dw, h: dh };

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, dx, dy, dw, dh);

  if (transparent.value) {
    try {
      const img = ctx.getImageData(dx, dy, dw, dh);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 8 && d[i + 1] < 8 && d[i + 2] < 8) d[i + 3] = 0;
      }
      ctx.putImageData(img, dx, dy);
    } catch (e) {
      console.warn('Preview transparency pass failed:', e);
    }
  }

  if (showScaleBar.value && src.nmPerPx) {
    drawScaleBarOverlay(ctx, imgRect.value, src.nmPerPx, sh);
  }

  renderMarkup();
}

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number, tile = 12) {
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      const dark = ((x / tile) + (y / tile)) % 2 === 0;
      ctx.fillStyle = dark ? '#2a2f3a' : '#3a414f';
      ctx.fillRect(x, y, tile, tile);
    }
  }
}

/** Render strokes onto a target context, given the image rect on that
 *  target. Stroke points are in 0..1 of the image rect and stroke size is a
 *  fraction of the image height, so the same call serves the preview and
 *  the full resolution output. */
function renderStrokes(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes.value) {
    if (s.points.length === 0) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, s.size * rect.h);
    if (s.points.length === 1) {
      const p = s.points[0];
      const x = rect.x + p.u * rect.w;
      const y = rect.y + p.v * rect.h;
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      const x = rect.x + p.u * rect.w;
      const y = rect.y + p.v * rect.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function renderMarkup() {
  const cv = markupEl.value;
  if (!cv) return;
  // The markup layer shares the preview's backing size, so imgRect (in
  // preview backing pixels) applies to it unchanged.
  const pv = previewEl.value;
  const W = pv ? pv.width : cv.width;
  const H = pv ? pv.height : cv.height;
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  renderStrokes(ctx, imgRect.value);
}

/** Map a pointer event to 0..1 image coordinates. The pointer is converted
 *  from CSS pixels to the canvas's own backing pixels using the element's
 *  on screen box, so it is correct at any preview size and any DPR. */
function pointerToImgUV(e: PointerEvent): { u: number; v: number } | null {
  const cv = markupEl.value;
  if (!cv) return null;
  const rect = cv.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = ((e.clientX - rect.left) / rect.width) * cv.width;
  const y = ((e.clientY - rect.top) / rect.height) * cv.height;
  const r = imgRect.value;
  if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return null;
  return { u: (x - r.x) / r.w, v: (y - r.y) / r.h };
}

function onPointerDown(e: PointerEvent) {
  const uv = pointerToImgUV(e);
  if (!uv) return;
  drawing = true;
  (e.target as Element).setPointerCapture?.(e.pointerId);
  // penSize is in CSS pixels on screen; store it as a fraction of the image
  // height (imgRect.h is in backing pixels, hence the DPR factor).
  const imgCssH = imgRect.value.h / previewDpr();
  const sizeFrac = penSize.value / Math.max(1, imgCssH);
  strokes.value.push({ color: penColor.value, size: sizeFrac, points: [uv] });
  renderMarkup();
}
function onPointerMove(e: PointerEvent) {
  if (!drawing) return;
  const uv = pointerToImgUV(e);
  if (!uv) return;
  const cur = strokes.value[strokes.value.length - 1];
  if (!cur) return;
  cur.points.push(uv);
  renderMarkup();
}
function onPointerUp(e: PointerEvent) {
  drawing = false;
  (e.target as Element).releasePointerCapture?.(e.pointerId);
}

function undo() {
  strokes.value.pop();
  renderMarkup();
}
function clearMarkup() {
  strokes.value = [];
  renderMarkup();
}

async function refreshSource() {
  errorMsg.value = '';
  const cap = captureSource({
    hideBoundingBox: hideBoundingBox.value,
    showScaleBar: showScaleBar.value,
  });
  if (!cap) {
    errorMsg.value = 'Viewer not ready. Try again in a moment.';
    sourceRef.value = null;
  } else {
    sourceRef.value = cap;
  }
  await nextTick();
  renderPreview();
}

watch(() => props.show, async (open) => {
  if (open) {
    await nextTick();
    const viewer: any = (window as any)['viewer'];
    if (typeof viewer?.showScaleBar?.value === 'boolean') {
      showScaleBar.value = viewer.showScaleBar.value;
    }
    hideBoundingBox.value = false;
    transparent.value = false;
    strokes.value = [];
    layoutFrame();
    await refreshSource();
  }
});

watch([hideBoundingBox], () => {
  if (props.show) refreshSource();
});
// Scale bar toggle is post-process, so no need to recapture, just redraw.
watch([showScaleBar, transparent], () => {
  if (props.show) renderPreview();
});
// The preview frame follows the output aspect.
watch([width, height], () => {
  if (props.show) scheduleRelayout();
});

// Refit the frame whenever the stage changes size (window resize, sidebar
// wrapping). The stage only exists while the dialog is open.
watch(stageEl, (el, _prev, onCleanup) => {
  if (!el || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => scheduleRelayout());
  ro.observe(el);
  onCleanup(() => ro.disconnect());
});

onBeforeUnmount(() => {
  drawing = false;
  if (relayoutRaf) cancelAnimationFrame(relayoutRaf);
  relayoutRaf = 0;
});

/** Upload a PNG blob to Supabase Storage. Returns its public URL. */
async function uploadBlob(blob: Blob): Promise<string> {
  // Upload straight to Supabase Storage.
  //
  // This used to POST to the signScreenshotUpload Cloud Function for a v4
  // signed URL and then PUT the blob to it. Signing requires the function's
  // runtime service account to call the IAM signBlob API, a permission it was
  // never granted, so every attach failed with "Sign URL failed (500)".
  // Supabase Storage needs no signing round trip, no extra IAM and no Cloud
  // Function — the bucket and policies already exist for admin uploads.
  const { useProofreadingBackendStore: useBackend } = await import('../store');
  return await useBackend().uploadHelpScreenshot(blob);
}

async function download() {
  errorMsg.value = '';
  const w = Math.max(16, Math.min(8192, Math.floor(width.value || 0)));
  const h = Math.max(16, Math.min(8192, Math.floor(height.value || 0)));
  if (!w || !h) {
    errorMsg.value = 'Width and height must be positive integers (max 8192).';
    return;
  }

  busy.value = true;
  try {
    const cap = captureSource({
      hideBoundingBox: hideBoundingBox.value,
      showScaleBar: showScaleBar.value,
    });
    if (!cap) throw new Error('Viewer not ready.');

    const { sw, sh, canvas: src, nmPerPx } = cap;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d')!;

    const sourceAspect = sw / sh;
    const targetAspect = w / h;
    let dw = w, dh = h, dx = 0, dy = 0;
    if (sourceAspect > targetAspect) {
      dh = Math.round(w / sourceAspect);
      dy = Math.round((h - dh) / 2);
    } else {
      dw = Math.round(h * sourceAspect);
      dx = Math.round((w - dw) / 2);
    }

    if (transparent.value) {
      ctx.clearRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, dx, dy, dw, dh);

    if (transparent.value) {
      try {
        const img = ctx.getImageData(dx, dy, dw, dh);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 8 && d[i + 1] < 8 && d[i + 2] < 8) d[i + 3] = 0;
        }
        ctx.putImageData(img, dx, dy);
      } catch (e) {
        console.warn('Transparency pass skipped:', e);
      }
    }

    const outRect = { x: dx, y: dy, w: dw, h: dh };
    if (showScaleBar.value && nmPerPx) {
      drawScaleBarOverlay(ctx, outRect, nmPerPx, sh);
    }

    // Markup at full output resolution. Points are 0..1 of the image rect and
    // sizes are a fraction of image height, so outRect alone places them.
    renderStrokes(ctx, outRect);

    const blob: Blob = await new Promise((resolve, reject) => {
      off.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
    });

    if (props.mode === 'attach') {
      const publicUrl = await uploadBlob(blob);
      emit('attached', { url: publicUrl });
      emit('close');
      return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eyewire-${ts}-${w}x${h}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    emit('close');
  } catch (e: any) {
    errorMsg.value = e?.message || 'Screenshot failed.';
    console.error('Screenshot error:', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="show" class="nge-shotdlg-overlay" @click.self="close">
    <div class="nge-shotdlg" role="dialog"
         :aria-label="props.mode === 'attach' ? 'Attach screenshot' : 'Save screenshot'">
      <div class="nge-shotdlg-header">
        <span class="material-symbols-outlined nge-shotdlg-ico">photo_camera</span>
        <span class="nge-shotdlg-title">{{ props.mode === 'attach' ? 'Attach screenshot' : 'Save screenshot' }}</span>
        <button class="nge-shotdlg-close" @click="close" aria-label="Close">×</button>
      </div>

      <div class="nge-shotdlg-main">
        <!-- Pen tools: a HUD strip across the top of the image. -->
        <div class="nge-shotdlg-toolbar" role="toolbar" aria-label="Pen tools">
          <span class="nge-shotdlg-tlabel">Pen</span>
          <div class="nge-shotdlg-swatches">
            <button v-for="c in PEN_COLORS" :key="c"
                    class="nge-shotdlg-swatch"
                    :class="{ 'is-active': penColor === c }"
                    :style="{ '--sw': c }"
                    @click="penColor = c"
                    :title="c"
                    :aria-label="`Pen color ${c}`"
                    :aria-pressed="penColor === c" />
          </div>

          <span class="nge-shotdlg-sep" aria-hidden="true" />

          <span class="nge-shotdlg-tlabel">Size</span>
          <input type="range" min="1" max="12" step="1" v-model.number="penSize"
                 class="nge-shotdlg-pen-size" :title="`Brush size: ${penSize}px`"
                 aria-label="Brush size" />
          <span class="nge-shotdlg-readout nge-shotdlg-readout-size">{{ penSize }}<span class="nge-shotdlg-unit">px</span></span>

          <span class="nge-shotdlg-sep" aria-hidden="true" />

          <button class="nge-shotdlg-tool" @click="undo" :disabled="!strokes.length"
                  title="Undo last stroke">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/>
            </svg>
            <span>Undo</span>
          </button>
          <button class="nge-shotdlg-tool" @click="clearMarkup" :disabled="!strokes.length"
                  title="Clear all marks">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>
            </svg>
            <span>Clear</span>
          </button>

          <span class="nge-shotdlg-toolbar-fill" />
          <span class="nge-shotdlg-readout nge-shotdlg-readout-dim">Marks {{ strokes.length }}</span>
          <span v-if="sourceRef" class="nge-shotdlg-readout nge-shotdlg-readout-dim nge-shotdlg-readout-src">
            Src {{ sourceRef.sw }} × {{ sourceRef.sh }}<span class="nge-shotdlg-unit">px</span>
          </span>
        </div>

        <!-- Stage: the preview frame is fitted in here at the output aspect. -->
        <div ref="stageEl" class="nge-shotdlg-stage">
          <div class="nge-shotdlg-frame"
               :style="{ width: frameCss.w + 'px', height: frameCss.h + 'px' }">
            <div class="nge-shotdlg-clip">
              <canvas ref="previewEl" class="nge-shotdlg-preview" />
              <canvas ref="markupEl" class="nge-shotdlg-markup"
                      @pointerdown="onPointerDown"
                      @pointermove="onPointerMove"
                      @pointerup="onPointerUp"
                      @pointercancel="onPointerUp" />
              <span class="nge-shotdlg-scan" aria-hidden="true" />
            </div>
            <i class="nge-shotdlg-brk tl" aria-hidden="true" />
            <i class="nge-shotdlg-brk tr" aria-hidden="true" />
            <i class="nge-shotdlg-brk bl" aria-hidden="true" />
            <i class="nge-shotdlg-brk br" aria-hidden="true" />
          </div>
        </div>
      </div>

      <!-- Right bar: output, options, actions. -->
      <div class="nge-shotdlg-side">
        <section class="nge-shotdlg-sec">
          <h3 class="nge-shotdlg-sechead">Output size</h3>
          <div class="nge-shotdlg-dims">
            <label class="nge-shotdlg-field">
              <span class="nge-shotdlg-flabel">Width</span>
              <input type="number" v-model.number="width" min="16" max="8192" />
            </label>
            <span class="nge-shotdlg-times">×</span>
            <label class="nge-shotdlg-field">
              <span class="nge-shotdlg-flabel">Height</span>
              <input type="number" v-model.number="height" min="16" max="8192" />
            </label>
            <span class="nge-shotdlg-px">px</span>
          </div>
          <div class="nge-shotdlg-presets">
            <button v-for="p in PRESETS" :key="p.label"
                    :class="{ 'is-active': isPreset(p.w, p.h) }"
                    @click="preset(p.w, p.h)">
              <b>{{ p.label }}</b>
              <span>{{ p.w }} × {{ p.h }}</span>
            </button>
          </div>
        </section>

        <section class="nge-shotdlg-sec">
          <h3 class="nge-shotdlg-sechead">Options</h3>
          <div class="nge-shotdlg-checks">
            <label class="nge-shotdlg-check">
              <input type="checkbox" v-model="transparent" />
              <span>Transparent background</span>
            </label>
            <label class="nge-shotdlg-check">
              <input type="checkbox" v-model="hideBoundingBox" />
              <span>Hide volume edge / bounding box</span>
            </label>
            <label class="nge-shotdlg-check">
              <input type="checkbox" v-model="showScaleBar" />
              <span>Show scale bar</span>
            </label>
          </div>
        </section>

        <div v-if="errorMsg" class="nge-shotdlg-err">{{ errorMsg }}</div>

        <div class="nge-shotdlg-actions">
          <button class="nge-shotdlg-primary" @click="download" :disabled="busy">
            {{ busy
                ? (props.mode === 'attach' ? 'Uploading…' : 'Rendering…')
                : (props.mode === 'attach' ? 'Attach' : 'Download') }}
          </button>
          <button class="nge-shotdlg-cancel" @click="close" :disabled="busy">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Styled after Amy's scifi-ui library (holopanel surface, holoframe corner
   brackets, holoscan single pass), with the values copied inline rather than
   depending on the library at runtime. */
.nge-shotdlg-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 14, 0.62);
  z-index: 10010;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.nge-shotdlg {
  --sd-line: 196 228 255;
  --sd-glow: 74 158 255;
  --sd-cyan: 126 224 255;
  --sd-ink: 214 234 252;
  position: relative;
  isolation: isolate;
  width: min(1400px, 94vw);
  height: min(900px, 90vh);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas:
    "head head"
    "main side";
  background: linear-gradient(158deg,
    rgba(14, 24, 44, 0.97) 0%,
    rgba(10, 18, 35, 0.98) 45%,
    rgba(6, 10, 18, 0.98) 100%);
  border: 1px solid rgb(var(--sd-glow) / 0.32);
  border-radius: 14px;
  color: rgb(var(--sd-ink));
  box-shadow:
    0 18px 50px rgba(0, 0, 0, 0.55),
    0 0 60px rgb(var(--sd-glow) / 0.08),
    inset 0 1px 0 rgb(var(--sd-line) / 0.10);
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.35;
  overflow: hidden;
  animation: nge-shotdlg-in 720ms cubic-bezier(.16, 1, .3, 1) both;
}
/* the lit hairline along the top edge (holopanel::before) */
.nge-shotdlg::before {
  content: "";
  position: absolute;
  left: 8%;
  right: 8%;
  top: 0;
  height: 1px;
  pointer-events: none;
  z-index: 3;
  background: linear-gradient(90deg, transparent,
    rgb(var(--sd-line) / 0.95) 50%, transparent);
  box-shadow: 0 0 12px rgb(178 216 248 / 0.6);
}
@keyframes nge-shotdlg-in {
  0%   { opacity: 0; transform: translateY(10px) scale(.97);
         filter: blur(10px) brightness(2.5); }
  60%  { opacity: 1; transform: translateY(0) scale(1);
         filter: blur(0) brightness(1.15); }
  100% { opacity: 1; transform: none; filter: none; }
}

/* ---- header ---- */
.nge-shotdlg-header {
  grid-area: head;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 11px 18px;
  border-bottom: 1px solid rgb(var(--sd-glow) / 0.18);
}
.nge-shotdlg-ico { font-size: 19px; color: rgb(var(--sd-cyan)); }
.nge-shotdlg-title {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--sd-line));
}
.nge-shotdlg-close {
  font-family: inherit;
  margin-left: auto;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgb(var(--sd-ink) / 0.8);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;
}
.nge-shotdlg-close:hover {
  color: #ffffff;
  border-color: rgb(var(--sd-glow) / 0.4);
  background: rgb(var(--sd-glow) / 0.1);
}

/* ---- main column: toolbar over stage ---- */
.nge-shotdlg-main {
  grid-area: main;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.nge-shotdlg-toolbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 16px;
  background:
    repeating-linear-gradient(0deg, rgb(var(--sd-cyan) / 0.025) 0 1px, transparent 1px 3px),
    rgba(6, 12, 26, 0.72);
  border-bottom: 1px solid rgb(var(--sd-glow) / 0.16);
}
.nge-shotdlg-tlabel,
.nge-shotdlg-sechead,
.nge-shotdlg-flabel {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--sd-line) / 0.72);
}
.nge-shotdlg-sep {
  width: 1px;
  height: 22px;
  background: linear-gradient(180deg, transparent, rgb(var(--sd-glow) / 0.45), transparent);
}
.nge-shotdlg-toolbar-fill { flex: 1 1 auto; }

.nge-shotdlg-swatches {
  display: flex;
  gap: 7px;
  padding: 4px 6px;
  border: 1px solid rgb(var(--sd-glow) / 0.18);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.25);
}
.nge-shotdlg-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.22);
  background: var(--sw);
  cursor: pointer;
  padding: 0;
  transition: transform .12s, box-shadow .15s, border-color .15s;
}
.nge-shotdlg-swatch:hover { transform: scale(1.12); }
.nge-shotdlg-swatch.is-active {
  border-color: #ffffff;
  box-shadow:
    0 0 0 2px rgba(6, 12, 26, 0.9),
    0 0 0 3.5px rgb(var(--sd-cyan) / 0.85),
    0 0 12px var(--sw);
}

.nge-shotdlg-pen-size {
  -webkit-appearance: none;
  appearance: none;
  width: 110px;
  height: 18px;
  background: transparent;
  cursor: pointer;
  margin: 0;
}
.nge-shotdlg-pen-size::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 2px;
  background:
    repeating-linear-gradient(90deg, rgb(var(--sd-line) / 0.35) 0 1px, transparent 1px 9px),
    rgb(var(--sd-glow) / 0.28);
}
.nge-shotdlg-pen-size::-moz-range-track {
  height: 3px;
  border-radius: 2px;
  background: rgb(var(--sd-glow) / 0.28);
}
.nge-shotdlg-pen-size::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4.5px;
  border-radius: 50%;
  background: rgb(var(--sd-cyan));
  border: 2px solid rgba(6, 12, 26, 0.95);
  box-shadow: 0 0 8px rgb(var(--sd-cyan) / 0.7);
}
.nge-shotdlg-pen-size::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--sd-cyan));
  border: 2px solid rgba(6, 12, 26, 0.95);
  box-shadow: 0 0 8px rgb(var(--sd-cyan) / 0.7);
}

.nge-shotdlg-readout {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--sd-cyan) / 0.95);
  white-space: nowrap;
}
.nge-shotdlg-readout-size { min-width: 34px; }
.nge-shotdlg-readout-dim { color: rgb(var(--sd-line) / 0.5); }
/* unit symbols keep their case inside uppercase readouts */
.nge-shotdlg-unit {
  text-transform: none;
  margin-left: 2px;
}

.nge-shotdlg-tool {
  font-family: inherit;
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  background: rgb(var(--sd-glow) / 0.08);
  border: 1px solid rgb(var(--sd-glow) / 0.3);
  border-radius: 6px;
  color: rgb(var(--sd-ink));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s, border-color .15s, color .15s, opacity .15s;
}
.nge-shotdlg-tool:hover:not(:disabled) {
  background: rgb(var(--sd-glow) / 0.2);
  border-color: rgb(var(--sd-cyan) / 0.6);
  color: #ffffff;
}
.nge-shotdlg-tool:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ---- stage + frame ---- */
.nge-shotdlg-stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 50% 45%, rgb(var(--sd-glow) / 0.07), transparent 70%),
    linear-gradient(rgb(var(--sd-glow) / 0.045) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(90deg, rgb(var(--sd-glow) / 0.045) 1px, transparent 1px) 0 0 / 40px 40px,
    rgba(2, 5, 12, 0.6);
}
.nge-shotdlg-frame {
  position: relative;
  flex: none;
  box-shadow:
    0 0 0 1px rgb(var(--sd-glow) / 0.4),
    0 10px 36px rgba(0, 0, 0, 0.6),
    0 0 34px rgb(var(--sd-glow) / 0.14);
}
.nge-shotdlg-clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
}
.nge-shotdlg-preview,
.nge-shotdlg-markup {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.nge-shotdlg-markup {
  cursor: crosshair;
  touch-action: none;
}

/* holoscan: one band passes once when the dialog opens, never loops */
.nge-shotdlg-scan {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 9%;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(180deg, transparent,
    rgb(var(--sd-cyan) / 0.16), transparent);
  animation: nge-shotdlg-scan 1.5s cubic-bezier(.4, 0, .2, 1) 0.35s 1 both;
}
@keyframes nge-shotdlg-scan {
  from { transform: translateY(-100%); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  to   { transform: translateY(1100%); opacity: 0; }
}

/* holoframe corner brackets, resting in the pushed out position */
.nge-shotdlg-brk {
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: none;
  border: 1.5px solid rgb(var(--sd-line) / 0.7);
  transition: transform .42s cubic-bezier(.2, .8, .25, 1);
}
.nge-shotdlg-brk.tl { top: 0; left: 0; border-right: 0; border-bottom: 0; transform: translate(-7px, -7px); }
.nge-shotdlg-brk.tr { top: 0; right: 0; border-left: 0; border-bottom: 0; transform: translate(7px, -7px); }
.nge-shotdlg-brk.bl { bottom: 0; left: 0; border-right: 0; border-top: 0; transform: translate(-7px, 7px); }
.nge-shotdlg-brk.br { bottom: 0; right: 0; border-left: 0; border-top: 0; transform: translate(7px, 7px); }
.nge-shotdlg-frame:hover .nge-shotdlg-brk.tl { transform: translate(-10px, -10px); }
.nge-shotdlg-frame:hover .nge-shotdlg-brk.tr { transform: translate(10px, -10px); }
.nge-shotdlg-frame:hover .nge-shotdlg-brk.bl { transform: translate(-10px, 10px); }
.nge-shotdlg-frame:hover .nge-shotdlg-brk.br { transform: translate(10px, 10px); }

/* ---- right bar ---- */
.nge-shotdlg-side {
  grid-area: side;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 16px;
  border-left: 1px solid rgb(var(--sd-glow) / 0.18);
  background:
    repeating-linear-gradient(0deg, rgb(var(--sd-cyan) / 0.02) 0 1px, transparent 1px 3px),
    rgba(4, 8, 18, 0.45);
}
.nge-shotdlg-sec {
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.nge-shotdlg-sechead {
  margin: 0;
  padding-bottom: 7px;
  border-bottom: 1px solid rgb(var(--sd-glow) / 0.16);
  color: rgb(var(--sd-line) / 0.85);
}

.nge-shotdlg-dims {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.nge-shotdlg-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1 1 0;
  min-width: 0;
}
.nge-shotdlg-flabel { font-size: 9px; color: rgb(var(--sd-line) / 0.55); }
.nge-shotdlg-field input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgb(var(--sd-glow) / 0.3);
  color: #ffffff;
  border-radius: 6px;
  padding: 7px 8px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.nge-shotdlg-field input[type="number"]:focus {
  outline: none;
  border-color: rgb(var(--sd-cyan) / 0.75);
  box-shadow: 0 0 0 3px rgb(var(--sd-cyan) / 0.12);
}
.nge-shotdlg-times { color: rgb(var(--sd-line) / 0.45); font-size: 14px; padding-bottom: 8px; }
.nge-shotdlg-px { color: rgb(var(--sd-line) / 0.6); font-size: 12px; padding-bottom: 9px; }

.nge-shotdlg-presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.nge-shotdlg-presets button {
  font-family: inherit;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  background: rgb(var(--sd-glow) / 0.07);
  border: 1px solid rgb(var(--sd-glow) / 0.25);
  border-radius: 6px;
  padding: 6px 9px;
  cursor: pointer;
  text-align: left;
  transition: background .15s, border-color .15s, box-shadow .15s;
}
.nge-shotdlg-presets button b {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgb(var(--sd-ink));
}
.nge-shotdlg-presets button span {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 10px;
  color: rgb(var(--sd-line) / 0.5);
  font-variant-numeric: tabular-nums;
}
.nge-shotdlg-presets button:hover {
  background: rgb(var(--sd-glow) / 0.18);
  border-color: rgb(var(--sd-glow) / 0.55);
}
.nge-shotdlg-presets button.is-active {
  background: rgb(var(--sd-glow) / 0.2);
  border-color: rgb(var(--sd-cyan) / 0.75);
  box-shadow: 0 0 12px rgb(var(--sd-cyan) / 0.16), inset 0 0 0 1px rgb(var(--sd-cyan) / 0.2);
}
.nge-shotdlg-presets button.is-active b { color: rgb(var(--sd-cyan)); }

.nge-shotdlg-checks {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nge-shotdlg-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  color: rgb(var(--sd-ink) / 0.92);
}
.nge-shotdlg-check input {
  -webkit-appearance: none;
  appearance: none;
  flex: none;
  position: relative;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid rgb(var(--sd-glow) / 0.5);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: background .15s, border-color .15s, box-shadow .15s;
}
.nge-shotdlg-check input:checked {
  background: rgb(var(--sd-cyan) / 0.22);
  border-color: rgb(var(--sd-cyan) / 0.9);
  box-shadow: 0 0 8px rgb(var(--sd-cyan) / 0.3);
}
.nge-shotdlg-check input:checked::after {
  content: "";
  position: absolute;
  left: 4.5px;
  top: 1.5px;
  width: 4px;
  height: 8px;
  border: solid rgb(var(--sd-cyan));
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.nge-shotdlg-check:hover input { border-color: rgb(var(--sd-cyan) / 0.8); }

.nge-shotdlg button:focus-visible,
.nge-shotdlg-check input:focus-visible,
.nge-shotdlg-pen-size:focus-visible {
  outline: 2px solid rgb(178 216 248);
  outline-offset: 2px;
}

.nge-shotdlg-err {
  background: rgba(220, 60, 60, 0.16);
  border: 1px solid rgba(220, 60, 60, 0.4);
  color: #ffb3b3;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
}

.nge-shotdlg-actions {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid rgb(var(--sd-glow) / 0.16);
}
.nge-shotdlg-cancel,
.nge-shotdlg-primary {
  font-family: inherit;
  width: 100%;
  border-radius: 6px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background .15s, border-color .15s, box-shadow .15s;
  border: 1px solid transparent;
}
.nge-shotdlg-primary {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  background: rgb(var(--sd-glow) / 0.24);
  border-color: rgb(var(--sd-cyan) / 0.6);
  color: #ffffff;
  box-shadow: 0 0 16px rgb(var(--sd-glow) / 0.2), inset 0 1px 0 rgb(var(--sd-line) / 0.15);
}
.nge-shotdlg-primary:hover:not(:disabled) {
  background: rgb(var(--sd-glow) / 0.36);
  border-color: rgb(var(--sd-cyan) / 0.9);
  box-shadow: 0 0 22px rgb(var(--sd-glow) / 0.32), inset 0 1px 0 rgb(var(--sd-line) / 0.2);
}
.nge-shotdlg-cancel {
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  border-color: rgba(255, 255, 255, 0.16);
  color: rgb(var(--sd-ink) / 0.85);
}
.nge-shotdlg-cancel:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); }
.nge-shotdlg-primary:disabled,
.nge-shotdlg-cancel:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* keep the pen strip on one line on mid size screens */
@media (max-width: 1300px) {
  .nge-shotdlg-readout-src { display: none; }
}

/* narrow screens: the right bar drops below the image */
@media (max-width: 820px) {
  .nge-shotdlg {
    height: 94vh;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "head"
      "main"
      "side";
  }
  .nge-shotdlg-side {
    max-height: 42vh;
    border-left: 0;
    border-top: 1px solid rgb(var(--sd-glow) / 0.18);
  }
  .nge-shotdlg-toolbar .nge-shotdlg-readout-dim { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .nge-shotdlg { animation: none; }
  .nge-shotdlg-scan { animation: none; display: none; }
  .nge-shotdlg-brk { transition: none; }
}
</style>
