/**
 * The Hunt in the game (Ames 2026-10-20): a timed event. Players search a
 * cell, or several, for mergers, drop a gold gem on each one they find, and
 * submit. The server (functions/hunts.js, ewHunt) holds the answer key and
 * says how many gems found a merger, never which. Gold, silver and bronze
 * special Achievements go to the best hunters when the time is up.
 *
 * This file is the game side: the list of hunts a player can see (with a
 * clock for the countdowns), the hunt's own gem layer, the player's gems kept
 * in this browser between visits, the answer, and the readers the Admin Hub
 * uses to take an answer key, the cells and the view from what is on screen.
 * The panel is components/HuntPanel.vue; the Admin Hub tab HuntsAdminTab.vue.
 */
import { reactive } from 'vue';
import { makeLayer } from 'neuroglancer/layer';
import { Uint64 } from 'neuroglancer/util/uint64';
import { setNgeMeshEdge, getNgeMeshEdge } from 'neuroglancer/mesh/nge_edge';
import { getBaseObjectColor } from 'neuroglancer/segmentation_display_state/frontend';
import { setStatedColor } from './widgets/widget_utils';
import { secureWrite } from './secure_write';
import { canonicalDataset, currentDatasetTag, findDatasetByCanonical, switchToDataset } from './datasets';
import { snapshotDisplay, restoreDisplayAfterLoad, keepDisplayEnabled } from './util/keep_display';

export type HuntPhase = 'announced' | 'live' | 'ended';
export type HuntTier = 'gold' | 'silver' | 'bronze';

export interface HuntInfo {
  id: number; title: string; description: string; dataset: string;
  /** Empty until the hunt starts (nobody hunts early); cell_count says how many. soma: where a cell starts, in the view's voxels. */
  cells: { root: string; label: string; soma?: number[] }[]; cell_count: number;
  announce_at: string | null; start_at: string; end_at: string; phase: HuntPhase;
  target_count: number; tolerance_um: number; max_points: number; max_submissions: number;
  tiers: { gold: number; silver: number; bronze: number }; awarded: boolean;
  /** Gems each player has, and the most gems each medal allows (0: no limit). */
  budget: number; gem_limits: { gold: number; silver: number; bronze: number };
  /** Hours "Hunt results" stays in the top bar after the end (24 unless the Hunt says). */
  results_hours?: number;
  /** The edge spots the key marks, in nanometres: shown to players once the Hunt is open. */
  edges_nm?: number[][];
  /** The answers can be shown (the Hunt is over and does not keep them). */
  answers?: boolean;
  /** The segmentation volume's bounds in nanometres: where the data ends. The cells glow teal within edge_nm of them. */
  bounds_nm?: number[][] | null;
  /** This close to the bounds is the edge of the dataset, nm (the server's judging rule, EDGE_NM). */
  edge_nm?: number;
  view: any | null;
  you: HuntRun & { best: number; submissions: number; rank: number };
  /** An admin's test run (hunt.test): open as if running, for that admin only; answers are never kept. */
  test?: boolean;
  /** How many places of each kind are hidden: mergers to cut, places to merge. */
  spots?: { cut: number; merge: number };
  /** A test hunt only admins see (its notes go to the admin who made it). */
  admins_only?: boolean;
  /** What each medal gives: the Achievement's name and picture. */
  prizes?: Partial<Record<HuntTier, { name: string; image: string }>>;
  board: { rank: number; name: string; found: number; gems: number; at: string; tier: HuntTier | null; you: boolean; fastest?: boolean }[];
  /** At the ceremony: who won the speed award, and for what. */
  fastest?: { name: string; reason: string; you: boolean } | null;
  players: number;
  winners: { gold: number; silver: number; bronze: number };
}

/** One gem the server judged: where it is (as the layer holds it), and whether it found a problem. */
export interface HuntDrop { id: string; at: number[] | null; hit: boolean; kind: 'cut' | 'merge' | null; k?: 'cut' | 'merge' | null }
/** A player's run: their gems so far, what they found, what is left. */
export interface HuntRun {
  budget: number; found: number; of: number; gems_used: number; gems_left: number; done: boolean;
  found_by?: { cut: number; merge: number }; of_by?: { cut: number; merge: number };
  /** When the run's clock started (the first open), and the time to the last find so far (ms). */
  started_at?: string | null; time_ms?: number | null;
  tier: HuntTier | null; drops: HuntDrop[];
}

/** What the server last said, plus a clock for the countdowns (server time). */
export const huntState = reactive({
  hunts: [] as HuntInfo[],
  /** The hunt an admin is trying (Admin Hub > Hunts > Try it yourself), or null. */
  test: null as HuntInfo | null,
  /** What the last gem dropped did (right, wrong, found already, refused). */
  news: null as null | DropNews,
  /** The last few answers, newest first (Ames 2026-10-21: a quick second gem hid the first one's answer). */
  log: [] as DropNews[],
  /** The gem being judged now, for its spinning gem on the spot. */
  pending: null as null | { id: string; gem: GemKind; x?: number; y?: number; at: number },
  /** Which layer Ctrl + Click drops into: cut gems or extend gems. */
  kind: 'cut' as GemKind,
  /** Gems this player told the admins about ("It's real"): sent, or checked and not one the key missed. */
  reported: {} as Record<string, 'sent' | 'no'>,
  /** The number key that picks each gem layer (its place in the layer tabs), for the buttons' tooltips. */
  keys: {} as Partial<Record<GemKind, number>>,
  /** Gems dropped and waiting for Submit (when each gem is not checked as it lands). */
  waiting: 0,
  loaded: false,
  loading: false,
  error: '',
  /** Server time minus this browser's, so a wrong clock never opens a hunt early. */
  offset: 0,
  now: Date.now(),
  /** The Hunt opening now, and the step it is on, for the Entering the Hunt animation (HuntOpening.vue). */
  opening: null as null | { title: string; step: string; token: number },
});
/** The step the opening Hunt is on (shown under Entering the Hunt). */
function openingStep(step: string) { if (huntState.opening) huntState.opening = { ...huntState.opening, step }; }

/**
 * A branch test site or a local build (not the live game or the Princeton site). The server
 * makes every Hunt saved from one admins only (Ames 2026-10-21: "we want to be testing on the
 * test site"), and the Admin Hub says so.
 */
export const ON_TEST_SITE = (() => {
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return true;
    if (!h.endsWith('-dot-brain-wire-dot-seung-lab.ue.r.appspot.com')) return false;
    return !h.startsWith('eyewire-ii-community-dot-') && !h.startsWith('princeton-tracers-dot-');
  } catch { return false; }
})();

/** The view's crosshair as x, y, z (voxels), for filling in a soma. */
export function crosshairXyz(): number[] | null {
  try {
    const p = Array.from<number>(viewer().navigationState.position.value);
    return p.length >= 3 ? p.slice(0, 3).map(v => Math.round(v)) : null;
  } catch { return null; }
}

/** Move to a hunt cell's soma (a hunt with several cells has a button for each). */
export function goToSoma(soma: number[]) {
  try { viewer().navigationState.position.value = Float32Array.from(soma.slice(0, 3)); } catch { /* no viewer */ }
}

export const GEM_COLOR = '#f5d142';   // the color key's gold

