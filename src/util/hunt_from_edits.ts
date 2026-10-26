/**
 * Make a Hunt from a proofread cell (Ames 2026-10-26, docs/HUNT-FROM-EDITS.md).
 * Admin Hub > Hunts pastes a proofread cell; this asks the chunked graph for
 * the cell's own edits, offers each editing session as the moment players
 * start from, and puts the cell as it was then on screen with every place
 * marked as a point in a Mergers and an Extensions layer. The editor then
 * reads those layers as it reads any key (HuntsAdminTab.vue), so nothing new
 * is saved and the server's key stays [x, y, z, 'cut' | 'merge'] in nm.
 *
 * Everything is asked from the admin's own browser with their CAVE sign in,
 * like Watch it grow (cell_history.ts). Rules: hunt_history_steps.ts.
 */
import { reactive, markRaw } from 'vue';
import { makeLayer } from 'neuroglancer/layer';
import { authHeaders } from '../widgets/pcg_service';
import { canonicalDataset, currentDatasetTag, findDatasetBySegName, segLayerName, switchToDataset } from '../datasets';
import { snapshotDisplay, restoreDisplayAfterLoad, keepDisplayEnabled } from './keep_display';
import { HUNT_PREVIEW_LAYER } from '../hunt';
import {
  parseBigJson, parseHistory, parseDetails, cellEdits, sessionStarts, sessionSupervoxels, visibleIn, placesFor,
  type CellEdit, type Place, type Dropped,
} from './hunt_history_steps';

/** Where a dataset's proofread cells are listed (with a soma supervoxel each) and which graph has their history. */
export interface HistorySource {
  canon: string; label: string; server: string;
  /** The graph table asked for the history and shown to players: any past root loads there. */
  table: string; segLayer: string;
  /** The proofread list: a CAVE table with pt_root_id, pt_supervoxel_id, pt_position. */
  datastack: string; somaTable: string;
}
export const HISTORY_SOURCES: HistorySource[] = [
  // MICrONS Live, not the v117 card: a cell as it was after June 2021 is "not valid" on v117 (401).
  { canon: 'minnie65_public', label: 'MICrONS public', server: 'https://minnie.microns-daf.com', table: 'minnie65_public', segLayer: 'minnie65_public_live',
    datastack: 'minnie65_public', somaTable: 'proofreading_status_and_strategy' },
  { canon: 'pinky_nf_v2', label: 'Sandbox', server: 'https://minnie.microns-daf.com', table: 'pinky_nf_v2', segLayer: 'pinky_nf_v2',
    datastack: 'pinky_sandbox', somaTable: 'neurons' },
];
export const sourceFor = (canon: string) => HISTORY_SOURCES.find(s => s.canon === canonicalDataset(canon)) ?? null;

export interface SessionOption {
  at: number;
  /** The cell as it was when the session began: what players see. */
  beforeRoot: string;
  editsAfter: number;
  places: Place[];
  dropped: Dropped;
}
export interface CellHistory {
  source: HistorySource;
  root: string;
  /** The proofread list's words for the cell, e.g. "dendrite extended, axon partially extended". */
  status: string;
  somaNm: number[];
  totalEdits: number;
  cellEdits: number;
  reaches: boolean;
  sessions: SessionOption[];
  /** The session with the most places (up to 60), picked at first. */
  best: number;
}

const MAX_PLACES_PICKED = 60;

/**
 * What the admin is making, kept outside the Admin Hub: the hub closes to look at the viewer (the profile
 * covers it), and the box over the viewer (HuntPlacesBox.vue) and the editor show the same cell and places.
 */
export const fromEdits = reactive({
  dataset: '',
  root: '',
  history: null as CellHistory | null,
  pick: -1,
  finished: false,
  /** The place last gone to, by its point id. */
  selected: '',
  /** The places box over the viewer is open. */
  checking: false,
  /** The Hunt editor as it was when the admin went to check; HuntsAdminTab.vue puts it back. */
  editor: null as any,
});
export function keepHistory(h: CellHistory | null) { fromEdits.history = h ? markRaw(h) : null; }
/** The editor is done with it (closed, or another Hunt opened): forget the cell and take the finished cell away. */
export function forgetFromEdits() {
  keepHistory(null);
  Object.assign(fromEdits, { pick: -1, selected: '', finished: false, checking: false, editor: null });
  setFinishedCell(null, false);
}
export const pickedSession = (): SessionOption | null => (fromEdits.history && fromEdits.pick >= 0 ? fromEdits.history.sessions[fromEdits.pick] ?? null : null);
const viewer = (): any => (window as any)['viewer'];

