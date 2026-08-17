/**
 * holo_trace.ts — the scifi-ui "particle trace": an arc of light runs the
 * panel boundary once, then breaks into particles that decay along a small
 * branching tree. Ported verbatim from scifi-ui hologram.js section 1
 * (PAD 26, 64 particles, 1500ms, sweep ends at 60 percent, two stroke
 * passes so the beam has a soft glow under a 1px core). One-shot by the
 * kit's own rule: it plays when a panel arrives, and never loops.
 *
 * runPanelTrace(host) appends its own canvas around the host (26px
 * overhang), runs once, and removes the canvas when done. The host needs
 * position: relative (or any positioned ancestor role) and visible size.
 */

// a point at fraction t around a rounded rectangle (shared by the trace
// and the zip; t=0 starts on the top edge just past the top-left corner,
// increasing t runs clockwise: top → right → bottom (right-to-left) → left)
function ringPoint(t: number, rw: number, rh: number, r: number): [number, number] {
  const sw = rw - 2 * r, sh = rh - 2 * r;
  const arc = Math.PI * r / 2, per = 2 * sw + 2 * sh + 4 * arc;
  let d = (((t % 1) + 1) % 1) * per;
  if (d < sw) return [r + d, 0];
  d -= sw;
  if (d < arc) { const a = d / arc * 1.5708; return [rw - r + r * Math.sin(a), r - r * Math.cos(a)]; }
  d -= arc;
  if (d < sh) return [rw, r + d];
  d -= sh;
  if (d < arc) { const b = d / arc * 1.5708; return [rw - r + r * Math.cos(b), rh - r + r * Math.sin(b)]; }
  d -= arc;
  if (d < sw) return [rw - r - d, rh];
  d -= sw;
  if (d < arc) { const c = d / arc * 1.5708; return [r - r * Math.sin(c), rh - r + r * Math.cos(c)]; }
  d -= arc;
  if (d < sh) return [0, rh - r - d];
  d -= sh;
  const e = d / arc * 1.5708;
  return [r - r * Math.cos(e), r - r * Math.sin(e)];
}

/** Fraction of the ring perimeter at which the bottom-center sits. */
function ringBottomCenterT(rw: number, rh: number, r: number): number {
  const sw = rw - 2 * r, sh = rh - 2 * r;
  const arc = Math.PI * r / 2, per = 2 * sw + 2 * sh + 4 * arc;
  return (sw + 2 * arc + sh + sw / 2) / per;
}
/** Fraction of the ring perimeter at which the top-center sits. */
function ringTopCenterT(rw: number, rh: number, r: number): number {
  const sw = rw - 2 * r, sh = rh - 2 * r;
  const arc = Math.PI * r / 2, per = 2 * sw + 2 * sh + 4 * arc;
  return (sw / 2) / per;
}

