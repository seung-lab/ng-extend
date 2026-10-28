/**
 * Highlight mode, stage 1 (docs/highlight-mode-spec.md): mark a stretch of a
 * cell as checked. Two picks on the cell, the path between them (the same
 * server call Find Path makes), kept as a thick stroke of polylines in a
 * "Checked" style layer (stroke_shape.ts keeps them small). The strokes are ordinary annotations, so they save
 * with the view (Save view, autosave, shared links) and survive edits.
 */
import { ref } from 'vue';
import { makeLayer } from 'neuroglancer/layer';
import { SegmentationUserLayer } from 'neuroglancer/segmentation_user_layer';
import { ngeGrapheneSelectionUnderMouse, ngeGrapheneFindPath, ngeGrapheneBranchGraph, ngeGraphenePieceOf, SegmentSelection } from 'neuroglancer/datasource/graphene/frontend';
import { branchSegments, nearestPiece, piecesBeyond, edgeEnds, type BranchGraph, type BranchWay } from './branch_tree';
import { MEC_KINDS, MEC_AIS, MEC_EDGE, MEC_SOMA, startXyz, isMec, meshEdgeSpots, maskEdgeSpots, cellMeshLoad, dataBoundsNm, AXON_LAYER, mecKindOfLayer, mecLayers, segBoundsNm, EDGE_NM, type MecKind } from './mec_marks';
import { currentSegLayer, currentSegLayerName, findDatasetBySegName, findDatasetByCanonical, canonicalDataset } from '../datasets';
import { useUserPreferencesStore, useProofreadingBackendStore } from '../store';
import { setNgeMeshTint, type NgeMeshTint } from 'neuroglancer/mesh/nge_tint';
import { mat4 } from 'neuroglancer/util/geom';
import { isTouchRef } from './mobile';
import { viewToLayer, layerToView } from './annotation_coords';
import { StatusMessage } from 'neuroglancer/status';
import { strokeRuns } from './stroke_shape';

export interface HighlightStyle {
  key: string; label: string; layer: string; color: string;
  /** One of the lab's MEC marks (mec_marks.ts): a point in the lab's own
   *  layer, placed with one click, not a stretch. */
  lab?: boolean;
}
/** The MEC marks as styles, for the panel's chips. */
export const mecStyles = (): HighlightStyle[] => MEC_KINDS.map(k => ({ key: k.key, label: k.label, layer: k.layer, color: k.color, lab: true }));
export const DEFAULT_HIGHLIGHT_STYLES: HighlightStyle[] = [
  { key: 'checked', label: 'Checked', layer: 'Checked ✓', color: '#3dff9a' },
  { key: 'look', label: 'Needs a look', layer: 'Needs a look', color: '#ffd24d' },
  { key: 'problem', label: 'Problem', layer: 'Problem', color: '#ff5d73' },
];
export const MAX_HIGHLIGHT_STYLES = 8;
const HEX = /^#[0-9a-f]{6}$/i;

/** The player's colours (Ames 2026-10-02): the three built in ones, in any
 *  colour they chose, plus the ones they added. Saved in their preferences,
 *  so they follow the account. A built in colour keeps its layer name; an
 *  added one's layer is named after it. */
export function highlightStyles(): HighlightStyle[] {
  let saved: { key: string; label: string; color: string }[] = [];
  try { saved = useUserPreferencesStore().prefs.highlightStyles ?? []; } catch { /* store not ready */ }
  if (!Array.isArray(saved)) saved = [];
  const colorOf = (key: string, fallback: string) => {
    const c = saved.find(s => s?.key === key)?.color;
    return c && HEX.test(c) ? c.toLowerCase() : fallback;
  };
  const out = DEFAULT_HIGHLIGHT_STYLES.map(d => ({ ...d, color: colorOf(d.key, d.color) }));
  // A tutorial can show Checked in its own color for a while, never saved
  // (tutorial-2.ts sets it: pink against the blue cell, Ames 2026-10-19).
  const shown = (window as any).__ngeCheckedColor;
  if (typeof shown === 'string' && HEX.test(shown)) out[0] = { ...out[0], color: shown };
  for (const s of saved) {
    if (out.length >= MAX_HIGHLIGHT_STYLES) break;
    if (!s || typeof s.key !== 'string' || !s.key.startsWith('c_')) continue;
    const label = String(s.label || '').trim().slice(0, 24);
    if (!label || !HEX.test(s.color) || out.some(o => o.key === s.key || o.layer === label)) continue;
    out.push({ key: s.key, label, layer: label, color: s.color.toLowerCase() });
  }
  return out;
}
export function saveHighlightStyles(styles: HighlightStyle[]) {
  // The tutorial's Checked color is never saved: keep the player's own.
  const shown = (window as any).__ngeCheckedColor;
  let mineChecked: string | undefined;
  try { mineChecked = (useUserPreferencesStore().prefs.highlightStyles ?? []).find((s: any) => s?.key === 'checked')?.color; } catch { /* none */ }
  const list = styles.map(({ key, label, color }) => ({ key, label, color }))
    .map(s => (shown && s.key === 'checked' && s.color === shown) ? { ...s, color: mineChecked ?? DEFAULT_HIGHLIGHT_STYLES[0].color } : s);
  useUserPreferencesStore().save({ highlightStyles: list });
}
/** Recolour a style's existing marks too: its layer takes the new colour and
 *  the tint follows. */
export function applyStyleColor(style: HighlightStyle) {
  try { managedLayer(style.layer)?.layer?.annotationDisplayState?.color?.restoreState(style.color); } catch { /* layer not loaded */ }
  scheduleTint();
}
/** A name an added colour may not take: its layer would collide. */
export function highlightNameTaken(label: string, styles: HighlightStyle[]): boolean {
  const n = label.trim().toLowerCase();
  return !n || n === START_LAYER.toLowerCase()
    || styles.some(s => s.label.toLowerCase() === n || s.layer.toLowerCase() === n)
    || !!managedLayer(label.trim());
}

/** The highlight layers in the view, each with the style it is drawn in.
 *  Found by what they hold (hl_ strokes), not by this player's colour list,
 *  so a shared view's marks show in the colours they were made with. */
function highlightLayers(): { managed: any; src: any; style: HighlightStyle }[] {
  const styles = highlightStyles();
  const out: { managed: any; src: any; style: HighlightStyle }[] = [];
  for (const managed of viewerOf()?.layerManager?.managedLayers ?? []) {
    if (managed.archived || managed.name === START_LAYER) continue;
    const src = managed.layer?.localAnnotations;
    if (!src) continue;
    // The lab's MEC layers, however the player's copy spells them.
    const kind = mecKindOfLayer(managed.name);
    if (kind) {
      out.push({ managed, src, style: { key: kind.key, label: kind.label, layer: managed.name, color: kind.color, lab: true } });
      continue;
    }
    const mine = styles.find(s => s.layer === managed.name);
    let holds = false;
    for (const ann of src) { if (String(ann.id).startsWith(ID_PREFIX)) { holds = true; } break; }
    if (!mine && !holds) continue;
    let color = mine?.color ?? '#3dff9a';
    try { const c = String(managed.layer.annotationDisplayState.color.toString()); if (HEX.test(c)) color = c.toLowerCase(); } catch { /* keep */ }
    out.push({ managed, src, style: { key: mine?.key ?? `layer:${managed.name}`, label: mine?.label ?? managed.name, layer: managed.name, color } });
  }
  return out;
}

