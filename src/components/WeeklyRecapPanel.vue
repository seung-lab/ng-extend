<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';
// Banner: 980 reconstructed cells (static/images/recap, original alongside).
import recapBanner from '../../static/images/recap/week-in-science-banner.jpg';

import { useUserStatsStore, useCellHistoryStore, useIssueTagStore, useHelpRequestStore, useProofreadingBackendStore } from '../store';
import { BUILDING_BADGES, EXPLORATION_BADGES, BadgeTrack } from '../widgets/badge_definitions';
import { SCIENCE_FACTS } from '../data/science-facts';

const { stats } = storeToRefs(useUserStatsStore());
const emit = defineEmits({ hide: null });
// When embedded (e.g. inside the profile's "Week in Science" tab) we drop the
// modal chrome and render the content inline.
const props = defineProps<{ embedded?: boolean }>();

// ── Week date range label: "Feb 23 – Mar 1, 2026" ────────────────────────
const weekRange = computed<string>(() => {
  const now = new Date();
  const day = now.getDay(); // 0=Sun … 6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return `${fmt(monday)} to ${fmt(sunday)}, ${sunday.getFullYear()}`;
});

// ── Scout and help activity this week (Amy: the recap was missing tag
// and help stats). Tags scope by their own timestamps; help requests have
// no resolved_at column, so answered scopes by the request's week.
const tagStoreW = useIssueTagStore();
const helpStoreW = useHelpRequestStore();
const backendW = useProofreadingBackendStore();

// ── Global stats: the whole community, from the leaderboard's own view ──
// user_edit_counts counts edits over a rolling 7 days (not Monday to
// Sunday), so the section says "last 7 days" rather than "this week".
interface GlobalStats {
  editsWeek: number; activeWeek: number; cellsWeek: number;
  editsAll: number; cellsAll: number; scientists: number; mineWeek: number;
}
const globalStats = ref<GlobalStats | null>(null);

// ── Your week and month, from the shared edit log ──
// The local stats tally lives in this browser only, so edits made on
// another computer never reached it (Amy's week showed 6 where the edit
// log and CAVE both had 13). Count merges and splits from edit_log for the
// same Monday to Sunday week the header shows, and the calendar month.
// Falls back to the local tally if the log cannot be read.
const serverCounts = ref<{ week: [number, number]; month: [number, number] } | null>(null);
const shown = computed(() => {
  const s = stats.value;
  const c = serverCounts.value;
  if (!c) return s;
  return {
    ...s,
    mergesThisWeek: c.week[0], splitsThisWeek: c.week[1], editsThisWeek: c.week[0] + c.week[1],
    mergesThisMonth: c.month[0], splitsThisMonth: c.month[1], editsThisMonth: c.month[0] + c.month[1],
  };
});
onMounted(async () => {
  const uid = backendW.userId;
  if (!uid) return;
  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = weekStart < monthStart ? weekStart : monthStart;
    const { supabase } = await import('../supabase');
    const { data, error } = await supabase.from('edit_log')
      .select('operation, timestamp, success')
      .eq('user_id', uid)
      .gte('timestamp', since.toISOString())
      .limit(20000);
    if (error || !data) return;
    const week: [number, number] = [0, 0];
    const month: [number, number] = [0, 0];
    for (const r of data as any[]) {
      if (r.success === false) continue;
      const i = r.operation === 'merge' ? 0 : r.operation === 'split' ? 1 : -1;
      if (i < 0) continue;
      const t = new Date(r.timestamp);
      if (t >= weekStart) week[i]++;
      if (t >= monthStart) month[i]++;
    }
    serverCounts.value = { week, month };
  } catch { /* keep the local tally */ }
});
onMounted(async () => {
  try {
    const { supabase } = await import('../supabase');
    const { data, error } = await supabase.from('user_edit_counts')
      .select('id, edits_week, completions_week, edits_alltime, completions_alltime')
      .limit(10000);
    if (error || !data) return;
    const sum = (k: string) => data.reduce((n: number, r: any) => n + (r[k] || 0), 0);
    const me = data.find((r: any) => r.id === backendW.userId);
    globalStats.value = {
      editsWeek: sum('edits_week'),
      activeWeek: data.filter((r: any) => (r.edits_week || 0) > 0).length,
      cellsWeek: sum('completions_week'),
      editsAll: sum('edits_alltime'),
      cellsAll: sum('completions_alltime'),
      scientists: data.filter((r: any) => (r.edits_alltime || 0) > 0 || (r.completions_alltime || 0) > 0).length,
      mineWeek: me?.edits_week || 0,
    };
  } catch { /* the section just stays hidden */ }
});
const weekStartMs = computed(() => {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon).getTime();
});
const inWeek = (iso?: string) => !!iso && new Date(iso).getTime() >= weekStartMs.value;
const tagsPlacedThisWeek = computed(() =>
  tagStoreW.tags.filter(t => t.userId && t.userId === backendW.userId && inWeek(t.createdAt)).length);
