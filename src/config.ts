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
  /** Schema used for cellTypeTable ('cell_type_local' or 'bound_tag'). */
  cellTypeSchema: 'cell_type_local' | 'bound_tag';

  // Default-view fields (all optional — when present, applied on dataset switch
  // so a fresh user lands on a visible cell instead of an empty 3D pane).
  /** Root IDs to add to the visible-segments set. */
  defaultSegments?: string[];
  /** Per-segment colors keyed by root_id, hex form e.g. '#00aaff'. */
  segmentColors?: Record<string, string>;
  /** Voxel coords; overrides DEFAULT_SETTINGS.position when set. */
  defaultPosition?: [number, number, number];
  /** Saved-state URL. When set AND user is not mid-tutorial, dataset switch
   *  redirects here so neuroglancer applies the curated view (camera, layers,
   *  segments, etc.) baked into the URL hash. Used for pinky_sandbox. */
  defaultStateUrl?: string;
}

export const CAVE_CONFIGS_BY_DATASET: Record<string, DatasetCaveConfig> = {
  // ── Stroeh mouse retina (EyeWire II production) ──────────────────────────
  stroeh_mouse_retina: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'stroeh_mouse_retina',
    alignedVolume:    'stroeh_mouse_retina',
    cellStatusTable:  'eyewire_ii_cell_status',
    cellTypeTable:    'eyewire_ii_cell_type',
    cellTypeSchema:   'cell_type_local',
    defaultSegments:  ['720575940569107563', '720575940565386350'],
    segmentColors:    {
      '720575940569107563': '#00aaff',
      '720575940565386350': '#ffd700',
    },
  },
  // Alias — neuroglancer layer name used in the viewer
  eyewire_ii: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'stroeh_mouse_retina',
    alignedVolume:    'stroeh_mouse_retina',
    cellStatusTable:  'eyewire_ii_cell_status',
    cellTypeTable:    'eyewire_ii_cell_type',
    cellTypeSchema:   'cell_type_local',
    defaultSegments:  ['720575940569107563', '720575940565386350'],
    segmentColors:    {
      '720575940569107563': '#00aaff',
      '720575940565386350': '#ffd700',
    },
  },

  // ── Pinky sandbox (dev / testing) ────────────────────────────────────────
  // The state URL is the user-curated sandbox view (saved on global.brain-wire-test.org).
  // It's only applied when the user manually switches to pinky_sandbox AND is not
  // in the active tutorial — Tutorial 1 uses pinky_sandbox and drives its own state.
  pinky_sandbox: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'pinky_sandbox',
    alignedVolume:    'pinky100',
    cellStatusTable:  'cell_status_dev',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultSegments:  ['648518346355727683'],
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5679507239337984',
  },
  pinky_training3: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'pinky_sandbox',
    alignedVolume:    'pinky100',
    cellStatusTable:  'cell_status_dev',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultSegments:  ['648518346355727683'],
  },
  pinky_nf_v2: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'pinky_sandbox',
    alignedVolume:    'pinky100',
    cellStatusTable:  'cell_status_dev',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
    defaultSegments:  ['648518346355727683'],
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5679507239337984',
  },

  // ── Minnie (MICrONS) ────────────────────────────────────────────────────
  minnie65_public: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public_v117',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'cell_status_dev',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
  },
  minnie65_public_v117: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public_v117',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'cell_status_dev',
    cellTypeTable:    'cell_type_dev',
    cellTypeSchema:   'bound_tag',
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
