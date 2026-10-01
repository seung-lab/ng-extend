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

export interface HighlightStyle { key: string; label: string; layer: string; color: string; }
export const HIGHLIGHT_STYLES: HighlightStyle[] = [
  { key: 'checked', label: 'Checked', layer: 'Checked ✓', color: '#3dff9a' },
  { key: 'look', label: 'Needs a look', layer: 'Needs a look', color: '#ffd24d' },
  { key: 'problem', label: 'Problem', layer: 'Problem', color: '#ff5d73' },
];

/** A wide stroke with no end dots: a highlighter line, not a measurement. */
const STROKE_SHADER = 'void main() {\n' +
  '  setColor(vec4(defaultColor().rgb, 0.85));\n' +
  '  setLineWidth(9.0);\n' +
  '  setEndpointMarkerSize(0.0);\n' +
  '}\n';

const ID_PREFIX = 'hl_';
const LINE = 1; // AnnotationType.LINE

const viewerOf = (): any => (window as any).viewer;

export interface Pick { selection: SegmentSelection; root: string; }

/** The cell under the cursor right now, or a reason there is none. */
export function pickUnderMouse(): Pick | { error: string } {
  const viewer = viewerOf();
  const layer = currentSegLayer()?.layer;
  if (!viewer || !(layer instanceof SegmentationUserLayer)) return { error: 'No segmentation layer is open.' };
  if (!layer.graphConnection.value) return { error: 'This dataset has no proofreading graph to trace a path through.' };
  let selection: SegmentSelection | undefined;
  try { selection = ngeGrapheneSelectionUnderMouse(layer, viewer.mouseState); } catch { /* not ready */ }
  if (!selection) return { error: 'Click on a cell that is showing in your view.' };
  return { selection, root: selection.rootId.toString() };
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
      onTop: true,
    });
    viewer.layerSpecification.add(managed);
  }
  // The local source appears once the layer has loaded.
  for (let i = 0; i < 60; i++) {
    const src = managed.layer?.localAnnotations;
    if (src) return src;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('The highlight layer did not load.');
}

/** Mark the stretch between two picks. Returns how many path points it has. */
export async function addHighlight(a: Pick, b: Pick, style: HighlightStyle): Promise<number> {
  const viewer = viewerOf();
  const layer = currentSegLayer()?.layer;
  if (!(layer instanceof SegmentationUserLayer)) throw new Error('No segmentation layer is open.');
  if (a.root !== b.root) throw new Error('Those two points are on different cells. Pick both on the same cell.');
  const nm = await ngeGrapheneFindPath(layer, a.selection, b.selection);
  if (!nm || nm.length < 2) throw new Error('No path came back between those points. Try two points farther apart.');
  // Annotation layers live in the viewer's own coordinates.
  const scalesNm: number[] = Array.from(viewer.coordinateSpace.value.scales as Float64Array).map(x => x / 1e-9);
  const pts = nm.map(p => Float32Array.from(p.map((v, i) => v / (scalesNm[i] || 1))));
  const src = await strokeSource(style);
  const mark = `${ID_PREFIX}${Date.now().toString(36)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    src.add({
      id: `${mark}_${i}`, type: LINE, pointA: pts[i], pointB: pts[i + 1], properties: [],
      description: i === 0 ? `${style.label}: cell ${a.root}` : undefined,
      relatedSegments: undefined,
    }, true).dispose();
  }
  return pts.length;
}

/** Every mark in the view, oldest first, read back from the layers
 *  themselves (so marks restored from a saved view count too). */
export function listHighlights(): { mark: string; style: HighlightStyle; ids: string[] }[] {
  const out = new Map<string, { mark: string; style: HighlightStyle; ids: string[] }>();
  for (const style of HIGHLIGHT_STYLES) {
    const src = managedLayer(style.layer)?.layer?.localAnnotations;
    if (!src) continue;
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
  return true;
}

export function clearHighlights() {
  for (const m of listHighlights()) removeIds(m.style, m.ids);
}
