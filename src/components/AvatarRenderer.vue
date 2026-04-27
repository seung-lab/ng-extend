<script setup lang="ts">
import {ref, onMounted, onUnmounted} from 'vue';
import {storeToRefs} from 'pinia';
import {useAvatarStore} from '../store';
import connectomeCoin from '../../static/coin/connectome-coin.png';

const charCanvasRef = ref<HTMLCanvasElement | null>(null);
const bgCanvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);
const errorMsg = ref<string | null>(null);

const store = useAvatarStore();
const {ready} = storeToRefs(store);

let animFrame = 0;
let resizeObserver: ResizeObserver | null = null;
let unmounted = false;

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

let captureCooldown = 0;

function loop() {
  const character = store.getCharacter();
  if (character) {
    const wasDirty = character.needsRender;
    character.render(true);
    // After a render that actually drew something, schedule a thumbnail capture
    // ~30 frames later (≈500ms) so async images settle first.
    if (wasDirty) captureCooldown = 30;
  }
  if (captureCooldown > 0) {
    captureCooldown--;
    if (captureCooldown === 0 && charCanvasRef.value) {
      store.captureThumbnailIfNeeded(charCanvasRef.value);
    }
  }
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
  } catch (e) {
    console.error('Avatar load failed', e);
    errorMsg.value = 'Failed to load avatar assets.';
    return;
  }

  // Component may have unmounted during the async init — bail before
  // scheduling anything that would outlive us.
  if (unmounted) return;

  animFrame = requestAnimationFrame(loop);
  resizeObserver = new ResizeObserver(sizeCanvases);
  resizeObserver.observe(stage);
});

onUnmounted(() => {
  unmounted = true;
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
      <div class="nge-avatar-loading-rings">
        <div class="nge-avatar-loading-ring"></div>
        <div class="nge-avatar-loading-ring nge-avatar-loading-ring--inner"></div>
        <div class="nge-avatar-loading-orbit">
          <span class="nge-avatar-loading-spark"></span>
          <span class="nge-avatar-loading-spark nge-avatar-loading-spark--2"></span>
          <span class="nge-avatar-loading-spark nge-avatar-loading-spark--3"></span>
        </div>
        <img :src="connectomeCoin" class="nge-avatar-loading-coin" alt="" />
      </div>
      <div class="nge-avatar-loading-label">Initializing connectome</div>
      <div class="nge-avatar-loading-sub">summoning your avatar…</div>
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
  gap: 18px;
  z-index: 2;
  pointer-events: none;
}
.nge-avatar-error {
  color: rgba(255, 140, 140, 0.85);
  font-size: 0.85em;
  font-style: italic;
  letter-spacing: 0.05em;
}

/* Holographic loader — twin spinning rings around the FlyWire coin. */
.nge-avatar-loading-rings {
  position: relative;
  width: 150px;
  height: 150px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.nge-avatar-loading-ring {
  position: absolute;
  inset: 0;
  border: 1.5px solid rgba(120, 200, 255, 0.18);
  border-radius: 50%;
  border-top-color: rgba(120, 220, 255, 0.85);
  border-right-color: rgba(180, 140, 255, 0.5);
  animation: nge-avatar-loading-spin 3s linear infinite;
}
.nge-avatar-loading-ring--inner {
  inset: 18px;
  border-color: rgba(0, 150, 255, 0.08);
  border-bottom-color: rgba(255, 200, 80, 0.65);
  border-left-color: rgba(120, 200, 255, 0.4);
  animation-duration: 5s;
  animation-direction: reverse;
}
@keyframes nge-avatar-loading-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Three orbital sparks tracing a wider ring around the coin. */
.nge-avatar-loading-orbit {
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  animation: nge-avatar-loading-spin 8s linear infinite;
}
.nge-avatar-loading-spark {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(120, 220, 255, 0.95);
  box-shadow: 0 0 12px rgba(120, 220, 255, 0.7), 0 0 4px rgba(255, 255, 255, 0.9);
  top: 50%;
  left: 50%;
  margin: -3px 0 0 -3px;
  transform: translateX(85px);
}
.nge-avatar-loading-spark--2 {
  background: rgba(255, 200, 80, 0.95);
  box-shadow: 0 0 12px rgba(255, 200, 80, 0.7), 0 0 4px rgba(255, 255, 255, 0.9);
  transform: rotate(120deg) translateX(85px);
}
.nge-avatar-loading-spark--3 {
  background: rgba(180, 140, 255, 0.95);
  box-shadow: 0 0 12px rgba(180, 140, 255, 0.7), 0 0 4px rgba(255, 255, 255, 0.9);
  transform: rotate(240deg) translateX(85px);
}

.nge-avatar-loading-coin {
  position: relative;
  z-index: 2;
  width: 92px;
  height: 92px;
  filter: drop-shadow(0 0 18px rgba(255, 200, 80, 0.55));
  animation: nge-avatar-loading-breathe 3.2s ease-in-out infinite;
}
@keyframes nge-avatar-loading-breathe {
  0%, 100% {
    filter: drop-shadow(0 0 12px rgba(255, 200, 80, 0.45));
    transform: scale(1);
  }
  50% {
    filter: drop-shadow(0 0 28px rgba(255, 220, 140, 0.85));
    transform: scale(1.05);
  }
}

.nge-avatar-loading-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.74em;
  font-weight: 600;
  letter-spacing: 0.24em;
  color: rgba(180, 220, 255, 0.9);
  text-shadow: 0 0 14px rgba(74, 158, 255, 0.4);
  text-transform: uppercase;
  animation: nge-avatar-loading-flicker 4s ease-in-out infinite;
}
@keyframes nge-avatar-loading-flicker {
  0%, 100% { opacity: 0.92; }
  50%      { opacity: 0.65; }
}
.nge-avatar-loading-sub {
  font-size: 0.7em;
  color: rgba(180, 220, 255, 0.45);
  font-style: italic;
  letter-spacing: 0.06em;
}
</style>
