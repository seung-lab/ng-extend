'use strict';
// Where the Sandbox's EM has an image (Ames 2026-11-17: "after it finishes
// doing a check, it turns the em2d slice black"). The pinky EM has blank
// patches: the imaged area's edge moves from section to section, and some
// sections are blank all over (551 is). A Jump spot on a blank patch showed
// the 2D view black: on task 16784's cell, spot z 545 had no image there,
// while 546 to 550 did.
//
// The coarsest scale, 1024 x 1024 x 40 nm, holds the whole section in one
// chunk 16 sections deep, about 400 kB gzipped. A spot on a blank patch moves
// to the nearest section with an image at the same place.

const zlib = require('zlib');

const EM = {
  url: 'https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em/1024.0_1024.0_40.0',
  res: [1024, 1024, 40], size: [488, 328, 2192], depth: 16,
};
/** How far, in sections, a spot may move to find an image. */
const MAX_SHIFT = 12;

const groups = new Map();
const KEEP = 8;
/** The 16 sections from z0, as raw bytes (x fastest), or null when unread. */
function group(fetchImpl, z0) {
  if (groups.has(z0)) { const g = groups.get(z0); groups.delete(z0); groups.set(z0, g); return g; }
  const z1 = Math.min(z0 + EM.depth, EM.size[2]);
  const p = (async () => {
    const r = await fetchImpl(`${EM.url}/0-${EM.size[0]}_0-${EM.size[1]}_${z0}-${z1}`, {signal: AbortSignal.timeout(15000)});
    if (!r.ok) return null;
    let buf = Buffer.from(await r.arrayBuffer());
    const want = EM.size[0] * EM.size[1] * (z1 - z0);
    if (buf.length !== want) buf = zlib.gunzipSync(buf);
    return buf.length === want ? buf : null;
  })().catch(() => null);
  groups.set(z0, p);
  while (groups.size > KEEP) groups.delete(groups.keys().next().value);
  // A failed read is tried again next time.
  p.then(b => { if (!b && groups.get(z0) === p) groups.delete(z0); });
  return p;
}

/** Is there an image at (x, y) of section z, and around it? null when unread. */
async function imaged(fetchImpl, x, y, z) {
  if (z < 0 || z >= EM.size[2]) return false;
  const z0 = Math.floor(z / EM.depth) * EM.depth;
  const buf = await group(fetchImpl, z0);
  if (!buf) return null;
  const plane = EM.size[0] * EM.size[1] * (z - z0);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= EM.size[0] || yy >= EM.size[1]) return false;
    if (buf[plane + yy * EM.size[0] + xx] === 0) return false;
  }
  return true;
}

/** The spot, on the nearest section with an image there (nm in, nm out).
 *  Unchanged when it has one, when none is near, or when the EM cannot be read. */
async function onImage(fetchImpl, nm) {
  if (!Array.isArray(nm) || nm.length < 3 || !nm.every(Number.isFinite)) return nm;
  try {
    const x = Math.floor(nm[0] / EM.res[0]), y = Math.floor(nm[1] / EM.res[1]), z = Math.floor(nm[2] / EM.res[2]);
    const here = await imaged(fetchImpl, x, y, z);
    if (here !== false) return nm;
    for (let d = 1; d <= MAX_SHIFT; d++) {
      for (const zz of [z + d, z - d]) {
        if (await imaged(fetchImpl, x, y, zz)) return [nm[0], nm[1], (zz + 0.5) * EM.res[2]];
      }
    }
  } catch (e) { console.warn('[sandbox-em] no image check', e.message); }
  return nm;
}

module.exports = {onImage, imaged, EM, MAX_SHIFT, _reset() { groups.clear(); }};
