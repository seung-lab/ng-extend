<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted, watch, nextTick, type Ref} from 'vue';
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';
import {DemoUser} from '../data/demo-users';
import {BADGE_DEFINITIONS, BUILDING_BADGES, EXPLORATION_BADGES, BadgeDefinition} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';
import {useUserPreferencesStore, useProofreadingBackendStore} from '../store';
import {EYEWIRE_FLAG} from '../data/countries';
import nurroTrophy from '../../static/badges/pyr/nurro-trophy.png';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

const {prefs} = storeToRefs(useUserPreferencesStore());
const backendStore = useProofreadingBackendStore();

type Tab = 'day' | 'week' | 'alltime';
const activeTab    = ref<Tab>('day');

// Metric toggle: ranks by edits (split+merge) or completions (mark_complete).
// Persists across sessions in localStorage.
type Metric = 'edits' | 'completions';
const METRIC_STORAGE_KEY = 'nge-leaderboard-metric';
const initialMetric = (localStorage.getItem(METRIC_STORAGE_KEY) as Metric) || 'edits';
const metric = ref<Metric>(initialMetric === 'completions' ? 'completions' : 'edits');
function setMetric(m: Metric) {
  metric.value = m;
  try { localStorage.setItem(METRIC_STORAGE_KEY, m); } catch {}
}
const selectedUser = ref<DemoUser | null>(null);
const selectedBadgeId = ref<number | null>(null);

// ── Load-in (Ames 2026-10-06: "make the leaderboard load in cooler") ──────
// After experimental-ui's arrival model: every row lands on its own damped
// spring, the stagger carries a slice of the golden angle so a batch never
// reads as one mechanical sweep, and each landing ends on a glint. The scores
// count up while the rows arrive, and a thin meter under each name draws out
// to that player's share of the leader's score. It runs when the board first
// has rows, and (faster) when the window or the metric changes. The minute
// refresh never replays it.
const contentEl = ref<HTMLElement | null>(null);
/** 0 to 1 while the scores count up; 1 at rest. */
const rollK = ref(1);
let arriveRaf = 0;
function arrive(fast = false) {
  cancelAnimationFrame(arriveRaf);
  const rows = Array.from(contentEl.value?.querySelectorAll<HTMLElement>('tbody > tr.nge-lb-row') || []);
  if (!rows.length) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    rows.forEach(r => { r.style.setProperty('--in', '1'); r.classList.add('is-landed'); });
    rollK.value = 1;
    return;
  }
  const GOLDEN = 0.381966;
  const t0 = performance.now(), lead = fast ? 50 : 300, step = fast ? 20 : 46, jitter = fast ? 36 : 96;
  const items = rows.map((el, i) => ({
    el, x: 0, v: 0, last: 0, done: false,
    // rows far down the list are off screen: they do not hold the others up
    start: t0 + lead + Math.min(i, 13) * step + ((i * GOLDEN) % 1) * jitter,
  }));
  rows.forEach(r => { r.style.setProperty('--in', '0'); r.classList.remove('is-landed'); });
  rollK.value = 0;
  const ROLL = fast ? 620 : 1250, rollStart = t0 + lead + 60;
  const tick = (now: number) => {
    let busy = false;
    for (const it of items) {
      if (it.done) continue;
      busy = true;
      if (now < it.start) continue;
      if (!it.last) it.last = now;
      const dt = Math.min((now - it.last) / 1000, 1 / 30);
      it.last = now;
      const h = dt / 3;
      for (let k = 0; k < 3; k++) {                 // a spring a little short of critical: one small overshoot
        const a = -230 * (it.x - 1) - 21 * it.v;
        it.v += a * h; it.x += it.v * h;
      }
      it.el.style.setProperty('--in', Math.max(0, Math.min(1.06, it.x)).toFixed(3));
      if (Math.abs(it.x - 1) < 0.003 && Math.abs(it.v) < 0.02) {
        it.el.style.setProperty('--in', '1');
        it.done = true;
        it.el.classList.add('is-landed');
      }
    }
    const q = Math.min(1, Math.max(0, (now - rollStart) / ROLL));
    rollK.value = q >= 1 ? 1 : 1 - Math.pow(1 - q, 3);
    if (q < 1) busy = true;
    if (busy) arriveRaf = requestAnimationFrame(tick);
  };
  arriveRaf = requestAnimationFrame(tick);
}
onUnmounted(() => cancelAnimationFrame(arriveRaf));

