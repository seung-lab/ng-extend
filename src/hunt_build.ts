/**
 * The Hunt Builder in the game (Ames 2026-10-27; rules in functions/hunt_build.js): players help build a Hunt
 * on the Sandbox.
 *
 * - The guard: cells being built, and every ID a planting touched, are protected. Player edits on them are
 *   refused (hunt.ts huntEditGuard asks buildEditGuard first); an invited helper's merge or cut is kept as a
 *   suggestion instead of going to the graph (the graph code hands the guard the edit as it would be sent).
 *   Watch it grow and "update to the current ID" are off for them (isBuildingCell, through isLiveHuntCell).
 * - The veil: from planting on, Pyr will not show those IDs to a player. Every way of showing a cell ends in a
 *   segmentation layer's shown segments; a veiled ID that lands there is taken straight back out.
 * - Planting, undo and Put it back: the admin's browser sends the stored edit to the graph itself, so the
 *   edit never passes the game's edit counting (planting is not proofreading work), then tells the server.
 */
import { reactive } from 'vue';
import { makeLayer } from 'neuroglancer/layer';
import { Uint64 } from 'neuroglancer/util/uint64';
import { StatusMessage } from 'neuroglancer/status';
import { secureWrite } from './secure_write';
import { canonicalDataset, currentDatasetTag, findDatasetByCanonical, segLayerName, switchToDataset } from './datasets';
import { authHeaders } from './widgets/pcg_service';
import { setStatedColor } from './widgets/widget_utils';
import { useProofreadingBackendStore } from './store';

export const BUILD_DATASET = 'pinky_nf_v2';
const GRAPH_SERVER = 'https://minnie.microns-daf.com';
const GRAPH = `${GRAPH_SERVER}/segmentation/api/v1/table/${BUILD_DATASET}`;
export const SUGGESTION_LAYER = 'Hunt suggestion';
export const MY_SUGGESTIONS_LAYER = 'My suggestions';

export type BuildKind = 'merge' | 'cut';
/** A merge as the graph is sent it, [[sv, x, y, z], [sv, x, y, z]]; a cut {sources, sinks}; nm. */
export type BuildEdit = any[][] | { sources: any[][]; sinks: any[][] };
export interface GuardCell { id: number; status: string; dataset: string; root: string; protected: string[]; veil: string[]; helper: boolean; merges_each: number; cuts_each: number }
export interface MySuggestion { id: number; kind: BuildKind; at: number[]; note: string; status: string; t: string; edit: BuildEdit }
export interface MineCell { id: number; root: string; dataset: string; start: number[] | null; merges_each: number; cuts_each: number; used: { merge: number; cut: number }; suggestions: MySuggestion[] }

export const buildState = reactive({
  cells: [] as GuardCell[],
  mine: [] as MineCell[],
  /** The help box is open. */
  helping: false,
  /** The last word on a helper's edit, for the box. */
  last: '' as string,
  lastOk: true,
});

const viewer = (): any => (window as any)['viewer'];
const call = <T = any>(action: string, args: Record<string, any> = {}) => secureWrite<T>(action as any, args);
const isAdmin = (): boolean => { try { return !!useProofreadingBackendStore().isAdmin; } catch { return false; } };
export const onBuildDataset = (): boolean => canonicalDataset(currentDatasetTag()) === BUILD_DATASET;

// ── Loading ──────────────────────────────────────────────────────────────────

let guardAt = 0, mineAt = 0, timer: ReturnType<typeof setInterval> | null = null;
/**
 * The guard (on the Sandbox, every 2 minutes, and at most every 15 seconds when the layers change, as on a switch
 * to the Sandbox) and the helper's own cells (every 5 minutes). Cheap: a few small rows.
 */
