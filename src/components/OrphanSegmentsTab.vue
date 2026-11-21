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
import { currentSegLayer, currentCellTypes, cellTypeLabel } from '../datasets';
import { explainCellType } from '../data/cell_type_glossary';
import { useCellHistoryStore, useProofreadingBackendStore, useUserStatsStore } from '../store';
import { secureWrite } from '../secure_write';
import { postLostFragmentPoint, saveCellType, getCellStatus, activeCaveServer, getLastCellTypeProblem } from '../widgets/lightbulb_service';
import { cellAtCrosshair, supervoxelAtPlace } from '../util/crosshair_cell';
import { getRootFromSupervoxel, ancestorAmong } from '../widgets/pcg_service';
import { NURRO_IMAGES } from '../widgets/lightbulb_service';
import { getToolbarIconDef } from '../data/toolbar-icons';
import EditableText from './EditableText.vue';
import QuestInstructions from './QuestInstructions.vue';
import { FRAGMENT_LIMIT, keptFragmentIds, setHeldFragments, markKept, dropHeld, heldFragments, pendingFragment, heldOf, localDrafts, saveLocalDraft, type FragmentDraft } from '../util/my_fragments';
import { fragmentsDone, nextMilestone, setFragmentsDone, addFragmentDone } from '../util/fragment_milestones';
import {
  ORPHANS_LARGE, ORPHANS_SMALLER, ORPHANS_GLIA, ORPHANS_SOMA, ORPHAN_POOL, orphanName,
  type OrphanSeg, type OrphanFlag,
} from '../data/orphan-segments';

const props = defineProps<{ playTick?: number; slim?: boolean }>();

/** After five fragments a player knows the drill (Ames 2026-11-20: power
 *  players "not going to want to have to check fix splits and merges and
 *  check every end every time"): the first two ticks go away and count as done. */
const VETERAN_AT = 5;
/** The how-to, admins edit it in the game (EditableText, key howto.lost_fragments). */
const HOWTO_LINES = [
  '<b>Fix splits and merges.</b> Cut off anything that belongs to another cell, and merge in pieces that are missing.',
  '<b>Check every end.</b> Follow each branch to its tip and extend it where it was cut short.',
  '<b>Crosshairs.</b> Put the crosshairs inside the thickest dendrite, or inside the soma if it has one, then press Use crosshairs. Pyr checks the point is inside this fragment.',
  '<b>Part of it belongs to another cell?</b> Cut it off and merge it into its own cell. If that cell is already proofread, you are done with it. If not, proofread it too, or stash it for later so anyone can pick it up. Never merge into an unrelated cell to get rid of a piece, and never delete anything.',
  'After 5 fragments, Pyr trusts you on 1 and 2 and stops asking.',
  '<b>Highlight</b> opens Highlight mode to mark what you checked: with Merge or Cut open, Ctrl+click goes to them and H+click highlights.',
];
/** The top bar's Highlight can, in place of the word (Ames 2026-11-20). */
const HIGHLIGHT_ICON = getToolbarIconDef('highlight')?.svg ?? '';
const name = orphanName();

type GroupKey = 'large' | 'smaller' | 'glia' | 'soma' | 'stashed';
/** Cells players found attached to a fragment and stashed for proofreading
 *  (Ames 2026-11-20), from the server's list. Played like any fragment. */
const STASHED = reactive<OrphanSeg[]>([]);
const GROUPS: { key: GroupKey; label: string; about: string; color: string; rows: OrphanSeg[] }[] = [
  { key: 'large',   label: 'Large',     color: '#7ecaff', rows: ORPHANS_LARGE,
    about: 'Big pieces with no flag. Most are parts of neurons cut off from their cell.' },
  { key: 'smaller', label: 'Small',   color: '#9fb4ff', rows: ORPHANS_SMALLER,
    about: 'The smallest of each kind. Fewer clues, so they can be harder to place.' },
  { key: 'glia',    label: 'Glia-like', color: '#6fe0d0', rows: ORPHANS_GLIA,
    about: 'The shape looks like a glial cell. Check it, and look for a soma.' },
  { key: 'soma',    label: 'Soma-like', color: '#c9b6ff', rows: ORPHANS_SOMA,
    about: 'May have a cell body. Put the point in the soma.' },
  { key: 'stashed', label: 'Stashed', color: '#ffd35a', rows: STASHED,
    about: 'Cells another player found attached to a fragment and saved for later. Proofread the whole cell.' },
];
/** The groups to show: Stashed only once something is in it. */
const shownGroups = computed(() => GROUPS.filter(g => g.key !== 'stashed' || STASHED.length > 0));
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
  /** The cell type the player chose, if any (Ames 2026-11-20). */
  cellType?: string;
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
  cellType: '', cellTypeCustom: '',
});
/** The cell type, the same list and save as Complete in the Cell Library
 *  (Ames 2026-11-20: "add a way to label the cell class in Lost Frags? we
 *  have automated labeling but it's not run on all cells"). Optional. It goes
 *  to CAVE's cell type table and the game's log, as every type does. */
const cellTypes = computed(() => currentCellTypes());
const typeKnown = ref('');
const typeAnnId = ref<number | undefined>(undefined);
const typeNote = ref('');
/** Part of the fragment belonged to another cell (Ames 2026-11-20). The
 *  player puts the crosshairs in that cell: Pyr says whether it is already
 *  proofread, and if not, they proofread it too or stash it for later. */
const other = reactive({ open: false, checking: false, root: '' as string, pt: null as [number, number, number] | null,
  done: false, choice: '' as '' | 'stashed' | 'proofread', msg: '', err: false });
function resetOther() { Object.assign(other, { open: false, checking: false, root: '', pt: null, done: false, choice: '', msg: '', err: false }); }
async function checkOther() {
  const row = active.value;
  if (!row || other.checking) return;
  other.checking = true; other.msg = ''; other.err = false; other.root = ''; other.done = false; other.choice = '';
  try {
    const at = await cellAtCrosshair();
    if (!at.root) { other.msg = at.problem || 'There is no cell under the crosshairs.'; other.err = true; return; }
    const mineNow = at.root === shownRoot.value || at.root === row.id
      || !!(await ancestorAmong(at.root, [shownRoot.value, row.id].filter(Boolean) as string[]).catch(() => undefined));
    if (mineNow) { other.msg = 'The crosshairs are in this fragment. Put them in the other cell.'; other.err = true; return; }
    other.root = at.root; other.pt = at.position;
    const server = activeCaveServer();
    const st = server ? await getCellStatus(server, at.root).catch(() => null) : null;
    if (active.value?.id !== row.id) return;
    if (st?.isComplete) {
      other.done = true;
      other.msg = 'That cell is already proofread. Merge the piece into it, and that is all.';
    } else if (st?.unreachable || !st) {
      other.msg = 'Pyr could not ask whether that cell is proofread. Choose what to do with it.';
    } else {
      other.msg = 'That cell is not proofread yet. Proofread it too, or stash it for later?';
    }
  } finally { other.checking = false; }
}
const typeTitle = (t: string) => explainCellType(t).join(String.fromCharCode(10)) || undefined;
const typeOpen = ref(false);
const typeBox = ref<HTMLElement | null>(null);
const typeList = ref<HTMLElement | null>(null);
/** The list floats over the page (the slim box would cut it off), under the
 *  button, or above it when there is no room below. */
