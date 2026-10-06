/**
 * Known datasets and a programmatic switcher.
 *
 * Both DatasetSelectorPanel and CellLibraryPanel (cross-dataset help-request
 * jump) need this info, so it lives here instead of inside a single component.
 */
// Dataset thumbnails (static/images/datasets). MICrONS art is Amy's pick for
// every MICrONS volume, pinky included.
import { offerViewRestoreAfterSwitch } from './util/view_autosave';
import thumbMicrons from '../static/images/datasets/microns.jpg';
import thumbMec from '../static/images/datasets/mec.jpg';
// EyeWire II retina: e2_overview.png from eyewire.ai.
import thumbRetina from '../static/images/datasets/retina.jpg';
import thumbBanc from '../static/images/datasets/banc.jpg';
// FlyWire: the 50 largest neurons render (Ames 2026-10-06).
import thumbFlywire from '../static/images/datasets/flywire.jpg';
import { useLayersStore, useUserPreferencesStore } from './store';
import { getDatasetCaveConfig, cellTypesForDataset } from './config';
import { openSegPanel } from './widgets/widget_utils';

export interface DatasetEntry {
  id: string;
  label: string;
  /** Compact name for inline UI (chat chips, badges) where `label` is too long. */
  shortLabel: string;
  /** Shortest name, for the top bar's "Data:" button. */
  abbrev: string;
  /** Organism the volume comes from; drives the species icon. */
  species: 'mouse' | 'fly' | 'human';
  description: string;
  /** Small 16:9 image for dataset cards (profile Datasets tab). Falls back
   *  to the species icon when unset. */
  thumbnail?: string;
  /** CAVE auth dataset that owns the segmentation table (auth API
   *  /service/pychunkedgraph/table/<table>/dataset). Drives the lock and
   *  "View only" marks in the dataset switcher (util/dataset_access.ts). */
  caveDataset?: string;
  /** Left out of the dataset switcher and profile (still resolvable, so saved
   *  links and states that use it keep working). */
  hidden?: boolean;
  /** Off until the player turns it on in their profile's Datasets tab
   *  ("More datasets", Ames 2026-10-06). See isDatasetShown. */
  optional?: boolean;
  /** Published segmentation files with no CAVE behind them (H01, the Janelia
   *  FlyEM volumes): look, colour and share only. No proofreading, claims or
   *  completions, and its CAVE config has an empty server. */
  exploreOnly?: boolean;
  /** Versions of one volume share a single switcher card that opens into a
   *  plain list (Ames 2026-09-30: the three MICrONS entries). */
  group?: string;
  /** This version's name in its group's list. */
  variantLabel?: string;
  /** Switcher section (Ames 2026-09-30). Defaults to 'production'. */
  section?: DatasetSection;
  /** Why Highlight mode is off here, if it is. MEC: its path server fails on
   *  long stretches (502, taking the segmentation service down for a minute)
   *  and it has no L2 cache, 2026-10-02. Remove the line when that is fixed. */
  highlightOff?: string;
  layers: any[];
}

/** Dataset switcher sections: Sandbox and View Only on the left,
 *  Production on the right. */
export type DatasetSection = 'sandbox' | 'viewonly' | 'production';

/** Switcher cards for grouped datasets. */
export const DATASET_GROUPS: Record<string, { label: string; description: string; thumbnail?: string; section?: DatasetSection }> = {
  microns: {
    section: 'viewonly',
    label: 'MICrONS: Mouse Visual Cortex',
    description: '1 mm³ of mouse visual cortex (8×8×40 nm)',
    thumbnail: thumbMicrons,
  },
};

/** Species icon shown next to dataset names (top bar, profile Datasets tab). */
export const SPECIES_ICONS: Record<DatasetEntry['species'], string> = {
  mouse: '🐭',
  fly: '🪰',
  human: '🧠',
};

/** Shown in the switcher and the profile: not hidden, and if optional, turned
 *  on by this player (prefs.extraDatasets, which follows the account). */
