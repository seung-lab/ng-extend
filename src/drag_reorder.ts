// Drag-to-reorder segment rows. Click the segment ID chip and drag a row
// up/down within its list to a new position. On drop the underlying
// Uint64OrderedSet is rebuilt in the new order, which makes NG's StarredSegments
// list source re-render with the new sequence and the change survives layer
// state JSON roundtrips.
//
// Design notes:
// - Trigger is the .neuroglancer-segment-list-entry-id chip only — not the
//   whole row — so the lightbulb / jump / star buttons stay clickable.
// - Drag is intra-list. We never move a row from preview→selected or vice
//   versa, since cross-list moves don't have a clean semantic in NG's data
//   model (the lists back to different watchables).
// - Preview-list reorder is visual only. The query result drives ordering and
//   re-runs on edit, so any reorder there will be transient — we still let it
//   happen because the UX feels broken if drag silently does nothing.

import {Uint64} from 'neuroglancer/util/uint64';
import {pickedSegments, touchPick} from 'neuroglancer/ui/nge_segment_folders';
import {getPastedSegments} from 'neuroglancer/ui/nge_pasted_segments';
import {ngeConfirm} from 'neuroglancer/ui/nge_confirm';

const ROW_SEL = '.neuroglancer-segment-list-entry';
const ID_SEL = '.neuroglancer-segment-list-entry-id';
const LIST_SEL = '.neuroglancer-segment-list';
const PREVIEW_CLASS = 'neuroglancer-preview-list';

const DRAG_THRESHOLD_PX = 4;

const FOLDER_DROP_SEL = '[data-nge-folder-drop]';
const FOLDER_HOVER_CLASS = 'nge-folder-drop-target';

function folderHeadingAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (el?.closest(FOLDER_DROP_SEL) as HTMLElement | null) ?? null;
}

interface DragState {
  startX: number;
  startY: number;
  row: HTMLElement;
  list: HTMLElement;
  isDragging: boolean;
  dropLine: HTMLElement;
  /** -1 if no valid drop target; else index in the list's current row order. */
  targetIndex: number;
  /** A section heading under the pointer: the cell goes into that folder. */
  folderTarget: HTMLElement | null;
}

let drag: DragState | null = null;

function createDropLine(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'nge-drop-line';
  return el;
}

function rowsInList(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(ROW_SEL));
}

function pickTargetIndex(list: HTMLElement, sourceRow: HTMLElement, clientY: number)
    : {index: number; lineTop: number} {
  const rows = rowsInList(list);
  let lineTop = 0;
  let index = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rect = r.getBoundingClientRect();
    if (r === sourceRow) {
      lineTop = rect.bottom;
      continue;
    }
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) {
      index = i;
      lineTop = rect.top;
      return {index, lineTop};
    }
    lineTop = rect.bottom;
  }
  return {index, lineTop};
}

/** The segmentation group a Seg panel row belongs to: the layer whose side
 *  panel is open, else the first segmentation layer. */
function groupFor(row?: Element | null): any {
  const viewer = (window as any)['viewer'];
  if (row?.closest('.neuroglancer-segment-display-tab')) {
    const g = viewer?.selectedLayer?.layer?.layer?.displayState?.segmentationGroupState?.value;
    if (g?.selectedSegments) return g;
  }
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    const g = ml.layer?.displayState?.segmentationGroupState?.value;
    if (g?.selectedSegments) return g;
  }
  return undefined;
}

/** `full` with `moved` put next to the neighbour it has in `shown`. */
function placeNextTo(full: string[], moved: string, shown: string[]): string[] {
  if (!full.includes(moved)) return full;
  const at = shown.indexOf(moved);
  const next = shown.slice(at + 1).find(id => id !== moved && full.includes(id));
  const prev = shown.slice(0, at).reverse().find(id => id !== moved && full.includes(id));
  const order = full.filter(id => id !== moved);
  if (next !== undefined) order.splice(order.indexOf(next), 0, moved);
  else if (prev !== undefined) order.splice(order.indexOf(prev) + 1, 0, moved);
  else order.push(moved);
  return order;
}

