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

// Cluster labels present in the current window AFTER manual point edits
// (recolours/deletes), sourced from the store so the buttons stay in sync.
const clusterLabels = computed<number[]>(() => store.splitClusterLabels);
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

// Where the anchor came from: picked in the viewer (A) or adopted from the
// bundle (the pipeline resolved it) — the latter can be re-picked with A.
const anchorText = computed(() =>
  store.anchorOrigin === "bundle" ? "from pipeline" : "picked",
);
const anchorTitle = computed(() =>
  store.anchorSv
    ? `anchor supervoxel ${store.anchorSv}` +
      (store.anchorOrigin === "bundle"
        ? " (resolved by the pipeline — hover the nucleus and press A to override)"
        : "")
    : "",
);

// Server mirror of the decisions (Candela review_decisions): local storage is
// written first, this only says whether the server copy is current.
const SYNC_LABEL: Record<string, string> = {
  idle: "",
  pending: "saving…",
  syncing: "saving…",
  synced: "saved",
  error: "not synced",
};
const syncText = computed(() => SYNC_LABEL[store.decisionsSync.status] ?? "");
const syncTitle = computed(() => {
  const s = store.decisionsSync;
  if (s.status === "error") {
    return `saved in this browser only — Candela sync failed: ${s.error ?? ""}`;
  }
  if (s.status === "synced" && s.lastSyncedAt) {
    return `synced to Candela at ${new Date(s.lastSyncedAt).toLocaleTimeString()}`;
  }
  return "syncing decisions to Candela";
});
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
          title="Highlight the clusters for one side of the split; every cluster you leave un-highlighted becomes the other side.  One Create-split always = two groups.  Skip = defer."
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
              :title="'Highlight cluster ' + lab + ' onto one side of the split'"
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
              title="Seed graphene multicut as a binary split: highlighted clusters → one side (sinks), all remaining clusters → the other side (sources), then activate multicut"
              @click="store.createSplit()"
            >
              ✂ Create split
            </button>
            <button
              v-if="store.canCreateSplit"
              class="btn-create-split"
              title="Queue this split as a BACKGROUND cut — view stays put; the anchor decides the keep side; CAVE processes queued cuts one at a time"
              :disabled="!store.hasAnchor"
              @click="store.enqueueCurrentSplit()"
            >
              ⏱ Queue cut
            </button>
          </template>
          <span v-else class="dim">(no token labels for this window)</span>
        </div>
        <div v-if="hasTokens" class="split-edit-hint">
          Fix points: hover a point in the view, press
          <kbd>X</kbd> to delete it, or a digit
          <kbd>0</kbd>–<kbd>9</kbd> to recolour it to that cluster.
          <button
            v-if="store.hasTokenEdits"
            class="btn-reset-edits"
            title="Undo all manual point edits for this window"
            @click="store.resetTokenEdits()"
          >
            reset edits
          </button>
        </div>
      </div>

      <div class="anchor-row">
        <span>
          Anchor:
          <span v-if="store.hasAnchor" class="anchor-set" :title="anchorTitle">
            set ✓ <span class="dim">({{ anchorText }})</span>
          </span>
          <span v-else class="dim">none — hover the nucleus, press A</span>
          <button v-if="store.hasAnchor" class="btn-reset-edits" @click="store.clearAnchor()">clear</button>
        </span>
        <span
          v-if="syncText"
          class="sync-state"
          :class="'sync-' + store.decisionsSync.status"
          :title="syncTitle"
        >
          {{ syncText }}
        </span>
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

<style scoped>
.anchor-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 6px 0 4px;
  font-size: 12px;
}
.anchor-set {
  color: #2e9e6b;
}
.anchor-row .btn-reset-edits {
  margin-left: 6px;
  background: #444;
  color: #eee;
  border: 1px solid #666;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  cursor: pointer;
}
.sync-state {
  font-size: 10px;
  color: #6b7280;
  white-space: nowrap;
  cursor: help;
}
.sync-synced {
  color: #2e9e6b;
}
.sync-error {
  color: #d0453b;
}
</style>
