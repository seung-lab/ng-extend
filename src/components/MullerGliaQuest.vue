<script setup lang="ts">
/**
 * MullerGliaQuest.vue: the Muller Glia Quest in the Quests tab (Ames
 * 2026-11-19). "The first section is confirming that it's a glia with a yes
 * or no. The second stage has users split two glia together that are merged."
 *
 * Stage 1: one cell at a time from the lab's All Glia tab; Yes, No or Not
 * sure. Three Yes confirm a cell, two No send it to the lab.
 * Stage 2 (after enough answers): segments holding two or more glia; the
 * player cuts them apart in Cut Mode and presses Check, and the server reads
 * the cell at every soma (src/muller_glia.ts, functions/muller-glia.js).
 * No bells, chat, Achievements or stats.
 */
import { computed, onMounted, ref } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { currentSegLayer } from '../datasets';
import { useProofreadingBackendStore } from '../store';
import QuestInstructions from './QuestInstructions.vue';
import EditableText from './EditableText.vue';
import imgMullerGlia from '../images/muller-glia.jpg';
import { startGliaSplitTutorial } from '../tutorial-glia-split';
import { gliaStatus, gliaNext, gliaAnswer, gliaUndo, gliaMine, gliaPairs, gliaCheck,
  type GliaCell, type GliaPair, type GliaStatus, type GliaAnswer } from '../muller_glia';

const backend = useProofreadingBackendStore();
const status = ref<GliaStatus | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const message = ref('');
const showHow = ref(false);
const stage = ref<1 | 2>(1);

const queue = ref<GliaCell[]>([]);
const current = computed(() => queue.value[0] || null);
const onScreen = ref(0);
const recent = ref<{ cellId: number; answer: GliaAnswer; index: string; segmentId: string }[]>([]);

const pairs = ref<GliaPair[]>([]);
const pairsLoaded = ref(false);
const pairOpen = ref('');
const checking = ref('');
const pairNote = ref<Record<string, string>>({});

/** "What is a Muller glia?" (Ames 2026-11-19: "link to a glia here and have
 *  an image in a popup"): the game's instructions box, with a Muller glia the
 *  lab proofread (Ames's example, 720575940572199198) and a link that shows it.
 *  Admins can edit the words and the picture (edit notes reach Ames). */
const EXAMPLE_GLIA = { segmentId: '720575940572199198', at: '43037,55535,1018' };
const WHAT_LEAD = "Muller glia are the retina's support cells. Each one spans the whole retina, from its foot at the inner surface to the photoreceptors, and holds the neurons around it in place.";
const WHAT_STEPS: string[] = [
  'A long column through the full depth of the retina.',
  'Its soma sits in the inner nuclear layer, among the bipolar cells.',
  'A wide end foot on the ganglion cell side (at the bottom of the picture), and fine sheets wrapped around its neighbors.',
  "No axon, and no tidy dendritic tree like a neuron's.",
  '<a href="#" data-nge-action="glia-example">Show this glia</a> in the viewer: a proofread Muller glia.',
];
/** Stage 2's steps (Ames 2026-11-19: fused glia usually touch in more than
 *  one place; Find Path shows where). Editable by admins. */
const SPLIT_STEPS: string[] = [
  "Open the segment. Use <b>Cell A</b> and <b>Cell B</b> to visit each glia's soma.",
  'Fused glia usually join in <b>more than one place</b>. To find one, press <b>F</b> for Find Path, <b>Ctrl+click</b> on soma A and then on soma B, and press <b>Enter</b>. The path runs through a place where the two cells join.',
  "Turn on Cut Mode (<b>C</b>). Put red points on cell A's side of that join and blue points on cell B's side, then cut.",
  'Run Find Path again. If a path still crosses from A to B, there is another join: cut it the same way.',
  'When no path is left, press <b>Check</b>. Pyr asks the server which cell each soma is in now.',
];
function onWhatAction(name: string) {
  if (name !== 'glia-example') return;
  showHow.value = false;
  show(EXAMPLE_GLIA.segmentId, EXAMPLE_GLIA.at);
  message.value = 'This is a proofread Muller glia. Turn it in 3D to see the whole column.';
}