/** A wide stroke with no end dots: a highlighter line, not a measurement. */
const STROKE_SHADER = 'void main() {\n' +
  '  setColor(vec4(defaultColor().rgb, 0.85));\n' +
  '  setLineWidth(4.0);\n' +
  '  setEndpointMarkerSize(0.0);\n' +
  '}\n';

const ID_PREFIX = 'hl_';
const LINE = 1; // AnnotationType.LINE
const POINT = 0; // AnnotationType.POINT
const POLYLINE = 4; // AnnotationType.POLYLINE

/** Add one mark's stroke: its line pieces (nanometres) saved as a few short
 *  polylines, the first carrying the description. A stroke too short to keep
 *  any length becomes a spot. */
function addStroke(src: any, mark: string, segs: [number[], number[]][], scalesNm: number[], description: string) {
  const runs = strokeRuns(segs, scalesNm);
  if (!runs.length && segs.length) {
    const point = Float32Array.from(segs[0][0].map((v, i) => v / (scalesNm[i] || 1)));
    src.add({ id: `${mark}_0`, type: POINT, point, properties: [], description }, true).dispose();
    return;
  }
  runs.forEach((points, i) => {
    src.add({ id: `${mark}_${i}`, type: POLYLINE, points, properties: [], description: i === 0 ? description : undefined }, true).dispose();
  });
}

/** Highlights saved before strokes were polylines (one line annotation per
 *  step) are rewritten the new way when the view opens, so the views they
 *  are in shrink too. Same ids, same colour, same description. */
function slimOldStrokes(src: any, scalesNm: number[]): number {
  const marks = new Map<string, { ids: string[]; segs: [number[], number[]][]; description: string }>();
  for (const ann of src) {
    const id = String(ann.id);
    if (ann.type !== LINE || !id.startsWith(ID_PREFIX)) continue;
    const mark = id.slice(0, id.lastIndexOf('_'));
    if (!marks.has(mark)) marks.set(mark, { ids: [], segs: [], description: '' });
    const m = marks.get(mark)!;
    m.ids.push(id);
    m.segs.push([[0, 1, 2].map(i => ann.pointA[i] * (scalesNm[i] || 1)), [0, 1, 2].map(i => ann.pointB[i] * (scalesNm[i] || 1))]);
    if (ann.description && !m.description) m.description = String(ann.description);
  }
  let slimmed = 0;
  for (const [mark, m] of marks) {
    // A mark of a line or two is as small as it gets.
    if (m.ids.length < 3) continue;
    // Its other annotations (none, for a stroke) keep their ids out of the way.
    const taken = new Set<string>();
    for (const ann of src) if (String(ann.id).startsWith(mark + '_')) taken.add(String(ann.id));
    if (taken.size !== m.ids.length) continue;
    for (const id of m.ids) { const ref = src.getReference(id); try { src.delete(ref); } finally { ref.dispose(); } }
    addStroke(src, mark, m.segs, scalesNm, m.description);
    slimmed++;
  }
  return slimmed;
}
const BALL_SCALE = 1.4;

const viewerOf = (): any => (window as any).viewer;

/** Why Highlight must not ask this dataset's server to trace, if it must
 *  not (MEC: its path server fails on long stretches and has no L2 cache). */
export function traceOffReason(): string {
  try {
    const name = currentSegLayerName();
    return findDatasetBySegName(name)?.highlightNoTrace ?? findDatasetByCanonical(canonicalDataset(name))?.highlightNoTrace ?? '';
  } catch { return ''; }
}
function refuseTrace() { const why = traceOffReason(); if (why) throw new Error(why); }

export interface Pick { selection: SegmentSelection; root: string; /** Viewer (global) coordinates of the click. */ global: number[]; }

/** The cell under the cursor right now, or a reason there is none. */
export function pickUnderMouse(): Pick | { error: string } {
  const viewer = viewerOf();
  const layer = currentSegLayer()?.layer;
  if (!viewer || !(layer instanceof SegmentationUserLayer)) return { error: 'No segmentation layer is open.' };
  if (!layer.graphConnection.value) return { error: 'This dataset has no proofreading graph to trace a path through.' };
  let selection: SegmentSelection | undefined;
  try { selection = ngeGrapheneSelectionUnderMouse(layer, viewer.mouseState); } catch { /* not ready */ }
  if (!selection) return { error: 'Click on a cell that is showing in your view.' };
  const global = Array.from(viewer.mouseState.position as Float32Array).slice(0, 3);
  return { selection, root: selection.rootId.toString(), global };
}

function managedLayer(name: string): any {
  return viewerOf()?.layerManager?.managedLayers?.find((l: any) => l.name === name && !l.archived);
}

