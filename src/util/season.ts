/**
 * Pyr's calendar of seasonal touches (Ames 2026-11-02).
 *
 * - Thanksgiving week: the turkey walks along the bottom of the screen
 *   (src/util/turkey.ts).
 * - The point particles take a seasonal shape (Nseraf's idea, report #342):
 *   snowflakes in December, bats from late September to the end of October,
 *   eggs around Easter, and the usual dots the rest of the year.
 *
 * To try a season on any day, set a date in the browser console:
 *   localStorage.setItem('nge.seasonDate', '2026-11-26')
 * and reload. Remove it (localStorage.removeItem('nge.seasonDate')) to go
 * back to today.
 */

/** Today, or the test date set in localStorage. */
export function seasonToday(): Date {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localStorage.getItem('nge.seasonDate') ?? '');
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  } catch { /* storage blocked */ }
  return new Date();
}

const dayStart = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

/** Thanksgiving in the US: the fourth Thursday of November. */
export function thanksgiving(year: number): Date {
  const first = new Date(year, 10, 1).getDay();
  return new Date(year, 10, 1 + ((4 - first + 7) % 7) + 21);
}

/** The Sunday before Thanksgiving through the Sunday after it. */
export function thanksgivingWeek(now = seasonToday()): boolean {
  const t = thanksgiving(now.getFullYear()), d = t.getDate();
  const from = dayStart(now.getFullYear(), 10, d - 4), to = dayStart(now.getFullYear(), 10, d + 4);
  return now.getTime() >= from && now.getTime() < to;
}

/** Easter Sunday (Western), worked out for any year (the Gregorian computus). */
export function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export type ParticleShape = 'dot' | 'snow' | 'bat' | 'egg';

/** The shape point particles take today. */
export function particleShape(now = seasonToday()): ParticleShape {
  const y = now.getFullYear(), m = now.getMonth(), t = now.getTime();
  if (m === 11) return 'snow';
  if (t >= dayStart(y, 8, 20) && t < dayStart(y, 10, 1)) return 'bat';
  const e = easter(y);
  // Palm Sunday through Easter Monday.
  if (t >= dayStart(y, e.getMonth(), e.getDate() - 7) && t < dayStart(y, e.getMonth(), e.getDate() + 2)) return 'egg';
  return 'dot';
}

let cached: { at: number; shape: ParticleShape } | null = null;
/** particleShape(), looked up at most once a minute (bursts call it often). */
export function currentParticleShape(): ParticleShape {
  const now = Date.now();
  if (!cached || now - cached.at > 60_000) cached = { at: now, shape: particleShape() };
  return cached.shape;
}

/** Snowflakes are drawn as lines; the other shapes are filled. */
export const shapeIsStroked = (s: ParticleShape) => s === 'snow';

/**
 * Adds one particle of `shape` to the canvas's current path, centred at
 * (x, y), about `r` across its middle, turned by `rot`. Every particle of a
 * burst goes into the same path, so a burst is still one fill or one stroke.
 */
export function addParticleShape(c: CanvasRenderingContext2D, shape: ParticleShape, x: number, y: number, r: number, rot: number) {
  if (shape === 'dot') { c.moveTo(x + r, y); c.arc(x, y, r, 0, 6.283); return; }
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const P = (px: number, py: number): [number, number] => [x + px * cos - py * sin, y + px * sin + py * cos];
  if (shape === 'snow') {
    // Six arms, each with a small V near its tip.
    const L = r * 3.2;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3, ca = Math.cos(a), sa = Math.sin(a);
      const arm = (u: number, v: number) => P(ca * u - sa * v, sa * u + ca * v);
      let p = arm(0, 0); c.moveTo(p[0], p[1]); p = arm(L, 0); c.lineTo(p[0], p[1]);
      p = arm(L * 0.55, -L * 0.28); c.moveTo(p[0], p[1]); p = arm(L * 0.75, 0); c.lineTo(p[0], p[1]);
      p = arm(L * 0.55, L * 0.28); c.lineTo(p[0], p[1]);
    }
    return;
  }
  if (shape === 'egg') {
    // Narrower at the top.
    const w = r * 2, h = r * 2.7;
    let p = P(0, -h); c.moveTo(p[0], p[1]);
    const curve = (a: number[], b: number[], e: number[]) => {
      const q1 = P(a[0], a[1]), q2 = P(b[0], b[1]), q3 = P(e[0], e[1]);
      c.bezierCurveTo(q1[0], q1[1], q2[0], q2[1], q3[0], q3[1]);
    };
    curve([w * 0.8, -h], [w, h * 0.1], [w, h * 0.3]);
    curve([w, h * 0.85], [w * 0.5, h], [0, h]);
    curve([-w * 0.5, h], [-w, h * 0.85], [-w, h * 0.3]);
    curve([-w, h * 0.1], [-w * 0.8, -h], [0, -h]);
    p = P(0, -h); c.moveTo(p[0], p[1]);
    return;
  }
  // A bat seen from the front: wings raised to points, scalloped below, and ears.
  const s = r * 1.7;
  const pts = [
    [0, -0.5], [0.25, -0.45], [0.45, -0.2], [1.2, -0.9], [2.4, -1.3], [2.2, -0.3],
    [1.7, 0.1], [1.35, -0.15], [1.0, 0.35], [0.7, 0.1], [0.4, 0.6], [0, 0.8],
  ];
  let p = P(pts[0][0] * s, pts[0][1] * s); c.moveTo(p[0], p[1]);
  for (let i = 1; i < pts.length; i++) { p = P(pts[i][0] * s, pts[i][1] * s); c.lineTo(p[0], p[1]); }
  for (let i = pts.length - 2; i >= 0; i--) { p = P(-pts[i][0] * s, pts[i][1] * s); c.lineTo(p[0], p[1]); }
  c.closePath();
  // Ears.
  p = P(-0.3 * s, -0.6 * s); c.moveTo(p[0], p[1]);
  p = P(-0.4 * s, -1.25 * s); c.lineTo(p[0], p[1]);
  p = P(0, -0.7 * s); c.lineTo(p[0], p[1]);
  p = P(0.4 * s, -1.25 * s); c.lineTo(p[0], p[1]);
  p = P(0.3 * s, -0.6 * s); c.lineTo(p[0], p[1]);
  c.closePath();
}

/** How a particle of `shape` is turned at burst progress k (0 to 1).
 *  `seed` is the particle's own random number. Bats rock as they fly, so
 *  they stay upright; snowflakes spin slowly; eggs tumble. */
export function particleTurn(shape: ParticleShape, seed: number, k: number): number {
  if (shape === 'bat') return Math.sin(k * 22 + seed * 6.283) * 0.35;
  if (shape === 'snow') return seed * 1.05 + k * (seed - 0.5) * 3;
  if (shape === 'egg') return (seed - 0.5) * 1.2 + k * (seed - 0.5) * 5;
  return 0;
}
