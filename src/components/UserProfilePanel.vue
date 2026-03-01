<script setup lang="ts">
import {ref, onMounted, onUnmounted, watch, nextTick} from 'vue';
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';

import {useLoginStore, useUserStatsStore, useUserPreferencesStore} from '../store';
import {BADGE_DEFINITIONS, BadgeDefinition} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {DEMO_USERS, DEMO_COMMUNITY_EDITS_WEEK, DEMO_COMMUNITY_EDITS_MONTH} from '../data/demo-users';

// ── Stores ────────────────────────────────────────────────────────────────────
const {sessions} = storeToRefs(useLoginStore());
const statsStore  = useUserStatsStore();
const {stats}     = storeToRefs(statsStore);
const prefsStore  = useUserPreferencesStore();
const {prefs}     = storeToRefs(prefsStore);

// ── Local state ───────────────────────────────────────────────────────────────
const closing        = ref(false);
const selectedBadge  = ref<BadgeDefinition | null>(null);
const showFlagPicker = ref(false);
const cellCanvas     = ref<HTMLCanvasElement | null>(null);

// ── Inline flag picker ────────────────────────────────────────────────────────
const QUICK_FLAGS = ['🇺🇸','🇬🇧','🇨🇦','🇩🇪','🇫🇷','🇯🇵','🇰🇷','🇨🇳','🇧🇷','🇮🇳','🇦🇺','🇳🇬','🇹🇼','🇵🇹','🇩🇰','🇸🇦'];

function setFlag(f: string) {
  prefsStore.save({flag: f});
  showFlagPicker.value = false;
}

// Close the flag picker when clicking anywhere outside it
function handleGlobalClick(e: MouseEvent) {
  const el = document.getElementById('nge-profile-flag-wrap');
  if (el && !el.contains(e.target as Node)) showFlagPicker.value = false;
}
onMounted(()  => document.addEventListener('click', handleGlobalClick, true));
onUnmounted(() => document.removeEventListener('click', handleGlobalClick, true));

