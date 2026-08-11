<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { fetchStatus, cancelJob } from "#src/merge_review/mergeQueueClient.js";
import { useMergeReviewStore } from "#src/merge_review/store.js";

interface Row {
  id: number; window_id: string; status: string; approved: number;
  keep_side: string | null; keep_root_id: number | null;
  operation_id: number | null; attempts: number; error: string | null;
}
const store = useMergeReviewStore();
const rows = ref<Row[]>([]);
const note = ref<string>("");
const updated = ref<string>("");
const busy = ref(false);
let timer: number | undefined;
const COLOR: Record<string, string> = {
  queued: "#8a8f98", approved: "#c9a227", validating: "#4b8bd6", running: "#4b8bd6",
  done: "#2e9e6b", failed: "#d0453b", superseded: "#a05fd0", skipped: "#6b7280",
  cancelled: "#6b7280",
};
async function refresh() {
  if (busy.value) return;
  busy.value = true;
  try {
    // One queue per neuron: only this root's jobs.
    const rootId = store.root != null ? String(store.root) : undefined;
    rows.value = (await fetchStatus(rootId)) as unknown as Row[];
    updated.value = new Date().toLocaleTimeString();
  } finally {
    busy.value = false;
  }
}
async function cancel(id: number) {
  note.value = "";
  const res = await cancelJob(id);
  if ("error" in res) note.value = `Job ${id}: ${res.error}`;
  await refresh();
}
// Poll every 2s so status changes (queued → running → done) show promptly.
onMounted(() => { refresh(); timer = window.setInterval(refresh, 2000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="mcq">
    <div class="mcq-head">
      <b>Cut queue</b>
      <span class="mcq-upd">
        <span v-if="updated" class="mcq-ago">updated {{ updated }}</span>
        <button class="mcq-refresh" :class="{ spin: busy }" title="refresh now" @click="refresh">⟳</button>
      </span>
    </div>
    <table class="mcq-tbl">
      <thead>
        <tr><th>#</th><th>win</th><th>status</th><th>keep</th><th>keep root</th><th>op</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.id }}</td><td>{{ r.window_id }}</td>
          <td class="statuscell">
            <span class="dot" :style="{ background: COLOR[r.status] }"></span>{{ r.status }}
            <button
              v-if="r.status === 'queued'"
              class="cancel-btn"
              title="cancel this job"
              @click="cancel(r.id)"
            >✕</button>
          </td>
          <td>{{ r.keep_side ?? "—" }}</td>
          <td class="mono">{{ r.keep_root_id ?? "—" }}</td>
          <td class="mono">{{ r.operation_id ?? "—" }}</td>
        </tr>
        <tr v-if="!rows.length"><td colspan="6" class="empty">queue empty</td></tr>
      </tbody>
    </table>
    <div v-if="note" class="mcq-note">{{ note }}</div>
  </div>
</template>

<style scoped>
.mcq { font-size: 12px; margin: 8px 0; }
.mcq-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.mcq-upd { display: flex; align-items: center; gap: 6px; }
.mcq-ago { color: #6b7280; font-size: 10px; }
.mcq-refresh { background: none; border: none; color: #9aa0b4; cursor: pointer; font-size: 13px; padding: 0 2px; }
.mcq-refresh:hover { color: #e7e9f2; }
.mcq-refresh.spin { animation: mcqspin 0.7s linear infinite; }
@keyframes mcqspin { to { transform: rotate(360deg); } }
.mcq-tbl { width: 100%; border-collapse: collapse; }
.mcq-tbl th, .mcq-tbl td { text-align: left; padding: 2px 6px; border-bottom: 1px solid #2b3142; }
.mcq-tbl th { color: #9aa0b4; }
.statuscell { white-space: nowrap; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.mono { font-family: monospace; font-size: 11px; }
.empty { color: #6b7280; text-align: center; padding: 6px; }
.cancel-btn {
  background: none; border: 1px solid #6b3140; color: #d0453b;
  border-radius: 3px; cursor: pointer; font-size: 10px; line-height: 1;
  padding: 0 4px; margin-left: 6px;
}
.cancel-btn:hover { background: #d0453b; color: #fff; }
.mcq-note { color: #c9a227; font-size: 11px; padding: 3px 6px; }
</style>
