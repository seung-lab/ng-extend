/**
 * The Thanksgiving turkey (Ames 2026-11-02), the 3D turkey from Ames's game
 * (scripts/turkey3d/turkey3d.js).
 *
 * In Thanksgiving week only (src/util/season.ts: the Sunday before through
 * the Sunday after), every so often a turkey walks along the bottom of the
 * screen. Halfway or so it stops, gobbles and flaps, then walks off the other
 * side. Clicking it makes it hop. A visit takes about twenty seconds.
 *
 * It never gets in the way: it is drawn on a small see-through canvas that
 * moves with it and ignores the mouse. Only a box over the turkey's body
 * takes clicks, and only while it is on screen.
 *
 * Cost: nothing at all outside Thanksgiving week. In the week, three.js and
 * the model (static/thanksgiving/turkey3d.js, about 145 KB zipped, and
 * turkey.glb, about 360 KB) are fetched the first time the turkey comes out,
 * and it is drawn only while it walks.
 *
 * Settings, "Show the Thanksgiving turkey" (userPrefs.hideTurkey) turns it
 * off, and Calm screen keeps it away.
 *
 * Silent for now. A gobble sound can go in GOBBLE_SOUND below.
 */
import { useUserPreferencesStore } from '../store';
import { isCalm } from './calm';
import { thanksgivingWeek } from './season';

/** A file in static/ to play when it gobbles, or '' for none. */
const GOBBLE_SOUND = '';

const FIRST_MS = [60_000, 120_000], EVERY_MS = [7 * 60_000, 12 * 60_000];
const BOX = 190, SPEED = 95; // px and px per second
const STOP_MS = 2600;

export function turkeySeason(): boolean { return thanksgivingWeek(); }

export function turkeyHidden(): boolean {
  try { return useUserPreferencesStore().prefs.hideTurkey === true; } catch { return false; }
}

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const between = ([a, b]: number[]) => a + Math.random() * (b - a);

interface Turkey3d {
  resize(w: number, h: number, dpr: number): void;
  frame(walking: number, yaw: number): void;
  face(yaw: number): void;
  hop(): void;
  gobble(): void;
}
let loading: Promise<Turkey3d> | null = null;
let cv: HTMLCanvasElement | null = null, hit: HTMLDivElement | null = null;

function load(): Promise<Turkey3d> {
  if (loading) return loading;
  cv = document.createElement('canvas');
  cv.className = 'nge-turkey';
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = `position:fixed;left:0;bottom:0;width:${BOX}px;height:${BOX}px;pointer-events:none;z-index:9000;display:none;will-change:transform;`;
  hit = document.createElement('div');
  hit.title = 'Happy Thanksgiving! Click the turkey';
  hit.style.cssText = `position:fixed;left:0;bottom:6px;width:${BOX * 0.42}px;height:${BOX * 0.5}px;z-index:9001;cursor:pointer;display:none;will-change:transform;`;
  document.body.append(cv, hit);
  loading = new Promise<void>((resolve, reject) => {
    if ((window as any).PyrTurkey3d) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'thanksgiving/turkey3d.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turkey3d.js did not load'));
    document.head.appendChild(s);
  }).then(async () => {
    const t: Turkey3d = await (window as any).PyrTurkey3d.createTurkey(cv, 'thanksgiving/turkey.glb');
    t.resize(BOX, BOX, Math.min(window.devicePixelRatio || 1, 2));
    return t;
  });
  loading.catch(() => { loading = null; cv?.remove(); hit?.remove(); cv = hit = null; });
  return loading;
}

let walking = false, timer: ReturnType<typeof setTimeout> | null = null;

function schedule(range: number[]) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; visit().finally(() => schedule(EVERY_MS)); }, between(range));
}

const mayShow = () => turkeySeason() && !turkeyHidden() && !isCalm() && !reduced() && !document.hidden;

/** One walk across the bottom of the screen. Resolves when it has gone. */
export async function visit(): Promise<void> {
  if (walking || !mayShow()) return;
  walking = true;
  try {
    const t = await load();
    if (!cv || !hit || !mayShow()) return;
    const c = cv, h = hit;
    const rightward = Math.random() < 0.5, dir = rightward ? 1 : -1;
    const W = window.innerWidth, from = rightward ? -BOX : W, to = rightward ? W : -BOX;
    // Turned a little toward the screen, so it shows more than its side.
    const walkYaw = dir * (Math.PI / 2 - 0.45);
    const stopAt = from + dir * (W + BOX) * (0.3 + Math.random() * 0.35);
    let x = from, stoppedAt = -1, stopped = false, last = performance.now();
    t.face(walkYaw);
    c.style.display = h.style.display = 'block';
    const place = () => {
      c.style.transform = `translateX(${Math.round(x)}px)`;
      h.style.transform = `translateX(${Math.round(x + BOX * 0.29)}px)`;
    };
    place();
    const onClick = (e: Event) => { e.preventDefault(); e.stopPropagation(); t.hop(); };
    h.addEventListener('pointerdown', onClick);
    await new Promise<void>(done => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        // Calm screen or the switch turned off on the way: gone at once.
        if (!mayShow()) { done(); return; }
        let pace = 1, yaw = walkYaw;
        if (!stopped && (x - stopAt) * dir >= 0) {
          stopped = true; stoppedAt = now; t.gobble();
          if (GOBBLE_SOUND) { try { const a = new Audio(GOBBLE_SOUND); a.volume = 0.5; a.play().catch(() => {}); } catch { /* no sound */ } }
        }
        if (stoppedAt >= 0 && now - stoppedAt < STOP_MS) { pace = 0; yaw = dir * 0.35; }
        x += dir * SPEED * pace * dt;
        place();
        t.frame(pace, yaw);
        if ((to - x) * dir <= 0) { done(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    h.removeEventListener('pointerdown', onClick);
    c.style.display = h.style.display = 'none';
  } catch { /* no turkey this time */ } finally {
    walking = false;
  }
}

let started = false;
export function startTurkey() {
  if (started || !turkeySeason()) return;
  started = true;
  schedule(FIRST_MS);
}