export function isDatasetShown(ds: DatasetEntry): boolean {
  if (ds.hidden) return false;
  if (!ds.optional) return true;
  try { return (useUserPreferencesStore().prefs.extraDatasets || []).includes(ds.id); }
  catch { return false; }
}

export const DATASETS: DatasetEntry[] = [
  {
    id: 'stroeh_mouse_retina',
    section: 'production',
    caveDataset: 'stroeh-mouse-retina',
    thumbnail: thumbRetina,
    label: 'EyeWire II: Retina',
    shortLabel: 'EyeWire II',
    abbrev: 'Retina',
    species: 'mouse',
    description: 'EyeWire II mouse retinal connectome (16×16×40 nm)',
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
    section: 'sandbox',
    caveDataset: 'pinky100',
    thumbnail: thumbMicrons,
    label: 'Pinky Sandbox',
    // Shown in the top bar ("Data: Sandbox") and inline chips (Amy).
    shortLabel: 'Sandbox',
    abbrev: 'Sandbox',
    species: 'mouse',
    description: 'MICrONS pinky, a small cortex volume for testing (4×4×40 nm)',
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
    group: 'microns',
    variantLabel: 'Public release (v117)',
    caveDataset: 'microns_public',
    thumbnail: thumbMicrons,
    label: 'MICrONS Minnie65',
    shortLabel: 'MICrONS',
    abbrev: 'MICrONS',
    species: 'mouse',
    description: 'MICrONS, 1 mm³ of mouse visual cortex (8×8×40 nm)',
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
  {
    id: 'minnie65_live',
    group: 'microns',
    variantLabel: 'Live public graph',
    caveDataset: 'microns_public',
    thumbnail: thumbMicrons,
    label: 'MICrONS Live',
    shortLabel: 'MICrONS Live',
    abbrev: 'Live',
    species: 'mouse',
    // The ROLLING public graphene table (plain minnie65_public), unlike the
    // frozen v117 snapshot the main MICrONS entry uses. The Dorkenwald and
    // Fuming export roots resolve here; this is also the table their
    // merge-free demo actually queries (its bundles carry
    // datastack minnie65_public). minnie65_phase3_v1 is a datastack /
    // aligned-volume name, NOT a graphene table: using it as one 400s.
    description: 'MICrONS minnie65 on the rolling public graph, where the AI merge candidate roots resolve',
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/minnie65_public',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'minnie65_public_live',
      },
    ],
  },
  {
    id: 'microns_proofread',
    group: 'microns',
    variantLabel: 'Proofreading (private graph, edits save)',
    caveDataset: 'minnie65',
    // Hidden for now (Ames 2026-09-28: "too many" datasets in the switcher).
    hidden: true,
    thumbnail: thumbMicrons,
    label: 'MICrONS Proofreading',
    shortLabel: 'MICrONS Proofread',
    abbrev: 'Proofread',
    species: 'mouse',
    description: 'MICrONS minnie65 private graph, where edits save (needs MICrONS proofreading access)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/minnie3_v1',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'minnie3_v1',
      },
    ],
  },
  {
    id: 'banc',
    section: 'viewonly',
    caveDataset: 'BANC',
    thumbnail: thumbBanc,
    label: 'BANC: Fly Brain and Nerve Cord',
    shortLabel: 'BANC',
    abbrev: 'BANC',
    species: 'fly',
    description: 'Whole fruit fly brain and nerve cord connectome (4×4×45 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://seunglab_lee_fly_cns_001_alignment/aligned/v0',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://cave.fanc-fly.com/segmentation/table/wclee_fly_cns_001',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'brain_and_nerve_cord',
      },
    ],
  },
  {
    // Same as its layer name, so a lookup by id finds the CAVE config.
    id: 'flywire_public',
    section: 'viewonly',
    caveDataset: 'flywire_public',
    thumbnail: thumbFlywire,
    label: 'FlyWire: Fruit Fly Brain',
    shortLabel: 'FlyWire',
    abbrev: 'FlyWire',
    species: 'fly',
    description: 'Whole adult fruit fly brain connectome, FAFB public release (4×4×40 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://flywire_em/aligned/v1',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://prod.flywire-daf.com/segmentation/table/flywire_public',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'flywire_public',
      },
    ],
  },
  {
    id: 'h01',
    section: 'viewonly',
    optional: true,
    exploreOnly: true,
    label: 'H01: Human Cortex',
    shortLabel: 'H01',
    abbrev: 'H01',
    species: 'human',
    description: 'A cubic millimetre of human temporal cortex, Google and Lichtman Lab (8×8×33 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://h01-release/data/20210601/4nm_raw',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: 'precomputed://gs://h01-release/data/20210601/c3',
        name: 'h01_c3',
      },
    ],
  },
  {
    id: 'manc',
    section: 'viewonly',
    optional: true,
    exploreOnly: true,
    label: 'MANC: Male Fly Nerve Cord',
    shortLabel: 'MANC',
    abbrev: 'MANC',
    species: 'fly',
    description: 'Male adult fruit fly ventral nerve cord, Janelia FlyEM v1.2 (8 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://flyem-vnc-2-26-213dba213ef26e094c16c860ae7f4be0/v3_emdata_clahe_xy/jpeg',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: 'precomputed://gs://manc-seg-v1p2/manc-seg-v1.2',
        name: 'manc_v1_2',
      },
    ],
  },
  {
    id: 'mcns',
    section: 'viewonly',
    optional: true,
    exploreOnly: true,
    label: 'MCNS: Male Fly Brain and Nerve Cord',
    shortLabel: 'MCNS',
    abbrev: 'MCNS',
    species: 'fly',
    description: 'Male adult fruit fly central nervous system, Janelia FlyEM v1.0 (8 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://flyem-male-cns/em/em-clahe-jpeg',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: 'precomputed://gs://flyem-male-cns/v1.0/segmentation',
        name: 'malecns_v1_0',
      },
    ],
  },
  {
    id: 'maol',
    section: 'viewonly',
    optional: true,
    exploreOnly: true,
    label: 'MAOL: Male Fly Optic Lobe',
    shortLabel: 'MAOL',
    abbrev: 'MAOL',
    species: 'fly',
    description: 'Male adult fruit fly optic lobe, Janelia FlyEM v1.1 (8 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://flyem-optic-lobe/grayscale-clahe-jpeg',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: 'precomputed://gs://flyem-optic-lobe/v1.1/segmentation',
        name: 'optic_lobe_v1_1',
      },
    ],
  },
  {
    id: 'pni_mec',
    section: 'production',
    highlightOff: 'Highlight is not available on this dataset yet: its server cannot trace paths along a cell.',
    caveDataset: 'HiMC',
    thumbnail: thumbMec,
    label: 'Medial Entorhinal Cortex',
    shortLabel: 'MEC',
    abbrev: 'MEC',
    species: 'mouse',
    description: 'PNI medial entorhinal cortex, grid cell circuitry (16×16×45 nm)',
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2',
        name: 'img',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://hc.himc-cave.com/segmentation/table/pni_mec',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        // Deliberately NOT 'seg', which is what the team's spelunker states call
        // it. 'seg' is too short and too generic to key a CAVE config on; see
        // MIN_SUBSTRING_MATCH in config.ts. Keep this identical to the
        // pni_mec key in CAVE_CONFIGS_BY_DATASET.
        name: 'pni_mec',
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
/** The managed segmentation layer currently on screen (visible and not
 *  archived), falling back to the first segmentation layer. Dataset
 *  switches leave the previous segmentation layer archived in
 *  managedLayers, so "first seg layer" heuristics silently target the OLD
 *  dataset: segments jumped to on MICrONS Live were being added to the
 *  archived public minnie layer. */
export function currentSegLayer(): any {
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
      if (ml.visible !== false && !ml.archived) return ml;
    }
    return firstSeg;
  } catch { return null; }
}

