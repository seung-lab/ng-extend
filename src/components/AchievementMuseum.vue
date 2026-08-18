<script setup lang="ts">
/**
 * AchievementMuseum: a walkable CSS 3D gallery for earned achievements.
 *
 * Badges are displayed as holographic artifacts on projector pedestals in a
 * navy gallery hall. Arrow keys or WASD walk, drag looks around, Esc exits.
 * Curate mode lets the owner select an artifact, drag it around the floor,
 * and resize it with the scroll wheel. Layout persists to localStorage keyed
 * by user id so each researcher's museum keeps its arrangement.
 */
import {ref, computed, watch, onMounted, onUnmounted} from 'vue';
import {BadgeDefinition} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';

// Special badge awards arrive from Supabase joins; keep the shape loose.
interface SpecialAwardLike {
  id: number;
  reason?: string | null;
  awarded_at?: string | null;
  badge?: {
    name?: string;
    description?: string;
    slug?: string;
    image_url?: string | null;
    thumbnail_url?: string | null;
  } | null;
}

interface ArtifactPose {
  x: number;
  z: number;
  s: number;
}

interface MuseumArtifact {
  key: string;
  name: string;
  subtitle: string;
  desc: string;
  img: string;
  kind: 'building' | 'exploration' | 'special';
  home: {x: number; z: number};
}

const props = defineProps<{
  building: BadgeDefinition[];
  exploration: BadgeDefinition[];
  specials: SpecialAwardLike[];
  userId: string;
  userName: string;
  editable: boolean;
}>();

const emit = defineEmits<{(e: 'close'): void}>();

// ── Room geometry (1 unit = 1px at perspective 800) ──────────────────────────
const PERSP = 800;
const ROOM_W = 2200;
const ROOM_D = 6200;
const WALL_H = 560;
const FLOOR_Y = 180;   // eye level is y 0, floor sits 180 below
const CEIL_Y = FLOOR_Y - WALL_H;

// ── Persisted layout ─────────────────────────────────────────────────────────
const layoutKey = computed(() => `nge_museum_layout_v1_${props.userId || 'anon'}`);
const layout = ref<Record<string, ArtifactPose>>({});

function loadLayout() {
  try {
    const raw = localStorage.getItem(layoutKey.value);
    layout.value = raw ? JSON.parse(raw) : {};
  } catch {
    layout.value = {};
  }
}

let saveTimer = 0;
watch(layout, () => {
  if (!props.editable) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(layoutKey.value, JSON.stringify(layout.value));
    } catch {}
  }, 350);
}, {deep: true});

// ── Artifact list with default gallery placement ─────────────────────────────
function wallSlot(i: number, side: 1 | -1): {x: number; z: number} {
  const perLine = 12;
  const spacing = 430;
  const line = Math.floor(i / perLine);
  const slot = i % perLine;
  return {
    x: side * (860 - line * 290),
    z: -640 - slot * spacing - (line % 2 ? 215 : 0),
  };
}

const artifacts = computed<MuseumArtifact[]>(() => {
  const out: MuseumArtifact[] = [];
  props.building.forEach((b, i) => out.push({
    key: `b:${b.slug}`,
    name: b.name,
    subtitle: `BUILDING · ${b.threshold.toLocaleString()} ${b.threshold === 1 ? 'EDIT' : 'EDITS'}`,
    desc: b.description,
    img: BADGE_IMAGE_MAP[b.imageKey] ?? '',
    kind: 'building',
    home: wallSlot(i, -1),
  }));
  props.exploration.forEach((b, i) => out.push({
    key: `e:${b.slug}`,
    name: b.name,
    subtitle: `EXPLORATION · ${b.threshold.toLocaleString()} ${b.threshold === 1 ? 'CELL' : 'CELLS'}`,
    desc: b.description,
    img: BADGE_IMAGE_MAP[b.imageKey] ?? '',
    kind: 'exploration',
    home: wallSlot(i, 1),
  }));
  const manySpecials = props.specials.length > 4;
  props.specials.forEach((a, i) => out.push({
    key: `sp:${a.id}`,
    name: a.badge?.name || 'Special Award',
    subtitle: `SPECIAL AWARD${a.awarded_at ? ' · ' + formatDate(a.awarded_at) : ''}`,
    desc: (a.reason && a.reason.trim()) || a.badge?.description || 'Awarded by the EyeWire II team',
    img: a.badge?.thumbnail_url || a.badge?.image_url || '',
    kind: 'special',
    home: manySpecials
      ? {x: i % 2 ? 270 : -270, z: -900 - Math.floor(i / 2) * 560}
      : {x: 0, z: -900 - i * 560},
  }));
  return out;
});

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {month: 'short', year: 'numeric'});
  } catch {
    return '';
  }
}

