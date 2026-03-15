<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted, watch, nextTick} from 'vue';
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';

import {useLoginStore, useUserStatsStore, useUserPreferencesStore, useCellHistoryStore, useProofreadingBackendStore, CellHistoryEntry} from '../store';
import {BADGE_DEFINITIONS, BUILDING_BADGES, EXPLORATION_BADGES, BadgeDefinition, BadgeTrack, statKeyForTrack} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {DEMO_USERS, DEMO_COMMUNITY_EDITS_WEEK, DEMO_COMMUNITY_EDITS_MONTH} from '../data/demo-users';

// ── Stores ────────────────────────────────────────────────────────────────────
const {sessions} = storeToRefs(useLoginStore());
const statsStore  = useUserStatsStore();
const {stats}     = storeToRefs(statsStore);
const prefsStore  = useUserPreferencesStore();
const {prefs}     = storeToRefs(prefsStore);
const historyStore = useCellHistoryStore();
const {cells: cellHistory} = storeToRefs(historyStore);

// Refresh stats from Supabase when profile opens
const backendStore = useProofreadingBackendStore();
backendStore.loadUserStats();

// ── Local state ───────────────────────────────────────────────────────────────
const closing        = ref(false);
const selectedBadge  = ref<BadgeDefinition | null>(null);
const showFlagPicker = ref(false);
const cellCanvas     = ref<HTMLCanvasElement | null>(null);

// ── Inline flag picker ────────────────────────────────────────────────────────
// All country flags A-Z (ISO 3166-1 alpha-2, sorted alphabetically)
const ALL_FLAGS = [
  '🇦🇫','🇦🇱','🇩🇿','🇦🇸','🇦🇩','🇦🇴','🇦🇬','🇦🇷','🇦🇲','🇦🇺',
  '🇦🇹','🇦🇿','🇧🇸','🇧🇭','🇧🇩','🇧🇧','🇧🇾','🇧🇪','🇧🇿','🇧🇯',
  '🇧🇹','🇧🇴','🇧🇦','🇧🇼','🇧🇷','🇧🇳','🇧🇬','🇧🇫','🇧🇮','🇰🇭',
  '🇨🇲','🇨🇦','🇨🇻','🇨🇫','🇹🇩','🇨🇱','🇨🇳','🇨🇴','🇰🇲','🇨🇬',
  '🇨🇩','🇨🇷','🇭🇷','🇨🇺','🇨🇾','🇨🇿','🇩🇰','🇩🇯','🇩🇲','🇩🇴',
  '🇪🇨','🇪🇬','🇸🇻','🇬🇶','🇪🇷','🇪🇪','🇸🇿','🇪🇹','🇫🇯','🇫🇮',
  '🇫🇷','🇬🇦','🇬🇲','🇬🇪','🇩🇪','🇬🇭','🇬🇷','🇬🇩','🇬🇹','🇬🇳',
  '🇬🇼','🇬🇾','🇭🇹','🇭🇳','🇭🇺','🇮🇸','🇮🇳','🇮🇩','🇮🇷','🇮🇶',
  '🇮🇪','🇮🇱','🇮🇹','🇨🇮','🇯🇲','🇯🇵','🇯🇴','🇰🇿','🇰🇪','🇰🇮',
  '🇰🇵','🇰🇷','🇰🇼','🇰🇬','🇱🇦','🇱🇻','🇱🇧','🇱🇸','🇱🇷','🇱🇾',
  '🇱🇮','🇱🇹','🇱🇺','🇲🇬','🇲🇼','🇲🇾','🇲🇻','🇲🇱','🇲🇹','🇲🇭',
  '🇲🇷','🇲🇺','🇲🇽','🇫🇲','🇲🇩','🇲🇨','🇲🇳','🇲🇪','🇲🇦','🇲🇿',
  '🇲🇲','🇳🇦','🇳🇷','🇳🇵','🇳🇱','🇳🇿','🇳🇮','🇳🇪','🇳🇬','🇲🇰',
  '🇳🇴','🇴🇲','🇵🇰','🇵🇼','🇵🇦','🇵🇬','🇵🇾','🇵🇪','🇵🇭','🇵🇱',
  '🇵🇹','🇶🇦','🇷🇴','🇷🇺','🇷🇼','🇰🇳','🇱🇨','🇻🇨','🇼🇸','🇸🇲',
  '🇸🇹','🇸🇦','🇸🇳','🇷🇸','🇸🇨','🇸🇱','🇸🇬','🇸🇰','🇸🇮','🇸🇧',
  '🇸🇴','🇿🇦','🇸🇸','🇪🇸','🇱🇰','🇸🇩','🇸🇷','🇸🇪','🇨🇭','🇸🇾',
  '🇹🇼','🇹🇯','🇹🇿','🇹🇭','🇹🇱','🇹🇬','🇹🇴','🇹🇹','🇹🇳','🇹🇷',
  '🇹🇲','🇹🇻','🇺🇬','🇺🇦','🇦🇪','🇬🇧','🇺🇸','🇺🇾','🇺🇿','🇻🇺',
  '🇻🇪','🇻🇳','🇾🇪','🇿🇲','🇿🇼',
];

