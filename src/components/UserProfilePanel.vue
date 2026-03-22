<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted} from 'vue';
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';

import {useLoginStore, useUserStatsStore, useUserPreferencesStore, useCellHistoryStore, useProofreadingBackendStore, useHelpRequestStore, CellHistoryEntry} from '../store';
import {BADGE_DEFINITIONS, BUILDING_BADGES, EXPLORATION_BADGES, BadgeDefinition, BadgeTrack, statKeyForTrack} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {DEMO_USERS, DEMO_COMMUNITY_EDITS_WEEK, DEMO_COMMUNITY_EDITS_MONTH} from '../data/demo-users';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

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

// Player assists — help requests resolved by current user
const helpStore = useHelpRequestStore();
const playerAssists = computed(() => {
  const name = backendStore.userName || backendStore.userEmail?.split('@')[0];
  if (!name) return 0;
  return helpStore.requests.filter(r => r.resolved && r.resolvedByName === name).length;
});

// ── Local state ───────────────────────────────────────────────────────────────
const closing        = ref(false);
const selectedBadge  = ref<BadgeDefinition | null>(null);
const selectedSpecialBadge = ref<any | null>(null);
const showFlagPicker = ref(false);
const showAllBuilding    = ref(false);
const showAllExploration = ref(false);
const BADGE_PREVIEW_LIMIT = 8;  // 2 rows of 4
const BADGE_PREVIEW_WITH_VIEWALL = 7;  // 7 badges + 1 "View All" tile = 8 slots

// ── Profile tabs ─────────────────────────────────────────────────────────────
const activeTab = ref<'overview' | 'trophyCase'>('overview');

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
// ── Demo seeding ─────────────────────────────────────────────────────────────
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
});

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
  selectedSpecialBadge.value = null;
  // Toggle: click same badge again to dismiss detail
  selectedBadge.value = selectedBadge.value?.id === badge.id ? null : badge;
}

function onSpecialBadgeClick(award: any) {
  selectedBadge.value = null;
  selectedSpecialBadge.value = selectedSpecialBadge.value?.id === award.id ? null : award;
}

// ── Earned badges + 1 upcoming "next" badge per track ────────────────────────
const earnedBuildingBadges = computed(() => {
  const earned = BUILDING_BADGES.filter(b => isBadgeEarned(b)).reverse();
  const nextLocked = BUILDING_BADGES.find(b => !isBadgeEarned(b));
  return { earned, next: nextLocked ?? null };
});

const earnedExplorationBadges = computed(() => {
  const earned = EXPLORATION_BADGES.filter(b => isBadgeEarned(b)).reverse();
  const nextLocked = EXPLORATION_BADGES.find(b => !isBadgeEarned(b));
  return { earned, next: nextLocked ?? null };
});

/** Most recently earned badge (highest threshold among earned). */
const latestEarnedBadge = computed(() => {
  const allEarned = BADGE_DEFINITIONS.filter(b => isBadgeEarned(b));
  if (allEarned.length === 0) return null;
  return allEarned.reduce((a, b) => a.threshold > b.threshold ? a : b);
});