// The way out is the way in, run backwards (Ames 2026-10-06): the rows leave
// from the bottom up, the scores count back down, and the controls, title
// and trophy fold away in the reverse of the order they arrived, before the
// panel zips into its button. Quicker than the arrival, so closing never
// feels held up.
const departing = ref(false);
function depart(): Promise<void> {
  cancelAnimationFrame(arriveRaf);
  const box = contentEl.value;
  const all = Array.from(box?.querySelectorAll<HTMLElement>('tbody > tr.nge-lb-row') || []);
  // only the rows on screen take part; the rest are already out of sight
  const view = box?.getBoundingClientRect();
  const rows = view ? all.filter(r => { const b = r.getBoundingClientRect(); return b.bottom > view.top && b.top < view.bottom; }) : all;
  departing.value = true;
  const STEP = 16, DUR = 200, ROLL = 300, t0 = performance.now();
  const total = Math.max(ROLL, (rows.length - 1) * STEP + DUR, 340);
  return new Promise(resolve => {
    const tick = (now: number) => {
      const t = now - t0;
      rows.forEach((el, i) => {
        const start = (rows.length - 1 - i) * STEP;         // last row first
        const q = Math.min(1, Math.max(0, (t - start) / DUR));
        el.style.setProperty('--in', (1 - q * q).toFixed(3));
        if (q > 0) el.classList.remove('is-landed');
      });
      const rq = Math.min(1, t / ROLL);
      rollK.value = 1 - rq * rq;
      if (t < total) arriveRaf = requestAnimationFrame(tick);
      else resolve();
    };
    arriveRaf = requestAnimationFrame(tick);
  });
}

// Load the board when it opens, and again every minute while it stays open,
// so the numbers do not go stale behind an open panel.
let refreshTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  backendStore.loadLeaderboard();
  refreshTimer = setInterval(() => { if (!document.hidden) backendStore.loadLeaderboard(); }, 60_000);
});
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer); });

// Convert Supabase user rows to DemoUser shape for display.
// `edits_*` and `completions_*` come from the `user_edit_counts` view;
// `total_edits` / `cells_completed` are the all-time fallbacks when the
// view isn't deployed yet. The DemoUser stats fields are reused as
// generic time-window slots — the leaderboard's metric/tab selection
// decides how to interpret them.
const supabaseUsers = computed<DemoUser[]>(() => {
  return backendStore.leaderboard.map((u: any) => {
    const isCompletions = metric.value === 'completions';
    const day  = isCompletions ? (u.completions_24h ?? 0)      : (u.edits_24h ?? 0);
    const week = isCompletions ? (u.completions_week ?? 0)     : (u.edits_week ?? 0);
    const all  = isCompletions ? (u.completions_alltime ?? u.cells_completed ?? 0)
                               : (u.edits_alltime      ?? u.total_edits      ?? 0);
    return {
      id: u.id,
      name: u.display_name || 'Anonymous',
      flag: u.flag || '',
      bio: '',
      stats: {
        editsAllTime: all,
        mergesAllTime: u.total_merges || 0,
        splitsAllTime: u.total_splits || 0,
        editsThisWeek: week,
        mergesThisWeek: 0,
        splitsThisWeek: 0,
        editsThisMonth: day,    // repurposed: now means 24h window
        mergesThisMonth: 0,
        splitsThisMonth: 0,
        cellsSubmitted: u.cells_completed || 0,
        currentStreak: u.current_streak || 0,
        longestStreak: u.longest_streak || 0,
      },
    };
  });
});

const metricLabel = computed(() => metric.value === 'completions' ? 'Cells' : 'Edits');

// Only real players, ever. With nothing to show the board says why (below);
// it used to fill itself with made-up demo players (audit, 2026-10-05).
const userSource = computed(() => supabaseUsers.value);

