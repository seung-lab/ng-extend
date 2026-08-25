<script setup lang="ts">
/**
 * Mobile welcome sheet.
 *
 * Phones get a curated experience instead of the full proofreading cockpit:
 * this sheet greets mobile visitors, says so honestly, and ferries them to
 * the systems that DO work great on a phone (Cell Library, chat, profile,
 * leaderboard), to two fun explainers (Neuro 101, Connectome 101), and to
 * the share actions.
 *
 * State lives in ExtensionBar (`showMobileWelcome`); the Guide button in the
 * bottom nav reopens it. Actions are emitted upward so ExtensionBar keeps
 * sole ownership of panel visibility. The 101 explainers link out to the
 * existing connectome.quest mobile experiences.
 */
// The neuron glyph, same as the top bar's Cell Library icon. Connectomics,
// not genomics: never the DNA emoji (Amy 2026-08-18).
import { computed, onMounted, onUnmounted, ref } from 'vue';
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
import NeuronGlyph from 'components/NeuronGlyph.vue';

/** loggedIn: after login the systems list becomes interactive links
 *  (tap Profile on the Guide to open the profile panel, etc.).
 *  userName: shown in the signed-in status row so the sheet always says
 *  where you stand — a hidden login button with no explanation reads as
 *  "login is missing" (Amy 2026-08-24).
 *  loginChecked: false until the first stored-token validation settles.
 *  The check is async, so on load loggedIn is briefly false even for a
 *  logged-in visitor; rendering the login button in that window makes it
 *  appear and then vanish a second later (Amy 2026-08-24). Until checked,
 *  the section shows a quiet verifying line instead of either state. */
const props = defineProps<{ show: boolean, loggedIn: boolean, loginChecked?: boolean, userName?: string }>();

/** Greeting matches who's there: a stranger is a citizen, a logged-in
 *  player is greeted by first name (or as a citizen scientist when the
 *  auth server gave us no name) — Amy 2026-08-24. */
const greeting = computed(() => {
  if (!props.loggedIn) return 'Welcome, citizen';
  const first = props.userName?.trim().split(/\s+/)[0];
  return first ? `Welcome, ${first}` : 'Welcome, citizen scientist';
});

const emit = defineEmits<{
  (e: 'hide'): void;
  /** Close the sheet and let identity verification take the stage. */
  (e: 'login'): void;
  (e: 'open', panel: 'cells' | 'chat' | 'profile' | 'leaderboard'): void;
}>();

type PanelId = 'cells' | 'chat' | 'profile' | 'leaderboard';

function openPanel(panel: PanelId) {
  emit('open', panel);
  emit('hide');
}

/** Rendered by the systems list; rows become live links after login. */
const SYSTEMS: { id: PanelId; icon: string; label: string; sub: string }[] = [
  { id: 'cells', icon: '', label: 'Cell Library', sub: 'Browse real neurons in 3D' },
  { id: 'chat', icon: '💬', label: 'Chat', sub: 'Talk with the community' },
  { id: 'profile', icon: '👤', label: 'Profile', sub: 'Your stats and badges' },
  { id: 'leaderboard', icon: '🏆', label: 'Leaderboard', sub: 'Top proofreaders this week' },
];

function dismiss() {
  emit('hide');
}

