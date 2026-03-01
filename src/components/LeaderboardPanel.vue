<script setup lang="ts">
import {ref, computed} from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import {DEMO_USERS, DemoUser} from '../data/demo-users';
import {BADGE_DEFINITIONS} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';

type Tab = 'week' | 'month' | 'alltime';
const activeTab     = ref<Tab>('alltime');
const selectedUser  = ref<DemoUser | null>(null);
const selectedBadgeId = ref<number | null>(null);

// Sort demo users by the active tab's edit metric
const rankedUsers = computed(() => {
  const key = activeTab.value === 'week'  ? 'editsThisWeek'
            : activeTab.value === 'month' ? 'editsThisMonth'
                                          : 'editsAllTime';
  return [...DEMO_USERS].sort((a, b) => b.stats[key] - a.stats[key]);
});

// Rank of Amy (id='amy') in current sort — for "you" highlight
const amyRank = computed(() =>
  rankedUsers.value.findIndex(u => u.id === 'amy') + 1,
);

function editCountForTab(user: DemoUser): number {
  if (activeTab.value === 'week')  return user.stats.editsThisWeek;
  if (activeTab.value === 'month') return user.stats.editsThisMonth;
  return user.stats.editsAllTime;
}

// Badges logic (mirrors UserProfilePanel)
function isBadgeEarned(editThreshold: number, editsAllTime: number): boolean {
  if (editThreshold === 0) return false;
  return editsAllTime >= editThreshold;
}

function getBadgeUrl(imageKey: string): string {
  return BADGE_IMAGE_MAP[imageKey] ?? '';
}

// Top earned badge for leaderboard row
function topBadge(user: DemoUser) {
  const earned = BADGE_DEFINITIONS
    .filter(b => b.editThreshold > 0 && user.stats.editsAllTime >= b.editThreshold)
    .sort((a, b) => b.editThreshold - a.editThreshold);
  return earned[0] ?? null;
}

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

const RANK_MEDAL: Record<number, string> = {1: '🥇', 2: '🥈', 3: '🥉'};

const emit = defineEmits({hide: null});
</script>

