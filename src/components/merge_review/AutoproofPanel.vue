<script setup lang="ts">
// Submit a root id to the auto-proofread pipeline, watch the job run, and load
// its candidates into the review.  Full mode lives in the welcome overlay (the
// primary way to start a review); compact mode sits in the top bar and follows
// the loaded neuron's root.  All state and actions live in the store — this
// component only renders `store.autoproof`.
import { computed, onMounted, ref, watch } from "vue";
import { useMergeReviewStore } from "#src/merge_review/store.js";
import { isAutoproofTerminal } from "#src/merge_review/autoproofClient.js";

defineProps<{ compact?: boolean }>();

const store = useMergeReviewStore();
const ap = computed(() => store.autoproof);

const text = ref("");

// Same palette as QueueStatusTable's COLOR map.
const COLOR: Record<string, string> = {
  idle: "#6b7280",
  submitting: "#4b8bd6",
  QUEUED: "#8a8f98",
  PREPROC_RUNNING: "#4b8bd6",
  PREPROC_DONE: "#c9a227",
  INFER_RUNNING: "#4b8bd6",
  DONE: "#2e9e6b",
  FAILED: "#d0453b",
  CANCELLED: "#6b7280",
};
const LABEL: Record<string, string> = {
  idle: "idle",
  submitting: "submitting…",
  QUEUED: "queued",
  PREPROC_RUNNING: "preprocessing",
  PREPROC_DONE: "preprocessed",
  INFER_RUNNING: "inferring",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const dotColor = computed(() => COLOR[ap.value.status] ?? "#8a8f98");
const statusLabel = computed(
  () => LABEL[ap.value.status] ?? ap.value.status.toLowerCase(),
);
const shortJob = computed(() =>
  ap.value.jobId ? ap.value.jobId.slice(0, 8) : "",
);
// Per-status counts across the job's roots.  For a single-root job they only
// repeat the status, so they show once the job has more than one root.
const countsText = computed(() => {
  const c = ap.value.counts;
  const keys = Object.keys(c).sort();
  const total = keys.reduce((s, k) => s + c[k], 0);
  if (total <= 1) return "";
  return keys
    .map((k) => `${LABEL[k] ?? k.toLowerCase()} ${c[k]}`)
    .join(" · ");
});
// A submit is in flight or a job is still running: lock the input so Enter
// pressed twice cannot queue the same root twice.
const running = computed(
  () =>
    ap.value.status === "submitting" ||
    (ap.value.jobId != null && !isAutoproofTerminal(ap.value.status)),
);
const canCancel = computed(
  () =>
    ap.value.jobId != null &&
    ap.value.status !== "submitting" &&
    !isAutoproofTerminal(ap.value.status),
);
const canLoad = computed(
  () => ap.value.status === "DONE" && !ap.value.resultsLoaded,
);
const showStatus = computed(
  () =>
    ap.value.status !== "idle" ||
    ap.value.jobId != null ||
    ap.value.error != null,
);
const updatedText = computed(() =>
  ap.value.updatedAt ? new Date(ap.value.updatedAt).toLocaleTimeString() : "",
);

function run() {
  if (running.value) return;
  const t = text.value.trim();
  if (!t) return;
  void store.submitAutoproof(t);
}

// Re-submit the root the failed job was for (falls back to the input).
function retry() {
  if (running.value) return;
  const rid = ap.value.rootId ?? text.value.trim();
  if (!rid) return;
  text.value = rid;
  void store.submitAutoproof(rid);
}

// Prefill only: the loaded neuron's root, else the root of the job the store
// already tracks.  Resuming a root's job is the store's business — its root
// watcher does it with the live-job guard, and submitAutoproof picks an
// existing job up before submitting — so this component never calls
// resumeAutoproof itself (a remount with a root set would otherwise bypass
// that guard and kill the poll of a still-running job for another root).
onMounted(() => {
  text.value = String(store.root ?? ap.value.rootId ?? "");
});

// Follow the loaded neuron: prefill with the bundle's root whenever it changes
// (the store's own watcher takes care of resuming that root's job).
watch(
  () => store.root,
  (r) => {
    if (r != null) text.value = String(r);
  },
);
</script>

<template>
  <div class="ap" :class="compact ? 'ap-compact' : 'ap-full'">
    <form class="ap-form" @submit.prevent="run">
      <input
        v-model="text"
        class="ap-input"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        placeholder="root id, e.g. 864691135271970725"
        title="root id to auto-proofread — Enter to run"
        :disabled="running"
      />
      <button
        type="submit"
        class="ap-run"
        :disabled="running || !text.trim()"
        title="submit this root to the auto-proofread pipeline"
      >
        Run auto-proofread
      </button>
    </form>
    <div v-if="showStatus" class="ap-status">
      <span class="ap-dot" :style="{ background: dotColor }"></span>
      <span class="ap-state">{{ statusLabel }}</span>
      <span v-if="ap.jobId" class="ap-mono" :title="`job ${ap.jobId}`">
        job {{ shortJob }}
      </span>
      <!-- Compact mode follows the loaded neuron, so the root is only shown
           when the tracked job is for a DIFFERENT root than the one loaded
           (the store keeps following a live job across a bundle import). -->
      <span
        v-if="ap.rootId && (!compact || ap.rootId !== String(store.root ?? ''))"
        class="ap-mono"
        :title="compact ? 'this job is for a different root than the loaded neuron' : ''"
      >
        root {{ ap.rootId }}
      </span>
      <span v-if="countsText" class="ap-counts">{{ countsText }}</span>
      <button
        v-if="canCancel"
        type="button"
        class="ap-btn ap-cancel"
        title="cancel the queued job (a root already running finishes on its own)"
        @click="store.cancelAutoproof()"
      >
        Cancel
      </button>
      <button
        v-if="canLoad"
        type="button"
        class="ap-btn ap-load"
        :title="`load candidates for root ${ap.rootId} (replaces the current bundle)`"
        @click="store.loadAutoproofResults()"
      >
        Load results
      </button>
      <button
        v-if="ap.status === 'FAILED'"
        type="button"
        class="ap-btn"
        title="submit the same root again"
        @click="retry"
      >
        Retry
      </button>
      <span v-if="!compact && updatedText" class="ap-upd">
        updated {{ updatedText }}
      </span>
    </div>
    <div v-if="ap.error" class="ap-error" :title="ap.error">{{ ap.error }}</div>
  </div>
</template>

<style scoped>
.ap {
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px;
  color: #ddd;
}
.ap-full {
  margin: 0 0 14px;
  padding: 10px 12px;
  background: #17181c;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
}
.ap-form {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ap-input {
  flex: 1 1 auto;
  min-width: 0;
  background: #222;
  color: #eee;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 5px 8px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
}
.ap-input:focus {
  outline: none;
  border-color: #5577aa;
}
.ap-input:disabled {
  opacity: 0.6;
}
.ap-run {
  background: #2a8a3a;
  color: #fff;
  border: 1px solid #4caf50;
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
}
.ap-run:hover:not(:disabled) {
  background: #3aaa4a;
}
.ap-run:disabled {
  opacity: 0.55;
  cursor: default;
}
.ap-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  font-size: 11px;
  color: #cfd2db;
}
.ap-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.ap-state {
  font-weight: 600;
}
.ap-mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: #9aa0b4;
}
.ap-counts {
  color: #9aa0b4;
}
.ap-upd {
  color: #6b7280;
  font-size: 10px;
  margin-left: auto;
}
.ap-btn {
  background: #383b46;
  color: #eee;
  border: 1px solid #555;
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.ap-btn:hover {
  background: #4a4d58;
}
.ap-cancel {
  border-color: #6b3140;
  color: #f28b82;
}
.ap-cancel:hover {
  background: #d0453b;
  border-color: #d0453b;
  color: #fff;
}
.ap-load {
  background: #2a4a7a;
  border-color: #5577aa;
  color: #fff;
}
.ap-load:hover {
  background: #3a5a8a;
}
.ap-error {
  margin-top: 4px;
  color: #f28b82;
  font-size: 11px;
  word-break: break-word;
}

/* Compact: a single row inside the 40px top bar. */
.ap-compact {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ap-compact .ap-input {
  flex: 0 0 auto;
  width: 190px;
  padding: 4px 6px;
  font-size: 11px;
}
.ap-compact .ap-run {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
}
.ap-compact .ap-status {
  margin-top: 0;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.ap-compact .ap-error {
  margin-top: 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
