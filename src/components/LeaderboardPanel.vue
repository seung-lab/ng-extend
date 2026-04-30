<script setup lang="ts">
import {ref, computed, onMounted, type Ref} from 'vue';
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';
import {DEMO_USERS, DemoUser} from '../data/demo-users';
import {BADGE_DEFINITIONS, BUILDING_BADGES, EXPLORATION_BADGES, BadgeDefinition} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {useUserPreferencesStore, useProofreadingBackendStore} from '../store';
import {EYEWIRE_FLAG} from '../data/countries';
import nurroTrophy from '../../static/badges/pyr/nurro-trophy.png';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

const {prefs} = storeToRefs(useUserPreferencesStore());
const backendStore = useProofreadingBackendStore();

type Tab = 'week' | 'month' | 'alltime';
const activeTab    = ref<Tab>('alltime');
const selectedUser = ref<DemoUser | null>(null);
const selectedBadgeId = ref<number | null>(null);

// Load real leaderboard from Supabase on mount
onMounted(() => { backendStore.loadLeaderboard(); });

// Convert Supabase user rows to DemoUser shape for display
const supabaseUsers = computed<DemoUser[]>(() => {
  return backendStore.leaderboard.map((u: any) => ({
    id: u.id,
    name: u.display_name || 'Anonymous',
    flag: u.flag || '',
    bio: '',
    stats: {
      editsAllTime: u.total_edits || 0,
      mergesAllTime: u.total_merges || 0,
      splitsAllTime: u.total_splits || 0,
      editsThisWeek: u.total_edits || 0,
      mergesThisWeek: u.total_merges || 0,
      splitsThisWeek: u.total_splits || 0,
      editsThisMonth: u.total_edits || 0,
      mergesThisMonth: u.total_merges || 0,
      splitsThisMonth: u.total_splits || 0,
      cellsSubmitted: u.cells_completed || 0,
      currentStreak: u.current_streak || 0,
      longestStreak: u.longest_streak || 0,
    },
  }));
});

// Use Supabase users if available, otherwise fall back to demo data
const userSource = computed(() => supabaseUsers.value.length > 0 ? supabaseUsers.value : DEMO_USERS);

// Sort users by the active tab's edit metric
const rankedUsers = computed(() => {
  const key = activeTab.value === 'week'  ? 'editsThisWeek'
            : activeTab.value === 'month' ? 'editsThisMonth'
                                          : 'editsAllTime';
  return [...userSource.value].sort((a, b) => b.stats[key] - a.stats[key]);
});

function editCountForTab(user: DemoUser): number {
  if (activeTab.value === 'week')  return user.stats.editsThisWeek;
  if (activeTab.value === 'month') return user.stats.editsThisMonth;
  return user.stats.editsAllTime;
}

// Badges helpers
function isBadgeEarnedByUser(badge: BadgeDefinition, user: DemoUser): boolean {
  if (badge.threshold === 0) return false;
  const stat = badge.track === 'building' ? user.stats.editsAllTime : user.stats.cellsSubmitted;
  return stat >= badge.threshold;
}

// Legacy compat wrapper
function isBadgeEarned(editThreshold: number, editsAllTime: number): boolean {
  if (editThreshold === 0) return false;
  return editsAllTime >= editThreshold;
}

function getBadgeUrl(imageKey: string): string {
  return BADGE_IMAGE_MAP[imageKey] ?? '';
}

// Top earned badge for the leaderboard row (highest threshold from either track)
function topBadge(user: DemoUser) {
  return BADGE_DEFINITIONS
    .filter(b => b.threshold > 0 && isBadgeEarnedByUser(b, user))
    .sort((a, b) => b.threshold - a.threshold)[0] ?? null;
}