export async function loadBuild(force = false, guardGap = 110_000) {
  const now = Date.now();
  const jobs: Promise<void>[] = [];
  if ((force || now - guardAt > guardGap) && onBuildDataset()) {
    guardAt = now;
    jobs.push(call<{ cells: GuardCell[] }>('build.guard').then(r => { buildState.cells = Array.isArray(r?.cells) ? r.cells : []; sweepVeil(); }).catch(() => { guardAt = 0; }));
  }
  if (force || now - mineAt > 290_000) {
    mineAt = now;
    jobs.push(call<{ cells: MineCell[] }>('build.mine').then(r => { buildState.mine = Array.isArray(r?.cells) ? r.cells : []; drawMySuggestions(); }).catch(() => { mineAt = 0; }));
  }
  await Promise.all(jobs);
}
export function startBuildWatch() {
  if (timer) return;
  void loadBuild(true);
  timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void loadBuild(); }, 30_000);
  installVeil();
}

// ── The guard ────────────────────────────────────────────────────────────────

const cellOf = (root: string): GuardCell | undefined => buildState.cells.find(c => c.protected.includes(String(root)));

/** A cell being built (or touched by a planting): no Watch it grow, no "update to the current ID". */
export function isBuildingCell(root: string): boolean {
  return onBuildDataset() && !!cellOf(root);
}

/**
 * Before a merge or cut is sent (hunt.ts huntEditGuard asks this first). An invited helper's edit (an admin's too) on
 * a cell taking suggestions is kept as a suggestion; other admins pass; anyone else's is refused. A sentence refuses, null lets it go.
 */
export function buildEditGuard(kind: 'merge' | 'split', roots: string[], edit?: BuildEdit): string | null {
  if (!onBuildDataset() || !buildState.cells.length) return null;
  const cell = roots.map(r => cellOf(r)).find(Boolean);
  if (!cell) return null;
  const did = kind === 'merge' ? 'merged' : 'cut';
  // An invited helper's edit is kept, admins included: while suggestions are open nobody changes the cell.
  if (cell.helper && cell.status === 'suggesting' && edit) {
    void keepSuggestion(cell, kind === 'merge' ? 'merge' : 'cut', edit);
    return `Saving it as a suggestion. Nothing was ${did}.`;
  }
  if (isAdmin()) return null;
  return `This cell is being made into a Hunt, so it stays as it is for now. Nothing was ${did}.`;
}

async function keepSuggestion(cell: GuardCell, kind: BuildKind, edit: BuildEdit) {
  const did = kind === 'merge' ? 'merged' : 'cut';
  try {
    const r = await call<{ used: { merge: number; cut: number }; of: { merge: number; cut: number } }>('build.suggest', { candidate_id: cell.id, kind, edit });
    buildState.last = `Saved as a suggestion (${kind} ${r.used[kind]} of ${r.of[kind]}). Nothing was ${did}. Thanks!`;
    buildState.lastOk = true;
    buildState.helping = true;
    mineAt = 0; void loadBuild();
  } catch (e: any) {
    buildState.last = `${e?.message || 'That suggestion was not saved.'} Nothing was ${did}.`;
    buildState.lastOk = false;
  }
  StatusMessage.showTemporaryMessage(buildState.last, 8000);
}

// ── The veil ─────────────────────────────────────────────────────────────────

