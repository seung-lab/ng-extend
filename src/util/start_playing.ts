/**
 * "Start playing" (Ames 2026-11-05): once Merge and Cut are done, the
 * Sandbox card's button stops leading to the edit access form and takes the
 * player to real work instead. Anyone signed in can claim a Sandbox cell, but
 * nothing said so: Nurro's note after Cut talks about real cells and the
 * Proofreading Test. Now the button opens the Sandbox's Cell Library, goes to
 * the player's open Sandbox cell or claims the next one, and says what to do.
 *
 * The button (DatasetSelectorPanel) leaves a note here and asks the Cell
 * Library to open; the switch to the Sandbox may reload the page, so the note
 * is kept in this tab's session and the library takes it once its cells are
 * in (CellLibraryPanel). A note older than three minutes is ignored.
 */
import { useUserPreferencesStore, useProofreadingBackendStore } from '../store';

const KEY = 'nge_start_playing';
const FRESH_MS = 3 * 60_000;  // a switch to the Sandbox can reload the page

/** Merge and Cut are behind the player: the Cut tutorial's Achievement in this
 *  browser or on the account, or the staged top bar's own record of it. */
export function basicsDone(): boolean {
  try { if (localStorage.getItem('nge-badge-safety-scissors')) return true; } catch { /* private mode */ }
  try {
    const stage = (useUserPreferencesStore().prefs as any).toolbarStage;
    if (stage?.done?.includes('cutDone')) return true;
  } catch { /* store not ready */ }
  try {
    return useProofreadingBackendStore().mySpecialBadges.some((a: any) => a?.badge?.slug === 'safety-scissors');
  } catch { return false; }
}

export function askStartPlaying() {
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* private window: the library just opens */ }
}

/** True once per press: the Cell Library should take the player to a cell. */
export function takeStartPlaying(): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
    return Number.isFinite(at) && Date.now() - at < FRESH_MS;
  } catch { return false; }
}