// Earned badges for the selected user (only earned, most recent first)
const earnedBuildingForUser = computed(() => {
  if (!selectedUser.value) return [];
  return BUILDING_BADGES.filter(b => isBadgeEarnedByUser(b, selectedUser.value!)).reverse();
});
const earnedExplorationForUser = computed(() => {
  if (!selectedUser.value) return [];
  return EXPLORATION_BADGES.filter(b => isBadgeEarnedByUser(b, selectedUser.value!)).reverse();
});

function selectUser(user: DemoUser) {
  selectedUser.value = user;
  selectedBadgeId.value = null;
}

function onDetailBadgeClick(badgeId: number) {
  selectedBadgeId.value = selectedBadgeId.value === badgeId ? null : badgeId;
}

function selectedBadgeDef() {
  if (!selectedBadgeId.value) return null;
  return BADGE_DEFINITIONS.find(b => b.id === selectedBadgeId.value) ?? null;
}

function openFullProfile(userId: string) {
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { userId } }));
  emit('hide');
}

const RANK_MEDAL: Record<number, string> = {1: '🥇', 2: '🥈', 3: '🥉'};

/** Convert flag emoji to a CDN image URL (cross-platform, Windows compat). */
function flagImgUrl(emoji: string): string {
  if (!emoji || emoji === EYEWIRE_FLAG) return '';
  const pts = [...emoji];
  if (pts.length < 2) return '';
  const code = pts.slice(0, 2).map(c => String.fromCharCode((c.codePointAt(0)! - 0x1F1E6) + 97)).join('');
  if (!code || code.length !== 2) return '';
  return `https://flagcdn.com/w40/${code}.png`;
}

function isEyewireFlag(flag: string): boolean {
  return flag === EYEWIRE_FLAG;
}

/** The flag value to display for a leaderboard user (logged-in user uses live prefs). */
function userFlag(user: DemoUser): string {
  return (user.id === 'amy' || user.id === backendStore.userId) ? (prefs.value.flag || user.flag) : user.flag;
}

const emit = defineEmits({hide: null});
</script>

