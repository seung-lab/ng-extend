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

  // a point at fraction t around a rounded rectangle
  function ring(t: number, rw: number, rh: number, r: number): [number, number] {
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

/** A "+1" that floats up from a click and flies to the profile button. */
export function flyPlusOne(fromX: number, fromY: number, text = '+1'): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:fixed;left:${fromX}px;top:${fromY}px;z-index:100000;` +
    `pointer-events:none;font:700 15px 'Orbitron','Inter',sans-serif;color:#f5d142;` +
    `text-shadow:0 0 8px rgba(245,209,66,0.8);transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  const target = document.getElementById('profileBtn')?.getBoundingClientRect();
  const tx = target ? target.left + target.width / 2 - fromX : 0;
  const ty = target ? target.top + target.height / 2 - fromY : -140;
  const anim = el.animate([
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0 },
    { transform: 'translate(-50%, calc(-50% - 46px)) scale(1.25)', opacity: 1, offset: 0.3 },
    { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.4)`, opacity: 0, offset: 1 },
  ], { duration: 950, easing: 'cubic-bezier(0.3, 0, 0.4, 1)' });
  anim.onfinish = () => el.remove();
}
