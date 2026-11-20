/**
 * Nurro flies off (Ames 2026-11-19): out of the chat box at the end of the
 * Datasets Unlocked ceremony, a hover, then up and off the right of the page,
 * leaving the starship's contrail behind him (src/util/starship.ts: glowing
 * particles, white hot, then cyan, then a fading blue). Drawn on a canvas
 * over the page; everything is removed when he is gone.
 */
import nurroFlying from '../../static/nurro/nurro-super-v2.png';

const LIFE_MS = 1250;
/** The fly-by's climb: tan of 15 degrees. */
const SLOPE = Math.tan(15 * Math.PI / 180);
interface Puff { x: number; y: number; vx: number; vy: number; age: number; size: number; }

/** The hourly fly-by (Ames 2026-11-20: "maybe he could just fly across the
 *  top 2/3 of the page"): in from the left, climbing at 15 degrees, out at
 *  the right, on a straight, wavy or looping path picked at random. */
export function flyNurroAcross(src: string = nurroFlying): Promise<void> { return flyNurroFrom(null, src, true); }

interface PathPoint { x: number; y: number; turn: number; heading: number; }
/** The fly-by's path, sampled: top left corner, the turn of the art (0 is
 *  the art as drawn, flying the base line) and the heading in radians. From
 *  (x, y) along (dx, dy); a wave or a loop rides on that line. */
function acrossPath(kind: 'straight' | 'wave' | 'loop', x: number, y: number, dx: number, dy: number, size: number): PathPoint[] {
  const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  // "up" from the line: its normal toward the top of the page
  const nx = uy, ny = -ux;
  const base = Math.atan2(dy, dx);
  const R = size * 1.1, loopAt = len * (0.35 + Math.random() * 0.25);
  const total = kind === 'loop' ? len + 2 * Math.PI * R : len;
  const N = 90, pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const s = total * i / N;
    let along = s, off = 0, ox = 0, oy = 0;
    if (kind === 'wave') off = size * 0.45 * Math.sin(2 * Math.PI * 1.5 * s / len);
    if (kind === 'loop') {
      if (s > loopAt && s < loopAt + 2 * Math.PI * R) {
        const phi = (s - loopAt) / R;
        along = loopAt; ox = ux * R * Math.sin(phi) + nx * R * (1 - Math.cos(phi)); oy = uy * R * Math.sin(phi) + ny * R * (1 - Math.cos(phi));
      } else if (s >= loopAt + 2 * Math.PI * R) along = s - 2 * Math.PI * R;
    }
    pts.push({ x: x + ux * along + nx * off + ox, y: y + uy * along + ny * off + oy });
  }
  const out: PathPoint[] = [];
  let prevTurn = 0;
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    // the turn, unwrapped so the loop turns all the way round, never back
    let turn = (heading - base) * 180 / Math.PI;
    while (turn - prevTurn > 180) turn -= 360;
    while (turn - prevTurn < -180) turn += 360;
    prevTurn = turn;
    out.push({ x: pts[i].x, y: pts[i].y, turn, heading });
  }
  return out;
}
function pathAt(path: PathPoint[], f: number): PathPoint {
  return path[Math.max(0, Math.min(path.length - 1, Math.round(f * (path.length - 1))))];
}

