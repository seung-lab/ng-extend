// Pyr invite only: the beta access popup, headless (Ames 2026-10-24).
// Build:  node scripts/build-prod.js
// Serve:  python -m http.server 3561 --directory dist/min
// Run:    node scripts/beta-gate.test.cjs [shots dir]
// Checks: a signed in player the server calls not invited gets the popup,
// sees its name and email filled in, is stopped on a bad email or an
// empty name, can send the request once (name, email, optional note), and then sees "Your request is
// in"; the popup cannot be closed by Escape or a click outside. Controls: a
// tester gets no popup, and neither does anyone when the server cannot be
// asked (it fails open; the server still refuses their writes).
// Every server call is answered here; nothing reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3561;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

/** One browser per player. `status` answers access.betaStatus: an object, or a number for an error. */
async function player(browser, status) {
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
    if (input.action === 'access.betaStatus') return typeof status === 'number' ? r.fulfill(json({ error: 'down' }, status)) : r.fulfill(json({ ok: true, data: status }));
    if (input.action === 'access.beta') return r.fulfill(json({ ok: true, data: { invited: false, requested: true } }));
    return r.fulfill(json({ ok: true, data: null }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
  await page.addStyleTag({ content: HIDE_CSS });
  // Signed in: the popup asks the server once the player's id is known.
  await page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const login = pinia._s.get('login');
    if (login && login.sessions.length === 0) login.sessions.push({ key: 'auth_token_v2_https://global.daf-apis.com/sticky_auth', name: 'New Player', email: 'new@example.org', hostname: 'test' });
    const pb = pinia._s.get('proofreadingBackend');
    pb.userId = 'u-new'; pb.userName = 'New Player'; pb.username = 'newbie';
  });
  await page.waitForTimeout(2500);
  return { context, page, calls, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    // 1. Not on the list, no request yet.
    const p = await player(browser, { invited: false, requested: false });
    const shown = await p.page.$('.nge-beta-panel');
    check('not on the list: the popup shows', !!shown);
    const text = shown ? (await p.page.innerText('.nge-beta-panel')).replace(/\s+/g, ' ') : '';
    check('it says invite only and names support@eyewire.ai', /Pyr is invite only for now/i.test(text) && /support@eyewire\.ai/.test(text), text.slice(0, 200));
    check('no dashes in its words', !/[\u2013\u2014]/.test(text));
    // Ames 2026-10-26: the radio played under the screen, with no way to stop it.
    check('the radio is not there behind the screen', !(await p.page.evaluate(() => document.body.classList.contains('nge-radio-on'))));
    const box0 = await p.page.locator('.nge-beta-panel').boundingBox();
    await p.page.screenshot({ path: path.join(OUT, 'beta-gate.png'), clip: { x: box0.x - 30, y: box0.y - 30, width: box0.width + 60, height: box0.height + 60 } });
    await p.page.keyboard.press('Escape');
    await p.page.mouse.click(20, 450);
    await p.page.waitForTimeout(400);
    check('Escape and a click outside leave it up', !!(await p.page.$('.nge-beta-panel')));
    // Filled in from the sign in.
    const pre = await p.page.evaluate(() => ({ name: document.querySelector('#nge-beta-name').value, email: document.querySelector('#nge-beta-email').value }));
    check('name and email are filled in from the sign in', pre.name === 'New Player' && pre.email === 'new@example.org', pre);
    // A bad email is caught here, and nothing is sent.
    await p.page.fill('#nge-beta-email', 'not an email');
    await p.page.click('.nge-beta-btn');
    await p.page.waitForTimeout(300);
    const err = await p.page.$eval('.nge-beta-error', el => el.innerText).catch(() => '');
    check('a bad email says so, and nothing is sent', /email does not look right/.test(err) && !p.calls.some(c => c.action === 'access.beta'), err);
    await p.page.fill('#nge-beta-name', '');
    await p.page.fill('#nge-beta-email', 'new@example.org');
    await p.page.click('.nge-beta-btn');
    await p.page.waitForTimeout(300);
    const err2 = await p.page.$eval('.nge-beta-error', el => el.innerText).catch(() => '');
    check('an empty name says so, and nothing is sent', /add your name/.test(err2) && !p.calls.some(c => c.action === 'access.beta'), err2);
    await p.page.fill('#nge-beta-name', "Zoë O'Brien");
    await p.page.fill('#nge-beta-note', 'My EyeWire name is tester1');
    await p.page.click('.nge-beta-btn');
    await p.page.waitForSelector('.nge-beta-text--done', { timeout: 5000 }).catch(() => {});
    const sent = p.calls.filter(c => c.action === 'access.beta');
    check('Request beta access sends one request: name, email and note', sent.length === 1 && sent[0].name === "Zoë O'Brien" && sent[0].email === 'new@example.org' && sent[0].note === 'My EyeWire name is tester1', sent);
    const done = (await p.page.innerText('.nge-beta-panel')).replace(/\s+/g, ' ');
    check('then it thanks them, signs off, and offers no button', /Thanks for requesting early access to map the brain/.test(done) && /The Pyr \(pronounced "peer"\) team at Princeton University/.test(done) && !(await p.page.$('.nge-beta-btn')), done.slice(0, 200));
    const links = await p.page.$$eval('.nge-beta-links a', as => as.map(a => a.href));
    check('and offers EyeWire and things to learn while they wait', links.some(h => /eyewire\.org/.test(h)) && links.filter(h => /connectome\.quest/.test(h)).length >= 2, links);
    check('no dashes in the thanks', !/[–—]/.test(done));
    const box = await p.page.locator('.nge-beta-panel').boundingBox();
    await p.page.screenshot({ path: path.join(OUT, 'beta-gate-sent.png'), clip: { x: box.x - 30, y: box.y - 30, width: box.width + 60, height: box.height + 60 } });
    check('no page errors', p.errors.filter(e => !/Failed to fetch/.test(e)).length === 0, p.errors.slice(0, 3));
    await p.context.close();

    // 2. Already asked: no button, "Your request is in".
    const q = await player(browser, { invited: false, requested: true });
    check('asked before: the popup says the request is in, no button', !!(await q.page.$('.nge-beta-text--done')) && !(await q.page.$('.nge-beta-btn')));
    await q.context.close();

    // 3. Controls: a tester, and a server that cannot be asked.
    const t = await player(browser, { invited: true, requested: false });
    check('control: a tester gets no popup (and was asked)', !(await t.page.$('.nge-beta-panel')) && t.calls.some(c => c.action === 'access.betaStatus'));
    check('control: a tester gets the radio', await t.page.evaluate(() => document.body.classList.contains('nge-radio-on')));
    await t.context.close();
    const d = await player(browser, 500);
    check('control: a server error shows no popup (fails open)', !(await d.page.$('.nge-beta-panel')) && d.calls.some(c => c.action === 'access.betaStatus'));
    await d.context.close();
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
  } finally {
    await browser.close();
  }
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