const label = (a: GliaAnswer) => (a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'Not sure');
const short = (id: string) => `…${String(id).slice(-6)}`;
const letter = (i: number) => String.fromCharCode(65 + i);

function show(segmentId: string, at: string) {
  error.value = '';
  try {
    const viewer: any = (window as any)['viewer'];
    const gs = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value;
    if (!viewer || !gs?.visibleSegments) { error.value = 'No segmentation layer is open.'; return; }
    gs.visibleSegments.clear();
    gs.visibleSegments.add(Uint64.parseString(segmentId));
    const xyz = (at.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (xyz.length === 3) viewer.navigationState.position.value = Float32Array.from(xyz);
  } catch (e: any) { error.value = `Could not show this cell: ${e?.message || e}`; }
}

async function load() {
  if (!backend.userId) return;
  loading.value = true; error.value = '';
  try {
    status.value = await gliaStatus();
    if (!status.value.installed) return;
    const [next, mine] = await Promise.all([gliaNext(5), gliaMine()]);
    queue.value = next.cells;
    recent.value = mine.answers;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { loading.value = false; }
}
onMounted(load);

async function refill() {
  if (queue.value.length > 2) return;
  try {
    const { cells } = await gliaNext(6);
    const have = new Set(queue.value.map(c => c.id));
    queue.value = queue.value.concat(cells.filter(c => !have.has(c.id)));
  } catch { /* the next answer tries again */ }
}

function openCell(c: GliaCell) { onScreen.value = c.id; show(c.segmentId, c.soma); }

async function answer(a: GliaAnswer) {
  const c = current.value;
  if (!c || busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const r = await gliaAnswer(c.id, a);
    const was = !!status.value?.unlocked;
    if (status.value) {
      status.value.answered = r.answered;
      if (r.answered >= status.value.unlockAfter) status.value.unlocked = true;
    }
    recent.value = [{ cellId: c.id, answer: a, index: c.index, segmentId: c.segmentId }, ...recent.value.filter(x => x.cellId !== c.id)].slice(0, 8);
    message.value = !was && status.value?.unlocked ? `${c.index}: ${label(a)}. Stage 2 is open: you can split merged glia now.` : `${c.index}: ${label(a)}. Thank you!`;
    queue.value = queue.value.slice(1);
    if (current.value) openCell(current.value);
    void refill();
  } catch (e: any) {
    error.value = e?.message || String(e);
    if (/already has its answer/.test(error.value)) { queue.value = queue.value.slice(1); void refill(); }
  } finally { busy.value = false; }
}
function skip() {
  const c = current.value;
  if (!c) return;
  queue.value = [...queue.value.slice(1), c];
  if (current.value) openCell(current.value);
}
async function undo(cellId: number) {
  busy.value = true; error.value = ''; message.value = '';
  try {
    const r = await gliaUndo(cellId);
    if (status.value) status.value.answered = r.answered;
    recent.value = recent.value.filter(x => x.cellId !== cellId);
    const { cells } = await gliaNext(5);
    queue.value = cells;
  } catch (e: any) { error.value = e?.message || String(e); }
  finally { busy.value = false; }
}

async function openStage2() {
  stage.value = 2;
  if (!status.value?.unlocked || pairsLoaded.value) return;
  try { const r = await gliaPairs(); pairs.value = r.pairs; pairsLoaded.value = true; if (status.value) status.value.split = r.split; }
  catch (e: any) { error.value = e?.message || String(e); }
}
function openPair(p: GliaPair, i = 0) { pairOpen.value = p.segmentId; show(p.segmentId, p.glia[i].at); }
async function check(p: GliaPair) {
  checking.value = p.segmentId; error.value = ''; message.value = ''; pairNote.value[p.segmentId] = '';
  try {
    const r = await gliaCheck(p.segmentId);
    if (r.split) {
      pairs.value = pairs.value.filter(x => x.segmentId !== p.segmentId);
      pairOpen.value = '';
      if (!r.already && status.value) { status.value.split += 1; status.value.splitAll += 1; }
      message.value = r.already ? `Someone already split ${p.glia.map(g => g.index).join(' + ')}. On to the next one!`
        : `Split! ${p.glia.map(g => g.index).join(' and ')} are ${p.glia.length === 2 ? 'two' : 'separate'} cells now.`;
    } else if (r.unreadable) {
      pairNote.value[p.segmentId] = 'Could not read the cell at one of the somas. Try again in a moment.';
    } else {
      const together = p.glia.length === 2 ? 'Both somas are still in one cell.' : 'Some somas are still in one cell.';
      pairNote.value[p.segmentId] = `${together} There is still a join: run Find Path from soma to soma to find it.`;
    }
  } catch (e: any) { pairNote.value[p.segmentId] = e?.message || String(e); }
  finally { checking.value = ''; }
}
</script>

<template>
  <div class="nge-mg">
    <div class="nge-mg-head">
      <div class="nge-mg-titlerow">
        <div class="nge-mg-title">Muller Glia Quest</div>
        <button class="nge-mg-btn" :class="{ on: showHow }" @click="showHow = !showHow">What is a Muller glia?</button>
      </div>
      <div class="nge-mg-lead">Muller glia are the retina's support cells. Each one spans the whole retina, from its foot at the inner surface to the photoreceptors, and holds the neurons around it in place. Help us find every one of them.</div>
      <QuestInstructions v-if="showHow" kicker="Muller Glia Quest" title="What is a Muller glia?"
        :lead="WHAT_LEAD" :steps="WHAT_STEPS" lead-key="quest.muller_glia.lead" steps-key="quest.muller_glia.what"
        image-key="quest.muller_glia.image" :image="imgMullerGlia" image-alt="A Muller glia from the Retina dataset in 3D: a long column with a wide end foot at the bottom"
        :legend="[]" @close="showHow = false" @action="onWhatAction" />
      <div v-if="status?.installed" class="nge-mg-stages">
        <button class="nge-mg-stage" :class="{ on: stage === 1 }" @click="stage = 1">
          <span class="nge-mg-stage-n">1</span> Is it a Muller glia?
          <span class="nge-mg-stage-c">{{ status.answered }} answered</span>
        </button>
        <button class="nge-mg-stage" :class="{ on: stage === 2, locked: !status.unlocked }" @click="openStage2">
          <span class="nge-mg-stage-n">2</span> Split the pair
          <span class="nge-mg-stage-c">{{ status.unlocked ? `${status.split} split by you` : `opens after ${status.unlockAfter} answers` }}</span>
        </button>
      </div>
    </div>

    <div v-if="!backend.userId" class="nge-mg-empty">Sign in to take a quest.</div>
    <div v-else-if="loading && !status" class="nge-mg-empty">Reading the quest…</div>
    <div v-else-if="status && !status.installed" class="nge-mg-empty">The Muller Glia Quest is not open yet.</div>
    <template v-else-if="status">
      <div v-if="error" class="nge-mg-msg nge-mg-msg--bad">{{ error }}</div>
      <div v-else-if="message" class="nge-mg-msg">{{ message }}</div>

      <!-- Stage 1 -->
      <template v-if="stage === 1">
        <div class="nge-mg-sub">Look at the cell in 3D. Is it a Muller glia? One answer per cell, then the next one opens.</div>
        <div v-if="current" class="nge-mg-card">
          <div class="nge-mg-card-top">
            <div>
              <div class="nge-mg-card-name">{{ current.index }}</div>
              <div class="nge-mg-meta">Cell {{ current.segmentId }}</div>
            </div>
            <span class="nge-mg-card-btns">
              <button class="nge-mg-btn" @click="openCell(current)" title="Show only this cell and go to its soma">{{ onScreen === current.id ? 'Show again' : 'Open' }}</button>
              <button v-if="queue.length > 1" class="nge-mg-btn nge-mg-btn--sm" @click="skip" title="Look at another cell first">Skip</button>
            </span>
          </div>
          <div class="nge-mg-answers">
            <button class="nge-mg-ans nge-mg-ans--yes" :disabled="busy" @click="answer('yes')">Yes</button>
            <button class="nge-mg-ans nge-mg-ans--no" :disabled="busy" @click="answer('no')">No</button>
            <button class="nge-mg-ans" :disabled="busy" @click="answer('unsure')">Not sure</button>
          </div>
        </div>
        <div v-else-if="!loading" class="nge-mg-empty">You answered every cell waiting for you. Thank you!</div>
        <template v-if="recent.length">
          <div class="nge-mg-section">Your latest answers</div>
          <div v-for="r in recent" :key="r.cellId" class="nge-mg-row">
            <span>{{ r.index }} <span class="nge-mg-meta">{{ short(r.segmentId) }}</span></span>
            <span class="nge-mg-row-r">
              <span class="nge-mg-pill" :class="'nge-mg-pill--' + r.answer">{{ label(r.answer) }}</span>
              <button class="nge-mg-btn nge-mg-btn--sm" :disabled="busy" @click="undo(r.cellId)" title="Take this answer back">Undo</button>
            </span>
          </div>
        </template>
        <div class="nge-mg-foot">Three Yes answers confirm a Muller glia. Two No answers send it to the lab for a closer look. So far: {{ status.confirmed }} confirmed, {{ status.flagged }} sent to the lab.</div>
      </template>

      <!-- Stage 2 -->
      <template v-else>
        <div class="nge-mg-train">
          <span>New to splitting glia? Practice on a real fused pair first. Nothing is cut.</span>
          <button class="nge-mg-btn nge-mg-btn--sm" @click="startGliaSplitTutorial()" title="Glia Split Training: Find Path, red and blue points and Preview, without cutting">Training</button>
        </div>
        <div v-if="!status.unlocked" class="nge-mg-empty">Stage 2 opens after {{ status.unlockAfter }} answers in Stage 1. You have {{ status.answered }}.</div>
        <template v-else>
          <div class="nge-mg-sub">Each of these is one segment holding two or more Muller glia that grew together. Cut them apart so each soma has its own cell.</div>
          <EditableText text-key="quest.muller_glia.split_steps" :original="SPLIT_STEPS" list-class="nge-mg-steps" />
          <div class="nge-mg-section">Merged glia <span class="nge-mg-count">{{ pairs.length }}</span></div>
          <div v-if="pairsLoaded && !pairs.length" class="nge-mg-empty">Every merged pair is split. Thank you!</div>
          <template v-for="p in pairs.slice(0, 15)" :key="p.segmentId">
            <div class="nge-mg-row" :class="{ 'nge-mg-row--open': pairOpen === p.segmentId }">
              <span>{{ p.glia.map(g => g.index).join(' + ') }} <span class="nge-mg-meta">{{ short(p.segmentId) }}</span></span>
              <span class="nge-mg-row-r"><button class="nge-mg-btn nge-mg-btn--sm" @click="openPair(p)">Open</button></span>
            </div>
            <div v-if="pairOpen === p.segmentId" class="nge-mg-pair">
              <div class="nge-mg-meta">Segment {{ p.segmentId }}</div>
              <div class="nge-mg-pair-btns">
                <button v-for="(g, i) in p.glia" :key="g.index" class="nge-mg-btn" :class="i % 2 ? 'nge-mg-btn--b' : 'nge-mg-btn--a'" @click="openPair(p, i)" :title="`Go to ${g.index}'s soma`">Cell {{ letter(i) }}</button>
                <button class="nge-mg-btn nge-mg-btn--go" :disabled="checking === p.segmentId" @click="check(p)">{{ checking === p.segmentId ? 'Checking…' : 'Check' }}</button>
              </div>
              <div v-if="pairNote[p.segmentId]" class="nge-mg-msg nge-mg-msg--bad nge-mg-msg--in">{{ pairNote[p.segmentId] }}</div>
            </div>
          </template>
          <div class="nge-mg-foot">Split by everyone so far: {{ status.splitAll }}.</div>
        </template>
      </template>
    </template>
    <div v-if="!status && error" class="nge-mg-msg nge-mg-msg--bad">{{ error }}</div>
  </div>
</template>

<style scoped>
.nge-mg { display: flex; flex-direction: column; font-size: 14px; color: #c9d6ea; }
.nge-mg-head { padding: 10px 12px 8px; border-bottom: 1px solid rgba(120, 140, 255, 0.08); display: flex; flex-direction: column; gap: 6px; }
.nge-mg-titlerow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nge-mg-title { font-family: 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; font-size: 14px; font-weight: 700; color: #eef; }
.nge-mg-lead { font-size: 14px; line-height: 1.5; color: #b3c0d3; }
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
.nge-mg-card-btns { display: flex; gap: 6px; align-items: center; }
.nge-mg-card-name { font-size: 16px; font-weight: 700; color: #eef4ff; }
.nge-mg-meta { font-size: 12px; color: #7f92ad; }
.nge-mg-answers { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px; }
.nge-mg-ans { padding: 10px 0; border-radius: 7px; cursor: pointer; font: 700 15px 'Inter', sans-serif; border: 1px solid rgba(120, 140, 255, 0.25); background: rgba(255, 255, 255, 0.03); color: #c9d6ea; }
.nge-mg-ans:hover:not(:disabled) { background: rgba(74, 158, 255, 0.12); }
.nge-mg-ans:disabled { opacity: 0.5; cursor: default; }
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
.nge-mg-train { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; padding: 8px 10px; border: 1px solid rgba(95, 180, 255, 0.25); border-radius: 6px; background: rgba(95, 180, 255, 0.06); color: #cfe3ff; font: 13px/1.4 'Inter', sans-serif; }
.nge-mg-btn--a { color: #ff9c9c; border-color: rgba(255, 120, 120, 0.4); }
.nge-mg-btn--b { color: #9cc8ff; border-color: rgba(120, 170, 255, 0.5); }
.nge-mg-btn--go { color: #a6ffd6; border-color: rgba(80, 220, 170, 0.5); margin-left: auto; }
.nge-mg-btn:disabled { opacity: 0.5; cursor: default; }
.nge-mg-pair { padding: 8px 12px 10px; background: rgba(74, 158, 255, 0.05); display: flex; flex-direction: column; gap: 6px; }
.nge-mg-pair-btns { display: flex; flex-wrap: wrap; gap: 6px; }
:deep(.nge-mg-steps) { margin: 6px 12px 0; padding: 8px 12px 8px 28px; border-radius: 6px; background: rgba(10, 20, 40, 0.5); font-size: 13px; line-height: 1.55; color: #b9c8de; }
.nge-mg-msg { margin: 8px 12px 0; padding: 6px 10px; border-radius: 6px; font-size: 13px; color: #a6ffd6; background: rgba(80, 220, 170, 0.08); }
.nge-mg-msg--bad { color: #ffb4c8; background: rgba(255, 100, 140, 0.08); }
.nge-mg-msg--in { margin: 0; }
.nge-mg-empty { padding: 16px 12px; color: #8ea3c0; }
.nge-mg-foot { padding: 12px; font-size: 12px; line-height: 1.5; color: #7f92ad; }
</style>