const typeListPos = ref<Record<string, string>>({});
watch(typeOpen, open => {
  if (!open || !typeBox.value) return;
  const r = typeBox.value.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 12;
  const h = Math.min(280, Math.max(below, r.top - 12));
  typeListPos.value = below >= 200 || below >= r.top
    ? { top: `${Math.round(r.bottom + 4)}px`, left: `${Math.round(r.left)}px`, width: `${Math.round(Math.max(r.width, 220))}px`, maxHeight: `${Math.round(h)}px` }
    : { bottom: `${Math.round(window.innerHeight - r.top + 4)}px`, left: `${Math.round(r.left)}px`, width: `${Math.round(Math.max(r.width, 220))}px`, maxHeight: `${Math.round(h)}px` };
});
function pickType(t: string) { form.cellType = t; form.cellTypeCustom = ''; typeOpen.value = false; }
function onTypeKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { typeOpen.value = false; return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const list = ['', ...cellTypes.value];
  const i = list.indexOf(form.cellType);
  form.cellType = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
  form.cellTypeCustom = '';
}
function onTypeOutside(e: PointerEvent) {
  if (typeOpen.value && typeBox.value && !typeBox.value.contains(e.target as Node) && !typeList.value?.contains(e.target as Node)) typeOpen.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onTypeOutside, true));
onUnmounted(() => document.removeEventListener('pointerdown', onTypeOutside, true));
function fillType(t: string) {
  if (!t || form.cellType || form.cellTypeCustom) return;
  if (cellTypes.value.includes(t)) form.cellType = t; else form.cellTypeCustom = t;
}
/** What CAVE already has for the fragment's cell, once the checklist opens. */
async function prefillType() {
  const root = shownRoot.value || active.value?.id;
  const server = activeCaveServer();
  if (!root || !server || !cellTypes.value.length) return;
  const st = await getCellStatus(server, root).catch(() => null);
  if (!st || (shownRoot.value || active.value?.id) !== root) return;
  typeAnnId.value = st.cellTypeAnnotationId;
  typeKnown.value = st.cellType || '';
  fillType(typeKnown.value);
}
const place = computed(() => active.value ? cur.value.rows.findIndex(r => r.id === active.value!.id) : -1);

function resetForm(s?: OrphanSave) {
  form.fixed = s?.fixed ?? false; form.ends = s?.ends ?? false;
  form.where = s?.where ?? (group.value === 'soma' ? 'soma' : 'dendrite');
  form.point = s?.point ?? null; form.pointOk = !!s?.point;
  form.pointMsg = s?.point ? `Saved at ${s.point.join(', ')}.` : '';
  form.nucId = s?.nucId ?? ''; form.noNucleus = s?.noNucleus ?? false; form.note = s?.note ?? '';
  form.saved = !!s;
  form.cellType = ''; form.cellTypeCustom = '';
  typeKnown.value = ''; typeAnnId.value = undefined; typeNote.value = '';
  fillType(s?.cellType || '');
  resetOther();
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
    else if (!saves[row.id]) applyDraft(row.id);
    lastSnap.set(row.id, JSON.stringify(currentDraft()));
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
  void flushProgress();
  active.value = row;
  shownRoot.value = row.id;
  resetForm(saves[row.id]);
  if (!saves[row.id]) applyDraft(row.id);
  history.jumpToCell(row.id, row.pt);
  finishing.value = false;
  claimMsg.value = '';
  progressNote.value = '';
  closeSelectionPanel();
  await followRoot(row);
}

// ── A fragment is tracked like a claimed cell (Ames 2026-11-21: "a lost
// fragment is essentially a cell so you need to track the ID from the initial
// coordinates"). Its anchor is a supervoxel at the spot the lab listed it;
// that supervoxel's root is the fragment's ID now, after anyone's merges and
// cuts. The anchor and the ID are kept on the claim (fragments.progress).
const anchors: Record<string, string> = {};
/** The supervoxel at a place, from the stored volume or, failing that, from
 *  the chunks on screen once they load (as a cell claim's anchor is read). */
function loadedSupervoxelAt(pt: [number, number, number]): string | null {
  try {
    const v: any = (window as any).viewer;
    const p = Float32Array.from(pt);
    for (const ml of v?.layerManager?.managedLayers ?? []) {
      if (ml.archived || !ml.layer?.displayState?.segmentSelectionState) continue;
      for (const rl of ml.layer.renderLayers ?? []) {
        const got = rl.getValueAt?.(p);
        const sv = got == null ? '' : String(Array.isArray(got) ? got[0] : got);
        if (sv && sv !== '0' && Math.floor(Number(sv) / 2 ** 56) === 1) return sv;
      }
    }
  } catch { /* viewer not ready */ }
  return null;
}
async function anchorAt(row: OrphanSeg): Promise<string | null> {
  const direct = await supervoxelAtPlace(row.pt).catch(() => null);
  if (direct && direct !== '0') return direct;
  for (let i = 0; i < 14 && active.value?.id === row.id; i++) {
    const sv = loadedSupervoxelAt(row.pt);
    if (sv) return sv;
    await new Promise(res => setTimeout(res, 500));
  }
  return null;
}
function showRoot(row: OrphanSeg, root: string) {
  if (active.value?.id !== row.id || root === shownRoot.value) return;
  try {
    const visible = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    for (const old of [shownRoot.value, row.id]) if (old && old !== root) visible?.delete(Uint64.parseString(old));
    visible?.add(Uint64.parseString(root));
  } catch { /* layer went away */ }
  shownRoot.value = root;
}
/** Find the fragment's current ID and show it. Returns it, or null. */
async function followRoot(row: OrphanSeg): Promise<string | null> {
  const h = heldOf(row.id), loc = localDrafts()[row.id];
  let anchor = anchors[row.id] || h?.anchor || loc?.anchor || null;
  // The ID saved on the claim, at once, while the anchor is looked up.
  if (h?.root || loc?.root) showRoot(row, (h?.root || loc?.root)!);
  let root: string | null = null;
  if (anchor) root = await getRootFromSupervoxel(anchor).catch(() => null);
  if (!root) {
    const sv = await anchorAt(row);
    if (!sv || active.value?.id !== row.id) return null;
    root = await getRootFromSupervoxel(sv).catch(() => null);
    if (!root) return null;
    // A new anchor only when that spot is still this fragment (or what it became).
    const ours = root === row.id || !!(await ancestorAmong(root, [row.id]).catch(() => undefined));
    if (ours) anchor = sv;
  }
  if (active.value?.id !== row.id) return root;
  if (anchor) anchors[row.id] = anchor;
  showRoot(row, root);
  const known = h?.root || loc?.root || row.id;
  saveLocalDraft(row.id, { root, anchor });
  // Kept on the claim when it is this player's, so another computer finds it too.
  if (isMine(row.id) && (anchor !== (h?.anchor || null) || root !== known)) {
    void sendProgress(row.id, { anchorSv: anchor || undefined, rootId: root });
  }
  return root;
}
const isMine = (id: string) => myClaim.value === id || !!heldOf(id);