<template>
  <modal-overlay id="nge-lb-modal" class="nge-lb-modal" @hide="emit('hide')">
    <div class="nge-lb-shell">

      <!-- ── LIST VIEW ─────────────────────────────────── -->
      <template v-if="!selectedUser">

        <div class="nge-lb-topbar">
          <button class="nge-lb-exit nge-lb-exit--abs" @click="emit('hide')">×</button>
        </div>

        <div class="nge-lb-hero">
          <div class="nge-lb-hero-grid"></div>
          <div class="nge-lb-hero-scanline"></div>
          <div class="nge-lb-hero-img-wrap">
            <img :src="nurroTrophy" alt="Nurro Trophy" class="nge-lb-hero-img" />
            <div class="nge-lb-hero-shadow"></div>
          </div>
          <div class="nge-lb-title-block">
            <div class="nge-lb-title-rule"></div>
            <h2 class="nge-lb-title-treat">
              <span class="nge-lb-title-bracket">▮</span>
              <span class="nge-lb-title-text">LEADERBOARD</span>
              <span class="nge-lb-title-bracket">▮</span>
            </h2>
            <div class="nge-lb-title-sub">RANKED&nbsp;//&nbsp;TOP&nbsp;CONTRIBUTORS</div>
            <div class="nge-lb-title-rule"></div>
          </div>
        </div>

        <div class="nge-lb-tabs">
          <button class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'alltime' }"
                  @click="activeTab = 'alltime'">All Time</button>
          <button class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'month' }"
                  @click="activeTab = 'month'">Month</button>
          <button class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'week' }"
                  @click="activeTab = 'week'">Week</button>
        </div>

        <div class="nge-lb-content">
          <table class="nge-lb-table">
            <thead>
              <tr>
                <th class="nge-lb-th nge-lb-th--rank">#</th>
                <th class="nge-lb-th">Name</th>
                <th class="nge-lb-th nge-lb-th--num">Edits</th>
                <th class="nge-lb-th nge-lb-th--badge">★</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(user, idx) in rankedUsers"
                :key="user.id"
                class="nge-lb-row"
                :class="{ 'nge-lb-row--you': user.id === 'amy' || user.id === backendStore.userId }"
                @click="selectUser(user)"
              >
                <td class="nge-lb-td nge-lb-td--rank">
                  <span v-if="RANK_MEDAL[idx + 1]">{{ RANK_MEDAL[idx + 1] }}</span>
                  <span v-else class="nge-lb-rank-num">{{ idx + 1 }}</span>
                </td>
                <td class="nge-lb-td">
                  <!-- Use live prefs flag for the logged-in user's row -->
                  <img v-if="isEyewireFlag(userFlag(user))"
                       class="nge-lb-flag-img nge-lb-flag-img--logo"
                       :src="pyrIcon" />
                  <img v-else-if="flagImgUrl(userFlag(user))"
                       class="nge-lb-flag-img"
                       :src="flagImgUrl(userFlag(user))" />
                  <span v-else class="nge-lb-flag-fallback">🌐</span>
                  <span class="nge-lb-name nge-lb-name--clickable" @click.stop="openFullProfile(user.id)" title="View profile">{{ user.name }}</span>
                  <span v-if="user.id === 'amy' || user.id === backendStore.userId" class="nge-lb-you-tag">you</span>
                  <span v-if="user.stats.currentStreak > 0" class="nge-lb-streak"
                        :title="`${user.stats.currentStreak}-day streak`">
                    🔥{{ user.stats.currentStreak }}
                  </span>
                </td>
                <td class="nge-lb-td nge-lb-td--num">
                  {{ editCountForTab(user).toLocaleString() }}
                </td>
                <td class="nge-lb-td nge-lb-td--badge">
                  <img
                    v-if="topBadge(user)"
                    :src="getBadgeUrl(topBadge(user)?.imageKey ?? '')"
                    :alt="topBadge(user)?.name ?? ''"
                    :title="topBadge(user)?.name ?? ''"
                    class="nge-lb-badge-img"
                  />
                  <span v-else class="nge-lb-badge-none">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ── DETAIL VIEW ────────────────────────────────── -->
      <template v-else>

        <div class="nge-lb-topbar">
          <button class="nge-lb-back" @click="selectedUser = null">← Back</button>
          <button class="nge-lb-exit" @click="emit('hide')">×</button>
        </div>

        <div class="nge-lb-content nge-lb-detail">

          <div class="nge-lb-detail-header">
            <div class="nge-lb-detail-name-row">
              <img v-if="isEyewireFlag(selectedUser.flag)" class="nge-lb-flag-img nge-lb-flag-img--detail nge-lb-flag-img--logo" :src="pyrIcon" />
              <img v-else-if="flagImgUrl(selectedUser.flag)" class="nge-lb-flag-img nge-lb-flag-img--detail" :src="flagImgUrl(selectedUser.flag)" />
              <span v-else class="nge-lb-flag-fallback nge-lb-flag-fallback--detail">🌐</span>
              <div class="nge-lb-detail-name">{{ selectedUser.name }}</div>
            </div>
            <div class="nge-lb-detail-bio" v-if="selectedUser.bio">{{ selectedUser.bio }}</div>
            <button class="nge-lb-view-profile" @click="openFullProfile(selectedUser.id)">View Full Profile →</button>
          </div>

          <!-- Stats grid (2-column) -->
          <div class="nge-lb-detail-grid">
            <div class="nge-lb-detail-stat">
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.editsAllTime.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">All-Time Edits</div>
            </div>
            <div class="nge-lb-detail-stat">
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.cellsSubmitted.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">Cells</div>
            </div>
            <div class="nge-lb-detail-stat">
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.mergesAllTime.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">Merges</div>
            </div>
            <div class="nge-lb-detail-stat">
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.splitsAllTime.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">Splits</div>
            </div>
            <div class="nge-lb-detail-stat">
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.editsThisWeek.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">This Week</div>
            </div>
            <div class="nge-lb-detail-stat">
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.editsThisMonth.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">This Month</div>
            </div>
          </div>

          <!-- Streak -->
          <div class="nge-lb-detail-streak"
               v-if="selectedUser.stats.currentStreak > 0 || selectedUser.stats.longestStreak > 0">
            <span class="nge-lb-detail-streak-flame">🔥</span>
            <span class="nge-lb-detail-streak-count">{{ selectedUser.stats.currentStreak }}</span>
            <span class="nge-lb-detail-streak-unit">day{{ selectedUser.stats.currentStreak === 1 ? '' : 's' }} current</span>
            <span class="nge-lb-detail-streak-sep" v-if="selectedUser.stats.longestStreak > 0"> · </span>
            <span class="nge-lb-detail-streak-best" v-if="selectedUser.stats.longestStreak > 0">
              Best: {{ selectedUser.stats.longestStreak }}d
            </span>
          </div>

          <!-- Edit Achievements -->
          <div class="nge-lb-detail-badges-label" style="color: #ffd08a;">Edit Achievements</div>
          <div v-if="earnedBuildingForUser.length > 0" class="nge-lb-detail-badges-grid">
            <div
              v-for="badge in earnedBuildingForUser"
              :key="badge.id"
              class="nge-lb-detail-badge"
              :class="{ 'nge-lb-detail-badge--selected': selectedBadgeId === badge.id }"
              :title="badge.name + ' — click for details'"
              @click="onDetailBadgeClick(badge.id)"
            >
              <div class="nge-lb-detail-badge-img">
                <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-lb-detail-badge-icon" />
              </div>
              <div class="nge-lb-detail-badge-name">{{ badge.name }}</div>
            </div>
          </div>
          <div v-else class="nge-lb-detail-no-badges">No edit badges earned yet</div>

          <!-- Cell Achievements -->
          <div class="nge-lb-detail-badges-label" style="color: #90fff2;">Cell Achievements</div>
          <div v-if="earnedExplorationForUser.length > 0" class="nge-lb-detail-badges-grid">
            <div
              v-for="badge in earnedExplorationForUser"
              :key="badge.id"
              class="nge-lb-detail-badge"
              :class="{ 'nge-lb-detail-badge--selected': selectedBadgeId === badge.id }"
              :title="badge.name + ' — click for details'"
              @click="onDetailBadgeClick(badge.id)"
            >
              <div class="nge-lb-detail-badge-img">
                <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-lb-detail-badge-icon" />
              </div>
              <div class="nge-lb-detail-badge-name">{{ badge.name }}</div>
            </div>
          </div>
          <div v-else class="nge-lb-detail-no-badges">No cell badges earned yet</div>

          <!-- Badge detail card -->
          <Transition name="lb-badge-detail">
            <div v-if="selectedBadgeDef()" class="nge-lb-detail-badge-card">
              <img
                :src="getBadgeUrl(selectedBadgeDef()?.imageKey ?? '')"
                :alt="selectedBadgeDef()?.name ?? ''"
                class="nge-lb-detail-badge-card-icon"
              />
              <div class="nge-lb-detail-badge-card-body">
                <div class="nge-lb-detail-badge-card-name">{{ selectedBadgeDef()?.name }}</div>
                <div class="nge-lb-detail-badge-card-desc">{{ selectedBadgeDef()?.description }}</div>
                <div class="nge-lb-detail-badge-card-thresh">
                  Unlocked at {{ selectedBadgeDef()?.threshold.toLocaleString() }} {{ selectedBadgeDef()?.track === 'building' ? 'edits' : 'cells completed' }}
                </div>
              </div>
              <button class="nge-lb-detail-badge-card-close" @click.stop="selectedBadgeId = null">×</button>
            </div>
          </Transition>

        </div>
      </template>

    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-lb-modal {
  font-size: 0.9em;
}

