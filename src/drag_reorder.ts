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

const ROW_SEL = '.neuroglancer-segment-list-entry';
const ID_SEL = '.neuroglancer-segment-list-entry-id';
const LIST_SEL = '.neuroglancer-segment-list';
const PREVIEW_CLASS = 'neuroglancer-preview-list';

const DRAG_THRESHOLD_PX = 4;

interface DragState {
  startX: number;
  startY: number;
  row: HTMLElement;
  list: HTMLElement;
  isDragging: boolean;
  dropLine: HTMLElement;
  /** -1 if no valid drop target; else index in the list's current row order. */
  targetIndex: number;
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

function getSelectedSegmentsSet(): {set: any; Uint64Ctor: typeof Uint64} | null {
  const viewer = (window as any)['viewer'];
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    const groupState = ml.layer?.displayState?.segmentationGroupState?.value;
    const selectedSegments = groupState?.selectedSegments;
    if (selectedSegments) return {set: selectedSegments, Uint64Ctor: Uint64};
  }
  return null;
}

function persistSelectedReorder(idsInNewOrder: string[]) {
  const got = getSelectedSegmentsSet();
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

  data.clear();
  for (const id of idsInNewOrder) {
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

  if (!isPreview) {
    // Selected list: rebuild Uint64OrderedSet, NG re-renders DOM. Then flash
    // the new (re-rendered) row by data-id, since `state.row` is gone.
    console.log('[nge-drag] persisting reorder for', ids.length, 'segments, dropping', segId);
    persistSelectedReorder(ids);
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
  }
  e.preventDefault();
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
  state.row.classList.remove('nge-drag-source');
  state.dropLine.remove();
  document.body.style.cursor = '';
  applyReorder(state);
}, true);

// Cancel an in-flight drag if the user hits Escape.
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || !drag) return;
  drag.row.classList.remove('nge-drag-source');
  drag.dropLine.remove();
  document.body.style.cursor = '';
  drag = null;
}, true);
