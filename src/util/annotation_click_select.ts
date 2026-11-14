/**
 * Click an annotation in the 2D or 3D view and it is selected in the list:
 * its layer's Annotations tab comes forward and the list scrolls to it
 * (Nseraf 2026-10-10: "left mouse clicking an annotation in 2/3D selects it
 * on the list to the right and moves/scrolls the list so that it's visible").
 * Until now that took a double click, or Ctrl plus a right click.
 *
 * A click, not a drag: the mouse must come up where it went down, quickly,
 * with no modifier key. Dragging the view, Ctrl+click tools (merge, cut,
 * placing an annotation) and Alt+click (jump to a segment in the list) are
 * left exactly as they are.
 *
 * Highlight strokes are skipped. A highlight is a chain of many short lines,
 * and selecting one of them is never what a click on a painted branch means.
 */
const MAX_MOVE_PX = 4;
const MAX_MS = 450;

interface Down { x: number; y: number; at: number; }

function annotationUnderMouse(viewer: any): { managed: any; state: any; id: string } | null {
  const mouse = viewer?.mouseState;
  // What is under the mouse is read from the last frame drawn for picking,
  // and on a slow tab that can be behind the mouse (Nseraf 2026-11-10, report
  // "left click select annotation buggy": sometimes a click did not select).
  // Read it again at the mouse's position now.
  try { mouse?.updateUnconditionally?.(); } catch { /* keep what it has */ }
  const id = mouse?.pickedAnnotationId;
  const state = mouse?.pickedAnnotationLayer;
  if (!mouse?.active || id === undefined || id === null || !state) return null;
  if (/^hl[_-]/.test(String(id))) return null;
  for (const managed of viewer.layerManager?.managedLayers ?? []) {
    const states = managed.layer?.annotationStates?.states;
    if (Array.isArray(states) && states.includes(state)) return { managed, state, id: String(id) };
  }
  // An annotation of a tool's own (a merge line, a cut point): not in any list.
  return null;
}

export function startAnnotationClickSelect(viewer: any) {
  let down: Down | null = null;
  window.addEventListener('mousedown', (e: MouseEvent) => {
    down = null;
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    if (!(e.target as HTMLElement | null)?.closest?.('.neuroglancer-rendered-data-panel')) return;
    // The event's own time, not the time it is handled: a page busy for a
    // moment (a big MEC view in Firefox) made a quick click look slow.
    down = { x: e.clientX, y: e.clientY, at: e.timeStamp };
  }, true);
  window.addEventListener('mouseup', (e: MouseEvent) => {
    const d = down;
    down = null;
    if (!d || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > MAX_MOVE_PX || e.timeStamp - d.at > MAX_MS) return;
    // Nothing found yet may only mean the picking frame is not drawn: look
    // again for a few frames while the mouse stays where it was clicked.
    let tries = 0;
    const look = () => {
      let hit: ReturnType<typeof annotationUnderMouse> = null;
      try { hit = annotationUnderMouse(viewer); } catch { /* nothing under the mouse */ }
      if (hit) { select(hit); return; }
      const m = viewer?.mouseState;
      const moved = m?.pageX !== undefined && Math.hypot(m.pageX - e.pageX, m.pageY - e.pageY) > MAX_MOVE_PX;
      if (++tries < 6 && !moved && down === null) requestAnimationFrame(look);
    };
    look();
  }, true);
  const select = (hit: { managed: any; state: any; id: string }) => {
    const { managed, state, id } = hit;
    try {
      // Bring the layer's list forward if another layer's panel is showing.
      const sel = viewer.selectedLayer;
      if (sel && sel.layer !== managed) sel.layer = managed;
      if (sel && !sel.visible) sel.visible = true;
      // A cell layer has no Annotations tab (its box is in Render): leave its tab alone.
      try { if (managed.layer.tabs?.options?.has('annotations') && managed.layer.tabs.value !== 'annotations') managed.layer.tabs.value = 'annotations'; } catch { /* no such tab */ }
      managed.layer.selectAnnotation(state, id, true);
      // The list scrolls to the row itself (third_party/neuroglancer/ui/annotations.ts),
      // waiting for its panel if that had to be brought forward first.
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('nge-annotation-reveal', { detail: { state, id } })));
    } catch (err) {
      console.warn('[annotation click] could not select', err);
    }
  };
}
