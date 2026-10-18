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

function inSandbox(): boolean {
  const name = currentSegLayer()?.name;
  if (!name) return false;
  const ds = DATASETS.find(d => canonicalDataset(segLayerName(d)) === canonicalDataset(name));
  return ds?.section === 'sandbox';
}

export function startLockedLayers() {
  (window as any).__ngeLayerLocked = (ml: any): boolean => {
    const type = ml?.layer?.constructor?.type ?? ml?.layer?.type ?? ml?.initialSpecification?.type;
    if (type !== 'image' && type !== 'segmentation') return false;
    return inSandbox();
  };
}
