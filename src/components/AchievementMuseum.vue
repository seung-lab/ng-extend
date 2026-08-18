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
import {getMuseumWireframe, MuseumWireframe} from '../util/museum_mesh';

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

interface BigPictureStats {
  editsAllTime?: number;
  mergesAllTime?: number;
  splitsAllTime?: number;
  cellsSubmitted?: number;
  currentStreak?: number;
  longestStreak?: number;
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
  stats?: BigPictureStats | null;
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
  // The museum uses the 320px downsampled art set: full res center-art PNGs
  // are 1024px and ~1.6MB each, far more than a 160px pedestal needs.
  const smallArt = (key: string) =>
    (BADGE_IMAGE_MAP[key] ?? '').replace('center-art/', 'center-art-320/');
  props.building.forEach((b, i) => out.push({
    key: `b:${b.slug}`,
    name: b.name,
    subtitle: `BUILDING · ${b.threshold.toLocaleString()} ${b.threshold === 1 ? 'EDIT' : 'EDITS'}`,
    desc: b.description,
    img: smallArt(b.imageKey),
    kind: 'building',
    home: wallSlot(i, -1),
  }));
  props.exploration.forEach((b, i) => out.push({
    key: `e:${b.slug}`,
    name: b.name,
    subtitle: `EXPLORATION · ${b.threshold.toLocaleString()} ${b.threshold === 1 ? 'CELL' : 'CELLS'}`,
    desc: b.description,
    img: smallArt(b.imageKey),
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

// Touch devices get an on-screen joystick and resize buttons.
const isTouch = window.matchMedia('(pointer: coarse)').matches;

// ── Real specimen in the sky ─────────────────────────────────────────────────
// Amy's wide field amacrine cell from the stroeh retina. Downloaded through
// the viewer's own authenticated mesh pipeline, decimated, cached locally.
// While it loads (or if it can't), the hand drawn SVG neuron stands in.
const SPECIMEN_SEG_ID = '720575940569107563';
const SPECIMEN_LABEL = 'WIDE FIELD AMACRINE · STROEH RETINA';
const wireframe = ref<MuseumWireframe | null>(null);
const specimenState = ref<'loading' | 'live' | 'fallback'>('loading');
const neuronCanvasEl = ref<HTMLCanvasElement | null>(null);

function drawSpecimen(now: number) {
  const canvas = neuronCanvasEl.value;
  const wf = wireframe.value;
  if (!canvas || !wf) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const spin = now * 0.00009;
  const ca = Math.cos(spin), sa = Math.sin(spin);
  const tilt = 0.42;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const v = wf.verts;
  const n = Math.floor(v.length / 3);
  const px = new Float32Array(n), py = new Float32Array(n);
  const sc = Math.min(W, H) / 2400;
  for (let i = 0; i < n; i++) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    const rx = x * ca + z * sa;
    const rz = -x * sa + z * ca;
    const ry = y * ct - rz * st;
    px[i] = W / 2 + rx * sc;
    py[i] = H / 2 + ry * sc;
  }
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const e = wf.edges;
  for (const pass of [{w: 7, c: 'rgba(53, 181, 255, 0.09)'}, {w: 1.5, c: 'rgba(160, 230, 255, 0.75)'}]) {
    ctx.lineWidth = pass.w;
    ctx.strokeStyle = pass.c;
    ctx.beginPath();
    for (let i = 0; i + 1 < e.length; i += 2) {
      ctx.moveTo(px[e[i]], py[e[i]]);
      ctx.lineTo(px[e[i + 1]], py[e[i + 1]]);
    }
    ctx.stroke();
  }
}
const joyEl = ref<HTMLElement | null>(null);
const joyKnobEl = ref<HTMLElement | null>(null);
const joy = {active: false, id: -1, x: 0, y: 0};

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

  if (joy.active) {
    cam.x += (fwd.x * -joy.y + right.x * joy.x) * speed;
    cam.z += (fwd.z * -joy.y + right.z * joy.x) * speed;
  }

  clampCam();

  const w = worldEl.value;
  if (w) {
    w.style.transform =
      `translateZ(${PERSP}px) rotateX(${cam.pitch}deg) rotateY(${cam.yaw}deg) ` +
      `translate3d(${-cam.x}px, 0px, ${-cam.z}px)`;
    w.style.setProperty('--mus-yaw', `${-cam.yaw}deg`);
  }
  if (++lodCounter % 20 === 0) updateLod();
  if (wireframe.value && (lodCounter & 1) === 0) drawSpecimen(now);
  raf = requestAnimationFrame(tick);
}

// ── Pointer: drag to look, or drag artifacts in curate mode ──────────────────
let dragMode: 'none' | 'look' | 'artifact' = 'none';
let dragKey = '';
let dragStart = {px: 0, py: 0, x: 0, z: 0, yaw: 0, pitch: 0, k: 1, id: -1};
let dragDist = 0;

function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  // HUD buttons keep their normal click behavior: capturing the pointer here
  // would swallow the click event they are about to receive. The joystick
  // manages its own pointer. A second finger never steals an active drag.
  if (target.closest('.mus-hud-top, .mus-hud-selected, .mus-hud-help, .mus-joystick, .mus-door')) return;
  if (dragMode !== 'none') return;
  dragStart.id = e.pointerId;
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
  if (dragMode === 'none' || e.pointerId !== dragStart.id) return;
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
  if (e.pointerId !== dragStart.id) return;
  if (dragMode === 'artifact' && dragDist < 6) {
    selectedKey.value = selectedKey.value === dragKey ? null : dragKey;
  }
  dragMode = 'none';
  dragStart.id = -1;
  viewportEl.value?.releasePointerCapture(e.pointerId);
}

// ── On-screen joystick (touch) ───────────────────────────────────────────────
function joyDown(e: PointerEvent) {
  e.stopPropagation();
  e.preventDefault();
  joy.active = true;
  joy.id = e.pointerId;
  joyEl.value?.setPointerCapture(e.pointerId);
  joyMove(e);
}

function joyMove(e: PointerEvent) {
  if (!joy.active || e.pointerId !== joy.id) return;
  const el = joyEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  joy.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
  joy.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
  const k = joyKnobEl.value;
  if (k) k.style.transform = `translate(${joy.x * 30}px, ${joy.y * 30}px)`;
}

function joyUp(e: PointerEvent) {
  if (e.pointerId !== joy.id) return;
  joy.active = false;
  joy.id = -1;
  joy.x = 0;
  joy.y = 0;
  const k = joyKnobEl.value;
  if (k) k.style.transform = '';
}

/** Resize the selected artifact from the HUD buttons (touch friendly). */
function scaleSelected(factor: number) {
  if (!selectedKey.value) return;
  const p = editablePose(selectedKey.value);
  p.s = Math.max(0.45, Math.min(2.6, p.s * factor));
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

// ── Distance based level of detail ───────────────────────────────────────────
// Only the nearest handful of artifacts run the bobbing animation, and
// artifacts far beyond the fog line stop painting entirely.
const artifactByKey = computed(() => new Map(artifacts.value.map(a => [a.key, a])));
let lodCounter = 0;

function updateLod() {
  const els = worldEl.value?.querySelectorAll('[data-akey]') as NodeListOf<HTMLElement> | undefined;
  if (!els) return;
  const scored: {el: HTMLElement; d: number}[] = [];
  els.forEach(el => {
    const a = artifactByKey.value.get(el.dataset.akey || '');
    const p = a ? poseOf(a) : null;
    const d = p ? Math.hypot(p.x - cam.x, p.z - cam.z) : Infinity;
    el.classList.toggle('mus-artifact--far', d > 4800);
    scored.push({el, d});
  });
  scored.sort((a, b) => a.d - b.d);
  scored.forEach((s, i) => s.el.classList.toggle('mus-artifact--near', i < 6 && s.d < 1800));
}

// ── Big picture stats for the side wall ──────────────────────────────────────
const statsRows = computed(() => {
  const s = props.stats || {};
  const n = (v: number | undefined) => (v ?? 0).toLocaleString();
  const streak = s.longestStreak ?? 0;
  return [
    {label: 'EDITS ALL TIME', value: n(s.editsAllTime)},
    {label: 'CELLS COMPLETED', value: n(s.cellsSubmitted)},
    {label: 'MERGES', value: n(s.mergesAllTime)},
    {label: 'SPLITS', value: n(s.splitsAllTime)},
    {label: streak === 1 ? 'DAY LONGEST STREAK' : 'DAYS LONGEST STREAK', value: n(streak)},
  ];
});

// The viewport meta lives only while the museum is open: adding it globally
// to index.html changes page scaling for the whole app, and the app's 3D
// viewport is not ours to resize. Scoped here, phones still get proper
// scaling for the museum walkthrough.
let injectedViewportMeta: HTMLMetaElement | null = null;

onMounted(() => {
  if (!document.querySelector('meta[name="viewport"]')) {
    injectedViewportMeta = document.createElement('meta');
    injectedViewportMeta.name = 'viewport';
    injectedViewportMeta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    document.head.appendChild(injectedViewportMeta);
  }
  loadLayout();
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  last = performance.now();
  raf = requestAnimationFrame(tick);
  getMuseumWireframe(SPECIMEN_SEG_ID).then(wf => {
    wireframe.value = wf;
    specimenState.value = wf ? 'live' : 'fallback';
  }).catch(() => {
    specimenState.value = 'fallback';
  });
});

onUnmounted(() => {
  injectedViewportMeta?.remove();
  injectedViewportMeta = null;
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
        <div class="mus-wall mus-wall--left" :style="{width: ROOM_D + 'px', height: WALL_H + 'px', transform: `translate3d(${-ROOM_W/2}px, ${CEIL_Y}px, 0px) rotateY(90deg)`}"></div>
        <div class="mus-wall mus-wall--right" :style="{width: ROOM_D + 'px', height: WALL_H + 'px', transform: `translate3d(${ROOM_W/2}px, ${CEIL_Y}px, ${-ROOM_D}px) rotateY(-90deg)`}"></div>
        <div class="mus-wall mus-wall--back" :style="{width: ROOM_W + 'px', height: WALL_H + 'px', transform: `translate3d(${-ROOM_W/2}px, ${CEIL_Y}px, ${-ROOM_D}px)`}"></div>
        <div class="mus-wall mus-wall--front" :style="{width: ROOM_W + 'px', height: WALL_H + 'px', transform: `translate3d(${ROOM_W/2}px, ${CEIL_Y}px, 0px) rotateY(180deg)`}"></div>

        <!-- Back wall inscription -->
        <div class="mus-inscription" :style="{transform: `translate3d(-600px, -270px, ${-ROOM_D + 6}px)`}">
          <div class="mus-inscription-title">HALL OF ACHIEVEMENTS</div>
          <div class="mus-inscription-sub">EYEWIRE II · CURATOR: {{ userName.toUpperCase() }}</div>
        </div>

        <!-- Giant hologram neuron in the open sky above the hall: the real
             specimen mesh when it loads, the hand drawn one until then -->
        <div class="mus-neuron" :style="{transform: `translate3d(0px, ${CEIL_Y - 700}px, ${-ROOM_D / 2}px) rotateY(var(--mus-yaw))`}">
          <canvas v-if="wireframe" ref="neuronCanvasEl" class="mus-neuron-canvas" width="1400" height="900"></canvas>
          <svg v-else class="mus-neuron-svg" viewBox="0 0 1200 760" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g class="mus-neuron-layer mus-neuron-layer--glow">
              <use href="#musNeuronPaths" />
            </g>
            <g class="mus-neuron-layer mus-neuron-layer--line">
              <g id="musNeuronPaths">
                <!-- soma wireframe -->
                <ellipse cx="600" cy="400" rx="72" ry="64" />
                <ellipse cx="600" cy="400" rx="72" ry="26" />
                <ellipse cx="600" cy="400" rx="30" ry="64" />
                <circle cx="600" cy="400" r="18" />
                <!-- dendrites -->
                <path d="M585 340 C560 285 525 245 475 205 M475 205 C445 175 420 155 400 130 M475 205 C495 170 505 145 512 118 M400 130 C382 110 366 96 352 84 M512 118 C520 98 530 82 545 66" />
                <path d="M640 348 C680 295 715 250 758 214 M758 214 C790 186 815 168 838 148 M758 214 C740 178 736 152 738 122 M838 148 C860 132 878 120 900 108" />
                <path d="M532 388 C465 375 405 355 342 330 M342 330 C300 314 268 302 234 296 M342 330 C320 356 302 372 282 392 M234 296 C210 292 190 288 168 290" />
                <path d="M560 456 C520 515 478 560 428 606 M428 606 C395 636 368 658 344 686 M428 606 C450 640 460 664 466 692 M344 686 C328 704 314 718 296 728" />
                <path d="M618 468 C630 535 622 595 600 652 M600 652 C588 685 574 708 556 728 M600 652 C622 680 636 700 648 724" />
                <!-- axon with terminal arbor -->
                <path d="M668 416 C760 442 850 448 950 440 C1020 434 1070 428 1108 422 M1108 422 C1130 408 1146 394 1162 376 M1108 422 C1132 430 1150 442 1166 458 M1162 376 C1172 364 1180 354 1190 346 M1166 458 C1176 468 1184 478 1192 488" />
              </g>
            </g>
            <g class="mus-neuron-nodes">
              <circle cx="352" cy="84" r="5" /><circle cx="545" cy="66" r="5" />
              <circle cx="900" cy="108" r="5" /><circle cx="738" cy="122" r="4" />
              <circle cx="168" cy="290" r="5" /><circle cx="282" cy="392" r="4" />
              <circle cx="296" cy="728" r="5" /><circle cx="466" cy="692" r="4" />
              <circle cx="556" cy="728" r="4" /><circle cx="648" cy="724" r="4" />
              <circle cx="1190" cy="346" r="5" /><circle cx="1192" cy="488" r="5" />
            </g>
          </svg>
        </div>

        <!-- Exit door on the entrance wall -->
        <div class="mus-door" :style="{transform: `translate3d(190px, ${FLOOR_Y - 470}px, -2px) rotateY(180deg)`}" @click="emit('close')">
          <div class="mus-door-arch"></div>
          <div class="mus-door-glow"></div>
          <div class="mus-door-label">EXIT</div>
          <div class="mus-door-sub">BACK TO EYEWIRE 2</div>
          <div class="mus-door-chevrons">⌃</div>
        </div>

        <!-- Big picture stats on the left wall, right where you walk in -->
        <div class="mus-wallstats" :style="{transform: `translate3d(${-ROOM_W / 2 + 8}px, -330px, -500px) rotateY(90deg)`}">
          <div class="mus-wallstats-title">CAREER TELEMETRY</div>
          <div class="mus-wallstats-row">
            <div v-for="row in statsRows" :key="row.label" class="mus-wallstats-item">
              <div class="mus-wallstats-value">{{ row.value }}</div>
              <div class="mus-wallstats-label">{{ row.label }}</div>
            </div>
          </div>
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
        <div v-if="specimenState === 'loading'" class="mus-hud-specimen">◌ SUMMONING SPECIMEN...</div>
        <div v-else-if="specimenState === 'live'" class="mus-hud-specimen">◉ SPECIMEN: {{ SPECIMEN_LABEL }}</div>
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
        <button class="mus-btn mus-btn--size" @click="scaleSelected(1 / 1.18)">−</button>
        <button class="mus-btn mus-btn--size" @click="scaleSelected(1.18)">+</button>
        <span v-if="!isTouch">drag to move · scroll to resize · R to reset · Esc to deselect</span>
        <span v-else>drag to move · tap again to deselect</span>
      </div>

      <div class="mus-hud-help">
        <template v-if="editMode && isTouch">
          CURATE MODE: tap an artifact to select · drag it across the floor · resize with − +
        </template>
        <template v-else-if="editMode">
          CURATE MODE: click an artifact to select · drag it across the floor · scroll resizes · arrows nudge
        </template>
        <template v-else-if="isTouch">
          JOYSTICK: walk · DRAG: look around
        </template>
        <template v-else>
          ARROWS or WASD: walk · SHIFT: run · DRAG: look around · SCROLL: glide · ESC: exit
        </template>
      </div>

      <div
        v-if="isTouch"
        ref="joyEl"
        class="mus-joystick"
        @pointerdown="joyDown"
        @pointermove="joyMove"
        @pointerup="joyUp"
        @pointercancel="joyUp"
      >
        <div ref="joyKnobEl" class="mus-joystick-knob"></div>
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
  /* Teleported to body, so set the type stack explicitly or descriptions
     fall back to the browser's serif default. */
  font-family: 'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif;
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

/* ── Room shell (open sky: no ceiling, the neuron hovers above) ── */
.mus-floor, .mus-wall {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  backface-visibility: hidden;
}

/* Grid lines get soft edges: hard 1px stops shimmer and flash while the
   camera moves, soft falloffs stay calm. */
.mus-floor {
  background:
    linear-gradient(90deg, transparent 46.5%, rgba(53, 181, 255, 0.10) 48.5%, rgba(120, 220, 255, 0.16) 50%, rgba(53, 181, 255, 0.10) 51.5%, transparent 53.5%),
    linear-gradient(rgba(53, 181, 255, 0.08) 0, rgba(53, 181, 255, 0.08) 1px, rgba(53, 181, 255, 0.02) 2px, transparent 3.5px),
    linear-gradient(90deg, rgba(53, 181, 255, 0.08) 0, rgba(53, 181, 255, 0.08) 1px, rgba(53, 181, 255, 0.02) 2px, transparent 3.5px),
    linear-gradient(180deg, rgba(6, 14, 30, 0.99), rgba(3, 8, 18, 0.99));
  background-size: 100% 100%, 146px 146px, 146px 146px, 100% 100%;
}

.mus-wall {
  background:
    linear-gradient(to bottom, transparent calc(100% - 4px), rgba(53, 181, 255, 0.30) calc(100% - 1px)),
    linear-gradient(to bottom, rgba(53, 181, 255, 0.20) 0, rgba(53, 181, 255, 0.06) 3px, transparent 6px),
    linear-gradient(rgba(53, 181, 255, 0.045) 0, rgba(53, 181, 255, 0.045) 1px, transparent 3px),
    linear-gradient(90deg, rgba(53, 181, 255, 0.045) 0, rgba(53, 181, 255, 0.045) 1px, transparent 3px),
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
  top: -540px;
  width: 210px;
  height: 540px;
  clip-path: polygon(47% 0, 53% 0, 100% 100%, 0 100%);
  background: linear-gradient(to bottom,
    rgba(150, 225, 255, 0.15) 0%,
    rgba(53, 181, 255, 0.055) 60%,
    rgba(53, 181, 255, 0.01) 100%);
  pointer-events: none;
  backface-visibility: hidden;
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
  pointer-events: none;
  backface-visibility: hidden;
}
/* Only the nearest artifacts animate; a hall of 60 bobbing layers janks. */
.mus-artifact--near .mus-float {
  animation: musBob 7.5s ease-in-out infinite;
}
.mus-artifact--far {
  visibility: hidden;
}
.mus-badge-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 0 14px rgba(53, 181, 255, 0.5));
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
  50%      { transform: translateY(-6px); }
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
  filter: drop-shadow(0 0 24px rgba(120, 220, 255, 0.9));
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
}
.mus-btn--size {
  padding: 4px 12px;
  font-size: 14px;
  line-height: 1;
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

/* ── Giant sky neuron ── */
.mus-neuron {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
/* Kept below 2500px and unanimated: a huge always-pulsing layer is a
   constant compositor tax and a glitch source. */
.mus-neuron-svg {
  position: absolute;
  left: -1200px;
  top: -758px;
  width: 2400px;
  height: 1516px;
  overflow: visible;
  opacity: 0.85;
}
.mus-neuron-layer { stroke: rgb(120, 220, 255); fill: none; stroke-linecap: round; }
.mus-neuron-layer--glow { stroke: rgba(53, 181, 255, 0.30); stroke-width: 15; }
.mus-neuron-layer--line { stroke-width: 3.5; opacity: 0.92; }
.mus-neuron-nodes circle {
  fill: rgba(160, 230, 255, 0.95);
  stroke: rgba(53, 181, 255, 0.5);
  stroke-width: 6;
}
.mus-neuron-canvas {
  position: absolute;
  left: -1400px;
  top: -930px;
  width: 2800px;
  height: 1800px;
}
.mus-hud-specimen {
  font-family: 'Orbitron', sans-serif;
  font-size: 10px;
  letter-spacing: 3px;
  color: rgba(140, 220, 255, 0.8);
  text-shadow: 0 0 10px rgba(53, 181, 255, 0.5);
}

/* ── Exit door on the entrance wall ── */
.mus-door {
  position: absolute;
  left: 0;
  top: 0;
  width: 380px;
  height: 470px;
  transform-origin: 0 0;
  cursor: pointer;
  background: linear-gradient(to top, rgba(53, 181, 255, 0.16) 0%, rgba(53, 181, 255, 0.05) 55%, transparent 100%);
  border: 2px solid rgba(120, 220, 255, 0.55);
  border-bottom: none;
  border-radius: 190px 190px 0 0;
  box-shadow:
    0 0 34px rgba(53, 181, 255, 0.35),
    inset 0 0 44px rgba(53, 181, 255, 0.14);
  text-align: center;
  backface-visibility: hidden;
}
.mus-door:hover {
  background: linear-gradient(to top, rgba(53, 181, 255, 0.26) 0%, rgba(53, 181, 255, 0.09) 55%, transparent 100%);
  box-shadow:
    0 0 54px rgba(53, 181, 255, 0.55),
    inset 0 0 54px rgba(53, 181, 255, 0.22);
}
.mus-door-arch {
  position: absolute;
  inset: 22px 22px 0;
  border: 1px solid rgba(53, 181, 255, 0.35);
  border-bottom: none;
  border-radius: 170px 170px 0 0;
  pointer-events: none;
}
.mus-door-glow {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 240px;
  height: 16px;
  transform: translateX(-50%);
  background: radial-gradient(ellipse at center, rgba(120, 220, 255, 0.55) 0%, transparent 70%);
  pointer-events: none;
}
.mus-door-label {
  margin-top: 150px;
  font-family: 'Orbitron', sans-serif;
  font-size: 56px;
  font-weight: 700;
  letter-spacing: 12px;
  color: rgba(190, 235, 255, 0.95);
  text-shadow: 0 0 22px rgba(53, 181, 255, 0.9);
  pointer-events: none;
}
.mus-door-sub {
  margin-top: 12px;
  font-family: 'Orbitron', sans-serif;
  font-size: 17px;
  font-weight: 500;
  letter-spacing: 4px;
  color: rgba(130, 200, 240, 0.85);
  text-shadow: 0 0 12px rgba(53, 181, 255, 0.5);
  pointer-events: none;
}
.mus-door-chevrons {
  margin-top: 26px;
  font-size: 30px;
  color: rgba(120, 220, 255, 0.7);
  animation: musDoorChevron 2.2s ease-in-out infinite;
  pointer-events: none;
}
@keyframes musDoorChevron {
  0%, 100% { transform: translateY(0); opacity: 0.55; }
  50%      { transform: translateY(-8px); opacity: 1; }
}

/* ── Big picture stats on the side wall ── */
.mus-wallstats {
  position: absolute;
  left: 0;
  top: 0;
  width: 2400px;
  padding: 40px 0 46px;
  transform-origin: 0 0;
  text-align: center;
  pointer-events: none;
  backface-visibility: hidden;
  background: linear-gradient(180deg, rgba(10, 24, 50, 0.55), rgba(6, 14, 30, 0.35));
  border: 2px solid rgba(53, 181, 255, 0.4);
  border-radius: 10px;
  box-shadow: 0 0 44px rgba(53, 181, 255, 0.22), inset 0 0 60px rgba(53, 181, 255, 0.08);
}
.mus-wallstats-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 20px;
  color: rgba(140, 215, 250, 0.85);
  text-shadow: 0 0 18px rgba(53, 181, 255, 0.6);
}
.mus-wallstats-row {
  margin-top: 38px;
  display: flex;
  justify-content: center;
  gap: 76px;
}
.mus-wallstats-item { min-width: 280px; }
.mus-wallstats-value {
  font-family: 'Orbitron', sans-serif;
  font-size: 104px;
  font-weight: 700;
  color: rgba(200, 240, 255, 1);
  text-shadow:
    0 0 26px rgba(53, 181, 255, 0.9),
    0 0 80px rgba(53, 181, 255, 0.45);
}
.mus-wallstats-label {
  margin-top: 10px;
  font-family: 'Orbitron', sans-serif;
  font-size: 17px;
  font-weight: 500;
  letter-spacing: 6px;
  color: rgba(130, 200, 240, 0.8);
}

/* ── Touch joystick ── */
.mus-joystick {
  position: absolute;
  left: 22px;
  bottom: 54px;
  width: 108px;
  height: 108px;
  border-radius: 50%;
  border: 1px solid rgba(53, 181, 255, 0.5);
  background:
    radial-gradient(circle, rgba(53, 181, 255, 0.10) 0%, rgba(10, 24, 48, 0.55) 70%);
  box-shadow: 0 0 18px rgba(53, 181, 255, 0.25), inset 0 0 24px rgba(53, 181, 255, 0.08);
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.mus-joystick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46px;
  height: 46px;
  margin: -23px 0 0 -23px;
  border-radius: 50%;
  border: 1px solid rgba(140, 230, 255, 0.85);
  background: radial-gradient(circle, rgba(120, 220, 255, 0.5) 0%, rgba(53, 181, 255, 0.22) 70%);
  box-shadow: 0 0 14px rgba(53, 181, 255, 0.6);
  transition: transform 0.08s linear;
  pointer-events: none;
}

@media (max-width: 640px) {
  .mus-hud-title { font-size: 12px; letter-spacing: 2px; }
  .mus-hud-count { display: none; }
  .mus-inscription-title { font-size: 56px; }
}

@media (prefers-reduced-motion: reduce) {
  .mus-float, .mus-artifact--selected .mus-disc { animation: none; }
}
</style>
