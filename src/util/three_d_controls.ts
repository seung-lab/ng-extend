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

export function startThreeDControls(viewer: any) {
  const map = viewer?.inputEventBindings?.perspectiveView;
  if (!map) return;
  for (const [key, action] of BINDINGS) map.set(key, action);
}
