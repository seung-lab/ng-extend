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
  // The LIVE minnie65 chunked graph (internal access required). The
  // Dorkenwald/Fuming exports carry root ids minted here, which the frozen
  // public v117 table cannot resolve (their meshes silently never load), so
  // AI candidate review happens on this entry. No defaultStateUrl: the v117
  // saved state would re-spec the frozen table.
  minnie65_phase3_v1: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_phase3_v1',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    // The two demo neurons from the Dorkenwald/Fuming export, preloaded so
    // arriving on Live immediately shows whether the live graph resolves
    // (meshes appear) or the account lacks phase3_v1 access (they stay
    // dark). Position: a max-confidence candidate window on …774191.
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
export function getDatasetCaveConfig(datasetOrLayerName?: string): DatasetCaveConfig {
  if (datasetOrLayerName) {
    const cfg = CAVE_CONFIGS_BY_DATASET[datasetOrLayerName];
    if (cfg) return cfg;
    // Try partial match (e.g. URL contains 'stroeh_mouse_retina')
    for (const [key, val] of Object.entries(CAVE_CONFIGS_BY_DATASET)) {
      if (datasetOrLayerName.includes(key) || key.includes(datasetOrLayerName)) return val;
    }
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
