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
import { useUserStatsStore, useProofreadingQueueStore, useProofreadingBackendStore } from '../store';
import { BUILDING_BADGES, EXPLORATION_BADGES, BadgeDefinition, statKeyForTrack } from '../widgets/badge_definitions';
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

/** Hero badge — shown centered as a big celebration */
const heroBadge = ref<Toast | null>(null);

function addToast(toast: Omit<Toast, 'id' | 'leaving'>) {
  const t: Toast = { ...toast, id: ++toastId, leaving: false };
  // Badge unlocks get hero treatment
  if (toast.type === 'badge') {
    heroBadge.value = t;
    // No auto-dismiss — stays until user clicks
    return;
  }
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

function dismissHero() {
  heroBadge.value = null;
}

function onHeroClick() {
  dismissHero();
  document.dispatchEvent(new CustomEvent('nge:open-profile'));
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
  setTimeout(() => { confettiRef.value?.sparkle(2); }, 800);

  // DEV: test hero badge from console → window.__testHeroBadge()
  (window as any).__testHeroBadge = () => {
    addToast({
      type: 'badge',
      title: 'Pyramid Builder',
      subtitle: 'You completed 100 edits on pyramidal neurons. Incredible work, scientist!',
      icon: BADGE_IMAGE_MAP[BUILDING_BADGES[4]?.imageKey] || '🏅',
      isImage: !!BADGE_IMAGE_MAP[BUILDING_BADGES[4]?.imageKey],
    });
    fireConfetti('gold', 1.5);
  };
});

// Watch for building badge unlocks (edits)
watch(() => stats.value.editsAllTime, (newEdits) => {
  if (!initialized) { prevEdits = newEdits; return; }
  // First real update after init — just capture baseline, don't celebrate
  if (!statsSeenNonZero && newEdits > 0) { statsSeenNonZero = true; prevEdits = newEdits; return; }
  for (const badge of BUILDING_BADGES) {
    if (badge.threshold <= 0) continue;
    if (prevEdits < badge.threshold && newEdits >= badge.threshold) {
      const imgUrl = BADGE_IMAGE_MAP[badge.imageKey] ?? '';
      addToast({
        type: 'badge',
        title: badge.name,
        subtitle: badge.description,
        icon: imgUrl || '🏅',
        isImage: !!imgUrl,
      });
      fireConfetti('gold', 1.5);
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
      const intensity = m >= 10000 ? 3 : m >= 1000 ? 2 : 1;
      const palette = m >= 10000 ? 'rainbow' : m >= 1000 ? 'gold' : 'cyan';
      fireConfetti(palette, intensity);
    }
  }
  prevEdits = newEdits;
});

