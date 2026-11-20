<script setup lang="ts">
import bannerImg from '../images/lost-fragments-banner.jpg';
import neuronIcon from '../../static/badges/pyr/neuron-icon-white.png';
/**
 * OrphanSegmentsTab.vue
 * MOCKUP (Ames 2026-11-19, branch claude/orphan-segments, test site only).
 * Untracked Retina segments the lab found (internal nickname only; players
 * never read it). Four groups from the lab's preview states: Large, Smaller,
 * Glia-like, Soma-like (src/data/orphan-segments.ts). Pick one, jump to it,
 * work the checklist (splits and merges, ends, a point in the major dendrite
 * or soma, NucID if there is one), Submit.
 *
 * Submit (Ames 2026-11-19, "build everything you need to get it working"):
 * a point in CAVE tagged lost_fragment (lightbulb_service postLostFragmentPoint,
 * the player's own sign in), then the server (functions/lost-fragments.js)
 * keeps the answer in ew_lost_fragments and writes the researchers' sheet.
 * The first Submit of a fragment counts as a completed cell, the same
 * mark_complete row a Complete logs. Test sites share live data: a Submit
 * there is real.
 *
 * Players read it as "Lost Fragments" (Ames 2026-11-19), ORPHAN_NAME.
 */
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import { play, stopPlay, startPlay } from '../util/play';
import { ON_TEST_SITE } from '../hunt';
import { Uint64 } from 'neuroglancer/util/uint64';
import { currentSegLayer } from '../datasets';
import { useCellHistoryStore, useProofreadingBackendStore, useUserStatsStore } from '../store';
import { secureWrite } from '../secure_write';
import { postLostFragmentPoint } from '../widgets/lightbulb_service';
import { cellAtCrosshair, supervoxelAtPlace } from '../util/crosshair_cell';
import { getRootFromSupervoxel } from '../widgets/pcg_service';
import { NURRO_IMAGES } from '../widgets/lightbulb_service';
import { frameSvg } from '../sandbox_match';
import { getToolbarIconDef } from '../data/toolbar-icons';
import {
  ORPHANS_LARGE, ORPHANS_SMALLER, ORPHANS_GLIA, ORPHANS_SOMA, ORPHAN_POOL, orphanName,
  type OrphanSeg, type OrphanFlag,
} from '../data/orphan-segments';

const props = defineProps<{ playTick?: number; slim?: boolean }>();

/** The Training Sim's circuit edge on a button, redrawn when it resizes. */
const vCircuit = {
  mounted(el: HTMLElement) {
    const host = document.createElement('span');
    host.className = 'nge-orph-frame';
    host.setAttribute('aria-hidden', 'true');
    el.prepend(host);
    let drawn = '';
    const draw = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h || `${w}x${h}` === drawn) return;
      drawn = `${w}x${h}`;
      host.innerHTML = frameSvg(w, h, false);
    };
    try { const ro = new ResizeObserver(draw); ro.observe(el); (el as any)._ngeRo = ro; } catch { /* drawn once */ }
    requestAnimationFrame(draw);
  },
  unmounted(el: HTMLElement) { (el as any)._ngeRo?.disconnect(); },
};
/** After five fragments a player knows the drill (Ames 2026-11-20: power
 *  players "not going to want to have to check fix splits and merges and
 *  check every end every time"): the first two ticks go away and count as done. */
const VETERAN_AT = 5;
/** The top bar's Highlight can, in place of the word (Ames 2026-11-20). */
const HIGHLIGHT_ICON = getToolbarIconDef('highlight')?.svg ?? '';
const name = orphanName();

type GroupKey = 'large' | 'smaller' | 'glia' | 'soma';
const GROUPS: { key: GroupKey; label: string; about: string; color: string; rows: OrphanSeg[] }[] = [
  { key: 'large',   label: 'Large',     color: '#7ecaff', rows: ORPHANS_LARGE,
    about: 'Big pieces with no flag. Most are parts of neurons cut off from their cell.' },
  { key: 'smaller', label: 'Small',   color: '#9fb4ff', rows: ORPHANS_SMALLER,
    about: 'The smallest of each kind. Fewer clues, so they can be harder to place.' },
  { key: 'glia',    label: 'Glia-like', color: '#6fe0d0', rows: ORPHANS_GLIA,
    about: 'The shape looks like a glial cell. Check it, and look for a soma.' },
  { key: 'soma',    label: 'Soma-like', color: '#c9b6ff', rows: ORPHANS_SOMA,
    about: 'May have a cell body. Put the point in the soma, and add the nucleus ID if there is a nucleus.' },
];
const FLAG_WORDS: Record<OrphanFlag, string> = { n: 'no flag', s: 'soma', sg: 'soma, glia', g: 'glia' };
const poolTotal = ORPHAN_POOL.n + ORPHAN_POOL.s + ORPHAN_POOL.sg + ORPHAN_POOL.g;

const group = ref<GroupKey>('large');
const cur = computed(() => GROUPS.find(g => g.key === group.value)!);

// ── Answers: the server's copy, kept in this browser between loads ──────
const SAVE_KEY = 'nge_orphan_saves_v2';
interface OrphanSave {
  id: string; group: GroupKey; root: string | null;
  fixed: boolean; ends: boolean;
  where: 'dendrite' | 'soma'; point: [number, number, number] | null;
  nucId: string; noNucleus: boolean; note: string; at: number;
  /** The CAVE row; null while CAVE could not take it (sent again on load). */
  caveId?: number | null;
}
/** Fragments someone else has answered: Play skips them. */
const taken = reactive(new Set<string>());
/** Fragments another player is playing (their claim): Play skips them too.
 *  Ames 2026-11-20: "play mode on a fragment should claim it as mine until I
 *  skip it". Claims stay in Supabase only, never the sheet. */
