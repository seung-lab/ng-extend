<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';

import { useUserStatsStore, useCellHistoryStore } from '../store';
import { BUILDING_BADGES, EXPLORATION_BADGES, BadgeTrack } from '../widgets/badge_definitions';

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

  return `${fmt(monday)} – ${fmt(sunday)}, ${sunday.getFullYear()}`;
});

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
const SCIENCE_FACTS = [
  'Each neuron you trace may connect to thousands of others — mapping even one cell helps scientists understand entire circuits.',
  'The MICrONS dataset contains roughly 200,000 neurons and 500 million synapses from a cubic millimeter of mouse cortex.',
  'Neuron tracing data from citizen scientists has contributed to peer-reviewed discoveries about how the eye processes motion.',
  'Thanks to projects like EyeWire and FlyWire, the first complete wiring diagram of a fruit fly brain — 140,000 neurons — now exists.',
];

const currentFact = computed<string>(() => {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNo = Math.ceil(
    ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7
  );
  return SCIENCE_FACTS[weekNo % SCIENCE_FACTS.length];
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
    <div class="nge-recap-shell" :class="{ 'nge-recap-shell--embedded': props.embedded }">

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
          <div class="nge-recap-big-number">{{ stats.editsThisWeek.toLocaleString() }}</div>
          <div class="nge-recap-big-label">edits this week</div>
          <div class="nge-recap-big-sub">
            {{ stats.mergesThisWeek.toLocaleString() }} merges
            + {{ stats.splitsThisWeek.toLocaleString() }} splits
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
              <div class="nge-recap-month-num">{{ stats.editsThisMonth.toLocaleString() }}</div>
              <div class="nge-recap-month-key">total edits</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ stats.mergesThisMonth.toLocaleString() }}</div>
              <div class="nge-recap-month-key">merges</div>
            </div>
            <div class="nge-recap-month-cell">
              <div class="nge-recap-month-num">{{ stats.splitsThisMonth.toLocaleString() }}</div>
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

        <!-- Community pulse -->
        <div class="nge-recap-section nge-recap-community"
             v-if="stats.communityEditsThisWeek > 0">
          <div class="nge-recap-section-label">Community This Week</div>
          <div class="nge-recap-community-total">
            🌐 {{ stats.communityEditsThisWeek.toLocaleString() }} edits by the EyeWire II community
          </div>
          <div class="nge-recap-community-share" v-if="contributionPct">
            Your contribution: <strong>{{ contributionPct }}%</strong> of this week's science
          </div>
        </div>

        <!-- Next badge progress -->
        <div class="nge-recap-section nge-recap-badge-progress" v-if="nextBadge">
          <div class="nge-recap-section-label">Next Badge</div>
          <div class="nge-recap-badge-row">
            <div class="nge-recap-badge-name">{{ nextBadge.name }}</div>
            <div class="nge-recap-badge-remaining">
              {{ nextBadge.remaining.toLocaleString() }} {{ nextBadge.track === 'building' ? 'edits' : 'cells' }} to go
            </div>
          </div>
          <div class="nge-recap-progress-track">
            <div
              class="nge-recap-progress-fill"
              :style="{ width: nextBadge.progressPct + '%' }"
            ></div>
          </div>
          <div class="nge-recap-progress-labels">
            <span>{{ nextBadge.prevThreshold.toLocaleString() }}</span>
            <span>{{ nextBadge.progressPct }}%</span>
            <span>{{ nextBadge.threshold.toLocaleString() }}</span>
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
.nge-recap-shell--embedded .nge-recap-content {
  width: 100%;
  padding: 8px 32px 32px;
}

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
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 20px;
}

.nge-recap-hero-title {
  font-size: 1.5em;
  font-weight: 700;
  color: #fff;
}

.nge-recap-hero-daterange {
  margin-top: 4px;
  font-size: 0.82em;
  color: #9e9e9e;
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
  color: #4a9eff;
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
  font-size: 0.85em;
  color: #bbb;
  line-height: 1.55;
  font-style: italic;
}
</style>
