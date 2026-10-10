/**
 * Completions from the Delta menu (Amy 2026-09-28: "use the Delta menu for
 * completions; write to the spreadsheet with the NG state link, ID, segID").
 *
 * "Mark as Proofread" in the Delta menu (and the Cell Profile) writes CAVE as
 * before. When the cell is a row of the dataset's Cell Library sheet it ALSO:
 *   1. finds that row, following the edit history when proofreading gave the
 *      cell a new root id (PCG lineage, see ancestorAmong),
 *   2. claims the row for you if nobody holds it (or uses your claim),
 *   3. marks the claim complete with the current root as the final segment,
 *   4. writes the sheet: Proofreader, Status, Date Complete, Final SegID and
 *      Final Link (a short link of your current view).
 *
 * planMenuCompletion runs BEFORE the CAVE write, so a row claimed by someone
 * else stops the whole completion instead of leaving CAVE and the sheet
 * disagreeing. finishMenuCompletion runs after CAVE succeeds.
 */
import { useIssueTagStore, useProofreadingBackendStore, useProofreadingQueueStore, type QueueItem, type ProofreadingTask } from '../store';
import { getDatasetCaveConfig } from '../config';
import { currentDatasetTag, currentSegLayer } from '../datasets';
import { removeHighlightsOfCells } from './highlight';
import { ancestorAmong, getRootFromSupervoxel } from '../widgets/pcg_service';
import { mintShortStateLink } from './state_link';
import { syncCellToSheet } from '../sheet_sync';

export interface MenuCompletionPlan {
  /** Set when the completion must not go ahead; shown to the player. */
  blocked?: string;
  /** The sheet row, or undefined when the cell is not a Cell Library cell. */
  row?: QueueItem;
  task?: ProofreadingTask;
  dataset: string;
  segId: string;
  /** MEC: the menu was opened on a cell's NUCLEUS (its own segment there).
   *  This is the cell around it, which is what gets marked complete. */
  cellRoot?: string;
}

function viewerPoint(): [number, number, number] {
  const pos = (window as any)['viewer']?.navigationState?.position?.value;
  return pos && pos.length >= 3
    ? [Math.round(pos[0]), Math.round(pos[1]), Math.round(pos[2])]
    : [0, 0, 0];
}

function parsePoint(s: string): [number, number, number] | null {
  const n = (s || '').split(/[\s,]+/).map(Number).filter(v => !Number.isNaN(v));
  return n.length >= 3 ? [n[0], n[1], n[2]] : null;
}

export async function planMenuCompletion(segId: string): Promise<MenuCompletionPlan> {
  const dataset = currentDatasetTag();
  const plan: MenuCompletionPlan = { dataset, segId };
  const cfg = getDatasetCaveConfig(dataset);
  const sheetUrl = cfg.cellLibrarySheetUrl;
  if (!sheetUrl) {
    // No segment-ID sheet (MEC): the Cell Library tasks are the list. The
    // server writes the sheet by the task's starting point (sheet-policy.js).
    if (cfg.annotationLog) await planFromTasks(plan);
    return plan;
  }

  const queue = useProofreadingQueueStore();
  if (queue.sheetUrl !== sheetUrl || !queue.items.length) await queue.loadFromSheet(sheetUrl, dataset);
  const rows = queue.items;
  // Whether this is a Cell Library cell could not be worked out (the list or
  // the cell's edit history did not load). That used to be treated as "not a
  // Cell Library cell": the cell was marked proofread with no ending asked
  // for and nothing written to the sheet, and the player had to fill in the
  // date, ID and link by hand (Nseraf 2026-10-10). Stop instead, before
  // anything is saved, and say so. Every caller already shows `blocked`.
  const cannotTell = 'Could not check this cell against the cell list just now, so nothing was saved. Try again in a moment.';
  if (!rows.length) { plan.blocked = cannotTell; return plan; }
  let row = rows.find(r => r.segId === segId || r.finalSegId === segId);
  if (!row) {
    // One of your own claims, by its current ID (kept up to date from the
    // claim's fixed point): no history lookup needed.
    const backend = useProofreadingBackendStore();
    const mine = backend.tasks.find(t => t.assigned_to === backend.userId
      && (t.status === 'assigned' || t.status === 'in_progress')
      && (backend.liveRoots[t.id] === segId || t.final_segment_id === segId));
    if (mine) row = rows.find(r => r.segId === mine.segment_id);
  }
  if (!row) {
    // Edited since it was listed: the sheet's Start SegID is an ancestor.
    // The lookup can fail for a moment; ask twice before giving up.
    let hit = await ancestorAmong(segId, rows.map(r => r.segId));
    if (hit === undefined) {
      await new Promise(r => setTimeout(r, 1200));
      hit = await ancestorAmong(segId, rows.map(r => r.segId));
    }
    if (hit === undefined) { plan.blocked = cannotTell; return plan; }
    if (hit) row = rows.find(r => r.segId === hit);
  }
  if (!row) return plan;  // truly not a Cell Library cell: CAVE only
  plan.row = row;

  const backend = useProofreadingBackendStore();
  await backend.loadTasks(dataset);
  const task = backend.tasks.find(t => t.segment_id === row!.segId);
  plan.task = task;
  if (task?.status === 'completed') {
    plan.blocked = task.assigned_to === backend.userId ? undefined
      : 'Someone else already completed this cell in the Cell Library.';
  } else if (task && (task.status === 'assigned' || task.status === 'in_progress')
             && task.assigned_to && task.assigned_to !== backend.userId) {
    plan.blocked = 'Another player has claimed this cell. Ask them, or pick another cell.';
  }
  return plan;
}

