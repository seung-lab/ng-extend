/**
 * "Hide completed": take every cell already marked proofread out of the
 * segment list (annkri 2026-10-07: "would be useful to also have a button to
 * remove completed cells from view"). With a long list of selected cells,
 * the finished ones are in the way of the ones still to do.
 *
 * A cell's completion is read the same way its row's Δ reads it
 * (getCellStatus), a few cells at a time so a list of a hundred does not send
 * two hundred requests at once. Nothing is changed on the server: the cells
 * are only deselected in this view, and the same button puts them back.
 */
import { Uint64 } from 'neuroglancer/util/uint64';
import { getCellStatus } from '../widgets/lightbulb_service';

const AT_ONCE = 6;

function groupState(): any {
  const viewer: any = (window as any).viewer;
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    if (ml.archived || ml.layer?.constructor?.type !== 'segmentation') continue;
    const g = ml.layer?.displayState?.segmentationGroupState?.value;
    if (g?.selectedSegments && g?.visibleSegments) return g;
  }
  return null;
}

export interface HideResult {
  /** Ids taken out of the list. */
  hidden: string[];
  /** Which of them were showing (eye on) before, so they can be put back as they were. */
  wasVisible: string[];
  checked: number;
  /** Cells whose status could not be read; they are left in the list. */
  unread: number;
}

/**
 * Deselect every completed cell. `progress(done, total)` is called as the
 * statuses come in. Resolves with what was hidden, or null when there is no
 * segmentation layer to work on.
 */
export async function hideCompletedCells(serverUrl: string, progress?: (done: number, total: number) => void): Promise<HideResult | null> {
  const group = groupState();
  if (!group) return null;
  const ids: string[] = [];
  for (const id of group.selectedSegments) ids.push(id.toString());
  for (const id of group.visibleSegments) { const s = id.toString(); if (!ids.includes(s)) ids.push(s); }

  const done: string[] = [];
  let unread = 0, finished = 0, next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const status = await getCellStatus(serverUrl, id);
        if (status === null) unread++;
        else if (status.isComplete) done.push(id);
      } catch { unread++; }
      progress?.(++finished, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, ids.length) }, worker));

  const wasVisible: string[] = [];
  for (const id of done) {
    const u = Uint64.parseString(id);
    if (group.visibleSegments.has(u)) { wasVisible.push(id); group.visibleSegments.delete(u); }
    group.selectedSegments.delete(u);
  }
  return { hidden: done, wasVisible, checked: ids.length, unread };
}

/** Put back what hideCompletedCells took out, showing the ones that were showing. */
export function showHiddenCells(result: HideResult) {
  const group = groupState();
  if (!group) return;
  const visible = new Set(result.wasVisible);
  for (const id of result.hidden) {
    const u = Uint64.parseString(id);
    group.selectedSegments.add(u);
    if (visible.has(id)) group.visibleSegments.add(u);
  }
}
