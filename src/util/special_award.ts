/**
 * Give the signed in player one of the special Achievements they have earned
 * by something they did in the game, and say so the first time: the hero
 * celebration, a notification, and a line in chat.
 *
 * The Achievement itself (its name, words and art) is a row an admin makes in
 * the Admin Hub. The game finds it by its code name (`slug`), so it can be
 * called anything. Until an admin has made it, nothing happens, and players
 * who had already earned it get it the next time the game checks.
 *
 * The server decides whether the player may have it (functions/index.js,
 * ewCommunityData): asking twice is harmless, and asking without having
 * earned it is refused.
 */
import { supabase } from '../supabase';
import { useProofreadingBackendStore } from '../store';

const inFlight = new Set<string>();

export async function awardSpecialOnce(opts: {
  /** The Achievement's code name in the Admin Hub. */
  slug: string;
  /** Kept with the award, for admins. */
  reason: string;
  /** What the player did, to finish "You ..." in the notification. */
  earnedBy: string;
}): Promise<boolean> {
  const backend = useProofreadingBackendStore();
  if (!backend.userId || inFlight.has(opts.slug)) return false;
  inFlight.add(opts.slug);
  try {
    if (!backend.specialBadges.length) await backend.loadSpecialBadges();
    const badge: any = backend.specialBadges.find((b: any) => b.slug === opts.slug);
    if (!badge) return false;                      // no admin has made it yet
    // Read fresh: at sign in the player's own list may not have arrived.
    await backend.loadMySpecialBadges();
    if (backend.mySpecialBadges.some((a: any) => a.badge_id === badge.id)) return false;

    await supabase.from('special_badge_awards').upsert({
      badge_id: badge.id, user_id: backend.userId, awarded_by: null, reason: opts.reason,
    }, { onConflict: 'badge_id,user_id' });
    await backend.loadMySpecialBadges();
    // Only if it was really recorded (the server may have refused).
    if (!backend.mySpecialBadges.some((a: any) => a.badge_id === badge.id)) return false;

    const image = badge.image_url || badge.thumbnail_url || '';
    backend.pendingBadgeCelebration = {
      title: `🏆 New Achievement: ${badge.name}`,
      body: `You ${opts.earnedBy} and earned the "${badge.name}" achievement.`,
      imageUrl: image,
    };
    backend.announceAchievement('special', badge.id);
    await backend.createSelfNotification({
      title: `🏆 New Achievement: ${badge.name}`,
      body: `You ${opts.earnedBy} and earned the "${badge.name}" achievement. Congratulations!`,
      image_url: image,
      thumbnail_url: badge.thumbnail_url || image,
    });
    return true;
  } catch (e) {
    console.warn('[achievement] could not record', opts.slug, e);
    return false;
  } finally {
    inFlight.delete(opts.slug);
  }
}
