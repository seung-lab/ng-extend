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
        <span class="nge-auth-banner-text">Your CAVE session expired — your last save didn't reach the server.</span>
        <button class="nge-auth-banner-btn" @click="window.location.reload()">Refresh to log in again</button>
        <button class="nge-auth-banner-close" @click="authExpired = false" title="Dismiss">×</button>
      </div>
    </transition>
  </div>
</template>

<style>
@import "../common.css";
@import "../ng-override.css";

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

/* ── CAVE auth-expired banner ── */
.nge-auth-banner {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px 12px 22px;
  background: linear-gradient(135deg, rgba(60, 12, 12, 0.95), rgba(80, 20, 20, 0.95));
  border: 1px solid rgba(255, 100, 100, 0.45);
  border-radius: 12px;
  color: #ffd6d6;
  font-size: 13px;
  font-weight: 500;
  z-index: 10000;
  backdrop-filter: blur(12px) saturate(140%);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 80, 80, 0.2);
}
.nge-auth-banner-text { white-space: nowrap; }
.nge-auth-banner-btn {
  padding: 6px 14px;
  background: rgba(255, 100, 100, 0.18);
  border: 1px solid rgba(255, 120, 120, 0.5);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.nge-auth-banner-btn:hover { background: rgba(255, 120, 120, 0.3); }
.nge-auth-banner-close {
  background: transparent;
  border: none;
  color: rgba(255, 220, 220, 0.7);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.nge-auth-banner-close:hover { color: #fff; }
.nge-auth-banner-enter-active,
.nge-auth-banner-leave-active { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-auth-banner-enter-from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
.nge-auth-banner-leave-to   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
</style>
