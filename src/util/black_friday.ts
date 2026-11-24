/**
 * Black Friday 2026 (Ames 2026-11-24: "2 quests for each 1 you do"):
 * on Friday November 27, Eastern time, every quest counts twice on the
 * Quests leaderboard and the profile's Quests card. The counting is done by
 * the database (ew_quest_board in supabase-holidays-2026.sql); the game only
 * says so, with a banner once (BlackFridayBanner.vue) and a 2× tag on the
 * leaderboard's Quests button.
 *
 * Test on another day with the season test date (src/util/season.ts):
 *   localStorage.setItem('nge.seasonDate', '2026-11-27')
 */
export const BLACK_FRIDAY = '2026-11-27';

/** Today as YYYY-MM-DD in Eastern time, or the season test date. */
function todayEastern(now = new Date()): string {
  try {
    const t = localStorage.getItem('nge.seasonDate');
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  } catch { /* storage blocked */ }
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return p;   // en-CA formats as YYYY-MM-DD
}

export function isBlackFriday(now = new Date()): boolean {
  return todayEastern(now) === BLACK_FRIDAY;
}