/** Convert flag emoji to ISO 3166-1 alpha-2 code (🇺🇸 → 'us'). */
function emojiToCode(emoji: string): string {
  const pts = [...emoji];
  if (pts.length < 2) return '';
  return pts.slice(0, 2).map(c => String.fromCharCode((c.codePointAt(0)! - 0x1F1E6) + 97)).join('');
}

/** Get a flag image URL from an emoji flag. Returns '' for non-flag emoji like 🌐. */
function flagImgUrl(emoji: string): string {
  const code = emojiToCode(emoji);
  if (!code || code.length !== 2) return '';
  return `https://flagcdn.com/w40/${code}.png`;
}

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

  const W = 270, H = 310;
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
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('minnie65', bR - 2, bB - 3);

  const completed   = Math.min(stats.value.cellsSubmitted, 400);
  const estimated   = Math.round(stats.value.editsAllTime / 30);
  const contributed = Math.min(Math.max(0, estimated - stats.value.cellsSubmitted), 250);
  const todayEdits  = Math.min(stats.value.editsToday, 80); // today's edits in amber

  if (completed === 0 && contributed === 0 && todayEdits === 0) {
    ctx.fillStyle = 'rgba(100, 130, 160, 0.3)';
    ctx.font = '11px system-ui, sans-serif';
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

  // Today's edits — amber/green dots with glow (drawn on top so they pop)
  const rngToday = seededRNG(77 + todayEdits); // seed changes as count grows
  for (let i = 0; i < todayEdits; i++) {
    const x = bL + inset + rngToday() * (bW - 2 * inset);
    const y = bT + inset + rngToday() * (bH - 2 * inset);
    // Glow
    const grd = ctx.createRadialGradient(x, y, 0, x, y, 7);
    grd.addColorStop(0, 'rgba(120, 255, 160, 0.45)');
    grd.addColorStop(1, 'rgba(120, 255, 160, 0)');
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
    // Dot
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120, 255, 160, 0.95)';
    ctx.fill();
  }
}

// Pulse the canvas when new cells are submitted or edits happen today
watch(() => stats.value.cellsSubmitted, (newVal, oldVal) => {
  if (newVal > oldVal) {
    nextTick(() => {
      cellCanvas.value?.classList.add('nge-canvas-pulse');
      setTimeout(() => cellCanvas.value?.classList.remove('nge-canvas-pulse'), 700);
    });
  }
});

