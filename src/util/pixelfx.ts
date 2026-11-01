/**
 * Plays a PixelFX effect (src/vendor/pixelfx, Ames 2026-11-01) on its own small
 * see-through canvas, chunky pixels and all. It never catches the mouse and
 * takes itself away when it ends. With Calm screen or reduced motion nothing
 * plays and the caller gets null, so it can show its still version instead.
 */
import { clearFrame, composite, createFrame, createFx, type FxModule } from '../vendor/pixelfx/pyr.js';

export interface PlayFxOptions {
  /** Where the effect goes: inside host, or on the page without one. */
  x: number;
  y: number;
  /** Which pixel of the effect lands on x, y, counted from its origin. */
  anchorX?: number;
  anchorY?: number;
  /** Screen pixels per effect pixel. */
  scale?: number;
  /** An element that is positioned. It goes behind what is already in there. */
  host?: HTMLElement;
  /** Leaves out what the effect draws behind or in front, like a floor shadow. */
  layer?: 'back' | 'front';
  /** Seconds to wait before it starts. */
  delay?: number;
  /** Seconds until a looping effect fades out. Without it, call stop(). */
  lasts?: number;
  /** The effect's own options: palette, seed. */
  options?: Record<string, unknown>;
}

export function fxMotionOk(): boolean {
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** A dark to bright ramp through one colour, for an effect's palette. */
export function fxRamp(hex: string, steps = 8): string[] {
  const n = parseInt(hex.slice(1), 16), rgb = [n >> 16, (n >> 8) & 255, n & 255];
  const mid = Math.floor(steps / 2);
  return Array.from({ length: steps }, (_, i) => {
    const part = i <= mid ? rgb.map(v => v * (0.15 + 0.85 * i / mid)) : rgb.map(v => v + (255 - v) * (i - mid) / (steps - 1 - mid));
    return '#' + part.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  });
}

export function playFx(mod: FxModule, o: PlayFxOptions): { stop(): void } | null {
  if (!fxMotionOk()) return null;
  const [w, h] = mod.meta.size, [ox, oy] = mod.meta.origin, S = o.scale ?? 2;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  cv.width = w;
  cv.height = h;
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = `position:${o.host ? 'absolute' : 'fixed'};left:${o.x - (ox + (o.anchorX ?? 0)) * S}px;top:${o.y - (oy + (o.anchorY ?? 0)) * S}px;` +
    `width:${w * S}px;height:${h * S}px;image-rendering:pixelated;pointer-events:none;${o.host ? '' : 'z-index:9400;'}`;
  const frame = createFrame(w, h);
  const img = new ImageData(w, h);
  const fx = createFx(mod, { ...o.options, x: ox, y: oy });
  let raf = 0, last = 0, lived = 0, wait = o.delay ?? 0, placed = false;
  const end = () => { cancelAnimationFrame(raf); cv.remove(); };
  const tick = (now: number) => {
    const dt = last ? Math.min(1 / 15, (now - last) / 1000) : 0;
    last = now;
    if (wait > 0) { wait -= dt; raf = requestAnimationFrame(tick); return; }
    if (!placed) {
      placed = true;
      if (o.host) o.host.prepend(cv); else document.body.appendChild(cv);
    } else if (!cv.isConnected) { end(); return; }
    fx.update(dt);
    if (o.lasts != null && (lived += dt) >= o.lasts) fx.stop();
    if (fx.done()) { end(); return; }
    clearFrame(frame);
    fx.draw(frame, o.layer);
    composite(frame, img.data, null);
    ctx.putImageData(img, 0, 0);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { stop: () => fx.stop() };
}
