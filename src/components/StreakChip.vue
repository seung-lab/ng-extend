<script setup lang="ts">
/**
 * The 🔥 streak chip in the top bar (Ames 2026-10-03: "a really cool flame
 * animation on hover, an immensely satisfying click, and take the scifi-ui to
 * the next level on the box appear animation").
 *
 * Built to the scifi-ui rules (SCIFIIFY.md):
 *  - Chase, do not jump. The fire's heat is one number that chases its
 *    target (hover, a click's kick) and the loop stops once it settles cold.
 *  - Only ambient things loop: the fire burns while you are on it; the card's
 *    entrance, its light sweep and the click's sparks all run once.
 *  - Draw marks, do not fade them in: the day pips light one after another.
 *  - The 🔥 itself is not replaced. The fire is drawn on top of it.
 *  - Every hover has its tap path: a click (or Enter) pins the card open.
 *  - Reduced motion lands on the true state: no fire, no sparks, the card
 *    simply shows with its pips already lit.
 */
import {computed, onUnmounted, ref, watch} from 'vue';
import {useProofreadingBackendStore} from '../store';
import {QUIET_TEST_HOST} from '../util/test_host';
import {FLAME_TIERS, flameTierIndex, type FlameTier} from '../util/streak_tiers';

const props = defineProps<{ current: number; best: number }>();
// A test hook can set the day count by hand (window.__testStreakFlame below).
const testDays = ref<number | null>(null);
const days = computed(() => testDays.value ?? props.current);
const bestDays = computed(() => Math.max(props.best, days.value));

// The number sits inside a bigger 🔥, in gold, and the flame grows with each
// digit so the number always fits (Kfay #589).
const digits = computed(() => String(Math.max(0, days.value)).length);
const flamePx = computed(() => digits.value <= 1 ? 24 : digits.value === 2 ? 28 : 32);
const flameScale = computed(() => flamePx.value / 13);   // the fire was drawn for a 13px 🔥
const countPx = computed(() => Math.round(flamePx.value * (digits.value <= 1 ? 0.5 : digits.value === 2 ? 0.42 : 0.34)));

const chipEl = ref<HTMLElement | null>(null);
const flameEl = ref<HTMLElement | null>(null);
const fireCv = ref<HTMLCanvasElement | null>(null);
const hovering = ref(false);
const pinned = ref(false);
const open = computed(() => hovering.value || pinned.value);
const still = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ── Day pips: the streak against your best, one pip a day (a bar past 14) ──
const PIP_MAX = 14;
const pipTotal = computed(() => Math.max(days.value, bestDays.value, 1));
const usePips = computed(() => pipTotal.value <= PIP_MAX);
const isBest = computed(() => days.value >= bestDays.value && days.value > 1);
// Congratulations that grow with the streak (Ames 2026-10-04).
const cheer = computed(() => {
  const n = days.value;
  // Opening the game counts as a day (Ames 2026-10-06), so the ask is to
  // come back, not to edit.
  const keep = 'Come back tomorrow to keep the flame going.';
  if (n <= 1) return 'Good to see you today! Come back tomorrow to start a streak.';
  if (n === 2) return `Two days running, nice work! ${keep}`;
  if (n < 7) return `Congrats, ${n} days in a row! You are on a roll. ${keep}`;
  if (n < 14) return `Congrats, ${n} days in a row! A week and counting of mapping the brain. ${keep}`;
  if (n < 30) return `Amazing, ${n} days in a row! That is real dedication. ${keep}`;
  return `Incredible, ${n} days in a row! You are an EyeWire legend. ${keep}`;
});
const shownCount = ref(days.value);       // the title's number rolls up on open
let rollRaf = 0;
watch(open, v => {
  cancelAnimationFrame(rollRaf);
  if (!v || still()) { shownCount.value = days.value; return; }
  const t0 = performance.now(), DUR = 420 + Math.min(380, days.value * 30);
  const step = (now: number) => {
    const q = Math.min(1, (now - t0) / DUR), e = 1 - Math.pow(1 - q, 3);
    shownCount.value = Math.round(days.value * e);
    if (q < 1) rollRaf = requestAnimationFrame(step);
  };
  shownCount.value = 0;
  rollRaf = requestAnimationFrame(step);
});

// ── Flame tiers (Ames 2026-11-20): the flame levels up as the streak grows
//    (util/streak_tiers.ts). The look on screen (shownIdx) can lag the streak
//    for a moment: a level up shows the old flame, flares, then swaps. ──────
const tierIdx = computed(() => flameTierIndex(days.value));
const shownIdx = ref(tierIdx.value);
const shown = computed(() => FLAME_TIERS[shownIdx.value]);
const nextTier = computed(() => FLAME_TIERS[shownIdx.value + 1] ?? null);
const levelUp = ref<FlameTier | null>(null);   // set while a level up is on screen
let celebrating = false, autoPinned = false;
let celebTimers: number[] = [];
const later = (ms: number, fn: () => void) => { celebTimers.push(window.setTimeout(fn, ms)); };

// The highest tier this browser has celebrated for this player's current run.
// A lower tier than that means the streak broke: the record drops, nothing plays.
const backend = useProofreadingBackendStore();
const seenKey = () => backend.userId ? `nge_flame_tier_v1:${backend.userId}` : '';
function readSeen(k: string): number | null {
  try { const v = localStorage.getItem(k); return v === null ? null : Number(v); } catch { return null; }
}
function writeSeen(k: string, i: number) { try { localStorage.setItem(k, String(i)); } catch { /* storage blocked: it plays again next time */ } }

watch([() => backend.userId, tierIdx], () => {
  if (testDays.value !== null) return;
  const now = tierIdx.value, k = seenKey();
  if (!k) { if (!celebrating) shownIdx.value = now; return; }
  const seen = readSeen(k);
  const due = now >= 1 && (seen === null || !Number.isFinite(seen) || now > seen);
  if (seen !== now) writeSeen(k, now);
  // a branch test site starts with empty storage every time: no card there
  if (due && !QUIET_TEST_HOST) celebrate(now - 1, now);
  else if (!celebrating) shownIdx.value = now;
}, { immediate: true });