async function strokeSource(style: HighlightStyle): Promise<any> {
  const viewer = viewerOf();
  let managed = managedLayer(style.layer);
  if (!managed) {
    managed = makeLayer(viewer.layerSpecification, style.layer, {
      type: 'annotation',
      source: 'local://annotations',
      annotations: [],
      annotationColor: style.color,
      shader: STROKE_SHADER,
      hideIn3d: true,
    });
    viewer.layerSpecification.add(managed);
  }
  // A new highlight is always one you can see.
  if (managed.visible === false) managed.setVisible(true);
  // The local source appears once the layer has loaded.
  for (let i = 0; i < 60; i++) {
    const src = managed.layer?.localAnnotations;
    if (src) return src;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('The highlight layer did not load.');
}

// ── The start point, shown where it was placed ──────────────────────────
// A Pyr gem in the 3D view (a dot in 2D), in the mark's colour, drawn over
// the mesh so it stays in sight while the view is turned to find the end
// point (Ames 2026-10-02). It lives in its own small layer, which goes away
// when the panel closes.
const START_LAYER = 'Highlight start';
const START_ID = 'hl-start';
const END_ID = 'hl-end';

export function showStartMarker(pick: Pick, style: HighlightStyle) {
  const viewer = viewerOf();
  const point = { type: 'point', id: START_ID, point: pick.global, description: 'Start of the stretch being marked' };
  const managed = managedLayer(START_LAYER);
  if (!managed) {
    viewer.layerSpecification.add(makeLayer(viewer.layerSpecification, START_LAYER, {
      type: 'annotation', source: 'local://annotations', annotations: [point],
      annotationColor: style.color, pointMarker: 'pyr', pointSize: 1.5, onTop: true,
    }));
    return;
  }
  const src = managed.layer?.localAnnotations;
  if (!src) return;
  try { managed.layer.annotationDisplayState.color.restoreState(style.color); } catch { /* keep its colour */ }
  src.clear();
  src.add({ id: START_ID, type: 0 /* POINT */, point: Float32Array.from(pick.global), properties: [], description: point.description }, true).dispose();
}

/** The second click gets its gem too, beside the first, while the path
 *  between them is traced. Both go when the mark lands (or fails). */
export function showEndMarker(pick: Pick) {
  const src = managedLayer(START_LAYER)?.layer?.localAnnotations;
  if (!src) return;
  try {
    const old = src.getReference(END_ID);
    if (old.value) src.delete(old);
    old.dispose();
  } catch { /* none yet */ }
  src.add({ id: END_ID, type: 0 /* POINT */, point: Float32Array.from(pick.global), properties: [], description: 'End of the stretch being marked' }, true).dispose();
}

/** Take the start point away; `removeLayer` when Highlight mode closes. */
export function clearStartMarker(removeLayer = false) {
  const managed = managedLayer(START_LAYER);
  if (!managed) return;
  if (removeLayer) {
    try { viewerOf().layerManager.removeManagedLayer(managed); } catch { /* already gone */ }
    return;
  }
  try { managed.layer?.localAnnotations?.clear(); } catch { /* not loaded yet */ }
}

/** Mark the stretch between two picks. Returns how many path points it has. */
export async function addHighlight(a: Pick, b: Pick, style: HighlightStyle, stillWanted: () => boolean = () => true): Promise<number> {
  const viewer = viewerOf();
  const layer = currentSegLayer()?.layer;
  if (!(layer instanceof SegmentationUserLayer)) throw new Error('No segmentation layer is open.');
  refuseTrace();
  if (a.root !== b.root) throw new Error('Those two points are on different cells. Pick both on the same cell.');
  // MEC's server takes minutes over a precise path (Ames 2026-10-24: "1m 34
  // seconds for a short path"). There the cell's branch map comes first: one
  // fetch per cell, then every stretch is worked out here. Without one, the
  // quick path, whose staircase the color reach covers.
  if (isMec()) {
    try {
      return await addBranchHighlight(a, 'toward', style, b, stillWanted, '');
    } catch (e) {
      if (!stillWanted()) return 0;
      console.warn('[highlight] MEC branch map failed, trying the quick path:', e);
    }
  }
  let nm: number[][] | null = null;
  let pathError: any = null;
  try { nm = await ngeGrapheneFindPath(layer, a.selection, b.selection, !isMec()); } catch (e) { pathError = e; }
  // The panel gave up waiting (timed out or cancelled): draw nothing late.
  if (!stillWanted()) return 0;
  if (!nm || nm.length < 2) {
    // The path service fails outright on some pairs of points (it answers
    // with a server error, seen 2026-10-10 on the retina). The cell's branch
    // map can still join them, so the mark is made from that instead.
    try {
      return await addBranchHighlight(a, 'toward', style, b, stillWanted, '');
    } catch (e) {
      console.warn('[highlight] path failed, and so did the branch map:', pathError, e);
      throw new Error(pathError && !/HTTP error 0|Network|Failed to fetch/i.test(String(pathError?.message))
        ? 'The server could not trace a path between those points. Try two points a little farther apart.'
        : (pathError?.message || 'No path came back between those points. Try two points farther apart.'));
    }
  }
  // Annotation layers live in the viewer's own coordinates.
  const scalesNm: number[] = Array.from(viewer.coordinateSpace.value.scales as Float64Array).map(x => x / 1e-9);
  const pts = nm.map(p => Float32Array.from(p.map((v, i) => v / (scalesNm[i] || 1))));
  // The server's path runs between the MIDDLES of the pieces that were
  // clicked, so it stops short of the clicks themselves: a branch marked to
  // its very tip kept an uncoloured end, and widening the reach to cover it
  // spilled onto the rest of the cell (Ames, Nseraf 2026-10-03). The two
  // clicks become the ends of the path. Each goes on the end it is nearer
  // to, whichever way round the server returned the path.
  const distNm = (p: ArrayLike<number>, q: ArrayLike<number>) =>
    Math.hypot(...[0, 1, 2].map(i => (p[i] - q[i]) * (scalesNm[i] || 1)));
  const ga = Float32Array.from(a.global), gb = Float32Array.from(b.global);
  if (ga.length === 3 && gb.length === 3 && ga.every(Number.isFinite) && gb.every(Number.isFinite)) {
    const first = pts[0], last = pts[pts.length - 1];
    const straight = distNm(ga, first) + distNm(gb, last) <= distNm(ga, last) + distNm(gb, first);
    const [head, tail] = straight ? [ga, gb] : [gb, ga];
    // Skip an end that is already there (a click right on a piece's middle).
    if (distNm(head, first) > 1) pts.unshift(head);
    if (distNm(tail, last) > 1) pts.push(tail);
  }
  const src = await strokeSource(style);
  const mark = `${ID_PREFIX}${Date.now().toString(36)}`;
  const ptsNm = pts.map(p => [0, 1, 2].map(i => p[i] * (scalesNm[i] || 1)));
  addStroke(src, mark, ptsNm.slice(1).map((q, i) => [ptsNm[i], q] as [number[], number[]]), scalesNm, `${style.label}: cell ${a.root}`);
  setLatestMark(mark);
  return pts.length;
}

// ── To soma, and Beyond (Krzysztof Kruk 2026-10-09) ─────────────────────
// "Select a centroid and click a button to highlight all its descendants or
// highlight all the ancestors", as in the first EyeWire. One click on the
// cell, then: To soma marks the way back to the soma; Beyond marks every
// branch on the far side of the click. See branch_tree.ts for how "which
// side" is decided, and where it can be wrong.

/** Every soma point on record, in viewer coordinates: the points in a layer
 *  named Soma (a Cell Library cell's starting view has one, and a soma you
 *  click for Highlight is kept there), and the cell's row in the library.
 *  A view can hold several cells, so the one that belongs to a cell is
 *  chosen later, by which lies on it. */
export function knownSomas(root: string): number[][] {
  const out: number[][] = [];
  for (const managed of viewerOf()?.layerManager?.managedLayers ?? []) {
    if (managed.archived || !SOMA_LAYER_NAME.test(String(managed.name))) continue;
    try {
      for (const ann of managed.layer?.localAnnotations ?? []) {
        const pt = ann.point ?? ann.pointA;
        if (!pt || pt.length < 3) continue;
        const p = layerToView(managed.layer.localAnnotations, pt);
        if (p.every(Number.isFinite)) out.push(p);
      }
    } catch { /* not loaded */ }
  }
  try {
    const task = useProofreadingBackendStore().tasks.find((t: any) => t.segment_id === root || t.final_segment_id === root);
    const nums = String(task?.soma_coords || task?.nucleus_coords || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (nums && nums.length === 3 && nums.every(Number.isFinite)) out.push(nums);
  } catch { /* no library */ }
  // On MEC the starting point is the nucleus, inside the soma.
  if (isMec()) { const start = startXyz(); if (start) out.push(start); }
  return out;
}

const SOMA_LAYER_NAME = /^soma/i;
const SOMA_LAYER = 'Soma';
/**
 * Keep a soma the player clicked, so the next To soma or Beyond on this cell
 * does not ask again (Ames 2026-10-10). It goes where a Cell Library cell's
 * soma already lives: a point in the view's Soma layer. So it can be seen,
 * moved or deleted like any annotation, it is saved and shared with the
 * view, and it still fits the cell after an edit changes the cell's id.
 */
function rememberSoma(pick: Pick, scalesNm: number[]) {
  try {
    const viewer = viewerOf();
    const near = knownSomas('').some(p => Math.hypot(...[0, 1, 2].map(i => (p[i] - pick.global[i]) * (scalesNm[i] || 1))) < 2000);
    if (near) return;   // already there
    const description = `Soma of cell ${pick.root} (clicked for Highlight)`;
    const managed = viewer.layerManager.managedLayers.find((l: any) => !l.archived && SOMA_LAYER_NAME.test(String(l.name)));
    if (!managed) {
      viewer.layerSpecification.add(makeLayer(viewer.layerSpecification, SOMA_LAYER, {
        type: 'annotation', source: 'local://annotations', annotationColor: '#ffd24d',
        annotations: [{ type: 'point', id: `soma_${Date.now().toString(36)}`, point: pick.global, description }],
      }));
      return;
    }
    managed.layer?.localAnnotations?.add({
      id: `soma_${Date.now().toString(36)}`, type: 0 /* POINT */, point: viewToLayer(managed.layer.localAnnotations, pick.global), properties: [], description,
    }, true).dispose();
  } catch (e) { console.warn('[highlight] could not keep the soma point:', e); }
}

/** A soma point farther than this from every piece of the cell is some
 *  other cell's soma (or an old one): not used. */
const SOMA_REACH_NM = 25000;
/** More strokes than this is a whole large cell: say so instead of drawing. */
const MAX_BRANCH_STROKES = 6000;

let graphCache: { root: string; at: number; graph: BranchGraph } | null = null;
async function branchGraphOf(layer: SegmentationUserLayer, root: string): Promise<BranchGraph> {
  // A cell's id changes with every edit, so a kept graph is never a stale one.
  if (graphCache && graphCache.root === root && Date.now() - graphCache.at < 5 * 60 * 1000) return graphCache.graph;
  const graph = await ngeGrapheneBranchGraph(layer, root);
  if (!graph.edges.length && !graph.points.size) throw new Error('The server has no branch map for this cell.');
  graphCache = { root, at: Date.now(), graph };
  return graph;
}

/** Thrown when the soma is not known: the panel asks for one more click. */
export class NeedsSomaSide extends Error {
  constructor() { super(isTouchRef.value ? "Now tap this cell's soma." : "Now Ctrl + click this cell's soma."); }
}

/**
 * Mark from one pick toward the soma, or everything beyond it.
 * `somaSide` is a second pick on the soma side; leave it out to use the
 * cell's known soma (NeedsSomaSide is thrown when there is none).
 * Returns how many pieces of the cell were marked.
 */
export async function addBranchHighlight(a: Pick, way: BranchWay, style: HighlightStyle, somaSide?: Pick,
                                         stillWanted: () => boolean = () => true, label?: string): Promise<number> {
  const viewer = viewerOf();
  const layer = currentSegLayer()?.layer;
  if (!(layer instanceof SegmentationUserLayer)) throw new Error('No segmentation layer is open.');
  refuseTrace();
  if (somaSide && somaSide.root !== a.root) throw new Error('Those two points are on different cells. Pick both on the same cell.');
  const scalesNm: number[] = Array.from(viewer.coordinateSpace.value.scales as Float64Array).map(x => x / 1e-9);
  const toNm = (g: ArrayLike<number>) => [0, 1, 2].map(i => g[i] * (scalesNm[i] || 1));

  const somas = somaSide ? [] : knownSomas(a.root);
  if (!somaSide && !somas.length) throw new NeedsSomaSide();
  const graph = await branchGraphOf(layer, a.root);
  if (!stillWanted()) return 0;

  // The piece each point is in: asked of the server, else the nearest one.
  const pieceAt = async (pick: Pick) => {
    const id = await ngeGraphenePieceOf(layer, pick.selection);
    if (id && (graph.points.has(id) || graph.edges.some(e => e[0] === id || e[1] === id))) return id;
    return nearestPiece(graph, toNm(pick.global))?.id;
  };
  const from = await pieceAt(a);
  let ref: string | undefined;
  let refNm: number[] | undefined;
  if (somaSide) {
    ref = await pieceAt(somaSide);
    refNm = toNm(somaSide.global);
  } else {
    // Of the somas on record, the one that lies on this cell.
    let best: { id: string; distNm: number; nm: number[] } | undefined;
    for (const p of somas) {
      const near = nearestPiece(graph, toNm(p));
      if (near && (!best || near.distNm < best.distNm)) best = { ...near, nm: toNm(p) };
    }
    // None of them is on this cell: ask for a click instead.
    if (!best || best.distNm > SOMA_REACH_NM) throw new NeedsSomaSide();
    ref = best.id;
    refNm = best.nm;
  }
  if (!stillWanted()) return 0;
  if (!from || !ref) throw new Error('That point is not on a mapped part of this cell.');

  // A plain two click mark that fell back to the branch map, with both clicks
  // in the same small piece of the cell: the stretch is the line between them.
  const direct = label !== undefined && from === ref && !!refNm;
  const { segments, pieces } = direct
    ? { segments: [[toNm(a.global), refNm!]] as [number[], number[]][], pieces: 1 }
    : branchSegments(graph, from, ref, way, toNm(a.global), way === 'toward' ? refNm : undefined);
  if (segments.length > MAX_BRANCH_STROKES) {
    throw new Error(`That is ${pieces.toLocaleString()} pieces of the cell, too much to mark at once. Pick a point farther out along the branch.`);
  }
  const src = await strokeSource(style);
  const mark = `${ID_PREFIX}${Date.now().toString(36)}`;
  const what = label ?? (way === 'toward' ? 'to soma' : 'beyond');
  addStroke(src, mark, segments, scalesNm, `${style.label}${what ? ', ' + what : ''}: cell ${a.root}`);
  setLatestMark(mark);
  // A soma that was clicked for this is kept for next time.
  if (somaSide && label === undefined) rememberSoma(somaSide, scalesNm);
  return pieces;
}

// ── The lab's MEC marks (Ames 2026-10-24) ────────────────────────────────
// On an MEC cell the lab asks for an AIS, and a True End, Can't Fix or Hits
// Edge on every branch end (mec_marks.ts). One click drops the mark: a point
// in the lab's own layer (what the lab reads), and the end of the branch
// glows in the mark's colour (buildTint). The lab proofreaders start with
// the axons: once the AIS is marked, the axon (everything beyond it) can be
// coloured, and its ends at the edge of the data found for the player.

/** The lab's layer for this kind, made as a claimed MEC cell makes it
 *  (mec_layers.ts) when the view lacks it. */
async function labSource(kind: MecKind): Promise<any> {
  const viewer = viewerOf();
  let managed = mecLayers().get(kind);
  if (!managed) {
    managed = makeLayer(viewer.layerSpecification, kind.layer, {
      type: 'annotation', source: { url: 'local://annotations' }, annotationColor: kind.color, annotations: [],
    });
    viewer.layerSpecification.add(managed);
  }
  if (managed.visible === false) managed.setVisible(true);
  for (let i = 0; i < 60; i++) {
    const src = managed.layer?.localAnnotations;
    if (src) return src;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`The ${kind.label} layer did not load.`);
}
const kindOf = (style: HighlightStyle) => MEC_KINDS.find(k => k.key === style.key);

/** Drop one MEC mark where the player clicked. */
/** The lab mark picked, shared by the Highlight box and the Cell Library's
 *  Marks (Ames 2026-10-24: "if I have highlight mode on it overrules the cell
 *  marks, which is a bit confusing"). Whichever of the two takes the click, it
 *  places this mark. Null: no lab mark is picked. */
export const sharedLabPick = ref<string | null>(null);

/** A highlight spot: one click, a point in the color's own layer that glows
 *  on the cell, for where the server can't trace a stretch (Ames 2026-10-24:
 *  "We should at least be able to add more highlight points"). */
export async function addHighlightSpot(pick: Pick, style: HighlightStyle): Promise<void> {
  const src = await strokeSource(style);
  const mark = `${ID_PREFIX}${Date.now().toString(36)}`;
  src.add({ id: `${mark}_0`, type: POINT, point: viewToLayer(src, pick.global), properties: [], description: `${style.label}: cell ${pick.root}` }, true).dispose();
  setLatestMark(mark);
}

export async function addLabMark(pick: Pick, style: HighlightStyle): Promise<void> {
  const kind = kindOf(style);
  if (!kind) throw new Error("That is not one of the lab's marks.");
  await addLabPoint(kind, pick.global, `${kind.label}: cell ${pick.root}`);
}

/** The soma, confirmed at the cell's starting point (its nucleus). */
/** Where the crosshairs are, in the view's voxels, rounded. */
function crosshairXyz(): number[] {
  return Array.from(viewerOf().navigationState.position.value as ArrayLike<number>).slice(0, 3).map(v => Math.round(v));
}
/** Confirm puts the mark where the crosshairs are (Ames 2026-10-27: "I
 *  confirmed AIS here where axes are but then it marked it blue up at the
 *  original point"). Go to the starting point, or to the lab's AIS point,
 *  moves the crosshairs there first, so confirming without moving takes it;
 *  moving them first puts the mark where they were moved. */
export async function confirmSomaAtStart(): Promise<number[]> {
  const at = crosshairXyz();
  let root = '';
  try { root = workingRoot(); } catch { /* several cells, or none: no cell id in the note */ }
  await addLabPoint(MEC_SOMA, at, `Soma, confirmed${root ? `: cell ${root}` : ''}`);
  return at;
}
/** The AIS, confirmed where the crosshairs are. */
export async function confirmAisAtSheet(): Promise<number[]> {
  const at = crosshairXyz();
  let root = '';
  try { root = workingRoot(); } catch { /* several cells, or none */ }
  await addLabPoint(MEC_AIS, at, `AIS, confirmed${root ? `: cell ${root}` : ''}`);
  return at;
}
/** Look at a point in the view (the lab's AIS point, the starting point). */
export function goToXyz(xyz: number[] | null): boolean {
  if (!xyz) return false;
  try { viewerOf().navigationState.position.value = Float32Array.from(xyz); return true; } catch { return false; }
}

/** Look at the starting point, to check it is in the soma. */
export function goToStart(): boolean {
  const start = startXyz();
  if (!start) return false;
  try { viewerOf().navigationState.position.value = Float32Array.from(start); return true; } catch { return false; }
}

async function addLabPoint(kind: MecKind, point: ArrayLike<number>, description: string): Promise<void> {
  const src = await labSource(kind);
  // A cell has one soma and one AIS: marking one again moves it.
  if (kind === MEC_SOMA || kind === MEC_AIS) {
    const old: string[] = [];
    for (const ann of src) if (String(ann.id).startsWith(ID_PREFIX)) old.push(String(ann.id));
    for (const id of old) { const ref = src.getReference(id); try { src.delete(ref); } finally { ref.dispose(); } }
  }
  const mark = `${ID_PREFIX}${Date.now().toString(36)}`;
  src.add({ id: `${mark}_0`, type: POINT, point: viewToLayer(src, point), properties: [], description }, true).dispose();
  setLatestMark(mark);
}

/** The newest AIS point in the view, in nanometres, placed here or by hand. */
function aisPointNm(scalesNm: number[]): number[] | null {
  const managed = mecLayers().get(MEC_AIS);
  let last: number[] | null = null;
  try {
    for (const ann of managed?.layer?.localAnnotations ?? []) {
      if (ann.type === POINT && ann.point) { const v = layerToView(managed.layer.localAnnotations, ann.point); last = [0, 1, 2].map(i => v[i] * (scalesNm[i] || 1)); }
    }
  } catch { /* not loaded */ }
  return last;
}
/** The cell being proofread: the only one showing, else the one clicked last
 *  while it still shows (an edit gives a cell a new id). */
export function workingRoot(lastRoot?: string | null): string {
  const visible = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
  const ids: string[] = [];
  try { for (const id of visible ?? []) ids.push(id.toString()); } catch { /* none */ }
  if (ids.length === 1) return ids[0];
  if (lastRoot && ids.includes(lastRoot)) return lastRoot;
  throw new Error(ids.length ? 'Several cells are showing. Click once on the cell you are working on first.' : 'Show the cell you are working on first.');
}

const AIS_REACH_NM = 15000;
/** The axon of a cell: the pieces beyond its AIS, away from the soma. */
function axonOf(root: string, graph: BranchGraph, scalesNm: number[]) {
  const ais = aisPointNm(scalesNm);
  if (!ais) throw new Error('Mark the AIS first: the axon is everything beyond it.');
  const at = nearestPiece(graph, ais);
  if (!at || at.distNm > AIS_REACH_NM) throw new Error('The AIS mark is not on this cell. Mark the AIS on the cell you are working on.');
  let soma: { id: string; distNm: number } | undefined;
  for (const p of knownSomas(root)) {
    const near = nearestPiece(graph, p);
    if (near && (!soma || near.distNm < soma.distNm)) soma = near;
  }
  if (!soma || soma.distNm > SOMA_REACH_NM) {
    throw new Error("Pyr doesn't know where this cell's soma is. Open the cell from the Cell Library, or mark the axon with a highlight colour and Beyond.");
  }
  if (soma.id === at.id) throw new Error('The AIS mark is on the soma itself. Put it where the axon leaves the cell.');
  return { from: at.id, ref: soma.id, aisNm: ais };
}

/** Colour the axon: everything beyond the AIS, in the AIS colour, in a
 *  highlight layer of its own. Returns how many pieces were marked. */
export async function addAxonHighlight(root: string, stillWanted: () => boolean = () => true): Promise<number> {
  const viewer = viewerOf();
  const layer = currentSegLayer()?.layer;
  if (!(layer instanceof SegmentationUserLayer)) throw new Error('No segmentation layer is open.');
  const scalesNm: number[] = Array.from(viewer.coordinateSpace.value.scales as Float64Array).map(x => x / 1e-9);
  refuseTrace();
  const graph = await branchGraphOf(layer, root);
  if (!stillWanted()) return 0;
  const { from, ref, aisNm } = axonOf(root, graph, scalesNm);
  const { segments, pieces } = branchSegments(graph, from, ref, 'away', aisNm);
  if (segments.length > MAX_BRANCH_STROKES) throw new Error(`That is ${pieces.toLocaleString()} pieces, too much to colour at once.`);
  const src = await strokeSource({ key: 'axon', label: AXON_LAYER, layer: AXON_LAYER, color: MEC_AIS.color });
  const mark = `${ID_PREFIX}${Date.now().toString(36)}`;
  addStroke(src, mark, segments, scalesNm, `Axon, beyond the AIS: cell ${root}`);
  setLatestMark(mark);
  return pieces;
}

/**
 * Hits Edge, found for the player: the branch ends that run into the edge of
 * the data, by the rule the Hunt uses for "edge of the dataset" (within
 * 5 um of the segmentation volume's outside). Along the axon only once the
 * AIS is marked (the lab starts with the axons), else the whole cell. Ends
 * already marked Hits Edge are left alone. All the new marks are one mark
 * for Undo. Returns what was added and what was there already.
 */
export async function addEdgeMarks(root: string, stillWanted: () => boolean = () => true,
                                   onProgress?: (done: number, total: number) => void):
    Promise<{ added: number; already: number; axonOnly: boolean; fromMesh?: boolean; closestNm?: number }> {
  const viewer = viewerOf();
  const managedSeg = currentSegLayer();
  const layer = managedSeg?.layer;
  if (!(layer instanceof SegmentationUserLayer)) throw new Error('No segmentation layer is open.');
  const bounds = dataBoundsNm() ?? segBoundsNm(managedSeg);
  if (!bounds) throw new Error("Pyr couldn't read where this dataset ends.");
  const scalesNm: number[] = Array.from(viewer.coordinateSpace.value.scales as Float64Array).map(x => x / 1e-9);
  // The branch map gives the tips of the branches. Where the server has no
  // branch map for the cell, the Hunt's own way: the parts of the cell's mesh
  // on screen that touch the edge (no server call, but the whole cell, and a
  // branch running along the edge counts too).
  let graph: BranchGraph | null = null;
  if (!traceOffReason()) {
    try { graph = await branchGraphOf(layer, root); } catch (e) { console.warn('[highlight] no branch map, using the meshes:', e); }
  }
  if (!stillWanted()) return { added: 0, already: 0, axonOnly: false };
  let only: Set<string> | undefined;
  let ends: number[][];
  let closestNm: number | undefined;
  if (graph) {
    if (aisPointNm(scalesNm)) {
      const { from, ref } = axonOf(root, graph, scalesNm);
      only = piecesBeyond(graph, from, ref);
    }
    ends = edgeEnds(graph, bounds, EDGE_NM, 3000, only);
  } else if (isMec()) {
    // MEC's data is not a box: the lab's image mask says where it ends.
    // 6 um: the segmentation stops a few um inside the imaged area (cell #1289
    // ended at y 2330 um, the image a few um further on, Ames 2026-10-26).
    const spots = await maskEdgeSpots(root, [bounds[0][2], bounds[1][2]], 6000, 2000, 20, stillWanted, onProgress);
    if (!spots.loaded) throw new Error("This cell's 3D mesh isn't loaded yet. Show the cell in 3D and try again.");
    ends = spots.spots;
  } else {
    const spots = meshEdgeSpots([root], bounds, EDGE_NM);
    if (!spots.loaded) throw new Error("This cell's 3D mesh isn't loaded yet. Show the cell in 3D and try again.");
    ends = spots.spots;
    closestNm = spots.closestNm;
  }
  // Ends someone already marked Hits Edge, by hand or before.
  const marked: number[][] = [];
  try {
    for (const ann of mecLayers().get(MEC_EDGE)?.layer?.localAnnotations ?? []) {
      if (ann.type === POINT && ann.point) { const v = layerToView(mecLayers().get(MEC_EDGE).layer.localAnnotations, ann.point); marked.push([0, 1, 2].map(i => v[i] * (scalesNm[i] || 1))); }
    }
  } catch { /* none */ }
  const fresh = ends.filter(e => !marked.some(m => Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]) < 4000));
  const result = { added: fresh.length, already: ends.length - fresh.length, axonOnly: !!only, fromMesh: !graph, closestNm };
  if (!fresh.length || !stillWanted()) return result;
  const src = await labSource(MEC_EDGE);
  const mark = `${ID_PREFIX}${Date.now().toString(36)}`;
  fresh.forEach((p, i) => {
    src.add({
      id: `${mark}_${i}`, type: POINT, point: viewToLayer(src, p.map((v, k) => v / (scalesNm[k] || 1))), properties: [],
      description: `Hits Edge, found by Pyr: cell ${root}`,
    }, true).dispose();
  });
  setLatestMark(mark);
  return result;
}