let veilSaidAt = 0;
const watched = new WeakSet<object>();
function segGroups(): any[] {
  const out: any[] = [];
  for (const ml of viewer()?.layerManager?.managedLayers ?? []) {
    const g = ml?.layer?.displayState?.segmentationGroupState?.value;
    if (g?.visibleSegments) out.push(g);
  }
  return out;
}
/** Take every veiled ID back out of what is shown (players only, on the Sandbox). */
export function sweepVeil() {
  if (!onBuildDataset() || isAdmin()) return;
  const veil = new Set(buildState.cells.flatMap(c => c.veil));
  if (!veil.size) return;
  let hid = 0;
  for (const g of segGroups()) {
    // As strings first: a set's iterator may hand back one reused number.
    const out = new Set<string>();
    for (const id of g.visibleSegments) if (veil.has(String(id))) out.add(String(id));
    for (const id of g.selectedSegments ?? []) if (veil.has(String(id))) out.add(String(id));
    for (const s of out) {
      try { g.visibleSegments.delete(Uint64.parseString(s)); } catch { /* gone */ }
      try { g.selectedSegments?.delete(Uint64.parseString(s)); } catch { /* gone */ }
      hid++;
    }
  }
  if (hid && Date.now() - veilSaidAt > 6000) {
    veilSaidAt = Date.now();
    StatusMessage.showTemporaryMessage('This cell is being made into a Hunt, so it is hidden until the Hunt starts.', 6000);
  }
}
function watchGroups() {
  for (const g of segGroups()) {
    if (watched.has(g)) continue;
    watched.add(g);
    // After the change has settled: removing inside its own signal would fight the layer.
    g.visibleSegments.changed.add(() => { setTimeout(sweepVeil, 0); });
  }
}
let veilInstalled = false;
function installVeil() {
  if (veilInstalled) return;
  const v = viewer();
  if (!v?.layerManager?.layersChanged) { setTimeout(installVeil, 1000); return; }
  veilInstalled = true;
  v.layerManager.layersChanged.add(() => {
    watchGroups();
    if (onBuildDataset()) { void loadBuild(false, 15_000); setTimeout(sweepVeil, 0); }
  });
  watchGroups();
}

// ── The view ─────────────────────────────────────────────────────────────────

/** nm to the view's coordinates, every other dimension kept as it is. */
function toView(nm: number[]): number[] | null {
  const v = viewer();
  const cs = v?.coordinateSpace?.value;
  const names: string[] = cs?.names ?? [], scales = cs?.scales;
  const ix = ['x', 'y', 'z'].map(n => names.indexOf(n));
  if (!scales || ix.some(i => i < 0)) return null;
  const p = Array.from<number>(v.navigationState?.position?.value ?? new Float32Array(names.length));
  ix.forEach((i, k) => { p[i] = Number(nm[k]) / (Number(scales[i]) * 1e9); });
  return p;
}
function removeLayer(name: string) {
  const v = viewer();
  const ml = v?.layerManager?.getLayerByName?.(name);
  if (ml) { try { v.layerManager.removeManagedLayer(ml); } catch { /* gone */ } }
}
const RED = '#ff5a6e', BLUE = '#5aaaff', GOLD = '#f5d142';
function pointsOf(kind: BuildKind, edit: BuildEdit, tag = ''): any[] {
  const pts: any[] = [];
  const add = (p: any[], color: string, k: number, side: string) => {
    const at = toView(p.slice(1, 4));
    if (at) pts.push({ type: 'point', id: `${tag}${side}${k}`, point: at, props: [color] });
  };
  if (kind === 'merge') (edit as any[][]).forEach((p, k) => add(p, GOLD, k, 'm'));
  else {
    ((edit as any).sources || []).forEach((p: any[], k: number) => add(p, RED, k, 'r'));
    ((edit as any).sinks || []).forEach((p: any[], k: number) => add(p, BLUE, k, 'b'));
  }
  return pts;
}
function drawPoints(name: string, annotations: any[]) {
  const v = viewer();
  if (!v?.layerSpecification) return;
  removeLayer(name);
  if (!annotations.length) return;
  v.layerSpecification.add(makeLayer(v.layerSpecification, name, {
    type: 'annotation', source: { url: 'local://annotations' }, annotations, pointSize: 6, onTop: true,
    annotationProperties: [{ id: 'color', type: 'rgb', default: GOLD }],
    shader: 'void main() { setColor(prop_color()); setPointMarkerSize(8.0); }',
  }));
}
/** The helper's own suggestions on screen, in a layer only they have. */
export function drawMySuggestions() {
  if (!onBuildDataset()) return;
  const open = buildState.mine.flatMap(c => c.suggestions.filter(s => s.status === 'open'));
  if (!open.length) { removeLayer(MY_SUGGESTIONS_LAYER); return; }
  drawPoints(MY_SUGGESTIONS_LAYER, open.flatMap(s => pointsOf(s.kind, s.edit, `s${s.id}-`)));
}
export function goToNm(nm: number[]) {
  const p = toView(nm);
  if (p) { try { viewer().navigationState.position.value = Float32Array.from(p); } catch { /* no viewer */ } }
}

