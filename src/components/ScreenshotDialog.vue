<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const width = ref(1920);
const height = ref(1080);
const transparent = ref(false);
const busy = ref(false);
const errorMsg = ref('');

function close() {
  if (busy.value) return;
  errorMsg.value = '';
  emit('close');
}

function preset(w: number, h: number) {
  width.value = w;
  height.value = h;
}

async function download() {
  errorMsg.value = '';
  const w = Math.max(16, Math.min(8192, Math.floor(width.value || 0)));
  const h = Math.max(16, Math.min(8192, Math.floor(height.value || 0)));
  if (!w || !h) {
    errorMsg.value = 'Width and height must be positive integers (max 8192).';
    return;
  }

  const viewer: any = (window as any)['viewer'];
  const sourceCanvas: HTMLCanvasElement | undefined = viewer?.display?.canvas;
  if (!sourceCanvas) {
    errorMsg.value = 'Viewer not ready. Try again in a moment.';
    return;
  }

  busy.value = true;
  try {
    // Force a fresh draw so the WebGL drawing buffer is current. The 2D copy
    // below MUST happen synchronously in the same task — preserveDrawingBuffer
    // is typically false, so the buffer is reset on the next task boundary.
    if (typeof viewer.display.draw === 'function') {
      viewer.display.draw();
    }

    const sw = sourceCanvas.width || sourceCanvas.clientWidth;
    const sh = sourceCanvas.height || sourceCanvas.clientHeight;
    if (!sw || !sh) {
      throw new Error('Viewer canvas has zero size.');
    }

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d')!;

    // Letterbox to preserve viewer aspect ratio.
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
    ctx.drawImage(sourceCanvas, dx, dy, dw, dh);

    // Heuristic transparency: replace near-black pixels with transparent.
    if (transparent.value) {
      try {
        const img = ctx.getImageData(0, 0, w, h);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 8 && d[i + 1] < 8 && d[i + 2] < 8) d[i + 3] = 0;
        }
        ctx.putImageData(img, 0, 0);
      } catch (e) {
        console.warn('Transparency pass skipped:', e);
      }
    }

    const blob: Blob = await new Promise((resolve, reject) => {
      off.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
    });

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
        <span>Save screenshot</span>
        <button class="nge-shotdlg-close" @click="close" aria-label="Close">×</button>
      </div>

      <div class="nge-shotdlg-body">
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

        <label class="nge-shotdlg-check">
          <input type="checkbox" v-model="transparent" />
          <span>Transparent background</span>
          <span class="nge-shotdlg-hint">(replaces black with transparent)</span>
        </label>

        <div v-if="errorMsg" class="nge-shotdlg-err">{{ errorMsg }}</div>
      </div>

      <div class="nge-shotdlg-actions">
        <button class="nge-shotdlg-cancel" @click="close" :disabled="busy">Cancel</button>
        <button class="nge-shotdlg-primary" @click="download" :disabled="busy">
          {{ busy ? 'Rendering…' : 'Download' }}
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
  width: 460px;
  max-width: 90vw;
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
.nge-shotdlg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.nge-shotdlg-label {
  font-size: 12px;
  color: #a8c5e0;
}
.nge-shotdlg-times {
  color: #5b7a96;
  font-size: 14px;
  padding: 0 2px;
}
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

.nge-shotdlg-check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.nge-shotdlg-check input { cursor: pointer; }
.nge-shotdlg-hint { color: #7d96b0; font-size: 11px; }

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
