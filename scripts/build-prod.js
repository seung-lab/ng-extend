#!/usr/bin/env node
// Cross-platform production build with all config defines.
// Equivalent to the bash build command in the CI workflow.

const { execFileSync } = require('child_process');
const fs = require('fs');

const defines = {
  CONFIG:           'config/ng-extend.json',
  STATE_SERVERS:    'config/state_servers.json',
  CUSTOM_BINDINGS:  'config/custom-keybinds.json',
  DATASETS:         'config/datastack-dataset.json',
  DEFAULT_SETTINGS: 'config/default-settings.json',
};

const args = ['./node_modules/neuroglancer/config/esbuild-cli.js', '--config=min'];

for (const [name, file] of Object.entries(defines)) {
  const content = fs.readFileSync(file, 'utf8').replace(/\s+/g, '');
  args.push('--define', `${name}=${content}`);
}

// ── Dataset selection ────────────────────────────────────────────────────────
// DATASET env var selects which dataset to embed as the default state.
//   node scripts/build-prod.js                         → minnie65
//   DATASET=pinky node scripts/build-prod.js           → pinky
//   DATASET=flywire_sandbox node scripts/build-prod.js → FlyWire sandbox
const DATASET = process.env.DATASET || 'pinky';

const DATASETS_CONFIG = {
  minnie65: {
    dimensions: { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [4e-8, 'm'] },
    position: [120320, 103936, 21360],
    crossSectionScale: 5,
    projectionScale: 30000,
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em',
        name: 'em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/minnie65_public_v117',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'minnie65_public',
        segments: [
          '864691135445639570',
          '864691135158265390',
          '864691135697404831',
          '864691136239802390',
          '864691135213953920',
          '864691135158296972',
          '864691134884741468',
          '864691135697405836',
          '864691135158267390',
          '864691136239803118',
          '864691135158265120',
        ],
      },
    ],
  },
  flywire_sandbox: {
    dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] },
    position: [108360, 42086, 3279],
    crossSectionScale: 8,
    projectionScale: 2230,
    layers: [
      {
        type: 'image',
        source: 'precomputed://gs://microns-seunglab/drosophila_v0/alignment/image_rechunked',
        name: 'fafb-em',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://prodv1.flywire-daf.com/segmentation/1.0/fly_v26',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'fly_v26',
      },
    ],
  },
  pinky: {
    dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] },
    position: [73631, 63170, 344],
    crossSectionScale: 1.1,
    projectionScale: 10800,
    layers: [
      {
        type: 'image',
        source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em',
        name: 'img',
      },
      {
        type: 'segmentation',
        source: {
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_training3',
          subsources: { default: true, mesh: true, graph: true },
          enableDefaultSubsources: true,
        },
        name: 'pinky_training3',
        segments: ['648518346354708544', '648518346355322263'],
      },
    ],
  },
};

const dataset = DATASETS_CONFIG[DATASET];
if (!dataset) {
  console.error(`Unknown DATASET="${DATASET}". Use: ${Object.keys(DATASETS_CONFIG).join(', ')}`);
  process.exit(1);
}

console.log(`Building with dataset: ${DATASET}`);

const state = JSON.stringify({
  dimensions: dataset.dimensions,
  position: dataset.position,
  crossSectionScale: dataset.crossSectionScale,
  projectionScale: dataset.projectionScale,
  projectionOrientation: [0, 0, 0, 1],
  layers: dataset.layers,
  layout: 'xy-3d',
});
args.push('--define', `NEUROGLANCER_DEFAULT_STATE_FRAGMENT=${JSON.stringify(state)}`);

console.log('Running esbuild...');
execFileSync(process.execPath, args, { stdio: 'inherit' });
