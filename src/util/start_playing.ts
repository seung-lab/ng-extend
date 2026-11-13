/**
 * "Start playing" (Ames 2026-11-05): once Merge and Cut are done, the
 * Sandbox card's button stops leading to the edit access form and takes the
 * player to real work instead. Anyone signed in can claim a Sandbox cell, but
 * nothing said so: Nurro's note after Cut talks about real cells and the
 * Proofreading Test. Now the button opens the Sandbox's Cell Library, goes to
 * the player's open Sandbox cell or claims the next one, and says what to do.
 *
 * Since 2026-11-09 the button starts Play (util/play.ts) on the Sandbox.
 */
import { useUserPreferencesStore, useProofreadingBackendStore } from '../store';


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
