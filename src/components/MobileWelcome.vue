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
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';

defineProps<{ show: boolean }>();

const emit = defineEmits<{
  (e: 'hide'): void;
  /** Close the sheet and let identity verification take the stage. */
  (e: 'login'): void;
}>();

function dismiss() {
  emit('hide');
}

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
        <!-- A wee brilliant beautiful burst: 2 seconds of sparkle on open,
             then gone. Pure CSS, plays on each mount. -->
        <div class="nge-mw-sparkles" aria-hidden="true"></div>
        <div class="nge-mw-handle"></div>
        <button class="nge-mw-close" @click="dismiss" title="Close">×</button>

        <!-- ── Home ── -->
        <div class="nge-mw-body">
          <div class="nge-mw-kicker">MOBILE UPLINK · LIMITED BANDWIDTH</div>
          <h2 class="nge-mw-title">Welcome, scientist</h2>
          <p class="nge-mw-copy">
            The full EyeWire II brain mapping interface needs a bigger
            screen. But your phone still has clearance. Start here:
          </p>

          <button class="nge-mw-learn" @click="openLearn">
            <span class="nge-mw-learn-icon">🧠</span>
            <span class="nge-mw-learn-text">
              <span class="nge-mw-learn-title">What is a brain anyway?</span>
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

          <!-- Not buttons: these systems unlock after login, this is the
               menu of what a phone can do, set in type not chrome. -->
          <div class="nge-mw-sys-list">
            <div class="nge-mw-sys">
              <span class="nge-mw-sys-icon"><img :src="neuronIcon" class="nge-mw-neuron-icon" alt="" /></span>
              <span class="nge-mw-sys-text">
                <span class="nge-mw-sys-label">Cell Library</span>
                <span class="nge-mw-sys-sub">Browse real neurons in 3D</span>
              </span>
            </div>
            <div class="nge-mw-sys">
              <span class="nge-mw-sys-icon">💬</span>
              <span class="nge-mw-sys-text">
                <span class="nge-mw-sys-label">Chat</span>
                <span class="nge-mw-sys-sub">Talk with the community</span>
              </span>
            </div>
            <div class="nge-mw-sys">
              <span class="nge-mw-sys-icon">👤</span>
              <span class="nge-mw-sys-text">
                <span class="nge-mw-sys-label">Profile</span>
                <span class="nge-mw-sys-sub">Your stats and badges</span>
              </span>
            </div>
            <div class="nge-mw-sys">
              <span class="nge-mw-sys-icon">🏆</span>
              <span class="nge-mw-sys-text">
                <span class="nge-mw-sys-label">Leaderboard</span>
                <span class="nge-mw-sys-sub">Top proofreaders this week</span>
              </span>
            </div>
          </div>

          <button class="nge-mw-cta" @click="emit('login')">
            🔐 LOG IN · FULL ACCESS
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
.nge-mw-blocker {
  position: fixed;
  inset: 0;
  z-index: 10500;
  background: rgba(2, 5, 12, 0.55);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.nge-mw-sheet {
  position: relative;
  width: 100%;
  max-width: 520px;
  max-height: 96dvh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 8px 18px calc(10px + env(safe-area-inset-bottom));
  border-radius: 18px;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(53, 181, 255, 0.10), transparent 60%),
    linear-gradient(180deg, #0b1424 0%, #070d1a 100%);
  border: 1px solid rgba(53, 181, 255, 0.35);
  border-top-color: rgba(53, 181, 255, 0.5);
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.7),
    0 0 30px rgba(53, 181, 255, 0.12),
    inset 0 1px 0 rgba(53, 181, 255, 0.25);
  color: #dfe9ff;
  font-family: 'Roboto', sans-serif;
}

/* Sparkle burst overlay */
.nge-mw-sparkles {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image:
    radial-gradient(2px 2px at 12% 18%, rgba(191, 233, 255, 0.95) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 78% 12%, rgba(53, 181, 255, 0.9) 0%, transparent 100%),
    radial-gradient(1px 1px at 32% 38%, rgba(255, 255, 255, 0.85) 0%, transparent 100%),
    radial-gradient(2px 2px at 88% 42%, rgba(140, 210, 255, 0.85) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 52% 8%, rgba(206, 147, 216, 0.75) 0%, transparent 100%),
    radial-gradient(1px 1px at 8% 62%, rgba(53, 181, 255, 0.8) 0%, transparent 100%),
    radial-gradient(2px 2px at 64% 70%, rgba(191, 233, 255, 0.8) 0%, transparent 100%),
    radial-gradient(1px 1px at 92% 82%, rgba(255, 255, 255, 0.7) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 24% 86%, rgba(140, 210, 255, 0.8) 0%, transparent 100%),
    radial-gradient(1px 1px at 44% 56%, rgba(206, 147, 216, 0.65) 0%, transparent 100%),
    radial-gradient(2px 2px at 70% 28%, rgba(53, 181, 255, 0.85) 0%, transparent 100%),
    radial-gradient(1px 1px at 16% 44%, rgba(255, 255, 255, 0.6) 0%, transparent 100%);
  animation: nge-mw-sparkle-burst 2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes nge-mw-sparkle-burst {
  0%   { opacity: 0;    transform: scale(0.72); filter: brightness(1.4); }
  18%  { opacity: 1; }
  55%  { opacity: 0.65; transform: scale(1.05); filter: brightness(2.4); }
  100% { opacity: 0;    transform: scale(1.22); filter: brightness(1); }
}

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
