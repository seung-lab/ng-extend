<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import { useHelpRequestStore, useCellHistoryStore, HelpRequest } from '../store';

const helpStore = useHelpRequestStore();
const historyStore = useCellHistoryStore();
const emit = defineEmits({ hide: null });

/** Active segmentation layer name — used to detect cross-dataset requests. */
function currentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('graphene') || url.includes('segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}

// Use a ref (not computed) since window.viewer is not reactive.
// Set on mount so it captures the current dataset at panel open time.
const activeDataset = ref('');

onMounted(() => {
  activeDataset.value = currentDataset();
  // Ensure help store data is fresh from localStorage
  helpStore.refreshPending();
});

function isCrossDataset(req: HelpRequest): boolean {
  return !!req.dataset && !!activeDataset.value && req.dataset !== activeDataset.value;
}

const pending  = computed(() => helpStore.requests.filter(r => !r.resolved));
const resolved = computed(() => helpStore.requests.filter(r => r.resolved));

/** Group pending requests by dataset for sectioned display. */
interface DatasetGroup {
  dataset: string;
  label: string;
  isCurrent: boolean;
  requests: HelpRequest[];
}

const collapsedSections = ref<Set<string>>(new Set());

const pendingByDataset = computed(() => {
  const groups = new Map<string, HelpRequest[]>();
  for (const req of pending.value) {
    const ds = req.dataset || 'Unknown';
    if (!groups.has(ds)) groups.set(ds, []);
    groups.get(ds)!.push(req);
  }
  // Build ordered array: current dataset first, then others
  const result: DatasetGroup[] = [];
  const current = activeDataset.value;
  // Current dataset section first
  if (current && groups.has(current)) {
    result.push({ dataset: current, label: current, isCurrent: true, requests: groups.get(current)! });
    groups.delete(current);
  }
  // Other datasets (collapsed by default)
  for (const [ds, reqs] of groups) {
    const isCurr = !current; // if no active dataset, don't mark any as cross
    result.push({ dataset: ds, label: ds, isCurrent: isCurr, requests: reqs });
    // Auto-collapse non-current sections
    if (current && ds !== current && !collapsedSections.value.has(ds)) {
      collapsedSections.value.add(ds);
    }
  }
  return result;
});

function toggleSection(ds: string) {
  if (collapsedSections.value.has(ds)) collapsedSections.value.delete(ds);
  else collapsedSections.value.add(ds);
}

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

        <!-- Current dataset indicator -->
        <div class="nge-help-current-dataset" v-if="activeDataset">
          Viewing: <strong>{{ activeDataset }}</strong>
        </div>

        <!-- Pending requests grouped by dataset -->
        <template v-if="pendingByDataset.length > 0">
          <div
            v-for="group in pendingByDataset"
            :key="group.dataset"
            class="nge-help-dataset-section"
            :class="{ 'nge-help-dataset-section--cross': !group.isCurrent }"
          >
            <!-- Section header (collapsible) -->
            <div class="nge-help-dataset-header" @click="toggleSection(group.dataset)">
              <span class="nge-help-dataset-arrow" :class="{ 'nge-help-dataset-arrow--collapsed': collapsedSections.has(group.dataset) }">▾</span>
              <span class="nge-help-dataset-name">
                {{ group.label }}
                <span v-if="group.isCurrent" class="nge-help-dataset-current-tag">current</span>
                <span v-else class="nge-help-dataset-other-tag">other dataset</span>
              </span>
              <span class="nge-help-dataset-count">{{ group.requests.length }}</span>
            </div>

            <!-- Collapsible cards -->
            <div v-if="!collapsedSections.has(group.dataset)" class="nge-help-dataset-cards">
              <div
                v-for="req in group.requests"
                :key="req.id"
                class="nge-help-card"
                :class="{ 'nge-help-card--cross': !group.isCurrent }"
              >
                <div class="nge-help-card-header">
                  <span class="nge-help-card-id" @click="jumpTo(req)">
                    {{ req.nickname || truncateId(req.segId) }}
                  </span>
                  <span class="nge-help-card-issue">{{ req.issueType }}</span>
                  <span class="nge-help-card-time">{{ relativeTime(req.createdAt) }}</span>
                </div>
                <div class="nge-help-card-note" v-if="req.note">{{ req.note }}</div>
                <div class="nge-help-card-cross-warn" v-if="!group.isCurrent">
                  ⚠ You're on <strong>{{ activeDataset }}</strong> — this is from {{ group.label }}
                </div>
                <div class="nge-help-card-actions">
                  <button class="nge-help-action" @click="jumpTo(req)">{{ !group.isCurrent ? '⚠ Jump anyway' : 'Jump to cell' }}</button>
                  <button class="nge-help-action nge-help-action--resolve" @click="resolveReq(req)">Mark resolved</button>
                </div>
              </div>
            </div>
          </div>
        </template>

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
              <span v-if="req.dataset" class="nge-help-card-dataset">{{ req.dataset }}</span>
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
  font-size: 1.15em;
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
  width: 480px;
  overflow-y: auto;
  padding: 0 16px 20px;
  flex: 1;
  min-height: 0;
  font-size: 15px;
}

