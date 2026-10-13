// The Cell Library's Quests tab, headless (Annotation Quests, 2026-10-12).
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

const BASE = 'http://localhost:3488/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots5');
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
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/cache/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
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
      if (input.action === 'quest_submit') { Object.assign(hit, { annotator: 'Test R. Player', status: input.status, splitMerged: input.splitMerged || '', link: input.link, notes: input.notes || '', date: '10/12/2026' }); return r.fulfill(json({ ok: true, updated: 6 })); }
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
  await context.route(/global\.daf-apis\.com\/nglstate\/api\/v1\/\d+/, r => r.fulfill(json({ dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [37166, 16688, 1973], layers: RETINA_LAYERS, layout: 'xy-3d' })));
  await context.route(/global\.brain-wire-test\.org\/nglstate\/api\/v1\/post/, r => { calls.push({ action: 'mint', method: r.request().method() }); return r.fulfill(json('https://global.brain-wire-test.org/nglstate/api/v1/4242')); });

  const page = await context.newPage();
  // A sign-in popup, should one open, is closed: the test never signs in.
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && /quest|Quest|aq-/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); if (/middleauth|MiddleAuth|state_link|nglstate|UnverifiedApp/i.test(m.text())) console.log('  console[' + m.type() + '] ' + m.text().slice(0, 220)); });
  page.on('request', r => { if (/daf-apis|brain-wire-test|auth_info/.test(r.url())) console.log('  req ' + r.method() + ' ' + r.url().slice(0, 120)); });
  page.on('requestfailed', r => { if (/daf-apis|brain-wire-test/.test(r.url())) console.log('  FAILED ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText); });
  const statusText = () => page.evaluate(() => (document.getElementById('statusContainer') || {}).innerText || '');
  const shot = async (name) => {
    const box = await page.locator('.nge-cl-panel').boundingBox().catch(() => null);
    if (box) await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: Math.max(0, box.x - 2), y: Math.max(0, box.y - 2), width: Math.min(1400, box.width + 4), height: Math.min(900, box.height + 4) } });
    else await page.screenshot({ path: path.join(OUT, name + '.png') });
  };
  const tabText = () => page.evaluate(() => (document.querySelector('.nge-aq') || {}).innerText || '');
  try {
    await page.goto(BASE, { waitUntil: 'load' });
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
    console.log('backend: ' + await page.evaluate(() => { const pb = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend'); return JSON.stringify({ userId: pb.userId, userName: pb.userName, username: pb.username }); }));
    console.log('dataset on screen: ' + await page.evaluate(() => { try { return window.viewer.layerManager.managedLayers.map(l => l.name).join(','); } catch (e) { return String(e); } }));
    // Shift+L opens the Cell Library.
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
    await page.waitForSelector('.nge-cl-panel', { timeout: 10000 });
    await page.waitForTimeout(800);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.nge-cl-filters button')].map(b => b.textContent.trim().replace(/\s+/g, ' ')));
    console.log('tabs: ' + JSON.stringify(tabs));
    await page.click('.nge-cl-quests-tab');
    await page.waitForSelector('.nge-aq', { timeout: 10000 });
    await page.waitForTimeout(1200);
    console.log('list calls: ' + JSON.stringify(calls));
    console.log('tab text: ' + JSON.stringify((await tabText()).slice(0, 700)));
    await shot('quests-list');

    // Jump: only that cell stays visible, and the view goes to its soma.
    await page.evaluate(() => { try { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina').layer.displayState.segmentationGroupState.value; g.visibleSegments.clear(); for (const id of ['1111', '2222', '3333']) g.visibleSegments.add(id); } catch (e) {} });
    await page.click('.nge-aq-row .nge-aq-btn--jump >> nth=0');
    await page.waitForTimeout(400);
    console.log('current row after jump: ' + await page.evaluate(() => [...document.querySelectorAll('.nge-aq-row--current .nge-aq-row-name')].map(e => e.textContent.trim())));
    console.log('after jump: ' + await page.evaluate(() => { try { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina').layer.displayState.segmentationGroupState.value; return JSON.stringify({ visible: [...g.visibleSegments].map(String), position: [...window.viewer.navigationState.position.value].map(Math.round) }); } catch (e) { return String(e); } }));
    // Claim the first open cell.
    const questLogs = [];
    page.on('console', m => { if (/\[quests\]/.test(m.text())) questLogs.push(m.type() + ': ' + m.text().slice(0, 240)); });
    await page.click('.nge-aq-btn--take >> nth=0');
    for (const t of [500, 1500, 3000, 6000]) { await page.waitForTimeout(t === 500 ? 500 : t === 1500 ? 1000 : t === 3000 ? 1500 : 3000); console.log('  layers at ' + t + 'ms: ' + await page.evaluate(() => window.viewer.layerManager.managedLayers.map(l => l.name + (l.layer && l.layer.type === 'annotation' ? '(' + [...l.layer.annotationDisplayState.color.value].map(v => Math.round(v * 255)).join(',') + ')' : '')).join(' | '))); }
    console.log('quest logs: ' + JSON.stringify(questLogs));
    console.log('after take, hash: ' + await page.evaluate(() => location.hash.slice(0, 90)));
    console.log('after take, layer colours: ' + await page.evaluate(() => { try { return JSON.stringify(window.viewer.layerManager.managedLayers.filter(l => l.layer && l.layer.type === 'annotation').map(l => ({ name: l.name, color: [...l.layer.annotationDisplayState.color.value].map(v => Math.round(v * 255)), tool: l.layer.tool && l.layer.tool.value ? String(l.layer.tool.value.toJSON ? l.layer.tool.value.toJSON() : l.layer.tool.value) : '' }))); } catch (e) { return String(e); } }));
    console.log('after take, layers: ' + await page.evaluate(() => { try { return window.viewer.layerManager.managedLayers.map(l => l.name).join(','); } catch (e) { return String(e); } }));
    console.log('after take, status bar: ' + JSON.stringify((await statusText()).slice(0, 300)));
    console.log('after take, layer json: ' + await page.evaluate(() => { try { return JSON.stringify(window.viewer.state.toJSON().layers.map(l => ({ type: l.type, name: l.name, n: Array.isArray(l.annotations) ? l.annotations.length : null, keys: Object.keys(l) }))); } catch (e) { return String(e); } }));
    console.log('after take, managed: ' + await page.evaluate(() => { try { return JSON.stringify(window.viewer.layerManager.managedLayers.map(ml => ({ name: ml.name, type: ml.layer && ml.layer.type, local: ml.layer && ml.layer.localAnnotations ? (ml.layer.localAnnotations.toJSON ? ml.layer.localAnnotations.toJSON().length : 'nojson') : null }))); } catch (e) { return String(e); } }));
    console.log('after take, text: ' + JSON.stringify((await tabText()).slice(0, 400)));
    await shot('quests-taken');

    // Mark two cilia the way a player would, through the layer itself.
    console.log('added points: ' + await page.evaluate(() => {
      try {
        const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'cilia');
        const src = ml.layer.localAnnotations;
        src.add({ id: 'c1', type: 0, point: Float32Array.from([37100, 16600, 1970]), properties: [] });
        src.add({ id: 'c2', type: 0, point: Float32Array.from([37200, 16700, 1975]), properties: [] });
        return src.toJSON().length;
      } catch (e) { return String(e); }
    }));
    // The segmentation never loads here (no sign in), so stand in for the value
    // under the crosshairs: a supervoxel of the quest cell.
    await page.evaluate(() => { const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina'); ml.layer.getValueAt = () => '123456789'; });
    // Submit it.
    await page.click('.nge-aq-row--mine .nge-aq-btn--submit');
    await page.waitForSelector('.nge-aq-form', { timeout: 5000 });
    const options = await page.evaluate(() => [...document.querySelectorAll('.nge-aq-form select option')].map(o => o.textContent.trim()));
    console.log('status options: ' + JSON.stringify(options));
    console.log('pills: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.nge-aq-form .nge-aq-pill')].map(b => b.textContent.trim()))));
    await page.selectOption('.nge-aq-form select', 'No cilium (one centriole)');
    await page.click('.nge-aq-pill:has-text("Split")');
    await page.fill('.nge-aq-notes', 'one centriole, the other side is cut off');
    await page.click('.nge-aq-recheck');
    await page.waitForTimeout(1200);
    console.log('form msgs: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.nge-aq-form-msg')].map(m => m.innerText))));
    console.log('send enabled: ' + await page.evaluate(() => !document.querySelector('.nge-aq-btn--send').disabled));
    await shot('quests-form');
    const logAll = m => console.log('  send-console[' + m.type() + '] ' + m.text().slice(0, 200));
    page.on('console', logAll);
    await page.click('.nge-aq-btn--send');
    // The celebration toast shows for five seconds: catch it as it appears.
    let toastText = [];
    for (let i = 0; i < 40 && !toastText.length; i++) {
      await page.waitForTimeout(200);
      toastText = await page.evaluate(() => [...document.querySelectorAll('.nge-toast--quest, .nge-toast')].map(t => t.innerText.replace(/\s+/g, ' ').trim()));
    }
    console.log('toast: ' + JSON.stringify(toastText));
    await page.screenshot({ path: path.join(OUT, 'celebration.png') });
    console.log('confetti canvas: ' + await page.evaluate(() => !!document.querySelector('canvas.nge-confetti, .nge-confetti canvas, canvas[class*=confetti]')));
    await page.waitForTimeout(2500);
    page.off('console', logAll);
    console.log('after submit, status bar: ' + JSON.stringify((await statusText()).slice(0, 300)));
    console.log('calls: ' + JSON.stringify(calls.filter(c => c.action !== 'quest_list')));
    console.log('after submit, text: ' + JSON.stringify((await tabText()).slice(0, 600)));
    await shot('quests-submitted');
    // The profile: the Quests count in the Scout report.
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: {} })));
    await page.waitForSelector('.nge-profile-stat-row--scout', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);
    console.log('profile scout row: ' + JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.nge-profile-stat-row--scout'); return r ? r.innerText.replace(/\s+/g, ' ').trim() : 'no scout row'; })));
    const scout = await page.locator('.nge-profile-stat-row--scout').boundingBox().catch(() => null);
    if (scout) await page.screenshot({ path: path.join(OUT, 'profile-scout.png'), clip: { x: Math.max(0, scout.x - 8), y: Math.max(0, scout.y - 40), width: Math.min(1400, scout.width + 16), height: Math.min(900, scout.height + 56) } });
    console.log('error box: ' + JSON.stringify(await page.evaluate(() => (document.querySelector('.nge-aq-error') || {}).innerText || '')));
  } finally {
    await browser.close();
  }
  console.log('page errors: ' + errors.length + (errors.length ? ' ' + JSON.stringify(errors.slice(0, 4)) : ''));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
