#!/usr/bin/env node
// Cross-platform dev server launcher (works on Windows PowerShell + bash)
// Equivalent to the bash-only `npm run dev-server` script.

const { spawn } = require('child_process');
const fs = require('fs');

const defines = {
  CONFIG:           'config/ng-extend.json',
  STATE_SERVERS:    'config/state_servers.json',
  CUSTOM_BINDINGS:  'config/custom-keybinds.json',
  DATASETS:         'config/datastack-dataset.json',
  DEFAULT_SETTINGS: 'config/default-settings.json',
};

const args = ['./node_modules/neuroglancer/config/esbuild-cli.js'];

for (const [name, file] of Object.entries(defines)) {
  const content = fs.readFileSync(file, 'utf8').replace(/\s+/g, '');
  args.push(`--define`);
  args.push(`${name}=${content}`);
}

// ── Dataset selection ────────────────────────────────────────────────────────
// Set DATASET=flywire_sandbox to use FlyWire sandbox instead of minnie65.
//   npm run dev-server                          → minnie65 (default)
//   DATASET=flywire_sandbox npm run dev-server  → FlyWire sandbox
const DATASET = process.env.DATASET || 'pinky_sandbox';

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
          subsources: {
            default: true,
            mesh: true,
            graph: true,
          },
          enableDefaultSubsources: true,
        },
        name: 'minnie65_public',
        segments: [
          '864691135445639570',  // seed — open by default
          '864691135158265390',  // L2/3 pyramidal
          '864691135697404831',  // L2/3 pyramidal
          '864691136239802390',  // L4 spiny stellate
          '864691135213953920',  // L5 thick-tufted pyramidal
          '864691135158296972',  // L5 slender-tufted pyramidal
          '864691134884741468',  // L6 corticothalamic
          '864691135697405836',  // PV+ basket cell (inhibitory)
          '864691135158267390',  // SST+ Martinotti cell (inhibitory)
          '864691136239803118',  // VIP+ bipolar cell (inhibitory)
          '864691135158265120',  // border / glia region
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
          subsources: {
            default: true,
            mesh: true,
            graph: true,
          },
          enableDefaultSubsources: true,
        },
        name: 'fly_v26',
      },
    ],
  },
  pinky_sandbox: {
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
          url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2',
          subsources: {
            default: true,
            mesh: true,
            graph: true,
          },
          enableDefaultSubsources: true,
        },
        name: 'pinky_nf_v2',
      },
    ],
  },
};

const dataset = DATASETS_CONFIG[DATASET];
if (!dataset) {
  console.error(`Unknown DATASET="${DATASET}". Use: ${Object.keys(DATASETS_CONFIG).join(', ')}`);
  process.exit(1);
}

console.log(`Using dataset: ${DATASET}`);

const micronState = JSON.stringify({
  dimensions: dataset.dimensions,
  position: dataset.position,
  crossSectionScale: dataset.crossSectionScale,
  projectionScale: dataset.projectionScale,
  projectionOrientation: [0, 0, 0, 1],
  layers: dataset.layers,
  layout: 'xy-3d',
});
// esbuild --define expects a JS expression; JSON.stringify wraps the value in quotes.
args.push('--define', `NEUROGLANCER_DEFAULT_STATE_FRAGMENT=${JSON.stringify(micronState)}`);

args.push('--config=dev', '--serve', '--watch', '--host', '0.0.0.0');

// ── Copy badge center-art PNGs into dev output ─────────────────────────────
const path = require('path');
const BADGE_ART = path.join(__dirname, '..', 'static', 'badges', 'pyr', 'center-art');
const DEV_OUT = path.join(__dirname, '..', 'dist', 'dev', 'center-art');
for (const track of ['building', 'exploration']) {
  const srcDir = path.join(BADGE_ART, track);
  const destDir = path.join(DEV_OUT, track);
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      if (file.endsWith('.png')) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
    }
    console.log(`Copied ${track} badge art → ${destDir}`);
  }
}

console.log('Starting dev server...');
const proc = spawn(process.execPath, args, { stdio: 'inherit', shell: false });
proc.on('exit', code => process.exit(code ?? 0));
