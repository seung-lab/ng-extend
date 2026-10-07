/**
 * Hide cells by status from the segment list, by clicking the legend
 * (annkri 2026-10-07: "would be useful to also have a button to remove
 * completed cells from view"; Ames: a clickable legend, not a new button).
 *
 * With a long list of selected cells, the finished ones are in the way of the
 * ones still to do. Clicking "Proofread" or "Done" in the legend under the
 * list takes those cells out; clicking it again puts them back. Any of the
 * four kinds can be hidden.
 *
 * A cell's status is read the same way its row's Δ reads it (getCellStatus),
 * a few cells at a time so a list of a hundred does not send two hundred
 * requests at once. Nothing is changed on the server: the cells are only
 * deselected in this view.
 *
 * It is a sweep, not a standing filter: a cell selected afterwards is shown,
 * whatever its status, so selecting a cell never silently does nothing.
 */
import { Uint64 } from 'neuroglancer/util/uint64';
import { getCellStatus, type CellStatus } from '../widgets/lightbulb_service';

/** The legend's four kinds, in the Δ's own terms (button_service._applyStatus). */
export type CellKind = 'todo' | 'proofread' | 'typed' | 'done';

export function kindOf(status: CellStatus): CellKind {
  if (status.isComplete && status.cellType) return 'done';
  if (status.isComplete) return 'proofread';
  if (status.cellType) return 'typed';
  return 'todo';
}

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
  /** The layer's own selection they came from: never put back into another. */
  group: unknown;
}

/**
 * Deselect every cell of one kind. `progress(done, total)` is called as the
 * statuses come in. Resolves with what was hidden, or null when there is no
 * segmentation layer to work on.
 */
export async function hideCellsOfKind(serverUrl: string, kind: CellKind, progress?: (done: number, total: number) => void): Promise<HideResult | null> {
  const group = groupState();
  if (!group) return null;
  const ids: string[] = [];
  for (const id of group.selectedSegments) ids.push(id.toString());
  for (const id of group.visibleSegments) { const s = id.toString(); if (!ids.includes(s)) ids.push(s); }

  const match: string[] = [];
  let unread = 0, finished = 0, next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const status = await getCellStatus(serverUrl, id);
        // A status that can not be read is not a "todo": leave that cell alone.
        if (status === null) unread++;
        else if (kindOf(status) === kind) match.push(id);
      } catch { unread++; }
      progress?.(++finished, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, ids.length) }, worker));
  if (groupState() !== group) return null;        // the dataset changed while this was checking

  const wasVisible: string[] = [];
  for (const id of match) {
    const u = Uint64.parseString(id);
    if (group.visibleSegments.has(u)) { wasVisible.push(id); group.visibleSegments.delete(u); }
    group.selectedSegments.delete(u);
  }
  return { hidden: match, wasVisible, checked: ids.length, unread, group };
}

/** Put back what hideCellsOfKind took out, showing the ones that were showing.
 *  False when the layer they came from is no longer the one on screen. */
export function showHiddenCells(result: HideResult): boolean {
  const group = groupState();
  if (!group || group !== result.group) return false;
  const visible = new Set(result.wasVisible);
  for (const id of result.hidden) {
    const u = Uint64.parseString(id);
    group.selectedSegments.add(u);
    if (visible.has(id)) group.visibleSegments.add(u);
  }
  return true;
}
