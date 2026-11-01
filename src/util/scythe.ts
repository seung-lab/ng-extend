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
  st.textContent = `body.nge-scythe .nge-3d-panel, body.nge-scythe .nge-3d-panel * { cursor: url("${scytheCursor}") 2 32, crosshair !important; }
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

/** The picture's blade tip and handle end, in pixels (static/tags/scythe-reap.png). */
const TIP = [8, 128], HANDLE = [188, 184];
const SWOOP_MS = 420;
let swoopTimer: ReturnType<typeof setTimeout> | null = null;
/** The scythe swings about its handle end, the blade's tip passing through
 *  (x, y) halfway, standing in for the cursor. Returns how long until
 *  the blade reaches the cell (Ames 2026-11-01: "swoop on reap like it is
 *  slicing the branch away"). Reduced motion: no swoop. */
function swoop(x: number, y: number): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  ensureStyle();
  document.body.classList.add('nge-scythe-swoop');
  if (swoopTimer) clearTimeout(swoopTimer);
  swoopTimer = setTimeout(() => document.body.classList.remove('nge-scythe-swoop'), SWOOP_MS);
  const el = document.createElement('img');
  el.src = scytheImage;
  el.alt = '';
  el.style.cssText = `position:fixed;left:${x + (HANDLE[0] - TIP[0]) - HANDLE[0]}px;top:${y + (HANDLE[1] - TIP[1]) - HANDLE[1]}px;`
    + `width:192px;height:192px;pointer-events:none;z-index:20000;transform-origin:${HANDLE[0]}px ${HANDLE[1]}px;`;
  document.body.appendChild(el);
  // Tip high to tip low: a downward cut.
  const anim = el.animate([
    {transform: 'rotate(42deg)', opacity: 0, offset: 0},
    {transform: 'rotate(30deg)', opacity: 1, offset: 0.2, easing: 'cubic-bezier(.5, 0, .9, .6)'},
    {transform: 'rotate(0deg)', opacity: 1, offset: 0.5, easing: 'cubic-bezier(.2, .6, .4, 1)'},
    {transform: 'rotate(-32deg)', opacity: 0, offset: 1},
  ], {duration: SWOOP_MS, fill: 'forwards'});
  anim.onfinish = anim.oncancel = () => el.remove();
  setTimeout(() => el.remove(), SWOOP_MS + 200);
  return SWOOP_MS / 2;
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
  playVanish();
  const hit = swoop(x, y);
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
