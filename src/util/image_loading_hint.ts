/**
 * A loading sign for a slow 2D image (Ames 2026-10-06: "could you use the
 * neuron loading indicator if it is slow?").
 *
 * Some image data is heavy. The Sandbox image is stored uncompressed, about
 * 3.8 MB a piece, and one 2D view needs around twenty pieces, so on an
 * ordinary connection the panel sits grey or half drawn for a while with
 * nothing to say it is still coming (Annkri: "for me that is the 2D image in
 * sandbox"). When the image has been loading for more than a moment, the
 * game's growing cell (GrowingCell.vue) appears at the top of the 2D panel
 * with how much has arrived, and goes when the image is all there.
 *
 * The numbers are neuroglancer's own: each image layer reports how many
 * pieces the view needs and how many it has.
 */
import { createApp, type App } from 'vue';
import GrowingCell from 'components/GrowingCell.vue';

const POLL_MS = 400;
const SHOW_AFTER_MS = 1500;      // a quick load never shows the sign
const HIDE_AFTER_MS = 500;       // and it does not flicker between pieces

interface Progress { need: number; have: number; }

function imageProgress(viewer: any): Progress {
  let need = 0, have = 0;
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    if (!ml.visible || ml.archived || ml.layer?.constructor?.type !== 'image') continue;
    for (const rl of ml.layer.renderLayers ?? []) {
      const p = rl.layerChunkProgressInfo;
      if (!p) continue;
      need += p.numVisibleChunksNeeded || 0;
      have += Math.min(p.numVisibleChunksAvailable || 0, p.numVisibleChunksNeeded || 0);
    }
  }
  return { need, have };
}

/** The first 2D (cross section) panel on screen, if any. */
function slicePanel(viewer: any): HTMLElement | null {
  for (const panel of viewer?.display?.panels ?? []) {
    const el: HTMLElement | undefined = panel?.element;
    if (el && 'sliceView' in panel && el.isConnected && el.offsetWidth > 0) return el;
  }
  return null;
}

const CSS = `
.nge-img-loading { position: fixed; z-index: 40; display: flex; align-items: center; gap: 8px; pointer-events: none;
  padding: 4px 12px 4px 4px; border-radius: 999px; font: 12px/1.3 'Inter', system-ui, sans-serif; color: #dce6f5;
  background: rgba(8, 14, 28, 0.86); border: 1px solid rgba(100, 200, 255, 0.3); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  opacity: 0; transform: translate(-50%, 6px); transition: opacity 0.25s ease, transform 0.25s ease; }
.nge-img-loading--on { opacity: 1; transform: translate(-50%, 0); }
.nge-img-loading .nge-il-count { color: rgba(220, 230, 245, 0.65); font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .nge-img-loading { transition: none; } }
`;

/** Call once the viewer exists. */
export function startImageLoadingHint(viewer: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let el: HTMLElement | null = null;
  let app: App | null = null;
  let behindSince = 0;      // when the image first fell behind, 0 when it is all there
  let caughtUpAt = 0;

  const place = () => {
    const panel = slicePanel(viewer);
    if (!el || !panel) return false;
    const b = panel.getBoundingClientRect();
    el.style.left = `${Math.round(b.left + b.width / 2)}px`;
    el.style.top = `${Math.round(b.top + 14)}px`;
    return true;
  };

  const show = (p: Progress) => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'nge-img-loading';
      el.setAttribute('role', 'status');
      el.innerHTML = `<span class="nge-il-cell"></span><span class="nge-il-text">Loading the image</span><span class="nge-il-count"></span>`;
      document.body.appendChild(el);
      app = createApp(GrowingCell, { size: 38, named: false });
      app.mount(el.querySelector('.nge-il-cell')!);
      if (!place()) { hide(true); return; }
      requestAnimationFrame(() => el?.classList.add('nge-img-loading--on'));
    } else if (!place()) { hide(true); return; }
    (el.querySelector('.nge-il-count') as HTMLElement).textContent = `${p.have} of ${p.need}`;
  };

  const hide = (now = false) => {
    if (!el) return;
    const gone = el, goneApp = app;
    el = null; app = null;
    gone.classList.remove('nge-img-loading--on');
    setTimeout(() => { try { goneApp?.unmount(); } catch { /* already gone */ } gone.remove(); }, now ? 0 : 280);
  };

  setInterval(() => {
    if (document.hidden) return;
    const p = imageProgress(viewer);
    const now = Date.now();
    if (p.need > 0 && p.have < p.need) {
      caughtUpAt = 0;
      if (!behindSince) behindSince = now;
      if (now - behindSince >= SHOW_AFTER_MS) show(p);
    } else {
      behindSince = 0;
      if (!caughtUpAt) caughtUpAt = now;
      if (now - caughtUpAt >= HIDE_AFTER_MS) hide();
    }
  }, POLL_MS);
}