// ── Canvas cell-dot visualization ─────────────────────────────────────────────
/** Seeded LCG RNG — deterministic dot layout that doesn't shift on re-render. */
function seededRNG(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Draw cells as dots inside a rectangular volume bounding box. */
function drawCells() {
  const canvas = cellCanvas.value;
  if (!canvas) return;

  const W = 260, H = 290;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Rectangular volume bounding box (all connectomics datasets are rectangular)
  const mX = 16, mY = 22;
  const bL = mX, bT = mY, bR = W - mX, bB = H - mY;
  const bW = bR - bL, bH = bB - bT;

  // Outer box (very faint)
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.09)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bL, bT, bW, bH);

  // Sci-fi corner brackets
  const cs = 11;
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ([ [bL, bT, 1, 1], [bR, bT, -1, 1], [bL, bB, 1, -1], [bR, bB, -1, -1] ] as const)
    .forEach(([x, y, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x + dx * cs, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * cs);
      ctx.stroke();
    });

  // Dataset label bottom-right
  ctx.fillStyle = 'rgba(74, 158, 255, 0.28)';
  ctx.font = '8px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('minnie65', bR - 2, bB - 3);

  const completed   = Math.min(stats.value.cellsSubmitted, 400);
  const estimated   = Math.round(stats.value.editsAllTime / 30);
  const contributed = Math.min(Math.max(0, estimated - stats.value.cellsSubmitted), 250);

  if (completed === 0 && contributed === 0) {
    ctx.fillStyle = 'rgba(100, 130, 160, 0.3)';
    ctx.font = '9.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Start editing to map cells', W / 2, H / 2 + 4);
    return;
  }

  const rng = seededRNG(42);
  const inset = 5;

  function nextDot(): [number, number] {
    // Uniform random within the volume rectangle (no rejection sampling needed)
    return [
      bL + inset + rng() * (bW - 2 * inset),
      bT + inset + rng() * (bH - 2 * inset),
    ];
  }

  // Contributed cells (faded blue) drawn first so bright dots render on top
  for (let i = 0; i < contributed; i++) {
    const [x, y] = nextDot();
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100, 160, 255, 0.2)';
    ctx.fill();
  }

  // Completed cells (bright blue)
  const completedDots: Array<[number, number]> = [];
  for (let i = 0; i < completed; i++) {
    const dot = nextDot();
    completedDots.push(dot);
    const [x, y] = dot;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120, 200, 255, 0.9)';
    ctx.fill();
  }

  // Radial glow on random selection of completed dots
  if (completedDots.length > 0) {
    const rngGlow = seededRNG(99);
    const glowN = Math.min(completedDots.length, 60);
    for (let i = 0; i < glowN; i++) {
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

// Pulse the canvas when new cells are submitted (real-time feedback)
watch(() => stats.value.cellsSubmitted, (newVal, oldVal) => {
  if (newVal > oldVal) {
    nextTick(() => {
      cellCanvas.value?.classList.add('nge-canvas-pulse');
      setTimeout(() => cellCanvas.value?.classList.remove('nge-canvas-pulse'), 700);
    });
  }
});

// ── Demo seeding + initial draw ───────────────────────────────────────────────
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

// Redraw when stats change (real edit data pushed in from CAVE)
watch(stats, () => nextTick(drawCells), {deep: true});

// Redraw canvas when returning from badge-detail view in the viz column
watch(selectedBadge, (v) => { if (!v) nextTick(drawCells); });

// ── Badge helpers ─────────────────────────────────────────────────────────────
function getBadgeUrl(imageKey: string): string {
  return BADGE_IMAGE_MAP[imageKey] ?? '';
}

function isBadgeEarned(editThreshold: number): boolean {
  if (editThreshold === 0) return false;
  return (stats.value.editsAllTime ?? 0) >= editThreshold;
}

function onBadgeClick(badge: BadgeDefinition) {
  if (!isBadgeEarned(badge.editThreshold)) return;
  // Toggle: click same badge again to return to cells canvas
  selectedBadge.value = selectedBadge.value?.id === badge.id ? null : badge;
}

// ── Close animation ───────────────────────────────────────────────────────────
function handleClose() {
  if (closing.value) return;
  closing.value = true;
  setTimeout(() => emit('hide'), 165);
}

const emit = defineEmits({hide: null, 'open-settings': null});
</script>

<template>
  <modal-overlay
    id="nge-profile-modal"
    class="nge-profile-modal"
    :class="{ 'nge-profile-closing': closing }"
    @hide="handleClose"
  >
    <div class="nge-profile-shell">

      <!-- ── Topbar ─────────────────────────────────────────── -->
      <div class="nge-profile-topbar">
        <span class="nge-profile-topbar-label">◈ USER PROFILE</span>
        <button class="nge-profile-exit" @click="handleClose">×</button>
      </div>

      <!-- ── Two-column body ────────────────────────────────── -->
      <div class="nge-profile-body">

        <!-- Left: scrollable stats & badges -->
        <div class="nge-profile-content">

          <!-- Header -->
          <div class="nge-profile-header" v-if="sessions.length > 0">
            <div class="nge-profile-name-row">

              <!-- Flag with inline picker -->
              <div id="nge-profile-flag-wrap" class="nge-profile-flag-wrap" @click.stop>
                <button
                  class="nge-profile-flag"
                  :class="{ 'nge-profile-flag--active': showFlagPicker }"
                  @click="showFlagPicker = !showFlagPicker"
                  title="Click to change flag"
                >{{ prefs.flag || '🌐' }}</button>
                <Transition name="nge-flag-picker">
                  <div v-if="showFlagPicker" class="nge-profile-flag-picker">
                    <button
                      v-for="f in QUICK_FLAGS" :key="f"
                      class="nge-profile-flag-opt"
                      :class="{ 'nge-profile-flag-opt--active': prefs.flag === f }"
                      @click="setFlag(f)"
                    >{{ f }}</button>
                  </div>
                </Transition>
              </div>

              <div class="nge-profile-name">{{ sessions[0].name }}</div>

              <button class="nge-profile-edit-btn"
                      @click="emit('open-settings')"
                      title="Edit Profile — set bio, flag, and more">⚙</button>
            </div>

            <div class="nge-profile-email">{{ sessions[0].email }}</div>

            <div class="nge-profile-bio" v-if="prefs.bio">{{ prefs.bio }}</div>
            <button v-else class="nge-profile-bio-add" @click="emit('open-settings')">
              + Add a bio
            </button>
          </div>

          <!-- Edits stats -->
          <div class="nge-profile-section nge-profile-section--edits">
            <div class="nge-profile-section-label">▌ Edits</div>
            <div class="nge-profile-stat-row">
              <div class="nge-profile-stat-col" v-for="(col, i) in [
                {label:'Today',    val:stats.editsToday,    sub:`${stats.mergesToday} · ${stats.splitsToday}`},
                {label:'Past 7d',  val:stats.editsThisWeek, sub:`${stats.mergesThisWeek} · ${stats.splitsThisWeek}`},
                {label:'All Time', val:stats.editsAllTime,  sub:`${stats.mergesAllTime} · ${stats.splitsAllTime}`},
              ]" :key="i">
                <div class="nge-profile-stat-label">{{ col.label }}</div>
                <div class="nge-profile-stat-val">{{ col.val.toLocaleString() }}</div>
                <div class="nge-profile-stat-sub">{{ col.sub }}</div>
              </div>
            </div>
          </div>

          <!-- Cells stats -->
          <div class="nge-profile-section nge-profile-section--cells">
            <div class="nge-profile-section-label">▌ Cells</div>
            <div class="nge-profile-stat-row">
              <div class="nge-profile-stat-col">
                <div class="nge-profile-stat-label">All Time</div>
                <div class="nge-profile-stat-val nge-profile-stat-val--hero">
                  {{ stats.cellsSubmitted.toLocaleString() }}
                </div>
                <div class="nge-profile-stat-sub">submitted</div>
              </div>
              <div class="nge-profile-stat-col">
                <div class="nge-profile-stat-label">Today</div>
                <div class="nge-profile-stat-val">0</div>
                <div class="nge-profile-stat-sub">—</div>
              </div>
              <div class="nge-profile-stat-col">
                <div class="nge-profile-stat-label">Past 7d</div>
                <div class="nge-profile-stat-val">0</div>
                <div class="nge-profile-stat-sub">—</div>
              </div>
            </div>
          </div>

          <!-- Streak -->
          <div class="nge-profile-section nge-profile-section--streak"
               v-if="stats.currentStreak > 0 || stats.longestStreak > 0">
            <div class="nge-profile-section-label nge-profile-section-label--amber">▌ Streak</div>
            <div class="nge-profile-streak-row">
              <div class="nge-profile-streak-current">
                <span class="nge-profile-streak-flame">🔥</span>
                <span class="nge-profile-streak-count">{{ stats.currentStreak }}</span>
                <span class="nge-profile-streak-unit">day{{ stats.currentStreak === 1 ? '' : 's' }} current</span>
              </div>
              <div class="nge-profile-streak-best" v-if="stats.longestStreak > 0">
                <span class="nge-profile-streak-best-label">Best</span>
                <span class="nge-profile-streak-best-val">{{ stats.longestStreak }}d</span>
              </div>
            </div>
          </div>

          <!-- Badges -->
          <div class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-section-label">▌ Badges</div>
            <div class="nge-profile-badges-hint" v-if="selectedBadge">
              ← badge detail on the right · click again to dismiss
            </div>
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in BADGE_DEFINITIONS"
                :key="badge.id"
                class="nge-profile-badge"
                :class="{
                  'nge-profile-badge--locked':   !isBadgeEarned(badge.editThreshold),
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                }"
                :title="isBadgeEarned(badge.editThreshold)
                  ? badge.name + ' — click to see detail'
                  : '??? — keep editing to unlock!'"
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
          </div>

        </div><!-- end .nge-profile-content -->

        <!-- Right: cell canvas  ↔  badge detail -->
        <div class="nge-profile-viz">
          <Transition name="nge-viz-swap" mode="out-in">

            <!-- Canvas view (default) -->
            <div v-if="!selectedBadge" key="canvas" class="nge-profile-viz-panel">
              <div class="nge-profile-viz-title">▌ Cells Mapped</div>
              <canvas ref="cellCanvas" class="nge-profile-canvas"></canvas>
              <div class="nge-profile-viz-legend">
                <span class="nge-profile-viz-dot nge-profile-viz-dot--completed"></span>
                <span class="nge-profile-viz-legend-lbl">completed</span>
                <span class="nge-profile-viz-dot nge-profile-viz-dot--contributed"></span>
                <span class="nge-profile-viz-legend-lbl">contributed</span>
              </div>
              <div class="nge-profile-viz-count">
                {{ stats.cellsSubmitted.toLocaleString() }} cells submitted
              </div>
            </div>

            <!-- Badge detail view -->
            <div v-else key="badge" class="nge-profile-viz-panel nge-profile-viz-badge">
              <div class="nge-profile-viz-title">▌ Badge Detail</div>
              <img
                :src="getBadgeUrl(selectedBadge.imageKey)"
                :alt="selectedBadge.name"
                class="nge-profile-viz-badge-icon"
              />
              <div class="nge-profile-viz-badge-name">{{ selectedBadge.name }}</div>
              <div class="nge-profile-viz-badge-desc">{{ selectedBadge.description }}</div>
              <div class="nge-profile-viz-badge-threshold">
                Unlocked at<br>
                <strong>{{ selectedBadge.editThreshold.toLocaleString() }}</strong> edits
              </div>
              <button class="nge-profile-viz-badge-back" @click="selectedBadge = null">
                ← Back to cells map
              </button>
            </div>

          </Transition>
        </div>

      </div><!-- end .nge-profile-body -->
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-profile-modal { font-size: 0.9em; }