const held = reactive(new Set<string>());
/** The fragment this player holds, from the server: Play goes back to it. */
const myClaim = ref<string | null>(null);
/** The server answered: answers go to the lab. */
const serverOn = ref(false);
const sending = ref(false);
const sendError = ref('');
const lastSent = ref('');
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
  nucMsg.value = '';
}

// The fragment open and its unsent answers, for this tab's session: the
// library closes and opens again (slim bar, Play), and the tab with it.
const DRAFT_KEY = 'nge_orph_draft_v1';
function saveDraft() {
  try {
    const a = active.value;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ group: group.value, id: a?.id ?? null, root: shownRoot.value,
      form: a && !form.saved ? { fixed: form.fixed, ends: form.ends, where: form.where, point: form.point, pointOk: form.pointOk,
        pointMsg: form.pointMsg, nucId: form.nucId, noNucleus: form.noNucleus, note: form.note } : null }));
  } catch { /* private window */ }
}
function restoreDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !GROUPS.some(g => g.key === d.group)) return;
    group.value = d.group;
    const row = d.id ? GROUPS.find(g => g.key === d.group)!.rows.find(r => r.id === d.id) : null;
    if (!row) return;
    active.value = row;
    shownRoot.value = d.root || row.id;
    resetForm(saves[row.id]);
    if (d.form && !saves[row.id]) Object.assign(form, d.form);
  } catch { /* nothing kept */ }
}
watch([group, active, shownRoot, () => ({ ...form })], saveDraft, { deep: true });

const history = useCellHistoryStore();
/** The jump opens neuroglancer's Selection panel on the right; it means
 *  nothing here (Ames 2026-11-19: "I don't want the selection window to
 *  appear"). Close it as it opens, the way Cilia Quest does. */
function closeSelectionPanel() {
  const shut = () => { try { const vis = (window as any).viewer?.selectionDetailsState?.location?.watchableVisible; if (vis && vis.value) vis.value = false; } catch { /* no such panel */ } };
  shut(); setTimeout(shut, 300); setTimeout(shut, 1200);
}
/** Slim: the fragment and what you are playing; Complete opens the checklist
 *  (Ames 2026-11-19: "when I'm ready to complete it, then I hit complete and
 *  then the rest of it folds down"). */
const finishing = ref(false);
async function open(row: OrphanSeg) {
  active.value = row;
  shownRoot.value = row.id;
  resetForm(saves[row.id]);
  history.jumpToCell(row.id, row.pt);
  finishing.value = false;
  closeSelectionPanel();
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
    const row = [...g.rows.slice(from), ...(k === 0 ? g.rows.slice(0, from) : [])].find(r => !saves[r.id] && !taken.has(r.id) && !held.has(r.id) && r.id !== active.value?.id);
    if (row) return { g: g.key, row };
  }
  return null;
}
const allDone = ref(false);
/** Play landed here: hold it for this player. If someone got there first,
 *  move on to the next one. Without the server, play on unclaimed. */
async function claimHere(row: OrphanSeg) {
  try {
    const res = await secureWrite<{ claimed: boolean; reason?: string }>('fragments.claim', { fragmentId: row.id });
    if (res && res.claimed) { myClaim.value = row.id; return; }
    // Only a plain "someone has it" moves Play on; anything else plays on.
    if (!res || res.claimed !== false || (res.reason !== 'done' && res.reason !== 'held')) return;
    (res.reason === 'done' ? taken : held).add(row.id);
    if (active.value?.id === row.id && playing.value && !saves[row.id]) playNext();
  } catch { /* the server can't say; keep playing */ }
}
function playNext() {
  const n = nextUndone();
  if (!n) { allDone.value = true; return; }
  allDone.value = false;
  group.value = n.g;
  void open(n.row);
  void claimHere(n.row);
  document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Your Fragment', cell: 'Segment ' + short(n.row.id) } }));
}
/** Skip: give the fragment back, then the next one. */
function skip() {
  const a = active.value;
  if (a && !saves[a.id]) {
    if (myClaim.value === a.id) myClaim.value = null;
    void secureWrite('fragments.release', { fragmentId: a.id }).catch(() => undefined);
  }
  playNext();
}
function findRow(id: string): { g: GroupKey; row: OrphanSeg } | null {
  for (const g of GROUPS) { const row = g.rows.find(r => r.id === id); if (row) return { g: g.key, row }; }
  return null;
}
// Pressing Play while a fragment is open and not yet submitted stays on it
// (Ames 2026-11-19: Play took her from Smaller back to Large, losing her note).
function playResume() {
  const a = active.value;
  if (a && !saves[a.id]) {
    void claimHere(a);
    document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Your Fragment', cell: 'Segment ' + a.id } }));
    return;
  }
  // The fragment this player holds, from another computer or an earlier visit.
  const mine = myClaim.value ? findRow(myClaim.value) : null;
  if (mine && !saves[mine.row.id]) {
    group.value = mine.g;
    void open(mine.row);
    void claimHere(mine.row);
    document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Your Fragment', cell: 'Segment ' + short(mine.row.id) } }));
    return;
  }
  playNext();
}
watch(() => props.playTick, t => { if (t) playResume(); });
onMounted(() => { restoreDraft(); if (props.playTick) playResume(); });
const onSkip = () => skip();
onMounted(() => document.addEventListener('nge:play-skip-fragment', onSkip));
onUnmounted(() => document.removeEventListener('nge:play-skip-fragment', onSkip));
const playing = computed(() => play.on === 'fragments');

