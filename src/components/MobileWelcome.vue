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
 * sole ownership of panel visibility.
 */
import {ref} from 'vue';

defineProps<{ show: boolean }>();

const emit = defineEmits<{
  (e: 'hide'): void;
  /** Close the sheet and let identity verification take the stage. */
  (e: 'login'): void;
  (e: 'open', panel: 'cells' | 'chat' | 'profile' | 'leaderboard'): void;
}>();

type View = 'home' | 'brain' | 'connectome';
const view = ref<View>('home');

function openPanel(panel: 'cells' | 'chat' | 'profile' | 'leaderboard') {
  emit('open', panel);
  emit('hide');
}

function dismiss() {
  view.value = 'home';
  emit('hide');
}

/* Share actions: same targets as the desktop share toast. */
function shareX() {
  const text = 'I am exploring real brain neurons in EyeWire II';
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.origin)}`,
    '_blank', 'noopener');
}
function shareFacebook() {
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin)}`,
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
        <div v-if="view === 'home'" class="nge-mw-body">
          <div class="nge-mw-kicker">MOBILE UPLINK · LIMITED BANDWIDTH</div>
          <h2 class="nge-mw-title">Welcome, scientist</h2>
          <p class="nge-mw-copy">
            The full EyeWire II cockpit, cutting and merging real neurons,
            needs a bigger screen. But your phone still has clearance.
            Start here:
          </p>

          <button class="nge-mw-learn" @click="view = 'brain'">
            <span class="nge-mw-learn-icon">🧠</span>
            <span class="nge-mw-learn-text">
              <span class="nge-mw-learn-title">What is a brain anyway?</span>
              <span class="nge-mw-learn-sub">Neuroscience 101</span>
            </span>
            <span class="nge-mw-learn-arrow">›</span>
          </button>
          <button class="nge-mw-learn" @click="view = 'connectome'">
            <span class="nge-mw-learn-icon">🕸️</span>
            <span class="nge-mw-learn-text">
              <span class="nge-mw-learn-title">What is a connectome?</span>
              <span class="nge-mw-learn-sub">The greatest map humans have ever drawn</span>
            </span>
            <span class="nge-mw-learn-arrow">›</span>
          </button>

          <div class="nge-mw-divider"><span>SYSTEMS AVAILABLE ON YOUR PHONE</span></div>

          <div class="nge-mw-grid">
            <button class="nge-mw-action" @click="openPanel('cells')">
              <span class="nge-mw-action-icon">🧬</span>
              <span class="nge-mw-action-label">Cell Library</span>
              <span class="nge-mw-action-sub">Browse real neurons in 3D</span>
            </button>
            <button class="nge-mw-action" @click="openPanel('chat')">
              <span class="nge-mw-action-icon">💬</span>
              <span class="nge-mw-action-label">Chat</span>
              <span class="nge-mw-action-sub">Talk with the community</span>
            </button>
            <button class="nge-mw-action" @click="openPanel('profile')">
              <span class="nge-mw-action-icon">👤</span>
              <span class="nge-mw-action-label">Profile</span>
              <span class="nge-mw-action-sub">Your stats and badges</span>
            </button>
            <button class="nge-mw-action" @click="openPanel('leaderboard')">
              <span class="nge-mw-action-icon">🏆</span>
              <span class="nge-mw-action-label">Leaderboard</span>
              <span class="nge-mw-action-sub">Top proofreaders this week</span>
            </button>
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

        <!-- ── Neuro 101 ── -->
        <div v-else-if="view === 'brain'" class="nge-mw-body">
          <button class="nge-mw-back" @click="view = 'home'">‹ BACK</button>
          <div class="nge-mw-kicker">NEUROSCIENCE 101</div>
          <h2 class="nge-mw-title">What is a brain anyway?</h2>

          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🌌</span>
            <p>Your head contains a galaxy: about 86 billion neurons,
            tiny cells that carry electricity, wired together more densely
            than any machine humans have ever built.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">⚡</span>
            <p>A neuron looks like a lightning tree. Branches called
            dendrites listen. One long cable, the axon, shouts. The spot
            where two neurons touch is a synapse, and you have about
            100 trillion of them.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🏎️</span>
            <p>Signals race down axons at up to 400 km/h. Every thought,
            memory, and dream you have ever had was neurons flashing in
            patterns, right there in the dark.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">💡</span>
            <p>The whole show runs on about 20 watts. Your brain outperforms
            supercomputers on less power than a refrigerator light bulb.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🔬</span>
            <p>To see this wiring, scientists slice brain tissue thinner than
            1/1000 of a human hair and photograph every slice with electron
            microscopes. Those photos are exactly what you see in EyeWire II.</p>
          </div>

          <button class="nge-mw-cta" @click="openPanel('cells')">
            SEE REAL NEURONS IN THE CELL LIBRARY ›
          </button>
        </div>

        <!-- ── Connectome 101 ── -->
        <div v-else class="nge-mw-body">
          <button class="nge-mw-back" @click="view = 'home'">‹ BACK</button>
          <div class="nge-mw-kicker">CONNECTOME 101</div>
          <h2 class="nge-mw-title">What is a connectome?</h2>

          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🗺️</span>
            <p>A connectome is the complete wiring map of a brain: which
            neuron talks to which, synapse by synapse. It is the most
            detailed map humans have ever tried to draw.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🗄️</span>
            <p>One cubic millimeter of brain, the size of a grain of sand,
            becomes petabytes of microscope images. That is thousands of
            laptops of data for a crumb of cortex.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🤖</span>
            <p>AI traces the neurons through the images first. But AI makes
            mistakes: it glues neurons together or snaps them apart. Someone
            has to check its homework.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🧑‍🚀</span>
            <p>That someone is you. Citizen scientists proofread the map,
            neuron by neuron. EyeWire players have been doing this since
            2012: over 200,000 people helped map the eye, and EyeWire II
            now maps the cortex itself.</p>
          </div>
          <div class="nge-mw-fact">
            <span class="nge-mw-fact-icon">🔓</span>
            <p>Every neuron you help finish becomes open science: data that
            helps researchers understand how brains compute, learn, and
            sometimes break.</p>
          </div>

          <div class="nge-mw-divider"><span>BRING A FRIEND TO THE LAB</span></div>
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
  align-items: flex-end;
  justify-content: center;
}

