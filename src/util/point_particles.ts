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
 * Kept light so placing points never waits on it (Ames 2026-11-02: the first
 * version made cut points feel slow): one small canvas made once and moved
 * to each point, no device pixel scaling, a few particles and no full canvas
 * glow, and a new burst simply replaces the one still running.
 *
 * Settings, "Particles" (userPrefs.pointParticles, on by default) turns this
 * and the Highlight and Tag mode bursts off together. Calm screen stops them
 * too, through the reduced motion check.
 */
import { useUserPreferencesStore } from '../store';
import { currentSegLayer } from '../datasets';

export function pointParticlesOn(): boolean {
  try { return useUserPreferencesStore().prefs.pointParticles !== false; } catch { return true; }
}

const CUT_RED = '255,90,90', CUT_BLUE = '80,150,255', MERGE_GOLD = '255,200,87', PATH_GREEN = '90,230,140';
const WATCH_MS = 900;

const SIZE = 220, HALF = SIZE / 2, DUR = 650;
let cv: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;

/** A small burst at (x, y) on the one shared canvas. */
function burst(x: number, y: number, rgb: string) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = SIZE; cv.height = SIZE;
    cv.style.cssText = `position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;pointer-events:none;z-index:100000;display:none;will-change:transform;`;
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    ctx = cv.getContext('2d');
  }
  if (!ctx) return;
  cancelAnimationFrame(raf);
  cv.style.transform = `translate(${Math.round(x - HALF)}px,${Math.round(y - HALF)}px)`;
  cv.style.display = 'block';
  const parts = Array.from({ length: 16 }, () => ({ a: Math.random() * 6.283, sp: 40 + Math.random() * 60, r: 1 + Math.random() * 1.4 }));
  const streaks = Array.from({ length: 6 }, () => ({ a: Math.random() * 6.283, len: 50 + Math.random() * 45 }));
  const c = ctx, t0 = performance.now();
  const draw = (now: number) => {
    const k = (now - t0) / DUR;
    c.clearRect(0, 0, SIZE, SIZE);
    if (k >= 1) { cv!.style.display = 'none'; return; }
    c.globalCompositeOperation = 'lighter';
    if (k < 0.3) {
      const q = k / 0.3, head = q * q * (3 - 2 * q);
      c.lineCap = 'round'; c.lineWidth = 1.2;
      c.strokeStyle = `rgba(${rgb},${((1 - q) * 0.55).toFixed(3)})`;
      c.beginPath();
      for (const st of streaks) {
        const r1 = 4 + head * st.len, r2 = 4 + head * st.len * 0.55;
        c.moveTo(HALF + Math.cos(st.a) * r2, HALF + Math.sin(st.a) * r2);
        c.lineTo(HALF + Math.cos(st.a) * r1, HALF + Math.sin(st.a) * r1);
      }
      c.stroke();
      c.fillStyle = `rgba(235,245,255,${(0.5 * (1 - q)).toFixed(3)})`;
      c.beginPath(); c.arc(HALF, HALF, 3 + 7 * (1 - q), 0, 6.283); c.fill();
    }
    c.fillStyle = `rgba(${rgb},${(Math.pow(1 - k, 1.3) * 0.85).toFixed(3)})`;
    c.beginPath();
    const eo = 1 - Math.pow(1 - k, 2);
    for (const p of parts) {
      const px = HALF + Math.cos(p.a) * p.sp * eo, py = HALF + Math.sin(p.a) * p.sp * eo;
      c.moveTo(px + p.r, py); c.arc(px, py, p.r * (1 - k * 0.35), 0, 6.283);
    }
    c.fill();
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}

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
      if (rgb) { burst(x, y, rgb); return; }
      if (performance.now() - t0 < WATCH_MS) setTimeout(look, 40);
    };
    // Neuroglancer adds the point in its own handler for this press, so the
    // first look comes right after it.
    setTimeout(look, 0);
  }, true);
}
