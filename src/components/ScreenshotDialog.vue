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

const PREVIEW_W = 480;
const PREVIEW_H = 270;

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
// Image rect within the preview after letterboxing.
const imgRect = ref({ x: 0, y: 0, w: PREVIEW_W, h: PREVIEW_H });

const previewEl = ref<HTMLCanvasElement | null>(null);
const markupEl = ref<HTMLCanvasElement | null>(null);

// Pen state. Strokes store points in 0..1 range relative to imgRect, so
// they survive resize and render sharp at any output resolution.
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
  cv.width = PREVIEW_W;
  cv.height = PREVIEW_H;
  const ctx = cv.getContext('2d')!;

  if (transparent.value) {
    drawCheckerboard(ctx, PREVIEW_W, PREVIEW_H);
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  }

  const src = sourceRef.value;
  if (!src) {
    imgRect.value = { x: 0, y: 0, w: PREVIEW_W, h: PREVIEW_H };
    return;
  }

  const { sw, sh, canvas: srcCanvas } = src;
  const sourceAspect = sw / sh;
  const targetAspect = PREVIEW_W / PREVIEW_H;
  let dw = PREVIEW_W, dh = PREVIEW_H, dx = 0, dy = 0;
  if (sourceAspect > targetAspect) {
    dh = Math.round(PREVIEW_W / sourceAspect);
    dy = Math.round((PREVIEW_H - dh) / 2);
  } else {
    dw = Math.round(PREVIEW_H * sourceAspect);
    dx = Math.round((PREVIEW_W - dw) / 2);
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

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tile = 12;
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      const dark = ((x / tile) + (y / tile)) % 2 === 0;
      ctx.fillStyle = dark ? '#2a2f3a' : '#3a414f';
      ctx.fillRect(x, y, tile, tile);
    }
  }
}

/** Render strokes onto a target context, given the image rect on that
 *  target. Stroke points are in 0..1 of the image rect. */
function renderStrokes(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, sizeScale: number) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes.value) {
    if (s.points.length === 0) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, s.size * sizeScale);
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
  cv.width = PREVIEW_W;
  cv.height = PREVIEW_H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
  renderStrokes(ctx, imgRect.value, 1);
}

function pointerToImgUV(e: PointerEvent): { u: number; v: number } | null {
  const cv = markupEl.value;
  if (!cv) return null;
  const rect = cv.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * PREVIEW_W;
  const y = ((e.clientY - rect.top) / rect.height) * PREVIEW_H;
  const r = imgRect.value;
  if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return null;
  return { u: (x - r.x) / r.w, v: (y - r.y) / r.h };
}

function onPointerDown(e: PointerEvent) {
  const uv = pointerToImgUV(e);
  if (!uv) return;
  drawing = true;
  (e.target as Element).setPointerCapture?.(e.pointerId);
  strokes.value.push({ color: penColor.value, size: penSize.value, points: [uv] });
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
    await refreshSource();
  }
});

watch([hideBoundingBox], () => {
  if (props.show) refreshSource();
});
// Scale bar toggle is post-process — no need to recapture, just redraw.
watch([showScaleBar, transparent], () => {
  if (props.show) renderPreview();
});