<template>
  <modal-overlay id="nge-lb-modal" class="nge-lb-modal" @hide="emit('hide')">
    <div class="nge-lb-shell">

      <!-- ── LIST VIEW ──────────────────────────────── -->
      <template v-if="!selectedUser">
        <!-- Header -->
        <div class="nge-lb-topbar">
          <span class="nge-lb-title">🏆 Leaderboard</span>
          <button class="nge-lb-exit" @click="emit('hide')">×</button>
        </div>

        <!-- Tabs -->
        <div class="nge-lb-tabs">
          <button
            class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'alltime' }"
            @click="activeTab = 'alltime'">All Time</button>
          <button
            class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'month' }"
            @click="activeTab = 'month'">This Month</button>
          <button
            class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'week' }"
            @click="activeTab = 'week'">This Week</button>
        </div>

        <!-- Table -->
        <div class="nge-lb-content">
          <table class="nge-lb-table">
            <thead>
              <tr>
                <th class="nge-lb-th nge-lb-th--rank">#</th>
                <th class="nge-lb-th">Name</th>
                <th class="nge-lb-th nge-lb-th--num">Edits</th>
                <th class="nge-lb-th nge-lb-th--num">Cells</th>
                <th class="nge-lb-th nge-lb-th--badge">Top Badge</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(user, idx) in rankedUsers"
                :key="user.id"
                class="nge-lb-row"
                :class="{ 'nge-lb-row--you': user.id === 'amy' }"
                @click="selectUser(user)"
              >
                <td class="nge-lb-td nge-lb-td--rank">
                  <span v-if="RANK_MEDAL[idx + 1]">{{ RANK_MEDAL[idx + 1] }}</span>
                  <span v-else class="nge-lb-rank-num">{{ idx + 1 }}</span>
                </td>
                <td class="nge-lb-td">
                  <span class="nge-lb-flag">{{ user.flag }}</span>
                  <span class="nge-lb-name">{{ user.name }}</span>
                  <span v-if="user.id === 'amy'" class="nge-lb-you-tag">you</span>
                  <span v-if="user.stats.currentStreak > 0" class="nge-lb-streak" :title="`${user.stats.currentStreak}-day streak`">
                    🔥{{ user.stats.currentStreak }}
                  </span>
                </td>
                <td class="nge-lb-td nge-lb-td--num">
                  {{ editCountForTab(user).toLocaleString() }}
                </td>
                <td class="nge-lb-td nge-lb-td--num">
                  {{ user.stats.cellsSubmitted.toLocaleString() }}
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

      <!-- ── DETAIL VIEW ─────────────────────────────── -->
      <template v-else>
        <!-- Back bar -->
        <div class="nge-lb-topbar">
          <button class="nge-lb-back" @click="selectedUser = null">← Back</button>
          <button class="nge-lb-exit" @click="emit('hide')">×</button>
        </div>

        <div class="nge-lb-content nge-lb-detail">
          <!-- Profile header -->
          <div class="nge-lb-detail-header">
            <div class="nge-lb-detail-name-row">
              <span class="nge-lb-detail-flag">{{ selectedUser.flag }}</span>
              <div class="nge-lb-detail-name">{{ selectedUser.name }}</div>
            </div>
            <div class="nge-lb-detail-bio" v-if="selectedUser.bio">{{ selectedUser.bio }}</div>
          </div>

          <!-- Stats grid -->
          <div class="nge-lb-detail-grid">
            <div class="nge-lb-detail-stat">
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.editsAllTime.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">Edits All Time</div>
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
              <div class="nge-lb-detail-stat-val">{{ selectedUser.stats.cellsSubmitted.toLocaleString() }}</div>
              <div class="nge-lb-detail-stat-lbl">Cells</div>
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

          <!-- Badges -->
          <div class="nge-lb-detail-badges-label">Badges</div>
          <div class="nge-lb-detail-badges-grid">
            <div
              v-for="badge in BADGE_DEFINITIONS"
              :key="badge.id"
              class="nge-lb-detail-badge"
              :class="{
                'nge-lb-detail-badge--locked': !isBadgeEarned(badge.editThreshold, selectedUser.stats.editsAllTime),
                'nge-lb-detail-badge--selected': selectedBadgeId === badge.id,
              }"
              :title="isBadgeEarned(badge.editThreshold, selectedUser.stats.editsAllTime)
                ? badge.name + ' — click for details'
                : '??? (locked)'"
              @click="isBadgeEarned(badge.editThreshold, selectedUser.stats.editsAllTime)
                ? onDetailBadgeClick(badge.id)
                : undefined"
            >
              <template v-if="isBadgeEarned(badge.editThreshold, selectedUser.stats.editsAllTime)">
                <div class="nge-lb-detail-badge-img">
                  <img :src="getBadgeUrl(badge.imageKey)" :alt="badge.name" class="nge-lb-detail-badge-icon" />
                </div>
                <div class="nge-lb-detail-badge-name">{{ badge.name }}</div>
              </template>
              <template v-else>
                <div class="nge-lb-detail-badge-img">
                  <div class="nge-lb-detail-badge-mystery">
                    <span class="nge-lb-detail-badge-mystery-q">?</span>
                  </div>
                </div>
                <div class="nge-lb-detail-badge-name nge-lb-detail-badge-name--locked">???</div>
              </template>
            </div>
          </div>

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
                  Unlocked at {{ selectedBadgeDef()?.editThreshold.toLocaleString() }} edits
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

