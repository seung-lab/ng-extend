/**
 * Whether this player is an apprentice in the mentor program right now
 * (src/mentor.ts sets it). Kept in a module of its own so the completion code
 * (lightbulb_service, store) can read it without importing the program.
 *
 * While it is on, a completion goes to a mentor from the Cell Library, and
 * every other way of completing a cell explains that instead of counting.
 */
export const apprenticeFlag = { active: false, cellsNeeded: 5 };

export function apprenticeBlockMessage(): string {
  return `You are in the mentor program: for your first ${apprenticeFlag.cellsNeeded} cells, complete a claimed cell from the Cell Library, so a mentor can take a second look.`;
}