/* ── Sidebar override ──────────────────────────────────────────────────────
   Neuroglancer's .overlay-content has position:absolute; top:50%; left:50%;
   transform:translate(-50%,-50%). We override those with !important to pin
   the panel to the right edge of the screen as a full-height sidebar.       */
.nge-lb-modal :deep(.nge-overlay) {
  right:  0    !important;
  top:    0    !important;
  left:   auto !important;
  bottom: 0    !important;
  transform: none !important;
  width: 360px;
  overflow: hidden;
  border-left: 1px solid rgba(74, 158, 255, 0.14);
  animation: ngeLbSlideIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Scanline removed — holographic border glow handled by ModalOverlay */

/* Slide in from the right — no centering transform needed for sidebar */
@keyframes ngeLbSlideIn {
  0% {
    opacity: 0;
    transform: translateX(40px);
    filter: blur(8px) brightness(2);
    box-shadow: -8px 0 60px rgba(0, 180, 255, 0.4);
  }
  35% {
    opacity: 1;
    filter: blur(0.5px) brightness(1.15);
  }
  100% {
    opacity: 1;
    transform: translateX(0);
    filter: blur(0) brightness(1);
    box-shadow: -4px 0 30px rgba(0, 150, 255, 0.06);
  }
}

/* (scanline keyframe removed — using ModalOverlay holographic effects) */

/* ── Shell — fills the full sidebar height ── */
.nge-lb-shell {
  display: flex;
  flex-direction: column;
  width: 360px;
  height: 100%;
}

/* ── Top bar (hero now owns the title) ── */
.nge-lb-topbar {
  position: relative;
  height: 0;
  flex-shrink: 0;
}
.nge-lb-exit--abs {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 5;
}

/* ── Hero (sci-fi treatment) ────────────────────────────────────── */
.nge-lb-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 16px 18px;
  overflow: hidden;
  border-bottom: 1px solid rgba(120, 180, 255, 0.12);
  background:
    radial-gradient(ellipse 70% 60% at 50% 30%, rgba(80, 150, 255, 0.10) 0%, rgba(80, 150, 255, 0) 60%),
    linear-gradient(180deg, rgba(10, 16, 32, 0.6) 0%, rgba(8, 12, 24, 0.0) 100%);
}