// Watch for exploration badge unlocks + cell milestones
watch(() => stats.value.cellsSubmitted, (newCells) => {
  if (!initialized) { prevCells = newCells; return; }
  // Exploration badge unlocks
  for (const badge of EXPLORATION_BADGES) {
    if (badge.threshold <= 0) continue;
    if (prevCells < badge.threshold && newCells >= badge.threshold) {
      const imgUrl = BADGE_IMAGE_MAP[badge.imageKey] ?? '';
      addToast({
        type: 'badge',
        title: badge.name,
        subtitle: badge.description,
        icon: imgUrl || '🏅',
        isImage: !!imgUrl,
      });
      fireConfetti('gold', 1.5);
    }
  }
  // Cell milestones
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

// ── Special badge award celebration (from admin-awarded badges) ──────────────
const backend = useProofreadingBackendStore();
let prevNotifCount = -1;

watch(() => backend.notifications.length, (newLen) => {
  if (prevNotifCount < 0) { prevNotifCount = newLen; return; }
  if (newLen <= prevNotifCount) { prevNotifCount = newLen; return; }
  // Check the newest notifications for achievement awards
  const newNotifs = backend.notifications.slice(0, newLen - prevNotifCount);
  for (const notif of newNotifs) {
    if (notif.title?.includes('New Achievement')) {
      addToast({
        type: 'badge',
        title: '✨ New Achievement!',
        subtitle: notif.body || 'You earned a special award!',
        icon: notif.thumbnail_url || notif.image_url || '🏆',
        isImage: !!(notif.thumbnail_url || notif.image_url),
      });
      fireConfetti('gold', 1.5);
    }
  }
  prevNotifCount = newLen;
});

// ── Replay badge celebration when clicked from notification panel ─────────
watch(() => backend.pendingBadgeCelebration, (pending) => {
  if (!pending) return;
  addToast({
    type: 'badge',
    title: '✨ New Achievement!',
    subtitle: pending.body || 'You earned a special award!',
    icon: pending.imageUrl || '🏆',
    isImage: !!pending.imageUrl,
  });
  fireConfetti('gold', 1.5);
  backend.pendingBadgeCelebration = null;
});
</script>

<template>
  <ConfettiCelebration ref="confettiRef" />
  <Teleport to="body">
    <!-- Hero badge unlock overlay — full-screen sci-fi spectacle -->
    <Transition name="nge-hero">
      <div v-if="heroBadge" class="nge-hero-overlay" @click="onHeroClick">
        <!-- Hex grid background -->
        <div class="nge-hero-hexgrid"></div>
        <!-- Shockwave ring -->
        <div class="nge-hero-shockwave"></div>
        <!-- Vertical energy scan -->
        <div class="nge-hero-scanline"></div>

        <div class="nge-hero-card">
          <!-- Multi-layer particles -->
          <div class="nge-hero-particles">
            <span v-for="i in 40" :key="i" class="nge-hero-particle" :style="{ '--i': i }"></span>
          </div>

          <!-- Rotating holographic rings -->
          <div class="nge-hero-rings">
            <div class="nge-hero-ring nge-hero-ring--1"></div>
            <div class="nge-hero-ring nge-hero-ring--2"></div>
            <div class="nge-hero-ring nge-hero-ring--3"></div>
          </div>

          <!-- Orbital electron dots -->
          <div class="nge-hero-orbits">
            <span v-for="i in 8" :key="i" class="nge-hero-orbit-dot" :style="{ '--j': i }"></span>
          </div>

          <!-- Pulsing energy aura -->
          <div class="nge-hero-aura"></div>

          <!-- Badge icon -->
          <div class="nge-hero-icon">
            <img v-if="heroBadge.isImage" :src="heroBadge.icon" class="nge-hero-badge-img" />
            <span v-else class="nge-hero-emoji">{{ heroBadge.icon }}</span>
          </div>

          <!-- Glitch-reveal title -->
          <div class="nge-hero-title-wrap">
            <div class="nge-hero-label">ACHIEVEMENT UNLOCKED</div>
            <div class="nge-hero-title">{{ heroBadge.title }}</div>
          </div>
          <div class="nge-hero-subtitle">{{ heroBadge.subtitle }}</div>
          <div class="nge-hero-hint">Click to view profile</div>
        </div>
      </div>
    </Transition>

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
/* ══════════════════════════════════════════════════════════════════
   HERO BADGE UNLOCK — Full-screen sci-fi spectacle
   ══════════════════════════════════════════════════════════════════ */
.nge-hero-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(6, 12, 28, 0.85) 0%, rgba(0, 0, 0, 0.95) 100%);
  backdrop-filter: blur(8px) saturate(1.5);
  cursor: pointer;
  overflow: hidden;
}

