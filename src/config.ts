export type Config = {
  volumes_url?: string;
  volumes_enabled?: string[];
  volumes_default?: { name: string; image: string; segmentation: string };
  leaderboard_url?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Eyewire II — CAVE API configuration
// Update the table names below once you have them from your CAVE admin.
// caveServer is auto-detected from the middleauth layer URL in the viewer.
// ─────────────────────────────────────────────────────────────────────────────
// ─── Per-dataset CAVE table + datastack configuration ───────────────────────
export interface DatasetCaveConfig {
  caveServer: string;
  datastack: string;
  alignedVolume: string;
  cellStatusTable: string;
  cellTypeTable: string;
  /** Schema used for cellTypeTable. 'cell_type_local' has cell_type +
   *  classification_system fields; 'bound_tag' just has a single tag field;
   *  'bound_tag_user' is bound_tag + a server-injected user_id column. */
  cellTypeSchema: 'cell_type_local' | 'bound_tag' | 'bound_tag_user';
  /** Schema used for cellStatusTable. Default is 'bound_tag'; use
   *  'bound_tag_user' once the table is migrated to the user-tracked variant
   *  (AnnotationEngine fills in user_id server-side from auth context). */
  cellStatusSchema?: 'bound_tag' | 'bound_tag_user';

  // Default-view fields (all optional — when present, applied on dataset switch
  // so a fresh user lands on a visible cell instead of an empty 3D pane).
  /** Root IDs to add to the visible-segments set. */
  defaultSegments?: string[];
  /** Per-segment colors keyed by root_id, hex form e.g. '#00aaff'. */
  segmentColors?: Record<string, string>;
  /** Voxel coords; overrides DEFAULT_SETTINGS.position when set. */
  defaultPosition?: [number, number, number];
  /** Saved-state URL. When set, dataset switch redirects here so neuroglancer
   *  applies the curated view (camera, layers, segments, etc.) baked into the
   *  URL hash. */
  defaultStateUrl?: string;
  /** When true, skip the defaultStateUrl redirect if a tutorial is active.
   *  Set on pinky_sandbox so Tutorial 1 (which drives sandbox state per-step)
   *  isn't disrupted. Stroeh isn't part of any tutorial so leave this false. */
  skipStateUrlIfTutorialActive?: boolean;
  /** Google Sheet (cell list) for THIS dataset's Cell Library. Each dataset
   *  keeps its own sheet; the Cell Library loads the one for the active dataset.
   *  Include the gid in the URL for multi-tab sheets. */
  cellLibrarySheetUrl?: string;
}

export const CAVE_CONFIGS_BY_DATASET: Record<string, DatasetCaveConfig> = {
  // ── Stroeh mouse retina (EyeWire II production) ──────────────────────────
  // Both v2 tables use schema `bound_tag_user`; AnnotationEngine auto-injects
  // user_id from the authenticated session (no client-side encoding needed).
  // For cell type, the cell-type string is stored in `tag`. The
  // classification_system field of the legacy cell_type_local is dropped —
  // we don't need it for EW2 today.
  stroeh_mouse_retina: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'stroeh_mouse_retina',
    alignedVolume:    'stroeh_mouse_retina',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellTypeTable:    'eyewire_ii_cell_type_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeSchema:   'bound_tag_user',
    defaultSegments:  ['720575940569107563', '720575940565386350'],
    segmentColors:    {
      '720575940569107563': '#00aaff',
      '720575940565386350': '#ffd700',
    },
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5672815546073088',
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/1H9KV0-CDGAzd3nvM0Vp1iXun9okwkpe-7tHhpkJbfWc/edit?gid=37544110',
  },
  // Alias — neuroglancer layer name used in the viewer
  eyewire_ii: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'stroeh_mouse_retina',
    alignedVolume:    'stroeh_mouse_retina',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellTypeTable:    'eyewire_ii_cell_type_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeSchema:   'bound_tag_user',
    defaultSegments:  ['720575940569107563', '720575940565386350'],
    segmentColors:    {
      '720575940569107563': '#00aaff',
      '720575940565386350': '#ffd700',
    },
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5672815546073088',
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/1H9KV0-CDGAzd3nvM0Vp1iXun9okwkpe-7tHhpkJbfWc/edit?gid=37544110',
  },

  // ── Pinky sandbox (dev / testing) ────────────────────────────────────────
  // The state URL is the user-curated sandbox view (saved on global.brain-wire-test.org).
  // It's only applied when the user manually switches to pinky_sandbox AND is not
  // in the active tutorial — Tutorial 1 uses pinky_sandbox and drives its own state.
  pinky_sandbox: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'pinky_sandbox',
    alignedVolume:    'pinky100',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultSegments:  ['648518346355727683'],
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5631012797153280',
    skipStateUrlIfTutorialActive: true,
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU/edit',
  },
  pinky_training3: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'pinky_sandbox',
    alignedVolume:    'pinky100',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultSegments:  ['648518346355727683'],
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU/edit',
  },
  // Same pinky100 volume as the other pinky rows, different PCG table. Without
  // this key `getDatasetCaveConfig('pinky_training6')` matched nothing and fell
  // through to DEFAULT_CAVE_CONFIG, so CAVE calls made while this layer was on
  // screen were addressed to the stroeh retina's aligned volume carrying pinky
  // root ids. Annotation tables are per aligned_volume, so the pinky100 tables
  // are correct here regardless of which PCG table the layer points at.
  pinky_training6: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'pinky_sandbox',
    alignedVolume:    'pinky100',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    // Taken from a working pinky_training6 state, so these resolve in THIS
    // table's graph. Root ids are per PCG table and do not carry across.
    defaultSegments:  ['648518346354708544', '648518346355322263'],
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU/edit',
  },
  pinky_nf_v2: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'pinky_sandbox',
    alignedVolume:    'pinky100',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultSegments:  ['648518346355727683'],
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5631012797153280',
    skipStateUrlIfTutorialActive: true,
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU/edit',
  },

  // ── Minnie (MICrONS) ────────────────────────────────────────────────────
  // ── PNI medial entorhinal cortex (MEC) ──────────────────────────────────
  // FIRST dataset on a CAVE server other than minnie.microns-daf.com. The app
  // resolves the server live from the graphene layer URL, so nothing here is
  // load-bearing for the host, but leaving caveServer wrong would still break
  // the dev fallback path in store.ts getCaveServerUrl() step 2.
  //
  // Tables below do not exist yet. As of 2026-09-22 the hc.himc-cave.com
  // annotation service does not have `pni_mec` registered as an aligned volume
  // (400 invalid_table_id) and materialize returns 503, so completions will
  // fail loudly until CAVE provisions them. That is deliberate: failing loudly
  // on an unprovisioned table beats silently writing to the retina.
  pni_mec: {
    caveServer:       'https://hc.himc-cave.com',
    datastack:        'pni_mec',
    alignedVolume:    'pni_mec',
    cellStatusTable:  'mec_cell_status_v1',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'mec_cell_type_v1',
    cellTypeSchema:   'bound_tag_user',
    // Root ids and camera lifted from the team proofreading state
    // (nglstate 6641601003126784), so they resolve in the pni_mec graph.
    defaultSegments:  ['720575947322423718', '720575947401560895', '720575947322485926'],
    defaultPosition:  [158487, 128036, 5061],
  },
  minnie65_public: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public_v117',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5757172763852800',
  },
  minnie65_public_v117: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public_v117',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5757172763852800',
  },
  // MICrONS Live: the ROLLING public graphene table (plain minnie65_public,
  // not the frozen v117 snapshot). The Dorkenwald/Fuming export roots
  // resolve here. No defaultStateUrl: the v117 saved state would re-spec
  // the frozen table. Keyed under both the dataset id and the layer name.
  minnie65_live: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    // The two demo neurons from the Dorkenwald/Fuming export, preloaded so
    // arriving on Live immediately proves the graph resolves (meshes
    // appear). Position: a max-confidence candidate window on …774191.
    defaultSegments:  ['864691135258774191', '864691135375361480'],
    segmentColors:    {
      '864691135258774191': '#FFD700',
      '864691135375361480': '#4a9eff',
    },
    defaultPosition:  [101385, 114771, 22738],
  },
  minnie65_public_live: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultSegments:  ['864691135258774191', '864691135375361480'],
    segmentColors:    {
      '864691135258774191': '#FFD700',
      '864691135375361480': '#4a9eff',
    },
    defaultPosition:  [101385, 114771, 22738],
  },

  // ── FlyWire (Drosophila FAFB) ───────────────────────────────────────────
  fly_v26: {
    caveServer:       'https://global.daf-apis.com',
    datastack:        'flywire_fafb_sandbox',
    alignedVolume:    'fafb_seung_import',
    cellStatusTable:  'cell_status_dev',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
  },
  flywire_fafb_sandbox: {
    caveServer:       'https://global.daf-apis.com',
    datastack:        'flywire_fafb_sandbox',
    alignedVolume:    'fafb_seung_import',
    cellStatusTable:  'cell_status_dev',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
  },
};

