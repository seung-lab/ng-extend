<script setup lang="ts">
import ExtensionBar from "components/ExtensionBar.vue";
import SplitMergeOverlay from "components/SplitMergeOverlay.vue";
import Tutorial from "components/Tutorial.vue";
import {useLoginStore} from '../store';
import {storeToRefs} from 'pinia';
import {ref, onMounted, onUnmounted} from 'vue';

const { sessions } = storeToRefs(useLoginStore());

// Banner shown when CAVE returns 401 from a write — token expired, user must
// re-authenticate. Triggered by `nge:cave-auth-expired` from lightbulb_service.
const authExpired = ref(false);
const handleAuthExpired = () => { authExpired.value = true; };
onMounted(() => document.addEventListener('nge:cave-auth-expired', handleAuthExpired));
onUnmounted(() => document.removeEventListener('nge:cave-auth-expired', handleAuthExpired));

/** Force a true hard reload that bypasses HTTP cache.
 *  `window.location.reload()` does a "validating" reload — the bundle is
 *  served from cache as long as max-age (600s) hasn't elapsed. We need to
 *  defeat that:
 *    1. Clear any Cache API entries (service worker etc.)
 *    2. Replace the URL with a cache-bust query param so the document is
 *       re-fetched, not validated. The neuroglancer hash state is preserved.
 */
async function hardReload() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* non-critical */ }
  const url = new URL(window.location.href);
  url.searchParams.set('_t', Date.now().toString());
  window.location.replace(url.toString());
}
</script>

<template>
  <div id="vueMain">
    <div class="ng-extend">
      <Tutorial v-if="sessions.length > 0" />
      <ExtensionBar />
    </div>
    <SplitMergeOverlay />
    <div id="content">
      <div id="neuroglancer-container"></div>
    </div>
    <transition name="nge-auth-banner">
      <div v-if="authExpired" class="nge-auth-banner">
        <span class="nge-auth-banner-eye" aria-hidden="true"></span>
        <span class="nge-auth-banner-text">
          <span class="nge-auth-banner-title">Sauron has severed your link to the cave connectome tables</span>
          <span class="nge-auth-banner-sub">Your cell update was not saved.</span>
        </span>
        <button class="nge-auth-banner-btn" @click="hardReload">Refresh</button>
        <button class="nge-auth-banner-close" @click="authExpired = false" title="Dismiss">×</button>
      </div>
    </transition>
  </div>
</template>

<style>
@import "../common.css";
@import "../ng-override.css";
@import "../responsive.css";
@import "../mobile.css";

#vueMain {
  position: relative;
  flex-direction: column;
}

#vueMain>*:not(#content) {
  font-family: 'Roboto', sans-serif;
}

#vueMain>*:not(#content) ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

#app,
#content,
#vueMain {
  display: flex;
  flex: 1;
}

/* ── CAVE auth-expired banner — Mount Doom edition ── */
.nge-auth-banner {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px 12px 16px;
  background:
    radial-gradient(ellipse at 18% 50%, rgba(255, 70, 0, 0.28), transparent 55%),
    radial-gradient(ellipse at 85% 50%, rgba(180, 25, 0, 0.22), transparent 50%),
    linear-gradient(135deg, #1a0500 0%, #2e0a02 50%, #14050a 100%);
  border: 1px solid rgba(255, 110, 30, 0.55);
  border-top: 1px solid rgba(255, 200, 90, 0.35);
  border-radius: 4px;
  color: #ffc196;
  font-family: 'Orbitron', 'Rajdhani', 'Courier New', monospace;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.6px;
  z-index: 10000;
  backdrop-filter: blur(14px) saturate(180%);
  box-shadow:
    0 0 30px rgba(255, 80, 0, 0.35),
    0 0 65px rgba(255, 30, 0, 0.18),
    inset 0 0 22px rgba(255, 60, 0, 0.07),
    0 8px 28px rgba(0, 0, 0, 0.7);
  animation: nge-sauron-flicker 4.5s ease-in-out infinite;
}

/* The Eye of Sauron — pure CSS, vertical slit pupil over a flaming iris */
.nge-auth-banner-eye {
  position: relative;
  width: 30px;
  height: 22px;
  flex: 0 0 auto;
  filter: drop-shadow(0 0 8px rgba(255, 90, 0, 0.85));
}
.nge-auth-banner-eye::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(ellipse 14px 11px at center,
      #ffe28a 0%,
      #ffaa00 30%,
      #ff4400 60%,
      #6a1100 100%);
  box-shadow:
    inset 0 0 6px rgba(255, 220, 120, 0.6),
    0 0 14px rgba(255, 90, 0, 0.7);
}
.nge-auth-banner-eye::after {
  /* Vertical slit pupil */
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 3px;
  height: 14px;
  background: #1a0500;
  border-radius: 2px;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.9);
}

