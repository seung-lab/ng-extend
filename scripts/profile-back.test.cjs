// A profile opened from an Admin Hub list returns to that list when it
// closes (Celia 2026-11-09), headless.
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    node scripts/profile-back.test.cjs [shots dir]
// Checks: Admin Hub > Pilot testers, a name opens that player's profile,
// closing it shows Pilot testers again; Dataset requests do the same on the
// Access requests tab; a profile opened any other way still just closes.
// Every server call is answered here; nothing reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3558;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };
const ME = 'test-user';
const OTHER = 'other-user';
const USERS = [
  { id: ME, display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' },
  { id: OTHER, display_name: 'Nik Other', username: 'nik', middleauth_email: 'nik@example.org' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    const rows = input.table === 'users' ? USERS : [];
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  await context.route(/supabase\.co/, r => {
    const u = decodeURIComponent(r.request().url());
    if (/\/rest\/v1\/pilot_members/.test(u)) return r.fulfill(json([{ email: 'nik@example.org', enabled: true, created_at: new Date().toISOString() }]));
    if (/\/rest\/v1\/users/.test(u)) {
      const id = (u.match(/id=eq\.([^&]+)/) || [])[1];
      const rows = id ? USERS.filter(x => x.id === id) : USERS;
      return r.fulfill(json(/pgrst\.object/.test(String(r.request().headers()['accept'] || '')) ? (rows[0] || null) : rows));
    }
    return r.fulfill(json([]));
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const state = () => page.evaluate(() => {
    const shell = document.querySelector('.nge-profile-shell');
    const sub = document.querySelector('.nge-admin-subtab--active');
    return {
      open: !!shell,
      admin: !!document.querySelector('.nge-profile-body--admin'),
      sub: sub ? sub.textContent.trim() : null,
      pilot: !!document.querySelector('.nge-pilot-admin'),
      names: [...document.querySelectorAll('.nge-profile-shell h1, .nge-profile-shell h2, .nge-profile-name')].map(e => e.textContent.trim()).slice(0, 3),
    };
  });
  const send = (detail) => page.evaluate(d => document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: d })), detail);
  const close = async () => { await page.click('.nge-profile-exit--tabs'); await page.waitForTimeout(900); };
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; pb.isAdmin = true; } catch (e) {} }
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }, HIDE_CSS);
    await page.waitForTimeout(2000);

    await send({ tab: 'pilot' });
    await page.waitForTimeout(1500);
    let s = await state();
    check('Admin Hub opens on Pilot testers', s.admin && s.pilot, s);

    // The name in the Pilot testers list, as a click would.
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.nge-pilot-admin button')].find(x => /Nik Other/.test(x.textContent || ''));
      if (b) { b.click(); return true; } return false;
    });
    if (!clicked) await send({ userId: 'other-user', back: 'pilot' });
    await page.waitForTimeout(1500);
    s = await state();
    check('a name opens that player\'s profile', s.open && !s.admin, { clicked, ...s });
    await page.screenshot({ path: path.join(OUT, 'profile-back-other.png') });

    await close();
    s = await state();
    check('closing it returns to Pilot testers', s.open && s.admin && s.pilot, s);
    await page.screenshot({ path: path.join(OUT, 'profile-back-pilot.png') });

    await send({ userId: 'other-user', back: 'access' });
    await page.waitForTimeout(1500);
    await close();
    s = await state();
    check('from Dataset requests it returns to Access requests', s.open && s.admin && /Access/.test(s.sub || ''), s);

    await close();
    s = await state();
    check('closing the Admin Hub closes the profile', !s.open, s);

    await send({ userId: 'other-user' });
    await page.waitForTimeout(1500);
    await close();
    s = await state();
    check('a profile opened elsewhere just closes', !s.open, s);
    check('no page errors', errors.length === 0, errors);
  } catch (e) {
    check('ran without throwing', false, String(e).slice(0, 300));
  }
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
