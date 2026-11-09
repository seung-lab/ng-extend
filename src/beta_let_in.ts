/**
 * Letting someone into the Pyr beta, shared by Admin Hub > Pilot testers and
 * the Access page (triage hub). Their email goes on Pilot testers; whoever
 * asked from inside Pyr hears it in their bell (Ames 2026-11-05); and the
 * "You're in" email goes from welcome@connectome.quest, once per address
 * (functions/access-request.js welcomeEmail).
 */
import { supabase } from './supabase';
import { secureWrite } from './secure_write';

/** The bell, for a request made from inside Pyr (an account to tell). */
export async function welcomeBell(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    await secureWrite('notification.insert', { row: {
      title: "🎉 You're in the Pyr beta!",
      body: "Welcome! You can now claim cells, take the tutorials and help map the brain. Thank you for joining us.\n\nThe Pyr (pronounced \"peer\") team at Princeton University",
      target_type: 'user', target_id: userId, send_at: new Date().toISOString(),
    } });
  } catch { /* they are in either way */ }
}

/** The email; what to show beside the person afterwards. */
export async function welcomeEmail(email: string, name: string): Promise<string> {
  try {
    const r = await secureWrite<{ sent: boolean; reason?: string }>('access.welcomeEmail', { email, name });
    return r?.sent ? 'Emailed them' : r?.reason === 'already sent' ? 'Emailed before' : '';
  } catch (e: any) {
    return e?.message || 'The email did not go.';
  }
}

/** Let them in. Throws when Pilot testers did not take the email. */
export async function addPilot(email: string): Promise<void> {
  const { error } = await supabase.from('pilot_members').upsert([{ email, enabled: true }], { onConflict: 'email' });
  if (error) throw new Error(error.message);
}