const tagsFixedThisWeek = computed(() =>
  tagStoreW.tags.filter(t => t.status === 'resolved' && t.resolvedById && t.resolvedById === backendW.userId && inWeek(t.resolvedAt ?? t.createdAt)).length);
const helpAskedThisWeek = computed(() =>
  helpStoreW.requests.filter(r => r.userId && r.userId === backendW.userId && inWeek(r.createdAt)).length);
const myRecapName = computed(() => backendW.userName || backendW.userEmail?.split('@')[0] || '');
const helpAnsweredThisWeek = computed(() =>
  helpStoreW.requests.filter(r => r.resolved && myRecapName.value && r.resolvedByName === myRecapName.value && inWeek(r.createdAt)).length);

// ── Month label: "March 2026" ─────────────────────────────────────────────
const monthLabel = computed<string>(() =>
  new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
);

// ── Community contribution % ──────────────────────────────────────────────
const contributionPct = computed<string | null>(() => {
  const total = stats.value.communityEditsThisWeek;
  const personal = stats.value.editsThisWeek;
  if (!total || !personal) return null;
  const pct = (personal / total) * 100;
  return pct < 0.1 ? '<0.1' : pct.toFixed(1);
});

// ── Next unearned badge + progress bar (picks closest across both tracks) ────
interface NextBadgeInfo {
  name: string;
  threshold: number;
  remaining: number;
  progressPct: number;
  prevThreshold: number;
  track: BadgeTrack;
}

/** Both tracks, edits first (Amy 2026-09-28: one bar for edits and one for
 *  cells). The old single bar picked whichever track had fewer units
 *  remaining, which compared edits against cells as if they were the same
 *  thing ("25 cells" beat "118 edits"). */
const nextBadges = computed<NextBadgeInfo[]>(() => {
  const all = nextBadgeFor.value;
  return [all.building, all.exploration].filter((x): x is NextBadgeInfo => !!x);
});
const nextBadgeFor = computed(() => {
  function nextFor(badges: typeof BUILDING_BADGES, current: number, track: BadgeTrack): NextBadgeInfo | null {
    const sorted = [...badges].filter(b => b.threshold > 0).sort((a, b) => a.threshold - b.threshold);
    const idx = sorted.findIndex(b => current < b.threshold);
    if (idx === -1) return null;
    const target = sorted[idx];
    const prev = idx > 0 ? sorted[idx - 1].threshold : 0;
    const pct = Math.min(100, Math.round(((current - prev) / (target.threshold - prev)) * 100));
    return { name: target.name, threshold: target.threshold, remaining: target.threshold - current, progressPct: pct, prevThreshold: prev, track };
  }
  return {
    building: nextFor(BUILDING_BADGES, stats.value.editsAllTime ?? 0, 'building'),
    exploration: nextFor(EXPLORATION_BADGES, stats.value.cellsSubmitted ?? 0, 'exploration'),
  };
});

const nextBadge = computed<NextBadgeInfo | null>(() => {
  function nextFor(badges: typeof BUILDING_BADGES, current: number, track: BadgeTrack): NextBadgeInfo | null {
    const sorted = [...badges].filter(b => b.threshold > 0).sort((a, b) => a.threshold - b.threshold);
    const idx = sorted.findIndex(b => current < b.threshold);
    if (idx === -1) return null;
    const target = sorted[idx];
    const prev = idx > 0 ? sorted[idx - 1].threshold : 0;
    const range = target.threshold - prev;
    const progress = current - prev;
    const pct = Math.min(100, Math.round((progress / range) * 100));
    return { name: target.name, threshold: target.threshold, remaining: target.threshold - current, progressPct: pct, prevThreshold: prev, track };
  }
  const b = nextFor(BUILDING_BADGES, stats.value.editsAllTime ?? 0, 'building');
  const e = nextFor(EXPLORATION_BADGES, stats.value.cellsSubmitted ?? 0, 'exploration');
  if (!b) return e;
  if (!e) return b;
  return b.remaining <= e.remaining ? b : e;
});