// ── The newest mark stands out (Annkri 2026-10-04) ──────────────────────
// "Another colour on the latest highlight you made, might make it easier to
// catch mistakes, if you clicked too far apart." The mark made last in this
// session is drawn lighter than the rest, on the cell and in the annotation
// list, until the next mark, an undo of it, or the panel closing. It is not
// saved: a reloaded or shared view has no "latest".
let latestMark: string | null = null;
/** The newest mark keeps its own hue and GLOWS (the mesh shader draws its
 *  colour bright and nearly unshaded). Pulling it toward white, the first
 *  version, only washed it out (Ames 2026-10-05). The small lift is there so
 *  the colour is its own: the shader finds the glowing mark by colour, and it
 *  must not match an older mark in the same style. */
const LATEST_LIFT = 0.12;
function setLatestMark(mark: string | null) {
  if (latestMark === mark) return;
  latestMark = mark;
  let style = document.getElementById('nge-hl-latest') as HTMLStyleElement | null;
  if (!mark) { style?.remove(); scheduleTint(); return; }
  if (!style) {
    style = document.createElement('style');
    style.id = 'nge-hl-latest';
    document.head.appendChild(style);
  }
  // Mark ids are hl_ plus base 36 digits, so they are safe inside a selector.
  const rows = `.neuroglancer-annotation-list-entry[data-nge-id^="${mark}_"]`;
  style.textContent =
    `${rows} { background: rgba(255, 255, 255, 0.09) !important; box-shadow: inset 3px 0 0 #fff !important; }\n` +
    `${rows} .neuroglancer-annotation-icon { color: #fff !important; text-shadow: 0 0 6px #fff !important; }\n` +
    '';
  scheduleTint();
}
// For checking from the console and in tests (like __ngeHighlightTint).
(window as any).__ngeHighlightSetLatest = setLatestMark;
/** Forget the newest mark (the Highlight panel closing). */
export function clearLatestHighlight() { setLatestMark(null); }