/** The level up: the old flame heats, flares, and comes back as the new one,
 *  with a ring, a shower in the new color and the card saying so. */
function celebrate(from: number, to: number) {
  celebTimers.forEach(clearTimeout); celebTimers = [];
  celebrating = true;
  shownIdx.value = from;
  const swap = () => {
    shownIdx.value = to;
    levelUp.value = FLAME_TIERS[to];
    if (!pinned.value) { pinned.value = true; autoPinned = true; }
  };
  const end = () => {
    celebrating = false; levelUp.value = null;
    if (autoPinned) { pinned.value = false; autoPinned = false; }
    if (!hovering.value) heatTarget = 0;
  };
  // let the page settle first: the card should not land in the loading rush
  later(1600, () => {
    if (still()) { swap(); later(7000, end); return; }
    heatTarget = 1; kick = 0.8; wakeFire();         // the old flame heats up
    later(850, () => {
      swap();
      kick = 2.8; for (let i = 0; i < 26; i++) spawnBlob(2.2);
      chipEl.value?.classList.remove('nge-streak-chip--leveled');
      void chipEl.value?.offsetWidth;
      chipEl.value?.classList.add('nge-streak-chip--leveled');
      const r = flameEl.value?.getBoundingClientRect();
      if (r) sparkShower(r.left + r.width / 2, r.top + r.height * 0.55, true);
      later(1400, () => { if (!hovering.value) heatTarget = 0.35; });
      later(6500, end);
    });
  });
}

// Test from the console: window.__testStreakFlame(30) plays the level up to
// Plasma as if the streak were 30 today; __testStreakFlame() puts it back.
(window as any).__testStreakFlame = (n?: number) => {
  if (n === undefined) { testDays.value = null; shownIdx.value = tierIdx.value; return; }
  testDays.value = n;
  const to = flameTierIndex(n);
  if (to >= 1) celebrate(to - 1, to); else shownIdx.value = to;
};

/** The fire's colors, white hot at the root out to the tip, for the tiers
 *  that are not simply a new hue (those are a filter over the whole fire). */
function firePalette(): string[] {
  switch (shown.value.id) {
    case 'kindled': return ['255,246,206', '255,206,84', '255,148,40', '228,84,22'];
    case 'bluecore': return ['214,240,255', '130,200,255', '255,160,56', '226,74,22'];
    case 'solar': return ['255,253,232', '255,230,120', '255,186,64', '255,126,34'];
    default: return ['255,236,170', '255,176,58', '255,104,26', '214,48,18'];
  }
}

// ── The fire: soft additive blobs rising through the 🔥, drawn on top ──────
const FW = 46, FH = 54;                       // canvas box, CSS px, centred on the flame
interface Blob { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number }
let blobs: Blob[] = [];
let heat = 0, heatTarget = 0, kick = 0;       // kick: the click's extra heat, decays on its own
let fireRaf = 0, lastT = 0, seed = Math.random() * 100;

function spawnBlob(power: number) {
  const max = 0.36 + Math.random() * 0.34;
  blobs.push({
    x: FW / 2 + (Math.random() - 0.5) * 9, y: FH * 0.72 + Math.random() * 3,
    vx: (Math.random() - 0.5) * 9, vy: -(22 + Math.random() * 24) * (0.75 + power * 0.5),
    life: 0, max, r: 3.2 + Math.random() * 3.4,
  });
}

