#!/usr/bin/env node
/**
 * One-off: compresses the player screenshots that were stored before the app
 * began compressing them itself (Ames 2026-10-07). Each one is rewritten IN
 * PLACE, at the same address, as WebP with its long side at most 2560 px, so
 * every request, reply, tag, bug report and chat message that points at it
 * keeps working and nothing has to be relinked. (The address may still end in
 * .png; what a browser reads is the stored type, which becomes image/webp.)
 *
 * Careful by design:
 *   - it writes nothing unless WRITE=1; without it, it prints what it would do
 *   - a file is replaced only when the new one decodes, has the same shape as
 *     asked for, and is smaller
 *   - after a replacement it is read back and checked; a mismatch stops the run
 *   - a file that is already WebP or cannot be read is left alone
 * Safe to run again: files already done are skipped.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/recompress-screenshots.mjs
 */
import sharp from 'sharp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const WRITE = process.env.WRITE === '1';
const BUCKET = 'admin-uploads';
const FOLDER = 'help-screenshots';
const MAX_SIDE = 2560;
const QUALITY = 85;

const AUTH = { apikey: KEY, ...(KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${KEY}` }) };

async function listFolder(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`could not list ${prefix}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function download(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: AUTH });
  if (!res.ok) throw new Error(`could not download ${path}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const mb = bytes => (bytes / 1048576).toFixed(2) + ' MB';

async function main() {
  const files = [];
  for (const owner of await listFolder(FOLDER)) {
    if (owner.id) { files.push({ path: `${FOLDER}/${owner.name}`, type: owner.metadata?.mimetype, size: owner.metadata?.size || 0 }); continue; }
    for (const f of await listFolder(`${FOLDER}/${owner.name}`)) {
      if (f.id) files.push({ path: `${FOLDER}/${owner.name}/${f.name}`, type: f.metadata?.mimetype, size: f.metadata?.size || 0 });
    }
  }
  const before = files.reduce((a, f) => a + f.size, 0);
  console.log(`[recompress] ${files.length} player screenshots stored, ${mb(before)}`);

  let done = 0, skipped = 0, saved = 0;
  for (const f of files) {
    if (f.type === 'image/webp') { skipped++; continue; }
    let original, out, meta;
    try {
      original = await download(f.path);
      out = await sharp(original).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#000' }).webp({ quality: QUALITY }).toBuffer();
      meta = await sharp(out).metadata();
    } catch (e) { console.log(`  left alone (could not read): ${f.path}  ${e.message.slice(0, 80)}`); skipped++; continue; }
    if (meta.format !== 'webp' || !meta.width || !meta.height || Math.max(meta.width, meta.height) > MAX_SIDE) { console.log(`  left alone (bad result): ${f.path}`); skipped++; continue; }
    if (out.length >= original.length) { console.log(`  left alone (not smaller): ${f.path}`); skipped++; continue; }
    console.log(`  ${f.path}  ${mb(original.length)} -> ${mb(out.length)}  ${meta.width}x${meta.height}`);
    saved += original.length - out.length;
    done++;
    if (!WRITE) continue;

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${f.path}`, {
      method: 'PUT', headers: { ...AUTH, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'max-age=3600' }, body: out,
    });
    if (!res.ok) throw new Error(`could not replace ${f.path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    // Read it back: what is stored must be exactly what was sent.
    const stored = await download(f.path);
    if (!stored.equals(out)) throw new Error(`${f.path} read back differently after the write. Stopping.`);
  }
  console.log(`[recompress] ${WRITE ? 'compressed' : 'would compress'} ${done}, left ${skipped} alone, ${WRITE ? 'saved' : 'would save'} ${mb(saved)} (${mb(before)} -> ${mb(before - saved)})`);
  if (!WRITE) console.log('[recompress] DRY RUN, nothing written. Set WRITE=1 to write.');
}

main().catch(e => { console.error('[recompress] stopped:', e.message); process.exit(1); });
