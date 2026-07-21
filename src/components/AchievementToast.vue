<script setup lang="ts">
/**
 * AchievementToast.vue
 * Celebrates milestones with animated toast notifications.
 * Watches the stats store and triggers toasts for:
 *  - Badge unlocks (edit thresholds crossed)
 *  - Streak milestones (7d, 14d, 30d, 60d, 100d)
 *
 * Cell-completion milestone toasts (10/25/50…) were removed — those moments
 * are now covered by the proper exploration-badge hero popup.
 */
import { ref, watch, onMounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useUserStatsStore, useProofreadingQueueStore, useProofreadingBackendStore } from '../store';
import { BUILDING_BADGES, EXPLORATION_BADGES, BadgeDefinition, statKeyForTrack } from '../widgets/badge_definitions';
import { BADGE_IMAGE_MAP } from '../widgets/badge_images';
import ConfettiCelebration from 'components/ConfettiCelebration.vue';
import pyrIcon from '../../static/badges/pyr/pyr-icon.png';

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
// Each stat needs its own "seen the real server value yet?" flag. Without this,
// when stats load from Supabase AFTER the `initialized` timer flips, the watcher
// sees 0 → realValue and treats already-earned badges as fresh unlocks (which
// caused the Astrolabe popup on every incognito load).
let prevEdits = 0;
let prevCells = 0;
let prevStreak = 0;
let initialized = false;
let editsSeenReal = false;
let cellsSeenReal = false;
let streakSeenReal = false;

const STREAK_MILESTONES = [7, 14, 30, 60, 100, 200, 365];

