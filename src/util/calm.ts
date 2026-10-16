/**
 * Calm screen (Settings, Ames 2026-10-16, from annkri's report #144: "too many
 * glowing/ bright elements that are stealing fokus ... it gets to much and
 * strenuous too look at over time").
 *
 * One switch, off by default, kept per player (userPrefs.calmScreen). On, it:
 * - puts body.nge-calm on the page. The global rules in ng-override.css stop
 *   every CSS animation and transition (each lands on its last frame, as the
 *   reduced motion rules do) and take away text glow; panels add their own
 *   body.nge-calm rules for the glows that are drawn another way.
 * - answers "reduce" to the code that asks the browser whether to reduce
 *   motion (window.matchMedia('(prefers-reduced-motion: reduce)')). Twenty or
 *   so places already ask that (the profile curves, rolling numbers, the
 *   growing cells, the leaderboard), so they all go still with no change of
 *   their own. A few read it once when they load, so those follow after a
 *   reload; the setting's hint says so.
 * The cells and the 3D view are not touched: only the interface around them.
 */
import { watch } from 'vue';
import { useUserPreferencesStore } from '../store';

let calm = false;
export function isCalm(): boolean { return calm; }

const REDUCE = /prefers-reduced-motion\s*:\s*reduce/i;

function patchMatchMedia() {
  const original = window.matchMedia?.bind(window);
  if (!original || (window.matchMedia as any).__ngeCalm) return;
  const patched = (query: string): MediaQueryList => {
    const list = original(query);
    if (!REDUCE.test(query)) return list;
    // The real list, except that it matches while the screen is calm.
    return new Proxy(list, {
      get(target, prop) {
        if (prop === 'matches') return calm || target.matches;
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  };
  (patched as any).__ngeCalm = true;
  window.matchMedia = patched as typeof window.matchMedia;
}

/** Called once at start up, before the panels are drawn. */
export function startCalm() {
  // Read the saved choice straight away, so code that asks once at load
  // already gets the right answer on a reload.
  try { calm = JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}')?.calmScreen === true; } catch { calm = false; }
  document.body.classList.toggle('nge-calm', calm);
  patchMatchMedia();
  // Then follow the setting (and the account's copy when it arrives).
  setTimeout(() => watch(() => useUserPreferencesStore().prefs.calmScreen === true, on => {
    calm = on;
    document.body.classList.toggle('nge-calm', on);
  }, { immediate: true }), 0);
}
