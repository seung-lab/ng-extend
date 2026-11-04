/**
 * Falling leaves (Ames 2026-11-04: "can we make fall foliage fall from the
 * top of the site").
 *
 * In the fall (src/util/season.ts: from 22 September to the end of
 * Thanksgiving week), now and then a light shower of autumn leaves drifts
 * down from the top of the screen, swaying and turning over as they go, and
 * is gone in about ten seconds. The first comes half a minute or so after
 * Pyr opens, then one every five to ten minutes.
 *
 * They never get in the way: one see-through canvas that ignores the mouse,
 * made for a shower and taken away after it. Nothing is drawn between
 * showers, and nothing at all outside the fall.
 *
 * The leaf button by the chat box (outside Thanksgiving week, when the turkey
 * button takes its place) and Settings, "Falling leaves", are one switch
 * (userPrefs.hideLeaves): off, the leaves go and the button goes grey; on, a
 * shower falls straight away. Calm screen keeps them away.
 */
import { useUserPreferencesStore } from '../store';
import { isCalm } from './calm';
import { fallSeason } from './season';

// Every five to ten minutes (Ames 2026-11-04).
const FIRST_MS = [25_000, 50_000], EVERY_MS = [5 * 60_000, 10 * 60_000];

export function leavesSeason(): boolean { return fallSeason(); }

export function leavesHidden(): boolean {
  try { return useUserPreferencesStore().prefs.hideLeaves === true; } catch { return false; }
}

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const between = ([a, b]: number[]) => a + Math.random() * (b - a);
const mayShow = () => leavesSeason() && !leavesHidden() && !isCalm() && !reduced() && !document.hidden;

/** Red, orange, gold and brown, bright enough to read on the dark screen. */
const COLOURS = ['#e8552b', '#f28c28', '#f6c142', '#d63f2f', '#b8692c', '#f2a03d'];

/** Leaf outlines, about 1 unit long, stem end at the bottom. */
let shapes: Path2D[] | null = null;
function leafShapes(): Path2D[] {
  if (shapes) return shapes;
  // A maple leaf: five points.
  const maple = new Path2D('M0,0.5 L0.06,0.22 L0.42,0.3 L0.32,0.08 L0.5,-0.05 L0.28,-0.12 L0.33,-0.38 L0.12,-0.28 L0,-0.5 L-0.12,-0.28 L-0.33,-0.38 L-0.28,-0.12 L-0.5,-0.05 L-0.32,0.08 L-0.42,0.3 L-0.06,0.22 Z');
  // An oak leaf: rounded lobes.
  const oak = new Path2D('M0,0.5 C0.08,0.4 0.22,0.38 0.2,0.24 C0.34,0.24 0.36,0.1 0.24,0.06 C0.36,0.0 0.34,-0.16 0.2,-0.14 C0.28,-0.28 0.18,-0.42 0.06,-0.34 C0.04,-0.46 -0.04,-0.46 -0.06,-0.34 C-0.18,-0.42 -0.28,-0.28 -0.2,-0.14 C-0.34,-0.16 -0.36,0.0 -0.24,0.06 C-0.36,0.1 -0.34,0.24 -0.2,0.24 C-0.22,0.38 -0.08,0.4 0,0.5 Z');
  // A plain leaf: a pointed oval.
  const plain = new Path2D('M0,0.5 C0.3,0.3 0.3,-0.2 0,-0.5 C-0.3,-0.2 -0.3,0.3 0,0.5 Z');
  shapes = [maple, maple, oak, plain];
  return shapes;
}
const VEIN = new Path2D('M0,0.5 L0,-0.4');

interface Leaf { x: number; y: number; size: number; fall: number; sway: number; freq: number; phase: number; spin: number; rot: number; flip: number; shape: Path2D; colour: string }

let showering = false;

/** One shower. Resolves when the last leaf has fallen off the bottom. */
export async function shower(): Promise<void> {
  if (showering || !mayShow()) return;
  showering = true;
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const cv = document.createElement('canvas');
  cv.className = 'nge-leaves';
  cv.setAttribute('aria-hidden', 'true');
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:8999;`;
  document.body.appendChild(cv);
  const c = cv.getContext('2d');
  try {
    if (!c) return;
    const all = leafShapes();
    const n = Math.max(12, Math.min(36, Math.round(W / 50)));
    const leaves: Leaf[] = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      // Spread out above the top, so they arrive over several seconds.
      y: -30 - Math.random() * H * 0.7,
      size: 18 + Math.random() * 16,
      // A little faster than at first (Ames: "They should fall a little faster").
      fall: 75 + Math.random() * 55,
      sway: 18 + Math.random() * 40,
      freq: 0.5 + Math.random() * 0.7,
      phase: Math.random() * 6.283,
      spin: (Math.random() - 0.5) * 2.4,
      rot: Math.random() * 6.283,
      flip: 1.2 + Math.random() * 2,
      shape: all[Math.floor(Math.random() * all.length)],
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    }));
    let last = performance.now(), time = 0;
    await new Promise<void>(done => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now; time += dt;
        // Calm screen or the switch turned off: gone at once.
        if (!mayShow()) { done(); return; }
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        let left = 0;
        for (const l of leaves) {
          l.y += l.fall * dt;
          l.rot += l.spin * dt;
          if (l.y > H + 30) continue;
          left++;
          if (l.y < -30) continue;
          const x = l.x + Math.sin(time * l.freq * 6.283 + l.phase) * l.sway;
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          c.translate(x, l.y);
          c.rotate(l.rot);
          // Turning over as it falls: squeezed from side to side.
          c.scale(l.size * (0.25 + 0.75 * Math.abs(Math.cos(time * l.flip + l.phase))), l.size);
          c.fillStyle = l.colour;
          c.globalAlpha = 0.9;
          c.fill(l.shape);
          c.globalAlpha = 0.35;
          c.lineWidth = 0.06;
          c.strokeStyle = '#5a2a10';
          c.stroke(VEIN);
        }
        c.globalAlpha = 1;
        if (!left) { done(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  } finally {
    cv.remove();
    showering = false;
  }
}

/** The leaf button: leaves off (grey button), or back on with a shower now. */
export function toggleLeaves() {
  const hide = !leavesHidden();
  try { useUserPreferencesStore().save({ hideLeaves: hide }); } catch { return; }
  if (!hide) void shower();
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(range: number[]) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; shower().finally(() => schedule(EVERY_MS)); }, between(range));
}

let started = false;
export function startLeaves() {
  if (started || !leavesSeason()) return;
  started = true;
  schedule(FIRST_MS);
}