/** Hunt actions go to their own function (secure_write routes hunt.*). */
export function huntCall<T = any>(action: string, args: Record<string, any> = {}): Promise<T> {
  return secureWrite<T>(action as any, args);
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Never on the Princeton Tracers' address (Ames 2026-10-19: "we don't mix paid and volunteers"): paid
 * tracers must not hunt beside the volunteers or on their board. Their build comes from its own branch;
 * this keeps the Hunt away when live is merged into it (the same test as its src/edition.ts).
 */
const TRACERS_HERE = (() => {
  try { return location.hostname.startsWith('princeton-tracers-dot-') || new URLSearchParams(location.search).has('tracers'); }
  catch { return false; }
})();

/** The hunts this player can see. One small call; again at each announcement, start and end. */
export function loadHunts(): Promise<void> {
  if (TRACERS_HERE) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    huntState.loading = true;
    try {
      const r = await huntCall<{ now: string; hunts: HuntInfo[] }>('hunt.current');
      huntState.offset = Date.parse(r.now) - Date.now();
      huntState.hunts = Array.isArray(r.hunts) ? r.hunts : [];
      huntState.error = '';
      huntState.loaded = true;
      installEditGuard();
      resumeOnScreen();
      scheduleRefresh();
      startTicker();
    } catch (e: any) {
      huntState.error = e?.message || String(e);
    } finally {
      huntState.loading = false;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function serverNow(): number { return Date.now() + huntState.offset; }

/** Ask again a moment after the next start or end, so the panel turns over on time. */
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const t = serverNow();
  const next = huntState.hunts.flatMap(h => [h.start_at, h.end_at].map(s => Date.parse(s)))
    .filter(x => Number.isFinite(x) && x > t).sort((a, b) => a - b)[0];
  // At least every two hours, so a hunt announced after the page opened shows too; every few
  // seconds while a hunt is over and its awards are still being given (Ames 2026-10-21: the
  // ceremony said "The awards are being given…" and stayed that way).
  const awaiting = huntState.hunts.some(h => (h.phase === 'ended' && !h.awarded) || (h.phase === 'live' && Date.parse(h.end_at) <= t))
    && huntState.hunts.some(h => t - Date.parse(h.end_at) < 10 * 60_000);   // at most ten minutes after an end
  const wait = awaiting ? 5000 + Math.random() * 2000 : next ? Math.min(next - t + 500 + Math.random() * 1500, 2 * 3600_000) : 2 * 3600_000;
  refreshTimer = setTimeout(() => { void loadHunts(); }, wait);
}

/**
 * The board again every half minute while a Hunt runs and this tab is in view (Ames 2026-10-26: every
 * player saw their own row move and everyone else's stand still until the end). hunt.board reads the
 * board alone, not every Hunt.
 */
let boardAt = 0, boardBusy = false;
async function refreshBoard() {
  const t = serverNow();
  const h = huntState.hunts.find(x => !x.test && Date.parse(x.start_at) <= t && t < Date.parse(x.end_at));
  if (!h || boardBusy || Date.now() - boardAt < 28_000 || (typeof document !== 'undefined' && document.hidden)) return;
  boardBusy = true; boardAt = Date.now();
  try {
    const r = await huntCall<{ id: number; rank: number; board: HuntInfo['board'] }>('hunt.board', { id: h.id });
    const copy = huntState.hunts.find(x => x.id === h.id);
    if (copy && Array.isArray(r?.board)) { copy.board = r.board; if (copy.you) copy.you = { ...copy.you, rank: r.rank }; }
  } catch { /* the next turn asks again */ }
  finally { boardBusy = false; }
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => { huntState.now = serverNow(); void refreshBoard(); }, 1000);
  try { document.addEventListener('visibilitychange', () => { if (!document.hidden) { boardAt = 0; void refreshBoard(); } }); } catch { /* no document */ }
}

/** The hunt the top bar shows: a running one first, then the next to start, then the latest to end. */
export function featuredHunt(): HuntInfo | null {
  const list = huntState.hunts;
  // Several at once (Ames 2026-10-21): the one open on screen, else the one that ends first.
  const live = list.filter(h => h.phase === 'live').sort((a, b) => Date.parse(a.end_at) - Date.parse(b.end_at));
  const onScreen = active && !active.test ? live.find(h => h.id === active!.id) : undefined;
  return onScreen ?? live[0]
    ?? [...list].filter(h => h.phase === 'announced').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0]
    ?? [...list].filter(h => h.phase === 'ended' && Date.parse(h.end_at) + (h.results_hours || 24) * 3600_000 > huntState.now)
      .sort((a, b) => Date.parse(b.end_at) - Date.parse(a.end_at))[0]
    ?? null;
}

/** The phase by this page's clock (the server's answer can be a few minutes old). */
export function phaseNow(h: HuntInfo): HuntPhase {
  if (h.test) return 'live';   // a test run is always open
  const t = huntState.now;
  if (t >= Date.parse(h.end_at)) return 'ended';
  if (t >= Date.parse(h.start_at)) return 'live';
  return 'announced';
}

/**
 * While a hunt runs its cells are frozen: a merge or cut that touches one is
 * refused before it is sent (third_party graphene frontend asks this guard).
 * Everyone, admins too: one stray edit would move the mergers out from under
 * the answer key. Cancel the hunt to edit its cell.
 */
function huntEditGuard(kind: 'merge' | 'split', roots: string[]): string | null {
  for (const h of huntState.hunts) {
    if (phaseNow(h) !== 'live' || !h.cells.length) continue;
    if (canonicalDataset(currentDatasetTag()) !== canonicalDataset(h.dataset)) continue;
    const frozen = new Set(h.cells.map(c => c.root));
    if (roots.some(r => frozen.has(r))) {
      return `This cell is in The Hunt, so it stays as it is until the Hunt ends. Nothing was ${kind === 'merge' ? 'merged' : 'cut'}.`;
    }
  }
  return null;
}

/**
 * A cell of a Hunt running now (or an admin's try of one). A Hunt made from a proofread cell's edits starts
 * from an old ID, and the segment list's "update to the current ID" would show the finished cell: the answers.
 */
export function isLiveHuntCell(root: string): boolean {
  const tried = huntState.test;
  for (const h of [...huntState.hunts, ...(tried ? [tried] : [])]) {
    if (!h?.cells?.length || !(h.test || phaseNow(h) === 'live')) continue;
    if (h.cells.some(c => c.root === root)) return true;
  }
  return false;
}

function installEditGuard() {
  try { (window as any).__ngeEditGuard = huntEditGuard; } catch { /* */ }
}

