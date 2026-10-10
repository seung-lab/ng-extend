import { secureWrite } from './secure_write';
export async function taskAction(action: 'claim' | 'claim_cell' | 'release' | 'complete' | 'heartbeat' | 'save_link' | 'set_anchor' | 'reopen', args: Record<string, unknown>) {
  return secureWrite('pilot.task', { operation: action, args });
}
/**
 * Practice actions are retried when the server is only busy. Its write
 * limiter keeps one shared counter, and with several players writing in the
 * same moment it answers "please wait" (429) to requests that are fine. One
 * such answer used to cost a learner their practice cell (claims and
 * renewals failing through 2026-10-09). A real refusal (session ended, not
 * yours, admins only) is not retried.
 */
export async function practiceAction(action: 'claim' | 'heartbeat' | 'begin_reset' | 'check_reset' | 'finish_reset', args: Record<string, unknown>) {
  let last: any;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await secureWrite('pilot.practice', { operation: action, args }); }
    catch (error: any) {
      last = error;
      const why = String(error?.message || error);
      const busy = /please wait|\(429\)|\(5\d\d\)|failed to fetch|network|timed? ?out|unavailable/i.test(why);
      if (!busy) throw error;
      console.warn(`[practice] ${action} was told to wait, trying again (${attempt + 1}):`, why);
      await new Promise(r => setTimeout(r, 700 * (attempt + 1) + Math.random() * 400));
    }
  }
  throw last;
}
