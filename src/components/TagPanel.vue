<script setup lang="ts">
/**
 * TagPanel.vue
 * Floats over the viewer when a segment is selected.
 * Shows tag/label status from Supabase and lets users set tags.
 * Uses lightbulb colors: purple = labeled, gray = unlabeled.
 */
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSegmentAnnotationStore, useSegmentTagStore, useProofreadingBackendStore } from '../store';
import { KNOWN_TAGS } from '../widgets/tag_service';

const annotStore = useSegmentAnnotationStore();
const tagStore = useSegmentTagStore();
const backendStore = useProofreadingBackendStore();

const { activeSegId } = storeToRefs(annotStore);
const { tag: tagRecord, loading, error, showPanel } = storeToRefs(tagStore);

const showTagMenu = ref(false);
const customTagInput = ref('');
const savingTag = ref(false);
const savedFlash = ref(false);

const shortId = computed(() => {
  const id = activeSegId.value ?? '';
  return id.length > 12 ? '…' + id.slice(-10) : id;
});

const isLabeled = computed(() => !!tagRecord.value?.tag);

const statusLabel = computed(() => {
  if (loading.value) return 'Loading…';
  if (error.value) return 'Error';
  if (!tagRecord.value) return 'Not in database';
  return tagRecord.value.tag || 'Not yet labeled';
});

// Fetch tag from Supabase whenever the active segment changes
watch(activeSegId, (id) => {
  if (id) tagStore.loadTag(id);
  else tagStore.tag = null;
  showTagMenu.value = false;
}, { immediate: true });

async function pickTag(tagValue: string) {
  if (!activeSegId.value || savingTag.value) return;
  savingTag.value = true;
  showTagMenu.value = false;
  await tagStore.saveTag(activeSegId.value, tagValue, backendStore.userId ?? undefined);
  savingTag.value = false;
  flash();
}

async function saveCustomTag() {
  const val = customTagInput.value.trim();
  if (!val) return;
  await pickTag(val);
  customTagInput.value = '';
}

async function handleClearTag() {
  if (!activeSegId.value || savingTag.value) return;
  savingTag.value = true;
  await tagStore.removeTag(activeSegId.value);
  savingTag.value = false;
  flash();
}

function flash() {
  savedFlash.value = true;
  setTimeout(() => savedFlash.value = false, 1200);
}

function copyId() {
  if (activeSegId.value) navigator.clipboard.writeText(activeSegId.value);
}

function dismiss() {
  tagStore.showPanel = false;
}
</script>

<template>
  <div class="nge-tag-panel" v-if="activeSegId && showPanel">
    <!-- Header -->
    <div class="nge-tag-header">
      <span class="nge-tag-icon">💡</span>
      <span class="nge-tag-title">Segment</span>
      <span class="nge-tag-id" :title="activeSegId ?? ''">{{ shortId }}</span>
      <button class="nge-tag-copy" @click="copyId" title="Copy full ID">📋</button>
      <span class="nge-tag-saved" v-if="savedFlash">✓ Saved</span>
      <button class="nge-tag-close" @click="dismiss" title="Close">×</button>
    </div>

    <div class="nge-tag-divider" />

    <!-- Status row -->
    <div class="nge-tag-row">
      <span class="nge-tag-label">Status</span>
      <span class="nge-tag-status" :class="{
        'nge-tag-status--labeled':   isLabeled,
        'nge-tag-status--unlabeled': tagRecord && !tagRecord.tag && !loading,
        'nge-tag-status--loading':   loading,
        'nge-tag-status--error':     error,
        'nge-tag-status--unknown':   !tagRecord && !loading && !error,
      }">{{ statusLabel }}</span>
    </div>

    <div class="nge-tag-divider" />

    <!-- Tag selector -->
    <div class="nge-tag-row nge-tag-row--type">
      <span class="nge-tag-label">Tag</span>
      <div class="nge-tag-type-wrap">
        <button
          class="nge-tag-type-toggle"
          :class="{ 'nge-tag-type-toggle--open': showTagMenu }"
          @click="showTagMenu = !showTagMenu"
          :disabled="loading"
        >
          {{ savingTag ? 'Saving…' : (tagRecord?.tag || 'Choose tag…') }}
          <span class="nge-tag-chevron">▾</span>
        </button>
        <!-- Tag dropdown -->
        <div class="nge-tag-type-menu" v-if="showTagMenu">
          <button
            v-for="t in KNOWN_TAGS"
            :key="t"
            class="nge-tag-type-item"
            :class="{ 'nge-tag-type-item--active': tagRecord?.tag === t }"
            @click="pickTag(t)"
          >{{ t }}</button>
          <div class="nge-tag-type-divider" />
          <div class="nge-tag-type-custom">
            <input
              v-model="customTagInput"
              class="nge-tag-type-input"
              placeholder="Custom tag…"
              @keydown.enter="saveCustomTag"
            />
            <button class="nge-tag-btn nge-tag-btn--small" @click="saveCustomTag">Save</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Clear tag button (if labeled) -->
    <div class="nge-tag-row nge-tag-row--actions" v-if="isLabeled">
      <button
        class="nge-tag-btn nge-tag-btn--ghost"
        :disabled="savingTag"
        @click="handleClearTag"
      >Clear Tag</button>
    </div>

    <!-- Error notice -->
    <div class="nge-tag-error" v-if="error">
      ⚠ {{ error }}
    </div>
  </div>
