/**
 * Which tab of the bell a notification belongs in, for admins (players have
 * one feed). Decided by the start of its title, which the server writes.
 *
 * - admin: what an admin has to act on that is not a bug report (Ames
 *   2026-10-21): access requests, proofreading test results, and a player's
 *   answer to a reply an admin asked for (functions/report-reply.js).
 * - triage: the triage loop's alerts about reports (Ames 2026-10-06: "they are
 *   clogging up my feed"), and an admin tagging you on a report.
 * - main: everything else.
 */
export type NotifKind = 'main' | 'triage' | 'admin';

// To do board tags and hand overs start with 📋 (functions/todos.js makeTagger; Ames 2026-10-23).
// Beta access requests from players not on Pilot testers (Ames 2026-10-24).
const ADMIN_STARTS = ['🔑 Beta access request', '🔬 Retina access request', 'Proofreading Test:', '💬 Reply to your question from', '📋 '];
const TRIAGE_STARTS = ['🗂', '🎉 Fixed'];

export function notifKind(title: string | null | undefined, isAdmin: boolean): NotifKind {
  if (!isAdmin) return 'main';
  const t = title || '';
  if (ADMIN_STARTS.some(s => t.startsWith(s))) return 'admin';
  if (TRIAGE_STARTS.some(s => t.startsWith(s)) || /tagged you on a report$/.test(t)) return 'triage';
  return 'main';
}
