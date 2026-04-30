/**
 * Known datasets and a programmatic switcher.
 *
 * Both DatasetSelectorPanel and CellLibraryPanel (cross-dataset help-request
 * jump) need this info, so it lives here instead of inside a single component.
 */
import { useLayersStore } from './store';
import { getDatasetCaveConfig } from './config';
import { openSegPanel } from './widgets/widget_utils';

export interface DatasetEntry {
  id: string;
  label: string;
  description: string;
  layers: any[];
}

export const DATASETS: DatasetEntry[] = [
  {
    id: 'stroeh_mouse_retina',
    label: 'EyeWire II: Retina',
    description: 'EyeWire II — mouse retinal connectome (16×16×40 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'stroeh_mouse_retina',
      },
    ],
  },
  {
    id: 'pinky_sandbox',
    label: 'Pinky Sandbox',
    description: 'MICrONS pinky — small cortex volume for testing (4×4×40 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em',
        name: 'img',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'pinky_nf_v2',
      },
    ],
  },
  {
    id: 'minnie65',
    label: 'MICrONS Minnie65',
    description: 'MICrONS — 1mm³ mouse visual cortex (8×8×40 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/minnie65_public_v117',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'minnie65_public',
      },
    ],
  },
];

/** Segmentation-layer name for an entry (what `getCurrentDatasetName()` returns). */
export function segLayerName(ds: DatasetEntry): string {
  const segLayer = ds.layers.find((l: any) => l.type === 'segmentation');
  return segLayer?.name ?? '';
}

/** Find a dataset entry whose segmentation-layer name matches `name`. */
export function findDatasetBySegName(name: string): DatasetEntry | undefined {
  if (!name) return undefined;
  return DATASETS.find(ds => segLayerName(ds) === name);
}

/**
 * Map any dataset-name variant the app has used historically to a stable
 * canonical key, so legacy help requests / saved links still group with
 * the current dataset.
 *
 * Variants we've seen for the same physical dataset:
 *   • Stroeh retina:  'stroeh_mouse_retina', 'eyewire_ii', 'eyewire_ii_retina'
 *   • Pinky sandbox:  'pinky_nf_v2', 'pinky_training3', 'pinky_training6', 'pinky'
 *   • Minnie65:       'minnie65_public', 'minnie65_public_v117' (and other versions)
 */
export function canonicalDataset(name: string | undefined | null): string {
  if (!name) return '';
  const n = name.toLowerCase();
  if (n.includes('stroeh') || n.startsWith('eyewire_ii')) return 'stroeh_mouse_retina';
  if (n.startsWith('pinky')) return 'pinky_nf_v2';
  if (n.startsWith('minnie65')) return 'minnie65_public';
  if (n.startsWith('flywire') || n.includes('fly_v')) return 'flywire_fafb_sandbox';
  return n;
}

/**
 * Programmatically switch the viewer to the given dataset.
 * Returns true on success. Caller is responsible for any post-switch action
 * (e.g. navigating to a segment) — wait one tick before doing so.
 */
export async function switchToDataset(ds: DatasetEntry): Promise<boolean> {
  try {
    const layerStore = useLayersStore();
    layerStore.selectLayers(ds.layers);
    const segName = segLayerName(ds);
    if (segName) localStorage.setItem('nge_dataset_preference', segName);
    const cfg = getDatasetCaveConfig(ds.id);
    console.info(`[datasets] Switched to ${ds.id} — CAVE: ${cfg.datastack}, tables: ${cfg.cellStatusTable}/${cfg.cellTypeTable}`);
    openSegPanel();
    return true;
  } catch (e) {
    console.error('[datasets] Switch failed:', e);
    return false;
  }
}
