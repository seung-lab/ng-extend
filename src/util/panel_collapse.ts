/**
 * Collapse a panel into its slim form and beam it back open: the Scout tag
 * panel's animation (TagModePanel), for panels that keep ONE element and
 * change its size (Cell Library slim view, Ames 2026-10-01).
 *
 * Collapse: a snapshot of the big panel zips up under a light bar into the
 * slim panel's rect. Expand: the full panel opens from the top under the same
 * light bar, its rounded corners kept all the way (Ames 2026-10-20).
 */

export interface PanelGhost { ghost: HTMLElement; snap: HTMLElement; from: DOMRect; }

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Snapshot `box` before it changes size. `trim` names long lists inside it:
 *  only their first rows are copied (a 16,000 row list is not worth cloning). */
export function snapshotPanel(box: HTMLElement, trim = '', keep = 30): PanelGhost | null {
  const from = box.getBoundingClientRect();
  if (!from.width || !from.height || reduced()) return null;
  const cs = getComputedStyle(box);
  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`,
    width: `${from.width}px`, height: `${from.height}px`,
    zIndex: '10020', pointerEvents: 'none', overflow: 'hidden',
    borderRadius: cs.borderRadius, boxSizing: 'border-box',
    background: 'rgba(6, 10, 20, 0.95)',
    border: '1px solid rgba(74, 150, 224, 0.35)',
    boxShadow: '0 6px 28px rgba(0, 0, 0, 0.55)',
  } as Partial<CSSStyleDeclaration>);
  const copy = (node: Element): Element => {
    if (trim && node.matches(trim)) {
      const shallow = node.cloneNode(false) as Element;
      Array.from(node.children).slice(0, keep).forEach(c => shallow.appendChild(c.cloneNode(true)));
      return shallow;
    }
    if (trim && node.querySelector(trim)) {
      const shallow = node.cloneNode(false) as Element;
      Array.from(node.childNodes).forEach(c =>
        shallow.appendChild(c.nodeType === 1 ? copy(c as Element) : c.cloneNode(true)));
      return shallow;
    }
    return node.cloneNode(true) as Element;
  };
  const snap = copy(box) as HTMLElement;
  Object.assign(snap.style, {
    animation: 'none', clipPath: '', margin: '0', border: 'none', boxShadow: 'none',
    width: `${from.width}px`, height: `${from.height}px`, maxHeight: 'none',
    overflow: 'hidden', transformOrigin: 'top left', position: 'absolute', left: '0', top: '0',
  } as Partial<CSSStyleDeclaration>);
  ghost.appendChild(snap);
  document.body.appendChild(ghost);
  return { ghost, snap, from };
}

/** A glowing bar the width of a box, inset from its rounded corners: the one
 *  light both the collapse and the expand ride on (Ames 2026-10-20: "Just
 *  make it a light bar zip up"). */
function makeLightBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  Object.assign(bar.style, {
    position: 'absolute', height: '2px', pointerEvents: 'none', borderRadius: '2px',
    background: 'linear-gradient(90deg, rgba(53,181,255,0) 0%, rgba(120,200,255,0.85) 18%, '
      + 'rgba(232,246,255,1) 50%, rgba(120,200,255,0.85) 82%, rgba(53,181,255,0) 100%)',
    boxShadow: '0 0 10px 1px rgba(53,181,255,0.65), 0 0 22px 2px rgba(53,181,255,0.25)',
  } as Partial<CSSStyleDeclaration>);
  return bar;
}

function radiusOf(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
}

/** Zip the snapshot up into `target` (the panel, already in its slim form):
 *  the big panel closes from the bottom under a light bar until it is the
 *  slim panel's size, then the slim panel shows. `parts` is kept for
 *  callers; nothing is written with particles any more (Ames 2026-10-20: "I
 *  also don't love the particles"). */
export function morphIntoSlim(g: PanelGhost, target: HTMLElement, parts: Element[]): void {
  void parts;
  const { ghost, snap, from } = g;
  const to = target.getBoundingClientRect();
  if (!to.width) { ghost.remove(); return; }
  // the picture of the big panel stretches with the box (the slim bar can be
  // wider), so no edge of it shows inside the zipping box
  snap.style.width = '100%';
  target.style.opacity = '0';
  const R = radiusOf(target) || parseFloat(ghost.style.borderRadius) || 12;
  const bar = makeLightBar();
  Object.assign(bar.style, { left: `${R}px`, right: `${R}px`, bottom: '0' } as Partial<CSSStyleDeclaration>);
  ghost.appendChild(bar);
  const D = 420;
  const zip = ghost.animate([
    { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` },
    { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` },
  ], { duration: D, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' });
  zip.onfinish = () => {
    target.style.transition = 'opacity 0.18s ease';
    target.style.opacity = '1';
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    fade.onfinish = () => ghost.remove();
    setTimeout(() => { target.style.transition = ''; target.style.opacity = ''; }, 400);
  };
}

/** Call `then` once `el` has kept the same size and place for a few frames
 *  (a list still filling in, a clamp still moving it), or after ~1.5 s. A
 *  light drawn on a box that is still changing misses its border. */
export function whenSettled(el: HTMLElement, then: () => void): void {
  let last = '', same = 0, n = 0;
  const tick = () => {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    const key = `${el.offsetWidth},${el.offsetHeight},${Math.round(r.left)},${Math.round(r.top)}`;
    same = key === last ? same + 1 : 0;
    last = key;
    if (same >= 3 || ++n > 90) then();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Open `box` from the top down under a light bar, once it has settled at
 *  its full size. The mask keeps the panel's rounded corners all the way
 *  (Ames 2026-10-20: the light "makes a sharp edge around the corner of the
 *  box, but the corner should be curved"). */
export function revealWithBeam(box: HTMLElement): void {
  // The caller may have clipped the box already (to hide it while it re-renders).
  if (reduced()) { box.style.clipPath = ''; return; }
  const R = radiusOf(box);
  box.style.clipPath = `inset(0 0 100% 0 round ${R}px)`;
  whenSettled(box, () => zipOpen(box));
}

function zipOpen(box: HTMLElement): void {
  const r0 = box.getBoundingClientRect();
  if (!r0.width || !r0.height) { box.style.clipPath = ''; return; }
  const R = radiusOf(box);
  const bar = makeLightBar();
  Object.assign(bar.style, { position: 'fixed', zIndex: '10020' } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(bar);
  const D = 460;
  const t0 = performance.now();
  const ease = (k: number) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const step = (now: number) => {
    if (!box.isConnected) { bar.remove(); return; }
    const k = Math.min(1, (now - t0) / D);
    const f = ease(k);
    // Follow the panel if it moves (a drag, a clamp) while it opens.
    const r = box.getBoundingClientRect();
    box.style.clipPath = k >= 1 ? '' : `inset(0 0 ${((1 - f) * 100).toFixed(2)}% 0 round ${R}px)`;
    // The bar rides the opening edge, inside the rounded corners.
    const y = r.top + f * r.height;
    Object.assign(bar.style, {
      left: `${r.left + R}px`, width: `${Math.max(0, r.width - 2 * R)}px`, top: `${y - 1}px`,
    } as Partial<CSSStyleDeclaration>);
    if (k < 1) { requestAnimationFrame(step); return; }
    const fade = bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
    fade.onfinish = () => bar.remove();
  };
  requestAnimationFrame(step);
  // A tab in the background runs no frames: never leave the panel hidden.
  setTimeout(() => { if (box.style.clipPath) { box.style.clipPath = ''; bar.remove(); } }, D + 1500);
}
