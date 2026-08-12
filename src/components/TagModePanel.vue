<script setup lang="ts">
/**
 * TagModePanel — Scout tag mode.
 *
 * Pick a tag type (merger subtypes per Amy's taxonomy, or Extension), then
 * either press the Tag button to drop it at the crosshair, or hold T and
 * left-click anywhere in the 2D/3D views to drop it exactly under the
 * cursor (neuroglancer's mouseState carries the data-space position).
 * Optional note, annotation layer, and screenshot ride along. Scythes and
 * Tracers work the open queue from the Cell Library's Tags tab.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useIssueTagStore, useSegmentAnnotationStore, IssueTagType, IssueTagSubtype } from '../store';
import { storeToRefs } from 'pinia';
import ScreenshotDialog from 'components/ScreenshotDialog.vue';

const emit = defineEmits({ hide: null });
const tagStore = useIssueTagStore();
const { activeSegId } = storeToRefs(useSegmentAnnotationStore());

/** One chip per tag kind. Merger subtypes get the fun names; tooltips keep
 *  them intuitive. */
const TAG_CHOICES: { key: string; tagType: IssueTagType; subtype?: IssueTagSubtype; label: string; hint: string }[] = [
  { key: 'snip',     tagType: 'merger', subtype: 'snip',     label: '✂️ Snip',     hint: 'One clean wrong merge, a single cut fixes it' },
  { key: 'hairball', tagType: 'merger', subtype: 'hairball', label: '🧶 Hairball', hint: 'Many cells tangled together, needs patient combing' },
  { key: 'twins',    tagType: 'merger', subtype: 'twins',    label: '👯 Twins',    hint: 'Two somas fused into one body' },
  { key: 'debris',   tagType: 'merger', subtype: 'debris',   label: '🗑 Debris',   hint: 'Junk merged in: glia, vessel, or fragment' },
  { key: 'extension', tagType: 'missing_branch',             label: '🌿 Extension', hint: 'A branch looks truncated, keep growing it' },
];
const LAST_CHOICE_KEY = 'nge_tag_last_choice_v1';
const selected = ref(localStorage.getItem(LAST_CHOICE_KEY) || 'snip');
const selectedChoice = computed(() => TAG_CHOICES.find(c => c.key === selected.value) ?? TAG_CHOICES[0]);
function choose(key: string) {
  selected.value = key;
  try { localStorage.setItem(LAST_CHOICE_KEY, key); } catch {}
}

const note = ref('');
const annotationLayer = ref('');
const screenshotUrl = ref('');
const showScreenshotDialog = ref(false);
const saving = ref(false);
const flash = ref('');
let flashTimer: ReturnType<typeof setTimeout> | null = null;

function annotationLayers(): string[] {
  try {
    const viewer = (window as any)['viewer'];
    return (viewer?.layerManager?.managedLayers ?? [])
      .filter((l: any) => l.layer?.type === 'annotation')
      .map((l: any) => l.name) as string[];
  } catch { return []; }
}

/** Crosshair position (voxel coords), the fallback drop point. */
function crosshairPosition(): number[] {
  try {
    const v: any = (window as any)['viewer'];
    const p = v?.navigationState?.position?.value;
    return p ? [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])] : [];
  } catch { return []; }
}

/** Position under the mouse cursor, when hovering a data view. */
function mousePosition(): number[] {
  try {
    const v: any = (window as any)['viewer'];
    const m = v?.mouseState;
    if (m?.active && m.position?.length >= 3) {
      return [Math.round(m.position[0]), Math.round(m.position[1]), Math.round(m.position[2])];
    }
  } catch {}
  return [];
}

const posLabel = computed(() => {
  const p = crosshairPosition();
  return p.length === 3 ? `${p[0]}, ${p[1]}, ${p[2]}` : 'no position';
});

async function drop(position: number[]) {
  if (saving.value) return;
  if (position.length !== 3) { showFlash('No position under cursor'); return; }
  const c = selectedChoice.value;
  saving.value = true;
  const t = await tagStore.add({
    tagType: c.tagType,
    subtype: c.subtype,
    position,
    segId: activeSegId.value || undefined,
    note: note.value.trim() || undefined,
    annotationLayer: annotationLayer.value || undefined,
    screenshotUrl: screenshotUrl.value || undefined,
  });
  saving.value = false;
  note.value = '';
  screenshotUrl.value = '';
  showFlash(t ? `⚑ ${c.label.replace(/^\S+\s/, '')} tagged` : 'Tag failed, try again');
}

function showFlash(msg: string) {
  flash.value = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash.value = ''; }, 1800);
}

// ── T + left click: drop a tag exactly under the cursor ─────────────────────
// Hold T (tracked on keydown/keyup, ignored while typing in a field) and
// click in any data view. Click is captured BEFORE neuroglancer so the tag
// click doesn't also select a segment.
const tHeld = ref(false);
function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return;
  if (e.key === 't' || e.key === 'T') tHeld.value = true;
  if (e.key === 'Escape') emit('hide');
}
function onKeyUp(e: KeyboardEvent) {
  if (e.key === 't' || e.key === 'T') tHeld.value = false;
}
function onClickCapture(e: MouseEvent) {
  if (!tHeld.value || e.button !== 0) return;
  const pos = mousePosition();
  if (pos.length !== 3) return; // cursor not over a data view — let the click through
  e.preventDefault();
  e.stopPropagation();
  drop(pos);
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('click', onClickCapture, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('click', onClickCapture, true);
});
</script>