/** Every mark in the view, oldest first, read back from the layers
 *  themselves (so marks restored from a saved view count too). */
export function listHighlights(): { mark: string; style: HighlightStyle; ids: string[] }[] {
  const out = new Map<string, { mark: string; style: HighlightStyle; ids: string[] }>();
  for (const { src, style } of highlightLayers()) {
    for (const ann of src) {
      const id = String(ann.id);
      if (!id.startsWith(ID_PREFIX)) continue;
      const mark = id.slice(0, id.lastIndexOf('_'));
      if (!out.has(mark)) out.set(mark, { mark, style, ids: [] });
      out.get(mark)!.ids.push(id);
    }
  }
  return [...out.values()].sort((x, y) => (x.mark < y.mark ? -1 : 1));
}

function removeIds(style: HighlightStyle, ids: string[]) {
  const src = managedLayer(style.layer)?.layer?.localAnnotations;
  if (!src) return;
  for (const id of ids) {
    const ref = src.getReference(id);
    try { src.delete(ref); } finally { ref.dispose(); }
  }
}

/** Remove the newest mark. False when there is none. */
export function undoHighlight(): boolean {
  const marks = listHighlights();
  const last = marks[marks.length - 1];
  if (!last) return false;
  removeIds(last.style, last.ids);
  if (last.mark === latestMark) setLatestMark(null);
  return true;
}

