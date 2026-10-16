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
const STICKY_AUTH_URL = 'https://global.daf-apis.com/sticky_auth';

export function caveToken(): string | null {
  try {
    const raw = window.localStorage.getItem(`auth_token_v2_${STICKY_AUTH_URL}`);
    return raw ? (JSON.parse(raw).accessToken ?? null) : null;
  } catch { return null; }
}

export type SecureAction =
  | 'notification.insert' | 'notification.update' | 'notification.delete'
  | 'triage.update' | 'triage.release'
  | 'pilot.task' | 'pilot.practice' | 'pilot.status' | 'activity.log' | 'activity.visit'
  | 'reply.ask' | 'reply.send' | 'reply.console'
  | 'outbox.add' | 'outbox.mine' | 'outbox.sent' | 'outbox.fail' | 'outbox.cancel' | 'outbox.summary'
  | 'test.status' | 'test.start' | 'test.heartbeat' | 'test.submit' | 'test.abandon'
  | 'access.mine' | 'access.save' | 'access.remove' | 'access.submit' | 'access.list' | 'access.review' | 'access.decide'
  | 'notification.self' | 'notification.helpReply' | 'notification.claimChatPost' | 'chat.achievement' | 'chat.pin' | 'chat.unpin';

/** Returns the row (or result) the function wrote; throws with a readable message. */
export async function secureWrite<T = any>(action: SecureAction, args: Record<string, any> = {}): Promise<T> {
  const token = caveToken();
  if (!token) throw new Error('Sign in to EyeWire II first.');
  const res = await fetch(action.startsWith('test.') ? TEST_ENDPOINT : action.startsWith('reply.') ? REPLY_ENDPOINT : action.startsWith('access.') ? ACCESS_ENDPOINT : ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...args, action, token }),
    redirect: 'error',
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non JSON error page */ }
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Save failed (${res.status})`);
  return json.data as T;
}
