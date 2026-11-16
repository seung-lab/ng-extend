/**
 * Layers a player cannot remove (Ames 2026-10-18: "we were supposed to make it
 * where user cannot X or trash the 2D or 3D segmentation in Sandbox").
 *
 * In a Sandbox dataset the base image layer (2D EM) and the segmentation
 * layer (3D segmentation) lose their remove (✕) and delete (trash) buttons
 * on the layer bar; clicking where they were does nothing. Annotation layers
 * and any layer the player added keep theirs. The layer bar asks through
 * window.__ngeLayerLocked (third_party/neuroglancer/ui/layer_bar.ts).
 */
import { DATASETS, canonicalDataset, segLayerName, currentSegLayer } from '../datasets';

/** The Sandbox's own segmentation layer name, when a Sandbox is on screen. */
function sandboxSegName(): string {
  const name = currentSegLayer()?.name;
  if (!name) return '';
  const ds = DATASETS.find(d => canonicalDataset(segLayerName(d)) === canonicalDataset(name));
  return ds?.section === 'sandbox' ? segLayerName(ds) : '';
}

export function startLockedLayers() {
  (window as any).__ngeLayerLocked = (ml: any): boolean => {
    const type = ml?.layer?.constructor?.type ?? ml?.layer?.type ?? ml?.initialSpecification?.type;
    if (type !== 'image' && type !== 'segmentation') return false;
    const own = sandboxSegName();
    if (!own) return false;
    // Only the Sandbox's own segmentation: a segmentation layer added on top
    // (the review's Missed pieces) keeps its X (Ames 2026-11-16: "there is no
    // X on this layer").
    if (type === 'segmentation') return ml?.name === own;
    return true;
  };
}
