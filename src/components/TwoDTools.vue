<script setup lang="ts">
/** The 2D Tools box, a prototype (util/two_d_tools.ts). */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { twoD, startTwoDTools, addPair, setSide, renamePair, removePair, goTo, jumpAcross, removeShape, clearSlice, capture, downloadCompare, LASSO_COLORS, type JumpPair } from '../util/two_d_tools';

onMounted(startTwoDTools);
const shapesHere = computed(() => twoD.shapes.filter(s => s.z === twoD.z));
const hasCapture = computed(() => twoD.captures.some(Boolean));
// Drag the box by its head, kept on screen. It stays where you left it.
const POS_KEY = 'nge_2d_tools_pos';
const box = ref<HTMLElement | null>(null);
const pos = ref<{ left: number; top: number } | null>((() => {
  try { const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return Number.isFinite(v?.left) && Number.isFinite(v?.top) ? v : null; } catch { return null; }
})());
function keepOnScreen(left: number, top: number) {
  const r = box.value?.getBoundingClientRect();
  return {
    left: Math.max(0, Math.min(left, window.innerWidth - (r?.width ?? 300))),
    top: Math.max(0, Math.min(top, window.innerHeight - 40)),
  };
}
function startDrag(e: MouseEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button') || !box.value) return;
  e.preventDefault();
  const r = box.value.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  const move = (m: MouseEvent) => { pos.value = keepOnScreen(m.clientX - dx, m.clientY - dy); };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos.value)); } catch { /* blocked */ }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
watch(() => twoD.open, open => { if (open && pos.value) void nextTick(() => { pos.value = keepOnScreen(pos.value!.left, pos.value!.top); }); });
const onName = (p: JumpPair, e: Event) => renamePair(p, (e.target as HTMLInputElement).value.trim());
</script>

<template>
  <div v-if="twoD.open" ref="box" class="nge-2d" :style="pos ? { left: pos.left + 'px', top: pos.top + 'px' } : undefined" @keydown.stop @keyup.stop @keypress.stop>
    <div class="nge-2d-head" title="Drag to move" @mousedown="startDrag">
      <span class="nge-2d-title">2D Tools <span class="nge-2d-tag">prototype</span></span>
      <button type="button" class="nge-2d-x" aria-label="Close" @click="twoD.open = false; twoD.lasso = false">×</button>
    </div>

    <section>
      <div class="nge-2d-label">Jump pairs</div>
      <div v-for="p in twoD.pairs" :key="p.id" class="nge-2d-pair">
        <input class="nge-2d-name" :value="p.name" maxlength="40" aria-label="Name of this pair" @change="onName(p, $event)" />
        <button type="button" class="nge-2d-btn" :class="{ 'nge-2d-btn--set': p.a }" :title="p.a ? 'Go to A' : 'Set A here'" @click="p.a ? goTo(p.a) : setSide(p, 'a')">A</button>
        <button type="button" class="nge-2d-btn nge-2d-btn--go" :disabled="!p.a || !p.b" title="Jump to the other side" @click="jumpAcross(p)">⇄</button>
        <button v-if="p.b" type="button" class="nge-2d-btn nge-2d-btn--set" title="Go to B" @click="goTo(p.b)">B</button>
        <button v-else type="button" class="nge-2d-btn nge-2d-btn--ask" title="Set B here" @click="setSide(p, 'b')">Set B</button>
        <button type="button" class="nge-2d-x" :aria-label="'Remove ' + p.name" title="Remove" @click="removePair(p)">×</button>
      </div>
      <button type="button" class="nge-2d-btn nge-2d-btn--wide" @click="addPair">+ New pair, A here</button>
    </section>

    <section>
      <div class="nge-2d-label">Lasso</div>
      <div class="nge-2d-row">
        <button type="button" class="nge-2d-btn" :class="{ 'nge-2d-btn--on': twoD.lasso }" :aria-pressed="twoD.lasso" @click="twoD.lasso = !twoD.lasso">{{ twoD.lasso ? 'Drawing: Esc to stop' : 'Lasso' }}</button>
        <button v-for="c in LASSO_COLORS" :key="c" type="button" class="nge-2d-dot" :class="{ 'nge-2d-dot--on': twoD.color === c }" :style="{ background: c }" :aria-label="'Colour ' + c" @click="twoD.color = c"></button>
      </div>
      <div v-if="shapesHere.length" class="nge-2d-row nge-2d-shapes">
        <span class="nge-2d-small">On this slice:</span>
        <button v-for="(s, i) in shapesHere" :key="s.id" type="button" class="nge-2d-chip" :style="{ borderColor: s.color }" title="Remove this shape" @click="removeShape(s.id)">{{ i + 1 }} ×</button>
        <button type="button" class="nge-2d-link" @click="clearSlice">Clear</button>
      </div>
    </section>

    <section>
      <div class="nge-2d-label">Compare</div>
      <div class="nge-2d-row">
        <button type="button" class="nge-2d-btn" @click="capture(0)">Capture 1</button>
        <button type="button" class="nge-2d-btn" @click="capture(1)">Capture 2</button>
        <button type="button" class="nge-2d-btn" :disabled="!hasCapture" @click="downloadCompare">Download</button>
      </div>
      <div v-if="hasCapture" class="nge-2d-shots">
        <figure v-for="(c, i) in twoD.captures" :key="i" class="nge-2d-shot">
          <img v-if="c" :src="c.url" :alt="'Capture ' + (i + 1)" />
          <div v-else class="nge-2d-empty">{{ i + 1 }}</div>
          <figcaption v-if="c">{{ c.label }}</figcaption>
        </figure>
      </div>
    </section>

    <div v-if="twoD.note" class="nge-2d-note" role="status">{{ twoD.note }}</div>
    <div class="nge-2d-small">Kept in this browser, for this dataset.</div>
  </div>
