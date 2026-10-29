/**
 * A loading sign for a slow 2D image (Ames 2026-10-06: "could you use the
 * neuron loading indicator if it is slow?").
 *
 * Some image data is heavy. The Sandbox image is stored uncompressed, about
 * 3.8 MB a piece, and MEC's sharpest level is 3.5 MB a piece for every single
 * slice, so on an ordinary connection the panel sits grey, black or half drawn
 * for a while with nothing to say it is still coming. When the image has been
 * loading for more than a moment, a small spinner with "Loading" appears at
 * the top of the 2D panel, and goes when the image is all there.
 *
 * Ames 2026-10-29: the growing cell card after 2.5 s was too slow ("2.5 is
 * long, may feel broken") and too much; this is a plain spinner after 0.8 s.
 *
 * The numbers are neuroglancer's own: each image layer reports how many
 * pieces the view needs and how many it has.
 */

const POLL_MS = 200;
// A quick load never shows the sign, and neither does tracing: the wait is
// counted from the last time the view moved, so scrolling through slices
// (when the image is always a little behind, but readable) never brings it up
// over the work. It is for a view that has sat still and is still not there.
// (Player report 2026-10-08: "the loading box for 2d should also wait a second
// or 2 before getting in ... this is making the tracing slower.") The blink
// after a jump on MEC (about half a second) stays under the wait.
const SHOW_AFTER_MS = 800;
const HIDE_AFTER_MS = 300;       // and it does not flicker between pieces

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
/* A small glass pill at the top of the 2D panel: a comet running round a ring
   (Pyr's cyan into violet, Ames 2026-10-30: "as long as it's gorgeous"). */
.nge-img-loading { position: fixed; z-index: 40; display: flex; align-items: center; gap: 9px; pointer-events: none;
  padding: 7px 14px 7px 9px; border-radius: 999px; font: 600 12px/1 'Inter', system-ui, sans-serif; letter-spacing: 0.03em; color: #e8f6ff;
  background: linear-gradient(135deg, rgba(14, 30, 58, 0.86), rgba(30, 18, 62, 0.86)); backdrop-filter: blur(6px);
  border: 1px solid rgba(120, 210, 255, 0.35);
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.45), 0 0 14px rgba(77, 216, 240, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  opacity: 0; transform: translate(-50%, 4px); transition: opacity 0.2s ease, transform 0.2s ease; }
.nge-img-loading--on { opacity: 1; transform: translate(-50%, 0); }
.nge-img-loading .nge-il-ring { position: relative; flex: none; width: 16px; height: 16px; animation: nge-il-spin 0.9s linear infinite;
  filter: drop-shadow(0 0 3px rgba(77, 216, 240, 0.8)); }
.nge-img-loading .nge-il-ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(196, 140, 255, 0) 0%, #c48cff 45%, #4dd8f0 100%);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px)); }
.nge-img-loading .nge-il-ring::after { content: ''; position: absolute; top: 0; left: 50%; width: 3px; height: 3px; margin-left: -1.5px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 4px #4dd8f0; }
@keyframes nge-il-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .nge-img-loading { transition: none; }
  .nge-img-loading .nge-il-ring { animation: none; }
}
`;

/** Call once the viewer exists. */
export function startImageLoadingHint(viewer: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let el: HTMLElement | null = null;
  let behindSince = 0;      // when the image first fell behind, 0 when it is all there
  let caughtUpAt = 0;
  let movedAt = 0;          // when the player last moved the view
  try {
    viewer.navigationState.changed.add(() => { movedAt = Date.now(); if (el) hide(); });
  } catch { /* no navigation state: the wait is counted from falling behind */ }

  const place = () => {
    const panel = slicePanel(viewer);
    if (!el || !panel) return false;
    const b = panel.getBoundingClientRect();
    el.style.left = `${Math.round(b.left + b.width / 2)}px`;
    el.style.top = `${Math.round(b.top + 14)}px`;
    return true;
  };

  const show = () => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'nge-img-loading';
      el.setAttribute('role', 'status');
      el.innerHTML = `<span class="nge-il-ring" aria-hidden="true"></span><span class="nge-il-text">Loading</span>`;
      document.body.appendChild(el);
      if (!place()) { hide(true); return; }
      requestAnimationFrame(() => el?.classList.add('nge-img-loading--on'));
    } else if (!place()) { hide(true); }
  };

  const hide = (now = false) => {
    if (!el) return;
    const gone = el;
    el = null;
    gone.classList.remove('nge-img-loading--on');
    setTimeout(() => gone.remove(), now ? 0 : 220);
  };

  setInterval(() => {
    if (document.hidden) return;
    const p = imageProgress(viewer);
    const now = Date.now();
    if (p.need > 0 && p.have < p.need) {
      caughtUpAt = 0;
      if (!behindSince) behindSince = now;
      if (now - Math.max(behindSince, movedAt) >= SHOW_AFTER_MS) show();
    } else {
      behindSince = 0;
      if (!caughtUpAt) caughtUpAt = now;
      if (now - caughtUpAt >= HIDE_AFTER_MS) hide();
    }
  }, POLL_MS);
}