// ── Favorite badge (persisted in localStorage) ────────────────────────────────
/** Favorite badge slug — synced to Supabase via store. */
const favoriteBadgeSlug = computed(() => backendStore.favoriteBadgeSlug);
const favoriteBadge = computed<BadgeDefinition | null>(() => {
  if (favoriteBadgeSlug.value) {
    const found = BADGE_DEFINITIONS.find(b => b.slug === favoriteBadgeSlug.value);
    if (found && isBadgeEarned(found)) return found;
  }
  return null;
});
/** Check if the favorite is a special badge (not a regular track badge). */
const favoriteSpecialBadge = computed(() => {
  if (!favoriteBadgeSlug.value || favoriteBadge.value) return null;
  return backendStore.mySpecialBadges.find(
    (a: any) => (a.badge?.slug || `special-${a.id}`) === favoriteBadgeSlug.value
  ) || null;
});
/** Badge shown in the Trophy Case featured banner. */
const featuredBadge = computed(() => selectedBadge.value ?? favoriteBadge.value ?? latestEarnedBadge.value);
function toggleFavoriteBadge(badge: BadgeDefinition) {
  const newSlug = favoriteBadgeSlug.value === badge.slug ? '' : badge.slug;
  backendStore.saveFavoriteBadge(newSlug);
}
function toggleFavoriteSpecialBadge(award: any) {
  const slug = award.badge?.slug || `special-${award.id}`;
  const newSlug = favoriteBadgeSlug.value === slug ? '' : slug;
  backendStore.saveFavoriteBadge(newSlug);
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const displayedBuildingBadges = computed(() => {
  const all = earnedBuildingBadges.value.earned;
  if (showAllBuilding.value) return all;
  // If overflow, show 7 to leave room for "View All" tile
  return all.length > BADGE_PREVIEW_LIMIT ? all.slice(0, BADGE_PREVIEW_WITH_VIEWALL) : all.slice(0, BADGE_PREVIEW_LIMIT);
});
const displayedExplorationBadges = computed(() => {
  const all = earnedExplorationBadges.value.earned;
  if (showAllExploration.value) return all;
  return all.length > BADGE_PREVIEW_LIMIT ? all.slice(0, BADGE_PREVIEW_WITH_VIEWALL) : all.slice(0, BADGE_PREVIEW_LIMIT);
});
const showBuildingViewAll = computed(() => earnedBuildingBadges.value.earned.length > BADGE_PREVIEW_LIMIT);
const showExplorationViewAll = computed(() => earnedExplorationBadges.value.earned.length > BADGE_PREVIEW_LIMIT);

/** Label for the threshold in badge detail. */
function thresholdLabel(badge: BadgeDefinition): string {
  return badge.track === 'building' ? 'edits' : 'cells completed';
}

// ── Per-track achievement countdowns ─────────────────────────────────────────
function nextForTrack(badges: BadgeDefinition[], current: number) {
  const sorted = [...badges].filter(b => b.threshold > 0).sort((a, b) => a.threshold - b.threshold);
  const next = sorted.find(b => current < b.threshold);
  if (!next) return null;
  const prev = sorted[sorted.indexOf(next) - 1]?.threshold ?? 0;
  const remaining = next.threshold - current;
  const pct = Math.min(100, Math.round(((current - prev) / (next.threshold - prev)) * 100));
  return { name: next.name, threshold: next.threshold, remaining, pct, track: next.track as BadgeTrack };
}

const nextBuildingAchievement = computed(() =>
  nextForTrack(BUILDING_BADGES, stats.value.editsAllTime ?? 0)
);
const nextExplorationAchievement = computed(() =>
  nextForTrack(EXPLORATION_BADGES, stats.value.cellsSubmitted ?? 0)
);

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
  const days: Array<{ date: string; label: string; edits: number; completions: number; total: number }> = [];
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
      completions: entry?.cellsCompleted ?? 0,
      total: (entry?.edits ?? 0) + (entry?.cellsCompleted ?? 0),
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
    <div class="nge-profile-shell" :class="{ 'nge-profile-shell--trophy': activeTab === 'trophyCase' }">

      <!-- ── Topbar ─────────────────────────────────────────── -->
      <div class="nge-profile-topbar">
        <span class="nge-profile-topbar-label">◈ RESEARCHER PROFILE</span>
        <button class="nge-profile-exit" @click="handleClose">×</button>
      </div>

      <!-- ── Tab bar ─────────────────────────────────────────── -->
      <div class="nge-profile-tabbar">
        <button
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'overview' }"
          @click="activeTab = 'overview'"
        >Overview</button>
        <button
          class="nge-profile-tab"
          :class="{ 'nge-profile-tab--active': activeTab === 'trophyCase' }"
          @click="activeTab = 'trophyCase'"
        >🏆 Trophy Case</button>
      </div>

      <!-- ── Three-column body (Overview tab) ────────────────── -->
      <div v-if="activeTab === 'overview'" class="nge-profile-body">

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
                  <img v-else :src="pyrIcon" class="nge-flag-img nge-pyr-icon" />
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

              <div class="nge-profile-name">{{ sessions[0].name || sessions[0].email?.split('@')[0] || 'Explorer' }}</div>

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
              <div class="nge-profile-stat-col" v-if="playerAssists > 0">
                <div class="nge-profile-stat-label">Assists</div>
                <div class="nge-profile-stat-val" style="color: #7f8;">{{ playerAssists }}</div>
                <div class="nge-profile-stat-sub">helped</div>
              </div>
            </div>

            <!-- Cell history list -->
            <div class="nge-cell-list" v-if="filteredCellHistory.length > 0">
              <div class="nge-cell-list-header">
                <span class="nge-cell-list-title">Recent Cells</span>
                <span v-if="currentDataset" class="nge-cell-list-dataset" :title="'Filtered to ' + currentDataset">{{ currentDataset }}</span>
              </div>
              <div class="nge-cell-list-columns">
                <span class="nge-cell-col-label nge-cell-col-label--id">Segment</span>
                <span class="nge-cell-col-label nge-cell-col-label--type">Type</span>
                <span class="nge-cell-col-label nge-cell-col-label--time">When</span>
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

          <!-- Proofreading Achievements (building track) -->
          <div class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-section-label" style="color: #ffd08a;">▌ Proofreading Achievements</div>
            <div class="nge-profile-countdown-inline" v-if="nextBuildingAchievement">
              <div class="nge-profile-countdown-row">
                <div class="nge-profile-countdown-remaining">{{ nextBuildingAchievement.remaining.toLocaleString() }} edits to go</div>
              </div>
              <div class="nge-profile-countdown-track">
                <div class="nge-profile-countdown-fill nge-profile-countdown-fill--building" :style="{ width: nextBuildingAchievement.pct + '%' }"></div>
              </div>
            </div>
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in displayedBuildingBadges"
                :key="badge.id"
                class="nge-profile-badge nge-profile-badge--building"
                :class="{
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                  'nge-profile-badge--latest': latestEarnedBadge?.id === badge.id,
                }"
                :title="badge.name + ' — click to see detail'"
                @click="onBadgeClick(badge)"
              >
                <div class="nge-profile-badge-img">
                  <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-profile-badge-icon" :class="`nge-badge--${badge.slug}`" />
                </div>
                <div class="nge-profile-badge-name">{{ badge.name }}</div>
              </div>
              <!-- Next locked badge teaser -->
              <div
                v-if="earnedBuildingBadges.next && !showBuildingViewAll"
                class="nge-profile-badge nge-profile-badge--locked"
                :title="'Next: keep editing to unlock!'"
              >
                <div class="nge-profile-badge-img">
                  <div class="nge-profile-badge-mystery">
                    <span class="nge-profile-badge-mystery-q">?</span>
                  </div>
                </div>
              </div>
              <!-- "View All" tile at end of row 2 -->
              <div
                v-if="showBuildingViewAll && !showAllBuilding"
                class="nge-profile-badge nge-profile-badge--viewall"
                title="View all badges in Trophy Case"
                @click="activeTab = 'trophyCase'"
              >
                <div class="nge-profile-badge-img">
                  <div class="nge-profile-badge-viewall-icon">🏆</div>
                </div>
                <div class="nge-profile-badge-name">View all</div>
              </div>
            </div>
            <div v-if="earnedBuildingBadges.earned.length === 0" class="nge-profile-badges-empty">
              Make your first edit to earn a badge!
            </div>
          </div>

          <!-- Divider between achievement tracks -->
          <div class="nge-profile-badges-divider"></div>

          <!-- Cell Achievements (exploration track) -->
          <div class="nge-profile-section nge-profile-section--badges">
            <div class="nge-profile-section-label" style="color: #90fff2;">▌ Cell Achievements</div>
            <div class="nge-profile-countdown-inline" v-if="nextExplorationAchievement">
              <div class="nge-profile-countdown-row">
                <div class="nge-profile-countdown-remaining">{{ nextExplorationAchievement.remaining.toLocaleString() }} cells to go</div>
              </div>
              <div class="nge-profile-countdown-track">
                <div class="nge-profile-countdown-fill nge-profile-countdown-fill--exploration" :style="{ width: nextExplorationAchievement.pct + '%' }"></div>
              </div>
            </div>
            <div class="nge-profile-badges-grid">
              <div
                v-for="badge in displayedExplorationBadges"
                :key="badge.id"
                class="nge-profile-badge nge-profile-badge--exploration"
                :class="{
                  'nge-profile-badge--selected': selectedBadge?.id === badge.id,
                  'nge-profile-badge--latest': latestEarnedBadge?.id === badge.id,
                }"
                :title="badge.name + ' — click to see detail'"
                @click="onBadgeClick(badge)"
              >
                <div class="nge-profile-badge-img">
                  <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-profile-badge-icon" :class="`nge-badge--${badge.slug}`" />
                </div>
                <div class="nge-profile-badge-name">{{ badge.name }}</div>
              </div>
              <!-- Next locked badge teaser -->
              <div
                v-if="earnedExplorationBadges.next && !showExplorationViewAll"
                class="nge-profile-badge nge-profile-badge--locked"
                :title="'Next: complete more cells to unlock!'"
              >
                <div class="nge-profile-badge-img">
                  <div class="nge-profile-badge-mystery">
                    <span class="nge-profile-badge-mystery-q">?</span>
                  </div>
                </div>
              </div>
              <!-- "View All" tile at end of row 2 -->
              <div
                v-if="showExplorationViewAll && !showAllExploration"
                class="nge-profile-badge nge-profile-badge--viewall"
                title="View all badges in Trophy Case"
                @click="activeTab = 'trophyCase'"
              >
                <div class="nge-profile-badge-img">
                  <div class="nge-profile-badge-viewall-icon">🏆</div>
                </div>
                <div class="nge-profile-badge-name">View all</div>
              </div>
            </div>
            <div v-if="earnedExplorationBadges.earned.length === 0" class="nge-profile-badges-empty">
              Complete your first cell to earn a badge!
            </div>
          </div>

          <!-- Special Awards (admin-awarded badges) -->
          <template v-if="backendStore.mySpecialBadges.length > 0">
            <div class="nge-profile-badges-divider"></div>
            <div class="nge-profile-section nge-profile-section--badges nge-profile-section--special">
              <div class="nge-profile-section-label">★ Special Awards</div>
              <div class="nge-profile-badges-grid">
                <div
                  v-for="award in backendStore.mySpecialBadges"
                  :key="award.id"
                  class="nge-profile-badge"
                  :class="{ 'nge-profile-badge--selected': selectedSpecialBadge?.id === award.id }"
                  :title="(award.badge?.name || '') + (award.badge?.description ? ' — ' + award.badge.description : '')"
                  @click="onSpecialBadgeClick(award)"
                >
                  <div class="nge-profile-badge-img">
                    <img :src="award.badge?.thumbnail_url || award.badge?.image_url" :alt="award.badge?.name" class="nge-profile-badge-icon" />
                  </div>
                  <div class="nge-profile-badge-name">{{ award.badge?.name || 'Award' }}</div>
                </div>
              </div>
            </div>
          </template>

        </div><!-- end center column -->

        <!-- RIGHT: latest badge highlight  <->  badge detail -->
        <div class="nge-profile-col nge-profile-col--right">
          <Transition name="nge-viz-swap" mode="out-in">

            <!-- Special badge detail view -->
            <div v-if="selectedSpecialBadge" key="special" class="nge-profile-viz-panel nge-profile-viz-badge nge-profile-viz-badge--detail">
              <img
                :src="selectedSpecialBadge.badge?.image_url || selectedSpecialBadge.badge?.thumbnail_url"
                :alt="selectedSpecialBadge.badge?.name"
                class="nge-profile-viz-badge-icon nge-profile-viz-badge-icon--large"
              />
              <div class="nge-profile-viz-badge-name">{{ selectedSpecialBadge.badge?.name || 'Award' }}</div>
              <div v-if="selectedSpecialBadge.badge?.description" class="nge-profile-viz-badge-desc">{{ selectedSpecialBadge.badge.description }}</div>
              <div class="nge-profile-viz-badge-threshold">
                Awarded {{ relativeTime(selectedSpecialBadge.awarded_at) }}
              </div>
              <button class="nge-profile-viz-badge-back" @click="selectedSpecialBadge = null">
                ← Back
              </button>
            </div>

            <!-- Default view: favorite badge → favorite special badge → latest earned -->
            <div v-else-if="!selectedBadge" key="latest" class="nge-profile-viz-panel nge-profile-viz-badge">
              <template v-if="favoriteBadge">
                <div class="nge-profile-viz-title">⭐ Favorite Badge</div>
                <img
                  :src="getBadgeUrl(favoriteBadge.imageKey)"
                  :alt="favoriteBadge.name"
                  class="nge-profile-viz-badge-icon"
                  :class="`nge-badge--${favoriteBadge.slug}`"
                />
                <div class="nge-profile-viz-badge-name">{{ favoriteBadge.name }}</div>
                <div class="nge-profile-viz-badge-desc">{{ favoriteBadge.description }}</div>
                <div class="nge-profile-viz-badge-threshold">
                  Unlocked at <strong>{{ favoriteBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(favoriteBadge) }}
                </div>
              </template>
              <template v-else-if="favoriteSpecialBadge">
                <div class="nge-profile-viz-title">⭐ Favorite Badge</div>
                <img
                  :src="favoriteSpecialBadge.badge?.image_url || favoriteSpecialBadge.badge?.thumbnail_url"
                  :alt="favoriteSpecialBadge.badge?.name"
                  class="nge-profile-viz-badge-icon nge-profile-viz-badge-icon--large"
                />
                <div class="nge-profile-viz-badge-name">{{ favoriteSpecialBadge.badge?.name || 'Award' }}</div>
                <div v-if="favoriteSpecialBadge.badge?.description" class="nge-profile-viz-badge-desc">{{ favoriteSpecialBadge.badge.description }}</div>
                <div class="nge-profile-viz-badge-threshold">
                  Won on <strong>{{ formatDate(favoriteSpecialBadge.awarded_at) }}</strong>
                </div>
              </template>
              <template v-else-if="latestEarnedBadge">
                <div class="nge-profile-viz-title">▌ Latest Badge</div>
                <img
                  :src="getBadgeUrl(latestEarnedBadge.imageKey)"
                  :alt="latestEarnedBadge.name"
                  class="nge-profile-viz-badge-icon"
                  :class="`nge-badge--${latestEarnedBadge.slug}`"
                />
                <div class="nge-profile-viz-badge-name">{{ latestEarnedBadge.name }}</div>
                <div class="nge-profile-viz-badge-desc">{{ latestEarnedBadge.description }}</div>
                <div class="nge-profile-viz-badge-threshold">
                  Earned at <strong>{{ latestEarnedBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(latestEarnedBadge) }}
                </div>
              </template>
              <template v-else>
                <div class="nge-profile-viz-title">▌ Badges</div>
                <div class="nge-profile-viz-badge-desc" style="margin-top: 40px;">
                  Make edits and complete cells to earn badges!
                </div>
              </template>
            </div>

            <!-- Badge detail view (when a badge is clicked) -->
            <div v-else key="badge" class="nge-profile-viz-panel nge-profile-viz-badge nge-profile-viz-badge--detail">
              <img
                :src="getBadgeUrl(selectedBadge.imageKey)"
                :alt="selectedBadge.name"
                class="nge-profile-viz-badge-icon nge-profile-viz-badge-icon--large"
                :class="`nge-badge--${selectedBadge.slug}`"
              />
              <div class="nge-profile-viz-badge-name">{{ selectedBadge.name }}</div>
              <div class="nge-profile-viz-badge-desc">{{ selectedBadge.description }}</div>
              <div class="nge-profile-viz-badge-threshold">
                Unlocked at <strong>{{ selectedBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(selectedBadge) }}
              </div>
              <button class="nge-profile-viz-badge-back" @click="selectedBadge = null">
                ← {{ favoriteBadge || favoriteSpecialBadge ? 'Back to favorite' : 'Back' }}
              </button>
            </div>

          </Transition>

          <!-- Divider between badge and streak -->
          <div class="nge-profile-right-divider"></div>

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
                  :title="`${day.date}: ${day.edits} edits, ${day.completions} completions`"
                >
                  <div class="nge-profile-chart-bar-wrap">
                    <div
                      v-if="day.completions > 0"
                      class="nge-profile-chart-bar nge-profile-chart-bar--completion"
                      :style="{ height: Math.max(2, (day.completions / chartMax) * 48) + 'px' }"
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
                  <span class="nge-profile-chart-legend-dot nge-profile-chart-legend-dot--completion"></span> Completions
                </span>
              </div>
            </div>
          </div>

        </div><!-- end right column -->

      </div><!-- end .nge-profile-body (Overview) -->

      <!-- ── Trophy Case tab ─────────────────────────────────── -->
      <div v-else class="nge-profile-body nge-profile-body--trophy">
        <div class="nge-trophy-scroll">

          <!-- ── Featured badge banner ── -->
          <div v-if="selectedSpecialBadge" class="nge-trophy-featured">
            <div class="nge-trophy-featured-effects">
              <div class="nge-trophy-ring nge-trophy-ring--1"></div>
              <div class="nge-trophy-ring nge-trophy-ring--2"></div>
              <div class="nge-trophy-ring nge-trophy-ring--3"></div>
              <div class="nge-trophy-ring nge-trophy-ring--4"></div>
              <div class="nge-trophy-ring nge-trophy-ring--5"></div>
              <span v-for="i in 8" :key="i" class="nge-trophy-orbit-dot" :style="{ '--j': i }"></span>
              <div class="nge-trophy-aura"></div>
            </div>
            <img
              :src="selectedSpecialBadge.badge?.image_url || selectedSpecialBadge.badge?.thumbnail_url"
              :alt="selectedSpecialBadge.badge?.name"
              class="nge-trophy-featured-icon nge-trophy-featured-icon--animated"
            />
            <div class="nge-trophy-featured-info">
              <div class="nge-trophy-featured-name nge-trophy-featured-name--scifi">{{ selectedSpecialBadge.badge?.name || 'Award' }}</div>
              <div v-if="selectedSpecialBadge.badge?.description" class="nge-trophy-featured-desc">{{ selectedSpecialBadge.badge.description }}</div>
              <div class="nge-trophy-featured-threshold">
                Won on <strong>{{ formatDate(selectedSpecialBadge.awarded_at) }}</strong>
              </div>
              <div v-if="favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`)" class="nge-trophy-featured-fav-label">⭐ Your favorite badge</div>
            </div>
            <button
              class="nge-trophy-featured-star"
              :class="{ 'nge-trophy-featured-star--active': favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`) }"
              :title="favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`) ? 'Remove from favorites' : 'Set as favorite badge'"
              @click="toggleFavoriteSpecialBadge(selectedSpecialBadge)"
            >{{ favoriteBadgeSlug === (selectedSpecialBadge.badge?.slug || `special-${selectedSpecialBadge.id}`) ? '★' : '☆' }}</button>
          </div>
          <div v-else-if="favoriteSpecialBadge" class="nge-trophy-featured">
            <div class="nge-trophy-featured-effects">
              <div class="nge-trophy-ring nge-trophy-ring--1"></div>
              <div class="nge-trophy-ring nge-trophy-ring--2"></div>
              <div class="nge-trophy-ring nge-trophy-ring--3"></div>
              <div class="nge-trophy-ring nge-trophy-ring--4"></div>
              <div class="nge-trophy-ring nge-trophy-ring--5"></div>
              <span v-for="i in 8" :key="i" class="nge-trophy-orbit-dot" :style="{ '--j': i }"></span>
              <div class="nge-trophy-aura"></div>
            </div>
            <img
              :src="favoriteSpecialBadge.badge?.image_url || favoriteSpecialBadge.badge?.thumbnail_url"
              :alt="favoriteSpecialBadge.badge?.name"
              class="nge-trophy-featured-icon nge-trophy-featured-icon--animated"
            />
            <div class="nge-trophy-featured-info">
              <div class="nge-trophy-featured-name nge-trophy-featured-name--scifi">{{ favoriteSpecialBadge.badge?.name || 'Award' }}</div>
              <div v-if="favoriteSpecialBadge.badge?.description" class="nge-trophy-featured-desc">{{ favoriteSpecialBadge.badge.description }}</div>
              <div class="nge-trophy-featured-threshold">
                Won on <strong>{{ formatDate(favoriteSpecialBadge.awarded_at) }}</strong>
              </div>
              <div class="nge-trophy-featured-fav-label">⭐ Your favorite badge</div>
            </div>
            <button
              class="nge-trophy-featured-star nge-trophy-featured-star--active"
              title="Remove from favorites"
              @click="toggleFavoriteSpecialBadge(favoriteSpecialBadge)"
            >★</button>
          </div>
          <div v-else-if="featuredBadge" class="nge-trophy-featured">
            <div class="nge-trophy-featured-effects">
              <div class="nge-trophy-ring nge-trophy-ring--1"></div>
              <div class="nge-trophy-ring nge-trophy-ring--2"></div>
              <div class="nge-trophy-ring nge-trophy-ring--3"></div>
              <div class="nge-trophy-ring nge-trophy-ring--4"></div>
              <div class="nge-trophy-ring nge-trophy-ring--5"></div>
              <span v-for="i in 8" :key="i" class="nge-trophy-orbit-dot" :style="{ '--j': i }"></span>
              <div class="nge-trophy-aura"></div>
            </div>
            <img
              :src="getBadgeUrl(featuredBadge.imageKey)"
              :alt="featuredBadge.name"
              class="nge-trophy-featured-icon nge-trophy-featured-icon--animated"
              :class="`nge-badge--${featuredBadge.slug}`"
            />
            <div class="nge-trophy-featured-info">
              <div class="nge-trophy-featured-name nge-trophy-featured-name--scifi">{{ featuredBadge.name }}</div>
              <div class="nge-trophy-featured-desc">{{ featuredBadge.description }}</div>
              <div class="nge-trophy-featured-threshold">
                Unlocked at <strong>{{ featuredBadge.threshold.toLocaleString() }}</strong> {{ thresholdLabel(featuredBadge) }}
              </div>
              <div v-if="favoriteBadgeSlug === featuredBadge.slug" class="nge-trophy-featured-fav-label">⭐ Your favorite badge</div>
            </div>
            <button
              class="nge-trophy-featured-star"
              :class="{ 'nge-trophy-featured-star--active': favoriteBadgeSlug === featuredBadge.slug }"
              :title="favoriteBadgeSlug === featuredBadge.slug ? 'Remove from favorites' : 'Set as favorite badge'"
              @click="toggleFavoriteBadge(featuredBadge)"
            >{{ favoriteBadgeSlug === featuredBadge.slug ? '★' : '☆' }}</button>
          </div>

          <!-- Exploration track (Cell Achievements first) -->
          <div class="nge-trophy-track">
            <div class="nge-trophy-track-label" style="color: #90fff2;">Cell Achievements
              <span class="nge-trophy-track-count">{{ earnedExplorationBadges.earned.length }} earned</span>
            </div>
            <div class="nge-trophy-grid">
              <div
                v-for="badge in earnedExplorationBadges.earned"
                :key="badge.id"
                class="nge-trophy-badge nge-trophy-badge--exploration"
                :class="{
                  'nge-trophy-badge--selected': selectedBadge?.id === badge.id,
                  'nge-trophy-badge--favorited': favoriteBadgeSlug === badge.slug,
                }"
                @click="onBadgeClick(badge)"
              >
                <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-trophy-badge-icon" :class="`nge-badge--${badge.slug}`" />
                <div class="nge-trophy-badge-name">{{ badge.name }}</div>
                <div class="nge-trophy-badge-desc">{{ badge.description }}</div>
                <div class="nge-trophy-badge-threshold">{{ badge.threshold.toLocaleString() }} cells</div>
              </div>
            </div>
          </div>

          <!-- Proofreading track -->
          <div class="nge-trophy-track">
            <div class="nge-trophy-track-label" style="color: #ffd08a;">Proofreading Achievements
              <span class="nge-trophy-track-count">{{ earnedBuildingBadges.earned.length }} earned</span>
            </div>
            <div class="nge-trophy-grid">
              <div
                v-for="badge in earnedBuildingBadges.earned"
                :key="badge.id"
                class="nge-trophy-badge nge-trophy-badge--building"
                :class="{
                  'nge-trophy-badge--selected': selectedBadge?.id === badge.id,
                  'nge-trophy-badge--favorited': favoriteBadgeSlug === badge.slug,
                }"
                @click="onBadgeClick(badge)"
              >
                <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-trophy-badge-icon" :class="`nge-badge--${badge.slug}`" />
                <div class="nge-trophy-badge-name">{{ badge.name }}</div>
                <div class="nge-trophy-badge-desc">{{ badge.description }}</div>
                <div class="nge-trophy-badge-threshold">{{ badge.threshold.toLocaleString() }} edits</div>
              </div>
            </div>
          </div>

          <!-- Special Awards -->
          <div v-if="backendStore.mySpecialBadges.length > 0" class="nge-trophy-track">
            <div class="nge-trophy-track-label">★ Special Awards</div>
            <div class="nge-trophy-grid">
              <div
                v-for="award in backendStore.mySpecialBadges"
                :key="award.id"
                class="nge-trophy-badge"
                :class="{ 'nge-trophy-badge--selected': selectedSpecialBadge?.id === award.id }"
                @click="onSpecialBadgeClick(award)"
              >
                <img :src="award.badge?.thumbnail_url || award.badge?.image_url" :alt="award.badge?.name" class="nge-trophy-badge-icon" />
                <div class="nge-trophy-badge-name">{{ award.badge?.name || 'Award' }}</div>
                <div v-if="award.badge?.description" class="nge-trophy-badge-desc">{{ award.badge.description }}</div>
              </div>
            </div>
          </div>

        </div>
      </div><!-- end Trophy Case -->

    </div>
  </modal-overlay>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap');
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

