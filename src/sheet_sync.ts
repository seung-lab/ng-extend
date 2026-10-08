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
    { value: "Can't Complete", hint: 'It cannot be finished (say why in the notes)' },
  ],
};
export function completeStatusesFor(dataset?: string | null) {
  return COMPLETE_STATUSES[canonicalDataset(dataset || currentDatasetTag())] ?? [];
}

/** Only the server holds Sheets credentials and chooses the destination/range. */
/** `link` and `notes` (complete only) fill the sheet's "Final Link" and
 *  "Notes" columns; the server never overwrites a filled cell. */
export async function syncCellToSheet(action: 'claim' | 'complete' | 'coordinates' | 'release', segmentId: string, coordinates?: string, sourceDataset?: string, link?: string, notes?: string, status?: string) {
  const dataset = canonicalDataset(sourceDataset || currentDatasetTag());
  if (!['pinky_nf_v2', 'stroeh_mouse_retina', 'pni_mec'].includes(dataset)) return;
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch {}
  if (!token) throw new Error('Sign in before syncing a cell.');
  const response = await fetch(functionUrl('ewSheetSync'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ action, segmentId, coordinates, dataset, token, ...(link ? { link } : {}), ...(notes ? { notes } : {}), ...(status ? { status } : {}) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Sheet syncing failed. Your cell is saved.');
  return result;
}
