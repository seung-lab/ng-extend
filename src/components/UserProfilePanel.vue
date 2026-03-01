<script setup lang="ts">
import {ref, onMounted, watch, nextTick} from 'vue';
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';

import {useLoginStore, useUserStatsStore, useUserPreferencesStore} from '../store';
import {BADGE_DEFINITIONS, BadgeDefinition} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {DEMO_USERS, DEMO_COMMUNITY_EDITS_WEEK, DEMO_COMMUNITY_EDITS_MONTH} from '../data/demo-users';

const {sessions} = storeToRefs(useLoginStore());
const statsStore = useUserStatsStore();
const {stats} = storeToRefs(statsStore);
const {prefs} = storeToRefs(useUserPreferencesStore());

// ── Cell-dot canvas ───────────────────────────────────────────────────────────
const cellCanvas = ref<HTMLCanvasElement | null>(null);

/** Simple seeded LCG RNG — gives deterministic, reproducible dot placement. */
function seededRNG(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Draw cell dots on the canvas: bright = completed, faded = contributed. */
function drawCells() {
  const canvas = cellCanvas.value;
  if (!canvas) return;

  const W = 240, H = 280;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const rx = W * 0.42, ry = H * 0.40;

  // Dataset-volume ellipse outline
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const completed   = Math.min(stats.value.cellsSubmitted, 400);
  const estimated   = Math.round(stats.value.editsAllTime / 30);
  const contributed = Math.min(Math.max(0, estimated - stats.value.cellsSubmitted), 250);

  if (completed === 0 && contributed === 0) {
    // Empty state label
    ctx.fillStyle = 'rgba(100, 130, 160, 0.35)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Start editing to see your cells!', cx, cy + 4);
    return;
  }

  // One RNG for all dot placement (seeded so layout is stable across redraws)
  const rng = seededRNG(42);
  const limitSq = 0.81; // 0.9² — keep dots 10% inside the ellipse edge

  function nextDot(): [number, number] {
    for (;;) {
      const ux = rng() * 2 - 1;
      const uy = rng() * 2 - 1;
      if (ux * ux + uy * uy <= limitSq) {
        return [cx + ux * rx, cy + uy * ry];
      }
    }
  }

  // Contributed dots (faded blue)
  for (let i = 0; i < contributed; i++) {
    const [x, y] = nextDot();
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100, 160, 255, 0.22)';
    ctx.fill();
  }

  // Completed dots (bright blue)
  const completedDots: Array<[number, number]> = [];
  for (let i = 0; i < completed; i++) {
    const dot = nextDot();
    completedDots.push(dot);
    const [x, y] = dot;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120, 200, 255, 0.88)';
    ctx.fill();
  }

  // Glow on a random selection of completed dots
  if (completedDots.length > 0) {
    const rngGlow = seededRNG(99);
    const glowCount = Math.min(completedDots.length, 60);
    for (let i = 0; i < glowCount; i++) {
      const [x, y] = completedDots[Math.floor(rngGlow() * completedDots.length)];
      const grd = ctx.createRadialGradient(x, y, 0, x, y, 6);
      grd.addColorStop(0, 'rgba(120, 200, 255, 0.35)');
      grd.addColorStop(1, 'rgba(120, 200, 255, 0)');
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    }
  }
}

// ── Demo stats seeding + initial draw ────────────────────────────────────────
onMounted(() => {
  if (stats.value.editsAllTime === 0) {
    const amy = DEMO_USERS[0];
    statsStore.setStats({
      editsAllTime:            amy.stats.editsAllTime,
      mergesAllTime:           amy.stats.mergesAllTime,
      splitsAllTime:           amy.stats.splitsAllTime,
      editsThisWeek:           amy.stats.editsThisWeek,
      mergesThisWeek:          amy.stats.mergesThisWeek,
      splitsThisWeek:          amy.stats.splitsThisWeek,
      editsThisMonth:          amy.stats.editsThisMonth,
      mergesThisMonth:         amy.stats.mergesThisMonth,
      splitsThisMonth:         amy.stats.splitsThisMonth,
      cellsSubmitted:          amy.stats.cellsSubmitted,
      currentStreak:           amy.stats.currentStreak,
      longestStreak:           amy.stats.longestStreak,
      communityEditsThisWeek:  DEMO_COMMUNITY_EDITS_WEEK,
      communityEditsThisMonth: DEMO_COMMUNITY_EDITS_MONTH,
    });
  }
  nextTick(drawCells);
});