// ── Rotating science facts (cycles by ISO week — same all week) ───────────

const currentFact = computed<string>(() => {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNo = Math.ceil(
    ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7
  );
  return SCIENCE_FACTS[weekNo % SCIENCE_FACTS.length].text;
});

// ── Cell activity this week ──────────────────────────────────────────────
const historyStore = useCellHistoryStore();

const mondayStart = computed<Date>(() => {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  return mon;
});

const cellsThisWeek = computed(() =>
  historyStore.cells.filter(c => new Date(c.updatedAt) >= mondayStart.value)
);
const cellsCompleted = computed(() => cellsThisWeek.value.filter(c => c.isComplete));
const cellsIdentified = computed(() => cellsThisWeek.value.filter(c => c.cellType));

function truncateId(id: string): string {
  return id.length > 12 ? id.slice(0, 6) + '…' + id.slice(-4) : id;
}

function jumpToCell(segId: string) {
  historyStore.jumpToCell(segId);
  emit('hide');
}
</script>

<template>
  <component
    :is="props.embedded ? 'div' : ModalOverlay"
    :id="props.embedded ? undefined : 'nge-recap-modal'"
    :class="props.embedded ? 'nge-recap-embedded' : 'nge-recap-modal'"
    @hide="emit('hide')"
  >
    <div class="nge-recap-shell" :class="{ 'nge-recap-shell--embedded': props.embedded }"
         :style="{ '--recap-banner': `url(${recapBanner})` }">

      <!-- Non-scrolling topbar (modal only) -->
      <div v-if="!props.embedded" class="nge-recap-topbar">
        <button class="nge-recap-exit" @click="emit('hide')">×</button>
      </div>

      <!-- Scrollable content -->
      <div class="nge-recap-content">

        <!-- Hero header -->
        <div class="nge-recap-hero">
          <!-- "My" when shown inside your own profile, "Your" when it appears
               as a standalone toast/panel addressed to the reader. -->
          <div class="nge-recap-hero-title">{{ embedded ? 'My' : 'Your' }} Week in Science</div>
          <div class="nge-recap-hero-daterange">{{ weekRange }}</div>
        </div>

        <!-- Big hero edit number -->
        <div class="nge-recap-big-stat">
          <div class="nge-recap-big-number">{{ shown.editsThisWeek.toLocaleString() }}</div>
          <div class="nge-recap-big-label">edits this week</div>
          <div class="nge-recap-big-sub">
            {{ shown.mergesThisWeek.toLocaleString() }} merges
            + {{ shown.splitsThisWeek.toLocaleString() }} splits
          </div>
        </div>

        <!-- Streak showcase -->
        <div class="nge-recap-section nge-recap-streak"
             v-if="stats.currentStreak > 0 || stats.longestStreak > 0">
          <div class="nge-recap-section-label">Editing Streak</div>
          <div class="nge-recap-streak-row">
            <div class="nge-recap-streak-current">
              <span class="nge-recap-flame">🔥</span>
              <span class="nge-recap-streak-num">{{ stats.currentStreak }}</span>
              <span class="nge-recap-streak-unit">
                day{{ stats.currentStreak === 1 ? '' : 's' }} in a row
              </span>
            </div>
            <div class="nge-recap-streak-record" v-if="stats.longestStreak > 0">
              <span class="nge-recap-streak-record-label">Personal best:</span>
              <span class="nge-recap-streak-record-num">{{ stats.longestStreak }}</span>
              <span class="nge-recap-streak-unit">
                day{{ stats.longestStreak === 1 ? '' : 's' }}
              </span>
            </div>
          </div>
        </div>

        <!-- Month summary -->
        <div class="nge-recap-section nge-recap-month">
          <div class="nge-recap-section-label">{{ monthLabel }}</div>
          <div class="nge-recap-month-grid">
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ shown.editsThisMonth.toLocaleString() }}</div>
              <div class="nge-recap-month-key">total edits</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ shown.mergesThisMonth.toLocaleString() }}</div>
              <div class="nge-recap-month-key">merges</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ shown.splitsThisMonth.toLocaleString() }}</div>
              <div class="nge-recap-month-key">splits</div>
            </div>
          </div>
        </div>

        <!-- Cell activity this week -->
        <div class="nge-recap-section nge-recap-cells" v-if="cellsThisWeek.length > 0">
          <div class="nge-recap-section-label">Cell Activity</div>
          <div class="nge-recap-month-grid">
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num nge-recap-cells-complete">{{ cellsCompleted.length }}</div>
              <div class="nge-recap-month-key">completed</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num nge-recap-cells-id">{{ cellsIdentified.length }}</div>
              <div class="nge-recap-month-key">identified</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ cellsThisWeek.length }}</div>
              <div class="nge-recap-month-key">touched</div>
            </div>
          </div>
          <div class="nge-recap-cell-list" v-if="cellsThisWeek.length > 0">
            <div
              v-for="cell in cellsThisWeek.slice(0, 8)"
              :key="cell.segId"
              class="nge-recap-cell-row"
              @click="jumpToCell(cell.segId)"
            >
              <span class="nge-recap-cell-pip" :class="{
                'nge-recap-cell-pip--done': cell.isComplete,
                'nge-recap-cell-pip--typed': !cell.isComplete && cell.cellType,
              }">{{ cell.isComplete ? '✓' : cell.cellType ? '🏷' : '○' }}</span>
              <span class="nge-recap-cell-name">{{ truncateId(cell.segId) }}</span>
              <span class="nge-recap-cell-type" v-if="cell.cellType">{{ cell.cellType }}</span>
            </div>
          </div>
        </div>

        <!-- Scout and help activity this week -->
        <div class="nge-recap-section">
          <div class="nge-recap-section-label">Scout Report</div>
          <div class="nge-recap-month-grid">
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num" style="color: #35b5ff;">{{ tagsPlacedThisWeek }}</div>
              <div class="nge-recap-month-key">tags placed</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num" style="color: #9d9;">{{ tagsFixedThisWeek }}</div>
              <div class="nge-recap-month-key">tags you fixed</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ helpAskedThisWeek }}</div>
              <div class="nge-recap-month-key">help asked</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num" style="color: #7f8;">{{ helpAnsweredThisWeek }}</div>
              <div class="nge-recap-month-key">help answered</div>
            </div>
          </div>
        </div>

        <!-- Next badge progress -->
        <div class="nge-recap-section nge-recap-badge-progress" v-if="nextBadges.length">
          <div class="nge-recap-section-label">Next Badges</div>
          <div v-for="nb in nextBadges" :key="nb.track" class="nge-recap-badge-track" :class="`nge-recap-badge-track--${nb.track}`">
            <div class="nge-recap-badge-row">
              <div class="nge-recap-badge-name">
                <!-- Badge names hidden here (Amy 2026-09-28): the next badge is a surprise. -->
                <span class="nge-recap-badge-kind">{{ nb.track === 'building' ? 'Edits' : 'Cells' }}</span>
              </div>
              <div class="nge-recap-badge-remaining">
                {{ nb.remaining.toLocaleString() }} {{ nb.track === 'building' ? 'edits' : 'cells' }} to go
              </div>
            </div>
            <div class="nge-recap-progress-track">
              <div
                class="nge-recap-progress-fill"
                :style="{ width: nb.progressPct + '%' }"
              ></div>
            </div>
            <div class="nge-recap-progress-labels">
              <span>{{ nb.prevThreshold.toLocaleString() }}</span>
              <span>{{ nb.progressPct }}%</span>
              <span>{{ nb.threshold.toLocaleString() }}</span>
            </div>
          </div>
        </div>
        <div class="nge-recap-section nge-recap-badge-complete" v-else>
          <div class="nge-recap-section-label">Badges</div>
          <div class="nge-recap-all-done">All badges unlocked. You are a Legend. 🏆</div>
        </div>

        <!-- Science fun fact -->
        <div class="nge-recap-section nge-recap-fact">
          <div class="nge-recap-fact-eyebrow">Did you know?</div>
          <div class="nge-recap-fact-text">{{ currentFact }}</div>
        </div>

        <!-- Global stats: everyone together -->
        <div class="nge-recap-section nge-recap-global" v-if="globalStats">
          <div class="nge-recap-section-label">Global Stats</div>
          <div class="nge-recap-global-halves">
          <div class="nge-recap-global-half">
          <div class="nge-recap-global-sub">Everyone in EyeWire II, last 7 days</div>
          <div class="nge-recap-month-grid">
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num" style="color: #42d5ec;">{{ globalStats.editsWeek.toLocaleString() }}</div>
              <div class="nge-recap-month-key">edits</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num" style="color: #c98bff;">{{ globalStats.activeWeek.toLocaleString() }}</div>
              <div class="nge-recap-month-key">scientists editing</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num" style="color: #7f8;">{{ globalStats.cellsWeek.toLocaleString() }}</div>
              <div class="nge-recap-month-key">cells completed</div>
            </div>
          </div>
          <div class="nge-recap-global-share" v-if="globalStats.mineWeek > 0 && globalStats.editsWeek > 0">
            You made <strong>{{ globalStats.mineWeek.toLocaleString() }}</strong> of them,
            <strong>{{ Math.round(globalStats.mineWeek / globalStats.editsWeek * 100) }}%</strong> of the community's edits.
          </div>
          </div>
          <div class="nge-recap-global-half">
          <div class="nge-recap-global-sub">All time</div>
          <div class="nge-recap-month-grid">
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ globalStats.editsAll.toLocaleString() }}</div>
              <div class="nge-recap-month-key">edits</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ globalStats.cellsAll.toLocaleString() }}</div>
              <div class="nge-recap-month-key">cells completed</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ globalStats.scientists.toLocaleString() }}</div>
              <div class="nge-recap-month-key">citizen scientists</div>
            </div>
          </div>
          </div>
          </div>
        </div>

      </div>
    </div>
  </component>
