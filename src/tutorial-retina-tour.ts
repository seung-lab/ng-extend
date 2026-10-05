/**
 * Tutorial 7 : Meet the cells of the retina
 * --------------------------------------------------------------
 * The EyeWire II retina's dataset tour (Ames 2026-10-05): the major classes
 * only, one example each. See src/dataset_tour_kit.ts for how a tour plays
 * and src/dataset_tour.ts for when it starts.
 *
 * The examples are cells already labelled in CAVE (eyewire_ii_cell_type,
 * eyewire_ii_cell_type_v2, test05_gcl_sstroeh_table_celltype); all four roots
 * were current on 2026-10-05. Boxes are each cell's mesh bounds in
 * micrometres. The volume is a sheet 82 micrometres deep: ganglion cell
 * bodies sit at low z, and bipolar and Müller cells run up to its top face,
 * so those two are shown from the side.
 */
import { Step } from "./store-pyr";
import { makeCellTour, VIEW_SIDE, VIEW_TOP, type TourCell } from "./dataset_tour_kit";
import retinaHero from "../static/images/datasets/retina.jpg";

const CELLS: TourCell[] = [
  {
    title: "Ganglion Cell",
    text: `The output neurons of the retina. Each one gathers signals in its flat tree of dendrites and sends them down a single axon, through the optic nerve, to the brain.

There are more than forty types, each reporting a different feature of the scene.`,
    ids: ['720575940563641563'], color: '#3e96f0',
    min: [461.2, 139.0, 14.3], max: [746.0, 532.6, 65.3],
    view: VIEW_TOP,
  },
  {
    title: "Amacrine Cell",
    text: `Interneurons that shape the signal on its way from bipolar cells to ganglion cells, mostly by inhibition.

This one is a **starburst** amacrine cell. Its dendrites radiate evenly from the cell body and help the retina detect the direction of motion.`,
    ids: ['720575940585113878'], color: '#ff5fb0',
    min: [403.1, 306.3, 11.4], max: [642.4, 549.1, 53.1],
    view: VIEW_TOP,
  },
  {
    title: "Bipolar Cell",
    text: `Stands upright in the retina and carries signals from the photoreceptors down to amacrine and ganglion cells.

How deep its axon ends tells you its type: **ON** cells end deeper, **OFF** cells nearer the cell body.`,
    ids: ['720575940565027409'], color: '#f5b84a',
    min: [316.0, 666.6, 11.7], max: [336.7, 689.8, 82.6],
    view: VIEW_SIDE,
  },
  {
    title: "Müller Glia",
    text: `The main glia of the retina, not a neuron. Each one spans the tissue like a pillar, with fine side branches that wrap the neurons and synapses around it.`,
    ids: ['720575940578861353'], color: '#67f5cb',
    min: [429.7, 413.0, 4.2], max: [463.2, 480.8, 82.6],
    view: VIEW_SIDE,
  },
];

export const steps: Step[] = makeCellTour({
  name: 'retina',
  layerMatch: 'stroeh_mouse_retina',
  // Retina voxels are 16 x 16 x 40 nm.
  voxelUm: [0.016, 0.016, 0.040],
  stage: {
    dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] },
    position: [37500, 21000, 1000],
    projectionScale: 40000,
    projectionOrientation: VIEW_TOP,
    layout: '3d',
    layers: [
      { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'stroeh_mouse_retina',
        segments: [],
      },
    ],
    showSlices: false,
  },
  cells: CELLS,
  welcome: {
    title: "Welcome to the Retina",
    hero: retinaHero,
    heroAlt: "The EyeWire II retina",
    paragraphs: [
      'This is a piece of mouse <strong>retina</strong>, the thin sheet of neural tissue at the back of the eye that turns light into signals for the brain.',
      'Before you start mapping, meet the four main kinds of cell you will find here, one at a time. Drag to rotate each one and scroll to zoom.',
    ],
  },
  finale: {
    title: "All together",
    text: `Here is one of each, seen from above in the same piece of retina. The bipolar and Müller cells look small from here because they stand on end.

Ready? The **Cell Library** up here is where you claim a cell. Press **Done** and it opens on the cells that are available.`,
    view: VIEW_TOP,
  },
});
