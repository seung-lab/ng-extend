/**
 * One popup at a time (Ames 2026-11-20: "make sure that we don't ever have
 * >1 popup at a time occurring for players").
 *
 * Anything that appears on its own (an Achievement, a celebration, a prompt,
 * a notice) asks for a turn first:
 *
 *   if (!(await takeTurn('quest-card', () => !!questCard.value))) return;
 *   questCard.value = card;
 *
 * takeTurn resolves when nothing else is showing, then watches isOpen and
 * frees the turn by itself once the popup is gone, so a producer never has
 * to remember to let go. It resolves false when the popup waited longer
 * than maxWaitMs and is no longer worth showing.
 *
 * While a sign-in screen, the beta or Principles gate, the "Now entering"
 * screen or the intro tour is up, every turn waits. Those, and the status
 * banners (outage, server down, no access), are not queued themselves.
 */
import { ref } from 'vue';

/** A quiet arrival (Ames 2026-11-20: "Im mostly concerned with opening the
 *  page and getting like 5 popups"): for the first two minutes, news that can
 *  wait (skipOnLoad) skips its popup; it stays in the bell or its chip. What
 *  the player earned or must answer still shows, one at a time, and the
 *  leaderboard greets only when nothing else did (quietArrival). */
const pageStart = Date.now();
const LOAD_QUIET_MS = 120_000;
let shownSinceLoad = 0;
/** True while nothing has popped up since the page opened and nothing waits. */
export function quietArrival(): boolean { return shownSinceLoad === 0 && !current && waiting.length === 0; }
/** True in the first two minutes after the page opened. */
export function justArrived(): boolean { return Date.now() - pageStart < LOAD_QUIET_MS; }

interface Waiter { id: string; priority: number; since: number; maxWaitMs: number; isOpen: () => boolean; resolve: (ok: boolean) => void }

/** The popup on screen now, or null. */
export const activePopup = ref<string | null>(null);

const BLOCKERS = [
  '.nge-login-blocker', '.nge-beta-screen', '.nge-principles-screen', '.nge-dst',
  '.nge-mw-blocker', '.nge-intro', '.introductionStep',
];
/** Extra checks a module can add: while any returns true, no turn is given. */
const holds: (() => boolean)[] = [];
export function addPopupHold(check: () => boolean): void { holds.push(check); }

const waiting: Waiter[] = [];
let current: Waiter | null = null;
let openedAt = 0;
let freedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** A short breath between one popup closing and the next opening. */
const GAP_MS = 700;
/** Time a popup gets to draw before isOpen is trusted. */
const SETTLE_MS = 1200;

function blocked(): boolean {
  try {
    for (const sel of BLOCKERS) {
      const el = document.querySelector(sel);
      if (el && el.getClientRects().length) return true;
    }
  } catch { /* no DOM */ }
  return holds.some(h => { try { return h(); } catch { return false; } });
}

function tick() {
  const now = Date.now();
  // Drop what waited too long to still matter.
  for (let i = waiting.length - 1; i >= 0; i--) {
    const w = waiting[i];
    if (now - w.since > w.maxWaitMs) { waiting.splice(i, 1); w.resolve(false); }
  }
  if (current) {
    let open = true;
    try { open = current.isOpen(); } catch { open = false; }
    if (now - openedAt < SETTLE_MS || open) return;
    current = null;
    activePopup.value = null;
    freedAt = now;
  }
  if (!waiting.length && !current) { if (timer) { clearInterval(timer); timer = null; } return; }
  if (now - freedAt < GAP_MS || blocked()) return;
  waiting.sort((a, b) => b.priority - a.priority || a.since - b.since);
  const next = waiting.shift()!;
  current = next;
  openedAt = now;
  activePopup.value = next.id;
  shownSinceLoad++;
  next.resolve(true);
}

function ensureTimer() { if (!timer) timer = setInterval(tick, 250); }

/**
 * Wait for this popup's turn. isOpen says whether it is still showing; the
 * turn ends when it returns false. Higher priority goes first; equal
 * priority goes in the order asked.
 */
export function takeTurn(id: string, isOpen: () => boolean, opts: { priority?: number; maxWaitMs?: number; skipOnLoad?: boolean } = {}): Promise<boolean> {
  if (opts.skipOnLoad && justArrived()) return Promise.resolve(false);
  return new Promise(resolve => {
    waiting.push({ id, priority: opts.priority ?? 0, since: Date.now(), maxWaitMs: opts.maxWaitMs ?? 30 * 60_000, isOpen, resolve });
    ensureTimer();
    tick();
  });
}

/** True while any queued popup is showing or waiting. */
export function popupBusy(): boolean { return !!current || waiting.length > 0; }
