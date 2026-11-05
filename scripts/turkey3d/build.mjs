// Builds static/thanksgiving/turkey3d.js from scripts/turkey3d/turkey3d.js.
// Needs three@0.170.0 installed in some folder outside the app (so the
// app's own node_modules stay as they are):
//   npm i three@0.170.0   (in that folder)
//   THREE_NODE_MODULES=<that folder>/node_modules node scripts/turkey3d/build.mjs
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../../node_modules/neuroglancer/package.json'));
const esbuild = require('esbuild');

await esbuild.build({
  entryPoints: [path.join(here, 'turkey3d.js')],
  outfile: path.resolve(here, '../../static/thanksgiving/turkey3d.js'),
  bundle: true,
  nodePaths: process.env.THREE_NODE_MODULES ? [process.env.THREE_NODE_MODULES] : [],
  minify: true,
  format: 'iife',
  target: 'es2019',
  legalComments: 'eof',
  banner: { js: '/* Pyr Thanksgiving turkey. Built by scripts/turkey3d/build.mjs. three.js: MIT License, Copyright 2010-2024 three.js authors. */' },
});
console.log('built static/thanksgiving/turkey3d.js');