<template>
  <Teleport to="body">
    <div class="nge-tagmode">
      <div class="nge-tagmode-head">
        <span class="nge-tagmode-title">⚑ SCOUT TAG MODE</span>
        <button class="nge-tagmode-close" title="Exit tag mode (Esc)" @click="emit('hide')">×</button>
      </div>
      <div class="nge-tagmode-hint">
        Pick a type, then <b>hold T and click</b> the spot in 2D or 3D, or use the
        Tag button to drop at the crosshair.
      </div>
      <div class="nge-tagmode-chips">
        <button
          v-for="c in TAG_CHOICES" :key="c.key"
          class="nge-tagmode-chip"
          :class="{ 'nge-tagmode-chip--active': selected === c.key, 'nge-tagmode-chip--ext': c.key === 'extension' }"
          :title="c.hint"
          @click="choose(c.key)"
        >{{ c.label }}</button>
      </div>
      <input
        v-model="note"
        class="nge-tagmode-note"
        placeholder="Optional note…"
        @keydown.stop @keyup.stop @keypress.stop
      />
      <div class="nge-tagmode-extras">
        <select v-if="annotationLayers().length" v-model="annotationLayer" class="nge-tagmode-select">
          <option value="">No annotation layer</option>
          <option v-for="l in annotationLayers()" :key="l" :value="l">📐 {{ l }}</option>
        </select>
        <button class="nge-tagmode-shot" @click="showScreenshotDialog = true">
          {{ screenshotUrl ? '🖼 Attached ✓' : '📸 Screenshot' }}
        </button>
      </div>
      <div class="nge-tagmode-foot">
        <span class="nge-tagmode-pos">crosshair: <b>{{ posLabel }}</b></span>
        <button class="nge-tagmode-btn" :disabled="saving" @click="drop(crosshairPosition())">
          ⚑ Tag crosshair
        </button>
      </div>
      <div v-if="flash" class="nge-tagmode-flash">{{ flash }}</div>
    </div>
    <screenshot-dialog
      :show="showScreenshotDialog"
      mode="attach"
      @close="showScreenshotDialog = false"
      @attached="p => { screenshotUrl = p.url; showScreenshotDialog = false; }"
    />
  </Teleport>
</template>

<style scoped>
.nge-tagmode {
  position: fixed;
  left: 50%;
  bottom: 46px;
  transform: translateX(-50%);
  z-index: 10005;
  width: 360px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(245, 209, 66, 0.35);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(245, 209, 66, 0.08);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: 'Inter', 'Segoe UI', sans-serif;
}
.nge-tagmode-head { display: flex; align-items: center; }
.nge-tagmode-title {
  flex: 1;
  font-family: 'Orbitron', 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #f5d142;
}
.nge-tagmode-close {
  background: none; border: none; color: #889; font-size: 18px;
  line-height: 1; cursor: pointer; padding: 0 2px;
}
.nge-tagmode-close:hover { color: #fff; }
.nge-tagmode-hint { font-size: 11px; color: rgba(255, 255, 255, 0.55); line-height: 1.45; }
.nge-tagmode-hint b { color: #f5d142; font-weight: 600; }
.nge-tagmode-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.nge-tagmode-chip {
  padding: 5px 10px;
  border-radius: 12px;
  font-size: 12px;
  cursor: pointer;
  background: rgba(224, 96, 96, 0.08);
  border: 1px solid rgba(224, 96, 96, 0.3);
  color: #eaa;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.nge-tagmode-chip--ext {
  background: rgba(96, 192, 96, 0.08);
  border-color: rgba(96, 192, 96, 0.3);
  color: #9d9;
}
.nge-tagmode-chip--active {
  background: rgba(245, 209, 66, 0.16);
  border-color: rgba(245, 209, 66, 0.6);
  color: #ffe9a0;
}
.nge-tagmode-note {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #dde;
  font-size: 12px;
  padding: 6px 9px;
}
.nge-tagmode-note:focus { outline: none; border-color: rgba(245, 209, 66, 0.45); }
.nge-tagmode-extras { display: flex; gap: 8px; }
.nge-tagmode-select {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #dde;
  font-size: 11.5px;
  padding: 5px 7px;
  color-scheme: dark;
}
.nge-tagmode-shot {
  background: rgba(120, 140, 255, 0.1);
  border: 1px solid rgba(120, 140, 255, 0.3);
  border-radius: 6px;
  color: #bcd;
  font-size: 11.5px;
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.nge-tagmode-shot:hover { background: rgba(120, 140, 255, 0.2); }
.nge-tagmode-foot { display: flex; align-items: center; gap: 8px; }
.nge-tagmode-pos { flex: 1; font-size: 11px; color: rgba(255, 255, 255, 0.65); }
.nge-tagmode-pos b { color: #ffb454; font-weight: 600; }
.nge-tagmode-btn {
  padding: 6px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(245, 209, 66, 0.14);
  border: 1px solid rgba(245, 209, 66, 0.45);
  color: #ffe9a0;
}
.nge-tagmode-btn:hover { background: rgba(245, 209, 66, 0.24); }
.nge-tagmode-btn:disabled { opacity: 0.5; cursor: default; }
.nge-tagmode-flash {
  font-size: 12px;
  color: #f5d142;
  text-align: center;
}
</style>