export function runPanelTrace(host: HTMLElement, PAD = 0): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  // scifi-ui uses PAD 26 for overhang; panels with overflow hidden pass 0
  // so the beam runs the inner boundary instead of being clipped.
  const N = 64, DUR = 1500, R = 15;

  const cv = document.createElement('canvas');
  cv.style.cssText = `position:absolute;inset:${-PAD}px;width:calc(100% + ${PAD * 2}px);height:calc(100% + ${PAD * 2}px);pointer-events:none;z-index:50;`;
  cv.setAttribute('aria-hidden', 'true');
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width + PAD * 2, h = rect.height + PAD * 2;
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ring = ringPoint;

  // a small branching tree, for the decay to run along
  type Seg = [number, number, number, number, number];
  function branches(x: number, y: number, ang: number): Seg[] {
    const segs: Seg[] = [];
    (function grow(px: number, py: number, a: number, len: number, depth: number) {
      const nx = px + Math.cos(a) * len, ny = py + Math.sin(a) * len;
      segs.push([px, py, nx, ny, depth]);
      if (depth >= 4) return;
      const spread = 0.36 + Math.random() * 0.34;
      grow(nx, ny, a - spread, len * 0.62, depth + 1);
      grow(nx, ny, a + spread, len * 0.62, depth + 1);
    })(x, y, ang, 13, 0);
    return segs;
  }

  const startT = 0;
  const s0 = ring(0, w - 2, h - 2, R);
  const P = Array.from({ length: N }, () => {
    const a = Math.random() * 6.283, rad = 20 + Math.random() * 60;
    return {
      x: s0[0] + 1 + Math.cos(a) * rad, y: s0[1] + 1 + Math.sin(a) * rad,
      r: 0.8 + Math.random() * 1.2,
      seg: 0, u: Math.random(), sp: 0.6 + Math.random() * 0.9,
    };
  });
  let tree: Seg[] | null = null;
  let raf = 0;
  const t0 = performance.now();

  function stop() {
    cancelAnimationFrame(raf);
    cv.remove();
  }

  function draw(now: number) {
    const k = (now - t0) / DUR;
    if (k >= 1) { stop(); return; }

    ctx!.globalCompositeOperation = 'destination-out';
    ctx!.fillStyle = 'rgba(0,0,0,0.22)';
    ctx!.fillRect(0, 0, w, h);
    ctx!.globalCompositeOperation = 'lighter';

    const SWEEP_END = 0.60;

    if (k < SWEEP_END) {
      const q = k / SWEEP_END;
      const head = q * q * (3 - 2 * q), TAIL = 0.11, SEG = 44;
      ctx!.lineCap = 'round';
      ctx!.lineJoin = 'round';
      // Persistent trail: the boundary stays faintly lit behind the head so
      // the sweep completes a visible FULL circle (Amy), instead of a comet
      // that fizzles at 60 percent of the lap.
      ctx!.globalCompositeOperation = 'source-over';
      ctx!.lineWidth = 1.0;
      ctx!.strokeStyle = 'rgba(150,200,240,0.28)';
      ctx!.beginPath();
      const TSEG = Math.max(8, Math.ceil(60 * head));
      for (let j = 0; j <= TSEG; j++) {
        const p = ring(startT + (j / TSEG) * head, w - 2, h - 2, R);
        if (j === 0) ctx!.moveTo(p[0] + 1, p[1] + 1); else ctx!.lineTo(p[0] + 1, p[1] + 1);
      }
      ctx!.stroke();
      for (let pass = 0; pass < 2; pass++) {
        ctx!.lineWidth = pass ? 1.0 : 4.0;
        for (let j = 0; j < SEG; j++) {
          const f1 = j / SEG, f2 = (j + 1) / SEG;
          const t1 = head - f1 * TAIL, t2 = head - f2 * TAIL;
          if (t2 < 0) break;
          const a1 = ring(startT + t1, w - 2, h - 2, R);
          const a2 = ring(startT + t2, w - 2, h - 2, R);
          const fade = (1 - f1) * (1 - f1);
          ctx!.beginPath();
          ctx!.moveTo(a1[0] + 1, a1[1] + 1);
          ctx!.lineTo(a2[0] + 1, a2[1] + 1);
          ctx!.globalCompositeOperation = pass ? 'source-over' : 'lighter';
          ctx!.strokeStyle = pass
            ? `rgba(178,216,248,${(fade * 0.46).toFixed(3)})`
            : `rgba(74,150,224,${(fade * 0.07).toFixed(3)})`;
          ctx!.stroke();
        }
      }
    } else {
      if (!tree) {
        const e0 = ring(startT + 1, w - 2, h - 2, R);
        const out = Math.atan2(e0[1] + 1 - h / 2, e0[0] + 1 - w / 2);
        tree = [];
        for (let b0 = 0; b0 < 3; b0++) {
          tree = tree.concat(branches(e0[0] + 1, e0[1] + 1,
            out + (b0 - 1) * 0.75 + (Math.random() - 0.5) * 0.3));
        }
        for (const m of P) {
          m.seg = (Math.random() * tree.length) | 0;
          m.u = Math.random() * 0.3;
        }
      }
      const d3 = (k - SWEEP_END) / (1 - SWEEP_END);
      for (const q2 of P) {
        const sg = tree[q2.seg];
        q2.u = Math.min(1, q2.u + 0.028 * q2.sp);
        const x = sg[0] + (sg[2] - sg[0]) * q2.u;
        const y = sg[1] + (sg[3] - sg[1]) * q2.u;
        const al = (1 - d3) * (1 - d3) * (0.34 - sg[4] * 0.06);
        ctx!.beginPath();
        ctx!.arc(x, y, 0.95 - sg[4] * 0.15, 0, 6.283);
        ctx!.fillStyle = `rgba(140,198,244,${Math.max(0, al).toFixed(3)})`;
        ctx!.fill();
      }
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
}

/**
 * The zip: two beams that split from one edge midpoint and race along both
 * sides to meet at the opposite midpoint, closing with a small spark.
 * direction 'up' starts at bottom-center and meets at top-center (the tag
 * panel collapsing to its slim strip); 'down' is the reverse, for expand.
 */
export function runPanelZip(host: HTMLElement, direction: 'up' | 'down' = 'up'): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const DUR = 700, R = 10;

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:50;';
  cv.setAttribute('aria-hidden', 'true');
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width, h = rect.height;
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rw = w - 2, rh = h - 2;
  const tBottom = ringBottomCenterT(rw, rh, R);
  const tTop = ringTopCenterT(rw, rh, R);
  const start = direction === 'up' ? tBottom : tTop;
  const end = direction === 'up' ? tTop : tBottom;
  // Beam A runs forward (increasing t, wraps), beam B runs backward; both
  // cover their half of the perimeter and land on `end` together.
  const distA = ((end - start) % 1 + 1) % 1;
  const distB = 1 - distA;
  const [mx, my] = ringPoint(end, rw, rh, R);

  let raf = 0;
  const t0 = performance.now();
  function head(tt: number): [number, number] {
    const p = ringPoint(tt, rw, rh, R);
    return [p[0] + 1, p[1] + 1];
  }
  function draw(now: number) {
    const k = (now - t0) / DUR;
    if (k >= 1) { cancelAnimationFrame(raf); cv.remove(); return; }
    ctx!.clearRect(0, 0, w, h);
    ctx!.lineCap = 'round';

    const RUN = 0.82;                       // beams run, then the spark
    if (k < RUN) {
      const q = k / RUN, eased = q * q * (3 - 2 * q);
      const TAIL = 0.16, SEG = 26;
      for (const [dir, dist] of [[1, distA], [-1, distB]] as [number, number][]) {
        for (let pass = 0; pass < 2; pass++) {
          ctx!.lineWidth = pass ? 1.1 : 4.0;
          for (let j = 0; j < SEG; j++) {
            const f1 = j / SEG, f2 = (j + 1) / SEG;
            const p1 = eased - f1 * TAIL, p2 = eased - f2 * TAIL;
            if (p2 < 0) break;
            const a1 = head(start + dir * p1 * dist);
            const a2 = head(start + dir * p2 * dist);
            const fade = (1 - f1) * (1 - f1);
            ctx!.beginPath();
            ctx!.moveTo(a1[0], a1[1]);
            ctx!.lineTo(a2[0], a2[1]);
            ctx!.globalCompositeOperation = pass ? 'source-over' : 'lighter';
            ctx!.strokeStyle = pass
              ? `rgba(178,216,248,${(fade * 0.5).toFixed(3)})`
              : `rgba(53,181,255,${(fade * 0.09).toFixed(3)})`;
            ctx!.stroke();
          }
        }
      }
    } else {
      // The meeting spark: a brief flash where the beams kissed.
      const s = (k - RUN) / (1 - RUN);
      const al = (1 - s) * (1 - s);
      ctx!.globalCompositeOperation = 'lighter';
      const g = ctx!.createRadialGradient(mx + 1, my + 1, 0, mx + 1, my + 1, 16 * (0.4 + s));
      g.addColorStop(0, `rgba(220,240,255,${(al * 0.7).toFixed(3)})`);
      g.addColorStop(1, 'rgba(53,181,255,0)');
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
}

/**
 * The draw: like the zip, but the beams leave the outline LIT behind them,
 * so the light literally draws the box into existence. Two heads split from
 * an edge midpoint, trace both halves of the boundary, and the finished
 * frame holds for a beat then fades (handing off to the panel's real
 * border). Returns the total ms until the canvas is gone, so callers can
 * choreograph content fade-in against it.
 */
export function runPanelDraw(
    host: HTMLElement, direction: 'up' | 'down' = 'down',
    onProgress?: (frac: number) => void): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return 0;
  const DUR = 620, HOLD = 120, FADE = 260, R = 10;

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:50;' +
    `transition:opacity ${FADE}ms ease;`;
  cv.setAttribute('aria-hidden', 'true');
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return 0; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width, h = rect.height;
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rw = w - 2, rh = h - 2;
  const tBottom = ringBottomCenterT(rw, rh, R);
  const tTop = ringTopCenterT(rw, rh, R);
  const start = direction === 'down' ? tTop : tBottom;
  const end = direction === 'down' ? tBottom : tTop;
  const distA = ((end - start) % 1 + 1) % 1;
  const distB = 1 - distA;

  function pt(tt: number): [number, number] {
    const p = ringPoint(tt, rw, rh, R);
    return [p[0] + 1, p[1] + 1];
  }

  let raf = 0;
  const t0 = performance.now();
  function draw(now: number) {
    const k = Math.min(1, (now - t0) / DUR);
    ctx!.clearRect(0, 0, w, h);
    ctx!.lineCap = 'round';
    ctx!.lineJoin = 'round';
    const eased = k * k * (3 - 2 * k);

    // Report how far down (or up) the heads have travelled, so the caller
    // can use the beam as a reveal mask over the panel content.
    if (onProgress) {
      const hp0 = pt(start + eased * distA);
      const frac = direction === 'down' ? hp0[1] / h : 1 - hp0[1] / h;
      onProgress(k >= 1 ? 1 : Math.max(0, Math.min(1, frac)));
    }

    for (const [dir, dist] of [[1, distA], [-1, distB]] as [number, number][]) {
      const SEG = Math.max(8, Math.ceil(60 * dist));
      // The lit trail, start to head, two passes: soft glow then core.
      for (let pass = 0; pass < 2; pass++) {
        ctx!.lineWidth = pass ? 1.1 : 3.4;
        ctx!.globalCompositeOperation = pass ? 'source-over' : 'lighter';
        ctx!.strokeStyle = pass ? 'rgba(178,216,248,0.6)' : 'rgba(53,181,255,0.09)';
        ctx!.beginPath();
        const steps = Math.ceil(SEG * eased);
        for (let j = 0; j <= steps; j++) {
          const p = pt(start + dir * Math.min(eased, j / SEG) * dist);
          if (j === 0) ctx!.moveTo(p[0], p[1]); else ctx!.lineTo(p[0], p[1]);
        }
        ctx!.stroke();
      }
      // Bright head while still drawing.
      if (k < 1) {
        const hp = pt(start + dir * eased * dist);
        const g = ctx!.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], 7);
        g.addColorStop(0, 'rgba(230,245,255,0.9)');
        g.addColorStop(1, 'rgba(53,181,255,0)');
        ctx!.globalCompositeOperation = 'lighter';
        ctx!.fillStyle = g;
        ctx!.fillRect(hp[0] - 8, hp[1] - 8, 16, 16);
      }
    }

    if (k < 1) { raf = requestAnimationFrame(draw); return; }
    // Outline complete: hold, then fade the canvas away.
    setTimeout(() => {
      cv.style.opacity = '0';
      setTimeout(() => cv.remove(), FADE + 40);
    }, HOLD);
  }
  raf = requestAnimationFrame(draw);
  void raf;
  return DUR + HOLD + FADE;
}