/* ─────────────────────────────────────────────────────────────────────────────
   OPEN ANIMATION — panel materializes fast, then sections stagger in
───────────────────────────────────────────────────────────────────────────── */

/* NOTE: NO position:relative here. Neuroglancer's .overlay-content already
   has position:absolute; top:50%; left:50%; transform:translate(-50%,-50%).
   Adding position:relative would override that and break centering.          */
.nge-profile-modal :deep(.nge-overlay) {
  overflow: hidden;
  animation: ngeProfileMaterialize 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Scanline sweep on open */
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
  animation: ngeProfileScan 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  z-index: 100;
  pointer-events: none;
}

/* Close animation — overrides materialize with higher specificity */
.nge-profile-closing.nge-profile-modal :deep(.nge-overlay) {
  animation: ngeProfileCollapse 0.15s ease-in both;
}

@keyframes ngeProfileMaterialize {
  0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.97); filter: blur(8px) brightness(2); box-shadow: 0 0 60px rgba(74,158,255,0.4); }
  40%  { opacity: 1; transform: translate(-50%,-50%) scale(1.003); filter: blur(0.5px) brightness(1.12); }
  100% { opacity: 1; transform: translate(-50%,-50%); filter: blur(0) brightness(1); box-shadow: none; }
}

@keyframes ngeProfileCollapse {
  0%   { opacity: 1; transform: translate(-50%,-50%) scale(1); filter: blur(0) brightness(1); }
  50%  { filter: blur(0) brightness(1.3); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(0.94); filter: blur(10px) brightness(2); }
}