/* ── Sci-fi materialize ── */
.nge-lb-modal :deep(.nge-overlay) {
  position: relative;
  overflow: hidden;
  animation: ngeLbMaterialize 0.52s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nge-lb-modal :deep(.nge-overlay::before) {
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
  animation: ngeLbScan 0.52s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  z-index: 100;
  pointer-events: none;
}

@keyframes ngeLbMaterialize {
  0% {
    opacity: 0; transform: translateY(14px) scale(0.96);
    filter: blur(8px) brightness(2);
    box-shadow: 0 0 60px rgba(74, 158, 255, 0.5), 0 0 120px rgba(74, 158, 255, 0.15);
  }
  35% {
    opacity: 1; filter: blur(0.5px) brightness(1.15);
    box-shadow: 0 0 20px rgba(74, 158, 255, 0.15);
  }
  100% {
    opacity: 1; transform: translateY(0) scale(1);
    filter: blur(0px) brightness(1); box-shadow: none;
  }
}

@keyframes ngeLbScan {
  0%   { top: 0%;   opacity: 1; }
  85%  { opacity: 0.4; }
  100% { top: 100%; opacity: 0; }
}

/* ── Shell ── */
.nge-lb-shell {
  display: flex;
  flex-direction: column;
  width: 580px;
  max-height: 88vh;
}

/* ── Top bar ── */
.nge-lb-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px 10px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}

.nge-lb-title {
  font-size: 1.1em;
  font-weight: 600;
  color: #e0e0e0;
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

/* ── Tabs ── */
.nge-lb-tabs {
  display: flex;
  gap: 0;
  padding: 10px 16px 0;
  flex-shrink: 0;
}

.nge-lb-tab {
  flex: 1;
  padding: 7px 0;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  color: #888;
  font-size: 0.82em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.nge-lb-tab:first-child { border-radius: 6px 0 0 6px; }
.nge-lb-tab:last-child  { border-radius: 0 6px 6px 0; }
.nge-lb-tab + .nge-lb-tab { border-left: none; }

.nge-lb-tab--active {
  background: rgba(74,158,255,0.16);
  border-color: rgba(74,158,255,0.4);
  color: rgba(160,220,255,0.95);
  font-weight: 600;
}

/* ── Scrollable content area ── */
.nge-lb-content {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 12px 0 16px;
}

/* ── Table ── */
.nge-lb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88em;
}

.nge-lb-th {
  padding: 6px 12px;
  text-align: left;
  color: #666;
  font-size: 0.78em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}

.nge-lb-th--rank  { width: 40px; text-align: center; }
.nge-lb-th--num   { width: 80px; text-align: right; }
.nge-lb-th--badge { width: 64px; text-align: center; }

.nge-lb-row {
  cursor: pointer;
  transition: background 0.12s;
}

.nge-lb-row:hover {
  background: rgba(255,255,255,0.04);
}

.nge-lb-row--you {
  background: rgba(74,158,255,0.06);
}

.nge-lb-row--you:hover {
  background: rgba(74,158,255,0.11);
}

.nge-lb-td {
  padding: 9px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  vertical-align: middle;
}

.nge-lb-td--rank {
  text-align: center;
  font-size: 1.15em;
  line-height: 1;
}

.nge-lb-rank-num {
  color: #555;
  font-size: 0.9em;
}

.nge-lb-td--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #ccc;
}

.nge-lb-td--badge {
  text-align: center;
}

.nge-lb-flag {
  font-size: 1.15em;
  margin-right: 7px;
  vertical-align: middle;
}

.nge-lb-name {
  font-weight: 500;
  color: #ddd;
}

.nge-lb-you-tag {
  display: inline-block;
  margin-left: 7px;
  padding: 1px 6px;
  background: rgba(74,158,255,0.15);
  border: 1px solid rgba(74,158,255,0.35);
  border-radius: 9px;
  font-size: 0.7em;
  color: rgba(160,220,255,0.9);
  vertical-align: middle;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.nge-lb-streak {
  margin-left: 8px;
  font-size: 0.8em;
  color: #f5a623;
  vertical-align: middle;
}

.nge-lb-badge-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  vertical-align: middle;
}

.nge-lb-badge-none {
  color: #444;
}

/* ── Detail view ── */
.nge-lb-detail {
  padding: 20px 24px 24px;
}

.nge-lb-detail-header {
  margin-bottom: 20px;
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
  font-size: 1.5em;
  font-weight: 700;
  color: #e8e8e8;
}

