/**
 * Whether this player is an apprentice in the mentor program right now
 * (src/mentor.ts sets it). Kept in a module of its own so the completion code
 * (lightbulb_service, store) can read it without importing the program.
 *
 * While it is on, a completion goes to a mentor from the Cell Library, and
 * every other way of completing a cell explains that instead of counting.
 */
export const apprenticeFlag = { active: false, cellsNeeded: 5 };

let lastShown = 0;
/** The message, and a centered card saying it (MentorBox listens), at most
 *  once a second: some paths ask twice for one press. */
export function apprenticeBlockMessage(): string {
  if (Date.now() - lastShown > 1000) {
    lastShown = Date.now();
    try { document.dispatchEvent(new CustomEvent('nge:mentor-blocked')); } catch { /* no page */ }
  }
  return `You are in the mentor program: for your first ${apprenticeFlag.cellsNeeded} cells, complete a claimed cell from the Cell Library, so a mentor can take a second look.`;
}
