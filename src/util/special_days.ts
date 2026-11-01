/**
 * Fireworks on special days (Ames 2026-11-01): New Year's Day and the Pyr
 * anniversary, Sep 28. Days go by Eastern time like the awards. They go off
 * once a day per browser, a little after the game opens, and not for players
 * who turned the Achievement celebration off or asked for a calm screen.
 */
import { fireworkBurst } from '../vendor/pixelfx/pyr.js';
import { fxMotionOk, playFx } from './pixelfx';

const COLOURS: string[][] = [
  ['#3d0a33', '#701560', '#b0228f', '#f53cd1', '#ff86e6', '#ffd2f6', '#ffffff'],
  ['#07204a', '#0d3f86', '#1a6fd0', '#00c8ff', '#7fe4ff', '#d0f6ff', '#ffffff'],
  ['#25124f', '#452a94', '#7b5cff', '#9b6bff', '#c58bff', '#ecdcff', '#ffffff'],
  ['#4a2c08', '#86520c', '#c48412', '#f0b424', '#ffe066', '#fff6c4', '#ffffff'],
];

/** A few fireworks across the top of a box, or of the page without one. */
export function launchFireworks(count: number, host?: HTMLElement) {
  const width = host?.clientWidth ?? window.innerWidth, height = host?.clientHeight ?? window.innerHeight;
  const scale = width >= 1100 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    playFx(fireworkBurst, {
      host, scale,
      x: width * (0.12 + 0.76 * ((i * 0.618 + 0.2) % 1)),
      y: height * (0.22 + 0.2 * ((i * 0.382) % 1)),
      delay: i * 0.7,
      options: { palette: COLOURS[i % COLOURS.length], seed: 9 + i * 7 },
    });
  }
}

/** Today's special day, or null. */
export function specialDay(now = new Date()): string | null {
  const md = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).format(now);
  return md === '1/1' ? 'new-year' : md === '9/28' ? 'anniversary' : null;
}

export function celebrateSpecialDay() {
  const day = specialDay();
  if (!day || !fxMotionOk()) return;
  const key = `pyr.specialDay.${day}.${new Date().getFullYear()}`;
  try {
    if (JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}').achievementCelebration === false) return;
    if (localStorage.getItem(key)) return;
  } catch { /* no storage: it may go off again next time */ }
  // Only once the player can see them: signed in, and on this tab.
  const waiting = setInterval(() => {
    if (document.hidden || document.querySelector('.nge-login-blocker')) return;
    clearInterval(waiting);
    try { localStorage.setItem(key, '1'); } catch { /* as above */ }
    setTimeout(() => launchFireworks(6), 4000);
  }, 2000);
}