function getSelectedSegmentsSet(row?: Element | null): {set: any; Uint64Ctor: typeof Uint64} | null {
  const g = groupFor(row);
  if (g) return {set: g.selectedSegments, Uint64Ctor: Uint64};
  const viewer = (window as any)['viewer'];
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    const groupState = ml.layer?.displayState?.segmentationGroupState?.value;
    const selectedSegments = groupState?.selectedSegments;
    if (selectedSegments) return {set: selectedSegments, Uint64Ctor: Uint64};
  }
  return null;
}

function persistSelectedReorder(idsInNewOrder: string[], movedId?: string, row?: Element | null) {
  const got = getSelectedSegmentsSet(row);
  if (!got) return;
  const {set} = got;
  // Reach into the OrderedSet's private Map. We can't use .clear() + .add()
  // because selectedSegments.clear() cascades to visibleSegments.clear() in
  // SegmentationUserLayer (every eyeball flips off). Mutating the Map directly
  // and then firing a synthetic "add" signal sidesteps the remove cascade
  // entirely while still triggering the StarredSegments list re-render.
  const data = (set as any).data as Map<bigint, Uint64> | undefined;
  const changed = (set as any).changed as {dispatch: (...a: any[]) => void} | undefined;
  if (!data || !changed) return;

  const byId = new Map<string, Uint64>();
  for (const u of data.values()) byId.set(u.toString(), u);
  if (!idsInNewOrder.every(id => byId.has(id))) return;

  // Only the rows on screen in one section are in `idsInNewOrder`. Keep every
  // other cell where it is and move the dragged one next to its new
  // neighbour: rebuilding from the visible rows alone dropped every cell
  // scrolled out of sight, or in another section, from the list.
  const full = [...byId.keys()];
  const order = movedId !== undefined ? placeNextTo(full, movedId, idsInNewOrder) : full;
  data.clear();
  for (const id of order) {
    const u = byId.get(id);
    if (u) data.set(BigInt(id), u);
  }
  // `add=true` so the cascade in segmentation_user_layer.ts (which only acts
  // on remove) doesn't fire. Args are otherwise unused by the listeners we
  // care about — they just re-read the now-reordered set.
  console.log('[nge-drag] dispatching reorder signal, set.size=', data.size);
  changed.dispatch(Array.from(data.values()), true);
}

function flashByDataId(segmentId: string, attempts = 30) {
  // NG's virtual-list re-render is animation-frame-debounced. After our
  // synthetic dispatch the row may take 2-3 frames to appear in DOM, so retry
  // up to ~500ms (30 frames at 60Hz) before giving up.
  const sel = `${ROW_SEL}[data-id="${CSS.escape(segmentId)}"]`;
  const matches = document.querySelectorAll<HTMLElement>(sel);
  if (matches.length > 0) {
    console.log('[nge-drag] flashing', matches.length, 'row(s) for', segmentId);
    matches.forEach(r => {
      r.classList.remove('nge-drop-flash');
      void r.offsetWidth;  // force reflow so the animation restarts cleanly
      r.classList.add('nge-drop-flash');
      window.setTimeout(() => r.classList.remove('nge-drop-flash'), 2500);
    });
    return;
  }
  if (attempts <= 0) {
    console.log('[nge-drag] gave up looking for row', segmentId, '— DOM never repopulated');
    return;
  }
  requestAnimationFrame(() => flashByDataId(segmentId, attempts - 1));
}

