// "?tutorialBox=T.S" opens tutorial T at box S for an admin, and does
// nothing for a player (Ames 2026-11-09), headless.
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    node scripts/tutorial-box-jump.test.cjs
// Every server call is answered here; nothing reaches production.
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const PORT = process.env.PORT || 3558;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };

async function visit(browser, query, admin, saved) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate', host + '/nglstate/', host + '/nglstate/api/v1', host + '/segmentation', host + '/segmentation/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/cloudfunctions\.net|run\.app/, async r => {
    // Reads of "users" go through the server (src/community_fetch.ts): the
    // account's saved tutorial place, arriving late (Ames 2026-11-10: her
    // saved place, tutorial 1 with Advanced Interface finished, landed after
    // the jump and hid the box).
    if (saved && /tutorial_active/.test(decodeURIComponent(r.request().postData() || '') + r.request().url())) {
      saved.hit = (saved.hit || 0) + 1;
      await new Promise(res => setTimeout(res, saved.delay));
      return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved.row) }));
    }
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
  await page.evaluate(([css, isAdmin]) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const login = pinia._s.get('login');
    if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
    const pb = pinia._s.get('proofreadingBackend');
    if (pb) { const set = () => { try { pb.userId = "test-user"; pb.userName = "Test Player"; pb.isAdmin = isAdmin; } catch (e) {} }; set(); setInterval(set, 100); }
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }, [HIDE_CSS, admin]);
  await page.waitForTimeout(saved ? saved.delay + 4000 : 5000);
  const s = await page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const t = pinia._s.get('tutorial');
    return { settled: t.hydrateSettledFor, uid: pinia._s.get("proofreadingBackend").userId, admin: pinia._s.get("proofreadingBackend").isAdmin, tutorial: t.activeTutorial, step: t.getTutorialStep(), url: location.search, box: (document.querySelector('.introductionStepAnchor .chip')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null, chips: document.querySelectorAll('.introductionStepAnchor .chip').length, anchors: document.querySelectorAll('.introductionStepAnchor').length, resume: !!document.querySelector('.nge-tut-resume') };
  });
  await context.close();
  if (saved) s.savedLoads = saved.hit || 0;
  return { s, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    let r = await visit(browser, '?tutorialBox=2.5', true);
    check('an admin lands on Advanced Interface, box 5', r.s.tutorial === 2 && r.s.step === 5, r.s);
    check('that box shows (Part 2, box 1), with no "partway through" question', /Part 2 of 4 .* 01 \/ 10/.test(r.s.box || '') && !r.s.resume, r.s);
    check('the link is used once: it leaves the address', !/tutorialBox/.test(r.s.url), r.s.url);
    check('no page errors (admin)', r.errors.length === 0, r.errors);
    // An admin whose saved place loads late, after where the jump used to fire.
    r = await visit(browser, '?tutorialBox=2.5', true, { delay: 4000, row: { tutorial_active: 1, tutorial_1_step: 21, tutorial_2_step: 33, tutorial_3_step: 17 } });
    check('a saved place arriving late does not hide the box', r.s.tutorial === 2 && r.s.step === 5 && /Part 2 of 4/.test(r.s.box || ''), r.s);
    // Cut and Merge boxes wait for a practice cell, which this offline test
    // cannot load: the jump lands, the box waits (as it does for players).
    r = await visit(browser, '?tutorialBox=5.3', true);
    check('Cut needs its practice cell: the link starts Cut from its start', r.s.tutorial === 5 && r.s.step === 0, r.s);
    r = await visit(browser, '?tutorialBox=1.999', true);
    check('a box past the end opens the last box', r.s.tutorial === 1 && r.s.step > 0, r.s);
    r = await visit(browser, '?tutorialBox=5.3', false);
    check('a player is not moved', !(r.s.tutorial === 5 && r.s.step === 3), r.s);
    r = await visit(browser, '?tutorialBox=5.3x', true);
    check('a bad link does nothing', !(r.s.tutorial === 5 && r.s.step === 3), r.s);
  } catch (e) {
    check('ran without throwing', false, String(e).slice(0, 300));
  }
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
