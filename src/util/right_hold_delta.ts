/**
 * Hold the right mouse button on a cell, in the 3D or a 2D view, and its Δ
 * menu opens, without finding the cell's row in the segment list first
 * (Nseraf #572). A right click, or a right drag, does what it always has:
 * the hold opens the menu only if the mouse stays still for HOLD_MS.
 *
 * In 3D a right click centers the view when the button comes up; after a
 * hold it does not (rendered_data_panel.ts reads rightHoldFired()).
 */
import {currentSegLayer} from '../datasets';
import {useLayersStore} from '../store';

const HOLD_MS = 500;
/** How far the mouse may wander, in pixels, and still count as held. */
const STILL_PX = 6;

let fired = false;
/** True from a hold's menu opening until the next right button press. */
export function rightHoldFired(): boolean { return fired; }
(window as any).__ngeRightHoldFired = rightHoldFired;

/** The cell under the mouse: the one neuroglancer highlights there. */
function cellUnderMouse(): string | null {
  const layer = currentSegLayer()?.layer;
  const sel = layer?.displayState?.segmentSelectionState;
  if (!sel?.hasSelectedSegment) return null;
  const id = sel.selectedSegment;
  if (!id || (id.low === 0 && id.high === 0)) return null;
  return id.toString();
}

function openMenu(id: string) {
  const viewer = (window as any).viewer;
  const svc = viewer?.buttonService;
  if (!svc?.openMenuFor) return;
  const layerName = viewer.selectedLayer?.layer?.name || currentSegLayer()?.name || 'default';
  const dataset = (typeof DATASETS !== 'undefined' && DATASETS) ? (DATASETS[layerName] ?? '') : '';
  svc.openMenuFor(id, useLayersStore().getCaveServerUrl(), dataset);
}

declare const DATASETS: {[key: string]: string} | undefined;

let started = false;
export function startRightHoldDelta() {
  if (started) return;
  started = true;
  window.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 2) return;
    fired = false;
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const target = e.target as Element | null;
    if (!target?.closest?.('.neuroglancer-rendered-data-panel')) return;
    // Taken now: in 2D a right click moves the view at once, and the cell
    // under the mouse then is another.
    const id = cellUnderMouse();
    if (!id) return;
    let travelled = 0;
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('blur', stop);
    };
    const onMove = (m: PointerEvent) => {
      // movementX works when the drag locks the pointer, as clientX does not
      travelled += Math.abs(m.movementX) + Math.abs(m.movementY);
      if (travelled > STILL_PX) stop();
    };
    const timer = window.setTimeout(() => {
      stop();
      fired = true;
      openMenu(id);
    }, HOLD_MS);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', stop, true);
    window.addEventListener('blur', stop);
  }, true);
}
