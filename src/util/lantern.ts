/**
 * Lantern mode (Krzysztof Kruk's idea, 2026-10-09; first version 2026-10-10).
 *
 * The cell is lit around the centre of your view and greyed to a shadow
 * everywhere else, and the light moves with you. It is for checking a big
 * cell a part at a time. The drawing is in the mesh shader
 * (third_party/neuroglancer/mesh/nge_lantern.ts); this file keeps the
 * settings, follows the view, and remembers the settings in this browser.
 *
 * Two settings:
 *   size    how far the light reaches, in micrometres
 *   flame   how bright the lit part is (Ames: "a flame intensity slider")
 * A third, Height (lifting the light toward the eye), was tried and taken out
 * the same day: on screen it read as a smaller Size and needed explaining
 * (Ames 2026-10-10: "I don't understand height", "remove height"). The
 * renderer can still do it (heightNm), it is simply always 0.
 */
import {reactive, watch} from 'vue';
import {setNgeLantern, type NgeLantern} from 'neuroglancer/mesh/nge_lantern';

const KEY = 'nge-lantern-v1';
export const LANTERN_LIMITS = {
  sizeUm: {min: 2, max: 80, step: 1, start: 12},
  flame: {min: 50, max: 180, step: 5, start: 115},     // per cent
};
/** How bright the part in shadow is. Dim enough to recede, not so dim that
 *  the shape of the cell is lost. */
const SHADOW = 0.26;

interface Saved { on: boolean; sizeUm: number; flame: number; open: boolean; }
const clamp = (v: unknown, r: {min: number; max: number; start: number}) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(r.min, Math.min(r.max, n)) : r.start;
};
function load(): Saved {
  let s: any = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* the defaults */ }
  return {
    on: false,                                   // never on by surprise after a reload
    sizeUm: clamp(s.sizeUm, LANTERN_LIMITS.sizeUm),
    flame: clamp(s.flame, LANTERN_LIMITS.flame),
    open: s.open !== false,
  };
}

/** The settings, live. The toolbar icon and the small Lantern bar read and write these. */
export const lantern = reactive<Saved>(load());

let viewer: any = null;
const state: NgeLantern = {
  center: new Float32Array(3), scaleNm: new Float32Array([1, 1, 1]),
  radiusNm: 0, heightNm: 0, intensity: 1, shadow: SHADOW,
};

function readView() {
  if (!viewer) return;
  try {
    const pos = viewer.navigationState.position.value;
    const scales = viewer.coordinateSpace.value.scales;
    for (let i = 0; i < 3; i++) {
      state.center[i] = Number(pos[i]) || 0;
      state.scaleNm[i] = (Number(scales[i]) || 1e-9) / 1e-9;
    }
  } catch { /* the view is not up yet */ }
}

// ── Lighting it, and putting it out (Ames 2026-10-10: "a cool load in/out") ──
// `lit` runs from 0 (off) to 1 (burning). Lighting: the dark closes in while
// the light swells out from the centre, a little past its size and back, with
// a flare that settles. Putting it out: the light shrinks to a point and the
// daylight comes back. Under "reduce motion" it simply switches.
const LIGHT_MS = 720, DOUSE_MS = 480;
let lit = 0;
let tween: number | null = null;
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const smooth = (t: number) => t * t * (3 - 2 * t);

function apply() {
  const on = lantern.on;
  // how far through lighting (or dousing) it is
  const swell = on ? easeOutBack(lit) : lit * lit;
  const flare = on ? 1 + 0.9 * Math.pow(1 - lit, 2) * (lit > 0 ? 1 : 0) : 1;
  state.radiusNm = lantern.sizeUm * 1000 * Math.max(0, swell);
  state.heightNm = 0;
  state.intensity = (lantern.flame / 100) * flare;
  // the dark closes in a little ahead of the light
  state.shadow = 1 - (1 - SHADOW) * smooth(Math.min(1, lit * 1.25));
  readView();
  setNgeLantern(lit > 0 ? state : null);
  try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  // For checking from the console and in tests.
  (window as any).__ngeLantern = lit > 0
    ? {centerNm: Array.from(state.center, (v, i) => v * state.scaleNm[i]), radiusNm: state.radiusNm, heightNm: state.heightNm, intensity: state.intensity, shadow: state.shadow, lit}
    : null;
}

/** Run `lit` to 1 (on) or 0 (off). */
function run() {
  if (tween !== null) { cancelAnimationFrame(tween); tween = null; }
  const target = lantern.on ? 1 : 0;
  if (reducedMotion() || document.hidden) { lit = target; apply(); return; }
  const from = lit, t0 = performance.now(), ms = (lantern.on ? LIGHT_MS : DOUSE_MS) * Math.abs(target - from);
  if (ms <= 0) { apply(); return; }
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    lit = from + (target - from) * t;
    apply();
    tween = t < 1 ? requestAnimationFrame(step) : null;
  };
  tween = requestAnimationFrame(step);
}

export function toggleLantern() { lantern.on = !lantern.on; }

/** Call once the viewer exists. */
export function startLantern(v: any) {
  if (viewer) return;
  viewer = v;
  // The light follows the centre of the view. The state object is shared with
  // the renderer, so a move only has to rewrite three numbers.
  const moved = () => { if (lit > 0) { readView(); (window as any).__ngeLantern && ((window as any).__ngeLantern.centerNm = Array.from(state.center, (c, i) => c * state.scaleNm[i])); } };
  try { viewer.navigationState.position.changed.add(moved); } catch { /* no position to follow */ }
  try { viewer.coordinateSpace.changed.add(() => { if (lit > 0) apply(); }); } catch { /* fixed scales */ }
  watch(() => lantern.on, run);
  watch(lantern, () => {
    if (tween === null) apply();
    try { localStorage.setItem(KEY, JSON.stringify({sizeUm: lantern.sizeUm, flame: lantern.flame, open: lantern.open})); } catch { /* not remembered */ }
  }, {deep: true});
  lit = lantern.on ? 1 : 0;
  apply();
}