.nge-mw-sheet {
  position: relative;
  width: 100%;
  max-width: 520px;
  max-height: 88dvh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 10px 20px calc(20px + env(safe-area-inset-bottom));
  border-radius: 18px 18px 0 0;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(53, 181, 255, 0.10), transparent 60%),
    linear-gradient(180deg, #0b1424 0%, #070d1a 100%);
  border-top: 1px solid rgba(53, 181, 255, 0.45);
  box-shadow:
    0 -10px 40px rgba(0, 0, 0, 0.7),
    0 0 30px rgba(53, 181, 255, 0.12),
    inset 0 1px 0 rgba(53, 181, 255, 0.25);
  color: #dfe9ff;
  font-family: 'Roboto', sans-serif;
}

.nge-mw-handle {
  width: 42px;
  height: 4px;
  border-radius: 2px;
  margin: 2px auto 10px;
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
  margin: 4px 0 6px;
}

.nge-mw-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #f0f6ff;
  margin: 0 0 8px;
}

.nge-mw-copy {
  font-size: 14px;
  line-height: 1.5;
  color: #aebfdd;
  margin: 0 0 16px;
}

/* Action grid */
.nge-mw-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 4px;
}

.nge-mw-action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 12px 10px;
  min-height: 84px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(53, 181, 255, 0.09), rgba(53, 181, 255, 0.03));
  border: 1px solid rgba(53, 181, 255, 0.30);
  box-shadow: inset 0 0 14px rgba(53, 181, 255, 0.05);
  color: #eaf3ff;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.nge-mw-action:active {
  border-color: rgba(53, 181, 255, 0.7);
  box-shadow: inset 0 0 18px rgba(53, 181, 255, 0.15), 0 0 14px rgba(53, 181, 255, 0.25);
}
.nge-mw-action-icon { font-size: 22px; }
.nge-mw-action-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.6px;
}
.nge-mw-action-sub {
  font-size: 11px;
  color: #8fa6cc;
  line-height: 1.3;
}

/* Divider */
.nge-mw-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 10px;
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
  padding: 11px 12px;
  margin-bottom: 8px;
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
  height: 44px;
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

/* Bypass + back + CTA */
.nge-mw-bypass {
  display: block;
  width: 100%;
  margin-top: 16px;
  padding: 10px;
  background: none;
  border: none;
  color: rgba(143, 166, 204, 0.75);
  font-family: 'Orbitron', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.6px;
  cursor: pointer;
}
.nge-mw-bypass:active { color: rgb(53, 181, 255); }

.nge-mw-back {
  background: none;
  border: none;
  padding: 4px 0;
  margin-bottom: 4px;
  color: rgba(53, 181, 255, 0.85);
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  cursor: pointer;
}

.nge-mw-fact {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(53, 181, 255, 0.10);
}
.nge-mw-fact:last-of-type { border-bottom: none; }
.nge-mw-fact-icon {
  font-size: 22px;
  flex: 0 0 auto;
  margin-top: 1px;
}
.nge-mw-fact p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: #c4d4ef;
}

.nge-mw-cta {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding: 13px;
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
