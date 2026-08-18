<script setup lang="ts">
/**
 * FlightMode — pilot the ship through the neuropil.
 *
 * A cockpit HUD over the whole viewport: click to engage steering (pointer
 * lock, mouse aims the nose), W thrusts along your gaze, S retro-thrusts,
 * A/D strafe, R/F rise and dive, Q/E roll, Shift is the boost. Arrow keys
 * steer too for the no-mouse crowd. Esc disengages steering, Esc again
 * powers the cockpit down.
 *
 * The camera work rides the perspective pose directly: forward is +z in
 * pose-local space (the camera sits at local -z looking at the center), so
 * thrust transforms [0,0,speed] by the pose orientation and walks the
 * shared navigation position. The 2D slices tag along for free.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits({ hide: null });
const LIGHT_RGB = '53,181,255';

const rootEl = ref<HTMLElement | null>(null);
const streakCv = ref<HTMLCanvasElement | null>(null);
const steering = ref(false);
const boosting = ref(false);
const speedLabel = ref('0');
const posLabel = ref('');

function nav(): any {
  return (window as any)['viewer']?.perspectiveNavigationState ?? null;
}
function positionState(): any {
  return (window as any)['viewer']?.navigationState?.position ?? null;
}

/* ── input state ── */
const keys: Record<string, boolean> = {};
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'r', 'f', 'q', 'e',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
let pendingYaw = 0, pendingPitch = 0;

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return;
  keys['shift'] = e.shiftKey;
  if (e.key === 'Escape') {
    // First Esc leaves the browser's pointer lock; the next one lands here.
    if (document.pointerLockElement) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    emit('hide');
    return;
  }
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.has(k)) {
    keys[k] = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
function onKeyUp(e: KeyboardEvent) {
  keys['shift'] = e.shiftKey;
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.has(k)) {
    keys[k] = false;
    e.stopImmediatePropagation();
  }
}
function onBlur() { for (const k of Object.keys(keys)) keys[k] = false; }

/* ── steering (pointer lock) ── */
function engageSteering() {
  rootEl.value?.requestPointerLock?.();
}
function onLockChange() {
  steering.value = document.pointerLockElement === rootEl.value;
}
function onMouseMove(e: MouseEvent) {
  if (!steering.value) return;
  const SENS = 0.0022;
  pendingYaw += e.movementX * SENS;
  pendingPitch += -e.movementY * SENS;
}

/* ── flight loop ── */
let raf = 0;
let lastT = 0;
let vx = 0, vy = 0, vz = 0; // smoothed velocity, pose-local units per second
let frame = 0;

function step(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
  lastT = now;
  const n = nav();
  const posState = positionState();
  if (!n || !posState) { raf = requestAnimationFrame(step); return; }

  const boost = keys['shift'] || boosting.value;
  const zoom = n.zoomFactor?.value || 1000;
  const cruise = zoom * (boost ? 1.7 : 0.55);

  // thrust targets, pose-local: +z forward, +x screen-right, -y screen-up
  const tz = (keys['w'] ? 1 : 0) + (keys['s'] ? -0.6 : 0);
  const tx = (keys['d'] ? 0.6 : 0) + (keys['a'] ? -0.6 : 0);
  const ty = (keys['f'] ? 0.6 : 0) + (keys['r'] ? -0.6 : 0);
  const k = 1 - Math.exp(-dt * 5); // inertia: ease toward the target
  vx += (tx * cruise - vx) * k;
  vy += (ty * cruise - vy) * k;
  vz += (tz * cruise - vz) * k;

  // steering: pointer-lock deltas plus arrow keys, applied on local axes
  const ARROW_RATE = 1.6;
  let yaw = pendingYaw, pitch = pendingPitch;
  pendingYaw = 0; pendingPitch = 0;
  if (keys['arrowright']) yaw += ARROW_RATE * dt;
  if (keys['arrowleft']) yaw -= ARROW_RATE * dt;
  if (keys['arrowup']) pitch += ARROW_RATE * dt;
  if (keys['arrowdown']) pitch -= ARROW_RATE * dt;
  let roll = 0;
  if (keys['e']) roll += 1.4 * dt;
  if (keys['q']) roll -= 1.4 * dt;
  try {
    const pose = n.pose;
    if (yaw) pose.rotateRelative(YAW_AXIS, yaw);
    if (pitch) pose.rotateRelative(PITCH_AXIS, pitch);
    if (roll) pose.rotateRelative(ROLL_AXIS, roll);
    const sp = Math.hypot(vx, vy, vz);
    if (sp > zoom * 0.002) {
      // transform local velocity by the pose orientation, walk the position
      const q = pose.orientation.orientation as Float32Array;
      const wv = transformQuat(vx * dt, vy * dt, vz * dt, q);
      const cur = posState.value as Float32Array;
      const next = Float32Array.from(cur);
      next[0] += wv[0]; next[1] += wv[1]; next[2] += wv[2];
      posState.value = next;
    }
    if ((frame++ % 6) === 0) {
      speedLabel.value = Math.round(sp).toLocaleString();
      const p = posState.value;
      posLabel.value = `${Math.round(p[0])}  ${Math.round(p[1])}  ${Math.round(p[2])}`;
      boosting.value = !!keys['shift'];
    }
    drawStreaks(sp / (zoom * 1.7));
  } catch { /* viewer mid-teardown, glide through the frame */ }
  raf = requestAnimationFrame(step);
}

