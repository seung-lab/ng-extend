/**
 * patch-bundle-config.js
 *
 * Adds `decode_jxl` to the precomputed datasource's asyncComputation list in
 * node_modules/neuroglancer/config/bundle-config.js so the JPEG-XL decoder
 * we vendor at third_party/neuroglancer/sliceview/jxl/ gets bundled into
 * async_computation.bundle.js. Without this, the worker is missing the
 * registerAsyncComputation(decodeJxl, ...) call and JXL chunks fail.
 *
 * Idempotent — running multiple times has no effect once patched.
 * Wired as a `postinstall` step so a fresh `npm install` re-applies it.
 */
const fs = require('fs');
const path = require('path');

const configPath = path.resolve(
  __dirname, '..', 'node_modules', 'neuroglancer', 'config', 'bundle-config.js');

if (!fs.existsSync(configPath)) {
  console.warn('[patch-bundle-config] file not found, skipping:', configPath);
  process.exit(0);
}

const before = fs.readFileSync(configPath, 'utf8');
if (before.includes("'neuroglancer/async_computation/decode_jxl'")) {
  console.log('[patch-bundle-config] already patched');
  process.exit(0);
}

// Add decode_jxl right after decode_png in the precomputed datasource block.
const after = before.replace(
  /(['"]neuroglancer\/datasource\/precomputed['"][\s\S]*?asyncComputation:\s*\[[\s\S]*?'neuroglancer\/async_computation\/decode_png',)/,
  "$1\n      'neuroglancer/async_computation/decode_jxl',");

if (after === before) {
  console.error('[patch-bundle-config] failed to find precomputed.asyncComputation block');
  process.exit(1);
}

fs.writeFileSync(configPath, after, 'utf8');
console.log('[patch-bundle-config] added decode_jxl to precomputed asyncComputation list');