/* ── Holographic edge glow — subtle orbiting light dots ── */
.nge-profile-modal :deep(.nge-overlay)::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: conic-gradient(
    from var(--nge-holo-angle, 0deg),
    transparent 0%,
    rgba(74, 158, 255, 0.0) 10%,
    rgba(74, 158, 255, 0.35) 14%,
    rgba(0, 210, 255, 0.15) 18%,
    transparent 22%,
    transparent 35%,
    rgba(160, 120, 255, 0.25) 39%,
    rgba(120, 80, 220, 0.1) 43%,
    transparent 47%,
    transparent 60%,
    rgba(0, 255, 200, 0.2) 64%,
    rgba(74, 158, 255, 0.08) 68%,
    transparent 72%,
    transparent 85%,
    rgba(74, 158, 255, 0.15) 89%,
    transparent 93%
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: ngeHoloEdgeSpin 8s linear infinite;
  pointer-events: none;
  z-index: 1;
  opacity: 0.7;
}

@property --nge-holo-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@keyframes ngeHoloEdgeSpin {
  to { --nge-holo-angle: 360deg; }
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
  transition: width 0.25s ease;
}
.nge-profile-shell--trophy {
  width: 85vw;
  max-width: 1200px;
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
  width: 380px;
  flex-shrink: 0;
}

