/**
 * Showcase views (Ames 2026-09-29): a dataset's "cell types" view is for
 * looking, not working. Whenever one loads, however it was opened (the Cell
 * Library button, the raw link pasted in a new tab, a link in chat):
 *   - 3D only, no 2D panels, no axis lines, no bounding box, a bit closer in;
 *   - the annotation label layers are dropped: the Seg tab of the
 *     segmentation layer, whose typed labels show in place of IDs, is the key;
 *   - the arrival leaderboard does not pop up over it.
 * Registered per dataset in config.ts (cellTypesUrl / cellTypesState).
 */
import { CAVE_CONFIGS_BY_DATASET } from './config';

function showcaseUrls(): string[] {
  return Object.values(CAVE_CONFIGS_BY_DATASET)
    .map(c => c.cellTypesUrl)
    .filter((u): u is string => !!u);
}

/** Set once this visit has opened a showcase: neuroglancer soon rewrites
 *  the address with the full state, so the link itself stops matching. */
let opened = false;
export function showcaseOpened(): boolean { return opened; }

/** Is this location hash one of the registered showcase views? */
export function isShowcaseHash(hash: string = window.location.hash): boolean {
  let h = hash || '';
  try { h = decodeURIComponent(h); } catch { /* keep as is */ }
  return showcaseUrls().some(u => h === '#!' + u || h.startsWith('#!' + u));
}

/**
 * Wait for the showcase's layers to replace the ones in `before`, then set
 * the view up. `before` is the layer set at the moment the view was asked
 * for (empty on a fresh page load).
 */
export function applyShowcaseWhenLoaded(before: Set<unknown> = new Set()) {
  const viewer: any = (window as any)['viewer'];
  if (!viewer) return;
  opened = true;
  let tries = 0;
  const tick = () => {
    const layers: any[] = viewer.layerManager?.managedLayers ?? [];
    const seg = layers.find(l => !before.has(l) && l.layer?.tabs?.options?.has?.('segments'));
    if (!seg) { if (++tries < 80) setTimeout(tick, 500); return; }
    try {
      for (const l of [...layers]) {
        if (l.layer?.type === 'annotation' || l.initialSpecification?.type === 'annotation') {
          viewer.layerManager.removeManagedLayer(l);
        }
      }
      viewer.selectedLayer.layer = seg;
      viewer.selectedLayer.visible = true;
      seg.layer.tabs.value = 'segments';
      const panel = seg.layer.panels?.panels?.[0];
      if (panel?.selectedTab) panel.selectedTab.value = 'segments';
      viewer.layout.restoreState('3d');
      viewer.showAxisLines.value = false;
      viewer.showDefaultAnnotations.value = false;
      viewer.projectionScale.value = viewer.projectionScale.value * 0.6;
    } catch (e) {
      console.warn('[showcase] could not set up the view:', e);
    }
  };
  setTimeout(tick, 500);
}

/** App startup: a showcase link opened directly, or navigated to later. */
export function installShowcase() {
  // Fresh page load: the saved view is fetched after boot, so wait for layers
  // that were not already there.
  if (isShowcaseHash()) {
    const viewer: any = (window as any)['viewer'];
    applyShowcaseWhenLoaded(new Set(viewer?.layerManager?.managedLayers ?? []));
  }
  window.addEventListener('hashchange', () => {
    if (!isShowcaseHash()) return;
    const viewer: any = (window as any)['viewer'];
    applyShowcaseWhenLoaded(new Set(viewer?.layerManager?.managedLayers ?? []));
  });
}