const YAW_AXIS = new Float32Array([0, 1, 0]);
const PITCH_AXIS = new Float32Array([1, 0, 0]);
const ROLL_AXIS = new Float32Array([0, 0, 1]);

/** vec3-by-quat transform, inlined so we skip an import from the fork. */
function transformQuat(x: number, y: number, z: number, q: Float32Array): [number, number, number] {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  let uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x;
  const uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx;
  uvx *= qw * 2; uvy *= qw * 2; uvz *= qw * 2;
  return [x + uvx + uuvx * 2, y + uvy + uuvy * 2, z + uvz + uuvz * 2];
}

/* ── boost streaks: lines racing past the canopy when you pour it on ── */
const STREAKS = Array.from({ length: 42 }, (_, i) => ({
  a: (i / 42) * 6.283 + (i % 7) * 0.13,
  d: 0.14 + ((i * 37) % 100) / 130,
}));
function drawStreaks(intensity: number) {
  const cv = streakCv.value;
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  if (cv.width !== vw || cv.height !== vh) { cv.width = vw; cv.height = vh; }
  ctx.clearRect(0, 0, vw, vh);
  const amt = Math.min(1, Math.max(0, intensity - 0.06));
  if (amt <= 0 || reducedMotion) return;
  const cx = vw / 2, cy = vh / 2, rMax = Math.hypot(cx, cy);
  ctx.lineCap = 'round';
  for (const s of STREAKS) {
    const r0 = rMax * (0.28 + s.d * 0.5);
    const len = rMax * 0.16 * amt * (0.5 + s.d);
    ctx.strokeStyle = `rgba(${LIGHT_RGB},${(0.16 * amt).toFixed(3)})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
    ctx.lineTo(cx + Math.cos(s.a) * (r0 + len), cy + Math.sin(s.a) * (r0 + len));
    ctx.stroke();
  }
}
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

onMounted(() => {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('mousemove', onMouseMove);
  lastT = performance.now();
  raf = requestAnimationFrame(step);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('blur', onBlur);
  document.removeEventListener('pointerlockchange', onLockChange);
  window.removeEventListener('mousemove', onMouseMove);
  if (document.pointerLockElement === rootEl.value) document.exitPointerLock?.();
});
</script>

<template>
  <div ref="rootEl" class="nge-flight" @click="engageSteering">
    <canvas ref="streakCv" class="nge-flight-streaks" aria-hidden="true"></canvas>

    <!-- canopy frame -->
    <div class="nge-flight-corner nge-flight-corner--tl"></div>
    <div class="nge-flight-corner nge-flight-corner--tr"></div>
    <div class="nge-flight-corner nge-flight-corner--bl"></div>
    <div class="nge-flight-corner nge-flight-corner--br"></div>

    <!-- reticle -->
    <div class="nge-flight-reticle" :class="{ 'nge-flight-reticle--hot': boosting }">
      <svg viewBox="0 0 120 120" width="120" height="120">
        <circle cx="60" cy="60" r="26" fill="none" stroke="rgba(53,181,255,0.55)" stroke-width="1.2" />
        <circle cx="60" cy="60" r="1.8" fill="rgba(216,238,255,0.9)" />
        <path d="M60 22 v12 M60 86 v12 M22 60 h12 M86 60 h12" stroke="rgba(53,181,255,0.75)" stroke-width="1.4" />
        <path d="M42 42 l6 6 M78 42 l-6 6 M42 78 l6 -6 M78 78 l-6 -6" stroke="rgba(53,181,255,0.3)" stroke-width="1" />
      </svg>
    </div>

    <!-- readouts -->
    <div class="nge-flight-top">
      <span class="nge-flight-rec"></span>
      FLIGHT MODE
      <span class="nge-flight-sub">{{ steering ? 'steering engaged' : 'click to steer' }}</span>
    </div>
    <div class="nge-flight-speed">
      <span class="nge-flight-key">VEL</span> {{ speedLabel }}
      <span v-if="boosting" class="nge-flight-boost">BOOST</span>
    </div>
    <div class="nge-flight-pos"><span class="nge-flight-key">POS</span> {{ posLabel }}</div>
    <div class="nge-flight-hint">
      W thrust · S retro · A/D strafe · R/F rise & dive · Q/E roll · Shift boost · Esc exit
    </div>
    <button class="nge-flight-exit" title="Power down (Esc)" @click.stop="emit('hide')">✕</button>
  </div>
</template>

<style scoped>
.nge-flight {
  position: fixed;
  inset: 0;
  z-index: 9990;
  cursor: crosshair;
  font-family: 'Orbitron', 'Inter', sans-serif;
  color: rgba(216, 238, 255, 0.92);
  animation: nge-flight-in 0.5s ease;
}
@keyframes nge-flight-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
.nge-flight-streaks { position: absolute; inset: 0; pointer-events: none; }

.nge-flight-corner {
  position: absolute;
  width: 46px; height: 46px;
  border: 1.4px solid rgba(53, 181, 255, 0.55);
  pointer-events: none;
  filter: drop-shadow(0 0 6px rgba(53, 181, 255, 0.35));
}
.nge-flight-corner--tl { top: 14px; left: 14px; border-right: none; border-bottom: none; }
.nge-flight-corner--tr { top: 14px; right: 14px; border-left: none; border-bottom: none; }
.nge-flight-corner--bl { bottom: 14px; left: 14px; border-right: none; border-top: none; }
.nge-flight-corner--br { bottom: 14px; right: 14px; border-left: none; border-top: none; }

.nge-flight-reticle {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0.9;
}
.nge-flight-reticle--hot { filter: drop-shadow(0 0 10px rgba(53, 181, 255, 0.7)); }

.nge-flight-top {
  position: absolute;
  top: 22px; left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  letter-spacing: 0.22em;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.nge-flight-sub {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: rgba(53, 181, 255, 0.85);
}
.nge-flight-rec {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #35b5ff;
  box-shadow: 0 0 8px rgba(53, 181, 255, 0.9);
  animation: nge-flight-blink 1.6s ease infinite;
}
@keyframes nge-flight-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

.nge-flight-key { color: rgba(53, 181, 255, 0.8); font-size: 9px; letter-spacing: 0.2em; margin-right: 4px; }
.nge-flight-speed {
  position: absolute;
  left: 26px; bottom: 56px;
  font-size: 15px;
  pointer-events: none;
}
.nge-flight-boost {
  margin-left: 8px;
  font-size: 9px;
  letter-spacing: 0.25em;
  color: #bfe6ff;
  text-shadow: 0 0 10px rgba(53, 181, 255, 0.9);
  animation: nge-flight-blink 0.5s ease infinite;
}
.nge-flight-pos {
  position: absolute;
  left: 26px; bottom: 30px;
  font-size: 11px;
  pointer-events: none;
  color: rgba(216, 238, 255, 0.75);
}
.nge-flight-hint {
  position: absolute;
  bottom: 18px; left: 50%;
  transform: translateX(-50%);
  font-family: 'Inter', sans-serif;
  font-size: 10.5px;
  color: rgba(216, 238, 255, 0.5);
  pointer-events: none;
  white-space: nowrap;
}
.nge-flight-exit {
  position: absolute;
  top: 18px; right: 22px;
  width: 30px; height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(53, 181, 255, 0.4);
  background: rgba(6, 10, 22, 0.7);
  color: rgba(216, 238, 255, 0.85);
  cursor: pointer;
  font-size: 13px;
}
.nge-flight-exit:hover { border-color: rgba(53, 181, 255, 0.8); box-shadow: 0 0 10px rgba(53, 181, 255, 0.35); }
</style>