function poseOf(a: MuseumArtifact): ArtifactPose {
  return layout.value[a.key] ?? {x: a.home.x, z: a.home.z, s: 1};
}

function artifactStyle(a: MuseumArtifact) {
  const p = poseOf(a);
  return {
    transform: `translate3d(${p.x}px, ${FLOOR_Y}px, ${p.z}px) rotateY(var(--mus-yaw)) scale3d(${p.s}, ${p.s}, ${p.s})`,
  };
}

/** Seed a mutable pose entry in the layout for the given key. */
function editablePose(key: string): ArtifactPose {
  if (!layout.value[key]) {
    const a = artifacts.value.find(x => x.key === key);
    layout.value[key] = a
      ? {x: a.home.x, z: a.home.z, s: 1}
      : {x: 0, z: -600, s: 1};
  }
  return layout.value[key];
}

// ── Camera + input ───────────────────────────────────────────────────────────
const cam = {x: 0, z: -140, yaw: 0, pitch: 0};
const keys = new Set<string>();
const editMode = ref(false);
const selectedKey = ref<string | null>(null);
const worldEl = ref<HTMLElement | null>(null);
const viewportEl = ref<HTMLElement | null>(null);

let intro = true;
let raf = 0;
let last = 0;

const MOVE_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'Equal', 'Minus', 'KeyR', 'KeyE',
]);

function clampCam() {
  cam.x = Math.max(-ROOM_W / 2 + 90, Math.min(ROOM_W / 2 - 90, cam.x));
  cam.z = Math.max(-ROOM_D + 90, Math.min(-90, cam.z));
  cam.pitch = Math.max(-34, Math.min(34, cam.pitch));
}

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
  last = now;

  if (intro) {
    cam.z += (-560 - cam.z) * Math.min(1, dt * 2.0);
    if (Math.abs(cam.z + 560) < 2 || keys.size > 0) intro = false;
  }

  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = (run ? 980 : 430) * dt;
  const turn = 130 * dt;
  const yr = cam.yaw * Math.PI / 180;
  const fwd = {x: Math.sin(yr), z: -Math.cos(yr)};
  const right = {x: Math.cos(yr), z: Math.sin(yr)};

  const sel = editMode.value && selectedKey.value ? editablePose(selectedKey.value) : null;
  if (sel) {
    // Arrow keys nudge the selected artifact, camera keeps WASD.
    const n = (run ? 680 : 280) * dt;
    if (keys.has('ArrowUp'))    { sel.x += fwd.x * n;   sel.z += fwd.z * n; }
    if (keys.has('ArrowDown'))  { sel.x -= fwd.x * n;   sel.z -= fwd.z * n; }
    if (keys.has('ArrowLeft'))  { sel.x -= right.x * n; sel.z -= right.z * n; }
    if (keys.has('ArrowRight')) { sel.x += right.x * n; sel.z += right.z * n; }
    if (keys.has('Equal')) sel.s = Math.min(2.6, sel.s + 1.1 * dt);
    if (keys.has('Minus')) sel.s = Math.max(0.45, sel.s - 1.1 * dt);
    sel.x = Math.max(-ROOM_W / 2 + 140, Math.min(ROOM_W / 2 - 140, sel.x));
    sel.z = Math.max(-ROOM_D + 160, Math.min(-240, sel.z));
  } else {
    if (keys.has('ArrowLeft'))  cam.yaw -= turn;
    if (keys.has('ArrowRight')) cam.yaw += turn;
    if (keys.has('ArrowUp'))    { cam.x += fwd.x * speed; cam.z += fwd.z * speed; }
    if (keys.has('ArrowDown'))  { cam.x -= fwd.x * speed; cam.z -= fwd.z * speed; }
  }

  if (keys.has('KeyW')) { cam.x += fwd.x * speed;   cam.z += fwd.z * speed; }
  if (keys.has('KeyS')) { cam.x -= fwd.x * speed;   cam.z -= fwd.z * speed; }
  if (keys.has('KeyA')) { cam.x -= right.x * speed; cam.z -= right.z * speed; }
  if (keys.has('KeyD')) { cam.x += right.x * speed; cam.z += right.z * speed; }

  clampCam();

  const w = worldEl.value;
  if (w) {
    w.style.transform =
      `translateZ(${PERSP}px) rotateX(${cam.pitch}deg) rotateY(${cam.yaw}deg) ` +
      `translate3d(${-cam.x}px, 0px, ${-cam.z}px)`;
    w.style.setProperty('--mus-yaw', `${-cam.yaw}deg`);
  }
  raf = requestAnimationFrame(tick);
}

