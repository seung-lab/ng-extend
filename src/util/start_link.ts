/**
 * A Cell Library cell's curated starting view (the sheet's "Start link"): the
 * view with its Soma / True End / Can't Fix / Hits Edge / Notes annotation
 * layers. Claiming from the Cell Library opens it; claiming the same cell
 * from the Delta menu did not, so the layers were missing until the cell was
 * reopened from the library (Annkri 2026-10-01).
 */
import { useProofreadingQueueStore } from '../store';
import { getDatasetCaveConfig } from '../config';
import { currentDatasetTag } from '../datasets';
import { ancestorAmong } from '../widgets/pcg_service';
import { snapshotDisplay, restoreDisplayAfterLoad, keepDisplayEnabled } from './keep_display';

/** The Start link of the sheet row for this segment, or '' when the cell is
 *  not a Cell Library cell (or its dataset has no segment sheet, e.g. MEC). */
export async function startLinkForSegment(segId: string): Promise<string> {
  try {
    const dataset = currentDatasetTag();
    const sheetUrl = getDatasetCaveConfig(dataset).cellLibrarySheetUrl;
    if (!sheetUrl) return '';
    const queue = useProofreadingQueueStore();
    if (queue.sheetUrl !== sheetUrl || !queue.items.length) await queue.loadFromSheet(sheetUrl, dataset);
    const rows = queue.items;
    let row = rows.find(r => r.segId === segId || r.finalSegId === segId);
    if (!row && rows.length) {
      // Edited since it was listed: the sheet's Start SegID is an ancestor.
      const hit = await ancestorAmong(segId, rows.map(r => r.segId));
      if (hit) row = rows.find(r => r.segId === hit);
    }
    return row?.startLink || '';
  } catch (e) {
    console.warn('[startLink] lookup failed:', e);
    return '';
  }
}

/** Load a share link's state in place (no reload), keeping the player's own
 *  display settings when that preference is on. False when it is not a link
 *  we can open. Same behaviour as the Cell Library's Claim. */
export function openStartLink(link?: string): boolean {
  if (!link) return false;
  try {
    const hash = new URL(link).hash;
    if (!hash.startsWith('#!')) return false;
    const snap = keepDisplayEnabled() ? snapshotDisplay() : null;
    window.location.hash = hash;
    restoreDisplayAfterLoad(snap);
    return true;
  } catch { return false; }
}
