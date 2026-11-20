/**
 * "Updating the 3D shape" after a cut or merge (Kfay, reports 586 and 582: on
 * an older graphics card the new mesh took about 30 seconds to show, with
 * nothing to say the cut had worked and the picture was still coming).
 *
 * After a merge or cut, a small pill sits at the top of the 3D panel while the
 * segmentation layer still has 3D pieces to load, and goes once they are all
 * there. It can be dragged anywhere (Kfay: "So the player can drag it where
 * he wants"), and remembers where. A quick update never shows it.
 *
 * The numbers are neuroglancer's own: each layer reports how many pieces the
 * view needs and how many it has (as util/image_loading_hint.ts for 2D).
 */

const POLL_MS = 250;
const SHOW_AFTER_MS = 900;     // a quick update never shows the pill
const HIDE_AFTER_MS = 400;     // nor does it flicker between pieces
const GIVE_UP_MS = 120_000;    // a view that never settles is not watched forever
// Some pieces never arrive (one that failed to load, or one neuroglancer keeps
// asking for), and the pill sat at 98% for the full two minutes (Ames
// 2026-11-20: "is this stuck? it's been on 98% for some time"). When the count
// stops moving, the shape is as done as it will get: the pill goes.
const STALL_NEAR_MS = 3_000;   // no progress for this long at 90% or more
const STALL_ANY_MS = 15_000;   // or this long anywhere
const PLACE_KEY = 'nge-mesh-updating-place';

function segProgress(viewer: any): { need: number; have: number } {
  let need = 0, have = 0;
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    if (!ml.visible || ml.archived || !String(ml.layer?.type || '').startsWith('segmentation')) continue;
    for (const rl of ml.layer.renderLayers ?? []) {
      const p = rl.layerChunkProgressInfo;
      if (!p) continue;
      need += p.numVisibleChunksNeeded || 0;
      have += Math.min(p.numVisibleChunksAvailable || 0, p.numVisibleChunksNeeded || 0);
    }
  }
  return { need, have };
}

/** The first 3D panel on screen, if any. */
function perspectivePanel(viewer: any): HTMLElement | null {
  for (const panel of viewer?.display?.panels ?? []) {
    const el: HTMLElement | undefined = panel?.element;
    if (el && !('sliceView' in panel) && 'navigationState' in panel && el.isConnected && el.offsetWidth > 0) return el;
  }
  return null;
}

const CSS = `
.nge-mesh-upd { position: fixed; z-index: 45; display: flex; align-items: center; gap: 9px; cursor: grab; user-select: none;
  padding: 7px 14px 7px 9px; border-radius: 999px; font: 600 12px/1 'Inter', system-ui, sans-serif; letter-spacing: 0.03em; color: #e8f6ff;
  background: linear-gradient(135deg, rgba(14, 30, 58, 0.88), rgba(30, 18, 62, 0.88)); backdrop-filter: blur(6px);
  border: 1px solid rgba(120, 210, 255, 0.35);
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.45), 0 0 14px rgba(77, 216, 240, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  opacity: 0; transition: opacity 0.2s ease; }
.nge-mesh-upd--on { opacity: 1; }
.nge-mesh-upd:active { cursor: grabbing; }
.nge-mesh-upd .nge-mu-ring { position: relative; flex: none; width: 16px; height: 16px; animation: nge-mu-spin 0.9s linear infinite;
  filter: drop-shadow(0 0 3px rgba(77, 216, 240, 0.8)); }
.nge-mesh-upd .nge-mu-ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(196, 140, 255, 0) 0%, #c48cff 45%, #4dd8f0 100%);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px)); }
.nge-mesh-upd .nge-mu-count { color: #9fd3ff; font-variant-numeric: tabular-nums; font-weight: 500; }
@keyframes nge-mu-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .nge-mesh-upd { transition: none; } .nge-mesh-upd .nge-mu-ring { animation: none; } }
`;