// Also pulse on today's edits (segment interactions)
watch(() => stats.value.editsToday, (newVal, oldVal) => {
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

/** Get the player's current count for a given track. */
function statForTrack(track: BadgeTrack): number {
  return track === 'building'
    ? (stats.value.editsAllTime ?? 0)
    : (stats.value.cellsSubmitted ?? 0);
}

function isBadgeEarned(badge: BadgeDefinition): boolean {
  if (badge.threshold === 0) return false;
  return statForTrack(badge.track) >= badge.threshold;
}

function onBadgeClick(badge: BadgeDefinition) {
  if (!isBadgeEarned(badge)) return;
  // Toggle: click same badge again to return to cells canvas
  selectedBadge.value = selectedBadge.value?.id === badge.id ? null : badge;
}

/** Label for the threshold in badge detail. */
function thresholdLabel(badge: BadgeDefinition): string {
  return badge.track === 'building' ? 'edits' : 'cells completed';
}

// ── Achievement countdown (shows next badge across both tracks) ──────────────
const nextAchievement = computed(() => {
  // Find next unearned badge from each track, show whichever is closer
  function nextFor(badges: BadgeDefinition[], current: number) {
    const sorted = [...badges].filter(b => b.threshold > 0).sort((a, b) => a.threshold - b.threshold);
    const next = sorted.find(b => current < b.threshold);
    if (!next) return null;
    const prev = sorted[sorted.indexOf(next) - 1]?.threshold ?? 0;
    const remaining = next.threshold - current;
    const pct = Math.min(100, Math.round(((current - prev) / (next.threshold - prev)) * 100));
    return { name: next.name, threshold: next.threshold, remaining, pct, track: next.track as BadgeTrack };
  }
  const building = nextFor(BUILDING_BADGES, stats.value.editsAllTime ?? 0);
  const exploration = nextFor(EXPLORATION_BADGES, stats.value.cellsSubmitted ?? 0);
  // Prefer whichever has fewer remaining (closer to unlock)
  if (!building) return exploration;
  if (!exploration) return building;
  return building.remaining <= exploration.remaining ? building : exploration;
});

// ── Current dataset helper (for filtering cells) ────────────────────────────
function getCurrentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      // Check layer type name (works even if dataSources haven't loaded)
      const typeName = ml.layer?.constructor?.name ?? '';
      if (typeName.includes('Segmentation')) return ml.name ?? '';
      // Fallback: check URL
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('graphene') || url.includes('segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}
const currentDataset = ref('');
onMounted(() => { currentDataset.value = getCurrentDataset(); });

// ── Cell history helpers ──────────────────────────────────────────────────────
/** Filter cells by current dataset (if set). Cells without a dataset tag always show. */
const filteredCellHistory = computed(() => {
  const ds = currentDataset.value;
  if (!ds) return cellHistory.value;
  return cellHistory.value.filter(c => !c.dataset || c.dataset === ds);
});

const completedCells = computed(() => filteredCellHistory.value.filter(c => c.isComplete));
const identifiedCells = computed(() => filteredCellHistory.value.filter(c => c.cellType && !c.isComplete));

// ── 14-day activity chart data ───────────────────────────────────────────────
const last14Days = computed(() => {
  const days: Array<{ date: string; label: string; edits: number; quests: number; total: number }> = [];
  const log = statsStore.dailyLog;
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = log.find((e: {date: string}) => e.date === dateStr);
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'narrow' });
    days.push({
      date: dateStr,
      label: i === 0 ? 'Today' : dayLabel,
      edits: entry?.edits ?? 0,
      quests: entry?.questsCompleted ?? 0,
      total: (entry?.edits ?? 0) + (entry?.questsCompleted ?? 0),
    });
  }
  return days;
});

const chartMax = computed(() => Math.max(1, ...last14Days.value.map(d => d.total)));

function truncateId(id: string): string {
  return id.length > 12 ? id.slice(0, 5) + '…' + id.slice(-5) : id;
}

function cellStatusIcon(cell: CellHistoryEntry): string {
  if (cell.isComplete && cell.cellType) return '✓';
  if (cell.isComplete) return '✓';
  if (cell.cellType) return '🏷';
  return '○';
}

function cellStatusClass(cell: CellHistoryEntry): string {
  if (cell.isComplete) return 'nge-cell-status--complete';
  if (cell.cellType) return 'nge-cell-status--typed';
  return 'nge-cell-status--pending';
}

function handleJumpToCell(segId: string) {
  historyStore.jumpToCell(segId);
  handleClose();
}

