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
 * type named here in the same table. All nine roots loaded from the public
 * graph (flywire_public) on 2026-10-06; it is a frozen release, so they do
 * not change. Boxes are each cell's mesh bounds in micrometres.
 *
 * The brain is seen from the front (looking along z), the way FlyWire shows
 * it: optic lobes at the sides, the central brain between them.
 */
import { Step } from "./store-pyr";
import { makeCellTour, VIEW_TOP, type TourCell } from "./dataset_tour_kit";
import flywireHero from "../static/images/datasets/flywire-welcome.jpg";

const CELLS: TourCell[] = [
  {
    title: "Optic: T4 Cell",
    text: `**Optic** neurons live entirely inside the optic lobes, the fly's visual system. They are more than half of all the neurons in the brain.

This is a **T4** cell, one of the first neurons to work out which way something is moving.`,
    ids: ['720575940627999640'], color: '#4fb4ff',
    min: [255.6, 195.4, 248.8], max: [284.7, 222.7, 269.3],
    view: VIEW_TOP,
  },
  {
    title: "Central: Kenyon Cell",
    text: `**Central** neurons stay inside the central brain, where sensing turns into decisions.

This is a **Kenyon cell** of the mushroom body, the fly's center for learning and memory. About 5,000 of them store which smells were good or bad.`,
    ids: ['720575940625290003'], color: '#ff6fb5',
    min: [535.0, 91.3, 51.0], max: [665.0, 202.8, 192.9],
    view: VIEW_TOP,
  },
  {
    title: "Sensory: Photoreceptor",
    text: `**Sensory** neurons bring information in from the outside world: sight, smell, taste, touch and sound.

This is an **R1-6 photoreceptor**. Its cell body sits in the eye, and only its end reaches into the brain, carrying the signal from light.`,
    ids: ['720575940631014656'], color: '#ffd24a',
    min: [846.5, 284.4, 103.2], max: [885.0, 295.5, 121.5],
    view: VIEW_TOP,
  },
  {
    title: "Visual Projection: LC10",
    text: `**Visual projection** neurons carry what the optic lobes have worked out into the central brain.

**LC10** cells respond to small moving things. Male flies use them to keep a female in view during courtship.`,
    ids: ['720575940633190169'], color: '#7ef0c2',
    min: [325.6, 150.8, 77.5], max: [420.3, 288.7, 226.7],
    view: VIEW_TOP,
  },
  {
    title: "Visual Centrifugal: cLP02",
    text: `**Visual centrifugal** neurons run the other way, from the central brain back out to the optic lobes, where they can change how the fly sees depending on what it is doing.

This one is a **cLP02** cell.`,
    ids: ['720575940627124873'], color: '#b48cff',
    min: [622.6, 200.8, 162.7], max: [735.7, 311.3, 234.3],
    view: VIEW_TOP,
  },
  {
    title: "Descending: Giant Fiber",
    text: `**Descending** neurons carry the brain's commands down to the nerve cord, which moves the legs and wings.

This is the **giant fiber** (DNp01), one of the largest neurons in the fly. It fires when something looms toward the fly and triggers the escape jump.`,
    ids: ['720575940632499757'], color: '#ff8a4a',
    min: [471.1, 173.4, 49.0], max: [652.8, 434.1, 281.8],
    view: VIEW_TOP,
  },
  {
    title: "Ascending: dMS-b",
    text: `**Ascending** neurons bring signals up from the nerve cord, telling the brain what the body is doing.

Their cell bodies are below the brain, so here you see only the branches that arrive, like this **dMS-b** neuron.`,
    ids: ['720575940645084548'], color: '#5ee0e6',
    min: [476.0, 242.5, 92.1], max: [527.6, 348.1, 236.5],
    view: VIEW_TOP,
  },
  {
    title: "Motor Neuron",
    text: `**Motor** neurons leave the brain to drive muscles. The ones in the brain mostly move the mouthparts and antennae.

There are only about a hundred of them in the whole brain.`,
    ids: ['720575940608078347'], color: '#f25f5c',
    min: [450.9, 302.4, 114.6], max: [517.2, 364.5, 243.1],
    view: VIEW_TOP,
  },
  {
    title: "Endocrine: PI Neuron",
    text: `**Endocrine** neurons release hormones instead of talking to one neighbor at a time.

This one is in the **pars intercerebralis** at the top of the brain, home of the cells that make the fly's insulin.`,
    ids: ['720575940610467682'], color: '#c9e265',
    min: [497.0, 99.1, 55.4], max: [555.1, 297.8, 194.2],
    view: VIEW_TOP,
  },
];

export const steps: Step[] = makeCellTour({
  name: 'flywire',
  layerMatch: 'flywire_public',
  // FlyWire voxels are 4 x 4 x 40 nm.
  voxelUm: [0.004, 0.004, 0.040],
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
    text: `Here is one neuron from each superclass in the same brain, seen from the front.

This is the public release of FlyWire, so it is here to **explore**: click any cell to load it, and open its Δ menu to see its type. Nothing you do here changes the data.

Want the full story? Take Nature's [immersive tour of the fly brain](https://www.nature.com/immersive/d42859-024-00053-4/index.html).`,
    view: VIEW_TOP,
  },
});