/* Faint blueprint grid behind the hero */
.nge-lb-hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, rgba(120, 180, 255, 0.06) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(120, 180, 255, 0.06) 1px, transparent 1px);
  background-size: 24px 24px;
  mask-image: radial-gradient(ellipse 80% 75% at 50% 45%, black 30%, transparent 90%);
  -webkit-mask-image: radial-gradient(ellipse 80% 75% at 50% 45%, black 30%, transparent 90%);
  pointer-events: none;
}

/* Slow scanline drift */
.nge-lb-hero-scanline {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 3px,
      rgba(120, 180, 255, 0.018) 3px,
      rgba(120, 180, 255, 0.018) 4px
    );
  pointer-events: none;
  animation: nge-lb-scanline-drift 9s linear infinite;
}
@keyframes nge-lb-scanline-drift {
  0%   { transform: translateY(0); }
  100% { transform: translateY(8px); }
}

/* Hero image — bigger, hovering with ground glow + gentle bob */
.nge-lb-hero-img-wrap {
  position: relative;
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}
.nge-lb-hero-img {
  width: 200px;
  height: 200px;
  object-fit: contain;
  filter:
    drop-shadow(0 0 14px rgba(120, 180, 255, 0.45))
    drop-shadow(0 12px 22px rgba(80, 140, 255, 0.28));
  animation:
    nge-lb-hero-float 5.5s ease-in-out infinite,
    nge-lb-hero-glow 3.6s ease-in-out infinite;
  position: relative;
  z-index: 2;
}
.nge-lb-hero-shadow {
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 130px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(120, 180, 255, 0.45) 0%, rgba(120, 180, 255, 0) 70%);
  filter: blur(3px);
  animation: nge-lb-hero-shadow-breathe 5.5s ease-in-out infinite;
  z-index: 1;
}
@keyframes nge-lb-hero-float {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50%      { transform: translateY(-8px) rotate(1deg); }
}
@keyframes nge-lb-hero-glow {
  0%, 100% {
    filter:
      drop-shadow(0 0 14px rgba(120, 180, 255, 0.45))
      drop-shadow(0 12px 22px rgba(80, 140, 255, 0.28));
  }
  50% {
    filter:
      drop-shadow(0 0 22px rgba(150, 200, 255, 0.65))
      drop-shadow(0 14px 28px rgba(80, 140, 255, 0.42));
  }
}
@keyframes nge-lb-hero-shadow-breathe {
  0%, 100% { transform: translateX(-50%) scale(1);   opacity: 0.85; }
  50%      { transform: translateX(-50%) scale(0.7); opacity: 0.45; }
}

