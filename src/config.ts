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
  caveServerByDataset: {
    minnie65_public:          'https://minnie.microns-daf.com',
    minnie65_public_v117:     'https://minnie.microns-daf.com',
    pinky_training3:          'https://minnie.microns-daf.com',
    // FlyWire sandbox (Drosophila FAFB) — uses global DAF CAVE server
    'fly_v26':                'https://global.daf-apis.com',
    'flywire_fafb_sandbox':   'https://global.daf-apis.com',
    eyewire_ii:               'https://global.brain-wire-test.org',
  } as Record<string, string>,

  /**
   * Annotation table for "cell complete" flags.
   * Using _dev suffix tables for testing — these must be created on the CAVE
   * server before use. Switch to 'cell_status' for production.
   */
  cellStatusTable: 'cell_status_dev',

  /**
   * Annotation table for cell type labels.
   * Using _dev suffix tables for testing. Switch to 'cell_type' for production.
   */
  cellTypeTable: 'cell_type_dev',

  /** CAVE datastack name for Eyewire II. Confirm with your team. */
  datastack: 'eyewire_ii',
};

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
