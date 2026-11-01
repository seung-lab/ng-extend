/**
 * Scythe reap (Ames 2026-10-25: "scythe swipe to make the branch crumble
 * away"; 2026-11-01: "more gently explode outward", "then fade away", Ames's
 * own sound and scythe picture, "the scythe for 1 click after the cut and then
 * go back to normal cursor", "a hot key to toggle it on/off in game").
 *
 * Two ways to hold it. The cut bar's Scythe reap switch (SplitMergeOverlay.vue,
 * remembered) gives one click of it after each cut, then the normal cursor.
 * Shift+R turns it on and off anywhere, and it stays on until turned off.
 *
 * With it, the cursor over the 3D view is the scythe, and a click on a cell
 * swoops through it and bursts it into particles that fly outward and darken
 * away (mesh/frontend.ts ngeCrumble, all in the shader). The cell ends up
 * hidden: unticked in the segment list, still in it, and Undelete (Ctrl+Z)
 * brings it back. Nothing is merged, split or changed in the data. A click
 * that misses every cell goes to the viewer as usual and keeps the scythe, so
 * the view can be turned to line up the piece. Escape puts it away. Calm
 * screen: no burst, the cell just goes.
 *
 * The cell under the mouse is neuroglancer's own pick (mouseState), not a
 * guess from the screen.
 */
import {ref} from 'vue';
import {ngeCrumble, ngeCrumbleClear} from 'neuroglancer/mesh/frontend';
import {rememberRemoved} from './undelete';
import {useUserPreferencesStore} from '../store';
import scytheCursor from '../../static/tags/scythe-reap-cursor.png';
import scytheImage from '../../static/tags/scythe-reap.png';
import {setNgeProps, type NgeProp, type NgePropMesh} from 'neuroglancer/perspective_view/nge_props';
import {mat4} from 'neuroglancer/util/geom';
import {loadGlbModel} from './glb';

const CRUMBLE_MS = 2800;

const viewerNow = (): any => (window as any).viewer;
/** The cut bar's switch: one click of the scythe after each cut. */
const REAP_KEY = 'nge-reap-after-cut';
function savedReap(): boolean { try { return localStorage.getItem(REAP_KEY) === '1'; } catch { return false; } }
export const reapAfterCut = ref(savedReap());
export function setReapAfterCut(on: boolean) {
  reapAfterCut.value = on;
  try { localStorage.setItem(REAP_KEY, on ? '1' : '0'); } catch { /* private window: for this visit */ }
}
/** This hold of the scythe ends with its first reap. */
let oneClick = false;
let active = false;
/** Cells crumbling now, by key (`low,high`), so none is reaped twice. */
const crumbling = new Set<string>();
let swallowUntil = 0;

