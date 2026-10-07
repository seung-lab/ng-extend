#!/usr/bin/env node
/**
 * Deletes old player screenshots from Supabase Storage so the bucket does
 * not fill up (Ames 2026-10-07: "delete screenshots that are over 7 days
 * old for now, so that we don't run out of storage").
 *
 * Only the folder admin-uploads/help-screenshots/ is ever touched. Achievement
 * art, notification images and blog images live in other folders.
 *
 * A screenshot is KEPT, whatever its age, while any of these still point at it:
 *   - a help request that is still open, or a reply on one
 *   - an issue tag that is still open
 *   - a saved Working Link
 *   - any notification or chat message
 *   - a bug report (or its triage card) newer than BUG_REPORT_DAYS
 * Everything else older than MAX_AGE_DAYS is deleted, and the link on the
 * row that pointed at it is cleared so nothing shows a broken image.
 *
 * It writes nothing unless DELETE=1. Without it, it prints what it would do.
 * If any table it must read cannot be read, it stops and deletes nothing.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-screenshots.mjs
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const DELETE = process.env.DELETE === '1';
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 7);
const BUG_REPORT_DAYS = Number(process.env.BUG_REPORT_DAYS || 30);
const BUCKET = 'admin-uploads';
const FOLDER = 'help-screenshots';
const DAY = 86400000;
const now = Date.now();

const HEADERS = { apikey: KEY, ...(KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${KEY}` }), 'Content-Type': 'application/json' };

/** Every row of a table, a thousand at a time in a fixed order. */
async function allRows(table, query = 'select=*', { optional = false } = {}) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}&order=id.asc`, { headers: { ...HEADERS, Range: `${from}-${from + 999}` } });
    if (!res.ok) {
      const text = await res.text();
      if (optional && (res.status === 404 || /PGRST205|does not exist|schema cache/i.test(text))) { console.log(`[cleanup] no table ${table}, skipped`); return []; }
      throw new Error(`could not read ${table}: ${res.status} ${text.slice(0, 200)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

/** The storage paths (help-screenshots/owner/file) mentioned anywhere in a row. */
const PATH = new RegExp(`${FOLDER}/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+`, 'g');
const pathsIn = value => (JSON.stringify(value ?? '').match(PATH) || []);

async function listFolder(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`could not list ${prefix}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const mb = bytes => (bytes / 1048576).toFixed(1) + ' MB';

async function main() {
  // 1. What is stored.
  const files = [];
  for (const owner of await listFolder(FOLDER)) {
    if (owner.id) { files.push({ path: `${FOLDER}/${owner.name}`, created: owner.created_at, size: owner.metadata?.size || 0 }); continue; }
    for (const f of await listFolder(`${FOLDER}/${owner.name}`)) {
      if (!f.id) continue;   // a deeper folder: not something this app writes
      files.push({ path: `${FOLDER}/${owner.name}/${f.name}`, created: f.created_at, size: f.metadata?.size || 0 });
    }
  }
  const total = files.reduce((a, f) => a + f.size, 0);
  console.log(`[cleanup] ${files.length} player screenshots stored, ${mb(total)}`);

  // 2. What still needs them.
  const keep = new Map();   // path -> why
  const protect = (value, why) => { for (const p of pathsIn(value)) if (!keep.has(p)) keep.set(p, why); };

  const requests = await allRows('help_requests', 'select=id,resolved,screenshot_url');
  const open = new Set(requests.filter(r => !r.resolved).map(r => r.id));
  for (const r of requests) if (!r.resolved) protect(r.screenshot_url, 'open help request');
  for (const r of await allRows('help_responses', 'select=id,request_id,screenshot_url')) if (open.has(r.request_id)) protect(r.screenshot_url, 'reply on an open help request');
  for (const t of await allRows('issue_tags', 'select=id,status,screenshot_url')) if (t.status !== 'resolved') protect(t.screenshot_url, 'open issue tag');
  for (const l of await allRows('working_links', 'select=id,screenshot_url,note')) protect(l, 'saved Working Link');
  for (const n of await allRows('notifications')) protect(n, 'notification');
  for (const m of await allRows('chat_messages', `select=id,text&text=ilike.*${FOLDER}*`)) protect(m, 'chat message');
  const recent = row => !row.created_at || now - new Date(row.created_at).getTime() < BUG_REPORT_DAYS * DAY;
  for (const i of await allRows('site_issues')) if (recent(i)) protect(i, `bug report under ${BUG_REPORT_DAYS} days old`);
  for (const c of await allRows('feedback_triage', 'select=*', { optional: true })) if (recent(c)) protect(c, `triage card under ${BUG_REPORT_DAYS} days old`);

  // 3. What goes.
  const doomed = [], kept = {};
  for (const f of files) {
    const age = (now - new Date(f.created).getTime()) / DAY;
    if (!(age > MAX_AGE_DAYS)) { kept[`under ${MAX_AGE_DAYS} days old`] = (kept[`under ${MAX_AGE_DAYS} days old`] || 0) + 1; continue; }
    const why = keep.get(f.path);
    if (why) { kept[why] = (kept[why] || 0) + 1; continue; }
    doomed.push({ ...f, age });
  }
  for (const [why, n] of Object.entries(kept)) console.log(`[cleanup] kept ${n}: ${why}`);
  console.log(`[cleanup] ${DELETE ? 'deleting' : 'would delete'} ${doomed.length} screenshots, ${mb(doomed.reduce((a, f) => a + f.size, 0))}`);
  for (const f of doomed) console.log(`  ${f.path}  ${Math.round(f.age)} days  ${mb(f.size)}`);
  if (!DELETE) { console.log('[cleanup] DRY RUN, nothing deleted. Set DELETE=1 to delete.'); return; }
  if (!doomed.length) return;

  // 4. Delete, then clear the links that pointed at what is gone.
  let gone = [];
  for (let i = 0; i < doomed.length; i += 100) {
    const batch = doomed.slice(i, i + 100).map(f => f.path);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: HEADERS, body: JSON.stringify({ prefixes: batch }) });
    if (!res.ok) throw new Error(`delete failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    gone = gone.concat(batch);
  }
  console.log(`[cleanup] deleted ${gone.length} screenshots`);
  const urlOf = p => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}`;
  for (const table of ['help_requests', 'help_responses', 'issue_tags', 'site_issues']) {
    let cleared = 0;
    for (let i = 0; i < gone.length; i += 40) {
      const list = gone.slice(i, i + 40).map(p => `"${urlOf(p)}"`).join(',');
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?screenshot_url=in.(${encodeURIComponent(list)})`, {
        method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=representation' }, body: JSON.stringify({ screenshot_url: null }),
      });
      if (!res.ok) { console.warn(`[cleanup] could not clear links in ${table}: ${res.status} ${(await res.text()).slice(0, 160)}`); break; }
      cleared += (await res.json()).length;
    }
    console.log(`[cleanup] cleared ${cleared} links in ${table}`);
  }
}

main().catch(e => { console.error('[cleanup] stopped, nothing more done:', e.message); process.exit(1); });
