<script setup lang="ts">
/**
 * AchievementToast.vue
 * Celebrates milestones with animated toast notifications.
 * Watches the stats store and triggers toasts for:
 *  - Badge unlocks (edit thresholds crossed)
 *  - Streak milestones (7d, 14d, 30d, 60d, 100d)
 *  - Cell completion milestones (10, 25, 50, 100, 250, 500, 1000)
 */
import { ref, watch, onMounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useUserStatsStore, useProofreadingQueueStore } from '../store';
import { BADGE_DEFINITIONS, BadgeDefinition } from '../widgets/badge_definitions';
import { BADGE_IMAGE_MAP } from '../widgets/badge_images';
import ConfettiCelebration from 'components/ConfettiCelebration.vue';

const statsStore = useUserStatsStore();
const { stats } = storeToRefs(statsStore);
const queueStore = useProofreadingQueueStore();
const confettiRef = ref<InstanceType<typeof ConfettiCelebration> | null>(null);

/** Fire confetti with configurable palette and intensity. */
function fireConfetti(palette = 'default', intensity = 1) {
  confettiRef.value?.trigger(palette, intensity);
}

interface Toast {
  id: number;
  type: 'badge' | 'streak' | 'cells' | 'edits' | 'quest';
  title: string;
  subtitle: string;
  icon: string;        // emoji or badge image URL
  isImage: boolean;     // true = icon is an image URL
  leaving: boolean;
}

const toasts = ref<Toast[]>([]);
let toastId = 0;

function addToast(toast: Omit<Toast, 'id' | 'leaving'>) {
  const t: Toast = { ...toast, id: ++toastId, leaving: false };
  toasts.value.push(t);
  // Auto-dismiss after 5s
  setTimeout(() => dismiss(t.id), 5000);
}

function dismiss(id: number) {
  const t = toasts.value.find(x => x.id === id);
  if (t && !t.leaving) {
    t.leaving = true;
    setTimeout(() => {
      toasts.value = toasts.value.filter(x => x.id !== id);
    }, 300);
  }
}

// ── Track previous values to detect threshold crossings ──────────────────────
let prevEdits = 0;
let prevCells = 0;
let prevStreak = 0;
let initialized = false;
let statsSeenNonZero = false; // Wait for real stats from server

const STREAK_MILESTONES = [7, 14, 30, 60, 100, 200, 365];
const CELL_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

onMounted(() => {
  // Capture initial values (don't toast for existing state)
  prevEdits = stats.value.editsAllTime;
  prevCells = stats.value.cellsSubmitted;
  prevStreak = stats.value.currentStreak;
  // Wait for stats to settle — stats may load from server after mount
  setTimeout(() => { initialized = true; }, 8000);

  // Welcome sparkle — calcium-imaging shimmer on extension open
  setTimeout(() => { confettiRef.value?.sparkle(1); }, 1500);
});

// Watch for badge unlocks
watch(() => stats.value.editsAllTime, (newEdits) => {
  if (!initialized) { prevEdits = newEdits; return; }
  // First real update after init — just capture baseline, don't celebrate
  if (!statsSeenNonZero && newEdits > 0) { statsSeenNonZero = true; prevEdits = newEdits; return; }
  for (const badge of BADGE_DEFINITIONS) {
    if (badge.editThreshold <= 0) continue;
    if (prevEdits < badge.editThreshold && newEdits >= badge.editThreshold) {
      const imgUrl = BADGE_IMAGE_MAP[badge.imageKey] ?? '';
      addToast({
        type: 'badge',
        title: `Badge Unlocked: ${badge.name}`,
        subtitle: badge.description,
        icon: imgUrl || '🏅',
        isImage: !!imgUrl,
      });
      // 🎊 Confetti for badge unlocks!
      fireConfetti('purple', badge.editThreshold >= 1000 ? 2 : 1);
    }
  }
  // Edit milestones (round numbers) — confetti scales with milestone size
  const editMilestones = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];
  for (const m of editMilestones) {
    if (prevEdits < m && newEdits >= m) {
      addToast({
        type: 'edits',
        title: `${m.toLocaleString()} Edits!`,
        subtitle: 'Your contribution is shaping the connectome.',
        icon: '⚡',
        isImage: false,
      });
      // 🎊 Confetti intensity scales with milestone
      const intensity = m >= 10000 ? 3 : m >= 1000 ? 2 : 1;
      const palette = m >= 10000 ? 'rainbow' : m >= 1000 ? 'gold' : 'cyan';
      fireConfetti(palette, intensity);
    }
  }
  prevEdits = newEdits;
});