/** Ames's scythe for the cursor; the hot spot is the blade's tip. */
function ensureStyle() {
  if (document.getElementById('nge-scythe-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-scythe-style';
  st.textContent = `body.nge-scythe .nge-3d-panel, body.nge-scythe .nge-3d-panel * { cursor: url("${scytheCursor}") 0 23, crosshair !important; }
body.nge-scythe-swoop .nge-3d-panel, body.nge-scythe-swoop .nge-3d-panel * { cursor: none !important; }`;
  document.head.appendChild(st);
}

/** The cell under the mouse in a 3D view, with the set it is shown from. */
function cellUnderMouse(): {id: any, key: string, visible: any} | null {
  const ms = viewerNow()?.mouseState;
  if (!ms?.active) return null;
  const rl = ms.pickedRenderLayer;
  const id = ms.pickedValue;
  if (!rl || !id || (id.low === 0 && id.high === 0)) return null;
  const group = rl.displayState?.segmentationGroupState?.value;
  // A cut in progress draws its own set of pieces; those are not for the scythe.
  if (group?.useTemporaryVisibleSegments?.value) return null;
  const visible = group?.visibleSegments;
  if (!visible?.has?.(id)) return null;
  return {id: id.clone ? id.clone() : id, key: `${id.low},${id.high}`, visible};
}

/** The picture's blade tip and handle end, in pixels (static/tags/scythe-reap.png),
 *  and how much smaller the cursor is. */
const TIP = [2, 124], HANDLE = [178, 176];
const CURSOR_SCALE = 36 / 192;
/** The picture's size at the height of the swing, as the model's (MODEL_PX). */
const FLAT_SCALE = 120 / 192;
const SWOOP_MS = 840;
/** The swing's parts, as shares of it: growing and winding up, the cut at HIT,
 *  the follow through, then back down to the cursor from RETURN. */
const WINDUP = 0.25, HIT = 0.5, RETURN = 0.75;
/** How far the whole scythe travels sideways each side of the click, in pixels:
 *  the width of the swoop (Ames 2026-11-01: "more x axis width"). */
const SWEEP_PX = 85, FOLLOW_SWEEP_PX = 170;
const WIND_DEG = 42, FOLLOW_DEG = -70;
let swoopTimer: ReturnType<typeof setTimeout> | null = null;
/** Ames's 3D scythe (static/halloween/scythe.glb), once it has loaded; until
 *  then, or if it cannot load, the picture swings instead. */
let swoopModel: NgePropMesh | null = null;
let swoopModelAsked = false;
function loadSwoopModel() {
  if (swoopModelAsked) return;
  swoopModelAsked = true;
  loadGlbModel('halloween/scythe.glb').then(m => { swoopModel = m; }, e => console.warn('[scythe] the 3D scythe could not be loaded:', e?.message));
}
/** Where the blade's tip and the handle's end are in the model, as glb.ts
 *  leaves it, and its size on screen at full size, in pixels. */
const MODEL_TIP = [-0.437, 0.204, 0], MODEL_HANDLE = [0.297, -0.5, 0], MODEL_PX = 120;
/** It leans: the tip starts behind the cell and comes on toward the eye. */
const WIND_LEAN = -65, FOLLOW_LEAN = 60;
/** Through the swing the blade lies tilted into the screen (Ames 2026-11-01:
 *  "tilt sideways as though into the screen"). */
const TILT_DEG = -50;
/** The model's size at the cursor, against MODEL_PX. */
const MODEL_CURSOR_SCALE = 0.33;
const smooth = (k: number) => k * k * (3 - 2 * k);
/** The swing at time t: one eased motion from the top of the wind up, through
 *  the click halfway, to the end of the follow through, with no join in it
 *  (Ames 2026-11-01: "needs easing on the swoop"). */
function swingAt(t: number) {
  let at: number, grown = 1, returned = 0;
  if (t < WINDUP) {
    grown = smooth(t / WINDUP);
    at = grown;
  } else if (t < RETURN) {
    const k = (t - WINDUP) / (RETURN - WINDUP);
    const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(2 - 2 * k, 3) / 2;
    at = 1 - 2 * eased;
  } else {
    // Back to the cursor, nothing left over: it ends the size and shape it began.
    returned = smooth((t - RETURN) / (1 - RETURN));
    grown = 1 - returned;
    at = -grown;
  }
  // From top (at 1) through the cut (0) to the end of the follow through (-1),
  // with no kink at the cut, whatever the two ends' sizes.
  const span = (top: number, end: number) => (top - end) / 2 * at + (top + end) / 2 * at * at;
  return {deg: span(WIND_DEG, FOLLOW_DEG), lean: span(WIND_LEAN, FOLLOW_LEAN), grown, returned, tilt: TILT_DEG * grown, sweep: span(SWEEP_PX, -FOLLOW_SWEEP_PX)};
}
/** Tilt into the screen, lean about the up axis, then turn in the plane of the
 *  screen. Screen y is up here, so a clockwise turn (the picture's deg) is
 *  negative. */
function swingTurn(deg: number, lean: number, tilt: number) {
  const a = -deg * Math.PI / 180, b = lean * Math.PI / 180, c = tilt * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return (v: number[]) => {
    const vy = v[1] * cc - v[2] * sc, vz0 = v[1] * sc + v[2] * cc;
    const vx = v[0] * cb + vz0 * sb, vz = -v[0] * sb + vz0 * cb;
    return [vx * ca - vy * sa, vx * sa + vy * ca, vz];
  };
}
const SWING_ARM = [0, 1, 2].map(i => (MODEL_TIP[i] - MODEL_HANDLE[i]) * MODEL_PX);
/** How far the blade's tip is from the click at time t, in pixels, y up. */
function tipOffset(t: number): number[] {
  const {deg, lean, grown, sweep, tilt} = swingAt(t);
  const turned = swingTurn(deg, lean, tilt)(SWING_ARM);
  // Measured from the pose at the cut, so the tip is on the click just then.
  const atCut = swingTurn(0, 0, tilt)(SWING_ARM);
  const off = [0, 1, 2].map(i => (turned[i] - atCut[i]) * grown);
  off[0] += sweep;
  return off;
}

/** A small trail of sparks left along the blade's path, from the start of the
 *  cut on: they hang where they were left, drift apart and go out. */
const TRAIL_COLORS = ['#19d3ff', '#00b7ff', '#58e6ff', '#0a9bff', '#b8f6ff'];
function trail(x: number, y: number, ms: number) {
  const cv = document.createElement('canvas');
  const R = 340, D = R * 2;
  cv.width = cv.height = D;
  cv.style.cssText = `position:fixed;left:${x - R}px;top:${y - R}px;width:${D}px;height:${D}px;pointer-events:none;z-index:20001;`;
  const g = cv.getContext('2d');
  if (!g) return;
  document.body.appendChild(cv);
  const LIFE = 700;
  const sparks: Array<{x: number, y: number, vx: number, vy: number, born: number, life: number, r: number, c: string}> = [];
  const COUNT = 240, FROM = WINDUP + 0.1, TO = RETURN - 0.04;
  for (let i = 0; i < COUNT; i++) {
    const t = FROM + (TO - FROM) * (i / (COUNT - 1));
    const tip = tipOffset(t);
    const {deg, lean, tilt} = swingAt(t);
    const arm = swingTurn(deg, lean, tilt)(SWING_ARM);
    const along = Math.random() * Math.random() * 0.45;
    sparks.push({
      x: R + tip[0] - arm[0] * along + (Math.random() - 0.5) * 8, y: R - tip[1] + arm[1] * along + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 44, vy: (Math.random() - 0.5) * 44 + 12,
      born: t * ms, life: LIFE * (0.5 + 0.7 * Math.random()), r: 0.9 + Math.random() * 1.9,
      c: TRAIL_COLORS[i % TRAIL_COLORS.length],
    });
  }
  const start = performance.now();
  const end = ms + LIFE * 1.2;
  const step = () => {
    const now = performance.now() - start;
    g.clearRect(0, 0, D, D);
    g.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      const age = now - p.born;
      if (age < 0 || age > p.life) continue;
      const k = age / p.life, secs = age / 1000;
      g.globalAlpha = 1 - k;
      g.fillStyle = p.c;
      g.beginPath();
      g.arc(p.x + p.vx * secs, p.y + p.vy * secs, p.r * (1 - 0.4 * k), 0, Math.PI * 2);
      g.fill();
    }
    if (now < end) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
}

/** The model in the scene, so branches in front of the blade hide it: it is
 *  laid out in pixels on the view through the point under the mouse, turned,
 *  and that layout is carried over to the viewer's coordinates. False: no
 *  view or point to swing in, so the picture does it. */
function swoop3D(x: number, y: number, ms: number): boolean {
  const viewer = viewerNow();
  const mouse = viewer?.mouseState;
  let panel: any = null;
  for (const pn of viewer?.display?.panels ?? []) {
    if (!pn?.element?.classList?.contains('nge-3d-panel')) continue;
    const r = pn.element.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) panel = pn;
  }
  const pp = panel?.projectionParameters?.value;
  if (!pp || !mouse?.position) return false;
  const info = pp.displayDimensionRenderInfo;
  const at = [0, 1, 2].map(i => mouse.position[info.displayDimensionIndices[i]] ?? 0);
  const nm = [0, 1, 2].map(i => (info.displayDimensionScales[i] || 1e-9) * 1e9);
  const rect = panel.element.getBoundingClientRect();
  const place = () => {
    const now = panel.projectionParameters.value;
    const vp = now.viewProjectionMat, inv = now.invViewProjectionMat;
    const w = vp[3] * at[0] + vp[7] * at[1] + vp[11] * at[2] + vp[15];
    if (w <= 0) return null;
    const ndc = [0, 1, 2].map(i => (vp[i] * at[0] + vp[i + 4] * at[1] + vp[i + 8] * at[2] + vp[i + 12]) / w);
    const back = (a: number, b: number, c: number) => {
      const g = inv[3] * a + inv[7] * b + inv[11] * c + inv[15];
      return [0, 1, 2].map(i => (inv[i] * a + inv[i + 4] * b + inv[i + 8] * c + inv[i + 12]) / g);
    };
    const base = back(ndc[0], ndc[1], ndc[2]);
    // One pixel right and up on screen, in nm; the same length toward the eye.
    const right = back(ndc[0] + 2 / rect.width, ndc[1], ndc[2]).map((v, i) => (v - base[i]) * nm[i]);
    const up = back(ndc[0], ndc[1] + 2 / rect.height, ndc[2]).map((v, i) => (v - base[i]) * nm[i]);
    const eye = back(ndc[0], ndc[1], ndc[2] - 0.001).map((v, i) => (v - base[i]) * nm[i]);
    const px = Math.hypot(right[0], right[1], right[2]);
    const eyeLen = Math.hypot(eye[0], eye[1], eye[2]) || 1;
    const toEye = eye.map(v => v / eyeLen * px);
    return {right: right.map((v, i) => v / nm[i]), up: up.map((v, i) => v / nm[i]), toEye: toEye.map((v, i) => v / nm[i])};
  };
  const prop: NgeProp = {mesh: swoopModel!, modelMat: mat4.create(), alpha: 1, dissolve: 0, seed: 0.5, glow: [0.08, 0.08, 0.1], rim: [1, 0.85, 0.5], shade: 1};
  const set = (t: number) => {
    const axes = place();
    if (!axes) { prop.alpha = 0; return; }
    const {deg, lean, grown, returned, tilt} = swingAt(t);
    // With the scythe put away (the one click after a cut) no scythe cursor
    // waits for it, so it goes out as it lands.
    prop.alpha = !active && t > 0.9 ? (1 - t) / 0.1 : 1;
    const turn = swingTurn(deg, lean, tilt);
    const scale = MODEL_PX * (MODEL_CURSOR_SCALE + (1 - MODEL_CURSOR_SCALE) * grown);
    const tipAt = tipOffset(t);
    // Home to where the mouse is now, not where it clicked.
    tipAt[0] += moved[0] * returned;
    tipAt[1] -= moved[1] * returned;
    const tipModel = turn(MODEL_TIP);
    const toGlobal = (q: number[], k: number) => axes.right[k] * q[0] + axes.up[k] * q[1] + axes.toEye[k] * q[2];
    const m = prop.modelMat;
    for (let col = 0; col < 3; col++) {
      const q = turn([col === 0 ? 1 : 0, col === 1 ? 1 : 0, col === 2 ? 1 : 0]).map(v => v * scale);
      for (let k = 0; k < 3; k++) m[col * 4 + k] = toGlobal(q, k);
    }
    const origin = [0, 1, 2].map(i => tipAt[i] - tipModel[i] * scale);
    for (let k = 0; k < 3; k++) m[12 + k] = at[k] + toGlobal(origin, k);
  };
  const moved = [0, 0];
  const onMove = (e: PointerEvent) => { moved[0] = e.clientX - x; moved[1] = e.clientY - y; };
  window.addEventListener('pointermove', onMove, true);
  set(0);
  setNgeProps([prop], 'scythe');
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / ms);
    set(t);
    try { viewer.display.scheduleRedraw(); } catch { /* nothing to redraw */ }
    if (t < 1) { requestAnimationFrame(step); return; }
    setNgeProps([], 'scythe');
    window.removeEventListener('pointermove', onMove, true);
  };
  requestAnimationFrame(step);
  return true;
}
/** The cursor grows into the full scythe, winding up, then swings about its
 *  handle end with the blade's tip passing through (x, y), and fades as it
 *  follows through (Ames 2026-11-01: "swoop on reap like it is slicing the
 *  branch away", "the cursor zoom larger and transition INTO the scythe").
 *  It starts exactly over the cursor, which is hidden meanwhile. Returns how
 *  long until the blade reaches the cell. Reduced motion: no swoop. */
