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
import { useProofreadingBackendStore, useProofreadingQueueStore, type QueueItem, type ProofreadingTask } from '../store';
import { getDatasetCaveConfig } from '../config';
import { currentDatasetTag } from '../datasets';
import { ancestorAmong } from '../widgets/pcg_service';
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
  let row = rows.find(r => r.segId === segId || r.finalSegId === segId);
  if (!row && rows.length) {
    // Edited since it was listed: the sheet's Start SegID is an ancestor.
    const hit = await ancestorAmong(segId, rows.map(r => r.segId));
    if (hit) row = rows.find(r => r.segId === hit);
  }
  if (!row) return plan;  // not a Cell Library cell: CAVE only
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

/** Claim (if needed), complete the claim and write the sheet. Returns a short
 *  note for the menu, or throws with a plain-English message. */
export async function finishMenuCompletion(plan: MenuCompletionPlan): Promise<string> {
  if (!plan.row) return '';
  const backend = useProofreadingBackendStore();
  const row = plan.row;
  let task = plan.task;

  if (task?.status !== 'completed') {
    if (!task || task.assigned_to !== backend.userId) {
      const point = parsePoint(row.somaCoords) ?? parsePoint(row.nucCoords) ?? viewerPoint();
      const claimed = task
        ? { ok: await backend.claimTask(task.id), reason: backend.error }
        : await backend.claimCell(point, row.segId);
      if (!claimed.ok) throw new Error(`Saved, but the sheet was not updated: ${claimed.reason || 'could not claim this cell'}.`);
      await backend.loadTasks(plan.dataset);
      task = backend.tasks.find(t => t.segment_id === row.segId);
      if (!task) throw new Error('Saved, but the Cell Library claim could not be found.');
    }
    await backend.completeTask(task.id, plan.segId, viewerPoint().join(', '));
  }

  const link = await mintShortStateLink();
  await syncCellToSheet('complete', row.segId, undefined, plan.dataset, link || undefined);
  await backend.loadTasks(plan.dataset);
  return link
    ? `Written to the sheet${row.index ? ` (${row.index})` : ''}.`
    : `Written to the sheet${row.index ? ` (${row.index})` : ''}, without a link (sign in to make one).`;
}
