/**
 * Tutorial 8 : Meet the cells of the fly brain
 * --------------------------------------------------------------
 * FlyWire's dataset tour (Ames 2026-10-06: "pick one cell type from each
 * superclass"). See src/dataset_tour_kit.ts for how a tour plays and
 * src/dataset_tour.ts for when it starts.
 *
 * The nine superclasses are FlyWire's own (hierarchical_neuron_annotations,
 * classification_system = super_class, public release v783; Schlegel et al.
 * 2024). Each example is a neuron labelled with that superclass and the cell
 * type named here. All roots loaded from the public graph (flywire_public)
 * on 2026-10-06; it is a frozen release, so they do not change. Boxes are
 * each cell's mesh bounds in micrometres.
 *
 * Each card carries its superclass render (Tyler Sloan's stills, brightened
 * for a dark card) and a button that loads every neuron of that type; the
 * lists and their counts are in src/data/flywire-tour-cells.ts. The sensory
 * example is an R7 photoreceptor rather than R1-6 because R7 belongs to an
 * optic column (Codex column_assignment), which its second button loads.
 *
 * The brain is seen from the front (looking along z), the way FlyWire shows
 * it, inside an outline of the whole brain (FlyWire's brain_mesh_v3).
 */
import { Step } from "./store-pyr";
import { makeCellTour, VIEW_TOP, type TourCell } from "./dataset_tour_kit";
import { T4A, KCAB, R7, R7_COLUMN, LC10A, CLP02, DNP01, DMS_B, MOTOR, PI } from "./data/flywire-tour-cells";
import flywireHero from "../static/images/datasets/flywire-welcome.jpg";
import imgOptic from "../static/images/flywire-superclass/optic.png";
import imgCentral from "../static/images/flywire-superclass/central.png";
import imgSensory from "../static/images/flywire-superclass/sensory.png";
import imgVisualProjection from "../static/images/flywire-superclass/visual_projection.png";
import imgVisualCentrifugal from "../static/images/flywire-superclass/visual_centrifugal.png";
import imgDescending from "../static/images/flywire-superclass/descending.png";
import imgAscending from "../static/images/flywire-superclass/ascending.png";
import imgMotor from "../static/images/flywire-superclass/motor.png";
import imgEndocrine from "../static/images/flywire-superclass/endocrine.png";

const SLOW = 'This may take a while to load.';
const count = (n: number) => n.toLocaleString('en-US');

// Colours follow the superclass renders, so the card and the cell agree.
const CELLS: TourCell[] = [
  {
    title: "Optic: T4 Cell",
    image: imgOptic, imageAlt: "All optic neurons of the fly brain",
    text: `**Optic** neurons live entirely inside the optic lobes, the fly's visual system. They are more than half of all the neurons in the brain.

This is a **T4** cell, one of the first neurons to work out which way something is moving.`,
    ids: ['720575940627999640'], color: '#e8d83a',
    min: [255.6, 195.4, 248.8], max: [284.7, 222.7, 269.3],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(T4A.ids.length)} T4a cells in this optic lobe`, note: SLOW, ...T4A }],
  },
  {
    title: "Central: Kenyon Cell",
    image: imgCentral, imageAlt: "All central neurons of the fly brain",
    text: `**Central** neurons stay inside the central brain, where sensing turns into decisions.

This is a **Kenyon cell** of the mushroom body, the fly's center for learning and memory. About 5,000 of them store which smells were good or bad.`,
    ids: ['720575940625290003'], color: '#f07a9a',
    min: [535.0, 91.3, 51.0], max: [665.0, 202.8, 192.9],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(KCAB.ids.length)} Kenyon cells of this type`, note: SLOW, ...KCAB }],
  },
  {
    title: "Sensory: Photoreceptor",
    image: imgSensory, imageAlt: "All sensory neurons of the fly brain",
    text: `**Sensory** neurons bring information in from the outside world: sight, smell, taste, touch and sound.

This is an **R7 photoreceptor**, one of the cells the fly sees colour with. Its cell body sits in the eye, and its long ending reaches into the optic lobe, where it joins one **column**: the stack of neurons that handles one point of the fly's view.`,
    ids: ['720575940610510275'], color: '#5fc88a',
    min: [747.2, 218.1, 107.5], max: [838.2, 235.1, 152.6],
    view: VIEW_TOP,
    more: [
      { label: `Show this cell in its optic column (${count(R7_COLUMN.ids.length)} neurons)`, color: 'own', ...R7_COLUMN },
      { label: `Show all ${count(R7.ids.length)} R7 photoreceptors of this eye`, note: SLOW, ...R7 },
    ],
  },
  {
    title: "Visual Projection: LC10",
    image: imgVisualProjection, imageAlt: "All visual projection neurons of the fly brain",
    text: `**Visual projection** neurons carry what the optic lobes have worked out into the central brain.

**LC10** cells respond to small moving things. Male flies use them to keep a female in view during courtship.`,
    ids: ['720575940633190169'], color: '#f0b021',
    min: [325.6, 150.8, 77.5], max: [420.3, 288.7, 226.7],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(LC10A.ids.length)} LC10a cells in this optic lobe`, note: SLOW, ...LC10A }],
  },
  {
    title: "Visual Centrifugal: cLP02",
    image: imgVisualCentrifugal, imageAlt: "All visual centrifugal neurons of the fly brain",
    text: `**Visual centrifugal** neurons run the other way, from the central brain back out to the optic lobes, where they can change how the fly sees depending on what it is doing.

