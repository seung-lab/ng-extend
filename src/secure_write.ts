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
const STICKY_AUTH_URL = 'https://global.daf-apis.com/sticky_auth';

function caveToken(): string | null {
  try {
    const raw = window.localStorage.getItem(`auth_token_v2_${STICKY_AUTH_URL}`);
    return raw ? (JSON.parse(raw).accessToken ?? null) : null;
  } catch { return null; }
}

export type SecureAction =
  | 'notification.insert' | 'notification.update' | 'notification.delete'
  | 'triage.update'
  | 'notification.self' | 'notification.helpReply' | 'notification.claimChatPost';

/** Returns the row (or result) the function wrote; throws with a readable message. */
export async function secureWrite<T = any>(action: SecureAction, args: Record<string, any> = {}): Promise<T> {
  const token = caveToken();
  if (!token) throw new Error('Sign in to EyeWire II first.');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...args }),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non JSON error page */ }
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Save failed (${res.status})`);
  return json.data as T;
}
