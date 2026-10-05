/**
 * Tutorial 6 : Meet the cells of MEC
 * --------------------------------------------------------------
 * Dataset onboarding (Ames 2026-10-05): the first time someone arrives in a
 * dataset they are walked through its cell types, one cell at a time, 3D
 * only, each with a short description. The last step loads every type at
 * once (the dataset's "cell types" view) and points at the Cell Library.
 *
 * MEC is the first dataset with a tour. The cells are the examples from
 * connectome.quest/mec (src/data/mec_cell_types_state.ts); boxes are each
 * cell's mesh bounds in micrometres from that gallery's cells.json.
 *
 * Started by src/dataset_tour.ts, or the Cell Library's "tour" link. The
 * steps are built by src/dataset_tour_kit.ts.
 */
import { Step } from "./store-pyr";
import { CAVE_CONFIGS_BY_DATASET } from "./config";
import { makeCellTour, type TourCell } from "./dataset_tour_kit";
import mecHero from "../static/images/datasets/mec-welcome.jpg";
import { MEC_CELL_TYPES_STATE } from "./data/mec_cell_types_state";

const CELLS: TourCell[] = [
  {
    title: "Stellate",
    text: `The star of MEC layer II. Several thick dendrites fan out from the cell body in every direction.

Many **grid cells**, the neurons that fire in a hexagonal pattern as an animal explores, are stellate.`,
    ids: ['720575947520731264'], color: '#67f5cb',
    min: [2070.4, 1901.82, 129.93], max: [2514.16, 2290.08, 425.82],
  },
  {
    title: "Pyramidal Neuron",
    text: `A cone shaped cell body with one main **apical dendrite** reaching toward the surface of the brain, and a skirt of shorter basal dendrites below.

In layer II they gather in small patches between the stellate cells.`,
    ids: ['720575947422955241', '720575947193326845'], color: '#3e96f0',
    min: [2375.22, 1883.01, 149.51], max: [2723.27, 2319.25, 424.12],
  },
  {
    title: "Bipolar",
    text: `Two main dendrites leave opposite ends of a long, narrow cell body, so the whole neuron looks like a spindle.`,
    ids: ['720575947496304424', '720575947357938785'], color: '#f5b84a',
    min: [2950.18, 2064.58, 247.27], max: [3095.42, 2374.76, 369.02],
  },
  {
    title: "Inhibitory Interneuron",
    text: `Releases GABA to quiet the neurons around it. Its dendrites are smooth, with few spines, and its axon branches densely close to home.

Basket and chandelier cells are two kinds you can label.`,
    ids: ['720575947567168828'], color: '#ff5fb0',
    min: [1713.9, 1905.81, 122.26], max: [2058.33, 2294.07, 430.34],
  },
  {
    title: "Astrocyte",
    text: `Glia, not a neuron. Its bushy, sponge like branches fill the space around synapses and wrap blood vessels, looking after the neurons nearby.`,
    ids: ['720575947505391325'], color: '#b06fe0',
    min: [2486.05, 2083.45, 189.73], max: [2551.56, 2149.41, 242.81],
  },
  {
    title: "Oligodendrocyte",
    text: `Glia that wrap axons in **myelin**, the insulation that speeds signals along. Look for thin branches that end in a loop or sleeve around an axon.`,
    ids: ['720575947480485108'], color: '#3fd8ff',
    min: [2014.16, 2063.84, 151.91], max: [2087.08, 2111.35, 224.66],
  },
  {
    title: "Microglia",
    text: `The immune cells of the brain. Small, with fine branches that keep watch over the tissue around them.

They merge easily with their neighbours in the segmentation, so a clean one is a good find.`,
    ids: ['720575947495909088', '720575947364826821'], color: '#e8823c',
    min: [2051.79, 2029.06, 345.63], max: [2131.86, 2096.99, 406.7],
  },
];

export const steps: Step[] = makeCellTour({
  name: 'mec',
  layerMatch: 'pni_mec',
  // MEC voxels are 16 x 16 x 45 nm.
  voxelUm: [0.016, 0.016, 0.045],
  stage: MEC_CELL_TYPES_STATE,
  cells: CELLS,
  welcome: {
    title: "Welcome to MEC",
    hero: mecHero,
    heroAlt: "The MEC volume",
    paragraphs: [
      'This is the <strong>medial entorhinal cortex</strong>, the part of the brain that holds its map of space.',
      'Before you start mapping, meet the seven kinds of cell you will find here, one at a time. Drag to rotate each one and scroll to zoom.',
    ],
  },
  finale: {
    title: "All together",
    text: `Here is one of each. The **Seg** list on the right names them, and **cell types** at the top of the Cell Library brings this view back any time.

Ready? The **Cell Library** up here is where you claim a cell. Press **Done** and it opens on the cells that are available.`,
    showcaseUrl: CAVE_CONFIGS_BY_DATASET['pni_mec']?.cellTypesUrl,
  },
});
