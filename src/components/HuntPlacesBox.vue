<script setup lang="ts">
/**
 * Checking a Hunt made from a proofread cell in the viewer (Ames 2026-10-26:
 * "I need to be able to see the coords marked before we do the hunt"). The
 * Admin Hub covers the viewer, so the editor closes it and this narrow box
 * sits over the view instead: the places, Previous and Next, the finished
 * cell, and Back to the Hunt editor, which reopens the editor as it was.
 */
import { computed, ref } from 'vue';
import { fromEdits, pickedSession, stepPlace, setFinishedCell } from '../util/hunt_from_edits';
import { useDragBox } from '../util/drag_box';
import HuntPlacesList from 'components/HuntPlacesList.vue';

const boxEl = ref<HTMLElement | null>(null);
const { pos, dragging, posStyle, startDrag } = useDragBox('nge_hunt_places_pos', boxEl);
const boxStyle = computed(() => ({ ...posStyle.value, ...(pos.value ? { maxHeight: `calc(100vh - ${Math.round(pos.value.y) + 12}px)` } : {}) }));

const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const session = computed(() => (fromEdits.checking ? pickedSession() : null));
function finished(e: Event) { fromEdits.finished = (e.target as HTMLInputElement).checked; setFinishedCell(fromEdits.history, fromEdits.finished); }
function back() {
  fromEdits.checking = false;
  document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'hunts' } }));
}
</script>

<template>
  <div v-if="session && fromEdits.history" ref="boxEl" class="nge-hpb" :class="{ 'nge-hpb--dragging': dragging }" :style="boxStyle" role="dialog" aria-label="Check the Hunt's places">
    <div class="nge-hpb-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-hpb-title">Check the places</span>
      <span class="nge-hpb-pos">Before {{ day(session.at) }}</span>
    </div>
    <p class="nge-hpb-how">The cell as players will see it. Go to each place and look: take out any that is not a real merger or extension, or add a point in the Mergers or Extensions layer.</p>
    <div class="nge-hpb-steps">
      <button class="nge-hpb-btn" @click="stepPlace(-1)">Previous</button>
      <button class="nge-hpb-btn" @click="stepPlace(1)">Next place</button>
    </div>
    <div class="nge-hpb-list"><HuntPlacesList /></div>
    <label class="nge-hpb-check"><input type="checkbox" :checked="fromEdits.finished" @change="finished" /> Show the finished cell (only you see it)</label>
    <button class="nge-hpb-btn nge-hpb-btn--back" @click="back">Back to the Hunt editor</button>
  </div>
</template>

<style scoped>
.nge-hpb {
  position: fixed; right: 16px; top: 64px; z-index: 9000;
  width: 340px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
  background: rgba(6, 10, 20, 0.95); border: 1px solid rgba(245, 209, 66, 0.45); border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55); backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; font-size: 13px;
}
.nge-hpb-head { display: flex; align-items: baseline; gap: 8px; cursor: grab; user-select: none; touch-action: none; margin: -12px -14px 0; padding: 12px 14px 2px; }
.nge-hpb--dragging .nge-hpb-head { cursor: grabbing; }
.nge-hpb-title { font-size: 16px; font-weight: 600; color: #f5d142; }
.nge-hpb-pos { margin-left: auto; color: rgba(220, 230, 245, 0.7); font-size: 12.5px; }
.nge-hpb-how { margin: 0; line-height: 1.45; color: rgba(220, 230, 245, 0.75); font-size: 12.5px; }
.nge-hpb-steps { display: flex; gap: 6px; }
.nge-hpb-list { max-height: 46vh; overflow-y: auto; padding-right: 4px; }
.nge-hpb-btn { flex: 1; padding: 6px 10px; border-radius: 7px; cursor: pointer; background: rgba(90, 170, 255, 0.12); border: 1px solid rgba(90, 170, 255, 0.45); color: #e6f0ff; font: 600 12.5px 'Inter', sans-serif; }
.nge-hpb-btn:hover, .nge-hpb-btn:focus-visible { background: rgba(90, 170, 255, 0.22); }
.nge-hpb-btn--back { background: rgba(245, 209, 66, 0.16); border-color: rgba(245, 209, 66, 0.65); color: #fff3c4; margin-top: 4px; }
.nge-hpb-btn--back:hover { background: rgba(245, 209, 66, 0.28); }
.nge-hpb-check { display: flex; gap: 6px; align-items: center; color: #a9bbd3; font-size: 12.5px; }
</style>
