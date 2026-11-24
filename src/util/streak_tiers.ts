/**
 * Flame tiers for the streak chip (Ames 2026-11-20): the 🔥 in the top bar
 * levels up as the streak grows, and celebrates once when it does.
 *
 *   1 Spark · 7 Kindled · 14 Blue Core · 30 Plasma · 50 Starfire · 100 Nova · 365 Solar
 *
 * The tier follows the CURRENT streak, so a broken streak takes the flame
 * back to a Spark. Every tier day is also a streak milestone
 * (streak_milestones.ts), which brings the bell note; the chip's own
 * celebration replaces the milestone confetti on those days.
 */
export interface FlameTier {
  days: number;
  id: 'spark' | 'kindled' | 'bluecore' | 'plasma' | 'starfire' | 'nova' | 'solar';
  name: string;
  /** The tier's light, as "r,g,b", for glows and the card. */
  rgb: string;
}

export const FLAME_TIERS: FlameTier[] = [
  { days: 1, id: 'spark', name: 'Spark', rgb: '255,150,40' },
  { days: 7, id: 'kindled', name: 'Kindled', rgb: '255,204,80' },
  { days: 14, id: 'bluecore', name: 'Blue Core', rgb: '130,205,255' },
  { days: 30, id: 'plasma', name: 'Plasma', rgb: '80,232,255' },
  { days: 50, id: 'starfire', name: 'Starfire', rgb: '214,120,255' },
  { days: 100, id: 'nova', name: 'Nova', rgb: '255,140,220' },
  { days: 365, id: 'solar', name: 'Solar', rgb: '236,244,255' },
];

/** Index into FLAME_TIERS for a streak of this many days. */
export function flameTierIndex(days: number): number {
  let i = 0;
  while (i + 1 < FLAME_TIERS.length && days >= FLAME_TIERS[i + 1].days) i++;
  return i;
}

export function flameTier(days: number): FlameTier {
  return FLAME_TIERS[flameTierIndex(days)];
}

/** The next tier up, or null at the top. */
export function nextFlameTier(days: number): FlameTier | null {
  return FLAME_TIERS[flameTierIndex(days) + 1] ?? null;
}

export function isFlameTierDay(days: number): boolean {
  return days > 1 && FLAME_TIERS.some(t => t.days === days);
}
