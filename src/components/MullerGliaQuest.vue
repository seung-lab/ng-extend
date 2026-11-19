<script setup lang="ts">
/**
 * MullerGliaQuest.vue — TEST SITE MOCKUP (Ames 2026-11-19).
 * "A secondary quest about Muller glia cells. The first section is confirming
 * that it's a glia with a yes or no. The second stage has users split two glia
 * together that are merged."
 *
 * Rows are a SAMPLE generated from the lab's All Glia tab
 * (src/data/muller_glia_mock.ts). Answers and finished splits stay in this
 * browser only (localStorage): no game table, no bells, no chat, no
 * Achievements, no stats. The Stage 2 check is real and read only: it asks the
 * PyChunkedGraph which cell each nucleus sits in now.
 */
import { computed, ref } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { currentSegLayer } from '../datasets';
import { supervoxelAtPlace } from '../util/crosshair_cell';
import { getRootFromSupervoxel } from '../widgets/pcg_service';
import { GLIA_CHECK_CELLS, GLIA_PAIRS, GLIA_STAGE1_POOL, GLIA_STAGE2_POOL, type GliaCheckCell, type GliaPair } from '../data/muller_glia_mock';

const KEY = 'nge_muller_glia_mock_v1';
type Answer = 'yes' | 'no' | 'unsure';
interface Saved { answers: Record<string, Answer>; split: Record<string, { a: string; b: string }> }
function read(): Saved {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.answers && s.split) return s; } catch {}
  return { answers: {}, split: {} };
}
const saved = ref<Saved>(read());
function write() { try { localStorage.setItem(KEY, JSON.stringify(saved.value)); } catch {} }

/** Stage 2 opens after this many Stage 1 answers (proposal; open on the test site). */
const UNLOCK_AFTER = 10;
const stage = ref<1 | 2>(1);
const answered = computed(() => Object.keys(saved.value.answers).length);
const stage2Ready = computed(() => answered.value >= UNLOCK_AFTER);
const splitDone = computed(() => Object.keys(saved.value.split).length);
const error = ref('');
const message = ref('');
const showHow = ref(false);

