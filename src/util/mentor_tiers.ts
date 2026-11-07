/**
 * The Mentor row of the Trophy Case (Ames 2026-11-05): a tier at 1, 5, 10, 25,
 * 50 and 75 apprentices graduated, each a Special Achievement the server gives
 * (functions/mentors.js MENTOR_TIERS, same slugs and names). The names here
 * are for tiers not earned yet; an earned one shows its own name and picture,
 * which an admin may change in Special Badges.
 */
import m1 from '../../static/mentor/tiers/mentor-1.png';
import m5 from '../../static/mentor/tiers/mentor-5.png';
import m10 from '../../static/mentor/tiers/mentor-10.png';
import m25 from '../../static/mentor/tiers/mentor-25.png';
import m50 from '../../static/mentor/tiers/mentor-50.png';
import m75 from '../../static/mentor/tiers/mentor-75.png';

export interface MentorTier { n: number; slug: string; name: string; image: string }
export const MENTOR_TIERS: MentorTier[] = [
  { n: 1, name: 'Mentor', image: m1 },
  { n: 5, name: 'Myelin Maker', image: m5 },
  { n: 10, name: 'Sheath Shaper', image: m10 },
  { n: 25, name: 'Saltatory Sensei', image: m25 },
  { n: 50, name: 'Grand Oligodendrocyte', image: m50 },
  { n: 75, name: 'Ranvier Royalty', image: m75 },
].map(t => ({ ...t, slug: `mentor-program-mentor-${t.n}` }));

/** The Apprentice graduate Achievement's name, as the server makes it. */
export const APPRENTICE_ACHIEVEMENT = 'Myelinated';

export const isMentorTierSlug = (slug: string | null | undefined) => !!slug && /^mentor-program-mentor-\d+$/.test(slug);
