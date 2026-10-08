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
import { MEC_CELL_TYPES_STATE } from './data/mec_cell_types_state';
/** How to proofread a Retina cell (Ames's "Test BPs in Eyewire II Branch"
 *  doc, 2026-09-29). Shown in the Cell Library under "instructions". */
const RETINA_HOWTO: string[] = [
  'New here? Watch <a href="https://youtu.be/QNMfmlJIfWs" target="_blank" rel="noopener">Claiming and Completing a cell in Eyewire II</a>, a short video of the steps below.',
  'Click <b>Available</b> and jump around until you find a cell you want.',
  '<b>Claim</b> it. You can hold up to 8 cells at a time. Claiming loads that cell\'s annotation layers; the jump arrow on its own does not.',
  'Start mapping! Add the annotations described in <a href="https://docs.google.com/spreadsheets/d/10cPvkLYU5zGDe7AJ6SHjhMcfdqXyiPM4W4qgob2g70w/edit?gid=508214135#gid=508214135" target="_blank" rel="noopener">the annotation guide</a>.',
  'When the cell is done, <b>Complete</b> it here in the Cell Library, or with the &Delta; button next to its segment ID in the side panel. That records it in the spreadsheet and in our database.',
  'Questions or problems? Use the <b>(!)</b> button in the top bar.',
];