function applyReorder(state: DragState) {
  const rows = rowsInList(state.list);
  const sourceIdx = rows.indexOf(state.row);
  let target = state.targetIndex;
  if (sourceIdx < 0 || target < 0) return;
  if (target === sourceIdx || target === sourceIdx + 1) return;

  const segId = state.row.getAttribute('data-id');
  if (!segId) return;

  const isPreview = state.list.classList.contains(PREVIEW_CLASS);

  // Compute the new id ordering (only for the rows we have in DOM).
  const ids = rows.map(r => r.getAttribute('data-id') || '');
  const [moved] = ids.splice(sourceIdx, 1);
  const adjusted = target > sourceIdx ? target - 1 : target;
  ids.splice(adjusted, 0, moved);

  if (state.list.classList.contains('nge-seg-list--pasted')) {
    // The Pasted list is drawn in its own order (newest paste first).
    const g = groupFor(state.row);
    if (!g) return;
    const p = getPastedSegments(g);
    p.ids = placeNextTo(p.ids, segId, ids);
    p.changed.dispatch();
    flashByDataId(segId);
  } else if (!isPreview) {
    // Selected list: rebuild Uint64OrderedSet, NG re-renders DOM. Then flash
    // the new (re-rendered) row by data-id, since `state.row` is gone.
    persistSelectedReorder(ids, segId, state.row);
    flashByDataId(segId);
  } else {
    // Preview/query list: visual reorder via DOM move. NG's query re-render
    // may eventually overwrite this — known v1 limitation.
    const refRow = rows[adjusted + (target > sourceIdx ? 1 : 0)] || null;
    state.list.insertBefore(state.row, refRow);
    state.row.classList.remove('nge-drop-flash');
    void state.row.offsetWidth;
    state.row.classList.add('nge-drop-flash');
    window.setTimeout(() => state.row.classList.remove('nge-drop-flash'), 2500);
  }
}

document.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button !== 0 || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const idChip = target.closest(ID_SEL) as HTMLElement | null;
  if (!idChip) return;
  const row = idChip.closest(ROW_SEL) as HTMLElement | null;
  if (!row) return;
  const list = row.closest(LIST_SEL) as HTMLElement | null;
  if (!list) return;

  drag = {
    startX: e.clientX,
    startY: e.clientY,
    row,
    list,
    isDragging: false,
    dropLine: createDropLine(),
    targetIndex: -1,
    folderTarget: null,
  };
}, true);

document.addEventListener('mousemove', (e: MouseEvent) => {
  if (!drag) return;
  if (!drag.isDragging) {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    // Promote to a real drag.
    drag.isDragging = true;
    drag.row.classList.add('nge-drag-source');
    document.body.appendChild(drag.dropLine);
    document.body.style.cursor = 'grabbing';
    document.body.classList.add('nge-row-dragging');
  }
  e.preventDefault();
  const heading = folderHeadingAt(e.clientX, e.clientY);
  if (heading !== drag.folderTarget) {
    drag.folderTarget?.classList.remove(FOLDER_HOVER_CLASS);
    drag.folderTarget = heading;
    heading?.classList.add(FOLDER_HOVER_CLASS);
  }
  drag.dropLine.style.display = heading ? 'none' : '';
  if (heading) return;
  const {index, lineTop} = pickTargetIndex(drag.list, drag.row, e.clientY);
  drag.targetIndex = index;
  const listRect = drag.list.getBoundingClientRect();
  // Clamp so the line stays inside the list bounds even when the cursor wanders.
  const clampedTop = Math.max(listRect.top, Math.min(listRect.bottom - 2, lineTop));
  drag.dropLine.style.top = `${clampedTop - 1}px`;
  drag.dropLine.style.left = `${listRect.left}px`;
  drag.dropLine.style.width = `${listRect.width}px`;
}, true);