// ── Pointer: drag to look, or drag artifacts in curate mode ──────────────────
let dragMode: 'none' | 'look' | 'artifact' = 'none';
let dragKey = '';
let dragStart = {px: 0, py: 0, x: 0, z: 0, yaw: 0, pitch: 0, k: 1};
let dragDist = 0;

function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  // HUD buttons keep their normal click behavior: capturing the pointer here
  // would swallow the click event they are about to receive.
  if (target.closest('.mus-hud-top, .mus-hud-selected, .mus-hud-help')) return;
  const hit = target.closest('[data-akey]') as HTMLElement | null;
  dragDist = 0;
  dragStart.px = e.clientX;
  dragStart.py = e.clientY;
  if (editMode.value && hit?.dataset.akey) {
    dragMode = 'artifact';
    dragKey = hit.dataset.akey;
    const p = editablePose(dragKey);
    dragStart.x = p.x;
    dragStart.z = p.z;
    const dist = Math.hypot(p.x - cam.x, p.z - cam.z);
    dragStart.k = Math.max(0.6, dist / PERSP);
  } else {
    dragMode = 'look';
    dragStart.yaw = cam.yaw;
    dragStart.pitch = cam.pitch;
  }
  viewportEl.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (dragMode === 'none') return;
  const dx = e.clientX - dragStart.px;
  const dy = e.clientY - dragStart.py;
  dragDist = Math.max(dragDist, Math.hypot(dx, dy));
  if (dragMode === 'look') {
    cam.yaw = dragStart.yaw - dx * 0.13;
    cam.pitch = dragStart.pitch + dy * 0.1;
    clampCam();
  } else if (dragMode === 'artifact') {
    const p = editablePose(dragKey);
    const yr = cam.yaw * Math.PI / 180;
    const k = dragStart.k;
    // Screen right follows the camera's right vector, screen up pushes away.
    p.x = dragStart.x + (dx * Math.cos(yr) - dy * Math.sin(yr)) * k;
    p.z = dragStart.z + (dx * Math.sin(yr) + dy * Math.cos(yr)) * k;
    p.x = Math.max(-ROOM_W / 2 + 140, Math.min(ROOM_W / 2 - 140, p.x));
    p.z = Math.max(-ROOM_D + 160, Math.min(-240, p.z));
  }
}

