/**
 * patch-live-server-nocache.js
 *
 * The dev server's live reload writes a "generation" into each HTML page it
 * serves and reloads the page when the server's generation differs. Upstream
 * lets the browser keep the page with an ETag, so after a rebuild the browser
 * revalidates, gets a 304 (the file on disk is unchanged) and reuses its old
 * copy, whose generation is out of date: it reloads, gets the same old copy,
 * and reloads about twice a second for good (Ames 2026-10-25: "it's nonstop
 * refreshing so I can't test it").
 *
 * This makes the HTML pages it serves never cached, so every load gets the
 * current generation. Dev server only; the built site is untouched.
 *
 * Idempotent. Wired as a `postinstall` step next to the other patches.
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.resolve(
  __dirname, '..', 'node_modules', 'neuroglancer', 'config', 'static-site-live-server.js');

if (!fs.existsSync(serverPath)) {
  console.warn('[patch-live-server-nocache] file not found, skipping:', serverPath);
  process.exit(0);
}

const before = fs.readFileSync(serverPath, 'utf8');
const MARK = '/* nge: HTML never cached */';
if (before.includes(MARK)) {
  console.log('[patch-live-server-nocache] already patched');
  process.exit(0);
}

const target = ".on('file', file)";
if (!before.includes(target)) {
  console.error('[patch-live-server-nocache] could not find the send() chain to patch');
  process.exit(1);
}
// send emits 'headers' before it checks freshness, so dropping the validators
// here also stops the 304.
const added = `${target}
          .on('headers', ${MARK} (r, p) => {
            if (/\\.x?html?$/i.test(p)) {
              r.setHeader('Cache-Control', 'no-store');
              r.removeHeader('ETag');
              r.removeHeader('Last-Modified');
            }
          })`;
fs.writeFileSync(serverPath, before.replace(target, added));
console.log('[patch-live-server-nocache] patched', serverPath);
