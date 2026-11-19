// The Retina "Start playing" hub and Lost Fragments Play, headless (Ames 2026-11-19).
// Build:  node scripts/build-prod.js
// Serve:  python -m http.server 3583 --directory dist/min
// Run:    node scripts/play-hub.test.cjs [base url] [screenshot dir]
// Checks, on a local build (a test site, so the hub is on):
//   edit access: the card shows BC Challenge, Lost Fragments, Cilia Quest, Glia Quest;
//     picking Lost Fragments and Start playing opens its tab on a fragment, with
//     Playing in the top bar; Skip goes to another fragment.
//   view only: Retina opens, the card shows, the edit quests are locked.
// Nothing reaches production: every server call is answered here.
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:3583/';
const SHOTS = process.argv[3] || '';
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 400) : '')); };

async function run(browser, perms, tag) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
    try { localStorage.removeItem('nge-play-kind'); localStorage.removeItem('nge_orphan_mock_v1'); localStorage.setItem('nge-cilia-training-autoplayed', '1'); } catch (e) {}
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  const me = { id: 1, email: 't@example.org', name: 'Test Player', permissions_v2: { 'stroeh-mouse-retina': perms, pinky100: ['view', 'edit'] } };
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)|\/auth\/api\/v1\/user\/\d+\/permissions/, r => r.fulfill(json(me)));
  await context.route(/docs\.google\.com/, r => r.fulfill({ status: 200, contentType: 'text/csv', body: 'Segment ID\n' }));
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }] : [];
    return r.fulfill(json({ status: 200, ok: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows), data: { invited: true } }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const out = {};
  try {
    const state = { dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [38932, 41971, 1222], layout: '3d', layers: [
      { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina' }, name: 'stroeh_mouse_retina' }] };
    await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(state)), { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }, HIDE_CSS);
    await page.waitForTimeout(5000);
    await page.evaluate(() => document.querySelectorAll('.introductionStep, .introductionStepAnchor, .nge-login-skip').forEach(e => e.remove()));
    await page.waitForSelector('.nge-play-btn', { timeout: 30000 });
    // A player without edit access starts on the Sandbox; they reach Retina through the
    // dataset switcher. Load Retina again, as the switcher does.
    if (!perms.includes('edit')) {
      await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(state)), { waitUntil: 'load' });
      await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 120000 });
      await page.waitForTimeout(3000);
      await page.evaluate(() => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        const login = pinia._s.get('login');
        if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
        const pb = pinia._s.get('proofreadingBackend');
        if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      });
      await page.waitForTimeout(5000);
      await page.evaluate(() => document.querySelectorAll('.introductionStep, .introductionStepAnchor, .nge-login-skip').forEach(e => e.remove()));
    }
    out.before = await page.evaluate(() => (window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState) || {}).name);
    await page.evaluate(() => document.querySelector('.nge-play-btn').click());
    await page.waitForTimeout(3000);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-play-${tag}.png` });
    out.dbg = await page.evaluate(() => ({ layer: (window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState) || {}).name, url: location.href.slice(0, 120), intro: !!document.querySelector(".introductionStep, .nge-intro-card, .nge-tut") }));
    await page.waitForSelector(".nge-play-hub", { timeout: 10000 });
    await page.waitForTimeout(800);
    out.cards = await page.evaluate(() => [...document.querySelectorAll('.nge-play-hub .nge-play-opt')].map(o => ({
      name: o.querySelector('.nge-play-opt-name').textContent.trim(), off: o.classList.contains('nge-play-opt--off'),
      lock: (o.querySelector('.nge-play-opt-lock, .nge-play-opt-note') || {}).textContent || '' })));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hub-${tag}.png` });
    if (perms.includes('edit')) {
      await page.evaluate(() => [...document.querySelectorAll('.nge-play-hub .nge-play-opt')].find(o => /Lost Fragments/.test(o.textContent)).click());
      await page.evaluate(() => [...document.querySelectorAll('.nge-play-card .nge-go')].find(b => /Start playing/.test(b.textContent)).click());
      await page.waitForSelector('.nge-orph-task', { timeout: 20000 });
      await page.waitForTimeout(1500);
      const seg = () => page.evaluate(() => (document.querySelector('.nge-orph-task-id') || {}).textContent || '');
      out.first = await seg();
      out.playingBar = await page.evaluate(() => !document.querySelector('.nge-orph-play') && !![...document.querySelectorAll('.nge-orph-link')].find(b => b.textContent.trim() === 'Stop') && !![...document.querySelectorAll('.nge-orph-btn')].find(b => b.textContent.trim() === 'Highlight'));
      out.chip = await page.evaluate(() => { const c = document.querySelector('.nge-play-chip'); return c ? c.textContent.trim() : null; });
      out.submitLabel = await page.evaluate(() => document.querySelector('.nge-orph-submit').textContent.trim());
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/fragments-playing.png` });
      await page.evaluate(() => [...document.querySelectorAll('.nge-orph-btn')].find(b => b.textContent.trim() === 'Skip').click());
      await page.waitForTimeout(1200);
      out.afterSkip = await seg();
      // Switch group from the fragment line, while playing.
      out.groupBefore = await page.evaluate(() => document.querySelector('.nge-orph-groupsel').value);
      await page.evaluate(() => { const sel = document.querySelector('.nge-orph-groupsel'); sel.value = 'soma'; sel.dispatchEvent(new Event('change')); });
      await page.waitForTimeout(1200);
      out.groupAfter = await page.evaluate(() => [document.querySelector('.nge-orph-groupsel').value, (document.querySelector('.nge-orph-task-meta') || {}).textContent || '']);
      out.slimBar = await page.evaluate(() => !!document.querySelector('.nge-orph--slim'));
      // Close the library and open it again: still on Lost Fragments (Ames 2026-11-19).
      out.beforeClose = await seg();
      await page.evaluate(() => { const t = document.querySelector('.nge-orph-notes'); t.value = 'kept note'; t.dispatchEvent(new Event('input')); });
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:close-cell-library')));
      await page.waitForTimeout(800);
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:open-cell-library')));
      await page.waitForTimeout(1500);
      out.reopened = await page.evaluate(() => !!document.querySelector('.nge-orph'));
      out.afterReopen = await seg();
      out.noteKept = await page.evaluate(() => (document.querySelector('.nge-orph-notes') || {}).value);
      // Play again while that one is open: it stays (Ames 2026-11-19).
      // The chip in the top bar: one press hides the library, the next goes back to the task.
      for (let i = 0; i < 2; i++) { await page.evaluate(() => document.querySelector('.nge-play-chip').click()); await page.waitForTimeout(6000); }
      out.afterReplay = await seg();
      out.replayDbg = await page.evaluate(() => ({ orph: !!document.querySelector('.nge-orph'), slim: !!document.querySelector('.nge-orph--slim'), lib: !!document.querySelector('.nge-cl-panel'), empty: (document.querySelector('.nge-orph-slim-empty') || {}).textContent, tut: !!document.querySelector('.nge-tut, .nge-training, .introductionStep') }));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/replay.png` });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/fragments-reopened.png` });
      // The full view, for the banner.
      await page.evaluate(() => { const b = document.querySelector('.nge-cl-slim-expand'); if (b) b.click(); });
      await page.waitForTimeout(1500);
      out.playHere = await page.evaluate(() => { const st = [...document.querySelectorAll('.nge-orph-link')].find(b => b.textContent.trim() === 'Stop'); if (st) st.click(); return true; });
      await page.waitForTimeout(800);
      out.playHere = await page.evaluate(() => !!document.querySelector('.nge-orph-playhere'));
      out.banner = await page.evaluate(() => { const b = document.querySelector('.nge-orph-banner'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(b).backgroundImage.slice(0, 60) }; });
      if (SHOTS) { const el = await page.$('.nge-orph'); if (el) await el.screenshot({ path: `${SHOTS}/fragments-banner.png` }); }
    }
  } catch (e) { out.error = String(e).slice(0, 300); }
  await context.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ed = await run(browser, ['view', 'edit'], 'edit');
  const names = (ed.cards || []).map(c => c.name);
  check('edit: four quests on the card', ['BC Challenge', 'Lost Fragments', 'Cilia Quest', 'Glia Quest'].every(n => names.includes(n)), ed.cards || ed);
  check('edit: Lost Fragments and Cilia open', (ed.cards || []).filter(c => /Lost|Cilia/.test(c.name)).every(c => !c.off), ed.cards);
  check('edit: Start playing lands on a fragment, full ID shown', /^\d{15,}$/.test(ed.first || ''), ed.first);
  check('edit: no Playing box; Stop, Highlight and Submit and next show', ed.playingBar && /Submit and next/.test(ed.submitLabel || ''), ed);
  check('edit: the top bar says Lost Fragments', /Lost Fragments/.test(ed.chip || ''), ed.chip);
  check('edit: Play shows the slim bar on Lost Fragments', ed.slimBar, ed.slimBar);
  check('edit: reopening the library stays on Lost Fragments', ed.reopened, ed.reopened);
  check('edit: Play here shows in the full view when not playing', ed.playHere, ed.playHere);
  check('edit: the banner shows in the full view', ed.banner && ed.banner.w > 200 && /lost-fragments-banner/.test(ed.banner.bg), ed.banner);
  check('edit: the group menu switches to Soma-like', ed.groupBefore === 'large' && ed.groupAfter && ed.groupAfter[0] === 'soma' && /1 of/.test(ed.groupAfter[1]), [ed.groupBefore, ed.groupAfter]);
  check('edit: reopening keeps the fragment and the note', ed.beforeClose && ed.afterReopen === ed.beforeClose && ed.noteKept === 'kept note', [ed.beforeClose, ed.afterReopen, ed.noteKept]);
  check('edit: Play again stays on the open fragment', ed.afterReplay === ed.beforeClose, [ed.beforeClose, ed.afterReplay, ed.replayDbg]);
  check('edit: Skip goes to another fragment', ed.afterSkip && ed.afterSkip !== ed.first, [ed.first, ed.afterSkip]);
  // View only (Ames 2026-11-19: "Yes, unlock to view"): Retina opens, and the card shows
  // with the edit quests locked.
  const vw = await run(browser, ['view'], 'view');
  check('view: stays on Retina', /retina/i.test(String(vw.before || '')) && /retina/i.test(String((vw.dbg || {}).layer || '')), [vw.before, vw.dbg]);
  check('view: the card shows', (vw.cards || []).length === 4, vw.cards || vw);
  check('view: Cilia and Lost Fragments locked', (vw.cards || []).filter(c => /Lost|Cilia/.test(c.name)).every(c => c.off && /edit access/.test(c.lock)), vw.cards);
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