function onPointerUp(e: PointerEvent) {
  if (dragMode === 'artifact' && dragDist < 6) {
    selectedKey.value = selectedKey.value === dragKey ? null : dragKey;
  }
  dragMode = 'none';
  viewportEl.value?.releasePointerCapture(e.pointerId);
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (editMode.value && selectedKey.value) {
    const p = editablePose(selectedKey.value);
    p.s = Math.max(0.45, Math.min(2.6, p.s * (1 - e.deltaY * 0.0012)));
  } else {
    const yr = cam.yaw * Math.PI / 180;
    const step = -e.deltaY * 0.9;
    cam.x += Math.sin(yr) * step;
    cam.z += -Math.cos(yr) * step;
    clampCam();
  }
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (selectedKey.value) selectedKey.value = null;
    else if (editMode.value) editMode.value = false;
    else emit('close');
    return;
  }
  if (!MOVE_KEYS.has(e.code)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  if (e.code === 'KeyE' && props.editable) {
    toggleEdit();
    return;
  }
  if (e.code === 'KeyR' && editMode.value && selectedKey.value) {
    const a = artifacts.value.find(x => x.key === selectedKey.value);
    if (a) layout.value[a.key] = {x: a.home.x, z: a.home.z, s: 1};
    return;
  }
  keys.add(e.code);
}

function onKeyUp(e: KeyboardEvent) {
  keys.delete(e.code);
}

function onBlur() {
  keys.clear();
}

function toggleEdit() {
  editMode.value = !editMode.value;
  if (!editMode.value) selectedKey.value = null;
}

function resetLayout() {
  layout.value = {};
  selectedKey.value = null;
  try {
    localStorage.removeItem(layoutKey.value);
  } catch {}
}

const selectedArtifact = computed(() =>
  artifacts.value.find(a => a.key === selectedKey.value) ?? null);

