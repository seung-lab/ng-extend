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
let timer: number | undefined;
const COLOR: Record<string, string> = {
  queued: "#8a8f98", approved: "#c9a227", validating: "#4b8bd6", running: "#4b8bd6",
  done: "#2e9e6b", failed: "#d0453b", superseded: "#a05fd0", skipped: "#6b7280",
  cancelled: "#6b7280",
};
async function refresh() {
  // One queue per neuron: only this root's jobs.
  const rootId = store.root != null ? String(store.root) : undefined;
  rows.value = (await fetchStatus(rootId)) as unknown as Row[];
}
async function cancel(id: number) {
  note.value = "";
  const res = await cancelJob(id);
  if ("error" in res) note.value = `Job ${id}: ${res.error}`;
  await refresh();
}
onMounted(() => { refresh(); timer = window.setInterval(refresh, 4000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="mcq">
    <div class="mcq-head"><b>Cut queue</b></div>
    <table class="mcq-tbl">
      <thead>
        <tr><th>#</th><th>win</th><th>status</th><th>keep</th><th>keep root</th><th>op</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.id }}</td><td>{{ r.window_id }}</td>
          <td><span class="dot" :style="{ background: COLOR[r.status] }"></span>{{ r.status }}</td>
          <td>{{ r.keep_side ?? "\u2014" }}</td>
          <td class="mono">{{ r.keep_root_id ?? "\u2014" }}</td>
          <td class="mono">{{ r.operation_id ?? "\u2014" }}</td>
          <td>
            <button
              v-if="r.status === 'queued'"
              class="cancel-btn"
              title="cancel this job"
              @click="cancel(r.id)"
            >\u2715</button>
          </td>
        </tr>
        <tr v-if="!rows.length"><td colspan="7" class="empty">queue empty</td></tr>
      </tbody>
    </table>
    <div v-if="note" class="mcq-note">{{ note }}</div>
  </div>
</template>

<style scoped>
.mcq { font-size: 12px; margin: 8px 0; }
.mcq-tbl { width: 100%; border-collapse: collapse; }
.mcq-tbl th, .mcq-tbl td { text-align: left; padding: 2px 6px; border-bottom: 1px solid #2b3142; }
.mcq-tbl th { color: #9aa0b4; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.mono { font-family: monospace; font-size: 11px; }
.empty { color: #6b7280; text-align: center; padding: 6px; }
.cancel-btn {
  background: none; border: 1px solid #6b3140; color: #d0453b;
  border-radius: 3px; cursor: pointer; font-size: 10px; line-height: 1;
  padding: 1px 4px;
}
.cancel-btn:hover { background: #d0453b; color: #fff; }
.mcq-note { color: #c9a227; font-size: 11px; padding: 3px 6px; }
</style>
