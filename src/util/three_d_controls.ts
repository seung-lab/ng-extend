import { currentSegLayerName } from '../datasets';
/**
 * The mouse in the 3D view (Ames 2026-10-14): scroll zooms, and dragging with
 * the right button slides the view, as in most 3D programs. A right click
 * without a drag still centres the view on the spot clicked. Only over the 3D
 * view: the 2D views keep scroll for moving through the sections.
 *
 * Neuroglancer's own Ctrl+scroll (zoom) and Shift+drag (slide) keep working
 * alongside, so there is nothing to switch (Ames: "make Ctrl + Scroll also
 * work and shift click and drag also just work by default ... then we
 * wouldn't even need those settings toggles"). A trackpad pinch arrives as
 * Ctrl+scroll, so it zooms too.
 */
const BINDINGS: [string, any][] = [
  ['at:wheel', { action: 'zoom-via-wheel', preventDefault: true }],
  ['at:mousedown2', 'nge-pan-or-center'],
];

/** How far the 3D view may zoom, in its own units. The widest dataset start
 *  is 300000 (config/default-settings.json); ten times that is far enough
 *  to see any of them whole. Past it the cells are too small to see, and a
 *  view saved that far out opened with an empty 3D view (Nseraf #182: 1.4e14). */
const ZOOM_3D_MIN = 10;
const ZOOM_3D_MAX = 3e6;
declare const DEFAULT_SETTINGS: { [key: string]: any };
/** The dataset's own 3D start, for a view far past the limit. */
function startZoom(): number {
  try {
    const z = Number(DEFAULT_SETTINGS[currentSegLayerName()]?.projectionScale);
    if (Number.isFinite(z) && z >= ZOOM_3D_MIN && z <= ZOOM_3D_MAX) return z;
  } catch { /* no settings */ }
  return 30000;
}

export function startThreeDControls(viewer: any) {
  const map = viewer?.inputEventBindings?.perspectiveView;
  if (map) for (const [key, action] of BINDINGS) map.set(key, action);
  // Keep the 3D zoom in range, however it got there: the wheel, a pinch, or
  // a saved view or link from before this limit.
  const scale = viewer?.projectionScale;
  if (!scale?.changed) return;
  const clamp = () => {
    const v = scale.value;
    // Not set yet: neuroglancer picks its own start from the data.
    if (!Number.isFinite(v)) return;
    // Far past the limit (a saved view): back to the dataset's own start.
    // Just past it (zooming out): stop at the limit.
    if (v > ZOOM_3D_MAX * 10) scale.value = startZoom();
    else if (v > ZOOM_3D_MAX) scale.value = ZOOM_3D_MAX;
    else if (v < ZOOM_3D_MIN) scale.value = ZOOM_3D_MIN;
  };
  scale.changed.add(clamp);
  clamp();
}
