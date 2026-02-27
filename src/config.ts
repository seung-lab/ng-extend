export type Config = {
  volumes_url?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Eyewire II — CAVE API configuration
// Update the table names below once you have them from your CAVE admin.
// caveServer is auto-detected from the middleauth layer URL in the viewer.
// ─────────────────────────────────────────────────────────────────────────────
export const EYEWIRE_II_CAVE_CONFIG = {
  /** Hard-code CAVE server URL here if auto-detection fails, else leave empty. */
  caveServerOverride: '',

  /** Annotation table that stores "cell complete" flags. Ask your CAVE admin. */
  cellStatusTable: 'cell_status',

  /** Annotation table that stores cell type labels. Ask your CAVE admin. */
  cellTypeTable: 'cell_type',

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