/**
 * A one-shot radial particle burst with light streaks, same additive-glow
 * family as the panel trace. Fired at a screen point (e.g. the tag panel on
 * submit). Sky blue by default; pass "r,g,b" to recolor.
 */
export function runParticleBurst(cx: number, cy: number, rgb = '53,181,255'): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const SIZE = 280, HALF = SIZE / 2, DUR = 750;

  const cv = document.createElement('canvas');
  cv.style.cssText = `position:fixed;left:${cx - HALF}px;top:${cy - HALF}px;` +
    `width:${SIZE}px;height:${SIZE}px;pointer-events:none;z-index:100000;`;
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = SIZE * dpr; cv.height = SIZE * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const parts = Array.from({ length: 30 }, () => {
    const a = Math.random() * 6.283;
    return {
      a,
      sp: 46 + Math.random() * 92,          // px travelled over the burst
      r: 0.8 + Math.random() * 1.6,
      drag: 0.5 + Math.random() * 0.5,      // eases the tail of the flight
    };
  });
  const streaks = Array.from({ length: 9 }, () => ({
    a: Math.random() * 6.283,
    len: 60 + Math.random() * 70,
  }));

  let raf = 0;
  const t0 = performance.now();
  function draw(now: number) {
    const k = (now - t0) / DUR;
    if (k >= 1) { cancelAnimationFrame(raf); cv.remove(); return; }
    ctx!.clearRect(0, 0, SIZE, SIZE);
    ctx!.globalCompositeOperation = 'lighter';

    // Streaks: fast radial lines that live in the first third.
    if (k < 0.34) {
      const q = k / 0.34, head = q * q * (3 - 2 * q);
      ctx!.lineCap = 'round';
      for (const s of streaks) {
        const r1 = 6 + head * s.len, r2 = 6 + head * s.len * 0.55;
        ctx!.beginPath();
        ctx!.moveTo(HALF + Math.cos(s.a) * r2, HALF + Math.sin(s.a) * r2);
        ctx!.lineTo(HALF + Math.cos(s.a) * r1, HALF + Math.sin(s.a) * r1);
        ctx!.lineWidth = 1.4;
        ctx!.strokeStyle = `rgba(${rgb},${((1 - q) * 0.55).toFixed(3)})`;
        ctx!.stroke();
      }
      // hot core flash
      const core = ctx!.createRadialGradient(HALF, HALF, 0, HALF, HALF, 26 * (1 - q) + 4);
      core.addColorStop(0, `rgba(220,240,255,${(0.5 * (1 - q)).toFixed(3)})`);
      core.addColorStop(1, `rgba(${rgb},0)`);
      ctx!.fillStyle = core;
      ctx!.fillRect(0, 0, SIZE, SIZE);
    }

    // Particles: fly out with ease-out, fade with (1-k)^2.
    for (const p of parts) {
      const eo = 1 - Math.pow(1 - k, 1.6 + p.drag);
      const x = HALF + Math.cos(p.a) * p.sp * eo;
      const y = HALF + Math.sin(p.a) * p.sp * eo;
      const al = (1 - k) * (1 - k) * 0.8;
      ctx!.beginPath();
      ctx!.arc(x, y, p.r * (1 - k * 0.5), 0, 6.283);
      ctx!.fillStyle = `rgba(${rgb},${al.toFixed(3)})`;
      ctx!.fill();
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
}

/**
 * The roundabout: one bright head takes a fast full lap of the panel
 * boundary, leaving the ring lit, then the light fades. Used as the
 * send-off when the success box hands back to the form.
 */
export function runPanelLap(host: HTMLElement, DUR = 520): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return 0;
  const R = 12, FADE = 200;
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:50;';
  cv.setAttribute('aria-hidden', 'true');
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return 0; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width, h = rect.height;
  cv.width = w * dpr; cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rw = w - 2, rh = h - 2;
  const start = ringTopCenterT(rw, rh, R);
  let raf = 0;
  const t0 = performance.now();
  function draw(now: number) {
    const t = now - t0;
    if (t >= DUR + FADE) { cancelAnimationFrame(raf); cv.remove(); return; }
    ctx!.clearRect(0, 0, w, h);
    const q = Math.min(1, t / DUR), eased = q * q * (3 - 2 * q);
    const fade = t > DUR ? 1 - (t - DUR) / FADE : 1;
    ctx!.lineCap = 'round'; ctx!.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx!.lineWidth = pass ? 1.2 : 4.2;
      ctx!.globalCompositeOperation = pass ? 'source-over' : 'lighter';
      ctx!.strokeStyle = pass
        ? `rgba(220,240,255,${(0.65 * fade).toFixed(3)})`
        : `rgba(53,181,255,${(0.1 * fade).toFixed(3)})`;
      ctx!.beginPath();
      const SEG = Math.max(12, Math.ceil(64 * eased));
      for (let j = 0; j <= SEG; j++) {
        const p = ringPoint(start + (j / SEG) * eased, rw, rh, R);
        if (j === 0) ctx!.moveTo(p[0] + 1, p[1] + 1); else ctx!.lineTo(p[0] + 1, p[1] + 1);
      }
      ctx!.stroke();
    }
    // the racing head
    if (q < 1) {
      const hp = ringPoint(start + eased, rw, rh, R);
      const g = ctx!.createRadialGradient(hp[0] + 1, hp[1] + 1, 0, hp[0] + 1, hp[1] + 1, 8);
      g.addColorStop(0, 'rgba(235,247,255,0.95)');
      g.addColorStop(1, 'rgba(53,181,255,0)');
      ctx!.globalCompositeOperation = 'lighter';
      ctx!.fillStyle = g;
      ctx!.fillRect(hp[0] - 8, hp[1] - 8, 18, 18);
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return DUR + FADE;
}

/**
 * The build: two smooth particle streams flow from an origin to the top and
 * bottom midpoints of the panel, gather there as glowing charge, then the
 * border lights from both points at once (heads racing along both sides)
 * while the caller fades the real box in. Ordered and fluid where the old
 * coalesce was sporadic (Amy: particles "should flow more smoothly and
 * build the box, coalesce at two points, then trigger the light sequence").
 * onPhase fires 'beams' when the border starts drawing and 'done' at the
 * end. Returns total ms.
 */
export function runBurstBuild(
    ox: number, oy: number, getRect: () => DOMRect | null, rgb = '53,181,255',
    onPhase?: (phase: 'beams' | 'done') => void): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    onPhase?.('beams'); onPhase?.('done');
    return 0;
  }
  const STREAM = 750, GATHER = 180, BEAMS = 700, FADE = 220;
  const TOTAL = STREAM + GATHER + BEAMS + FADE;
  const R = 15;

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100000;';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); onPhase?.('beams'); onPhase?.('done'); return 0; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  cv.width = vw * dpr; cv.height = vh * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const N = 56;
  const parts = Array.from({ length: N }, (_, i) => ({
    toTop: i % 2 === 0,
    delay: (i / N) * 0.5,          // staggered departure = a stream, not a bang
    side: ((i >> 1) % 2 ? 1 : -1) * (4 + ((i * 7) % 12)),  // parallel lane offset
    r: 1.2 + ((i * 13) % 10) / 7,
  }));

  let beamsFired = false, doneFired = false;
  let raf = 0;
  const t0 = performance.now();

  function targets(rect: DOMRect): [[number, number], [number, number]] {
    return [[rect.left + rect.width / 2, rect.top + 1],
            [rect.left + rect.width / 2, rect.top + rect.height - 1]];
  }

  function draw(now: number) {
    const t = now - t0;
    if (t >= TOTAL) {
      if (!doneFired) { doneFired = true; onPhase?.('done'); }
      cancelAnimationFrame(raf); cv.remove(); return;
    }
    ctx!.clearRect(0, 0, vw, vh);
    ctx!.globalCompositeOperation = 'lighter';
    const rect = getRect();
    if (!rect) { raf = requestAnimationFrame(draw); return; }
    const [top, bot] = targets(rect);

    // ── Streams: each particle flies origin → its midpoint along a bezier,
    // in staggered lanes, easing in and out. Arrivals feed the charge.
    let charge = 0;
    const streamEnd = STREAM + GATHER;
    for (const p of parts) {
      const dur = STREAM * 0.55;
      const start = p.delay * (STREAM - dur);
      const lt = (t - start) / dur;
      if (lt <= 0) continue;
      const dst = p.toTop ? top : bot;
      if (lt >= 1) { charge += 1; continue; }
      const e = lt < 0.5 ? 2 * lt * lt : 1 - Math.pow(-2 * lt + 2, 2) / 2;
      // control point: sideways bow for a ribbon-like path
      const mx = (ox + dst[0]) / 2 + p.side * 3, my = (oy + dst[1]) / 2 + p.side;
      const x = (1 - e) * (1 - e) * ox + 2 * (1 - e) * e * mx + e * e * dst[0] + p.side * Math.sin(e * Math.PI);
      const y = (1 - e) * (1 - e) * oy + 2 * (1 - e) * e * my + e * e * dst[1];
      ctx!.beginPath();
      ctx!.arc(x, y, p.r, 0, 6.283);
      ctx!.fillStyle = `rgba(${rgb},${(0.75 * Math.min(1, lt * 3)).toFixed(3)})`;
      ctx!.fill();
      // short comet tail along the path
      const eb = Math.max(0, e - 0.06);
      const bx = (1 - eb) * (1 - eb) * ox + 2 * (1 - eb) * eb * mx + eb * eb * dst[0] + p.side * Math.sin(eb * Math.PI);
      const by = (1 - eb) * (1 - eb) * oy + 2 * (1 - eb) * eb * my + eb * eb * dst[1];
      ctx!.strokeStyle = `rgba(${rgb},0.22)`;
      ctx!.lineWidth = p.r * 0.9;
      ctx!.beginPath(); ctx!.moveTo(bx, by); ctx!.lineTo(x, y); ctx!.stroke();
    }

    // ── The two charge points glow with arrivals, then drain into the beams.
    const beamT = (t - streamEnd) / BEAMS;
    const drain = beamT > 0 ? Math.max(0, 1 - beamT * 1.6) : 1;
    const glow = Math.min(1, charge / (N * 0.45)) * drain;
    for (const pt of [top, bot]) {
      const g = ctx!.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], 14 + glow * 10);
      g.addColorStop(0, `rgba(235,246,255,${(0.85 * glow).toFixed(3)})`);
      g.addColorStop(0.4, `rgba(${rgb},${(0.5 * glow).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx!.fillStyle = g;
      ctx!.fillRect(pt[0] - 30, pt[1] - 30, 60, 60);
    }

    // ── Beams: from both charge points, heads race along both sides at
    // once, leaving the frame lit behind them, the light builds the box.
    if (beamT > 0) {
      if (!beamsFired) { beamsFired = true; onPhase?.('beams'); }
      const rw = rect.width - 2, rh = rect.height - 2;
      const tTop = ringTopCenterT(rw, rh, R), tBot = ringBottomCenterT(rw, rh, R);
      const q = Math.min(1, beamT), eased = q * q * (3 - 2 * q);
      const fade = t > streamEnd + BEAMS ? 1 - (t - streamEnd - BEAMS) / FADE : 1;
      ctx!.lineCap = 'round'; ctx!.lineJoin = 'round';
      const runs: [number, number, number][] = [
        [tTop, 1, ((tBot - tTop) % 1 + 1) % 1],
        [tTop, -1, 1 - (((tBot - tTop) % 1 + 1) % 1)],
      ];
      for (const [startT, dir, dist] of runs) {
        for (let pass = 0; pass < 2; pass++) {
          ctx!.lineWidth = pass ? 1.2 : 4;
          ctx!.globalCompositeOperation = pass ? 'source-over' : 'lighter';
          ctx!.strokeStyle = pass
            ? `rgba(216,238,255,${(0.62 * fade).toFixed(3)})`
            : `rgba(${rgb},${(0.1 * fade).toFixed(3)})`;
          ctx!.beginPath();
          const SEG = Math.max(10, Math.ceil(56 * dist));
          const steps = Math.ceil(SEG * eased);
          for (let j = 0; j <= steps; j++) {
            const p = ringPoint(startT + dir * Math.min(eased, j / SEG) * dist, rw, rh, R);
            const px = rect.left + p[0] + 1, py = rect.top + p[1] + 1;
            if (j === 0) ctx!.moveTo(px, py); else ctx!.lineTo(px, py);
          }
          ctx!.stroke();
        }
      }
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return TOTAL;
}

/**
 * Burst-then-coalesce: a big particle burst that arcs back and lands along
 * the border ring of a panel, lighting the frame as it assembles. The rect
 * is re-read every frame via getRect so the particles chase the box that
 * appears mid-flight (form box out, success box in). Returns total ms so
 * the caller can unveil the real border at the handoff.
 */
export function runBurstCoalesce(cx: number, cy: number, getRect: () => DOMRect | null, rgb = '53,181,255'): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const DUR = 1450, R = 15, N = 64;
  const BURST_END = 0.30, LAND_END = 0.86;

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100000;';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return 0; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  cv.width = vw * dpr; cv.height = vh * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const parts = Array.from({ length: N }, (_, i) => {
    const a = Math.random() * 6.283;
    return {
      a,
      reach: 70 + Math.random() * 130,       // how far the burst throws it
      r: 0.9 + Math.random() * 1.7,
      ringT: (i + Math.random() * 0.6) / N,  // its seat on the border ring
      wob: (Math.random() - 0.5) * 46,       // sideways arc on the way home
      drag: 1.4 + Math.random(),
      // Personal landing time (as k), so the swarm seats in a stagger
      // rather than as one synchronized thud.
      landK: BURST_END + (LAND_END - BURST_END) * (0.5 + 0.5 * Math.random()),
    };
  });

  // Amy's spec: the frame must NOT brighten as individual particles land.
  // Arrivals accumulate silently; once LIT_FRACTION of the swarm has seated,
  // the charge releases as one light impulse sweeping the ring, and the real
  // border takes over as it fades.
  const LIT_FRACTION = 0.6;
  let pulseAtK: number | null = null;

  let raf = 0;
  const t0 = performance.now();
  function draw(now: number) {
    const k = (now - t0) / DUR;
    if (k >= 1) { cancelAnimationFrame(raf); cv.remove(); return; }
    ctx!.clearRect(0, 0, vw, vh);
    ctx!.globalCompositeOperation = 'lighter';

    const rect = getRect();
    const rw = rect ? rect.width - 2 : 0, rh = rect ? rect.height - 2 : 0;

    for (const p of parts) {
      // Where the burst threw it (eases out early, then holds).
      const bq = Math.min(1, k / BURST_END);
      const bEase = 1 - Math.pow(1 - bq, p.drag);
      const bx = cx + Math.cos(p.a) * p.reach * bEase;
      const by = cy + Math.sin(p.a) * p.reach * bEase;

      let x = bx, y = by, al = 0.8 * (1 - k * 0.25);
      if (k > BURST_END && rect) {
        // Coalesce: arc from the burst apex to its seat on the ring, each
        // particle on its own personal schedule.
        const cq = Math.min(1, (k - BURST_END) / (p.landK - BURST_END));
        const cEase = cq * cq * (3 - 2 * cq);
        const seat = ringPoint(p.ringT, rw, rh, R);
        const sx = rect.left + seat[0] + 1, sy = rect.top + seat[1] + 1;
        const arc = Math.sin(cEase * Math.PI) * p.wob;
        const dx = sy - by, dy = -(sx - bx);
        const dl = Math.hypot(dx, dy) || 1;
        x = bx + (sx - bx) * cEase + (dx / dl) * arc;
        y = by + (sy - by) * cEase + (dy / dl) * arc;
        // Seated particles hold their glow (charging the frame); they only
        // dim once the impulse has released and the real border takes over.
        if (pulseAtK !== null) {
          const pEnd = Math.min(pulseAtK + 0.24, 0.97);
          if (k > pEnd) al *= Math.max(0, 1 - (k - pEnd) / (1 - pEnd));
        }
      }
      ctx!.beginPath();
      ctx!.arc(x, y, p.r, 0, 6.283);
      ctx!.fillStyle = `rgba(${rgb},${Math.max(0, al).toFixed(3)})`;
      ctx!.fill();
    }

    // Landing census. The frame stays dark while the swarm seats; enough
    // arrivals trip the impulse (LAND_END is the everyone-is-home backstop).
    if (rect && pulseAtK === null) {
      let landed = 0;
      for (const p of parts) if (k >= p.landK) landed++;
      if (landed / N >= LIT_FRACTION || k >= LAND_END) pulseAtK = k;
    }

    // The impulse: two light heads leave top-center, sweep opposite sides of
    // the ring, and meet at bottom-center, over a ring-wide glow that spikes
    // on release and decays as the real border takes over.
    if (rect && pulseAtK !== null) {
      const pEnd = Math.min(pulseAtK + 0.24, 0.97);
      const q = Math.min(1, (k - pulseAtK) / (pEnd - pulseAtK));
      const qEase = q * q * (3 - 2 * q);
      const topT = ringTopCenterT(rw, rh, R);
      const flash = Math.pow(1 - q, 1.6);
      ctx!.lineCap = 'round';

      // Ring-wide release glow.
      for (let pass = 0; pass < 2; pass++) {
        ctx!.lineWidth = pass ? 1.1 : 5.2;
        ctx!.globalCompositeOperation = pass ? 'source-over' : 'lighter';
        ctx!.strokeStyle = pass
          ? `rgba(198,228,252,${(0.5 * flash).toFixed(3)})`
          : `rgba(${rgb},${(0.16 * flash).toFixed(3)})`;
        ctx!.beginPath();
        const SEG = 72;
        for (let j = 0; j <= SEG; j++) {
          const p = ringPoint(j / SEG, rw, rh, R);
          const px = rect.left + p[0] + 1, py = rect.top + p[1] + 1;
          if (j === 0) ctx!.moveTo(px, py); else ctx!.lineTo(px, py);
        }
        ctx!.stroke();
      }

      // The two traveling heads with comet tails.
      const TAIL = 0.14, TAIL_SEG = 16;
      ctx!.globalCompositeOperation = 'lighter';
      for (const dir of [1, -1]) {
        const headT = topT + dir * 0.5 * qEase;
        for (let s = 0; s < TAIL_SEG; s++) {
          const t0 = headT - dir * (s / TAIL_SEG) * TAIL * qEase;
          const t1 = headT - dir * ((s + 1) / TAIL_SEG) * TAIL * qEase;
          const a0 = ringPoint(t0, rw, rh, R);
          const a1 = ringPoint(t1, rw, rh, R);
          const segAl = 0.85 * (1 - s / TAIL_SEG) * (1 - q * 0.55);
          ctx!.lineWidth = 3.2 * (1 - s / TAIL_SEG) + 0.8;
          ctx!.strokeStyle = s < 2
            ? `rgba(228,244,255,${segAl.toFixed(3)})`
            : `rgba(${rgb},${(segAl * 0.8).toFixed(3)})`;
          ctx!.beginPath();
          ctx!.moveTo(rect.left + a0[0] + 1, rect.top + a0[1] + 1);
          ctx!.lineTo(rect.left + a1[0] + 1, rect.top + a1[1] + 1);
          ctx!.stroke();
        }
      }
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return DUR;
}

/** Once-injected keyframes for effects that outlive a WAAPI handle. */
function ensureHoloCss() {
  if (document.getElementById('nge-holo-anim-css')) return;
  const st = document.createElement('style');
  st.id = 'nge-holo-anim-css';
  st.textContent = `
@keyframes ngeProfileAbsorb {
  0%   { box-shadow: 0 0 0 0 rgba(245, 209, 66, 0.65); }
  100% { box-shadow: 0 0 0 16px rgba(245, 209, 66, 0); }
}
.nge-profile-absorb { animation: ngeProfileAbsorb 0.55s ease-out; border-radius: 50%; }`;
  document.head.appendChild(st);
}

/**
 * A "+1" that arcs to the profile button as a comet: the head flies along a
 * curved path shedding a fading dot trail, and the profile button absorbs
 * the landing with a pulse.
 */
export function flyPlusOne(fromX: number, fromY: number, text = '+1'): void {
  ensureHoloCss();
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:fixed;left:0;top:0;z-index:100000;` +
    `pointer-events:none;font:700 15px 'Orbitron','Inter',sans-serif;color:#f5d142;` +
    `text-shadow:0 0 8px rgba(245,209,66,0.8);will-change:transform;`;
  document.body.appendChild(el);
  const targetEl = document.getElementById('profileBtn');
  const target = targetEl?.getBoundingClientRect();
  const tx = target ? target.left + target.width / 2 : fromX;
  const ty = target ? target.top + target.height / 2 : fromY - 140;
  // Control point above the straight line for a comet-like arc.
  const mx = (fromX + tx) / 2, my = Math.min(fromY, ty) - 90;
  const DUR = 950;
  const t0 = performance.now();
  let lastTrail = 0;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function step(now: number) {
    const k = Math.min(1, (now - t0) / DUR);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
    const x = (1 - e) * (1 - e) * fromX + 2 * (1 - e) * e * mx + e * e * tx;
    const y = (1 - e) * (1 - e) * fromY + 2 * (1 - e) * e * my + e * e * ty;
    const sc = 1 + 0.25 * Math.sin(Math.PI * Math.min(k * 2, 1)) - 0.6 * Math.max(0, k - 0.6) / 0.4;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${Math.max(0.3, sc)})`;
    el.style.opacity = k > 0.85 ? String(1 - (k - 0.85) / 0.15) : '1';
    // Shed a trail dot every ~28ms.
    if (!reduced && now - lastTrail > 28 && k < 0.92) {
      lastTrail = now;
      const d = document.createElement('div');
      const r = 2 + Math.random() * 2.5;
      d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${r}px;height:${r}px;` +
        `border-radius:50%;background:rgba(245,209,66,0.8);box-shadow:0 0 6px rgba(245,209,66,0.6);` +
        `pointer-events:none;z-index:99999;transform:translate(-50%,-50%);`;
      document.body.appendChild(d);
      d.animate([{opacity: 0.9}, {opacity: 0}], {duration: 420, easing: 'ease-out'}).onfinish = () => d.remove();
    }
    if (k < 1) { requestAnimationFrame(step); return; }
    el.remove();
    // The profile button drinks the light.
    if (targetEl) {
      targetEl.classList.remove('nge-profile-absorb');
      void targetEl.offsetWidth; // restart the animation
      targetEl.classList.add('nge-profile-absorb');
      setTimeout(() => targetEl.classList.remove('nge-profile-absorb'), 650);
    }
  }
  requestAnimationFrame(step);
}

