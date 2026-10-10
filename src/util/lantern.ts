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

function apply() {
  state.radiusNm = lantern.sizeUm * 1000;
  state.heightNm = 0;
  state.intensity = lantern.flame / 100;
  readView();
  setNgeLantern(lantern.on ? state : null);
  try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  // For checking from the console and in tests.
  (window as any).__ngeLantern = lantern.on
    ? {centerNm: Array.from(state.center, (v, i) => v * state.scaleNm[i]), radiusNm: state.radiusNm, heightNm: state.heightNm, intensity: state.intensity}
    : null;
}

export function toggleLantern() { lantern.on = !lantern.on; }

/** Call once the viewer exists. */
export function startLantern(v: any) {
  if (viewer) return;
  viewer = v;
  // The light follows the centre of the view. The state object is shared with
  // the renderer, so a move only has to rewrite three numbers.
  const moved = () => { if (lantern.on) { readView(); (window as any).__ngeLantern && ((window as any).__ngeLantern.centerNm = Array.from(state.center, (c, i) => c * state.scaleNm[i])); } };
  try { viewer.navigationState.position.changed.add(moved); } catch { /* no position to follow */ }
  try { viewer.coordinateSpace.changed.add(() => { if (lantern.on) apply(); }); } catch { /* fixed scales */ }
  watch(lantern, () => {
    apply();
    try { localStorage.setItem(KEY, JSON.stringify({sizeUm: lantern.sizeUm, flame: lantern.flame, open: lantern.open})); } catch { /* not remembered */ }
  }, {deep: true});
  apply();
}