@keyframes ngeProfileScan {
  0%   { top: 0%;   opacity: 1; }
  85%  { opacity: 0.4; }
  100% { top: 100%; opacity: 0; }
}

/* Staggered section roll-in */
@keyframes ngeSectionRollIn {
  0%   { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* ─────────────────────────────────────────────────────────────────────────────
   SHELL
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-shell {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

/* ── Topbar ── */
.nge-profile-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(74, 158, 255, 0.1);
  background: rgba(74, 158, 255, 0.04);
}

.nge-profile-topbar-label {
  font-size: 0.65em;
  letter-spacing: 0.18em;
  color: rgba(74, 158, 255, 0.55);
  text-transform: uppercase;
  font-weight: 600;
}

.nge-profile-exit {
  background: none; border: none;
  color: #666; font-size: 1.5em; cursor: pointer; line-height: 1; padding: 0;
}
.nge-profile-exit:hover { color: #fff; }

/* ── Two-column body ── */
.nge-profile-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── Left column: scrollable content ── */
.nge-profile-content {
  width: 420px;
  overflow-y: auto;
  padding: 20px 36px 32px;
  box-sizing: border-box;
  flex-shrink: 0;
  /* Dark scrollbars */
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}

.nge-profile-content::-webkit-scrollbar        { width: 4px; }
.nge-profile-content::-webkit-scrollbar-track  { background: rgba(255, 255, 255, 0.02); }
.nge-profile-content::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }
.nge-profile-content::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.4); }

