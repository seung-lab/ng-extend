/**
 * Collapse a panel into its slim form and beam it back open: the Scout tag
 * panel's animation (TagModePanel), for panels that keep ONE element and
 * change its size (Cell Library slim view, Ames 2026-10-01).
 *
 * Collapse: a snapshot of the big panel shrinks into the slim panel's exact
 * rect while its contents scale down and fade, then particles write the slim
 * panel's parts. Expand: a beam draws the frame and unrolls the panel under it.
 */
import { runPanelDraw, runParticleWrite } from './holo_trace';

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

/** Shrink the snapshot into `target` (the panel, already in its slim form),
 *  then write `parts` with particles as the real panel fades in. */
export function morphIntoSlim(g: PanelGhost, target: HTMLElement, parts: Element[]): void {
  const { ghost, snap, from } = g;
  const to = target.getBoundingClientRect();
  if (!to.width) { ghost.remove(); return; }
  target.style.opacity = '0';
  const D = 480;
  ghost.animate([
    { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
      borderColor: 'rgba(74, 150, 224, 0.35)' },
    { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
      borderColor: 'rgba(53, 181, 255, 0.6)' },
  ], { duration: D, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' });
  snap.animate([
    { transform: 'scale(1, 1)', opacity: 1, filter: 'blur(0)' },
    { transform: `scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0, filter: 'blur(3px)' },
  ], { duration: D * 0.8, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' });
  setTimeout(() => {
    const rects = parts.filter(el => (el as HTMLElement).offsetWidth > 0).map(el => el.getBoundingClientRect());
    runParticleWrite(rects, to, [to]);
    target.style.transition = 'opacity 0.42s ease 0.12s';
    target.style.opacity = '1';
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
    fade.onfinish = () => ghost.remove();
    setTimeout(() => { target.style.transition = ''; target.style.opacity = ''; }, 700);
  }, D * 0.78);
}

/** Beam-draw `box` (already at its full size) from the top down. The beam
 *  runs on a frame laid over the panel, because the panel itself is clipped. */
export function revealWithBeam(box: HTMLElement): void {
  // The caller may have clipped the box already (to hide it while it re-renders).
  if (reduced()) { box.style.clipPath = ''; return; }
  const r = box.getBoundingClientRect();
  if (!r.width || !r.height) { box.style.clipPath = ''; return; }
  const frame = document.createElement('div');
  Object.assign(frame.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    borderRadius: getComputedStyle(box).borderRadius, pointerEvents: 'none', zIndex: '10020',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(frame);
  box.style.clipPath = 'inset(0 0 100% 0)';
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    box.style.clipPath = '';
    setTimeout(() => frame.remove(), 500);
  };
  const total = runPanelDraw(frame, 'down', frac => {
    if (frac >= 1) done();
    else box.style.clipPath = `inset(0 0 ${((1 - frac) * 100).toFixed(2)}% 0)`;
  });
  if (!total) done();
  else setTimeout(done, total + 200);
}
