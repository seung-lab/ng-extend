/**
 * One tap does what Ctrl+click does, on a touch screen with no keyboard
 * (Nseraf, report 135, on a Galaxy Tab). Cut, Merge and Find Path bind their
 * own taps (graphene frontend.ts, ngeBindTapToPlace) and win over these,
 * because tool maps sit above the viewer's own bindings. Everything else
 * that places a point with Ctrl+click comes here:
 *   · Highlight, while its box is open (it registers a claim), the same
 *     order as on a desktop, where Highlight takes Ctrl+click first;
 *   · the selected layer's annotation tool (neuroglancer's "annotate").
 * A tap with nothing to place does nothing, as before.
 *
 * The same rule as in Cut: the point waits a moment, a second tap inside
 * that moment takes it back and shows or hides the segment (neuroglancer's
 * own double tap), and a second tap after the point is placed is a new tap.
 */

const TAP_WAIT_MS = 300;
/** neuroglancer's multiTapMaxInterval: a second tap within this is a "double tap". */
const DOUBLE_TAP_MS = 500;

/** Returns what a tap at (x, y) would place, or null to pass. */
export type TapClaim = (x: number, y: number) => (() => void) | null;
const claims: TapClaim[] = [];

/** Highlight registers while its box is open; the returned function unregisters. */
export function claimTouchTaps(claim: TapClaim): () => void {
  claims.unshift(claim);
  return () => { const i = claims.indexOf(claim); if (i >= 0) claims.splice(i, 1); };
}

export function installTouchTap(viewer: any) {
  const placerFor = (x: number, y: number): (() => void) | null => {
    for (const claim of claims) {
      const place = claim(x, y);
      if (place) return place;
    }
    const tool = viewer.selectedLayer?.layer?.layer?.tool?.value;
    if (tool && typeof tool.trigger === 'function') return () => tool.trigger(viewer.mouseState);
    return null;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let placedAt = 0;
  const schedule = (place: () => void) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; placedAt = Date.now(); place(); }, TAP_WAIT_MS);
  };
  const select = () => {
    viewer.mouseState.updateUnconditionally();
    viewer.layerManager.invokeAction('select');
  };
  const at = (e: any) => [e?.detail?.centerX ?? 0, e?.detail?.centerY ?? 0] as const;

  for (const map of [viewer.inputEventBindings.sliceView, viewer.inputEventBindings.perspectiveView]) {
    map.set('at:touchtap1x1', 'nge-tap');
    map.set('at:touchtap1x2', 'nge-tap-double');
  }
  viewer.bindAction('nge-tap', (e: any) => {
    const place = placerFor(...at(e));
    if (place) schedule(place);
  });
  viewer.bindAction('nge-tap-double', (e: any) => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; select(); return; }
    if (Date.now() - placedAt < DOUBLE_TAP_MS) {
      const place = placerFor(...at(e));
      if (place) { schedule(place); return; }
    }
    select();
  });
}