// ── The work so far, saved as the player goes: ticks, point, type and note
// come back after a reload, on another computer, and from My Cells.
const progressNote = ref('');
function currentDraft(): FragmentDraft {
  return { fixed: form.fixed, ends: form.ends, where: form.where, point: form.point ? [...form.point] as [number, number, number] : null,
    pointOk: form.pointOk, note: form.note, cellType: form.cellType, cellTypeCustom: form.cellTypeCustom };
}
const lastSnap = new Map<string, string>();
const draftWork = (d: FragmentDraft) => d.fixed || d.ends || !!d.point || !!d.note.trim() || !!d.cellType || !!d.cellTypeCustom.trim();
/** The newest saved work for a fragment, from the server's claim or this browser. */
function applyDraft(id: string) {
  const h = heldOf(id), loc = localDrafts()[id];
  const d = (loc?.draft && (loc.at || 0) > (h?.draftAt || 0)) ? loc.draft : (h?.draft || loc?.draft || null);
  if (d) {
    Object.assign(form, { fixed: !!d.fixed, ends: !!d.ends, where: d.where === 'soma' ? 'soma' : 'dendrite',
      point: d.point || null, pointOk: !!(d.point && d.pointOk), note: d.note || '',
      cellType: d.cellType || '', cellTypeCustom: d.cellTypeCustom || '' });
    form.pointMsg = d.point ? `Saved at ${d.point.join(', ')}.` : '';
  }
  lastSnap.set(id, JSON.stringify(currentDraft()));
}
let pending: { id: string; draft: FragmentDraft } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function queueProgress() {
  const a = active.value;
  if (!a || saves[a.id] || form.saved) return;
  const d = currentDraft();
  const snap = JSON.stringify(d);
  if (snap === lastSnap.get(a.id)) return;
  lastSnap.set(a.id, snap);
  saveLocalDraft(a.id, { draft: d });   // this browser at once
  const h = heldOf(a.id);
  if (h) { h.draft = d; h.draftAt = Date.now(); }
  if (!draftWork(d) && !isMine(a.id)) return;
  pending = { id: a.id, draft: d };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushProgress(), 1200);
}
async function flushProgress() {
  clearTimeout(saveTimer);
  const p = pending; pending = null;
  if (!p) return;
  await sendProgress(p.id, { draft: p.draft, anchorSv: anchors[p.id], rootId: active.value?.id === p.id && shownRoot.value !== p.id ? shownRoot.value || undefined : undefined });
}
/** Saves on the claim; working on a fragment claims it, as Play would. */
async function sendProgress(id: string, body: { draft?: FragmentDraft; anchorSv?: string; rootId?: string | null }) {
  try {
    const res = await secureWrite<{ saved: boolean; kept?: boolean; reason?: string; keptIds?: string[] }>('fragments.progress', { fragmentId: id, ...body });
    if (res && res.saved) {
      if (!heldOf(id)) heldFragments.list.push({ id, kept: !!res.kept, at: new Date().toISOString() });
      const h = heldOf(id)!;
      if (res.kept) markKept(id);
      if (body.draft) { h.draft = body.draft; h.draftAt = Date.now(); }
      if (body.anchorSv) h.anchor = body.anchorSv;
      if (body.rootId) h.root = body.rootId;
      if (active.value?.id === id) { progressNote.value = 'Progress saved.'; if (!myClaim.value) myClaim.value = id; }
      return;
    }
    if (active.value?.id !== id) return;
    progressNote.value = res && res.reason === 'full'
      ? `Saved in this browser only: you have ${FRAGMENT_LIMIT} Lost Fragments started. Complete or skip one in My Cells.`
      : res && res.reason === 'held' ? 'Saved in this browser only: another player is working on this one.'
      : res && res.reason === 'done' ? 'Someone has already completed this one.' : '';
  } catch {
    // A server without fragments.progress yet: an edit still keeps it (fragments.keep).
    if (body.rootId || (body.draft && draftWork(body.draft))) {
      void secureWrite<{ kept: boolean }>('fragments.keep', { fragmentId: id }).then(res => { if (res && res.kept) markKept(id); }).catch(() => undefined);
    }
    if (active.value?.id === id) progressNote.value = 'Saved in this browser.';
  }
}
watch(() => [form.fixed, form.ends, form.where, form.point, form.pointOk, form.note, form.cellType, form.cellTypeCustom], queueProgress);
onMounted(() => window.addEventListener('pagehide', flushProgress));
onUnmounted(() => { window.removeEventListener('pagehide', flushProgress); void flushProgress(); });
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
    if (res && res.claimed) {
      myClaim.value = row.id;
      // Landing here let go of the last one, unless it was kept.
      heldFragments.list = heldFragments.list.filter(f => f.kept || f.id === row.id);
      if (!heldFragments.list.some(f => f.id === row.id)) heldFragments.list.push({ id: row.id, kept: false, at: new Date().toISOString() });
      const h = heldOf(row.id)!;
      if (anchors[row.id] && h.anchor !== anchors[row.id]) {
        void sendProgress(row.id, { anchorSv: anchors[row.id], rootId: active.value?.id === row.id && shownRoot.value !== row.id ? shownRoot.value : undefined });
      }
      return;
    }
    // Five started already: back to those.
    if (res && res.claimed === false && res.reason === 'full') {
      setHeldFragments(((res as any).keptIds || []).map((id: string) => ({ fragment_id: id, kept: true })));
      if (active.value?.id === row.id && playing.value) playNext();
      return;
    }
    // Only a plain "someone has it" moves Play on; anything else plays on.
    if (!res || res.claimed !== false || (res.reason !== 'done' && res.reason !== 'held')) return;
    (res.reason === 'done' ? taken : held).add(row.id);
    if (active.value?.id === row.id && playing.value && !saves[row.id]) playNext();
  } catch { /* the server can't say; keep playing */ }
}
/** Claim from the full view, without Play (Ames 2026-11-20: "We do need a
 *  button for claim"). One claim per player, as with Play: claiming this one
 *  lets go of the last. */