export interface DatasetCaveConfig {
  caveServer: string;
  datastack: string;
  alignedVolume: string;
  cellStatusTable: string;
  cellTypeTable: string;
  /** Schema used for cellTypeTable. 'cell_type_local' has cell_type +
   *  classification_system fields; 'bound_tag' just has a single tag field;
   *  'bound_tag_user' is bound_tag + a server-injected user_id column. */
  cellTypeSchema: 'cell_type_local' | 'bound_tag' | 'bound_tag_user' | 'bound_double_tag_user';
  /** Schema used for cellStatusTable. Default is 'bound_tag'; use
   *  'bound_tag_user' once the table is migrated to the user-tracked variant
   *  (AnnotationEngine fills in user_id server-side from auth context). */
  cellStatusSchema?: 'bound_tag' | 'bound_tag_user' | 'proofreading_boolstatus_user' | 'representative_point';
  /** The dataset's own tables are shown but players cannot write them (the
   *  table owner keeps write permission PRIVATE). The segment menu says so
   *  instead of offering a Save that CAVE would refuse. */
  cellStatusReadOnly?: boolean;
  cellTypeReadOnly?: boolean;
  /** Published files with no CAVE at all (H01, the Janelia FlyEM volumes):
   *  nothing to read or write, so no server may be assumed for it. */
  exploreOnly?: boolean;

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
  /** 'edit_log': this dataset's CAVE annotation tables can't be written yet,
   *  so completions and cell types are logged ONLY to Supabase edit_log
   *  (server-stamped user, cell ID, point) and read back from there. Each row
   *  keeps its point, so the log can be replayed into CAVE once it exists. */
  annotationLog?: 'edit_log';
  /** Proofreading instructions for this dataset, linked from the Cell
   *  Library header (MEC only for now, Ames 2026-09-29). */
  instructionsUrl?: string;
  /** Step-by-step how-to shown INSIDE the Cell Library when its header's
   *  "instructions" is clicked (Retina, from Ames's tester doc 2026-09-29).
   *  Trusted HTML written here in code: <b>, and <a> links open a new tab. */
  howToSteps?: string[];
  /** A view with one example of each cell type, opened from the Cell
   *  Library header (MEC). A full neuroglancer state. */
  cellTypesState?: Record<string, any>;
  /** Same, as a saved-state link (the part after "#!"). Wins over
   *  cellTypesState; the Seg tab of the segment layer opens once it loads. */
  cellTypesUrl?: string;
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
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/10cPvkLYU5zGDe7AJ6SHjhMcfdqXyiPM4W4qgob2g70w/edit?gid=37544110',
    howToSteps:       RETINA_HOWTO,
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
    cellLibrarySheetUrl: 'https://docs.google.com/spreadsheets/d/10cPvkLYU5zGDe7AJ6SHjhMcfdqXyiPM4W4qgob2g70w/edit?gid=37544110',
    howToSteps:       RETINA_HOWTO,
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
    // Still true 2026-09-28: hc.himc-cave.com annotation returns 400
    // invalid_table_id for pni_mec and materialize 503. Log to Supabase (Ames).
    annotationLog:    'edit_log',
    cellTypesState:   MEC_CELL_TYPES_STATE,
    // Ames's labelled view (2026-09-29).
    cellTypesUrl:     'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5718150469386240',
    instructionsUrl:  'https://docs.google.com/spreadsheets/d/1cGit_jEzUa3idCqM0w_KRW4P42KKN9RnPK4Zafa9Nzw/edit?gid=1005852930#gid=1005852930',
    // Root ids and camera lifted from the team proofreading state
    // (nglstate 6641601003126784), so they resolve in the pni_mec graph.
    defaultSegments:  ['720575947322423718', '720575947401560895', '720575947322485926'],
    defaultPosition:  [158487, 128036, 5061],
    // Amy's curated MEC view (2026-09-26): two proofread cells, blue and
    // yellow. The colours, cells and camera live in the saved state itself.
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5742946691317760',
  },
  minnie65_public: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public_v117',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'eyewire_ii_cell_type_v2',  // created 2026-09-28, 8x8x40 nm
    cellTypeSchema:   'bound_tag_user',
    defaultStateUrl:  'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5757172763852800',
  },
  minnie65_public_v117: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_public_v117',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'eyewire_ii_cell_type_v2',  // created 2026-09-28, 8x8x40 nm
    cellTypeSchema:   'bound_tag_user',
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
    cellTypeTable:    'eyewire_ii_cell_type_v2',  // created 2026-09-28, 8x8x40 nm
    cellTypeSchema:   'bound_tag_user',
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
    cellTypeTable:    'eyewire_ii_cell_type_v2',  // created 2026-09-28, 8x8x40 nm
    cellTypeSchema:   'bound_tag_user',
    defaultSegments:  ['864691135258774191', '864691135375361480'],
    segmentColors:    {
      '864691135258774191': '#FFD700',
      '864691135375361480': '#4a9eff',
    },
    defaultPosition:  [101385, 114771, 22738],
  },

  // MICrONS Proofreading: the PRIVATE minnie65 graph (datastack
  // minnie65_phase3_v1, graphene table minnie3_v1, CAVE auth dataset
  // minnie65). Only accounts with minnie65 edit can save edits; the switcher
  // locks it for everyone else (util/dataset_access.ts). Same aligned volume
  // as the public cards, so the same EyeWire annotation tables. Root ids here
  // differ from the public graph's, so it has its own canonical key.
  minnie3_v1: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'minnie65_phase3_v1',
    alignedVolume:    'minnie65_phase3',
    cellStatusTable:  'eyewire_ii_cell_status_v2',
    cellStatusSchema: 'bound_tag_user',
    cellTypeTable:    'eyewire_ii_cell_type_v2',
    cellTypeSchema:   'bound_tag_user',
  },

  // ── FlyWire (Drosophila FAFB) ───────────────────────────────────────────
  // BANC, the fly brain and nerve cord (Bates et al., Nature 2026). Its own
  // CAVE server (cave.fanc-fly.com), auth dataset BANC. Starts on a
  // proofread cell from backbone_proofread (v898). The EyeWire status and
  // cell type tables are BANC's own: backbone_proofread (proofread marks)
  // and cell_info (primary class, identity and subtype labels). Both are
  // owned by CAVE user 4741 with write permission PRIVATE (checked
  // 2026-09-30), so the game shows them read only. When the owner opens
  // backbone_proofread to the group, drop cellStatusReadOnly (Ames approved
  // writing EyeWire completions there).
  brain_and_nerve_cord: {
    caveServer:       'https://cave.fanc-fly.com',
    datastack:        'brain_and_nerve_cord',
    alignedVolume:    'brain_and_nerve_cord',
    cellStatusTable:  'backbone_proofread',
    cellStatusSchema: 'proofreading_boolstatus_user',
    cellStatusReadOnly: true,
    cellTypeTable:    'cell_info',
    cellTypeSchema:   'bound_double_tag_user',
    cellTypeReadOnly: true,
    defaultPosition:  [139823, 138471, 2627],
  },
  // CA3, mouse hippocampus (Zheng et al. 2025). The datastack has no proofread
  // table and no usable cell type table (ca3_cell_type holds one row, checked
  // 2026-10-07), so both names are empty: nothing is read or written, and the
  // cell menu says so. Starts on the tour's pyramidal cell and one of the
  // mossy fibers that contact it (src/tutorial-ca3-tour.ts).
  zheng_ca3: {
    caveServer:       'https://minnie.microns-daf.com',
    datastack:        'zheng_ca3',
    alignedVolume:    'zheng_ca3',
    cellStatusTable:  '',
    cellStatusReadOnly: true,
    cellTypeTable:    '',
    cellTypeSchema:   'bound_tag_user',
    cellTypeReadOnly: true,
    defaultSegments:  ['648518346438632877', '648518346448994107'],
    segmentColors:    { '648518346438632877': '#2E8BE0', '648518346448994107': '#E8A93A' },
    defaultPosition:  [58208, 63963, 1119],
  },
  // FlyWire public release (frozen at materialization v783), on FlyWire's own
  // CAVE server. Auth dataset flywire_public: view for everyone, edit for
  // nobody. proofread_neurons has one row per proofread neuron (schema
  // representative_point, so a row means proofread); neuron_information_v2
  // carries the community labels. Both are shown read only. Starts on three
  // of the tour's cells (src/tutorial-flywire-tour.ts): a Kenyon cell, an
  // LC10 and the giant fiber.
  flywire_public: {
    caveServer:       'https://prod.flywire-daf.com',
    datastack:        'flywire_fafb_public',
    alignedVolume:    'fafb_seung_alignment_v0',
    cellStatusTable:  'proofread_neurons',
    cellStatusSchema: 'representative_point',
    cellStatusReadOnly: true,
    cellTypeTable:    'neuron_information_v2',
    cellTypeSchema:   'bound_tag_user',
    cellTypeReadOnly: true,
    defaultSegments:  ['720575940625290003', '720575940633190169', '720575940632499757'],
    segmentColors:    {
      '720575940625290003': '#ff6fb5',
      '720575940633190169': '#7ef0c2',
      '720575940632499757': '#ff8a4a',
    },
    defaultPosition:  [131000, 55000, 3500],
  },
  // FlyWire's live graph (fly_v31), shown only to accounts with FAFB edit
  // access (DatasetEntry.needsEdit). Merges and splits go to FlyWire itself.
  // FlyWire's own annotation tables are shown read only: the game does not
  // write proofread marks or labels into them.
  flywire_fafb_production: {
    caveServer:       'https://prod.flywire-daf.com',
    datastack:        'flywire_fafb_production',
    alignedVolume:    'fafb_seung_alignment_v0',
    cellStatusTable:  'proofread_neurons',
    cellStatusSchema: 'representative_point',
    cellStatusReadOnly: true,
    cellTypeTable:    'neuron_information_v2',
    cellTypeSchema:   'bound_tag_user',
    cellTypeReadOnly: true,
    defaultPosition:  [131000, 55000, 3500],
  },
  // Explore only volumes: published segmentation files, no CAVE. Registered
  // with an EMPTY server on purpose. An unregistered layer name falls back
  // to the retina's config and would address the wrong volume; these say
  // plainly that there is nothing to read or write.
  // Starter cells so the 3D view is not empty: for H01, layer 2 interneurons
  // from Google's own gallery state; for the FlyEM volumes, neurons named in
  // each volume's own segment properties (the giant fibers DNp01 in MANC and
  // the male CNS, the HS cells in the optic lobe).
  h01_c3:           { caveServer: '', datastack: '', alignedVolume: '', cellStatusTable: '', cellTypeTable: '', cellTypeSchema: 'bound_tag', cellStatusReadOnly: true, cellTypeReadOnly: true, exploreOnly: true,
    defaultSegments: ['1100054524', '1115430292', '12237931142', '1333290325', '1538274151', '1539076840', '1594648509', '1638188509'] },
  manc_v1_2:        { caveServer: '', datastack: '', alignedVolume: '', cellStatusTable: '', cellTypeTable: '', cellTypeSchema: 'bound_tag', cellStatusReadOnly: true, cellTypeReadOnly: true, exploreOnly: true,
    defaultSegments: ['10000', '10002'] },
  malecns_v1_0:     { caveServer: '', datastack: '', alignedVolume: '', cellStatusTable: '', cellTypeTable: '', cellTypeSchema: 'bound_tag', cellStatusReadOnly: true, cellTypeReadOnly: true, exploreOnly: true,
    defaultSegments: ['10001', '10010'] },
  optic_lobe_v1_1:  { caveServer: '', datastack: '', alignedVolume: '', cellStatusTable: '', cellTypeTable: '', cellTypeSchema: 'bound_tag', cellStatusReadOnly: true, cellTypeReadOnly: true, exploreOnly: true,
    defaultSegments: ['10015', '10016', '10023'] },
  // The same configs under each dataset's switcher id: some callers look a
  // dataset up by id rather than by layer name (switchToDataset does), and
  // these ids are too short for the substring match (MIN_SUBSTRING_MATCH).
  get h01() { return this.h01_c3; },
  get manc() { return this.manc_v1_2; },
  get mcns() { return this.malecns_v1_0; },
  get maol() { return this.optic_lobe_v1_1; },
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