// ── Idempotent badge awards ──────────────────────────────────────────────────
// A badge must toast at most once, ever. Without a persistent record the
// threshold-crossing watcher re-fires whenever cellsSubmitted/editsAllTime
// bounces across a threshold — e.g. Supabase reloading a slightly-stale value,
// or the browse-time edit heuristic bumping the counter — which produced the
// repeated "Abacus" popups in Pinky Sandbox. We remember earned badge ids in
// localStorage and skip anything already granted.
const AWARDED_BADGES_KEY = 'nge_awarded_badges_v1';
const awardedBadges = new Set<string>(loadAwardedBadges());
function loadAwardedBadges(): string[] {
  try {
    const raw = localStorage.getItem(AWARDED_BADGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
/** Returns true if this is the first time we've seen this badge (and records
 *  it). Returns false if it was already awarded before. */
function claimBadgeOnce(id: string): boolean {
  if (awardedBadges.has(id)) return false;
  awardedBadges.add(id);
  try { localStorage.setItem(AWARDED_BADGES_KEY, JSON.stringify([...awardedBadges])); } catch { /* quota — non-critical */ }
  return true;
}

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
  if (!editsSeenReal && newEdits > 0) { editsSeenReal = true; prevEdits = newEdits; return; }
  for (const badge of BUILDING_BADGES) {
    if (badge.threshold <= 0) continue;
    if (prevEdits < badge.threshold && newEdits >= badge.threshold) {
      if (!claimBadgeOnce(badge.id != null ? `b:${badge.id}` : `b:${badge.slug}`)) continue;
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
  // First real update from Supabase — just capture baseline, don't celebrate
  // already-earned badges. Fixes phantom Astrolabe popup on every incognito load.
  if (!cellsSeenReal && newCells > 0) { cellsSeenReal = true; prevCells = newCells; return; }
  // Exploration badge unlocks
  for (const badge of EXPLORATION_BADGES) {
    if (badge.threshold <= 0) continue;
    if (prevCells < badge.threshold && newCells >= badge.threshold) {
      if (!claimBadgeOnce(badge.id != null ? `e:${badge.id}` : `e:${badge.slug}`)) continue;
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
  // Cell-completion milestone toasts removed — exploration badge hero popup
  // covers these moments now.
  prevCells = newCells;
});

// Watch for streak milestones
watch(() => stats.value.currentStreak, (newStreak) => {
  if (!initialized) { prevStreak = newStreak; return; }
  if (!streakSeenReal && newStreak > 0) { streakSeenReal = true; prevStreak = newStreak; return; }
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

/** Parse badge name and description from notification body like:
 *  'You earned the "Alpha Tester" award! — Only the elite are invited...' */
function parseBadgeBody(body: string): { name: string; description: string } {
  const nameMatch = body.match(/"([^"]+)"/);
  const name = nameMatch ? nameMatch[1] : 'New Achievement';
  // Description is after " — " or after "award!"
  const descMatch = body.match(/(?:award!?\s*(?:—\s*)?)(.*)/);
  const description = descMatch?.[1]?.trim() || body;
  return { name, description };
}

// One award reaches BOTH watchers below: the realtime handler sets
// pendingBadgeCelebration AND calls loadNotifications(), which grows the list.
// Without dedup that's two toasts + two confetti bursts per badge. Gate both on
// a short window keyed by the badge title so a single award celebrates once,
// while a genuine re-earn or a deliberate replay-on-click later still fires.
const recentCelebrations = new Map<string, number>();
function claimCelebration(key: string): boolean {
  const now = Date.now();
  const last = recentCelebrations.get(key) ?? 0;
  if (now - last < 6000) return false;
  recentCelebrations.set(key, now);
  return true;
}

watch(() => backend.notifications.length, (newLen) => {
  if (prevNotifCount < 0) { prevNotifCount = newLen; return; }
  if (newLen <= prevNotifCount) { prevNotifCount = newLen; return; }
  // Check the newest notifications for achievement awards
  const newNotifs = backend.notifications.slice(0, newLen - prevNotifCount);
  for (const notif of newNotifs) {
    if (notif.title?.includes('New Achievement')) {
      if (!claimCelebration(notif.title)) continue;
      const { name, description } = parseBadgeBody(notif.body || '');
      addToast({
        type: 'badge',
        title: name,
        subtitle: description,
        icon: notif.image_url || notif.thumbnail_url || '🏆',
        isImage: !!(notif.image_url || notif.thumbnail_url),
      });
      fireConfetti('gold', 1.5);
    }
  }
  prevNotifCount = newLen;
});

// ── Replay badge celebration when clicked from notification panel ─────────
watch(() => backend.pendingBadgeCelebration, (pending) => {
  if (!pending) return;
  backend.pendingBadgeCelebration = null;
  // Same dedup as the notifications watcher: if the realtime path already
  // celebrated this award moments ago, don't double it.
  if (pending.title && !claimCelebration(pending.title)) return;
  const { name, description } = parseBadgeBody(pending.body || '');
  addToast({
    type: 'badge',
    title: name,
    subtitle: description,
    icon: pending.imageUrl || '🏆',
    isImage: !!pending.imageUrl,
  });
  fireConfetti('gold', 1.5);
});

// ── Cell completion celebration ──
const cellCelebration = ref<{ totalCells: number; imageUrl: string; batchCount?: number } | null>(null);

watch(() => backend.pendingCellCelebration, (pending) => {
  if (!pending) return;
  cellCelebration.value = { ...pending };
  backend.pendingCellCelebration = null;
  // Batch completions get the hero treatment: cascading confetti bursts
  // (cyan → gold → magenta → cyan) and a longer dwell so the user can take
  // it in. Single-cell stays as the original quick cyan pop.
  if (pending.batchCount && pending.batchCount > 1) {
    fireConfetti('cyan', 2.2);
    setTimeout(() => fireConfetti('gold', 2.0), 500);
    setTimeout(() => fireConfetti('cyan', 1.6), 1100);
    setTimeout(() => fireConfetti('gold', 1.4), 1800);
    playBatchChime();
    // No auto-dismiss for the batch hero — user must click X or outside the
    // card. Weeks of work deserve as long a stare as they want.
  } else {
    fireConfetti('cyan', 2);
    setTimeout(() => { cellCelebration.value = null; }, 6000);
  }
});

function dismissCellCelebration() {
  cellCelebration.value = null;
}

/**
 * Asgardian batch chime — procedural synth via Web Audio API. No asset files.
 * Layers a low boom (Bifrost rumble) + bell chord (C4-G4-C5 with stagger)
 * + high shimmer sparkle. ~2.5s total. Plays once when a batch celebration
 * fires; needs a prior user gesture to satisfy autoplay policy (we get one
 * via the wizard submit click).
 */
function playBatchChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);

    // Low boom — the cosmic impact
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(80, t0);
    boom.frequency.exponentialRampToValueAtTime(35, t0 + 0.9);
    boomGain.gain.setValueAtTime(0.0001, t0);
    boomGain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.05);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
    boom.connect(boomGain).connect(master);
    boom.start(t0);
    boom.stop(t0 + 1.5);

    // Bell chord — C4 + G4 + C5 with stagger for a chime arpeggio feel
    const chord = [261.63, 392.00, 523.25];
    chord.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = t0 + i * 0.08;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0005, start + 2.6);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 2.7);
      // Octave overtone for crystal sparkle
      const oct = ctx.createOscillator();
      const octGain = ctx.createGain();
      oct.type = 'triangle';
      oct.frequency.value = f * 2;
      octGain.gain.setValueAtTime(0.0001, start);
      octGain.gain.exponentialRampToValueAtTime(0.06, start + 0.025);
      octGain.gain.exponentialRampToValueAtTime(0.0005, start + 1.8);
      oct.connect(octGain).connect(master);
      oct.start(start);
      oct.stop(start + 2.0);
    });

    // High shimmer — fast frequency sweep up
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'triangle';
    shimmer.frequency.setValueAtTime(2200, t0 + 0.35);
    shimmer.frequency.exponentialRampToValueAtTime(4200, t0 + 1.4);
    shimmerGain.gain.setValueAtTime(0.0001, t0 + 0.35);
    shimmerGain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.45);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0005, t0 + 2.0);
    shimmer.connect(shimmerGain).connect(master);
    shimmer.start(t0 + 0.35);
    shimmer.stop(t0 + 2.0);

    // Close the AudioContext after the sound finishes so we don't leak.
    setTimeout(() => { ctx.close().catch(() => {}); }, 3000);
  } catch (e) {
    console.warn('[batch] chime failed:', e);
  }
}
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
            <span v-for="i in 20" :key="i" class="nge-hero-particle" :style="{ '--i': i }"></span>
          </div>

          <!-- Rotating holographic rings -->
          <div class="nge-hero-rings">
            <div class="nge-hero-ring nge-hero-ring--1"></div>
            <div class="nge-hero-ring nge-hero-ring--2"></div>
            <div class="nge-hero-ring nge-hero-ring--3"></div>
          </div>

          <!-- Orbital electron dots -->
          <div class="nge-hero-orbits">
            <span v-for="i in 5" :key="i" class="nge-hero-orbit-dot" :style="{ '--j': i }"></span>
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

    <!-- Single-cell celebration overlay (compact) -->
    <Transition name="nge-cell-celebrate">
      <div v-if="cellCelebration && (!cellCelebration.batchCount || cellCelebration.batchCount <= 1)" class="nge-cell-overlay" @click="dismissCellCelebration">
        <div class="nge-cell-card">
          <img v-if="cellCelebration.imageUrl" :src="cellCelebration.imageUrl" class="nge-cell-nurro" />
          <div class="nge-cell-text">
            <div class="nge-cell-congrats">Congratulations, Cell Complete!</div>
            <div class="nge-cell-thanks">Thank you for helping to map the brain. For science!</div>
            <div class="nge-cell-stats">+1 cell brings your total to <strong>{{ cellCelebration.totalCells }}</strong></div>
          </div>
          <div class="nge-cell-hint">Click to dismiss</div>
        </div>
      </div>
    </Transition>

    <!-- Batch celebration overlay — Asgardian hero treatment -->
    <Transition name="nge-batch-celebrate">
      <div v-if="cellCelebration && cellCelebration.batchCount && cellCelebration.batchCount > 1" class="nge-batch-overlay" @click="dismissCellCelebration">
        <div class="nge-batch-vignette"></div>
        <div class="nge-batch-hexgrid"></div>
        <div class="nge-batch-rays">
          <div v-for="i in 8" :key="i" class="nge-batch-ray" :style="{ '--i': i - 1 }"></div>
        </div>
        <div class="nge-batch-shockwave"></div>
        <div class="nge-batch-shockwave nge-batch-shockwave--2"></div>
        <!-- Background dust — particles rise with organic noise (wandering side-to-side). -->
        <div class="nge-batch-particles">
          <span v-for="i in 50" :key="i" class="nge-batch-particle" :style="{ '--i': i }"></span>
        </div>
        <div class="nge-batch-card" @click.stop>
          <button class="nge-batch-close" @click="dismissCellCelebration" aria-label="Dismiss">×</button>
          <span class="nge-batch-corner nge-batch-corner--tl"></span>
          <span class="nge-batch-corner nge-batch-corner--tr"></span>
          <span class="nge-batch-corner nge-batch-corner--bl"></span>
          <span class="nge-batch-corner nge-batch-corner--br"></span>
          <div class="nge-batch-aura"></div>
          <!-- Halo cloud — 60 particles in 3 concentric bands at varying radii.
               Replaces the previous solid rotating rings with something softer and gaseous. -->
          <div class="nge-batch-halo">
            <span v-for="i in 72" :key="i" class="nge-batch-halo-particle" :style="{ '--i': i - 1 }"></span>
          </div>
          <div class="nge-batch-scanline"></div>

          <div class="nge-batch-pyr-wrap">
            <img :src="pyrIcon" class="nge-batch-pyr" alt="Pyr" />
            <!-- Orbital particles around the Pyr icon — replaces the Norse runes
                 with something more elegant: 24 small dots in 3 orbital bands at
                 different speeds, like electrons / planets. -->
            <div class="nge-batch-orbits">
              <span v-for="i in 24" :key="i" class="nge-batch-orbit" :style="{ '--i': i - 1 }"></span>
            </div>
          </div>

          <div class="nge-batch-label">CELLS COMPLETE</div>
          <div class="nge-batch-count">+{{ cellCelebration.batchCount }}</div>
          <div class="nge-batch-cells-text">cells added to the connectome</div>
          <div class="nge-batch-divider"></div>
          <div class="nge-batch-total-label">YOUR TOTAL</div>
          <div class="nge-batch-total">{{ cellCelebration.totalCells }}</div>
          <div class="nge-batch-total-sub">cells mapped</div>
          <div class="nge-batch-thanks">Thank you for mapping the brain!</div>
          <div class="nge-batch-rally">FOR SCIENCE!</div>
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
  will-change: opacity;
  transform: translateZ(0);
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
  will-change: transform, opacity;
  transform: translateZ(0);
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
  will-change: transform;
  transform: translateZ(0);
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
  image-rendering: auto;
  animation: nge-hero-badge-materialize 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  will-change: transform, opacity;
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

