<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useMergeReviewStore } from "#src/merge_review/store.js";
import { isDecided, splitTagText } from "#src/merge_review/decisions.js";
import { useDraggable } from "#src/merge_review/useDraggable.js";
import type { ReviewWindow } from "#src/merge_review/types.js";

const store = useMergeReviewStore();

const panel = ref<HTMLElement | null>(null);
const header = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
useDraggable(panel, header);

interface Tag {
  cls: string;
  text: string;
  title?: string;
}

function tagsFor(w: ReviewWindow): Tag[] {
  const d = store.decisions[w.idx] || {};
  const tags: Tag[] = [];
  const mergeV = d.merge || d.verdict; // verdict is legacy
  if (mergeV) {
    tags.push({ cls: `verdict-tag ${mergeV}`, text: mergeV.toUpperCase() });
  }
  const splitV = d.split || d.affinity; // affinity is legacy
  const splitTag = splitTagText(splitV);
  if (splitTag) {
    tags.push({
      cls: "verdict-tag affinity-tag",
      text: splitTag.text,
      title: splitTag.title,
    });
  }
  return tags;
}

function probText(w: ReviewWindow): string {
  return w.verify_prob == null ? "—" : w.verify_prob.toFixed(3);
}

const decidedCount = computed(
  () => store.visibleWindows.filter((w) => isDecided(store.decisions[w.idx])).length,
);

// Keep the selected row scrolled into the centre of the list, even if
// the panel was resized down to a few rows tall.
watch(
  () => store.currentIdx,
  () => {
    nextTick(() => {
      const sel = listEl.value?.querySelector(".win-row.selected");
      if (sel) {
        try {
          sel.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
          sel.scrollIntoView();
        }
      }
    });
  },
);
</script>

<template>
  <aside
    v-show="store.windowsOpen"
    id="left-panel"
    ref="panel"
    class="floating-window"
    :class="{ collapsed: store.windowsCollapsed }"
  >
    <div ref="header" class="panel-header">
      <span class="grip">⠿</span>
      <span class="title">Windows</span>
      <button
        class="panel-min"
        title="Minimise (header only)"
        @click="store.windowsCollapsed = !store.windowsCollapsed"
      >
        _
      </button>
      <button
        class="panel-close"
        title="Hide (re-open from the top bar)"
        @click="store.windowsOpen = false"
      >
        ×
      </button>
    </div>
    <div class="panel-body">
      <p class="meta-line">{{ store.meta }}</p>

      <h3>Tab</h3>
      <div id="tab-toggle">
        <button
          :class="{ active: store.currentTab === 'suspect' }"
          @click="store.currentTab = 'suspect'"
        >
          Suspects
        </button>
        <button
          :class="{ active: store.currentTab === 'all' }"
          @click="store.currentTab = 'all'"
        >
          All windows
        </button>
      </div>

      <h3>Filter</h3>
      <label>
        <input type="checkbox" v-model="store.hideDecided" />
        hide decided
      </label>

      <h3>Windows ({{ decidedCount }}/{{ store.visibleWindows.length }})</h3>
      <div id="window-list" ref="listEl">
        <div
          v-for="w of store.visibleWindows"
          :key="w.idx"
          class="win-row"
          :class="{ 'is-suspect': w.is_suspect, selected: store.currentIdx === w.idx }"
          @click="store.selectWindow(w.idx)"
        >
          <span class="idx">#{{ w.idx }}</span>
          <span class="prob">{{ probText(w) }}</span>
          <span
            v-for="(t, i) of tagsFor(w)"
            :key="i"
            :class="t.cls"
            :title="t.title"
            >{{ t.text }}</span
          >
        </div>
        <div v-if="!store.visibleWindows.length" class="empty-list">
          (no matching windows)
        </div>
      </div>
    </div>
  </aside>
</template>