async function ask(url: string, init: RequestInit = {}, server = 'https://minnie.microns-daf.com'): Promise<any> {
  const res = await fetch(url, { ...init, headers: { ...authHeaders(server), ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) {
    let msg = '';
    try { msg = String(JSON.parse(text)?.message || ''); } catch { /* not JSON */ }
    const e: any = new Error(`${res.status}${msg ? `: ${msg.slice(0, 160)}` : ''}`);
    e.status = res.status;
    throw e;
  }
  return parseBigJson(text);
}

/** A few at a time, in order. */
async function inTurn<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await f(items[i]); }
  }));
  return out;
}

/** The cell's row in the proofread list: its soma, and what the list says about it. Live first, then the latest snapshot. */
async function somaRow(src: HistorySource, root: string): Promise<any | null> {
  const base = `${src.server}/materialize/api/v3/datastack/${src.datastack}`;
  const body = (live: boolean) => `{${live ? `"table":"${src.somaTable}","timestamp":"${new Date().toISOString()}",` : ''}"filter_in_dict":{"${src.somaTable}":{"pt_root_id":[${root}]}},"desired_resolution":[1,1,1]}`;
  try {
    const rows = await ask(`${base}/query?return_pyarrow=false`, { method: 'POST', body: body(true) }, src.server);
    if (Array.isArray(rows) && rows.length) return rows[0];
  } catch { /* the snapshot below */ }
  try {
    const versions = await ask(`${base}/versions`, {}, src.server);
    const v = Math.max(...(Array.isArray(versions) ? versions.map(Number).filter(Number.isFinite) : []));
    if (!Number.isFinite(v)) return null;
    const rows = await ask(`${base}/version/${v}/table/${src.somaTable}/query?return_pyarrow=false`, { method: 'POST', body: body(false) }, src.server);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch { return null; }
}

const words = (s: unknown) => String(s ?? '').replace(/_/g, ' ').trim();
function statusLine(row: any): string {
  if (row?.strategy_dendrite != null || row?.strategy_axon != null) {
    const d = words(row.strategy_dendrite), a = words(row.strategy_axon);
    return [d && d !== 'none' ? d : 'dendrite not proofread', a && a !== 'none' ? a : 'axon not proofread'].join(', ');
  }
  return row?.cell_type ? `cell type ${row.cell_type}` : '';
}

/**
 * Everything the panel shows for one cell: its sessions, and for each the places a player can find from there.
 * step(text) says what is being asked, for a loading line.
 */
export async function readCellHistory(canon: string, rootIn: string, tolNm: number, step: (s: string) => void = () => {}): Promise<CellHistory> {
  const src = sourceFor(canon);
  if (!src) throw new Error('This works on MICrONS public and the Sandbox, where proofread cells are listed.');
  const root = rootIn.trim();
  if (!/^\d{15,20}$/.test(root)) throw new Error('Paste a cell ID (a long number).');
  const seg = `${src.server}/segmentation/api/v1/table/${src.table}`;

  step('Finding the cell in the proofread list');
  const row = await somaRow(src, root);
  const sv = row?.pt_supervoxel_id != null ? String(row.pt_supervoxel_id) : '';
  const somaNm = ['x', 'y', 'z'].map(a => Number(row?.[`pt_position_${a}`]));
  if (!/^\d+$/.test(sv) || !somaNm.every(Number.isFinite)) {
    throw new Error(`This cell is not in ${src.label}'s proofread list (${src.somaTable}), so its soma is not known. Paste the ID the list has for it.`);
  }

  step('Reading the graph');
  const info = await ask(`${src.server}/segmentation/table/${src.table}/info`, {}, src.server);
  const res: number[] = info?.scales?.[0]?.resolution;
  if (!Array.isArray(res) || res.length < 3) throw new Error('The graph did not say its voxel size.');

  step('Reading every edit in the cell\'s history');
  let history;
  try { history = await ask(`${seg}/root/${root}/tabular_change_log?filtered=false`, {}, src.server); }
  catch (e: any) { throw new Error(e?.status >= 400 && e?.status < 600 ? `The graph has no history for that ID on ${src.label} (${e.message}).` : String(e?.message || e)); }
  const ops = parseHistory(history, root);
  if (!ops.length) throw new Error('This cell was never edited, so there is nothing to hunt for.');

  step(`Reading the details of ${ops.length} edits`);
  const batches: number[][] = [];
  for (let i = 0; i < ops.length; i += 200) batches.push(ops.slice(i, i + 200).map(o => o.id));
  const parts = await inTurn(batches, 3, b => ask(`${seg}/operation_details?int64_as_str=1&operation_ids=${encodeURIComponent(JSON.stringify(b))}`, {}, src.server));
  const details = parseDetails(Object.assign({}, ...parts));

  step('Finding the cell before its first edit');
  const t0 = ops[0].at;
  const start = String((await ask(`${seg}/node/${sv}/root?int64_as_str=1&timestamp=${(t0 - 1000) / 1000}`, {}, src.server))?.root_id ?? '');
  if (!/^\d+$/.test(start)) throw new Error('The graph did not say where the cell began.');
  const { edits, reaches } = cellEdits(ops, details, start, root, res);
  if (!edits.length) throw new Error('None of the edits changed the cell itself.');

  // What each session's players could see: one lookup of the edits' supervoxels as they were then.
  const starts = sessionStarts(edits);
  step(`Checking what players would see, ${starts.length} ${starts.length === 1 ? 'start' : 'starts'}`);
  const seen = await inTurn(starts, 3, async (i) => {
    const R = edits[i].prev, at = edits[i].op.at;
    const svs = sessionSupervoxels(edits, i);
    const rootOf = new Map<string, string>();
    for (let k = 0; k < svs.length; k += 1000) {
      const chunk = svs.slice(k, k + 1000);
      const r = await ask(`${seg}/roots?int64_as_str=1&timestamp=${(at - 1000) / 1000}`, { method: 'POST', body: `{"node_ids":[${chunk.join(',')}]}` }, src.server);
      const got: string[] = (r?.root_ids ?? []).map(String);
      chunk.forEach((s, j) => { if (got[j]) rootOf.set(s, got[j]); });
    }
    return new Set(edits.slice(i).filter(e => visibleIn(e, rootOf, R)).map(e => e.op.id));
  });

  // The size of each piece joined or cut off, only for edits some start can show.
  const needSize = [...new Set(seen.flatMap(s => [...s]))];
  const byOp = new Map(edits.map(e => [e.op.id, e] as [number, CellEdit]));
  step(`Measuring ${needSize.length} pieces`);
  const pieceL2 = new Map<number, number>();
  await inTurn(needSize, 6, async (id) => {
    const e = byOp.get(id);
    if (!e?.piece.length) return;
    let n = 0;
    for (const r of e.piece.slice(0, 3)) {
      try { n += ((await ask(`${seg}/node/${r}/leaves?stop_layer=2`, {}, src.server))?.leaf_ids ?? []).length; }
      catch { return; }   // unknown size: kept
    }
    pieceL2.set(id, n);
  });

  const sessions: SessionOption[] = starts.map((i, k) => {
    const { places, dropped } = placesFor(edits, i, seen[k], pieceL2, tolNm);
    return { at: edits[i].op.at, beforeRoot: edits[i].prev, editsAfter: edits.length - i, places, dropped };
  });
  let best = 0;
  sessions.forEach((s, k) => {
    const n = Math.min(s.places.length, MAX_PLACES_PICKED), b = Math.min(sessions[best].places.length, MAX_PLACES_PICKED);
    if (n > b) best = k;
  });
  return { source: src, root, status: statusLine(row), somaNm, totalEdits: ops.length, cellEdits: edits.length, reaches, sessions, best };
}

// ── On screen ──────────────────────────────────────────────────────────────

export const MERGERS_LAYER = 'Mergers';
export const EXTENSIONS_LAYER = 'Extensions';
const PLACE_COLOR = { cut: '#f5d142', merge: '#9b5cff' };   // the gems' own found colors (hunt.ts FOUND_COLOR)
export const placeId = (p: Place) => `place-${p.op}`;

function nmToVoxels(dims: Record<string, any>): (nm: number[]) => number[] {
  const axes = Object.keys(dims || {});
  return (nm: number[]) => axes.map(a => { const k = ['x', 'y', 'z'].indexOf(a); return k < 0 ? 0 : nm[k] / (Number(dims[a][0]) * 1e9); });
}

/**
 * Put the cell as it was at a session's start on screen, with its places as points (numbered as the list
 * numbers them), the crosshair on the soma. Switches dataset first when another one is open.
 */
export async function showSession(h: CellHistory, s: SessionOption): Promise<void> {
  const want = findDatasetBySegName(h.source.segLayer);
  if (!want) throw new Error('This version of Pyr does not have that dataset. Reload the page to update.');
  if (canonicalDataset(currentDatasetTag()) !== h.source.canon) {
    const ok = await switchToDataset(want, { forJump: true });
    if (!ok) throw new Error('Could not switch dataset.');
    for (let i = 0; i < 40 && canonicalDataset(currentDatasetTag()) !== h.source.canon; i++) await new Promise(r => setTimeout(r, 250));
    for (let i = 0; i < 40 && !viewer()?.state; i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 800));
  }
  const v = viewer();
  const state = v?.state?.toJSON?.();
  if (!state?.dimensions) throw new Error('The viewer is not ready yet. Try again in a moment.');
  const segSpec: any = want.layers.find((l: any) => l.type === 'segmentation');
  const cur: any = (state.layers ?? []).find((l: any) => l?.type === 'segmentation' && l.name !== HUNT_PREVIEW_LAYER) ?? {};
  const keep = ['tab', 'objectAlpha', 'selectedAlpha', 'notSelectedAlpha', 'meshSilhouetteRendering', 'colorSeed', 'segmentDefaultColor'];
  const segLayer: any = { type: 'segmentation', name: segLayerName(want), source: segSpec.source, segments: [s.beforeRoot] };
  for (const k of keep) if (cur[k] !== undefined) segLayer[k] = cur[k];
  const toVox = nmToVoxels(state.dimensions);
  const layers = [...(state.layers ?? []).filter((l: any) => l?.type === 'image'), segLayer];
  const next = { ...state, layers, position: toVox(h.somaNm) };
  delete next.selectedLayer; delete next.selection;
  const snap = keepDisplayEnabled() ? snapshotDisplay() : null;
  v.state.restoreState(next);
  restoreDisplayAfterLoad(snap);
  // The points go on once the view has settled: a layer added with the restore, or too soon after it, comes
  // back empty or not at all (hunt.ts openHunt adds its gem layers the same way).
  const numbered = s.places.map((p, i) => ({ p, n: i + 1 }));
  const kinds: [string, 'cut' | 'merge'][] = ([[MERGERS_LAYER, 'cut'], [EXTENSIONS_LAYER, 'merge']] as [string, 'cut' | 'merge'][])
    .filter(([, k]) => s.places.some(p => p.kind === k));
  const add = () => {
    for (const [name, kind] of kinds) {
      if (managed(name)) continue;
      const ml = makeLayer(v.layerSpecification, name, {
        // Size 1, the normal point (Ames 2026-10-26: at 6 the gems hid the cell); the layer's Size slider changes it.
        type: 'annotation', source: { url: 'local://annotations' }, tool: 'annotatePoint', annotationColor: PLACE_COLOR[kind], pointSize: 1, onTop: true,
        annotations: numbered.filter(x => x.p.kind === kind).map(x => ({ type: 'point', id: placeId(x.p), point: toVox(x.p.nm), description: String(x.n) })),
      });
      v.layerSpecification.add(ml);
    }
  };
  let steady = 0;
  for (let i = 0; i < 20 && steady < 3; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (kinds.every(([name]) => (managed(name)?.layer?.localAnnotations?.toJSON?.() ?? []).length)) { steady++; continue; }
    steady = 0;
    for (const [name] of kinds) {
      const ml = managed(name);
      if (ml && !(ml.layer?.localAnnotations?.toJSON?.() ?? []).length) { try { v.layerManager.removeManagedLayer(ml); } catch { /* gone */ } }
    }
    add();
  }
}

