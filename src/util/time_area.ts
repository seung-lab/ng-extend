/**
 * Time in Pyr (Ames 2026-11-19: "see how much time they're actually spending
 * in Pyr and also maybe what area of the site they're in"). The presence
 * heartbeat, once a minute, also says which part of Pyr is on screen and
 * whether the player used the mouse or keyboard lately. The server adds up
 * the minutes for team members only (supabase-team-time.sql); the Access
 * page shows them.
 */

/** Input in the last two minutes, with the tab in front, counts as active. */
const ACTIVE_MS = 2 * 60_000;
let lastInput = Date.now();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  const mark = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, mark, { capture: true, passive: true });
  }
}

export function activeNow(): boolean {
  listen();
  return !document.hidden && Date.now() - lastInput < ACTIVE_MS;
}

/** What is on screen, first match wins: a panel over the viewer, else the viewer. */
const AREAS: [string, string][] = [
  ['admin', '.nge-admin-hub, .ah'],
  ['tutorial', '.introductionStep, .nge-tut-resume'],
  ['cell_library', '.nge-cl-panel'],
  ['quests', '.nge-quest-board, .nge-hunt'],
  ['profile', '.nge-profile-modal'],
  ['leaderboard', '.nge-lb-modal'],
  ['settings', '.nge-settings-modal'],
];
const shown = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].some(e => e.offsetParent !== null || e.getClientRects().length > 0);

export function currentArea(): string {
  listen();
  try {
    for (const [name, sel] of AREAS) if (shown(sel)) return name;
  } catch { /* a page without these never fails the heartbeat */ }
  return 'viewer';
}

listen();
