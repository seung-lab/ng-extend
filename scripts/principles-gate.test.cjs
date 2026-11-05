// The Eyewire II Principles on the Retina dataset, headless (Ames 2026-10-27).
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3561 --directory dist/min
// Run:    node scripts/principles-gate.test.cjs [shots dir]
// Checks: a signed in player who has not agreed gets the principles screen on
// the retina, with a link to eyewire.ai/principles; it stays up through Escape
// and a click outside; OK, I agree sends the version the server asked about,
// once, and the screen goes (Ames 2026-10-27: one sentence and OK). Controls: a player who agreed sees nothing; a
// player still at the beta screen is not asked; a server error shows nothing.
// Every server call is answered here; nothing reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3561;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 300) : '')); };

/** One browser per player. `status` answers access.principlesStatus: an object, or a number for an error. */
async function player(browser, status, beta = { invited: true }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: [] };
    try { localStorage.setItem('auth_token_v2_https://global.daf-apis.com/sticky_auth', JSON.stringify(token)); } catch (e) {}
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org|microns-daf\.com/, r => r.abort());
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  const calls = [];
  await context.route(/ewAccessRequest/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    calls.push(input);
    if (input.action === 'access.betaStatus') return r.fulfill(json({ ok: true, data: beta }));
    if (input.action === 'access.principlesStatus') return typeof status === 'number' ? r.fulfill(json({ error: 'down' }, status)) : r.fulfill(json({ ok: true, data: status }));
    if (input.action === 'access.principlesAgree') return r.fulfill(json({ ok: true, data: { agreed: true, version: input.version } }));
    return r.fulfill(json({ ok: true, data: null }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
  await page.addStyleTag({ content: HIDE_CSS });
  await page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const login = pinia._s.get('login');
    if (login && login.sessions.length === 0) login.sessions.push({ key: 'auth_token_v2_https://global.daf-apis.com/sticky_auth', name: 'New Player', email: 'new@example.org', hostname: 'test' });
    const pb = pinia._s.get('proofreadingBackend');
    pb.userId = 'u-new'; pb.userName = 'New Player'; pb.username = 'newbie';
  });
  await page.waitForTimeout(3000);
  return { context, page, calls, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const V = '2026-10-27';
    // 1. Not agreed yet, on the retina.
    const p = await player(browser, { version: V, agreed: false, at: null });
    const onRetina = await p.page.evaluate(() => (window.viewer.layerManager.managedLayers || []).some(l => /stroeh_mouse_retina/.test(l.name)));
    check('the build is on the retina dataset', onRetina);
    const shown = await p.page.$('.nge-principles-panel');
    check('not agreed: the principles screen shows', !!shown);
    const text = shown ? (await p.page.innerText('.nge-principles-panel')).replace(/\s+/g, ' ') : '';
    check('one sentence, a link to the full text, and OK', /OK, I agree/i.test(text) && (text.match(/\. /g) || []).length <= 1 && /Eyewire II Principles/.test(text)
      && await p.page.$eval('.nge-principles-panel a[href="https://eyewire.ai/principles"]', a => a.target === '_blank').catch(() => false), text.slice(0, 200));
    check('no dashes in its words', !/[\u2013\u2014]/.test(text));
    const box = await p.page.locator('.nge-principles-panel').boundingBox();
    if (box) await p.page.screenshot({ path: path.join(OUT, 'principles-gate.png'), clip: { x: box.x - 30, y: Math.max(0, box.y - 30), width: box.width + 60, height: Math.min(900, box.height + 60) } });
    await p.page.keyboard.press('Escape');
    await p.page.mouse.click(20, 450);
    await p.page.waitForTimeout(400);
    check('Escape and a click outside leave it up', !!(await p.page.$('.nge-principles-panel')));
    await p.page.click('.nge-principles-btn');
    await p.page.waitForTimeout(800);
    const sent = p.calls.filter(c => c.action === 'access.principlesAgree');
    check('Agree sends one agreement, with the version the server asked about', sent.length === 1 && sent[0].version === V, sent);
    check('then the screen goes', !(await p.page.$('.nge-principles-panel')));
    check('no page errors', p.errors.filter(e => !/Failed to fetch/.test(e)).length === 0, p.errors.slice(0, 3));
    // Only ever once (Ames 2026-10-27): after a reload, even with the server
    // still saying "not agreed", this browser does not ask again.
    await p.page.reload({ waitUntil: 'load' });
    await p.page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await p.page.addStyleTag({ content: HIDE_CSS });
    await p.page.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && login.sessions.length === 0) login.sessions.push({ key: 'auth_token_v2_https://global.daf-apis.com/sticky_auth', name: 'New Player', email: 'new@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      pb.userId = 'u-new'; pb.userName = 'New Player'; pb.username = 'newbie';
    });
    await p.page.waitForTimeout(3000);
    check('after agreeing, a reload never asks again', !(await p.page.$('.nge-principles-panel')));
    await p.context.close();

    // 3. Controls.
    const a = await player(browser, { version: V, agreed: true, at: '2026-10-27T10:00:00Z' });
    check('control: a player who agreed sees nothing (and was asked)', !(await a.page.$('.nge-principles-panel')) && a.calls.some(c => c.action === 'access.principlesStatus'));
    await a.context.close();
    const b = await player(browser, { version: V, agreed: false, at: null }, { invited: false, requested: false });
    check('control: a player at the beta screen is not asked yet', !(await b.page.$('.nge-principles-panel')) && !b.calls.some(c => c.action === 'access.principlesStatus') && !!(await b.page.$('.nge-beta-panel')));
    await b.context.close();
    const d = await player(browser, 500);
    check('control: a server error shows nothing (fails open)', !(await d.page.$('.nge-principles-panel')) && d.calls.some(c => c.action === 'access.principlesStatus'));
    await d.context.close();
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
  } finally {
    await browser.close();
  }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
