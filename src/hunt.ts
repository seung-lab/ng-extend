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
  board: { rank: number; name: string; found: number; gems: number; at: string; tier: HuntTier | null; you: boolean }[];
  players: number;
  winners: { gold: number; silver: number; bronze: number };
}

/** One gem the server judged: where it is (as the layer holds it), and whether it found a problem. */
export interface HuntDrop { id: string; at: number[] | null; hit: boolean; kind: 'cut' | 'merge' | null; k?: 'cut' | 'merge' | null }
/** A player's run: their gems so far, what they found, what is left. */
export interface HuntRun {
  budget: number; found: number; of: number; gems_used: number; gems_left: number; done: boolean;
  found_by?: { cut: number; merge: number }; of_by?: { cut: number; merge: number };
  tier: HuntTier | null; drops: HuntDrop[];
}

/** What the server last said, plus a clock for the countdowns (server time). */
export const huntState = reactive({
  hunts: [] as HuntInfo[],
  /** The hunt an admin is trying (Admin Hub > Hunts > Try it yourself), or null. */
  test: null as HuntInfo | null,
  /** What the last gem dropped did (right, wrong, found already, refused). */
  news: null as null | DropNews,
  /** The gem being judged now, for its spinning gem on the spot. */
  pending: null as null | { id: string; gem: GemKind; x?: number; y?: number; at: number },
  /** Which layer Ctrl + Click drops into: cut gems or extend gems. */
  kind: 'cut' as GemKind,
  loaded: false,
  loading: false,
  error: '',
  /** Server time minus this browser's, so a wrong clock never opens a hunt early. */
  offset: 0,
  now: Date.now(),
});

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

/** The hunts this player can see. One small call; again at each announcement, start and end. */
export function loadHunts(): Promise<void> {
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
  const wait = awaiting ? 5000 + Math.random() * 2000 : next ? Math.min(next - t + 1500 + Math.random() * 3000, 2 * 3600_000) : 2 * 3600_000;
  refreshTimer = setTimeout(() => { void loadHunts(); }, wait);
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => { huntState.now = serverNow(); }, 1000);
}

/** The hunt the top bar shows: a running one first, then the next to start, then the latest to end. */
export function featuredHunt(): HuntInfo | null {
  const list = huntState.hunts;
  return list.find(h => h.phase === 'live')
    ?? [...list].filter(h => h.phase === 'announced').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0]
    ?? [...list].filter(h => h.phase === 'ended').sort((a, b) => Date.parse(b.end_at) - Date.parse(a.end_at))[0]
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

function installEditGuard() {
  try { (window as any).__ngeEditGuard = huntEditGuard; } catch { /* */ }
}