function savedPlace(): { x: number; y: number } | null {
  try { const p = JSON.parse(localStorage.getItem(PLACE_KEY) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; }
}

/** Call once the viewer exists. */
export function startMeshUpdating(viewer: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let el: HTMLElement | null = null;
  let watchUntil = 0;        // watching while now < this (set by an edit)
  let editAt = 0;
  let caughtUpAt = 0;
  let timer = 0;
  let lastHave = -1, lastNeed = -1, movedAt = 0;

  const place = () => {
    if (!el) return false;
    const saved = savedPlace();
    if (saved) {
      el.style.left = `${Math.min(Math.max(0, saved.x), window.innerWidth - 60)}px`;
      el.style.top = `${Math.min(Math.max(0, saved.y), window.innerHeight - 30)}px`;
      return true;
    }
    const panel = perspectivePanel(viewer);
    if (!panel) return false;
    const b = panel.getBoundingClientRect();
    el.style.left = `${Math.round(b.left + b.width / 2 - el.offsetWidth / 2)}px`;
    el.style.top = `${Math.round(b.top + 14)}px`;
    return true;
  };

  const makeDraggable = (node: HTMLElement) => {
    node.addEventListener('pointerdown', e => {
      const r = node.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      node.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => { node.style.left = `${m.clientX - dx}px`; node.style.top = `${m.clientY - dy}px`; };
      const up = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        try { localStorage.setItem(PLACE_KEY, JSON.stringify({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) })); } catch { /* private window */ }
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
    // Double click: back to the top of the 3D panel.
    node.addEventListener('dblclick', () => { try { localStorage.removeItem(PLACE_KEY); } catch { /* */ } place(); });
  };

  const show = (p: { need: number; have: number }) => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'nge-mesh-upd';
      el.setAttribute('role', 'status');
      el.title = 'Your edit is saved. The 3D shape is still loading. Drag to move; double click to put back.';
      el.innerHTML = `<span class="nge-mu-ring" aria-hidden="true"></span><span>Updating the 3D shape</span><span class="nge-mu-count"></span>`;
      document.body.appendChild(el);
      makeDraggable(el);
      if (!place()) { hide(true); return; }
      requestAnimationFrame(() => el?.classList.add('nge-mesh-upd--on'));
    }
    const count = el.querySelector('.nge-mu-count') as HTMLElement | null;
    if (count) count.textContent = p.need > 1 ? `${Math.floor((p.have / p.need) * 100)}%` : '';
  };

  const hide = (now = false) => {
    if (!el) return;
    const gone = el;
    el = null;
    gone.classList.remove('nge-mesh-upd--on');
    setTimeout(() => gone.remove(), now ? 0 : 220);
  };

  const tick = () => {
    const now = Date.now();
    if (now > watchUntil) { hide(); clearInterval(timer); timer = 0; return; }
    if (document.hidden) return;
    const p = segProgress(viewer);
    if (p.have !== lastHave || p.need !== lastNeed) { lastHave = p.have; lastNeed = p.need; movedAt = now; }
    const still = now - (movedAt || now);
    const stalled = p.need > 0 && (still >= STALL_ANY_MS || (still >= STALL_NEAR_MS && p.have / p.need >= 0.9));
    if (p.need > 0 && p.have < p.need && !stalled) {
      caughtUpAt = 0;
      if (now - editAt >= SHOW_AFTER_MS) show(p);
    } else {
      if (!caughtUpAt) caughtUpAt = now;
      // Caught up, and given the new shape a moment to be asked for.
      if (now - caughtUpAt >= HIDE_AFTER_MS && now - editAt >= SHOW_AFTER_MS) { hide(); watchUntil = 0; }
    }
  };

  window.addEventListener('nge-graph-edit', ((e: CustomEvent) => {
    const kind = e.detail?.kind;
    if (kind !== 'merge' && kind !== 'split') return;
    editAt = Date.now();
    caughtUpAt = 0;
    lastHave = -1; lastNeed = -1; movedAt = editAt;
    watchUntil = editAt + GIVE_UP_MS;
    if (!timer) timer = window.setInterval(tick, POLL_MS);
  }) as EventListener);
}
