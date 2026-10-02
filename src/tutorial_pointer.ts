/**
 * tutorial_pointer.ts: a search line from one spot on screen to another.
 *
 * Ames (2026-10-02) asked for the tutorial's "which layer?" (i) to draw a
 * line to the segmentation layer chip, in the style of Highlight Mode's
 * path-search loader (find_path_status.ts startLoader): thin wandering
 * trails set out from the start, the first to arrive lights up as the path,
 * and the target gets a dot. Drawn on one full-screen canvas that ignores
 * the mouse and removes itself.
 */
const TRAIL = 'rgba(200,164,255,0.55)';
const FOUND = '#edd040';

let live: { raf: number; cv: HTMLCanvasElement } | null = null;

export function stopSearchLine() {
  if (!live) return;
  cancelAnimationFrame(live.raf);
  live.cv.remove();
  live = null;
}

export function drawSearchLine(from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 3200) {
  stopSearchLine();
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:100001`;
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }
  ctx.scale(dpr, dpr);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  // Arrive in under a second whatever the distance.
  const speed = Math.max(4, dist / 45);
  type Walker = { x: number; y: number; a: number; pts: number[] };
  const aim = Math.atan2(to.y - from.y, to.x - from.x);
  const walkers: Walker[] = Array.from({ length: 7 }, () => ({ x: from.x, y: from.y, a: aim + (Math.random() - 0.5) * 2.2, pts: [from.x, from.y] }));
  let found: number[] | null = null, foundAt = 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { found = [from.x, from.y, to.x, to.y]; foundAt = performance.now(); }
  const me = { raf: 0, cv };
  live = me;
  const frame = (now: number) => {
    if (live !== me) return;
    // Fade old trails rather than clearing, so they linger then dissolve.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${found ? 0.05 : 0.08})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    if (!found) {
      for (const w of walkers) {
        const toT = Math.atan2(to.y - w.y, to.x - w.x);
        let d = toT - w.a; d = Math.atan2(Math.sin(d), Math.cos(d));
        w.a += d * 0.16 + (Math.random() - 0.5) * 0.7;
        const px = w.x, py = w.y;
        w.x += Math.cos(w.a) * speed; w.y += Math.sin(w.a) * speed;
        w.pts.push(w.x, w.y);
        ctx.strokeStyle = TRAIL; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(w.x, w.y); ctx.stroke();
        if (Math.hypot(to.x - w.x, to.y - w.y) < speed * 1.5) { w.pts.push(to.x, to.y); found = w.pts; foundAt = now; break; }
      }
      // Never wander for long: settle on the straight line.
      if (!found && walkers[0].pts.length > 400) { found = [from.x, from.y, to.x, to.y]; foundAt = now; }
    }
    if (found) {
      const age = now - foundAt;
      const alpha = age < holdMs - 600 ? 1 : Math.max(0, (holdMs - age) / 600);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = FOUND; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
      ctx.shadowColor = FOUND; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(found[0], found[1]);
      for (let i = 2; i < found.length; i += 2) ctx.lineTo(found[i], found[i + 1]);
      ctx.stroke();
      const r = 5 + 2 * Math.sin(age / 160);
      ctx.fillStyle = FOUND;
      ctx.beginPath(); ctx.arc(to.x, to.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      if (age >= holdMs) { stopSearchLine(); return; }
    }
    me.raf = requestAnimationFrame(frame);
  };
  me.raf = requestAnimationFrame(frame);
}