// ── Spinnable cell ────────────────────────────────────────────────────────
// A tiny rotating neuron (the login box's glyph) at the top of the sheet.
// It idles in a slow spin; dragging spins it directly and a flick leaves
// momentum that eases back to the idle rate (Amy 2026-08-25).
const spinAngle = ref(0);
const IDLE_VEL = 0.35;               // deg per frame ≈ 21°/s
let spinVel = IDLE_VEL;
let spinDragging = false;
let spinLastX = 0;
let spinRaf = 0;
function spinTick() {
  if (!spinDragging) {
    spinAngle.value = (spinAngle.value + spinVel) % 360;
    spinVel += (IDLE_VEL - spinVel) * 0.03;  // momentum eases to idle
  }
  spinRaf = requestAnimationFrame(spinTick);
}
onMounted(() => { spinRaf = requestAnimationFrame(spinTick); });
onUnmounted(() => cancelAnimationFrame(spinRaf));
function spinStart(e: PointerEvent) {
  spinDragging = true;
  spinLastX = e.clientX;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function spinMove(e: PointerEvent) {
  if (!spinDragging) return;
  const dx = e.clientX - spinLastX;
  spinLastX = e.clientX;
  spinAngle.value = (spinAngle.value + dx * 0.6) % 360;
  spinVel = dx * 0.6;
}
function spinEnd() {
  spinDragging = false;
  spinVel = Math.max(-7, Math.min(7, spinVel));
}

// Portal social-proof line. Three candidate copies were wired as an A/B/C
// test with Supabase conversion logging (commit 182be75; schema kept in
// supabase-mobile-welcome-ab.sql) but traffic is too thin to test yet, so
// the strongest line ships fixed — see TODO.md to revive the test.
const PORTAL_LINE = 'People like you have mapped over 40,000 real neurons.';

/* The 101 explainers are the existing connectome.quest mobile experiences. */
function openLearn() {
  window.open('https://connectome.quest/learn.html', '_blank', 'noopener');
}
function openAtlas() {
  window.open('https://connectome.quest/atlas/#top', '_blank', 'noopener');
}

/* Share actions: same targets as the desktop share toast. */
function shareX() {
  const text = 'I am exploring real brain neurons in EyeWire II';
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.origin)}`,
    '_blank', 'noopener');
}
function shareFacebook() {
  // quote= prefills the post text; the link preview itself comes from the
  // page's Open Graph tags (see index.html).
  const quote = 'I am exploring real brain neurons in EyeWire II';
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin)}&quote=${encodeURIComponent(quote)}`,
    '_blank', 'noopener');
}
function shareEmail() {
  const subject = 'Explore real brain neurons in EyeWire II';
  const body = `${window.location.origin}\n`;
  window.location.href =
    `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
</script>

<template>
  <!-- Teleported: .ng-extend's `button { display:inline-block; font:inherit }`
       cascade must not reach the sheet's own components. -->
  <teleport to="body">
  <transition name="nge-mw">
    <div v-if="show" class="nge-mw-blocker" @click.self="dismiss">
      <div class="nge-mw-sheet" role="dialog" aria-label="EyeWire II on mobile">
        <div class="nge-mw-handle"></div>
        <button class="nge-mw-close" @click="dismiss" title="Close">×</button>

        <!-- ── Home ── -->
        <div class="nge-mw-body">
          <div class="nge-mw-spin-stage" aria-hidden="true"
              @pointerdown="spinStart" @pointermove="spinMove"
              @pointerup="spinEnd" @pointercancel="spinEnd">
            <div class="nge-mw-spin" :style="{ transform: `rotateX(8deg) rotateY(${spinAngle}deg)` }">
              <NeuronGlyph />
            </div>
          </div>
          <div class="nge-mw-kicker">MOBILE UPLINK · LIMITED BANDWIDTH</div>
          <h2 class="nge-mw-title">{{ greeting }}</h2>
          <p class="nge-mw-copy">
            The full EyeWire II brain mapping interface needs a bigger
            screen. But your phone still has clearance. Start here:
          </p>

          <button class="nge-mw-learn" @click="openLearn">
            <span class="nge-mw-learn-icon">🧠</span>
            <span class="nge-mw-learn-text">
              <!-- The playful "anyway" is for strangers; players get the tidy title. -->
              <span class="nge-mw-learn-title">{{ loggedIn ? 'What is a brain?' : 'What is a brain anyway?' }}</span>
              <span class="nge-mw-learn-sub">Neuroscience 101</span>
            </span>
            <span class="nge-mw-learn-arrow">›</span>
          </button>
          <button class="nge-mw-learn" @click="openAtlas">
            <span class="nge-mw-learn-icon">🕸️</span>
            <span class="nge-mw-learn-text">
              <span class="nge-mw-learn-title">What is a connectome?</span>
              <span class="nge-mw-learn-sub">The greatest map humans have ever drawn</span>
            </span>
            <span class="nge-mw-learn-arrow">›</span>
          </button>

          <div class="nge-mw-divider"><span>SYSTEMS AVAILABLE ON YOUR PHONE</span></div>

          <!-- Typography before login (systems unlock after auth); once
               logged in each row is a live link into its panel. -->
          <div class="nge-mw-sys-list">
            <component :is="loggedIn ? 'button' : 'div'"
                v-for="sys in SYSTEMS"
                :key="sys.id"
                class="nge-mw-sys"
                :class="{ 'nge-mw-sys--link': loggedIn }"
                @click="loggedIn && openPanel(sys.id)">
              <span class="nge-mw-sys-icon">
                <img v-if="sys.id === 'cells'" :src="neuronIcon" class="nge-mw-neuron-icon" alt="" />
                <template v-else>{{ sys.icon }}</template>
              </span>
              <span class="nge-mw-sys-text">
                <span class="nge-mw-sys-label">{{ sys.label }}<span v-if="loggedIn" class="nge-mw-sys-go"> ›</span></span>
                <span class="nge-mw-sys-sub">{{ sys.sub }}</span>
              </span>
            </component>
          </div>

          <!-- Logged out: the mission invite IS the login path. Logged in:
               an explicit status row instead — the sheet always shows where
               you stand with the login system, never a silent gap. Until
               the token check settles, neither: a quiet verifying line, so
               the login button never flashes in and then vanishes. -->
          <div v-if="!loginChecked" class="nge-mw-verifying">VERIFYING CLEARANCE&hellip;</div>
          <template v-else-if="!loggedIn">
            <div class="nge-mw-divider"><span>CITIZEN SCIENCE MOBILE PORTAL</span></div>
            <p class="nge-mw-invite">{{ PORTAL_LINE }}</p>
            <!-- Straight into the Google auth popup (via nge:request-login in
                 ExtensionBar/LoginModal) — no second Log in tap on the
                 Identity Verification box. -->
            <button class="nge-mw-cta" @click="emit('login')">
              🔐 LOG IN WITH GOOGLE
            </button>
            <div class="nge-mw-cta-sub">Become a citizen scientist · free · full access</div>
          </template>
          <button v-else class="nge-mw-signed" @click="openPanel('profile')">
            ✓ CITIZEN SCIENTIST ON DUTY<template v-if="userName"> · {{ userName.toUpperCase() }}</template>
          </button>

          <div class="nge-mw-divider"><span>RECRUIT MORE SCIENTISTS</span></div>
          <div class="nge-mw-share">
            <button @click="shareX" title="Post to X">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
                <path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.5L4.7 21H1.5l7.5-8.5L1.2 3h6.6l4.5 6zm-1.1 16.2h1.8L7.7 4.7H5.8z"/>
              </svg>
              <span>Post</span>
            </button>
            <button @click="shareFacebook" title="Share to Facebook">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M14 7h3V4h-3c-1.93 0-3.5 1.57-3.5 3.5V10H8v3h2.5v8h3v-8H16l1-3h-3.5V7.5c0-.28.22-.5.5-.5z"/>
              </svg>
              <span>Share</span>
            </button>
            <button @click="shareEmail" title="Email a link">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="1.5"/>
                <path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>
              </svg>
              <span>Email</span>
            </button>
          </div>

          <button class="nge-mw-bypass" @click="dismiss">
            JUST EXPLORING · ENTER THE FULL COCKPIT ›
          </button>
        </div>

      </div>
    </div>
  </transition>
  </teleport>
</template>

<style>
/* No visible scrollbars on the landing box — it still scrolls by touch
   when content overflows a short screen (Amy 2026-08-25). */
.nge-mw-sheet { scrollbar-width: none; -ms-overflow-style: none; }
.nge-mw-sheet::-webkit-scrollbar { display: none; width: 0; height: 0; }

/* Spinnable cell: perspective stage; the glyph coin-spins on Y. */
.nge-mw-spin-stage {
  width: 76px;
  height: 64px;
  margin: 0 auto 2px;
  perspective: 320px;
  touch-action: none;
  cursor: grab;
}
.nge-mw-spin-stage:active { cursor: grabbing; }
.nge-mw-spin {
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  will-change: transform;
  filter: drop-shadow(0 0 10px rgba(24, 207, 255, 0.35));
}

/* Fullscreen on phones: the sheet IS the landing page, not a box floating
   over one (Amy 2026-08-25). The blocker just hosts it edge to edge. */
.nge-mw-blocker {
  position: fixed;
  inset: 0;
  z-index: 10500;
  background: #070d1a;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 0;
  box-sizing: border-box;
}

.nge-mw-sheet {
  position: relative;
  width: 100%;
  max-width: 560px;
  height: 100dvh;
  max-height: 100dvh;
  overflow-y: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: calc(8px + env(safe-area-inset-top)) 18px calc(10px + env(safe-area-inset-bottom));
  border-radius: 0;
  border: none;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(53, 181, 255, 0.10), transparent 60%),
    linear-gradient(180deg, #0b1424 0%, #070d1a 100%);
  color: #dfe9ff;
  font-family: 'Roboto', sans-serif;
}

/* Vertically center the content on tall screens without clipping short
   ones: auto margins inside a scroll container collapse safely. */
.nge-mw-body { margin-top: auto; margin-bottom: auto; }

.nge-mw-handle {
  width: 42px;
  height: 4px;
  border-radius: 2px;
  margin: 2px auto 8px;
  background: rgba(53, 181, 255, 0.4);
  box-shadow: 0 0 8px rgba(53, 181, 255, 0.35);
}

.nge-mw-close {
  position: absolute;
  top: 10px;
  right: 8px;
  width: 40px;
  height: 40px;
  background: none;
  border: none;
  color: rgba(159, 180, 216, 0.8);
  font-size: 24px;
  cursor: pointer;
  line-height: 1;
}

.nge-mw-kicker {
  font-family: 'Orbitron', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2.2px;
  color: rgba(53, 181, 255, 0.85);
  text-shadow: 0 0 8px rgba(53, 181, 255, 0.45);
  margin: 2px 0 4px;
}

.nge-mw-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #f0f6ff;
  margin: 0 0 6px;
}

.nge-mw-copy {
  font-size: 13.5px;
  line-height: 1.45;
  color: #aebfdd;
  margin: 0 0 12px;
}

/* Systems list: pure typography, no chrome. These are not buttons, they
   describe what unlocks after login. */
.nge-mw-sys-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
  margin-bottom: 2px;
  padding: 2px 2px 0;
}

.nge-mw-sys {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.nge-mw-sys-icon {
  font-size: 20px;
  line-height: 1.2;
  flex: 0 0 auto;
  filter: drop-shadow(0 0 6px rgba(53, 181, 255, 0.35));
}
.nge-mw-neuron-icon {
  width: 30px;
  height: 30px;
  vertical-align: middle;
  filter:
    drop-shadow(0 0 5px rgba(53, 181, 255, 0.9))
    drop-shadow(0 0 12px rgba(53, 181, 255, 0.5))
    brightness(1.15);
}
.nge-mw-sys-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.nge-mw-sys-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.8px;
  color: #dfeeff;
  text-shadow: 0 0 10px rgba(53, 181, 255, 0.35);
}
.nge-mw-sys-sub {
  font-size: 11px;
  color: #8fa6cc;
  line-height: 1.35;
}

/* Logged in: the rows are live links into their panels. */
.nge-mw-sys--link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}
.nge-mw-sys--link .nge-mw-sys-label {
  color: rgb(53, 181, 255);
  text-shadow: 0 0 10px rgba(53, 181, 255, 0.5);
}
.nge-mw-sys--link:active .nge-mw-sys-label {
  text-shadow: 0 0 16px rgba(53, 181, 255, 0.9);
}
.nge-mw-sys-go {
  font-family: inherit;
  opacity: 0.8;
}

/* Divider */
.nge-mw-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 11px 0 8px;
}
.nge-mw-divider::before,
.nge-mw-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(53, 181, 255, 0.35), transparent);
}
.nge-mw-divider span {
  font-family: 'Orbitron', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.8px;
  color: rgba(143, 166, 204, 0.85);
  white-space: nowrap;
}

/* Learn rows */
.nge-mw-learn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  margin-bottom: 7px;
  border-radius: 10px;
  background: rgba(9, 17, 32, 0.8);
  border: 1px solid rgba(53, 181, 255, 0.22);
  color: #eaf3ff;
  cursor: pointer;
  text-align: left;
}
.nge-mw-learn:active { border-color: rgba(53, 181, 255, 0.6); }
.nge-mw-learn-icon { font-size: 24px; }
.nge-mw-learn-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.nge-mw-learn-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 13px;
  font-weight: 600;
}
.nge-mw-learn-sub {
  font-size: 11px;
  color: #8fa6cc;
}
.nge-mw-learn-arrow {
  font-size: 22px;
  color: rgba(53, 181, 255, 0.8);
}

/* Share row */
.nge-mw-share {
  display: flex;
  gap: 10px;
}
.nge-mw-share button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 40px;
  border-radius: 9px;
  background: rgba(9, 17, 32, 0.8);
  border: 1px solid rgba(53, 181, 255, 0.28);
  color: #cfe2ff;
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.8px;
  cursor: pointer;
}
.nge-mw-share button:active {
  border-color: rgba(53, 181, 255, 0.65);
  box-shadow: 0 0 12px rgba(53, 181, 255, 0.3);
}

/* Bypass + CTA */
.nge-mw-bypass {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 8px 4px 2px;
  background: none;
  border: none;
  color: rgba(143, 166, 204, 0.75);
  font-family: 'Orbitron', sans-serif;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 1.1px;
  white-space: nowrap;
  cursor: pointer;
}
.nge-mw-bypass:active { color: rgb(53, 181, 255); }



.nge-mw-cta {
  display: block;
  width: 100%;
  margin-top: 11px;
  padding: 11px;
  border-radius: 9px;
  background: linear-gradient(180deg, rgba(53, 181, 255, 0.22), rgba(53, 181, 255, 0.08));
  border: 1px solid rgba(53, 181, 255, 0.55);
  color: #eaf6ff;
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.4px;
  cursor: pointer;
  box-shadow: 0 0 16px rgba(53, 181, 255, 0.18), inset 0 0 14px rgba(53, 181, 255, 0.08);
}
.nge-mw-cta:active { box-shadow: 0 0 22px rgba(53, 181, 255, 0.4); }

.nge-mw-invite {
  font-size: 12.5px;
  line-height: 1.45;
  color: #aebfdd;
  margin: 0;
}

.nge-mw-cta-sub {
  margin-top: 6px;
  text-align: center;
  font-family: 'Orbitron', sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: rgba(143, 166, 204, 0.75);
}

/* Pre-check: quiet placeholder where the login section will land. Sized
   like the signed-in row so the sheet doesn't jump when the check settles. */
.nge-mw-verifying {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 11px;
  padding: 11px;
  border-radius: 9px;
  border: 1px solid rgba(53, 181, 255, 0.18);
  text-align: center;
  color: rgba(143, 166, 204, 0.7);
  font-family: 'Orbitron', sans-serif;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 1.6px;
  animation: nge-mw-verify-pulse 1.4s ease-in-out infinite;
}
@keyframes nge-mw-verify-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}

/* Logged in: status row in the invite's place; tap opens the profile. */
.nge-mw-signed {
  display: block;
  width: 100%;
  margin-top: 11px;
  padding: 10px;
  border-radius: 9px;
  background: rgba(0, 220, 120, 0.06);
  border: 1px solid rgba(0, 220, 120, 0.35);
  color: #b8f5d8;
  font-family: 'Orbitron', sans-serif;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 1.2px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nge-mw-signed:active { box-shadow: 0 0 16px rgba(0, 220, 120, 0.3); }

/* Sheet transition */
.nge-mw-enter-active,
.nge-mw-leave-active { transition: opacity 0.28s ease; }
.nge-mw-enter-active .nge-mw-sheet,
.nge-mw-leave-active .nge-mw-sheet { transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-mw-enter-from,
.nge-mw-leave-to { opacity: 0; }
.nge-mw-enter-from .nge-mw-sheet,
.nge-mw-leave-to .nge-mw-sheet { transform: translateY(60px); }
</style>