/** Remove only the highlights that were made on these cells (each mark's
 *  first stroke names the cell it was made on). Returns how many marks went. */
export function removeHighlightsOfCells(roots: string[]): number {
  const want = new Set(roots.filter(Boolean).map(String));
  if (!want.size) return 0;
  let gone = 0;
  for (const m of listHighlights()) {
    const src = managedLayer(m.style.layer)?.layer?.localAnnotations;
    if (!src) continue;
    let cell = '';
    for (const ann of src) {
      if (!String(ann.id).startsWith(m.mark + '_')) continue;
      const hit = String(ann.description ?? '').match(/cell (\d+)\s*$/);
      if (hit) { cell = hit[1]; break; }
    }
    if (!want.has(cell)) continue;
    removeIds(m.style, m.ids);
    if (m.mark === latestMark) setLatestMark(null);
    gone++;
  }
  return gone;
}

/** Every highlight goes. The lab's MEC marks stay: they are the cell's
 *  record (Undo or the annotation list removes one). */
export function clearHighlights() {
  for (const m of listHighlights()) if (!m.style.lab) removeIds(m.style, m.ids);
  setLatestMark(null);
}

// ── Surface tint (stage 3, the geometric way) ────────────────────────────
// The strokes are the record; the tint is how they look in 3D. Every mark is
// rasterised into a small 3D colour map and the mesh shader paints any
// surface near a marked path (neuroglancer/mesh/nge_tint.ts). Rebuilt
// whenever the highlight layers change, panel open or not, so marks restored
// from a saved view tint the cell too.

