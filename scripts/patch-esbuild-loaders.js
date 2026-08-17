/**
 * patch-esbuild-loaders.js
 *
 * Registers `.jpg`/`.jpeg` with esbuild's `file` loader in
 * node_modules/neuroglancer/config/esbuild.js. Upstream only configures
 * `{'.wasm': 'dataurl', '.png': 'file'}`, so importing a .jpg asset (e.g.
 * the tutorial banners in src/images/) fails with "No loader is configured
 * for '.jpg'". Adding the loader lets us keep photographic assets as JPEG
 * instead of bloating them into PNG.
 *
 * Idempotent — safe to run repeatedly. Wired as a `postinstall` step so a
 * fresh `npm install` (including CI) re-applies it after node_modules is
 * regenerated. Covers both the dev server and the prod build since both go
 * through this Builder.
 */
const fs = require('fs');
const path = require('path');

const configPath = path.resolve(
  __dirname, '..', 'node_modules', 'neuroglancer', 'config', 'esbuild.js');

if (!fs.existsSync(configPath)) {
  console.warn('[patch-esbuild-loaders] file not found, skipping:', configPath);
  process.exit(0);
}

const before = fs.readFileSync(configPath, 'utf8');
if (before.includes("'.jpg': 'file'") && before.includes("'.obj': 'file'") && before.includes("'.vtk': 'file'")) {
  console.log('[patch-esbuild-loaders] already patched');
  process.exit(0);
}

// Extend the existing loader map. Anchoring on the stable `.png` entry.
const target = "'.png': 'file'";
if (!before.includes(target)) {
  console.error('[patch-esbuild-loaders] could not find the loader map to patch');
  process.exit(1);
}
// .obj: the scout pin mesh (static/tags/pin.obj) is imported for its URL so
// the bundler copies it into dist; runtime code fetches and parses it.
let after = before;
if (!after.includes("'.jpg': 'file'")) {
  after = after.replace(target, "'.png': 'file', '.jpg': 'file', '.jpeg': 'file'");
}
if (!after.includes("'.obj': 'file'")) {
  after = after.replace("'.jpeg': 'file'", "'.jpeg': 'file', '.obj': 'file'");
}
if (!after.includes("'.vtk': 'file'")) {
  after = after.replace("'.obj': 'file'", "'.obj': 'file', '.vtk': 'file'");
}

fs.writeFileSync(configPath, after, 'utf8');
console.log('[patch-esbuild-loaders] registered .jpg/.jpeg/.obj file loaders');
