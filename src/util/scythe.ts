/**
 * The scythe (Ames 2026-10-25: "after you cut a piece you can hammer
 * (instead let's use Scythe, since that's sort of a long running inside joke
 * with grim reaper) so scythe swipe to make the branch crumble away").
 *
 * After a cut, a small bar at the top offers the scythe. With it, the cursor
 * over the 3D view is a scythe, and a click on a cell (or a drag that starts
 * on one and sweeps across others) makes each cell crumble away: it breaks
 * into chunks that fall and turn to dust (mesh/frontend.ts ngeCrumble, all
 * in the shader). Then the cell is hidden: unticked in the segment list,
 * still in it, and Undelete (Ctrl+Z) brings it back. Nothing is merged,
 * split or changed in the data. A click that misses every cell goes to the
 * viewer as usual, so the view can still be turned. Done or Escape puts the
 * scythe away. Calm screen: no crumble, the cell just goes.
 *
 * The pattern is the pumpkin hammer's (pumpkin.ts startSmashing). The cell
 * under the mouse is neuroglancer's own pick (mouseState), not a guess from
 * the screen.
 */
import {ngeCrumble, ngeCrumbleClear} from 'neuroglancer/mesh/frontend';
import {rememberRemoved} from './undelete';

const CRUMBLE_MS = 1400;
/** How long the offer stays after a cut. */
const OFFER_MS = 20_000;

let viewer: any = null;
let active = false;
let bar: HTMLDivElement | null = null;
let offer: HTMLDivElement | null = null;
let offerTimer: ReturnType<typeof setTimeout> | null = null;
/** Cells crumbling now, by key (`low,high`), so a sweep takes each once. */
const crumbling = new Set<string>();
/** The mouse is held after a hit: cells swept over crumble too. */
let sweeping = false;
let swallowUntil = 0;

/** A scythe for the cursor: a curved blade on a long handle. The hot spot is
 *  the blade's tip. */
const SCYTHE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">'
  + '<path d="M33 38 L15 5" stroke="#2a1608" stroke-width="5" stroke-linecap="round"/>'
  + '<path d="M33 38 L15 5" stroke="#9a6a3a" stroke-width="3" stroke-linecap="round"/>'
  + '<path d="M15 4 C 9 2, 4 6, 2 16 C 6 11, 10 9.5, 17 9 Z" fill="#e8eef4" stroke="#20262c" stroke-width="1.4" stroke-linejoin="round"/>'
  + '</svg>';
const SCYTHE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(SCYTHE_SVG)}") 2 16, crosshair`;