/** The group menu on the fragment line (Ames 2026-11-19: "How do I switch from
 *  large to medium to small?", the group buttons are hidden while playing). */
/** Highlight mode (Ames 2026-11-19: "make it easier to open highlight mode
 *  here"). It runs beside Merge and Cut: Ctrl+click goes to them, H+click to it. */
function openHighlight() { document.dispatchEvent(new CustomEvent('nge:open-highlight')); }
const copied = ref(false);
/** The slim bar keeps the note box closed until asked (Ames 2026-11-19: "this box is too big"). */
const noteOpen = ref(false);
const helpOpen = ref(false);
async function copyId(id: string) {
  try { await navigator.clipboard.writeText(id); copied.value = true; setTimeout(() => { copied.value = false; }, 1500); } catch { /* clipboard blocked */ }
}
function onGroupChange(e: Event) { switchGroup((e.target as HTMLSelectElement).value as GroupKey); }
function switchGroup(g: GroupKey) {
  if (g === group.value) return;
  pickGroup(g);
  if (playing.value) { active.value = null; playNext(); }
}
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
    // After merges and cuts the fragment has a new ID that the list on screen
    // may not have yet (Ames 2026-11-19: the check failed on her edited
    // fragment). Ask what the fragment's own start point belongs to now.
    const row = active.value;
    if (!inShown && row) {
      const sv = await supervoxelAtPlace(row.pt).catch(() => null);
      const now = sv && sv !== '0' ? await getRootFromSupervoxel(sv).catch(() => null) : null;
      if (now && now === at.root && active.value?.id === row.id) {
        inShown = true;
        try {
          if (shownRoot.value && shownRoot.value !== now) visible?.delete(Uint64.parseString(shownRoot.value));
          visible?.add(Uint64.parseString(now));
        } catch { /* layer went away */ }
        shownRoot.value = now;
      }
    }
    form.pointOk = inShown;
    form.pointMsg = inShown
      ? `Inside the segment, at ${at.position.join(', ')}.`
      : `The crosshairs are in ${short(at.root)}, which is not on screen. Move them into the segment and try again.`;
  } finally { form.checking = false; }
}

const nucChecking = ref(false);
const nucMsg = ref('');
/** The nucleus under the crosshairs: its own segment, not the fragment. */
async function useNucleus() {
  nucChecking.value = true; nucMsg.value = '';
  try {
    const at = await cellAtCrosshair();
    if (!at.root) { nucMsg.value = at.problem || 'Could not read the crosshairs.'; return; }
    const mine = new Set([shownRoot.value, active.value?.id].filter(Boolean) as string[]);
    if (mine.has(at.root)) { form.nucId = ''; nucMsg.value = 'The crosshairs are in the fragment itself. Move them onto the nucleus inside the soma.'; return; }
    form.nucId = at.root;
    nucMsg.value = `Nucleus ${short(at.root)} saved. Check it sits inside this soma.`;
  } finally { nucChecking.value = false; }
}
const veteran = computed(() => Object.keys(saves).length >= VETERAN_AT);
const fixedOk = computed(() => form.fixed || veteran.value);
const endsOk = computed(() => form.ends || veteran.value);
const completeLabel = computed(() => form.saved ? 'Send again' : playing.value ? 'Complete and next' : 'Complete');
const canSubmit = computed(() => fixedOk.value && endsOk.value && form.pointOk && !!form.point && (form.noNucleus || form.where === 'dendrite' || !!form.nucId.trim()));
const missing = computed(() => {
  const m: string[] = [];
  if (!fixedOk.value) m.push('fix the splits and merges');
  if (!endsOk.value) m.push('check the ends');
  if (!form.pointOk) m.push(`put a point in the ${form.where === 'soma' ? 'soma' : 'major dendrite'}`);
  if (form.where === 'soma' && !form.noNucleus && !form.nucId.trim()) m.push('read the nucleus with the crosshairs, or tick No nucleus');
  return m;
});
/** Counts the fragment as a completed cell: the same row a Complete logs. */
function countCompleted(root: string, pt: [number, number, number], fragmentId: string) {
  try {
    const backend = useProofreadingBackendStore();
    if (!backend.userId) return;
    backend.logEdit({ operation: 'mark_complete', segment_after: root, coordinates: `${pt[0]}, ${pt[1]}, ${pt[2]}`,
      metadata: { root_id: root, lost_fragment: fragmentId } });
    const stats = useUserStatsStore();
    stats.setStats({ cellsSubmitted: stats.stats.cellsSubmitted + 1 });
    stats.logDailyCellComplete();
    backend.pendingCellCelebration = {
      totalCells: stats.stats.cellsSubmitted,
      imageUrl: NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)],
      segId: root,
    };
  } catch { /* the answer is saved either way */ }
}
async function submit() {
  const row = active.value;
  if (!row || !canSubmit.value || !form.point || sending.value) return;
  sending.value = true; sendError.value = ''; lastSent.value = '';
  const pt = [...form.point] as [number, number, number];
  const root = shownRoot.value || row.id;
  try {
    // CAVE first, once per fragment; a resubmit keeps the row it has.
    let caveId = saves[row.id]?.caveId ?? null;
    if (caveId == null) caveId = await postLostFragmentPoint(pt);
    const res = await secureWrite<{ first: boolean; sheet: string }>('fragments.submit', {
      fragmentId: row.id, group: group.value, rootId: root, labFlag: FLAG_WORDS[row.flag], labUm3: row.um3,
      fixed: fixedOk.value, ends: endsOk.value, pointIn: form.where, pt,
      nucleusId: form.where === 'soma' && !form.noNucleus ? form.nucId.trim() : '', noNucleus: form.noNucleus,
      note: form.note.trim(), caveAnnotationId: caveId,
    });
    serverOn.value = true;
    saves[row.id] = {
      id: row.id, group: group.value, root, fixed: fixedOk.value, ends: endsOk.value, where: form.where, point: pt,
      nucId: form.nucId.trim(), noNucleus: form.noNucleus, note: form.note.trim(), at: Date.now(), caveId,
    };
    persist();
    if (res && res.first) countCompleted(root, pt, row.id);
    if (myClaim.value === row.id) myClaim.value = null;
    lastSent.value = res && res.sheet === 'failed' ? 'Sent to the lab. The sheet will catch up.' : 'Sent to the lab.';
    if (caveId == null) lastSent.value += ' CAVE was busy, so Pyr sends the point again later.';
  } catch (e: any) {
    sendError.value = String((e && e.message) || 'Could not send it. Try again in a moment.');
    return;
  } finally { sending.value = false; }
  if (active.value?.id !== row.id) return;
  form.saved = true;
  finishing.value = false;
  if (playing.value) playNext();
}