/** Why there are no rows, or a note above the rows; '' when all is well. */
const boardNote = computed(() => {
  const st = backendStore.leaderboardState;
  if (st === 'loading' && !supabaseUsers.value.length) return 'Loading the board';
  if (st === 'unavailable') return supabaseUsers.value.length
    ? 'The board could not be refreshed just now. These are the last numbers it read.'
    : 'The board is not available right now. Please try again in a moment.';
  if (st === 'alltime-only' && activeTab.value !== 'alltime')
    return 'The 24 hour and 7 day counts are not available right now. All Time still is.';
  if (st === 'ok' && !boardRows.value.length) return 'Nobody is on this board yet.';
  return '';
});
/** No rows at all on the tab being shown. */
const boardBlank = computed(() =>
  !supabaseUsers.value.length || (backendStore.leaderboardState === 'alltime-only' && activeTab.value !== 'alltime'));
const readAt = computed(() => backendStore.leaderboardAt
  ? new Date(backendStore.leaderboardAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

// Sort users by the active tab's edit metric.
//   day → editsThisMonth field (now repurposed to hold edits_24h)
//   week → editsThisWeek
//   alltime → editsAllTime
const rankedUsers = computed(() => {
  const key = activeTab.value === 'week' ? 'editsThisWeek'
            : activeTab.value === 'day'  ? 'editsThisMonth'
                                         : 'editsAllTime';
  // Ties: the same order every time (by name, then id), never by chance.
  return [...userSource.value].sort((a, b) => b.stats[key] - a.stats[key]
    || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
});

// The board lists the top 50 of the ranking on screen. A player below that
// still gets their own row at the foot, with their true place (Ames
// 2026-10-05: "always add your own row with your true rank").
const BOARD_SIZE = 50;
const isYou = (user: DemoUser) => user.id === backendStore.userId;
const rankingColumn = computed(() => {
  const span = activeTab.value === 'week' ? 'week' : activeTab.value === 'day' ? '24h' : 'alltime';
  return `${metric.value === 'completions' ? 'completions' : 'edits'}_${span}`;
});
const boardRows = computed<{ user: DemoUser; rank: number; below: boolean }[]>(() => {
  if (boardBlank.value) return [];
  const all = rankedUsers.value;
  const rows = all.slice(0, BOARD_SIZE).map((user, i) => ({ user, rank: i + 1, below: false }));
  const at = all.findIndex(isYou);
  if (at >= BOARD_SIZE) {
    // The loaded list only holds the top of each ranking, so the true place
    // comes from the server's count of players ahead.
    const rank = Math.max(backendStore.leaderboardMyRanks[rankingColumn.value] ?? 0, at + 1);
    rows.push({ user: all[at], rank, below: true });
  }
  return rows;
});

// The board's first rows, then every change of window or metric, and coming
// back from a player's card.
let arrivedOnce = false;
watch(() => boardRows.value.length > 0, has => {
  if (!has || arrivedOnce) return;
  arrivedOnce = true;
  nextTick(() => arrive(false));
}, { immediate: true, flush: 'post' });
watch([activeTab, metric], () => { if (arrivedOnce) nextTick(() => arrive(true)); }, { flush: 'post' });
watch(selectedUser, u => { if (!u && arrivedOnce) nextTick(() => arrive(true)); }, { flush: 'post' });
/** The leader's score on the board in view, for the meters. */
const topCount = computed(() => boardRows.value.reduce((m, r) => Math.max(m, editCountForTab(r.user)), 0));
const shareOf = (user: DemoUser) => topCount.value > 0 ? Math.min(1, editCountForTab(user) / topCount.value) : 0;

function editCountForTab(user: DemoUser): number {
  if (activeTab.value === 'week') return user.stats.editsThisWeek;
  if (activeTab.value === 'day')  return user.stats.editsThisMonth;
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

// ── Open on arrival, zip into the 🏆 on close (Ames 2026-09-28) ──
// The leaderboard greets you when you open EyeWire II (ExtensionBar reads
// this pref), and closing it shrinks it into its toolbar button so you
// know where it went.
const ON_OPEN_KEY = 'nge-leaderboard-on-open';
const showOnOpen = ref(readShowOnOpen());
function readShowOnOpen(): boolean {
  try { return localStorage.getItem(ON_OPEN_KEY) !== '0'; } catch { return true; }
}
function setShowOnOpen(on: boolean) {
  showOnOpen.value = on;
  try { localStorage.setItem(ON_OPEN_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

function onShowOnOpenChange(e: Event) { setShowOnOpen((e.target as HTMLInputElement).checked); }

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const shell = document.querySelector('#nge-lb-modal .nge-overlay') as HTMLElement | null
    ?? document.querySelector('#nge-lb-modal .nge-lb-shell') as HTMLElement | null;
  const btn = document.querySelector('[data-icon-id="leaderboard"]') as HTMLElement | null;
  // ModalOverlay passes id="nge-lb-modal" to its root, the dimmed backdrop.
  const blocker = document.getElementById('nge-lb-modal');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && !selectedUser.value) await depart();
  if (shell && btn && !reduce && shell.animate) {
    const a = shell.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    const s = Math.max(0.04, Math.min(b.width / a.width, b.height / a.height));
    // Clear the dim and blur behind it (not the whole backdrop's opacity,
    // which would hide the panel mid-flight).
    if (blocker && !props.peek) {
      blocker.style.backgroundImage = 'none';
      blocker.animate([
        { backgroundColor: 'rgba(0, 6, 16, 0.85)', backdropFilter: 'blur(6px)' },
        { backgroundColor: 'rgba(0, 6, 16, 0)', backdropFilter: 'blur(0px)' },
      ], { duration: 420, easing: 'ease-out', fill: 'forwards' });
    }
    // The panel is pinned with `transform: none !important` (below), which
    // beats any animation of `transform`, so move it with the separate
    // translate / scale properties instead.
    const anim = shell.animate([
      { translate: '0px 0px', scale: '1', opacity: 1, filter: 'blur(0px)' },
      { translate: `${dx * 0.35}px ${dy * 0.35}px`, scale: '0.55', opacity: 0.85, filter: 'blur(0.5px)', offset: 0.45 },
      { translate: `${dx}px ${dy}px`, scale: String(s), opacity: 0, filter: 'blur(2px)' },
    ] as Keyframe[], { duration: 520, easing: 'cubic-bezier(0.55, 0, 0.35, 1)', fill: 'forwards' });
    try { await anim.finished; } catch { /* interrupted */ }
    btn.classList.add('nge-icon-btn--caught');
    setTimeout(() => btn.classList.remove('nge-icon-btn--caught'), 700);
  }
  emit('hide');
}

/** The dataset's own numbers live in DatasetStatsPanel; ExtensionBar
 *  listens, puts this panel away and opens that one. */
function openDatasetStats() {
  document.dispatchEvent(new CustomEvent('nge:open-dataset-stats', { detail: { panel: true } }));
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
/** Peek: the arrival greeting. No dim or blur, the site stays usable, and
 *  the first click anywhere else zips it away (Ames 2026-09-28). */
const props = defineProps<{ peek?: boolean }>();
function onPeekPointerDown(e: PointerEvent) {
  const panel = document.querySelector('#nge-lb-modal .nge-overlay');
  if (panel && !panel.contains(e.target as Node)) void close();
}
function onPeekKey(e: KeyboardEvent) { if (e.key === 'Escape') void close(); }
onMounted(() => {
  if (!props.peek) return;
  document.addEventListener('pointerdown', onPeekPointerDown, true);
  document.addEventListener('keydown', onPeekKey);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', onPeekPointerDown, true);
  document.removeEventListener('keydown', onPeekKey);
});
</script>

<template>
  <modal-overlay id="nge-lb-modal" class="nge-lb-modal" :class="{ 'nge-lb-modal--peek': props.peek }" @hide="close">
    <div class="nge-lb-shell" :class="{ 'nge-lb-shell--departing': departing }">
      <span class="nge-lb-scan" aria-hidden="true"></span>

      <!-- ── LIST VIEW ─────────────────────────────────── -->
      <template v-if="!selectedUser">

        <div class="nge-lb-topbar">
          <button class="nge-lb-exit nge-lb-exit--abs" @click="close">×</button>
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
          <button class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'day' }"
                  @click="activeTab = 'day'">24h</button>
          <button class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'week' }"
                  @click="activeTab = 'week'">Week</button>
          <button class="nge-lb-tab" :class="{ 'nge-lb-tab--active': activeTab === 'alltime' }"
                  @click="activeTab = 'alltime'">All Time</button>
        </div>

        <!-- Metric toggle: edits vs completions -->
        <div class="nge-lb-metric-toggle">
          <button
            class="nge-lb-metric"
            :class="{ 'nge-lb-metric--active': metric === 'edits' }"
            @click="setMetric('edits')"
          >Edits</button>
          <button
            class="nge-lb-metric"
            :class="{ 'nge-lb-metric--active': metric === 'completions' }"
            @click="setMetric('completions')"
          >Cells</button>
        </div>

        <div ref="contentEl" class="nge-lb-content">
          <div v-if="boardNote" class="nge-lb-note" role="status">{{ boardNote }}</div>
          <table v-if="boardRows.length" class="nge-lb-table">
            <thead>
              <tr>
                <th class="nge-lb-th nge-lb-th--rank">#</th>
                <th class="nge-lb-th">Name</th>
                <th class="nge-lb-th nge-lb-th--num">{{ metricLabel }}</th>
                <th class="nge-lb-th nge-lb-th--badge">★</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="{ user, rank, below } in boardRows"
                :key="user.id"
                class="nge-lb-row"
                :class="{ 'nge-lb-row--you': isYou(user), 'nge-lb-row--below': below }"
                :title="below ? `You are ${rank.toLocaleString()} on this board. The top ${BOARD_SIZE} are shown above.` : undefined"
                @click="selectUser(user)"
              >
                <td class="nge-lb-td nge-lb-td--rank">
                  <span v-if="RANK_MEDAL[rank]" class="nge-lb-medal">{{ RANK_MEDAL[rank] }}</span>
                  <span v-else class="nge-lb-rank-num">{{ rank.toLocaleString() }}</span>
                </td>
                <td class="nge-lb-td nge-lb-td--name">
                  <!-- This player's share of the leader's score, drawn as the row lands. -->
                  <i class="nge-lb-meter" aria-hidden="true" :style="{ '--share': shareOf(user) }"></i>
                  <!-- Use live prefs flag for the logged-in user's row -->
                  <img v-if="isEyewireFlag(userFlag(user))"
                       class="nge-lb-flag-img nge-lb-flag-img--logo"
                       :src="pyrIcon" />
                  <img v-else-if="flagImgUrl(userFlag(user))"
                       class="nge-lb-flag-img"
                       :src="flagImgUrl(userFlag(user))" />
                  <span v-else class="nge-lb-flag-fallback">🌐</span>
                  <span class="nge-lb-name nge-lb-name--clickable" @click.stop="openFullProfile(user.id)" title="View profile">{{ user.name }}</span>
                  <span v-if="isYou(user)" class="nge-lb-you-tag">you</span>
                  <span v-if="user.stats.currentStreak > 0" class="nge-lb-streak"
                        :title="`${user.stats.currentStreak}-day streak`">
                    🔥{{ user.stats.currentStreak }}
                  </span>
                </td>
                <td class="nge-lb-td nge-lb-td--num">
                  {{ Math.round(editCountForTab(user) * rollK).toLocaleString() }}
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
        <button class="nge-lb-dataset-stats" @click="openDatasetStats">Dataset stats: what has been done so far →</button>
        <label class="nge-lb-onopen">
          <input type="checkbox" :checked="showOnOpen" @change="onShowOnOpenChange" />
          Show when I open EyeWire II
          <span v-if="readAt" class="nge-lb-readat" title="When these numbers were read. The board refreshes every minute while it is open.">Read at {{ readAt }}</span>
        </label>
      </template>

      <!-- ── DETAIL VIEW ────────────────────────────────── -->
      <template v-else>

        <div class="nge-lb-topbar">
          <button class="nge-lb-back" @click="selectedUser = null">← Back</button>
          <button class="nge-lb-exit" @click="close">×</button>
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
/* Peek: no dim, no blur, clicks go through to the site around the panel. */
.nge-lb-modal--peek {
  background: none !important;
  backdrop-filter: none !important;
  pointer-events: none !important;
}
.nge-lb-modal--peek :deep(.nge-holo-modal-particles) { display: none; }
.nge-lb-modal--peek :deep(.nge-overlay) {
  pointer-events: auto;
  animation: nge-lb-peek-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
@keyframes nge-lb-peek-in {
  from { translate: 40px 0; opacity: 0; }
  to { translate: 0 0; opacity: 1; }
}

/* ── Sidebar override ──────────────────────────────────────────────────────
   Neuroglancer's .overlay-content has position:absolute; top:50%; left:50%;
   transform:translate(-50%,-50%). We override those with !important to pin
   the panel to the right edge of the screen as a full-height sidebar.       */
/* One scrollbar, the list's own (Ames 2026-10-06: a second one ran down the
   far right edge). The panel is a column exactly as tall as the screen and
   never scrolls itself; only the list inside it does. */
/* (the selector names all three of the dialog's classes so it outranks the
   site-wide "every dialog scrolls" rule in ng-override.css) */
.nge-lb-modal :deep(.nge-overlay.modal.overlay-content) {
  display: flex !important;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden !important;
  max-height: 100vh !important;
}
.nge-lb-modal :deep(.nge-overlay) > .nge-lb-shell { flex: 1 1 auto; height: auto; min-height: 0; }
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
.nge-lb-dataset-stats {
  flex-shrink: 0;
  margin: 8px 14px 0;
  text-align: left;
  padding: 8px 12px;
  font-size: 12px;
  color: rgb(126, 224, 255);
  background: rgba(126, 224, 255, 0.06);
  border: 1px solid rgba(126, 224, 255, 0.28);
  border-radius: 6px;
  cursor: pointer;
}
.nge-lb-dataset-stats:hover { background: rgba(126, 224, 255, 0.14); color: #fff; }
.nge-lb-onopen {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 12px 10px;
  font-size: 12px;
  color: #8fa6c2;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
/* The site's own tick box, in the leaderboard's gold (Ames 2026-10-06: the
   browser's yellow square was not proper style). Same build as the one in
   the screenshot dialog. */
.nge-lb-onopen input {
  -webkit-appearance: none;
  appearance: none;
  flex: none;
  position: relative;
  width: 15px;
  height: 15px;
  margin: 0;
  border: 1px solid rgba(245, 196, 80, 0.5);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.nge-lb-onopen input:checked {
  background: rgba(245, 196, 80, 0.18);
  border-color: rgba(245, 196, 80, 0.9);
  box-shadow: 0 0 8px rgba(245, 196, 80, 0.3);
}
.nge-lb-onopen input:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #ffd87a;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.nge-lb-onopen:hover input { border-color: rgba(245, 196, 80, 0.85); }
.nge-lb-onopen input:focus-visible { outline: 2px solid rgb(178 216 248); outline-offset: 2px; }
.nge-lb-onopen:hover { color: #cfe0ff; }

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

/* ── Metric toggle (Edits / Cells) ── */
.nge-lb-metric-toggle {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 6px 14px 0;
  flex-shrink: 0;
}
.nge-lb-metric {
  padding: 4px 14px;
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-size: 0.66em;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  background: transparent;
  border: 1px solid rgba(120, 180, 255, 0.12);
  color: rgba(160, 195, 230, 0.55);
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.nge-lb-metric:hover {
  background: rgba(120, 180, 255, 0.06);
  color: rgba(180, 215, 245, 0.85);
}
.nge-lb-metric--active {
  background: rgba(120, 180, 255, 0.12);
  border-color: rgba(120, 180, 255, 0.45);
  color: #cfe6ff;
}

/* ── Scrollable content ── */
.nge-lb-content {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 10px 0 16px;
  /* Dark sci-fi scrollbar (Firefox) */
  scrollbar-width: thin;
  scrollbar-color: rgba(120, 180, 255, 0.35) rgba(8, 14, 26, 0.6);
}
/* Dark sci-fi scrollbar (WebKit / Chrome / Edge) */
.nge-lb-content::-webkit-scrollbar {
  width: 10px;
}
.nge-lb-content::-webkit-scrollbar-track {
  background: rgba(8, 14, 26, 0.6);
  border-left: 1px solid rgba(120, 180, 255, 0.08);
}
.nge-lb-content::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(120, 180, 255, 0.4), rgba(80, 140, 255, 0.25));
  border-radius: 5px;
  border: 2px solid rgba(8, 14, 26, 0.6);
  background-clip: padding-box;
}
.nge-lb-content::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(150, 200, 255, 0.55), rgba(100, 160, 255, 0.4));
  background-clip: padding-box;
  border: 2px solid rgba(8, 14, 26, 0.6);
}
.nge-lb-content::-webkit-scrollbar-corner {
  background: rgba(8, 14, 26, 0.6);
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
  /* the arrival: --in is driven by the row's spring (see arrive()) */
  --in: 1;
  opacity: min(1, var(--in));
  translate: calc((1 - var(--in)) * 30px) 0;
}
/* the landing ends on a glint: the rank lights up once, a medal pops */
.nge-lb-row.is-landed .nge-lb-td--rank { animation: nge-lb-glint 520ms ease-out 1; }
@keyframes nge-lb-glint {
  35% { text-shadow: 0 0 12px rgba(178, 216, 248, 0.95); filter: brightness(1.7); }
}
.nge-lb-medal { display: inline-block; }
.nge-lb-row.is-landed .nge-lb-medal { animation: nge-lb-medal 560ms cubic-bezier(0.2, 1.7, 0.4, 1) 1; }
@keyframes nge-lb-medal { 0% { transform: none; } 32% { transform: scale(1.5) rotate(-12deg); } 100% { transform: none; } }
/* share of the leader's score: a hairline under the name, drawn out as the row arrives */
.nge-lb-td--name { position: relative; }
.nge-lb-meter {
  position: absolute; left: 10px; right: 10px; bottom: -1px; height: 1px; pointer-events: none;
  background: rgba(120, 180, 255, 0.07);
}
.nge-lb-meter::after {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: calc(var(--share) * min(1, var(--in)) * 100%);
  background: linear-gradient(90deg, rgba(74, 158, 255, 0.15), rgba(126, 224, 255, 0.85));
  box-shadow: 0 0 6px rgba(126, 224, 255, 0.5);
}
.nge-lb-row--you .nge-lb-meter::after { background: linear-gradient(90deg, rgba(245, 196, 80, 0.2), rgba(255, 216, 122, 0.95)); box-shadow: 0 0 6px rgba(245, 196, 80, 0.55); }

/* ── The rest of the load-in: each piece arrives once, in order ── */
.nge-lb-shell { position: relative; }
/* one scan band down the whole board */
.nge-lb-scan {
  position: absolute; left: 0; right: 0; top: -9%; height: 9%; z-index: 3; pointer-events: none; opacity: 0;
  background: linear-gradient(180deg, transparent, rgba(126, 224, 255, 0.13), transparent);
  animation: nge-lb-scan 1500ms cubic-bezier(0.22, 0.9, 0.28, 1) 300ms 1 both;
}
@keyframes nge-lb-scan { 0% { top: -9%; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
/* the trophy drops in on a spring curve, out of an overbright blur */
.nge-lb-hero-img-wrap { animation: nge-lb-trophy-in 760ms cubic-bezier(0.2, 1.45, 0.35, 1) 90ms both; }
@keyframes nge-lb-trophy-in {
  0%   { opacity: 0; transform: translateY(22px) scale(0.5); filter: blur(8px) brightness(3); }
  55%  { opacity: 1; filter: blur(0) brightness(1.5); }
  100% { opacity: 1; transform: none; filter: none; }
}
/* the title opens from its centre, the rules draw outward, the tagline tightens into place */
.nge-lb-title-treat { animation: nge-lb-title-open 620ms cubic-bezier(0.16, 1, 0.3, 1) 240ms both; }
@keyframes nge-lb-title-open { 0% { clip-path: inset(0 50% 0 50%); opacity: 0; } 30% { opacity: 1; } 100% { clip-path: inset(-20px -20px -20px -20px); opacity: 1; } }
.nge-lb-title-rule { animation: nge-lb-rule 700ms cubic-bezier(0.16, 1, 0.3, 1) 200ms both; }
@keyframes nge-lb-rule { 0% { transform: scaleX(0); opacity: 0; } 100% { transform: none; opacity: 1; } }
.nge-lb-title-sub { animation: nge-lb-sub 700ms cubic-bezier(0.16, 1, 0.3, 1) 420ms both; }
@keyframes nge-lb-sub { 0% { opacity: 0; letter-spacing: 0.95em; } 100% { opacity: 1; } }
.nge-lb-tabs { animation: nge-lb-rise 460ms cubic-bezier(0.16, 1, 0.3, 1) 480ms both; }
.nge-lb-metric-toggle { animation: nge-lb-rise 460ms cubic-bezier(0.16, 1, 0.3, 1) 560ms both; }
.nge-lb-table thead { animation: nge-lb-rise 420ms cubic-bezier(0.16, 1, 0.3, 1) 620ms both; }
@keyframes nge-lb-rise { 0% { opacity: 0; translate: 0 8px; } 100% { opacity: 1; translate: none; } }

/* ── The way out: each piece folds away, last in first out ── */
.nge-lb-shell--departing .nge-lb-table thead { animation: nge-lb-sink 180ms ease-in 0ms both; }
.nge-lb-shell--departing .nge-lb-metric-toggle { animation: nge-lb-sink 180ms ease-in 40ms both; }
.nge-lb-shell--departing .nge-lb-tabs { animation: nge-lb-sink 180ms ease-in 80ms both; }
.nge-lb-shell--departing .nge-lb-onopen,
.nge-lb-shell--departing .nge-lb-note { animation: nge-lb-sink 160ms ease-in 0ms both; }
@keyframes nge-lb-sink { 0% { opacity: 1; translate: none; } 100% { opacity: 0; translate: 0 8px; } }
.nge-lb-shell--departing .nge-lb-title-sub { animation: nge-lb-sub-out 200ms ease-in 100ms both; }
@keyframes nge-lb-sub-out { 0% { opacity: 1; } 100% { opacity: 0; letter-spacing: 0.95em; } }
.nge-lb-shell--departing .nge-lb-title-treat { animation: nge-lb-title-close 240ms cubic-bezier(0.7, 0, 0.84, 0) 120ms both; }
@keyframes nge-lb-title-close { 0% { clip-path: inset(-20px -20px -20px -20px); opacity: 1; } 100% { clip-path: inset(0 50% 0 50%); opacity: 0; } }
.nge-lb-shell--departing .nge-lb-title-rule { animation: nge-lb-rule-out 240ms cubic-bezier(0.7, 0, 0.84, 0) 120ms both; }
@keyframes nge-lb-rule-out { 0% { transform: none; opacity: 1; } 100% { transform: scaleX(0); opacity: 0; } }
.nge-lb-shell--departing .nge-lb-hero-img-wrap { animation: nge-lb-trophy-out 300ms cubic-bezier(0.6, -0.3, 0.74, 0.05) 100ms both; }
@keyframes nge-lb-trophy-out {
  0%   { opacity: 1; transform: none; filter: none; }
  100% { opacity: 0; transform: translateY(18px) scale(0.5); filter: blur(6px) brightness(2.4); }
}

@media (prefers-reduced-motion: reduce) {
  .nge-lb-scan { display: none; }
  .nge-lb-hero-img-wrap, .nge-lb-title-treat, .nge-lb-title-rule, .nge-lb-title-sub, .nge-lb-tabs, .nge-lb-metric-toggle, .nge-lb-table thead,
  .nge-lb-row.is-landed .nge-lb-td--rank, .nge-lb-row.is-landed .nge-lb-medal { animation: none; }
}

.nge-lb-row:hover              { background: rgba(255, 255, 255, 0.04); }
.nge-lb-row--you               { background: rgba(74, 158, 255, 0.06); }
.nge-lb-row--you:hover         { background: rgba(74, 158, 255, 0.11); }
/* Your own row when you are below the top 50: set apart from the list above,
   and pinned to the foot of the list so it shows without scrolling. */
.nge-lb-row--below > td        { border-top: 1px dashed rgba(120, 180, 255, 0.45); position: sticky; bottom: 0; z-index: 1; background: #0d1830; }

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
.nge-lb-note {
  margin: 14px 16px; padding: 10px 12px; border-radius: 8px;
  font-size: 12.5px; line-height: 1.45; color: #cfe3ff;
  background: rgba(120, 170, 255, 0.08); border: 1px solid rgba(120, 170, 255, 0.25);
}
.nge-lb-readat { margin-left: auto; font-size: 11px; color: #8a97ad; }

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
