/**
 * MEC cells open with the lab's four annotation layers (Ames 2026-10-24). The
 * lab's legend asks for these on every MEC cell; Retina cells get theirs from
 * their start link, MEC cells have none, so players had to make them by hand.
 * No Soma layer: the Cell Library puts the soma coordinates in the lab's
 * spreadsheet itself. Notes layers are the player's own business.
 *
 * The names and colours are shared with the MEC Highlight mode, so its marks
 * and plain points land in the same layers.
 */
import { makeLayer } from 'neuroglancer/layer';
import { currentDatasetTag } from '../datasets';

export const MEC_LAYERS: { name: string; color: string }[] = [
  { name: 'AIS 🐬', color: '#4dd8f0' },
  { name: 'True End 🟢', color: '#3ddc84' },
  { name: "Can't Fix 🔴", color: '#ff4d5e' },
  { name: 'Hits Edge 🟠', color: '#ff9a3c' },
];

function addMissing(): void {
  const viewer: any = (window as any).viewer;
  const managed: any[] = viewer?.layerManager?.managedLayers ?? [];
  if (!viewer?.layerSpecification) return;
  if (currentDatasetTag() !== 'pni_mec') return;
  // "True End" and "True End 🟢" are the same layer: letters only, any case.
  const key = (n: string) => String(n).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const have = new Set(managed.filter(l => !l.archived).map(l => key(l.name)));
  for (const { name, color } of MEC_LAYERS) {
    if (have.has(key(name))) continue;
    viewer.layerSpecification.add(makeLayer(viewer.layerSpecification, name, {
      type: 'annotation',
      source: { url: 'local://annotations' },
      annotationColor: color,
      annotations: [],
    }));
  }
}

/** Add any of the four that the view lacks, once the cell's view has loaded
 *  (a start link replaces the layers, so look again a little later). */
export function ensureMecLayers(): void {
  for (const ms of [1200, 4000]) setTimeout(() => { try { addMissing(); } catch (e) { console.warn('[mec layers]', e); } }, ms);
}
