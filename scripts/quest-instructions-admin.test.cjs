// The Cilia Quest Instructions box, as an admin, headless (Ames 2026-11-06:
// "retain the edit button and add an 'add image'").
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3563 --directory dist/min
// Run:    BASE=http://localhost:3563/ node scripts/quest-instructions-admin.test.cjs [shots dir]
// Checks: an admin sees Edit on the intro and the steps, and Change image /
// Remove image under the picture; Change image uploads (kind instructions)
// and saves the picture's address as the site text quest.retina_cilia.image,
// and the box shows the new picture; Remove image saves "none" and leaves the
// admin an Add image slot; Use original removes the saved text. Control: a
// player who is not an admin sees none of these buttons.
// Every server call is answered here; nothing reaches production.
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');

const BASE = process.env.BASE || 'http://localhost:3563/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots-instructions');
fs.mkdirSync(OUT, { recursive: true });
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const STORE = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/admin-uploads/instructions/test/new-picture.png';
// A real 2 x 2 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNwmPAfiBggFAAvtgc9nStJfQAAAABJRU5ErkJggg==', 'base64');
const RETINA_VIEW = '#!' + encodeURIComponent(JSON.stringify({
  dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [37166, 16688, 1973], layout: 'xy-3d',
  layers: [
    { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' },
    { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'stroeh_mouse_retina', segments: [] },
  ] }));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

async function session(browser, admin) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: ['https://global.daf-apis.com', 'https://minnie.microns-daf.com'] };
    try { localStorage.setItem('auth_token_v2_https://global.daf-apis.com/sticky_auth', JSON.stringify(token)); } catch (e) {}
    try { localStorage.setItem('nge-cilia-quest-intro-seen', '1'); } catch (e) {}
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Admin',
    permissions_v2: { 'stroeh-mouse-retina': ['view', 'edit'] } })));
  await context.route(/supabase\.co/, r => {
    if (/storage\/v1\/object\/public\/admin-uploads\//.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return r.fulfill(json([]));
  });
  const writes = [], uploads = [];
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    const url = r.request().url();
    if (/ewSheetSync/.test(url)) return r.fulfill(json({ ok: true, you: 'Test Admin', rows: [] }));
    if (/ewSecureUpload/.test(url)) { uploads.push({ kind: input.kind, contentType: input.contentType }); return r.fulfill(json({ url: STORE })); }
    if (input.table === 'site_texts' && input.method && input.method !== 'GET') { writes.push({ method: input.method, query: input.query, body: input.body }); return r.fulfill(json({ status: 201, headers: { 'Content-Type': 'application/json' }, body: '[]' })); }
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Admin', username: 'testadmin', middleauth_email: 't@example.org' }] : [];
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + RETINA_VIEW, { waitUntil: 'load' });
  await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
  await page.addStyleTag({ content: HIDE_CSS });
  await page.waitForTimeout(2500);
  await page.evaluate((admin) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const login = pinia._s.get('login');
    if (login && login.sessions.length === 0) login.sessions.push({ key: 'auth_token_v2_https://global.daf-apis.com/sticky_auth', name: 'Test Admin', email: 't@example.org', hostname: 'test' });
    const pb = pinia._s.get('proofreadingBackend');
    pb.userId = 'test-user'; pb.userName = 'Test Admin'; pb.username = 'testadmin';
    pb.isAdmin = admin;
  }, admin);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
  await page.waitForSelector('.nge-cl-panel', { timeout: 10000 });
  await page.click('.nge-cl-quests-tab');
  await page.waitForSelector('.nge-aq', { timeout: 10000 });
  await page.click('.nge-aq-info');
  await page.waitForSelector('.nge-qi', { timeout: 5000 });
  await page.waitForTimeout(1200);
  return { context, page, writes, uploads, errors };
}
const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('.nge-qi button')].map(b => b.textContent.trim()).filter(t => t && t !== '×'));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const a = await session(browser, true);
    const p = a.page;
    const first = await buttons(p);
    check('an admin keeps Edit on the intro and the steps', first.filter(t => t === 'Edit').length === 2, first);
    check('and gets Change image and Remove image under the picture', first.includes('Change image') && first.includes('Remove image'), first);
    await p.screenshot({ path: path.join(OUT, 'admin-box.png') });

    // Change image: upload, save the address, show it.
    await p.setInputFiles('.nge-qi .nge-edimg-file', { name: 'cilium.png', mimeType: 'image/png', buffer: PNG });
    await p.waitForFunction((u) => { const i = document.querySelector('.nge-qi .nge-qi-img'); return i && i.src === u; }, STORE, { timeout: 8000 }).catch(() => {});
    const saved = a.writes.filter(w => w.method === 'POST');
    check('Change image uploads as an instructions picture', a.uploads.length === 1 && a.uploads[0].kind === 'instructions' && a.uploads[0].contentType === 'image/png', a.uploads);
    const row = saved.length ? (Array.isArray(saved[0].body) ? saved[0].body[0] : saved[0].body) : null;
    check('and saves its address as quest.retina_cilia.image', row && row.key === 'quest.retina_cilia.image' && row.body === STORE, saved);
    check('the box shows the new picture', await p.evaluate((u) => { const i = document.querySelector('.nge-qi .nge-qi-img'); return !!i && i.src === u; }, STORE));
    const now = await buttons(p);
    check('with Use original offered now', now.includes('Use original'), now);

    // Remove image: "none", and the admin sees the Add image slot.
    await p.click('.nge-qi button:has-text("Remove image")');
    await p.waitForTimeout(500);
    const removed = a.writes.filter(w => w.method === 'POST').slice(-1)[0];
    const rrow = removed ? (Array.isArray(removed.body) ? removed.body[0] : removed.body) : null;
    check('Remove image saves "none"', rrow && rrow.key === 'quest.retina_cilia.image' && rrow.body === 'none', removed);
    const slot = await p.evaluate(() => ({ img: !!document.querySelector('.nge-qi .nge-qi-img'), add: (document.querySelector('.nge-qi .nge-edimg-empty') || {}).textContent || '', key: !!document.querySelector('.nge-qi .nge-qi-key') }));
    check('then no picture, no color key, and an Add image slot for the admin', !slot.img && !slot.key && /Add image/.test(slot.add), slot);
    await p.screenshot({ path: path.join(OUT, 'admin-add-image.png') });

    // Use original: the saved text is removed and the game's picture is back.
    await p.click('.nge-qi button:has-text("Use original")');
    await p.waitForTimeout(500);
    const del = a.writes.filter(w => w.method === 'DELETE').slice(-1)[0];
    check('Use original deletes the saved picture', del && /key=eq\.quest\.retina_cilia\.image/.test(del.query || ''), del);
    check('and the game\'s own picture shows again', await p.evaluate(() => { const i = document.querySelector('.nge-qi .nge-qi-img'); return !!i && /cilia-annotated/.test(i.src); }));
    check('no page errors (admin)', a.errors.length === 0, a.errors.slice(0, 3));
    await a.context.close();

    // Control: a player who is not an admin.
    const b = await session(browser, false);
    const theirs = await buttons(b.page);
    check('control: a player sees no Edit and no picture buttons', !theirs.some(t => /Edit|image|original/i.test(t)), theirs);
    check('control: a player still sees the picture', await b.page.evaluate(() => !!document.querySelector('.nge-qi .nge-qi-img')));
    await b.context.close();
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
  } finally {
    await browser.close();
  }
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
