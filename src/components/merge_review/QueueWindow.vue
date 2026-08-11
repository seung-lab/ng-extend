<script setup lang="ts">
import { ref } from "vue";
import { useDraggable } from "#src/merge_review/useDraggable.js";
import QueueStatusTable from "#src/components/merge_review/QueueStatusTable.vue";
import { useMergeReviewStore } from "#src/merge_review/store.js";

const store = useMergeReviewStore();
const panel = ref<HTMLElement | null>(null);
const header = ref<HTMLElement | null>(null);
useDraggable(panel, header);
const collapsed = ref(false);
</script>

<template>
  <div ref="panel" class="queue-window">
    <div ref="header" class="queue-window-header">
      <span>\u23F1 Cut queue<span v-if="store.root" class="qw-root"> \u00B7 {{ store.root }}</span></span>
      <button class="qw-collapse" :title="collapsed ? 'expand' : 'collapse'" @click="collapsed = !collapsed">
        {{ collapsed ? "\u25B8" : "\u25BE" }}
      </button>
    </div>
    <div v-show="!collapsed" class="queue-window-body">
      <QueueStatusTable />
    </div>
  </div>
</template>

<style scoped>
.queue-window {
  position: fixed;
  right: 12px;
  bottom: 12px;
  width: 340px;
  max-height: 46vh;
  background: #0c0e16;
  color: #e7e9f2;
  border: 1px solid #2b3142;
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  z-index: 30;
  resize: both;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.queue-window-header {
  cursor: move;
  padding: 6px 10px;
  background: #161a26;
  border-bottom: 1px solid #2b3142;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 12px;
  user-select: none;
}
.qw-root {
  color: #9aa0b4;
  font-weight: 400;
  font-size: 11px;
}
.qw-collapse {
  background: none;
  border: none;
  color: #9aa0b4;
  cursor: pointer;
  font-size: 13px;
}
.queue-window-body {
  overflow: auto;
  padding: 4px 8px 8px;
}
</style>
