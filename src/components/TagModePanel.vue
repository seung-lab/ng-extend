<script setup lang="ts">
/**
 * TagModePanel — Scout tag mode.
 *
 * A small floating chooser: center the crosshair on the problem spot, pick a
 * tag type, and a typed flag is dropped at that exact position (plus the
 * selected segment when one is active). Scythes work the open queue from the
 * Cell Library's Tags tab and jump straight to each location.
 */
import { ref, computed } from 'vue';
import { useIssueTagStore, useSegmentAnnotationStore, IssueTagType } from '../store';
import { storeToRefs } from 'pinia';

const emit = defineEmits({ hide: null });
const tagStore = useIssueTagStore();
const { activeSegId } = storeToRefs(useSegmentAnnotationStore());

const note = ref('');
const saving = ref(false);
const flash = ref('');
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Crosshair position in voxel coords (same source the help form uses). */
function viewerPosition(): number[] {
  try {
    const v: any = (window as any)['viewer'];
    const p = v?.navigationState?.position?.value;
    return p ? [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])] : [];
  } catch { return []; }
}

const posLabel = computed(() => {
  const p = viewerPosition();
  return p.length === 3 ? `${p[0]}, ${p[1]}, ${p[2]}` : 'no position';
});

async function drop(tagType: IssueTagType) {
  if (saving.value) return;
  const position = viewerPosition();
  if (position.length !== 3) { showFlash('No crosshair position'); return; }
  saving.value = true;
  const t = await tagStore.add({
    tagType,
    position,
    segId: activeSegId.value || undefined,
    note: note.value.trim() || undefined,
  });
  saving.value = false;
  note.value = '';
  showFlash(t ? (tagType === 'merger' ? '⚑ Merger tagged' : '⚑ Missing branch tagged') : 'Tag failed, try again');
}

function showFlash(msg: string) {
  flash.value = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash.value = ''; }, 1800);
}
</script>

<template>
  <Teleport to="body">
    <div class="nge-tagmode">
      <div class="nge-tagmode-head">
        <span class="nge-tagmode-title">⚑ SCOUT TAG MODE</span>
        <button class="nge-tagmode-close" title="Exit tag mode" @click="emit('hide')">×</button>
      </div>
      <div class="nge-tagmode-hint">
        Center the crosshair on the problem, then tag it. Scythes jump to every open tag from Cell Library, Tags.
      </div>
      <div class="nge-tagmode-pos">crosshair: <b>{{ posLabel }}</b><template v-if="activeSegId"> · seg …{{ activeSegId.slice(-6) }}</template></div>
      <div class="nge-tagmode-actions">
        <button class="nge-tagmode-btn nge-tagmode-btn--merger" :disabled="saving" @click="drop('merger')">
          ⛓ Merger
        </button>
        <button class="nge-tagmode-btn nge-tagmode-btn--branch" :disabled="saving" @click="drop('missing_branch')">
          🌿 Missing branch
        </button>
      </div>
      <input
        v-model="note"
        class="nge-tagmode-note"
        placeholder="Optional note…"
        @keydown.stop @keyup.stop @keypress.stop
      />
      <div v-if="flash" class="nge-tagmode-flash">{{ flash }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.nge-tagmode {
  position: fixed;
  left: 50%;
  bottom: 46px;
  transform: translateX(-50%);
  z-index: 10005;
  width: 320px;
  max-width: calc(100vw - 24px);
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
.nge-tagmode-hint { font-size: 11px; color: rgba(255, 255, 255, 0.5); line-height: 1.4; }
.nge-tagmode-pos { font-size: 11px; color: rgba(255, 255, 255, 0.65); }
.nge-tagmode-pos b { color: #ffb454; font-weight: 600; }
.nge-tagmode-actions { display: flex; gap: 8px; }
.nge-tagmode-btn {
  flex: 1;
  padding: 8px 0;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.nge-tagmode-btn--merger {
  background: rgba(224, 96, 96, 0.12);
  border: 1px solid rgba(224, 96, 96, 0.4);
  color: #ff9d9d;
}
.nge-tagmode-btn--merger:hover { background: rgba(224, 96, 96, 0.22); }
.nge-tagmode-btn--branch {
  background: rgba(96, 192, 96, 0.12);
  border: 1px solid rgba(96, 192, 96, 0.4);
  color: #9de89d;
}
.nge-tagmode-btn--branch:hover { background: rgba(96, 192, 96, 0.22); }
.nge-tagmode-btn:disabled { opacity: 0.5; cursor: default; }
.nge-tagmode-note {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #dde;
  font-size: 12px;
  padding: 6px 9px;
}
.nge-tagmode-note:focus { outline: none; border-color: rgba(245, 209, 66, 0.45); }
.nge-tagmode-flash {
  font-size: 12px;
  color: #f5d142;
  text-align: center;
}
</style>
