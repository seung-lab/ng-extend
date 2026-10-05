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
 * Started by src/dataset_tour.ts, or the Cell Library's "tour" link.
 */
import { Step } from "./store-pyr";
import { useLayersStore } from "./store";
import { CAVE_CONFIGS_BY_DATASET } from "./config";
import { setStatedColor } from "./widgets/widget_utils";
import mecHero from "../static/images/datasets/mec-welcome.jpg";
import { MEC_CELL_TYPES_STATE } from "./data/mec_cell_types_state";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** MEC voxels are 16 x 16 x 45 nm. */
const VOXEL_UM = [0.016, 0.016, 0.045];
/** projectionScale per micrometre of a cell's largest extent: fills the view
 *  with a little margin. */
const SCALE_PER_UM = 95;

/** Low and to the right, clear of the cell in the middle of the view and of
 *  chat on the left. */
const BESIDE = { element: "body", x: 0.84, y: 0.66 };
const MIDDLE = { element: "body", x: 0.5, y: 0.5 };

function viewer(): any { return (window as any)['viewer']; }

function mecLayer(): any {
  const layers: any[] = viewer()?.layerManager?.managedLayers ?? [];
  return layers.find(l => {
    const spec = l.layer?.dataSources?.[0]?.spec?.url ?? '';
    return spec.includes('graphene://') && spec.includes('pni_mec');
  });
}

/** The tour's stage: MEC, 3D only, nothing selected yet, no side panel. */
function baseState(): Record<string, any> {
  const st = JSON.parse(JSON.stringify(MEC_CELL_TYPES_STATE));
  st.layout = '3d';
  st.showAxisLines = false;
  st.showDefaultAnnotations = false;
  st.selectedLayer = { layer: 'pni_mec', visible: false };
  for (const l of st.layers) if (l.type === 'segmentation') l.segments = [];
  return st;
}

/** Make sure the viewer is on the stage. Each step calls this, so the tour
 *  also works when it is resumed after a reload or stepped back from the
 *  final view. */
async function ensureStage() {
  const v = viewer();
  if (!v) return;
  document.dispatchEvent(new CustomEvent('nge:close-all-panels'));
  document.dispatchEvent(new CustomEvent('nge:close-cell-library'));
  if (!mecLayer()) {
    await useLayersStore().loadState(baseState());
    for (let i = 0; i < 40 && !mecLayer()?.layer?.displayState; i++) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  try {
    v.layout.restoreState('3d');
    v.showAxisLines.value = false;
    v.showDefaultAnnotations.value = false;
    v.selectedLayer.visible = false;
  } catch (e) {
    console.warn('[mec tour] could not set the stage:', e);
  }
}

/** Show only these segments, coloured as in the cell types view, and frame
 *  the box (micrometres) that holds the cell. */
async function showCell(ids: string[], color: string, min: number[], max: number[]) {
  await ensureStage();
  const v = viewer();
  const layer = mecLayer()?.layer;
  const group = layer?.displayState?.segmentationGroupState?.value;
  if (!v || !group) return;
  try {
    const { Uint64 } = require('neuroglancer/util/uint64');
    const colors = layer.displayState.segmentationColorGroupState?.value?.segmentStatedColors;
    // neuroglancer packs as 0xBBGGRR.
    const n = parseInt(color.slice(1), 16);
    const packed = ((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16);
    group.visibleSegments.clear();
    for (const id of ids) {
      const seg = Uint64.parseString(id);
      try { if (colors) setStatedColor(colors, seg, packed); } catch { /* keeps its default colour */ }
      group.visibleSegments.add(seg);
    }
    const centre = [0, 1, 2].map(i => (min[i] + max[i]) / 2 / VOXEL_UM[i]);
    v.navigationState.position.value = Float32Array.from(centre);
    const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    v.projectionScale.value = extent * SCALE_PER_UM;
  } catch (e) {
    console.warn('[mec tour] could not show the cell:', e);
  }
}

/** The finale: every cell type at once. Finishing the tour then opens the
 *  Cell Library on Available (Tutorial.vue). */
function showAllTypes() {
  const cfg = CAVE_CONFIGS_BY_DATASET['pni_mec'];
  // The registered showcase link: src/showcase.ts sets the view up (3D only,
  // labels in the Seg tab, no leaderboard) once it loads.
  if (cfg?.cellTypesUrl) window.location.hash = '#!' + cfg.cellTypesUrl;
}

interface TourCell {
  title: string;
  text: string;
  ids: string[];
  color: string;
  min: number[];
  max: number[];
}

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

export const steps: Step[] = [
  {
    title: "Welcome to MEC",
    // Hero on top, copy below, the same frame as the Site Tour welcome.
    html: `
<div class="nge-tour-welcome">
  <div class="nge-tour-welcome-hero">
    <img src="${mecHero}" alt="The MEC volume" />
  </div>
  <div class="nge-tour-welcome-body">
    <p>This is the <strong>medial entorhinal cortex</strong>, the part of the brain that holds its map of space.</p>
    <p>Before you start mapping, meet the seven kinds of cell you will find here, one at a time. Drag to rotate each one and scroll to zoom.</p>
  </div>
</div>`,
    position: MIDDLE,
    width: "480px",
    nextLabel: "Meet the cells",
    onEnter: ensureStage,
  },
  ...CELLS.map((c): Step => ({
    title: c.title,
    text: c.text,
    position: BESIDE,
    width: "340px",
    onEnter: () => showCell(c.ids, c.color, c.min, c.max),
  })),
  {
    title: "All together",
    text: `Here is one of each. The **Seg** list on the right names them, and **cell types** at the top of the Cell Library brings this view back any time.

Ready? The **Cell Library** up here is where you claim a cell. Press **Done** and it opens on the cells that are available.`,
    position: { element: '[data-icon-id="cells"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
    onEnter: showAllTypes,
  },
];
