/**
 * Highlight mode, stage 1 (docs/highlight-mode-spec.md): mark a stretch of a
 * cell as checked. Two picks on the cell, the path between them (the same
 * server call Find Path makes), kept as a thick stroke of line annotations in
 * a "Checked" style layer. The strokes are ordinary annotations, so they save
 * with the view (Save view, autosave, shared links) and survive edits.
 */
import { makeLayer } from 'neuroglancer/layer';
import { SegmentationUserLayer } from 'neuroglancer/segmentation_user_layer';
import { ngeGrapheneSelectionUnderMouse, ngeGrapheneFindPath, SegmentSelection } from 'neuroglancer/datasource/graphene/frontend';
import { currentSegLayer } from '../datasets';
import { useUserPreferencesStore } from '../store';
import { setNgeMeshTint, type NgeMeshTint } from 'neuroglancer/mesh/nge_tint';
import { mat4 } from 'neuroglancer/util/geom';

export interface HighlightStyle { key: string; label: string; layer: string; color: string; }
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
  useUserPreferencesStore().save({ highlightStyles: styles.map(({ key, label, color }) => ({ key, label, color })) });
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

const viewerOf = (): any => (window as any).viewer;

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
  if (a.root !== b.root) throw new Error('Those two points are on different cells. Pick both on the same cell.');
  const nm = await ngeGrapheneFindPath(layer, a.selection, b.selection);
  // The panel gave up waiting (timed out or cancelled): draw nothing late.
  if (!stillWanted()) return 0;
  if (!nm || nm.length < 2) throw new Error('No path came back between those points. Try two points farther apart.');
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
  for (let i = 0; i < pts.length - 1; i++) {
    src.add({
      id: `${mark}_${i}`, type: LINE, pointA: pts[i], pointB: pts[i + 1], properties: [],
      description: i === 0 ? `${style.label}: cell ${a.root}` : undefined,
      relatedSegments: undefined,
    }, true).dispose();
  }
  setLatestMark(mark);
  return pts.length;
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

export function clearHighlights() {
  for (const m of listHighlights()) removeIds(m.style, m.ids);
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
  const layers = highlightLayers();
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
  for (const { managed } of highlightLayers()) {
    if ((managed.visible !== false) !== on) managed.setVisible(on);
  }
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
  const segs: { a: number[]; b: number[]; rgb: number[]; latest?: boolean }[] = [];
  for (const { managed, src, style } of highlightLayers()) {
    if (managed.visible === false) continue;
    const rgb = hexRgb(style.color);
    // The newest mark, lifted toward white so it reads apart from older ones.
    const rgbLatest = rgb.map(c => Math.round(c + (255 - c) * LATEST_LIFT));
    const latestPrefix = latestMark ? `${latestMark}_` : null;
    for (const ann of src) {
      if (ann.type !== LINE || !String(ann.id).startsWith(ID_PREFIX)) continue;
      const isLatest = latestPrefix !== null && String(ann.id).startsWith(latestPrefix);
      segs.push({
        a: [0, 1, 2].map(i => ann.pointA[i] * scalesNm[i]),
        b: [0, 1, 2].map(i => ann.pointB[i] * scalesNm[i]), rgb: isLatest ? rgbLatest : rgb, latest: isLatest,
      });
    }
  }
  if (!segs.length) return null;
  const r = tintRadiusNm();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of segs) for (const p of [s.a, s.b]) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], p[i] - r); hi[i] = Math.max(hi[i], p[i] + r);
  }
  const ext = [0, 1, 2].map(i => hi[i] - lo[i]);
  // Cell size: fine enough for a clean edge, coarse enough to fit the budget.
  let cell = Math.max(r / 5, Math.cbrt((ext[0] * ext[1] * ext[2]) / MAX_VOXELS));
  let dims = ext.map(e => Math.max(2, Math.ceil(e / cell)));
  while (Math.max(...dims) > 1024) { cell *= 1.25; dims = ext.map(e => Math.max(2, Math.ceil(e / cell))); }
  const [nx, ny, nz] = dims;
  const data = new Uint8Array(nx * ny * nz * 4);
  const soft = Math.max(cell, r * 0.3);   // feathered edge
  // The newest mark is painted last, so where it overlaps an older mark its
  // lighter colour is the one that shows.
  segs.sort((x, y) => Number(!!x.latest) - Number(!!y.latest));
  for (const s of segs) {
    const { a, b, rgb } = s;
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
  (window as any).__ngeHighlightTint = { segments: segs.length, dims: [nx, ny, nz], cellNm: cell, radiusNm: r };
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
    for (const { managed, src } of highlightLayers()) {
      if (styled.has(src)) continue;
      styled.add(src);
      // With the surface tinted, the stroke itself is not drawn in 3D; it
      // still marks the path in the 2D views.
      try {
        managed.layer.annotationDisplayState.ngeOnTop.value = false;
        managed.layer.annotationDisplayState.ngeHideIn3d.value = true;
      } catch { /* */ }
    }
    scheduleTint();
    // Not for ever: an annotation layer with a remote source never gets one.
    if (waiting && !retry && tries < 25) { tries++; retry = setTimeout(() => { retry = null; scan(); }, 400); }
  };
  viewer.layerManager.layersChanged.add(() => { tries = 0; scan(); });
  viewer.coordinateSpace.changed.add(scheduleTint);
  scan();
}