onMounted(() => {
  loadLayout();
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  last = performance.now();
  raf = requestAnimationFrame(tick);
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  window.clearTimeout(saveTimer);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('blur', onBlur);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="viewportEl"
      class="nge-museum"
      :class="{'nge-museum--edit': editMode}"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @wheel="onWheel"
    >
      <!-- ── 3D world ── -->
      <div ref="worldEl" class="mus-world">
        <!-- Room shell -->
        <div class="mus-floor" :style="{width: ROOM_W + 'px', height: ROOM_D + 'px', transform: `translate3d(${-ROOM_W/2}px, ${FLOOR_Y}px, ${-ROOM_D}px) rotateX(90deg)`}"></div>
        <div class="mus-ceiling" :style="{width: ROOM_W + 'px', height: ROOM_D + 'px', transform: `translate3d(${-ROOM_W/2}px, ${CEIL_Y}px, ${-ROOM_D}px) rotateX(90deg)`}"></div>
        <div class="mus-wall mus-wall--left" :style="{width: ROOM_D + 'px', height: WALL_H + 'px', transform: `translate3d(${-ROOM_W/2}px, ${CEIL_Y}px, 0px) rotateY(90deg)`}"></div>
        <div class="mus-wall mus-wall--right" :style="{width: ROOM_D + 'px', height: WALL_H + 'px', transform: `translate3d(${ROOM_W/2}px, ${CEIL_Y}px, ${-ROOM_D}px) rotateY(-90deg)`}"></div>
        <div class="mus-wall mus-wall--back" :style="{width: ROOM_W + 'px', height: WALL_H + 'px', transform: `translate3d(${-ROOM_W/2}px, ${CEIL_Y}px, ${-ROOM_D}px)`}"></div>
        <div class="mus-wall mus-wall--front" :style="{width: ROOM_W + 'px', height: WALL_H + 'px', transform: `translate3d(${-ROOM_W/2}px, ${CEIL_Y}px, 0px) rotateY(180deg)`}"></div>

        <!-- Back wall inscription -->
        <div class="mus-inscription" :style="{transform: `translate3d(-600px, -270px, ${-ROOM_D + 6}px)`}">
          <div class="mus-inscription-title">HALL OF ACHIEVEMENTS</div>
          <div class="mus-inscription-sub">EYEWIRE II · CURATOR: {{ userName.toUpperCase() }}</div>
        </div>

        <!-- Artifacts -->
        <div
          v-for="(a, i) in artifacts"
          :key="a.key"
          class="mus-artifact"
          :class="[`mus-artifact--${a.kind}`, {'mus-artifact--selected': selectedKey === a.key}]"
          :data-akey="a.key"
          :style="artifactStyle(a)"
        >
          <div class="mus-beam"></div>
          <div class="mus-disc"></div>
          <div class="mus-float" :style="{animationDelay: `${(i % 9) * -0.7}s`}">
            <img v-if="a.img" class="mus-badge-img" :src="a.img" :alt="a.name" draggable="false" />
            <div v-else class="mus-badge-fallback">✦</div>
          </div>
          <div class="mus-plaque">
            <div class="mus-plaque-name">{{ a.name }}</div>
            <div class="mus-plaque-sub">{{ a.subtitle }}</div>
            <div class="mus-plaque-desc">{{ a.desc }}</div>
          </div>
        </div>

        <!-- Empty museum message -->
        <div v-if="artifacts.length === 0" class="mus-empty" :style="{transform: `translate3d(-300px, -120px, -1400px)`}">
          <div class="mus-empty-title">THE HALL AWAITS</div>
          <div class="mus-empty-sub">Earn badges to fill your museum with artifacts.</div>
        </div>
      </div>

      <!-- ── HUD ── -->
      <div class="mus-vignette"></div>
      <div class="mus-hud-top">
        <div class="mus-hud-title">◈ ACHIEVEMENT MUSEUM</div>
        <div class="mus-hud-count">{{ artifacts.length }} ARTIFACTS ON DISPLAY</div>
        <div class="mus-hud-actions">
          <button v-if="editable" class="mus-btn" :class="{'mus-btn--active': editMode}" @click="toggleEdit">
            {{ editMode ? '✓ Done curating' : '⬡ Curate' }}
          </button>
          <button v-if="editMode" class="mus-btn" @click="resetLayout">Reset layout</button>
          <button class="mus-btn mus-btn--exit" @click="emit('close')">✕ Exit</button>
        </div>
      </div>

      <div v-if="editMode && selectedArtifact" class="mus-hud-selected">
        <span class="mus-hud-selected-name">{{ selectedArtifact.name }}</span>
        <span>drag to move · scroll to resize · R to reset · Esc to deselect</span>
      </div>

      <div class="mus-hud-help">
        <template v-if="editMode">
          CURATE MODE: click an artifact to select · drag it across the floor · scroll resizes · arrows nudge
        </template>
        <template v-else>
          ARROWS or WASD: walk · SHIFT: run · DRAG: look around · SCROLL: glide · ESC: exit
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ══════════════════════════════════════════════════════════════════════════
   ACHIEVEMENT MUSEUM · holographic gallery hall
   ══════════════════════════════════════════════════════════════════════════ */

.nge-museum {
  position: fixed;
  inset: 0;
  z-index: 9500;
  overflow: hidden;
  perspective: 800px;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(10, 22, 44, 0.9) 0%, rgba(2, 5, 12, 0.98) 70%),
    #02050c;
  cursor: grab;
  user-select: none;
  touch-action: none;
  animation: musFadeIn 0.5s ease-out;
}
.nge-museum:active { cursor: grabbing; }
.nge-museum--edit { cursor: default; }

@keyframes musFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.mus-world {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-style: preserve-3d;
  will-change: transform;
}

/* ── Room shell ── */
.mus-floor, .mus-ceiling, .mus-wall {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  backface-visibility: hidden;
}

.mus-floor {
  background:
    linear-gradient(90deg, transparent 46.5%, rgba(53, 181, 255, 0.10) 48.5%, rgba(120, 220, 255, 0.16) 50%, rgba(53, 181, 255, 0.10) 51.5%, transparent 53.5%),
    linear-gradient(rgba(53, 181, 255, 0.075) 1px, transparent 1px),
    linear-gradient(90deg, rgba(53, 181, 255, 0.075) 1px, transparent 1px),
    linear-gradient(180deg, rgba(6, 14, 30, 0.99), rgba(3, 8, 18, 0.99));
  background-size: 100% 100%, 146px 146px, 146px 146px, 100% 100%;
}

.mus-ceiling {
  background:
    repeating-linear-gradient(to bottom, transparent 0 190px, rgba(120, 210, 255, 0.10) 190px 210px, transparent 210px 420px),
    linear-gradient(180deg, rgba(3, 7, 16, 0.99), rgba(2, 5, 12, 0.99));
}

.mus-wall {
  background:
    linear-gradient(to bottom, transparent calc(100% - 3px), rgba(53, 181, 255, 0.35) calc(100% - 1px)),
    linear-gradient(to bottom, rgba(53, 181, 255, 0.22) 1px, transparent 3px),
    linear-gradient(rgba(53, 181, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(53, 181, 255, 0.05) 1px, transparent 1px),
    linear-gradient(180deg, rgba(7, 14, 30, 0.97) 0%, rgba(4, 9, 20, 0.98) 100%);
  background-size: 100% 100%, 100% 100%, 140px 140px, 140px 140px, 100% 100%;
}

.mus-wall--back {
  background:
    radial-gradient(ellipse at 50% 55%, rgba(53, 181, 255, 0.12) 0%, transparent 60%),
    linear-gradient(to bottom, transparent calc(100% - 3px), rgba(53, 181, 255, 0.35) calc(100% - 1px)),
    linear-gradient(180deg, rgba(7, 14, 30, 0.98) 0%, rgba(4, 9, 20, 0.99) 100%);
}

/* ── Back wall inscription ── */
.mus-inscription {
  position: absolute;
  left: 0;
  top: 0;
  width: 1200px;
  text-align: center;
  pointer-events: none;
}
.mus-inscription-title {
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 64px;
  font-weight: 700;
  letter-spacing: 14px;
  color: rgba(160, 225, 255, 0.9);
  text-shadow:
    0 0 18px rgba(53, 181, 255, 0.85),
    0 0 60px rgba(53, 181, 255, 0.5);
}
.mus-inscription-sub {
  margin-top: 14px;
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 8px;
  color: rgba(120, 190, 235, 0.6);
  text-shadow: 0 0 12px rgba(53, 181, 255, 0.4);
}

/* ── Artifacts ── */
.mus-artifact {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}

/* Spotlight cone from the ceiling */
.mus-beam {
  position: absolute;
  left: -105px;
  top: -560px;
  width: 210px;
  height: 560px;
  clip-path: polygon(47% 0, 53% 0, 100% 100%, 0 100%);
  background: linear-gradient(to bottom,
    rgba(150, 225, 255, 0.20) 0%,
    rgba(53, 181, 255, 0.07) 60%,
    rgba(53, 181, 255, 0.01) 100%);
  pointer-events: none;
}

/* Projector rings on the floor */
.mus-disc {
  position: absolute;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  transform: translate3d(-95px, -2px, -95px) rotateX(90deg);
  background:
    radial-gradient(circle, rgba(120, 220, 255, 0.5) 0%, rgba(53, 181, 255, 0.16) 18%, transparent 34%),
    radial-gradient(circle, transparent 52%, rgba(53, 181, 255, 0.4) 54%, transparent 57%),
    radial-gradient(circle, transparent 72%, rgba(53, 181, 255, 0.25) 74%, transparent 77%),
    radial-gradient(circle, transparent 92%, rgba(53, 181, 255, 0.35) 95%, transparent 98%);
  pointer-events: none;
}

/* The floating relic itself */
.mus-float {
  position: absolute;
  left: -80px;
  top: -330px;
  width: 160px;
  height: 160px;
  animation: musBob 6s ease-in-out infinite;
  pointer-events: none;
}
.mus-badge-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 0 16px rgba(53, 181, 255, 0.55)) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.6));
}
.mus-badge-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 84px;
  color: rgba(150, 225, 255, 0.9);
  text-shadow: 0 0 28px rgba(53, 181, 255, 0.8);
}

