/**
 * Lost Fragments milestones (Ames 2026-11-20: "some celebration when they get
 * to the first 500 and another celebration for every thousand after that like
 * confetti in the site and a banner that pops up saying congrats we just
 * completed in lost fragments and have a countdown that shows how many to go").
 *
 * Milestones: 500, then 1,000, 2,000, 3,000 and on. The count is every
 * fragment anyone has completed, read from the server's fragments.list (this
 * player's own answers plus everyone else's). Each milestone celebrates once
 * per browser: a player away when it was crossed sees it on their next visit.
 */
import { ref } from 'vue';

export const FIRST_MILESTONE = 500;
export const MILESTONE_STEP = 1000;

/** Fragments completed by everyone, once the server has said; null before. */
export const fragmentsDone = ref<number | null>(null);
/** The milestone to celebrate now, or null. */
export const milestoneToShow = ref<number | null>(null);

/** The highest milestone at or below n, or 0 for none yet. */
export function milestoneReached(n: number): number {
  if (n < FIRST_MILESTONE) return 0;
  if (n < MILESTONE_STEP) return FIRST_MILESTONE;
  return Math.floor(n / MILESTONE_STEP) * MILESTONE_STEP;
}
/** The next milestone above n. */
export function nextMilestone(n: number): number {
  if (n < FIRST_MILESTONE) return FIRST_MILESTONE;
  return (Math.floor(n / MILESTONE_STEP) + 1) * MILESTONE_STEP;
}

const SEEN_KEY = 'nge_lf_milestone_seen_v1';
function seen(): number {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
}
export function markMilestoneSeen(m: number) {
  try { if (m > seen()) localStorage.setItem(SEEN_KEY, String(m)); } catch { /* private mode */ }
}

/** The server's count. A milestone this browser has not celebrated yet comes
 *  up, only the latest one when several were crossed while away. */
export function setFragmentsDone(n: number) {
  if (!Number.isFinite(n) || n < 0) return;
  fragmentsDone.value = n;
  const m = milestoneReached(n);
  if (m > 0 && m > seen()) milestoneToShow.value = m;
}
/** One more fragment done in this browser, before the server is asked again. */
export function addFragmentDone() {
  if (fragmentsDone.value != null) setFragmentsDone(fragmentsDone.value + 1);
}