function show(segmentId: string, at: string) {
  error.value = '';
  try {
    const viewer: any = (window as any)['viewer'];
    const gs = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value;
    if (!viewer || !gs?.visibleSegments) { error.value = 'No segmentation layer is open. Switch to Retina first.'; return; }
    gs.visibleSegments.clear();
    gs.visibleSegments.add(Uint64.parseString(segmentId));
    const xyz = (at.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (xyz.length === 3) viewer.navigationState.position.value = Float32Array.from(xyz);
  } catch (e: any) { error.value = `Could not show this cell: ${e?.message || e}`; }
}

// ── Stage 1: is it a Muller glia? ─────────────────────────────────────────
const nextCell = computed<GliaCheckCell | null>(() => GLIA_CHECK_CELLS.find(c => !saved.value.answers[c.index]) ?? null);
const onScreen = ref('');
function openCell(c: GliaCheckCell) { onScreen.value = c.index; show(c.segmentId, c.soma); }
function answer(c: GliaCheckCell, a: Answer) {
  saved.value.answers[c.index] = a; write();
  message.value = `${c.index}: ${a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'Not sure'}. Saved in this browser only.`;
  const n = nextCell.value;
  if (n) openCell(n);
}
function undo(index: string) { delete saved.value.answers[index]; write(); message.value = ''; }
const recent = computed(() => GLIA_CHECK_CELLS.filter(c => saved.value.answers[c.index]).slice(-6).reverse());
const label = (a: Answer) => (a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'Not sure');

// ── Stage 2: split the pair ───────────────────────────────────────────────
const pairOpen = ref('');
const checking = ref('');
const pairNote = ref<Record<string, string>>({});
const openPairs = computed(() => GLIA_PAIRS.filter(p => !saved.value.split[p.segmentId]));
function openPair(p: GliaPair, i = 0) { pairOpen.value = p.segmentId; show(p.segmentId, p.nuclei[i].at); }
async function rootAt(at: string): Promise<string | null> {
  const xyz = (at.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (xyz.length !== 3) return null;
  const sv = await supervoxelAtPlace(xyz);
  return sv && sv !== '0' ? getRootFromSupervoxel(sv) : null;
}
/** Real check, read only: which cell holds each nucleus now. */
async function check(p: GliaPair) {
  checking.value = p.segmentId; error.value = ''; message.value = '';
  try {
    const [a, b] = await Promise.all([rootAt(p.nuclei[0].at), rootAt(p.nuclei[1].at)]);
    if (!a || !b) { pairNote.value[p.segmentId] = 'Could not read the cell at one of the nuclei. Sign in, or try again.'; return; }
    if (a === b) { pairNote.value[p.segmentId] = 'Both nuclei are still in one cell. Keep cutting along where the two glia touch.'; return; }
    saved.value.split[p.segmentId] = { a, b }; write();
    pairNote.value[p.segmentId] = '';
    message.value = `Split! ${p.nuclei[0].index} and ${p.nuclei[1].index} are two cells now. Saved in this browser only.`;
    pairOpen.value = '';
  } catch (e: any) { pairNote.value[p.segmentId] = e?.message || String(e); }
  finally { checking.value = ''; }
}
const short = (id: string) => `…${id.slice(-6)}`;
</script>

<template>
  <div class="nge-mg">
    <div class="nge-mg-mock">Test site preview. Your answers stay in this browser and count for nothing yet.</div>
    <div class="nge-mg-head">
      <div class="nge-mg-titlerow">
        <div class="nge-mg-title">Muller Glia Quest</div>
        <button class="nge-mg-btn" :class="{ on: showHow }" @click="showHow = !showHow">What is a Muller glia?</button>
      </div>
      <div class="nge-mg-lead">Muller glia are the retina's support cells. Each one spans the whole retina, from its foot at the inner surface to the photoreceptors, and holds the neurons around it in place. Help us find every one of them.</div>
      <ul v-if="showHow" class="nge-mg-how">
        <li>A long column through the full depth of the retina.</li>
        <li>Its soma sits in the inner nuclear layer, among the bipolar cells.</li>
        <li>A wide end foot on the ganglion cell side, and fine sheets wrapped around its neighbors.</li>
        <li>No axon, and no tidy dendritic tree like a neuron's.</li>
      </ul>
      <div class="nge-mg-stages">
        <button class="nge-mg-stage" :class="{ on: stage === 1 }" @click="stage = 1">
          <span class="nge-mg-stage-n">1</span> Is it a Muller glia?
          <span class="nge-mg-stage-c">{{ answered }} answered</span>
        </button>
        <button class="nge-mg-stage" :class="{ on: stage === 2, locked: !stage2Ready }" @click="stage = 2">
          <span class="nge-mg-stage-n">2</span> Split the pair
          <span class="nge-mg-stage-c">{{ stage2Ready ? `${splitDone} split` : `opens after ${UNLOCK_AFTER} answers` }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="nge-mg-msg nge-mg-msg--bad">{{ error }}</div>
    <div v-else-if="message" class="nge-mg-msg">{{ message }}</div>

    <!-- Stage 1 -->
    <template v-if="stage === 1">
      <div class="nge-mg-sub">Look at the cell in 3D. Is it a Muller glia? One answer per cell, then the next one opens.</div>
      <div v-if="nextCell" class="nge-mg-card">
        <div class="nge-mg-card-top">
          <div>
            <div class="nge-mg-card-name">{{ nextCell.index }}</div>
            <div class="nge-mg-meta">Cell {{ nextCell.segmentId }}</div>
          </div>
          <button class="nge-mg-btn" @click="openCell(nextCell)" title="Show only this cell and go to its soma">{{ onScreen === nextCell.index ? 'Show again' : 'Open' }}</button>
        </div>
        <div class="nge-mg-answers">
          <button class="nge-mg-ans nge-mg-ans--yes" @click="answer(nextCell, 'yes')">Yes</button>
          <button class="nge-mg-ans nge-mg-ans--no" @click="answer(nextCell, 'no')">No</button>
          <button class="nge-mg-ans" @click="answer(nextCell, 'unsure')">Not sure</button>
        </div>
      </div>
      <div v-else class="nge-mg-empty">You answered every cell in this preview.</div>
      <template v-if="recent.length">
        <div class="nge-mg-section">Your answers</div>
        <div v-for="c in recent" :key="c.index" class="nge-mg-row">
          <span>{{ c.index }} <span class="nge-mg-meta">{{ short(c.segmentId) }}</span></span>
          <span class="nge-mg-row-r">
            <span class="nge-mg-pill" :class="'nge-mg-pill--' + saved.answers[c.index]">{{ label(saved.answers[c.index]) }}</span>
            <button class="nge-mg-btn nge-mg-btn--sm" @click="undo(c.index)">Undo</button>
          </span>
        </div>
      </template>
      <div class="nge-mg-foot">Preview: {{ GLIA_CHECK_CELLS.length }} cells. The full list holds {{ GLIA_STAGE1_POOL.toLocaleString() }} glia from the lab's sheet that no one has typed yet.</div>
    </template>

    <!-- Stage 2 -->
    <template v-else>
      <div v-if="!stage2Ready" class="nge-mg-lock">In the game, Stage 2 opens after {{ UNLOCK_AFTER }} answers in Stage 1. It is open here so you can try it.</div>
      <div class="nge-mg-sub">Each of these is one segment holding two Muller glia that grew together. Cut them apart so each nucleus has its own cell.</div>
      <ol class="nge-mg-steps">
        <li>Open the pair. Use Nucleus A and Nucleus B to visit each cell's nucleus.</li>
        <li>Find where the two glia touch. Turn on Cut Mode (C).</li>
        <li>Red points on cell A's side, blue points on cell B's side, then cut.</li>
        <li>Press Check. Pyr asks the server which cell each nucleus is in now.</li>
      </ol>
      <div class="nge-mg-section">Merged pairs <span class="nge-mg-count">{{ openPairs.length }}</span></div>
      <template v-for="p in openPairs.slice(0, 12)" :key="p.segmentId">
        <div class="nge-mg-row" :class="{ 'nge-mg-row--open': pairOpen === p.segmentId }">
          <span>{{ p.nuclei[0].index }} + {{ p.nuclei[1].index }} <span class="nge-mg-meta">{{ short(p.segmentId) }}</span></span>
          <span class="nge-mg-row-r">
            <button class="nge-mg-btn nge-mg-btn--sm" @click="openPair(p)">Open</button>
          </span>
        </div>
        <div v-if="pairOpen === p.segmentId" class="nge-mg-pair">
          <div class="nge-mg-meta">Segment {{ p.segmentId }}</div>
          <div class="nge-mg-pair-btns">
            <button class="nge-mg-btn nge-mg-btn--a" @click="openPair(p, 0)">Nucleus A</button>
            <button class="nge-mg-btn nge-mg-btn--b" @click="openPair(p, 1)">Nucleus B</button>
            <button class="nge-mg-btn nge-mg-btn--go" :disabled="checking === p.segmentId" @click="check(p)">{{ checking === p.segmentId ? 'Checking…' : 'Check' }}</button>
          </div>
          <div v-if="pairNote[p.segmentId]" class="nge-mg-msg nge-mg-msg--bad">{{ pairNote[p.segmentId] }}</div>
        </div>
      </template>
      <div class="nge-mg-foot">Found today: {{ GLIA_STAGE2_POOL }} segments in the lab's sheet still hold two or more glia nuclei. The preview lists the pairs.</div>
    </template>
  </div>
</template>

<style scoped>
.nge-mg { display: flex; flex-direction: column; font-size: 14px; color: #c9d6ea; }
.nge-mg-mock { margin: 8px 12px 0; padding: 6px 10px; border-radius: 6px; font-size: 12px; color: #9fc4ff; background: rgba(74, 158, 255, 0.08); border: 1px dashed rgba(74, 158, 255, 0.35); }
.nge-mg-head { padding: 10px 12px 8px; border-bottom: 1px solid rgba(120, 140, 255, 0.08); display: flex; flex-direction: column; gap: 6px; }
.nge-mg-titlerow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nge-mg-title { font-family: 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; font-size: 14px; font-weight: 700; color: #eef; }
.nge-mg-lead { font-size: 14px; line-height: 1.5; color: #b3c0d3; }
.nge-mg-how { margin: 0; padding: 8px 12px 8px 26px; border-radius: 6px; background: rgba(10, 20, 40, 0.6); border: 1px solid rgba(120, 140, 255, 0.12); font-size: 13px; line-height: 1.55; color: #b9c8de; }
.nge-mg-stages { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; }
.nge-mg-stage { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 7px; cursor: pointer; text-align: left;
  border: 1px solid rgba(120, 140, 255, 0.15); background: transparent; color: #a9b8cc; font: 600 13px 'Inter', sans-serif; }
.nge-mg-stage.on { border-color: rgba(74, 158, 255, 0.7); background: rgba(74, 158, 255, 0.12); color: #e6f0ff; }
.nge-mg-stage.locked:not(.on) { opacity: 0.6; }
.nge-mg-stage-n { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; align-items: center; justify-content: center; font-size: 12px; background: rgba(74, 158, 255, 0.25); color: #dbe9ff; }
.nge-mg-stage-c { width: 100%; font-weight: 400; font-size: 12px; color: #8ea3c0; }
.nge-mg-sub { padding: 10px 12px 2px; font-size: 13px; line-height: 1.5; color: #a9b8cc; }
.nge-mg-card { margin: 8px 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(74, 158, 255, 0.35); background: linear-gradient(160deg, rgba(20, 40, 80, 0.55), rgba(8, 14, 30, 0.6)); }
.nge-mg-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.nge-mg-card-name { font-size: 16px; font-weight: 700; color: #eef4ff; }
.nge-mg-meta { font-size: 12px; color: #7f92ad; }
.nge-mg-answers { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px; }
.nge-mg-ans { padding: 10px 0; border-radius: 7px; cursor: pointer; font: 700 15px 'Inter', sans-serif; border: 1px solid rgba(120, 140, 255, 0.25); background: rgba(255, 255, 255, 0.03); color: #c9d6ea; }
.nge-mg-ans:hover { background: rgba(74, 158, 255, 0.12); }
.nge-mg-ans--yes { border-color: rgba(80, 220, 170, 0.55); color: #a6ffd6; }
.nge-mg-ans--no { border-color: rgba(206, 147, 216, 0.55); color: #e4c1ec; }
.nge-mg-section { padding: 12px 12px 4px; font-family: 'Orbitron', 'Inter', sans-serif; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(100, 200, 255, 0.8); display: flex; gap: 6px; align-items: center; }
.nge-mg-count { font-family: 'Inter', sans-serif; letter-spacing: 0; font-size: 13px; color: #8bf; }
.nge-mg-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid rgba(120, 140, 255, 0.05); }
.nge-mg-row--open { background: rgba(74, 158, 255, 0.08); }
.nge-mg-row-r { display: flex; align-items: center; gap: 8px; }
.nge-mg-pill { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); }
.nge-mg-pill--yes { color: #a6ffd6; background: rgba(80, 220, 170, 0.12); }
.nge-mg-pill--no { color: #e4c1ec; background: rgba(206, 147, 216, 0.12); }
.nge-mg-btn { padding: 5px 11px; border: 1px solid rgba(120, 140, 255, 0.2); border-radius: 5px; background: transparent; color: #8bf; font: 600 13px 'Inter', sans-serif; cursor: pointer; white-space: nowrap; }
.nge-mg-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.12); }
.nge-mg-btn.on { background: rgba(74, 158, 255, 0.15); }
.nge-mg-btn--sm { padding: 3px 9px; font-size: 12px; }
.nge-mg-btn--a { color: #ff9c9c; border-color: rgba(255, 120, 120, 0.4); }
.nge-mg-btn--b { color: #9cc8ff; border-color: rgba(120, 170, 255, 0.5); }
.nge-mg-btn--go { color: #a6ffd6; border-color: rgba(80, 220, 170, 0.5); margin-left: auto; }
.nge-mg-btn:disabled { opacity: 0.5; cursor: default; }
.nge-mg-pair { padding: 8px 12px 10px; background: rgba(74, 158, 255, 0.05); display: flex; flex-direction: column; gap: 6px; }
.nge-mg-pair-btns { display: flex; gap: 6px; }
.nge-mg-steps { margin: 6px 12px 0; padding: 8px 12px 8px 28px; border-radius: 6px; background: rgba(10, 20, 40, 0.5); font-size: 13px; line-height: 1.55; color: #b9c8de; }
.nge-mg-lock { margin: 8px 12px 0; font-size: 12px; color: #9fc4ff; }
.nge-mg-msg { margin: 8px 12px 0; padding: 6px 10px; border-radius: 6px; font-size: 13px; color: #a6ffd6; background: rgba(80, 220, 170, 0.08); }
.nge-mg-msg--bad { color: #ffb4c8; background: rgba(255, 100, 140, 0.08); margin: 0; }
.nge-mg-head + .nge-mg-msg--bad { margin: 8px 12px 0; }
.nge-mg-empty { padding: 16px 12px; color: #8ea3c0; }
.nge-mg-foot { padding: 12px; font-size: 12px; color: #7f92ad; }
</style>
