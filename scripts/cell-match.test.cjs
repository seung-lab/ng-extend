// Cell match on a Sandbox claim, headless (Ames 2026-11-12).
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3571 --directory dist/min
// Run:    node scripts/cell-match.test.cjs [shots dir] [base url]
// Checks: with the player's Sandbox claim on screen, the card asks the server
// (ewSandboxMatch) and shows the match and the pieces; an edit dims it to
// "Checking" and, 2 s after the last of a burst of edits, asks once more and
// shows the new number with its change; a cell with no true cell hides the
// card; off screen it goes away. The answers are the test's own; nothing
// reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const BASE = process.argv[3] || 'http://localhost:3571/';
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const SEG = '648518346351001000';
const STATE = { dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] }, position: [84054, 50604, 1424], layout: '3d', layers: [
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2' }, name: 'pinky_nf_v2', segments: [SEG] },
] };
const CLAIM = { id: 16762, segment_id: SEG, dataset: 'pinky_nf_v2', status: 'assigned', assigned_to: 'test-user', soma_coords: '84054, 50604, 1424',
  nucleus_coords: null, claim_point_x: 84054, claim_point_y: 50604, claim_point_z: 1424, supervoxel_id: '75295862611928762', notes: 'Sheet #2', source_sheet_url: null, kind: 'cell',
  priority: 0, created_at: '2026-11-01T00:00:00+00:00', updated_at: '2026-11-01T00:00:00+00:00' };
