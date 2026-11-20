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
const {gliaAction, memDb} = require('../functions/muller-glia');
const TEST_UUID = '00000000-0000-4000-8000-000000000001';
const gliaCells = [];
for (let i = 0; i < 14; i++) gliaCells.push({sheet_index: `F${100 + i}`, segment_id: String(720575940559811933n + BigInt(i)), soma_coords: '24771,38930,1875', guess: 'Muller', stage: 1});
for (const [ix, at] of [['F560', '40856,35011,2024'], ['E758', '39650,34032,421']]) gliaCells.push({sheet_index: ix, segment_id: '720575940548399816', soma_coords: at, stage: 2, pair_segment: '720575940548399816'});
const gliaDb = memDb({cells: gliaCells});
let gliaRoots = {'40856,35011,2024': '720575940548399816', '39650,34032,421': '720575940548399816'};
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
  await context.addInitScript(() => { try { localStorage.setItem('nge-cilia-training-autoplayed', '1'); localStorage.setItem('nge-cilia-quest-intro-seen', '1'); localStorage.setItem('pyr-intro-seen', '1'); } catch (e) {} });
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
    if (/ewMullerGlia/.test(r.request().url())) {
      let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
      const {action, token, ...args} = input;
      calls.push({glia: action, args});
      return gliaAction(action, args, {db: gliaDb, me: {id: TEST_UUID}, isAdmin: false, somaRoots: async s => s.map(x => gliaRoots[x] ?? null)})
        .then(data => r.fulfill(json({ok: true, data})), e => r.fulfill(json({error: e.message}, e.status || 500)));
    }
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
  // Ames's own saved wording of the popup (site_texts, 2026-11-20), whose link
  // an edit once broke: it must come back as a working action link.
  const SAVED_WHAT = [
    'A long column through the full depth of the retina.',
    'Its soma sits in the inner nuclear layer, among the bipolar cells.',
    'A wide end foot on the ganglion cell side (at the bottom of the picture), and fine sheets wrapped around its neighbors.',
    "No axon, and no tidy dendritic tree like a neuron's.",
    '[Show this glia](#glia-example) in the viewer: a Müller glia proofread by Nseraf.',
  ].join('\n\n');
  await context.route(/supabase\.co/, r => {
    if (r.request().method() === 'GET' && /site_texts/.test(r.request().url())) return r.fulfill(json([{ key: 'quest.muller_glia.what', body: SAVED_WHAT, updated_by_name: 'Amy R. Sterling', updated_at: '2026-11-20T15:35:11Z' }]));
    return r.fulfill(json([]));
  });
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
    await page.evaluate(() => [...document.querySelectorAll('.nge-mg-btn')].find(b => /What is a M[uü]ller glia/.test(b.textContent)).click());
    await page.waitForTimeout(800);
    const pop = await page.evaluate(() => { const q = document.querySelector('.nge-qi'); const img = q && q.querySelector('img'); return q ? { title: q.querySelector('.nge-qi-title').innerText, img: !!img && img.naturalWidth > 0, items: q.querySelectorAll('li').length } : null; });
    ok(pop && /What is a M[uü]ller glia/.test(pop.title) && pop.img && pop.items === 5, 'popup: title, picture loaded, five lines ' + JSON.stringify(pop));
    const said = await page.evaluate(() => document.querySelector('.nge-qi').innerText);
    ok(/proofread by Nseraf/.test(said) && !/\]\(#/.test(said), 'the saved wording shows, with no raw link marks ' + JSON.stringify(said.slice(-90)));
    await page.screenshot({ path: path.join(OUT, '0-popup.png') });
    await page.evaluate(() => document.querySelector('.nge-qi a[data-nge-action="glia-example"]').click());
    await page.waitForTimeout(500);
    const ex = await page.evaluate(() => { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina'); return { vis: [...g.layer.displayState.segmentationGroupState.value.visibleSegments].map(String), open: !!document.querySelector('.nge-qi') }; });
    ok(ex.vis.join() === '720575940558455015' && !ex.open, "Show this glia, from Ames's saved wording, loads Nseraf's glia and closes the popup");
    const first = (await page.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', '.nge-mg-card-name')).trim();
    await page.evaluate(() => document.querySelector('.nge-mg-card .nge-mg-btn').click());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina'); const gs = g && g.layer.displayState.segmentationGroupState.value; return { vis: gs ? [...gs.visibleSegments].map(String) : [], pos: [...window.viewer.navigationState.position.value].map(Math.round) }; });
    ok(after.vis.length === 1 && after.pos.join(',') === '24771,38930,1875', 'Open shows only that cell, at its soma');
    for (const n of [0, 1, 2]) { await page.evaluate(n => document.querySelectorAll('.nge-mg-answers button')[n].click(), n); await page.waitForTimeout(500); }
    const s = gliaDb._state;
    ok(s.answers.length === 3 && s.answers[0].answer === 'yes' && s.answers[0].user_id === TEST_UUID, 'three answers reach the server, first is Yes');
    ok((await page.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', '.nge-mg-card-name')).trim() !== first, 'the next cell comes up');
    ok(await page.locator('.nge-mg-row').count() === 3, 'latest answers listed');
    await shot('2-answered');
    await page.evaluate(() => document.querySelector('.nge-mg-row .nge-mg-btn--sm').click());
    await page.waitForTimeout(600);
    ok(s.answers.length === 2, 'Undo takes an answer back on the server');
    await page.evaluate(() => document.querySelectorAll('.nge-mg-stage')[1].click());
    await page.waitForTimeout(400);
    console.log('  mg count ' + await page.locator('.nge-mg').count() + ' panel ' + await page.locator('.nge-cl-panel').count()); await page.screenshot({ path: path.join(OUT, 'dbg.png') });
    ok(/opens after 10 answers/.test(await page.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', '.nge-mg')), 'Stage 2 locked before 10 answers');
    await page.evaluate(() => document.querySelectorAll('.nge-mg-stage')[0].click());
    await page.waitForTimeout(400);
    for (let k = 0; k < 8; k++) { await page.evaluate(() => document.querySelectorAll('.nge-mg-answers button')[0].click()); await page.waitForTimeout(450); }
    ok(/Stage 2 is open/.test(await page.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', '.nge-mg')), 'the 10th answer opens Stage 2');
    await page.evaluate(() => document.querySelectorAll('.nge-mg-stage')[1].click());
    await page.waitForTimeout(600);
    ok(await page.locator('.nge-mg-row').count() === 1, 'one merged pair listed');
    await page.evaluate(() => document.querySelector('.nge-mg-row .nge-mg-btn--sm').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.nge-mg-btn--go').click());
    await page.waitForTimeout(800);
    ok(/still in one cell/.test(await page.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', '.nge-mg-pair')), 'Check: still merged');
    await shot('3-stage2');
    gliaRoots = {'40856,35011,2024': '720575940000000001', '39650,34032,421': '720575940000000002'};
    await page.evaluate(() => document.querySelector('.nge-mg-btn--go').click());
    await page.waitForTimeout(800);
    ok(/Split! F560 and E758 are two cells now/.test(await page.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', '.nge-mg')) && s.splits.length === 1, 'Check: split recorded');
    await shot('4-split');
    // Play on the Müller card: the slim yes/no bar (Ames 2026-11-20).
    const answersBefore = calls.filter(c => c.glia === 'glia.answer').length;
    await page.evaluate(() => {
      try { localStorage.setItem('nge_quest_pick_v1', 'muller'); sessionStorage.setItem('nge_glia_slim', String(Date.now())); } catch (e) {}
      document.dispatchEvent(new CustomEvent('nge:quest-pick', { detail: 'muller' }));
      document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab: 'quests' } }));
    });
    await page.waitForTimeout(1500);
    const slimBar = await page.evaluate(() => { const b = document.querySelector('.nge-mg--slim'); return b ? { text: b.innerText.replace(/\s+/g, ' '), full: !!document.querySelector('.nge-mg-head'), slimPanel: !!document.querySelector('.nge-cl-panel--slim') } : null; });
    ok(slimBar && /Is F\d+ a Müller glia\?/.test(slimBar.text) && !slimBar.full && slimBar.slimPanel, 'Play opens the slim yes/no bar ' + JSON.stringify(slimBar));
    const asked = await page.evaluate(() => (document.querySelector('.nge-mg-slimmeta')?.innerText.match(/F\d+/) || [''])[0]);
    const onView = await page.evaluate(() => { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina'); return [...g.layer.displayState.segmentationGroupState.value.visibleSegments].map(String).join(); });
    const askedSeg = String(720575940559811933n + BigInt(Number(asked.slice(1)) - 100));
    ok(onView === askedSeg, `the cell asked about is the one on screen (${asked}: ${askedSeg}, view ${onView})`);
    const shownBefore = await page.evaluate(() => { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina'); return [...g.layer.displayState.segmentationGroupState.value.visibleSegments].map(String).join(); });
    await page.screenshot({ path: path.join(OUT, '5-slim.png') });
    await page.evaluate(() => document.querySelector('.nge-mg--slim .nge-mg-ans--no').click());
    await page.waitForTimeout(1000);
    const shownAfter = await page.evaluate(() => { const g = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina'); return [...g.layer.displayState.segmentationGroupState.value.visibleSegments].map(String).join(); });
    ok(calls.filter(c => c.glia === 'glia.answer').length === answersBefore + 1 && shownAfter && shownAfter !== shownBefore, `No on the slim bar is sent and the next cell opens (${shownBefore} then ${shownAfter})`);
    const other = calls.filter(c => c.action && c.action !== 'quest_list');
    ok(other.length === 0, 'nothing else written');
    console.log(errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors');
    console.log(fails ? fails + ' FAILED' : 'all passed');
  } catch (e) { console.log('ERROR ' + (e && e.stack || e)); }
  await browser.close();
})();