/** MEC: find the Cell Library task for this cell (following edits back to the
 *  task's root) and present it as the row to complete. */
async function planFromTasks(plan: MenuCompletionPlan) {
  const backend = useProofreadingBackendStore();
  await backend.loadTasks(plan.dataset);
  const tasks = backend.tasks.filter(t => t.segment_id && /^\d+$/.test(t.segment_id));
  let task = tasks.find(t => t.segment_id === plan.segId || t.final_segment_id === plan.segId);
  // Crosshairs in the nucleus (Ames 2026-09-29): complete the cell around it,
  // at its current root (the stored supervoxel follows it through edits).
  const byNucleus = !task && tasks.find(t => t.final_nucleus_id === plan.segId);
  if (byNucleus) {
    task = byNucleus;
    const root = byNucleus.supervoxel_id ? await getRootFromSupervoxel(String(byNucleus.supervoxel_id)).catch(() => null) : null;
    plan.cellRoot = root || byNucleus.segment_id;
    plan.segId = plan.cellRoot;
  }
  if (!task && tasks.length) {
    const hit = await ancestorAmong(plan.segId, tasks.map(t => t.segment_id));
    if (hit) task = tasks.find(t => t.segment_id === hit);
  }
  if (!task) return;  // not a Cell Library cell: logged only
  const index = (task.notes || '').match(/Sheet #([\w-]+)/)?.[1] ?? '';
  plan.task = task;
  plan.row = {
    segId: task.segment_id, index: index ? `#${index}` : '', nucCoords: task.nucleus_coords || '',
    somaCoords: task.soma_coords || '', finalSegId: task.final_segment_id || '', finalNucId: '',
    notes: task.notes || '', dataset: plan.dataset,
  };
  if (task.status === 'completed') {
    plan.blocked = task.assigned_to === backend.userId ? undefined
      : 'Someone else already completed this cell in the Cell Library.';
  } else if ((task.status === 'assigned' || task.status === 'in_progress') && task.assigned_to && task.assigned_to !== backend.userId) {
    plan.blocked = 'Another player has claimed this cell. Ask them, or pick another cell.';
  }
}

/** Empty the player's own local annotation layers (points, lines, boxes,
 *  highlights) once a cell is complete, since that markup does not apply to
 *  the next cell. The layers stay; shared ones (Scout tags, AI candidates)
 *  are left alone, as are layers whose annotations come from a server.
 *
 *  `done`: the cell just completed (every id it is known by). With other
 *  cells still showing, their markup must survive: a player who marked
 *  several cells and then completed them one by one lost every mark after
 *  the first, so those cells reached the sheet with empty annotation layers
 *  (2026-10-08). Then only this cell's highlights go, and the rest stays
 *  until the last of those cells is completed. Without `done` (a batch,
 *  which completes everything on show) all of it is cleared. */
export function clearOwnAnnotations(done?: string[]) {
  if (done && othersShowing(done)) {
    try { removeHighlightsOfCells(done); } catch (e) { console.warn('[menuComplete] could not clear this cell\'s highlights', e); }
    return;
  }
  const issueTags = useIssueTagStore();
  for (const managed of (window as any)['viewer']?.layerManager?.managedLayers ?? []) {
    if (managed.archived || issueTags.isTagStoreLayer(managed.name)) continue;
    try { managed.layer?.localAnnotations?.clear(); } catch (e) {
      console.warn('[menuComplete] could not clear', managed.name, e);
    }
  }
}

/** True when a cell other than the completed one is showing in the view. If
 *  the view cannot be read, say yes: keeping markup is the safe mistake. */
function othersShowing(done: string[]): boolean {
  try {
    const visible = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
    if (!visible) return true;
    const mine = new Set(done.filter(Boolean).map(String));
    for (const id of visible) if (!mine.has(id.toString())) return true;
    return false;
  } catch { return true; }
}

/** For a batch (Batch Processor): the point captured on each cell, and one
 *  view link minted for the whole batch instead of one per cell. */
export interface FinishOptions {
  point?: [number, number, number];
  link?: string | null;
  /** Leave the player's markup for the caller to clear (a batch clears it
   *  once at the end, so a cell that fails keeps its points). */
  keepMarkup?: boolean;
  /** How the cell ended and the player's notes, as the Cell Library's own
   *  Complete form collects them (completion_details.ts). Written to the
   *  sheet's Status and Notes columns. */
  status?: string;
  notes?: string;
}

/** True when completing this plan writes the Cell Library sheet for the first
 *  time, so the ending and notes should be asked for before it goes ahead. */
export function needsCompletionDetails(plan: MenuCompletionPlan | null): boolean {
  return !!plan?.row && !plan.blocked && plan.task?.status !== 'completed';
}

/** Claim (if needed), complete the claim and write the sheet. Returns a short
 *  note for the menu, or throws with a plain-English message. */
export async function finishMenuCompletion(plan: MenuCompletionPlan, opts: FinishOptions = {}): Promise<string> {
  if (!plan.row) return '';
  const backend = useProofreadingBackendStore();
  const row = plan.row;
  let task = plan.task;
  const here = () => opts.point ?? viewerPoint();

  if (task?.status !== 'completed') {
    if (!task || task.assigned_to !== backend.userId) {
      const point = parsePoint(row.somaCoords) ?? parsePoint(row.nucCoords) ?? here();
      const claimed = task
        ? { ok: await backend.claimTask(task.id), reason: backend.error }
        : await backend.claimCell(point, row.segId);
      if (!claimed.ok) throw new Error(`Saved, but the sheet was not updated: ${claimed.reason || 'could not claim this cell'}.`);
      await backend.loadTasks(plan.dataset);
      task = backend.tasks.find(t => t.segment_id === row.segId);
      if (!task) throw new Error('Saved, but the Cell Library claim could not be found.');
    }
    await backend.completeTask(task.id, plan.segId, here().join(', '));
  }

  const link = opts.link !== undefined ? opts.link : await mintShortStateLink();
  await syncCellToSheet('complete', row.segId, undefined, plan.dataset, link || undefined, opts.notes, opts.status);
  // After the Final Link has captured it: the markup belonged to this cell.
  if (!opts.keepMarkup) clearOwnAnnotations([plan.segId, row.segId, row.finalSegId, plan.cellRoot ?? '', task?.final_segment_id ?? ''].filter(Boolean) as string[]);
  await backend.loadTasks(plan.dataset);
  return link
    ? `Written to the sheet${row.index ? ` (${row.index})` : ''}.`
    : `Written to the sheet${row.index ? ` (${row.index})` : ''}, without a link (sign in to make one).`;
}
