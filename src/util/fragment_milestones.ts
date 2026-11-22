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
 * The banner is the shared community one (util/community_milestones.ts).
 */
import { ref } from 'vue';
import { celebrate, milestoneAt, nextMilestoneAfter } from './community_milestones';

export const FIRST_MILESTONE = 500;
export const MILESTONE_STEP = 1000;

/** The lab's fragments still to do, for the Cell Library's tab (toknow #610:
 *  it showed the size of the first sample list, 151). Null until known. */
export const fragmentsToDo = ref<number | null>(null);

/** Fragments completed by everyone, once the server has said; null before. */
export const fragmentsDone = ref<number | null>(null);

/** The highest milestone at or below n, or 0 for none yet. */
export function milestoneReached(n: number): number { return milestoneAt('fragments', n); }
/** The next milestone above n. */
export function nextMilestone(n: number): number { return nextMilestoneAfter('fragments', n); }

/** The server's count. A milestone this browser has not celebrated yet comes
 *  up in the community banner (components/CommunityMilestone.vue), only the
 *  latest one when several were crossed while away. */
export function setFragmentsDone(n: number) {
  if (!Number.isFinite(n) || n < 0) return;
  fragmentsDone.value = n;
  const m = milestoneReached(n);
  if (m > 0) celebrate('fragments', m);
}
/** One more fragment done in this browser, before the server is asked again. */
export function addFragmentDone() {
  if (fragmentsDone.value != null) setFragmentsDone(fragmentsDone.value + 1);
}
