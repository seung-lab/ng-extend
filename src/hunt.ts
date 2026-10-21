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
  /** Empty until the hunt starts (nobody hunts early); cell_count says how many. */
  cells: { root: string; label: string }[]; cell_count: number;
  announce_at: string | null; start_at: string; end_at: string; phase: HuntPhase;
  target_count: number; tolerance_um: number; max_points: number; max_submissions: number;
  tiers: { gold: number; silver: number; bronze: number }; awarded: boolean;
  view: any | null;
  you: { best: number; submissions: number; left: number; tier: HuntTier | null; rank: number };
  /** An admin's test run (hunt.test): open as if running, for that admin only; answers are never kept. */
  test?: boolean;
  board: { rank: number; name: string; found: number; at: string; tier: HuntTier | null; you: boolean }[];
  players: number;
  winners: { gold: number; silver: number; bronze: number };
}

export interface HuntResult {
  found: number; of: number; close: number; best: number; points: number; left: number; tier: HuntTier | null;
  /** A test run only: each merger, found or not, and the nearest gem in µm (for setting the tolerance). */
  test?: boolean; tolerance_um?: number; mergers?: { found: boolean; nearest_um: number | null }[];
}

/** What the server last said, plus a clock for the countdowns (server time). */
export const huntState = reactive({
  hunts: [] as HuntInfo[],
  /** The hunt an admin is trying (Admin Hub > Hunts > Try it yourself), or null. */
  test: null as HuntInfo | null,
  loaded: false,
  loading: false,
  error: '',
  /** Server time minus this browser's, so a wrong clock never opens a hunt early. */
  offset: 0,
  now: Date.now(),
});

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
  // At least every two hours, so a hunt announced after the page opened shows too.
  const wait = next ? Math.min(next - t + 1500 + Math.random() * 3000, 2 * 3600_000) : 2 * 3600_000;
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
  return new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── The gem layer ─────────────────────────────────────────────────────────

const viewer = (): any => (window as any)['viewer'];
/** A test run has a layer and saved gems of its own, so trying a hunt never mixes with playing it. */
export function huntLayerName(h: Pick<HuntInfo, 'title' | 'test'>): string { return `${h.test ? 'Hunt test' : 'Hunt'}: ${h.title}`.slice(0, 60); }
const POINTS_KEY = (h: Pick<HuntInfo, 'id' | 'test'>) => `nge-hunt-gems-${h.test ? 'test-' : ''}${h.id}`;

function managed(name: string): any {
  return (viewer()?.layerManager?.managedLayers ?? []).find((ml: any) => ml.name === name && !ml.archived) ?? null;
}

/** The hunt layer as the view would save it, or null when it is not on screen. */
function layerJson(name: string): any | null {
  try { return (viewer()?.state?.toJSON?.()?.layers ?? []).find((l: any) => l && l.name === name && l.type === 'annotation') ?? null; }
  catch { return null; }
}

function savedGems(h: Pick<HuntInfo, 'id' | 'test'>): any[] {
  try { const v = JSON.parse(localStorage.getItem(POINTS_KEY(h)) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/** Keep the player's gems in this browser, so leaving and coming back keeps them. */
export function saveGems(h: Pick<HuntInfo, 'id' | 'title' | 'test'>): number {
  const l = layerJson(huntLayerName(h));
  if (!l) return -1;
  const gems = (Array.isArray(l.annotations) ? l.annotations : []).filter((a: any) => a && a.type === 'point');
  try { localStorage.setItem(POINTS_KEY(h), JSON.stringify(gems)); } catch { /* full, or private */ }
  return gems.length;
}

/** How many gems the player has on screen for this hunt (-1 when its layer is not open). */
export function gemsOnScreen(h: Pick<HuntInfo, 'title' | 'test'>): number {
  const l = layerJson(huntLayerName(h));
  if (!l) return -1;
  return (Array.isArray(l.annotations) ? l.annotations : []).filter((a: any) => a && a.type === 'point').length;
}

/** The hunt's gem layer: gold Pyr gems, the point tool picked, the player's own gems back in it. */
function ensureGemLayer(h: HuntInfo) {
  const v = viewer();
  if (!v?.layerSpecification) return;
  const name = huntLayerName(h);
  let ml = managed(name);
  if (!ml) {
    ml = makeLayer(v.layerSpecification, name, {
      type: 'annotation', source: { url: 'local://annotations' }, annotations: savedGems(h),
      annotationColor: GEM_COLOR, pointMarker: 'pyr', pointSize: 1.6, tool: 'annotatePoint',
    });
    v.layerSpecification.add(ml);
  }
  try { v.selectedLayer.layer = ml; v.selectedLayer.visible = true; } catch { /* the panel is optional */ }
}

const AFTER_SWITCH_KEY = 'nge_hunt_after_switch';

/**
 * Open a hunt: its dataset (switching reloads the page, so the next page
 * carries on), its starting view, and the gem layer with the player's gems.
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
  // Gems already on screen (coming back to the hunt) are kept first.
  if (managed(huntLayerName(h))) saveGems(h);
  const v = viewer();
  if (!v?.state) throw new Error('The viewer is not ready yet. Try again in a moment.');
  const snap = keepDisplayEnabled() ? snapshotDisplay() : null;
  v.state.restoreState(h.view);
  restoreDisplayAfterLoad(snap);
  // The restore and the display keeper settle over a moment and can drop a
  // layer added too early, so add the gem layer until it has stayed put.
  const name = huntLayerName(h);
  let steady = 0;
  for (let i = 0; i < 16 && steady < 3; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (layerJson(name)) { steady++; continue; }
    steady = 0;
    ensureGemLayer(h);
  }
  ensureGemLayer(h);
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

/** Admins: open a hunt to try it (any phase, a draft too). Answers are scored and never kept. */
export async function openTestHunt(id: number): Promise<HuntInfo> {
  huntState.test = null;
  const t = await huntCall<HuntInfo>('hunt.test', { id });
  huntState.test = { ...t, test: true, phase: 'live' };
  return huntState.test;
}

/** Send the gems on screen as an answer. */
export async function submitGems(h: HuntInfo): Promise<HuntResult> {
  const name = huntLayerName(h);
  const l = layerJson(name);
  if (!l) throw new Error('Open the Hunt first: your gems go in its own layer.');
  saveGems(h);
  const dims = viewer()?.state?.toJSON?.()?.dimensions;
  const r = await huntCall<HuntResult>(h.test ? 'hunt.test_submit' : 'hunt.submit', { id: h.id, layer: { source: l.source, annotations: l.annotations }, dims });
  if (!h.test) void loadHunts();
  return r;
}

let watchTimer: ReturnType<typeof setInterval> | null = null;
/** Every few seconds, keep the gems of a running hunt in this browser. */
export function startGemWatch() {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    for (const h of huntState.hunts) if (h.phase === 'live') saveGems(h);
    if (huntState.test) saveGems(huntState.test);
  }, 4000);
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
export function readHuntFromScreen(keyLayer: string) {
  const state = viewer()?.state?.toJSON?.();
  if (!state) throw new Error('The viewer is not ready yet.');
  const layer = (state.layers ?? []).find((l: any) => l && l.name === keyLayer && l.type === 'annotation');
  if (!layer) throw new Error(`No annotation layer called "${keyLayer}" on screen.`);
  return {
    key: { layer: { source: layer.source, annotations: layer.annotations }, dims: state.dimensions },
    view: state,
    cells: cellsOnScreen(),
    dataset: canonicalDataset(currentDatasetTag()),
  };
}