const ANSWERS = {
  first: { taskId: 16762, scorable: true, root: SEG, match: 0, missing: { left: 28, total: 28 }, extra: { left: 3, total: 3 } },
  merged: { taskId: 16762, scorable: true, root: '648518346351002000', match: 37, missing: { left: 17, total: 28 }, extra: { left: 3, total: 3 } },
  worse: { taskId: 16762, scorable: true, root: '648518346351003000', match: 31, missing: { left: 18, total: 28 }, extra: { left: 1, total: 3 } },
  none: { taskId: 16762, scorable: false },
};
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
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player', permissions_v2: { pinky100: ['view', 'edit'] } })));
  await context.route(/docs\.google\.com/, r => r.fulfill({ status: 200, contentType: 'text/csv', body: 'Segment ID\n' }));
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }]
      : input.table === 'proofreading_tasks' ? [CLAIM] : [];
    return r.fulfill(json({ status: 200, ok: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  // The match function: answers as the test says, and counts the asks.
  const asks = [];
  let answer = ANSWERS.first;
  await context.route(/ewSandboxMatch/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    asks.push({ action: input.action, taskId: input.taskId, hasToken: !!input.token });
    return r.fulfill(json({ ok: true, data: answer }));
  });
  await context.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/proofreading_tasks/.test(u)) return r.fulfill(json([CLAIM]));
    return r.fulfill(json([]));
  });
  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const cardText = () => page.evaluate(() => { const c = document.getElementById('nge-cell-match'); return c ? c.innerText.replace(/\s+/g, ' ').trim() : null; });
  const waitText = (re, ms = 15000) => page.waitForFunction((src) => { const c = document.getElementById('nge-cell-match'); return !!c && new RegExp(src).test(c.innerText.replace(/\s+/g, ' ')); }, re.source, { timeout: ms }).then(() => true, () => false);
  const edit = (roots) => page.evaluate((r) => window.dispatchEvent(new CustomEvent('nge-graph-edit', { detail: { kind: 'merge', roots: r } })), roots);
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
    // The claim reaches the store however it loads; make sure it is there.
    await page.evaluate((claim) => {
      const pb = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend');
      if (pb && Array.isArray(pb.tasks) && !pb.tasks.some(t => t.id === claim.id)) pb.tasks.push(claim);
    }, CLAIM);

    const shown = await waitText(/Cell match 0%/, 30000);
    check('the card shows on the Sandbox claim', shown, { text: await cardText(), asks });
    check('it asked the match function for this cell, signed in', asks.length >= 1 && asks[0].action === 'match.check' && asks[0].taskId === 16762 && asks[0].hasToken, asks);
    check('pieces under the number', (await cardText() || '').includes('Missing 28 of 28 pieces · Extra 3 of 3 pieces'), await cardText());
    const box = await page.evaluate(() => { const r = document.getElementById('nge-cell-match').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    check('small, at the top left', box.x < 40 && box.y < 120 && box.w < 320 && box.h < 80, box);
    // The test site's intro panel and the first visit welcome window cover
    // the view here; they are moved aside for the pictures.
    const shot = async (name) => {
      const covers = await page.evaluate(() => {
        const out = [...document.querySelectorAll('.nge-stt')];
        // The welcome window: the box around its title, short of the whole page.
        const title = [...document.querySelectorAll('body *')].find(el => [...el.childNodes].some(n => n.nodeType === 3 && /welcome to pyr/i.test(n.textContent)));
        let box = title;
        while (box && box.parentElement && box.parentElement !== document.body && box.parentElement.getBoundingClientRect().width < window.innerWidth * 0.95) box = box.parentElement;
        if (box) out.push(box);
        out.forEach(el => { el.style.visibility = 'hidden'; });
        return out.map(el => String(el.className || el.tagName).slice(0, 40));
      });
      console.log('moved aside for', name + ':', covers);
      await page.screenshot({ path: path.join(OUT, name) });
    };
    await page.waitForTimeout(2000);
    // The first visit welcome window: closed with its own X (top right of it).
    const closed = await page.evaluate(() => {
      const x = [...document.querySelectorAll('button, [role=button]')].find(b => /^\s*[×✕x]\s*$/i.test(b.textContent || '') && b.getBoundingClientRect().x > 1100 && b.getBoundingClientRect().y < 140 && b.getBoundingClientRect().y > 100);
      if (x) x.click();
      return !!x;
    });
    console.log('welcome window closed for the pictures:', closed);
    await page.waitForTimeout(800);
    await shot('cell-match-start.png');

    // A burst of three edits: one ask, 2 s after the last.
    const before = asks.length;
    answer = ANSWERS.merged;
    await edit([ANSWERS.merged.root]);
    await page.waitForTimeout(300);
    check('an edit dims the card to Checking at once', /Checking/.test(await cardText() || ''), await cardText());
    await page.waitForTimeout(800); await edit([ANSWERS.merged.root]);
    await page.waitForTimeout(800); await edit([ANSWERS.merged.root]);
    await page.waitForTimeout(1200);
    check('no ask while the edits keep coming', asks.length === before, asks.length - before);
    const updated = await waitText(/Cell match 37%/, 10000);
    check('after the burst, one ask and the new number', updated && asks.length === before + 1, { text: await cardText(), asks: asks.length - before });
    check('the change shows beside it', /\+37/.test(await cardText() || ''), await cardText());
    check('pieces updated', (await cardText() || '').includes('Missing 17 of 28 pieces'), await cardText());
    await shot('cell-match-after-merge.png');

    // A worse edit: the number goes down, and says so.
    answer = ANSWERS.worse;
    await edit([ANSWERS.worse.root]);
    check('a worse edit lowers the number', await waitText(/Cell match 31%/, 10000) && /−6/.test(await cardText() || ''), await cardText());
    const copy = (await cardText() || '').replace(/−6/, '');
    check('no dashes in the card', !/[\u2013\u2014]|\s-\s/.test(copy), copy);

    // The Proofreading Test's line card in the same corner: the card moves below it.
    await page.evaluate(() => { const q = document.createElement('div'); q.className = 'nge-tqc'; q.style.cssText = 'position:fixed;top:64px;left:12px;width:300px;height:80px'; document.body.appendChild(q); });
    await page.waitForTimeout(2500);
    const top = await page.evaluate(() => document.getElementById('nge-cell-match').getBoundingClientRect().top);
    check('stays clear of the test line card', top >= 64 + 80 + 8, top);
    await page.evaluate(() => document.querySelector('.nge-tqc').remove());

    // The server says there is no true cell: the card goes.
    answer = ANSWERS.none;
    await edit([ANSWERS.worse.root]);
    await page.waitForTimeout(3500);
    check('a cell with no true cell has no card', (await cardText()) === null, await cardText());

    // Back to a score, then the cell leaves the screen: the card goes too.
    answer = ANSWERS.merged;
    await edit([ANSWERS.merged.root]);
    await waitText(/Cell match 37%/, 10000);
    await page.evaluate(() => {
      const ml = window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState);
      ml.layer.displayState.segmentationGroupState.value.visibleSegments.clear();
    });
    await page.waitForTimeout(3000);
    check('off screen, no card', (await cardText()) === null, await cardText());
    check('no page errors', errors.length === 0, errors);
  } catch (e) { check('the run finished', false, String(e).slice(0, 300)); }
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
