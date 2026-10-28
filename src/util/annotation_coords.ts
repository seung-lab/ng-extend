/**
 * Points in an annotation layer are stored in the layer's own coordinates,
 * which need not be the view's: a layer kept from another saved view can count
 * in other units (triage #281, 2026-10-28, Ames: "coords for soma I press save
 * and it puts a point off the soma"). neuroglancer's own point tool converts
 * through the layer's transform (getMousePositionInAnnotationCoordinates in
 * ui/annotations.ts); these do the same for a point Pyr places or reads.
 * Where the layer and the view agree, they change nothing.
 */
import { getChunkPositionFromCombinedGlobalLocalPositions } from 'neuroglancer/render_coordinate_transform';

/** The managed layer whose local annotations are `src`. */
function managedOf(src: any): any {
  for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (ml?.layer?.localAnnotations === src) return ml;
  }
  return null;
}
function stateOf(src: any): any {
  const states: any[] = managedOf(src)?.layer?.annotationStates?.states ?? [];
  return states.find(s => s?.source === src) ?? states[0];
}

/** A view position (the viewer's global coordinates) in the layer's own. */
export function viewToLayer(src: any, view: ArrayLike<number>): Float32Array {
  try {
    const st = stateOf(src);
    const ct = st?.chunkTransform?.value;
    if (ct && ct.error === undefined) {
      const out = new Float32Array(ct.modelTransform.unpaddedRank);
      if (getChunkPositionFromCombinedGlobalLocalPositions(out, Float32Array.from(view), st.localPosition.value,
          ct.layerRank, ct.combinedGlobalLocalToChunkTransform)) {
        return out;
      }
    }
  } catch { /* the layer is not ready: its coordinates are the view's */ }
  return Float32Array.from(view);
}

/** A point stored in the layer, as a view position: the inverse of
 *  viewToLayer, found from where it sends the origin and the three axes
 *  (the transform is affine). */
export function layerToView(src: any, p: ArrayLike<number>): number[] {
  const c = viewToLayer(src, [0, 0, 0]);
  const cols = [0, 1, 2].map(i => { const e = [0, 0, 0]; e[i] = 1; const v = viewToLayer(src, e); return [0, 1, 2].map(k => v[k] - c[k]); });
  // A[k][i] = cols[i][k]; solve A g = p - c.
  const A = [0, 1, 2].map(k => [0, 1, 2].map(i => cols[i][k]));
  const b = [0, 1, 2].map(k => p[k] - c[k]);
  const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
    + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return [p[0], p[1], p[2]];
  const solve = (col: number) => {
    const M = A.map(r => r.slice());
    for (let k = 0; k < 3; k++) M[k][col] = b[k];
    return (M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
      + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])) / det;
  };
  return [solve(0), solve(1), solve(2)];
}

/** For checking from the console (triage #281): for each annotation layer,
 *  the crosshairs in the view and in the layer's own coordinates. Where they
 *  differ, a point written without converting lands somewhere else. */
try {
  (window as any).__ngeLayerCoords = () => {
    const v = (window as any).viewer;
    const here = Array.from(v.navigationState.position.value as ArrayLike<number>).slice(0, 3).map(x => Math.round(x));
    const out: Record<string, string> = { view: here.join(', ') };
    for (const ml of v.layerManager.managedLayers) {
      const src = ml?.layer?.localAnnotations;
      if (!src || ml.archived) continue;
      out[ml.name] = Array.from(viewToLayer(src, here)).slice(0, 3).map(x => Math.round(x)).join(', ');
    }
    return out;
  };
} catch { /* no window */ }
