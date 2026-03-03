<script setup lang="ts">
import { computed } from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import { useHelpRequestStore, useCellHistoryStore, HelpRequest } from '../store';

const helpStore = useHelpRequestStore();
const historyStore = useCellHistoryStore();
const emit = defineEmits({ hide: null });

const pending  = computed(() => helpStore.requests.filter(r => !r.resolved));
const resolved = computed(() => helpStore.requests.filter(r => r.resolved));

function jumpTo(req: HelpRequest) {
  historyStore.jumpToCell(req.segId, req.position);
  emit('hide');
}

function resolveReq(req: HelpRequest) {
  helpStore.resolve(req.id);
  helpStore.refreshPending();
}

function removeReq(req: HelpRequest) {
  helpStore.remove(req.id);
  helpStore.refreshPending();
}

function truncateId(id: string): string {
  return id.length > 14 ? id.slice(0, 6) + '…' + id.slice(-4) : id;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
</script>

<template>
  <modal-overlay id="nge-help-modal" class="nge-help-modal" @hide="emit('hide')">
    <div class="nge-help-shell">

      <div class="nge-help-topbar">
        <div class="nge-help-title">🔍 Second Opinion Requests</div>
        <button class="nge-help-exit" @click="emit('hide')">×</button>
      </div>

      <div class="nge-help-content">

        <!-- Pending requests -->
        <div class="nge-help-section" v-if="pending.length > 0">
          <div class="nge-help-section-label">Pending ({{ pending.length }})</div>
          <div
            v-for="req in pending"
            :key="req.id"
            class="nge-help-card"
          >
            <div class="nge-help-card-header">
              <span class="nge-help-card-id" @click="jumpTo(req)">
                {{ req.nickname || truncateId(req.segId) }}
              </span>
              <span class="nge-help-card-issue">{{ req.issueType }}</span>
              <span class="nge-help-card-time">{{ relativeTime(req.createdAt) }}</span>
            </div>
            <div class="nge-help-card-note" v-if="req.note">{{ req.note }}</div>
            <div class="nge-help-card-actions">
              <button class="nge-help-action" @click="jumpTo(req)">Jump to cell</button>
              <button class="nge-help-action nge-help-action--resolve" @click="resolveReq(req)">Mark resolved</button>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div class="nge-help-empty" v-if="pending.length === 0 && resolved.length === 0">
          No help requests yet. Select a segment and click "Ask for Second Opinion" in the annotation panel.
        </div>

        <!-- Resolved requests -->
        <div class="nge-help-section nge-help-section--resolved" v-if="resolved.length > 0">
          <div class="nge-help-section-label">Resolved ({{ resolved.length }})</div>
          <div
            v-for="req in resolved"
            :key="req.id"
            class="nge-help-card nge-help-card--resolved"
          >
            <div class="nge-help-card-header">
              <span class="nge-help-card-id" @click="jumpTo(req)">
                {{ req.nickname || truncateId(req.segId) }}
              </span>
              <span class="nge-help-card-issue" v-if="req.issueType">{{ req.issueType }}</span>
              <span class="nge-help-card-time">{{ relativeTime(req.createdAt) }}</span>
              <button class="nge-help-card-remove" @click="removeReq(req)" title="Remove">×</button>
            </div>
            <div class="nge-help-card-note" v-if="req.note">{{ req.note }}</div>
          </div>
        </div>

      </div>
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-help-shell {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}

.nge-help-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  flex-shrink: 0;
}

.nge-help-title {
  font-size: 1.1em;
  font-weight: 700;
  color: #e8ecf4;
}

.nge-help-exit {
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.6em;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}
.nge-help-exit:hover { color: #fff; }

.nge-help-content {
  width: 400px;
  overflow-y: auto;
  padding: 0 16px 20px;
  flex: 1;
  min-height: 0;
}

.nge-help-section-label {
  font-size: 0.72em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #666;
  margin-bottom: 8px;
  margin-top: 4px;
}

.nge-help-card {
  background: rgba(245, 166, 35, 0.04);
  border: 1px solid rgba(245, 166, 35, 0.15);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
}

.nge-help-card--resolved {
  opacity: 0.55;
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.08);
}

.nge-help-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nge-help-card-id {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.85em;
  color: rgba(74, 158, 255, 0.9);
  cursor: pointer;
}
.nge-help-card-id:hover { text-decoration: underline; }

.nge-help-card-issue {
  font-size: 0.72em;
  padding: 1px 7px;
  border-radius: 8px;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid rgba(245, 166, 35, 0.25);
  color: #f5a623;
  font-weight: 600;
}

.nge-help-card-time {
  margin-left: auto;
  font-size: 0.72em;
  color: #666;
}

.nge-help-card-remove {
  background: none;
  border: none;
  color: #666;
  font-size: 1.1em;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.nge-help-card-remove:hover { color: #f66; }

.nge-help-card-note {
  margin-top: 6px;
  font-size: 0.82em;
  color: #bbb;
  line-height: 1.4;
  white-space: pre-wrap;
}

.nge-help-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.nge-help-action {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.25);
  background: rgba(100, 180, 255, 0.06);
  color: #8bf;
  font-size: 0.78em;
  cursor: pointer;
  transition: background 0.12s;
}
.nge-help-action:hover { background: rgba(100, 180, 255, 0.14); }

.nge-help-action--resolve {
  border-color: rgba(127, 255, 136, 0.25);
  background: rgba(127, 255, 136, 0.06);
  color: #7f8;
}
.nge-help-action--resolve:hover { background: rgba(127, 255, 136, 0.14); }

.nge-help-empty {
  text-align: center;
  color: #666;
  font-size: 0.85em;
  padding: 40px 20px;
  line-height: 1.5;
}

.nge-help-section--resolved {
  margin-top: 16px;
}
</style>