</template>

<style>
.nge-2d-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3; }
.nge-2d-open { position: absolute; top: 8px; right: 40px; z-index: 5; padding: 3px 9px; font: 600 11px/1.4 system-ui, sans-serif; color: #e8eef5; background: rgba(8, 14, 26, 0.82); border: 1px solid rgba(126, 224, 255, 0.45); border-radius: 6px; cursor: pointer; }
.nge-2d-open:hover { background: rgba(30, 60, 90, 0.9); }
.nge-2d { position: fixed; left: 360px; top: 100px; z-index: 900; width: 300px; max-height: calc(100vh - 170px); overflow-y: auto; padding: 10px 12px; font: 12px/1.4 system-ui, sans-serif; color: #e8eef5; background: rgba(8, 14, 26, 0.95); border: 1px solid rgba(126, 224, 255, 0.35); border-radius: 10px; box-shadow: 0 8px 26px rgba(0, 0, 0, 0.5); }
.nge-2d-head { cursor: move; user-select: none; display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.nge-2d-title { font-weight: 700; font-size: 13px; }
.nge-2d-tag { margin-left: 4px; padding: 0 5px; font-size: 10px; font-weight: 600; color: #ffd24d; border: 1px solid rgba(255, 210, 77, 0.5); border-radius: 8px; }
.nge-2d section { padding: 7px 0; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.nge-2d-label { margin-bottom: 5px; font-size: 11px; font-weight: 700; color: #9fb4c9; }
.nge-2d-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.nge-2d-pair { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.nge-2d-name { flex: 1 1 auto; min-width: 0; padding: 2px 5px; font: inherit; color: inherit; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 4px; }
.nge-2d button.nge-2d-btn { padding: 3px 8px; font: inherit; color: #e8eef5; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 5px; cursor: pointer; white-space: nowrap; }
.nge-2d button.nge-2d-btn:hover:not(:disabled) { background: rgba(126, 224, 255, 0.18); }
.nge-2d button.nge-2d-btn:disabled { opacity: 0.4; cursor: default; }
.nge-2d button.nge-2d-btn--set { border-color: rgba(61, 255, 154, 0.6); color: #7cffb2; }
.nge-2d button.nge-2d-btn--ask { border-color: rgba(255, 210, 77, 0.6); color: #ffd24d; }
.nge-2d button.nge-2d-btn--go { color: #7ee0ff; font-weight: 700; }
.nge-2d button.nge-2d-btn--on { background: rgba(126, 224, 255, 0.28); border-color: #7ee0ff; }
.nge-2d button.nge-2d-btn--wide { width: 100%; }
.nge-2d button.nge-2d-x { padding: 0 4px; font-size: 15px; line-height: 1; color: #9fb4c9; background: none; border: 0; cursor: pointer; }
.nge-2d button.nge-2d-x:hover { color: #fff; }
.nge-2d button.nge-2d-dot { width: 17px; height: 17px; padding: 0; border: 2px solid transparent; border-radius: 50%; cursor: pointer; }
.nge-2d button.nge-2d-dot--on { border-color: #fff; }
.nge-2d-shapes { margin-top: 6px; }
.nge-2d button.nge-2d-chip { padding: 0 6px; font: inherit; color: inherit; background: none; border: 1px solid; border-radius: 9px; cursor: pointer; }
.nge-2d button.nge-2d-link { padding: 0; font: inherit; color: #7ee0ff; background: none; border: 0; text-decoration: underline; cursor: pointer; }
.nge-2d-small { font-size: 11px; color: #9fb4c9; }
.nge-2d-shots { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 7px; }
.nge-2d-shot { margin: 0; min-width: 0; }
.nge-2d-shot img, .nge-2d-empty { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.18); }
.nge-2d-empty { display: flex; align-items: center; justify-content: center; color: #6c7f93; }
.nge-2d-shot figcaption { margin-top: 2px; font-size: 9.5px; color: #9fb4c9; overflow-wrap: anywhere; }
.nge-2d-note { margin: 3px 0; color: #ffd24d; }
</style>