// Mouse visual cortex (MICrONS minnie65, and the pinky sandbox), in the
// MICrONS classification's plain-English names.
export const CORTEX_CELL_TYPES: string[] = [
  'L2/3 Pyramidal',
  'L4 Pyramidal',
  'L4 Spiny Stellate',
  'L5 IT Pyramidal',
  'L5 ET Pyramidal',
  'L5 NP Pyramidal',
  'L6 IT Pyramidal',
  'L6 CT Pyramidal',
  'Basket Cell',
  'Chandelier Cell',
  'Martinotti Cell',
  'Bipolar Interneuron',
  'Neurogliaform Cell',
  'Other Interneuron',
  'Astrocyte',
  'Oligodendrocyte',
  'Oligodendrocyte Precursor (OPC)',
  'Microglia',
  'Vascular Cell',
  'Other',
  'Unknown / Unsure',
];

// Medial entorhinal cortex (pni_mec).
export const MEC_CELL_TYPES: string[] = [
  'Stellate',
  'Pyramidal Neuron',
  'Intermediate Stellate / Pyramidal',
  'Horizontal (deep layers)',
  'Bipolar',
  'Inhibitory Interneuron',
  'Basket',
  'Chandelier',
  'Other Interneuron',
  'Astrocyte',
  'Oligodendrocyte',
  'Oligodendrocyte Precursor (OPC)',
  'Microglia',
  'Vascular',
  'Other',
  'Unknown / Unsure',
];

/** The cell type picker's list for a dataset (Amy 2026-09-28: "won't be
 *  seeing amacrine cells in MEC"). Takes the canonical dataset key; an
 *  unrecognised dataset gets only the neutral choices, never another tissue's
 *  types. Users can still free-type any value. */
export function cellTypesForDataset(canonical: string): string[] {
  switch (canonical) {
    case 'stroeh_mouse_retina': return RETINAL_CELL_TYPES;
    case 'pinky_nf_v2':
    case 'minnie65_public':
    case 'minnie3_v1': return CORTEX_CELL_TYPES;
    case 'pni_mec': return MEC_CELL_TYPES;
    default: return ['Neuron', 'Glia', 'Other', 'Unknown / Unsure'];
  }
}