const claimMsg = ref('');
const claiming = ref(false);
async function claimActive() {
  const a = active.value;
  if (!a || claiming.value) return;
  claiming.value = true; claimMsg.value = '';
  try {
    const res = await secureWrite<{ claimed: boolean; reason?: string }>('fragments.claim', { fragmentId: a.id });
    if (res && res.claimed) {
      myClaim.value = a.id; held.delete(a.id); claimMsg.value = 'Yours. Your progress saves as you go, until you skip or complete it.';
      if (!heldOf(a.id)) heldFragments.list.push({ id: a.id, kept: false, at: new Date().toISOString() });
      void sendProgress(a.id, { anchorSv: anchors[a.id], rootId: shownRoot.value !== a.id ? shownRoot.value : undefined, draft: currentDraft() });
      return;
    }
    if (res && res.claimed === false && res.reason === 'done') { taken.add(a.id); claimMsg.value = 'Someone has already completed this one.'; return; }
    if (res && res.claimed === false && res.reason === 'full') { claimMsg.value = `You have ${FRAGMENT_LIMIT} Lost Fragments started. Complete or skip one first: they are in My Cells.`; return; }
    if (res && res.claimed === false) { held.add(a.id); claimMsg.value = 'Another player is working on this one.'; return; }
    claimMsg.value = 'Could not claim it. Try again in a moment.';
  } catch { claimMsg.value = 'Could not claim it. Try again in a moment.'; }
  finally { claiming.value = false; }
}
async function releaseActive() {
  const a = active.value;
  if (!a || myClaim.value !== a.id) return;
  myClaim.value = null; claimMsg.value = 'Let go. Someone else can claim it now.';
  pending = null; clearTimeout(saveTimer);
  dropHeld(a.id);
  await secureWrite('fragments.release', { fragmentId: a.id }).catch(() => undefined);
}
/** With FRAGMENT_LIMIT started, Play takes you to those, one after another,
 *  until one is completed or skipped (Ames 2026-11-21). */
function nextKept(): { g: GroupKey; row: OrphanSeg } | null {
  const ids = keptFragmentIds.value.filter(id => !saves[id]);
  if (ids.length < FRAGMENT_LIMIT) return null;
  const at = active.value ? ids.indexOf(active.value.id) : -1;
  for (let k = 1; k <= ids.length; k++) {
    const f = findRow(ids[(at + k + ids.length) % ids.length]);
    if (f && f.row.id !== active.value?.id) return f;
  }
  return null;
}
const fullNote = ref('');
function playNext() {
  const kept = nextKept();
  if (kept) {
    allDone.value = false;
    fullNote.value = `You have ${FRAGMENT_LIMIT} Lost Fragments started. Complete or skip one, and Play gives you new ones again.`;
    group.value = kept.g;
    void open(kept.row);
    void claimHere(kept.row);
    document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Finish this one first', cell: 'Cell ID: ' + idNow(kept.row.id) } }));
    return;
  }
  fullNote.value = '';
  const n = nextUndone();
  if (!n) { allDone.value = true; return; }
  allDone.value = false;
  group.value = n.g;
  void open(n.row);
  void claimHere(n.row);
  document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Your Cell', cell: 'Cell ID: ' + idNow(n.row.id) } }));
}
/** Skip: give the fragment back, then the next one. */
function skip() {
  const a = active.value;
  if (a && !saves[a.id]) {
    if (myClaim.value === a.id) myClaim.value = null;
    if (pending?.id === a.id) { pending = null; clearTimeout(saveTimer); }
    dropHeld(a.id);
    void secureWrite('fragments.release', { fragmentId: a.id }).catch(() => undefined);
  }
  playNext();
}
const idNow = (id: string) => (active.value?.id === id && shownRoot.value) || heldOf(id)?.root || localDrafts()[id]?.root || id;
function findRow(id: string): { g: GroupKey; row: OrphanSeg } | null {
  for (const g of GROUPS) { const row = g.rows.find(r => r.id === id); if (row) return { g: g.key, row }; }
  return null;
}
// Pressing Play while a fragment is open and not yet submitted stays on it
// (Ames 2026-11-19: Play took her from Smaller back to Large, losing her note).
/** Where Start playing takes you back to (Ames 2026-11-21: "launch players
 *  back where they were"): the fragment open now if it is not sent, else the
 *  one you last worked on (the server's newest claim; saving work renews it),
 *  else none. */
const resumeId = computed(() => {
  const a = active.value;
  if (a && !saves[a.id]) return a.id;
  const m = myClaim.value;
  return m && !saves[m] && findRow(m) ? m : null;
});
let listLoad: Promise<void> | null = null;
async function playResume() {
  // After a reload the server's list says which fragment was yours: wait for it.
  if (!heldFragments.loaded && !active.value) {
    listLoad = listLoad || loadAnswers();
    await Promise.race([listLoad, new Promise(res => setTimeout(res, 6000))]);
  }
  const a = active.value;
  if (a && !saves[a.id]) {
    void claimHere(a);
    document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Your Cell', cell: 'Cell ID: ' + idNow(a.id) } }));
    return;
  }
  // The fragment this player holds, from another computer or an earlier visit.
  const mine = myClaim.value ? findRow(myClaim.value) : null;
  if (mine && !saves[mine.row.id]) {
    group.value = mine.g;
    void open(mine.row);
    void claimHere(mine.row);
    document.dispatchEvent(new CustomEvent('nge:play-landed', { detail: { title: 'Your Cell', cell: 'Cell ID: ' + idNow(mine.row.id) } }));
    return;
  }
  playNext();
}
watch(() => props.playTick, t => { if (t) void playResume(); });
onMounted(() => { restoreDraft(); if (props.playTick) void playResume(); });
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
/** The instructions open by themselves the first time a player comes to
 *  Lost Fragments, in the same box as the Cilia Quest's (Ames 2026-11-20:
 *  "We need an instructions pop-up for lost fragments as well"); ? opens
 *  them again. */
const HOWTO_SEEN_KEY = 'nge-lf-howto-seen';
function closeHelp() {
  helpOpen.value = false;
  try { localStorage.setItem(HOWTO_SEEN_KEY, '1'); } catch { /* private window */ }
}
onMounted(() => {
  let seen = true;
  try { seen = localStorage.getItem(HOWTO_SEEN_KEY) === '1'; } catch { /* storage blocked: do not nag */ }
  if (!seen) helpOpen.value = true;
});
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

/** Complete opens the checklist and reads the crosshairs straight away, so
 *  the point is filled in if they already sit in the fragment (Ames
 *  2026-11-20: "when I hit complete, it pre-fills with the crosshair
 *  position"). A point already saved is kept. */
