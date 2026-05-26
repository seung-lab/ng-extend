<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useMergeReviewStore } from "#src/merge_review/store.js";
import WindowsPanel from "#src/components/merge_review/WindowsPanel.vue";
import DecisionPanel from "#src/components/merge_review/DecisionPanel.vue";
import WelcomeOverlay from "#src/components/merge_review/WelcomeOverlay.vue";

const store = useMergeReviewStore();

// Unique cluster labels of the current window, for digit-key mapping.
function clusterLabels(): number[] {
  const w = store.currentWindow;
  if (!w || !w.tokens || !Array.isArray(w.tokens.labels)) return [];
  return Array.from(new Set(w.tokens.labels))
    .map(Number)
    .sort((a, b) => a - b);
}

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  // Don't steal keys while typing.
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }
  // Let neuroglancer own its keybindings when the viewer is focused.
  if (target && target.closest && target.closest("#neuroglancer-container")) {
    return;
  }
  if (store.showWelcome || !store.bundle) return;

  const k = e.key.toLowerCase();
  // Real-merge verdict
  if (k === "y") store.applyMerge("yes");
  else if (k === "n") store.applyMerge("no");
  else if (k === "s") store.applyMerge("skip");
  else if (k === "u") store.applyMerge("unsure");
  // SPLIT WHICH? — digit keys toggle the per-window cluster buttons.
  // 1 → first cluster, 2 → second, etc.  0 toggles Skip.
  else if (/^[0-9]$/.test(k)) {
    if (k === "0") {
      store.toggleSplitSkip();
    } else {
      const labels = clusterLabels();
      const i = Number(k) - 1;
      if (i < labels.length) store.toggleSplitCluster(labels[i]);
    }
  }
  // Navigation
  else if (k === "arrowright" || k === "enter") store.goNextUndecided();
  else if (k === "arrowleft") store.jumpRow(-1); // BACK = step back
  else if (k === "arrowdown" || k === "j") store.jumpRow(1);
  else if (k === "arrowup" || k === "k") store.jumpRow(-1);
  else return; // not ours — leave default behaviour

  e.preventDefault();
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="merge-review">
    <welcome-overlay v-if="store.showWelcome" />
    <windows-panel />
    <decision-panel />
  </div>
</template>

<style>
@import "../../merge_review/merge_review.css";
</style>