/**
 * Grim's signature: a scythe sweeps through at (x, y) with a crescent
 * slash of light. Played when a Cut tag is resolved.
 */
export function runScytheSwing(x: number, y: number, _imgUrl?: string): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // Amy 2026-08-17: the swinging scythe image is retired, the crescent
  // slash streak alone is the effect.
  const S = 150, HALF = S / 2;
  const cv = document.createElement('canvas');
  cv.style.cssText = `position:fixed;left:${x - HALF}px;top:${y - HALF}px;width:${S}px;height:${S}px;` +
    `pointer-events:none;z-index:99999;`;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = S * dpr; cv.height = S * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t0 = performance.now(), DUR = 540;
  const A0 = -Math.PI * 0.78, A1 = Math.PI * 0.28; // matches the swing arc
  function draw(now: number) {
    const k = (now - t0) / DUR;
    if (k >= 1) { cv.remove(); return; }
    ctx!.clearRect(0, 0, S, S);
    const q = Math.min(1, k / 0.72), head = q * q * (3 - 2 * q);
    const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
    ctx!.lineCap = 'round';
    ctx!.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      ctx!.beginPath();
      ctx!.arc(HALF, HALF, 46, A0, A0 + (A1 - A0) * head);
      ctx!.lineWidth = pass ? 1.4 : 5;
      ctx!.strokeStyle = pass
        ? `rgba(220,240,255,${(0.7 * fade).toFixed(3)})`
        : `rgba(53,181,255,${(0.14 * fade).toFixed(3)})`;
      ctx!.stroke();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