/** "2d 4h", "3h 12m", "4m 05s": time left until a moment. */
export function countdown(iso: string | null | undefined): string {
  const ms = Math.max(0, Date.parse(iso || '') - huntState.now);
  if (!Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
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
const FOUND = { id: 'hunt-found', name: 'Found', color: '#f5d142' };    // a found gem shines gold
const MISSED = { id: 'hunt-missed', name: 'Missed', color: '#7d8799' }; // a missed one goes gray

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

function foldersFor(drops: HuntDrop[]) {
  return [
    { id: FOUND.id, name: FOUND.name, ids: drops.filter(d => d.hit).map(d => d.id), color: FOUND.color, paint: true },
    { id: MISSED.id, name: MISSED.name, ids: drops.filter(d => !d.hit).map(d => d.id), color: MISSED.color, paint: true },
  ];
}

/** The kind of a gem already judged: the layer it was dropped from (older gems: what it found, else cut). */
const dropKind = (d: HuntDrop): GemKind => (d.k === 'merge' || d.k === 'cut' ? d.k : d.kind === 'merge' ? 'merge' : 'cut');

/** The hunt's gem layers, the player's judged gems back in their folders, one layer picked for Ctrl + Click. */
function ensureGemLayers(h: HuntInfo) {
  const v = viewer();
  if (!v?.layerSpecification) return;
  for (const k of gemKinds(h)) {
    const name = huntLayerName(h, k);
    if (managed(name)) continue;
    const drops = (h.you?.drops ?? []).filter(d => dropKind(d) === k && Array.isArray(d.at) && d.at.length >= 3);
    const ml = makeLayer(v.layerSpecification, name, {
      type: 'annotation', source: { url: 'local://annotations' },
      annotations: drops.map(d => ({ type: 'point', id: d.id, point: d.at })),
      annotationColor: KIND_COLOR[k], pointMarker: 'pyr', pointSize: 1.6, tool: 'annotatePoint',
      ngeAnnFolders: foldersFor(drops),
    });
    v.layerSpecification.add(ml);
  }
  pickKind(h, gemKinds(h).includes(huntState.kind) ? huntState.kind : gemKinds(h)[0]);
}

/** Which layer Ctrl + Click drops into: the Hunt box's Cut and Extend buttons. */
export function pickKind(h: HuntInfo, kind: GemKind) {
  huntState.kind = kind;
  const ml = managed(huntLayerName(h, kind));
  const v = viewer();
  if (ml && v) { try { v.selectedLayer.layer = ml; v.selectedLayer.visible = true; } catch { /* the panel is optional */ } }
}

/** Put a judged gem in its folder (and the folder back, if the player removed it). */
function fileGem(h: HuntInfo, kind: GemKind, id: string, hit: boolean) {
  const folders = managed(huntLayerName(h, kind))?.layer?.ngeAnnFolders;
  if (!folders) return;
  const want = hit ? FOUND : MISSED;
  let value = (folders.value as any[]).map(f => ({ ...f, ids: f.ids.filter((x: string) => x !== id) }));
  if (!value.some(f => f.id === want.id)) value = [...value, { id: want.id, name: want.name, ids: [], color: want.color, paint: true }];
  folders.value = value.map(f => (f.id === want.id ? { ...f, ids: [...f.ids, id] } : f));
  folders.changed.dispatch();
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
export async function goToHunt(h: HuntInfo): Promise<'ok' | 'switching'> {
  if (!h.view) throw new Error(h.phase === 'announced' ? 'The Hunt has not started yet.' : 'This Hunt has no view to open.');
  if (canonicalDataset(currentDatasetTag()) !== canonicalDataset(h.dataset)) {
    const ds = findDatasetByCanonical(canonicalDataset(h.dataset));
    if (!ds) throw new Error('This Hunt is on a dataset this version of Pyr does not have. Reload the page to update.');
    try { sessionStorage.setItem(AFTER_SWITCH_KEY, JSON.stringify({ id: h.id, test: !!h.test, at: Date.now() })); } catch { /* private window */ }
    const ok = await switchToDataset(ds, { forJump: true });
    if (!ok) throw new Error('Could not switch dataset.');
    return 'switching';
  }
  const v = viewer();
  if (!v?.state) throw new Error('The viewer is not ready yet. Try again in a moment.');
  active = null;   // the old layers go with the restore; nothing in them is judged meanwhile
  queue.length = 0;
  const snap = keepDisplayEnabled() ? snapshotDisplay() : null;
  v.state.restoreState(h.view);
  restoreDisplayAfterLoad(snap);
  // The restore and the display keeper settle over a moment and can drop a
  // layer added too early, so add the gem layers until they have stayed put.
  const names = gemKinds(h).map(k => huntLayerName(h, k));
  let steady = 0;
  for (let i = 0; i < 16 && steady < 3; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (names.every(n => layerJson(n))) { steady++; continue; }
    steady = 0;
    ensureGemLayers(h);
  }
  ensureGemLayers(h);
  judged.clear();
  for (const d of h.you?.drops ?? []) judged.add(d.id);
  active = h;
  startDropWatch();
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
  testDrops.length = 0;
  const t = await huntCall<HuntInfo>('hunt.test', { id });
  huntState.test = { ...t, test: true, phase: 'live' };
  return huntState.test;
}

/** What the last gem did, for the Hunt box. */
export interface DropNews {
  id: string; result: 'hit' | 'miss' | 'already' | 'refused'; kind?: GemKind | null; gem: GemKind;
  other?: GemKind | null; text?: string; nearest_um?: number | null; at: number;
  /** Where on screen the gem was dropped (the Ctrl + Click), for the burst there. */
  x?: number; y?: number;
}

// Where the last Ctrl + Click (⌘ + Click) landed, so each gem's answer can burst on the spot.
let lastClick: { x: number; y: number; at: number } | null = null;
try {
  window.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) lastClick = { x: e.clientX, y: e.clientY, at: Date.now() };
  }, true);
} catch { /* no window */ }

