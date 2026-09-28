import { canonicalDataset, currentDatasetTag } from './datasets';
import { functionUrl } from './functions_base';

/** Only the server holds Sheets credentials and chooses the destination/range. */
export async function syncCellToSheet(action: 'claim' | 'complete' | 'coordinates', segmentId: string, coordinates?: string, sourceDataset?: string) {
  const dataset = canonicalDataset(sourceDataset || currentDatasetTag());
  if (!['pinky_nf_v2', 'stroeh_mouse_retina'].includes(dataset)) return;
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch {}
  if (!token) throw new Error('Sign in before syncing a cell.');
  const response = await fetch(functionUrl('ewSheetSync'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ action, segmentId, coordinates, dataset, token }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Sheet syncing failed. Your cell is saved.');
  return result;
}
