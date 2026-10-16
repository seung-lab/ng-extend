/**
 * The Tracers edition's start view (see src/edition.ts). Kept apart from
 * edition.ts because it needs the dataset list, which imports the stores.
 */
import {DATASETS} from './datasets';
import {getDatasetCaveConfig} from './config';
import {TRACER_EDITION} from './edition';

/** The dataset a tracer lands in when the address holds no view. */
const TRACER_DATASET = 'pni_mec';

/**
 * The start view for an address with no view in it: MEC on the Tracers
 * edition, the build's own default (the Sandbox) everywhere else. Same shape
 * as the fragment scripts/build-prod.js writes, with MEC's starter cells.
 */
export function editionDefaultFragment(buildDefault: string | undefined): string | undefined {
  if (!TRACER_EDITION) return buildDefault;
  const ds = DATASETS.find(d => d.id === TRACER_DATASET);
  if (!ds) return buildDefault;
  const cfg = getDatasetCaveConfig(TRACER_DATASET);
  const layers = ds.layers.map((l: any) => l.type === 'segmentation' && cfg.defaultSegments?.length
    ? {...l, segments: cfg.defaultSegments}
    : l);
  return JSON.stringify({
    dimensions: {x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4.5e-8, 'm']},
    position: cfg.defaultPosition ?? [158487, 128036, 5061],
    crossSectionScale: 2,
    projectionScale: 30000,
    projectionOrientation: [0, 0, 0, 1],
    layers,
    layout: 'xy-3d',
  });
}