</template>

<style scoped>
.nge-recap-modal {
  font-size: 0.9em;
}

/* ── Shell: flex structure (animation on the overlay panel itself) ── */
.nge-recap-shell {
  display: flex;
  flex-direction: column;
  max-height: 88vh;
}
/* Embedded in the profile tab: no modal height cap, let the profile body scroll.
   Fill the profile shell's width instead of the standalone modal's fixed 580px,
   which read as a small centred box inside the wider profile. */
.nge-recap-shell--embedded { max-height: none; }
.nge-recap-embedded { display: block; width: 100%; }
.nge-recap-shell--embedded { width: 100%; }
/* Embedded in the wide profile tab: sections flow into three columns so the
   whole week fits on one screen. Title, big number, and the global stats
   run the full width. */
.nge-recap-shell--embedded .nge-recap-content {
  width: 100%;
  padding: 8px 32px 24px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: 28px;
  align-content: start;
}
.nge-recap-shell--embedded .nge-recap-content > .nge-recap-hero,
.nge-recap-shell--embedded .nge-recap-content > .nge-recap-big-stat,
.nge-recap-shell--embedded .nge-recap-content > .nge-recap-global { grid-column: 1 / -1; }
.nge-recap-shell--embedded .nge-recap-hero { padding: 40px 16px 8px; margin-bottom: 4px; }
.nge-recap-shell--embedded .nge-recap-big-stat { padding: 4px 0 16px; }
.nge-recap-shell--embedded .nge-recap-section { margin-bottom: 14px; padding-bottom: 14px; }
@media (max-width: 900px) {
  .nge-recap-shell--embedded .nge-recap-content { grid-template-columns: minmax(0, 1fr); }
}
.nge-recap-global-halves { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; }
@media (max-width: 900px) { .nge-recap-global-halves { grid-template-columns: minmax(0, 1fr); } }