/** The soma as the coordinate bar shows it (the view's voxels), for "Where players start". */
export function somaVoxels(h: CellHistory): number[] | null {
  const dims = viewer()?.state?.toJSON?.()?.dimensions;
  return dims ? nmToVoxels(dims)(h.somaNm).slice(0, 3).map(v => Math.round(v)) : null;
}

/** A place layer's points as they are on screen now (the admin may have moved, removed or added some). */
export function placesOnScreen(): { id: string; kind: 'cut' | 'merge'; at: number[] }[] {
  const out: { id: string; kind: 'cut' | 'merge'; at: number[] }[] = [];
  try {
    for (const l of viewer()?.state?.toJSON?.()?.layers ?? []) {
      const kind = l?.type !== 'annotation' ? null : l.name === MERGERS_LAYER ? 'cut' : l.name === EXTENSIONS_LAYER ? 'merge' : null;
      if (!kind) continue;
      for (const a of Array.isArray(l.annotations) ? l.annotations : []) {
        if (a?.type === 'point' && Array.isArray(a.point)) out.push({ id: String(a.id), kind, at: a.point.slice(0, 3).map((x: number) => Math.round(Number(x))) });
      }
    }
  } catch { /* nothing on screen */ }
  return out;
}

export interface PlaceRow { id: string; kind: 'cut' | 'merge'; at: number[]; n: number | null; place: Place | null }
/** The places on screen now, numbered as the list numbers them; points the admin added come last, unnumbered. */
export function placeRows(): PlaceRow[] {
  const meta = new Map<string, { n: number; place: Place }>();
  (pickedSession()?.places ?? []).forEach((p, i) => meta.set(placeId(p), { n: i + 1, place: p }));
  return placesOnScreen().map(r => ({ ...r, n: meta.get(r.id)?.n ?? null, place: meta.get(r.id)?.place ?? null }))
    .sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9));
}
/** Go to the next (1) or previous (-1) place in the list. */
export function stepPlace(dir: 1 | -1) {
  const rows = placeRows();
  if (!rows.length) return;
  const i = rows.findIndex(r => r.id === fromEdits.selected);
  const r = rows[i < 0 ? (dir > 0 ? 0 : rows.length - 1) : (i + dir + rows.length) % rows.length];
  fromEdits.selected = r.id;
  goToPlace(r.at);
}

