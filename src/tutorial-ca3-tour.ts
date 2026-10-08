/**
 * Tutorial 10 : Meet the cells of CA3
 * --------------------------------------------------------------
 * CA3's dataset tour (Ames 2026-10-07; every dataset ships with one). See
 * src/dataset_tour_kit.ts for how a tour plays and src/dataset_tour.ts for
 * when it starts.
 *
 * The cells and their colours are the ones in Ames's renders at
 * amyleesterling.github.io/ca3 (Zheng et al., bioRxiv 2025,
 * doi:10.1101/2025.07.09.663979). The pyramidal cell is that page's featured
 * cell, and the mossy fiber is one of the six that contact it: the counts in
 * the text (165 synapses from 6 fibers, 53 from this one) were measured from
 * synapses_ca3_v1 at materialization 671 (D:/Meshes/HANDOFF.md). Boxes are
 * each cell's mesh bounds in micrometres. All ids were current roots of the
 * zheng_ca3 graph on 2026-10-07; it is a live graph, so an edit to one of
 * these cells would retire its id.
 *
 * The block is a slab about 92 micrometres thick, seen face on (along z).
 */
import { Step } from "./store-pyr";
import { makeCellTour, VIEW_TOP, type TourCell } from "./dataset_tour_kit";
import { THORNY, SPARSELY_THORNY, INHIBITORY, MOSSY_FIBERS } from "./data/ca3-tour-cells";
import ca3Hero from "../static/images/datasets/ca3-welcome.jpg";

const SLOW = 'This may take a while to load.';
const count = (n: number) => n.toLocaleString('en-US');
const PYR = '648518346438632877', FIBER = '648518346448994107';

const CELLS: TourCell[] = [
  {
    title: "Thorny Pyramidal Cell",
    text: `The main neuron of CA3. Close to the cell body its dendrites are covered in **thorny excrescences**: big, knobbly spines found almost nowhere else in the brain.

Each cluster of thorns is where a mossy fiber plugs in. This cell receives 165 synapses from just 6 mossy fibers.`,
    ids: [PYR], color: '#2E8BE0',
    min: [883.6, 1020.7, 4.3], max: [1211.9, 1282.0, 96.4],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(THORNY.ids.length)} thorny pyramidal cells`, note: SLOW, ...THORNY }],
  },
  {
    title: "Mossy Fiber",
    text: `Not a whole cell: this is the **axon** of a granule cell in the dentate gyrus, next door to CA3. Its cell body is outside the block.

Look for the giant swellings along it. Each one wraps a cluster of thorns. This fiber makes 53 synapses onto the pyramidal cell you just met.`,
    ids: [FIBER], color: '#E8A93A',
    min: [943.3, 1153.3, 4.3], max: [1009.6, 1229.2, 96.4],
    view: VIEW_TOP,
    more: [
      { label: `Show it with the pyramidal cell it contacts`, color: 'own', ids: [PYR, FIBER], min: [883.6, 1020.7, 4.3], max: [1211.9, 1282.0, 96.4] },
      { label: `Show all ${count(MOSSY_FIBERS.ids.length)} mossy fibers`, note: SLOW, ...MOSSY_FIBERS },
    ],
  },
  {
    // Ames 2026-10-07: zoom into a synapse and play the interactive animation
    // from the CA3 renders page. The box is the 53 synapses this fiber makes
    // onto the cell (web/scene.json there) with a margin; the embedded page is
    // that site's viewer.html in its embed mode.
    title: "Watch the Synapse Fire",
    embed: { src: 'https://amyleesterling.github.io/ca3/viewer.html?embed=1', title: 'An action potential travelling from the mossy fiber into the pyramidal cell' },
    text: `The view has zoomed in to where the gold fiber meets the blue cell: 53 synapses packed into a space about 5 micrometres across, where the fiber wraps a cluster of thorns.

Above is the same pair, alive. Press **Play**, or drag the slider: the signal runs down the fiber, crosses at the bouton and travels through the cell to its cell body. Drag the picture to turn it.

One spike is usually not enough to make the cell fire. A quick burst is. That is why this is called a **conditional detonator** synapse.`,
    ids: [PYR, FIBER], color: '#2E8BE0', colors: { [FIBER]: '#E8A93A' },
    min: [990.8, 1163.3, 4.3], max: [1015.4, 1188.5, 29.8],
    view: VIEW_TOP,
  },
  {
    title: "Sparsely Thorny Pyramidal Cell",
    text: `A pyramidal cell with far fewer thorns on its dendrites, so the mossy fibers have fewer places to plug in.

Compare its dendrites near the cell body with the first cell's.`,
    ids: ['648518346447471947'], color: '#9F72EC',
    min: [922.2, 935.2, 4.3], max: [1217.8, 1241.3, 96.4],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(SPARSELY_THORNY.ids.length)} sparsely thorny pyramidal cells`, note: SLOW, ...SPARSELY_THORNY }],
  },
  {
    title: "Inhibitory Interneuron",
    text: `Releases GABA to quiet the neurons around it. Its dendrites are smooth, with few spines, and its axon spreads widely through the block.`,
    ids: ['648518346436534164'], color: '#17A06B',
    min: [603.2, 590.3, 4.3], max: [1046.6, 1049.5, 96.4],
    view: VIEW_TOP,
    more: [{ label: `Show all ${count(INHIBITORY.ids.length)} interneurons`, note: SLOW, ...INHIBITORY }],
  },
];

export const steps: Step[] = makeCellTour({
  name: 'ca3',
  layerMatch: 'zheng_ca3',
  // CA3 voxels are 18 x 18 x 45 nm.
  voxelUm: [0.018, 0.018, 0.045],
  stage: {
    dimensions: { x: [1.8e-8, 'm'], y: [1.8e-8, 'm'], z: [4.5e-8, 'm'] },
    position: [58208, 63963, 1119],
    projectionScale: 24000,
    projectionOrientation: VIEW_TOP,
    layout: '3d',
    layers: [
      { type: 'image', source: 'precomputed://gs://zheng_mouse_hippocampus_production/v2/img_aligned_sharded_18nm', name: 'em' },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/zheng_ca3',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'zheng_ca3',
        segments: [],
      },
    ],
    showSlices: false,
  },
  cells: CELLS,
  welcome: {
    title: "Welcome to CA3",
    hero: ca3Hero,
    heroAlt: "The CA3 cell populations, coloured by cell class",
    paragraphs: [
      'This is a block of mouse <strong>hippocampus</strong>, from the area called CA3. The hippocampus is where the brain forms new memories.',
      'Meet four of the players in its circuit, one at a time. Drag to rotate and scroll to zoom.',
      'From Zheng et al., 2025. <a href="https://amyleesterling.github.io/ca3/" target="_blank" rel="noopener">See the CA3 renderings</a> or <a href="https://doi.org/10.1101/2025.07.09.663979" target="_blank" rel="noopener">read the paper</a>.',
    ],
  },
  finale: {
    title: "All together",
    pointAtCellLibrary: false,
    text: `Here are all four in the same block: a thorny pyramidal cell, one of its mossy fibers, a sparsely thorny pyramidal cell and an interneuron.

CA3 is here to **explore**: click any cell to load it, colour it and share the view. There is no cell list to claim from yet.`,
    view: VIEW_TOP,
  },
});
