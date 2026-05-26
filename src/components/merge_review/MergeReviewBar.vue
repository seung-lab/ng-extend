<script setup lang="ts">
import { useMergeReviewStore } from "#src/merge_review/store.js";
import { useImport } from "#src/merge_review/useImport.js";

const store = useMergeReviewStore();
const { importBundle, importDecisions } = useImport();

function showWindows() {
  store.windowsOpen = true;
  store.windowsCollapsed = false;
}
function showDecision() {
  store.decisionOpen = true;
  store.decisionCollapsed = false;
}
</script>

<template>
  <div class="merge-review-bar">
    <span class="brand">MERGER FREE</span>
    <button @click="importBundle">↑ Import bundle</button>
    <button @click="importDecisions">↑ Import decisions</button>
    <button :disabled="!store.bundle" @click="store.exportDecisions()">
      ↓ Export decisions
    </button>
    <button class="panel-toggle" title="Re-open the windows panel" @click="showWindows">
      Windows
    </button>
    <button class="panel-toggle" title="Re-open the decision panel" @click="showDecision">
      Decision
    </button>
  </div>
</template>
