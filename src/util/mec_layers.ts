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
  // Super Quests only (Ames 2026-10-28): a place the player has checked.
  { name: 'Checked ✅', color: '#c48cff' },
];
/** The four an ordinary MEC claim opens with. */
const CLAIM_LAYERS = MEC_LAYERS.slice(0, 4).map(l => l.name);

/** "True End" and "True End 🟢" are the same layer: letters only, any case.
 *  So is "Can't Fix 🔴3": neuroglancer numbers a layer added under a name
 *  already taken, and such copies piled up, Can't Fix 1 to 4 (Ames
 *  2026-10-26: "when i claim new cells its making new layers"). */
export const mecLayerKey = (n: string) => String(n).replace(/\d+\s*$/, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** Fold copies of one of the four into one layer: their points move to the
 *  copy with the most, the others go, and the one kept takes the plain name.
 *  A copy whose points have not loaded yet is left for the next look. */
function mergeCopies(viewer: any): void {
  for (const { name } of MEC_LAYERS) {
    const copies = (viewer.layerManager.managedLayers as any[]).filter(l => !l.archived && mecLayerKey(l.name) === mecLayerKey(name));
    if (copies.length < 2) continue;
    const size = (l: any) => { let n = 0; try { for (const _ of l.layer?.localAnnotations ?? []) n++; } catch { /* none */ } return n; };
    if (copies.some(l => !l.layer?.localAnnotations)) continue;
    copies.sort((a, b) => size(b) - size(a));
    const [keep, ...rest] = copies;
    const dst = keep.layer.localAnnotations;
    const ids = new Set<string>();
    for (const a of dst) ids.add(String(a.id));
    for (const dup of rest) {
      for (const a of dup.layer.localAnnotations) {
        if (ids.has(String(a.id))) continue;
        ids.add(String(a.id));
        dst.add({ ...a }, true).dispose();
      }
      viewer.layerManager.removeManagedLayer(dup);
    }
    if (keep.name !== name && !viewer.layerManager.getLayerByName(name)) {
      keep.name = name;
      viewer.layerManager.layersChanged.dispatch();
    }
  }
}

/** The layers a Super Quest uses (Ames 2026-10-28: AIS, which is required,
 *  Checked and True End). */
export const SUPER_QUEST_LAYERS = ['AIS 🐬', 'Checked ✅', 'True End 🟢'];

function addMissing(only: string[] = CLAIM_LAYERS): void {
  const viewer: any = (window as any).viewer;
  if (!viewer?.layerSpecification) return;
  if (currentDatasetTag() !== 'pni_mec') return;
  mergeCopies(viewer);
  const managed: any[] = viewer?.layerManager?.managedLayers ?? [];
  const key = mecLayerKey;
  const wanted = new Set(only.map(key));
  // The layers this cell does not use go, when they hold no points.
  {
    for (const ml of managed.slice()) {
      if (ml.archived || wanted.has(key(ml.name)) || !MEC_LAYERS.some(l => key(l.name) === key(ml.name))) continue;
      const pts = ml.layer?.localAnnotations;
      if (!pts) continue;
      let n = 0; for (const _ of pts) n++;
      if (!n) viewer.layerManager.removeManagedLayer(ml);
    }
  }
  const have = new Set(managed.filter(l => !l.archived).map(l => key(l.name)));
  for (const { name, color } of MEC_LAYERS) {
    if (!wanted.has(key(name))) continue;
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
export function ensureMecLayers(only?: string[]): void {
  for (const ms of [1200, 4000, 9000]) setTimeout(() => { try { addMissing(only); } catch (e) { console.warn('[mec layers]', e); } }, ms);
}
