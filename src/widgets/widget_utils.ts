import {formatScaleWithUnit} from "neuroglancer/util/si_units";

export const getLayerScales = (coordinateSpace: any) => {
    let scales = new Float32Array(coordinateSpace.value?.scales.length);

    for (let i=0; i < coordinateSpace.value?.scales.length; i++) {
        const {scale} = formatScaleWithUnit(coordinateSpace.value?.scales[i], coordinateSpace.value?.units[i])
        scales[i] = parseFloat(scale);
    }
    return scales
}

/**
 * Select the segmentation layer, open the side panel, and switch to the
 * Seg. tab. Used both after login (initial landing view) and after a
 * dataset switch (so the user always sees the segment list immediately).
 *
 * Idempotent — safe to call repeatedly. Retries up to ~6 seconds in case
 * the layer hasn't finished initializing yet.
 */
export function openSegPanel(retryAttempts = 3): void {
  try {
    // Mobile keeps the seg side panel closed (Amy 2026-08-18): it would
    // cover most of a phone screen. The Layers toolbar action still opens
    // it deliberately; this only skips the automatic opens (post login,
    // dataset switch).
    if (document.body.classList.contains('nge-mobile')) return;
    const viewer: any = (window as any)['viewer'];
    if (!viewer) return;
    const segLayer = viewer.layerManager.managedLayers.find(
      (l: any) => l.layer?.constructor?.name?.includes('Segmentation'),
    );
    if (!segLayer) {
      if (retryAttempts > 0) {
        setTimeout(() => openSegPanel(retryAttempts - 1), 2000);
      } else {
        console.log('[openSegPanel] No segmentation layer found after retries');
      }
      return;
    }
    viewer.selectedLayer.layer = segLayer;
    viewer.selectedLayer.visible = true;
    setTimeout(() => {
      const tabLabels = document.querySelectorAll(
        '.neuroglancer-layer-side-panel-tab, ' +
        '.neuroglancer-tab-label, ' +
        '[data-tab], ' +
        '.neuroglancer-layer-group-viewer-tab'
      );
      for (const tab of tabLabels) {
        const text = tab.textContent?.trim();
        if (text === 'Seg.' || text === 'Seg' || text === 'Segments') {
          (tab as HTMLElement).click();
          return;
        }
      }
      // Fallback: any leaf element with text "Seg."
      const allEls = document.querySelectorAll('.neuroglancer-layer-side-panel *');
      for (const el of allEls) {
        if (el.children.length === 0 && el.textContent?.trim() === 'Seg.') {
          (el as HTMLElement).click();
          return;
        }
      }
    }, 800);
  } catch (e) {
    console.warn('[openSegPanel] error:', e);
  }
}