/* Title treatment — Orbitron, wide tracking, gradient + glow */
.nge-lb-title-block {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  z-index: 2;
}
.nge-lb-title-rule {
  width: 220px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(120, 180, 255, 0.5) 50%,
    transparent 100%
  );
}
.nge-lb-title-treat {
  margin: 4px 0 2px;
  display: flex;
  align-items: center;
  gap: 14px;
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 1.5em;
  font-weight: 700;
  letter-spacing: 0.32em;
  background: linear-gradient(
    180deg,
    #e8f3ff 0%,
    #9bc8ff 55%,
    #5b9eff 100%
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow:
    0 0 12px rgba(120, 180, 255, 0.5),
    0 0 24px rgba(120, 180, 255, 0.25);
  animation: nge-lb-title-pulse 4s ease-in-out infinite;
}
@keyframes nge-lb-title-pulse {
  0%, 100% { filter: brightness(1)    drop-shadow(0 0 6px rgba(120, 180, 255, 0.35)); }
  50%      { filter: brightness(1.18) drop-shadow(0 0 12px rgba(150, 200, 255, 0.55)); }
}
.nge-lb-title-bracket {
  font-size: 0.55em;
  color: rgba(120, 180, 255, 0.7);
  -webkit-text-fill-color: rgba(120, 180, 255, 0.7);
  letter-spacing: 0;
}
.nge-lb-title-text {
  /* Inherit gradient fill */
}
.nge-lb-title-sub {
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 0.6em;
  letter-spacing: 0.4em;
  color: rgba(120, 180, 255, 0.55);
  text-transform: uppercase;
  margin-bottom: 4px;
}

.nge-lb-exit {
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.6em;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.nge-lb-exit:hover { color: #fff; }

.nge-lb-back {
  background: none;
  border: none;
  color: rgba(100, 180, 255, 0.85);
  font-size: 0.88em;
  cursor: pointer;
  padding: 4px 0;
}

.nge-lb-back:hover { color: rgba(160, 220, 255, 1); }

/* ── Tabs (sci-fi pill row) ── */
.nge-lb-tabs {
  display: flex;
  gap: 8px;
  padding: 12px 14px 6px;
  flex-shrink: 0;
  justify-content: center;
}

.nge-lb-tab {
  position: relative;
  padding: 7px 18px;
  background: rgba(120, 180, 255, 0.04);
  border: 1px solid rgba(120, 180, 255, 0.18);
  color: rgba(180, 200, 230, 0.7);
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 0.72em;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}

.nge-lb-tab:hover {
  background: rgba(120, 180, 255, 0.10);
  color: rgba(200, 220, 245, 0.9);
}

.nge-lb-tab--active {
  background: linear-gradient(180deg, rgba(120, 180, 255, 0.22) 0%, rgba(80, 140, 255, 0.12) 100%);
  border-color: rgba(120, 180, 255, 0.6);
  color: #d8ecff;
  box-shadow:
    0 0 12px rgba(120, 180, 255, 0.35),
    inset 0 0 8px rgba(120, 180, 255, 0.18);
}
.nge-lb-tab--active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 24px;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(120, 180, 255, 0.9), transparent);
  transform: translateX(-50%);
}

/* ── Scrollable content ── */
.nge-lb-content {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 10px 0 16px;
}

/* ── Table ── */
.nge-lb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86em;
}

