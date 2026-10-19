/**
 * The Sandbox's 2D view opens close enough in for its cells to load (Ames
 * 2026-10-19: "our default zoom level is too far out. it's so zoomed out that
 * seg doesn't even load!").
 *
 * The Sandbox's views are saved ones: the curated landing view and every
 * tutorial and practice step. Several were saved with the 2D view at 13 or
 * more voxels a pixel, where the chunked graph segmentation does not load. A
 * Sandbox view that asks for a 2D zoom further out than FAR opens at CLOSE.
 * Zooming out by hand afterwards is left alone. Other datasets are untouched.
 */
const FAR = 12;
export const SANDBOX_CLOSE = 2.5;

const isSandboxSource = (s: unknown) => /pinky/i.test(typeof s === 'string' ? s : JSON.stringify(s ?? ''));

/** A saved view about to load: bring a far 2D zoom in, for the Sandbox. */
export function closeInSandboxView(state: any): any {
  try {
    if (!state || typeof state !== 'object') return state;
    const layers = Array.isArray(state.layers) ? state.layers : Object.values(state.layers ?? {});
    const sandbox = layers.some((l: any) => l?.type === 'segmentation' && (isSandboxSource(l.source) || /pinky/i.test(String(l.name ?? ''))));
    if (sandbox && typeof state.crossSectionScale === 'number' && state.crossSectionScale > FAR) state.crossSectionScale = SANDBOX_CLOSE;
  } catch { /* leave the view as saved */ }
  return state;
}

/** The view the game opened with (from the address): the same, once. */
export function startSandboxZoom() {
  let tries = 0;
  const timer = setInterval(() => {
    const viewer = (window as any).viewer;
    if (++tries > 40) { clearInterval(timer); return; }
    const seg = (viewer?.layerManager?.managedLayers ?? []).find((ml: any) => ml.layer?.type === 'segmentation' || ml.initialSpecification?.type === 'segmentation');
    if (!seg) return;
    clearInterval(timer);
    const sandbox = /pinky/i.test(String(seg.name ?? '')) || isSandboxSource(seg.initialSpecification?.source);
    if (sandbox && viewer.navigationState.zoomFactor.value > FAR) viewer.navigationState.zoomFactor.value = SANDBOX_CLOSE;
  }, 250);
}