// Watch for cell milestones
watch(() => stats.value.cellsSubmitted, (newCells) => {
  if (!initialized) { prevCells = newCells; return; }
  for (const m of CELL_MILESTONES) {
    if (prevCells < m && newCells >= m) {
      addToast({
        type: 'cells',
        title: `${m} Cells Completed!`,
        subtitle: `You've proofread ${m} neurons. Incredible!`,
        icon: '🧠',
        isImage: false,
      });
      fireConfetti('default', m >= 100 ? 2 : 1);
    }
  }
  prevCells = newCells;
});

// Watch for streak milestones
watch(() => stats.value.currentStreak, (newStreak) => {
  if (!initialized) { prevStreak = newStreak; return; }
  for (const m of STREAK_MILESTONES) {
    if (prevStreak < m && newStreak >= m) {
      addToast({
        type: 'streak',
        title: `${m}-Day Streak!`,
        subtitle: `${m} days of continuous contribution.`,
        icon: '🔥',
        isImage: false,
      });
      fireConfetti('gold', m >= 30 ? 2 : 1);
    }
  }
  prevStreak = newStreak;
});

// ── Daily Quest completion celebration ──────────────────────────────────
let prevDailyDone = -1; // -1 = not yet initialized
const DAILY_QUEST_COUNT = 3;

/** Check if all 3 daily quests are proofread. */
function dailyQuestsComplete(): number {
  const total = queueStore.items.length;
  if (total === 0) return 0;
  // Replicate the daily quest selection logic from ProofreadingQueuePanel
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const seedStr = todayKey + (queueStore.sheetUrl || '');
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = ((h << 5) - h + seedStr.charCodeAt(i)) | 0;
  const seed = Math.abs(h);

  const startIdx = seed % total;
  const indices: number[] = [];
  for (let i = 0; i < total && indices.length < DAILY_QUEST_COUNT; i++) {
    const idx = (startIdx + i) % total;
    if (!queueStore.proofread.has(queueStore.items[idx].segId)) indices.push(idx);
  }
  for (let i = 0; i < total && indices.length < DAILY_QUEST_COUNT; i++) {
    const idx = (startIdx + i) % total;
    if (!indices.includes(idx)) indices.push(idx);
  }
  return indices.filter(idx => queueStore.proofread.has(queueStore.items[idx].segId)).length;
}

// Watch proofread set size changes
watch(() => queueStore.proofread.size, () => {
  if (!initialized || queueStore.items.length === 0) return;
  const done = dailyQuestsComplete();
  if (prevDailyDone < 0) { prevDailyDone = done; return; }
  if (prevDailyDone < DAILY_QUEST_COUNT && done >= DAILY_QUEST_COUNT) {
    addToast({
      type: 'quest',
      title: '🎉 Daily Quests Complete!',
      subtitle: 'All 3 quests done — you\'re a neuroscience hero!',
      icon: '🧠',
      isImage: false,
    });
    fireConfetti('rainbow', 2);
  }
  prevDailyDone = done;
});
</script>

<template>
  <ConfettiCelebration ref="confettiRef" />
  <Teleport to="body">
    <div class="nge-toast-container">
      <TransitionGroup name="nge-toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="nge-toast"
          :class="[
            `nge-toast--${toast.type}`,
            { 'nge-toast--leaving': toast.leaving },
          ]"
          @click="dismiss(toast.id)"
        >
          <!-- Sparkle particles -->
          <div class="nge-toast-particles">
            <span v-for="i in 6" :key="i" class="nge-toast-particle" :style="{ '--i': i }"></span>
          </div>

          <!-- Icon -->
          <div class="nge-toast-icon">
            <img v-if="toast.isImage" :src="toast.icon" class="nge-toast-badge-img" />
            <span v-else class="nge-toast-emoji">{{ toast.icon }}</span>
          </div>

          <!-- Text -->
          <div class="nge-toast-text">
            <div class="nge-toast-title">{{ toast.title }}</div>
            <div class="nge-toast-subtitle">{{ toast.subtitle }}</div>
          </div>

          <!-- Progress bar (auto-dismiss countdown) -->
          <div class="nge-toast-progress"></div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-toast-container {
  position: fixed;
  top: 52px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 360px;
}

/* ── Toast card ── */
.nge-toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(18, 22, 30, 0.96);
  border: 1px solid rgba(100, 180, 255, 0.2);
  border-radius: 10px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 0 40px rgba(74, 158, 255, 0.06);
  cursor: pointer;
  pointer-events: all;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(8px);
}

