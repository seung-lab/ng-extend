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
/** Keyed by the cell's segment ID: a claim's task ID was not always known
 *  yet when its start link opened. */
const stashKey = (cellKey: string) => `nge_retina_annot_${cellKey}`;

const viewerOf = (): any => (window as any).viewer;

function readStash(taskId: string): any[] {
  try { const v = JSON.parse(localStorage.getItem(stashKey(taskId)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeStash(taskId: string, specs: any[]) {
  try { specs.length ? localStorage.setItem(stashKey(taskId), JSON.stringify(specs)) : localStorage.removeItem(stashKey(taskId)); } catch { /* full: the start link still has them */ }
}

/** Take the start link's annotation layers off the screen, keeping them for the button. */
function putAside(taskId: string): boolean {
  const viewer = viewerOf();
  if (!viewer?.layerSpecification || currentDatasetTag() !== RETINA_DATASET) return false;
  const managed: any[] = (viewer.layerManager?.managedLayers ?? []).filter((l: any) => !l.archived && isRetinaAnnotationLayer(l.name));
  if (!managed.length) return false;
  // Wait until each layer has loaded, so its points are kept with it.
  if (managed.some(l => !l.layer)) return false;
  let specs: any[] = [];
  try { specs = (viewer.layerSpecification.toJSON() as any[]).filter(s => s && isRetinaAnnotationLayer(s.name)); } catch { return false; }
  const stash = readStash(taskId);
  const have = new Set(stash.map(s => layerKey(s.name)));
  for (const s of specs) if (!have.has(layerKey(s.name))) stash.push(s);
  writeStash(taskId, stash);
  for (const ml of managed) { try { viewer.layerManager.removeManagedLayer(ml); } catch { /* already gone */ } }
  return true;
}

/** The claim being opened light, until its start link has finished loading. */
let watching: { stop: () => void } | null = null;
const WATCH_MS = 60000;

/** A fresh Retina claim: whenever its start link's annotation layers arrive
 *  (a link held on the state server can take many seconds; fixed timers
 *  missed it, Ames 2026-11-07), they go aside and the Checked Highlight layer
 *  is there to mark with. Watches for a minute, or until the Annotation
 *  layers button is pressed. */
export function startRetinaClaimLight(cellKey: string): void {
  watching?.stop();
  const viewer = viewerOf();
  let opened = false;
  const look = () => {
    try {
      if (currentDatasetTag() !== RETINA_DATASET) return;
      const moved = putAside(cellKey);
      if (!viewerOf()?.layerManager?.managedLayers?.length) return;
      // The Checked layer once, then again whenever the start link's layers
      // land (they can bring a Checked of their own, to fold into one).
      const hasChecked = (viewerOf()?.layerManager?.managedLayers ?? []).some((l: any) => !l.archived && /^checked/i.test(String(l.name)));
      if (moved || !opened || !hasChecked) void ensureHighlightLayer('checked');
      if (!opened) { opened = true; document.dispatchEvent(new CustomEvent('nge:open-highlight')); }
    } catch (e) { console.warn('[retina layers]', e); }
  };
  const tick = setInterval(look, 1000);
  const off = viewer?.layerManager?.layersChanged?.add?.(() => setTimeout(look, 0));
  const end = setTimeout(() => me.stop(), WATCH_MS);
  const me = {
    stop: () => {
      clearInterval(tick); clearTimeout(end);
      try { typeof off === 'function' ? off() : viewer?.layerManager?.layersChanged?.remove?.(look); } catch { /* */ }
      if (watching === me) watching = null;
    },
  };
  watching = me;
  setTimeout(look, 300);
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
export function addRetinaAnnotationLayers(taskId: string | null, startLink?: string): number {
  watching?.stop();
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
