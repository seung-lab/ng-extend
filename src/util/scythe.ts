/**
 * Scythe reap (Ames 2026-10-25: "scythe swipe to make the branch crumble
 * away"; 2026-11-01: a button in cut mode, "more gently explode outward",
 * "then fade away", Ames's own sound and scythe picture, "a seamless UI",
 * "a toggle on/off not a button").
 *
 * The cut bar's Scythe reap switch (SplitMergeOverlay.vue) turns it on: the
 * cursor over the 3D view is the scythe, and each click on a cell bursts it
 * into particles that fly outward and darken away (mesh/frontend.ts
 * ngeCrumble, all in the shader), as the scythe swoops through it. It stays on
 * until switched off. There is no box to
 * dismiss. The cell ends up hidden: unticked in the segment list, still
 * in it, and Undelete (Ctrl+Z) brings it back. Nothing is merged, split or
 * changed in the data. A click that misses every cell goes to the viewer as
 * usual, so the view can be turned to line up the piece. The switch, Escape or
 * leaving cut mode turns it off. Calm screen: no
 * burst, the cell just goes.
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
import {runScytheSwing} from './holo_trace';

const CRUMBLE_MS = 2800;

const viewerNow = (): any => (window as any).viewer;
/** The scythe is on, for the cut bar's switch. */
export const scytheActive = ref(false);
let active = false;
/** Cells crumbling now, by key (`low,high`), so none is reaped twice. */
const crumbling = new Set<string>();
let swallowUntil = 0;

/** Ames's scythe for the cursor; the hot spot is the blade's tip. */
function ensureStyle() {
  if (document.getElementById('nge-scythe-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-scythe-style';
  st.textContent = `body.nge-scythe .nge-3d-panel, body.nge-scythe .nge-3d-panel * { cursor: url("${scytheCursor}") 2 32, crosshair !important; }`;
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
/** The scythe swings about its handle end, the blade's tip passing through
 *  (x, y) halfway, with a streak of light behind it. Returns how long until
 *  the blade reaches the cell (Ames 2026-11-01: "swoop on reap like it is
 *  slicing the branch away"). Reduced motion: no swoop. */
function swoop(x: number, y: number): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
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
  runScytheSwing(x, y);
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

/** Switch the scythe on. */
export function startScythe() {
  if (active || !viewerNow()) return;
  active = true;
  scytheActive.value = true;
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

/** Switch it off. A cell already bursting still goes. */
export function stopScythe() {
  if (!active) return;
  active = false;
  scytheActive.value = false;
  document.body.classList.remove('nge-scythe');
  window.removeEventListener('pointerdown', onDown, true);
  window.removeEventListener('keydown', onKey, true);
  unhookTimer = setTimeout(() => { unhookTimer = null; unhook(); }, SWALLOW_MS);
}
