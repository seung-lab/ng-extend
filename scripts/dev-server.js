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
// Image source: public BossDB S3 bucket (no auth required).
// Segmentation: CAVE-backed graphene server (middleauth login gates edits,
//   but browsing and segment selection work without credentials).
const micronState = JSON.stringify({
  dimensions: { x: [8e-9, 'm'], y: [8e-9, 'm'], z: [4e-8, 'm'] },
  position: [240000, 210000, 2050],
  crossSectionScale: 5,
  projectionScale: 30000,
  projectionOrientation: [0, 0, 0, 1],
  layers: [
    {
      type: 'image',
      source: 'precomputed://s3://bossdb-open-data/iarpa_microns/minnie/minnie65/em',
      name: 'em',
    },
    {
      type: 'segmentation',
      source: 'graphene://https://minnie.microns-daf.com/segmentation/table/minnie65_public_v117',
      name: 'minnie65_public',
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