/* ── Right column: visualization ── */
.nge-profile-viz {
  width: 268px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 16px;
  border-left: 1px solid rgba(74, 158, 255, 0.08);
  background: rgba(74, 158, 255, 0.015);
  overflow: hidden;
}

/* ─────────────────────────────────────────────────────────────────────────────
   HEADER
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-header {
  padding-bottom: 22px;
  margin-bottom: 6px;
  animation: ngeSectionRollIn 0.2s ease-out 0.12s both;
}

.nge-profile-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

/* Flag + inline picker */
.nge-profile-flag-wrap {
  position: relative;
  flex-shrink: 0;
}

.nge-profile-flag {
  background: none; border: none;
  font-size: 1.55em; line-height: 1; cursor: pointer; padding: 2px;
  border-radius: 4px;
  transition: background 0.12s, transform 0.12s;
}
.nge-profile-flag:hover            { background: rgba(255,255,255,0.08); transform: scale(1.1); }
.nge-profile-flag--active          { background: rgba(74,158,255,0.15); }

.nge-profile-flag-picker {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 200;
  background: #1c1e26;
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 8px;
  padding: 6px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.nge-profile-flag-opt {
  background: none; border: none;
  font-size: 1.3em; padding: 4px; border-radius: 4px; cursor: pointer;
  transition: background 0.1s, transform 0.1s;
  line-height: 1;
}
.nge-profile-flag-opt:hover          { background: rgba(255,255,255,0.1); transform: scale(1.15); }
.nge-profile-flag-opt--active        { background: rgba(74,158,255,0.18); }

/* Picker transition */
.nge-flag-picker-enter-active  { transition: all 0.14s cubic-bezier(0.34, 1.56, 0.64, 1); }
.nge-flag-picker-leave-active  { transition: all 0.1s ease-in; }
.nge-flag-picker-enter-from,
.nge-flag-picker-leave-to      { opacity: 0; transform: translateY(-6px) scale(0.96); }

/* Name */
.nge-profile-name {
  font-size: 1.45em;
  font-weight: 700;
  color: #eef0f4;
  letter-spacing: -0.01em;
  text-shadow: 0 0 28px rgba(74, 158, 255, 0.28);
  flex: 1;
}

/* Edit button */
.nge-profile-edit-btn {
  background: none; border: none;
  color: rgba(74, 158, 255, 0.4);
  font-size: 1em; cursor: pointer; padding: 2px 4px; border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.nge-profile-edit-btn:hover {
  color: rgba(74, 158, 255, 0.9);
  background: rgba(74, 158, 255, 0.1);
}

.nge-profile-email {
  font-style: italic;
  color: rgba(158, 158, 158, 0.7);
  font-size: 0.82em;
  margin-bottom: 4px;
}

.nge-profile-bio {
  font-size: 0.82em;
  color: #aaa;
  line-height: 1.45;
  font-style: italic;
  margin-top: 4px;
}

.nge-profile-bio-add {
  background: none; border: none;
  font-size: 0.78em;
  color: rgba(74, 158, 255, 0.45);
  cursor: pointer; padding: 0; margin-top: 4px;
  transition: color 0.15s;
  font-style: italic;
}
.nge-profile-bio-add:hover { color: rgba(74, 158, 255, 0.8); }

/* ─────────────────────────────────────────────────────────────────────────────
   SECTIONS (shared layout)
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-section {
  margin-bottom: 22px;
  padding-bottom: 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.nge-profile-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }

/* Section label: "▌ EDITS" style */
.nge-profile-section-label {
  font-size: 0.63em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(74, 158, 255, 0.65);
  margin-bottom: 12px;
}

.nge-profile-section-label--amber { color: rgba(245, 166, 35, 0.65); }

/* Section roll-in delays */
.nge-profile-section--edits   { animation: ngeSectionRollIn 0.2s ease-out 0.18s both; }
.nge-profile-section--cells   { animation: ngeSectionRollIn 0.2s ease-out 0.24s both; }
.nge-profile-section--streak  { animation: ngeSectionRollIn 0.2s ease-out 0.29s both; }
.nge-profile-section--badges  { animation: ngeSectionRollIn 0.2s ease-out 0.33s both; }

/* ── Stat row ── */
.nge-profile-stat-row {
  display: flex;
  gap: 16px;
}

.nge-profile-stat-col {
  flex: 1;
}

.nge-profile-stat-label {
  font-size: 0.68em;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.nge-profile-stat-val {
  font-size: 1.2em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  color: #d8dde8;
  letter-spacing: -0.02em;
}

.nge-profile-stat-val--hero {
  font-size: 1.6em;
  color: rgba(120, 200, 255, 0.9);
  text-shadow: 0 0 20px rgba(74, 158, 255, 0.3);
}

.nge-profile-stat-sub {
  font-size: 0.7em;
  color: #444;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

/* ── Streak ── */
.nge-profile-streak-row {
  display: flex;
  align-items: baseline;
  gap: 18px;
  flex-wrap: wrap;
}

.nge-profile-streak-current {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.nge-profile-streak-flame { font-size: 1.25em; line-height: 1; }
.nge-profile-streak-count { font-size: 1.7em; font-weight: 800; color: #f5a623; line-height: 1; }
.nge-profile-streak-unit  { font-size: 0.8em; color: #777; }

.nge-profile-streak-best {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 0.82em;
}
.nge-profile-streak-best-label { color: #555; }
.nge-profile-streak-best-val   { color: #888; font-weight: 600; }

/* ── Badges ── */
.nge-profile-badges-hint {
  font-size: 0.7em;
  color: rgba(74, 158, 255, 0.45);
  font-style: italic;
  margin-bottom: 10px;
}

.nge-profile-badges-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.nge-profile-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: default;
  transition: transform 0.15s;
  border-radius: 6px;
  padding: 3px 2px;
  transition: transform 0.15s, background 0.15s;
}

.nge-profile-badge:not(.nge-profile-badge--locked) { cursor: pointer; }
.nge-profile-badge:not(.nge-profile-badge--locked):hover { transform: scale(1.1); }
.nge-profile-badge--selected {
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.3) inset;
}
.nge-profile-badge--selected .nge-profile-badge-img {
  filter: drop-shadow(0 0 6px rgba(100, 180, 255, 0.75));
}

.nge-profile-badge-img {
  display: flex; align-items: center; justify-content: center;
  width: 54px; height: 54px;
  transition: filter 0.15s;
}

.nge-profile-badge-icon { width: 48px; height: 48px; object-fit: contain; }

.nge-profile-badge-mystery {
  width: 42px; height: 42px;
  background: rgba(255,255,255,0.04);
  border: 2px dashed rgba(255,255,255,0.12);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  display: flex; align-items: center; justify-content: center;
}
.nge-profile-badge-mystery-q {
  font-size: 1.1em; font-weight: 700; color: rgba(255,255,255,0.18); font-style: italic; line-height: 1;
}

.nge-profile-badge-name {
  font-size: 0.62em; color: #888; margin-top: 3px; line-height: 1.2;
  max-width: 60px; word-break: break-word;
}
.nge-profile-badge-name--locked { color: #333; }

/* ─────────────────────────────────────────────────────────────────────────────
   VIZ COLUMN
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-viz-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  animation: ngeSectionRollIn 0.2s ease-out 0.15s both;
}

.nge-profile-viz-title {
  font-size: 0.63em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(74, 158, 255, 0.55);
  align-self: flex-start;
}

.nge-profile-canvas { display: block; }

/* Pulse when new cells submitted */
@keyframes ngeCellsPulse {
  0%   { filter: brightness(1.8) drop-shadow(0 0 12px rgba(120,200,255,0.9)); }
  100% { filter: brightness(1)   drop-shadow(0 0 0px rgba(120,200,255,0));  }
}
.nge-canvas-pulse { animation: ngeCellsPulse 0.7s ease-out both; }

.nge-profile-viz-legend {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: center;
}
.nge-profile-viz-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.nge-profile-viz-dot--completed  { background: rgba(120, 200, 255, 0.9); }
.nge-profile-viz-dot--contributed { background: rgba(100,160,255,0.22); border: 1px solid rgba(100,160,255,0.45); }
.nge-profile-viz-legend-lbl { font-size: 0.66em; color: #444; margin-right: 5px; }

.nge-profile-viz-count { font-size: 0.68em; color: #444; text-align: center; }

/* Badge detail in viz column */
.nge-profile-viz-badge { justify-content: center; text-align: center; gap: 12px; }

.nge-profile-viz-badge-icon { width: 88px; height: 88px; object-fit: contain; filter: drop-shadow(0 0 16px rgba(74,158,255,0.35)); }

.nge-profile-viz-badge-name {
  font-size: 1em; font-weight: 700; color: #e0e8f4;
  text-shadow: 0 0 20px rgba(74,158,255,0.25);
}

.nge-profile-viz-badge-desc { font-size: 0.8em; color: #888; line-height: 1.4; font-style: italic; }

.nge-profile-viz-badge-threshold {
  font-size: 0.75em; color: #555; line-height: 1.5; text-align: center;
}
.nge-profile-viz-badge-threshold strong { color: rgba(74,158,255,0.7); font-size: 1.15em; }

.nge-profile-viz-badge-back {
  margin-top: 4px;
  background: none; border: none;
  font-size: 0.75em; color: rgba(74,158,255,0.5);
  cursor: pointer; padding: 4px 8px; border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.nge-profile-viz-badge-back:hover { color: rgba(74,158,255,0.9); background: rgba(74,158,255,0.1); }

/* Viz swap transition */
.nge-viz-swap-enter-active { transition: all 0.18s ease-out; }
.nge-viz-swap-leave-active { transition: all 0.12s ease-in; }
.nge-viz-swap-enter-from   { opacity: 0; transform: translateX(12px); }
.nge-viz-swap-leave-to     { opacity: 0; transform: translateX(-12px); }
</style>
