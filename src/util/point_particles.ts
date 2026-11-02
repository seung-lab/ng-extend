/**
 * Particles where a cut, merge or Find Path point lands (Ames 2026-11-02,
 * from Nseraf's #342: Highlight already bursts at its points).
 *
 * The three tools are neuroglancer's own and place their points on
 * Ctrl+click (a tap on a touch screen). On that press this module notes the
 * tool's point count, then checks it for a moment: once the count goes up,
 * the point really landed and a small burst goes off where the click was.
 * A click that misses the cell places nothing, so it gets nothing.
 *   Cut: red or blue, the colour of the point placed.
 *   Merge: gold.  Find Path: green.
 * Smaller than Highlight's, since cut points often go down several at once.
 *
 * Settings, "Particles" (userPrefs.pointParticles, on by default) turns this
 * and the Highlight and Tag mode bursts off together. Calm screen stops them
 * too, through the reduced motion check inside runParticleBurst.
 */
import { useUserPreferencesStore } from '../store';
import { currentSegLayer } from '../datasets';
import { runParticleBurst } from './holo_trace';

export function pointParticlesOn(): boolean {
  try { return useUserPreferencesStore().prefs.pointParticles !== false; } catch { return true; }
}

const CUT_RED = '255,90,90', CUT_BLUE = '80,150,255', MERGE_GOLD = '255,200,87', PATH_GREEN = '90,230,140';
const WATCH_MS = 900;
const SCALE = 0.6;

const graphState = (): any => (currentSegLayer() as any)?.layer?.graphConnection?.value?.state;

/** What the open tool has placed so far, or null when none of the three is open. */
function snapshot(): { tool: 'cut' | 'merge' | 'path'; red: number; blue: number; n: number; path: string } | null {
  try {
    if (document.querySelector('.graphene-multicut')) {
      const ms = graphState()?.multicutState;
      return { tool: 'cut', red: ms?.sinks?.size ?? 0, blue: ms?.sources?.size ?? 0, n: 0, path: '' };
    }
    if (document.querySelector('.graphene-merge-segments')) {
      return { tool: 'merge', red: 0, blue: 0, n: document.querySelectorAll('.graphene-merge-segments-point').length, path: '' };
    }
    if (document.querySelector('.graphene-find-path')) {
      const st = graphState()?.findPathState;
      return { tool: 'path', red: 0, blue: 0, n: 0, path: st ? JSON.stringify(st.toJSON() ?? null) : '' };
    }
  } catch { /* the layer went away */ }
  return null;
}

/** The colour of the point that landed since `before`, or '' while none has. */
function landed(before: NonNullable<ReturnType<typeof snapshot>>): string {
  const now = snapshot();
  if (!now || now.tool !== before.tool) return '';
  if (now.tool === 'cut') return now.red > before.red ? CUT_RED : now.blue > before.blue ? CUT_BLUE : '';
  if (now.tool === 'merge') return now.n > before.n ? MERGE_GOLD : '';
  // Find Path: a new end changes the saved form; a cleared tool is not a point.
  return now.path !== before.path && now.path !== 'null' && now.path !== '' ? PATH_GREEN : '';
}

let started = false;
/** Only the latest press is watched, so a missed click cannot burst later at its old spot. */
let press = 0;
export function startPointParticles() {
  if (started) return;
  started = true;
  window.addEventListener('pointerdown', e => {
    press++;
    if (e.button !== 0) return;
    if (e.pointerType !== 'touch' && !(e.ctrlKey || e.metaKey)) return;
    // Only clicks in the 2D and 3D views place points.
    if (!(e.target as Element | null)?.closest?.('.neuroglancer-rendered-data-panel')) return;
    if (!pointParticlesOn()) return;
    const before = snapshot();
    if (!before) return;
    const x = e.clientX, y = e.clientY, t0 = performance.now(), mine = press;
    const look = () => {
      if (mine !== press) return;
      const rgb = landed(before);
      if (rgb) { runParticleBurst(x, y, rgb, SCALE); return; }
      if (performance.now() - t0 < WATCH_MS) setTimeout(look, 30);
    };
    setTimeout(look, 30);
  }, true);
}