function promptNickname(segId: string) {
  const cell = cellHistory.value.find(c => c.segId === segId);
  const current = cell?.nickname ?? '';
  const name = window.prompt('Name this cell:', current);
  if (name !== null) {
    historyStore.setNickname(segId, name);
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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

      <!-- ── Three-column body ──────────────────────────────── -->
      <div class="nge-profile-body">

        <!-- LEFT: stats + recent cells -->
        <div class="nge-profile-col nge-profile-col--left">

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
                >
                  <img v-if="flagImgUrl(prefs.flag || '')" :src="flagImgUrl(prefs.flag)" class="nge-flag-img" />
                  <span v-else>🌐</span>
                </button>
                <Transition name="nge-flag-picker">
                  <div v-if="showFlagPicker" class="nge-profile-flag-picker">
                    <button
                      v-for="f in ALL_FLAGS" :key="f"
                      class="nge-profile-flag-opt"
                      :class="{ 'nge-profile-flag-opt--active': prefs.flag === f }"
                      @click="setFlag(f)"
                    ><img :src="flagImgUrl(f)" class="nge-flag-img nge-flag-img--picker" /></button>
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
                {label:'Today',    val:stats.editsToday,    merges:stats.mergesToday,    splits:stats.splitsToday},
                {label:'Past 7d',  val:stats.editsThisWeek, merges:stats.mergesThisWeek, splits:stats.splitsThisWeek},
                {label:'All Time', val:stats.editsAllTime,  merges:stats.mergesAllTime,  splits:stats.splitsAllTime},
              ]" :key="i">
                <div class="nge-profile-stat-label">{{ col.label }}</div>
                <div class="nge-profile-stat-val">{{ col.val.toLocaleString() }}</div>
                <div class="nge-profile-stat-breakdown">
                  <span class="nge-profile-stat-bp" title="Merges">
                    <svg class="nge-profile-stat-icon nge-profile-stat-icon--merge" viewBox="0 0 16 16" fill="none">
                      <path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <circle cx="4" cy="2.5" r="1.5" fill="currentColor"/>
                      <circle cx="12" cy="2.5" r="1.5" fill="currentColor"/>
                      <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
                      <path d="M8 11v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                    {{ col.merges }}
                  </span>
                  <span class="nge-profile-stat-bp" title="Splits">
                    <svg class="nge-profile-stat-icon nge-profile-stat-icon--split" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <circle cx="8" cy="2.5" r="1.5" fill="currentColor"/>
                      <circle cx="4" cy="13" r="1.5" fill="currentColor"/>
                      <circle cx="12" cy="13" r="1.5" fill="currentColor"/>
                      <path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                    {{ col.splits }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Cells stats -->
          <div class="nge-profile-section nge-profile-section--cells">
            <div class="nge-profile-section-label">▌ Cells</div>
            <div class="nge-profile-stat-row">
              <div class="nge-profile-stat-col">
                <div class="nge-profile-stat-label">Completed</div>
                <div class="nge-profile-stat-val nge-profile-stat-val--hero">
                  {{ completedCells.length.toLocaleString() }}
                </div>
                <div class="nge-profile-stat-sub">proofread</div>
              </div>
              <div class="nge-profile-stat-col">
                <div class="nge-profile-stat-label">Identified</div>
                <div class="nge-profile-stat-val">{{ identifiedCells.length.toLocaleString() }}</div>
                <div class="nge-profile-stat-sub">typed only</div>
              </div>
              <div class="nge-profile-stat-col">
                <div class="nge-profile-stat-label">Total</div>
                <div class="nge-profile-stat-val">{{ filteredCellHistory.length.toLocaleString() }}</div>
                <div class="nge-profile-stat-sub">touched</div>
              </div>
            </div>

            <!-- Cell history list -->
            <div class="nge-cell-list" v-if="filteredCellHistory.length > 0">
              <div class="nge-cell-list-header">
                <span>Recent cells — click to jump</span>
                <span v-if="currentDataset" class="nge-cell-list-dataset" :title="'Filtered to ' + currentDataset">{{ currentDataset }}</span>
              </div>
              <div class="nge-cell-list-scroll">
                <div
                  v-for="cell in filteredCellHistory.slice(0, 50)"
                  :key="cell.segId"
                  class="nge-cell-row"
                  :title="cell.nickname ? `${cell.nickname} (${cell.segId})` : `Jump to ${cell.segId}`"
                >
                  <button
                    class="nge-cell-fav"
                    :class="{ 'nge-cell-fav--active': cell.isFavorite }"
                    @click.stop="historyStore.toggleFavorite(cell.segId)"
                    title="Toggle favorite"
                  >{{ cell.isFavorite ? '★' : '☆' }}</button>
                  <span class="nge-cell-pip" :class="cellStatusClass(cell)">{{ cellStatusIcon(cell) }}</span>
                  <span class="nge-cell-id" @click="handleJumpToCell(cell.segId)">
                    {{ cell.nickname || truncateId(cell.segId) }}
                  </span>
                  <span class="nge-cell-type" v-if="cell.cellType" @click="handleJumpToCell(cell.segId)">{{ cell.cellType }}</span>
                  <span class="nge-cell-time" @click="handleJumpToCell(cell.segId)">{{ relativeTime(cell.updatedAt) }}</span>
                  <button
                    class="nge-cell-rename"
                    @click.stop="promptNickname(cell.segId)"
                    title="Rename this cell"
                  >✎</button>
                </div>
              </div>
            </div>
            <div class="nge-cell-empty" v-else>
              Select segments and mark complete or set cell type to build your history.
            </div>
          </div>

        </div><!-- end left column -->

        <!-- CENTER: countdown + badges + streak -->
        <div class="nge-profile-col nge-profile-col--center">

          <!-- Achievement countdown — moved to top of center column -->
          <div class="nge-profile-section nge-profile-section--countdown" v-if="nextAchievement">
            <div class="nge-profile-section-label nge-profile-section-label--green">▌ Next Achievement</div>
            <div class="nge-profile-countdown-row">
              <div class="nge-profile-countdown-name">{{ nextAchievement.name }}</div>
              <div class="nge-profile-countdown-remaining">{{ nextAchievement.remaining.toLocaleString() }} {{ nextAchievement.track === 'building' ? 'edits' : 'cells' }} to go</div>
            </div>
            <div class="nge-profile-countdown-track">
              <div class="nge-profile-countdown-fill" :style="{ width: nextAchievement.pct + '%' }"></div>
            </div>
            <div class="nge-profile-countdown-labels">
              <span>{{ (nextAchievement.threshold - nextAchievement.remaining).toLocaleString() }}</span>
              <span>{{ nextAchievement.pct }}%</span>
              <span>{{ nextAchievement.threshold.toLocaleString() }}</span>
            </div>
          </div>

          <!-- Edit Achievements (building track) -->
          <div class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-section-label" style="color: #ffd08a;">▌ Edit Achievements</div>
            <div class="nge-profile-badges-hint" v-if="selectedBadge?.track === 'building'">
              achievement detail on the right · click again to dismiss
            </div>
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in BUILDING_BADGES"
                :key="badge.id"
                class="nge-profile-badge"
                :class="{
                  'nge-profile-badge--locked':   !isBadgeEarned(badge),
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                }"
                :title="isBadgeEarned(badge)
                  ? badge.name + ' — click to see detail'
                  : '??? — keep editing to unlock!'"
                @click="onBadgeClick(badge)"
              >
                <template v-if="isBadgeEarned(badge)">
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

          <!-- Divider between achievement tracks -->
          <div class="nge-profile-badges-divider"></div>

          <!-- Cell Achievements (exploration track) -->
          <div class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-section-label" style="color: #90fff2;">▌ Cell Achievements</div>
            <div class="nge-profile-badges-hint" v-if="selectedBadge?.track === 'exploration'">
              achievement detail on the right · click again to dismiss
            </div>
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in EXPLORATION_BADGES"
                :key="badge.id"
                class="nge-profile-badge"
                :class="{
                  'nge-profile-badge--locked':   !isBadgeEarned(badge),
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                }"
                :title="isBadgeEarned(badge)
                  ? badge.name + ' — click to see detail'
                  : '??? — complete more cells to unlock!'"
                @click="onBadgeClick(badge)"
              >
                <template v-if="isBadgeEarned(badge)">
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

          <!-- Streak + Activity Chart -->
          <div class="nge-profile-section nge-profile-section--streak">
            <div class="nge-profile-section-label nge-profile-section-label--amber">▌ Streak</div>
            <div class="nge-profile-streak-row" v-if="stats.currentStreak > 0 || stats.longestStreak > 0">
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

            <!-- 14-day activity chart -->
            <div class="nge-profile-activity-chart">
              <div class="nge-profile-chart-label">Last 14 Days</div>
              <div class="nge-profile-chart-bars">
                <div
                  v-for="day in last14Days"
                  :key="day.date"
                  class="nge-profile-chart-col"
                  :title="`${day.date}: ${day.edits} edits, ${day.quests} quests`"
                >
                  <div class="nge-profile-chart-bar-wrap">
                    <div
                      v-if="day.quests > 0"
                      class="nge-profile-chart-bar nge-profile-chart-bar--quest"
                      :style="{ height: Math.max(2, (day.quests / chartMax) * 48) + 'px' }"
                    ></div>
                    <div
                      v-if="day.edits > 0"
                      class="nge-profile-chart-bar nge-profile-chart-bar--edit"
                      :style="{ height: Math.max(2, (day.edits / chartMax) * 48) + 'px' }"
                    ></div>
                  </div>
                  <div class="nge-profile-chart-day">{{ day.label }}</div>
                </div>
              </div>
              <div class="nge-profile-chart-legend">
                <span class="nge-profile-chart-legend-item">
                  <span class="nge-profile-chart-legend-dot nge-profile-chart-legend-dot--edit"></span> Edits
                </span>
                <span class="nge-profile-chart-legend-item">
                  <span class="nge-profile-chart-legend-dot nge-profile-chart-legend-dot--quest"></span> Quests
                </span>
              </div>
            </div>
          </div>


        </div><!-- end center column -->

        <!-- RIGHT: cell canvas  <->  badge detail -->
        <div class="nge-profile-col nge-profile-col--right">
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
                <span class="nge-profile-viz-dot nge-profile-viz-dot--today"></span>
                <span class="nge-profile-viz-legend-lbl">today</span>
              </div>
              <div class="nge-profile-viz-count">
                {{ stats.cellsSubmitted.toLocaleString() }} cells submitted
              </div>
            </div>

            <!-- Badge detail view -->
            <div v-else key="badge" class="nge-profile-viz-panel nge-profile-viz-badge">
              <div class="nge-profile-viz-title">▌ Achievement Detail</div>
              <img
                :src="getBadgeUrl(selectedBadge.imageKey)"
                :alt="selectedBadge.name"
                class="nge-profile-viz-badge-icon"
              />
              <div class="nge-profile-viz-badge-name">{{ selectedBadge.name }}</div>
              <div class="nge-profile-viz-badge-desc">{{ selectedBadge.description }}</div>
              <div class="nge-profile-viz-badge-threshold">
                Unlocked at<br>
                <strong>{{ selectedBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(selectedBadge) }}
              </div>
              <button class="nge-profile-viz-badge-back" @click="selectedBadge = null">
                ← Back to cells map
              </button>
            </div>

          </Transition>
        </div><!-- end right column -->

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
  background: linear-gradient(135deg, rgba(4, 6, 14, 0.97) 0%, rgba(8, 12, 24, 0.95) 50%, rgba(4, 8, 18, 0.97) 100%) !important;
}

