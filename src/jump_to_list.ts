// Alt+click on a 3D / 2D rendered panel scrolls the segment list to the segment
// under the cursor and flashes its row. Inverse of the right-click jump in
// segment_display_state/frontend.ts which jumps the camera to a segment in the list.
//
// Implementation: capture-phase mousedown intercept on rendered-data-panel
// elements. We read the segment-under-cursor from segmentSelectionState (which
// NG already maintains for hover) and look up its row by data-id. If the row
// isn't in the DOM (virtual list culled it, or segment is unstarred), a status
// message tells the user.

import {StatusMessage} from 'neuroglancer/status';

const FLASH_CLASS = 'nge-list-jump-flash';
const FADEOUT_CLASS = 'nge-list-jump-fadeout';
const FLASH_MS = 5000;
const FADEOUT_MS = 350;

let activeRow: HTMLElement | null = null;
let activeTimer: number | null = null;

function clearActiveFlash() {
  if (!activeRow) return;
  if (activeTimer !== null) {
    window.clearTimeout(activeTimer);
    activeTimer = null;
  }
  const row = activeRow;
  activeRow = null;
  row.classList.remove(FLASH_CLASS);
  // Brief fade-out so the previous highlight glides away instead of
  // cutting hard when the user moves on to another segment.
  row.classList.add(FADEOUT_CLASS);
  window.setTimeout(() => row.classList.remove(FADEOUT_CLASS), FADEOUT_MS);
}

function getSegmentUnderCursor(): string | null {
  const viewer = (window as any)['viewer'];
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    const sel = ml.layer?.displayState?.segmentSelectionState;
    if (sel?.hasSelectedSegment) return sel.selectedSegment.toString();
  }
  return null;
}

function findSegmentIndexInSet(set: any, segmentId: string): number {
  if (!set) return -1;
  let i = 0;
  for (const u of set as Iterable<{toString(): string}>) {
    if (u.toString() === segmentId) return i;
    i++;
  }
  return -1;
}

/** Returns true if at least one list was scrolled (virtual list re-render
 * pending on next frame). NG's virtual list uses an anchor-index system, so
 * direct scrollTop manipulation isn't reliable — we call the instance's own
 * scrollItemIntoView, which the patch in move_to_segment_patch.ts exposes on
 * each list element. */
function scrollSelectedListToIndex(idx: number): HTMLElement | null {
  const lists = document.querySelectorAll<HTMLElement>(
      '.neuroglancer-segment-list:not(.neuroglancer-preview-list)');
  console.log('[nge-jump] looking for VL on', lists.length, 'lists, target idx=', idx);
  for (const list of Array.from(lists)) {
    const vl = (list as any).__nge_virtualList;
    console.log('[nge-jump] list:', list.className, 'vl:', !!vl, 'has scroll API:', !!vl?.scrollItemIntoView, 'source.length:', vl?.source?.length);
    if (vl?.scrollItemIntoView) {
      vl.scrollItemIntoView(idx);
      console.log('[nge-jump] called scrollItemIntoView, anchorIndex now:', vl.state?.anchorIndex);
      return list;
    }
  }
  return null;
}

/** Try to find a row by data-id and run the callback on it; retry up to N
 * frames since NG's virtual-list re-render is debounced via animation frame
 * and may not have landed by the time we ask. */
function findRowAndApply(segmentId: string, fn: (row: HTMLElement) => void, attempts = 12) {
  const sel = `.neuroglancer-segment-list-entry[data-id="${CSS.escape(segmentId)}"]`;
  const all = document.querySelectorAll<HTMLElement>(sel);
  if (all.length > 0) {
    const target = Array.from(all).find(r => !r.closest('.neuroglancer-preview-list')) ?? all[0];
    fn(target);
    return;
  }
  if (attempts <= 0) return;
  requestAnimationFrame(() => findRowAndApply(segmentId, fn, attempts - 1));
}

function flashRow(row: HTMLElement) {
  // If the user clicks a *different* segment mid-flash, fade the old one out
  // before lighting up the new one so the eye can follow the transition.
  if (activeRow && activeRow !== row) clearActiveFlash();
  if (activeRow === row && activeTimer !== null) {
    window.clearTimeout(activeTimer);
    activeTimer = null;
  }
  row.classList.remove(FLASH_CLASS);
  row.classList.remove(FADEOUT_CLASS);
  activeRow = row;
  // Re-add on next frame so the animation restarts even on repeated clicks.
  requestAnimationFrame(() => {
    if (activeRow !== row) return;
    row.classList.add(FLASH_CLASS);
    activeTimer = window.setTimeout(() => {
      activeTimer = null;
      if (activeRow === row) {
        activeRow = null;
        row.classList.remove(FLASH_CLASS);
      }
    }, FLASH_MS);
  });
}

function scrollListToSegment(segmentId: string): boolean {
  // A segment can appear in multiple lists at once (query/preview + selected).
  // Prefer the row in the *selected* list (the one not flagged preview) since
  // that's the stable list users typically look at; if not found there, fall
  // back to the first match anywhere.
  const selector = `.neuroglancer-segment-list-entry[data-id="${CSS.escape(segmentId)}"]`;
  const all = Array.from(document.querySelectorAll<HTMLElement>(selector));

  if (all.length === 0) {
    console.log('[nge-jump] row not in DOM for segment', segmentId);
    // Row isn't in the DOM — virtual list culled it. Find the segment's index
    // in the selected list source and tell the list element to scroll there;
    // its scroll listener re-renders the visible window. Then on the next
    // frame, find the freshly-rendered row and flash it.
    const viewer = (window as any)['viewer'];
    let idx = -1;
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const groupState = ml.layer?.displayState?.segmentationGroupState?.value;
      idx = findSegmentIndexInSet(groupState?.selectedSegments, segmentId);
      if (idx >= 0) {
        console.log('[nge-jump] found in selectedSegments at idx', idx);
        break;
      }
    }
    if (idx < 0) {
      console.log('[nge-jump] not in selectedSegments either — bailing');
      return false;
    }
    const list = scrollSelectedListToIndex(idx);
    if (!list) return false;
    // Wait for NG's debounced re-render to land the new row, then flash it.
    findRowAndApply(segmentId, row => {
      row.scrollIntoView({block: 'center', behavior: 'smooth'});
      flashRow(row);
    });
    return true;
  }

  const preferred = all.find(r => !r.closest('.neuroglancer-preview-list')) ?? all[0];
  // Scroll every match into view so both lists track the segment when both
  // contain it. The user's eye lands on whichever was nearer to begin with.
  for (const r of all) {
    r.scrollIntoView({block: 'center', behavior: 'smooth'});
  }
  flashRow(preferred);
  return true;
}

window.addEventListener('mousedown', (e: MouseEvent) => {
  // Alt+left-click only — strict modifier match so we don't steal alt+shift drags etc.
  if (e.button !== 0 || !e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.neuroglancer-rendered-data-panel')) return;

  const segId = getSegmentUnderCursor();
  if (!segId) return;

  // Win against NG's rotate/translate handlers on the same mousedown.
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  if (!scrollListToSegment(segId)) {
    StatusMessage.showTemporaryMessage(
        `Segment ${segId} is not in the current list — star it or add to selected first.`,
        2500);
  }
}, /* capture */ true);
