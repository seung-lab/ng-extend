<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMergeReviewStore } from "#src/merge_review/store.js";
import { clusterColor } from "#src/merge_review/state.js";
import { useDraggable } from "#src/merge_review/useDraggable.js";

const store = useMergeReviewStore();

const panel = ref<HTMLElement | null>(null);
const header = ref<HTMLElement | null>(null);
useDraggable(panel, header);

const MERGE_BUTTONS = [
  { v: "yes", cls: "v-yes", label: "YES" },
  { v: "no", cls: "v-no", label: "NO" },
  { v: "skip", cls: "v-skip", label: "Skip" },
  { v: "unsure", cls: "v-unsure", label: "Unsure" },
];

const curMeta = computed(() => {
  const w = store.currentWindow;
  if (!w) return "Pick a window from the list →";
  const has_tokens = !!(w.tokens && w.tokens.labels);
  const sp = (w.tokens && w.tokens.spectral) || {};
  const sp_str =
    sp.k != null ? `  k=${sp.k} score=${(sp.score || 0).toFixed(3)}` : "";
  return (
    `W#${w.idx}  center=${w.center_um.map((c) => c.toFixed(1)).join(",")} µm` +
    `  prob=${w.verify_prob == null ? "—" : w.verify_prob.toFixed(3)}` +
    `  ${w.is_suspect ? "SUSPECT" : "non-suspect"}` +
    (has_tokens ? sp_str : "  (no token affinity)")
  );
});

const currentDecision = computed(() =>
  store.currentIdx != null ? store.decisions[store.currentIdx] || {} : {},
);

const mergeValue = computed(
  () => currentDecision.value.merge || currentDecision.value.verdict,
);

// Unique cluster labels present in the current window's tokens.
const clusterLabels = computed<number[]>(() => {
  const w = store.currentWindow;
  if (!w || !w.tokens || !Array.isArray(w.tokens.labels)) return [];
  return Array.from(new Set(w.tokens.labels))
    .map(Number)
    .sort((a, b) => a - b);
});
const hasTokens = computed(() => clusterLabels.value.length > 0);

const selectedClusters = computed<Set<string>>(() => {
  const splitV = currentDecision.value.split;
  return Array.isArray(splitV) ? new Set(splitV.map(String)) : new Set();
});
const splitIsSkip = computed(() => currentDecision.value.split === "skip");

// Notes: locally edited, debounced write-through to the store.
const notes = ref("");
let notesTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => store.currentIdx,
  () => {
    notes.value = currentDecision.value.notes || "";
  },
);
function onNotesInput() {
  if (notesTimer) clearTimeout(notesTimer);
  notesTimer = setTimeout(() => store.setNotes(notes.value), 800);
}
</script>

<template>
  <div
    v-show="store.decisionOpen"
    id="decision-panel"
    ref="panel"
    class="floating-window"
    :class="{ collapsed: store.decisionCollapsed }"
  >
    <div ref="header" class="panel-header">
      <span class="grip">⠿</span>
      <span class="title">{{ curMeta }}</span>
      <button
        class="btn-back"
        title="Step back one window (←)"
        @click="store.jumpRow(-1)"
      >
        ← BACK
      </button>
      <button
        class="btn-next"
        title="Jump to next undecided suspect (→ / Enter)"
        @click="store.goNextUndecided()"
      >
        NEXT →
      </button>
      <button
        class="panel-min"
        title="Minimise"
        @click="store.decisionCollapsed = !store.decisionCollapsed"
      >
        _
      </button>
      <button
        class="panel-close"
        title="Hide (re-open from the top bar)"
        @click="store.decisionOpen = false"
      >
        ×
      </button>
    </div>
    <div class="panel-body">
      <div class="decision-group">
        <span class="dg-label">Real merge?</span>
        <div class="dg-buttons">
          <button
            v-for="b of MERGE_BUTTONS"
            :key="b.v"
            :class="[b.cls, { active: mergeValue === b.v }]"
            @click="store.applyMerge(b.v)"
          >
            {{ b.label }}
          </button>
        </div>
      </div>

      <div class="decision-group">
        <span
          class="dg-label"
          title="Pick which colored clusters should actually be split off (multi-select).  Skip = defer."
          >SPLIT WHICH?</span
        >
        <div class="dg-buttons">
          <template v-if="hasTokens">
            <button
              v-for="lab of clusterLabels"
              :key="lab"
              class="split-cluster-btn"
              :class="{ active: selectedClusters.has(String(lab)) }"
              :style="{ background: clusterColor(lab), borderColor: clusterColor(lab) }"
              :title="'Split off cluster ' + lab"
              @click="store.toggleSplitCluster(lab)"
            >
              C{{ lab }}
            </button>
            <button
              class="v-skip"
              :class="{ active: splitIsSkip }"
              title="Defer this window"
              @click="store.toggleSplitSkip()"
            >
              Skip
            </button>
            <button
              v-if="store.canCreateSplit"
              class="btn-create-split"
              title="Seed the graphene multicut tool: one cluster's annotations become the sinks, the other's the sources, then activate multicut"
              @click="store.createSplit()"
            >
              ✂ Create split
            </button>
          </template>
          <span v-else class="dim">(no token labels for this window)</span>
        </div>
      </div>

      <input
        id="cur-notes"
        v-model="notes"
        type="text"
        placeholder="notes (optional)"
        @input="onNotesInput"
      />
    </div>
  </div>
</template>