const judged = new Set<string>();   // gems the server has answered for (or put back from the run)
const queue: { id: string; kind: GemKind; x?: number; y?: number }[] = [];
let busy = false;
/** A test run's gems so far (sent back with each new one; the server judges them again). */
const testDrops: { id: string; nm: number[]; hit: number; k: GemKind }[] = [];

/** The running hunt in the list (or the test run), to update with each answer. */
function liveCopy(h: HuntInfo): HuntInfo | null {
  return h.test ? huntState.test : (huntState.hunts.find(x => x.id === h.id) ?? null);
}

async function judgeNext() {
  if (busy) return;
  const h = active;
  const next = queue.shift();
  if (!h || !next) return;
  const { id, kind, x, y } = next;
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
      // Out of gems, all found, or the Hunt is over: the gem does not stay.
      judged.add(id);
      removeGem(h, kind, id);
      huntState.news = { id, gem: kind, result: 'refused', text: e?.message || String(e), at: Date.now(), x, y };
      return;
    }
    judged.add(id);
    if (r.drop?.already) {
      removeGem(h, kind, id);
      huntState.news = { id, gem: kind, result: 'already', at: Date.now(), x, y };
    } else {
      const hit = !!r.drop?.hit;
      fileGem(h, kind, id, hit);
      if (h.test) testDrops.push({ id, nm: r.nm, hit: hit ? 0 : -1, k: kind });
      huntState.news = { id, gem: kind, result: hit ? 'hit' : 'miss', kind: r.drop?.kind ?? null, other: r.drop?.other ?? null,
        nearest_um: h.test ? r.nearest_um : undefined, at: Date.now(), x, y };
    }
    const copy = liveCopy(h);
    if (copy && r.run) copy.you = { ...copy.you, ...r.run };
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
    if (!h) return;
    for (const kind of gemKinds(h)) {
      const src = managed(huntLayerName(h, kind))?.layer?.localAnnotations;
      if (!src) continue;
      for (const a of src) {
        if (!a || a.type !== 0 /* point */ || judged.has(a.id) || queue.some(q => q.id === a.id) || src.pending?.has?.(a.id)) continue;
        // The click that made it, if it was just now.
        const click = lastClick && Date.now() - lastClick.at < 3000 ? lastClick : null;
        lastClick = null;
        queue.push({ id: a.id, kind, ...(click ? { x: click.x, y: click.y } : {}) });
      }
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
    for (const d of h.you?.drops ?? []) {
      judged.add(d.id);
      if (kinds.includes(dropKind(d))) fileGem(h, dropKind(d), d.id, d.hit);
    }
    active = h;
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
      .map(l => ({ name: String(l.name), points: (Array.isArray(l.annotations) ? l.annotations : []).filter((a: any) => a && a.type === 'point').length }))
      .filter(c => c.points > 0).sort((a, b) => b.points - a.points);
  } catch { return []; }
}

/** The cells shown in the segmentation layers (hidden ones, marked "!", left out). */
export function cellsOnScreen(): { root: string; label: string }[] {
  const out: { root: string; label: string }[] = [];
  try {
    for (const l of viewer()?.state?.toJSON?.()?.layers ?? []) {
      if (!l || l.type !== 'segmentation' || !Array.isArray(l.segments)) continue;
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
export type KeyKind = 'cut' | 'merge';
export function guessKind(name: string): KeyKind {
  if (/merger|cut|split\b/i.test(name)) return 'cut';
  if (/merge|extension|extend|join|missing|attach/i.test(name)) return 'merge';
  return 'cut';
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
  return {
    key: { layers, dims: state.dimensions },
    view: state,
    cells: cellsOnScreen(),
    dataset: canonicalDataset(currentDatasetTag()),
  };
}
