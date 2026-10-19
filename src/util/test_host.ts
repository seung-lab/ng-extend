/**
 * A branch test site (`<branch>-dot-brain-wire-dot-seung-lab.ue.r.appspot.com`),
 * where Ames walks a change before it goes live. Each one is a new origin
 * with empty browser storage, so everything that greets a first visit came
 * up on every one of them (Ames 2026-10-19: "can you make your test servers
 * not give me 1000 popups? I always get tutorial, badge, profile..").
 *
 * On these sites the greetings stay away: the tutorial waits until one is
 * started from the menu, the leaderboard does not open on arrival, the
 * Loyalty achievement card and the welcome sparkle do not play, and the
 * split screen tip does not show. Everything still works when opened by
 * hand. Add `?popups` to the address to get them all back for a test.
 *
 * The live game, the Princeton tracers' site, GitHub Pages and local dev
 * servers are not test sites here, so nothing changes there.
 */
function quietTestHost(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    if (new URLSearchParams(location.search).has('popups')) return false;
  } catch { /* an odd address: treat it as a test site */ }
  const h = location.hostname;
  if (!h.endsWith('-dot-brain-wire-dot-seung-lab.ue.r.appspot.com')) return false;
  return !h.startsWith('eyewire-ii-community-dot-') && !h.startsWith('princeton-tracers-dot-');
}

export const QUIET_TEST_HOST = quietTestHost();