function fireFrame(now: number) {
  const dt = Math.min(0.05, (now - (lastT || now)) / 1000); lastT = now;
  kick *= Math.exp(-dt * 3.2);
  heat += (heatTarget + kick - heat) * (1 - Math.exp(-dt * 9));
  const cv = fireCv.value, ctx = cv?.getContext('2d');
  if (!cv || !ctx) { fireRaf = 0; return; }
  const t = now / 1000 + seed;

  // The 🔥 itself breathes with the heat: a wobble made of three sines that
  // never line up, so it never reads as a loop.
  const fl = flameEl.value;
  if (fl) {
    const wob = Math.sin(t * 9.1) * 0.5 + Math.sin(t * 14.7 + 1.3) * 0.3 + Math.sin(t * 23.3 + 4) * 0.2;
    const h = Math.min(heat, 2.4);
    fl.style.transform = `translateY(${(-0.6 * h).toFixed(2)}px) rotate(${(wob * 5 * h).toFixed(2)}deg) scale(${(1 + 0.1 * h + wob * 0.035 * h).toFixed(3)}, ${(1 + 0.16 * h + Math.abs(wob) * 0.07 * h).toFixed(3)})`;
    fl.style.filter = h > 0.02 ? `brightness(${(1 + 0.28 * h).toFixed(3)}) saturate(${(1 + 0.25 * h).toFixed(3)}) drop-shadow(0 0 ${(5 * h).toFixed(1)}px rgba(255,150,40,${Math.min(0.85, 0.55 * h).toFixed(3)}))` : '';
  }
  chipEl.value?.style.setProperty('--streak-heat', Math.min(1.6, heat).toFixed(3));

  // feed
  const want = heat * 62 * dt;
  let n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
  while (n-- > 0) spawnBlob(heat);

  ctx.clearRect(0, 0, FW, FH);
  ctx.globalCompositeOperation = 'lighter';
  const pal = firePalette();
  for (const b of blobs) {
    b.life += dt;
    const k = b.life / b.max;
    // lazy sideways curl, stronger near the top: what makes it lick
    b.vx += Math.sin(t * 7 + b.y * 0.35) * 55 * dt;
    b.vx *= Math.exp(-dt * 3);
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (k >= 1) continue;
    const r = b.r * (1 - k * 0.72);
    const a = Math.sin(Math.min(1, k * 4) * 1.5708) * (1 - k) * 0.5 * Math.min(1, heat + 0.2);
    // white hot at the root, then gold, orange, a deep red tip
    const col = k < 0.22 ? pal[0] : k < 0.5 ? pal[1] : k < 0.78 ? pal[2] : pal[3];
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    g.addColorStop(0, `rgba(${col},${a.toFixed(3)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 6.2832); ctx.fill();
  }
  blobs = blobs.filter(b => b.life < b.max);

  // settled cold: stop, and leave the 🔥 exactly as it was
  if (heatTarget === 0 && kick < 0.01 && heat < 0.012 && blobs.length === 0) {
    heat = 0; fireRaf = 0; lastT = 0;
    if (fl) { fl.style.transform = ''; fl.style.filter = ''; }
    chipEl.value?.style.setProperty('--streak-heat', '0');
    ctx.clearRect(0, 0, FW, FH);
    return;
  }
  fireRaf = requestAnimationFrame(fireFrame);
}

function wakeFire() {
  if (still() || fireRaf) return;
  const cv = fireCv.value;
  // the canvas is scaled up with the flame, so give it the pixels to stay sharp
  const d = Math.min(5, dprOf() * flameScale.value);
  if (cv && cv.width !== Math.round(FW * d)) {
    cv.width = Math.round(FW * d); cv.height = Math.round(FH * d);
    cv.getContext('2d')?.setTransform(d, 0, 0, d, 0, 0);
  }
  lastT = 0;
  fireRaf = requestAnimationFrame(fireFrame);
}
const dprOf = () => Math.min(window.devicePixelRatio || 1, 2);

function onEnter() { hovering.value = true; heatTarget = 1; wakeFire(); }
function onLeave() { hovering.value = false; heatTarget = 0; }

// ── The click: stoke the fire. One felt moment: a flare, a ring, and a
//    shower of sparks that arc out and fall, each with its own weight. ──────
function stoke() {
  pinned.value = !pinned.value;
  autoPinned = false;
  if (still()) return;
  kick = 1.9; wakeFire();
  for (let i = 0; i < 14; i++) spawnBlob(1.6);
  chipEl.value?.classList.remove('nge-streak-chip--stoked');
  void chipEl.value?.offsetWidth;                 // restart the count's bump
  chipEl.value?.classList.add('nge-streak-chip--stoked');
  const r = flameEl.value?.getBoundingClientRect();
  if (r) sparkShower(r.left + r.width / 2, r.top + r.height * 0.55);
}

function sparkShower(cx: number, cy: number, big = false) {
  const W = 340, H = 280, OX = W / 2, OY = 40, DUR = big ? 2000 : 1500;
  const cv = document.createElement('canvas');
  // the sparks take the flame's color: the same filter as the fire
  cv.className = `nge-streak-tint nge-streak-tint--${shown.value.id}`;
  cv.style.cssText = `position:fixed;left:${cx - OX}px;top:${cy - OY}px;width:${W}px;height:${H}px;pointer-events:none;z-index:100000;`;
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }
  const d = dprOf();
  cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
  // The chip sits at the very top of the screen, so the sparks are thrown out
  // and DOWN: a fan under the bar, each one falling under its own gravity.
  const sparks = Array.from({ length: big ? 90 : 46 }, () => {
    const a = Math.PI * (0.06 + Math.random() * 0.88);           // a downward fan
    const sp = (90 + Math.random() * 250) * (big ? 1.2 : 1);
    return { x: OX, y: OY, px: OX, py: OY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55 - 40 - Math.random() * 70,
      g: 420 + Math.random() * 380, drag: 1.2 + Math.random() * 1.6, life: 0, max: 0.55 + Math.random() * 0.85,
      w: 0.8 + Math.random() * 1.5, hot: Math.random() };
  });
  let last = performance.now();
  const t0 = last;
  const draw = (now: number) => {
    const dt = Math.min(0.04, (now - last) / 1000); last = now;
    const el = now - t0;
    if (el > DUR) { cv.remove(); return; }
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    // the ring: one thin shock that opens and thins out
    // a level up sends a second, wider ring after the first
    const q2 = (el - 160) / 700;
    if (big && q2 > 0 && q2 < 1) {
      const e2 = 1 - Math.pow(1 - q2, 3);
      ctx.beginPath(); ctx.arc(OX, OY, 10 + e2 * 96, 0, 6.2832);
      ctx.lineWidth = 3 * (1 - q2) + 0.4;
      ctx.strokeStyle = `rgba(255,214,140,${(0.8 * (1 - q2)).toFixed(3)})`;
      ctx.stroke();
    }
    const q = el / 420;
    if (q < 1) {
      const e = 1 - Math.pow(1 - q, 3);
      ctx.beginPath(); ctx.arc(OX, OY, 6 + e * 46, 0, 6.2832);
      ctx.lineWidth = 2.2 * (1 - q) + 0.3;
      ctx.strokeStyle = `rgba(255,190,90,${(0.75 * (1 - q)).toFixed(3)})`;
      ctx.stroke();
      const core = ctx.createRadialGradient(OX, OY, 0, OX, OY, 30 * (1 - q) + 5);
      core.addColorStop(0, `rgba(255,244,210,${(0.7 * (1 - q)).toFixed(3)})`);
      core.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = core; ctx.fillRect(0, 0, W, H);
    }
    ctx.lineCap = 'round';
    for (const s of sparks) {
      s.life += dt;
      if (s.life >= s.max) continue;
      s.px = s.x; s.py = s.y;
      s.vx *= Math.exp(-dt * s.drag); s.vy = s.vy * Math.exp(-dt * s.drag * 0.4) + s.g * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const k = s.life / s.max, a = Math.pow(1 - k, 1.4);
      // each spark cools as it falls: white, gold, orange, ember red
      const col = k < 0.15 + s.hot * 0.15 ? '255,246,214' : k < 0.5 ? '255,196,84' : k < 0.8 ? '255,128,36' : '220,60,20';
      ctx.beginPath(); ctx.moveTo(s.px - s.vx * dt * 1.6, s.py - s.vy * dt * 1.6); ctx.lineTo(s.x, s.y);
      ctx.lineWidth = s.w * (1 - k * 0.5);
      ctx.strokeStyle = `rgba(${col},${a.toFixed(3)})`;
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// A pinned card closes on a click elsewhere, or Escape.
function onDocDown(e: Event) { if (pinned.value && !chipEl.value?.contains(e.target as Node)) pinned.value = false; }
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && pinned.value) { pinned.value = false; e.stopPropagation(); }
  else if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === chipEl.value) { e.preventDefault(); stoke(); }
}
watch(pinned, v => {
  document.removeEventListener('pointerdown', onDocDown, true);
  if (v) document.addEventListener('pointerdown', onDocDown, true);
});
onUnmounted(() => {
  cancelAnimationFrame(fireRaf); cancelAnimationFrame(rollRaf);
  celebTimers.forEach(clearTimeout);
  document.removeEventListener('pointerdown', onDocDown, true);
});
</script>

<template>
  <div ref="chipEl" class="nge-streak-chip" :class="{ 'nge-streak-chip--open': open, 'holo-on': pinned }"
       tabindex="0" role="button" :aria-expanded="open" :aria-label="`Editing streak: ${days} days`"
       @pointerenter="onEnter" @pointerleave="onLeave" @focus="onEnter" @blur="onLeave"
       @click="stoke" @keydown="onKey">
    <span class="nge-streak-chip-fire" :class="`nge-streak-tier--${shown.id}`"
          :style="{ '--flame-px': flamePx + 'px', '--flame-scale': flameScale, '--count-px': countPx + 'px', '--tier-rgb': shown.rgb }">
      <!-- the tier's ornaments, behind and around the flame (util/streak_tiers.ts) -->
      <span v-if="shownIdx >= 1" class="nge-streak-orn-glow" aria-hidden="true"></span>
      <span v-if="shown.id === 'solar'" class="nge-streak-orn-flares" aria-hidden="true"><i style="--w: 1.75; --d: 7s"></i><i class="rev" style="--w: 1.4; --d: 10s"></i></span>
      <span class="nge-streak-tint" :class="`nge-streak-tint--${shown.id}`">
        <span ref="flameEl" class="nge-streak-chip-flame">🔥</span>
        <canvas ref="fireCv" class="nge-streak-chip-canvas" aria-hidden="true"></canvas>
      </span>
      <span v-if="shown.id === 'plasma' || shown.id === 'starfire'" class="nge-streak-orn-orbit" aria-hidden="true">
        <i></i><i v-if="shown.id === 'starfire'" style="--o: 0.5"></i>
      </span>
      <span v-if="shown.id === 'kindled'" class="nge-streak-orn-embers" aria-hidden="true"><i></i><i></i><i></i></span>
      <span v-if="shown.id === 'nova'" class="nge-streak-orn-crown" aria-hidden="true"><i>✦</i><i>✦</i><i>✦</i></span>
      <span class="nge-streak-chip-count">{{ days }}</span>
    </span>

    <!-- The card. v-if, so every opening is an arrival and runs its entrance once. -->
    <div v-if="open" class="nge-streak-tip" role="tooltip">
      <span class="nge-streak-tip-beam" aria-hidden="true"></span>
      <span class="nge-streak-tip-scan" aria-hidden="true"></span>
      <i class="nge-streak-tip-brk tl" aria-hidden="true"></i><i class="nge-streak-tip-brk tr" aria-hidden="true"></i>
      <i class="nge-streak-tip-brk bl" aria-hidden="true"></i><i class="nge-streak-tip-brk br" aria-hidden="true"></i>
      <div v-if="levelUp" class="nge-streak-tip-level nge-streak-tip-row" style="--i: 0" :style="{ '--tier-rgb': levelUp.rgb }">
        <span class="nge-streak-tip-level-label">New flame</span>
        <span class="nge-streak-tip-level-name">{{ levelUp.name }}!</span>
      </div>
      <div class="nge-streak-tip-title nge-streak-tip-row" style="--i: 0">🔥 <span class="nge-streak-tip-num">{{ shownCount }}</span>-day streak</div>
      <div v-if="usePips" class="nge-streak-tip-pips nge-streak-tip-row" style="--i: 1"
           :title="isBest ? 'Your best streak yet' : `${days} of your best ${bestDays} days`">
        <i v-for="n in pipTotal" :key="n" class="nge-streak-tip-pip" :class="{ 'is-lit': n <= days, 'is-head': n === days }" :style="{ '--n': n }"></i>
      </div>
      <div v-else class="nge-streak-tip-bar nge-streak-tip-row" style="--i: 1" :title="`${days} of your best ${Math.max(days, bestDays)} days`">
        <i :style="{ '--fill': Math.round(days / pipTotal * 100) + '%' }"></i>
      </div>
      <div class="nge-streak-tip-body nge-streak-tip-row" style="--i: 2">{{ cheer }}</div>
      <div class="nge-streak-tip-tier nge-streak-tip-row" style="--i: 3" :style="{ '--tier-rgb': shown.rgb }">
        <b>{{ shown.name }} flame.</b>
        <template v-if="nextTier"> Next: {{ nextTier.name }} at {{ nextTier.days }} days, {{ nextTier.days - days }} to go.</template>
        <template v-else> The brightest flame there is.</template>
      </div>
      <div v-if="bestDays > days" class="nge-streak-tip-best nge-streak-tip-row" style="--i: 4">Your best: {{ bestDays }} days</div>
      <div v-else-if="days > 1" class="nge-streak-tip-best nge-streak-tip-row" style="--i: 4">🏆 Your best streak yet!</div>
      <!-- Every flame in a row (Ames 2026-11-24): the ones passed lit, this one marked, the ones ahead dimmed. -->
      <div class="nge-streak-tip-ladder nge-streak-tip-row" style="--i: 5">
        <span v-for="(t, ti) in FLAME_TIERS" :key="t.id" class="nge-streak-rung"
              :class="{ 'is-locked': ti > shownIdx, 'is-now': ti === shownIdx }"
              :title="`${t.name} flame: ${t.days === 1 ? 'day 1' : t.days + ' days'}`">
          <span class="nge-streak-tint" :class="`nge-streak-tint--${t.id}`"><span class="nge-streak-rung-flame">🔥</span></span>
          <small>{{ t.days }}</small>
        </span>
      </div>
    </div>
  </div>
</template>

<style>
@property --streak-beam { syntax: '<angle>'; initial-value: 0deg; inherits: false; }

.nge-streak-chip {
  --streak-heat: 0;
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #f5a623;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
.nge-streak-chip:focus-visible { box-shadow: inset 0 0 0 1px rgba(245, 166, 35, 0.6); border-radius: 6px; }
.nge-streak-chip-fire { position: relative; display: inline-block; line-height: 1; isolation: isolate; }

/* ── Flame tiers (util/streak_tiers.ts). The tint is one filter over the 🔥
      and its fire together, so the fire, its glow and the click's sparks
      all take the tier's color. Ornaments sit outside the tint. ── */
.nge-streak-tint { position: relative; display: inline-block; line-height: 1; z-index: 1; }
/* Kindled: bright yellow gold, so it reads apart from a Spark (Ames 2026-11-24) */
.nge-streak-tint--kindled { filter: hue-rotate(24deg) saturate(1.5) brightness(1.22) drop-shadow(0 0 1.5px rgba(255, 236, 120, 1)); }
.nge-streak-tier--kindled .nge-streak-orn-glow { scale: 1.25; background: radial-gradient(closest-side, rgba(255, 226, 90, 0.6), rgba(255, 210, 80, 0.18) 55%, rgba(255, 210, 80, 0)); }
/* and embers rising off it */
.nge-streak-orn-embers { position: absolute; left: 50%; top: 40%; width: 0; height: 0; z-index: 3; pointer-events: none; }
.nge-streak-orn-embers > i { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #fff4b0; opacity: 0;
  box-shadow: 0 0 2px 1px rgba(255, 220, 90, 0.95); animation: nge-streak-ember 1.8s ease-out infinite; }
.nge-streak-orn-embers > i:nth-child(1) { left: calc(var(--flame-px) * -0.26); }
.nge-streak-orn-embers > i:nth-child(2) { left: calc(var(--flame-px) * 0.18); animation-delay: -0.6s; }
.nge-streak-orn-embers > i:nth-child(3) { left: calc(var(--flame-px) * -0.04); animation-delay: -1.2s; }
@keyframes nge-streak-ember { 0% { transform: translateY(3px); opacity: 0; } 20% { opacity: 1; } 100% { transform: translate(2px, calc(var(--flame-px) * -0.6)); opacity: 0; } }
.nge-streak-tint--bluecore { filter: drop-shadow(0 0 1.5px rgba(150, 215, 255, 0.8)); }
/* the white-blue heart in the belly of the flame, like a torch */
.nge-streak-tint--bluecore::after {
  content: ''; position: absolute; left: 50%; top: 64%; width: 66%; height: 58%;
  translate: -50% -50%; border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(225, 244, 255, 1), rgba(90, 180, 255, 0.95) 50%, rgba(60, 140, 255, 0) 100%);
}
.nge-streak-tint--plasma { filter: hue-rotate(168deg) saturate(1.3) brightness(1.1) drop-shadow(0 0 1.5px rgba(150, 245, 255, 0.9)); }
.nge-streak-tint--starfire { filter: hue-rotate(238deg) saturate(1.35) brightness(1.08) drop-shadow(0 0 1.5px rgba(230, 170, 255, 0.9)); }
.nge-streak-tint--nova { animation: nge-streak-nova 9s linear infinite; }
@keyframes nge-streak-nova {
  0%   { filter: hue-rotate(0deg) saturate(1.35) brightness(1.1) drop-shadow(0 0 1.5px rgba(255, 220, 245, 0.9)); }
  100% { filter: hue-rotate(360deg) saturate(1.35) brightness(1.1) drop-shadow(0 0 1.5px rgba(255, 220, 245, 0.9)); }
}
/* Solar: white hot at rest; open the card and it runs through every flame's color (Ames 2026-11-24) */
.nge-streak-tint--solar { filter: hue-rotate(0deg) saturate(0.12) brightness(1.6) drop-shadow(0 0 2px rgba(255, 255, 255, 0.95)); }
.nge-streak-chip--open .nge-streak-chip-fire .nge-streak-tint--solar { animation: nge-streak-solar 3s ease-in-out infinite; }
@keyframes nge-streak-solar {
  0%, 100% { filter: hue-rotate(0deg) saturate(0.12) brightness(1.6) drop-shadow(0 0 2px rgba(255, 255, 255, 0.95)); }
  12% { filter: hue-rotate(0deg) saturate(1.2) brightness(1.05) drop-shadow(0 0 2px rgba(255, 150, 40, 0.9)); }
  26% { filter: hue-rotate(18deg) saturate(1.3) brightness(1.15) drop-shadow(0 0 2px rgba(255, 204, 80, 0.9)); }
  40% { filter: hue-rotate(200deg) saturate(1.2) brightness(1.15) drop-shadow(0 0 2px rgba(130, 205, 255, 0.9)); }
  54% { filter: hue-rotate(168deg) saturate(1.4) brightness(1.15) drop-shadow(0 0 2px rgba(80, 232, 255, 0.9)); }
  68% { filter: hue-rotate(238deg) saturate(1.4) brightness(1.1) drop-shadow(0 0 2px rgba(214, 120, 255, 0.9)); }
  82% { filter: hue-rotate(300deg) saturate(1.4) brightness(1.1) drop-shadow(0 0 2px rgba(255, 140, 220, 0.9)); }
}

/* a soft halo in the tier's light, from Kindled up */
.nge-streak-orn-glow {
  position: absolute; left: 50%; top: 58%; width: calc(var(--flame-px) * 1.6); height: calc(var(--flame-px) * 1.6);
  translate: -50% -50%; border-radius: 50%; pointer-events: none; z-index: 0;
  background: radial-gradient(closest-side, rgba(var(--tier-rgb), 0.42), rgba(var(--tier-rgb), 0.12) 55%, rgba(var(--tier-rgb), 0) 100%);
}
/* Solar: two thin white arcs circling the flame, each its own way */
.nge-streak-orn-flares { position: absolute; left: 50%; top: 58%; width: 0; height: 0; pointer-events: none; z-index: 0; }
.nge-streak-orn-flares > i {
  position: absolute; width: calc(var(--flame-px) * var(--w)); height: calc(var(--flame-px) * var(--w));
  left: calc(var(--flame-px) * var(--w) / -2); top: calc(var(--flame-px) * var(--w) / -2); border-radius: 50%;
  border: 1.5px solid transparent; border-top-color: rgba(255, 255, 255, 0.95); border-left-color: rgba(200, 225, 255, 0.35);
  filter: drop-shadow(0 0 2px rgba(220, 235, 255, 0.9)); animation: nge-streak-spin var(--d) linear infinite;
}
.nge-streak-orn-flares > i.rev { animation-direction: reverse; border-top-color: transparent; border-bottom-color: rgba(255, 255, 255, 0.9); border-right-color: rgba(200, 225, 255, 0.35); }
.nge-streak-chip--open .nge-streak-orn-flares { animation: nge-streak-solar 3s ease-in-out infinite; }
@keyframes nge-streak-spin { to { transform: rotate(360deg); } }
/* Plasma and Starfire: sparks on a tilted orbit, passing in front of the
   flame on the near side and behind it on the far side. Two eased sweeps a
   quarter turn apart make the ellipse; z-index flips at the far side. */
.nge-streak-orn-orbit { position: absolute; left: 50%; top: 58%; width: 0; height: 0; pointer-events: none; z-index: 0; }
.nge-streak-orn-orbit > i {
  position: absolute; left: 0; top: 0; --P: 3.2s;
  animation: nge-streak-orb-x var(--P) ease-in-out calc(var(--o, 0) * var(--P) * -1) infinite,
             nge-streak-orb-z var(--P) step-end calc(var(--o, 0) * var(--P) * -1) infinite;
}
.nge-streak-orn-orbit > i::before {
  content: ''; position: absolute; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 3px 1px rgba(var(--tier-rgb), 1), 0 0 7px 2px rgba(var(--tier-rgb), 0.6);
  animation: nge-streak-orb-y var(--P) ease-in-out calc(var(--o, 0) * var(--P) * -1 - var(--P) / 4) infinite;
}
@keyframes nge-streak-orb-x { 0%, 100% { transform: translateX(calc(var(--flame-px) * -0.68)); } 50% { transform: translateX(calc(var(--flame-px) * 0.68)); } }
@keyframes nge-streak-orb-y { 0%, 100% { transform: translateY(calc(var(--flame-px) * -0.2)) rotate(-14deg); } 50% { transform: translateY(calc(var(--flame-px) * 0.2)); } }
@keyframes nge-streak-orb-z { 0% { z-index: 3; } 50% { z-index: -1; } }
/* Nova: a little crown of stars that twinkle in turn */
.nge-streak-orn-crown { position: absolute; left: 50%; top: -3px; translate: -50% 0; display: flex; gap: 3px; z-index: 3; pointer-events: none; }
.nge-streak-orn-crown > i {
  font-style: normal; font-size: 7px; line-height: 1; color: #fff;
  text-shadow: 0 0 3px rgba(255, 150, 230, 1), 0 0 6px rgba(160, 200, 255, 0.9);
  animation: nge-streak-twinkle 2.4s ease-in-out infinite;
}
.nge-streak-orn-crown > i:nth-child(2) { translate: 0 -3px; font-size: 8px; animation-delay: -0.8s; }
.nge-streak-orn-crown > i:nth-child(3) { animation-delay: -1.6s; }
@keyframes nge-streak-twinkle { 0%, 100% { opacity: 1; scale: 1; } 50% { opacity: 0.45; scale: 0.7; } }

/* the level up: the flame swells, flashes and settles as the new one */
.nge-streak-chip--leveled .nge-streak-chip-fire { animation: nge-streak-levelup 1000ms cubic-bezier(.2, 1.5, .4, 1) both; }
@keyframes nge-streak-levelup {
  0% { transform: scale(1); filter: brightness(1); }
  18% { transform: scale(1.55) translateY(1px); filter: brightness(2.2); }
  48% { transform: scale(0.92); filter: brightness(1.3); }
  100% { transform: scale(1); filter: none; }
}
/* inline-block: a transform does nothing on a plain inline span */
.nge-streak-chip-flame { display: inline-block; font-size: var(--flame-px, 24px); line-height: 1; transform-origin: 50% 88%; will-change: transform, filter; }
.nge-streak-chip-canvas {
  position: absolute; left: 50%; top: 50%;
  width: 46px; height: 54px;
  margin: -34px 0 0 -23px;                 /* the fire's root sits at the 🔥's base */
  /* drawn for a 13px 🔥: grown about the flame's middle, its root lands at the bigger 🔥's base */
  transform-origin: 23px 34px;
  transform: scale(var(--flame-scale, 1));
  pointer-events: none;
}
/* the count sits in the belly of the flame in the bar's own dark color, cut
   out of the fire, with a pale glow behind it so it reads on the orange
   (report 592: a gold number on a gold flame was not readable) */
.nge-streak-chip-count {
  position: absolute; left: 50%; top: 64%;
  translate: -50% -50%;                     /* translate, not transform: the click's bump owns transform */
  font-size: var(--count-px, 12px);
  line-height: 1;
  letter-spacing: -0.02em;
  pointer-events: none;
  z-index: 2;
  font-weight: 900;
  color: var(--color-dark-bg, #121212);
  text-shadow:
    0 0 2px rgba(255, 236, 170, 0.95), 0 0 4px rgba(255, 220, 140, 0.8),
    0 0 calc(4px + var(--streak-heat) * 6px) rgba(255, 200, 110, calc(0.5 + var(--streak-heat) * 0.4));
}
/* the click: the number takes the hit and springs back */
.nge-streak-chip--stoked .nge-streak-chip-count { animation: nge-streak-bump 520ms cubic-bezier(.2, 1.7, .4, 1) both; }
@keyframes nge-streak-bump {
  0% { transform: scale(1); } 22% { transform: scale(1.42) translateY(-1px); } 55% { transform: scale(0.94); } 100% { transform: scale(1); }
}

/* ── The card ── */
.nge-streak-tip {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 248px;
  padding: 12px 14px 12px;
  border-radius: 10px;
  /* the holopanel surface: dark gradient, a lit top hairline, in the streak's amber */
  background:
    linear-gradient(180deg, rgba(255, 190, 110, 0.07), transparent 38%),
    linear-gradient(160deg, rgba(16, 13, 12, 0.97), rgba(9, 12, 22, 0.97));
  border: 1px solid rgba(245, 166, 35, 0.34);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), 0 0 22px rgba(245, 166, 35, 0.1), inset 0 1px 0 rgba(255, 214, 150, 0.22);
  color: #d8e2f0;
  font-weight: 400;
  font-size: 12.5px;
  line-height: 1.45;
  white-space: normal;
  cursor: default;
  z-index: 10000;
  transform-origin: calc(100% - 22px) -8px;      /* it opens out of the flame */
  animation: nge-streak-tip-in 480ms cubic-bezier(.16, 1, .3, 1) both;
}
@keyframes nge-streak-tip-in {
  0%   { opacity: 0; transform: translateY(-6px) scale(0.78, 0.5); filter: blur(6px) brightness(2.6); clip-path: inset(0 0 100% 62% round 10px); }
  18%  { opacity: 1; filter: blur(2px) brightness(1.9); }
  45%  { filter: blur(0) brightness(1.3); clip-path: inset(0 0 22% 0 round 10px); }
  70%  { transform: translateY(0) scale(1.012); clip-path: inset(0 round 10px); }
  100% { opacity: 1; transform: none; filter: none; clip-path: inset(-40px round 10px); }
}
/* a head of light takes one lap of the border, then it is gone */
.nge-streak-tip-beam {
  position: absolute; inset: -1px; border-radius: inherit; padding: 1.5px; pointer-events: none;
  background: conic-gradient(from var(--streak-beam), transparent 0 62%, rgba(255, 170, 60, 0.35) 78%, rgba(255, 214, 150, 0.95) 94%, #fff 98.5%, transparent 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  filter: drop-shadow(0 0 5px rgba(255, 170, 60, 0.8));
  opacity: 0;
  animation: nge-streak-beam 900ms cubic-bezier(.45, 0, .2, 1) 120ms both;
}
@keyframes nge-streak-beam {
  0% { --streak-beam: 40deg; opacity: 0; } 12% { opacity: 1; } 80% { opacity: 1; } 100% { --streak-beam: 400deg; opacity: 0; }
}
/* one scan band, top to bottom, once */
.nge-streak-tip-scan {
  position: absolute; left: 0; right: 0; top: 0; height: 22%; pointer-events: none; opacity: 0; border-radius: inherit;
  background: linear-gradient(180deg, transparent, rgba(255, 190, 110, 0.16), transparent);
  animation: nge-streak-scan 620ms cubic-bezier(.3, 0, .2, 1) 260ms both;
}
@keyframes nge-streak-scan { 0% { transform: translateY(-100%); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(460%); opacity: 0; } }
/* corner brackets push outward from inside the frame and stay */
.nge-streak-tip-brk { position: absolute; width: 9px; height: 9px; pointer-events: none; border: 0 solid rgba(255, 196, 107, 0.85); opacity: 0; animation: nge-streak-brk 480ms cubic-bezier(.16, 1, .3, 1) 200ms both; }
.nge-streak-tip-brk.tl { left: 0; top: 0; border-width: 1.5px 0 0 1.5px; --bx: -1; --by: -1; border-top-left-radius: 4px; }
.nge-streak-tip-brk.tr { right: 0; top: 0; border-width: 1.5px 1.5px 0 0; --bx: 1; --by: -1; border-top-right-radius: 4px; }
.nge-streak-tip-brk.bl { left: 0; bottom: 0; border-width: 0 0 1.5px 1.5px; --bx: -1; --by: 1; border-bottom-left-radius: 4px; }
.nge-streak-tip-brk.br { right: 0; bottom: 0; border-width: 0 1.5px 1.5px 0; --bx: 1; --by: 1; border-bottom-right-radius: 4px; }
@keyframes nge-streak-brk {
  0% { opacity: 0; transform: translate(calc(var(--bx) * -4px), calc(var(--by) * -4px)); }
  60% { opacity: 1; transform: translate(calc(var(--bx) * 7px), calc(var(--by) * 7px)); }
  100% { opacity: 0.85; transform: translate(calc(var(--bx) * 4px), calc(var(--by) * 4px)); }
}
/* the lines settle as a cascade, each a little later than the one above */
.nge-streak-tip-row { animation: nge-streak-row 420ms cubic-bezier(.16, 1, .3, 1) calc(180ms + var(--i) * 70ms) both; }
@keyframes nge-streak-row { 0% { opacity: 0; transform: translateY(7px); filter: blur(3px); } 100% { opacity: 1; transform: none; filter: none; } }
.nge-streak-tip-title { font-weight: 700; font-size: 13px; color: #ffc46b; margin-bottom: 7px; }
.nge-streak-tip-num { display: inline-block; min-width: 0.6em; font-variant-numeric: tabular-nums; text-align: right; }
.nge-streak-tip-best { margin-top: 6px; font-size: 11.5px; color: #9fb3cc; }
/* day pips: one a day, lit in order; the unlit ones are the days up to your best */
.nge-streak-tip-pips { display: flex; gap: 4px; margin-bottom: 9px; }
.nge-streak-tip-pip {
  flex: 1 1 0; max-width: 22px; height: 5px; border-radius: 3px;
  background: rgba(255, 196, 107, 0.13); box-shadow: inset 0 0 0 1px rgba(255, 196, 107, 0.16);
}
.nge-streak-tip-pip.is-lit { animation: nge-streak-pip 380ms cubic-bezier(.2, 1.5, .4, 1) calc(330ms + var(--n) * 55ms) both; }
@keyframes nge-streak-pip {
  0% { background: rgba(255, 196, 107, 0.13); transform: scaleY(1); box-shadow: inset 0 0 0 1px rgba(255, 196, 107, 0.16); }
  40% { background: #fff3d6; transform: scaleY(2.1); box-shadow: 0 0 10px rgba(255, 190, 90, 0.95); }
  100% { background: linear-gradient(90deg, #f5a623, #ffcf7a); transform: scaleY(1); box-shadow: 0 0 6px rgba(245, 166, 35, 0.55); }
}
.nge-streak-tip-pip.is-head.is-lit { animation-name: nge-streak-pip-head; }
@keyframes nge-streak-pip-head {
  0% { background: rgba(255, 196, 107, 0.13); transform: scaleY(1); }
  40% { background: #fff; transform: scaleY(2.6); box-shadow: 0 0 14px rgba(255, 214, 150, 1); }
  100% { background: linear-gradient(90deg, #ffcf7a, #fff1cf); transform: scaleY(1.25); box-shadow: 0 0 9px rgba(255, 196, 107, 0.9); }
}
.nge-streak-tip-bar { height: 5px; border-radius: 3px; margin-bottom: 9px; background: rgba(255, 196, 107, 0.13); overflow: hidden; }
.nge-streak-tip-bar > i { display: block; height: 100%; width: var(--fill); border-radius: 3px; background: linear-gradient(90deg, #f5a623, #ffcf7a); box-shadow: 0 0 6px rgba(245, 166, 35, 0.55); transform-origin: 0 50%; animation: nge-streak-bar 700ms cubic-bezier(.16, 1, .3, 1) 380ms both; }
@keyframes nge-streak-bar { 0% { transform: scaleX(0); } 100% { transform: none; } }

/* the card's level up line, and the flame's name in its own light */
.nge-streak-tip-level { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.nge-streak-tip-level-label { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(var(--tier-rgb), 0.9); }
.nge-streak-tip-level-name {
  font-size: 17px; font-weight: 800; color: rgb(var(--tier-rgb));
  text-shadow: 0 0 10px rgba(var(--tier-rgb), 0.75);
  animation: nge-streak-level-name 900ms cubic-bezier(.2, 1.6, .4, 1) 260ms both;
}
@keyframes nge-streak-level-name { 0% { opacity: 0; transform: scale(0.6); filter: brightness(2.4); } 100% { opacity: 1; transform: none; filter: none; } }
.nge-streak-tip-tier { margin-top: 6px; font-size: 11.5px; color: #c4d2e4; }
.nge-streak-tip-tier b { color: rgb(var(--tier-rgb)); font-weight: 700; }
/* the flame ladder */
.nge-streak-tip-ladder { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; padding: 9px 2px 4px; border-top: 1px solid rgba(255, 214, 150, 0.15); }
.nge-streak-rung { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; width: 28px; }
.nge-streak-rung-flame { display: inline-block; font-size: 18px; line-height: 1; }
.nge-streak-rung small { font-size: 9.5px; color: #8fa3c4; font-variant-numeric: tabular-nums; }
.nge-streak-rung.is-locked .nge-streak-tint { opacity: 0.4; }
.nge-streak-rung.is-locked .nge-streak-rung-flame { filter: grayscale(1) brightness(0.6); }
.nge-streak-rung.is-now small { color: #ffd38a; font-weight: 800; }
.nge-streak-rung.is-now::after { content: ''; position: absolute; bottom: -5px; width: 14px; height: 2px; border-radius: 1px; background: #ffd38a; box-shadow: 0 0 6px #ffb44a; }

/* Reduced motion: the finished card, pips lit, no fire and no sweep. */
@media (prefers-reduced-motion: reduce) {
  .nge-streak-orn-rays, .nge-streak-orn-crown > i, .nge-streak-tip-level-name, .nge-streak-chip--leveled .nge-streak-chip-fire { animation: none; }
  .nge-streak-tint--nova { animation: none; filter: hue-rotate(300deg) saturate(1.35) brightness(1.1); }
  .nge-streak-orn-orbit > i, .nge-streak-orn-orbit > i::before { animation: none; }
  .nge-streak-orn-orbit > i { transform: translateX(calc(var(--flame-px) * 0.6)); z-index: 3; }
  .nge-streak-orn-orbit > i[style] { transform: translateX(calc(var(--flame-px) * -0.6)); }
  .nge-streak-tip, .nge-streak-tip-row, .nge-streak-tip-brk, .nge-streak-tip-bar > i, .nge-streak-chip--stoked .nge-streak-chip-count { animation: none; }
  .nge-streak-tip-brk { opacity: 0.85; transform: translate(calc(var(--bx) * 4px), calc(var(--by) * 4px)); }
  .nge-streak-tip-beam, .nge-streak-tip-scan { display: none; }
  .nge-streak-tip-pip.is-lit { animation: none; background: linear-gradient(90deg, #f5a623, #ffcf7a); box-shadow: 0 0 6px rgba(245, 166, 35, 0.55); }
}
</style>