/* Scanline removed — holographic border glow handled by ModalOverlay */

/* Close animation — overrides materialize with higher specificity */
.nge-profile-closing.nge-profile-modal :deep(.nge-overlay) {
  animation: ngeProfileCollapse 0.15s ease-in both;
}

@keyframes ngeProfileMaterialize {
  0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.97); filter: blur(10px) brightness(2.5); box-shadow: 0 0 80px rgba(0,180,255,0.5); }
  30%  { opacity: 0.8; transform: translate(-50%,-50%) scale(1.003); filter: blur(1px) brightness(1.2); }
  60%  { opacity: 1; transform: translate(-50%,-50%) scale(0.998); filter: blur(0) brightness(1.05); }
  100% { opacity: 1; transform: translate(-50%,-50%); filter: blur(0) brightness(1); box-shadow: none; }
}

@keyframes ngeProfileCollapse {
  0%   { opacity: 1; transform: translate(-50%,-50%) scale(1); filter: blur(0) brightness(1); }
  50%  { filter: blur(0) brightness(1.3); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(0.94); filter: blur(10px) brightness(2); }
}

/* (scanline keyframe removed — using ModalOverlay holographic effects) */

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

/* ── Three-column body ── */
.nge-profile-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── Shared column base ── */
.nge-profile-col {
  overflow-y: auto;
  padding: 20px 24px 32px;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}
