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

// ── MICrONS minnie65_public default state ──────────────────────────────────
// Loads as the initial neuroglancer view when no URL hash is present.
// EM source uses HTTPS (not s3://) so the browser can fetch it without the
// AWS SDK; the BossDB S3 bucket allows anonymous HTTPS GET.
// Seed segment IDs give immediate colour on first load; users can click any
// grey voxel in the EM panel to add more segments.
const SEED_SEGMENTS = [
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
];

const micronState = JSON.stringify({
  dimensions: { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [4e-8, 'm'] },
  position: [150000, 130000, 1250],
  crossSectionScale: 4,
  projectionScale: 25000,
  projectionOrientation: [0, 0, 0, 1],
  layers: [
    {
      type: 'image',
      source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em',
      name: 'em',
    },
    {
      type: 'segmentation',
      source: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/minnie65_public_v117',
      name: 'minnie65_public',
      segments: SEED_SEGMENTS,
    },
  ],
  layout: 'xy-3d',
});
// esbuild --define expects a JS expression; JSON.stringify wraps the value in quotes.
args.push('--define', `NEUROGLANCER_DEFAULT_STATE_FRAGMENT=${JSON.stringify(micronState)}`);

args.push('--config=dev', '--serve', '--watch');

console.log('Starting dev server...');
const proc = spawn(process.execPath, args, { stdio: 'inherit', shell: false });
proc.on('exit', code => process.exit(code ?? 0));