/* ═══ Cell Completion Celebration ═══ */
.nge-cell-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 8, 20, 0.85);
  backdrop-filter: blur(8px);
  cursor: pointer;
}
.nge-cell-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 500px;
  padding: 40px 50px;
  animation: nge-cell-float 3s ease-in-out infinite alternate;
}
.nge-cell-nurro {
  width: 200px;
  height: 200px;
  object-fit: contain;
  margin-bottom: 24px;
  filter: drop-shadow(0 0 20px rgba(0, 200, 255, 0.3));
  animation: nge-cell-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.nge-cell-text {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nge-cell-congrats {
  font-family: 'Orbitron', 'Rajdhani', 'Audiowide', monospace;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: linear-gradient(135deg, #a0ffd4 0%, #00dca0 40%, #58a6ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: nge-cell-title-in 0.5s ease-out 0.3s both;
}
.nge-cell-thanks {
  font-size: 15px;
  color: #99aabb;
  font-style: italic;
  line-height: 1.5;
  animation: nge-cell-fade-in 0.4s ease-out 0.6s both;
}
.nge-cell-stats {
  font-size: 16px;
  color: #e0ecff;
  margin-top: 6px;
  font-family: 'Orbitron', monospace;
  letter-spacing: 0.04em;
  animation: nge-cell-fade-in 0.4s ease-out 0.9s both;
}
.nge-cell-stats strong {
  font-size: 22px;
  color: #00dca0;
  text-shadow: 0 0 10px rgba(0, 220, 160, 0.4);
}
.nge-cell-hint {
  margin-top: 28px;
  font-size: 11px;
  color: #556;
  letter-spacing: 0.1em;
  animation: nge-cell-fade-in 0.4s ease-out 1.2s both;
}

@keyframes nge-cell-bounce {
  0% { transform: scale(0.3) translateY(40px); opacity: 0; }
  60% { transform: scale(1.1) translateY(-8px); opacity: 1; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes nge-cell-title-in {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes nge-cell-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
@keyframes nge-cell-float {
  from { transform: translateY(0); }
  to { transform: translateY(-6px); }
}

/* Transition */
.nge-cell-celebrate-enter-active { transition: opacity 0.4s ease-out; }
.nge-cell-celebrate-leave-active { transition: opacity 0.5s ease-in; }
.nge-cell-celebrate-enter-from, .nge-cell-celebrate-leave-to { opacity: 0; }

/* ─────────────────────────────────────────────────────────────────────
   Batch celebration overlay — hero treatment for users who've spent
   weeks tracing cells. Big count, total card, rotating rings, particles.
   ───────────────────────────────────────────────────────────────────── */
.nge-batch-overlay {
  position: fixed;
  inset: 0;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: radial-gradient(ellipse at center, rgba(20, 30, 60, 0.88) 0%, rgba(0, 0, 0, 0.96) 100%);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  overflow: hidden;
}
.nge-batch-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.5) 100%);
  pointer-events: none;
}

/* Floating particles — wander side-to-side as they rise (organic noise, like
   dust in a sunbeam). Each particle has its own drift amplitude and direction
   so the field never looks regimented. */
.nge-batch-particles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.nge-batch-particle {
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(120, 200, 255, 0.8);
  box-shadow: 0 0 8px rgba(120, 200, 255, 0.85);
  bottom: -10px;
  left: calc((var(--i) - 1) * 2% + 1%);
  --drift: 1;
  animation: nge-batch-particle-rise calc(11s + var(--i) * 0.15s) ease-in-out infinite;
  animation-delay: calc(var(--i) * -0.4s);
  filter: blur(0.3px);
}
.nge-batch-particle:nth-child(3n)  { background: rgba(255, 200, 80, 0.78); box-shadow: 0 0 9px rgba(255, 200, 80, 0.85); }
.nge-batch-particle:nth-child(7n)  { background: rgba(180, 230, 255, 0.7); box-shadow: 0 0 8px rgba(180, 230, 255, 0.7); }
.nge-batch-particle:nth-child(11n) { background: rgba(255, 240, 200, 0.85); box-shadow: 0 0 12px rgba(255, 240, 200, 0.9); }
.nge-batch-particle:nth-child(2n)  { width: 1px; height: 1px; }
.nge-batch-particle:nth-child(5n)  { width: 3px; height: 3px; }
.nge-batch-particle:nth-child(13n) { width: 4px; height: 4px; filter: blur(0.6px); }
/* Stagger drift amplitudes so motion looks Brownian, not mechanical. */
.nge-batch-particle:nth-child(4n)   { --drift: 1.4; }
.nge-batch-particle:nth-child(4n+1) { --drift: 0.7; }
.nge-batch-particle:nth-child(4n+2) { --drift: 1.0; }
.nge-batch-particle:nth-child(4n+3) { --drift: -1.2; } /* negative flips the wave direction */
@keyframes nge-batch-particle-rise {
  0%   { transform: translateY(0)     translateX(0); opacity: 0; }
  6%   { opacity: 1; }
  16%  { transform: translateY(-15vh) translateX(calc(var(--drift) * 22px)); }
  30%  { transform: translateY(-30vh) translateX(calc(var(--drift) * -28px)); }
  44%  { transform: translateY(-45vh) translateX(calc(var(--drift) * 32px)); }
  58%  { transform: translateY(-60vh) translateX(calc(var(--drift) * -22px)); }
  72%  { transform: translateY(-75vh) translateX(calc(var(--drift) * 26px)); }
  86%  { transform: translateY(-90vh) translateX(calc(var(--drift) * -18px)); opacity: 1; }
  100% { transform: translateY(-110vh) translateX(0); opacity: 0; }
}

/* Card */
.nge-batch-card {
  position: relative;
  background: linear-gradient(135deg, rgba(40, 50, 80, 0.92), rgba(20, 25, 50, 0.96));
  border: 1px solid rgba(120, 200, 255, 0.32);
  border-radius: 24px;
  padding: 50px 70px 36px;
  text-align: center;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', sans-serif;
  color: #cce;
  box-shadow:
    0 0 80px rgba(74, 158, 255, 0.42),
    0 0 160px rgba(74, 158, 255, 0.18),
    0 20px 60px rgba(0,0,0,0.6);
  min-width: 380px;
  max-width: 90vw;
  z-index: 2;
  animation: nge-batch-card-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes nge-batch-card-in {
  0%   { opacity: 0; transform: scale(0.78) translateY(50px); filter: blur(8px); }
  60%  { filter: blur(0); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* Pulsing aura behind the card */
.nge-batch-aura {
  position: absolute;
  inset: -100px;
  background: radial-gradient(ellipse at center, rgba(74, 158, 255, 0.18) 0%, transparent 60%);
  pointer-events: none;
  animation: nge-batch-aura-pulse 3s ease-in-out infinite;
  z-index: -1;
}
@keyframes nge-batch-aura-pulse {
  0%, 100% { opacity: 0.55; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.12); }
}

/* Halo cloud around the card — replaces the previous solid rings with 72
   particles in 3 concentric bands (with intra-band radial scatter so it reads
   as a gaseous cloud, not perfect circles). Different per-band rotation
   speeds create depth/parallax. */
.nge-batch-halo {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
}
.nge-batch-halo-particle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  --halo-r: 240px;
  animation: nge-batch-halo-spin var(--halo-speed, 36s) linear infinite;
  animation-delay: calc(var(--i) * -0.18s);
  filter: blur(0.4px);
}
/* Three bands, three speeds — slow outermost reads as deep background */
.nge-batch-halo-particle:nth-child(3n)   { --halo-speed: 28s; background: rgba(120, 200, 255, 0.6);  box-shadow: 0 0 5px rgba(120, 200, 255, 0.75); }
.nge-batch-halo-particle:nth-child(3n+1) { --halo-speed: 44s; background: rgba(255, 210, 110, 0.55); box-shadow: 0 0 5px rgba(255, 200, 100, 0.7); }
.nge-batch-halo-particle:nth-child(3n+2) { --halo-speed: 62s; background: rgba(180, 230, 255, 0.45); box-shadow: 0 0 5px rgba(180, 230, 255, 0.55); }
/* Radial scatter within each band so it's a cloud, not a ring */
.nge-batch-halo-particle:nth-child(9n)   { --halo-r: 215px; }
.nge-batch-halo-particle:nth-child(9n+1) { --halo-r: 232px; }
.nge-batch-halo-particle:nth-child(9n+2) { --halo-r: 248px; }
.nge-batch-halo-particle:nth-child(9n+3) { --halo-r: 268px; }
.nge-batch-halo-particle:nth-child(9n+4) { --halo-r: 286px; }
.nge-batch-halo-particle:nth-child(9n+5) { --halo-r: 304px; }
.nge-batch-halo-particle:nth-child(9n+6) { --halo-r: 322px; }
.nge-batch-halo-particle:nth-child(9n+7) { --halo-r: 348px; }
.nge-batch-halo-particle:nth-child(9n+8) { --halo-r: 376px; }
/* Size variation */
.nge-batch-halo-particle:nth-child(5n)   { width: 1px; height: 1px; }
.nge-batch-halo-particle:nth-child(7n)   { width: 3px; height: 3px; filter: blur(0.6px); }
.nge-batch-halo-particle:nth-child(13n)  { width: 4px; height: 4px; filter: blur(0.8px); opacity: 0.85; }
@keyframes nge-batch-halo-spin {
  0%   { transform: translate(-50%, -50%) rotate(0deg)   translateY(var(--halo-r)); }
  100% { transform: translate(-50%, -50%) rotate(360deg) translateY(var(--halo-r)); }
}

/* Pyr icon — central anchor of the celebration. Pulses gently with a soft
   cyan halo. Replaces the random-pick nurro avatar. */
.nge-batch-pyr-wrap {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 0 auto 18px;
}
.nge-batch-pyr {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 88px;
  height: 88px;
  transform: translate(-50%, -50%);
  object-fit: contain;
  filter:
    drop-shadow(0 0 20px rgba(120, 200, 255, 0.85))
    drop-shadow(0 0 40px rgba(74, 158, 255, 0.5));
  animation: nge-batch-pyr-pulse 3.2s ease-in-out infinite;
  z-index: 2;
}
@keyframes nge-batch-pyr-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1);    filter: drop-shadow(0 0 20px rgba(120, 200, 255, 0.85)) drop-shadow(0 0 40px rgba(74, 158, 255, 0.5)); }
  50%      { transform: translate(-50%, -50%) scale(1.04); filter: drop-shadow(0 0 32px rgba(120, 200, 255, 1))    drop-shadow(0 0 60px rgba(74, 158, 255, 0.7)); }
}

/* Orbital particles around the Pyr icon — replaces the Norse runes.
   24 particles in 3 orbital bands (8 per band) at different speeds.
   Mix of cyan and gold. Each particle has its own --i for phase offset. */
.nge-batch-orbits {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}
.nge-batch-orbit {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  --orbit-r: 60px;
  animation: nge-batch-orbit-spin var(--orbit-speed, 8s) linear infinite;
  animation-delay: calc(var(--i) * -0.35s);
  filter: blur(0.2px);
}
.nge-batch-orbit:nth-child(3n)   { --orbit-r: 56px; --orbit-speed: 6.5s;  background: rgba(120, 200, 255, 0.95); box-shadow: 0 0 8px rgba(120, 200, 255, 1); }
.nge-batch-orbit:nth-child(3n+1) { --orbit-r: 76px; --orbit-speed: 11s;   background: rgba(255, 215, 120, 0.9);  box-shadow: 0 0 8px rgba(255, 200, 100, 0.95); }
.nge-batch-orbit:nth-child(3n+2) { --orbit-r: 94px; --orbit-speed: 17s;   background: rgba(180, 230, 255, 0.85); box-shadow: 0 0 9px rgba(180, 230, 255, 0.85); }
/* Counter-rotate every other to add visual interest (like opposing orbits) */
.nge-batch-orbit:nth-child(2n)   { animation-direction: reverse; }
.nge-batch-orbit:nth-child(7n)   { width: 4px; height: 4px; }
.nge-batch-orbit:nth-child(11n)  { width: 2px; height: 2px; opacity: 0.75; }
@keyframes nge-batch-orbit-spin {
  0%   { transform: translate(-50%, -50%) rotate(0deg)   translateY(var(--orbit-r)); }
  100% { transform: translate(-50%, -50%) rotate(360deg) translateY(var(--orbit-r)); }
}

/* Cyan-themed count */
.nge-batch-label {
  font-size: 0.7em;
  letter-spacing: 0.45em;
  color: rgba(120, 200, 255, 0.85);
  text-transform: uppercase;
  margin-bottom: 8px;
  font-weight: 700;
}
.nge-batch-count {
  font-size: 5.5em;
  font-weight: 900;
  letter-spacing: -0.02em;
  background: linear-gradient(180deg, #aef 0%, #4af 55%, #28b 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  filter: drop-shadow(0 0 28px rgba(74, 158, 255, 0.7));
  line-height: 1;
  animation: nge-batch-count-in 0.9s 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
}
@keyframes nge-batch-count-in {
  0%   { opacity: 0; transform: scale(0.3) rotate(-8deg); }
  60%  { transform: scale(1.18) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(0); }
}
.nge-batch-cells-text {
  font-size: 0.88em;
  color: #aab;
  margin-top: 10px;
  margin-bottom: 8px;
  letter-spacing: 0.05em;
}

/* Divider between count and total */
.nge-batch-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(120, 200, 255, 0.45), transparent);
  margin: 22px 0 18px;
}

