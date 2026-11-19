<script setup lang="ts">
/**
 * OrphanSegmentsTab.vue
 * MOCKUP (Ames 2026-11-19, branch claude/orphan-segments, test site only).
 * Untracked Retina segments the lab found (internal nickname only; players
 * never read it). Four groups from the lab's preview states: Large, Smaller,
 * Glia-like, Soma-like (src/data/orphan-segments.ts). Pick one, jump to it,
 * work the checklist (splits and merges, ends, a point in the major dendrite
 * or soma, NucID if there is one), Submit.
 *
 * Nothing leaves this browser: Submit saves to localStorage only. Test sites
 * share the live Supabase and functions, so no bells, chat, stats or claims.
 *
 * Players read it as "Lost Fragments" (Ames 2026-11-19), ORPHAN_NAME.
 */
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import { play, stopPlay } from '../util/play';
import { Uint64 } from 'neuroglancer/util/uint64';
import { currentSegLayer } from '../datasets';
import { useCellHistoryStore } from '../store';
import { cellAtCrosshair, supervoxelAtPlace } from '../util/crosshair_cell';
import { getRootFromSupervoxel } from '../widgets/pcg_service';
import {
  ORPHANS_LARGE, ORPHANS_SMALLER, ORPHANS_GLIA, ORPHANS_SOMA, ORPHAN_POOL, orphanName,
  type OrphanSeg, type OrphanFlag,
} from '../data/orphan-segments';

const props = defineProps<{ playTick?: number; slim?: boolean }>();
const name = orphanName();

type GroupKey = 'large' | 'smaller' | 'glia' | 'soma';
const GROUPS: { key: GroupKey; label: string; about: string; color: string; rows: OrphanSeg[] }[] = [
  { key: 'large',   label: 'Large',     color: '#7ecaff', rows: ORPHANS_LARGE,
    about: 'Big pieces with no flag. Most are parts of neurons cut off from their cell.' },
  { key: 'smaller', label: 'Smaller',   color: '#9fb4ff', rows: ORPHANS_SMALLER,
    about: 'The smallest of each kind. Fewer clues, so they can be harder to place.' },
  { key: 'glia',    label: 'Glia-like', color: '#6fe0d0', rows: ORPHANS_GLIA,
    about: 'The shape looks like a glial cell. Check it, and look for a soma.' },
  { key: 'soma',    label: 'Soma-like', color: '#c9b6ff', rows: ORPHANS_SOMA,
    about: 'May have a cell body. Put the point in the soma, and read the NucID if there is a nucleus.' },
];
const FLAG_WORDS: Record<OrphanFlag, string> = { n: 'no flag', s: 'soma', sg: 'soma, glia', g: 'glia' };
const poolTotal = ORPHAN_POOL.n + ORPHAN_POOL.s + ORPHAN_POOL.sg + ORPHAN_POOL.g;

const group = ref<GroupKey>('large');
const cur = computed(() => GROUPS.find(g => g.key === group.value)!);

// ── Local saves (mockup) ─────────────────────────────────────────────
const SAVE_KEY = 'nge_orphan_mock_v1';
interface OrphanSave {
  id: string; group: GroupKey; root: string | null;
  fixed: boolean; ends: boolean;
  where: 'dendrite' | 'soma'; point: [number, number, number] | null;
  nucId: string; noNucleus: boolean; note: string; at: number;
}
const saves = reactive<Record<string, OrphanSave>>((() => {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; } catch { return {}; }
})());
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(saves)); } catch { /* private window */ } }
const doneIn = (g: GroupKey) => GROUPS.find(x => x.key === g)!.rows.filter(r => saves[r.id]).length;

// ── The one being worked on ──────────────────────────────────────────
const active = ref<OrphanSeg | null>(null);
const shownRoot = ref<string | null>(null);
const form = reactive({
  fixed: false, ends: false, where: 'dendrite' as 'dendrite' | 'soma',
  point: null as [number, number, number] | null, pointMsg: '', pointOk: false, checking: false,
  nucId: '', noNucleus: false, note: '', saved: false,
});
const place = computed(() => active.value ? cur.value.rows.findIndex(r => r.id === active.value!.id) : -1);