This one is a **cLP02** cell.`,
    ids: ['720575940627124873'], color: '#a6d93a',
    min: [622.6, 200.8, 162.7], max: [735.7, 311.3, 234.3],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(CLP02.ids.length)} cLP02 cells`, note: SLOW, ...CLP02 }],
  },
  {
    title: "Descending: Giant Fiber",
    image: imgDescending, imageAlt: "All descending neurons of the fly brain",
    text: `**Descending** neurons carry the brain's commands down to the nerve cord, which moves the legs and wings.

This is the **giant fiber** (DNp01), one of the largest neurons in the fly. It fires when something looms toward the fly and triggers the escape jump.`,
    ids: ['720575940632499757'], color: '#e39aa5',
    min: [471.1, 173.4, 49.0], max: [652.8, 434.1, 281.8],
    view: VIEW_TOP,
    more: [{ label: `Show both giant fibers`, ...DNP01 }],
  },
  {
    title: "Ascending: dMS-b",
    image: imgAscending, imageAlt: "All ascending neurons of the fly brain",
    text: `**Ascending** neurons bring signals up from the nerve cord, telling the brain what the body is doing.

Their cell bodies are below the brain, so here you see only the branches that arrive, like this **dMS-b** neuron.`,
    ids: ['720575940645084548'], color: '#7fb6e6',
    min: [476.0, 242.5, 92.1], max: [527.6, 348.1, 236.5],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(DMS_B.ids.length)} dMS-b neurons`, ...DMS_B }],
  },
  {
    title: "Motor Neuron",
    image: imgMotor, imageAlt: "All motor neurons of the fly brain",
    text: `**Motor** neurons leave the brain to drive muscles. The ones in the brain mostly move the mouthparts and antennae.

There are only about a hundred of them in the whole brain.`,
    ids: ['720575940608078347'], color: '#d8b48e',
    min: [450.9, 302.4, 114.6], max: [517.2, 364.5, 243.1],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(MOTOR.ids.length)} motor neurons of this type`, ...MOTOR }],
  },
  {
    title: "Endocrine: PI Neuron",
    image: imgEndocrine, imageAlt: "All endocrine neurons of the fly brain",
    text: `**Endocrine** neurons release hormones instead of talking to one neighbor at a time.

This one is in the **pars intercerebralis** at the top of the brain, home of the cells that make the fly's insulin.`,
    ids: ['720575940610467682'], color: '#c3a6e6',
    min: [497.0, 99.1, 55.4], max: [555.1, 297.8, 194.2],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(PI.ids.length)} PI neurons`, note: SLOW, ...PI }],
  },
];

export const steps: Step[] = makeCellTour({
  name: 'flywire',
  layerMatch: 'flywire_public',
  // FlyWire voxels are 4 x 4 x 40 nm.
  voxelUm: [0.004, 0.004, 0.040],
  backdropLayer: 'brain_outline',
  stage: {
    dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] },
    position: [131000, 55000, 3500],
    projectionScale: 260000,
    projectionOrientation: VIEW_TOP,
    layout: '3d',
    layers: [
      { type: 'image', source: 'precomputed://gs://flywire_em/aligned/v1', name: 'em' },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://prod.flywire-daf.com/segmentation/table/flywire_public',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'flywire_public',
        segments: [],
      },
      // A faint outline of the whole brain, so each cell is seen in place
      // (Ames 2026-10-06). Listed after the dataset's own layer: the game
      // takes the first segmentation layer as the dataset on screen.
      {
        type: 'segmentation',
        source: 'precomputed://gs://flywire_neuropil_meshes/whole_neuropil/brain_mesh_v3',
        name: 'brain_outline',
        segments: ['1'],
        segmentColors: { '1': '#8fb8e8' },
        objectAlpha: 0.07,
        selectedAlpha: 0,
        notSelectedAlpha: 0,
        meshSilhouetteRendering: 3,
        pick: false,
      },
    ],
    showSlices: false,
  },
  cells: CELLS,
  welcome: {
    title: "Welcome to FlyWire",
    hero: flywireHero,
    heroAlt: "The 50 largest neurons of the FlyWire fruit fly brain connectome",
    // Fills the frame: shown whole, the render's navy backdrop made a box
    // inside the card.
    paragraphs: [
      'This is the whole brain of an adult <strong>fruit fly</strong>: about 140,000 neurons, every one mapped by the FlyWire community of scientists and citizen scientists.',
      'FlyWire sorts its neurons into nine big groups called superclasses. Meet one neuron from each, one at a time. Drag to rotate and scroll to zoom.',
      // Ames 2026-10-06: the paper collection on the first card.
      'Published in <strong>Nature</strong>, 2024. <a href="https://www.nature.com/collections/hgcfafejia" target="_blank" rel="noopener">Read the FlyWire papers</a>.',
    ],
  },
  finale: {
    title: "All together",
    pointAtCellLibrary: false,
    text: `Here is one neuron from each superclass in the same brain, seen from the front.

This is the public release of FlyWire, so it is here to **explore**: click any cell to load it, and open its Δ menu to see its type. Nothing you do here changes the data.

Want the full story? Take Nature's [immersive tour of the fly brain](https://www.nature.com/immersive/d42859-024-00053-4/index.html).`,
    view: VIEW_TOP,
  },
});