function swoop(x: number, y: number): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  ensureStyle();
  // window.__ngeSwoopMs slows it down, for a look at it frame by frame.
  const ms = Number((window as any).__ngeSwoopMs) || SWOOP_MS;
  document.body.classList.add('nge-scythe-swoop');
  if (swoopTimer) clearTimeout(swoopTimer);
  swoopTimer = setTimeout(() => document.body.classList.remove('nge-scythe-swoop'), ms);
  trail(x, y, ms);
  if (swoopModel && swoop3D(x, y, ms)) return ms * HIT;
  const el = document.createElement('img');
  el.src = scytheImage;
  el.alt = '';
  el.style.cssText = `position:fixed;left:${x - TIP[0]}px;top:${y - TIP[1]}px;width:192px;height:192px;`
    + `pointer-events:none;z-index:20000;transform-origin:${TIP[0]}px ${TIP[1]}px;`;
  document.body.appendChild(el);
  // Where the blade's tip is, off the click, with the scythe turned deg about
  // its handle end (which rests where it would be at full size, unturned).
  const armX = TIP[0] - HANDLE[0], armY = TIP[1] - HANDLE[1];
  const pose = (deg: number, scale: number, grown: number, sweep: number, opacity: number, offset: number): Keyframe => {
    const r = deg * Math.PI / 180;
    const dx = (armX * Math.cos(r) - armY * Math.sin(r) - armX) * grown * FLAT_SCALE + sweep;
    const dy = (armX * Math.sin(r) + armY * Math.cos(r) - armY) * grown * FLAT_SCALE;
    return {offset, opacity, transform: `translate(${dx}px, ${dy}px) rotate(${deg}deg) scale(${scale})`};
  };
  const frames: Keyframe[] = [];
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const {deg, grown, sweep} = swingAt(t);
    frames.push(pose(deg, CURSOR_SCALE + (FLAT_SCALE - CURSOR_SCALE) * grown, grown, sweep, 1, t));
  }
  const anim = el.animate(frames, {duration: ms, fill: 'forwards'});
  anim.onfinish = anim.oncancel = () => el.remove();
  setTimeout(() => el.remove(), ms + 200);
  return ms * HIT;
}