/** "2d 4h", "3h 12m", "4m 05s": time left until a moment. */
export function countdown(iso: string | null | undefined): string {
  const ms = Math.max(0, Date.parse(iso || '') - huntState.now);
  if (!Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  // To the second, so it is seen to run (Ames 2026-10-26: "hunt needs a countdown to the second").
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${mm}m ${ss}s`;
  if (h > 0) return `${h}h ${mm}m ${ss}s`;
  return `${m}m ${ss}s`;
}

/** A moment in the player's own time zone. */
export function localTime(iso: string | null | undefined): string {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  // With the player's own zone named (Ames 2026-10-21), e.g. "Thu, Oct 22, 12:00 PM PDT".
  return new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

// ── The gem layers, and each gem judged as it lands ──────────────────────
// Ames 2026-10-21: "Ctrl + Click to drop a gem on a merger or missing extension.
// The Hunt will let you know if you got it right or wrong, and how many Hunt
// problems and gems remain. The Hunt finishes when you find all the problems or
// run out of gems." And: "we could give players 2 layers: cut, extend". So a hunt
// opens with a Cut layer (red gems, for mergers) and an Extend layer (blue gems,
// for missing extensions), one of them picked for Ctrl + Click. The server keeps
// each player's run (its gems in order, each right or wrong); the layers are
// drawn from it, so leaving and coming back, or another computer, shows the same
// gems. Right gems turn gold in a "Found" folder, wrong ones gray in "Missed".

const viewer = (): any => (window as any)['viewer'];
export type GemKind = 'cut' | 'merge';
const KIND_WORD: Record<GemKind, string> = { cut: 'cut', merge: 'extend' };
const KIND_COLOR: Record<GemKind, string> = { cut: '#e06060', merge: '#5aaaff' };   // the color key's red; a blue
const FOUND = { id: 'hunt-found', name: 'Found', color: '#f5d142' };    // a found gem shines: gold for a merger,
const FOUND_COLOR: Record<GemKind, string> = { cut: '#f5d142', merge: '#9b5cff' };   // purple for a missing extension
const MISSED = { id: 'hunt-missed', name: 'Missed', color: '#7d8799' }; // a missed one goes gray
const EDGE = { id: 'hunt-edge', name: 'Edge of the dataset', color: '#42d5ec' };   // teal: no gem used, neither found nor missed
/** What the gem colors mean, for the key in the Hunt box (Ames 2026-10-26: "add a key for what the colors of gems mean"). */
export const GEM_KEY: { colors: string[]; words: string }[] = [
  { colors: [KIND_COLOR.cut, KIND_COLOR.merge], words: 'Not checked yet' },
  { colors: [FOUND_COLOR.cut], words: 'Merger found' },
  { colors: [FOUND_COLOR.merge], words: 'Extension found' },
  { colors: [MISSED.color], words: 'Missed' },
  { colors: [EDGE.color], words: 'Edge of the dataset' },
];
export const EDGE_COLOR = EDGE.color;
const edgeIds = new Set<string>();

/** The layer for one kind of gem; a test run has layers of its own, so trying a hunt never mixes with playing it. */
export function huntLayerName(h: Pick<HuntInfo, 'title' | 'test'>, kind: GemKind = 'cut'): string {
  return `${h.test ? 'Hunt test' : 'Hunt'} ${KIND_WORD[kind]}: ${h.title}`.slice(0, 60);
}
/** The kinds of gem a hunt needs: cut when it hides mergers, extend when it hides missing extensions. */
export function gemKinds(h: Pick<HuntInfo, 'spots'>): GemKind[] {
  const s = h.spots;
  if (!s) return ['cut'];
  const out: GemKind[] = [];
  if (s.cut > 0) out.push('cut');
  if (s.merge > 0) out.push('merge');
  return out.length ? out : ['cut'];
}

function managed(name: string): any {
  return (viewer()?.layerManager?.managedLayers ?? []).find((ml: any) => ml.name === name && !ml.archived) ?? null;
}

/** A hunt layer as the view would save it, or null when it is not on screen. */
function layerJson(name: string): any | null {
  try { return (viewer()?.state?.toJSON?.()?.layers ?? []).find((l: any) => l && l.name === name && l.type === 'annotation') ?? null; }
  catch { return null; }
}

/** The gems in a hunt's layers right now (-1 when none of them is on screen). */
export function gemsOnScreen(h: Pick<HuntInfo, 'title' | 'test' | 'spots'>): number {
  let n = -1;
  for (const k of gemKinds(h)) {
    const src = managed(huntLayerName(h, k))?.layer?.localAnnotations;
    if (!src) continue;
    if (n < 0) n = 0;
    for (const a of src) if (a && a.type === 0 /* point */) n++;
  }
  return n;
}

function foldersFor(drops: HuntDrop[], kind: GemKind) {
  return [
    { id: FOUND.id, name: FOUND.name, ids: drops.filter(d => d.hit).map(d => d.id), color: FOUND_COLOR[kind], paint: true },
    { id: MISSED.id, name: MISSED.name, ids: drops.filter(d => !d.hit).map(d => d.id), color: MISSED.color, paint: true },
  ];
}

/** The kind of a gem already judged: the layer it was dropped from (older gems: what it found, else cut). */
const dropKind = (d: HuntDrop): GemKind => (d.k === 'merge' || d.k === 'cut' ? d.k : d.kind === 'merge' ? 'merge' : 'cut');

/** A gem on screen the server does not keep (a second gem on a place found already): it stays through a redraw. */
interface KeptGem { kind: GemKind; id: string; point: number[]; judged: boolean; edge: boolean }
function keptOnScreen(h: HuntInfo): KeptGem[] {
  const known = new Set((h.you?.drops ?? []).map(d => d.id));
  const out: KeptGem[] = [];
  for (const k of gemKinds(h)) {
    const src = managed(huntLayerName(h, k))?.layer?.localAnnotations;
    if (!src) continue;
    // Every gem the server does not keep: a judged one stays gold; one not judged yet is judged after the redraw.
    for (const a of src) if (a && a.type === 0 && a.point && !known.has(a.id)) out.push({ kind: k, id: a.id, point: Array.from(a.point as Float32Array), judged: judged.has(a.id), edge: edgeIds.has(a.id) });
  }
  return out;
}

/** The hunt's gem layers, the player's judged gems back in their folders, one layer picked for Ctrl + Click. */
function ensureGemLayers(h: HuntInfo, extra: KeptGem[] = []) {
  const v = viewer();
  if (!v?.layerSpecification) return;
  for (const k of gemKinds(h)) {
    const name = huntLayerName(h, k);
    if (managed(name)) continue;
    const drops = (h.you?.drops ?? []).filter(d => dropKind(d) === k && Array.isArray(d.at) && d.at.length >= 3);
    const more = extra.filter(g => g.kind === k);
    const folders = foldersFor(drops, k);
    folders[0].ids.push(...more.filter(g => g.judged && !g.edge).map(g => g.id));
    const edges = more.filter(g => g.judged && g.edge).map(g => g.id);
    if (edges.length) folders.push({ id: EDGE.id, name: EDGE.name, ids: edges, color: EDGE.color, paint: true });
    const ml = makeLayer(v.layerSpecification, name, {
      type: 'annotation', source: { url: 'local://annotations' },
      annotations: [...drops.map(d => ({ type: 'point', id: d.id, point: d.at })), ...more.map(g => ({ type: 'point', id: g.id, point: g.point }))],
      // Behind the cells in 3D, as real marks sit (Ames 2026-10-23: "can we make the gems not show
      // through the neuron?"); her marks stay on screen by the judging that never removes them.
      annotationColor: KIND_COLOR[k], pointMarker: 'pyr', pointSize: 2, tool: 'annotatePoint', onTop: false,
      ngeAnnFolders: folders,
    });
    v.layerSpecification.add(ml);
  }
  ensureEdgeLayer(h);
  pickKind(h, gemKinds(h).includes(huntState.kind) ? huntState.kind : gemKinds(h)[0]);
}

/** Where the edges of the dataset are, shown to players: teal rings, read only, so nobody spends a
 *  gem finding them (Ames 2026-10-23: "we should just highlight/show where the edges [are]"). */
/**
 * A Hunt's note in chat as the Hunt stands now (Ames 2026-10-26: "can we update this message when a hunt is
 * active? bc it's not 'coming' anymore"). "🔎 The Hunt is coming: X" reads "is on" while X runs and "is over"
 * after. stage: 0 coming, 1 on, 2 over, so chat can keep only the newest card per Hunt. From the Hunt's
 * phase as the server last gave it (the list is asked again at each start and end), not a ticking clock.
 */
const HUNT_NOTE = /^(\s*🔎\s*The Hunt) (is coming|is on|is over): (.+?)\s*$/u;
export function huntNoteNow(text: string): { text: string; title: string; stage: number } | null {
  const m = HUNT_NOTE.exec(text);
  if (!m) return null;
  const title = m[3];
  const stage = m[2] === 'is coming' ? 0 : m[2] === 'is on' ? 1 : 2;
  const h = huntState.hunts.find(x => x.title === title);
  const now = !h ? stage : h.phase === 'live' ? 1 : h.phase === 'ended' ? 2 : 0;
  return { text: now > stage ? `${m[1]} ${now === 1 ? 'is on' : 'is over'}: ${title}` : text, title, stage };
}

/**
 * A missed gem is a real problem the key missed, says the player (Ames 2026-10-26: "a 'found an unlabeled
 * cut/merge' type button"): the admins hear, and Count it in the editor makes it count, with Laser Eyes.
 */
export async function reportGem(h: HuntInfo, dropId: string) {
  await huntCall('hunt.report', { id: h.id, drop_id: dropId });
  huntState.reported = { ...huntState.reported, [dropId]: 'sent' };
}
/** What the server says of this player's reports (after a reload, or an admin's check). */
export function reportedOf(h: HuntInfo | null, id: string): 'sent' | 'no' | null {
  const d = (h?.you as any)?.drops?.find((x: any) => x.id === id);
  if (d?.rep_no) return 'no';
  if (d?.rep) return 'sent';
  return huntState.reported[id] ?? null;
}

export const huntAnswersLayerName = (h: HuntInfo) => `Hunt answers: ${h.title}`;
/** Nanometres to the viewer's global coordinates, at the current position for any other axes. */
function nmToGlobal(): ((nm: number[]) => number[]) | null {
  const v = viewer();
  const cs = v?.coordinateSpace?.value;
  const names: string[] = cs?.names ?? [], scales = cs?.scales;
  const ix = ['x', 'y', 'z'].map(n => names.indexOf(n));
  if (!scales || ix.some(i => i < 0)) return null;
  const here = Array.from<number>(v.navigationState?.position?.value ?? new Float32Array(names.length));
  return (e: number[]) => { const p = here.slice(); ix.forEach((i, k) => { p[i] = e[k] / (Number(scales[i]) * 1e9); }); return p; };
}
/**
 * The answers on the cells once the Hunt is over (Ames 2026-10-26: "should we show players the answer to the hunt
 * at the end", yes): a ring on every merger (gold) and extension (purple). The player's own gems sit on the ones
 * they found, so the rings alone are the ones they missed. Shown through the cells, so none hides.
 */
export async function showAnswers(h: HuntInfo): Promise<{ total: number; found: number; tookPart: boolean } | null> {
  const r = await huntCall<{ took_part: boolean; places: { at: number[]; kind: GemKind; found: boolean }[] }>('hunt.answers', { id: h.id });
  if (!gemKinds(h).some(k => managed(huntLayerName(h, k)))) { if (await goToHunt(h) === 'switching') return null; }
  const v = viewer();
  const toGlobal = nmToGlobal();
  if (!v?.layerSpecification || !toGlobal) throw new Error('The viewer is not ready yet. Try again in a moment.');
  const old = managed(huntAnswersLayerName(h));
  if (old) { try { v.layerManager.removeManagedLayer(old); } catch { /* already gone */ } }
  const places = r.places.map((p, i) => ({ ...p, id: `answer-${i + 1}` }));
  const folders = (['cut', 'merge'] as GemKind[]).map(k => ({ id: `answers-${k}`, name: k === 'cut' ? 'Mergers' : 'Extensions',
    ids: places.filter(p => p.kind === k).map(p => p.id), color: FOUND_COLOR[k], paint: true })).filter(f => f.ids.length);
  const ml = makeLayer(v.layerSpecification, huntAnswersLayerName(h), {
    type: 'annotation', source: { url: 'local://annotations' },
    annotations: places.map(p => ({ type: 'point', id: p.id, point: toGlobal(p.at) })),
    annotationColor: FOUND_COLOR.cut, pointSize: 6, onTop: true, ngeAnnFolders: folders,
  });
  v.layerSpecification.add(ml);
  setTimeout(() => {
    const ds = managed(huntAnswersLayerName(h))?.layer?.annotationDisplayState;
    const ref = Number((h.view as any)?.projectionScale) || 0;
    try { if (ds?.ngeShrinkRef && ref > 0) ds.ngeShrinkRef.value = ref; } catch { /* optional */ }
  }, 300);
  return { total: places.length, found: places.filter(p => p.found).length, tookPart: r.took_part };
}
export function hideAnswers(h: HuntInfo) {
  const ml = managed(huntAnswersLayerName(h));
  if (ml) { try { viewer()?.layerManager?.removeManagedLayer(ml); } catch { /* already gone */ } }
}
export const answersOnScreen = (h: HuntInfo) => !!managed(huntAnswersLayerName(h));

export const huntEdgeLayerName = (h: HuntInfo) => `${h.test ? 'Hunt test edges' : 'Hunt edges'}: ${h.title}`;
function ensureEdgeLayer(h: HuntInfo) {
  const v = viewer();
  // The marked spots only: the volume drawn as a box was not it (Ames 2026-10-23: "I think we wanted to
  // try highlighting the actual neurons"). Where the cells meet the volume's sides they glow (edgeGlow),
  // so a ring is only for a spot marked away from the sides.
  const edges = ringEdges(h);
  const old = managed(huntEdgeLayerName(h));
  if (old && v?.layerManager) {
    // A layer from before the glow (it kept every spot) is drawn again with the rings that are left.
    const had = layerJson(huntEdgeLayerName(h))?.annotations?.length ?? 0;
    if (had === edges.length) { setRingsVisible(h); return; }
    try { v.layerManager.removeManagedLayer(old); } catch { /* already gone */ }
  }
  if (!v?.layerSpecification || !edges.length) return;
  const cs = v.coordinateSpace?.value;
  const names: string[] = cs?.names ?? [], scales = cs?.scales;
  const ix = ['x', 'y', 'z'].map(n => names.indexOf(n));
  if (!scales || ix.some(i => i < 0)) return;
  const here = Array.from<number>(v.navigationState?.position?.value ?? new Float32Array(names.length));
  const toVox = (e: number[]) => { const p = here.slice(); ix.forEach((i, k) => { p[i] = e[k] / (Number(scales[i]) * 1e9); }); return p; };
  const ml = makeLayer(v.layerSpecification, huntEdgeLayerName(h), {
    type: 'annotation', source: { url: 'local://annotations' },
    annotations: [
      ...edges.map((e, i) => ({ type: 'point', id: `edge-${i}`, point: toVox(e) })),
    ],
    annotationColor: EDGE.color, pointSize: 5, onTop: false,
  });
  v.layerSpecification.add(ml);
  setRingsVisible(h);
}
/** The spots the glow does not show: marked away from the volume's sides. */
function ringEdges(h: HuntInfo): number[][] {
  const b = h.bounds_nm, m = edgeMarginNm(h) * 1.2;
  return (h.edges_nm ?? []).filter(e => !b || ![0, 1, 2].some(i => e[i] - b[0][i] <= m || b[1][i] - e[i] <= m));
}
const edgeMarginNm = (h: HuntInfo) => Number(h.edge_nm) > 0 ? Number(h.edge_nm) : 5000;
function setRingsVisible(h: HuntInfo) {
  const ml = managed(huntEdgeLayerName(h));
  try { if (ml && ml.visible !== huntPrefs.edges) ml.setVisible(huntPrefs.edges); } catch { /* optional */ }
}

/**
 * The cells glow teal where they run out of the data (Ames 2026-10-23: "Can you actually highlight the 3D
 * mesh tho?"): within the Hunt's edge margin of the segmentation volume's sides, the same rule that judges
 * an Extend gem there as the edge of the dataset. While a Hunt with bounds is open on its dataset, and the
 * player has not switched it off ("it might be distracting in a hunt").
 */
let glowKey = '';
const EDGE_RGB = [1, 3, 5].map(i => parseInt(EDGE.color.slice(i, i + 2), 16) / 255) as [number, number, number];   // the edge gems' teal

/**
 * Hunt cells drawn close to that teal get another color when the Hunt opens (Ames 2026-10-26: "how do we
 * handle marking edge of dataset if the cell loads blue?"), so teal on a cell only ever means the data ends.
 */
const OFF_TEAL = [0xff5fa8, 0x58e07c, 0xff7a6b, 0xc76bff];   // pink, green, coral, violet (0xRRGGBB)
function nearTeal(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 0.3 || max - min < 0.2 * max) return false;   // dark or gray: no hue to mix up
  const d = max - min;
  const hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  const deg = (hue + 360) % 360;
  return deg >= 160 && deg <= 225;   // cyan to light blue, around the teal's 189
}
function cellsOffTeal(h: HuntInfo) {
  if (!h.bounds_nm) return;
  const roots = (h.cells ?? []).map(c => String(c.root));
  let n = 0;
  for (const ml of viewer()?.layerManager?.managedLayers ?? []) {
    const ds = ml?.layer?.type === 'segmentation' ? ml.layer.displayState : null;
    const stated = ds?.segmentationColorGroupState?.value?.segmentStatedColors;
    if (!stated) continue;
    for (const root of roots) {
      const id = new Uint64();
      if (!id.tryParseString(root)) continue;
      const c = getBaseObjectColor(ds, id, new Float32Array(4));
      if (!nearTeal(c[0], c[1], c[2])) continue;
      const hex = OFF_TEAL[n++ % OFF_TEAL.length];
      try { setStatedColor(stated, id, ((hex >> 16) & 255) | (hex & 0xff00) | ((hex & 255) << 16)); } catch { /* keeps its color */ }
    }
  }
}
function edgeGlow(h: HuntInfo | null) {
  const v = viewer();
  const b = h?.bounds_nm;
  const scales = v?.coordinateSpace?.value?.scales;
  const on = !!(h && b && huntPrefs.edges && scales && scales.length >= 3
    && gemKinds(h).some(k => managed(huntLayerName(h, k)))
    && canonicalDataset(currentDatasetTag()) === canonicalDataset(h.dataset));
  const scaleNm = on ? Float32Array.from([0, 1, 2], i => (Number(scales[i]) || 1e-9) / 1e-9) : null;
  const key = on ? JSON.stringify([b, edgeMarginNm(h!), Array.from(scaleNm!)]) : '';
  if (key === glowKey) return;
  glowKey = key;
  setNgeMeshEdge(on ? { lo: b![0], hi: b![1], marginNm: edgeMarginNm(h!), scaleNm: scaleNm!, color: EDGE_RGB } : null);
  try { v?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
}
try { (window as any).__ngeHuntGlow = { get: getNgeMeshEdge, set: setNgeMeshEdge }; } catch { /* no window */ }

/** The gems sit behind the cells: also on Hunt layers made before (the game keeps Show through by layer name).
 *  And they shrink as the 3D view zooms out past the Hunt's starting zoom (Ames 2026-10-23: "gems too big when I zoom out"). */
function gemsBehindCells(h: HuntInfo) {
  const ref = Number((h.view as any)?.projectionScale) || Number(viewer()?.projectionScale?.value) || 0;
  for (const name of [...gemKinds(h).map(k => huntLayerName(h, k)), huntEdgeLayerName(h)]) {
    const ml = managed(name);
    const ds = ml?.layer?.constructor?.type === 'annotation' ? ml.layer.annotationDisplayState : null;
    if (!ds) continue;
    try { if (ds.ngeOnTop && ds.ngeOnTop.value) ds.ngeOnTop.value = false; } catch { /* the setting is optional */ }
    try { if (ds.ngeShrinkRef && ref > 0) ds.ngeShrinkRef.value = ref; } catch { /* the setting is optional */ }
  }
}

/** Which layer Ctrl + Click drops into: the Hunt box's Cut and Extend buttons. */
export function pickKind(h: HuntInfo, kind: GemKind) {
  huntState.kind = kind;
  const ml = managed(huntLayerName(h, kind));
  const v = viewer();
  if (ml && v) { try { v.selectedLayer.layer = ml; v.selectedLayer.visible = huntPrefs.panels; } catch { /* the panel is optional */ } }
}

/** Put a judged gem in its folder (and the folder back, if the player removed it). */
function fileGem(h: HuntInfo, kind: GemKind, id: string, hit: boolean | 'edge') {
  const folders = managed(huntLayerName(h, kind))?.layer?.ngeAnnFolders;
  if (!folders) return;
  const want = hit === 'edge' ? EDGE : hit ? { ...FOUND, color: FOUND_COLOR[kind] } : MISSED;
  let value = (folders.value as any[]).map(f => ({ ...f, ids: f.ids.filter((x: string) => x !== id) }));
  if (!value.some(f => f.id === want.id)) value = [...value, { id: want.id, name: want.name, ids: [], color: want.color, paint: true }];
  folders.value = value.map(f => (f.id === want.id ? { ...f, ids: [...f.ids, id], color: want.color } : f));
  folders.changed.dispatch();
  // Checked: it stays from now on (keepCheckedGems), even if taken off before the next look.
  const a = managed(huntLayerName(h, kind))?.layer?.localAnnotations?.get?.(id);
  if (a?.point) lockedGems.set(id, { kind, point: Array.from(a.point as Float32Array), folder: want.id });
}

function removeGem(h: HuntInfo, kind: GemKind, id: string) {
  const src = managed(huntLayerName(h, kind))?.layer?.localAnnotations;
  if (!src) return;
  const ref = src.getReference(id);
  try { src.delete(ref); } finally { ref.dispose(); }
}

const AFTER_SWITCH_KEY = 'nge_hunt_after_switch';

/** The hunt open on screen, whose new gems are judged. */
let active: HuntInfo | null = null;

/**
 * Open a hunt: its dataset (switching reloads the page, so the next page
 * carries on), its starting view, and the gem layers with the player's gems.
 * 'switching' when the page is about to reload.
 */
export async function goToHunt(given: HuntInfo): Promise<'ok' | 'switching'> {
  // Entering the Hunt, shown while it opens and for a moment after, so a quick open does not flash.
  const token = Date.now();
  huntState.opening = { title: given.title, step: 'Opening the Hunt', token };
  try { return await openHunt(given); }
  finally {
    const left = 1300 - (Date.now() - token);
    setTimeout(() => { if (huntState.opening?.token === token) huntState.opening = null; }, Math.max(0, left));
  }
}
async function openHunt(given: HuntInfo): Promise<'ok' | 'switching'> {
  let h = given;
  // Before the start the server keeps the view back (nobody peeks), and the page asks again a few
  // seconds after the start. A click in between asks now, and again for a moment while the server's
  // clock catches up (Ames 2026-10-21: "a slight delay between when it started and when it let me click").
  for (let i = 0; i < 5 && !h.view && !h.test && phaseNow(h) === 'live'; i++) {
    if (i) await new Promise(r => setTimeout(r, 800));
    await loadHunts();
    h = huntState.hunts.find(x => x.id === given.id) ?? h;
  }
  if (!h.view) throw new Error(phaseNow(h) === 'announced' ? 'The Hunt has not started yet.' : 'This Hunt has no view to open.');
  if (canonicalDataset(currentDatasetTag()) !== canonicalDataset(h.dataset)) {
    const ds = findDatasetByCanonical(canonicalDataset(h.dataset));
    if (!ds) throw new Error('This Hunt is on a dataset this version of Pyr does not have. Reload the page to update.');
    try { sessionStorage.setItem(AFTER_SWITCH_KEY, JSON.stringify({ id: h.id, test: !!h.test, at: Date.now() })); } catch { /* private window */ }
    openingStep(`Switching to ${(ds as any).name || 'its dataset'}`);
    const ok = await switchToDataset(ds, { forJump: true });
    if (!ok) throw new Error('Could not switch dataset.');
    // The switch happens in place (no reload): wait for it, then carry on into the Hunt (Ames 2026-10-23:
    // "switched me but didn't take me to the hunt"). If the page reloads instead, takeHuntAfterSwitch carries on.
    const want = canonicalDataset(h.dataset);
    for (let i = 0; i < 40 && canonicalDataset(currentDatasetTag()) !== want; i++) await new Promise(r => setTimeout(r, 250));
    if (canonicalDataset(currentDatasetTag()) !== want) return 'switching';
    try { sessionStorage.removeItem(AFTER_SWITCH_KEY); } catch { /* private window */ }
    for (let i = 0; i < 40 && !viewer()?.state; i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 800));   // the new dataset's layers settle before the Hunt's view replaces them
  }
  const v = viewer();
  if (!v?.state) throw new Error('The viewer is not ready yet. Try again in a moment.');
  const kept = active && active.id === h.id && !!active.test === !!h.test ? keptOnScreen(h) : [];
  active = null;   // the old layers go with the restore; nothing in them is judged meanwhile
  queue.length = 0;
  waiting.length = 0;
  huntState.waiting = 0;
  const snap = keepDisplayEnabled() ? snapshotDisplay() : null;
  openingStep('Opening the view');
  v.state.restoreState(h.view);
  restoreDisplayAfterLoad(snap);
  // The restore and the display keeper settle over a moment and can drop a
  // layer added too early, so add the gem layers until they have stayed put.
  const names = [...gemKinds(h).map(k => huntLayerName(h, k)), ...(ringEdges(h).length ? [huntEdgeLayerName(h)] : [])];
  let steady = 0;
  for (let i = 0; i < 16 && steady < 3; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (names.every(n => layerJson(n))) { steady++; continue; }
    steady = 0;
    ensureGemLayers(h, kept);
  }
  openingStep('Placing your gems');
  ensureGemLayers(h, kept);
  judged.clear();
  lockedGems.clear();
  for (const d of h.you?.drops ?? []) judged.add(d.id);
  for (const g of kept) if (g.judged) judged.add(g.id);
  onScreenBefore.clear();
  for (const g of kept) onScreenBefore.add(g.id);
  active = h;
  quietPanels();
  gemsBehindCells(h);
  cellsOffTeal(h);
  edgeGlow(h);
  setTimeout(() => { gemsBehindCells(h); cellsOffTeal(h); }, 1500);   // after the display keeper has put back what it kept
  startDropWatch();
  // The run's clock starts at the first open (the server keeps the first time; a second open changes nothing).
  if (!h.test && h.phase === 'live' && !h.you?.started_at) {
    try {
      const r = await huntCall<{ run: HuntRun }>('hunt.start', { id: h.id });
      const copy = liveCopy(h);
      if (copy && r?.run) copy.you = { ...copy.you, ...r.run };
      // The board read before the run began has no row for you; the page asks again only at the end.
      if (r?.run) void loadHunts();
    } catch (e) { console.warn('[hunt] could not start the clock:', e); }
  }
  return 'ok';
}

/** After a dataset switch for a hunt: the hunt to carry on with (and whether it is a test run), once. */
export function takeHuntAfterSwitch(): { id: number; test: boolean } | null {
  try {
    const want = JSON.parse(sessionStorage.getItem(AFTER_SWITCH_KEY) || 'null');
    sessionStorage.removeItem(AFTER_SWITCH_KEY);
    if (!want || Date.now() - (want.at || 0) > 120_000) return null;
    const id = Number(want.id) || 0;
    return id ? { id, test: !!want.test } : null;
  } catch { return null; }
}

/** Admins: open a hunt to try it (any phase, a draft too). Each gem is judged and nothing is kept. */
export async function openTestHunt(id: number): Promise<HuntInfo> {
  huntState.test = null;
  huntState.news = null;
  huntState.log = [];
  testDrops.length = 0;
  const t = await huntCall<HuntInfo>('hunt.test', { id });
  huntState.test = { ...t, test: true, phase: 'live' };
  return huntState.test;
}

/** What the last gem did, for the Hunt box. */
export interface DropNews {
  id: string; result: 'hit' | 'miss' | 'already' | 'refused' | 'edge' | 'kept'; kind?: GemKind | null; gem: GemKind;
  other?: GemKind | null; text?: string; nearest_um?: number | null; at: number;
  /** Where on screen the gem was dropped (the Ctrl + Click), for the burst there. */
  x?: number; y?: number;
}

// Where the last Ctrl + Click (⌘ + Click) landed, so each gem's answer can burst on the spot.
let lastClick: { x: number; y: number; at: number } | null = null;
let lastCtrlAt = 0;
try {
  window.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) { lastClick = { x: e.clientX, y: e.clientY, at: Date.now() }; lastCtrlAt = lastClick.at; }
  }, true);
} catch { /* no window */ }

const judged = new Set<string>();   // gems the server has answered for (or put back from the run)
/** Gems already on screen when the Hunt came back (a reload, Back to the start view): never taken off as new ones. */
const onScreenBefore = new Set<string>();

/**
 * Check each gem as it lands, or keep them until Submit (Ames 2026-10-21: "want option to
 * autosubmit or submit manually"). Kept in this browser.
 */
export const huntPrefs = reactive({
  auto: (() => { try { return localStorage.getItem('nge-hunt-auto') !== '0'; } catch { return true; } })(),
  /** The Annotations and Selection panels while hunting (Ames 2026-10-21: "an option to hide Annotations
   *  side panel during hunt"): closed unless the player opens them here. Kept in this browser. */
  panels: (() => { try { return localStorage.getItem('nge-hunt-panels') === '1'; } catch { return false; } })(),
  /** The cells glow where they run out of the data (Ames 2026-10-23: "a way to toggle that on/off bc it
   *  might be distracting in a hunt"). On unless the player turns it off. Kept in this browser. */
  edges: (() => { try { return localStorage.getItem('nge-hunt-edges') !== '0'; } catch { return true; } })(),
});
export function setHuntEdges(on: boolean) {
  huntPrefs.edges = on;
  try { localStorage.setItem('nge-hunt-edges', on ? '1' : '0'); } catch { /* private window */ }
  edgeGlow(active);
  if (active) setRingsVisible(active);
}
export function setHuntPanels(on: boolean) {
  huntPrefs.panels = on;
  try { localStorage.setItem('nge-hunt-panels', on ? '1' : '0'); } catch { /* private window */ }
  const v = viewer(); if (!v) return;
  try {
    if (isGemLayer(v.selectedLayer?.layer?.name)) v.selectedLayer.visible = on;
    if (!on) v.selectionDetailsState.location.visible = false;
  } catch { /* the panels are optional */ }
}
function isGemLayer(name: unknown): boolean {
  return !!active && typeof name === 'string' && gemKinds(active).some(k => huntLayerName(active!, k) === name);
}
/** Closed while hunting: the gem layer's panel, and the Selection panel each new gem opens. */
function quietPanels() {
  if (huntPrefs.panels || !active) return;
  const v = viewer(); if (!v) return;
  try {
    if (isGemLayer(v.selectedLayer?.layer?.name)) v.selectedLayer.visible = false;
    v.selectionDetailsState.location.visible = false;
  } catch { /* the panels are optional */ }
}
/** A gem's Ctrl + Click opens the Selection panel (neuroglancer selects the new point): closed at once, no flash.
 *  A panel the player opens by hand stays open. */
const hookedViewers = new WeakSet<object>();
function hookPanels() {
  const v = viewer();
  const w = v?.selectionDetailsState?.location?.watchableVisible;
  if (!v || !w?.changed || hookedViewers.has(v)) return;
  hookedViewers.add(v);
  w.changed.add(() => {
    if (w.value && active && !huntPrefs.panels && lastCtrlAt && Date.now() - lastCtrlAt < 1500) w.value = false;
  });
  // The Cut and Extend buttons follow the gem layer picked any way (Ames 2026-10-26: "the buttons in hunt
  // should track my changes -- eg I am in Cut but the box shows extend"): its tab, or its number key.
  // Going from one gem layer to the other leaves the side panel as the player has it, as the buttons do.
  const sl = v.selectedLayer;
  if (!sl?.changed) return;
  let lastName: string | undefined = sl.layer?.name;
  sl.changed.add(() => {
    const name: string | undefined = sl.layer?.name;
    if (name === lastName) return;
    const fromGem = isGemLayer(lastName);
    lastName = name;
    const k = gemKindOf(name);
    if (!k) return;
    if (huntState.kind !== k) huntState.kind = k;
    if (fromGem && !huntPrefs.panels) queueMicrotask(() => { if (sl.layer?.name === name && sl.visible) sl.visible = false; });
  });
}
/** Which gem a layer holds in the open Hunt, if it is one of its gem layers. */
function gemKindOf(name: unknown): GemKind | null {
  if (!active || typeof name !== 'string') return null;
  return gemKinds(active).find(k => huntLayerName(active!, k) === name) ?? null;
}
/** The buttons show the gem layer picked (a hook added late misses a change), and each gem layer's number key. */
function followKind(h: HuntInfo) {
  const v = viewer();
  const k = gemKindOf(v?.selectedLayer?.layer?.name);
  if (k && huntState.kind !== k) huntState.kind = k;
  // The number keys pick a layer by its place in the tabs, 1 to 9; with Classic Layers (Settings) they show
  // and hide it instead, so no key is offered then.
  let classic = false;
  try { classic = JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}').classicLayerClicks === true; } catch { /* default */ }
  const tabs = classic ? [] : (v?.layerManager?.managedLayers ?? []).filter((l: any) => !l.archived).map((l: any) => l.name);
  const keys: Partial<Record<GemKind, number>> = {};
  for (const g of gemKinds(h)) { const i = tabs.indexOf(huntLayerName(h, g)); if (i >= 0 && i < 9) keys[g] = i + 1; }
  if (JSON.stringify(keys) !== JSON.stringify(huntState.keys)) huntState.keys = keys;
}
/** Gems dropped but not sent yet (Submit mode). */
const waiting: { id: string; kind: GemKind; x?: number; y?: number }[] = [];
/** Take back the last gem not sent yet (Ames 2026-10-26, from Celia: you can delete a gem added by
 *  mistake while "Check each gem as it lands" is off). */
export function takeBackGem() {
  const h = active;
  const w = waiting.pop();
  huntState.waiting = waiting.length;
  if (h && w) removeGem(h, w.kind, w.id);
}
/**
 * Checked gems stay (Celia 2026-10-26: you should not be able to remove gems marked correct or incorrect):
 * one taken off, from the Annotations panel or anywhere, comes back at once in its folder.
 */
const lockedGems = new Map<string, { kind: GemKind; point: number[]; folder: string }>();
function keepCheckedGems(h: HuntInfo) {
  for (const kind of gemKinds(h)) {
    const layer = managed(huntLayerName(h, kind))?.layer;
    const src = layer?.localAnnotations;
    if (!src) continue;
    const folders = ((layer.ngeAnnFolders?.value ?? []) as any[]);
    const folderOf = (id: string) => folders.find(f => [FOUND.id, MISSED.id, EDGE.id].includes(f.id) && f.ids.includes(id))?.id as string | undefined;
    for (const a of src) {
      if (!a || a.type !== 0 || !a.point || !judged.has(a.id)) continue;
      const folder = folderOf(a.id);
      if (folder) lockedGems.set(a.id, { kind, point: Array.from(a.point as Float32Array), folder });
    }
    let back = 0;
    for (const [id, g] of lockedGems) {
      if (g.kind !== kind || src.get?.(id)) continue;
      try { src.add({ type: 0, id, point: Float32Array.from(g.point), description: '', properties: [] } as any); } catch { continue; }
      fileGem(h, kind, id, g.folder === EDGE.id ? 'edge' : g.folder === FOUND.id);
      back++;
    }
    if (back) tell({ id: `kept-${Date.now()}`, gem: kind, result: 'kept', at: Date.now() });
  }
}
export function setAutoJudge(on: boolean) {
  huntPrefs.auto = on;
  try { localStorage.setItem('nge-hunt-auto', on ? '1' : '0'); } catch { /* private window */ }
  if (on) submitWaiting();
}
/** Send the waiting gems, one after another. */
export function submitWaiting() {
  while (waiting.length) queue.push(waiting.shift()!);
  huntState.waiting = 0;
  if (queue.length) void judgeNext();
}
const transient = (m: string) => /wait a moment|Save failed \(5\d\d\)|Failed to fetch|NetworkError|Load failed|did not go through|timed? ?out/i.test(m);
const tries = new Map<string, number>();
const queue: { id: string; kind: GemKind; x?: number; y?: number }[] = [];
let busy = false;
/** A test run's gems so far (sent back with each new one; the server judges them again). */
const testDrops: { id: string; nm: number[]; hit: number; k: GemKind }[] = [];

/** The running hunt in the list (or the test run), to update with each answer. */
function liveCopy(h: HuntInfo): HuntInfo | null {
  return h.test ? huntState.test : (huntState.hunts.find(x => x.id === h.id) ?? null);
}

function tell(n: DropNews) {
  huntState.news = n;
  huntState.log = [n, ...huntState.log].slice(0, 4);
}

async function judgeNext() {
  if (busy) return;
  const h = active;
  const next = queue.shift();
  if (!h || !next) return;
  const { id, kind, x, y } = next;
  if (judged.has(id)) { if (queue.length) void judgeNext(); return; }   // answered already: never sent twice
  busy = true;
  huntState.pending = { id, gem: kind, x, y, at: Date.now() };
  try {
    const name = huntLayerName(h, kind);
    const src = managed(name)?.layer?.localAnnotations;
    const a = src?.get?.(id);
    if (!a || !a.point) return;
    const json = layerJson(name);
    const dims = viewer()?.state?.toJSON?.()?.dimensions;
    const layer = { source: json?.source ?? 'local://annotations', annotations: [{ type: 'point', id, point: Array.from(a.point as Float32Array) }] };
    let r: any;
    try {
      r = await huntCall<any>(h.test ? 'hunt.test_drop' : 'hunt.drop', { id: h.id, kind, layer, dims, ...(h.test ? { prev: testDrops } : {}) });
    } catch (e: any) {
      const m = e?.message || String(e);
      // A busy server or a blink in the network: the gem stays and is sent again in a moment.
      const n = (tries.get(id) ?? 0) + 1;
      if (transient(m) && n <= 6) {
        tries.set(id, n);
        setTimeout(() => { if (!queue.some(q => q.id === id)) { queue.unshift(next); void judgeNext(); } }, 1200 * n);
        return;
      }
      // Out of gems, all found, or the Hunt is over: the gem does not stay.
      judged.add(id);
      removeGem(h, kind, id);
      tell({ id, gem: kind, result: 'refused', text: e?.message || String(e), at: Date.now(), x, y });
      return;
    }
    judged.add(id);
    if (r.drop?.edge) {
      // Where the branch leaves the data: no gem used, and the gem stays in its own folder.
      edgeIds.add(id);
      fileGem(h, kind, id, 'edge');
      tell({ id, gem: kind, result: 'edge', at: Date.now(), x, y });
    } else if (r.drop?.repeat) {
      // The server had this gem already: its first answer stands, the gem stays where it is.
      fileGem(h, kind, id, !!r.drop.hit);
    } else if (r.drop?.already) {
      // A second gem on a place found already: it stays, gold, and uses no gem.
      fileGem(h, kind, id, true);
      tell({ id, gem: kind, result: 'already', at: Date.now(), x, y });
    } else {
      const hit = !!r.drop?.hit;
      fileGem(h, kind, id, hit);
      if (h.test) testDrops.push({ id, nm: r.nm, hit: hit ? 0 : -1, k: kind });
      tell({ id, gem: kind, result: hit ? 'hit' : 'miss', kind: r.drop?.kind ?? null, other: r.drop?.other ?? null,
        nearest_um: h.test ? r.nearest_um : undefined, at: Date.now(), x, y });
    }
    const copy = liveCopy(h);
    if (copy && r.run) {
      copy.you = { ...copy.you, ...r.run };
      // Your own row on the board moves with your gems (the rest wait for the next ask).
      const mine = copy.board?.find(b => b.you);
      if (mine) {
        mine.found = r.run.found; mine.gems = r.run.gems_used;
        copy.board.sort((a, b) => b.found - a.found || a.gems - b.gems).forEach((b, i) => { b.rank = i + 1; });
      } else if (!h.test) void loadHunts();   // no row for you yet (the board was read before your run): ask once
    }
  } finally {
    busy = false;
    huntState.pending = null;
    if (queue.length) void judgeNext();
  }
}

let dropTimer: ReturnType<typeof setInterval> | null = null;
/** Look for new gems in the open hunt's layers, a few times a second, and judge each in turn. */
export function startDropWatch() {
  if (dropTimer) return;
  dropTimer = setInterval(() => {
    if (!active) resumeOnScreen();   // layers that came back with the link load after the list
    const h = active;
    edgeGlow(h);
    if (!h) return;
    hookPanels();
    followKind(h);
    keepCheckedGems(h);
    for (const kind of gemKinds(h)) {
      const src = managed(huntLayerName(h, kind))?.layer?.localAnnotations;
      if (!src) continue;
      for (const a of src) {
        if (!a || a.type !== 0 /* point */ || judged.has(a.id) || queue.some(q => q.id === a.id) || src.pending?.has?.(a.id)) continue;
        if (huntState.pending?.id === a.id) continue;   // on its way to the server (a slow answer)
        // The click that made it, if it was just now.
        const click = lastClick && Date.now() - lastClick.at < 3000 ? lastClick : null;
        lastClick = null;
        if (waiting.some(w => w.id === a.id)) continue;
        const item = { id: a.id, kind, ...(click ? { x: click.x, y: click.y } : {}) };
        // Never more gems down than the run has (Celia 2026-10-23: "able to lay down one more gem than she
        // had"): once the run is done, or the gems waiting for Submit use every gem left, a new one comes
        // off at once. (A gem on a place found already, or at an edge, uses none and stays.)
        const you = liveCopy(h)?.you;
        if (you && !onScreenBefore.has(a.id) && (you.done || (!huntPrefs.auto && waiting.length >= you.gems_left))) {
          removeGem(h, kind, a.id);
          tell({ id: a.id, gem: kind, result: 'refused', at: Date.now(), ...(click ? { x: click.x, y: click.y } : {}),
            text: you.done ? (you.of && you.found >= you.of ? 'You found them all. Your Hunt is done.' : 'You have used all your gems. Your Hunt is done.')
              : `No gem left for this one: ${waiting.length === 1 ? 'the gem waiting uses your last one' : `the ${waiting.length} gems waiting use them all`}. Submit, or take one back.` });
          continue;
        }
        if (huntPrefs.auto) queue.push(item);
        else { waiting.push(item); huntState.waiting = waiting.length; }
      }
    }
    // A waiting gem the player took away is not sent.
    if (waiting.length) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        const src = managed(huntLayerName(h, waiting[i].kind))?.layer?.localAnnotations;
        if (!src?.get?.(waiting[i].id)) waiting.splice(i, 1);
      }
      huntState.waiting = waiting.length;
    }
    if (queue.length) void judgeNext();
  }, 400);
}
/** Kept for the top bar, which starts it at sign in. */
export const startGemWatch = startDropWatch;

/**
 * A running hunt whose layers are already on screen (a reload keeps them in the
 * link, or the player came back to the tab) is judged again without pressing
 * anything: its judged gems are known from the server's run and put in their
 * folders; any gem not judged yet is judged now.
 */
function resumeOnScreen() {
  if (active && !active.test) {
    const fresh = huntState.hunts.find(x => x.id === active!.id);
    if (fresh && fresh.phase === 'live') { active = fresh; return; }
    if (fresh && fresh.phase !== 'live') { active = null; return; }
  }
  if (active) return;
  for (const h of huntState.hunts) {
    if (h.phase !== 'live') continue;
    const kinds = gemKinds(h).filter(k => managed(huntLayerName(h, k)));
    if (!kinds.length) continue;
    judged.clear();
    lockedGems.clear();
    for (const d of h.you?.drops ?? []) {
      judged.add(d.id);
      if (kinds.includes(dropKind(d))) fileGem(h, dropKind(d), d.id, d.hit);
    }
    // The gems already down when the Hunt comes back are the player's: checked again, never taken off as new.
    onScreenBefore.clear();
    for (const k of kinds) for (const a of managed(huntLayerName(h, k))?.layer?.localAnnotations ?? []) if (a?.id) onScreenBefore.add(a.id);
    active = h;
    gemsBehindCells(h);
    cellsOffTeal(h);
    ensureEdgeLayer(h);   // a ring layer from before the glow comes back with the link: drawn again with the rings left
    startDropWatch();
    return;
  }
}

// ── For the Admin Hub: read an answer key, the cells and the view from the screen ──

export interface KeyCandidate { name: string; points: number }

/** Annotation layers on screen with point annotations, most points first. */
export function keyCandidates(): KeyCandidate[] {
  try {
    const layers: any[] = viewer()?.state?.toJSON?.()?.layers ?? [];
    return layers.filter(l => l && l.type === 'annotation')
      // Points, and places with an area: ellipsoids, lines and boxes (Ames 2026-10-26).
      .map(l => ({ name: String(l.name), points: (Array.isArray(l.annotations) ? l.annotations : []).filter((a: any) => a && ['point', 'ellipsoid', 'line', 'axis_aligned_bounding_box'].includes(a.type)).length }))
      .filter(c => c.points > 0).sort((a, b) => b.points - a.points);
  } catch { return []; }
}

/**
 * The finished cell an admin can lay over a Hunt cell made from its edits (util/hunt_from_edits.ts). It is
 * the answer, so it is never a Hunt cell and never in a Hunt's view.
 */
export const HUNT_PREVIEW_LAYER = 'Finished cell (only you see it)';

/** The cells shown in the segmentation layers (hidden ones, marked "!", left out). */
export function cellsOnScreen(): { root: string; label: string }[] {
  const out: { root: string; label: string }[] = [];
  try {
    for (const l of viewer()?.state?.toJSON?.()?.layers ?? []) {
      if (!l || l.type !== 'segmentation' || !Array.isArray(l.segments) || l.name === HUNT_PREVIEW_LAYER) continue;
      for (const s of l.segments) {
        const id = String(s);
        if (/^\d{5,24}$/.test(id) && !out.some(c => c.root === id)) out.push({ root: id, label: '' });
      }
    }
  } catch { /* nothing on screen */ }
  return out.slice(0, 20);
}

/** What the Admin Hub sends to make a hunt from the screen: the key layer, the view, the cells, the dataset. */
/** A layer's places are cuts (mergers) or merges (pieces left off); a guess from its name, which the admin can change. */
/** A key layer marks mergers (cut), extensions (merge), or edges of the dataset (edge: not problems). */
export type KeyKind = 'cut' | 'merge' | 'edge';
export function guessKind(name: string): KeyKind {
  if (/edge|boundary|border|out of (the )?data/i.test(name)) return 'edge';
  if (/merger|cut|split\b/i.test(name)) return 'cut';
  if (/merge|extension|extend|join|missing|attach/i.test(name)) return 'merge';
  return 'cut';
}

/**
 * The volume's outer bounds in nanometres, [[x, y, z] low, [x, y, z] high]: an Extend gem this near
 * them is the edge of the dataset (Ames 2026-10-22). The segmentation's own volume, where the cells
 * are cut off (Ames 2026-10-23: the viewer space can be far larger, so nothing counted); else the
 * whole viewer space. Null if unknown.
 */
export function datasetBoundsNm(): number[][] | null {
  for (const ml of viewer()?.layerManager?.managedLayers ?? []) {
    try {
      if (ml?.layer?.type !== 'segmentation') continue;
      const b = layerBoundsNm(ml);
      if (b) return b;
    } catch { /* the next layer */ }
  }
  return viewerBoundsNm();
}
/** A layer's data bounds in nanometres: its source's own voxel bounds times the source's own scales
 *  (the sandbox's 8 nm source in a 4 nm view came out half size through the transform, Ames 2026-10-23). */
export function layerBoundsNm(ml: any): number[][] | null {
  for (const ds of ml?.layer?.dataSources ?? []) {
    const ls = ds?.loadState;
    const inS = (ls?.dataSource?.modelTransform ?? ls?.transform?.value)?.inputSpace;
    const lo = inS?.bounds?.lowerBounds, hi = inS?.bounds?.upperBounds, sc = inS?.scales, names: string[] = inS?.names ?? [];
    if (!lo || !hi || !sc) continue;
    const ix = ['x', 'y', 'z'].map(n => names.indexOf(n));
    if (ix.some(i => i < 0)) continue;
    const L = ix.map(i => Number(lo[i]) * Number(sc[i]) * 1e9), H = ix.map(i => Number(hi[i]) * Number(sc[i]) * 1e9);
    if (L.every((v, k) => Number.isFinite(v) && Number.isFinite(H[k]) && H[k] > v)) return [L, H];
  }
  return null;
}
try { (window as any).__ngeHuntBounds = layerBoundsNm; } catch { /* no window */ }

/**
 * Where the Hunt's cells run out of the data (Ames 2026-10-23: "I think we wanted to try highlighting
 * the actual neurons"): their meshes near the volume's outside, one spot per place. Read from the
 * meshes on screen (vertex positions in nanometres), within marginNm of a face, grouped on a grid and
 * joined where they touch. `meshes`/`loaded`: the cells' mesh pieces in all, and on hand now.
 */
export function meshEdgeSpots(roots: string[], bounds: number[][] | null, marginNm = 5000, binNm = 3000): { spots: number[][]; pieces: number; loaded: number } {
  const out = { spots: [] as number[][], pieces: 0, loaded: 0 };
  if (!bounds || !roots.length) return out;
  const [lo, hi] = bounds;
  const bins = new Map<string, { n: number; x: number; y: number; z: number; i: number; j: number; k: number }>();
  // The mesh layer keys a cell by its id's low and high words (getObjectKey).
  const keyOf = (root: string) => { const u = new Uint64(); return u.tryParseString(root) ? `${u.low},${u.high}` : ''; };
  for (const ml of viewer()?.layerManager?.managedLayers ?? []) {
    if (ml?.layer?.type !== 'segmentation') continue;
    for (const rl of ml.layer.renderLayers ?? []) {
      const src = rl?.source;
      if (!src?.fragmentSource?.chunks || !src?.chunks || typeof src.getFragmentKey !== 'function') continue;
      for (const root of roots) {
        const key = keyOf(root);
        const manifest = key ? src.chunks.get(key) : undefined;
        if (!manifest?.fragmentIds) continue;
        for (const fid of manifest.fragmentIds) {
          out.pieces++;
          const frag = src.fragmentSource.chunks.get(src.getFragmentKey(key, fid).key);
          const vp: Float32Array | undefined = frag?.meshData?.vertexPositions;
          if (!vp) continue;
          out.loaded++;
          for (let p = 0; p + 2 < vp.length; p += 3) {
            const x = vp[p], y = vp[p + 1], z = vp[p + 2];
            const d = Math.min(x - lo[0], hi[0] - x, y - lo[1], hi[1] - y, z - lo[2], hi[2] - z);
            if (!(d <= marginNm)) continue;
            const i = Math.floor(x / binNm), j = Math.floor(y / binNm), k = Math.floor(z / binNm);
            const bk = `${i},${j},${k}`;
            const b = bins.get(bk);
            if (b) { b.n++; b.x += x; b.y += y; b.z += z; } else bins.set(bk, { n: 1, x, y, z, i, j, k });
          }
        }
      }
    }
  }
  // Touching bins are one place: its spot is the middle of their vertices.
  const seen = new Set<string>();
  for (const [bk, b0] of bins) {
    if (seen.has(bk)) continue;
    seen.add(bk);
    let n = 0, sx = 0, sy = 0, sz = 0;
    const queue = [b0];
    while (queue.length) {
      const b = queue.pop()!;
      n += b.n; sx += b.x; sy += b.y; sz += b.z;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const nk = `${b.i + di},${b.j + dj},${b.k + dk}`;
        const nb = bins.get(nk);
        if (nb && !seen.has(nk)) { seen.add(nk); queue.push(nb); }
      }
    }
    if (n >= 8) out.spots.push([Math.round(sx / n), Math.round(sy / n), Math.round(sz / n)]);
  }
  out.spots = out.spots.slice(0, 200);
  return out;
}
try { (window as any).__ngeHuntEdges = meshEdgeSpots; } catch { /* no window */ }
function viewerBoundsNm(): number[][] | null {
  try {
    const cs = viewer()?.coordinateSpace?.value;
    const names: string[] = cs?.names ?? [];
    const lo = cs?.bounds?.lowerBounds, hi = cs?.bounds?.upperBounds, sc = cs?.scales;
    if (!lo || !hi || !sc) return null;
    const ix = ['x', 'y', 'z'].map(n => names.indexOf(n));
    if (ix.some(i => i < 0)) return null;
    const L = ix.map(i => Number(lo[i]) * Number(sc[i]) * 1e9), H = ix.map(i => Number(hi[i]) * Number(sc[i]) * 1e9);
    return L.every((v, k) => Number.isFinite(v) && Number.isFinite(H[k]) && H[k] > v) ? [L, H] : null;
  } catch { return null; }
}

/** Ames 2026-10-21: the key can come from two layers (or more), one for merges and one for cuts. */
export function readHuntFromScreen(keyLayers: { name: string; kind: KeyKind }[]) {
  const state = viewer()?.state?.toJSON?.();
  if (!state) throw new Error('The viewer is not ready yet.');
  if (!keyLayers.length) throw new Error('Tick the layer (or layers) with the places marked.');
  const layers = keyLayers.map(k => {
    const layer = (state.layers ?? []).find((l: any) => l && l.name === k.name && l.type === 'annotation');
    if (!layer) throw new Error(`No annotation layer called "${k.name}" on screen.`);
    return { layer: { source: layer.source, annotations: layer.annotations }, kind: k.kind };
  });
  const bounds = datasetBoundsNm();
  const cells = cellsOnScreen();
  const auto = meshEdgeSpots(cells.map(c => c.root), bounds);
  return {
    key: { layers, dims: state.dimensions, bounds_nm: bounds, auto_edges_nm: auto.spots },
    view: { ...state, layers: (state.layers ?? []).filter((l: any) => l?.name !== HUNT_PREVIEW_LAYER) },
    cells,
    dataset: canonicalDataset(currentDatasetTag()),
    autoEdges: auto,
  };
}