function resetForm(s?: OrphanSave) {
  form.fixed = s?.fixed ?? false; form.ends = s?.ends ?? false;
  form.where = s?.where ?? (group.value === 'soma' ? 'soma' : 'dendrite');
  form.point = s?.point ?? null; form.pointOk = !!s?.point;
  form.pointMsg = s?.point ? `Saved at ${s.point.join(', ')}.` : '';
  form.nucId = s?.nucId ?? ''; form.noNucleus = s?.noNucleus ?? false; form.note = s?.note ?? '';
  form.saved = !!s;
}

const history = useCellHistoryStore();
async function open(row: OrphanSeg) {
  active.value = row;
  shownRoot.value = row.id;
  resetForm(saves[row.id]);
  history.jumpToCell(row.id, row.pt);
  // The listed ID may be old (one in the lab's list already was). The jump
  // point sits inside the segment, so ask what is there now and show that.
  const sv = await supervoxelAtPlace(row.pt).catch(() => null);
  if (!sv || sv === '0' || active.value?.id !== row.id) return;
  const root = await getRootFromSupervoxel(sv).catch(() => null);
  if (!root || root === row.id || active.value?.id !== row.id) return;
  try {
    const visible = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    visible?.delete(Uint64.parseString(row.id));
    visible?.add(Uint64.parseString(root));
    shownRoot.value = root;
  } catch { /* layer went away */ }
}
function step(d: number) {
  const rows = cur.value.rows;
  const i = place.value < 0 ? (d > 0 ? 0 : rows.length - 1) : (place.value + d + rows.length) % rows.length;
  void open(rows[i]);
}
// ── Play (util/play.ts): Submit, then the next one not yet done ─────
/** The next fragment with no answer, from this group on, then the others. */
function nextUndone(): { g: GroupKey; row: OrphanSeg } | null {
  const start = GROUPS.findIndex(x => x.key === group.value);
  for (let k = 0; k < GROUPS.length; k++) {
    const g = GROUPS[(start + k) % GROUPS.length];
    const from = k === 0 && active.value ? g.rows.findIndex(r => r.id === active.value!.id) + 1 : 0;
    const row = [...g.rows.slice(from), ...(k === 0 ? g.rows.slice(0, from) : [])].find(r => !saves[r.id] && r.id !== active.value?.id);
    if (row) return { g: g.key, row };
  }
  return null;
}
const allDone = ref(false);
function playNext() {
  const n = nextUndone();
  if (!n) { allDone.value = true; return; }
  allDone.value = false;
  group.value = n.g;
  void open(n.row);
  document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Your fragment', cell: 'Segment ' + short(n.row.id) } }));
}
watch(() => props.playTick, t => { if (t) playNext(); });
onMounted(() => { if (props.playTick) playNext(); });
const onSkip = () => playNext();
onMounted(() => document.addEventListener('nge:play-skip-fragment', onSkip));
onUnmounted(() => document.removeEventListener('nge:play-skip-fragment', onSkip));
const playing = computed(() => play.on === 'fragments');

function pickGroup(g: GroupKey) {
  group.value = g;
  if (active.value && !GROUPS.find(x => x.key === g)!.rows.some(r => r.id === active.value!.id)) active.value = null;
}

async function usePoint() {
  form.checking = true; form.pointMsg = '';
  try {
    const at = await cellAtCrosshair();
    if (!at.root) { form.pointOk = false; form.pointMsg = at.problem || 'Could not read the crosshairs.'; return; }
    form.point = at.position;
    const visible = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    let inShown = false;
    try { inShown = !!visible?.has(Uint64.parseString(at.root)); } catch { /* */ }
    form.pointOk = inShown;
    form.pointMsg = inShown
      ? `Inside the segment, at ${at.position.join(', ')}.`
      : `The crosshairs are in ${short(at.root)}, which is not on screen. Move them into the segment and try again.`;
  } finally { form.checking = false; }
}