function reap(cell: {id: any, key: string, visible: any}, x: number, y: number) {
  if (crumbling.has(cell.key)) return;
  crumbling.add(cell.key);
  const hide = () => {
    try {
      if (cell.visible.has(cell.id)) {
        cell.visible.delete(cell.id);
        rememberRemoved([cell.id.toString()]);
      }
    } catch { /* the layer has gone */ }
    // After it is hidden, so it never flashes back whole.
    setTimeout(() => { ngeCrumbleClear(cell.key); crumbling.delete(cell.key); }, 300);
  };
  if (document.body.classList.contains('nge-calm')) { hide(); return; }
  // window.__ngeCrumbleMs slows it down, for a look at it frame by frame.
  const ms = Number((window as any).__ngeCrumbleMs) || CRUMBLE_MS;
  const hit = swoop(x, y);
  // The sound starts with the cut, not the wind up.
  setTimeout(playVanish, hit * WINDUP / HIT);
  setTimeout(() => {
    ngeCrumble(cell.key, ms);
    try { viewerNow()?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
    setTimeout(hide, ms);
  }, hit);
}

/** Ames's Scythe Vanish, fetched when the scythe is picked up. Each burst gets
 *  its own copy, so a sweep across several cells can overlap. */
let vanish: HTMLAudioElement | null = null;
function playVanish() {
  // Silent with the volume off (Ames 2026-11-01): the bottom right control's
  // saved choice (RadioPlayer.vue). A player who never chose has it on.
  try {
    const radio = useUserPreferencesStore().prefs.radio;
    if (radio && (radio.on === false || radio.volume === 0)) return;
  } catch { /* no preferences yet: as a player who never chose */ }
  try { void (vanish?.cloneNode() as HTMLAudioElement | undefined)?.play().catch(() => { /* no sound */ }); } catch { /* no sound */ }
}

function swallow(e: Event) {
  if (performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); }
}
function onDown(e: PointerEvent) {
  if (!active || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest?.('.nge-3d-panel')) return;
  const cell = cellUnderMouse();
  if (!cell) return;  // a miss: the viewer gets the click
  e.preventDefault();
  e.stopPropagation();
  swallowUntil = performance.now() + 600;
  reap(cell, e.clientX, e.clientY);
  if (oneClick) stopScythe();
}
function onKey(e: KeyboardEvent) {
  if (active && e.key === 'Escape') { e.stopPropagation(); stopScythe(); }
}