function managed(name: string): any {
  return (viewer()?.layerManager?.managedLayers ?? []).find((ml: any) => ml.name === name && !ml.archived) ?? null;
}

/** Take one place off the screen (its layer reads again, so the key loses it too). */
export function removePlace(kind: 'cut' | 'merge', id: string) {
  const src = managed(kind === 'cut' ? MERGERS_LAYER : EXTENSIONS_LAYER)?.layer?.localAnnotations;
  if (!src) return;
  const ref = src.getReference(id);
  try { src.delete(ref); } finally { ref.dispose(); }
}

/** Move the view to a place. */
export function goToPlace(at: number[]) {
  try {
    const v = viewer();
    const p = Array.from<number>(v.navigationState.position.value);
    at.slice(0, 3).forEach((x, k) => { p[k] = x; });
    v.navigationState.position.value = Float32Array.from(p);
  } catch { /* no viewer */ }
}

/**
 * The finished cell, faint and white over the old one: meshes only, never in 2D or editable, and named so
 * the editor leaves it out of the cells and the view it saves (hunt.ts HUNT_PREVIEW_LAYER).
 */
export function setFinishedCell(h: CellHistory | null, on: boolean) {
  const v = viewer();
  const old = managed(HUNT_PREVIEW_LAYER);
  if (old) { try { v.layerManager.removeManagedLayer(old); } catch { /* already gone */ } }
  if (!on || !h || !v?.layerSpecification) return;
  const spec: any = findDatasetBySegName(h.source.segLayer)?.layers.find((l: any) => l.type === 'segmentation');
  let src: any = spec?.source;
  if (typeof src === 'string') src = { url: src };
  if (!src?.url) return;
  const ml = makeLayer(v.layerSpecification, HUNT_PREVIEW_LAYER, {
    type: 'segmentation', source: { url: src.url, enableDefaultSubsources: false, subsources: { mesh: true } },
    segments: [h.root], objectAlpha: 0.3, segmentDefaultColor: '#ffffff', hideSegmentZero: true, pick: false,
  });
  v.layerSpecification.add(ml);
}