const TINT_KEY = 'nge_highlight_tint_nm';
/** How far from the path the tint reaches, in nanometres. */
export function tintRadiusNm(): number {
  try { const v = Number(localStorage.getItem(TINT_KEY)); if (v >= 500 && v <= 10000) return v; } catch { /* */ }
  return 2500;
}
export function setTintRadiusNm(nm: number) {
  try { localStorage.setItem(TINT_KEY, String(Math.round(nm))); } catch { /* */ }
  scheduleTint();
}
/** Whether your highlights are showing. A highlight lives in a layer of its
 *  own, so this is those layers being switched on: the same thing as the eye
 *  on each layer's tab, for all of them at once. Off hides the strokes in 2D
 *  and the colour on the cell in 3D, and nothing is deleted. */
export function highlightsShown(): boolean {
  // The lab's MEC layers are switched from their own tabs, not from here.
  const layers = highlightLayers().filter(l => !l.style.lab);
  return !layers.length || layers.some(l => l.managed.visible !== false);
}
/** Calls back whenever a layer is added, removed, shown or hidden. */
export function onLayersChanged(cb: () => void): () => void {
  const signal = viewerOf()?.layerManager?.layersChanged;
  if (!signal) return () => { /* nothing to undo */ };
  signal.add(cb);
  return () => { signal.remove(cb); };
}
export function setHighlightsShown(on: boolean) {
  for (const { managed, style } of highlightLayers()) {
    if (style.lab) continue;
    if ((managed.visible !== false) !== on) managed.setVisible(on);
  }
  scheduleTint();
}

/** Lines painted on the cell that are not highlights: the cut preview
 *  (src/util/cut_preview.ts) colours the two sides of a cut this way. In
 *  nanometres. They are never saved and go when it clears them. */
export interface ExtraTintLine { a: number[]; b: number[]; rgb: number[]; }
let extraTintLines: ExtraTintLine[] = [];
export function setExtraTintLines(lines: ExtraTintLine[] | null) {
  extraTintLines = lines ?? [];
  scheduleTint();
}
/** Whole blocks of the volume painted one colour: [x0, y0, z0, x1, y1, z1] in
 *  nanometres. The cut preview colours a cell this way, block by block. */
export interface ExtraTintBox { box: number[]; rgb: number[]; }
let extraTintBoxes: ExtraTintBox[] = [];
export function setExtraTintBoxes(boxes: ExtraTintBox[] | null) {
  extraTintBoxes = boxes ?? [];
  scheduleTint();
}

const MAX_VOXELS = 6e6;   // 24 MB of RGBA at most
const hexRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function buildTint(): NgeMeshTint | null {
  const viewer = viewerOf();
  if (!viewer) return null;
  const scalesNm: number[] = Array.from(viewer.coordinateSpace.value.scales as Float64Array).slice(0, 3).map(x => x / 1e-9);
  if (scalesNm.length < 3) return null;
  // Every stroke segment, in nanometres.
  const segs: { a: number[]; b: number[]; rgb: number[]; latest?: boolean; ball?: boolean }[] = [];
  for (const { managed, src, style } of highlightLayers()) {
    if (managed.visible === false) continue;
    const rgb = hexRgb(style.color);
    // The newest mark, lifted toward white so it reads apart from older ones.
    const rgbLatest = rgb.map(c => Math.round(c + (255 - c) * LATEST_LIFT));
    const latestPrefix = latestMark ? `${latestMark}_` : null;
    for (const ann of src) {
      // Every point in an MEC layer glows on the cell, placed here or by hand.
      if (style.lab) {
        if (ann.type !== POINT || !ann.point) continue;
        const v = layerToView(src, ann.point);
        const p = [0, 1, 2].map(i => v[i] * scalesNm[i]);
        segs.push({ a: p, b: p, rgb, ball: true });
        continue;
      }
      if (!String(ann.id).startsWith(ID_PREFIX)) continue;
      const isLatest = latestPrefix !== null && String(ann.id).startsWith(latestPrefix);
      // A highlight spot (where the server can't trace, MEC): a glow there.
      if (ann.type === POINT && ann.point) {
        const v = layerToView(src, ann.point);
        const p = [0, 1, 2].map(i => v[i] * scalesNm[i]);
        segs.push({ a: p, b: p, rgb: isLatest ? rgbLatest : rgb, latest: isLatest, ball: true });
        continue;
      }
      if (ann.type === POLYLINE && ann.points) {
        const rgbHere = isLatest ? rgbLatest : rgb;
        const ps = (ann.points as ArrayLike<number>[]).map(q => [0, 1, 2].map(i => q[i] * scalesNm[i]));
        for (let k = 0; k + 1 < ps.length; k++) segs.push({ a: ps[k], b: ps[k + 1], rgb: rgbHere, latest: isLatest });
        continue;
      }
      if (ann.type !== LINE) continue;
      segs.push({
        a: [0, 1, 2].map(i => ann.pointA[i] * scalesNm[i]),
        b: [0, 1, 2].map(i => ann.pointB[i] * scalesNm[i]), rgb: isLatest ? rgbLatest : rgb, latest: isLatest,
      });
    }
  }
  // The cut preview's two sides, over any highlight on the same stretch.
  for (const l of extraTintLines) segs.push({ a: l.a, b: l.b, rgb: l.rgb });
  if (!segs.length && !extraTintBoxes.length) return null;
  const r = tintRadiusNm();
  // A mark at a branch end glows a little wider than a stroke, so the end
  // reads as marked from a distance.
  const rBall = r * BALL_SCALE;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of segs) for (const p of [s.a, s.b]) for (let i = 0; i < 3; i++) {
    const rr = s.ball ? rBall : r;
    lo[i] = Math.min(lo[i], p[i] - rr); hi[i] = Math.max(hi[i], p[i] + rr);
  }
  for (const b of extraTintBoxes) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], b.box[i]); hi[i] = Math.max(hi[i], b.box[i + 3]);
  }
  const ext = [0, 1, 2].map(i => hi[i] - lo[i]);
  // Cell size: fine enough for a clean edge, coarse enough to fit the budget.
  let cell = Math.max(r / 5, Math.cbrt((ext[0] * ext[1] * ext[2]) / MAX_VOXELS));
  let dims = ext.map(e => Math.max(2, Math.ceil(e / cell)));
  while (Math.max(...dims) > 1024) { cell *= 1.25; dims = ext.map(e => Math.max(2, Math.ceil(e / cell))); }
  const [nx, ny, nz] = dims;
  const data = new Uint8Array(nx * ny * nz * 4);
  const soft = Math.max(cell, r * 0.3);   // feathered edge
  const rLine = r;
  // Blocks first, at full strength; a highlight stroke painted after still
  // shows on top where it is the stronger mark.
  for (const b of extraTintBoxes) {
    const i0 = [0, 1, 2].map(i => Math.max(0, Math.floor((b.box[i] - lo[i]) / cell)));
    const i1 = [0, 1, 2].map(i => Math.min(dims[i] - 1, Math.ceil((b.box[i + 3] - lo[i]) / cell) - 1));
    for (let z = i0[2]; z <= i1[2]; z++) for (let y = i0[1]; y <= i1[1]; y++) {
      let o = ((z * ny + y) * nx + i0[0]) * 4;
      for (let x = i0[0]; x <= i1[0]; x++, o += 4) {
        data[o] = b.rgb[0]; data[o + 1] = b.rgb[1]; data[o + 2] = b.rgb[2]; data[o + 3] = 254;
      }
    }
  }
  // The newest mark is painted last, so where it overlaps an older mark its
  // lighter colour is the one that shows.
  segs.sort((x, y) => Number(!!x.latest) - Number(!!y.latest));
  for (const s of segs) {
    const { a, b, rgb } = s;
    const r = s.ball ? rBall : rLine;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    const i0 = [0, 1, 2].map(i => Math.max(0, Math.floor((Math.min(a[i], b[i]) - r - lo[i]) / cell)));
    const i1 = [0, 1, 2].map(i => Math.min(dims[i] - 1, Math.ceil((Math.max(a[i], b[i]) + r - lo[i]) / cell)));
    for (let z = i0[2]; z <= i1[2]; z++) {
      const pz = lo[2] + (z + 0.5) * cell - a[2];
      for (let y = i0[1]; y <= i1[1]; y++) {
        const py = lo[1] + (y + 0.5) * cell - a[1];
        let o = ((z * ny + y) * nx + i0[0]) * 4;
        for (let x = i0[0]; x <= i1[0]; x++, o += 4) {
          const px = lo[0] + (x + 0.5) * cell - a[0];
          let t = (px * d[0] + py * d[1] + pz * d[2]) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - t * d[0], ey = py - t * d[1], ez = pz - t * d[2];
          const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (dist >= r) continue;
          const alpha = Math.min(1, (r - dist) / soft);
          const A = Math.round(alpha * 255);
          // The strongest mark wins a cell; the newest wins a tie.
          if (s.latest ? A < data[o + 3] : A <= data[o + 3]) continue;
          data[o] = Math.round(rgb[0] * alpha);
          data[o + 1] = Math.round(rgb[1] * alpha);
          data[o + 2] = Math.round(rgb[2] * alpha);
          data[o + 3] = A;
        }
      }
    }
  }
  // Global coordinates -> texture coordinates: (p * scaleNm - lo) / (dims * cell).
  const m = mat4.create();
  for (let i = 0; i < 3; i++) {
    m[i * 5] = scalesNm[i] / (dims[i] * cell);
    m[12 + i] = -lo[i] / (dims[i] * cell);
  }
  // For checking from the console and in tests.
  (window as any).__ngeHighlightTint = { segments: segs.length, boxes: extraTintBoxes.length, dims: [nx, ny, nz], cellNm: cell, radiusNm: r };
  const glowSeg = segs.find(s => s.latest);
  const glow = glowSeg ? glowSeg.rgb.map(c => c / 255) as [number, number, number] : undefined;
  return { data, dims: [nx, ny, nz], gridFromGlobal: m, glow };
}

let tintTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTint() {
  if (tintTimer) clearTimeout(tintTimer);
  tintTimer = setTimeout(() => {
    tintTimer = null;
    try { setNgeMeshTint(buildTint()); } catch (e) { console.warn('[highlight] tint failed:', e); setNgeMeshTint(null); }
    try { viewerOf()?.display?.scheduleRedraw(); } catch { /* no viewer */ }
  }, 120);
}

/** Call once the viewer exists: keeps the mesh tint in step with the marks. */
export function startHighlightTint(viewer: any) {
  const watched = new WeakSet<object>();
  const styled = new WeakSet<object>();
  const slimmed = new WeakSet<object>();
  // Older highlights, rewritten as polylines once the view knows its voxel
  // size (the simplifying is in nanometres).
  const slimAll = () => {
    const space = viewer.coordinateSpace.value;
    if (!space?.valid || space.rank < 3) return;
    const scalesNm: number[] = Array.from(space.scales as Float64Array).slice(0, 3).map(x => x / 1e-9);
    for (const { managed, src, style } of highlightLayers()) {
      if (style.lab || slimmed.has(src)) continue;
      slimmed.add(src);
      try {
        const n = slimOldStrokes(src, scalesNm);
        if (n) console.log(`[highlight] ${n} older highlight${n === 1 ? '' : 's'} in ${managed.name} rewritten smaller`);
      } catch (e) { console.warn('[highlight] could not slim the older highlights:', e); }
    }
  };
  let retry: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;
  const scan = () => {
    let waiting = false;
    // Every local annotation layer is watched (any of them may be, or
    // become, a highlight layer); a rebuild with no marks costs nothing.
    for (const managed of viewer.layerManager.managedLayers) {
      if (managed.layer?.constructor?.type !== 'annotation') continue;
      const src = managed.layer?.localAnnotations;
      // A layer's annotations arrive a moment after the layer itself.
      if (!src) { waiting = true; continue; }
      if (!watched.has(src)) {
        watched.add(src);
        src.changed.add(scheduleTint);
        try { managed.layer.annotationDisplayState.color.changed.add(scheduleTint); } catch { /* */ }
      }
    }
    for (const { managed, src, style } of highlightLayers()) {
      // The lab's points stay in sight in 3D, as the lab placed them.
      if (style.lab || styled.has(src)) continue;
      styled.add(src);
      // With the surface tinted, the stroke itself is not drawn in 3D; it
      // still marks the path in the 2D views.
      try {
        managed.layer.annotationDisplayState.ngeOnTop.value = false;
        managed.layer.annotationDisplayState.ngeHideIn3d.value = true;
      } catch { /* */ }
    }
    slimAll();
    scheduleTint();
    // Not for ever: an annotation layer with a remote source never gets one.
    if (waiting && !retry && tries < 25) { tries++; retry = setTimeout(() => { retry = null; scan(); }, 400); }
  };
  viewer.layerManager.layersChanged.add(() => { tries = 0; scan(); });
  viewer.coordinateSpace.changed.add(() => { slimAll(); scheduleTint(); });
  scan();
}

// ── Hits Edge, found on its own (Ames 2026-10-24: "I thought it was
// supposed to auto detect when it reaches the edge of the dataset"; back
// 2026-10-26 with the lab's image mask) ────────────────────────────────────
// While an MEC claim is open and its cell is the one on screen, Pyr waits for
// the cell's 3D mesh to finish loading, then marks Hits Edge wherever it
// reaches the end of the data (addEdgeMarks). Once per cell id per page: an
// edit gives the cell a new id, so a grown branch is looked at again, and
// spots already marked are never marked twice. The player is told, and
// checks each one.
const edgeLooked = new Set<string>();
let edgeLoadSeen: { root: string; loaded: number } | null = null;
/** What the search on its own is doing, for Marks to show: `looking` is
 *  the share done (0 to 1) while it runs, else null. */
export const autoEdgeNews = { last: '', looking: null as number | null };
let autoBusy = false;
async function autoEdgeTick() {
  if (autoBusy || !isMec() || !startXyz()) return;
  let root: string;
  try { root = workingRoot(); } catch { return; }
  if (edgeLooked.has(root)) return;
  const { pieces, loaded } = cellMeshLoad(root);
  // Loaded, and no more pieces came in since the last look.
  const steady = pieces > 0 && loaded === pieces && edgeLoadSeen?.root === root && edgeLoadSeen.loaded === loaded;
  edgeLoadSeen = { root, loaded };
  if (!steady) return;
  edgeLooked.add(root);
  autoBusy = true;
  try {
    autoEdgeNews.looking = 0;
    const r = await addEdgeMarks(root, () => true, (done, total) => { autoEdgeNews.looking = total ? done / total : 0; });
    if (!r.added) return;
    autoEdgeNews.last = `Pyr marked ${r.added} ${r.added === 1 ? 'place' : 'places'} where this cell reaches the edge of the data. Check each one.`;
    StatusMessage.showTemporaryMessage(autoEdgeNews.last, 9000);
  } catch (e) { console.warn('[highlight] Hits Edge on its own failed:', e); }
  finally { autoBusy = false; autoEdgeNews.looking = null; }
}
/** Call once the viewer exists. */
export function startAutoEdgeMarks() {
  setInterval(() => { void autoEdgeTick(); }, 4000);
}
