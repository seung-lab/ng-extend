/**
 * A one-off visitor (Ames 2026-11-08): the Starship (a picture of Ames's 3D
 * model, nose to the right) zooms across the screen once, trailing engine
 * light, then is gone. Once per browser, today only, never for someone who
 * asked for less motion. A drawing on top of the page; it never touches the
 * cells or blocks a click.
 */
import shipUrl from '../images/starship-flyby.png';

const SEEN_KEY = 'pyr-starship-flyby-2026-11-08b';
const UNTIL = Date.parse('2026-11-09T05:00:00Z');   // the end of today, Eastern
const FLY_MS = 4200;

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private window */ }
}

export function flyStarshipAcross() {
  const img = new Image();
  img.src = shipUrl;
  img.onload = () => run(img);
}

function run(img: HTMLImageElement) {
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147480000';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.scale(dpr, dpr);

  const size = Math.max(70, Math.min(130, W * 0.09));
  const y0 = H * (0.3 + Math.random() * 0.2);
  // left to right on a gentle wave
  const at = (q: number): [number, number] => [-size + (W + 2 * size) * q, y0 + Math.sin(q * Math.PI * 2.2) * H * 0.06];
  interface P { x: number; y: number; vx: number; vy: number; age: number; r: number; }
  let parts: P[] = [];
  const t0 = performance.now();
  let last = t0, prev = at(0);
  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const q = Math.min(1, (now - t0) / FLY_MS);
    const [x, y] = at(q);
    const ang = Math.atan2(y - prev[1], x - prev[0]);
    // engine light from both nozzles, laid along the path since last frame
    const back = size * 0.45;
    for (let k = 0; k < 6 && q < 1; k++) {
      const s = Math.random(), side = (k % 2 ? 1 : -1) * size * 0.14;
      const bx = prev[0] + (x - prev[0]) * s, by = prev[1] + (y - prev[1]) * s;
      parts.push({
        x: bx - Math.cos(ang) * back - Math.sin(ang) * side, y: by - Math.sin(ang) * back + Math.cos(ang) * side,
        vx: -Math.cos(ang) * 40 + (Math.random() - 0.5) * 30, vy: -Math.sin(ang) * 40 + (Math.random() - 0.5) * 30,
        age: 0, r: size * (0.06 + Math.random() * 0.05),
      });
    }
    prev = [x, y];
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.age / 1.1, a = 0.7 * Math.pow(Math.max(0, 1 - k), 1.5);
      const r = p.r * (1 + 2 * k);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(${Math.round(230 - 120 * k)},${Math.round(250 - 80 * k)},255,${a})`);
      g.addColorStop(1, 'rgba(60,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    parts = parts.filter(p => p.age < 1.1);
    ctx.globalCompositeOperation = 'source-over';
    if (q < 1) {
      // a quick barrel roll in the middle: the ship squashes thin and back
      const roll = Math.exp(-Math.pow((q - 0.3) / 0.03, 2));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);   // the picture's nose points right, the way it flies
      ctx.scale(1, Math.cos(roll * Math.PI * 2));   // a roll about its own length
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    if (q < 1 || parts.length) requestAnimationFrame(step);
    else cv.remove();
  };
  requestAnimationFrame(step);
}

/** Plays once, a little while after the game opens, if it hasn't yet. */
export function startStarshipFlyby() {
  if (Date.now() > UNTIL || seen()) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const go = () => {
    if (document.visibilityState !== 'visible' || seen()) return;
    markSeen();
    flyStarshipAcross();
  };
  setTimeout(() => {
    if (document.visibilityState === 'visible') go();
    else document.addEventListener('visibilitychange', go, {once: true});
  }, 9000);
}

(window as any).pyrFlyby = flyStarshipAcross;
