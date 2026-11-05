// Admin Hub, Pilot testers, Beta requests (Ames 2026-10-26: "Where should I
// see the access request? Can you grant me a button that adds their email to
// the pilot tester list?"), headless.
// Build:  node scripts/build-prod.js
// Serve:  python -m http.server 3561 --directory dist/min
// Run:    node scripts/beta-requests.test.cjs [shots dir]
// Checks: every Beta access report is listed once per email, newest first,
// with the right email (the sign in email from the game, the given one from
// connectome.quest, never one typed in a note); Let them in adds that email
// to pilot_members and the row then says In with Email them; someone already
// a tester is not listed as waiting. Every server call is answered here.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3561;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 300) : '')); };

const { handle } = require('../functions/access-request');
// What functions/access-request.js writes, in its three shapes.
const ISSUES = [
  { id: 'i4', category: 'Beta access', user_name: 'Sophia Sterling', title: 'Beta access request from Sophia Sterling', url: null, created_at: '2026-10-26T15:00:00Z',
    message: 'Sophia Sterling asks to join the Pyr beta.\nEmail: sophia@example.org. To let them in, add this one under Admin Hub, Pilot testers.\nTheir note: Sign in email: evil@example.org. please' },
  { id: 'i3', category: 'Beta access', user_name: 'Vic Visitor', title: 'Beta access request from Vic Visitor (connectome.quest)', url: 'https://connectome.quest/access.html', created_at: '2026-10-26T14:00:00Z',
    message: 'Vic Visitor asks to join the Pyr beta, from connectome.quest.\nEmail they gave: vic@example.org. They have not signed in to Pyr yet. To let them in, add this email under Admin Hub, Pilot testers, and tell them to sign in with it.\nThey agreed to the community principles.' },
  { id: 'i2', category: 'Beta access', user_name: 'Gus Game', title: 'Beta access request from Gus Game', url: null, created_at: '2026-10-25T10:00:00Z',
    message: 'Gus Game asks to join the Pyr beta.\nEmail they gave: gus@home.example\nSign in email: gus@work.example. To let them in, add this one under Admin Hub, Pilot testers.\nEyeWire username: gus_ew\nEyeWire rank: Scythe' },
  { id: 'i1', category: 'Beta access', user_name: 'Tess Tester', title: 'Beta access request from Tess Tester', url: null, created_at: '2026-10-24T10:00:00Z',
    message: 'Tess Tester asks to join the Pyr beta.\nEmail: tess@example.org. To let them in, add this one under Admin Hub, Pilot testers.' },
  { id: 'i0', category: 'Beta access', user_name: 'Vic Visitor', title: 'Beta access request from Vic Visitor (connectome.quest)', url: 'https://connectome.quest/access.html', created_at: '2026-10-20T10:00:00Z',
    message: 'Vic Visitor asks to join the Pyr beta, from connectome.quest.\nEmail they gave: vic@example.org. They have not signed in to Pyr yet.' },
];