/* ── Dataset-grouped sections ── */
.nge-help-dataset-section {
  margin-bottom: 12px;
}
.nge-help-dataset-section--cross {
  opacity: 0.7;
}

.nge-help-dataset-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(74, 158, 255, 0.04);
  border: 1px solid rgba(74, 158, 255, 0.1);
  cursor: pointer;
  transition: background 0.12s;
  user-select: none;
  margin-bottom: 6px;
}
.nge-help-dataset-header:hover {
  background: rgba(74, 158, 255, 0.08);
}

.nge-help-dataset-arrow {
  font-size: 0.75em;
  color: #667;
  transition: transform 0.15s;
  display: inline-block;
}
.nge-help-dataset-arrow--collapsed {
  transform: rotate(-90deg);
}

.nge-help-dataset-name {
  font-size: 0.88em;
  font-weight: 600;
  color: #bcc;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nge-help-dataset-current-tag {
  font-size: 0.72em;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(127, 255, 136, 0.1);
  border: 1px solid rgba(127, 255, 136, 0.2);
  color: #7f8;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nge-help-dataset-other-tag {
  font-size: 0.72em;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(245, 166, 35, 0.08);
  border: 1px solid rgba(245, 166, 35, 0.15);
  color: rgba(245, 166, 35, 0.7);
  font-weight: 500;
}

.nge-help-dataset-count {
  font-size: 0.78em;
  font-weight: 700;
  color: #778;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  padding: 0 5px;
}

.nge-help-dataset-cards {
  padding-left: 4px;
}

.nge-help-section-label {
  font-size: 0.85em;
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
  font-size: 0.88em;
  color: rgba(74, 158, 255, 0.9);
  cursor: pointer;
}
.nge-help-card-id:hover { text-decoration: underline; }

.nge-help-card-issue {
  font-size: 0.85em;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid rgba(245, 166, 35, 0.25);
  color: #f5a623;
  font-weight: 600;
}

.nge-help-card-time {
  margin-left: auto;
  font-size: 0.85em;
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
  font-size: 0.88em;
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
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.25);
  background: rgba(100, 180, 255, 0.06);
  color: #8bf;
  font-size: 0.92em;
  cursor: pointer;
  transition: background 0.12s;
}
.nge-help-action:hover:not(:disabled) { background: rgba(100, 180, 255, 0.14); }

.nge-help-action--resolve {
  border-color: rgba(127, 255, 136, 0.25);
  background: rgba(127, 255, 136, 0.06);
  color: #7f8;
}
.nge-help-action--resolve:hover { background: rgba(127, 255, 136, 0.14); }

.nge-help-card-dataset {
  font-size: 0.82em;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(100, 180, 255, 0.08);
  border: 1px solid rgba(100, 180, 255, 0.2);
  color: rgba(100, 180, 255, 0.7);
  font-weight: 500;
}

.nge-help-card--cross {
  opacity: 0.7;
  border-color: rgba(255, 152, 0, 0.15);
  background: rgba(255, 152, 0, 0.02);
}

.nge-help-card-cross-warn {
  font-size: 0.88em;
  color: #f5a623;
  margin-top: 4px;
  line-height: 1.4;
}

.nge-help-current-dataset {
  font-size: 0.88em;
  color: #778;
  padding: 4px 0 10px;
  border-bottom: 1px solid rgba(100, 180, 255, 0.08);
  margin-bottom: 10px;
}
.nge-help-current-dataset strong {
  color: rgba(100, 180, 255, 0.8);
}

.nge-help-empty {
  text-align: center;
  color: #666;
  font-size: 0.92em;
  padding: 40px 20px;
  line-height: 1.5;
}

.nge-help-section--resolved {
  margin-top: 16px;
}
</style>
