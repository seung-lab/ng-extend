<script setup lang="ts">
/**
 * Nurro introduces top bar icons a new player has just received, when no
 * tutorial box is doing it (util/toolbar_staging.ts). A small card under the
 * right end of the top bar, beside the icons it names; it goes by itself.
 */
import { computed, watch } from 'vue';
import { announcement } from '../util/toolbar_staging';
import { getToolbarIconDef } from '../data/toolbar-icons';
// Nurro with a laser pointer: the library's picture for pointing at the interface.
import imgNurro from '../../static/nurro/nurro-laser-teach.png';

const icons = computed(() => (announcement.value?.icons || []).map(id => getToolbarIconDef(id)).filter((d): d is NonNullable<typeof d> => !!d));
let timer: ReturnType<typeof setTimeout> | null = null;
watch(announcement, a => {
  if (timer) clearTimeout(timer);
  if (a) timer = setTimeout(() => { if (announcement.value === a) announcement.value = null; }, 16000);
});
function close() { announcement.value = null; }
/** Profile > Settings, where the player picks which top bar icons show. */
function openSettings() {
  announcement.value = null;
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'settings' } }));
}
</script>

<template>
  <transition name="nge-stage-card">
    <div v-if="announcement" :key="announcement.at" class="ng-extend nge-stage-card" role="status" aria-live="polite">
      <img :src="imgNurro" alt="" class="nge-stage-nurro" />
      <div class="nge-stage-body">
        <div class="nge-stage-who">Nurro</div>
        <p class="nge-stage-text">{{ announcement.text }}</p>
        <div v-if="icons.length" class="nge-stage-icons">
          <span v-for="d in icons" :key="d.id" class="nge-stage-icon" :title="d.label">
            <span v-if="d.svg" v-html="d.svg"></span><template v-else>{{ d.emoji }}</template>
          </span>
        </div>
        <div class="nge-stage-actions">
          <button class="nge-hud-btn nge-stage-ok" @click="close">Got it</button>
          <button v-if="announcement.settingsButton" class="nge-hud-btn nge-hud-btn--quiet nge-stage-settings" @click="openSettings">Profile Settings</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.nge-stage-card {
  position: fixed;
  top: 58px;
  right: 16px;
  z-index: 9400;
  width: 330px;
  max-width: calc(100vw - 32px);
  display: flex;
  gap: 12px;
  padding: 14px 16px 14px 12px;
  border-radius: 10px;
  border: 1px solid rgba(74, 150, 224, 0.4);
  background: rgba(8, 13, 24, 0.96);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 0 40px rgba(74, 150, 224, 0.12);
  color: rgba(226, 238, 251, 0.92);
  font-family: 'Roboto', 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
.nge-stage-nurro { width: 72px; height: 72px; object-fit: contain; flex: none; }
.nge-stage-body { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.nge-stage-who {
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #7ecaff;
}
.nge-stage-text { margin: 0; }
.nge-stage-icons { display: flex; flex-wrap: wrap; gap: 6px; font-size: 20px; }
.nge-stage-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 32px; border-radius: 6px;
  background: rgba(126, 224, 255, 0.08);
  box-shadow: 0 0 0 1px rgba(126, 224, 255, 0.45);
}
.nge-stage-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.nge-stage-card-enter-active { transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
.nge-stage-card-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.nge-stage-card-enter-from, .nge-stage-card-leave-to { opacity: 0; transform: translateY(-10px); }
@media (prefers-reduced-motion: reduce) {
  .nge-stage-card-enter-active, .nge-stage-card-leave-active { transition: opacity 0.2s; }
  .nge-stage-card-enter-from, .nge-stage-card-leave-to { transform: none; }
}
</style>
