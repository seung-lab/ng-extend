<script setup lang="ts">
/**
 * AccessReviewBar: reviewing one access request in the view (Ames,
 * 2026-10-16: "review all the points the player placed in game and give
 * feedback per point"). The example's view is loaded behind it; each
 * Multicut point can be flown to and marked good or off, the example marked
 * good or redo, with a note. Next and Back step through the ten. Marks are
 * saved at once but reach the player only when the reviewer sends the
 * answer from the Admin Hub (AccessRequestsTab).
 */
import { ref, computed, watch } from 'vue';
import { reviewing, reviewAccessItem, openExample, flyTo, backToRequests, pointName, type AccessItem } from '../access_request';
import { useDragBox } from '../util/drag_box';

const boxEl = ref<HTMLElement | null>(null);
const { dragging, posStyle, startDrag } = useDragBox('nge_access_review_pos', boxEl);
const busy = ref(false);
const error = ref('');
const feedback = ref('');
const saved = ref('');

const request = computed(() => reviewing.value?.request ?? null);
const index = computed(() => reviewing.value?.index ?? 0);
const items = computed(() => request.value?.items ?? []);
const item = computed<AccessItem | null>(() => items.value[index.value] ?? null);
const canMark = computed(() => request.value?.status === 'submitted');
watch(item, it => { feedback.value = it?.feedback ?? ''; saved.value = ''; error.value = ''; }, { immediate: true });

const points = computed(() => {
  const it = item.value;
  if (!it) return [];
  const out: { key: string; color: 'red' | 'blue' | 'merge'; n: string; position: number[] }[] = [];
  for (const color of ['red', 'blue', 'merge'] as const) (it.points[color] ?? []).forEach((p, i) => out.push({ key: `${color}:${i}`, color, n: pointName(color, i), position: p.position }));
  return out;
});

async function save(patch: Parameters<typeof reviewAccessItem>[1]) {
  const it = item.value;
  if (!it?.id) return;
  busy.value = true; error.value = '';
  try { Object.assign(it, await reviewAccessItem(it.id, patch)); saved.value = 'Saved'; }
  catch (e: any) { error.value = e?.message || 'That was not saved.'; }
  finally { busy.value = false; }
}
function markPoint(key: string, mark: 'good' | 'off') {
  const it = item.value;
  if (!it) return;
  const marks = { ...(it.point_marks ?? {}) };
  if (marks[key] === mark) delete marks[key]; else marks[key] = mark;
  void save({ pointMarks: marks });
}
/** Every point of this example good, or every one off, in one click
 *  (Ames 2026-10-16); a second click on the same one clears them. */
function markAll(mark: 'good' | 'off') {
  const keys = points.value.map(p => p.key);
  const marks = item.value?.point_marks ?? {};
  const already = keys.length > 0 && keys.every(k => marks[k] === mark);
  void save({ pointMarks: already ? {} : Object.fromEntries(keys.map(k => [k, mark])) });
}
const allMarked = (mark: 'good' | 'off') => points.value.length > 0 && points.value.every(p => item.value?.point_marks?.[p.key] === mark);
function setVerdict(v: 'good' | 'redo') { void save({ verdict: item.value?.verdict === v ? null : v }); }
function saveNote() { if ((item.value?.feedback ?? '') !== feedback.value) void save({ feedback: feedback.value }); }

function go(step: number) {
  if (!reviewing.value) return;
  saveNote();
  const n = Math.min(items.value.length - 1, Math.max(0, index.value + step));
  reviewing.value = { ...reviewing.value, index: n };  // openExample keeps it for a refresh
  if (items.value[n]) openExample(items.value[n]);
}
</script>