/** The server's answers for this player, and fragments others have done.
 *  Answers whose CAVE point did not go in are sent again here. */
async function loadAnswers() {
  try {
    const res = await secureWrite<{ mine: any[]; others: string[]; held?: string[]; myClaim?: string | null }>('fragments.list');
    serverOn.value = true;
    for (const k of Object.keys(saves)) delete saves[k];
    for (const m of res.mine || []) {
      const g = GROUPS.find(x => x.rows.some(r => r.id === m.fragment_id));
      saves[m.fragment_id] = {
        id: m.fragment_id, group: (g ? g.key : 'large') as GroupKey, root: m.root_id, fixed: true, ends: true,
        where: m.point_in, point: m.pt, nucId: m.nucleus_id || '', noNucleus: !!m.no_nucleus, note: m.note || '',
        at: Date.parse(m.updated_at) || Date.now(), caveId: m.cave_annotation_id ?? null,
      };
    }
    persist();
    taken.clear();
    for (const id of res.others || []) taken.add(id);
    held.clear();
    for (const id of res.held || []) held.add(id);
    myClaim.value = res.myClaim ?? null;
    if (active.value && saves[active.value.id] && !finishing.value) resetForm(saves[active.value.id]);
    for (const m of res.mine || []) {
      if (m.cave_annotation_id != null || !Array.isArray(m.pt)) continue;
      const id = await postLostFragmentPoint(m.pt as [number, number, number]);
      if (id == null) break;  // CAVE still busy: the next load tries again
      await secureWrite('fragments.caveId', { fragmentId: m.fragment_id, caveAnnotationId: id }).catch(() => undefined);
      if (saves[m.fragment_id]) { saves[m.fragment_id].caveId = id; persist(); }
    }
  } catch { serverOn.value = false; }
}
onMounted(() => { void loadAnswers(); });

const short = (id: string) => id.length > 8 ? '…' + id.slice(-6) : id;
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
</script>