/** After a hit, the rest of that click (mouseup, click) is still the scythe's,
 *  so the viewer does not also select or move. */
const SWALLOW_MS = 700;
let unhookTimer: ReturnType<typeof setTimeout> | null = null;
function unhook() {
  window.removeEventListener('mousedown', swallow, true);
  window.removeEventListener('mouseup', swallow, true);
  window.removeEventListener('click', swallow, true);
}

/** Take up the scythe, for one reap or until put away. */
export function startScythe(once = false) {
  if (active || !viewerNow()) return;
  active = true;
  oneClick = once;
  if (unhookTimer) { clearTimeout(unhookTimer); unhookTimer = null; }
  if (!vanish) {
    vanish = new Audio('sfx/scythe-vanish.mp3');
    vanish.preload = 'auto';
    new Image().src = scytheImage;
    loadSwoopModel();
  }
  ensureStyle();
  document.body.classList.add('nge-scythe');
  // pointerdown and mousedown both: neuroglancer listens for mousedown
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('mouseup', swallow, true);
  window.addEventListener('click', swallow, true);
  window.addEventListener('keydown', onKey, true);
}

/** Put it away. A cell already bursting still goes. */
export function stopScythe() {
  if (!active) return;
  active = false;
  document.body.classList.remove('nge-scythe');
  window.removeEventListener('pointerdown', onDown, true);
  window.removeEventListener('keydown', onKey, true);
  unhookTimer = setTimeout(() => { unhookTimer = null; unhook(); }, SWALLOW_MS);
}

/** Shift+R (util/key_list.ts), and the one click after a cut. Call once. */
export function startScytheControls() {
  window.addEventListener('keydown', e => {
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyR' || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    e.stopPropagation();
    if (active) stopScythe(); else startScythe();
  }, true);
  // graphene frontend.ts: how a submitted cut went.
  window.addEventListener('nge-cut-submitted', (e: Event) => {
    if ((e as CustomEvent).detail?.success && reapAfterCut.value) startScythe(true);
  });
}
