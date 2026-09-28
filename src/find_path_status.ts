// Find Path progress (Amy 2026-09-28: "find path should have a loading icon
// or something to indicate that it is working", and the "Finding path
// between..." line was unstyled).
//
// neuroglancer's graphServer.findPath (graphene/frontend.ts) shows a plain
// #statusContainer line, "Finding path between A and B", for as long as the
// request runs, then "Path found!" (5 s) or "Path finding failed: ...". None of
// them carry a class, so this module recognises them by text and restyles them
// in place:
//   working  a path-search loader (explorers wander from the green source dot
//            and trail toward the pink target; the first to arrive lights its
//            route, then the search restarts), "Tracing path", elapsed seconds
//   done     a green check line
//   error    the error text, kept verbatim, in the error style
// While working, body gets .nge-fp-busy so the tool bar can react (Submit
// pulses, the hint says it is tracing). Nothing of neuroglancer's is changed:
// if it rewrites the line (e.g. working -> error) the rescan re-classifies it.

const UI_ATTR = 'data-nge-fp-ui';
type Kind = 'working' | 'done' | 'error' | '';

interface Live { raf: number; timer: number; }
const live = new Map<HTMLElement, Live>();

/** The line's own text, ignoring anything this module injected. */
function ownText(li: HTMLElement): string {
  let s = '';
  li.childNodes.forEach(n => {
    if (n instanceof HTMLElement && n.hasAttribute(UI_ATTR)) return;
    s += n.textContent ?? '';
  });
  return s.trim();
}

function kindOf(text: string): Kind {
  if (text.startsWith('Finding path between')) return 'working';
  if (text.startsWith('Path found')) return 'done';
  if (text.startsWith('Path finding failed')) return 'error';
  return '';
}

function precisionOn(): boolean {
  const cb = document.querySelector<HTMLInputElement>('.graphene-find-path label input[type="checkbox"]');
  return !!cb?.checked;
}

function stop(li: HTMLElement) {
  const l = live.get(li);
  if (l) { cancelAnimationFrame(l.raf); clearInterval(l.timer); live.delete(li); }
  li.querySelectorAll(`[${UI_ATTR}]`).forEach(e => e.remove());
}

/** Path-search loader: explorers on a biased random walk from S to T. */
function startLoader(cv: HTMLCanvasElement, l: Live) {
  const W = 190, H = 24, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const S = { x: 9, y: H / 2 }, T = { x: W - 9, y: H / 2 };
  type Walker = { x: number; y: number; a: number; pts: number[] };
  let walkers: Walker[] = [];
  let found: number[] | null = null, foundAt = 0;
  const reset = () => {
    walkers = Array.from({ length: 7 }, () => ({ x: S.x, y: S.y, a: (Math.random() - 0.5) * 2.4, pts: [S.x, S.y] }));
    found = null;
  };
  reset();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dot = (x: number, y: number, c: string, r: number) => {
    ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  };
  const frame = (now: number) => {
    // Fade old trails rather than clearing, so paths linger then dissolve.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${found ? 0.04 : 0.09})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    if (!found && !reduce) {
      for (const w of walkers) {
        const toT = Math.atan2(T.y - w.y, T.x - w.x);
        // Steer toward the target with jitter, bounce off the top and bottom.
        let d = toT - w.a; d = Math.atan2(Math.sin(d), Math.cos(d));
        w.a += d * 0.08 + (Math.random() - 0.5) * 0.9;
        const px = w.x, py = w.y;
        w.x += Math.cos(w.a) * 1.25; w.y += Math.sin(w.a) * 1.25;
        if (w.y < 2 || w.y > H - 2) { w.a = -w.a; w.y = Math.max(2, Math.min(H - 2, w.y)); }
        if (w.x < 2) { w.a = Math.PI - w.a; w.x = 2; }
        w.pts.push(w.x, w.y);
        ctx.strokeStyle = 'rgba(200,164,255,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(w.x, w.y); ctx.stroke();
        if (Math.hypot(T.x - w.x, T.y - w.y) < 5) { found = w.pts; foundAt = now; break; }
      }
      // A search that wandered too long starts over.
      if (!found && walkers[0].pts.length > 900) reset();
    }
    if (found) {
      // The winning route lights up, then the search restarts.
      const k = Math.min(1, (now - foundAt) / 350);
      ctx.strokeStyle = `rgba(235,220,255,${0.9 * (1 - Math.max(0, (now - foundAt - 500) / 400))})`;
      ctx.lineWidth = 1.6; ctx.shadowColor = '#c8a4ff'; ctx.shadowBlur = 8;
      ctx.beginPath();
      const n = Math.floor((found.length / 2) * k);
      for (let i = 0; i < n; i++) i ? ctx.lineTo(found[i * 2], found[i * 2 + 1]) : ctx.moveTo(found[0], found[1]);
      ctx.stroke(); ctx.shadowBlur = 0;
      if (now - foundAt > 950) { ctx.clearRect(0, 0, W, H); reset(); }
    }
    dot(S.x, S.y, '#6fe0a0', 3);
    dot(T.x, T.y, '#ff8fcf', 3);
    l.raf = requestAnimationFrame(frame);
  };
  l.raf = requestAnimationFrame(frame);
}

function apply(li: HTMLElement, kind: Kind) {
  stop(li);
  li.classList.remove('nge-fp-status', 'nge-fp-status--working', 'nge-fp-status--done', 'nge-fp-status--error');
  li.dataset.ngeFp = kind;
  if (!kind) return;
  li.classList.add('nge-fp-status', `nge-fp-status--${kind}`);
  if (kind === 'error') return;  // keep neuroglancer's error text as is, just styled

  const ui = document.createElement('span');
  ui.setAttribute(UI_ATTR, '');
  ui.className = 'nge-fp-ui';
  if (kind === 'done') {
    ui.innerHTML = '<span class="nge-fp-check">✓</span><span class="nge-fp-label">Path found</span>';
    li.appendChild(ui);
    return;
  }
  const cv = document.createElement('canvas');
  cv.className = 'nge-fp-loader';
  const label = document.createElement('span');
  label.className = 'nge-fp-label';
  label.textContent = 'Tracing path';
  const secs = document.createElement('span');
  secs.className = 'nge-fp-secs';
  secs.textContent = '0s';
  const note = document.createElement('span');
  note.className = 'nge-fp-note';
  note.textContent = precisionOn()
    ? 'Precision mode is on: slower, but the path follows the cell closely'
    : 'Following the cell between your two points';
  ui.append(cv, label, secs, note);
  li.appendChild(ui);
  li.title = ownText(li);
  const l: Live = { raf: 0, timer: 0 };
  const t0 = Date.now();
  l.timer = window.setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    secs.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }, 1000);
  live.set(li, l);
  startLoader(cv, l);
}

function rescan() {
  const container = document.getElementById('statusContainer');
  let working = false;
  if (container) {
    for (const el of Array.from(container.children)) {
      const li = el as HTMLElement;
      const kind = kindOf(ownText(li));
      if (kind === 'working') working = true;
      if ((li.dataset.ngeFp ?? '') !== kind) apply(li, kind);
    }
  }
  // Lines neuroglancer has already removed: stop their animation.
  for (const li of Array.from(live.keys())) if (!li.isConnected) stop(li);
  document.body.classList.toggle('nge-fp-busy', working);
}

let queued = false;
function watch() {
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; rescan(); });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
// The bundle can run before <body> exists; never let that break startup.
if (document.body) watch();
else document.addEventListener('DOMContentLoaded', watch, { once: true });
