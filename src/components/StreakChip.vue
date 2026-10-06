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

const props = defineProps<{ current: number; best: number }>();

const chipEl = ref<HTMLElement | null>(null);
const flameEl = ref<HTMLElement | null>(null);
const fireCv = ref<HTMLCanvasElement | null>(null);
const hovering = ref(false);
const pinned = ref(false);
const open = computed(() => hovering.value || pinned.value);
const still = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ── Day pips: the streak against your best, one pip a day (a bar past 14) ──
const PIP_MAX = 14;
const pipTotal = computed(() => Math.max(props.current, props.best, 1));
const usePips = computed(() => pipTotal.value <= PIP_MAX);
const isBest = computed(() => props.current >= props.best && props.current > 1);
// Congratulations that grow with the streak (Ames 2026-10-04).
const cheer = computed(() => {
  const n = props.current;
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
const shownCount = ref(props.current);       // the title's number rolls up on open
let rollRaf = 0;
watch(open, v => {
  cancelAnimationFrame(rollRaf);
  if (!v || still()) { shownCount.value = props.current; return; }
  const t0 = performance.now(), DUR = 420 + Math.min(380, props.current * 30);
  const step = (now: number) => {
    const q = Math.min(1, (now - t0) / DUR), e = 1 - Math.pow(1 - q, 3);
    shownCount.value = Math.round(props.current * e);
    if (q < 1) rollRaf = requestAnimationFrame(step);
  };
  shownCount.value = 0;
  rollRaf = requestAnimationFrame(step);
});

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
    const col = k < 0.22 ? '255,236,170' : k < 0.5 ? '255,176,58' : k < 0.78 ? '255,104,26' : '214,48,18';
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
  if (cv && cv.width !== Math.round(FW * dprOf())) {
    const d = dprOf();
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
  if (still()) return;
  kick = 1.9; wakeFire();
  for (let i = 0; i < 14; i++) spawnBlob(1.6);
  chipEl.value?.classList.remove('nge-streak-chip--stoked');
  void chipEl.value?.offsetWidth;                 // restart the count's bump
  chipEl.value?.classList.add('nge-streak-chip--stoked');
  const r = flameEl.value?.getBoundingClientRect();
  if (r) sparkShower(r.left + r.width / 2, r.top + r.height * 0.55);
}

function sparkShower(cx: number, cy: number) {
  const W = 340, H = 280, OX = W / 2, OY = 40, DUR = 1500;
  const cv = document.createElement('canvas');
  cv.style.cssText = `position:fixed;left:${cx - OX}px;top:${cy - OY}px;width:${W}px;height:${H}px;pointer-events:none;z-index:100000;`;
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }
  const d = dprOf();
  cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
  // The chip sits at the very top of the screen, so the sparks are thrown out
  // and DOWN: a fan under the bar, each one falling under its own gravity.
  const sparks = Array.from({ length: 46 }, () => {
    const a = Math.PI * (0.06 + Math.random() * 0.88);           // a downward fan
    const sp = 90 + Math.random() * 250;
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
  document.removeEventListener('pointerdown', onDocDown, true);
});
</script>

<template>
  <div ref="chipEl" class="nge-streak-chip" :class="{ 'nge-streak-chip--open': open, 'holo-on': pinned }"
       tabindex="0" role="button" :aria-expanded="open" :aria-label="`Editing streak: ${current} days`"
       @pointerenter="onEnter" @pointerleave="onLeave" @focus="onEnter" @blur="onLeave"
       @click="stoke" @keydown="onKey">
    <span class="nge-streak-chip-fire">
      <span ref="flameEl" class="nge-streak-chip-flame">🔥</span>
      <canvas ref="fireCv" class="nge-streak-chip-canvas" aria-hidden="true"></canvas>
    </span>&nbsp;<span class="nge-streak-chip-count">{{ current }}</span>

    <!-- The card. v-if, so every opening is an arrival and runs its entrance once. -->
    <div v-if="open" class="nge-streak-tip" role="tooltip">
      <span class="nge-streak-tip-beam" aria-hidden="true"></span>
      <span class="nge-streak-tip-scan" aria-hidden="true"></span>
      <i class="nge-streak-tip-brk tl" aria-hidden="true"></i><i class="nge-streak-tip-brk tr" aria-hidden="true"></i>
      <i class="nge-streak-tip-brk bl" aria-hidden="true"></i><i class="nge-streak-tip-brk br" aria-hidden="true"></i>
      <div class="nge-streak-tip-title nge-streak-tip-row" style="--i: 0">🔥 <span class="nge-streak-tip-num">{{ shownCount }}</span>-day streak</div>
      <div v-if="usePips" class="nge-streak-tip-pips nge-streak-tip-row" style="--i: 1"
           :title="isBest ? 'Your best streak yet' : `${current} of your best ${best} days`">
        <i v-for="n in pipTotal" :key="n" class="nge-streak-tip-pip" :class="{ 'is-lit': n <= current, 'is-head': n === current }" :style="{ '--n': n }"></i>
      </div>
      <div v-else class="nge-streak-tip-bar nge-streak-tip-row" style="--i: 1" :title="`${current} of your best ${Math.max(current, best)} days`">
        <i :style="{ '--fill': Math.round(current / pipTotal * 100) + '%' }"></i>
      </div>
      <div class="nge-streak-tip-body nge-streak-tip-row" style="--i: 2">{{ cheer }}</div>
      <div v-if="best > current" class="nge-streak-tip-best nge-streak-tip-row" style="--i: 3">Your best: {{ best }} days</div>
      <div v-else-if="current > 1" class="nge-streak-tip-best nge-streak-tip-row" style="--i: 3">🏆 Your best streak yet!</div>
      <div v-else-if="current > 1" class="nge-streak-tip-best nge-streak-tip-row" style="--i: 3">This is your best streak yet! 🏆</div>
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
.nge-streak-chip-fire { position: relative; display: inline-block; }
/* inline-block: a transform does nothing on a plain inline span */
.nge-streak-chip-flame { display: inline-block; transform-origin: 50% 88%; will-change: transform, filter; }
.nge-streak-chip-canvas {
  position: absolute; left: 50%; top: 50%;
  width: 46px; height: 54px;
  margin: -34px 0 0 -23px;                 /* the fire's root sits at the 🔥's base */
  pointer-events: none;
}
/* the count warms with the fire */
.nge-streak-chip-count {
  display: inline-block;
  text-shadow: 0 0 calc(var(--streak-heat) * 10px) rgba(255, 170, 60, calc(var(--streak-heat) * 0.75));
  color: color-mix(in srgb, #f5a623, #ffe2a6 calc(var(--streak-heat) * 45%));
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

/* Reduced motion: the finished card, pips lit, no fire and no sweep. */
@media (prefers-reduced-motion: reduce) {
  .nge-streak-tip, .nge-streak-tip-row, .nge-streak-tip-brk, .nge-streak-tip-bar > i, .nge-streak-chip--stoked .nge-streak-chip-count { animation: none; }
  .nge-streak-tip-brk { opacity: 0.85; transform: translate(calc(var(--bx) * 4px), calc(var(--by) * 4px)); }
  .nge-streak-tip-beam, .nge-streak-tip-scan { display: none; }
  .nge-streak-tip-pip.is-lit { animation: none; background: linear-gradient(90deg, #f5a623, #ffcf7a); box-shadow: 0 0 6px rgba(245, 166, 35, 0.55); }
}
</style>