function ensureStyle() {
  if (document.getElementById('nge-scythe-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-scythe-style';
  st.textContent = `
body.nge-scythe .nge-3d-panel, body.nge-scythe .nge-3d-panel * { cursor: ${SCYTHE_CURSOR} !important; }
.nge-scythe-bar {
  position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 20000;
  display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; border-radius: 999px;
  font: 600 14px/1.2 Inter, system-ui, sans-serif; color: #e4e9f0;
  background: rgba(12, 14, 20, 0.92); border: 1px solid rgba(190, 205, 225, 0.45);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 18px rgba(170, 190, 220, 0.18);
}
.nge-scythe-bar svg { width: 22px; height: 22px; flex: none; }
.nge-scythe-bar button {
  font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 999px; cursor: pointer;
  color: #0c0e14; background: linear-gradient(180deg, #f1f4f8, #b9c3cf); border: 0;
}
.nge-scythe-bar button.nge-scythe-quiet { color: #c9d2dd; background: transparent; border: 1px solid rgba(190, 205, 225, 0.35); }`;
  document.head.appendChild(st);
}

function makeBar(text: string, buttons: Array<{label: string, quiet?: boolean, act: () => void}>): HTMLDivElement {
  ensureStyle();
  const el = document.createElement('div');
  el.className = 'nge-scythe-bar';
  el.setAttribute('role', 'status');
  el.innerHTML = SCYTHE_SVG;
  const label = document.createElement('span');
  label.textContent = text;
  el.appendChild(label);
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    if (b.quiet) btn.className = 'nge-scythe-quiet';
    btn.addEventListener('click', b.act);
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  return el;
}

/** A soft swish, made on the spot: noise swept through a band filter. */
function swish() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ac: AudioContext = new AC();
    const len = Math.floor(ac.sampleRate * 0.4);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin(Math.PI * k / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(700, ac.currentTime);
    f.frequency.exponentialRampToValueAtTime(3800, ac.currentTime + 0.35);
    const g = ac.createGain();
    g.gain.value = 0.3;
    src.connect(f).connect(g).connect(ac.destination);
    src.start();
    src.onended = () => { ac.close(); };
  } catch { /* no sound */ }
}

/** The cell under the mouse in a 3D view, with the set it is shown from. */
function cellUnderMouse(): {id: any, key: string, visible: any} | null {
  const ms = viewer?.mouseState;
  if (!ms?.active) return null;
  const rl = ms.pickedRenderLayer;
  const id = ms.pickedValue;
  if (!rl || !id || (id.low === 0 && id.high === 0)) return null;
  const visible = rl.displayState?.segmentationGroupState?.value?.visibleSegments;
  if (!visible?.has?.(id)) return null;
  return {id: id.clone ? id.clone() : id, key: `${id.low},${id.high}`, visible};
}

function reap(cell: {id: any, key: string, visible: any}) {
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
  swish();
  // window.__ngeCrumbleMs slows it down, for a look at it frame by frame.
  const ms = Number((window as any).__ngeCrumbleMs) || CRUMBLE_MS;
  ngeCrumble(cell.key, ms);
  try { viewer?.display?.scheduleRedraw(); } catch { /* nothing to redraw */ }
  setTimeout(hide, ms);
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
  sweeping = true;
  reap(cell);
}
function onMove() {
  if (!active || !sweeping) return;
  swallowUntil = performance.now() + 600;
  const cell = cellUnderMouse();
  if (cell) reap(cell);
}
function onUp() { sweeping = false; }
function onKey(e: KeyboardEvent) {
  if (active && e.key === 'Escape') { e.stopPropagation(); stopScythe(); }
}

/** Hand the player the scythe. */
export function startScythe() {
  hideOffer();
  if (active || !viewer) return;
  active = true;
  document.body.classList.add('nge-scythe');
  // pointerdown and mousedown both: neuroglancer listens for mousedown
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('mouseup', swallow, true);
  window.addEventListener('click', swallow, true);
  window.addEventListener('keydown', onKey, true);
  bar = makeBar('Swipe a piece to clear it away', [{label: 'Done', act: () => stopScythe()}]);
}

/** Put the scythe away. Cells already crumbling still go. */
export function stopScythe() {
  if (!active) return;
  active = false;
  sweeping = false;
  document.body.classList.remove('nge-scythe');
  window.removeEventListener('pointerdown', onDown, true);
  window.removeEventListener('pointermove', onMove, true);
  window.removeEventListener('pointerup', onUp, true);
  window.removeEventListener('mousedown', swallow, true);
  window.removeEventListener('mouseup', swallow, true);
  window.removeEventListener('click', swallow, true);
  window.removeEventListener('keydown', onKey, true);
  bar?.remove();
  bar = null;
}

function hideOffer() {
  if (offerTimer) { clearTimeout(offerTimer); offerTimer = null; }
  offer?.remove();
  offer = null;
}

/** After a cut: the scythe is offered for a while. */
function offerScythe() {
  if (active) return;
  hideOffer();
  offer = makeBar('Clear a cut-off piece away?', [
    {label: 'Pick up the scythe', act: () => startScythe()},
    {label: 'Not now', quiet: true, act: () => hideOffer()},
  ]);
  offerTimer = setTimeout(hideOffer, OFFER_MS);
}

/** Call once the viewer exists. */
export function startScytheOffers(v: any) {
  if (viewer) return;
  viewer = v;
  // graphene frontend.ts: the server took a split.
  window.addEventListener('nge-graph-edit', (e: Event) => {
    if ((e as CustomEvent).detail?.kind === 'split') offerScythe();
  });
}