document.addEventListener('mouseup', (e: MouseEvent) => {
  if (!drag) return;
  const state = drag;
  drag = null;

  if (!state.isDragging) {
    // Below-threshold release — treat as a normal click, don't intercept.
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  justDragged = performance.now();
  state.row.classList.remove('nge-drag-source');
  state.dropLine.remove();
  document.body.style.cursor = '';
  document.body.classList.remove('nge-row-dragging');
  if (state.folderTarget) {
    state.folderTarget.classList.remove(FOLDER_HOVER_CLASS);
    const segId = state.row.getAttribute('data-id');
    if (segId) {
      // A picked cell carries every picked cell with it.
      const segIds = pickedSegments.ids.has(segId) ? [...pickedSegments.ids] : [segId];
      state.folderTarget.dispatchEvent(new CustomEvent('nge-folder-drop', {detail: {segIds}}));
      flashByDataId(segId);
    }
    return;
  }
  applyReorder(state);
}, true);

// A click on a cell's ID chip (not a drag) opens its Δ menu (Ames
// 2026-10-14: "Should we make it so that you can click on a seg ID to bring
// up the delta menu?"). Opened after the click has finished, so the menu's
// own click-outside check does not shut it again at once.
let justDragged = 0;

// Ctrl+click (Cmd+click on a Mac) picks or unpicks a cell; Shift+click picks
// every cell between the last one clicked and this one, in the same section.
// Buttons on the row (eye, copy, remove, jump, Δ) keep their own clicks.
const ROW_BUTTONS = 'button, .neuroglancer-icon, input, .nge-seg-list-toggle';
function pickTarget(e: MouseEvent): HTMLElement | null {
  const t = e.target as HTMLElement | null;
  if (!t || t.closest(ROW_BUTTONS)) return null;
  // Only the Seg panel's lists: segment rows elsewhere (selection details,
  // an annotation's segments) keep their own Ctrl and Shift clicks.
  if (!t.closest('.neuroglancer-segment-display-tab')) return null;
  const row = t.closest(ROW_SEL) as HTMLElement | null;
  return row?.getAttribute('data-id') ? row : null;
}
// Select mode (touch screens, report 146): a plain tap picks, as Ctrl+click.
const picking = (e: MouseEvent) => e.ctrlKey || e.metaKey || e.shiftKey || touchPick.on;
document.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button !== 0 || !picking(e) || e.altKey) return;
  if (!pickTarget(e)) return;
  // neuroglancer's own Ctrl/Shift row clicks stay out of it
  e.preventDefault();
  e.stopPropagation();
}, true);
document.addEventListener('click', (e: MouseEvent) => {
  if (e.button !== 0 || !picking(e) || e.altKey) return;
  const row = pickTarget(e);
  const id = row?.getAttribute('data-id');
  if (!row || !id) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.shiftKey && pickedSegments.anchor) {
    const list = row.closest(LIST_SEL);
    const ids = list ? rowsInList(list as HTMLElement).map(r => r.getAttribute('data-id') || '') : [];
    const a = ids.indexOf(pickedSegments.anchor);
    const b = ids.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      pickedSegments.set([...pickedSegments.ids, ...ids.slice(lo, hi + 1)]);
      return;
    }
  }
  pickedSegments.toggle(id);
}, true);

document.addEventListener('click', (e: MouseEvent) => {
  if (e.button !== 0 || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || touchPick.on) return;
  if (performance.now() - justDragged < 300) return;
  const chip = (e.target as HTMLElement | null)?.closest(ID_SEL);
  if (!chip) return;
  pickedSegments.clear();
  const row = chip.closest(ROW_SEL);
  const delta = row?.querySelector<HTMLElement>('.nge-lb-btn');
  if (!delta) return;
  window.setTimeout(() => delta.click(), 0);
}, true);

// Cancel an in-flight drag if the user hits Escape.
// Esc unpicks; Delete takes the picked cells out of the view (asking first
// when there is more than one). Never while typing.
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (!pickedSegments.ids.size || drag) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
  if (e.key === 'Escape') {
    pickedSegments.clear();
    return;
  }
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const panel = document.querySelector('.neuroglancer-segment-display-tab');
  const got = getSelectedSegmentsSet(panel);
  if (!got) return;
  const ids = [...pickedSegments.ids].map(s => Uint64.parseString(s)).filter(id => got.set.has(id));
  if (!ids.length) {
    pickedSegments.clear();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const remove = () => {
    got.set.delete(ids);
    pickedSegments.clear();
  };
  if (ids.length > 1) {
    void ngeConfirm(`Remove ${ids.length} cells from the view?`, {title: 'Remove cells'})
        .then(yes => { if (yes) remove(); });
  } else {
    remove();
  }
}, true);

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || !drag) return;
  drag.folderTarget?.classList.remove(FOLDER_HOVER_CLASS);
  drag.row.classList.remove('nge-drag-source');
  drag.dropLine.remove();
  document.body.style.cursor = '';
  document.body.classList.remove('nge-row-dragging');
  drag = null;
}, true);
