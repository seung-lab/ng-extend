<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useMergeReviewStore } from "#src/merge_review/store.js";
import WindowsPanel from "#src/components/merge_review/WindowsPanel.vue";
import DecisionPanel from "#src/components/merge_review/DecisionPanel.vue";
import WelcomeOverlay from "#src/components/merge_review/WelcomeOverlay.vue";

const store = useMergeReviewStore();

// Unique cluster labels of the current window (after edits), for the
// SPLIT WHICH digit-key mapping.
function clusterLabels(): number[] {
  return store.splitClusterLabels;
}

function isTypingTarget(target: HTMLElement | null): boolean {
  return !!(
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

// Point editing (capture phase): when a token point is hovered in the
// viewer, X deletes it and a digit recolours it to that cluster.  Runs
// before neuroglancer's own keybindings and the bubble handler below;
// only swallows the key when a token is actually hovered, so SPLIT WHICH
// digits and ng shortcuts keep working everywhere else.
function onEditKeyCapture(e: KeyboardEvent) {
  if (store.showWelcome || !store.bundle) return;
  if (isTypingTarget(e.target as HTMLElement | null)) return;
  const k = e.key.toLowerCase();
  const isDigit = /^[0-9]$/.test(k);
  if (k !== "x" && !isDigit) return;
  const acted =
    k === "x"
      ? store.editHoveredToken("x")
      : store.editHoveredToken(Number(k));
  if (acted) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
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
  else if (k === "a") store.setAnchorFromClick();
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

onMounted(() => {
  document.addEventListener("keydown", onEditKeyCapture, true); // capture
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onEditKeyCapture, true);
  document.removeEventListener("keydown", onKeydown);
});
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
