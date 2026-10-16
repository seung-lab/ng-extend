/**
 * Cut points left on a cell that is not shown (Ames, 2026-10-16: "pressing C
 * shows some old cell and hides the ones I'm working on; a refresh fixes it").
 *
 * Neuroglancer keeps the cut tool's red and blue points, and the cell they sit
 * on (its "focus segment"), in the layer's saved state until a cut goes
 * through. Leaving cut mode with Esc or C keeps them, and they travel with the
 * URL, share links and saved views. When cut mode opens with a focus segment
 * set, the tool shows ONLY that cell (graphene frontend.ts,
 * updateMulticutDisplay), so points from an earlier cell hide the player's
 * own. A focus segment can even be restored with no points at all.
 *
 * So when cut mode opens on a cell the player is not showing, the points are
 * cleared and kept here, so the cut bar can offer Undo. Points on a cell that
 * is shown are never touched.
 */

/** What was cleared, as neuroglancer's own JSON, for Undo. */
let saved: { layer: any; json: any } | null = null;

function multicutStateOf(layer: any): any {
  return layer?.graphConnection?.value?.state?.multicutState;
}

/** The cells the player is showing, the set the cut tool itself starts from. */
function visibleSegmentsOf(layer: any): any {
  return layer?.graphConnection?.value?.segmentsState?.visibleSegments
    ?? layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
}

/**
 * Called once as cut mode opens. Returns null when nothing was left over, or
 * the number of points cleared (0 when the old cell had no points).
 */
export function clearStaleCutPoints(layer: any): number | null {
  const ms = multicutStateOf(layer);
  const focus = ms?.focusSegment?.value;
  if (!ms || focus === undefined) return null;
  const visible = visibleSegmentsOf(layer);
  if (!visible || visible.has(focus)) return null;
  const count = (ms.sinks?.size ?? 0) + (ms.sources?.size ?? 0);
  saved = count > 0 ? { layer, json: ms.toJSON() } : null;
  ms.reset();
  return count;
}

/** Put the cleared points back. The cut tool then shows their cell again. */
export function undoStaleCutClear(): boolean {
  if (!saved) return false;
  const { layer, json } = saved;
  saved = null;
  const ms = multicutStateOf(layer);
  if (!ms) return false;
  try { ms.restoreState(json); return true; } catch (e) {
    console.warn('[stale cut points] could not put the points back:', e);
    return false;
  }
}

/** Undo is offered only while the bar says so. */
export function forgetStaleCutClear() {
  saved = null;
}
