<script setup lang="ts">
/**
 * AchievementMuseum: a walkable WebGL gallery for earned achievements.
 *
 * Badges are holographic artifacts on projector pedestals in a navy gallery
 * hall, with Amy's real wide field amacrine cell drifting over the hall as a
 * wireframe canopy. Arrow keys or WASD walk, Q and E pan up and down, drag
 * looks around, Esc exits. Curate mode lets the owner select, drag, and
 * resize artifacts; the layout persists per user in localStorage.
 *
 * v1 rendered the room with CSS 3D transforms; the DOM compositor
 * re-rasterizes planes during camera motion, which flickered. The room is
 * now a single three.js scene (src/util/museum_scene.ts) and this component
 * keeps all input, curation, and persistence logic.
 */
import {ref, computed, watch, onMounted, onUnmounted} from 'vue';
import {BadgeDefinition} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {getMuseumWireframe, MuseumWireframe} from '../util/museum_mesh';
import {MuseumScene, SceneArtifact} from '../util/museum_scene';

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

interface MuseumArtifact extends SceneArtifact {
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

// ── Room geometry (1 unit = 1px at the old CSS scale) ────────────────────────
const ROOM_W = 2200;
const ROOM_D = 6200;
const WALL_H = 560;
const FLOOR_Y = 180;

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
  // The museum uses the 320px downsampled art set for distance and swaps in
  // the full 1024px set up close; full res PNGs are ~1.6MB each.
  const smallArt = (key: string) =>
      (BADGE_IMAGE_MAP[key] ?? '').replace('center-art/', 'center-art-320/');
  props.building.forEach((b, i) => out.push({
    key: `b:${b.slug}`,
    name: b.name,
    subtitle: `BUILDING · ${b.threshold.toLocaleString()} ${b.threshold === 1 ? 'EDIT' : 'EDITS'}`,
    desc: b.description,
    img: smallArt(b.imageKey),
    imgHi: BADGE_IMAGE_MAP[b.imageKey] ?? '',
    kind: 'building',
    home: wallSlot(i, -1),
  }));
  props.exploration.forEach((b, i) => out.push({
    key: `e:${b.slug}`,
    name: b.name,
    subtitle: `EXPLORATION · ${b.threshold.toLocaleString()} ${b.threshold === 1 ? 'CELL' : 'CELLS'}`,
    desc: b.description,
    img: smallArt(b.imageKey),
    imgHi: BADGE_IMAGE_MAP[b.imageKey] ?? '',
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
    imgHi: a.badge?.image_url || a.badge?.thumbnail_url || '',
    kind: 'special',
    home: manySpecials
      ? {x: i % 2 ? 270 : -270, z: -900 - Math.floor(i / 2) * 520}
      : {x: 0, z: -900 - i * 520},
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

// ── Big picture stats for the back wall ──────────────────────────────────────
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

// ── Camera + input ───────────────────────────────────────────────────────────
const cam = {x: 0, z: -140, yaw: 0, pitch: 0};
const keys = new Set<string>();
const editMode = ref(false);
const selectedKey = ref<string | null>(null);
const viewportEl = ref<HTMLElement | null>(null);
const glCanvasEl = ref<HTMLCanvasElement | null>(null);
let museumScene: MuseumScene | null = null;

// Touch devices get an on-screen joystick and resize buttons.
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const joyEl = ref<HTMLElement | null>(null);
const joyKnobEl = ref<HTMLElement | null>(null);
const joy = {active: false, id: -1, x: 0, y: 0};

// ── Real specimen in the sky ─────────────────────────────────────────────────
const SPECIMEN_SEG_ID = '720575940569107563';
const SPECIMEN_LABEL = 'WIDE FIELD AMACRINE · STROEH RETINA';
const wireframe = ref<MuseumWireframe | null>(null);
const specimenState = ref<'loading' | 'live' | 'fallback'>('loading');
const specimenProgress = ref<{loaded: number; total: number} | null>(null);

// The soma is not at the arbor's bounding box center: wide field cells are
// asymmetric. Find it as the densest knot of vertices so the cell body hangs
// over the hall's centerline with the arbor wheeling around it.
let somaCenter = {x: 0, y: 0, z: 0};
let somaMaxRadius = 1000;

function computeSomaCenter(wf: MuseumWireframe) {
  const v = wf.verts;
  const n = Math.floor(v.length / 3);
  const R2 = 150 * 150;
  let best = 0, bestCount = -1;
  const stride = n > 3000 ? 2 : 1;
  for (let i = 0; i < n; i += stride) {
    const xi = v[i * 3], yi = v[i * 3 + 1], zi = v[i * 3 + 2];
    let c = 0;
    for (let j = 0; j < n; j++) {
      const dx = v[j * 3] - xi, dy = v[j * 3 + 1] - yi, dz = v[j * 3 + 2] - zi;
      if (dx * dx + dy * dy + dz * dz < R2) c++;
    }
    if (c > bestCount) {
      bestCount = c;
      best = i;
    }
  }
  somaCenter = {x: v[best * 3], y: v[best * 3 + 1], z: v[best * 3 + 2]};
  let maxR2 = 1;
  for (let i = 0; i < n; i++) {
    const dx = v[i * 3] - somaCenter.x;
    const dy = v[i * 3 + 1] - somaCenter.y;
    const dz = v[i * 3 + 2] - somaCenter.z;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }
  somaMaxRadius = Math.sqrt(maxR2);
}

let intro = true;
let raf = 0;
let last = 0;

const MOVE_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'PageUp', 'PageDown',
  'ShiftLeft', 'ShiftRight', 'Equal', 'Minus', 'KeyR', 'KeyC',
]);

function clampCam() {
  cam.x = Math.max(-ROOM_W / 2 + 90, Math.min(ROOM_W / 2 - 90, cam.x));
  cam.z = Math.max(-ROOM_D + 90, Math.min(-90, cam.z));
  cam.pitch = Math.max(-34, Math.min(62, cam.pitch));
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

  const lookRate = 55 * dt;
  if (keys.has('KeyQ') || keys.has('PageUp'))   cam.pitch += lookRate;
  if (keys.has('KeyE') || keys.has('PageDown')) cam.pitch -= lookRate;

  if (joy.active) {
    cam.x += (fwd.x * -joy.y + right.x * joy.x) * speed;
    cam.z += (fwd.z * -joy.y + right.z * joy.x) * speed;
  }

  clampCam();

  if (museumScene) {
    museumScene.setCamera(cam.x, cam.z, cam.yaw, cam.pitch);
    museumScene.render(now);
  }
  raf = requestAnimationFrame(tick);
}

// ── Scene sync ───────────────────────────────────────────────────────────────
function syncArtifacts() {
  if (!museumScene) return;
  museumScene.setArtifacts(artifacts.value);
  for (const a of artifacts.value) museumScene.setPose(a.key, poseOf(a));
  museumScene.setSelected(selectedKey.value);
}

watch(artifacts, syncArtifacts);
watch(layout, () => {
  if (!museumScene) return;
  for (const a of artifacts.value) museumScene.setPose(a.key, poseOf(a));
}, {deep: true});
watch(selectedKey, k => museumScene?.setSelected(k));
watch(wireframe, wf => {
  if (wf && museumScene) museumScene.setSpecimen(wf, somaCenter, somaMaxRadius);
});

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
  if (target.closest('.mus-hud-top, .mus-hud-selected, .mus-hud-help, .mus-joystick')) return;
  if (dragMode !== 'none') return;
  dragDist = 0;
  dragStart.px = e.clientX;
  dragStart.py = e.clientY;
  dragStart.id = e.pointerId;
  const hitKey = editMode.value ? museumScene?.pickArtifact(e.clientX, e.clientY) : null;
  if (editMode.value && hitKey) {
    dragMode = 'artifact';
    dragKey = hitKey;
    const p = editablePose(dragKey);
    dragStart.x = p.x;
    dragStart.z = p.z;
    const dist = Math.hypot(p.x - cam.x, p.z - cam.z);
    dragStart.k = Math.max(0.6, dist / 800);
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
  if (dragDist < 6) {
    if (dragMode === 'artifact') {
      selectedKey.value = selectedKey.value === dragKey ? null : dragKey;
    } else if (museumScene?.pickDoor(e.clientX, e.clientY)) {
      emit('close');
    } else if (editMode.value) {
      selectedKey.value = null;
    }
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
  if (e.code === 'KeyC' && props.editable) {
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

function onResize() {
  museumScene?.resize();
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

/** Download the decimated wireframe so it can be baked into the app. */
function exportSpecimen() {
  const wf = wireframe.value;
  if (!wf) return;
  const blob = new Blob([JSON.stringify(wf)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `specimen-${SPECIMEN_SEG_ID}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const selectedArtifact = computed(() =>
  artifacts.value.find(a => a.key === selectedKey.value) ?? null);

// The viewport meta lives only while the museum is open: adding it globally
// to index.html changes page scaling for the whole app, and the app's 3D
// viewport is not ours to resize.
let injectedViewportMeta: HTMLMetaElement | null = null;
let unmounted = false;

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
  window.addEventListener('resize', onResize);

  // Plaque textures rasterize Orbitron, so wait for fonts before building.
  const fontsReady: Promise<unknown> =
      (document as any).fonts?.ready ?? Promise.resolve();
  fontsReady.then(() => {
    if (unmounted || !glCanvasEl.value) return;
    museumScene = new MuseumScene(glCanvasEl.value, {
      roomW: ROOM_W,
      roomD: ROOM_D,
      wallH: WALL_H,
      floorY: FLOOR_Y,
      userName: props.userName,
      statsRows: statsRows.value,
    });
    syncArtifacts();
    if (wireframe.value) {
      museumScene.setSpecimen(wireframe.value, somaCenter, somaMaxRadius);
    }
  });

  last = performance.now();
  raf = requestAnimationFrame(tick);

  getMuseumWireframe(SPECIMEN_SEG_ID, {
    onProgress: (loaded, total) => {
      specimenProgress.value = {loaded, total};
    },
  }).then(wf => {
    if (wf) computeSomaCenter(wf);
    wireframe.value = wf;
    specimenState.value = wf ? 'live' : 'fallback';
  }).catch(() => {
    specimenState.value = 'fallback';
  });
});

onUnmounted(() => {
  unmounted = true;
  injectedViewportMeta?.remove();
  injectedViewportMeta = null;
  cancelAnimationFrame(raf);
  window.clearTimeout(saveTimer);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('resize', onResize);
  museumScene?.dispose();
  museumScene = null;
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
      <canvas ref="glCanvasEl" class="mus-gl"></canvas>

      <!-- ── HUD ── -->
      <div class="mus-vignette"></div>
      <div class="mus-hud-top">
        <div class="mus-hud-title">◈ ACHIEVEMENT MUSEUM</div>
        <div class="mus-hud-count">{{ artifacts.length }} ARTIFACTS ON DISPLAY</div>
        <div v-if="specimenState === 'loading'" class="mus-hud-specimen">◌ SUMMONING SPECIMEN{{ specimenProgress && specimenProgress.total ? ` · ${specimenProgress.loaded}/${specimenProgress.total} FRAGMENTS` : '...' }}</div>
        <div v-else-if="specimenState === 'live'" class="mus-hud-specimen">◉ SPECIMEN: {{ SPECIMEN_LABEL }}</div>
        <div v-else class="mus-hud-specimen mus-hud-specimen--dim">◌ SPECIMEN OFFLINE · OPEN THE STROEH RETINA DATASET, THEN REVISIT</div>
        <div class="mus-hud-actions">
          <button v-if="editable" class="mus-btn" :class="{'mus-btn--active': editMode}" @click="toggleEdit">
            {{ editMode ? '✓ Done curating' : '⬡ Curate' }}
          </button>
          <button v-if="editMode" class="mus-btn" @click="resetLayout">Reset layout</button>
          <button v-if="editMode && specimenState === 'live'" class="mus-btn" @click="exportSpecimen">⇓ Export specimen</button>
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

      <div v-if="artifacts.length === 0" class="mus-empty-hud">
        <div class="mus-empty-title">THE HALL AWAITS</div>
        <div class="mus-empty-sub">Earn badges to fill your museum with artifacts.</div>
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
          ARROWS or WASD: walk · Q / E: look up and down · SHIFT: run · DRAG: look around · SCROLL: glide · ESC: exit
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
   ACHIEVEMENT MUSEUM · WebGL gallery hall, DOM carries only the HUD
   ══════════════════════════════════════════════════════════════════════════ */

.nge-museum {
  position: fixed;
  inset: 0;
  z-index: 9500;
  overflow: hidden;
  background: #02050c;
  cursor: grab;
  user-select: none;
  touch-action: none;
  animation: musFadeIn 0.5s ease-out;
  font-family: 'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif;
}
.nge-museum:active { cursor: grabbing; }
.nge-museum--edit { cursor: default; }

@keyframes musFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.mus-gl {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
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
.mus-hud-specimen {
  font-family: 'Orbitron', sans-serif;
  font-size: 10px;
  letter-spacing: 3px;
  color: rgba(140, 220, 255, 0.8);
  text-shadow: 0 0 10px rgba(53, 181, 255, 0.5);
}
.mus-hud-specimen--dim {
  color: rgba(120, 160, 195, 0.55);
  text-shadow: none;
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
.mus-btn--size {
  padding: 4px 12px;
  font-size: 14px;
  line-height: 1;
}

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
.mus-hud-selected-name {
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  letter-spacing: 2px;
  color: rgba(190, 235, 255, 1);
  text-transform: uppercase;
}

.mus-empty-hud {
  position: absolute;
  top: 40%;
  left: 0;
  right: 0;
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
}
</style>