(async () => {
  const pilot = [{ email: 'tess@example.org', enabled: true }];
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: [] };
    try { localStorage.setItem('auth_token_v2_https://global.daf-apis.com/sticky_auth', JSON.stringify(token)); } catch (e) {}
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org|microns-daf\.com/, r => r.abort());
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  // Registered first: Playwright tries the last registered route first.
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ ok: true, data: { invited: true } })));
  // Add to list and Remove request, answered by the real rules over a stand-in store.
  const store = {};
  const marks = { all: async () => ({ ...store }), set: async (e, v) => { if (v) store[e] = v; else delete store[e]; } };
  await context.route(/ewSecureWrite/, r => {
    let i = {}; try { i = r.request().postDataJSON() || {}; } catch (e) {}
    if (i.action === 'triage.update') { triageUpdates.push(i); if (i.fields && i.fields.status) cardStatus = i.fields.status; }
    r.fulfill(json({ ok: true, data: [] }));
  });
  await context.route(/ewAccessRequest/, async r => {
    let i = {}; try { i = r.request().postDataJSON() || {}; } catch (e) {}
    const { action, token, ...args } = i;
    if (action === 'access.betaStatus') return r.fulfill(json({ ok: true, data: { invited: true } }));
    try { r.fulfill(json({ ok: true, data: await handle(action, args, { marks, isAdmin: true, who: { email: 'amy@example.org' } }) })); }
    catch (e) { r.fulfill(json({ error: e.message }, e.status || 500)); }
  });
  const upserts = [];
  let cardStatus = 'proposed';
  const triageUpdates = [];
  const envelope = (body) => json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await context.route(/ewCommunityData/, r => {
    let i = {}; try { i = r.request().postDataJSON() || {}; } catch (e) {}
    if (i.table === 'site_issues' && i.method === 'GET') {
      const q = new URLSearchParams(i.query);
      if (q.get('category') === 'eq.Beta access') return r.fulfill(envelope(ISSUES));
      const ids = (q.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(x => x.replace(/"/g, ''));
      return r.fulfill(envelope(ISSUES.filter(x => ids.includes(x.id))));
    }
    // One triage card: Gus's request (Ames 2026-10-26: let them in from the card).
    if (i.table === 'feedback_triage' && i.method === 'GET') {
      const q = new URLSearchParams(i.query);
      if (q.get('status') && q.get('status') !== 'eq.proposed' && !/proposed/.test(q.get('status'))) return r.fulfill(envelope([]));
      return r.fulfill(envelope([{ id: 'tc1', source: 'site_issue', source_id: 'i2', status: cardStatus, recommendation: 'nothing',
        rationale: 'No suggestion yet. To get one, press Suggest a fix on this card.', created_at: '2026-10-25T10:01:00Z', source_excerpt: 'Gus Game asks to join the Pyr beta.' }]));
    }
    if (i.table === 'pilot_members' && i.method === 'GET') return r.fulfill(envelope(pilot));
    if (i.table === 'pilot_members' && i.method === 'POST') {
      for (const row of [].concat(i.body)) { upserts.push(row); const hit = pilot.find(p => p.email === row.email); if (hit) Object.assign(hit, row); else pilot.push({ ...row }); }
      return r.fulfill(envelope([]));
    }
    return r.fulfill(envelope([]));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.addStyleTag({ content: HIDE_CSS });
    await page.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && login.sessions.length === 0) login.sessions.push({ name: 'Ames', email: 'amy@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      pb.userId = 'u-admin'; pb.userName = 'Ames'; pb.username = 'amy'; pb.userEmail = 'amy@example.org'; pb.isAdmin = true;
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'pilot' } })));
    await page.waitForSelector('.nge-beta-req li', { timeout: 15000 });
    await page.waitForTimeout(600);
    const rows = await page.$$eval('.nge-beta-req li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')));
    check('three waiting, newest first, one row per email', rows.length === 3 && /Sophia/.test(rows[0]) && /Vic/.test(rows[1]) && /Gus/.test(rows[2]), rows);
    check('the game request shows the email from the server line, not the note', /sophia@example\.org/.test(rows[0]) && !/· evil@/.test(rows[0]), rows[0]);
    check('the note is shown', /please/.test(rows[0]));
    check('a site request says so', /from connectome\.quest/.test(rows[1]) && /vic@example\.org/.test(rows[1]));
    check('two emails: the sign in one is listed', /gus@work\.example/.test(rows[2]));
    check('someone already a tester is not waiting', !rows.some(r => /Tess/.test(r)));
    const box = await page.locator('.nge-pilot-admin').boundingBox();
    await page.screenshot({ path: path.join(OUT, 'beta-requests.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(700, box.height) } });
    await page.click('.nge-beta-req li >> nth=1 >> text=Let them in');
    await page.waitForTimeout(800);
    check('Let them in adds that email to the pilot testers', upserts.length === 1 && upserts[0].email === 'vic@example.org' && upserts[0].enabled === true, upserts);
    const after = await page.$$eval('.nge-beta-req li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')));
    check('then they leave the waiting list', after.length === 2 && !after.some(r => /Vic/.test(r)), after);
    const rowsNow = () => page.$$eval('.nge-beta-req li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')));
    const view = async (label) => { await page.click(`.nge-beta-views button:has-text("${label}")`); await page.waitForTimeout(300); };
    check('EyeWire username and rank show', /EyeWire: gus_ew, Scythe/.test(after.find(r => /Gus/.test(r)) || ''), after);
    // Add to list: off the waiting page, onto On the list, kept by the server.
    await page.click('.nge-beta-req li:has-text("Gus") >> text=Add to list');
    await page.waitForTimeout(600);
    check('Add to list takes them off Waiting', !(await rowsNow()).some(r => /Gus/.test(r)));
    check('and keeps them in the database list', store['gus@work.example'] && store['gus@work.example'].mark === 'listed', store);
    await view('On the list');
    check('On the list shows them, with Let them in', (await rowsNow()).some(r => /Gus/.test(r) && /Let them in/.test(r)));
    // Remove request.
    await view('Waiting');
    await page.click('.nge-beta-req li:has-text("Sophia") >> text=Remove request');
    await page.waitForTimeout(600);
    check('Remove request takes them off Waiting', !(await rowsNow()).some(r => /Sophia/.test(r)) && store['sophia@example.org'] && store['sophia@example.org'].mark === 'removed');
    await view('Removed');
    check('Removed shows them', (await rowsNow()).some(r => /Sophia/.test(r)));
    await page.click('.nge-beta-req li:has-text("Sophia") >> text=Back to waiting');
    await page.waitForTimeout(600);
    await view('Waiting');
    check('Back to waiting brings them back', (await rowsNow()).some(r => /Sophia/.test(r)) && !store['sophia@example.org']);
    const counts = (await page.innerText('.nge-beta-views')).replace(/\s+/g, ' ');
    check('the tabs count each list', /Waiting 1/.test(counts) && /On the list 1/.test(counts) && /Let in 2/.test(counts) && /Removed 0/.test(counts), counts);
    await page.screenshot({ path: path.join(OUT, 'beta-requests-sorted.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(700, box.height) } });
    await view('Let in');
    const all = await rowsNow();
    const vic = all.find(r => /Vic/.test(r)) || '';
    check('Let in: Vic says In, with Email them', /\bIn\b/.test(vic) && /Email them/.test(vic), all);
    const mail = await page.$eval('.nge-beta-req-mail', a => a.getAttribute('href')).catch(() => '');
    check('Email them is addressed to them and has no dashes', /^mailto:/.test(mail) && !/%E2%80%93|%E2%80%94/i.test(mail), mail.slice(0, 120));
    // The triage card: Let them in, right on a Beta access card. The board
    // is its own page (?triage=board), signed in the same way.
    upserts.length = 0;
    await context.route(/user\/me/, r => r.fulfill(json({ email: 'amy@example.org', name: 'Ames' })));
    const board = await context.newPage();
    board.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    await board.goto(`http://localhost:${PORT}/?triage=board`, { waitUntil: 'load' });
    await board.waitForSelector('.nge-triage-beta', { timeout: 20000 }).catch(() => {});
    const cardText = await board.$eval('.nge-triage-beta', e => e.innerText).catch(() => '');
    if (!cardText) { console.log('DEBUG', (await board.evaluate(() => document.body.innerText.slice(0, 900))).replace(/\s+/g, ' ')); await board.screenshot({ path: path.join(OUT, 'card-debug.png') }); }
    check('a Beta access triage card has Let them in, with the email it will add', /Let them in/.test(cardText) && /gus@work\.example/.test(cardText), cardText);
    await board.click('text=Beta access request from Gus Game').catch(() => {});
    await board.waitForTimeout(800);
    const cardBox = await board.locator('.nge-triage-beta').boundingBox().catch(() => null);
    if (cardBox) await board.screenshot({ path: path.join(OUT, 'triage-card.png'), clip: { x: Math.max(0, cardBox.x - 30), y: Math.max(0, cardBox.y - 220), width: Math.min(900, cardBox.width + 400), height: 320 } });
    await board.click('.nge-triage-beta >> text=Let them in').catch(() => {});
    await board.waitForTimeout(1500);
    check('Let them in on the card adds that email to Pilot testers', upserts.length === 1 && upserts[0].email === 'gus@work.example' && upserts[0].enabled === true, upserts);
    const done = triageUpdates.find(u => u.fields && u.fields.status === 'done');
    check('and moves the card to Done with a note', !!done && /gus@work\.example added to Pilot testers/.test(JSON.stringify(done)), triageUpdates);
    await board.close();
    const text = await page.innerText('.nge-pilot-admin');
    check('no dashes in the words', !/[\u2013\u2014]/.test(text));
    check('no page errors', errors.filter(e => !/Failed to fetch/.test(e)).length === 0, errors.slice(0, 3));
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'beta-requests-fail.png') }).catch(() => {});
    console.log(await page.evaluate(() => (document.querySelector('.nge-pilot-admin') || document.querySelector('.nge-profile-shell') || document.body).innerText.slice(0, 600)).catch(() => ''));
  } finally {
    await browser.close();
  }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
