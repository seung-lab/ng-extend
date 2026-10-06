/**
 * The Days track's ladder (Ames 2026-10-06): milestones on the total number
 * of days a player has shown up. Total days never resets, unlike a streak.
 *
 *   2, 3, 5, 7, 14, 21, 28, 30, 40, 50, 60, 70, 80, 90, 100,
 *   then every 25 (125, 150, 175, 200, 225, ...), without end,
 *   plus each full year (365, 730, ...).
 * Big celebration: every 100 days and every full year.
 *
 * The server checks the same rule before it lets a milestone notification be
 * sent (functions/index.js, "notification.self"): keep the two in step.
 */
const FIRST = [2, 3, 5, 7, 14, 21, 28, 30, 40, 50, 60, 70, 80, 90, 100];

export function isDayMilestone(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n <= 100) return FIRST.includes(n);
  return n % 25 === 0 || n % 365 === 0;
}

/** Every 100 days, and every full year. */
export function isBigDayMilestone(n: number): boolean {
  return isDayMilestone(n) && n >= 100 && (n % 100 === 0 || n % 365 === 0);
}

/** The first milestone above n. */
export function nextDayMilestone(n: number): number {
  let m = Math.max(1, Math.floor(n)) + 1;
  while (!isDayMilestone(m)) m++;
  return m;
}

/** The last milestone at or below n, or 0 when there is none yet. */
export function lastDayMilestone(n: number): number {
  for (let m = Math.floor(n); m >= 2; m--) if (isDayMilestone(m)) return m;
  return 0;
}

/** Milestones passed going from `before` to `now`: above before, up to now. */
export function dayMilestonesReached(before: number, now: number): number[] {
  const out: number[] = [];
  for (let m = nextDayMilestone(before); m <= now; m = nextDayMilestone(m)) out.push(m);
  return out;
}

/** A stretch of the ladder around n: the last `behind` reached and the next `ahead`. */
export function dayLadderAround(n: number, behind = 3, ahead = 3): { days: number; reached: boolean; big: boolean }[] {
  const reached: number[] = [];
  for (let m = lastDayMilestone(n); m > 0 && reached.length < behind; m = lastDayMilestone(m - 1)) reached.unshift(m);
  const next: number[] = [];
  for (let m = nextDayMilestone(n); next.length < ahead; m = nextDayMilestone(m)) next.push(m);
  return [...reached.map(days => ({ days, reached: true, big: isBigDayMilestone(days) })),
          ...next.map(days => ({ days, reached: false, big: isBigDayMilestone(days) }))];
}

/** "1 year", "2 years", or "" when n is not a whole number of years. */
export function wholeYears(n: number): string {
  if (n < 365 || n % 365 !== 0) return '';
  const y = n / 365;
  return y === 1 ? '1 year' : `${y} years`;
}