async function toSandbox(): Promise<void> {
  if (onBuildDataset()) return;
  const ds = findDatasetByCanonical(BUILD_DATASET);
  if (!ds || !(await switchToDataset(ds, { forJump: true }))) throw new Error('Could not switch to the Sandbox.');
  for (let i = 0; i < 40 && !onBuildDataset(); i++) await new Promise(r => setTimeout(r, 250));
  await new Promise(r => setTimeout(r, 900));
}
/** Show these IDs alone in the Sandbox's segmentation layer, colored, at a place (view voxels) if given. */
async function showOnly(ids: string[], at?: number[] | null, colors: Record<string, string> = {}) {
  await toSandbox();
  const ds = findDatasetByCanonical(BUILD_DATASET);
  const name = ds ? segLayerName(ds) : '';
  const ml = viewer()?.layerManager?.getLayerByName?.(name);
  const layer = ml?.layer;
  const g = layer?.displayState?.segmentationGroupState?.value;
  if (!g) throw new Error('The Sandbox is not ready yet. Try again in a moment.');
  g.visibleSegments.clear();
  try { g.selectedSegments?.clear(); } catch { /* older layer */ }
  const stated = layer.displayState.segmentationColorGroupState?.value?.segmentStatedColors;
  for (const id of ids) {
    const seg = Uint64.parseString(id);
    const hex = colors[id];
    if (hex && stated) {
      const n = parseInt(hex.slice(1), 16);
      try { setStatedColor(stated, seg, ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16)); } catch { /* default color */ }
    }
    try { g.selectedSegments?.add(seg); } catch { /* older layer */ }
    g.visibleSegments.add(seg);
  }
  if (at?.length) { try { viewer().navigationState.position.value = Float32Array.from(at.slice(0, 3)); } catch { /* no viewer */ } }
}
/** A helper opens their cell. */
export async function openBuildCell(c: { root: string; start: number[] | null }) {
  await showOnly([c.root], c.start);
  setTimeout(drawMySuggestions, 1200);
}

// ── The graph, from the admin's browser ──────────────────────────────────────

