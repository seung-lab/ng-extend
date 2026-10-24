/**
 * The lab's four marks on an MEC cell (Ames 2026-10-24), as Highlight mode
 * places them. The lab's legend asks for these on every MEC cell:
 *   AIS        where the axon leaves the cell (none on some cell types)
 *   True End   a branch end where the branch naturally stops
 *   Can't Fix  a branch that should go on, but the next piece can't be found
 *   Hits Edge  a branch that runs into the end of the dataset
 * Each is a point in its own annotation layer. The names and colours are the
 * ones a claimed MEC cell opens with (MEC_LAYERS in mec_layers.ts), so a
 * mark placed here and a point placed by hand land in the same layer.
 *
 * The lab proofreaders start with the axons, and so does this: mark the AIS,
 * colour the axon (everything beyond the AIS), then mark each of its ends.
 */
import { currentDatasetTag } from '../datasets';
import { MEC_LAYERS } from './mec_layers';

export interface MecKind { key: string; label: string; layer: string; color: string; hint: string; }
const KIND_INFO: { key: string; label: string; hint: string }[] = [
  { key: 'mec:ais', label: 'AIS', hint: 'Where the axon leaves the cell. Some cell types have none: then skip it.' },
  { key: 'mec:end', label: 'True End', hint: 'A branch end where the branch naturally stops.' },
  { key: 'mec:cantfix', label: "Can't Fix", hint: "A branch that should go on, but you can't find the next piece." },
  { key: 'mec:edge', label: 'Hits Edge', hint: 'A branch that reaches the end of the dataset.' },
];
/** The layer names and colours come from MEC_LAYERS, in the same order. */
export const MEC_KINDS: MecKind[] = KIND_INFO.map((k, i) => ({ ...k, layer: MEC_LAYERS[i].name, color: MEC_LAYERS[i].color }));
export const MEC_AIS = MEC_KINDS[0];
export const MEC_EDGE = MEC_KINDS[3];
/** The axon, coloured beyond the AIS: a highlight layer of its own, so the
 *  lab's AIS layer holds only the AIS points it expects. */
export const AXON_LAYER = 'Axon';

export const isMec = () => currentDatasetTag() === 'pni_mec';

/** "True End" and "True End 🟢" are the same layer: letters only, any case
 *  (the same rule mec_layers.ts uses to avoid making a second one). */
export const layerKey = (name: string) => String(name).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
export const mecKindOfLayer = (name: string) => MEC_KINDS.find(k => layerKey(k.layer) === layerKey(name));

/** The four layers in the view, by kind. */
export function mecLayers(): Map<MecKind, any> {
  const out = new Map<MecKind, any>();
  for (const managed of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (managed.archived) continue;
    const kind = mecKindOfLayer(managed.name);
    if (kind && !out.has(kind)) out.set(kind, managed);
  }
  return out;
}

/** How many points each layer holds, placed by Highlight or by hand. */
export function mecCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const k of MEC_KINDS) counts[k.key] = 0;
  for (const [kind, managed] of mecLayers()) {
    try { for (const ann of managed.layer?.localAnnotations ?? []) if (ann.type === 0) counts[kind.key]++; } catch { /* not loaded */ }
  }
  return counts;
}

/**
 * The marks on the cell, as a line for the lab's sheet when the cell is
 * completed: "Marks: AIS 1, True End 12, Can't Fix 2, Hits Edge 5". Empty
 * off MEC, or when the view has none of the four layers. The marks themselves
 * travel in the Final Link; this is the count, readable in the sheet.
 */
export function mecMarkSummary(): string {
  if (!isMec() || !mecLayers().size) return '';
  const c = mecCounts();
  return 'Marks: ' + MEC_KINDS.map(k => `${k.label} ${c[k.key]}`).join(', ');
}

/**
 * The segmentation volume's outer bounds in nanometres, [[x, y, z] low,
 * [x, y, z] high]: where the data ends. From the Hunt (src/hunt.ts
 * layerBoundsNm on the claude/hunt branch): the source's own voxel bounds
 * times its own scales, since the viewer's space can be far larger than the
 * data. Null if unknown.
 */
export function segBoundsNm(ml: any): number[][] | null {
  for (const ds of ml?.layer?.dataSources ?? []) {
    const ls = ds?.loadState;
    const inS = (ls?.dataSource?.modelTransform ?? ls?.transform?.value)?.inputSpace;
    const lo = inS?.bounds?.lowerBounds, hi = inS?.bounds?.upperBounds, sc = inS?.scales, names: string[] = inS?.names ?? [];
    if (!lo || !hi || !sc) continue;
    const ix = ['x', 'y', 'z'].map(n => names.indexOf(n));
    if (ix.some(i => i < 0)) continue;
    const L = ix.map(i => Number(lo[i]) * Number(sc[i]) * 1e9), H = ix.map(i => Number(hi[i]) * Number(sc[i]) * 1e9);
    if (L.every((v, k) => Number.isFinite(v) && Number.isFinite(H[k]) && H[k] > v)) return [L, H];
  }
  return null;
}
/** The Hunt's rule: this close to the bounds is the edge of the dataset. */
export const EDGE_NM = 5000;