// Redraw whenever stats change (real edit data pushed in)
watch(stats, () => nextTick(drawCells), {deep: true});

// ── Badge helpers ─────────────────────────────────────────────────────────────
function getBadgeUrl(imageKey: string): string {
  return BADGE_IMAGE_MAP[imageKey] ?? '';
}

function isBadgeEarned(editThreshold: number): boolean {
  if (editThreshold === 0) return false;
  return (stats.value.editsAllTime ?? 0) >= editThreshold;
}

const selectedBadge = ref<BadgeDefinition | null>(null);

function onBadgeClick(badge: BadgeDefinition) {
  if (!isBadgeEarned(badge.editThreshold)) return;
  selectedBadge.value = selectedBadge.value?.id === badge.id ? null : badge;
}

const emit = defineEmits({hide: null});
</script>

<template>
  <modal-overlay id="nge-profile-modal" class="nge-profile-modal" @hide="emit('hide')">
    <div class="nge-profile-shell">

      <!-- Non-scrolling topbar -->
      <div class="nge-profile-topbar">
        <button class="nge-profile-exit" @click="emit('hide')">×</button>
      </div>

      <!-- Body: left scrollable stats + right canvas viz -->
      <div class="nge-profile-body">

        <!-- Left column: scrollable stats & badges -->
        <div class="nge-profile-content">

          <!-- Header: flag + name + email + bio -->
          <div class="nge-profile-header" v-if="sessions.length > 0">
            <div class="nge-profile-name-row">
              <span class="nge-profile-flag" v-if="prefs.flag">{{ prefs.flag }}</span>
              <div class="nge-profile-name">{{ sessions[0].name }}</div>
            </div>
            <div class="nge-profile-email">{{ sessions[0].email }}</div>
            <div class="nge-profile-bio" v-if="prefs.bio">{{ prefs.bio }}</div>
          </div>

          <!-- Stats grid: Edits | Cells -->
          <div class="nge-profile-grid">
            <!-- Edits column -->
            <div>
              <div class="nge-profile-col-header">Edits</div>
              <div class="nge-profile-subgrid">
                <div class="nge-profile-timespan">Today</div>
                <div class="nge-profile-timespan">Past 7 Days</div>
                <div class="nge-profile-timespan">All Time</div>
                <div class="nge-profile-count">
                  {{ stats.editsToday }}
                  <span class="nge-profile-split">({{ stats.mergesToday }} | {{ stats.splitsToday }})</span>
                </div>
                <div class="nge-profile-count">
                  {{ stats.editsThisWeek }}
                  <span class="nge-profile-split">({{ stats.mergesThisWeek }} | {{ stats.splitsThisWeek }})</span>
                </div>
                <div class="nge-profile-count">
                  {{ stats.editsAllTime }}
                  <span class="nge-profile-split">({{ stats.mergesAllTime }} | {{ stats.splitsAllTime }})</span>
                </div>
              </div>
            </div>

            <!-- Cells column -->
            <div>
              <div class="nge-profile-col-header">Cells</div>
              <div class="nge-profile-subgrid">
                <div class="nge-profile-timespan">Today</div>
                <div class="nge-profile-timespan">Past 7 Days</div>
                <div class="nge-profile-timespan">All Time</div>
                <div class="nge-profile-count">0</div>
                <div class="nge-profile-count">0</div>
                <div class="nge-profile-count">{{ stats.cellsSubmitted }}</div>
              </div>
            </div>
          </div>

          <!-- Streak -->
          <div class="nge-profile-streak"
               v-if="stats.currentStreak > 0 || stats.longestStreak > 0">
            <div class="nge-profile-streak-label">Editing Streak</div>
            <div class="nge-profile-streak-values">
              <div class="nge-profile-streak-current">
                <span class="nge-profile-streak-flame">🔥</span>
                <span class="nge-profile-streak-count">{{ stats.currentStreak }}</span>
                <span class="nge-profile-streak-unit">
                  day{{ stats.currentStreak === 1 ? '' : 's' }} current
                </span>
              </div>
              <div class="nge-profile-streak-best" v-if="stats.longestStreak > 0">
                <span class="nge-profile-streak-best-label">Best:</span>
                <span class="nge-profile-streak-best-count">{{ stats.longestStreak }}</span>
                <span class="nge-profile-streak-unit">
                  day{{ stats.longestStreak === 1 ? '' : 's' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Badges -->
          <div class="nge-profile-badges">
            <div class="nge-profile-badges-label">Badges</div>
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in BADGE_DEFINITIONS"
                :key="badge.id"
                class="nge-profile-badge"
                :class="{
                  'nge-profile-badge--locked': !isBadgeEarned(badge.editThreshold),
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                }"
                :title="isBadgeEarned(badge.editThreshold)
                  ? badge.name + ' — click to learn more'
                  : '??? (locked — keep editing to reveal!)'"
                @click="onBadgeClick(badge)"
              >
                <template v-if="isBadgeEarned(badge.editThreshold)">
                  <div class="nge-profile-badge-img">
                    <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-profile-badge-icon" />
                  </div>
                  <div class="nge-profile-badge-name">{{ badge.name }}</div>
                </template>
                <template v-else>
                  <div class="nge-profile-badge-img">
                    <div class="nge-profile-badge-mystery">
                      <span class="nge-profile-badge-mystery-q">?</span>
                    </div>
                  </div>
                  <div class="nge-profile-badge-name nge-profile-badge-name--locked">???</div>
                </template>
              </div>
            </div>

            <!-- Badge detail card -->
            <Transition name="badge-detail">
              <div v-if="selectedBadge" class="nge-profile-badge-detail">
                <img
                  :src="getBadgeUrl(selectedBadge.imageKey)"
                  :alt="selectedBadge.name"
                  class="nge-profile-badge-detail-icon"
                />
                <div class="nge-profile-badge-detail-body">
                  <div class="nge-profile-badge-detail-name">{{ selectedBadge.name }}</div>
                  <div class="nge-profile-badge-detail-desc">{{ selectedBadge.description }}</div>
                  <div class="nge-profile-badge-detail-threshold">
                    Unlocked at {{ selectedBadge.editThreshold.toLocaleString() }} edits
                  </div>
                </div>
                <button class="nge-profile-badge-detail-close" @click.stop="selectedBadge = null">×</button>
              </div>
            </Transition>
          </div>

        </div><!-- end .nge-profile-content -->

        <!-- Right column: cell-dot canvas visualization -->
        <div class="nge-profile-viz">
          <div class="nge-profile-viz-title">Cells Mapped</div>
          <canvas ref="cellCanvas" class="nge-profile-canvas"></canvas>
          <div class="nge-profile-viz-legend">
            <span class="nge-profile-viz-dot nge-profile-viz-dot--completed"></span>
            <span class="nge-profile-viz-legend-label">completed</span>
            <span class="nge-profile-viz-dot nge-profile-viz-dot--contributed"></span>
            <span class="nge-profile-viz-legend-label">contributed</span>
          </div>
          <div class="nge-profile-viz-count">
            {{ stats.cellsSubmitted.toLocaleString() }} cells submitted
          </div>
        </div>

      </div><!-- end .nge-profile-body -->
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-profile-modal {
  font-size: 0.9em;
}

/* ── Sci-fi materialize ── */
/* NOTE: no position:relative here — neuroglancer's .overlay-content already
   has position:absolute which correctly centers the panel. The ::before
   scanline works because position:absolute creates a containing block.       */
.nge-profile-modal :deep(.nge-overlay) {
  overflow: hidden;
  animation: ngeProfileMaterialize 0.52s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nge-profile-modal :deep(.nge-overlay::before) {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(74, 158, 255, 0.5) 15%,
    rgba(160, 220, 255, 1) 50%,
    rgba(74, 158, 255, 0.5) 85%,
    transparent 100%
  );
  animation: ngeProfileScan 0.52s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  z-index: 100;
  pointer-events: none;
}

@keyframes ngeProfileMaterialize {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) translateY(14px) scale(0.96);
    filter: blur(8px) brightness(2);
    box-shadow: 0 0 60px rgba(74, 158, 255, 0.5), 0 0 120px rgba(74, 158, 255, 0.15);
  }
  35% {
    opacity: 1;
    transform: translate(-50%, -50%);
    filter: blur(0.5px) brightness(1.15);
    box-shadow: 0 0 20px rgba(74, 158, 255, 0.15);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%);
    filter: blur(0px) brightness(1);
    box-shadow: none;
  }
}