/* Center: badges + streak + countdown */
.nge-profile-col--center {
  width: 380px;
  flex-shrink: 0;
  overflow-x: hidden;
  border-left: 1px solid rgba(74, 158, 255, 0.08);
  border-right: 1px solid rgba(74, 158, 255, 0.08);
  background: rgba(74, 158, 255, 0.01);
}

/* Right: latest badge / badge detail */
.nge-profile-col--right {
  width: 310px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
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
.nge-flag-img.nge-pyr-icon { width: 22px; height: 22px; object-fit: contain; border-radius: 0; }
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
.nge-profile-countdown-name { font-weight: 400; color: rgba(255,255,255,0.5); font-size: 0.82em; font-style: italic; }
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
.nge-profile-countdown-inline { margin-bottom: 10px; }
.nge-profile-countdown-fill--building { background: linear-gradient(90deg, #ffd08a, #f5a623); }
.nge-profile-countdown-fill--exploration { background: linear-gradient(90deg, #90fff2, #4ae5d5); }

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

.nge-profile-chart-bar--completion {
  background: linear-gradient(to top, rgba(255, 180, 50, 0.5), rgba(255, 180, 50, 0.85));
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

.nge-profile-chart-legend-dot--completion {
  background: rgba(255, 180, 50, 0.7);
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
/* Exploration badges: blue highlight (default) */
.nge-profile-badge--selected {
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.3) inset;
}
.nge-profile-badge--selected .nge-profile-badge-img {
  filter: drop-shadow(0 0 6px rgba(100, 180, 255, 0.75));
}
.nge-profile-badge--latest .nge-profile-badge-img {
  filter: drop-shadow(0 0 8px rgba(100, 180, 255, 0.6));
}
.nge-profile-badge--latest .nge-profile-badge-name {
  color: #8ac8ff;
}
/* Building badges: subtle golden highlight */
.nge-profile-badge--building.nge-profile-badge--selected {
  background: rgba(245, 166, 35, 0.06);
  box-shadow: 0 0 0 1px rgba(245, 166, 35, 0.2) inset;
}
.nge-profile-badge--building.nge-profile-badge--selected .nge-profile-badge-img {
  filter: drop-shadow(0 0 3px rgba(255, 200, 80, 0.35));
}
.nge-profile-badge--building.nge-profile-badge--latest .nge-profile-badge-img {
  filter: drop-shadow(0 0 4px rgba(255, 200, 80, 0.3));
}
.nge-profile-badge--building.nge-profile-badge--latest .nge-profile-badge-name {
  color: #ffd08a;
}
/* Twine: rotate 90° to look like an infinity symbol */
.nge-badge--twine { transform: rotate(90deg); }

/* ── "View All" tile in badge grid ── */
.nge-profile-badge--viewall {
  cursor: pointer;
  background: rgba(74, 158, 255, 0.04);
  border: 1px dashed rgba(74, 158, 255, 0.2);
  border-radius: 8px;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.nge-profile-badge--viewall:hover {
  background: rgba(74, 158, 255, 0.1);
  border-color: rgba(74, 158, 255, 0.4);
  transform: scale(1.08);
}
.nge-profile-badge-viewall-icon {
  width: 68px;
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2em;
  opacity: 0.7;
}

.nge-profile-section--special {
  border-top: none;
}

.nge-profile-badges-empty {
  font-size: 0.75em;
  color: #556;
  padding: 8px 0;
  font-style: italic;
}

.nge-profile-badges-toggle {
  background: none;
  border: 1px solid rgba(245, 166, 35, 0.25);
  color: rgba(255, 208, 138, 0.6);
  font-size: 0.72em;
  padding: 4px 12px;
  border-radius: 12px;
  cursor: pointer;
  margin-top: 6px;
  transition: color 0.15s, border-color 0.15s;
}
.nge-profile-badges-toggle:hover {
  color: rgba(255, 208, 138, 0.9);
  border-color: rgba(245, 166, 35, 0.45);
}

.nge-profile-right-divider {
  height: 1px;
  margin: 18px 20px;
  background: linear-gradient(90deg, transparent 0%, rgba(74, 158, 255, 0.15) 30%, rgba(74, 158, 255, 0.15) 70%, transparent 100%);
}

.nge-profile-badge-img {
  display: flex; align-items: center; justify-content: center;
  width: 68px; height: 68px;
  transition: filter 0.15s;
}

.nge-profile-badge-icon { width: 62px; height: 62px; object-fit: contain; }

.nge-profile-badge-mystery {
  width: 50px; height: 50px;
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

/* Badge detail in viz column */
.nge-profile-viz-badge { justify-content: flex-start; text-align: center; gap: 12px; padding-top: 16px; }

.nge-profile-viz-badge-icon { width: 220px; height: 220px; object-fit: contain; filter: drop-shadow(0 0 20px rgba(74,158,255,0.4)); }
.nge-profile-viz-badge-icon--large { width: 240px; height: 240px; }

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

.nge-cell-list-title {
  font-size: 0.82em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(74, 158, 255, 0.65);
  font-style: normal;
}

.nge-cell-list-columns {
  display: flex;
  align-items: center;
  padding: 0 2px 4px 42px; /* align with cell rows (past fav + pip) */
  border-bottom: 1px solid rgba(74, 158, 255, 0.08);
  margin-bottom: 2px;
}
.nge-cell-col-label {
  font-size: 0.58em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.25);
}
.nge-cell-col-label--id { flex: 1; }
.nge-cell-col-label--type { width: 90px; text-align: left; }
.nge-cell-col-label--time { width: 52px; text-align: right; padding-right: 18px; }

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

/* ─────────────────────────────────────────────────────────────────────────────
   TAB BAR
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-tabbar {
  display: flex;
  gap: 2px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(74, 158, 255, 0.1);
  flex-shrink: 0;
}

.nge-profile-tab {
  background: none;
  border: none;
  color: rgba(160, 175, 200, 0.6);
  font-size: 0.82em;
  font-weight: 600;
  padding: 8px 16px 7px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  letter-spacing: 0.02em;
}
.nge-profile-tab:hover {
  color: rgba(200, 220, 255, 0.8);
}
.nge-profile-tab--active {
  color: rgba(200, 220, 255, 0.95);
  border-bottom-color: #4a9eff;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TROPHY CASE TAB
───────────────────────────────────────────────────────────────────────────── */
.nge-profile-body--trophy {
  display: block;
  padding: 0;
}

.nge-trophy-scroll {
  overflow-y: auto;
  padding: 16px 24px 24px;
  max-height: calc(90vh - 100px);
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}
.nge-trophy-scroll::-webkit-scrollbar        { width: 4px; }
.nge-trophy-scroll::-webkit-scrollbar-track  { background: rgba(255, 255, 255, 0.02); }
.nge-trophy-scroll::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }
.nge-trophy-scroll::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.4); }

.nge-trophy-track {
  margin-bottom: 24px;
}

.nge-trophy-track-label {
  font-size: 0.88em;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.nge-trophy-track-count {
  font-size: 0.82em;
  font-weight: 500;
  color: #667;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 2px 8px;
}

.nge-trophy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 10px;
}

.nge-trophy-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 10px 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: transform 0.15s, background 0.15s, border-color 0.15s;
}
.nge-trophy-badge:hover {
  transform: scale(1.05);
  background: rgba(74, 158, 255, 0.06);
  border-color: rgba(74, 158, 255, 0.15);
}
.nge-trophy-badge--selected {
  background: rgba(74, 158, 255, 0.1) !important;
  border-color: rgba(74, 158, 255, 0.3) !important;
  box-shadow: 0 0 12px rgba(74, 158, 255, 0.15);
}
.nge-trophy-badge--building.nge-trophy-badge--selected {
  background: rgba(245, 166, 35, 0.08) !important;
  border-color: rgba(245, 166, 35, 0.25) !important;
  box-shadow: 0 0 12px rgba(245, 166, 35, 0.1);
}

.nge-trophy-badge--locked {
  opacity: 0.35;
  cursor: default;
}
.nge-trophy-badge--locked:hover {
  transform: none;
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.04);
}

.nge-trophy-badge-icon {
  width: 56px;
  height: 56px;
  object-fit: contain;
  margin-bottom: 6px;
  filter: drop-shadow(0 0 4px rgba(100, 180, 255, 0.2));
}

.nge-trophy-badge-mystery {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.8em;
  color: #445;
  border: 2px dashed rgba(100, 120, 160, 0.2);
  border-radius: 50%;
  margin-bottom: 6px;
}

.nge-trophy-badge-name {
  font-size: 0.72em;
  font-weight: 600;
  color: rgba(200, 215, 240, 0.85);
  line-height: 1.2;
  margin-bottom: 2px;
}
.nge-trophy-badge-name--locked {
  color: #445;
}

.nge-trophy-badge-desc {
  font-size: 0.62em;
  color: #667;
  line-height: 1.3;
  max-height: 2.6em;
  overflow: hidden;
}

.nge-trophy-badge-threshold {
  font-size: 0.6em;
  color: #556;
  margin-top: 3px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}

/* ── Featured badge banner (top of Trophy Case) ── */
.nge-trophy-featured {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px 28px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, rgba(8, 14, 28, 0.95), rgba(12, 22, 48, 0.9));
  border: 1px solid rgba(74, 158, 255, 0.15);
  border-radius: 14px;
  position: relative;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), inset 0 0 40px rgba(74, 158, 255, 0.02);
}
.nge-trophy-featured-icon {
  width: 350px;
  height: 350px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 0 20px rgba(100, 180, 255, 0.4));
}
.nge-trophy-featured-info {
  flex: 1;
  min-width: 0;
}
.nge-trophy-featured-name {
  font-size: 1.6em;
  font-weight: 700;
  color: #e0ecff;
  margin-bottom: 6px;
}
.nge-trophy-featured-desc {
  font-size: 1em;
  color: #99aabb;
  line-height: 1.5;
  margin-bottom: 8px;
}
.nge-trophy-featured-threshold {
  font-size: 0.88em;
  color: #667;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}
.nge-trophy-featured-fav-label {
  font-size: 0.78em;
  color: #ffd700;
  margin-top: 8px;
  letter-spacing: 0.03em;
}
.nge-trophy-featured-star {
  position: absolute;
  top: 16px;
  right: 18px;
  background: none;
  border: none;
  font-size: 2em;
  color: #556;
  cursor: pointer;
  padding: 4px 8px;
  transition: color 0.2s, transform 0.2s;
  line-height: 1;
}
.nge-trophy-featured-star:hover {
  color: #ffd700;
  transform: scale(1.15);
}
.nge-trophy-featured-star--active {
  color: #ffd700;
  text-shadow: 0 0 12px rgba(255, 215, 0, 0.5);
}

/* Favorited badge gets subtle gold outline in grid */
.nge-trophy-badge--favorited {
  box-shadow: 0 0 0 1.5px rgba(255, 215, 0, 0.35) inset;
}
.nge-trophy-detail-close:hover { color: #f66; }

/* ── Hero-style effects around featured badge ── */
.nge-trophy-featured {
  overflow: visible;          /* let rings extend beyond banner */
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  gap: 72px;                  /* more space between icon and text */
}
.nge-trophy-featured-effects {
  position: absolute;
  top: 50%;
  left: 200px;               /* center on the 350px icon area + padding */
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 0;
}
.nge-trophy-featured-icon {
  z-index: 1;
  position: relative;
}
.nge-trophy-featured-icon--animated {
  animation: nge-trophy-float 5s ease-in-out infinite alternate;
}
.nge-trophy-featured-name--scifi {
  font-family: 'Orbitron', 'Rajdhani', 'Audiowide', 'Share Tech Mono', ui-monospace, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 1.8em;
  background: linear-gradient(135deg, #e0ecff 0%, #58a6ff 50%, #a0d0ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
@keyframes nge-trophy-float {
  from { transform: translateY(0); }
  to   { transform: translateY(-8px); }
}

/* Rotating rings */
.nge-trophy-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid transparent;
  will-change: transform;
  transform: translateZ(0);
  top: 50%;
  left: 50%;
}
.nge-trophy-ring--1 {
  width: 380px; height: 380px;
  margin: -190px 0 0 -190px;
  border-color: rgba(0, 200, 255, 0.12);
  animation: nge-trophy-ring-spin 50s linear infinite;
  box-shadow: 0 0 12px rgba(0, 200, 255, 0.06);
}
.nge-trophy-ring--2 {
  width: 340px; height: 340px;
  margin: -170px 0 0 -170px;
  border-color: rgba(206, 147, 216, 0.08);
  border-style: dashed;
  animation: nge-trophy-ring-spin 70s linear infinite reverse;
  box-shadow: 0 0 12px rgba(206, 147, 216, 0.04);
}
.nge-trophy-ring--3 {
  width: 410px; height: 410px;
  margin: -205px 0 0 -205px;
  border-color: rgba(0, 255, 180, 0.05);
  border-width: 0.5px;
  animation: nge-trophy-ring-spin 90s linear infinite;
}
/* Trim-path style rings: dashed with animated dash offset */
.nge-trophy-ring--4 {
  width: 440px; height: 440px;
  margin: -220px 0 0 -220px;
  border: none;
  background: transparent;
  border-radius: 50%;
  /* SVG-like trim path via background gradient on a ring */
  box-shadow: none;
  outline: 1.5px dashed rgba(0, 200, 255, 0.07);
  outline-offset: -1px;
  animation: nge-trophy-ring-spin 120s linear infinite;
}
.nge-trophy-ring--5 {
  width: 360px; height: 360px;
  margin: -180px 0 0 -180px;
  border: 1.5px solid transparent;
  border-top-color: rgba(0, 200, 255, 0.1);
  border-right-color: rgba(206, 147, 216, 0.06);
  animation: nge-trophy-ring-spin 40s linear infinite reverse;
}
@keyframes nge-trophy-ring-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Orbital dots */
.nge-trophy-orbit-dot {
  position: absolute;
  width: 4px; height: 4px;
  border-radius: 50%;
  background: rgba(0, 220, 255, 0.7);
  box-shadow: 0 0 6px rgba(0, 220, 255, 0.4), 0 0 14px rgba(0, 220, 255, 0.2);
  top: 50%; left: 50%;
  will-change: transform;
  animation: nge-trophy-orbit 40s linear infinite;
  animation-delay: calc(var(--j) * -12s);
}
.nge-trophy-orbit-dot:nth-child(odd) {
  width: 3px; height: 3px;
  background: rgba(206, 180, 255, 0.6);
  box-shadow: 0 0 5px rgba(206, 180, 255, 0.3);
  animation-duration: 55s;
  animation-direction: reverse;
}
.nge-trophy-orbit-dot:nth-child(3n) {
  width: 3px; height: 3px;
  background: rgba(0, 255, 180, 0.5);
  box-shadow: 0 0 5px rgba(0, 255, 180, 0.3);
  animation-duration: 48s;
}
/* Outer orbit particles */
.nge-trophy-orbit-dot:nth-child(n+6) {
  animation-name: nge-trophy-orbit-outer;
  animation-duration: 65s;
  width: 2px; height: 2px;
  opacity: 0.6;
}
.nge-trophy-orbit-dot:nth-child(7) {
  background: rgba(255, 200, 100, 0.5);
  box-shadow: 0 0 4px rgba(255, 200, 100, 0.3);
  animation-duration: 58s;
  animation-direction: reverse;
}
.nge-trophy-orbit-dot:nth-child(8) {
  width: 2.5px; height: 2.5px;
  background: rgba(100, 180, 255, 0.6);
  box-shadow: 0 0 5px rgba(100, 180, 255, 0.3);
  animation-duration: 72s;
}
@keyframes nge-trophy-orbit {
  from { transform: rotate(calc(var(--j) * 45deg))       translateX(175px) rotate(calc(var(--j) * -45deg)); }
  to   { transform: rotate(calc(var(--j) * 45deg + 360deg)) translateX(175px) rotate(calc(var(--j) * -45deg - 360deg)); }
}
@keyframes nge-trophy-orbit-outer {
  from { transform: rotate(calc(var(--j) * 45deg))       translateX(210px) rotate(calc(var(--j) * -45deg)); }
  to   { transform: rotate(calc(var(--j) * 45deg + 360deg)) translateX(210px) rotate(calc(var(--j) * -45deg - 360deg)); }
}

/* Pulsing aura */
.nge-trophy-aura {
  position: absolute;
  width: 340px; height: 340px;
  top: 50%; left: 50%;
  margin: -170px 0 0 -170px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 180, 255, 0.05) 0%, rgba(206, 147, 216, 0.025) 40%, transparent 70%);
  animation: nge-trophy-aura-pulse 10s ease-in-out infinite;
  pointer-events: none;
}
@keyframes nge-trophy-aura-pulse {
  0%, 100% { transform: scale(1);    opacity: 0.5; }
  50%      { transform: scale(1.12); opacity: 0.85; }
}
</style>
