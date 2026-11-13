#!/usr/bin/env node
/**
 * Deletes old player screenshots from Supabase Storage so the bucket does
 * not fill up (Ames 2026-10-07: "delete screenshots... so that we don't run
 * out of storage"; 14 days, once screenshots were also stored compressed).
 *
 * Images admins sent in replies (admin-uploads/reply-images/) go after 7
 * days once their report is closed, see cleanReplyImages below. Files on To do
 * cards go 7 days after the card is Done, see cleanTodoFiles, and so do
 * pictures on them, see cleanTodoImages. Cards themselves are never deleted.
 *
 * Only the folder admin-uploads/help-screenshots/ is ever touched. Achievement
 * art, notification images and blog images live in other folders.
 *
 * A screenshot is KEPT, whatever its age, while any of these still point at it:
 *   - a help request that is still open, or a reply on one
 *   - an issue tag that is still open
 *   - a saved Working Link
 *   - any notification or chat message
 *   - any bug report or triage card, however old (Ames 2026-11-13: "Don't
 *     delete the screenshots attached to bug reports"). They are stored
 *     compressed, WebP at most 2560 px, a fraction of the PNG.
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
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 14);
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

async function listFolder(prefix, bucket = BUCKET) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
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
  // Bug reports keep their screenshots for good.
  for (const i of await allRows('site_issues')) protect(i, 'bug report');
  for (const c of await allRows('feedback_triage', 'select=*', { optional: true })) protect(c, 'triage card');

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


// ── Images in replies to submitters (Ames 2026-10-20: "delete them after 7
// days") ──
// admin-uploads/reply-images/ only. Every image there older than
// REPLY_IMAGE_DAYS is deleted, whatever points at it. Then a reply card in a
// player's bell that showed it gets a Nurro neuron picture again, and the
// triage card's thread says the image was removed.
const REPLY_FOLDER = 'reply-images';
const REPLY_IMAGE_DAYS = Number(process.env.REPLY_IMAGE_DAYS || 7);
const NEURON_ART = n => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/nurro-neurons/neuron-${1 + (n % 24)}.jpg`;

async function cleanReplyImages() {
  const files = [];
  for (const owner of await listFolder(REPLY_FOLDER)) {
    if (owner.id) continue;   // nothing is written straight into the folder
    for (const f of await listFolder(`${REPLY_FOLDER}/${owner.name}`)) {
      if (f.id) files.push({ path: `${REPLY_FOLDER}/${owner.name}/${f.name}`, created: f.created_at, size: f.metadata?.size || 0 });
    }
  }
  // Only on closed reports (Ames 2026-11-09: "make sure the auto delete after
  // 7 days is only on closed reports"). An image on a triage card that is not
  // done or dismissed stays, whatever its age.
  const triage = await allRows('feedback_triage', 'select=id,status,feedback_log', { optional: true });
  const keepOpen = new Set();
  for (const c of triage) {
    if (c.status === 'done' || c.status === 'dismissed') continue;
    for (const e of Array.isArray(c.feedback_log) ? c.feedback_log : []) if (e && e.image_url) keepOpen.add(e.image_url);
  }
  const urlOf = p => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}`;
  const held = files.filter(f => keepOpen.has(urlOf(f.path))).length;
  const doomed = files.filter(f => (now - new Date(f.created).getTime()) / DAY > REPLY_IMAGE_DAYS && !keepOpen.has(urlOf(f.path)));
  console.log(`[cleanup] ${held} reply images kept on open reports`);
  console.log(`[cleanup] ${files.length} reply images stored; ${DELETE ? 'deleting' : 'would delete'} ${doomed.length} older than ${REPLY_IMAGE_DAYS} days, ${mb(doomed.reduce((a, f) => a + f.size, 0))}`);
  if (!DELETE || !doomed.length) return;

  const gone = [];
  for (let i = 0; i < doomed.length; i += 100) {
    const batch = doomed.slice(i, i + 100).map(f => f.path);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: HEADERS, body: JSON.stringify({ prefixes: batch }) });
    if (!res.ok) throw new Error(`reply image delete failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    gone.push(...batch);
  }
  console.log(`[cleanup] deleted ${gone.length} reply images`);
  const urls = new Set(gone.map(p => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}`));

  // The player's reply card: a neuron picture again, not a broken image.
  let cards = 0;
  for (const n of await allRows('notifications', 'select=id,image_url&image_url=like.*%2Freply-images%2F*')) {
    if (!urls.has(n.image_url)) continue;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${n.id}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ image_url: NEURON_ART(Number(n.id) || 0) }) });
    if (res.ok) cards++; else console.warn(`[cleanup] could not reset notification ${n.id}: ${res.status}`);
  }
  console.log(`[cleanup] reset ${cards} reply cards to a neuron picture`);

  // The triage card's thread: "Image removed after 7 days".
  let threads = 0;
  for (const c of triage) {
    const log = Array.isArray(c.feedback_log) ? c.feedback_log : [];
    if (!log.some(e => e && urls.has(e.image_url))) continue;
    const next = log.map(e => (e && urls.has(e.image_url) ? { ...e, image_url: null, image_removed: true } : e));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback_triage?id=eq.${c.id}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ feedback_log: next }) });
    if (res.ok) threads++; else console.warn(`[cleanup] could not mark triage card ${c.id}: ${res.status}`);
  }
  console.log(`[cleanup] marked ${threads} triage threads`);
}

// ── Files on To do cards (Ames 2026-11-09: "delete files after 7 days") ──
// admin-files/todo-files/<owner>/<id>/<name>. Every file older than
// TODO_FILE_DAYS on a card Done for TODO_FILE_DAYS is deleted, and its link on the card stays, greyed, as
// "name (deleted after 7 days)" (TodoBoard.vue shows such a link as gone).
const FILE_BUCKET = 'admin-files';
const FILE_FOLDER = 'todo-files';
const TODO_FILE_DAYS = Number(process.env.TODO_FILE_DAYS || 7);
const GONE = ' (deleted after 7 days)';

async function cleanTodoFiles() {
  const files = [];
  let owners;
  try { owners = await listFolder(FILE_FOLDER, FILE_BUCKET); }
  catch (e) { console.log(`[cleanup] no To do files to look at (${e.message.slice(0, 80)})`); return; }
  for (const owner of owners) {
    if (owner.id) continue;
    for (const dir of await listFolder(`${FILE_FOLDER}/${owner.name}`, FILE_BUCKET)) {
      if (dir.id) continue;
      for (const f of await listFolder(`${FILE_FOLDER}/${owner.name}/${dir.name}`, FILE_BUCKET)) {
        if (f.id) files.push({ path: `${FILE_FOLDER}/${owner.name}/${dir.name}/${f.name}`, created: f.created_at, size: f.metadata?.size || 0 });
      }
    }
  }
  // Only on closed cards (Ames 2026-11-09: "only on closed reports"): a file
  // goes once its card has been Done for TODO_FILE_DAYS. A file no card links
  // to any more goes after TODO_FILE_DAYS.
  const base = `${SUPABASE_URL}/storage/v1/object/public/${FILE_BUCKET}/`;
  const pathOf = url => { if (!url.startsWith(base)) return ''; try { return decodeURIComponent(url.slice(base.length).split('?')[0]); } catch { return ''; } };
  const todoCards = await allRows('admin_todos', 'select=id,list,done_at,links');
  const cardOf = new Map();
  for (const c of todoCards) for (const l of Array.isArray(c.links) ? c.links : []) { const p = l && pathOf(String(l.url || '')); if (p) cardOf.set(p, c); }
  const old = t => t && (now - new Date(t).getTime()) / DAY > TODO_FILE_DAYS;
  const closedLongEnough = c => c.list === 'done' && old(c.done_at);
  const doomed = files.filter(f => old(f.created) && (!cardOf.has(f.path) || closedLongEnough(cardOf.get(f.path))));
  console.log(`[cleanup] ${files.filter(f => cardOf.has(f.path) && !closedLongEnough(cardOf.get(f.path))).length} To do files kept on open cards`);
  console.log(`[cleanup] ${files.length} To do files stored; ${DELETE ? 'deleting' : 'would delete'} ${doomed.length} older than ${TODO_FILE_DAYS} days, ${mb(doomed.reduce((a, f) => a + f.size, 0))}`);
  if (!DELETE || !doomed.length) return;
  const gone = [];
  for (let i = 0; i < doomed.length; i += 100) {
    const batch = doomed.slice(i, i + 100).map(f => f.path);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${FILE_BUCKET}`, { method: 'DELETE', headers: HEADERS, body: JSON.stringify({ prefixes: batch }) });
    if (!res.ok) throw new Error(`To do file delete failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    gone.push(...batch);
  }
  console.log(`[cleanup] deleted ${gone.length} To do files`);
  const goneSet = new Set(gone);
  let marked = 0;
  for (const c of todoCards) {
    const links = Array.isArray(c.links) ? c.links : [];
    if (!links.some(l => l && goneSet.has(pathOf(String(l.url || ''))))) continue;
    const next = links.map(l => (l && goneSet.has(pathOf(String(l.url || ''))) && !String(l.label || '').endsWith(GONE)
      ? { ...l, label: String(l.label || 'File').slice(0, 80 - GONE.length) + GONE } : l));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_todos?id=eq.${c.id}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ links: next }) });
    if (res.ok) marked++; else console.warn(`[cleanup] could not mark To do card ${c.id}: ${res.status}`);
  }
  console.log(`[cleanup] marked ${marked} To do cards`);
}

// ── Pictures on To do cards (Ames 2026-11-09: "keep the cards just delete
// images and files") ──
// admin-uploads/todo-images/<owner>/<id>.<ext>. A picture goes once it is
// older than TODO_FILE_DAYS and every card showing it is closed: To do cards
// Done for TODO_FILE_DAYS, triage cards done or dismissed. The cards stay. A
// picture in a card's pictures is taken off it; one written into notes or a
// comment becomes the words "(picture deleted after 7 days)".
const IMG_FOLDER = 'todo-images';
const IMG_GONE = '(picture deleted after 7 days)';

async function cleanTodoImages() {
  const files = [];
  for (const owner of await listFolder(IMG_FOLDER)) {
    if (owner.id) continue;
    for (const f of await listFolder(`${IMG_FOLDER}/${owner.name}`)) {
      if (f.id) files.push({ path: `${IMG_FOLDER}/${owner.name}/${f.name}`, created: f.created_at, size: f.metadata?.size || 0 });
    }
  }
  const urlOf = p => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}`;
  const old = t => t && (now - new Date(t).getTime()) / DAY > TODO_FILE_DAYS;
  const rows = [
    ...(await allRows('admin_todos', 'select=*')).map(r => ({ table: 'admin_todos', r, closed: (r.list === 'done' || r.list === 'incomplete') && old(r.done_at) })),
    ...(await allRows('feedback_triage', 'select=*', { optional: true })).map(r => ({ table: 'feedback_triage', r, closed: r.status === 'done' || r.status === 'dismissed' })),
  ].map(x => ({ ...x, json: JSON.stringify(x.r) }));
  const users = f => rows.filter(x => x.json.includes(f.path));
  const held = files.filter(f => users(f).some(x => !x.closed)).length;
  const doomed = files.filter(f => old(f.created) && users(f).every(x => x.closed));
  console.log(`[cleanup] ${held} To do pictures kept on open cards`);
  console.log(`[cleanup] ${files.length} To do pictures stored; ${DELETE ? 'deleting' : 'would delete'} ${doomed.length}, ${mb(doomed.reduce((a, f) => a + f.size, 0))}`);
  if (!DELETE || !doomed.length) return;
  const gone = [];
  for (let i = 0; i < doomed.length; i += 100) {
    const batch = doomed.slice(i, i + 100).map(f => f.path);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: HEADERS, body: JSON.stringify({ prefixes: batch }) });
    if (!res.ok) throw new Error(`To do picture delete failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    gone.push(...batch);
  }
  console.log(`[cleanup] deleted ${gone.length} To do pictures`);
  const goneUrls = gone.map(urlOf);
  let marked = 0;
  for (const x of rows) {
    if (!gone.some(p => x.json.includes(p))) continue;
    const change = {};
    for (const [k, v] of Object.entries(x.r)) {
      const s = JSON.stringify(v);
      if (!gone.some(p => s.includes(p))) continue;
      if (k === 'images' && Array.isArray(v)) { change[k] = v.filter(u => !goneUrls.includes(String(u && (u.url || u)))); continue; }
      let t = s;
      for (const u of goneUrls) t = t.split(u).join(IMG_GONE);
      change[k] = JSON.parse(t);
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${x.table}?id=eq.${x.r.id}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(change) });
    if (res.ok) marked++; else console.warn(`[cleanup] could not mark ${x.table} ${x.r.id}: ${res.status}`);
  }
  console.log(`[cleanup] marked ${marked} cards`);
}

// Player screenshots first, then reply images, then To do files and pictures; one failing stops the run.
main().then(cleanReplyImages).then(cleanTodoFiles).then(cleanTodoImages).catch(e => { console.error('[cleanup] stopped, nothing more done:', e.message); process.exit(1); });