<template>
  <div v-if="request && item" ref="boxEl" class="nge-arv" :class="{ 'nge-arv--dragging': dragging }" :style="posStyle" role="dialog" aria-label="Review an access request">
    <div class="nge-arv-head" title="Drag to move" @pointerdown="startDrag">
      <span class="nge-arv-title">{{ request.player_name || request.email }}</span>
      <span class="nge-arv-pos">{{ item.kind === 'cut' ? 'Cut' : 'Merge' }} {{ item.slot }} · {{ index + 1 }} of {{ items.length }}</span>
    </div>
    <p class="nge-arv-how">
      {{ item.kind === 'cut' ? 'Two cells wrongly joined: red and blue points mark where the player would cut.' : 'One cell wrongly broken in two: each merge joins its point a to its point b.' }}
    </p>
    <p v-if="item.note" class="nge-arv-quote">Player: {{ item.note }}</p>

    <div v-if="points.length" class="nge-arv-all">
      <span>All {{ points.length }} points</span>
      <button class="nge-arv-mark" :class="{ 'nge-arv-mark--good': allMarked('good') }" :disabled="busy || !canMark" @click="markAll('good')">all good</button>
      <button class="nge-arv-mark" :class="{ 'nge-arv-mark--off': allMarked('off') }" :disabled="busy || !canMark" @click="markAll('off')">all off</button>
    </div>
    <div v-if="points.length" class="nge-arv-pts">
      <div v-for="p in points" :key="p.key" class="nge-arv-pt">
        <button class="nge-arv-fly" :class="`nge-arv-fly--${p.color}`" title="Fly to this point" @click="flyTo(p.position)">
          <span class="nge-arv-dot"></span>{{ p.n }}
        </button>
        <button class="nge-arv-mark" :class="{ 'nge-arv-mark--good': item.point_marks?.[p.key] === 'good' }" :disabled="busy || !canMark" @click="markPoint(p.key, 'good')">good</button>
        <button class="nge-arv-mark" :class="{ 'nge-arv-mark--off': item.point_marks?.[p.key] === 'off' }" :disabled="busy || !canMark" @click="markPoint(p.key, 'off')">off</button>
      </div>
    </div>
    <p v-else class="nge-arv-how">No points were saved with this example.</p>
    <button v-if="item.position" class="nge-arv-link" @click="flyTo(item.position)">Back to where the player was looking</button>

    <div class="nge-arv-verdict">
      <button class="nge-arv-v" :class="{ 'nge-arv-v--good': item.verdict === 'good' }" :disabled="busy || !canMark" @click="setVerdict('good')">Good</button>
      <button class="nge-arv-v" :class="{ 'nge-arv-v--redo': item.verdict === 'redo' }" :disabled="busy || !canMark" @click="setVerdict('redo')">Redo</button>
    </div>
    <textarea v-model="feedback" class="nge-arv-note" rows="2" maxlength="2000" :disabled="!canMark"
              placeholder="A note on this example for the player" @blur="saveNote"></textarea>
    <p v-if="error" class="nge-arv-err" role="alert">{{ error }}</p>
    <p v-else-if="saved" class="nge-arv-saved" role="status">{{ saved }}. The player sees it when you send your answer.</p>

    <p v-if="!canMark" class="nge-arv-how nge-arv-locked">{{ request.status === 'redo' ? `Waiting for ${request.player_name || 'the player'} to send it again. You can mark it once it is sent.` : 'This request is closed, so its marks stay as they are.' }}</p>
    <div class="nge-arv-nav">
      <button class="nge-arv-btn" :disabled="index === 0" @click="go(-1)">Back</button>
      <button class="nge-arv-btn" :disabled="index >= items.length - 1" @click="go(1)">Next</button>
      <button class="nge-arv-btn nge-arv-btn--list" @click="saveNote(); backToRequests()">To the request</button>
    </div>
  </div>
</template>

<style scoped>
.nge-arv {
  position: fixed; right: 16px; top: 64px; z-index: 9000;
  width: 380px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  padding: 12px 14px;
  background: rgba(6, 10, 20, 0.95);
  border: 1px solid rgba(245, 209, 66, 0.45);
  border-radius: 12px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  font-family: 'Inter', 'Segoe UI', sans-serif; color: #dce6f5; font-size: 15px;
}
.nge-arv-head { display: flex; align-items: baseline; gap: 8px; cursor: grab; user-select: none; touch-action: none; margin: -12px -14px 0; padding: 12px 14px 4px; }
.nge-arv--dragging .nge-arv-head { cursor: grabbing; }
.nge-arv-title { font-size: 17px; font-weight: 600; color: #f5d142; }
.nge-arv-pos { margin-left: auto; color: rgba(220, 230, 245, 0.7); }
.nge-arv-how { margin: 6px 0; line-height: 1.45; color: rgba(220, 230, 245, 0.75); overflow-wrap: anywhere; }
.nge-arv-quote { margin: 6px 0; padding: 4px 8px; border-left: 2px solid rgba(255, 255, 255, 0.3); border-radius: 0; white-space: pre-wrap; }
.nge-arv-all { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; padding-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.nge-arv-all span { flex: 1; color: rgba(220, 230, 245, 0.8); }
.nge-arv-pts { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.nge-arv-pt { display: flex; align-items: center; gap: 6px; }
.nge-arv-fly { flex: 1; display: inline-flex; align-items: center; gap: 6px; font: inherit; color: #dce6f5; background: none; border: none; cursor: pointer; text-align: left; padding: 2px 0; }
.nge-arv-fly:hover { text-decoration: underline; text-underline-offset: 3px; }
.nge-arv-dot { width: 9px; height: 9px; border-radius: 50%; }
.nge-arv-fly--red .nge-arv-dot { background: #e06060; }
.nge-arv-fly--blue .nge-arv-dot { background: #5aa0ff; }
.nge-arv-fly--merge .nge-arv-dot { background: #ff7ad9; }
.nge-arv-mark, .nge-arv-v, .nge-arv-btn { font: inherit; font-size: 14px; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #dce6f5; cursor: pointer; }
.nge-arv-mark:disabled, .nge-arv-v:disabled, .nge-arv-btn:disabled { opacity: 0.5; cursor: default; }
.nge-arv-mark--good, .nge-arv-v--good { border-color: #7CFFB2; color: #7CFFB2; background: rgba(124, 255, 178, 0.12); }
.nge-arv-mark--off, .nge-arv-v--redo { border-color: #f5d142; color: #f5d142; background: rgba(245, 209, 66, 0.12); }
.nge-arv-link { font: inherit; font-size: 14px; background: none; border: none; color: #9fd3ff; cursor: pointer; padding: 0; }
.nge-arv-verdict { display: flex; gap: 6px; margin: 10px 0 6px; }
.nge-arv-v { flex: 1; font-size: 15px; padding: 5px 9px; }
.nge-arv-note { display: block; width: 100%; box-sizing: border-box; font: inherit; color: #fff; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; padding: 5px 7px; resize: vertical; }
.nge-arv-err { color: #f5d142; margin: 6px 0 0; }
.nge-arv-saved { color: rgba(124, 255, 178, 0.85); margin: 6px 0 0; font-size: 14px; }
.nge-arv-nav { display: flex; gap: 6px; margin-top: 10px; }
.nge-arv-btn--list { margin-left: auto; }
</style>
