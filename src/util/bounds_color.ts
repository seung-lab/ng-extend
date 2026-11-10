/**
 * The volume outline (neuroglancer's "Data Bounds" box on the image and cell
 * layers) in a quiet slate blue, lower contrast than the bright blue it was
 * (Ames 2026-11-07: "desaturate the bounding box a little"). Those layers
 * draw no other annotations, so their annotation color is the outline's.
 * Annotation layers keep their own colors.
 */
export const BOUNDS_COLOR = '#3a4864';

const viewerOf = (): any => (window as any).viewer;

function paint() {
  const layers: any[] = viewerOf()?.layerManager?.managedLayers ?? [];
  for (const ml of layers) {
    const layer = ml?.layer;
    const type = (layer?.constructor as any)?.type;
    if (!layer || type === 'annotation') continue;
    const color = layer.annotationDisplayState?.color;
    if (!color) continue;
    try { if (color.toString() !== BOUNDS_COLOR) color.restoreState(BOUNDS_COLOR); } catch { /* not a color */ }
  }
}

export function startBoundsColor() {
  let tries = 0;
  const wait = setInterval(() => {
    const lm = viewerOf()?.layerManager;
    if (!lm && ++tries < 240) return;
    clearInterval(wait);
    if (!lm) return;
    paint();
    lm.layersChanged.add(() => paint());
  }, 500);
}