</template>

<style scoped>
.nge-tag-panel {
  position: fixed;
  bottom: 48px;
  left: 16px;
  width: 320px;
  background: rgba(18, 22, 30, 0.97);
  border: 1px solid rgba(100, 180, 255, 0.25);
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6),
              0 0 0 1px rgba(100, 180, 255, 0.08);
  z-index: 500;
  font-size: 15px;
  color: #cdd;
  backdrop-filter: blur(8px);
  animation: nge-tag-slide-in 0.18s ease;
}

@keyframes nge-tag-slide-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Header ── */
.nge-tag-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 8px 12px;
}

.nge-tag-icon { font-size: 18px; }

.nge-tag-title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(100, 180, 255, 0.7);
  font-weight: 600;
}

.nge-tag-id {
  font-family: monospace;
  font-size: 13px;
  color: #8bf;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nge-tag-copy {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.5;
  padding: 0 2px;
  line-height: 1;
}
.nge-tag-copy:hover { opacity: 1; }

.nge-tag-saved {
  font-size: 12px;
  color: #7f8;
  animation: nge-tag-fade 1.2s ease forwards;
}
@keyframes nge-tag-fade {
  0%   { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}

.nge-tag-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: #888;
  padding: 0 2px;
}
.nge-tag-close:hover { color: #fff; }

.nge-tag-divider {
  height: 1px;
  background: rgba(100, 180, 255, 0.12);
  margin: 0 12px;
}

/* ── Rows ── */
.nge-tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 36px;
}

.nge-tag-label {
  font-size: 13px;
  color: #778;
  min-width: 50px;
}

/* ── Status (lightbulb colors) ── */
.nge-tag-status {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
}
.nge-tag-status--labeled   { color: #CE93D8; }
.nge-tag-status--unlabeled { color: #aaa; }
.nge-tag-status--loading   { color: #778; font-style: italic; }
.nge-tag-status--error     { color: #f88; }
.nge-tag-status--unknown   { color: #667; font-style: italic; }

/* ── Buttons ── */
.nge-tag-btn {
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.3);
  background: rgba(100, 180, 255, 0.08);
  color: #8bf;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.nge-tag-btn:hover:not(:disabled) {
  background: rgba(100, 180, 255, 0.18);
  color: #adf;
}
.nge-tag-btn:disabled { opacity: 0.4; cursor: default; }
.nge-tag-btn--small { padding: 3px 8px; }
.nge-tag-btn--ghost {
  background: none;
  border-color: rgba(255, 255, 255, 0.15);
  color: #888;
}
.nge-tag-btn--ghost:hover:not(:disabled) { color: #bbb; background: rgba(255,255,255,0.04); }

/* ── Tag selector ── */
.nge-tag-row--type { align-items: flex-start; }
.nge-tag-row--actions { justify-content: flex-end; padding-top: 0; }

.nge-tag-type-wrap {
  position: relative;
  flex: 1;
}

.nge-tag-type-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(100, 180, 255, 0.25);
  background: rgba(100, 180, 255, 0.06);
  color: #aac;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}
.nge-tag-type-toggle:hover:not(:disabled) { background: rgba(100, 180, 255, 0.14); }
.nge-tag-type-toggle--open { border-color: rgba(100, 180, 255, 0.5); }

.nge-tag-chevron { opacity: 0.5; margin-left: 6px; }

.nge-tag-type-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 4px);
  width: 100%;
  background: #1a1f2a;
  border: 1px solid rgba(100, 180, 255, 0.25);
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.6);
  z-index: 600;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
}

.nge-tag-type-item {
  display: block;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: none;
  color: #bcc;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.nge-tag-type-item:hover { background: rgba(100,180,255,0.1); color: #fff; }
.nge-tag-type-item--active { color: #CE93D8; font-weight: 600; }

.nge-tag-type-divider { height: 1px; background: rgba(100,180,255,0.1); margin: 4px 0; }

.nge-tag-type-custom {
  display: flex;
  gap: 6px;
  padding: 6px 10px;
}

.nge-tag-type-input {
  flex: 1;
  padding: 4px 9px;
  border-radius: 4px;
  border: 1px solid rgba(100,180,255,0.25);
  background: rgba(255,255,255,0.05);
  color: #cdd;
  font-size: 13px;
  outline: none;
}
.nge-tag-type-input:focus { border-color: rgba(100,180,255,0.5); }

/* ── Error ── */
.nge-tag-error {
  padding: 6px 12px 10px;
  font-size: 12px;
  color: #f88;
  opacity: 0.8;
}
</style>