async function graph(path: string, body?: any): Promise<any> {
  const res = await fetch(`${GRAPH}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: authHeaders(GRAPH_SERVER), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text.replace(/:\s*(\d{16,})/g, ':"$1"').replace(/([[,]\s*)(\d{16,})(?=\s*[,\]])/g, '$1"$2"')); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`The graph said no (${res.status})${json?.message ? `: ${String(json.message).slice(0, 200)}` : ''}.`);
  return json;
}
const svsOf = (kind: BuildKind, edit: BuildEdit): string[] => (kind === 'merge' ? (edit as any[][]) : [...(edit as any).sources, ...(edit as any).sinks]).map((p: any[]) => String(p[0]));
async function rootsOf(svs: string[]): Promise<string[]> {
  const r = await graph('/roots?int64_as_str=1', { node_ids: svs });
  return (r?.root_ids ?? []).map(String);
}
/** The cell's ID after an edit: the root of its soma's supervoxel when known, else the biggest of the new roots. */
async function cellRootAfter(newRoots: string[], anchorSv: string | null): Promise<string> {
  if (anchorSv) {
    try { const r = await graph(`/node/${anchorSv}/root?int64_as_str=1`); if (r?.root_id) return String(r.root_id); } catch { /* by size below */ }
  }
  if (newRoots.length <= 1) return newRoots[0] || '';
  let best = newRoots[0], most = -1;
  for (const r of newRoots.slice(0, 4)) {
    try { const n = ((await graph(`/node/${r}/leaves?stop_layer=2&int64_as_str=1`))?.leaf_ids ?? []).length; if (n > most) { most = n; best = r; } } catch { /* skip */ }
  }
  return best;
}

export interface QueueSuggestion { id: number; kind: BuildKind; edit: BuildEdit; at: number[]; note: string; status: string; t: string; name: string; admin_note: string; done_by: string; done_at: string | null; operation_id: number | null }
export interface QueueCell { id: number; root: string; status: string; dataset: string; start: number[] | null; anchor_sv: string | null; protected: string[] }

/** Show a suggestion: the cell, and for a merge the piece it would join (violet), with the helper's points. */
export async function showSuggestion(cell: QueueCell, s: QueueSuggestion): Promise<{ pieceL2: number | null }> {
  let other: string | null = null, pieceL2: number | null = null;
  if (s.kind === 'merge') {
    try {
      const roots = await rootsOf(svsOf('merge', s.edit));
      other = roots.find(r => r !== cell.root) ?? null;
      if (other) pieceL2 = ((await graph(`/node/${other}/leaves?stop_layer=2&int64_as_str=1`))?.leaf_ids ?? []).length;
    } catch { /* the cell alone */ }
  }
  await showOnly(other ? [cell.root, other] : [cell.root], null, other ? { [cell.root]: BLUE, [other]: '#9b5cff' } : { [cell.root]: BLUE });
  goToNm(s.at);
  setTimeout(() => drawPoints(SUGGESTION_LAYER, pointsOf(s.kind, s.edit, 'q-')), 600);
  return { pieceL2 };
}
export function hideSuggestion() { removeLayer(SUGGESTION_LAYER); }

/** What a cut would take off, before anything changes: the supervoxels on each side. */
export async function previewCut(edit: BuildEdit): Promise<{ sides: number[]; illegal: boolean }> {
  const r = await graph('/graph/split_preview?int64_as_str=1', { sources: (edit as any).sources, sinks: (edit as any).sinks });
  const comps: any[][] = r?.supervoxel_connected_components ?? [];
  return { sides: comps.map(c => (Array.isArray(c) ? c.length : 0)), illegal: !!r?.illegal_split };
}

/** Plant it: the stored edit, sent as it is, then the server told what it made. */
export async function plantSuggestion(cell: QueueCell, s: QueueSuggestion, note = '') {
  const svs = svsOf(s.kind, s.edit);
  const before = await rootsOf(svs);
  const r = await graph(s.kind === 'merge' ? '/merge?int64_as_str=1' : '/split?int64_as_str=1', s.edit);
  const made: string[] = (r?.new_root_ids ?? []).map(String);
  const op = r?.operation_id != null ? String(r.operation_id) : '';
  if (!op) throw new Error('The graph made the edit but did not say its number. Check the cell before going on.');
  const cellRoot = s.kind === 'merge' ? (made[0] || '') : await cellRootAfter(made, cell.anchor_sv);
  return call('build.plant', { id: s.id, operation_id: op, before_roots: before, new_roots: made, cell_root: cellRoot, note });
}
/** Undo a planting in the graph, then on the server. */
export async function undoPlanting(cell: QueueCell, s: QueueSuggestion) {
  if (!s.operation_id) throw new Error('This planting has no operation to undo.');
  const r = await graph('/undo?int64_as_str=1', { operation_id: Number(s.operation_id) });
  const made: string[] = (r?.new_root_ids ?? []).map(String);
  return call('build.undo', { id: s.id, new_roots: made, cell_root: await cellRootAfter(made, cell.anchor_sv) });
}
/** Put it back: every planting undone in the graph, newest first, then the cell closed. Says how many failed. */
export async function putBack(cellId: number, anchorSv: string | null, step: (s: string) => void = () => {}) {
  const first = await call<{ cell: { root: string }; operations: number[] }>('build.put_back', { id: cellId });
  const undone: number[] = [];
  let made: string[] = [], failed = 0;
  for (const [i, op] of first.operations.entries()) {
    step(`Undoing planting ${i + 1} of ${first.operations.length}`);
    try { const r = await graph('/undo?int64_as_str=1', { operation_id: op }); made = (r?.new_root_ids ?? []).map(String); undone.push(op); }
    catch { failed++; }
  }
  const cellRoot = undone.length ? await cellRootAfter(made, anchorSv) : first.cell.root;
  const out = await call('build.put_back', { id: cellId, done: true, undone, cell_root: cellRoot });
  return { ...out, failed };
}