/* Gold-themed total */
.nge-batch-total-label {
  font-size: 0.65em;
  letter-spacing: 0.45em;
  color: rgba(255, 200, 80, 0.82);
  text-transform: uppercase;
  font-weight: 700;
  margin-bottom: 6px;
}
.nge-batch-total {
  font-size: 3.6em;
  font-weight: 800;
  background: linear-gradient(180deg, #fea 0%, #fc4 55%, #b80 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  filter: drop-shadow(0 0 18px rgba(255, 200, 80, 0.55));
  line-height: 1;
  animation: nge-batch-count-in 0.9s 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
}
.nge-batch-total-sub {
  font-size: 0.82em;
  color: #889;
  margin-top: 6px;
  letter-spacing: 0.05em;
}

.nge-batch-thanks {
  font-size: 0.92em;
  color: #aab;
  margin-top: 28px;
  font-style: italic;
}
.nge-batch-rally {
  font-size: 1.1em;
  font-weight: 800;
  letter-spacing: 0.32em;
  color: rgba(255, 220, 130, 0.95);
  text-shadow: 0 0 14px rgba(255, 200, 80, 0.7), 0 0 28px rgba(255, 180, 60, 0.4);
  margin-top: 8px;
  text-transform: uppercase;
  /* Pad-right matches the letter-spacing so the text stays centered */
  padding-right: 0.32em;
}
.nge-batch-hint {
  font-size: 0.72em;
  color: #667;
  margin-top: 14px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

/* Transition */
.nge-batch-celebrate-enter-active { transition: opacity 0.5s ease-out; }
.nge-batch-celebrate-leave-active { transition: opacity 0.6s ease-in; }
.nge-batch-celebrate-enter-from, .nge-batch-celebrate-leave-to { opacity: 0; }

/* ── Asgardian additions ───────────────────────────────────────── */

/* Hexagonal background grid — slow drift, low opacity */
.nge-batch-hexgrid {
  position: absolute;
  inset: -50px;
  pointer-events: none;
  background-image:
    linear-gradient(60deg, transparent 49.5%, rgba(120, 200, 255, 0.06) 49.5%, rgba(120, 200, 255, 0.06) 50.5%, transparent 50.5%),
    linear-gradient(-60deg, transparent 49.5%, rgba(120, 200, 255, 0.06) 49.5%, rgba(120, 200, 255, 0.06) 50.5%, transparent 50.5%),
    linear-gradient(0deg, transparent 49.5%, rgba(120, 200, 255, 0.06) 49.5%, rgba(120, 200, 255, 0.06) 50.5%, transparent 50.5%);
  background-size: 60px 104px;
  animation: nge-batch-hex-drift 40s linear infinite;
  mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
}
@keyframes nge-batch-hex-drift {
  0%   { background-position: 0 0, 0 0, 0 0; }
  100% { background-position: 60px 104px, -60px 104px, 0 104px; }
}

/* Prismatic rays radiating from center — Bifrost feel, gold/cyan dominant */
.nge-batch-rays {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nge-batch-ray {
  position: absolute;
  width: 2px;
  height: 140vh;
  top: 50%;
  left: 50%;
  transform-origin: center;
  transform: translate(-50%, -50%) rotate(calc(var(--i) * 45deg));
  background: linear-gradient(to bottom, transparent 0%, var(--ray-color, rgba(255, 200, 80, 0.5)) 50%, transparent 100%);
  filter: blur(0.5px);
  opacity: 0;
  animation: nge-batch-ray-pulse 7s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.35s);
}
.nge-batch-ray:nth-child(odd)  { --ray-color: rgba(255, 200, 80, 0.55); }
.nge-batch-ray:nth-child(even) { --ray-color: rgba(120, 200, 255, 0.5); }
.nge-batch-ray:nth-child(3) { --ray-color: rgba(255, 230, 180, 0.6); }
.nge-batch-ray:nth-child(7) { --ray-color: rgba(180, 230, 255, 0.55); }
@keyframes nge-batch-ray-pulse {
  0%, 100% { opacity: 0; }
  40%, 60% { opacity: 0.5; }
}

/* Shockwave — single expanding ring on entry */
.nge-batch-shockwave {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100px;
  height: 100px;
  border: 2px solid rgba(120, 200, 255, 0.8);
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0);
  pointer-events: none;
  animation: nge-batch-shockwave-fire 1.4s ease-out 0.1s 1 forwards;
  box-shadow: 0 0 40px rgba(120, 200, 255, 0.6);
}
.nge-batch-shockwave--2 {
  border-color: rgba(255, 200, 80, 0.7);
  box-shadow: 0 0 40px rgba(255, 200, 80, 0.5);
  animation-delay: 0.4s;
  animation-duration: 1.6s;
}
@keyframes nge-batch-shockwave-fire {
  0%   { transform: translate(-50%, -50%) scale(0);  opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(20); opacity: 0; }
}

/* Card border ornaments — Asgardian gold corner brackets */
.nge-batch-corner {
  position: absolute;
  width: 28px;
  height: 28px;
  pointer-events: none;
}
.nge-batch-corner::before, .nge-batch-corner::after {
  content: '';
  position: absolute;
  background: linear-gradient(135deg, rgba(255, 220, 130, 0.95), rgba(255, 180, 60, 0.6));
  box-shadow: 0 0 8px rgba(255, 200, 80, 0.6);
}
.nge-batch-corner::before { width: 28px; height: 2px; }
.nge-batch-corner::after  { width: 2px;  height: 28px; }
.nge-batch-corner--tl { top: -1px; left: -1px; }
.nge-batch-corner--tl::before { top: 0;   left: 0; }
.nge-batch-corner--tl::after  { top: 0;   left: 0; }
.nge-batch-corner--tr { top: -1px; right: -1px; }
.nge-batch-corner--tr::before { top: 0;   right: 0; }
.nge-batch-corner--tr::after  { top: 0;   right: 0; }
.nge-batch-corner--bl { bottom: -1px; left: -1px; }
.nge-batch-corner--bl::before { bottom: 0; left: 0; }
.nge-batch-corner--bl::after  { bottom: 0; left: 0; }
.nge-batch-corner--br { bottom: -1px; right: -1px; }
.nge-batch-corner--br::before { bottom: 0; right: 0; }
.nge-batch-corner--br::after  { bottom: 0; right: 0; }

/* Vertical scanline that sweeps across the card once on entry */
.nge-batch-scanline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom,
    transparent 0%,
    rgba(120, 200, 255, 0.9) 30%,
    rgba(255, 230, 180, 1) 50%,
    rgba(120, 200, 255, 0.9) 70%,
    transparent 100%);
  box-shadow: 0 0 12px rgba(120, 200, 255, 0.8), 0 0 24px rgba(120, 200, 255, 0.4);
  left: -10px;
  pointer-events: none;
  animation: nge-batch-scanline-sweep 1.8s ease-out 0.4s 1 forwards;
  opacity: 0;
}
@keyframes nge-batch-scanline-sweep {
  0%   { left: -10px; opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { left: calc(100% + 10px); opacity: 0; }
}

/* X close button — gold accent, subtle until hover */
.nge-batch-close {
  position: absolute;
  top: 12px;
  right: 14px;
  background: rgba(255, 200, 80, 0.08);
  border: 1px solid rgba(255, 200, 80, 0.25);
  color: rgba(255, 220, 130, 0.85);
  font-size: 1.4em;
  font-weight: 300;
  width: 32px;
  height: 32px;
  line-height: 1;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 10;
  transition: all 0.18s;
  font-family: inherit;
}
.nge-batch-close:hover {
  background: rgba(255, 200, 80, 0.2);
  border-color: rgba(255, 220, 130, 0.7);
  color: #ffe;
  box-shadow: 0 0 16px rgba(255, 200, 80, 0.5);
  transform: scale(1.1) rotate(90deg);
}

/* Nurro wrapper — holds the avatar + the orbiting runes */
.nge-batch-nurro-wrap {
  position: relative;
  width: 92px;
  height: 92px;
  margin: 0 auto 22px;
}
.nge-batch-nurro-wrap .nge-batch-nurro {
  margin: 0;
}

/* Orbiting Norse runes around the nurro */
.nge-batch-runes {
  position: absolute;
  inset: 0;
  pointer-events: none;
  animation: nge-batch-runes-orbit 32s linear infinite;
}
@keyframes nge-batch-runes-orbit {
  0%   { transform: rotate(0); }
  100% { transform: rotate(360deg); }
}
.nge-batch-rune {
  position: absolute;
  top: 50%;
  left: 50%;
  --angle: calc(var(--i) * 60deg);
  /* place on a circle of radius 90 around the nurro center, then counter-rotate
     so the rune itself stays upright as the container spins */
  transform:
    translate(-50%, -50%)
    rotate(var(--angle))
    translateY(-90px)
    rotate(calc(-1 * var(--angle)));
  font-size: 1.4em;
  font-weight: 600;
  color: rgba(255, 220, 130, 0.85);
  text-shadow:
    0 0 10px rgba(255, 200, 80, 0.85),
    0 0 22px rgba(255, 180, 60, 0.5);
  animation: nge-batch-rune-pulse 3.4s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.45s);
}
@keyframes nge-batch-rune-pulse {
  0%, 100% { opacity: 0.4; filter: blur(0); }
  50%      { opacity: 1;   filter: blur(0.4px); }
}
</style>