function openFinish() {
  finishing.value = true;
  if (!form.point && !form.checking) void usePoint();
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
    // Its edit history: the cell under the crosshairs grew out of this
    // fragment (Ames 2026-11-20: "Crosshair check is failing"; the start
    // point read below can't read Retina's segmentation, so it never matched).
    if (!inShown && row) {
      const from = await ancestorAmong(at.root, [shownRoot.value, row.id].filter(Boolean) as string[]).catch(() => undefined);
      if (from && active.value?.id === row.id) {
        inShown = true;
        try {
          if (shownRoot.value && shownRoot.value !== at.root) visible?.delete(Uint64.parseString(shownRoot.value));
          visible?.add(Uint64.parseString(at.root));
        } catch { /* layer went away */ }
        shownRoot.value = at.root;
      }
    }
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
const canSubmit = computed(() => fixedOk.value && endsOk.value && form.pointOk && !!form.point);
const missing = computed(() => {
  const m: string[] = [];
  if (!fixedOk.value) m.push('fix the splits and merges');
  if (!endsOk.value) m.push('check the ends');
  if (!form.pointOk) m.push(`put a point in the ${form.where === 'soma' ? 'soma' : 'major dendrite'}`);
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
  const type = (form.cellTypeCustom.trim() || form.cellType).trim().slice(0, 120);
  typeNote.value = '';
  if (type && type !== typeKnown.value) {
    const server = activeCaveServer();
    const ok = server ? await saveCellType(server, root, type, typeAnnId.value, true, pt).catch(() => false) : false;
    if (!ok) {
      typeNote.value = getLastCellTypeProblem() || 'The cell type could not be saved. Try again, or leave it empty.';
      sending.value = false;
      return;
    }
    typeKnown.value = type;
  }
  if (other.root && !other.done && !other.choice) {
    sendError.value = 'Choose what to do with the other cell: proofread it too, or stash it.';
    sending.value = false;
    return;
  }
  let proofreadNext = '';
  if (other.root && other.choice) {
    try {
      const st = await secureWrite<{ stashed: boolean; claimed?: boolean }>('fragments.stash',
        { rootId: other.root, fromFragmentId: row.id, pt: other.pt, choice: other.choice === 'proofread' ? 'proofread' : 'stash' });
      if (other.choice === 'proofread' && st && st.claimed) proofreadNext = other.root;
    } catch (e: any) {
      sendError.value = String((e && e.message) || 'The other cell could not be stashed. Try again in a moment.');
      sending.value = false;
      return;
    }
  }
  const otherRoot = other.root && (other.done || other.choice) ? other.root : '';
  const otherStatus = other.done ? 'done' : other.choice;
  try {
    // CAVE first, once per fragment; a resubmit keeps the row it has.
    let caveId = saves[row.id]?.caveId ?? null;
    if (caveId == null) caveId = await postLostFragmentPoint(pt);
    const res = await secureWrite<{ first: boolean; sheet: string }>('fragments.submit', {
      fragmentId: row.id, group: group.value, rootId: root, labFlag: FLAG_WORDS[row.flag], labUm3: row.um3,
      fixed: fixedOk.value, ends: endsOk.value, pointIn: form.where, pt,
      nucleusId: form.where === 'soma' && !form.noNucleus ? form.nucId.trim() : '', noNucleus: form.noNucleus,
      note: form.note.trim(), caveAnnotationId: caveId,
      otherRoot, otherStatus,
    });
    serverOn.value = true;
    saves[row.id] = {
      id: row.id, group: group.value, root, fixed: fixedOk.value, ends: endsOk.value, where: form.where, point: pt,
      nucId: form.nucId.trim(), noNucleus: form.noNucleus, note: form.note.trim(), at: Date.now(), caveId,
      cellType: type || saves[row.id]?.cellType || '',
    };
    persist();
    if (res && res.first) { countCompleted(root, pt, row.id); addFragmentDone(); }
    if (myClaim.value === row.id) myClaim.value = null;
    if (pending?.id === row.id) { pending = null; clearTimeout(saveTimer); }
    dropHeld(row.id);
    lastSent.value = res && res.sheet === 'failed' ? 'Sent to the lab. The sheet will catch up.' : 'Sent to the lab.';
    if (caveId == null) lastSent.value += ' CAVE was busy, so Pyr sends the point again later.';
  } catch (e: any) {
    sendError.value = String((e && e.message) || 'Could not send it. Try again in a moment.');
    return;
  } finally { sending.value = false; }
  if (active.value?.id !== row.id) return;
  form.saved = true;
  finishing.value = false;
  // Proofread it too: the stashed cell is theirs, and opens next.
  if (proofreadNext) {
    await loadAnswers();
    const next = STASHED.find(x => x.id === proofreadNext);
    if (next) { group.value = 'stashed'; myClaim.value = next.id; void open(next); return; }
  }
  if (playing.value) playNext();
}

/** Who stashed each stashed cell, for its row. */
const stashBy = reactive<Record<string, string>>({});
function loadStash(list: any[]) {
  const rows: OrphanSeg[] = [];
  for (const x of list) {
    if (!x || !/^\d{15,20}$/.test(String(x.root_id)) || !Array.isArray(x.pt) || x.pt.length !== 3) continue;
    rows.push({ id: String(x.root_id), pt: x.pt.map(Number) as [number, number, number], um3: 0, flag: 'n' });
    stashBy[String(x.root_id)] = String(x.player_name || '');
  }
  STASHED.splice(0, STASHED.length, ...rows);
}
/** The server's answers for this player, and fragments others have done.
 *  Answers whose CAVE point did not go in are sent again here. */
async function loadAnswers() {
  try {
    const res = await secureWrite<{ mine: any[]; others: string[]; held?: string[]; myClaim?: string | null; stash?: any[] }>('fragments.list');
    loadStash(res.stash || []);
    setHeldFragments((res as any).myClaims || []);
    serverOn.value = true;
    {
      const a = active.value;
      if (a && !saves[a.id] && !draftWork(currentDraft())) applyDraft(a.id);
      if (a && heldOf(a.id)?.anchor && !anchors[a.id]) void followRoot(a);
    }
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
    setFragmentsDone((res.mine || []).length + (res.others || []).length);
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
onMounted(() => { listLoad = listLoad || loadAnswers(); });

/** A merge or cut while a fragment is open and not yet sent: it stays yours
 *  when Play hands you the next one (Ames 2026-11-21). */
function onEditLogged(e: Event) {
  const op = (e as CustomEvent).detail?.operation;
  const a = active.value;
  if (!a || saves[a.id] || (op !== 'merge' && op !== 'split')) return;
  // Its new ID, from the anchor, once the graph has the edit.
  setTimeout(async () => {
    if (active.value?.id !== a.id) return;
    const before = shownRoot.value;
    const root = await followRoot(a);
    // followRoot saved a changed ID; an edit that left the ID as it was still makes it started.
    if (!root || root === before) void sendProgress(a.id, { anchorSv: anchors[a.id], rootId: root || before || undefined });
  }, 1500);
}
onMounted(() => document.addEventListener('nge:edit-logged', onEditLogged));
onUnmounted(() => document.removeEventListener('nge:edit-logged', onEditLogged));
/** "Open" on a fragment in My Cells (util/my_fragments.ts). */
function openPending() {
  const id = pendingFragment.id;
  if (!id) return;
  const f = findRow(id);
  if (!f) return;   // the Stashed list may not be loaded yet; tried again after it is
  pendingFragment.id = null;
  group.value = f.g;
  void open(f.row);
  void claimHere(f.row);
}
watch(() => [pendingFragment.id, STASHED.length], () => openPending(), { immediate: true });
// The cell type CAVE already has, when the checklist is on screen for a fragment.
watch(() => [active.value?.id, shownRoot.value, finishing.value || !props.slim] as const, ([id, , shown]) => {
  if (id && shown) void prefillType();
}, { immediate: true });

const short = (id: string) => id.length > 8 ? '…' + id.slice(-6) : id;
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
</script>

<template>
  <div class="nge-orph" :class="{ 'nge-orph--slim': slim }">
    <QuestInstructions v-if="helpOpen" kicker="Lost Fragments" title="How to rescue a Lost Fragment"
      :lead="name.lead" lead-key="howto.lost_fragments.lead" :steps="HOWTO_LINES" steps-key="howto.lost_fragments"
      image-key="howto.lost_fragments.image" :image="bannerImg" image-alt="Blue cubes tumbling apart with gold neuron branches running through them"
      :legend="[]" banner circuit @close="closeHelp" />
    <div v-if="!slim" class="nge-orph-head">
      <!-- The banner (Ames 2026-11-19): her render of EyeWire cubes with
           gold branches running through them, the title over it. -->
      <div class="nge-orph-banner" :style="{ backgroundImage: `url(${bannerImg})` }" role="img" aria-label="Blue cubes tumbling apart with gold neuron branches running through them">
        <div class="nge-orph-title">{{ name.title }}</div>
      </div>
      <!-- How many are open, in the lead for everyone (Ames 2026-11-20: keep
           saying about 150 of 13,000, "add that to the text up at the top"). -->
      <div class="nge-orph-lead">{{ name.lead }} {{ fmt(GROUPS.reduce((a, g) => a + (g.key === 'stashed' ? 0 : g.rows.length), 0)) }} of the {{ fmt(poolTotal) }} the lab found are open to start, and each one counts as a completed cell.</div>
      <div v-if="fragmentsDone != null" class="nge-orph-countdown">Together we have completed <b>{{ fmt(fragmentsDone) }}</b>. <b class="nge-orph-countdown-num">{{ fmt(nextMilestone(fragmentsDone) - fragmentsDone) }}</b> to go until we celebrate {{ fmt(nextMilestone(fragmentsDone)) }}!</div>
      <div v-if="ON_TEST_SITE || !serverOn" class="nge-orph-mock">{{ !serverOn ? 'Pyr could not reach the server, so Complete will not save yet.' : 'Test site: Complete here is real. It goes to the lab and counts as a completed cell.' }}</div>
    </div>

    <div v-if="!slim" class="nge-orph-groups">
      <button v-for="g in shownGroups" :key="g.key" class="nge-orph-group" :class="{ 'nge-orph-group--on': group === g.key }"
              :style="{ '--g': g.color }" @click="pickGroup(g.key)" :title="g.about">
        <span class="nge-orph-group-name">{{ g.label }}</span>
        <span class="nge-orph-group-n">{{ doneIn(g.key) }} / {{ g.rows.length }}</span>
      </button>
    </div>
    <div v-if="!slim" class="nge-orph-about">{{ cur.about }}</div>
    <!-- Start playing, always here (Ames 2026-11-21: "we need the start
         playing button back in lost frags that will launch players back where
         they were"). -->
    <div v-if="!slim" class="nge-orph-playhere-row">
      <button class="nge-orph-playhere" @click="startPlay('fragments')"
              :title="resumeId ? 'Back to the fragment you were working on, with your progress' : 'Opens the next fragment you have not done. After Complete, the next one.'">
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>Start playing
      </button>
      <span class="nge-orph-playhere-hint">{{ resumeId ? `Takes you back to ${idNow(resumeId)}, where you left off.` : 'Opens the next fragment, then the next one after each Complete.' }}</span>
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
        <button v-if="playing" class="nge-orph-btn nge-orph-skip" @click="skip" title="Give this one back and go to the next fragment"><span class="nge-orph-label">Skip</span></button>
        <!-- One button (Ames 2026-11-20: "we have one complete and next
             button"): Complete opens the checklist, then sends it. -->
        <button v-if="!finishing" class="nge-orph-btn nge-orph-complete" @click="openFinish" title="Done with this fragment? Open the checklist."><span class="nge-orph-label">{{ form.saved ? 'Completed' : 'Complete' }}</span></button>
        <button v-else class="nge-orph-btn nge-orph-complete on" :disabled="!canSubmit || sending" :title="missing.length ? `Still to do: ${missing.join(', ')}.` : 'Send it to the lab'" @click="submit"><span class="nge-orph-label">{{ sending ? 'Sending…' : completeLabel }}</span></button>
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
              <option v-for="g in shownGroups" :key="g.key" :value="g.key">{{ g.label }}</option>
            </select>, {{ place + 1 }} of {{ cur.rows.length }},
            <template v-if="group === 'stashed'">stashed by {{ stashBy[active.id] || 'a player' }}</template>
            <template v-else>{{ fmt(active.um3) }} µm³, lab flag: {{ FLAG_WORDS[active.flag] }}</template>
          </div>
          <div v-if="shownRoot && shownRoot !== active.id" class="nge-orph-note">Merges and cuts gave it this new ID. Pyr follows it for you; it started as {{ active.id }}.</div>
        </div>
      </div>
      <div v-if="!slim" class="nge-orph-controls">
        <button class="nge-orph-btn" @click="step(-1)" title="Previous fragment">&lsaquo;<template v-if="!slim"> Previous</template></button>
        <button class="nge-orph-btn" @click="step(1)" title="Next fragment"><template v-if="!slim">Next </template>&rsaquo;</button>
        <button class="nge-orph-btn" @click="open(active)" title="Fly the view back to this fragment, if you moved away">Recenter</button>
        <button v-if="!saves[active.id]" class="nge-orph-btn nge-orph-claimbtn" :class="{ 'nge-orph-claimbtn--mine': myClaim === active.id }" :disabled="claiming"
                :title="myClaim === active.id ? 'You hold this fragment. Press to let it go.' : 'Hold this fragment for you, so Play does not give it to anyone else'"
                @click="myClaim === active.id ? releaseActive() : claimActive()">{{ claiming ? 'Claiming…' : myClaim === active.id ? 'Release' : 'Claim' }}</button>
        <button v-if="playing" class="nge-orph-btn" @click="skip" title="Give this one back and go to the next fragment">Skip</button>
        <button v-else class="nge-orph-btn nge-orph-playbtn" @click="startPlay('fragments')" title="Play: after Submit, the next fragment opens by itself">&#9654; Play</button>
        <button class="nge-orph-help-btn" :class="{ on: helpOpen }" :aria-expanded="helpOpen ? 'true' : 'false'" title="How to do a fragment" @click="helpOpen = !helpOpen">?</button>
        <button v-if="playing" class="nge-orph-link nge-orph-stop" @click="stopPlay" title="Stop playing: Submit stays on this fragment">Stop</button>
      </div>

      <div v-if="!slim && claimMsg" class="nge-orph-note">{{ claimMsg }}</div>
      <div v-if="progressNote && !form.saved && (!slim || finishing)" class="nge-orph-note nge-orph-progress">{{ progressNote }}</div>
      <div v-if="fullNote && playing" class="nge-orph-note">{{ fullNote }}</div>
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
        <li v-if="cellTypes.length" class="nge-orph-typeli nge-orph-nonum" :class="{ done: !!(form.cellType || form.cellTypeCustom.trim()) }">
          <div class="nge-orph-row" title="If you can tell what kind of cell this piece is from. Leave it empty if you are not sure.">
            <b>Cell type</b> <span class="nge-orph-sub">optional</span>
          </div>
          <div class="nge-orph-row nge-orph-typerow">
            <!-- A Pyr list, not the browser's grey one (Ames 2026-11-20: "Stylize this dropdown"). -->
            <div ref="typeBox" class="nge-orph-typepick" :class="{ open: typeOpen }">
              <button type="button" class="nge-orph-input nge-orph-type nge-orph-typebtn" aria-label="Cell type" aria-haspopup="listbox" :aria-expanded="typeOpen ? 'true' : 'false'"
                      @click="typeOpen = !typeOpen" @keydown.stop="onTypeKey" @keyup.stop @keypress.stop>
                <span :class="{ 'nge-orph-typeph': !form.cellType }">{{ form.cellType ? cellTypeLabel(form.cellType) : 'Not sure' }}</span>
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <Teleport to="body">
              <div v-if="typeOpen" ref="typeList" class="nge-orph-typelist" :style="typeListPos" role="listbox" aria-label="Cell type">
                <button v-for="t in ['', ...cellTypes]" :key="t || 'none'" type="button" role="option" class="nge-orph-typeopt"
                        :class="{ on: form.cellType === t, dim: !t }" :aria-selected="form.cellType === t ? 'true' : 'false'" :title="t ? typeTitle(t) : undefined"
                        @click="pickType(t)">
                  <span>{{ t ? cellTypeLabel(t) : 'Not sure' }}</span>
                  <svg v-if="form.cellType === t" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
              </Teleport>
            </div>
            <input v-model="form.cellTypeCustom" class="nge-orph-input nge-orph-type" placeholder="Or type your own" maxlength="120"
                   aria-label="Or type your own cell type" @input="form.cellTypeCustom.trim() && (form.cellType = '')"
                   @keydown.stop @keyup.stop @keypress.stop />
          </div>
          <div v-if="typeNote" class="nge-orph-row"><span class="nge-orph-note nge-orph-note--err">{{ typeNote }}</span></div>
        </li>
        <li class="nge-orph-nonum nge-orph-otherli">
          <button v-if="!other.open" class="nge-orph-link" @click="other.open = true">Part of it belongs to another cell?</button>
          <template v-else>
            <div class="nge-orph-row"><b>Another cell</b> <span class="nge-orph-sub">Cut that part off and merge it into its own cell. Then put the crosshairs in that cell.</span></div>
            <div class="nge-orph-row">
              <button class="nge-orph-btn" :disabled="other.checking" @click="checkOther">{{ other.checking ? 'Checking…' : 'Check that cell' }}</button>
              <span v-if="other.root" class="nge-orph-nucid" :title="other.root">{{ short(other.root) }}</span>
              <button class="nge-orph-link" @click="resetOther()">No other cell</button>
            </div>
            <div v-if="other.msg" class="nge-orph-row"><span class="nge-orph-note" :class="{ 'nge-orph-note--err': other.err, 'nge-orph-note--ok': other.done }">{{ other.msg }}</span></div>
            <div v-if="other.root && !other.done" class="nge-orph-row nge-orph-otherpick">
              <button class="nge-orph-btn" :class="{ on: other.choice === 'proofread' }" @click="other.choice = 'proofread'"
                      title="After you submit this fragment, that cell opens next. It counts as a completed cell of its own.">Proofread it too</button>
              <button class="nge-orph-btn" :class="{ on: other.choice === 'stashed' }" @click="other.choice = 'stashed'"
                      title="It goes into the Stashed group, for anyone to proofread later.">Stash it for later</button>
            </div>
          </template>
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
        <span class="nge-orph-item-flag">{{ group === 'stashed' ? 'stashed' : FLAG_WORDS[r.flag] }}</span>
        <span class="nge-orph-item-v">{{ group === 'stashed' ? (stashBy[r.id] || '') : fmt(r.um3) + ' µm³' }}</span>
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
.nge-orph-help :deep(.nge-orph-help-list) { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.nge-orph-help :deep(.nge-orph-help-list b) { color: #eef; }
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
.nge-orph-typerow { flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.nge-orph .nge-orph-type { flex: 1 1 150px; min-width: 0; width: auto; }
.nge-orph-typepick { position: relative; flex: 1 1 170px; min-width: 0; display: flex; }
.nge-orph .nge-orph-typebtn { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer;
  color: #e6f0ff; background: rgba(10, 22, 44, 0.85); border: 1px solid rgba(127, 190, 255, 0.35); }
.nge-orph-typebtn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nge-orph-typebtn svg { flex: none; color: #8fd6ff; transition: transform 0.15s; }
.nge-orph-typepick.open .nge-orph-typebtn { border-color: rgba(143, 214, 255, 0.8); box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.18); }
.nge-orph-typepick.open .nge-orph-typebtn svg { transform: rotate(180deg); }
.nge-orph-typeph { color: #8ea6c4; }
.nge-orph-typelist { position: fixed; z-index: 10050; box-sizing: border-box; overflow-y: auto; padding: 4px;
  background: linear-gradient(160deg, rgba(14, 30, 62, 0.98), rgba(7, 13, 30, 0.98)); border: 1px solid rgba(111, 196, 255, 0.5); border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 18px rgba(74, 158, 255, 0.18); scrollbar-width: thin; scrollbar-color: rgba(127, 190, 255, 0.4) transparent; }
.nge-orph-typeopt { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px; border: 0; border-radius: 5px;
  background: transparent; color: #d6e6fa; font: 500 13px/1.3 Inter, system-ui, sans-serif; text-align: left; cursor: pointer; }
.nge-orph-typeopt:hover { background: rgba(74, 158, 255, 0.18); color: #fff; }
.nge-orph-typeopt.on { background: rgba(74, 158, 255, 0.26); color: #fff; }
.nge-orph-typeopt.on svg { color: #8fd6ff; flex: none; }
.nge-orph-typeopt.dim { color: #8ea6c4; }
/* The nucleus (part of the soma point) and the optional type carry no
   number (Ames 2026-11-20: "we don't need (4) here"). */
.nge-orph-check li.nge-orph-nonum { list-style: none; }
.nge-orph-otherpick .nge-orph-btn.on { border-color: #ffd35a !important; color: #ffe9a6 !important; background: rgba(255, 211, 90, 0.12) !important; }
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
.nge-orph-countdown { margin: 4px 0 8px; font-size: 12.5px; color: #a9c3e0; }
.nge-orph-countdown b { color: #e6f0ff; }
.nge-orph-countdown .nge-orph-countdown-num { color: #ffd35a; }
.nge-orph-claimbtn { color: #9be8b4 !important; border-color: rgba(68, 170, 102, 0.55) !important; }
.nge-orph-claimbtn--mine { color: #a9c3e0 !important; border-color: rgba(127, 190, 255, 0.3) !important; }
/* Training Sim's look (Ames 2026-11-20). Quiet buttons: thin edge, soft words. */
.nge-orph--slim .nge-orph-task .nge-orph-btn { padding: 5px 9px; border: 1px solid rgba(127, 190, 255, 0.22); border-radius: 6px; background: transparent; color: #a9c3e0; font: 500 12px/1 Inter, system-ui, sans-serif; }
.nge-orph--slim .nge-orph-task .nge-orph-btn:hover:not(:disabled) { border-color: rgba(127, 216, 255, 0.55); background: rgba(74, 158, 255, 0.12); color: #e6f0ff; }
/* Action buttons in the checklist: filled blue, as Training Sim's. */
.nge-orph--slim .nge-orph-check .nge-orph-btn { border-color: #7fd8ff; background: rgba(74, 158, 255, 0.3); color: #fff; font-weight: 600; }
.nge-orph--slim .nge-orph-check .nge-orph-btn:hover:not(:disabled) { background: rgba(74, 158, 255, 0.45); border-color: #a8e4ff; color: #fff; }
.nge-orph-seg { border-color: rgba(127, 190, 255, 0.35); border-radius: 6px; }
.nge-orph-seg button { color: #a9c3e0; font: 600 12px/1.3 Inter, system-ui, sans-serif; padding: 4px 9px; }
.nge-orph-seg button.on { background: rgba(74, 158, 255, 0.3); color: #fff; box-shadow: inset 0 0 0 1px #7fd8ff; }
.nge-orph-finishhead b { font: 600 12px/1 Orbitron, Inter, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #d6e2f5; }
/* The selected layer tab's border (Ames 2026-11-20: "the top bar of the
   layers tab that's active has the line with the circle and then the gap and
   then another circle and then the line continues ... that's the border"):
   a solid edge all round, no fade, and on Skip and Complete the top edge
   breaks at two pads three quarters across. 3px of headroom above the edge
   holds the pads, which sit half above it. */
.nge-orph-slimbtns { gap: 10px !important; }
.nge-orph-slimrow { padding-right: 28px !important; }
.nge-orph-slimrow .nge-orph-btn { --edge: rgba(74, 158, 255, 0.6); --face: #0a1326; --pad: var(--edge);
  position: relative; isolation: isolate; height: 33px; box-sizing: border-box; display: inline-flex; align-items: center;
  padding: 1px 16px 0 13px !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
  background: linear-gradient(var(--edge), var(--edge)) left bottom / 100% calc(100% - 3px) no-repeat !important;
  clip-path: polygon(0 3px, calc(100% - 9px) 3px, 100% 12px, 100% 100%, 7px 100%, 0 calc(100% - 7px));
  color: #cfe2f7 !important; font: 600 13px/1 Inter, system-ui, sans-serif !important; }
.nge-orph-slimrow .nge-orph-btn::before { content: ''; position: absolute; inset: 4px 1px 1px 1px; z-index: -1; pointer-events: none; background: var(--face);
  clip-path: polygon(0 0, calc(100% - 8.6px) 0, 100% 8.6px, 100% 100%, 6.6px 100%, 0 calc(100% - 6.6px)); }
.nge-orph-slimrow .nge-orph-btn:hover:not(:disabled) { --edge: #8fd6ff; --face: #0f1d3a; color: #fff !important; }
.nge-orph-slimrow .nge-orph-btn:focus-visible { outline: none; --edge: #ffffff; }
/* Skip and Complete: the two pads and the gap in the top edge, three quarters
   across, or clear of the cut corner on a narrow button. */
.nge-orph-slimrow .nge-orph-skip, .nge-orph-slimrow .nge-orph-complete { --px: min(75%, calc(100% - 26px));
  clip-path: polygon(0 3px, calc(var(--px) - 8px) 3px, calc(var(--px) - 8px) 0, calc(var(--px) + 8px) 0, calc(var(--px) + 8px) 3px,
    calc(100% - 9px) 3px, 100% 12px, 100% 100%, 7px 100%, 0 calc(100% - 7px)); }
.nge-orph-slimrow .nge-orph-skip::after, .nge-orph-slimrow .nge-orph-complete::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 8px; z-index: 1; pointer-events: none;
  background:
    radial-gradient(circle at calc(var(--px) - 4.5px) 3.5px, var(--face) 0 0.9px, var(--pad) 1.3px 2.1px, transparent 2.5px),
    radial-gradient(circle at calc(var(--px) + 4.5px) 3.5px, var(--face) 0 0.9px, var(--pad) 1.3px 2.1px, transparent 2.5px),
    linear-gradient(90deg, transparent calc(var(--px) - 2.6px), var(--face) calc(var(--px) - 2.6px), var(--face) calc(var(--px) + 2.6px), transparent calc(var(--px) + 2.6px)) left 0 top 3px / 100% 1px no-repeat; }
.nge-orph-slimrow .nge-orph-skip { --edge: #6fc4ff; --pad: #c9f3ff; padding: 1px 16px 0 13px !important; }
.nge-orph-slimrow .nge-orph-complete { --edge: #3eecbe; --face: #0c3a30; --pad: #b9ffe6; color: #eafff7 !important; padding: 1px 18px 0 14px !important; }
.nge-orph-slimrow .nge-orph-complete:hover:not(:disabled), .nge-orph-slimrow .nge-orph-complete.on:not(:disabled) { --edge: #8ff7d6; --face: #11503f; }
.nge-orph-slimrow .nge-orph-btn:disabled { opacity: 0.55; }
.nge-orph-slimrow .nge-orph-hl { width: 34px; justify-content: center; padding: 3px 3px 0 0 !important; }
.nge-orph-slimrow .nge-orph-hl :deep(svg) { width: 18px !important; height: 18px !important; }
/* Highlight: the icon alone, no outline (Ames 2026-11-20). */
.nge-orph-slimrow .nge-orph-hl { background: none !important; clip-path: none; border-radius: 6px !important; padding: 0 !important; height: 30px; }
.nge-orph-slimrow .nge-orph-hl::before { display: none; }
.nge-orph-slimrow .nge-orph-hl:hover:not(:disabled) { background: rgba(74, 158, 255, 0.14) !important; }
.nge-orph-slimrow .nge-orph-hl:focus-visible { outline: 2px solid #7fd8ff; outline-offset: 1px; }
.nge-orph-nucid { font: 600 12px 'JetBrains Mono', ui-monospace, monospace; color: #cfe6ff; }
.nge-orph-item--on { background: rgba(74, 158, 255, 0.14); border-color: rgba(126, 202, 255, 0.35); }
.nge-orph-item-i { color: #6c7a90; font-variant-numeric: tabular-nums; text-align: right; }
.nge-orph-item-id { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: #eef; overflow: hidden; text-overflow: ellipsis; }
.nge-orph-item-flag { font-size: 11.5px; color: #93a0b6; }
.nge-orph-item-v { font-size: 12px; color: #a9b8cc; font-variant-numeric: tabular-nums; }
.nge-orph-item-s { color: #6fe0d0; font-weight: 700; }
.nge-orph-item--done .nge-orph-item-id { color: #a6ffd6; }
</style>
