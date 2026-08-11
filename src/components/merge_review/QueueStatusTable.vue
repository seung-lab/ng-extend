<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { QUEUE_API } from "#src/merge_review/mergeQueueClient.js";

interface Row {
  id: number; window_id: string; status: string; approved: number;
  keep_side: string | null; keep_root_id: number | null;
  operation_id: number | null; attempts: number; error: string | null;
}
const rows = ref<Row[]>([]);
let timer: number | undefined;
const COLOR: Record<string, string> = {
  queued: "#8a8f98", approved: "#c9a227", validating: "#4b8bd6", running: "#4b8bd6",
  done: "#2e9e6b", failed: "#d0453b", superseded: "#a05fd0", skipped: "#6b7280",
};
async function refresh() {
  try {
    const r = await fetch(`${QUEUE_API}/status`);
    rows.value = (await r.json()).rows ?? [];
  } catch { /* transient */ }
}
onMounted(() => { refresh(); timer = window.setInterval(refresh, 4000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="mcq">
    <div class="mcq-head"><b>Cut queue</b></div>
    <table class="mcq-tbl">
      <thead>
        <tr><th>#</th><th>win</th><th>status</th><th>keep</th><th>keep root</th><th>op</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.id }}</td><td>{{ r.window_id }}</td>
          <td><span class="dot" :style="{ background: COLOR[r.status] }"></span>{{ r.status }}</td>
          <td>{{ r.keep_side ?? "\u2014" }}</td>
          <td class="mono">{{ r.keep_root_id ?? "\u2014" }}</td>
          <td class="mono">{{ r.operation_id ?? "\u2014" }}</td>
        </tr>
        <tr v-if="!rows.length"><td colspan="6" class="empty">queue empty</td></tr>
      </tbody>
    </table>
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
</style>
