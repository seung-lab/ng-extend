import { canonicalDataset, currentDatasetTag } from './datasets';
import { functionUrl } from './functions_base';

/** The ways a cell can end, per dataset, spelled exactly as that dataset's
 *  sheet spells them in its Status dropdown (Retina, read 2026-10-03). The
 *  Complete form offers these; the server keeps its own copy of the list
 *  (functions/sheet-policy.js) and refuses anything else. A dataset with no
 *  entry has one ending, "Complete", and the form shows no choice. */
export const COMPLETE_STATUSES: Record<string, { value: string; hint: string }[]> = {
  stroeh_mouse_retina: [
    { value: 'Complete (cut off)', hint: 'Finished, but part of the cell leaves the volume' },
    { value: 'Complete', hint: 'Finished, and the whole cell is inside the volume' },
    { value: 'Not BC', hint: 'This is not a bipolar cell' },
    { value: "Can't Complete", hint: 'It cannot be finished (say why in the notes). Counts as your completed cell, but the cell is not marked proofread' },
  ],
  // MEC players proofread the axon only (Ames 2026-10-27: "a way to mark
  // axon proofread in MEC without having to proofread the whole thing").
  pni_mec: [
    { value: 'Axon complete', hint: 'The axon is proofread, to every end. Counts as your completed cell; the cell is not marked proofread' },
  ],
};
/** An MEC cell whose axon is proofread: counts as the player's completed cell
 *  and leaves the Cell Library, but is not marked proofread in CAVE (Ames
 *  2026-10-27: "not marked proofread in CAVE - will find out how to label
 *  there"). The sheet's Status dropdown needs this option, spelled the same. */
export const AXON_COMPLETE = 'Axon complete';
/** "Can't Complete" ends the claim, counts as the player's completed cell and
 *  is written to the sheet, but the cell is NOT marked proofread in CAVE
 *  (Ames 2026-10-22: "We don't want players to be able to mark can't complete
 *  just bc they can't finish the cell, bc that marks the cell proofread";
 *  "it should count as a completed cell I think? at least from cell library"). */
export const CANT_COMPLETE = "Can't Complete";
export const marksProofread = (status?: string | null) => status !== CANT_COMPLETE && status !== AXON_COMPLETE;

export function completeStatusesFor(dataset?: string | null) {
  return COMPLETE_STATUSES[canonicalDataset(dataset || currentDatasetTag())] ?? [];
}

/** Only the server holds Sheets credentials and chooses the destination/range. */
/** `link` and `notes` (complete only) fill the sheet's "Final Link" and
 *  "Notes" columns; the server never overwrites a filled cell. */
export async function syncCellToSheet(action: 'claim' | 'complete' | 'coordinates' | 'release' | 'reopen', segmentId: string, coordinates?: string, sourceDataset?: string, link?: string, notes?: string, status?: string, cellType?: string) {
  const dataset = canonicalDataset(sourceDataset || currentDatasetTag());
  if (!['pinky_nf_v2', 'stroeh_mouse_retina', 'pni_mec'].includes(dataset)) return;
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch {}
  if (!token) throw new Error('Sign in before syncing a cell.');
  // An MEC cell's marks, counted, go in its Notes (Ames 2026-10-24): the
  // points themselves are in the Final Link, the count is readable in the
  // sheet. Read now, before the view's markup is cleared.
  if (action === 'complete' && dataset === 'pni_mec') {
    // Loaded here, not imported: mec_marks reaches datasets, which reaches
    // store, which imports this file.
    const { mecMarkSummary } = await import('./util/mec_marks');
    const marks = mecMarkSummary();
    if (marks) notes = [String(notes ?? '').trim().slice(0, 1000 - marks.length - 3), marks].filter(Boolean).join(' | ');
  }
  const response = await fetch(functionUrl('ewSheetSync'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ action, segmentId, coordinates, dataset, token, ...(link ? { link } : {}), ...(notes ? { notes } : {}), ...(status ? { status } : {}), ...(cellType ? { cellType } : {}) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Sheet syncing failed. Your cell is saved.');
  return result;
}