.nge-lb-th {
  padding: 5px 10px;
  text-align: left;
  color: #555;
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.nge-lb-th--rank  { width: 34px; text-align: center; }
.nge-lb-th--num   { width: 62px; text-align: right; }
.nge-lb-th--badge { width: 36px; text-align: center; }

.nge-lb-row {
  cursor: pointer;
  transition: background 0.12s;
}

.nge-lb-row:hover              { background: rgba(255, 255, 255, 0.04); }
.nge-lb-row--you               { background: rgba(74, 158, 255, 0.06); }
.nge-lb-row--you:hover         { background: rgba(74, 158, 255, 0.11); }

.nge-lb-td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

.nge-lb-td--rank {
  text-align: center;
  font-size: 1.1em;
  line-height: 1;
}

.nge-lb-rank-num {
  color: #555;
  font-size: 0.88em;
}

.nge-lb-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #ccc;
}

.nge-lb-td--badge {
  text-align: center;
}

.nge-lb-flag-img {
  width: 20px; height: 14px; object-fit: cover; border-radius: 2px;
  margin-right: 6px; vertical-align: middle;
}
.nge-lb-flag-img--detail {
  width: 32px; height: 22px;
}
.nge-lb-flag-img--logo {
  width: 18px; height: 18px;
  object-fit: contain;
  border-radius: 0;
}
.nge-lb-flag-img--logo.nge-lb-flag-img--detail {
  width: 26px; height: 26px;
}

.nge-lb-flag-fallback {
  font-size: 1em;
  margin-right: 6px;
  vertical-align: middle;
}
.nge-lb-flag-fallback--detail {
  font-size: 1.5em;
}

.nge-lb-name {
  font-weight: 500;
  color: rgba(74, 158, 255, 0.9);
  cursor: pointer;
}
.nge-lb-row:hover .nge-lb-name {
  text-decoration: underline;
}

.nge-lb-you-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  background: rgba(74, 158, 255, 0.15);
  border: 1px solid rgba(74, 158, 255, 0.35);
  border-radius: 9px;
  font-size: 0.68em;
  color: rgba(160, 220, 255, 0.9);
  vertical-align: middle;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.nge-lb-streak {
  margin-left: 6px;
  font-size: 0.76em;
  color: #f5a623;
  vertical-align: middle;
}

.nge-lb-badge-img {
  width: 28px;
  height: 28px;
  object-fit: contain;
  vertical-align: middle;
}

.nge-lb-badge-none { color: #444; }

/* ── Detail view ── */
.nge-lb-detail {
  padding: 18px 20px 24px;
}

.nge-lb-detail-header {
  margin-bottom: 18px;
}

.nge-lb-detail-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.nge-lb-detail-flag {
  font-size: 1.8em;
  line-height: 1;
}

.nge-lb-detail-name {
  font-size: 1.35em;
  font-weight: 700;
  color: #e8e8e8;
}

.nge-lb-detail-bio {
  font-size: 0.82em;
  color: #777;
  font-style: italic;
  margin-top: 6px;
  line-height: 1.4;
}

/* Detail stats: 2-column grid */
.nge-lb-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 16px;
}

.nge-lb-detail-stat {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 9px 11px;
}

.nge-lb-detail-stat-val {
  font-size: 1.2em;
  font-weight: 700;
  color: #e0e0e0;
  font-variant-numeric: tabular-nums;
}

