/**
 * EyeWire II: your annotation point size is remembered.
 *
 * The Size slider on an annotation layer used to be kept only for layers of
 * the same name, and only when the Cell Library opened a cell, so a new
 * layer or a new workspace started small again (Celia D 2026-10-12: "I can't
 * find a place to change the size of my annotation points that works
 * universally"; Ames: "shouldn't it just save your slider?"). Now moving the
 * slider saves it twice, in this browser: for that layer's name, and as the
 * size every layer without one of its own starts at.
 *
 * Order when a layer opens: the size written in the view itself, else the
 * size last set on a layer of that name, else the size last set anywhere,
 * else 1.
 */
const BY_NAME_KEY = 'nge-annotation-point-sizes';   // shared with src/util/keep_display.ts
const DEFAULT_KEY = 'nge-annotation-point-size-default';

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0.25 && v <= 20;

function byName(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(BY_NAME_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

/** The size last set on any slider, or 1 if none ever was. */
export function ngeDefaultPointSize(): number {
  try { const v = Number(localStorage.getItem(DEFAULT_KEY)); return ok(v) ? v : 1; } catch { return 1; }
}

/** The size a layer with no size of its own in the view should open at. */
export function ngePointSizeFor(layerName: string|undefined): number {
  const named = layerName ? byName()[layerName] : undefined;
  return ok(named) ? named : ngeDefaultPointSize();
}

/** The player moved a Size slider: remember it for this name and for new layers. */
export function ngeRememberPointSize(layerName: string|undefined, size: number) {
  if (!ok(size)) return;
  try {
    localStorage.setItem(DEFAULT_KEY, String(size));
    if (layerName) {
      const all = byName();
      delete all[layerName];
      all[layerName] = size;   // newest last
      const names = Object.keys(all);
      for (const name of names.slice(0, Math.max(0, names.length - 80))) delete all[name];
      localStorage.setItem(BY_NAME_KEY, JSON.stringify(all));
    }
  } catch { /* private window: it lasts for this visit only */ }
}