/** Default fallback config when dataset is unknown. */
export const DEFAULT_CAVE_CONFIG: DatasetCaveConfig = CAVE_CONFIGS_BY_DATASET.stroeh_mouse_retina;

export const EYEWIRE_II_CAVE_CONFIG = {
  /**
   * Hard-coded CAVE server URL fallback used when auto-detection from a
   * middleauth layer URL fails (e.g. bare graphene:// URLs in dev).
   */
  caveServerOverride: 'https://minnie.microns-daf.com',

  /**
   * Per-dataset CAVE server URLs, keyed by neuroglancer layer name.
   * Used as second-priority fallback after middleauth auto-detection.
   */
  caveServerByDataset: Object.fromEntries(
    Object.entries(CAVE_CONFIGS_BY_DATASET).map(([k, v]) => [k, v.caveServer])
  ) as Record<string, string>,

  // Legacy flat fields — kept for backward compat, but prefer getDatasetCaveConfig()
  cellStatusTable: DEFAULT_CAVE_CONFIG.cellStatusTable,
  cellTypeTable: DEFAULT_CAVE_CONFIG.cellTypeTable,
  datastack: DEFAULT_CAVE_CONFIG.datastack,
  alignedVolume: DEFAULT_CAVE_CONFIG.alignedVolume,

  /** Default Google Sheet URL for the Cell Library task list.
   *  Used when no sheet URL has been configured in localStorage. */
  cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/1SdepJzadXMz5TC-5DFZxUyDJk7efEPP39HE0hmUAJjU/edit',

  /** Google Sheets API key for write-back (claim/completion data). */
  googleSheetsApiKey: 'AIzaSyDEZoctmovc7FQXK-fBu2mI-wWHiKEB9LU',
};