@keyframes ngeProfileScan {
  0%   { top: 0%;   opacity: 1; }
  85%  { opacity: 0.4; }
  100% { top: 100%; opacity: 0; }
}

/* ── Shell ── */
.nge-profile-shell {
  display: flex;
  flex-direction: column;
  max-height: 88vh;
}

.nge-profile-topbar {
  display: flex;
  justify-content: flex-end;
  padding: 10px 12px 0;
  flex-shrink: 0;
}

.nge-profile-exit {
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.6em;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.nge-profile-exit:hover { color: #fff; }

/* ── Two-column body ── */
.nge-profile-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── Left: scrollable stats & badges ── */
.nge-profile-content {
  width: 380px;
  overflow-y: auto;
  padding: 16px 40px 30px;
  box-sizing: border-box;
  flex-shrink: 0;
}

/* ── Right: cell-dot canvas ── */
.nge-profile-viz {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px 16px;
  border-left: 1px solid rgba(255, 255, 255, 0.05);
}

.nge-profile-viz-title {
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #555;
}

.nge-profile-canvas {
  display: block;
}

.nge-profile-viz-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}

.nge-profile-viz-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.nge-profile-viz-dot--completed  { background: rgba(120, 200, 255, 0.88); }
.nge-profile-viz-dot--contributed { background: rgba(100, 160, 255, 0.25); border: 1px solid rgba(100, 160, 255, 0.5); }

.nge-profile-viz-legend-label {
  font-size: 0.7em;
  color: #555;
  margin-right: 6px;
}

.nge-profile-viz-count {
  font-size: 0.72em;
  color: #555;
  text-align: center;
}

/* ── Header ── */
.nge-profile-header {
  padding-bottom: 24px;
}

.nge-profile-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nge-profile-flag {
  font-size: 1.4em;
  line-height: 1;
  flex-shrink: 0;
}

.nge-profile-name {
  font-size: 1.4em;
  font-weight: 600;
}

.nge-profile-email {
  font-style: italic;
  color: #9e9e9e;
  font-size: 0.9em;
}

.nge-profile-bio {
  font-size: 0.82em;
  color: #aaa;
  margin-top: 6px;
  line-height: 1.4;
  font-style: italic;
}

/* ── Stats grid ── */
.nge-profile-grid {
  display: grid;
  grid-template-columns: 50% 50%;
  margin-bottom: 24px;
}

.nge-profile-col-header {
  padding-bottom: 14px;
  font-size: 1.4em;
  font-weight: 600;
}

.nge-profile-subgrid {
  display: grid;
  grid-template-columns: 33% 33% 34%;
}

.nge-profile-timespan {
  font-size: 0.78em;
  color: #9e9e9e;
  padding-bottom: 6px;
}

.nge-profile-count {
  font-size: 1.1em;
  padding-bottom: 4px;
}

.nge-profile-split {
  display: block;
  font-size: 0.75em;
  color: #9e9e9e;
  white-space: nowrap;
}

/* ── Streak ── */
.nge-profile-streak {
  margin-bottom: 24px;
  padding: 12px 14px;
  background: rgba(245, 166, 35, 0.07);
  border: 1px solid rgba(245, 166, 35, 0.18);
  border-radius: 8px;
}

.nge-profile-streak-label {
  font-size: 0.72em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #666;
  margin-bottom: 8px;
}

.nge-profile-streak-values {
  display: flex;
  align-items: baseline;
  gap: 20px;
  flex-wrap: wrap;
}

.nge-profile-streak-current {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.nge-profile-streak-flame { font-size: 1.3em; line-height: 1; }
.nge-profile-streak-count { font-size: 1.6em; font-weight: 700; color: #f5a623; line-height: 1; }
.nge-profile-streak-unit  { font-size: 0.78em; color: #9e9e9e; }

.nge-profile-streak-best {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 0.85em;
}

.nge-profile-streak-best-label { color: #666; }
.nge-profile-streak-best-count { color: #bbb; font-weight: 600; }

/* ── Badges ── */
.nge-profile-badges-label {
  font-size: 1.4em;
  font-weight: 600;
  padding-top: 16px;
  padding-bottom: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.nge-profile-badges-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.nge-profile-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: default;
  transition: transform 0.15s;
}

.nge-profile-badge:not(.nge-profile-badge--locked) { cursor: pointer; }
.nge-profile-badge:not(.nge-profile-badge--locked):hover { transform: scale(1.08); }

.nge-profile-badge--selected .nge-profile-badge-img {
  filter: drop-shadow(0 0 6px rgba(100, 180, 255, 0.75));
}

.nge-profile-badge-img {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  transition: filter 0.15s;
}

.nge-profile-badge-icon {
  width: 54px;
  height: 54px;
  object-fit: contain;
}

.nge-profile-badge-mystery {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px dashed rgba(255, 255, 255, 0.15);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nge-profile-badge-mystery-q {
  font-size: 1.3em;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.2);
  font-style: italic;
  line-height: 1;
}

.nge-profile-badge-name {
  font-size: 0.68em;
  color: #bbb;
  margin-top: 4px;
  line-height: 1.2;
  max-width: 72px;
  word-break: break-word;
}

.nge-profile-badge-name--locked {
  color: #444;
  letter-spacing: 0.05em;
}

/* ── Badge detail card ── */
.nge-profile-badge-detail {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
  padding: 12px 14px;
  background: rgba(100, 180, 255, 0.08);
  border: 1px solid rgba(100, 180, 255, 0.22);
  border-radius: 8px;
  position: relative;
}

.nge-profile-badge-detail-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  flex-shrink: 0;
}

.nge-profile-badge-detail-body { flex: 1; min-width: 0; }

.nge-profile-badge-detail-name {
  font-weight: 600;
  font-size: 1em;
  margin-bottom: 3px;
}

.nge-profile-badge-detail-desc {
  font-size: 0.85em;
  color: #ccc;
  margin-bottom: 3px;
}

.nge-profile-badge-detail-threshold {
  font-size: 0.75em;
  color: rgba(100, 180, 255, 0.7);
}

.nge-profile-badge-detail-close {
  position: absolute;
  top: 6px;
  right: 10px;
  background: none;
  border: none;
  color: #666;
  font-size: 1.1em;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.nge-profile-badge-detail-close:hover { color: #ccc; }

.badge-detail-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.badge-detail-leave-active { transition: all 0.15s ease-in; }
.badge-detail-enter-from,
.badge-detail-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
</style>
