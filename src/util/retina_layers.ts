/**
 * Retina claims start light (Ames 2026-11-07): the bipolar cell guide lets
 * players keep track with Highlight OR annotations, so a claim no longer opens
 * with the start link's five annotation layers (Soma, True End, Can't Fix,
 * Hits Edge, Notes). It opens with one Checked Highlight layer instead. The
 * layers the start link brought are kept aside, with any points in them, and
 * the Cell Library's "Annotation layers" button puts them back. A profile
 * setting (retinaAnnotationLayers) keeps the old way: all of them, every time.
 */
import { makeLayer } from 'neuroglancer/layer';
import { currentDatasetTag } from '../datasets';
import { ensureHighlightLayer } from './highlight';

export const RETINA_DATASET = 'stroeh_mouse_retina';
export const RETINA_ANNOTATION_LAYERS = ['Soma', 'True End', "Can't Fix", 'Hits Edge', 'Notes'];

/** "Can't Fix 🔴2" and "can't fix" are the same layer: letters only, any case,
 *  without the number neuroglancer adds to a copy. */
const layerKey = (n: string) => String(n).replace(/\d+\s*$/, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const KEYS = new Set(RETINA_ANNOTATION_LAYERS.map(layerKey));
const isRetinaAnnotationLayer = (name: string) => KEYS.has(layerKey(name));
const stashKey = (taskId: number) => `nge_retina_annot_${taskId}`;

const viewerOf = (): any => (window as any).viewer;

function readStash(taskId: number): any[] {
  try { const v = JSON.parse(localStorage.getItem(stashKey(taskId)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeStash(taskId: number, specs: any[]) {
  try { specs.length ? localStorage.setItem(stashKey(taskId), JSON.stringify(specs)) : localStorage.removeItem(stashKey(taskId)); } catch { /* full: the start link still has them */ }
}

/** Take the start link's annotation layers off the screen, keeping them for the button. */
function putAside(taskId: number): void {
  const viewer = viewerOf();
  if (!viewer?.layerSpecification || currentDatasetTag() !== RETINA_DATASET) return;
  const managed: any[] = (viewer.layerManager?.managedLayers ?? []).filter((l: any) => !l.archived && isRetinaAnnotationLayer(l.name));
  if (!managed.length) return;
  // Wait until each layer has loaded, so its points are kept with it.
  if (managed.some(l => !l.layer)) return;
  let specs: any[] = [];
  try { specs = (viewer.layerSpecification.toJSON() as any[]).filter(s => s && isRetinaAnnotationLayer(s.name)); } catch { return; }
  const stash = readStash(taskId);
  const have = new Set(stash.map(s => layerKey(s.name)));
  for (const s of specs) if (!have.has(layerKey(s.name))) stash.push(s);
  writeStash(taskId, stash);
  for (const ml of managed) { try { viewer.layerManager.removeManagedLayer(ml); } catch { /* already gone */ } }
}

/** A fresh Retina claim: once its start link has loaded, the annotation layers
 *  go aside and the Checked Highlight layer is there to mark with. */
export function startRetinaClaimLight(taskId: number): void {
  for (const ms of [1200, 4000, 9000]) {
    setTimeout(() => {
      try {
        if (currentDatasetTag() !== RETINA_DATASET) return;
        putAside(taskId);
        void ensureHighlightLayer('checked');
      } catch (e) { console.warn('[retina layers]', e); }
    }, ms);
  }
}

/** Whether any of the five is on screen now. */
export function retinaAnnotationLayersShown(): boolean {
  return (viewerOf()?.layerManager?.managedLayers ?? []).some((l: any) => !l.archived && isRetinaAnnotationLayer(l.name));
}

/** The layers from the claim's start link, when nothing was put aside (a
 *  claim opened before this change, say). Only a link that carries its state
 *  in the address can be read here. */
function specsFromStartLink(link?: string): any[] {
  if (!link) return [];
  try {
    const hash = new URL(link).hash;
    if (!hash.startsWith('#!')) return [];
    const state = JSON.parse(decodeURIComponent(hash.slice(2)));
    return (state?.layers ?? []).filter((s: any) => s && isRetinaAnnotationLayer(s.name));
  } catch { return []; }
}

/** The "Annotation layers" button: put back the five, with their points.
 *  Returns how many were added. */
export function addRetinaAnnotationLayers(taskId: number | null, startLink?: string): number {
  const viewer = viewerOf();
  if (!viewer?.layerSpecification) return 0;
  const specs = (taskId ? readStash(taskId) : []);
  const fromLink = specsFromStartLink(startLink);
  const byKey = new Map<string, any>();
  for (const s of [...fromLink, ...specs]) byKey.set(layerKey(s.name), s);  // kept-aside copies win
  // Any of the five the start link did not have is added empty.
  for (const name of RETINA_ANNOTATION_LAYERS) if (!byKey.has(layerKey(name))) byKey.set(layerKey(name), { type: 'annotation', source: 'local://annotations', annotations: [], name });
  const onScreen = new Set((viewer.layerManager.managedLayers as any[]).filter(l => !l.archived).map(l => layerKey(l.name)));
  let added = 0;
  for (const name of RETINA_ANNOTATION_LAYERS) {
    const k = layerKey(name);
    if (onScreen.has(k)) continue;
    const spec = { ...byKey.get(k) };
    const layerName = spec.name || name;
    delete spec.name;
    try {
      viewer.layerSpecification.add(makeLayer(viewer.layerSpecification, layerName, spec));
      added++;
    } catch (e) { console.warn('[retina layers] could not add', layerName, e); }
  }
  if (taskId) writeStash(taskId, []);
  return added;
}