/**
 * Resolve the full CAVE config for the currently active dataset.
 * Accepts a dataset/layer name and returns the matching config,
 * falling back to DEFAULT_CAVE_CONFIG.
 */
/** Substring matching below is a convenience for names like
 *  'graphene://.../stroeh_mouse_retina'. Short names must NOT take part in it:
 *  MEC's segmentation layer is literally called 'seg', and the other MEC
 *  layers are 'em', 'img', 'ws', 'aff', 'sem' and 'size'. Without a floor,
 *  any of those could match a key by accident.
 *
 *  The value is 5, not 6: 'pinky' is a real historical alias (see the variant
 *  list in datasets.ts) and must keep resolving to pinky_sandbox/pinky100.
 *  5 is the shortest floor that keeps 'pinky' working while excluding every
 *  generic layer name above, the longest of which is 'size' at 4.
 *  Verified against the compiled module: no registered key or known alias
 *  resolves differently before and after this change. */
const MIN_SUBSTRING_MATCH = 5;

function findDatasetCaveConfig(name: string): DatasetCaveConfig | undefined {
  const exact = CAVE_CONFIGS_BY_DATASET[name];
  if (exact) return exact;
  if (name.length < MIN_SUBSTRING_MATCH) return undefined;
  for (const [key, val] of Object.entries(CAVE_CONFIGS_BY_DATASET)) {
    if (key.length < MIN_SUBSTRING_MATCH) continue;
    if (name.includes(key) || key.includes(name)) return val;
  }
  return undefined;
}

/** True when `name` resolves to a registered dataset rather than falling
 *  through to DEFAULT_CAVE_CONFIG. Callers use this to tell "this really is
 *  the retina" apart from "nobody registered this and we guessed the retina". */
export function isRegisteredDataset(name?: string): boolean {
  return !!name && !!findDatasetCaveConfig(name);
}

export function getDatasetCaveConfig(datasetOrLayerName?: string): DatasetCaveConfig {
  if (datasetOrLayerName) {
    const cfg = findDatasetCaveConfig(datasetOrLayerName);
    if (cfg) return cfg;
    // Silent fallback here has already cost us one production incident
    // (pinky_training6 writing to the retina's aligned volume). Say so.
    console.warn(
      `[config] No CAVE config registered for '${datasetOrLayerName}'. ` +
      `Falling back to ${DEFAULT_CAVE_CONFIG.datastack}/${DEFAULT_CAVE_CONFIG.alignedVolume}. ` +
      `CAVE writes made now will address the WRONG volume. ` +
      `Register it in CAVE_CONFIGS_BY_DATASET (see docs/HANDOFF-new-dataset.md).`);
  }
  return DEFAULT_CAVE_CONFIG;
}

// Standard mammalian retinal cell types shown in the annotation picker.
// Users can also free-type any value not in this list.
export const RETINAL_CELL_TYPES: string[] = [
  'Retinal Ganglion Cell (RGC)',
  'Amacrine Cell',
  'Starburst Amacrine Cell (SAC)',
  'Bipolar Cell',
  'ON Bipolar Cell',
  'OFF Bipolar Cell',
  'Horizontal Cell',
  'Rod Photoreceptor',
  'Cone Photoreceptor',
  'Müller Glia',
  'Astrocyte',
  'Microglia',
  'Vascular Cell',
  'Interplexiform Cell',
  'Other',
  'Unknown / Unsure',
];
