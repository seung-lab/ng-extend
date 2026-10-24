// Help notifications open on their request, and the Help tab's All / Mine
// switch, headless (2026-10-24).
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    node scripts/help-focus.test.cjs [shots dir]
// Checks: "Open in Help tab" on a reply notification opens the Help tab on
// the player's own request that reply was on, highlighted and scrolled into
// view, also when it sits under another dataset's folded group; Mine shows
// only the player's requests and All everyone's; the Help tab's number stays
// everyone's open requests.
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

// 12 open requests on the Sandbox (the dataset on screen), two of them the
// player's, plus one of the player's on Retina (another dataset's group).
const ME = 'test-user';
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const reqRow = (i, user, dataset = 'pinky_nf_v2') => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, segment_id: String(648518346353830000 + i), position: '[1,2,3]', note: `request ${i}`, issue_type: 'merge', created_at: day(i), resolved: false, dataset, user_id: user, user_name: user === ME ? 'Test Player' : 'Other ' + i });
const REQS = [];
for (let i = 1; i <= 12; i++) REQS.push(reqRow(i, i === 3 || i === 11 ? ME : 'other-' + i));
REQS.push(reqRow(20, ME, 'stroeh_mouse_retina'));
const T_FAR = REQS[10].id;   // request 11: mine, far down the list
const T_CROSS = REQS[12].id; // request 20: mine, on Retina
const RESPONSES = [
  { id: 'r1', request_id: T_FAR, user_id: 'nseraf', user_name: 'Nseraf', note: "16 days ago, this should probs be 'resolved'?", created_at: day(1), resolved: false },
  { id: 'r2', request_id: REQS[2].id, user_id: 'nseraf', user_name: 'Nseraf', note: 'Looks fine to me', created_at: day(1), resolved: false },
  { id: 'r3', request_id: T_CROSS, user_id: 'celia', user_name: 'celiad', note: 'Thanks for sending! I only see one ID here though.', created_at: day(2), resolved: false },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate', host + '/nglstate/', host + '/nglstate/api/v1', host + '/segmentation', host + '/segmentation/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
    try { localStorage.removeItem('nge_cl_help_scope'); } catch (e) {}
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    const rows = input.table === 'users' ? [{ id: ME, display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }] : [];
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  await context.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/\/rest\/v1\/help_requests/.test(u) && r.request().method() === 'GET') return r.fulfill(json(REQS));
    if (/\/rest\/v1\/help_responses/.test(u) && r.request().method() === 'GET') return r.fulfill(json(RESPONSES));
    return r.fulfill(json([]));
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const state = () => page.evaluate(() => {
    const panel = document.querySelector('.nge-cl-panel');
    const active = document.querySelector('.nge-cl-panel .nge-cl-help-item--active');
    const tab = document.querySelector('.nge-cl-panel .nge-cl-tabgroup-row button.active');
    let inView = false;
    if (active && panel) {
      const a = active.getBoundingClientRect(), p = panel.getBoundingClientRect();
      inView = a.top >= p.top && a.bottom <= p.bottom;
    }
    return {
      open: !!panel, tab: tab ? tab.innerText.replace(/\s+/g, ' ').trim() : null,
      activeId: active ? active.getAttribute('data-help-id') : null, inView,
      items: [...document.querySelectorAll('.nge-cl-panel [data-help-id]')].map(e => e.getAttribute('data-help-id')),
    };
  });
  const openReply = async (body) => {
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:close-cell-library')));
    await page.waitForTimeout(400);
    await page.evaluate((body) => document.dispatchEvent(new CustomEvent('nge:preview-notification', { detail: { title: '💬 Response to your help request', body } })), body);
    await page.waitForSelector('.nge-notif-open-help', { timeout: 10000 });
    await page.click('.nge-notif-open-help');
    await page.waitForSelector('.nge-cl-panel', { timeout: 10000 });
    await page.waitForTimeout(1800);
  };
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }, HIDE_CSS);
    await page.waitForTimeout(2500);

    await openReply("Nseraf responded: 16 days ago, this should probs be 'resolved'?");
    let s = await state();
    check('a reply note opens the Help tab', s.open && /^Help/.test(s.tab || ''), s.tab);
    check('on the request the reply was on, highlighted', s.activeId === T_FAR, s.activeId);
    check('scrolled into view', s.inView, s.inView);
    await page.screenshot({ path: path.join(OUT, 'help-focus.png') });

    await openReply('celiad responded: Thanks for sending! I only see one ID here though.');
    s = await state();
    check('a request on another dataset: its group opens and it is highlighted in view', s.activeId === T_CROSS && s.inView, { activeId: s.activeId, inView: s.inView });

    // All / Mine.
    const counts = await page.evaluate(() => [...document.querySelectorAll('.nge-cl-help-scope button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
    check('the switch reads All requests 13 and Mine 3', JSON.stringify(counts) === JSON.stringify(['All requests 13', 'Mine 3']), counts);
    await page.click('.nge-cl-help-scope button:has-text("Mine")');
    await page.waitForTimeout(500);
    s = await state();
    const mine = REQS.filter(r => r.user_id === ME).map(r => r.id);
    // Other groups fold; count what is listed plus mine on the folded group.
    check('Mine lists only your requests', s.items.length > 0 && s.items.every(id => mine.includes(id)), s.items);
    const helpTab = await page.evaluate(() => document.querySelector('.nge-cl-help-tab').innerText.replace(/\s+/g, ' ').trim());
    check('the Help tab still counts everyone\'s open requests', helpTab === 'Help 13', helpTab);
    await page.screenshot({ path: path.join(OUT, 'help-mine.png') });
    await page.click('.nge-cl-help-scope button:has-text("All requests")');
    await page.waitForTimeout(500);
    s = await state();
    check('All lists everyone again', s.items.some(id => !mine.includes(id)), s.items.length);
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
    try { await page.screenshot({ path: path.join(OUT, 'help-focus-failed.png') }); } catch (e2) { /* no picture */ }
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
