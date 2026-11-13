// Play on the Sandbox when its layer has another pinky name, headless (Ames 2026-11-12:
// "start playing in sandbox still takes me to retina dataset").
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3571 --directory dist/min
// Run:    node scripts/play-sandbox-name.test.cjs [base url]
// Checks: with edit access on both Retina and the Sandbox, the Play card offers
// "Sandbox cells" while a Sandbox view is on screen, whether its segmentation
// layer is named exactly pinky_nf_v2 (the control) or another pinky name that
// the top bar already reads as "Data: Sandbox". Nothing reaches production.
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:3571/';
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const state = (name) => ({ dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] }, position: [84054, 50604, 1424], layout: '3d', layers: [
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2' }, name },
] });
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 300) : '')); };

async function playCard(browser, layerName) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
    try { localStorage.removeItem('nge-play-kind'); } catch (e) {}
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  const me = { id: 1, email: 't@example.org', name: 'Test Player', permissions_v2: { 'stroeh-mouse-retina': ['view', 'edit'], pinky100: ['view', 'edit'], pinky_sandbox: ['view', 'edit'] } };
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)|\/auth\/api\/v1\/user\/\d+\/permissions/, r => r.fulfill(json(me)));
  await context.route(/docs\.google\.com/, r => r.fulfill({ status: 200, contentType: 'text/csv', body: 'Segment ID\n' }));
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }] : [];
    return r.fulfill(json({ status: 200, ok: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows), data: null }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  let out = { where: null, topBar: null, layer: null };
  try {
    await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(state(layerName))), { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 120000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }, HIDE_CSS);
    await page.waitForSelector('.nge-play-btn', { timeout: 30000 });
    await page.waitForTimeout(4000);
    out.layer = await page.evaluate(() => (window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState) || {}).name);
    out.topBar = await page.evaluate(() => { const b = [...document.querySelectorAll('button, span, div')].find(e => e.children.length === 0 && /^Data:/.test((e.textContent || '').trim())); return b ? b.textContent.trim() : null; });
    await page.evaluate(() => document.querySelector('.nge-play-btn').click());
    await page.waitForSelector('.nge-play-opt-where', { timeout: 10000 });
    out.where = await page.evaluate(() => document.querySelector('.nge-play-opt-where').textContent.trim());
  } catch (e) { out.error = String(e).slice(0, 200); }
  await context.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const exact = await playCard(browser, 'pinky_nf_v2');
  check('control: the exact layer name plays on the Sandbox', /Sandbox/.test(exact.where || ''), exact);
  const other = await playCard(browser, 'pinky_training6');
  check('another pinky name: the top bar says Sandbox', /Sandbox/.test(other.topBar || ''), other);
  check('another pinky name: Play plays on the Sandbox too', /Sandbox/.test(other.where || ''), other);
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