const canSubmit = computed(() => form.fixed && form.ends && form.pointOk && !!form.point && (form.noNucleus || form.where === 'dendrite' || !!form.nucId.trim()));
const missing = computed(() => {
  const m: string[] = [];
  if (!form.fixed) m.push('fix the splits and merges');
  if (!form.ends) m.push('check the ends');
  if (!form.pointOk) m.push(`put a point in the ${form.where === 'soma' ? 'soma' : 'major dendrite'}`);
  if (form.where === 'soma' && !form.noNucleus && !form.nucId.trim()) m.push('add the NucID, or tick No nucleus');
  return m;
});
function submit() {
  if (!active.value || !canSubmit.value) return;
  saves[active.value.id] = {
    id: active.value.id, group: group.value, root: shownRoot.value,
    fixed: form.fixed, ends: form.ends, where: form.where, point: form.point,
    nucId: form.nucId.trim(), noNucleus: form.noNucleus, note: form.note.trim(), at: Date.now(),
  };
  persist();
  form.saved = true;
  if (playing.value) playNext();
}
function forget() {
  if (!active.value) return;
  delete saves[active.value.id];
  persist();
  resetForm();
}

const short = (id: string) => id.length > 8 ? '…' + id.slice(-6) : id;
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
</script>

<template>
  <div class="nge-orph" :class="{ 'nge-orph--slim': slim }">
    <div v-if="!slim" class="nge-orph-head">
      <!-- The emblem (Ames 2026-11-19: "a cool graphic"): loose shards of a
           cell drifting back into the dashed outline of the neuron they left. -->
      <svg class="nge-orph-art" viewBox="0 0 320 84" role="img" aria-label="Fragments drifting back into a neuron's outline">
        <defs>
          <radialGradient id="orphGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#7ecaff" stop-opacity="0.35"/><stop offset="1" stop-color="#7ecaff" stop-opacity="0"/></radialGradient>
          <linearGradient id="orphShard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f1ff"/><stop offset="0.5" stop-color="#7ecaff"/><stop offset="1" stop-color="#4a7dff"/></linearGradient>
        </defs>
        <ellipse cx="226" cy="44" rx="74" ry="36" fill="url(#orphGlow)"/>
        <g class="nge-orph-art-ghost" fill="none" stroke="#9fb4ff" stroke-width="1.4" stroke-dasharray="3 4" stroke-linecap="round">
          <circle cx="226" cy="44" r="11"/>
          <path d="M215 40 Q196 30 176 33 Q160 35 146 26"/><path d="M216 50 Q198 62 180 60"/>
          <path d="M237 38 Q258 22 284 20"/><path d="M237 49 Q262 58 290 66"/><path d="M258 29 L270 12"/>
          <path d="M226 55 L228 78"/>
        </g>
        <circle cx="226" cy="44" r="4" fill="#c9b6ff" opacity="0.8"/>
        <g fill="url(#orphShard)">
          <polygon class="nge-orph-shard s1" points="22,30 34,24 38,36 27,40"/>
          <polygon class="nge-orph-shard s2" points="58,58 72,52 70,66"/>
          <polygon class="nge-orph-shard s3" points="86,22 98,18 101,29 90,31"/>
          <polygon class="nge-orph-shard s4" points="112,50 121,44 128,54 118,60"/>
          <polygon class="nge-orph-shard s5" points="42,10 50,8 52,15"/>
          <polygon class="nge-orph-shard s6" points="132,30 140,27 142,35"/>
        </g>
        <g class="nge-orph-art-trail" stroke="#7ecaff" stroke-width="1" stroke-linecap="round" opacity="0.5">
          <path d="M40 34 L60 36"/><path d="M74 59 L92 57"/><path d="M103 26 L120 27"/><path d="M130 52 L146 49"/>
        </g>
      </svg>
      <div class="nge-orph-title">{{ name.title }}</div>
      <div class="nge-orph-lead">{{ name.lead }}</div>
      <div class="nge-orph-mock">Test site preview: {{ GROUPS.reduce((a, g) => a + g.rows.length, 0) }} sample segments
        of the {{ fmt(poolTotal) }} the lab found. Submit saves on this computer only.</div>
    </div>

    <div v-if="!slim" class="nge-orph-groups">
      <button v-for="g in GROUPS" :key="g.key" class="nge-orph-group" :class="{ 'nge-orph-group--on': group === g.key }"
              :style="{ '--g': g.color }" @click="pickGroup(g.key)" :title="g.about">
        <span class="nge-orph-group-name">{{ g.label }}</span>
        <span class="nge-orph-group-n">{{ doneIn(g.key) }} / {{ g.rows.length }}</span>
      </button>
    </div>
    <div v-if="!slim" class="nge-orph-about">{{ cur.about }}</div>
    <div v-if="slim && !active" class="nge-orph-note nge-orph-slim-empty">No fragment open. Open the full view to pick one.</div>

    <div v-if="playing" class="nge-orph-play">
      <span>Playing Lost Fragments. Submit takes you to the next one.</span>
      <button class="nge-orph-link" @click="stopPlay">Stop playing</button>
    </div>
    <div v-if="playing && allDone" class="nge-orph-note nge-orph-note--ok">You have answered every fragment here. Thank you!</div>
    <div v-if="active" class="nge-orph-task">
      <div class="nge-orph-task-top">
        <div>
          <div class="nge-orph-task-name">Segment {{ short(shownRoot || active.id) }}</div>
          <div class="nge-orph-task-meta">
            <span :style="{ color: cur.color }">{{ cur.label }}</span>, {{ place + 1 }} of {{ cur.rows.length }},
            {{ fmt(active.um3) }} µm³, lab flag: {{ FLAG_WORDS[active.flag] }}
          </div>
          <div v-if="shownRoot && shownRoot !== active.id" class="nge-orph-note">Edited since the lab's list; showing its current ID.</div>
        </div>
      </div>
      <div class="nge-orph-controls">
        <button class="nge-orph-btn" @click="step(-1)">&lsaquo; Previous</button>
        <button class="nge-orph-btn" @click="step(1)">Next &rsaquo;</button>
        <button class="nge-orph-btn" @click="open(active)" title="Fly the view back to where this fragment starts">Back to start</button>
        <button v-if="playing" class="nge-orph-btn" @click="playNext" title="Leave this one and go to the next fragment">Skip</button>
      </div>

      <ol class="nge-orph-check">
        <li :class="{ done: form.fixed }">
          <label><input type="checkbox" v-model="form.fixed" /> <b>Fix splits and merges.</b>
            Cut off anything that belongs to another cell and merge in missing pieces.</label>
        </li>
        <li :class="{ done: form.ends }">
          <label><input type="checkbox" v-model="form.ends" /> <b>Check every end.</b>
            Follow each branch to its tip and extend it where it was cut short.</label>
        </li>
        <li :class="{ done: form.pointOk }">
          <div><b>Record a point</b> in the
            <span class="nge-orph-seg">
              <button :class="{ on: form.where === 'dendrite' }" @click="form.where = 'dendrite'">major dendrite</button>
              <button :class="{ on: form.where === 'soma' }" @click="form.where = 'soma'">soma</button>
            </span>
          </div>
          <div class="nge-orph-sub">Put the crosshairs inside the {{ form.where === 'soma' ? 'soma' : 'thickest dendrite' }}, then press Use crosshairs.</div>
          <div class="nge-orph-row">
            <button class="nge-orph-btn" :disabled="form.checking" @click="usePoint">{{ form.checking ? 'Checking…' : 'Use crosshairs' }}</button>
            <span v-if="form.pointMsg" class="nge-orph-note" :class="{ 'nge-orph-note--err': !form.pointOk }">{{ form.pointMsg }}</span>
          </div>
        </li>
        <li :class="{ done: form.noNucleus || !!form.nucId.trim() }">
          <div><b>NucID</b>, if the segment has a nucleus.</div>
          <div class="nge-orph-row">
            <input v-model="form.nucId" class="nge-orph-input" :disabled="form.noNucleus" inputmode="numeric" placeholder="NucID" aria-label="NucID" />
            <label class="nge-orph-sub"><input type="checkbox" v-model="form.noNucleus" /> No nucleus</label>
          </div>
        </li>
      </ol>
      <textarea v-model="form.note" class="nge-orph-input nge-orph-notes" rows="2" placeholder="Notes for the lab (optional): what you think it is, anything odd"></textarea>

      <div class="nge-orph-row">
        <button class="nge-orph-btn nge-orph-submit" :disabled="!canSubmit" @click="submit">{{ form.saved ? 'Submit again' : playing ? 'Submit and next' : 'Submit' }}</button>
        <button v-if="form.saved" class="nge-orph-btn" @click="step(1)">Next segment &rsaquo;</button>
        <button v-if="form.saved" class="nge-orph-link" @click="forget">Clear my answer</button>
      </div>
      <div v-if="form.saved" class="nge-orph-note nge-orph-note--ok">Saved on this computer. On the real version it goes to the lab.</div>
      <div v-else-if="missing.length" class="nge-orph-note">Still to do: {{ missing.join(', ') }}.</div>
    </div>

    <div v-if="!slim" class="nge-orph-list">
      <button v-for="(r, i) in cur.rows" :key="r.id" class="nge-orph-item" :class="{ 'nge-orph-item--on': active?.id === r.id, 'nge-orph-item--done': !!saves[r.id] }"
              @click="open(r)" :title="`Jump to segment ${r.id}`">
        <span class="nge-orph-item-i">{{ i + 1 }}</span>
        <span class="nge-orph-item-id">{{ r.id }}</span>
        <span class="nge-orph-item-flag">{{ FLAG_WORDS[r.flag] }}</span>
        <span class="nge-orph-item-v">{{ fmt(r.um3) }} µm³</span>
        <span class="nge-orph-item-s">{{ saves[r.id] ? '✓' : '' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.nge-orph-art { display: block; width: 100%; height: auto; max-height: 84px; margin-bottom: 2px; }
.nge-orph-art-ghost { opacity: 0.75; }
.nge-orph-shard { transform-box: fill-box; transform-origin: center; animation: nge-orph-drift 5.5s ease-in-out infinite; filter: drop-shadow(0 0 4px rgba(126, 202, 255, 0.7)); }
.nge-orph-shard.s2 { animation-delay: -1.2s; } .nge-orph-shard.s3 { animation-delay: -2.1s; } .nge-orph-shard.s4 { animation-delay: -3.3s; }
.nge-orph-shard.s5 { animation-delay: -0.6s; } .nge-orph-shard.s6 { animation-delay: -4.2s; }
.nge-orph-art-trail { animation: nge-orph-trail 5.5s ease-in-out infinite; }
@keyframes nge-orph-drift { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(7px, -3px) rotate(9deg); } }
@keyframes nge-orph-trail { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) { .nge-orph-shard, .nge-orph-art-trail { animation: none; } }
.nge-orph--slim .nge-orph-task { margin-top: 8px; }
.nge-orph--slim .nge-orph-play { margin: 8px 10px 0; }
.nge-orph-slim-empty { padding: 10px 12px; }
.nge-orph-play { display: flex; align-items: center; gap: 10px; justify-content: space-between; margin: 8px 0; padding: 7px 10px; border: 1px solid rgba(62, 236, 190, 0.45); background: rgba(62, 236, 190, 0.08); color: #c8fbea; font-size: 13.5px; }
/* In the Cell Library's own colors and sizes (see RetinaCastTab). */
.nge-orph { display: flex; flex-direction: column; }
.nge-orph-head { padding: 10px 12px 8px; display: flex; flex-direction: column; gap: 5px; }
.nge-orph-title { font-family: 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; font-size: 14px; font-weight: 700; color: #eef; text-transform: uppercase; }
.nge-orph-lead { font-size: 14px; line-height: 1.5; color: #b3c0d3; }
.nge-orph-mock { font-size: 12.5px; line-height: 1.45; color: #9fd0ff; background: rgba(74, 158, 255, 0.08); border: 1px dashed rgba(126, 202, 255, 0.35); border-radius: 6px; padding: 5px 8px; }

.nge-orph-groups { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 2px 12px 6px; }
.nge-orph-group { --g: #7ecaff; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(120, 140, 255, 0.2); background: transparent; color: #b3c0d3; cursor: pointer; font: inherit; text-align: left; }
.nge-orph-group:hover { border-color: var(--g); color: #eef; }
.nge-orph-group--on { border-color: var(--g); background: color-mix(in srgb, var(--g) 14%, transparent); color: #fff; }
.nge-orph-group-name { font: 700 13px 'Inter', sans-serif; color: var(--g); }
.nge-orph-group-n { font-size: 12px; font-variant-numeric: tabular-nums; }
.nge-orph-about { padding: 0 12px 8px; font-size: 13px; line-height: 1.5; color: #cfdcef; }

.nge-orph-task { margin: 0 10px 8px; padding: 10px 12px; border-radius: 10px; background: rgba(66, 213, 236, 0.06); border: 1px solid rgba(66, 213, 236, 0.28); display: flex; flex-direction: column; gap: 8px; }
.nge-orph-task-name { font-size: 17px; font-weight: 700; color: #fff; }
.nge-orph-task-meta { font-size: 13px; color: #a9b8cc; }
.nge-orph-controls, .nge-orph-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nge-orph-btn { padding: 5px 11px; border: 1px solid rgba(120, 140, 255, 0.25); border-radius: 5px; background: transparent; color: #8bf; font: 600 13px 'Inter', sans-serif; cursor: pointer; white-space: nowrap; }
.nge-orph-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.1); border-color: rgba(126, 202, 255, 0.5); }
.nge-orph-btn:disabled { opacity: 0.45; cursor: default; }
.nge-orph-submit:not(:disabled) { background: rgba(74, 158, 255, 0.22); border-color: rgba(126, 202, 255, 0.7); color: #eaf6ff; }
.nge-orph-link { background: none; border: none; color: #93a0b6; font: 12.5px 'Inter', sans-serif; text-decoration: underline; cursor: pointer; }

.nge-orph-check { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 9px; font-size: 13.5px; line-height: 1.45; color: #cfdcef; }
.nge-orph-check li::marker { color: #7ecaff; font-weight: 700; }
.nge-orph-check li.done::marker { color: #6fe0d0; }
.nge-orph-check b { color: #eef; }
.nge-orph-check input[type=checkbox] { accent-color: #4a9eff; vertical-align: -2px; }
.nge-orph-sub { font-size: 12.5px; color: #93a0b6; }
.nge-orph-seg { display: inline-flex; margin-left: 4px; border: 1px solid rgba(120, 140, 255, 0.25); border-radius: 5px; overflow: hidden; vertical-align: 1px; }
.nge-orph-seg button { padding: 2px 8px; background: transparent; border: none; color: #8bf; font: 600 12.5px 'Inter', sans-serif; cursor: pointer; }
.nge-orph-seg button.on { background: rgba(74, 158, 255, 0.25); color: #eaf6ff; }
.nge-orph-input { height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid rgba(120, 140, 255, 0.2); background: rgba(10, 16, 30, 0.6); color: #eef; font: 13px 'Inter', sans-serif; width: 160px; }
.nge-orph-input:focus { outline: none; border-color: rgba(126, 202, 255, 0.6); }
.nge-orph-notes { width: auto; height: auto; padding: 6px 8px; resize: vertical; }
.nge-orph-note { font-size: 12.5px; color: #93a0b6; line-height: 1.4; }
.nge-orph-note--err { color: #ff9b9b; }
.nge-orph-note--ok { color: #a6ffd6; }

.nge-orph-list { display: flex; flex-direction: column; padding: 0 6px 8px; }
.nge-orph-item { display: grid; grid-template-columns: 22px 1fr auto auto 14px; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; background: transparent; border: 1px solid transparent; color: #cfdcef; cursor: pointer; text-align: left; font: 13px 'Inter', sans-serif; }
.nge-orph-item:hover { background: rgba(74, 158, 255, 0.08); }
.nge-orph-item--on { background: rgba(74, 158, 255, 0.14); border-color: rgba(126, 202, 255, 0.35); }
.nge-orph-item-i { color: #6c7a90; font-variant-numeric: tabular-nums; text-align: right; }
.nge-orph-item-id { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #eef; overflow: hidden; text-overflow: ellipsis; }
.nge-orph-item-flag { font-size: 11.5px; color: #93a0b6; }
.nge-orph-item-v { font-size: 12px; color: #a9b8cc; font-variant-numeric: tabular-nums; }
.nge-orph-item-s { color: #6fe0d0; font-weight: 700; }
.nge-orph-item--done .nge-orph-item-id { color: #a6ffd6; }
</style>