export function flyNurroFrom(box: { left: number; top: number; width: number; height: number } | null, src: string = nurroFlying, across = false): Promise<void> {
  return new Promise(done => {
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; } } catch { /* fly */ }
    const W = window.innerWidth, H = window.innerHeight;
    // Across the page he is smaller (Ames 2026-11-20: "he should be smaller").
    const size = across ? Math.min(96, Math.max(64, W * 0.05)) : Math.min(180, Math.max(110, W * 0.1));
    const x0 = box && box.width ? box.left + box.width / 2 - size / 2 : 40;
    const y0 = box && box.height ? box.top + box.height / 2 - size / 2 : H - size - 80;

    const canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: W + 'px', height: H + 'px', zIndex: '99998', pointerEvents: 'none' });
    const img = document.createElement('img');
    img.src = src; img.alt = ''; img.setAttribute('aria-hidden', 'true');
    Object.assign(img.style, { position: 'fixed', left: '0', top: '0', width: size + 'px', height: size + 'px', zIndex: '99999', pointerEvents: 'none',
      transform: `translate(${x0}px, ${y0}px) scale(0.2)`, opacity: '0', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.45))' });
    document.body.appendChild(canvas);
    document.body.appendChild(img);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const dx = W + size - x0, rise = Math.max(y0 + size, H * 0.6);
    const at = (f: number, s = 1, r = 0) => `translate(${x0 + dx * f * f}px, ${y0 - rise * (f < 0.25 ? f * 0.4 : 0.1 + (f - 0.25) * 1.2)}px) rotate(${r}deg) scale(${s})`;
    // The hourly fly-by (Ames 2026-11-20): climbing at 15 degrees ("he should
    // fly UP at 15"), within the top two thirds of the page, on a path picked
    // at random each time ("sometimes he flies straight, sometimes he does a
    // little loop-de-loop"): straight, a gentle wave, or a loop. His head
    // always points the way he is going, and the contrail streams behind.
    const climb = (W + 2 * size) * SLOPE;
    const ay = Math.min(H * 0.66 - size, climb + H * 0.04 + Math.random() * Math.max(0, H * 0.62 - size - climb - H * 0.04));
    const kind = across ? (['straight', 'wave', 'loop'] as const)[Math.floor(Math.random() * 3)] : 'straight';
    const path = across ? acrossPath(kind, -size, ay, W + 2 * size, -climb, size) : [];
    const DURATION = across ? (kind === 'loop' ? 6800 : 5200) : 3800;
    const anim = across ? img.animate(path.map((q, i) => ({
      transform: `translate(${q.x}px, ${q.y}px) rotate(${q.turn}deg)`, opacity: 1, offset: i / (path.length - 1),
    })), { duration: DURATION, easing: 'linear', fill: 'forwards' }) : img.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(0.2)`, opacity: 0, offset: 0 },
      { transform: `translate(${x0}px, ${y0 - 30}px) rotate(-6deg) scale(1.1)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${x0 + 10}px, ${y0 - 40}px) rotate(-4deg) scale(1)`, opacity: 1, offset: 0.28 },
      { transform: at(0.55, 1, -12), opacity: 1, offset: 0.6 },
      { transform: at(1, 0.9, -22), opacity: 1, offset: 1 },
    ], { duration: DURATION, easing: 'ease-in', fill: 'forwards' });

    let puffs: Puff[] = [];
    let last = performance.now(), prev: { x: number; y: number } | null = null, debt = 0, gone = false;
    const finish = () => { if (gone) return; gone = true; img.remove(); canvas.remove(); done(); };
    const frame = (now: number) => {
      if (gone) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = Number(anim.currentTime || 0);
      const r = img.getBoundingClientRect();
      // His back, where the cape streams from (he faces right).
      const here = across ? pathAt(path, t / DURATION) : null;
      // Across: behind his back along the way he is heading.
      const tail = here ? { x: r.left + r.width / 2 - Math.cos(here.heading) * size * 0.4, y: r.top + r.height / 2 - Math.sin(here.heading) * size * 0.4 }
        : { x: r.left + r.width * 0.16, y: r.top + r.height * 0.52 };
      const speed = prev ? Math.hypot(tail.x - prev.x, tail.y - prev.y) / Math.max(dt, 0.001) : 0;
      // A thin wisp on the hover, a full contrail once he is moving.
      const power = !across && t < DURATION * 0.12 ? 0 : Math.min(1, 0.15 + speed / 900);
      debt += dt * (across ? 110 : 420) * power;
      while (debt >= 1 && t < DURATION) {
        debt -= 1;
        const along = Math.random();
        const p = prev ? { x: prev.x + (tail.x - prev.x) * along, y: prev.y + (tail.y - prev.y) * along } : tail;
        const jx = Math.random() - 0.5, jy = Math.random() - 0.5;
        const L = r.width;
        // Across, the puffs drift straight back from the way he is heading.
        const back = -L * (0.4 + Math.random() * 0.3) * 0.6;
        const hx = here ? Math.cos(here.heading) : 1, hy = here ? Math.sin(here.heading) : 0;
        puffs.push({ x: p.x + jx * L * 0.06, y: p.y + jy * L * 0.06, vx: (here ? back * hx : back) + jx * L * (across ? 0.12 : 0.3), vy: here ? back * hy + jy * L * 0.12 : L * 0.15 + jy * L * 0.3,
          age: (1 - along) * dt * 1000, size: L * (across ? 0.03 + Math.random() * 0.03 : 0.05 + Math.random() * 0.05) });
      }
      prev = tail;
      for (const q of puffs) { q.age += dt * 1000; q.x += q.vx * dt; q.y += q.vy * dt; const k = Math.max(0, 1 - dt * 2.2); q.vx *= k; q.vy *= k; }
      puffs = puffs.filter(q => q.age < LIFE_MS);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const q of puffs) {
        const k = q.age / LIFE_MS;
        // white hot, then cyan, then a fading blue (as the ship's trail)
        const R = Math.round(255 * (0.55 - 0.45 * k)), G = Math.round(255 * (0.95 - 0.45 * k));
        const a = 0.55 * Math.pow(1 - k, 1.6);
        const rad = q.size * (1 + 1.6 * k);
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad);
        g.addColorStop(0, `rgba(${R},${G},255,${a})`);
        g.addColorStop(1, `rgba(${R},${G},255,0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.fill();
      }
      if (t >= DURATION && !puffs.length) { finish(); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // However the page is (a hidden tab draws no frames), nothing stays behind.
    setTimeout(finish, DURATION + LIFE_MS + 3000);
  });
}
