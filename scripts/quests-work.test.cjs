// The active quest and its saved work, headless (player report 2026-10-14:
// "It's hard to tell which quest you are currently working on ... If you lay
// down points and then reopen the Quest you are on it will remove your work").
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3488 --directory dist/min
// Run:    node scripts/quests-work.test.cjs [shots dir]
// Plays the player's steps: open a quest, place points, open it again, open
// another, come back, reload the tab, release. Every server call is answered
// here, the private saved views (user_views) by an in-memory table; nothing
// reaches production.
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');

const BASE = process.env.QUEST_BASE || 'http://localhost:3488/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots-work');
fs.mkdirSync(OUT, { recursive: true });
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const A5 = '720575940561794892', A7 = '720575940572159335', A9 = '720575940551642305';
const START = (id) => 'https://spelunker.cave-explorer.org/#!middleauth+https://global.daf-apis.com/nglstate/api/v1/' + id;
const row = (index, segmentId, startId, over = {}) => ({ index, segmentId, soma: startId === 111 ? '37166, 16688, 1973' : '40000, 20000, 2000', cellClass: 'AC', cellType: 'OFF SAC', startLink: START(startId), status: '', splitMerged: '', link: '', annotator: '', date: '', notes: '', ...over });
const ROWS = [
  row('A5', A5, 111, { annotator: 'Test R. Player' }),
  row('A7', A7, 222, { annotator: 'Test R. Player' }),
  row('A9', A9, 333),
];
// The lab's Start Link for each cell: its two layers, empty, and the cell.
const labState = (cell, position) => ({
  dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position, layout: 'xy-3d',
  layers: [
    { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' },
    { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'stroeh_mouse_retina', segments: [cell] },
    { type: 'annotation', source: 'local://annotations', name: 'Daugther centriole', annotations: [], annotationColor: '#ff0000' },
    { type: 'annotation', source: 'local://annotations', name: 'Basal body', annotations: [], annotationColor: '#ffff00' },
  ],
  selectedLayer: { layer: 'Basal body', visible: true },
});
const STATES = { 111: labState(A5, [37166, 16688, 1973]), 222: labState(A7, [40000, 20000, 2000]) };

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate', host + '/nglstate/', host + '/nglstate/api/v1', host + '/segmentation', host + '/segmentation/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  // Every middleauth host answered first; the specific answers below win.
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  // The private saved views, kept here.
  const views = {};
  const viewCalls = [];
  const basalIn = (state) => { const l = ((state || {}).layers || []).find(x => x.name === 'Basal body'); return l && Array.isArray(l.annotations) ? l.annotations.length : null; };
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    const u = r.request().url();
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    if (/ewSheetSync/.test(u)) {
      if (input.action === 'quest_list') return r.fulfill(json({ ok: true, you: 'Test R. Player', rows: ROWS }));
      const hit = ROWS.find(x => x.segmentId === String(input.segmentId));
      if (input.action === 'quest_release' && hit) { hit.annotator = ''; return r.fulfill(json({ ok: true, updated: 1 })); }
      return r.fulfill(json({ error: 'Not in this test.' }, 400));
    }
    const env = (status, body) => r.fulfill(json({ status, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) }));
    if (input.table === 'user_views') {
      const q = new URLSearchParams(input.query || '');
      const method = String(input.method || 'GET').toUpperCase();
      if (method === 'POST') {
        for (const v of (Array.isArray(input.body) ? input.body : [input.body])) {
          views[v.dataset] = { dataset: v.dataset, state: v.state, updated_at: new Date().toISOString() };
          viewCalls.push({ method, dataset: v.dataset, basal: basalIn(v.state) });
        }
        return env(201);
      }
      const want = (q.get('dataset') || '').replace(/^eq\./, '');
      viewCalls.push({ method, dataset: want || '(all)' });
      const sel = (q.get('select') || '').split(',');
      const pick = (v) => Object.fromEntries(sel.map(k => [k, v[k]]));
      const out = Object.values(views).filter(v => !want || v.dataset === want).map(pick);
      return env(200, /pgrst\.object/.test(String(input.accept || '')) ? (out[0] || null) : out);
    }
    const rows = input.table === 'users' && String(input.method || 'GET').toUpperCase() === 'GET'
      ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org', total_edits: 0, cells_completed: 0 }] : [];
    return env(200, /pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows);
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  // The lab's Start Links, counted.
  const stateReads = [];
  await context.route(/global\.daf-apis\.com\/nglstate\/api\/v1\/\d+/, r => { const id = r.request().url().split('/').pop(); stateReads.push(id); return r.fulfill(json(STATES[id] || {})); });

  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const signIn = async () => {
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    const put = () => page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; pb.userEmail = 't@example.org'; } catch (e) {} }
      if (!document.getElementById('test-hide')) { const st = document.createElement('style'); st.id = 'test-hide'; st.textContent = css; document.head.appendChild(st); }
    }, HIDE_CSS);
    await put(); await page.waitForTimeout(3500); await put(); await page.waitForTimeout(300);
  };
  const openQuests = async () => {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
    await page.waitForSelector('.nge-cl-panel', { timeout: 10000 });
    await page.waitForTimeout(600);
    if (!(await page.$('.nge-aq'))) await page.click('.nge-cl-quests-tab');
    await page.waitForSelector('.nge-aq-row--mine', { timeout: 15000 });
    await page.waitForTimeout(800);
  };
  const mineRow = (index) => page.locator('.nge-aq-row--mine', { has: page.locator('.nge-aq-row-name', { hasText: index + ',' }) });
  const rowsInfo = () => page.evaluate(() => [...document.querySelectorAll('.nge-aq-row--mine')].map(r => ({
    name: r.querySelector('.nge-aq-row-name').childNodes[0].textContent.trim(),
    active: !!r.querySelector('.nge-aq-active-pill'),
    cell: (r.querySelector('.nge-aq-cellid') || {}).textContent || '',
    saved: ((r.querySelector('.nge-aq-saved span') || {}).textContent || '').trim(),
  })));
  const basal = () => page.evaluate(() => { const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'Basal body'); return ml && ml.layer && ml.layer.localAnnotations ? ml.layer.localAnnotations.toJSON().length : null; });
  const layerNames = () => page.evaluate(() => window.viewer.layerManager.managedLayers.map(l => l.name));
  const msg = () => page.evaluate(() => ((document.querySelector('.nge-aq-msg') || {}).textContent || '').trim());
  const posts = (cell) => viewCalls.filter(c => c.method === 'POST' && c.dataset === 'quest.retina_cilia.' + cell);
  const waitDressed = () => page.waitForFunction(() => { const n = window.viewer.layerManager.managedLayers.map(l => l.name); return n.includes('Basal body') && n.includes('Cilium centerline'); }, null, { timeout: 30000 });
  const stored = () => page.evaluate(() => ({ active: JSON.parse(localStorage.getItem('nge-quest-active') || 'null'), onScreen: sessionStorage.getItem('nge-quest-on-screen') }));

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await signIn();
    await openQuests();
    let info = await rowsInfo();
    check('each of your quests shows its cell ID', info.length === 2 && info.some(r => r.cell === 'Cell ' + A5) && info.some(r => r.cell === 'Cell ' + A7), info);
    check('nothing is active before a quest is opened', info.every(r => !r.active), info);

    // 1. Open A5: the lab's Start Link, and A5 becomes the active quest.
    await mineRow('A5').locator('button', { hasText: 'Open' }).click();
    await waitDressed();
    await page.waitForTimeout(1200);
    info = await rowsInfo();
    check('Open makes A5 the active quest', info.find(r => r.name.startsWith('A5')).active && !info.find(r => r.name.startsWith('A7')).active, info);
    check('A5 opened on its Start Link', stateReads.filter(x => x === '111').length === 1, stateReads);
    await page.screenshot({ path: path.join(OUT, 'work-active.png'), clip: await page.locator('.nge-cl-panel').boundingBox() });

    // 2. Place two points: saved a few seconds later, to A5.
    await page.evaluate(() => {
      const src = window.viewer.layerManager.managedLayers.find(l => l.name === 'Basal body').layer.localAnnotations;
      src.add({ id: 'p1', type: 0, point: Float32Array.from([37100, 16600, 1970]), properties: [] });
      src.add({ id: 'p2', type: 0, point: Float32Array.from([37200, 16700, 1975]), properties: [] });
    });
    await page.waitForFunction(() => /Saved at/.test([...document.querySelectorAll('.nge-aq-saved span')].map(s => s.textContent).join('|')), null, { timeout: 25000 }).catch(() => {});
    const firstSave = posts(A5);
    check('placing points saves them to A5 by themselves', firstSave.length >= 1 && firstSave[firstSave.length - 1].basal === 2, firstSave);
    info = await rowsInfo();
    check('the row says the work is saved', /^Saved at /.test(info.find(r => r.name.startsWith('A5')).saved), info);

    // 3. The player's report: open the quest you are on again.
    const readsBefore = stateReads.length;
    await mineRow('A5').locator('button', { hasText: 'Open' }).click();
    await page.waitForTimeout(2500);
    check('Open on the active quest does not reload it', stateReads.length === readsBefore, stateReads);
    check('and the points are still there', await basal() === 2, await basal());
    check('and it says so', /You are on A5\. Your work is as you left it\./.test(await msg()), await msg());

    // 4. Open another quest: A5 is saved first, then A7 opens on its Start Link.
    const a5Posts = posts(A5).length;
    await mineRow('A7').locator('button', { hasText: 'Open' }).click();
    await page.waitForFunction(() => { const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'Basal body'); return ml && ml.layer && ml.layer.localAnnotations && ml.layer.localAnnotations.toJSON().length === 0; }, null, { timeout: 30000 });
    await waitDressed();
    await page.waitForTimeout(1200);
    check('opening A7 saves A5 first', posts(A5).length === a5Posts + 1 && posts(A5)[posts(A5).length - 1].basal === 2, posts(A5));
    check('A7 opens on its Start Link and is now the active quest', stateReads.includes('222') && (await rowsInfo()).find(r => r.name.startsWith('A7')).active && !(await rowsInfo()).find(r => r.name.startsWith('A5')).active, { stateReads, rows: await rowsInfo() });

    // 5. Back to A5: its saved work, not its Start Link.
    const a5Reads = stateReads.filter(x => x === '111').length;
    await mineRow('A5').locator('button', { hasText: 'Open' }).click();
    await page.waitForFunction(() => { const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'Basal body'); return ml && ml.layer && ml.layer.localAnnotations && ml.layer.localAnnotations.toJSON().length === 2; }, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    check('A5 comes back with its two points', await basal() === 2, await basal());
    check('from the saved work, not the Start Link', stateReads.filter(x => x === '111').length === a5Reads, stateReads);
    check('and says so', /Your saved work on A5 is back\./.test(await msg()), await msg());
    check('the quest layers are all there, once each', JSON.stringify((await layerNames()).filter(n => /centerline|centriole|basal/i.test(n))) === JSON.stringify(['Cilium centerline', 'Daugther centriole', 'Basal body']), await layerNames());

    // 6. Save now.
    const before6 = posts(A5).length;
    await mineRow('A5').locator('.nge-aq-save').click();
    await page.waitForTimeout(1500);
    check('Save now saves A5', posts(A5).length === before6 + 1, posts(A5).length);

    // 7. A reload of the tab: A5 is still the active quest, and Open still keeps the work.
    await page.reload({ waitUntil: 'load' });
    await signIn();
    await openQuests();
    check('after a reload A5 is still the active quest', (await rowsInfo()).find(r => r.name.startsWith('A5')).active, await rowsInfo());
    const readsBefore7 = stateReads.length;
    await mineRow('A5').locator('button', { hasText: 'Open' }).click();
    await page.waitForTimeout(2500);
    check('after a reload, Open on it still does not reload it', stateReads.length === readsBefore7 && await basal() === 2, { stateReads, basal: await basal() });
    await page.screenshot({ path: path.join(OUT, 'work-after-reload.png'), clip: await page.locator('.nge-cl-panel').boundingBox() });

    // 8. Release: no longer the active quest.
    await mineRow('A5').locator('button', { hasText: 'Release' }).click();
    await page.waitForTimeout(2500);
    const st = await stored();
    check('Release ends the active quest', st.active === null && st.onScreen === null && (await rowsInfo()).every(r => !r.active), { st, rows: await rowsInfo() });
    check('no saved view was written for a quest that was not on screen', viewCalls.filter(c => c.method === 'POST').every(c => c.dataset === 'quest.retina_cilia.' + A5 || c.dataset === 'quest.retina_cilia.' + A7 || !c.dataset.startsWith('quest.')), viewCalls.filter(c => c.method === 'POST').map(c => c.dataset));
    console.log('saved view calls: ' + viewCalls.length + ' ' + JSON.stringify(viewCalls.map(c => c.method + ' ' + c.dataset.replace('quest.retina_cilia.', 'q.') + (c.basal != null ? ' basal=' + c.basal : ''))));
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
    try { await page.screenshot({ path: path.join(OUT, 'work-failed.png') }); } catch (e2) { /* no picture */ }
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