@keyframes musBob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-16px); }
}

/* Name plaque */
.mus-plaque {
  position: absolute;
  left: -110px;
  top: -145px;
  width: 220px;
  padding: 10px 12px 12px;
  text-align: center;
  background: linear-gradient(160deg, rgba(8, 18, 38, 0.88), rgba(5, 11, 24, 0.92));
  border: 1px solid rgba(53, 181, 255, 0.35);
  border-radius: 6px;
  box-shadow:
    0 0 18px rgba(53, 181, 255, 0.18),
    inset 0 0 22px rgba(53, 181, 255, 0.07);
  pointer-events: none;
}
.mus-plaque-name {
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 2px;
  color: rgba(190, 235, 255, 0.95);
  text-shadow: 0 0 10px rgba(53, 181, 255, 0.6);
  text-transform: uppercase;
}
.mus-plaque-sub {
  margin-top: 4px;
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 2px;
  color: rgba(110, 185, 230, 0.85);
}
.mus-plaque-desc {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.35;
  color: rgba(170, 200, 225, 0.72);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Track accents */
.mus-artifact--building .mus-plaque-sub { color: rgba(255, 208, 138, 0.85); }
.mus-artifact--building .mus-disc {
  background:
    radial-gradient(circle, rgba(255, 220, 160, 0.45) 0%, rgba(255, 190, 90, 0.14) 18%, transparent 34%),
    radial-gradient(circle, transparent 52%, rgba(255, 190, 90, 0.35) 54%, transparent 57%),
    radial-gradient(circle, transparent 72%, rgba(255, 190, 90, 0.2) 74%, transparent 77%),
    radial-gradient(circle, transparent 92%, rgba(255, 190, 90, 0.3) 95%, transparent 98%);
}
.mus-artifact--exploration .mus-plaque-sub { color: rgba(144, 255, 242, 0.85); }
.mus-artifact--exploration .mus-disc {
  background:
    radial-gradient(circle, rgba(160, 255, 242, 0.45) 0%, rgba(80, 230, 210, 0.14) 18%, transparent 34%),
    radial-gradient(circle, transparent 52%, rgba(80, 230, 210, 0.35) 54%, transparent 57%),
    radial-gradient(circle, transparent 72%, rgba(80, 230, 210, 0.2) 74%, transparent 77%),
    radial-gradient(circle, transparent 92%, rgba(80, 230, 210, 0.3) 95%, transparent 98%);
}
.mus-artifact--special .mus-plaque {
  border-color: rgba(206, 147, 216, 0.5);
  box-shadow:
    0 0 18px rgba(206, 147, 216, 0.22),
    inset 0 0 22px rgba(206, 147, 216, 0.08);
}
.mus-artifact--special .mus-plaque-sub { color: rgba(226, 180, 235, 0.9); }
.mus-artifact--special .mus-beam {
  background: linear-gradient(to bottom,
    rgba(235, 190, 255, 0.32) 0%,
    rgba(206, 147, 216, 0.10) 60%,
    rgba(206, 147, 216, 0.02) 100%);
}
.mus-artifact--special .mus-disc {
  background:
    radial-gradient(circle, rgba(235, 195, 245, 0.5) 0%, rgba(206, 147, 216, 0.16) 18%, transparent 34%),
    radial-gradient(circle, transparent 52%, rgba(206, 147, 216, 0.4) 54%, transparent 57%),
    radial-gradient(circle, transparent 72%, rgba(206, 147, 216, 0.25) 74%, transparent 77%),
    radial-gradient(circle, transparent 92%, rgba(206, 147, 216, 0.35) 95%, transparent 98%);
}

/* Curate mode affordances. Artifact children are click-transparent while
   walking so drags always look around; curate mode makes them grabbable. */
.nge-museum--edit .mus-artifact { cursor: move; }
.nge-museum--edit .mus-float,
.nge-museum--edit .mus-plaque,
.nge-museum--edit .mus-disc { pointer-events: auto; }
.nge-museum--edit .mus-plaque::after {
  content: '⬡ click to curate';
  display: block;
  margin-top: 5px;
  font-size: 9px;
  letter-spacing: 1.5px;
  color: rgba(53, 181, 255, 0.55);
  font-family: 'Orbitron', sans-serif;
}
.mus-artifact--selected .mus-plaque {
  border-color: rgba(140, 230, 255, 0.95);
  box-shadow:
    0 0 26px rgba(53, 181, 255, 0.55),
    inset 0 0 26px rgba(53, 181, 255, 0.16);
}
.mus-artifact--selected .mus-plaque::after {
  content: '⬡ selected';
  color: rgba(140, 230, 255, 0.95);
}
.mus-artifact--selected .mus-badge-img {
  filter: drop-shadow(0 0 26px rgba(120, 220, 255, 0.95)) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.6));
}
.mus-artifact--selected .mus-disc {
  animation: musDiscPulse 1.6s ease-in-out infinite;
}
@keyframes musDiscPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