/* ── Sci-fi materialize ── */
.nge-recap-modal :deep(.nge-overlay) {
  overflow: hidden;
  animation: ngeRecapMaterialize 0.52s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Scanline removed — holographic border glow handled by ModalOverlay */

@keyframes ngeRecapMaterialize {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) translateY(14px) scale(0.96);
    filter: blur(10px) brightness(2.5);
    box-shadow: 0 0 80px rgba(0, 180, 255, 0.5), 0 0 160px rgba(0, 180, 255, 0.15);
  }
  30% {
    opacity: 0.8;
    transform: translate(-50%, -50%);
    filter: blur(1px) brightness(1.2);
    box-shadow: 0 0 30px rgba(0, 180, 255, 0.15);
  }
  60% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(0.998);
    filter: blur(0) brightness(1.05);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%);
    filter: blur(0) brightness(1);
    box-shadow: none;
  }
}

/* (scanline keyframe removed — using ModalOverlay holographic effects) */

.nge-recap-topbar {
  display: flex;
  justify-content: flex-end;
  padding: 10px 12px 0;
  flex-shrink: 0;
}

.nge-recap-exit {
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.6em;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.nge-recap-exit:hover { color: #fff; }

/* ── Scrollable content ── */
.nge-recap-content {
  width: 580px;
  overflow-y: auto;
  scrollbar-width: none;         /* Firefox */
  padding: 8px 44px 32px;
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
}
.nge-recap-content::-webkit-scrollbar {
  display: none;                 /* Chrome / Safari */
}

/* ── Hero header ── */
.nge-recap-hero {
  text-align: center;
  padding: 70px 16px 26px;
  margin-bottom: 20px;
}
/* The 980 cells render fills the whole tab: vivid behind the title, then
   darkened down the page so every stat stays readable over it. */
.nge-recap-shell {
  background:
    linear-gradient(180deg, rgba(4, 6, 12, 0.2) 0px, rgba(4, 6, 12, 0.55) 220px, rgba(4, 6, 12, 0.86) 420px, rgba(4, 6, 12, 0.92) 100%),
    var(--recap-banner) center top / cover no-repeat,
    #04060c;
}

.nge-recap-hero-title {
  font-size: 1.5em;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.85);
}

.nge-recap-hero-daterange {
  margin-top: 4px;
  font-size: 0.85em;
  color: #d6e6f5;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.9);
}

/* ── Big hero stat ── */
.nge-recap-big-stat {
  text-align: center;
  padding: 16px 0 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 20px;
}

.nge-recap-big-number {
  font-size: 3.2em;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 0 18px rgba(120, 190, 255, 0.45), 0 2px 10px rgba(0, 0, 0, 0.8);
  line-height: 1;
  letter-spacing: -0.02em;
}

.nge-recap-big-label {
  font-size: 0.95em;
  color: #ccc;
  margin-top: 4px;
}

.nge-recap-big-sub {
  font-size: 0.75em;
  color: #666;
  margin-top: 3px;
}

/* ── Generic section ── */
.nge-recap-section {
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.nge-recap-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.nge-recap-section-label {
  font-size: 0.72em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #666;
  margin-bottom: 10px;
}

/* ── Streak ── */
.nge-recap-streak-row {
  display: flex;
  align-items: baseline;
  gap: 20px;
  flex-wrap: wrap;
}

.nge-recap-streak-current {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.nge-recap-flame {
  font-size: 1.5em;
  line-height: 1;
}

.nge-recap-streak-num {
  font-size: 2em;
  font-weight: 700;
  color: #f5a623;
  line-height: 1;
}

.nge-recap-streak-unit {
  font-size: 0.82em;
  color: #9e9e9e;
}

.nge-recap-streak-record {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 0.85em;
}

.nge-recap-streak-record-label { color: #666; }

.nge-recap-streak-record-num {
  color: #bbb;
  font-weight: 600;
}

/* ── Month summary ── */
.nge-recap-month-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.nge-recap-month-cell {
  background: rgba(74, 158, 255, 0.06);
  border: 1px solid rgba(74, 158, 255, 0.12);
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
}

.nge-recap-month-num {
  font-size: 1.3em;
  font-weight: 700;
  color: #4a9eff;
}

.nge-recap-month-key {
  font-size: 0.7em;
  color: #666;
  margin-top: 2px;
}

/* ── Cell activity ── */
.nge-recap-cells-complete { color: #7f8 !important; }
.nge-recap-cells-id { color: #f5a623 !important; }

.nge-recap-cell-list {
  margin-top: 10px;
}

.nge-recap-cell-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.82em;
  transition: background 0.12s;
}

.nge-recap-cell-row:hover {
  background: rgba(74, 158, 255, 0.08);
}

.nge-recap-cell-pip { width: 16px; text-align: center; flex-shrink: 0; }
.nge-recap-cell-pip--done { color: #7f8; }
.nge-recap-cell-pip--typed { color: #f5a623; }

.nge-recap-cell-name {
  flex: 1;
  color: rgba(74, 158, 255, 0.8);
  font-family: ui-monospace, 'Cascadia Code', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nge-recap-cell-type {
  flex-shrink: 0;
  font-size: 0.9em;
  color: #9e9e9e;
  font-style: italic;
}

/* ── Community pulse ── */
.nge-recap-community-total {
  font-size: 0.88em;
  color: #ccc;
  margin-bottom: 6px;
}

.nge-recap-community-share {
  font-size: 0.82em;
  color: #9e9e9e;
}

.nge-recap-community-share strong {
  color: #4a9eff;
}

/* ── Next badge progress ── */
.nge-recap-badge-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.nge-recap-badge-name {
  font-size: 0.92em;
  font-weight: 600;
  color: #ddd;
}

.nge-recap-badge-remaining {
  font-size: 0.75em;
  color: #9e9e9e;
}

.nge-recap-progress-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.nge-recap-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4a9eff, #6fbcff);
  border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nge-recap-progress-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 0.68em;
  color: #555;
}

.nge-recap-all-done {
  font-size: 0.9em;
  color: #4a9eff;
  font-style: italic;
}

/* ── Science fact ── */
.nge-recap-fact {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 14px 16px;
  border-bottom: none;
  margin-bottom: 0;
}

.nge-recap-fact-eyebrow {
  font-size: 0.68em;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #4a9eff;
  margin-bottom: 6px;
}

.nge-recap-fact-text {
  font-size: 0.9em;
  color: #d4dce8;
  line-height: 1.55;
}

.nge-recap-global { margin-top: 20px; }
.nge-recap-global-sub {
  margin: -4px 0 10px;
  font-size: 0.8em;
  color: #9fb3c8;
}

.nge-recap-global-share {
  margin-top: 10px;
  font-size: 0.86em;
  color: #c9d6e3;
}
.nge-recap-global-share strong { color: #42d5ec; }

/* ── Readability over the render (Amy 2026-09-28: "some of these are hard to
      read"). The neuron render now sits behind the recap, so the old #555 to
      #666 labels and near-transparent tiles vanished into it. Labels are
      lifted, every tile and panel gets a dark translucent backing, and all
      text gets a soft dark halo. Kept as one block at the end so it layers on
      the rules above without rewriting them. ── */
.nge-recap-section-label,
.nge-recap-month-key,
.nge-recap-big-sub,
.nge-recap-streak-record-label,
.nge-recap-progress-labels {
  color: #b4c3d6;
}
.nge-recap-streak-unit,
.nge-recap-badge-remaining,
.nge-recap-community-share,
.nge-recap-cell-type { color: #d2dbe7; }
.nge-recap-streak-record-num,
.nge-recap-badge-name,
.nge-recap-big-label { color: #f2f6fb; }
.nge-recap-month-cell {
  background: rgba(4, 8, 18, 0.78);
  border-color: rgba(74, 158, 255, 0.28);
  backdrop-filter: blur(6px);
}
.nge-recap-fact {
  background: rgba(4, 8, 18, 0.8);
  border-color: rgba(74, 158, 255, 0.22);
  backdrop-filter: blur(6px);
}
.nge-recap-badge-progress,
.nge-recap-streak-row {
  background: rgba(4, 8, 18, 0.72);
  border-radius: 8px;
  padding: 10px 12px;
  backdrop-filter: blur(6px);
}
.nge-recap-section-label,
.nge-recap-month-key,
.nge-recap-month-num,
.nge-recap-streak-num,
.nge-recap-streak-unit,
.nge-recap-streak-record,
.nge-recap-badge-name,
.nge-recap-badge-remaining,
.nge-recap-progress-labels,
.nge-recap-big-label,
.nge-recap-big-sub,
.nge-recap-global-sub,
.nge-recap-global-share,
.nge-recap-fact-text {
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 10px rgba(0, 0, 0, 0.7);
}
.nge-recap-progress-track { background: rgba(255, 255, 255, 0.14); }

/* Two countdowns, colour matched to the profile's badge sections:
   Proofreading (edits) amber, Cell Achievements teal. */
.nge-recap-badge-track + .nge-recap-badge-track { margin-top: 12px; }
.nge-recap-badge-kind {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: 8px;
  font-size: 0.72em;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: 1px;
}
.nge-recap-badge-track--building .nge-recap-badge-kind { background: rgba(255, 208, 138, 0.16); color: #ffd08a; }
.nge-recap-badge-track--exploration .nge-recap-badge-kind { background: rgba(94, 234, 212, 0.14); color: #5eead4; }
.nge-recap-badge-track--building .nge-recap-progress-fill { background: linear-gradient(90deg, #f5a623, #ffd08a); }
.nge-recap-badge-track--exploration .nge-recap-progress-fill { background: linear-gradient(90deg, #14b8a6, #5eead4); }
</style>