/* Type-specific accent */
.nge-toast--badge  { border-color: rgba(206, 147, 216, 0.3); }
.nge-toast--streak { border-color: rgba(245, 166, 35, 0.3); }
.nge-toast--cells  { border-color: rgba(76, 175, 80, 0.3); }
.nge-toast--edits  { border-color: rgba(74, 158, 255, 0.3); }
.nge-toast--quest  { border-color: rgba(0, 200, 255, 0.35); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 60px rgba(0, 200, 255, 0.12); }

/* ── Icon ── */
.nge-toast-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}
.nge-toast--badge .nge-toast-icon  { background: rgba(206, 147, 216, 0.1); }
.nge-toast--streak .nge-toast-icon { background: rgba(245, 166, 35, 0.1); }
.nge-toast--cells .nge-toast-icon  { background: rgba(76, 175, 80, 0.1); }
.nge-toast--quest .nge-toast-icon  { background: rgba(0, 200, 255, 0.12); }

.nge-toast-badge-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  filter: drop-shadow(0 0 8px rgba(206, 147, 216, 0.5));
  animation: nge-toast-badge-glow 1.5s ease-in-out infinite alternate;
}
@keyframes nge-toast-badge-glow {
  from { filter: drop-shadow(0 0 4px rgba(206, 147, 216, 0.3)); }
  to   { filter: drop-shadow(0 0 12px rgba(206, 147, 216, 0.7)); }
}

.nge-toast-emoji {
  font-size: 22px;
  line-height: 1;
  animation: nge-toast-bounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes nge-toast-bounce {
  0%   { transform: scale(0.3); opacity: 0; }
  60%  { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}

/* ── Text ── */
.nge-toast-text {
  flex: 1;
  min-width: 0;
}

.nge-toast-title {
  font-size: 13px;
  font-weight: 700;
  color: #e0e4ec;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nge-toast--badge .nge-toast-title  { color: #CE93D8; }
.nge-toast--streak .nge-toast-title { color: #f5a623; }
.nge-toast--cells .nge-toast-title  { color: #81C784; }
.nge-toast--quest .nge-toast-title  { color: #00c8ff; }

.nge-toast-subtitle {
  font-size: 11px;
  color: #666;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Progress bar (auto-dismiss) ── */
.nge-toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: rgba(74, 158, 255, 0.4);
  animation: nge-toast-countdown 5s linear forwards;
}
.nge-toast--badge .nge-toast-progress  { background: rgba(206, 147, 216, 0.4); }
.nge-toast--streak .nge-toast-progress { background: rgba(245, 166, 35, 0.4); }
.nge-toast--cells .nge-toast-progress  { background: rgba(76, 175, 80, 0.4); }
.nge-toast--quest .nge-toast-progress  { background: rgba(0, 200, 255, 0.4); }

@keyframes nge-toast-countdown {
  from { width: 100%; }
  to   { width: 0%; }
}

/* ── Sparkle particles ── */
.nge-toast-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.nge-toast-particle {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(200, 220, 255, 0.6);
  animation: nge-toast-sparkle 1.2s ease-out forwards;
  animation-delay: calc(var(--i) * 0.08s);
  left: calc(10% + var(--i) * 14%);
  top: 50%;
}
.nge-toast--badge .nge-toast-particle  { background: rgba(206, 147, 216, 0.7); }
.nge-toast--streak .nge-toast-particle { background: rgba(245, 166, 35, 0.7); }
.nge-toast--cells .nge-toast-particle  { background: rgba(129, 199, 132, 0.7); }
.nge-toast--quest .nge-toast-particle  { background: rgba(0, 200, 255, 0.7); }

@keyframes nge-toast-sparkle {
  0%   { opacity: 1; transform: translate(0, 0) scale(1); }
  50%  { opacity: 0.8; transform: translate(calc((var(--i) - 3) * 8px), -20px) scale(0.6); }
  100% { opacity: 0; transform: translate(calc((var(--i) - 3) * 14px), -35px) scale(0); }
}

/* ── Transitions ── */
.nge-toast-enter-active {
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.nge-toast-leave-active {
  transition: all 0.25s ease-in;
}
.nge-toast-enter-from {
  opacity: 0;
  transform: translateX(100px) scale(0.8);
}
.nge-toast-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.9);
}
.nge-toast-move {
  transition: transform 0.3s ease;
}
</style>