.nge-lb-detail-bio {
  font-size: 0.85em;
  color: #888;
  font-style: italic;
  margin-top: 6px;
  line-height: 1.4;
}

/* Detail stats grid */
.nge-lb-detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.nge-lb-detail-stat {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 10px 12px;
}

.nge-lb-detail-stat-val {
  font-size: 1.25em;
  font-weight: 700;
  color: #e0e0e0;
  font-variant-numeric: tabular-nums;
}

.nge-lb-detail-stat-lbl {
  font-size: 0.72em;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 3px;
}

/* Detail streak */
.nge-lb-detail-streak {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin-bottom: 18px;
  padding: 10px 14px;
  background: rgba(245,166,35,0.07);
  border: 1px solid rgba(245,166,35,0.18);
  border-radius: 8px;
  font-size: 0.9em;
}

.nge-lb-detail-streak-flame { font-size: 1.1em; }
.nge-lb-detail-streak-count { font-size: 1.3em; font-weight: 700; color: #f5a623; }
.nge-lb-detail-streak-unit  { color: #888; font-size: 0.85em; }
.nge-lb-detail-streak-sep   { color: #444; }
.nge-lb-detail-streak-best  { color: #bbb; font-size: 0.85em; }

/* Detail badges */
.nge-lb-detail-badges-label {
  font-size: 1.1em;
  font-weight: 600;
  padding-bottom: 10px;
  border-top: 1px solid rgba(255,255,255,0.08);
  padding-top: 16px;
  margin-bottom: 10px;
}

.nge-lb-detail-badges-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.nge-lb-detail-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: default;
  transition: transform 0.15s;
}

.nge-lb-detail-badge:not(.nge-lb-detail-badge--locked) {
  cursor: pointer;
}

.nge-lb-detail-badge:not(.nge-lb-detail-badge--locked):hover {
  transform: scale(1.08);
}

.nge-lb-detail-badge--selected .nge-lb-detail-badge-img {
  filter: drop-shadow(0 0 6px rgba(100, 180, 255, 0.75));
}

.nge-lb-detail-badge-img {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
}

.nge-lb-detail-badge-icon {
  width: 54px;
  height: 54px;
  object-fit: contain;
}

.nge-lb-detail-badge-mystery {
  width: 48px;
  height: 48px;
  background: rgba(255,255,255,0.05);
  border: 2px dashed rgba(255,255,255,0.15);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nge-lb-detail-badge-mystery-q {
  font-size: 1.3em;
  font-weight: 700;
  color: rgba(255,255,255,0.2);
  font-style: italic;
  line-height: 1;
}

.nge-lb-detail-badge-name {
  font-size: 0.68em;
  color: #bbb;
  margin-top: 4px;
  line-height: 1.2;
  max-width: 72px;
  word-break: break-word;
}

.nge-lb-detail-badge-name--locked {
  color: #444;
  letter-spacing: 0.05em;
}

/* Badge detail card */
.nge-lb-detail-badge-card {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
  padding: 12px 14px;
  background: rgba(100,180,255,0.08);
  border: 1px solid rgba(100,180,255,0.22);
  border-radius: 8px;
  position: relative;
}

.nge-lb-detail-badge-card-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  flex-shrink: 0;
}

.nge-lb-detail-badge-card-body { flex: 1; min-width: 0; }

.nge-lb-detail-badge-card-name {
  font-weight: 600;
  font-size: 1em;
  margin-bottom: 3px;
}

.nge-lb-detail-badge-card-desc {
  font-size: 0.85em;
  color: #ccc;
  margin-bottom: 3px;
}

.nge-lb-detail-badge-card-thresh {
  font-size: 0.75em;
  color: rgba(100,180,255,0.7);
}

.nge-lb-detail-badge-card-close {
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

.nge-lb-detail-badge-card-close:hover { color: #ccc; }

.lb-badge-detail-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.lb-badge-detail-leave-active {
  transition: all 0.15s ease-in;
}

.lb-badge-detail-enter-from,
.lb-badge-detail-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
</style>
