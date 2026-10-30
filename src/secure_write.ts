import { functionUrl } from './functions_base';
/**
 * Writes to notifications and feedback_triage go through the ewSecureWrite
 * Cloud Function, never straight to Supabase: the anon key the app ships is
 * read only for those tables (supabase-lockdown-notifications-triage.sql).
 * The function verifies the caller's CAVE sign in token with CAVE and, for
 * admin actions, checks the admins table with a key the browser never sees.
 */
const ENDPOINT = (window as any).__NGE_SECURE_WRITE_URL
  || functionUrl('ewSecureWrite');
// The proofreading test has a function of its own (functions/index.js,
// ewProofreadingTest): the shared one is redeployed from many checkouts.
const TEST_ENDPOINT = (window as any).__NGE_TEST_WRITE_URL
  || functionUrl('ewProofreadingTest');
// Report replies have one too, for the same reason (ewReportReply).
const REPLY_ENDPOINT = (window as any).__NGE_REPLY_WRITE_URL
  || functionUrl('ewReportReply');
// Retina access requests too (ewAccessRequest, src/access_request.ts).
const ACCESS_ENDPOINT = (window as any).__NGE_ACCESS_WRITE_URL
  || functionUrl('ewAccessRequest');
// The Hunt too (ewHunt, src/hunt.ts): its answer keys must never be taken
// away by a deploy of the shared gateway from a checkout without them.
const HUNT_ENDPOINT = (window as any).__NGE_HUNT_URL
  || functionUrl('ewHunt');
const STICKY_AUTH_URL = 'https://global.daf-apis.com/sticky_auth';

export function caveToken(): string | null {
  try {
    const raw = window.localStorage.getItem(`auth_token_v2_${STICKY_AUTH_URL}`);
    return raw ? (JSON.parse(raw).accessToken ?? null) : null;
  } catch { return null; }
}

export type SecureAction =
  | 'notification.insert' | 'notification.update' | 'notification.delete'
  | 'triage.update' | 'triage.release' | 'triage.note'
  | 'todo.list' | 'todo.save' | 'todo.comment' | 'todo.delete' | 'todo.key' | 'todo.keyStatus'
  | 'pilot.task' | 'pilot.practice' | 'quest.admin' | 'pilot.status' | 'activity.log' | 'activity.visit'
  | 'reply.ask' | 'reply.send' | 'reply.console'
  | 'outbox.add' | 'outbox.mine' | 'outbox.sent' | 'outbox.fail' | 'outbox.cancel' | 'outbox.summary'
  | 'test.status' | 'test.start' | 'test.heartbeat' | 'test.submit' | 'test.abandon' | 'test.tries' | 'test.try' | 'test.queueJoin' | 'test.queueLeave' | 'test.queueRemove'
  | 'access.betaStatus' | 'access.beta' | 'access.grantLines'
  | 'access.datasetStatus' | 'access.dataset' | 'access.datasetList' | 'access.datasetDecide'
  | 'access.mine' | 'access.save' | 'access.remove' | 'access.submit' | 'access.withdraw' | 'access.list' | 'access.review' | 'access.decide' | 'access.reset'
  | 'notification.self' | 'notification.helpReply' | 'help.dropReminder' | 'notification.claimChatPost' | 'chat.achievement' | 'chat.pin' | 'chat.unpin'
  | 'hunt.current' | 'hunt.submit' | 'hunt.list' | 'hunt.read' | 'hunt.save' | 'hunt.now' | 'hunt.cancel' | 'hunt.delete' | 'hunt.award' | 'hunt.rescore'
  | 'hunt.notes' | 'hunt.test' | 'hunt.test_drop' | 'hunt.drop' | 'hunt.start' | 'hunt.duplicate';

/** Returns the row (or result) the function wrote; throws with a readable message. */
export async function secureWrite<T = any>(action: SecureAction, args: Record<string, any> = {}): Promise<T> {
  const token = caveToken();
  if (!token) throw new Error('Sign in to EyeWire II first.');
  const res = await fetch(action.startsWith('test.') ? TEST_ENDPOINT : action.startsWith('reply.') ? REPLY_ENDPOINT : action.startsWith('access.') ? ACCESS_ENDPOINT : (action.startsWith('hunt.') || action.startsWith('build.')) ? HUNT_ENDPOINT : ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...args, action, token }),
    redirect: 'error',
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non JSON error page */ }
  // The status rides along, so a caller can tell a server that is down (5xx)
  // from one that said no (4xx).
  if (!res.ok || !json?.ok) throw Object.assign(new Error(json?.error || `Save failed (${res.status})`), { status: res.status });
  return json.data as T;
}