export function currentSegLayerName(): string {
  return currentSegLayer()?.name ?? '';
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

/** Cell type picker choices for the dataset on screen. */
export function currentCellTypes(): string[] {
  return cellTypesForDataset(currentDatasetTag());
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
 *   • MEC:            'pni_mec', 'mec'
 *
 * NOTE: the team's shared spelunker states name the MEC segmentation layer
 * 'seg'. That is deliberately NOT mapped here — 'seg' is generic enough that
 * claiming it would mislabel any other dataset that ever uses the same name.
 * lightbulb_service falls back to the graphene table name for those states.
 */
export function canonicalDataset(name: string | undefined | null): string {
  if (!name) return '';
  const n = name.toLowerCase();
  if (n.includes('stroeh') || n.startsWith('eyewire_ii')) return 'stroeh_mouse_retina';
  if (n.startsWith('pinky')) return 'pinky_nf_v2';
  if (n.startsWith('minnie65')) return 'minnie65_public';
  // Private MICrONS graph: its root ids are not the public ones, so it keeps
  // its own key rather than sharing minnie65_public's rows.
  if (n.startsWith('minnie3')) return 'minnie3_v1';
  // The public release graph is its own dataset: its root ids are frozen at
  // v783 and are not the sandbox's.
  if (n === 'flywire_public' || n.startsWith('flywire_fafb_public')) return 'flywire_fafb_public';
  if (n.startsWith('flywire') || n.includes('fly_v')) return 'flywire_fafb_sandbox';
  // Explore only volumes (published files, no CAVE).
  if (n.startsWith('h01')) return 'h01_c3';
  if (n.startsWith('manc')) return 'manc_v1_2';
  if (n.startsWith('malecns')) return 'malecns_v1_0';
  if (n.startsWith('optic_lobe')) return 'optic_lobe_v1_1';
  if (n.startsWith('pni_mec') || n === 'mec') return 'pni_mec';
  if (n.startsWith('brain_and_nerve') || n === 'banc' || n.startsWith('wclee_fly_cns')) return 'brain_and_nerve_cord';
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
  // Exact layer-name match first: two entries can share a canonical tag
  // (public MICrONS and MICrONS Live), and canonicalising first would
  // always label both as the first entry.
  const exact = findDatasetBySegName(name);
  if (exact) return exact.shortLabel;
  const canon = canonicalDataset(name);
  const entry = findDatasetByCanonical(canon);
  return entry?.shortLabel ?? EXTRA_SHORT_LABELS[canon] ?? name;
}

/** Dataset entry for any historical name variant (canonicalises first). */
export function findDatasetByCanonical(canon: string): DatasetEntry | undefined {
  return DATASETS.find(ds => canonicalDataset(segLayerName(ds)) === canon);
}

/** Top-bar abbreviation for any dataset-name variant ('' when unknown). */
export function datasetAbbrev(name: string | undefined | null): string {
  if (!name) return '';
  const exact = findDatasetBySegName(name);
  if (exact) return exact.abbrev;
  const canon = canonicalDataset(name);
  return findDatasetByCanonical(canon)?.abbrev ?? EXTRA_SHORT_LABELS[canon] ?? '';
}

/** Species icon for any dataset-name variant. FlyWire has no DATASETS entry
 *  but can appear on older records, so it gets an explicit fallback. */
export function datasetSpeciesIcon(name: string | undefined | null): string {
  if (!name) return '';
  const canon = canonicalDataset(name);
  const entry = findDatasetByCanonical(canon);
  if (entry) return SPECIES_ICONS[entry.species];
  if (canon.includes('fly')) return SPECIES_ICONS.fly;
  return '';
}

/**
 * Programmatically switch the viewer to the given dataset.
 * Returns true on success. Caller is responsible for any post-switch action
 * (e.g. navigating to a segment) — wait one tick before doing so.
 */
export async function switchToDataset(ds: DatasetEntry): Promise<boolean> {
  try {
    const layerStore = useLayersStore();
    // Offer the player's autosaved view of the new dataset once it is up.
    offerViewRestoreAfterSwitch();
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
