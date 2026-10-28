<script setup lang="ts">
/**
 * A view opened on a dataset this player's CAVE account can't reach (a chat
 * "Open view" link, a shared link) used to show an empty view and nothing
 * more (andrearwen, 2026-10-28: "I see no 2D"). Now a note says why, with a
 * button to ask for access (Ames 2026-10-28). Closing it hides it for that
 * dataset until the next visit.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { currentSegLayerName, findDatasetBySegName, findDatasetByCanonical, canonicalDataset, type DatasetEntry } from '../datasets';
import { datasetAccess } from '../util/dataset_access';
import RequestAccessButton from './RequestAccessButton.vue';
import { needsRetinaFirst } from '../dataset_access_request';

const current = ref<DatasetEntry | undefined>(undefined);
function detect() {
  try {
    const name = currentSegLayerName();
    current.value = findDatasetBySegName(name) ?? findDatasetByCanonical(canonicalDataset(name));
  } catch { current.value = undefined; }
}
let off: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  detect();
  // The viewer arrives after this: watch its layers once it is there.
  timer = setInterval(() => {
    const signal = (window as any).viewer?.layerManager?.layersChanged;
    if (!signal) return;
    if (timer) { clearInterval(timer); timer = null; }
    signal.add(detect);
    off = () => signal.remove(detect);
    detect();
  }, 500);
});
onUnmounted(() => { off?.(); if (timer) clearInterval(timer); });

const closed = ref<Set<string>>(new Set());
const shown = computed(() => {
  const ds = current.value;
  return !!ds && !closed.value.has(ds.id) && datasetAccess(ds.caveDataset) === 'none';
});
function close() {
  if (current.value) closed.value = new Set([...closed.value, current.value.id]);
}
</script>

<template>
  <transition name="nge-noaccess">
    <div v-if="shown && current" class="nge-noaccess" role="status">
      <span class="nge-noaccess-icon" aria-hidden="true">🔒</span>
      <span class="nge-noaccess-text">You don't have access to <b>{{ current.shortLabel || current.label }}</b> yet, so its cells won't load.<template v-if="needsRetinaFirst(current)"> Unlock Level 1 (retina edit access) before moving to {{ current.shortLabel || current.label }}: send your edits from Ask for Edit Access in the menu.</template></span>
      <RequestAccessButton v-if="!needsRetinaFirst(current)" :ds="current" />
      <button type="button" class="nge-noaccess-x" title="Close" aria-label="Close" @click="close">×</button>
    </div>
  </transition>
</template>

<style scoped>
.nge-noaccess {
  position: fixed; left: 50%; top: 96px; transform: translateX(-50%); z-index: 9400;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; max-width: min(640px, calc(100vw - 24px));
  padding: 10px 12px 10px 14px; border-radius: 10px;
  background: rgba(10, 16, 28, 0.95); border: 1px solid rgba(245, 209, 66, 0.45);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; font-size: 14px; color: #dce6f5;
}
.nge-noaccess-icon { font-size: 16px; }
.nge-noaccess-text { flex: 1 1 260px; line-height: 1.4; }
.nge-noaccess-x { font: inherit; font-size: 20px; line-height: 1; padding: 0 4px; background: none; border: none; color: rgba(220, 230, 245, 0.7); cursor: pointer; }
.nge-noaccess-x:hover { color: #fff; }
.nge-noaccess-enter-active, .nge-noaccess-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.nge-noaccess-enter-from, .nge-noaccess-leave-to { opacity: 0; transform: translate(-50%, -8px); }
</style>
