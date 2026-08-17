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

const args = ['./node_modules/neuroglancer/config/esbuild-cli.js', '--config=min', '--no-typecheck'];

for (const [name, file] of Object.entries(defines)) {
  const content = fs.readFileSync(file, 'utf8').replace(/\s+/g, '');
  args.push('--define', `${name}=${content}`);
}

// Build stamp — recorded on every client error report so a crash can be traced
// back to the exact deploy that introduced it.
try {
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  args.push('--define', `NGE_BUILD=${JSON.stringify(sha)}`);
} catch {
  // Not a git checkout — build stamp is optional, the guarded typeof in
  // main.ts handles the identifier being left undefined.
}

// ── Dataset selection ────────────────────────────────────────────────────────
// DATASET env var selects which dataset to embed as the default state.
//   node scripts/build-prod.js                         → minnie65
//   DATASET=pinky node scripts/build-prod.js           → pinky
//   DATASET=flywire_sandbox node scripts/build-prod.js → FlyWire sandbox
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
          subsources: { default: true, mesh: true, graph: true },
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

// ── Copy badge center-art PNGs into build output ────────────────────────────
const path = require('path');
const BADGE_ART = path.join(__dirname, '..', 'static', 'badges', 'pyr', 'center-art');
// esbuild --config=min outputs to dist/min
const OUT_DIR = path.join(__dirname, '..', 'dist', 'min', 'center-art');

for (const track of ['building', 'exploration']) {
  const srcDir = path.join(BADGE_ART, track);
  const destDir = path.join(OUT_DIR, track);
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      if (file.endsWith('.png')) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
    }
    console.log(`Copied ${track} badge art to ${destDir}`);
  }
}

// ── Copy standalone HTML pages (CAVE table viewer, etc.) ────────────────────
const STATIC_DIR = path.join(__dirname, '..', 'static');
const DIST_MIN = path.join(__dirname, '..', 'dist', 'min');
for (const file of fs.readdirSync(STATIC_DIR)) {
  if (file.endsWith('.html')) {
    fs.copyFileSync(path.join(STATIC_DIR, file), path.join(DIST_MIN, file));
    console.log(`Copied ${file} to ${DIST_MIN}`);
  }
}

// ── Stamp bundle URLs with a build version ──────────────────────────────────
// The App Engine edge caches every path for 10 minutes. A cache-busted page
// URL (the Pyr logo's hard refresh) used to fetch a FRESH index.html that
// still referenced plain main.bundle.js, so the edge could hand back a stale
// bundle for up to 10 more minutes. Versioned query strings make a fresh
// index pull fresh bundles immediately.
const INDEX_HTML = path.join(DIST_MIN, 'index.html');
if (fs.existsSync(INDEX_HTML)) {
  const stamp = Date.now().toString(36);
  const html = fs.readFileSync(INDEX_HTML, 'utf8')
    .replace(/src="(main\.bundle\.js)"/g, `src="$1?v=${stamp}"`)
    .replace(/href="(main\.bundle\.css)"/g, `href="$1?v=${stamp}"`);
  fs.writeFileSync(INDEX_HTML, html);
  console.log(`Stamped bundle URLs with v=${stamp}`);
}
