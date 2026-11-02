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
 * Where the chat box is, he hops up onto it and walks along its top.
 *
 * The turkey button by the chat box, Settings ("Show the Thanksgiving
 * turkey") and the palette are one switch (userPrefs.hideTurkey). Calm
 * screen keeps it away too.
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
  cv.style.cssText = `position:fixed;left:0;bottom:-10px;width:${BOX}px;height:${BOX}px;pointer-events:none;z-index:9000;display:none;will-change:transform;`;
  hit = document.createElement('div');
  hit.title = 'Happy Thanksgiving! Click the turkey';
  hit.style.cssText = `position:fixed;left:0;bottom:0;width:${BOX * 0.42}px;height:${BOX * 0.5}px;z-index:9001;cursor:pointer;display:none;will-change:transform;`;
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

/** Calm screen and reduced motion always keep it away. */
const mayMove = () => turkeySeason() && !isCalm() && !reduced() && !document.hidden;
const mayShow = () => mayMove() && !turkeyHidden();

/**
 * The chat box's turkey button, and Turn the Turkey on/off in the palette
 * (Ames 2026-11-02: "clicking the turkey button should make him go away",
 * "and click should grey it out"). An on and off switch, the same one as in
 * Settings: off, the turkey hurries off the screen and the button goes grey;
 * on, he comes straight out for a walk.
 */
export function toggleTurkey() {
  const hide = !turkeyHidden();
  try { useUserPreferencesStore().save({ hideTurkey: hide }); } catch { return; }
  if (!hide) void visit();
}

/** The chat box the turkey hops up onto: the whole chat panel while it is
 *  open, or just its input bar while it sits quiet (its messages faded). */
function chatBox(): DOMRect | null {
  const low = (el: Element | null) => {
    const r = el?.getBoundingClientRect();
    // Only a box sitting low on the screen, so he never leaps to the top.
    return r && r.width && r.top > window.innerHeight * 0.55 ? r : null;
  };
  const panel = document.querySelector('.nge-chat-float');
  const open = panel && !panel.classList.contains('nge-chat-float--quiet') && !panel.classList.contains('nge-chat-float--collapsed') ? low(panel) : null;
  return open ?? low(document.querySelector('.nge-chat-input-wrap'));
}

/** How high (px above the bottom of the screen) the ground is under x. */
function groundAt(x: number, box: DOMRect | null): number {
  if (!box || x < box.left + 8 || x > box.right - 8) return 0;
  return window.innerHeight - box.top - 8;
}

// Sent away, he gobbles goodbye, then trots off at twice his walk (Ames:
// four times was too fast, and he forgot to gobble).
const HOP_MS = 520, HURRY = 2, BYE_MS = 1300;

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
    let x = from, y = 0, stoppedAt = -1, stopped = false, leaving = -1, last = performance.now();
    let jump: { from: number; to: number; t0: number } | null = null;
    t.face(walkYaw);
    c.style.display = h.style.display = 'block';
    const place = () => {
      c.style.transform = `translate(${Math.round(x)}px,${-Math.round(y)}px)`;
      h.style.transform = `translate(${Math.round(x + BOX * 0.29)}px,${-Math.round(y)}px)`;
    };
    place();
    const onClick = (e: Event) => { e.preventDefault(); e.stopPropagation(); t.hop(); };
    h.addEventListener('pointerdown', onClick);
    await new Promise<void>(done => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        // Calm screen on the way: gone at once.
        if (!mayMove()) { done(); return; }
        // Switched off on the way (the button or Settings): off he hurries.
        if (turkeyHidden() && leaving < 0) { leaving = now; t.gobble(); }
        let pace = 1, yaw = walkYaw;
        if (!stopped && leaving < 0 && (x - stopAt) * dir >= 0) {
          stopped = true; stoppedAt = now; t.gobble();
          if (GOBBLE_SOUND) { try { const a = new Audio(GOBBLE_SOUND); a.volume = 0.5; a.play().catch(() => {}); } catch { /* no sound */ } }
        }
        if (leaving < 0 && stoppedAt >= 0 && now - stoppedAt < STOP_MS) { pace = 0; yaw = dir * 0.35; }
        if (leaving >= 0) {
          if (now - leaving < BYE_MS) { pace = 0; yaw = dir * 0.35; } else pace = HURRY;
        }
        const speed = pace;
        x += dir * SPEED * speed * dt;
        // Up onto the chat box and down again: a hop that starts just
        // before the edge, so he lands on it rather than walking through.
        const feet = x + BOX / 2, ground = groundAt(feet + dir * 34, chatBox());
        if (jump) {
          const q = Math.min(1, (now - jump.t0) / HOP_MS);
          y = jump.from + (jump.to - jump.from) * q + Math.sin(q * Math.PI) * (26 + Math.max(0, jump.to - jump.from) * 0.35);
          if (q >= 1) { y = jump.to; jump = null; }
        } else if (Math.abs(ground - y) > 2) {
          if (pace > 0) { jump = { from: y, to: ground, t0: now }; t.hop(); }
        }
        place();
        t.frame(Math.min(1, speed), yaw);
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
