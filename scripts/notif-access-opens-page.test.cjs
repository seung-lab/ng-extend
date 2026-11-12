// Admins: an access note opens the Access page (Ames 2026-11-12: "clicking an
// access notif should open the access dash"), headless.
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    PORT=3558 node scripts/notif-access-opens-page.test.cjs
// Checks: a Beta request note opens ?triage=access at the email it names
// (unescaped); the weekly Access note opens the page with no person; a
// Proofreading Test note (Admin, not access) does not open it.
// Every server call is answered here; nothing reaches production.
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const PORT = process.env.PORT || 3558;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };

const NOTES = [
  { id: 901, title: '🔑 Beta access request from Dom', body: 'Dom asked to join.\n\nEmail: dom\\.a\\@hotmail\\.example\n\nTheir note:\n\nhi', created_at: new Date().toISOString() },
  { id: 902, title: '🔑 Access this week', body: '3 people asked. Celia at celia\\@eyewire\\.org can help.', created_at: new Date().toISOString() },
  { id: 903, title: 'Proofreading Test: Kim passed', body: 'kim\\@example\\.org scored 88%.', created_at: new Date().toISOString() },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const opened = () => page.evaluate(() => window.__opened.splice(0));
  const click = async (id) => {
    await page.evaluate((id) => document.dispatchEvent(new CustomEvent('nge:open-notification', { detail: { id } })), id);
    await page.waitForTimeout(700);
  };
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.addStyleTag({ content: HIDE_CSS });
    await page.waitForTimeout(1500);
    await page.evaluate((notes) => {
      window.__opened = [];
      window.open = (u) => { window.__opened.push(String(u)); return null; };
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const b = pinia._s.get('proofreadingBackend');
      b.isAdmin = true;
      b.loadNotifications = async () => {};
      b.markNotificationRead = () => {};
      b.notifications.splice(0, b.notifications.length, ...notes);
    }, NOTES);

    await click(901);
    let o = await opened();
    check('a Beta request note opens the Access page at that person', o.length === 1 && /\?triage=access&person=dom\.a%40hotmail\.example$/.test(o[0]), o);
    await click(902);
    o = await opened();
    check('the weekly Access note opens the page, not at a team email', o.length === 1 && /\?triage=access$/.test(o[0]), o);
    await click(903);
    o = await opened();
    check('a Proofreading Test note does not open the Access page', o.length === 0, o);
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
