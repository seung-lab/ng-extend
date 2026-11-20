/**
 * The main color of a piece of Achievement art, so the glow behind it can
 * match it (Ames 2026-11-20: "make the glow behind the item match the primary
 * color of the item in all cases. So for example, days helping science should
 * have purple glow"). Before this every glow was the site blue, or gold for
 * edits, whatever the art looked like.
 *
 * The art is drawn small onto a canvas; its bright, colorful pixels are
 * sorted into hue buckets and the heaviest bucket wins. Gray and dark pixels
 * (outlines, shading) do not vote. The answer is "r, g, b", ready for
 * rgba(var(--art), a) in CSS, brightened so a dark piece still glows.
 */
import type { Directive } from 'vue';

const cache = new Map<string, Promise<string | null>>();

function measure(img: HTMLImageElement): string | null {
  const N = 40;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data; // throws on cross-origin art without CORS
  const B = 18;
  const w = new Float64Array(B), r = new Float64Array(B), g = new Float64Array(B), b = new Float64Array(B);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 140) continue;
    const R = px[i] / 255, G = px[i + 1] / 255, Bl = px[i + 2] / 255;
    const max = Math.max(R, G, Bl), min = Math.min(R, G, Bl), d = max - min;
    const s = max === 0 ? 0 : d / max;
    if (s < 0.3 || max < 0.3) continue;
    let h = 0;
    if (max === R) h = ((G - Bl) / d) % 6;
    else if (max === G) h = (Bl - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
    const k = Math.floor(h / (360 / B)) % B;
    const weight = s * s * max;
    w[k] += weight; r[k] += px[i] * weight; g[k] += px[i + 1] * weight; b[k] += px[i + 2] * weight;
  }
  let best = -1;
  for (let k = 0; k < B; k++) {
    // neighbours count a little, so a hue split across two buckets still wins
    const score = w[k] + 0.5 * (w[(k + 1) % B] + w[(k + B - 1) % B]);
    if (best < 0 || score > (w[best] + 0.5 * (w[(best + 1) % B] + w[(best + B - 1) % B]))) best = k;
  }
  if (best < 0 || w[best] < 1) return null;
  let R = r[best] / w[best], G = g[best] / w[best], Bl = b[best] / w[best];
  // lift to full brightness so the glow reads on the dark frame
  const lift = 255 / Math.max(R, G, Bl, 1);
  R = Math.round(Math.min(255, R * lift)); G = Math.round(Math.min(255, G * lift)); Bl = Math.round(Math.min(255, Bl * lift));
  return `${R}, ${G}, ${Bl}`;
}

export function artColor(url: string): Promise<string | null> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => { try { resolve(measure(img)); } catch { resolve(null); } };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

/** Tiles and frames that take the color of the art inside them. */
const HOLDERS = '.nge-profile-badge, .nge-trophy-badge, .nge-trophy-featured, .nge-badge-zoom, .nge-special-modal';

function apply(el: HTMLImageElement) {
  const url = el.currentSrc || el.src;
  if (!url) return;
  (el as any).__ngeArtUrl = url;
  artColor(url).then(rgb => {
    if ((el as any).__ngeArtUrl !== url) return; // the art changed meanwhile
    const holder = (el.closest(HOLDERS) as HTMLElement | null) ?? el;
    for (const t of new Set([el, holder])) {
      if (rgb) t.style.setProperty('--art', rgb); else t.style.removeProperty('--art');
    }
  });
}

/** v-art-glow on an <img>: sets --art on it and on the tile around it. */
export const vArtGlow: Directive<HTMLImageElement> = {
  mounted(el) { apply(el); },
  updated(el) { if ((el as any).__ngeArtUrl !== (el.currentSrc || el.src)) apply(el); },
};
