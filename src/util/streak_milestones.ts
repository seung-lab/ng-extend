/**
 * Streak milestones (Ames 2026-10-06, for the custom streak achievements).
 *
 *   2, 3, 5, 7, 14, 21, 28, 30,
 *   then every 10 days from 40 to 100,
 *   then every 25 days (125, 150, ...),
 *   and every full year (365, 730, ...), which is not on the 25 day grid.
 *
 * functions/index.js carries the same rule for the server, which only accepts
 * a streak notification for a real milestone the saved streak has reached.
 * Keep the two in step.
 */
const EARLY = [2, 3, 5, 7, 14, 21, 28, 30];

export function isStreakMilestone(days: number): boolean {
  if (!Number.isInteger(days) || days < 2) return false;
  if (days <= 30) return EARLY.includes(days);
  if (days <= 100) return days % 10 === 0;
  return days % 25 === 0 || days % 365 === 0;
}

/** The first milestone after this many days. */
export function nextStreakMilestone(days: number): number {
  let d = Math.max(1, Math.floor(days)) + 1;
  while (!isStreakMilestone(d)) d++;
  return d;
}

/** Milestones passed going from one streak length to another (normally one). */
export function streakMilestonesBetween(before: number, after: number): number[] {
  const out: number[] = [];
  for (let d = Math.max(1, before) + 1; d <= after && out.length < 50; d++) if (isStreakMilestone(d)) out.push(d);
  return out;
}

const LINES: Record<number, string> = {
  2: 'Two days in a row. That is how every streak starts!',
  3: 'Three days running. The flame is catching!',
  5: 'Five days straight. You are on a roll!',
  7: 'A full week of mapping the brain, every single day. Congratulations!',
  14: 'Two weeks straight. That is real dedication. Congratulations!',
  21: 'Three weeks without missing a day. This is a habit now!',
  28: 'Four full weeks, every single day. Outstanding!',
  30: 'A whole month without missing a day. Incredible work!',
  40: 'Forty days in a row. The neurons thank you!',
  50: 'Fifty days straight. Halfway to a hundred!',
  60: 'Sixty days in a row. You are a force of nature!',
  70: 'Seventy days running. Nothing stops you!',
  80: 'Eighty days in a row. Remarkable!',
  90: 'Ninety days straight. One hundred is in sight!',
  100: 'One hundred days. You are an EyeWire legend!',
  200: 'Two hundred days of science, back to back. Astonishing!',
  365: 'A full year, every single day. There are no words. Thank you!',
};

/** The congratulation for a milestone. */
export function streakLine(days: number): string {
  if (LINES[days]) return LINES[days];
  if (days % 365 === 0) return `${days / 365} full years, every single day. There are no words. Thank you!`;
  return `${days.toLocaleString()} days in a row. Every one of them moved the map forward. Thank you!`;
}