/* ── Hex grid background ── */
.nge-hero-hexgrid {
  position: absolute;
  inset: -50%;
  background-image:
    linear-gradient(30deg, rgba(0, 180, 255, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(0, 180, 255, 0.03) 87.5%),
    linear-gradient(150deg, rgba(0, 180, 255, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(0, 180, 255, 0.03) 87.5%),
    linear-gradient(30deg, rgba(0, 180, 255, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(0, 180, 255, 0.03) 87.5%),
    linear-gradient(150deg, rgba(0, 180, 255, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(0, 180, 255, 0.03) 87.5%),
    linear-gradient(60deg, rgba(206, 147, 216, 0.02) 25%, transparent 25.5%, transparent 75%, rgba(206, 147, 216, 0.02) 75%),
    linear-gradient(60deg, rgba(206, 147, 216, 0.02) 25%, transparent 25.5%, transparent 75%, rgba(206, 147, 216, 0.02) 75%);
  background-size: 80px 140px;
  background-position: 0 0, 0 0, 40px 70px, 40px 70px, 0 0, 40px 70px;
  animation: nge-hero-hexdrift 20s linear infinite;
  pointer-events: none;
  opacity: 0;
  animation: nge-hero-hexdrift 20s linear infinite, nge-hero-hexfade 1s 0.3s ease-out forwards;
}
@keyframes nge-hero-hexdrift {
  from { transform: translate(0, 0) rotate(0deg); }
  to { transform: translate(-40px, -70px) rotate(1deg); }
}
@keyframes nge-hero-hexfade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ── Shockwave ring ── */
.nge-hero-shockwave {
  position: absolute;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  border: 2px solid rgba(0, 200, 255, 0.6);
  box-shadow: 0 0 40px rgba(0, 200, 255, 0.3), inset 0 0 40px rgba(0, 200, 255, 0.1);
  animation: nge-hero-shockwave 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  pointer-events: none;
}
@keyframes nge-hero-shockwave {
  0% { transform: scale(0.5); opacity: 1; border-width: 3px; }
  70% { opacity: 0.4; border-width: 1px; }
  100% { transform: scale(18); opacity: 0; border-width: 0.5px; }
}

/* ── Vertical energy scan ── */
.nge-hero-scanline {
  position: absolute;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, transparent 0%, rgba(0, 200, 255, 0.15) 20%, rgba(0, 200, 255, 0.4) 50%, rgba(0, 200, 255, 0.15) 80%, transparent 100%);
  box-shadow: 0 0 20px rgba(0, 200, 255, 0.3);
  animation: nge-hero-scan 3s ease-in-out infinite;
  pointer-events: none;
}
@keyframes nge-hero-scan {
  0% { top: -5%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: 105%; opacity: 0; }
}

/* ── Main card ── */
.nge-hero-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 56px 80px 48px;
  background: radial-gradient(ellipse at 50% 30%, rgba(0, 60, 120, 0.15) 0%, transparent 70%),
    linear-gradient(145deg, rgba(8, 12, 24, 0.97) 0%, rgba(14, 18, 32, 0.96) 50%, rgba(6, 10, 22, 0.97) 100%);
  border: 1px solid rgba(0, 180, 255, 0.15);
  border-radius: 24px;
  box-shadow:
    0 0 120px rgba(0, 160, 255, 0.15),
    0 0 300px rgba(206, 147, 216, 0.08),
    0 0 60px rgba(0, 220, 255, 0.1),
    inset 0 0 80px rgba(0, 100, 200, 0.03),
    0 32px 80px rgba(0, 0, 0, 0.8);
  position: relative;
  overflow: visible;
  z-index: 1;
  animation: nge-hero-card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes nge-hero-card-enter {
  0% { transform: scale(0.3) translateY(40px); opacity: 0; filter: brightness(3) blur(10px); }
  40% { transform: scale(1.06) translateY(-4px); filter: brightness(1.4) blur(0px); }
  70% { transform: scale(0.98) translateY(2px); }
  100% { transform: scale(1) translateY(0); opacity: 1; filter: brightness(1) blur(0); }
}

/* Animated shimmer sweep across card */
.nge-hero-card::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 24px;
  background: conic-gradient(from 0deg, transparent 0%, rgba(0, 200, 255, 0.12) 10%, transparent 20%, rgba(206, 147, 216, 0.1) 30%, transparent 40%, rgba(0, 200, 255, 0.08) 50%, transparent 60%);
  animation: nge-hero-border-spin 6s linear infinite;
  z-index: -1;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
  padding: 1px;
}
@keyframes nge-hero-border-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ── Holographic rings ── */
.nge-hero-rings {
  position: absolute;
  top: 20px;
  width: 440px;
  height: 440px;
  pointer-events: none;
}
.nge-hero-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid transparent;
}
.nge-hero-ring--1 {
  border-color: rgba(0, 200, 255, 0.2);
  animation: nge-hero-ring-spin 8s linear infinite;
  box-shadow: 0 0 15px rgba(0, 200, 255, 0.1);
}
.nge-hero-ring--2 {
  inset: 20px;
  border-color: rgba(206, 147, 216, 0.15);
  border-style: dashed;
  animation: nge-hero-ring-spin 12s linear infinite reverse;
  box-shadow: 0 0 15px rgba(206, 147, 216, 0.08);
}
.nge-hero-ring--3 {
  inset: -15px;
  border-color: rgba(0, 255, 180, 0.08);
  border-width: 0.5px;
  animation: nge-hero-ring-spin 20s linear infinite;
}
@keyframes nge-hero-ring-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ── Orbital electron dots ── */
.nge-hero-orbits {
  position: absolute;
  top: 20px;
  width: 440px;
  height: 440px;
  pointer-events: none;
}
.nge-hero-orbit-dot {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(0, 220, 255, 0.9);
  box-shadow: 0 0 8px rgba(0, 220, 255, 0.6), 0 0 20px rgba(0, 220, 255, 0.3);
  top: 50%;
  left: 50%;
  animation: nge-hero-orbit 4s linear infinite;
  animation-delay: calc(var(--j) * -0.5s);
  offset-path: ellipse(170px 160px at 50% 50%);
  offset-rotate: 0deg;
  animation-name: nge-hero-orbit-path;
}
.nge-hero-orbit-dot:nth-child(odd) {
  width: 3px;
  height: 3px;
  background: rgba(206, 180, 255, 0.8);
  box-shadow: 0 0 6px rgba(206, 180, 255, 0.5);
  animation-duration: 6s;
  animation-direction: reverse;
}
.nge-hero-orbit-dot:nth-child(3n) {
  width: 4px;
  height: 4px;
  background: rgba(0, 255, 180, 0.7);
  box-shadow: 0 0 6px rgba(0, 255, 180, 0.4);
  animation-duration: 5s;
}
/* Fallback orbit using transform for browsers without offset-path */
@keyframes nge-hero-orbit-path {
  from { offset-distance: 0%; opacity: 0.4; }
  50% { opacity: 1; }
  to { offset-distance: 100%; opacity: 0.4; }
}
/* Traditional orbit fallback */
@keyframes nge-hero-orbit {
  from { transform: rotate(calc(var(--j) * 45deg)) translateX(210px) rotate(calc(var(--j) * -45deg)); }
  to { transform: rotate(calc(var(--j) * 45deg + 360deg)) translateX(210px) rotate(calc(var(--j) * -45deg - 360deg)); }
}
/* Use traditional orbit by default (better browser support) */
.nge-hero-orbit-dot {
  offset-path: none;
  animation-name: nge-hero-orbit;
}

/* ── Energy aura ── */
.nge-hero-aura {
  position: absolute;
  top: 50px;
  width: 360px;
  height: 360px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 180, 255, 0.08) 0%, rgba(206, 147, 216, 0.04) 40%, transparent 70%);
  animation: nge-hero-aura-pulse 2.5s ease-in-out infinite;
  pointer-events: none;
}
@keyframes nge-hero-aura-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.15); opacity: 1; }
}

