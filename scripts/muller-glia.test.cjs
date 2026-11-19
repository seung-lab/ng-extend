// The Muller Glia Quest mockup in the Quests tab, headless (2026-11-19).
// Built from scripts/quests-tab.test.cjs: every server is stubbed.
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3488 --directory dist/min
// Run:    node scripts/quests-tab.test.cjs [shots dir]
// Every server call is answered here: the quest sheet gateway (ewSheetSync),
// the data gateway, the state servers and every middleauth host. Nothing can
// reach production. One 401 with the fake token would make the middleauth
// provider wait for a login for good, so no middleauth host is ever reached.
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');

const BASE = process.env.BASE || 'http://localhost:3495/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots-muller');
fs.mkdirSync(OUT, { recursive: true });
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';

const START = 'https://spelunker.cave-explorer.org/#!middleauth+https://global.daf-apis.com/nglstate/api/v1/5309136999809024';
const row = (index, segmentId, cellType, over = {}) => ({ index, segmentId, soma: '37166, 16688, 1973', cellClass: 'AC', cellType, startLink: START, status: '', splitMerged: '', link: '', annotator: '', date: '', notes: '', ...over });
const ROWS = [
  row('A5', '720575940561794892', 'OFF SAC'),
  row('A7', '720575940572159335', 'OFF SAC'),
  row('A20', '720575940551642305', 'ON SAC', { annotator: 'Nseraf' }),
  row('A40', '720575940553016515', 'ON SAC', { annotator: 'Celia D', status: 'No cilium', date: '10/11/2026', link: 'https://x.test/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/9' }),
];
const calls = [];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const RETINA_LAYERS = [
  { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' },
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'stroeh_mouse_retina', segments: ['720575940561794892'] },
  { type: 'annotation', source: 'local://annotations', name: 'cilia', annotations: [{ type: 'point', id: 'a', point: [37100, 16600, 1970] }, { type: 'point', id: 'b', point: [37200, 16700, 1975] }] },
  // The lab's own layers, as its Start Links carry them (its spelling).
  { type: 'annotation', source: 'local://annotations', name: 'Daugther centriole', annotations: [], annotationColor: '#ff0000' },
  { type: 'annotation', source: 'local://annotations', name: 'Basal body', annotations: [], annotationColor: '#ffff00' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // A stored middleauth token the way the provider expects it: under the
  // login URL that /auth_info names, and listing the app URLs it may be used
  // for (the provider refuses a token whose appUrls lack the server).
  await context.addInitScript(() => { try { localStorage.setItem('nge-cilia-training-autoplayed', '1'); localStorage.setItem('nge-cilia-quest-intro-seen', '1'); } catch (e) {} });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate', host + '/nglstate/', host + '/nglstate/api/v1', host + '/segmentation', host + '/segmentation/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) {
      try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {}
    }
  });
  // Nothing with the fake token may reach a real middleauth server: one 401
  // makes the provider wait for a login for good. Registered first, so every
  // specific answer below takes precedence (the last registered route wins).
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  // The segmentation server would answer the fake token with 401, and one 401
  // makes the middleauth provider wait for a login for good. Keep it out of reach.
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  // The crosshair check asks the chunked graph for the root of the supervoxel
  // under the crosshairs: answer with the quest cell's own ID.
  await context.route(/minnie\.microns-daf\.com\/segmentation\/api\/v1\/table\/[^/]+\/node\/\d+\/root/, r => r.fulfill(json({ root_id: '720575940561794892', root: '720575940561794892' })));
  // The provider checks a stored token against the login server's user/me.
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/cache/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player', permissions_v2: { 'stroeh-mouse-retina': ['view', 'edit'], stroeh_mouse_retina: ['view', 'edit'] } })));
  await context.route(/daf-apis\.com\/auth\/api\/v1\/user\/me|microns-daf\.com\/auth\/api\/v1\/user\/me/, r => r.fulfill(json({ email: 't@example.org', name: 'Test Player' })));
  // The quest gateway and the data gateway.
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    const u = r.request().url();
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    if (/ewSheetSync/.test(u)) {
      calls.push({ action: input.action, quest: input.quest, segmentId: input.segmentId, status: input.status, splitMerged: input.splitMerged, link: input.link, notes: input.notes, hasToken: !!input.token });
      const hit = ROWS.find(x => x.segmentId === String(input.segmentId));
      if (input.quest !== 'retina_cilia') return r.fulfill(json({ error: 'There is no such quest.' }, 400));
      // `you`: the sheet's spelling of the player's name, which differs from the game's.
      if (input.action === 'quest_list') return r.fulfill(json({ ok: true, you: 'Test R. Player', rows: ROWS }));
      if (!hit) return r.fulfill(json({ error: 'This cell is not in the quest sheet.' }, 409));
      if (input.action === 'quest_claim') { if (hit.annotator && hit.annotator !== 'Test R. Player') return r.fulfill(json({ error: 'Someone else has this cell.' }, 409)); hit.annotator = 'Test R. Player'; return r.fulfill(json({ ok: true, updated: 1 })); }
      if (input.action === 'quest_release') { hit.annotator = ''; return r.fulfill(json({ ok: true, updated: 1 })); }
      if (input.action === 'quest_submit') { Object.assign(hit, { annotator: 'Test R. Player', status: input.status, splitMerged: input.splitMerged || '', link: input.link, notes: input.notes || '', date: '10/12/2026' }); return new Promise(res => setTimeout(() => { r.fulfill(json({ ok: true, updated: 6 })); res(); }, 1500)); }
      return r.fulfill(json({ error: 'Invalid quest action.' }, 400));
    }
    // The data gateway: the player's own profile row, nothing else.
    const rows = input.table === 'users' && String(input.method || 'GET').toUpperCase() === 'GET'
      ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org', total_edits: 0, cells_completed: 0 }]
      : [];
    const single = /pgrst\.object/.test(String(input.accept || ''));
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(single ? (rows[0] || null) : rows) }));
  });
  await context.route(/supabase\.co/, r => r.request().method() !== 'GET' ? r.fulfill(json([])) : r.fulfill(json([])));
  // State servers: the start link's state (loaded on Take) and the share link (minted on Submit).
  await context.route(/global\.daf-apis\.com\/nglstate\/api\/v1\/\d+/, r => r.fulfill(json({ dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [37166, 16688, 1973], layers: RETINA_LAYERS, layout: 'xy-3d', selectedLayer: { layer: 'Basal body', visible: true }, selection: { visible: true } })));
  await context.route(/global\.brain-wire-test\.org\/nglstate\/api\/v1\/post/, r => { calls.push({ action: 'mint', method: r.request().method() }); return r.fulfill(json('https://global.brain-wire-test.org/nglstate/api/v1/4242')); });

  const page = await context.newPage();
  // A sign-in popup, should one open, is closed: the test never signs in.
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && /quest|Quest|aq-/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); if (/middleauth|MiddleAuth|state_link|nglstate|UnverifiedApp/i.test(m.text())) console.log('  console[' + m.type() + '] ' + m.text().slice(0, 220)); });
  page.on('request', r => { if (/daf-apis|brain-wire-test|auth_info/.test(r.url())) console.log('  req ' + r.method() + ' ' + r.url().slice(0, 120)); });
  page.on('requestfailed', r => { if (/daf-apis|brain-wire-test/.test(r.url())) console.log('  FAILED ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText); });
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('  NAV ' + f.url().slice(0, 140)); });
  const statusText = () => page.evaluate(() => (document.getElementById('statusContainer') || {}).innerText || '');
  const shot = async (name) => {
    const box = await page.locator('.nge-cl-panel').boundingBox().catch(() => null);
    if (box) await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: Math.max(0, box.x - 2), y: Math.max(0, box.y - 2), width: Math.min(1400, box.width + 4), height: Math.min(900, box.height + 4) } });
    else await page.screenshot({ path: path.join(OUT, name + '.png') });
  };
  const tabText = () => page.evaluate(() => (document.querySelector('.nge-aq') || {}).innerText || '');
  try {
    await page.goto(BASE, { waitUntil: 'load' });
    // The first load switches to Retina and reloads: wait until the page stays put.
    let navs = 0; page.on('framenavigated', () => navs++);
    for (let i = 0, last = -1; i < 20 && navs !== last; i++) { last = navs; await page.waitForTimeout(4000); }
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; pb.userEmail = 't@example.org'; } catch (e) {} }
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }, HIDE_CSS);
    await page.waitForTimeout(3500);
    // The app's own sign-in flow may have run meanwhile: put the test identity back.
    await page.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; pb.userEmail = 't@example.org'; } catch (e) {} }
    });
    await page.waitForTimeout(300);
    let fails = 0;
    const ok = (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) fails++; };
    await page.evaluate(() => { try { localStorage.removeItem('nge_muller_glia_mock_v1'); } catch (e) {} });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
    await page.waitForTimeout(800);
    await page.click('.nge-cl-quests-tab');
    await page.waitForTimeout(500);
    if (await page.locator('.nge-cl-quests-switch').count()) {
      await page.click('.nge-cl-quests-switch');
      for (let i = 0, last = -1; i < 20 && navs !== last; i++) { last = navs; await page.waitForTimeout(4000); }
      await page.evaluate((css) => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        const pb = pinia._s.get('proofreadingBackend');
        if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; pb.userEmail = 't@example.org'; } catch (e) {} }
        const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      }, HIDE_CSS);
      await page.waitForTimeout(3000);
      if (!(await page.locator('.nge-cl-questpick, .nge-cl-quests-tab').count())) await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
      await page.waitForTimeout(800);
      await page.click('.nge-cl-quests-tab');
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(OUT, '0-debug.png') });
    console.log('  panel: ' + await page.locator('.nge-cl-panel').count() + ' tabs ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.nge-cl-filters button')].map(b => b.textContent.trim()))));
    console.log('  list: ' + JSON.stringify(await page.evaluate(() => (document.querySelector('.nge-cl-list')||{}).innerText?.slice(0,200))) + ' layers ' + await page.evaluate(() => window.viewer.layerManager.managedLayers.map(l=>l.name).join(',')));
    ok(await page.locator('.nge-cl-questpick button').count() === 2, 'quest picker shows two quests');
    await page.click('.nge-cl-questpick button >> nth=1');
    await page.waitForTimeout(400);
    ok(await page.locator('.nge-mg').count() === 1, 'Muller Glia Quest opens');
    await shot('1-stage1');
    const first = await page.locator('.nge-mg-card-name').innerText();
    await page.click('.nge-mg-card .nge-mg-btn');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina'); const gs = g && g.layer.displayState.segmentationGroupState.value; return { vis: gs ? [...gs.visibleSegments].map(String) : [], pos: [...window.viewer.navigationState.position.value].map(Math.round) }; });
    console.log('  after Open: ' + JSON.stringify(after));
    ok(after.vis.length === 1, 'Open shows only that cell');
    for (const n of [0, 1, 2]) { await page.locator('.nge-mg-answers button').nth(n).click({ timeout: 5000 }); await page.waitForTimeout(250); }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nge_muller_glia_mock_v1') || '{}'));
    ok(Object.keys(saved.answers || {}).length === 3 && saved.answers[first] === 'yes', 'three answers kept in this browser, first is Yes');
    await shot('2-answered');
    await page.evaluate(() => document.querySelector('.nge-mg-row .nge-mg-btn--sm').click());
    await page.waitForTimeout(200);
    ok(Object.keys(JSON.parse(await page.evaluate(() => localStorage.getItem('nge_muller_glia_mock_v1'))).answers).length === 2, 'Undo removes an answer');
    await page.evaluate(() => document.querySelectorAll('.nge-mg-stage')[1].click());
    await page.waitForTimeout(300);
    console.log('  stage2 text: ' + JSON.stringify((await page.locator('.nge-mg').innerText()).slice(0, 600)));
    ok(/Merged pairs/i.test(await page.locator('.nge-mg').innerText()), 'Stage 2 lists merged pairs');
    await page.evaluate(() => document.querySelector('.nge-mg-row .nge-mg-btn--sm').click());
    await page.waitForTimeout(300);
    await shot('3-stage2');
    await page.evaluate(() => document.querySelector('.nge-mg-btn--b').click());
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('.nge-mg-btn--go').click());
    await page.waitForTimeout(2500);
    console.log('  check note (servers stubbed): ' + JSON.stringify(await page.evaluate(() => (document.querySelector('.nge-mg-pair .nge-mg-msg') || {}).innerText || '')));
    await shot('4-stage2-check');
    const writes = calls.filter(c => c.action && c.action !== 'quest_list');
    ok(writes.length === 0, 'no server writes from the mockup');
    console.log(errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors');
    console.log(fails ? fails + ' FAILED' : 'all passed');
  } catch (e) { console.log('ERROR ' + (e && e.stack || e)); }
  await browser.close();
})();
