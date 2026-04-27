<script setup lang="ts">
import {ref, onMounted, onUnmounted} from 'vue';

import Character, {Gender} from '../widgets/avatar/character';
import {CanvasWrapper} from '../widgets/avatar/canvas_interface';
import Renderer from '../widgets/avatar/renderer';

const charCanvasRef = ref<HTMLCanvasElement | null>(null);
const bgCanvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const errorMsg = ref<string | null>(null);

let character: Character | null = null;
let renderer: Renderer | null = null;
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
  if (character) character.needsRender = true;
}

function loop() {
  if (character) character.render(true);
  animFrame = requestAnimationFrame(loop);
}

onMounted(async () => {
  const charCanvas = charCanvasRef.value;
  const bgCanvas = bgCanvasRef.value;
  const stage = stageRef.value;
  if (!charCanvas || !bgCanvas || !stage) return;

  sizeCanvases();

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = 1;
  colorCanvas.height = 1;

  const createImage = (canvas: CanvasWrapper): Promise<CanvasImageSource> =>
      createImageBitmap(canvas as unknown as ImageBitmapSource);

  renderer = new Renderer(charCanvas, bgCanvas, colorCanvas, createImage);

  try {
    character = await Character.createCharacter(Gender.Female, renderer);
    loading.value = false;
    animFrame = requestAnimationFrame(loop);
  } catch (e) {
    console.error('Avatar load failed', e);
    errorMsg.value = 'Failed to load avatar assets.';
    loading.value = false;
    return;
  }

  resizeObserver = new ResizeObserver(sizeCanvases);
  resizeObserver.observe(stage);
});

onUnmounted(() => {
  cancelAnimationFrame(animFrame);
  resizeObserver?.disconnect();
  character?.cancel();
  character = null;
  renderer = null;
});
</script>

<template>
  <div ref="stageRef" class="nge-avatar-stage">
    <canvas ref="bgCanvasRef" class="nge-avatar-canvas nge-avatar-canvas--bg" />
    <canvas ref="charCanvasRef" class="nge-avatar-canvas nge-avatar-canvas--char" />
    <div v-if="loading" class="nge-avatar-loading">Loading avatar…</div>
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
  border-radius: 10px;
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
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9em;
  font-style: italic;
  z-index: 2;
  pointer-events: none;
}
.nge-avatar-error { color: rgba(255, 140, 140, 0.85); }
</style>