/* ── Badge icon ── */
.nge-hero-icon {
  width: 380px;
  height: 380px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter:
    drop-shadow(0 0 40px rgba(0, 180, 255, 0.4))
    drop-shadow(0 0 80px rgba(206, 147, 216, 0.25))
    drop-shadow(0 0 120px rgba(0, 220, 255, 0.15));
  animation: nge-hero-float 4s ease-in-out infinite alternate;
  z-index: 2;
  position: relative;
}
.nge-hero-badge-img {
  width: 360px;
  height: 360px;
  object-fit: contain;
  animation: nge-hero-badge-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes nge-hero-badge-materialize {
  0% { transform: scale(0.1) rotate(-20deg); opacity: 0; filter: brightness(4) saturate(0); }
  50% { filter: brightness(1.8) saturate(1.2); }
  80% { transform: scale(1.05) rotate(2deg); }
  100% { transform: scale(1) rotate(0deg); opacity: 1; filter: brightness(1) saturate(1); }
}
.nge-hero-emoji {
  font-size: 180px;
  animation: nge-hero-badge-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes nge-hero-float {
  from { transform: translateY(0); }
  to { transform: translateY(-12px); }
}

/* ── Title ── */
.nge-hero-title-wrap {
  text-align: center;
  z-index: 2;
  margin-top: 20px;
}
.nge-hero-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.35em;
  text-transform: uppercase;
  color: rgba(0, 200, 255, 0.7);
  margin-bottom: 8px;
  animation: nge-hero-glitch-in 0.6s 0.3s ease-out both;
}
.nge-hero-title {
  font-size: 32px;
  font-weight: 300;
  color: #fff;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  text-shadow:
    0 0 30px rgba(0, 180, 255, 0.6),
    0 0 60px rgba(0, 180, 255, 0.3),
    0 0 100px rgba(206, 147, 216, 0.15),
    0 2px 4px rgba(0, 0, 0, 0.8);
  animation: nge-hero-glitch-in 0.6s 0.5s ease-out both;
}
.nge-hero-subtitle {
  font-size: 15px;
  color: rgba(180, 200, 220, 0.7);
  text-align: center;
  max-width: 380px;
  line-height: 1.6;
  z-index: 2;
  animation: nge-hero-glitch-in 0.6s 0.7s ease-out both;
}
.nge-hero-hint {
  font-size: 11px;
  color: rgba(0, 200, 255, 0.3);
  margin-top: 8px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  z-index: 2;
  animation: nge-hero-glitch-in 0.6s 0.9s ease-out both;
}
@keyframes nge-hero-glitch-in {
  0% { opacity: 0; transform: translateY(10px); filter: blur(4px); clip-path: inset(0 100% 0 0); }
  40% { clip-path: inset(0 20% 0 0); }
  60% { clip-path: inset(0 0 0 0); filter: blur(0); }
  75% { transform: translateY(-2px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* ── Particles (40, multi-layered) ── */
.nge-hero-particles { position: absolute; inset: -40px; pointer-events: none; overflow: visible; z-index: 0; }
.nge-hero-particle {
  position: absolute;
  border-radius: 50%;
  background: rgba(0, 200, 255, 0.7);
  animation: nge-hero-sparkle-up 3s ease-out infinite;
  animation-delay: calc(var(--i) * 0.075s);
  left: calc(2% + var(--i) * 2.4%);
  bottom: -10px;
  width: 3px;
  height: 3px;
}
.nge-hero-particle:nth-child(odd) {
  background: rgba(206, 180, 255, 0.6);
  width: 2px; height: 2px;
  animation-duration: 3.5s;
}
.nge-hero-particle:nth-child(3n) {
  background: rgba(0, 255, 180, 0.5);
  width: 4px; height: 4px;
  animation-duration: 2.8s;
}
.nge-hero-particle:nth-child(4n) {
  background: rgba(255, 200, 80, 0.6);
  width: 3px; height: 3px;
  animation-duration: 4s;
}
.nge-hero-particle:nth-child(5n) {
  background: rgba(255, 100, 200, 0.5);
  width: 2px; height: 2px;
  animation-duration: 3.2s;
}
@keyframes nge-hero-sparkle-up {
  0%   { opacity: 0; transform: translateY(0) translateX(0) scale(0.5); }
  15%  { opacity: 1; transform: translateY(-40px) translateX(calc((var(--i) - 20) * 1.5px)) scale(1); }
  60%  { opacity: 0.7; transform: translateY(-200px) translateX(calc((var(--i) - 20) * 4px)) scale(0.8); }
  100% { opacity: 0; transform: translateY(-400px) translateX(calc((var(--i) - 20) * 6px)) scale(0); }
}

/* ── Transitions ── */
.nge-hero-enter-active { transition: opacity 0.3s ease-out; }
.nge-hero-leave-active { transition: all 0.5s ease-in; }
.nge-hero-enter-from { opacity: 0; }
.nge-hero-leave-to { opacity: 0; }
.nge-hero-leave-to .nge-hero-card { transform: scale(0.8) translateY(20px); opacity: 0; filter: brightness(2) blur(6px); }
.nge-hero-leave-to .nge-hero-shockwave { display: none; }

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