.nge-auth-banner-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  white-space: nowrap;
}
.nge-auth-banner-title {
  text-transform: uppercase;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 1.1px;
  color: #ffd9a3;
  text-shadow:
    0 0 5px rgba(255, 100, 0, 0.85),
    0 0 14px rgba(255, 50, 0, 0.55);
  animation: nge-sauron-pulse 2.6s ease-in-out infinite;
}
.nge-auth-banner-sub {
  font-size: 10.5px;
  letter-spacing: 0.8px;
  color: rgba(255, 170, 130, 0.75);
  text-transform: uppercase;
}

.nge-auth-banner-btn {
  margin-left: 16px;
  padding: 6px 14px;
  background: linear-gradient(180deg, rgba(140, 35, 0, 0.65), rgba(60, 12, 0, 0.7));
  border: 1px solid rgba(255, 120, 40, 0.7);
  border-top-color: rgba(255, 200, 90, 0.6);
  border-radius: 2px;
  color: #ffe6b8;
  font-family: 'Orbitron', 'Rajdhani', 'Courier New', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  cursor: pointer;
  text-shadow: 0 0 6px rgba(255, 100, 0, 0.85);
  box-shadow:
    inset 0 0 10px rgba(255, 70, 0, 0.32),
    0 0 14px rgba(255, 60, 0, 0.45);
  transition: all 0.18s ease-out;
}
.nge-auth-banner-btn:hover {
  background: linear-gradient(180deg, rgba(200, 60, 0, 0.75), rgba(110, 22, 0, 0.78));
  box-shadow:
    inset 0 0 14px rgba(255, 130, 0, 0.45),
    0 0 24px rgba(255, 90, 0, 0.7);
  color: #fff;
  transform: translateY(-1px);
}
.nge-auth-banner-btn:active { transform: translateY(0); }

.nge-auth-banner-close {
  background: transparent;
  border: none;
  color: rgba(255, 170, 110, 0.6);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s, text-shadow 0.15s;
}
.nge-auth-banner-close:hover {
  color: #ffce92;
  text-shadow: 0 0 8px rgba(255, 100, 0, 0.8);
}

@keyframes nge-sauron-flicker {
  0%, 100% {
    box-shadow:
      0 0 30px rgba(255, 80, 0, 0.35),
      0 0 65px rgba(255, 30, 0, 0.18),
      inset 0 0 22px rgba(255, 60, 0, 0.07),
      0 8px 28px rgba(0, 0, 0, 0.7);
  }
  47% {
    box-shadow:
      0 0 38px rgba(255, 110, 20, 0.5),
      0 0 80px rgba(255, 50, 0, 0.28),
      inset 0 0 26px rgba(255, 80, 0, 0.12),
      0 8px 28px rgba(0, 0, 0, 0.7);
  }
  50% {
    box-shadow:
      0 0 22px rgba(255, 60, 0, 0.25),
      0 0 50px rgba(180, 20, 0, 0.12),
      inset 0 0 18px rgba(255, 50, 0, 0.05),
      0 8px 28px rgba(0, 0, 0, 0.7);
  }
}
@keyframes nge-sauron-pulse {
  0%, 100% { text-shadow: 0 0 5px rgba(255, 100, 0, 0.85), 0 0 14px rgba(255, 50, 0, 0.55); }
  50%      { text-shadow: 0 0 9px rgba(255, 140, 30, 1), 0 0 22px rgba(255, 70, 0, 0.75); }
}

.nge-auth-banner-enter-active,
.nge-auth-banner-leave-active { transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-auth-banner-enter-from { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.96); }
.nge-auth-banner-leave-to   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
</style>