onBeforeUnmount(() => { drawing = false; });

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

    // Markup at full output resolution. Stroke sizes are in preview pixels,
    // so scale up by (output image height / preview image height).
    const scale = dh / imgRect.value.h;
    renderStrokes(ctx, outRect, scale);

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
    <div class="nge-shotdlg" role="dialog" aria-label="Save screenshot">
      <div class="nge-shotdlg-header">
        <span class="material-symbols-outlined nge-shotdlg-ico">photo_camera</span>
        <span>{{ props.mode === 'attach' ? 'Attach screenshot' : 'Save screenshot' }}</span>
        <button class="nge-shotdlg-close" @click="close" aria-label="Close">×</button>
      </div>

      <div class="nge-shotdlg-body">
        <div class="nge-shotdlg-preview-wrap">
          <canvas ref="previewEl" class="nge-shotdlg-preview"
                  :width="PREVIEW_W" :height="PREVIEW_H" />
          <canvas ref="markupEl" class="nge-shotdlg-markup"
                  :width="PREVIEW_W" :height="PREVIEW_H"
                  @pointerdown="onPointerDown"
                  @pointermove="onPointerMove"
                  @pointerup="onPointerUp"
                  @pointercancel="onPointerUp" />
        </div>

        <div class="nge-shotdlg-pen">
          <span class="nge-shotdlg-pen-label">Pen</span>
          <div class="nge-shotdlg-swatches">
            <button v-for="c in PEN_COLORS" :key="c"
                    class="nge-shotdlg-swatch"
                    :class="{ 'is-active': penColor === c }"
                    :style="{ background: c }"
                    @click="penColor = c"
                    :title="c" />
          </div>
          <input type="range" min="1" max="12" step="1" v-model.number="penSize"
                 class="nge-shotdlg-pen-size" :title="`Brush size: ${penSize}px`" />
          <button class="nge-shotdlg-pen-btn" @click="undo" title="Undo last stroke">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/>
            </svg>
          </button>
          <button class="nge-shotdlg-pen-btn" @click="clearMarkup" title="Clear all marks">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>
            </svg>
          </button>
        </div>

        <div class="nge-shotdlg-row">
          <span class="nge-shotdlg-label">Width</span>
          <input type="number" v-model.number="width" min="16" max="8192" />
          <span class="nge-shotdlg-times">×</span>
          <span class="nge-shotdlg-label">Height</span>
          <input type="number" v-model.number="height" min="16" max="8192" />
          <span class="nge-shotdlg-px">px</span>
        </div>

        <div class="nge-shotdlg-presets">
          <button @click="preset(1280, 720)">720p</button>
          <button @click="preset(1920, 1080)">1080p</button>
          <button @click="preset(2560, 1440)">1440p</button>
          <button @click="preset(3840, 2160)">4K</button>
        </div>

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

        <div v-if="errorMsg" class="nge-shotdlg-err">{{ errorMsg }}</div>
      </div>

      <div class="nge-shotdlg-actions">
        <button class="nge-shotdlg-cancel" @click="close" :disabled="busy">Cancel</button>
        <button class="nge-shotdlg-primary" @click="download" :disabled="busy">
          {{ busy
              ? (props.mode === 'attach' ? 'Uploading…' : 'Rendering…')
              : (props.mode === 'attach' ? 'Attach' : 'Download') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nge-shotdlg-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 10010;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.nge-shotdlg {
  width: 540px;
  max-width: 92vw;
  background: linear-gradient(135deg,
    rgba(8, 28, 48, 0.96) 0%,
    rgba(12, 18, 38, 0.98) 50%,
    rgba(8, 28, 48, 0.96) 100%);
  border: 1px solid rgba(74, 200, 255, 0.4);
  border-radius: 14px;
  color: #cfeaff;
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.55),
    0 0 24px rgba(74, 200, 255, 0.18);
  font-size: 13px;
  overflow: hidden;
}
.nge-shotdlg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(74, 200, 255, 0.18);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.nge-shotdlg-ico { font-size: 18px; color: #5be3ff; }
.nge-shotdlg-close {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #cfeaff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.nge-shotdlg-close:hover { color: #ffffff; }

.nge-shotdlg-body {
  padding: 14px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nge-shotdlg-preview-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(74, 200, 255, 0.25);
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

.nge-shotdlg-pen {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.nge-shotdlg-pen-label {
  font-size: 12px;
  color: #a8c5e0;
  margin-right: 2px;
}
.nge-shotdlg-swatches {
  display: flex;
  gap: 4px;
}
.nge-shotdlg-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s, border-color 0.15s;
}
.nge-shotdlg-swatch:hover { transform: scale(1.12); }
.nge-shotdlg-swatch.is-active {
  border-color: #ffffff;
  box-shadow: 0 0 0 2px rgba(74, 200, 255, 0.5);
}
.nge-shotdlg-pen-size {
  width: 80px;
  accent-color: #5be3ff;
}
.nge-shotdlg-pen-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 200, 255, 0.3);
  border-radius: 6px;
  color: #cfeaff;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.nge-shotdlg-pen-btn:hover {
  background: rgba(74, 200, 255, 0.22);
  border-color: rgba(74, 200, 255, 0.6);
  color: #ffffff;
}

.nge-shotdlg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.nge-shotdlg-label { font-size: 12px; color: #a8c5e0; }
.nge-shotdlg-times { color: #5b7a96; font-size: 14px; padding: 0 2px; }
.nge-shotdlg-row input[type="number"] {
  width: 88px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(74, 200, 255, 0.3);
  color: #ffffff;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.nge-shotdlg-row input[type="number"]:focus {
  outline: none;
  border-color: rgba(74, 200, 255, 0.7);
}
.nge-shotdlg-px { color: #a8c5e0; font-size: 12px; }

.nge-shotdlg-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.nge-shotdlg-presets button {
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.3);
  color: #cfeaff;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.nge-shotdlg-presets button:hover {
  background: rgba(74, 158, 255, 0.22);
  border-color: rgba(74, 158, 255, 0.6);
}

.nge-shotdlg-checks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nge-shotdlg-check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.nge-shotdlg-check input { cursor: pointer; }

.nge-shotdlg-err {
  background: rgba(220, 60, 60, 0.16);
  border: 1px solid rgba(220, 60, 60, 0.4);
  color: #ffb3b3;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
}

.nge-shotdlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
  border-top: 1px solid rgba(74, 200, 255, 0.18);
}
.nge-shotdlg-cancel,
.nge-shotdlg-primary {
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  border: 1px solid transparent;
}
.nge-shotdlg-cancel {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.18);
  color: #cfeaff;
}
.nge-shotdlg-cancel:hover { background: rgba(255, 255, 255, 0.06); }
.nge-shotdlg-primary {
  background: rgba(74, 158, 255, 0.22);
  border-color: rgba(74, 158, 255, 0.55);
  color: #ffffff;
}
.nge-shotdlg-primary:hover {
  background: rgba(74, 158, 255, 0.34);
  border-color: rgba(74, 158, 255, 0.8);
}
.nge-shotdlg-primary:disabled,
.nge-shotdlg-cancel:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