.nge-profile-col::-webkit-scrollbar        { width: 4px; }
.nge-profile-col::-webkit-scrollbar-track  { background: rgba(255, 255, 255, 0.02); }
.nge-profile-col::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }
.nge-profile-col::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.4); }

/* Left: stats + recent cells */
.nge-profile-col--left {
  width: 320px;
  flex-shrink: 0;
}

/* Center: badges + streak + countdown */
.nge-profile-col--center {
  width: 340px;
  flex-shrink: 0;
  border-left: 1px solid rgba(74, 158, 255, 0.08);
  border-right: 1px solid rgba(74, 158, 255, 0.08);
  background: rgba(74, 158, 255, 0.01);
}

/* Right: cells mapped visualization */
.nge-profile-col--right {
  width: 310px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
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

/* Flag images (cross-platform — Windows doesn't render flag emoji) */
.nge-flag-img { width: 24px; height: 18px; object-fit: cover; border-radius: 2px; vertical-align: middle; }
.nge-flag-img--picker { width: 28px; height: 20px; }

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
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  max-height: 240px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.3) transparent;
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

.nge-profile-section-label--green { color: rgba(127, 255, 136, 0.65); }

/* Section roll-in delays */
.nge-profile-section--edits     { animation: ngeSectionRollIn 0.2s ease-out 0.18s both; }
.nge-profile-section--cells     { animation: ngeSectionRollIn 0.2s ease-out 0.24s both; }
.nge-profile-section--streak    { animation: ngeSectionRollIn 0.2s ease-out 0.29s both; }
.nge-profile-section--badges    { animation: ngeSectionRollIn 0.2s ease-out 0.33s both; }
.nge-profile-section--countdown { animation: ngeSectionRollIn 0.2s ease-out 0.37s both; }

