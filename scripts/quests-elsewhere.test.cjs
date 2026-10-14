// The Quests tab on a dataset without quests, headless (2026-10-13).
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3488 --directory dist/min
// Run:    node scripts/quests-elsewhere.test.cjs [shots dir]
// Checks: the tab says where quests are, in the top bar's name for the
// dataset ("Retina"), and its button switches there. The switch reloads the
// page into the dataset's start view; the Cell Library has to come back open
// on Quests, with the quest list in it.
// Every server call is answered here; nothing reaches production. One 401
// with the fake token wedges the middleauth provider, so every middleauth
// host is answered by a catch-all registered first.
const path = require('path');
const fs = require('fs');
// The start view of Retina, as the config names it (it changes now and then).
const CONFIG = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.ts'), 'utf8');
const RETINA_START = ((CONFIG.slice(CONFIG.indexOf("datastack:        'stroeh_mouse_retina'")).match(/defaultStateUrl:\s*'[^']*[/]nglstate[/]api[/]v1[/](\d+)'/) || [])[1]) || '';
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const RETINA_LAYERS = [
  { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' },
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'stroeh_mouse_retina', segments: [] },
];
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
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  const sheetCalls = [];
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    if (/ewSheetSync/.test(r.request().url())) { sheetCalls.push(input.action); return r.fulfill(json({ ok: true, you: 'Test Player', rows: [] })); }
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }] : [];
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  // The start view the switch reloads into: Retina's layers.
  const stateReads = [];
  await context.route(/global\.brain-wire-test\.org\/nglstate\/api\/v1\/\d+/, r => { stateReads.push(r.request().url().split('/').pop()); return r.fulfill(json({ dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [37166, 16688, 1973], layers: RETINA_LAYERS, layout: 'xy-3d' })); });

  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const ready = async () => {
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      if (!document.getElementById('test-hide')) { const st = document.createElement('style'); st.id = 'test-hide'; st.textContent = css; document.head.appendChild(st); }
    }, HIDE_CSS);
  };
  const layers = () => page.evaluate(() => window.viewer.layerManager.managedLayers.map(l => l.name));
  const dataLabel = () => page.evaluate(() => (document.body.innerText.match(/Data: [A-Za-z ]+/) || [''])[0].trim());
  try {
    await page.goto('http://localhost:3488/', { waitUntil: 'load' });
    await ready();
    await page.waitForTimeout(2500);
    console.log('dataset on screen: ' + (await layers()).join(',') + ' | ' + await dataLabel());
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
    await page.waitForSelector('.nge-cl-panel', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.click('.nge-cl-quests-tab');
    await page.waitForSelector('.nge-cl-quests-elsewhere', { timeout: 5000 });
    const notice = await page.evaluate(() => ({ text: document.querySelector('.nge-cl-quests-elsewhere-text').innerText.replace(/\s+/g, ' ').trim(), button: document.querySelector('.nge-cl-quests-switch').innerText.trim() }));
    check('off Retina the tab says where quests are, in the name the top bar uses', notice.text === 'Quests are on Retina for now. You are on Sandbox.', notice.text);
    check('the button says Switch to Retina', notice.button === 'Switch to Retina', notice.button);
    const box = await page.locator('.nge-cl-panel').boundingBox();
    await page.screenshot({ path: path.join(OUT, 'quests-elsewhere.png'), clip: { x: box.x - 2, y: box.y - 2, width: Math.min(1400, box.width + 4), height: Math.min(900, box.height + 4) } });

    // The switch: the page reloads into Retina's start view.
    const reloaded = page.waitForEvent('load', { timeout: 40000 }).then(() => true, () => false);
    await page.click('.nge-cl-quests-switch');
    check('the switch reloads the page', await reloaded);
    await ready();
    // (The address is rewritten once the view is in, so the read is what is checked.)
    await page.waitForFunction(() => window.viewer.layerManager.managedLayers.some(l => l.name === 'stroeh_mouse_retina'), null, { timeout: 40000 }).catch(() => {});
    check('the start view of Retina was read from the state server', !!RETINA_START && stateReads.length > 0 && stateReads.every(id => id === RETINA_START), stateReads);
    check('Retina is on screen', (await layers()).includes('stroeh_mouse_retina') && await dataLabel() === 'Data: Retina', { layers: await layers(), label: await dataLabel(), stateReads });
    const reopened = await page.waitForSelector('.nge-cl-panel', { timeout: 20000 }).then(() => true, () => false);
    check('the Cell Library comes back open by itself', reopened);
    const list = await page.waitForSelector('.nge-aq', { timeout: 30000 }).then(() => true, () => false);
    const tab = await page.evaluate(() => ({ questsTabActive: !!document.querySelector('.nge-cl-quests-tab.active'), notice: !!document.querySelector('.nge-cl-quests-elsewhere'), text: document.querySelector('.nge-aq') ? document.querySelector('.nge-aq').innerText.replace(/\s+/g, ' ').slice(0, 60) : null }));
    check('on the Quests tab, with the quest in it and no notice', list && tab.questsTabActive && !tab.notice && /Cilia Quest/.test(tab.text || ''), tab);
    check('the quest list was asked for, and no more than twice', sheetCalls.includes('quest_list') && sheetCalls.filter(a => a === 'quest_list').length <= 2, sheetCalls);
    check('the note left for the next page is used up', await page.evaluate(() => sessionStorage.getItem('nge_cl_after_switch')) === null);
    await page.screenshot({ path: path.join(OUT, 'quests-after-switch.png') });
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
    try { await page.screenshot({ path: path.join(OUT, 'quests-elsewhere-failed.png') }); } catch (e2) { /* no picture */ }
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
