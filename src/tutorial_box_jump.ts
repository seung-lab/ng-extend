/**
 * Admins only: open a tutorial at one box, from a link like
 * "?tutorialBox=5.7" (tutorial 5, box 7: the box number the tutorial timing
 * records). The Access page's "Tutorial boxes players linger on" rows link
 * here (Ames 2026-11-09: "click to open that step in tutorial").
 *
 * It shows the box as players see it. A box that relies on an earlier one
 * (an edit made) shows its words and highlights, but its check may wait on
 * something that never happened. The practice tutorials (Merge, Cut and the
 * two Sandboxes) need their practice cell, which only their start loads: a
 * link to one of their boxes starts that tutorial from its beginning. It
 * moves the admin's own place in that tutorial, like any other visit.
 */
import { watch } from 'vue';
import { useTutorialStore } from './store-pyr';
import { useProofreadingBackendStore } from './store';

export const BOX_PARAM = 'tutorialBox';
/** Merge, Cut, Merger Sandbox, Extension Sandbox (Tutorial.vue's list). */
export const PRACTICE_TUTORIALS = [3, 5, 9, 13];

export function parseBox(v: string | null): [number, number] | null {
  const m = v ? /^(\d{1,2})\.(\d{1,3})$/.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function boxLink(tutorial: number, box: number, base = `${window.location.origin}${window.location.pathname}`): string {
  return `${base}?${BOX_PARAM}=${tutorial}.${box}`;
}

let started = false;
export function startTutorialBoxJump() {
  if (started) return;
  started = true;
  let want: [number, number] | null = null;
  try { want = parseBox(new URLSearchParams(window.location.search).get(BOX_PARAM)); } catch { /* no address */ }
  if (!want) return;
  // The link is used once: a refresh does not jump again.
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete(BOX_PARAM);
    window.history.replaceState(window.history.state, '', u.toString());
  } catch { /* keep going */ }
  const backend = useProofreadingBackendStore();
  let done = false;
  const go = () => {
    if (done || !want || !backend.isAdmin) return;
    done = true;
    // After the account's saved tutorial place has loaded, which would
    // otherwise put the admin back where they were.
    openTutorialBox(want[0], want[1], 2500);
  };
  watch(() => backend.isAdmin, go, { immediate: true });
}

/** Open tutorial t at box s, now or after a wait (also Open to edit on an
 *  edit note, src/text_edit_links.ts). */
export function openTutorialBox(t: number, s: number, delayMs = 0) {
  const tutorials = useTutorialStore();
  const len = Number((window as any).__ngeTutorialLengths?.[t]) || 0;
  if (!len) { console.warn(`[tutorial box] no tutorial ${t}`); return; }
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('nge:tutorial-box', { detail: { tutorial: t, box: s } }));
    if (PRACTICE_TUTORIALS.includes(t)) {
      document.dispatchEvent(new CustomEvent('nge:tutorial-start', { detail: { id: t } }));
      return;
    }
    tutorials.activeTutorial = t;
    tutorials.setTutorialStep(Math.min(Math.max(0, s), len - 1));
  }, delayMs);
}