/* ── Achievement countdown ── */
.nge-profile-countdown-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.nge-profile-countdown-name { font-weight: 600; color: #ddd; font-size: 0.92em; }
.nge-profile-countdown-remaining { font-size: 0.75em; color: #9e9e9e; }
.nge-profile-countdown-track {
  height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden;
}
.nge-profile-countdown-fill {
  height: 100%; background: linear-gradient(90deg, #7f8, #4a9eff); border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.nge-profile-countdown-labels {
  display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.68em; color: #555;
}

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

.nge-profile-stat-breakdown {
  display: flex;
  gap: 10px;
  margin-top: 5px;
}

.nge-profile-stat-bp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.92em;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-variant-numeric: tabular-nums;
  color: #889;
}

.nge-profile-stat-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.nge-profile-stat-icon--merge { color: rgba(120, 200, 255, 0.9); }
.nge-profile-stat-icon--split { color: rgba(255, 160, 100, 0.9); }

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

/* ── Activity chart ────────────────────────────────────────── */
.nge-profile-activity-chart {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.nge-profile-chart-label {
  font-size: 0.68em;
  color: #556;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.nge-profile-chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 64px;
  padding-bottom: 16px;
}

.nge-profile-chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.nge-profile-chart-bar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 48px;
  width: 100%;
  gap: 1px;
}

.nge-profile-chart-bar {
  width: 100%;
  max-width: 12px;
  border-radius: 2px 2px 0 0;
  min-height: 0;
  transition: height 0.3s ease;
}

.nge-profile-chart-bar--edit {
  background: linear-gradient(to top, rgba(74, 158, 255, 0.5), rgba(74, 158, 255, 0.8));
}

.nge-profile-chart-bar--quest {
  background: linear-gradient(to top, rgba(206, 147, 216, 0.5), rgba(206, 147, 216, 0.8));
  border-radius: 2px;
}

.nge-profile-chart-day {
  font-size: 0.55em;
  color: #445;
  margin-top: 3px;
  white-space: nowrap;
}

.nge-profile-chart-legend {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 4px;
}

.nge-profile-chart-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.62em;
  color: #556;
}

.nge-profile-chart-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.nge-profile-chart-legend-dot--edit {
  background: rgba(74, 158, 255, 0.7);
}

.nge-profile-chart-legend-dot--quest {
  background: rgba(206, 147, 216, 0.7);
}

/* ── Badges ── */
.nge-profile-badges-divider {
  height: 1px;
  margin: 14px 0 8px;
  background: linear-gradient(90deg, transparent 0%, rgba(74, 158, 255, 0.2) 30%, rgba(74, 158, 255, 0.2) 70%, transparent 100%);
}

.nge-profile-badges-hint {
  font-size: 0.7em;
  color: rgba(74, 158, 255, 0.45);
  font-style: italic;
  margin-bottom: 10px;
}

.nge-profile-badges-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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
  font-size: 0.78em;
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
  display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.nge-profile-viz-dot--completed  { background: rgba(120, 200, 255, 0.9); }
.nge-profile-viz-dot--contributed { background: rgba(100,160,255,0.22); border: 1px solid rgba(100,160,255,0.45); }
.nge-profile-viz-dot--today       { background: rgba(120, 255, 160, 0.9); }
.nge-profile-viz-legend-lbl { font-size: 0.78em; color: #555; margin-right: 5px; }

.nge-profile-viz-count { font-size: 0.85em; color: #666; text-align: center; font-weight: 600; }

/* Badge detail in viz column */
.nge-profile-viz-badge { justify-content: center; text-align: center; gap: 12px; }

.nge-profile-viz-badge-icon { width: 140px; height: 140px; object-fit: contain; filter: drop-shadow(0 0 20px rgba(74,158,255,0.4)); }

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

/* ─────────────────────────────────────────────────────────────────────────────
   CELL HISTORY LIST
───────────────────────────────────────────────────────────────────────────── */
.nge-cell-list {
  margin-top: 16px;
}

.nge-cell-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.nge-cell-list-header span {
  font-size: 0.68em;
  color: rgba(74, 158, 255, 0.45);
  font-style: italic;
}

.nge-cell-list-dataset {
  font-size: 0.62em !important;
  font-style: normal !important;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(74, 158, 255, 0.08);
  border: 1px solid rgba(74, 158, 255, 0.2);
  color: rgba(74, 158, 255, 0.6) !important;
  font-weight: 500;
}

.nge-cell-list-scroll {
  max-height: 200px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}

.nge-cell-list-scroll::-webkit-scrollbar       { width: 3px; }
.nge-cell-list-scroll::-webkit-scrollbar-track  { background: transparent; }
.nge-cell-list-scroll::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }

.nge-cell-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #bcc;
  font-size: 0.78em;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  overflow: hidden;
}

.nge-cell-row:hover {
  background: rgba(74, 158, 255, 0.1);
  color: #fff;
}

.nge-cell-pip {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-size: 0.9em;
}

.nge-cell-status--complete .nge-cell-pip,
.nge-cell-pip.nge-cell-status--complete { color: #CE93D8; }
.nge-cell-status--typed .nge-cell-pip,
.nge-cell-pip.nge-cell-status--typed    { color: #4CAF50; }
.nge-cell-status--pending .nge-cell-pip,
.nge-cell-pip.nge-cell-status--pending  { color: #555; }

.nge-cell-id {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.88em;
  color: #8bf;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}

.nge-cell-type {
  flex: 1;
  font-size: 0.85em;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.nge-cell-time {
  flex-shrink: 0;
  font-size: 0.8em;
  color: #444;
  white-space: nowrap;
}

.nge-cell-fav {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85em;
  padding: 0 2px;
  opacity: 0.3;
  transition: opacity 0.12s;
}
.nge-cell-row:hover .nge-cell-fav { opacity: 0.6; }
.nge-cell-fav--active { opacity: 1 !important; color: #f5a623; }

.nge-cell-rename {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85em;
  padding: 0 2px;
  opacity: 0;
  color: rgba(74, 158, 255, 0.6);
  transition: opacity 0.12s;
}
.nge-cell-row:hover .nge-cell-rename { opacity: 0.6; }
.nge-cell-rename:hover { opacity: 1 !important; }

.nge-cell-empty {
  margin-top: 12px;
  font-size: 0.75em;
  color: #444;
  font-style: italic;
  line-height: 1.5;
}
</style>