.nge-lb-detail-stat-lbl {
  font-size: 0.7em;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 2px;
}

/* Detail streak */
.nge-lb-detail-streak {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin-bottom: 16px;
  padding: 9px 12px;
  background: rgba(245, 166, 35, 0.07);
  border: 1px solid rgba(245, 166, 35, 0.18);
  border-radius: 8px;
  font-size: 0.88em;
}

.nge-lb-detail-streak-flame { font-size: 1.1em; }
.nge-lb-detail-streak-count { font-size: 1.25em; font-weight: 700; color: #f5a623; }
.nge-lb-detail-streak-unit  { color: #888; font-size: 0.85em; }
.nge-lb-detail-streak-sep   { color: #444; }
.nge-lb-detail-streak-best  { color: #bbb; font-size: 0.85em; }

/* Detail badges */
.nge-lb-detail-badges-label {
  font-size: 1em;
  font-weight: 600;
  padding-top: 14px;
  padding-bottom: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 8px;
}

.nge-lb-detail-badges-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.nge-lb-detail-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: default;
  transition: transform 0.15s;
}

.nge-lb-detail-badge:not(.nge-lb-detail-badge--locked) { cursor: pointer; }
.nge-lb-detail-badge:not(.nge-lb-detail-badge--locked):hover { transform: scale(1.08); }

.nge-lb-detail-badge--selected .nge-lb-detail-badge-img {
  filter: drop-shadow(0 0 6px rgba(100, 180, 255, 0.75));
}

.nge-lb-detail-badge-img {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
}

.nge-lb-detail-badge-icon {
  width: 44px;
  height: 44px;
  object-fit: contain;
}

.nge-lb-detail-badge-mystery {
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px dashed rgba(255, 255, 255, 0.15);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nge-lb-detail-badge-mystery-q {
  font-size: 1.1em;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.2);
  font-style: italic;
  line-height: 1;
}

.nge-lb-detail-badge-name {
  font-size: 0.62em;
  color: #bbb;
  margin-top: 3px;
  line-height: 1.2;
  max-width: 60px;
  word-break: break-word;
}

.nge-lb-detail-badge-name--locked { color: #444; }

.nge-lb-detail-no-badges {
  font-size: 0.78em;
  color: #444;
  font-style: italic;
  padding: 8px 0 4px;
}

/* Badge detail card */
.nge-lb-detail-badge-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 10px 12px;
  background: rgba(100, 180, 255, 0.08);
  border: 1px solid rgba(100, 180, 255, 0.22);
  border-radius: 8px;
  position: relative;
}

.nge-lb-detail-badge-card-icon {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
}

.nge-lb-detail-badge-card-body { flex: 1; min-width: 0; }

.nge-lb-detail-badge-card-name  { font-weight: 600; font-size: 0.92em; margin-bottom: 2px; }
.nge-lb-detail-badge-card-desc  { font-size: 0.8em; color: #ccc; margin-bottom: 2px; }
.nge-lb-detail-badge-card-thresh { font-size: 0.72em; color: rgba(100, 180, 255, 0.7); }

.nge-lb-detail-badge-card-close {
  position: absolute;
  top: 5px; right: 9px;
  background: none; border: none;
  color: #666; font-size: 1.1em; cursor: pointer; padding: 0; line-height: 1;
}

.nge-lb-detail-badge-card-close:hover { color: #ccc; }

.lb-badge-detail-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.lb-badge-detail-leave-active { transition: all 0.15s ease-in; }
.lb-badge-detail-enter-from,
.lb-badge-detail-leave-to { opacity: 0; transform: translateY(8px) scale(0.96); }

.nge-lb-view-profile {
  margin-top: 8px;
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.25);
  color: #58a6ff;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.nge-lb-view-profile:hover {
  background: rgba(74, 158, 255, 0.2);
  border-color: rgba(74, 158, 255, 0.4);
}
</style>
