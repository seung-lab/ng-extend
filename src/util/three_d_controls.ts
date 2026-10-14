/**
 * The mouse in the 3D view (Ames 2026-10-14): scroll zooms, and dragging with
 * the right button slides the view, as in most 3D programs. A right click
 * without a drag still centres the view on the spot clicked. Only over the 3D
 * view: the 2D views keep scroll for moving through the sections.
 *
 * Neuroglancer's own controls (scroll moves the view along the line of sight,
 * Ctrl+scroll zooms, Shift+drag slides) are a Settings switch, "Classic
 * neuroglancer 3D controls". Ctrl+scroll and Shift+drag work either way, so a
 * trackpad pinch (which arrives as Ctrl+scroll) always zooms.
 */
import { useUserPreferencesStore } from '../store';
import { watch } from 'vue';

const PYR_BINDINGS: [string, any][] = [
  ['at:wheel', { action: 'zoom-via-wheel', preventDefault: true }],
  ['at:mousedown2', 'nge-pan-or-center'],
];

/** True when the player chose neuroglancer's own 3D controls. */
export function classic3dControls(): boolean {
  try { return useUserPreferencesStore().prefs.classic3dControls === true; } catch { return false; }
}

function apply(viewer: any, classic: boolean) {
  const map = viewer?.inputEventBindings?.perspectiveView;
  if (!map) return;
  for (const [key, action] of PYR_BINDINGS) {
    // Classic: take ours away, so neuroglancer's own (inherited) ones apply.
    if (classic) map.delete(key);
    else map.set(key, action);
  }
}

export function startThreeDControls(viewer: any) {
  apply(viewer, classic3dControls());
  try {
    watch(() => useUserPreferencesStore().prefs.classic3dControls, on => apply(viewer, on === true));
  } catch { /* the store is not ready: the first choice stays */ }
}

/** Tutorial and tour wording that follows the player's choice. */
export const zoom3dWords = () => (classic3dControls() ? 'CTRL+SCROLL' : 'SCROLL');
export const pan3dWords = () => (classic3dControls() ? 'SHIFT+DRAG' : 'RIGHT-DRAG');