<template>
  <div class="nge-orph" :class="{ 'nge-orph--slim': slim }">
    <div v-if="!slim" class="nge-orph-head">
      <!-- The banner (Ames 2026-11-19): her render of EyeWire cubes with
           gold branches running through them, the title over it. -->
      <div class="nge-orph-banner" :style="{ backgroundImage: `url(${bannerImg})` }" role="img" aria-label="Blue cubes tumbling apart with gold neuron branches running through them">
        <div class="nge-orph-title">{{ name.title }}</div>
      </div>
      <div class="nge-orph-lead">{{ name.lead }}</div>
      <div class="nge-orph-mock">{{ ON_TEST_SITE ? 'Test site preview' : 'Admin preview' }}: {{ GROUPS.reduce((a, g) => a + g.rows.length, 0) }} sample segments
        of the {{ fmt(poolTotal) }} the lab found. {{ serverOn ? 'Each Submit goes to the lab and counts as a completed cell.' : 'Pyr could not reach the server, so Submit will not save yet.' }}</div>
    </div>

    <div v-if="!slim" class="nge-orph-groups">
      <button v-for="g in GROUPS" :key="g.key" class="nge-orph-group" :class="{ 'nge-orph-group--on': group === g.key }"
              :style="{ '--g': g.color }" @click="pickGroup(g.key)" :title="g.about">
        <span class="nge-orph-group-name">{{ g.label }}</span>
        <span class="nge-orph-group-n">{{ doneIn(g.key) }} / {{ g.rows.length }}</span>
      </button>
    </div>
    <div v-if="!slim" class="nge-orph-about">{{ cur.about }}</div>
    <div v-if="!slim && !playing" class="nge-orph-playhere-row">
      <button class="nge-orph-playhere" @click="startPlay('fragments')" title="Play: opens the next fragment you haven't answered. After Submit, the next one.">
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>Play here
      </button>
      <span class="nge-orph-playhere-hint">Opens the next fragment, then the next one after each Submit.</span>
    </div>
    <div v-if="slim && !active" class="nge-orph-note nge-orph-slim-empty">No fragment open. Open the full view to pick one.</div>

    <div v-if="playing && allDone" class="nge-orph-note nge-orph-note--ok">You have answered every fragment here. Thank you!</div>
    <!-- The slim bar's header (Ames 2026-11-19: "needs a header"). -->
    <!-- Slim: one row, like the BC Challenge slim row (Ames 2026-11-19: "make
         it styled ACTUALLY slim"); Complete opens the checklist under it. -->
    <!-- Ames 2026-11-20: no group menu, ID, Playing chip or previous and next
         here; Skip moves on, and the full view has the rest. -->
    <div v-if="slim && active" class="nge-orph-slimrow" :data-id="shownRoot || active.id">
      <img :src="neuronIcon" class="nge-orph-slimicon" alt="" aria-hidden="true" />
      <div class="nge-orph-slimid">
        <div class="nge-orph-slimtop"><span class="nge-orph-slimlabel">Lost Fragments</span></div>
        <div class="nge-orph-slimmeta" :style="{ color: cur.color }">{{ cur.label }}</div>
      </div>
      <div class="nge-orph-slimbtns">
        <button class="nge-orph-btn nge-orph-hl" @click="openHighlight" aria-label="Highlight" title="Highlight mode (H): mark what you have checked. With Merge or Cut open, Ctrl+click goes to them; hold H and click to highlight." v-html="HIGHLIGHT_ICON"></button>
        <button v-if="playing" v-circuit class="nge-orph-btn nge-orph-circ nge-orph-skip" @click="skip" title="Give this one back and go to the next fragment"><span class="nge-orph-label">Skip</span></button>
        <!-- One button (Ames 2026-11-20: "we have one complete and next
             button"): Complete opens the checklist, then sends it. -->
        <button v-if="!finishing" v-circuit class="nge-orph-btn nge-orph-circ nge-orph-complete" @click="finishing = true" title="Done with this fragment? Open the checklist."><span class="nge-orph-label">{{ form.saved ? 'Completed' : 'Complete' }}</span></button>
        <button v-else v-circuit class="nge-orph-btn nge-orph-circ nge-orph-complete on" :disabled="!canSubmit || sending" :title="missing.length ? `Still to do: ${missing.join(', ')}.` : 'Send it to the lab'" @click="submit"><span class="nge-orph-label">{{ sending ? 'Sending…' : completeLabel }}</span></button>
      </div>
    </div>
    <div v-if="active && (!slim || finishing)" class="nge-orph-task">
      <div v-if="!slim" class="nge-orph-task-top">
        <div>
          <div class="nge-orph-task-name">
            <span class="nge-orph-task-id">{{ shownRoot || active.id }}</span>
            <button class="nge-orph-copy" :title="copied ? 'Copied' : 'Copy the segment ID'" @click="copyId(shownRoot || active.id)">{{ copied ? 'Copied' : 'Copy' }}</button>
          </div>
          <div class="nge-orph-task-meta">
            <select class="nge-orph-groupsel" :value="group" :style="{ color: cur.color }" aria-label="Fragment group"
                    title="Switch group" @change="onGroupChange">
              <option v-for="g in GROUPS" :key="g.key" :value="g.key">{{ g.label }}</option>
            </select>, {{ place + 1 }} of {{ cur.rows.length }},
            {{ fmt(active.um3) }} µm³, lab flag: {{ FLAG_WORDS[active.flag] }}
          </div>
          <div v-if="shownRoot && shownRoot !== active.id" class="nge-orph-note">Edited since the lab's list; showing its current ID.</div>
        </div>
      </div>
      <div v-if="!slim" class="nge-orph-controls">
        <button class="nge-orph-btn" @click="step(-1)" title="Previous fragment">&lsaquo;<template v-if="!slim"> Previous</template></button>
        <button class="nge-orph-btn" @click="step(1)" title="Next fragment"><template v-if="!slim">Next </template>&rsaquo;</button>
        <button class="nge-orph-btn" @click="open(active)" title="Fly the view back to this fragment, if you moved away">Recenter</button>
        <button class="nge-orph-btn" @click="openHighlight" title="Highlight mode (H): mark what you have checked. With Merge or Cut open, Ctrl+click goes to them; hold H and click to highlight.">Highlight</button>
        <button v-if="playing" class="nge-orph-btn" @click="skip" title="Give this one back and go to the next fragment">Skip</button>
        <button v-else class="nge-orph-btn nge-orph-playbtn" @click="startPlay('fragments')" title="Play: after Submit, the next fragment opens by itself">&#9654; Play</button>
        <button class="nge-orph-help-btn" :class="{ on: helpOpen }" :aria-expanded="helpOpen ? 'true' : 'false'" title="How to do a fragment" @click="helpOpen = !helpOpen">?</button>
        <button v-if="playing" class="nge-orph-link nge-orph-stop" @click="stopPlay" title="Stop playing: Submit stays on this fragment">Stop</button>
      </div>

      <div v-if="helpOpen" class="nge-orph-help">
        <p><b>1. Fix splits and merges.</b> Cut off anything that belongs to another cell, and merge in pieces that are missing.</p>
        <p><b>2. Check every end.</b> Follow each branch to its tip and extend it where it was cut short.</p>
        <p><b>3. Crosshairs.</b> Put the crosshairs inside the thickest dendrite, or inside the soma if it has one, then press Use crosshairs. Pyr checks the point is inside this fragment.</p>
        <p><b>4. Nucleus</b> (soma only). In Retina each nucleus is its own segment. Put the crosshairs on the nucleus inside the soma and press Use crosshairs: Pyr reads its ID, so the lab can match the soma to its nucleus. No nucleus? Tick No nucleus.</p>
        <p v-if="veteran">You have done {{ VETERAN_AT }} or more, so Pyr trusts you on 1 and 2 and stops asking.</p>
        <p v-else>After {{ VETERAN_AT }} fragments, Pyr trusts you on 1 and 2 and stops asking.</p>
        <p><b>Highlight</b> opens Highlight mode to mark what you checked: with Merge or Cut open, Ctrl+click goes to them and H+click highlights.</p>
      </div>
      <div v-if="slim" class="nge-orph-row nge-orph-finishhead"><b>Before you complete</b><button class="nge-orph-help-btn" :class="{ on: helpOpen }" title="How to do a fragment" @click="helpOpen = !helpOpen">?</button><button class="nge-orph-help-btn nge-orph-fold" title="Fold the checklist away" aria-label="Fold the checklist away" @click="finishing = false">&times;</button></div>
      <template v-if="!slim || finishing">
      <ol class="nge-orph-check">
        <li v-if="!veteran" :class="{ done: form.fixed }">
          <label title="Cut off anything that belongs to another cell and merge in missing pieces."><input type="checkbox" v-model="form.fixed" /> <b>Fix splits and merges</b></label>
        </li>
        <li v-if="!veteran" :class="{ done: form.ends }">
          <label title="Follow each branch to its tip and extend it where it was cut short."><input type="checkbox" v-model="form.ends" /> <b>Check every end</b></label>
        </li>
        <li :class="{ done: form.pointOk }">
          <div class="nge-orph-row"><span><b>Crosshairs in</b></span>
            <span class="nge-orph-seg">
              <button :class="{ on: form.where === 'dendrite' }" @click="form.where = 'dendrite'">major dendrite</button>
              <button :class="{ on: form.where === 'soma' }" @click="form.where = 'soma'">soma</button>
            </span>
            <button class="nge-orph-btn" :disabled="form.checking" @click="usePoint" :title="`Put the crosshairs inside the ${form.where === 'soma' ? 'soma' : 'thickest dendrite'}, then press this.`">{{ form.checking ? 'Checking…' : 'Use crosshairs' }}</button>
          </div>
          <div v-if="form.pointMsg" class="nge-orph-row">
            <span v-if="form.pointMsg" class="nge-orph-note" :class="{ 'nge-orph-note--err': !form.pointOk }">{{ form.pointMsg }}</span>
          </div>
        </li>
        <li v-if="form.where === 'soma'" :class="{ done: form.noNucleus || !!form.nucId.trim() }">
          <div class="nge-orph-row" title="In Retina each nucleus is its own segment. Put the crosshairs on the nucleus inside the soma and press Use crosshairs.">
            <b>Nucleus</b>
            <button class="nge-orph-btn" :disabled="form.noNucleus || nucChecking" @click="useNucleus">{{ nucChecking ? 'Reading…' : 'Use crosshairs' }}</button>
            <span v-if="form.nucId && !form.noNucleus" class="nge-orph-nucid" :title="form.nucId">{{ short(form.nucId) }}</span>
            <label class="nge-orph-sub"><input type="checkbox" v-model="form.noNucleus" /> No nucleus</label>
          </div>
          <div v-if="nucMsg && !form.noNucleus" class="nge-orph-row"><span class="nge-orph-note" :class="{ 'nge-orph-note--err': !form.nucId }">{{ nucMsg }}</span></div>
        </li>
      </ol>
      <textarea v-if="noteOpen || form.note" v-model="form.note" class="nge-orph-input nge-orph-notes" :rows="slim ? 1 : 2" placeholder="Notes for the lab (optional): what you think it is, anything odd"></textarea>

      <div class="nge-orph-row">
        <button v-if="!slim" class="nge-orph-btn nge-orph-submit" :disabled="!canSubmit || sending" :title="missing.length ? `Still to do: ${missing.join(', ')}.` : ''" @click="submit">{{ sending ? 'Sending…' : completeLabel }}</button>
        <button v-if="form.saved" class="nge-orph-btn" @click="step(1)">Next segment &rsaquo;</button>
        <button v-if="!noteOpen && !form.note" class="nge-orph-link" @click="noteOpen = true">Add a note</button>
      </div>
      <div v-if="sendError" class="nge-orph-note nge-orph-note--err">{{ sendError }}</div>
      <div v-else-if="form.saved" class="nge-orph-note nge-orph-note--ok">{{ lastSent || 'Sent to the lab. Send again to change your answer.' }}</div>
      <div v-else-if="missing.length" class="nge-orph-note">Still to do: {{ missing.join(', ') }}.</div>
      </template>
    </div>

    <div v-if="!slim" class="nge-orph-list">
      <button v-for="(r, i) in cur.rows" :key="r.id" class="nge-orph-item" :class="{ 'nge-orph-item--on': active?.id === r.id, 'nge-orph-item--done': !!saves[r.id], 'nge-orph-item--held': !saves[r.id] && (held.has(r.id) || taken.has(r.id)) }"
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
.nge-orph--slim .nge-orph-task { margin-top: 8px; }
.nge-orph-slim-empty { padding: 10px 12px; }
.nge-orph--slim .nge-orph-task { margin: 4px 6px 6px; padding: 7px 9px; gap: 5px; }
.nge-orph--slim .nge-orph-task-name { font-size: 14px; }
.nge-orph--slim .nge-orph-task-id { font-size: 13px; }
.nge-orph--slim .nge-orph-task-meta { font-size: 12px; }
.nge-orph--slim .nge-orph-btn { padding: 3px 8px; font-size: 12px; }
.nge-orph--slim .nge-orph-check { gap: 4px; font-size: 12.5px; line-height: 1.35; padding-left: 18px; }
.nge-orph--slim .nge-orph-input { height: 24px; font-size: 12px; width: 120px; }
.nge-orph--slim .nge-orph-notes { width: auto; height: auto; }
.nge-orph-task-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nge-orph-task-id { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14.5px; user-select: all; }
.nge-orph-copy { font: 600 11.5px Inter, sans-serif; padding: 2px 8px; border-radius: 5px; cursor: pointer; color: #9fd0ff; background: rgba(74, 158, 255, 0.1); border: 1px solid rgba(126, 202, 255, 0.35); }
.nge-orph-copy:hover { background: rgba(74, 158, 255, 0.2); }
.nge-orph-slimrow { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 2px; }
.nge-orph-slimid { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 0 1 auto; }
.nge-orph-slimtop { display: flex; align-items: center; gap: 6px; }
.nge-orph-slimicon { flex: 0 0 26px; width: 26px; height: 26px; object-fit: contain; filter: drop-shadow(0 0 3px rgba(79, 207, 255, 0.5)); }
.nge-orph-slimlabel { font: 700 13.5px 'Orbitron', 'Inter', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #9fd0ff; }
.nge-orph-slimmeta { font-size: 12px; color: #a9b8cc; white-space: nowrap; }
.nge-orph-slimbtns { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; justify-content: flex-end; }
.nge-orph-slimrow .nge-orph-btn { padding: 6px 11px; font-size: 13px; }
.nge-orph-complete { color: #c8fbea !important; border-color: rgba(62, 236, 190, 0.6) !important; background: rgba(20, 90, 70, 0.35) !important; }
.nge-orph-complete.on { background: rgba(20, 110, 85, 0.6) !important; }
.nge-orph-finishhead { justify-content: flex-start; font-size: 13px; color: #eef; }
.nge-orph-finishhead > button:first-of-type { margin-left: auto; }
.nge-orph-complete { padding: 4px 14px; }
.nge-orph-playbtn { color: #9ff5da; border-color: rgba(62, 236, 190, 0.5); }
.nge-orph-help-btn { width: 24px; height: 24px; border-radius: 50%; border: 1px solid rgba(126, 202, 255, 0.45); background: transparent; color: #9fd0ff; font: 700 13px 'Inter', sans-serif; cursor: pointer; padding: 0; }
.nge-orph-help-btn.on, .nge-orph-help-btn:hover { background: rgba(74, 158, 255, 0.18); color: #fff; }
.nge-orph-help { font-size: 12.5px; line-height: 1.45; color: #c3d0e2; background: rgba(10, 18, 32, 0.7); border: 1px solid rgba(126, 202, 255, 0.25); border-radius: 8px; padding: 7px 10px; display: flex; flex-direction: column; gap: 5px; }
.nge-orph-help p { margin: 0; }
.nge-orph-help b { color: #eef; }
.nge-orph-stop { margin-left: auto; align-self: center; }
.nge-orph-groupsel { font: inherit; font-weight: 600; background: rgba(10, 18, 32, 0.9); border: 1px solid rgba(126, 202, 255, 0.35); border-radius: 5px; padding: 0 2px; cursor: pointer; }
.nge-orph-groupsel option { color: #dce6f5; background: #0b1220; }
.nge-orph-playhere-row { display: flex; align-items: center; gap: 10px; margin: 2px 12px 8px; flex-wrap: wrap; }
.nge-orph-playhere { display: inline-flex; align-items: center; gap: 6px; padding: 5px 13px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(62, 236, 190, 0.7); background: linear-gradient(135deg, rgba(8, 72, 64, 0.94), rgba(10, 48, 66, 0.94));
  color: #dcfff4; font: 700 12.5px/1 'Orbitron', Inter, system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase;
  text-shadow: 0 0 8px rgba(62, 236, 190, 0.6); box-shadow: 0 0 12px rgba(62, 236, 190, 0.3); }
.nge-orph-playhere svg { color: #3eecbe; }
.nge-orph-playhere:hover { box-shadow: 0 0 18px rgba(62, 236, 190, 0.55); }
.nge-orph-playhere-hint { font-size: 12px; color: #9fb4cc; }
/* In the Cell Library's own colors and sizes (see RetinaCastTab). */
.nge-orph { display: flex; flex-direction: column; }
.nge-orph-banner { position: relative; height: 92px; margin: -10px -12px 4px; background-size: cover; background-position: center 30%; display: flex; align-items: flex-end; padding: 0 14px 9px; }
.nge-orph-banner::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(8, 12, 24, 0) 35%, rgba(8, 12, 24, 0.85) 100%); pointer-events: none; }
.nge-orph-banner .nge-orph-title { position: relative; z-index: 1; font-size: 16px; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8); }
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
.nge-orph-item--held { opacity: 0.45; }
/* Training Sim's look (Ames 2026-11-20). Quiet buttons: thin edge, soft words. */
.nge-orph-slimrow .nge-orph-btn:not(.nge-orph-circ), .nge-orph--slim .nge-orph-task .nge-orph-btn { padding: 5px 9px; border: 1px solid rgba(127, 190, 255, 0.22); border-radius: 6px; background: transparent; color: #a9c3e0; font: 500 12px/1 Inter, system-ui, sans-serif; }
.nge-orph-slimrow .nge-orph-btn:not(.nge-orph-circ):hover:not(:disabled), .nge-orph--slim .nge-orph-task .nge-orph-btn:hover:not(:disabled) { border-color: rgba(127, 216, 255, 0.55); background: rgba(74, 158, 255, 0.12); color: #e6f0ff; }
/* Action buttons in the checklist: filled blue, as Training Sim's. */
.nge-orph--slim .nge-orph-check .nge-orph-btn { border-color: #7fd8ff; background: rgba(74, 158, 255, 0.3); color: #fff; font-weight: 600; }
.nge-orph--slim .nge-orph-check .nge-orph-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.45); border-color: #a8e4ff; color: #fff; }
.nge-orph-seg { border-color: rgba(127, 190, 255, 0.35); border-radius: 6px; }
.nge-orph-seg button { color: #a9c3e0; font: 600 12px/1.3 Inter, system-ui, sans-serif; padding: 4px 9px; }
.nge-orph-seg button.on { background: rgba(74, 158, 255, 0.3); color: #fff; box-shadow: inset 0 0 0 1px #7fd8ff; }
.nge-orph-finishhead b { font: 600 12px/1 Orbitron, Inter, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #d6e2f5; }
/* Complete and Skip: the circuit edge, green and blue as Training Sim's Complete and Jump. */
.nge-orph-slimrow .nge-orph-circ { --cc: 127, 216, 255; --fill: rgba(127, 216, 255, 0.1); --fill-on: rgba(127, 216, 255, 0.2); position: relative; isolation: isolate; overflow: visible; border: 0 !important; border-radius: 0; background: none !important; box-shadow: none; color: #eef8ff !important; font: 600 13px/1 Inter, system-ui, sans-serif; padding: 9px 16px; }
.nge-orph-slimrow .nge-orph-complete { --cc: 62, 236, 190; --fill: rgba(32, 150, 110, 0.28); --fill-on: rgba(36, 170, 124, 0.42); color: #eafff6 !important; }
.nge-orph-slimrow .nge-orph-circ:hover:not(:disabled) { filter: drop-shadow(0 0 6px rgba(var(--cc), 0.35)); }
.nge-orph-slimrow .nge-orph-circ:focus-visible { outline: none; }
.nge-orph-label { position: relative; z-index: 1; }
.nge-orph-slimrow .nge-orph-circ :deep(.nge-orph-frame) { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.nge-orph-slimrow .nge-orph-circ :deep(.nge-orph-frame svg) { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.nge-orph-slimrow .nge-orph-circ :deep(.rim) { fill: var(--fill); stroke: rgba(var(--cc), 0.72); stroke-width: 1; transition: fill 0.15s, stroke 0.15s; }
.nge-orph-slimrow .nge-orph-circ:hover:not(:disabled) :deep(.rim), .nge-orph-slimrow .nge-orph-complete.on :deep(.rim) { fill: var(--fill-on); stroke: rgb(var(--cc)); }
.nge-orph-slimrow .nge-orph-circ:focus-visible :deep(.rim) { stroke: #fff; }
.nge-orph-slimrow .nge-orph-circ :deep(.tr) { fill: none; stroke: rgba(var(--cc), 0.6); stroke-width: 1; stroke-linejoin: round; stroke-linecap: round; }
.nge-orph-slimrow .nge-orph-circ :deep(.pad) { fill: rgb(var(--cc)); }
.nge-orph-slimrow .nge-orph-circ :deep(.via) { fill: #0a1322; stroke: rgba(var(--cc), 0.85); stroke-width: 1; }
.nge-orph-slimrow .nge-orph-circ :deep(.pin) { fill: rgba(var(--cc), 0.7); }
.nge-orph-slimrow .nge-orph-circ :deep(.side) { fill: #0a1322; stroke: rgb(var(--cc)); stroke-width: 1.4; filter: drop-shadow(0 0 3px rgba(var(--cc), 0.8)); }
.nge-orph-slimrow .nge-orph-circ :deep(.side-in) { fill: rgb(var(--cc)); }
.nge-orph-slimrow .nge-orph-hl { display: grid; place-items: center; width: 32px; height: 32px; padding: 0 !important; }
.nge-orph-slimrow .nge-orph-hl :deep(svg) { width: 20px !important; height: 20px !important; }
.nge-orph-nucid { font: 600 12px 'JetBrains Mono', ui-monospace, monospace; color: #cfe6ff; }
.nge-orph-item--on { background: rgba(74, 158, 255, 0.14); border-color: rgba(126, 202, 255, 0.35); }
.nge-orph-item-i { color: #6c7a90; font-variant-numeric: tabular-nums; text-align: right; }
.nge-orph-item-id { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #eef; overflow: hidden; text-overflow: ellipsis; }
.nge-orph-item-flag { font-size: 11.5px; color: #93a0b6; }
.nge-orph-item-v { font-size: 12px; color: #a9b8cc; font-variant-numeric: tabular-nums; }
.nge-orph-item-s { color: #6fe0d0; font-weight: 700; }
.nge-orph-item--done .nge-orph-item-id { color: #a6ffd6; }
</style>