/* Empty state */
.mus-empty {
  position: absolute;
  width: 600px;
  text-align: center;
  pointer-events: none;
}
.mus-empty-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 8px;
  color: rgba(160, 225, 255, 0.85);
  text-shadow: 0 0 18px rgba(53, 181, 255, 0.7);
}
.mus-empty-sub {
  margin-top: 10px;
  font-size: 15px;
  color: rgba(150, 190, 220, 0.7);
}

/* ── HUD ── */
.mus-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(1, 3, 8, 0.55) 100%);
}
.nge-museum--edit .mus-vignette {
  box-shadow: inset 0 0 0 2px rgba(53, 181, 255, 0.45), inset 0 0 60px rgba(53, 181, 255, 0.12);
}

.mus-hud-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 20px;
  background: linear-gradient(to bottom, rgba(2, 6, 14, 0.85), transparent);
}
.mus-hud-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 4px;
  color: rgba(190, 235, 255, 0.95);
  text-shadow: 0 0 12px rgba(53, 181, 255, 0.7);
}
.mus-hud-count {
  font-family: 'Orbitron', sans-serif;
  font-size: 10px;
  letter-spacing: 3px;
  color: rgba(110, 185, 230, 0.75);
}
.mus-hud-actions {
  margin-left: auto;
  display: flex;
  gap: 10px;
}
.mus-btn {
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  letter-spacing: 2px;
  padding: 7px 14px;
  color: rgba(190, 235, 255, 0.9);
  background: rgba(10, 24, 48, 0.75);
  border: 1px solid rgba(53, 181, 255, 0.4);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mus-btn:hover {
  background: rgba(20, 44, 80, 0.9);
  box-shadow: 0 0 14px rgba(53, 181, 255, 0.4);
}
.mus-btn--active {
  background: rgba(53, 181, 255, 0.22);
  border-color: rgba(140, 230, 255, 0.9);
  box-shadow: 0 0 16px rgba(53, 181, 255, 0.5);
}
.mus-btn--exit { border-color: rgba(255, 120, 130, 0.45); }
.mus-btn--exit:hover { box-shadow: 0 0 14px rgba(255, 120, 130, 0.4); }

.mus-hud-selected {
  position: absolute;
  top: 62px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 8px 16px;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(150, 200, 235, 0.85);
  background: rgba(6, 14, 30, 0.85);
  border: 1px solid rgba(53, 181, 255, 0.45);
  border-radius: 5px;
  pointer-events: none;
}
.mus-hud-selected-name {
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  letter-spacing: 2px;
  color: rgba(190, 235, 255, 1);
  text-transform: uppercase;
}

.mus-hud-help {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 14px 20px 16px;
  text-align: center;
  font-family: 'Orbitron', sans-serif;
  font-size: 10px;
  letter-spacing: 2.5px;
  color: rgba(120, 190, 235, 0.7);
  background: linear-gradient(to top, rgba(2, 6, 14, 0.85), transparent);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .mus-float, .mus-artifact--selected .mus-disc { animation: none; }
}
</style>
