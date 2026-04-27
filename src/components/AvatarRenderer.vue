<script setup lang="ts">
import {ref, onMounted, onUnmounted} from 'vue';
import {storeToRefs} from 'pinia';
import {useAvatarStore} from '../store';

const charCanvasRef = ref<HTMLCanvasElement | null>(null);
const bgCanvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);
const errorMsg = ref<string | null>(null);

const store = useAvatarStore();
const {ready} = storeToRefs(store);

let animFrame = 0;
let resizeObserver: ResizeObserver | null = null;

function sizeCanvases() {
  const stage = stageRef.value;
  const charCanvas = charCanvasRef.value;
  const bgCanvas = bgCanvasRef.value;
  if (!stage || !charCanvas || !bgCanvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (w === 0 || h === 0) return;

  for (const c of [charCanvas, bgCanvas]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  const character = store.getCharacter();
  if (character) character.needsRender = true;
}

function loop() {
  const character = store.getCharacter();
  if (character) character.render(true);
  animFrame = requestAnimationFrame(loop);
}

onMounted(async () => {
  const charCanvas = charCanvasRef.value;
  const bgCanvas = bgCanvasRef.value;
  const stage = stageRef.value;
  if (!charCanvas || !bgCanvas || !stage) return;

  sizeCanvases();

  try {
    await store.initialize(charCanvas, bgCanvas);
    animFrame = requestAnimationFrame(loop);
  } catch (e) {
    console.error('Avatar load failed', e);
    errorMsg.value = 'Failed to load avatar assets.';
    return;
  }

  resizeObserver = new ResizeObserver(sizeCanvases);
  resizeObserver.observe(stage);
});

onUnmounted(() => {
  cancelAnimationFrame(animFrame);
  resizeObserver?.disconnect();
  store.destroy();
});
</script>

<template>
  <div ref="stageRef" class="nge-avatar-stage">
    <canvas ref="bgCanvasRef" class="nge-avatar-canvas nge-avatar-canvas--bg" />
    <canvas ref="charCanvasRef" class="nge-avatar-canvas nge-avatar-canvas--char" />
    <div v-if="!ready && !errorMsg" class="nge-avatar-loading">
      <div class="nge-avatar-loading-pulse"></div>
      <div>Loading avatar…</div>
    </div>
    <div v-else-if="errorMsg" class="nge-avatar-error">{{ errorMsg }}</div>
  </div>
</template>

<style scoped>
.nge-avatar-stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: #191558;
  overflow: hidden;
  border-radius: 12px;
}
.nge-avatar-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.nge-avatar-canvas--bg { z-index: 0; }
.nge-avatar-canvas--char { z-index: 1; }
.nge-avatar-loading,
.nge-avatar-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.85em;
  font-style: italic;
  letter-spacing: 0.05em;
  z-index: 2;
  pointer-events: none;
}
.nge-avatar-error { color: rgba(255, 140, 140, 0.85); }
.nge-avatar-loading-pulse {
  width: 36px;
  height: 36px;
  border: 2px solid rgba(120, 200, 255, 0.15);
  border-top-color: rgba(120, 200, 255, 0.7);
  border-radius: 50%;
  animation: nge-avatar-spin 0.9s linear infinite;
}
@keyframes nge-avatar-spin {
  to { transform: rotate(360deg); }
}
</style>
