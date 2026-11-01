// The Sandbox's Cell Library with no sheet behind it, headless (Ames 2026-11-01).
// Serve:  npm run dev-server-win
// Run:    node scripts/sandbox-library.test.cjs [shots dir] [base url]
// Checks: its cells come from the tasks alone: the list shows them, hidden
// ones stay out, the old sheet is never read, and claiming one writes to no sheet.
// Every server call is answered here; nothing reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const BASE = process.argv[3] || 'http://localhost:8080/';
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const NEW_SHEET = 'https://docs.google.com/spreadsheets/d/1lAX3pMqhevs-1JSs4VkWYQIIFKmQp1KDF2ND8QuZVXo/edit?gid=930129917';
const STATE = { dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] }, position: [84054, 50604, 1424], layout: '3d', layers: [
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2' }, name: 'pinky_nf_v2' },
] };
const task = (i, extra = {}) => ({ id: 1000 + i, segment_id: String(648518346351000000 + i * 1000), dataset: 'pinky_nf_v2', status: 'pending', assigned_to: null, soma_coords: `${80000 + i}, 50000, 1000`,
  nucleus_coords: null, claim_point_x: 80000 + i, claim_point_y: 50000, claim_point_z: 1000, supervoxel_id: String(75000000000000000 + i), notes: `Sheet #${i}`, source_sheet_url: NEW_SHEET, kind: 'cell',
  priority: 0, created_at: '2026-11-01T00:00:00+00:00', updated_at: '2026-11-01T00:00:00+00:00', ...extra });
const TASKS = [...Array.from({ length: 50 }, (_, i) => task(i + 1)),
  // An old cell someone still holds and one they finished stay; a hidden one does not show.
  task(90, { status: 'assigned', assigned_to: 'someone', notes: null, source_sheet_url: 'old' }),
  task(91, { status: 'completed', assigned_to: 'someone', notes: null, source_sheet_url: 'old' }),
  task(92, { status: 'skipped', notes: 'Retired', source_sheet_url: 'old' })];
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 300) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player', permissions_v2: { 'stroeh-mouse-retina': ['view', 'edit'], pinky100: ['view', 'edit'] } })));
  const sheetWrites = [], sheetReads = [], actions = [];
  await context.route(/docs\.google\.com/, r => { sheetReads.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/csv', body: 'Segment ID\n' }); });
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    const url = r.request().url();
    if (/ewSheetSync/.test(url)) { sheetWrites.push(input.action); return r.fulfill(json({ ok: true })); }
    if (/claim/i.test(JSON.stringify(input))) actions.push({ ...input, token: undefined });
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }]
      : input.table === 'proofreading_tasks' && !/assigned_to/.test(JSON.stringify(input)) ? TASKS : [];
    return r.fulfill(json({ status: 200, ok: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  await context.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/assigned_to=eq|task_assignments/.test(u)) return r.fulfill(json([]));
    if (/proofreading_tasks/.test(u)) return r.fulfill(json(/pinky_nf_v2|dataset=in/.test(u) || !/dataset=/.test(u) ? TASKS : []));
    return r.fulfill(json([]));
  });
  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(STATE)), { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 120000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }, HIDE_CSS);
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
    await page.waitForSelector('.nge-cl-panel', { timeout: 15000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.querySelector('.nge-cl-panel').innerText);
    console.log(text.replace(/\s+/g, ' ').slice(0, 400));
    const store = () => page.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      return { queue: pinia._s.get('proofreadingQueue')?.items?.length ?? null, sheet: pinia._s.get('proofreadingQueue')?.sheetUrl ?? '', tasks: pinia._s.get('proofreadingBackend').tasks.length };
    });
    const s = await store();
    check('the tasks are loaded', s.tasks === TASKS.length, s);
    check('no sheet rows are listed', !s.queue, s);
    check('the old sheet is never read', !sheetReads.some(u => u.includes('1SdepJzadXM')), sheetReads);
    const tabs = text.replace(/\s+/g, ' ');
    check('Available 50, All leaves the hidden cell out', /Available 50/.test(tabs) && /All 52/.test(tabs), tabs.slice(0, 80));
    await page.locator('.nge-cl-panel button', { hasText: /Available/ }).first().click();
    await page.waitForTimeout(800);
    const claimBtns = page.locator('.nge-cl-btn--claim');
    const n = await claimBtns.count();
    check('every one of the 50 unclaimed cells offers Claim, and the hidden one does not', n === 50, n);
    await page.screenshot({ path: path.join(OUT, 'sandbox-library.png') });
    await claimBtns.first().click();
    await page.waitForTimeout(2500);
    const claim = actions[0];
    check('claiming sends the cell', !!claim && claim.args?.id === 1001, { actions: actions.slice(-3), panel: (await page.evaluate(() => document.querySelector('.nge-cl-panel')?.innerText || '')).replace(/\s+/g, ' ').slice(0, 300) });
    check('nothing is written to a sheet', sheetWrites.length === 0, sheetWrites);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { check('the run finished', false, String(e).slice(0, 300)); }
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
