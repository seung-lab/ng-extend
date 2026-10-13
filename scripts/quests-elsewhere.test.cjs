// The Quests tab on a dataset without quests, headless (2026-10-13).
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3488 --directory dist/min
// Run:    node scripts/quests-elsewhere.test.cjs [shots dir]
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto('http://localhost:3488/', { waitUntil: 'load' });
  await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
  await page.evaluate((css) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const login = pinia._s.get('login');
    if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
    const pb = pinia._s.get('proofreadingBackend');
    if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; } catch (e) {} }
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }, HIDE_CSS);
  await page.waitForTimeout(2500);
  console.log('dataset on screen: ' + await page.evaluate(() => window.viewer.layerManager.managedLayers.map(l => l.name).join(',')));
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
  await page.waitForSelector('.nge-cl-panel', { timeout: 10000 });
  await page.waitForTimeout(800);
  console.log('tabs: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.nge-cl-filters button')].map(b => b.textContent.trim().replace(/\s+/g, ' ')))));
  await page.click('.nge-cl-quests-tab');
  await page.waitForSelector('.nge-cl-quests-elsewhere', { timeout: 5000 });
  console.log('notice: ' + JSON.stringify(await page.evaluate(() => document.querySelector('.nge-cl-quests-elsewhere').innerText)));
  const box = await page.locator('.nge-cl-panel').boundingBox();
  await page.screenshot({ path: path.join(OUT, 'quests-elsewhere.png'), clip: { x: box.x - 2, y: box.y - 2, width: Math.min(1400, box.width + 4), height: Math.min(900, box.height + 4) } });
  const switchErrors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') switchErrors.push(m.text().slice(0, 160)); });
  await page.click('.nge-cl-quests-switch');
  await page.waitForTimeout(3000);
  console.log('panel still open: ' + await page.evaluate(() => !!document.querySelector('.nge-cl-panel')) + ' active tab: ' + JSON.stringify(await page.evaluate(() => (document.querySelector('.nge-cl-filters button.active') || {}).textContent || '')) + ' switch console: ' + JSON.stringify(switchErrors.slice(0, 4)));
  console.log('after switch, layers: ' + await page.evaluate(() => window.viewer.layerManager.managedLayers.map(l => l.name).join(',')));
  console.log('after switch, tab: ' + JSON.stringify(await page.evaluate(() => ({ questsTabActive: !!document.querySelector('.nge-cl-quests-tab.active'), questsBody: !!document.querySelector('.nge-aq'), notice: !!document.querySelector('.nge-cl-quests-elsewhere') }))));
  await browser.close();
  console.log('page errors: ' + errors.length + (errors.length ? ' ' + JSON.stringify(errors.slice(0, 3)) : ''));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
