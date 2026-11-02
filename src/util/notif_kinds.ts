/**
 * Which tab of the bell a notification belongs in, for admins (players have
 * one feed). Decided by the start of its title, which the server writes.
 *
 * - admin: what an admin has to act on that is not a bug report (Ames
 *   2026-10-21): access requests, proofreading test results, and a player's
 *   answer to a reply an admin asked for (functions/report-reply.js).
 * - triage: the triage loop's alerts about reports (Ames 2026-10-06: "they are
 *   clogging up my feed"), and an admin tagging you on a report.
 * - hunt: hunters' reports of a problem a Hunt's answers missed (Ames
 *   2026-10-27: "a special category of hunt submission notifications").
 * - main: everything else.
 */
export type NotifKind = 'main' | 'triage' | 'admin' | 'hunt';

// To do board tags and hand overs start with 📋 (functions/todos.js makeTagger; Ames 2026-10-23).
// Beta access requests from players not on Pilot testers (Ames 2026-10-24).
// Dataset access requests too (Ames 2026-10-29: "these should be in Admin").
const ADMIN_STARTS = ['🔑 Access update', '🔑 Beta access request', '🔬 Retina access request', '🔓 Dataset access request', 'Proofreading Test:', '💬 Reply to your question from', '📋 '];
const TRIAGE_STARTS = ['🗂', '🎉 Fixed'];

export function notifKind(title: string | null | undefined, isAdmin: boolean): NotifKind {
  if (!isAdmin) return 'main';
  const t = title || '';
  if (ADMIN_STARTS.some(s => t.startsWith(s))) return 'admin';
  // Hunters' reports of what the answers missed (functions/hunts.js), a tab of their own (Ames 2026-10-27).
  if (t.startsWith('🔎 Hunt report')) return 'hunt';
  // Players' suggested errors for a Hunt being built (functions/hunt_build.js), with them.
  if (t.startsWith('💡 Hunt suggestion')) return 'hunt';
  if (TRIAGE_STARTS.some(s => t.startsWith(s)) || /tagged you on a report$/.test(t)) return 'triage';
  return 'main';
}
