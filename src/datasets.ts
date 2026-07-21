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
  /** Compact name for inline UI (chat chips, badges) where `label` is too long. */
  shortLabel: string;
  description: string;
  layers: any[];
}

export const DATASETS: DatasetEntry[] = [
  {
    id: 'stroeh_mouse_retina',
    label: 'EyeWire II: Retina',
    shortLabel: 'EyeWire II',
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
    shortLabel: 'Pinky',
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
    shortLabel: 'MICrONS',
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
 * The segmentation-layer name currently on screen. Prefers a visible,
 * non-archived layer: switching datasets leaves the previous segmentation layer
 * archived in `managedLayers`, so taking the first one would report a stale
 * dataset (e.g. the tutorial's pinky while the viewer is really on stroeh).
 *
 * Reads the live `window['viewer']`, which is NOT reactive — callers needing the
 * value to update on a dataset switch should also touch a reactive layer signal
 * (e.g. `useLayersStore().activeLayers`).
 */
export function currentSegLayerName(): string {
  try {
    const viewer = (window as any)['viewer'];
    const layers = viewer?.layerManager?.managedLayers ?? [];
    const isSeg = (ml: any) => {
      const cn = ml?.layer?.constructor?.name ?? '';
      return cn.includes('Segmentation') || ml?.layer?.type === 'segmentation';
    };
    let firstSeg: any = null;
    for (const ml of layers) {
      if (!isSeg(ml)) continue;
      if (!firstSeg) firstSeg = ml;
      if (ml.visible !== false && !ml.archived) return ml.name ?? '';
    }
    return firstSeg?.name ?? '';
  } catch { return ''; }
}

/**
 * Canonical dataset tag to STAMP on and FILTER Supabase rows (tasks, edits,
 * help, etc.) for whatever dataset is currently on screen. Replaces the old
 * hardcoded 'eyewire_ii' string that mislabelled every row regardless of the
 * active dataset. Falls back to the stroeh production dataset when the viewer
 * isn't ready — which is also the canonical value 'eyewire_ii' migrates to, so
 * existing rows still match.
 */
export function currentDatasetTag(): string {
  return canonicalDataset(currentSegLayerName()) || 'stroeh_mouse_retina';
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
 * Short, human-facing name for any dataset-name variant.
 *
 * Used wherever a dataset is shown inline (e.g. the chat #SegID chip) so those
 * labels match the Dataset selector instead of leaking raw layer names like
 * `pinky_nf_v2`. Canonicalises first, so every historical alias resolves to the
 * same friendly name.
 *
 * FlyWire has no DATASETS entry (it isn't offered in the switcher) but can
 * still appear on older records, so it gets an explicit fallback.
 */
const EXTRA_SHORT_LABELS: Record<string, string> = {
  flywire_fafb_sandbox: 'FlyWire',
};

export function datasetDisplayName(name: string | undefined | null): string {
  if (!name) return '';
  const canon = canonicalDataset(name);
  const entry = DATASETS.find(ds => canonicalDataset(segLayerName(ds)) === canon);
  return entry?.shortLabel ?? EXTRA_SHORT_LABELS[canon] ?? name;
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
