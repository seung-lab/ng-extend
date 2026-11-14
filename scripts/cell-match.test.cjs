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
  first: { taskId: 16762, scorable: true, root: SEG, match: 0, score: 62, startScore: 62, edits: 0, merge: 0, cut: 0, missing: { left: 28, total: 28 }, extra: { left: 3, total: 3 } },
  merged: { taskId: 16762, scorable: true, root: '648518346351002000', match: 37, score: 74, startScore: 62, edits: 1, merge: 39, cut: 0, missing: { left: 17, total: 28 }, extra: { left: 3, total: 3 } },
  worse: { taskId: 16762, scorable: true, root: '648518346351003000', match: 31, score: 70, startScore: 62, edits: 2, merge: 36, cut: 67, missing: { left: 18, total: 28 }, extra: { left: 1, total: 3 } },
  // A cell with nothing to cut at the start.
  clean: { taskId: 16762, scorable: true, root: '648518346351004000', match: 50, score: 80, startScore: 62, edits: 3, merge: 50, cut: null, missing: { left: 10, total: 20 }, extra: { left: 0, total: 0 } },
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
  const events = [];
  const hintSteps = [];
  const HINT_PLACE = { taskId: 16762, scorable: true, left: 2, n: 0, step: 1, piece: { kind: 'merge', size: 60, nearNm: [317000, 163000, 66480] } };
  const HINT = { taskId: 16762, scorable: true, left: 2, n: 0, piece: { kind: 'merge', root: '648518346351009999', size: 60, pointNm: [317516, 163676, 66480] } };
  let answer = ANSWERS.first;
  let reviewAnswer = null;
  await context.route(/ewSandboxMatch/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    asks.push({ action: input.action, taskId: input.taskId, hasToken: !!input.token });
    if (input.action === 'match.hint') { hintSteps.push(input.step); return r.fulfill(json({ ok: true, data: input.step === 2 ? HINT : HINT_PLACE })); }
    if (input.action === 'match.event') { events.push(input.kind); return r.fulfill(json({ ok: true, data: { ok: true } })); }
    return r.fulfill(json({ ok: true, data: input.action === 'match.review' ? reviewAnswer : answer }));
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
  const cardText = () => page.evaluate(() => { const c = document.getElementById('nge-cell-match'); return c ? c.innerText.replace(/\s+/g, ' ').trim().toLowerCase() : null; });
  const waitText = (re, ms = 15000) => page.waitForFunction((src) => { const c = document.getElementById('nge-cell-match'); return !!c && new RegExp(src, 'i').test(c.innerText.replace(/\s+/g, ' ')); }, re.source, { timeout: ms }).then(() => true, () => false);
  const edit = (roots, kind = 'merge') => page.evaluate(([r, k]) => window.dispatchEvent(new CustomEvent('nge-graph-edit', { detail: { kind: k, roots: r } })), [roots, kind]);
  try {
    await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(STATE)), { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 120000 });
    // The Cell Library answers are faked here: say it is listening.
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:cm-library-ready')));
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

    const shown = await waitText(/merge 0%/i, 30000);
    check('the card shows on the Sandbox claim', shown, { text: await cardText(), asks });
    check('it asked the match function for this cell, signed in', asks.some(a => a.action === 'match.check' && a.taskId === 16762 && a.hasToken), asks);
    check('Playing: Practice, the Match score, then Merge and Cut with their pieces', /^playing: practice .*match score [a-z ]*0% 0 edits merge 0% 0 of 28 pieces merged in cut 0% removed 0 of 3 errors/.test(await cardText() || ''), await cardText());
    const box = await page.evaluate(() => { const r = document.getElementById('nge-cell-match').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    check('small, at the top left', box.x < 40 && box.y < 160 && box.w <= 355 && box.h < 300, box);
    // Clear of the Play button in the same corner.
    const clash = await page.evaluate(() => {
      const c = document.getElementById('nge-cell-match').getBoundingClientRect();
      return [...document.querySelectorAll('.nge-play-dock, .nge-play-btn')].map(e => e.getBoundingClientRect()).filter(r => r.height)
        .some(r => r.left < c.right && c.left < r.right && r.top < c.bottom && c.top < r.bottom);
    });
    check('clear of the Play button', !clash, clash);
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
    const dim = await page.evaluate(() => document.getElementById('nge-cell-match').classList.contains('nge-cm-checking'));
    const loading = await page.evaluate(() => { const g = document.querySelector('#nge-cell-match .nge-cm-score .nge-cm-gauge'); return getComputedStyle(g, '::after').animationName; });
    check('while checking, a light runs along the score bar', loading === 'nge-cm-load', loading);
    check('an edit dims the numbers at once and says Merge complete', dim && /merge complete/.test(await cardText() || ''), await cardText());
    await page.waitForTimeout(800); await edit([ANSWERS.merged.root]);
    await page.waitForTimeout(800); await edit([ANSWERS.merged.root]);
    await page.waitForTimeout(1200);
    check('no ask while the edits keep coming', asks.length === before, asks.length - before);
    const updated = await waitText(/39%/, 10000);
    check('after the burst, one ask and the new Merge number', updated && asks.length === before + 1, { text: await cardText(), asks: asks.length - before });
    check('the change shows beside the row that moved, and only there', /match score [a-z ]*\+19 19% 1 edit merge \+39 39% 11 of 28 pieces merged in cut 0% removed 0 of 3 errors/.test(await cardText() || ''), await cardText());
    await shot('cell-match-after-merge.png');

    // A worse edit: the number goes down, and says so.
    answer = ANSWERS.worse;
    await edit([ANSWERS.worse.root]);
    const worse = await waitText(/36%/, 10000);
    check('a cut shows in the Cut row, a lost piece lowers Merge', worse && /match score [a-z ]*\+32 51% 2 edits merge −3 36% 10 of 28 pieces merged in cut \+67 67% removed 2 of 3 errors/.test(await cardText() || ''), await cardText());
    // A cut: "Cut complete" lights up for a moment, then back to the reading.
    // A cut: "Cut complete" at once, plain; then the reading says good or wrong
    // (Ames 2026-11-13: "I got cut complete ... but it was wrong cut").
    const state = () => page.evaluate(() => { const c = document.getElementById('nge-cell-match'); return { state: c.querySelector('.nge-cm-state').textContent, good: c.classList.contains('nge-cm-done'), bad: c.classList.contains('nge-cm-bad') }; });
    const goodCut = { ...ANSWERS.worse, root: '648518346351006000', cut: 100, extra: { left: 0, total: 3 } };
    answer = goodCut;
    await edit([goodCut.root], 'split');
    const atOnce = await state();
    check('a cut says Cut complete at once, not yet judged', atOnce.state === 'Cut complete' && !atOnce.good && !atOnce.bad, atOnce);
    await waitText(/100%/, 10000);
    const judged = await state();
    check('a cut that takes off a merger says Good cut, in green', judged.state === 'Good cut' && judged.good && !judged.bad, judged);
    const wrongCut = { ...goodCut, root: '648518346351007000', merge: 20, missing: { left: 22, total: 28 } };
    answer = wrongCut;
    await edit([wrongCut.root], 'split');
    await waitText(/20%/, 10000);
    const wrong = await state();
    check('a cut that takes off real cell says Wrong cut, in red', wrong.state === 'Wrong cut' && wrong.bad && !wrong.good, wrong);
    await shot('cell-match-wrong-cut.png');
    const verdicts = await page.evaluate(() => {
      const j = window.__ngeCellMatch.judgeEdit;
      const a = { scorable: true, merge: 40, cut: null, missing: { left: 10, total: 20 }, extra: { left: 0, total: 0 } };
      return [j('merge', a, { ...a, merge: 50, missing: { left: 8, total: 20 } }).text, j('merge', a, { ...a, cut: 0, extra: { left: 0, total: 0 } }).text, j('split', a, a).text];
    });
    check('a merge that brings in a wrong part is a Wrong merge; nothing moved is No change', verdicts.join('|') === 'Good merge|Wrong merge|No change', verdicts);
    const heads = await page.evaluate(() => { const h = document.querySelector('#nge-cell-match .nge-cm-head'); const t = document.querySelector('#nge-cell-match .nge-cm-title'); const st = document.querySelector('#nge-cell-match .nge-cm-state'); const was = st.textContent; st.textContent = 'Merge complete'; const longest = st.scrollWidth > st.clientWidth; st.textContent = was; return { longestCut: longest, head: Math.round(h.getBoundingClientRect().height), title: Math.round(t.getBoundingClientRect().height), state: st.textContent, cut: st.scrollWidth > st.clientWidth }; });
    check('the top line stays one line and a long verdict is not cut off', heads.title <= 16 && !heads.cut && !heads.longestCut, heads);
    const fills = await page.evaluate(() => [...document.querySelectorAll('#nge-cell-match .nge-cm-fill')].map(f => Math.round(f.getBoundingClientRect().width)));
    check('the bars fill', fills[0] > 0, fills);
    await page.waitForTimeout(5000);
    const later = await state();
    check('then back to Live', later.state === 'Live' && !later.good && !later.bad, later);

    // The Playing box (Ames 2026-11-14): the cell, its actions, Complete and Hint in one box.
    const box1 = await page.evaluate(() => {
      const c = document.getElementById('nge-cell-match');
      const vis = sel => { const e = c.querySelector(sel); return !!e && e.offsetParent !== null; };
      return { id: c.querySelector('.nge-cm-cellid').textContent, icon: vis('.nge-cm-cellbtn'), save: vis('.nge-cm-saveview'), skip: vis('.nge-cm-skipcell'), complete: vis('.nge-cm-complete'), owns: document.body.classList.contains('nge-cm-owns'), nudge: vis('.nge-cm-nudge') };
    });
    check('the box shows the cell, the cell icon, Save view, Skip and Complete, and the slim row steps aside', /^Cell 6485183463510\d+$/.test(box1.id) && box1.icon && box1.save && box1.skip && box1.complete && box1.owns && !box1.nudge, box1);
    await shot('cell-match-playbox.png');
    const sent = await page.evaluate(() => { const got = []; const f = e => got.push(e.detail.action + ':' + e.detail.taskId); document.addEventListener('nge:cm-cell-action', f); const c = document.getElementById('nge-cell-match'); c.querySelector('.nge-cm-saveview').click(); document.removeEventListener('nge:cm-cell-action', f); return got; });
    check('Save view asks the Cell Library, for this cell', sent.join(',') === 'save:16762', sent);
    // Skip asks first (Ames 2026-11-14).
    const skipAsk = await page.evaluate(() => { const got = []; const f = e => got.push(e.detail.action); document.addEventListener('nge:cm-cell-action', f); const c = document.getElementById('nge-cell-match'); c.querySelector('.nge-cm-skipcell').click(); const asked = !c.querySelector('.nge-cm-skipask').hidden && c.querySelector('.nge-cm-skipask').innerText.replace(/\s+/g, ' '); const before = got.length; c.querySelector('.nge-cm-skipask-no').click(); const closed = c.querySelector('.nge-cm-skipask').hidden; c.querySelector('.nge-cm-skipcell').click(); c.querySelector('.nge-cm-skipask-yes').click(); document.removeEventListener('nge:cm-cell-action', f); return { asked, before, closed, after: got }; });
    check('Skip asks first: Keep working skips nothing, Skip this cell skips', /skip this cell\? it goes back for someone else, and your edits on it no longer count for you/i.test(skipAsk.asked || '') && skipAsk.before === 0 && skipAsk.closed && skipAsk.after.join(',') === 'skip', skipAsk);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:cm-cell-state', { detail: { taskId: 16762, saving: false, saved: true, savedText: 'Saved 2 minutes ago', skipping: false, completing: null } })));
    const vnote = await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-viewnote').innerText);
    check('the box says when the view was saved, and that it saves by itself', vnote === 'Saved 2 minutes ago. Your view also saves by itself when you move to another cell.', vnote);
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-complete').click());
    const fin1 = await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); return { text: c.querySelector('.nge-cm-finish').innerText.replace(/\s+/g, ' '), go: c.querySelector('.nge-cm-finish-go').disabled, rows: c.querySelector('.nge-cm-row[data-row="merge"]').offsetParent !== null }; });
    check('Complete opens in the box: checking the crosshairs, saving the view, not yet ready', /complete this cell checking the crosshairs… saving your view…/i.test(fin1.text) && fin1.go && !fin1.rows, fin1);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:cm-cell-state', { detail: { taskId: 16762, saving: false, saved: true, skipping: false, completing: { checking: false, ok: true, message: '', minting: false, submitting: false, link: true } } })));
    const fin2 = await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); return { text: c.querySelector('.nge-cm-finish').innerText.replace(/\s+/g, ' '), go: c.querySelector('.nge-cm-finish-go').disabled, saved: c.querySelector('.nge-cm-saveview').textContent }; });
    check('crosshairs inside and the view saved: Complete and Review is ready', /crosshairs are inside your cell\. your view is saved with it\./i.test(fin2.text) && !fin2.go && fin2.saved === 'Saved ✓', fin2);
    await shot('cell-match-finish.png');
    const submit = await page.evaluate(() => { let got = null; const f = e => { got = e.detail; }; document.addEventListener('nge:cm-cell-action', f); const c = document.getElementById('nge-cell-match'); c.querySelector('.nge-cm-finish-addnote').click(); c.querySelector('.nge-cm-finish-note').value = 'soma is cut off at the edge'; c.querySelector('.nge-cm-finish-go').click(); document.removeEventListener('nge:cm-cell-action', f); return got; });
    check('Complete and Review sends the note along', !!submit && submit.action === 'complete-submit' && submit.notes === 'soma is cut off at the edge', submit);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:cm-cell-state', { detail: { taskId: 16762, saving: false, saved: true, skipping: false, completing: null } })));
    const fin3 = await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); return { finish: c.querySelector('.nge-cm-finish').hidden, rows: c.querySelector('.nge-cm-row[data-row="merge"]').offsetParent !== null }; });
    check('Complete closed: back to Merge and Cut', fin3.finish && fin3.rows, fin3);
    // A minute with no edit: Hint.
    await page.evaluate(() => window.__ngeCellMatch.ageHintClock(16762, 61000));
    await page.waitForTimeout(2600);
    const nudge = await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); const h = c.querySelector('.nge-cm-hbtn'); return { h: !!h && h.offsetParent !== null && h.textContent, tip: h && h.title, line: !c.querySelector('.nge-cm-nudge').hidden }; });
    check('after a minute with no edit, Hint appears in the button row, and nothing else opens', nudge.h === 'Hint' && nudge.tip === 'Click for a Hint' && !nudge.line, nudge);
    await shot('cell-match-hint.png');
    // Collapsed: no Hint at all (Ames 2026-11-14: "I would be too tempted to click").
    const minNudge = await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); c.querySelector('.nge-cm-min-btn').click(); const shown = c.querySelector('.nge-cm-hbtn').offsetParent !== null; c.querySelector('.nge-cm-min-btn').click(); return shown; });
    check('collapsed, Hint is not offered', minNudge === false, minNudge);
    const hintLayers = () => page.evaluate(() => ({ text: document.querySelector('#nge-cell-match .nge-cm-nudge').innerText.replace(/\s+/g, ' '), layers: (window.viewer.layerManager.managedLayers || []).map(l => l.name).filter(n => /^Hint/.test(n)) }));
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-hbtn').click());
    await page.waitForTimeout(1500);
    const place = await hintLayers();
    const layout = await page.evaluate(() => JSON.stringify(window.viewer.layout.toJSON()));
    check('Hint opens the 2D view beside the 3D', /xy/.test(layout), layout);
    check('Hint first: only the place on your cell where it starts, no piece shown', /missing a branch that starts near the blue pin\. look for a loose end there\. show me next hint/i.test(place.text) && place.layers.includes('Hint spot') && !place.layers.includes('Hint piece'), place);
    await shot('cell-match-hint-place.png');
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-hint-btn').click());
    await page.waitForTimeout(1500);
    const hinted = await hintLayers();
    const inMain = await page.evaluate(() => { const ls = window.viewer.layerManager.managedLayers.filter(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState); return ls.some(l => [...l.layer.displayState.segmentationGroupState.value.visibleSegments].map(String).includes('648518346351009999')); });
    check('Show me: the piece in gold in your own layer (so Ctrl+click merges it), and what to do', /gold piece belongs to your cell\. merge it in\. next hint/i.test(hinted.text) && inMain && !hinted.layers.includes('Hint piece') && hinted.layers.includes('Hint spot'), { hinted, inMain });
    check('the two steps were asked in order', hintSteps.join(',') === '1,2', hintSteps);
    check('the lab hears: opened, Hint offered (the hint itself is recorded by the server)', events.includes('opened') && events.includes('hint_offered'), events);
    await shot('cell-match-hint-shown.png');
    await edit([answer.root]);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ nudge: document.querySelector('#nge-cell-match .nge-cm-nudge').hidden, layers: (window.viewer.layerManager.managedLayers || []).map(l => l.name).filter(n => /^Hint/.test(n)) }));
    after.inMain = await page.evaluate(() => window.viewer.layerManager.managedLayers.filter(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState).some(l => [...l.layer.displayState.segmentationGroupState.value.visibleSegments].map(String).includes('648518346351009999')));
    check('an edit puts Hint away and clears its piece', after.nudge && after.layers.length === 0 && !after.inMain, after);
    // Resize by the corner (Ames 2026-11-14), kept.
    const sized = await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); const cs = getComputedStyle(c); c.style.width = '440px'; c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return { resize: cs.resize, w: Math.round(c.getBoundingClientRect().width), kept: localStorage.getItem('nge-cell-match-size') }; });
    check('the box resizes from its corner, and keeps the size', sized.resize === 'both' && sized.w === 440 && /"w":440/.test(sized.kept || ''), sized);
    await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); c.style.width = ''; c.style.height = ''; localStorage.removeItem('nge-cell-match-size'); });
    const copy = (await cardText() || '').replace(/−3/, '');
    check('no dashes in the card', !/[\u2013\u2014]|\s-\s/.test(copy), copy);

    // A cell with nothing to cut says so.
    answer = ANSWERS.clean;
    await edit([ANSWERS.clean.root]);
    check('nothing to cut', await waitText(/50%/, 10000) && /cut nothing to cut/.test(await cardText() || ''), await cardText());

    // The function before Merge and Cut (one number only): no card rather than a wrong one.
    answer = { taskId: 16762, scorable: true, root: '648518346351005000', match: 12, missing: { left: 9, total: 20 }, extra: { left: 0, total: 0 } };
    await edit([answer.root]);
    await page.waitForTimeout(3500);
    check('an older function answer shows no card', (await cardText()) === null, await cardText());
    answer = ANSWERS.clean;
    await edit([ANSWERS.clean.root]);
    await waitText(/50%/, 10000);

    // The Proofreading Test's line card in the same corner: the card moves below it.
    await page.evaluate(() => { const q = document.createElement('div'); q.className = 'nge-tqc'; q.style.cssText = 'position:fixed;top:64px;left:12px;width:300px;height:80px'; document.body.appendChild(q); });
    await page.waitForTimeout(2500);
    const top = await page.evaluate(() => document.getElementById('nge-cell-match').getBoundingClientRect().top);
    check('stays clear of the test line card', top >= 64 + 80 + 8, top);
    await page.evaluate(() => document.querySelector('.nge-tqc').remove());

    // The server says there is no true cell: no numbers, and the card says why.
    answer = ANSWERS.none;
    await edit([ANSWERS.worse.root]);
    await page.waitForTimeout(3500);
    check('a cell with no true cell has no card when not playing', (await cardText()) === null, await cardText());

    // Back to a score, then the cell leaves the screen: the card goes too.
    answer = ANSWERS.merged;
    await edit([ANSWERS.merged.root]);
    await waitText(/39%/, 10000);
    // Complete and Review: the review takes the HUD, draws what was missed and
    // waits for the player.
    reviewAnswer = { ...ANSWERS.merged, merge: 84, cut: 67, missing: { left: 2, total: 28 }, extra: { left: 1, total: 3 },
      missed: [{ root: '648518346351777001', size: 4214, pointNm: [85000 * 4, 51000 * 4, 1500 * 40] }, { root: '648518346351777002', size: 622, pointNm: [84154 * 4, 50704 * 4, 1430 * 40] }],
      mergers: [{ size: 322, pointNm: [84254 * 4, 50804 * 4, 1440 * 40] }] };
    const label = await page.evaluate(() => window.__ngeCellMatch.hasReview(16762));
    check('the cell offers Complete and Review', label === true, label);
    const choice1 = page.evaluate(() => window.__ngeCellMatch.showReview(16762, window.__ngeCellMatch.startReview(16762), true));
    const reviewed = await waitText(/review match score final/, 10000);
    check('the review shows the final numbers', reviewed && /merge 84%/.test(await cardText() || '') && /cut 67%/.test(await cardText() || ''), await cardText());
    check('what was missed, and the cut left', /missed 2 pieces show 1 of 2 merged 1 part show/.test(await cardText() || ''), await cardText());
    await page.waitForTimeout(3000);
    const layers = await page.evaluate(() => {
      const ls = window.viewer.layerManager.managedLayers;
      const missed = ls.find(l => l.name === 'Missed pieces'), pins = ls.find(l => l.name === 'Mergers left');
      let n = -1; try { n = pins.layer.localAnnotations.toJSON().length; } catch (e) {}
      return { missed: missed ? [...missed.layer.displayState.segmentationGroupState.value.visibleSegments].map(String) : null, pins: n };
    });
    check('the missed pieces are drawn, the cut pinned', layers.missed && layers.missed.length === 2 && layers.missed.includes('648518346351777001') && layers.pins === 1, layers);
    const pos0 = await page.evaluate(() => Array.from(window.viewer.navigationState.position.value).map(Math.round));
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-extra .nge-cm-btn').click());
    await page.waitForTimeout(500);
    const pos1 = await page.evaluate(() => Array.from(window.viewer.navigationState.position.value).map(Math.round));
    check('Show flies to the first missed piece', pos0[0] !== 85000 && pos1[0] === 85000 && pos1[1] === 51000 && pos1[2] === 1500, { pos0, pos1 });
    await shot('cell-match-review.png');
    // Save view (Ames 2026-11-13): to My Links, and a tip says where it went.
    const saved = await page.evaluate(async () => {
      // The store's My Links save, stood in for: nothing is written.
      window.__ngeCellMatch.setSaveLink(async (l) => { window.__savedLink = l; return 'test-link'; });
      window.__openedTab = null;
      document.addEventListener('nge:open-cell-library', e => { window.__openedTab = (e.detail || {}).tab; }, { once: true });
      document.querySelector('#nge-cell-match .nge-cm-save').click();
      await new Promise(r => setTimeout(r, 400));
      const tip = document.getElementById('nge-cell-match-saved');
      const l = window.__savedLink || {};
      return { button: document.querySelector('#nge-cell-match .nge-cm-save').textContent, tip: tip ? tip.innerText : null,
        title: l.title, note: l.note, hasMissedLayer: /Missed%20pieces|Missed pieces/.test(decodeURIComponent(l.url || '')), dataset: l.dataset };
    });
    check('Save view saves this view, missed pieces and all, to My Links', saved.button === 'Saved \u2713' && saved.hasMissedLayer && saved.title === 'My 1st practice cell' && saved.dataset === 'pinky_nf_v2', saved);
    check('a tip says it is in My Links', /SAVED/.test(saved.tip || '') && /My Links/.test(saved.tip || '') && !/[\u2013\u2014]|\s-\s/.test((saved.tip || '') + (saved.note || '')), saved);
    await shot('cell-match-saved.png');
    // Open My Links walks the way there (Ames 2026-11-13): Cell Library, then
    // (if slim) Full view, then My Links, each lit up before it is pressed.
    await page.evaluate(() => {
      window.__guide = [];
      window.__guideTimer = setInterval(() => { const l = document.querySelector('#nge-cell-match-guide .nge-cm-guide-label'); const t = l && l.textContent; if (t && window.__guide[window.__guide.length - 1] !== t) window.__guide.push(t); }, 50);
      document.querySelector('#nge-cell-match-saved .nge-cm-tip-open').click();
    });
    await page.waitForTimeout(6000);
    const opened = await page.evaluate(() => { clearInterval(window.__guideTimer); const tab = document.querySelector('.nge-cl-panel .nge-cl-links-tab'); return { steps: window.__guide, onLinks: !!tab && tab.classList.contains('active'), tip: !!document.getElementById('nge-cell-match-saved') }; });
    check('Open My Links lights up Cell Library, then My Links, and lands on My Links', opened.steps[0] === 'Cell Library' && opened.steps.includes('My Links') && opened.onLinks && !opened.tip, opened);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:close-cell-library')));
    check('no dashes in the review', !/[–—]|\s-\s/.test(await cardText() || ''), await cardText());
    await page.evaluate(() => [...document.querySelectorAll('#nge-cell-match .nge-cm-btn')].find(b => /next cell/i.test(b.textContent)).click());
    const c1 = await choice1;
    const gone = await page.evaluate(() => !window.viewer.layerManager.managedLayers.some(l => l.name === 'Missed pieces' || l.name === 'Mergers left'));
    check('Next cell: on to the next, the review and its layers gone', c1 === 'next' && gone && (await cardText()) === null, { c1, gone, text: await cardText() });
    // A clean cell says so; Close stays with it.
    reviewAnswer = { ...ANSWERS.merged, merge: 100, cut: 100, missing: { left: 0, total: 28 }, extra: { left: 0, total: 3 }, missed: [], mergers: [] };
    const choice2 = page.evaluate(() => window.__ngeCellMatch.showReview(16762, window.__ngeCellMatch.startReview(16762), false));
    check('a clean cell says so', await waitText(/nothing missed\. clean cell\./, 10000), await cardText());
    await page.evaluate(() => [...document.querySelectorAll('#nge-cell-match .nge-cm-btn')].find(b => /close/i.test(b.textContent)).click());
    check('Close stays with the cell', (await choice2) === 'stay', null);
    // No true cell: the review steps aside and Complete goes on.
    reviewAnswer = ANSWERS.none;
    const c3 = await page.evaluate(() => window.__ngeCellMatch.showReview(16762, window.__ngeCellMatch.startReview(16762), true));
    check('no review without a true cell', c3 === 'next', c3);
    answer = ANSWERS.merged;
    await edit([ANSWERS.merged.root]);
    await waitText(/39%/, 10000);

    // Bigger text (Ames: "can the text be less microscopic").
    const sizes = await page.evaluate(() => ({ pieces: parseFloat(getComputedStyle(document.querySelector('#nge-cell-match .nge-cm-pieces')).fontSize), label: parseFloat(getComputedStyle(document.querySelector('#nge-cell-match .nge-cm-label')).fontSize) }));
    check('readable text sizes', sizes.pieces >= 13 && sizes.label >= 11, sizes);
    // Drag and drop by the top line; it stays put; a double click puts it back.
    const hb = await page.evaluate(() => { const r = document.querySelector('#nge-cell-match .nge-cm-title').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
    // The welcome hero is still over the corner in this headless run; a player has closed it.
    await page.evaluate(() => document.querySelectorAll('.nge-hero-overlay').forEach(e => { e.style.display = 'none'; }));
    await page.mouse.move(hb.x, hb.y); await page.mouse.down(); await page.mouse.move(hb.x + 400, hb.y + 250, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(2500);
    const dragged = await page.evaluate(() => { const r = document.getElementById('nge-cell-match').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; });
    check('drag moves the card and it stays there', Math.abs(dragged.left - 412) <= 3 && dragged.top > 250, dragged);
    await page.mouse.dblclick(dragged.left + 40, dragged.top + 10);
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => Math.round(document.getElementById('nge-cell-match').getBoundingClientRect().left));
    check('double click puts it back', back === 12, back);
    // The X closes the box and Pyr's Play button comes back to open it
    // (Ames 2026-11-14: "it's not clear how to get back bc the play button is gone").
    await page.evaluate(() => { document.querySelector('.introductionStep')?.remove(); document.querySelector('#nge-cell-match .nge-cm-x').click(); });
    await page.waitForTimeout(1000);
    const folded = await page.evaluate(() => { const p = document.querySelector('.nge-play-btn'); return { card: !!document.getElementById('nge-cell-match'), chip: !!document.getElementById('nge-cell-match-open'), play: !!p && p.getBoundingClientRect().width > 0 && p.textContent.trim(), row: !document.body.classList.contains('nge-cm-owns') }; });
    check('X closes the box: no Match button, the Play button is back, the Cell Library row returns', !folded.card && !folded.chip && folded.play === 'Play' && folded.row, folded);
    await shot('cell-match-closed.png');
    answer = ANSWERS.merged;
    await edit([ANSWERS.merged.root]);
    await page.waitForTimeout(3500);
    check('closed stays closed through edits', await page.evaluate(() => !document.getElementById('nge-cell-match') && !!document.querySelector('.nge-play-btn')), null);
    await page.evaluate(() => document.querySelector('.nge-play-btn').click());
    check('Play opens it again', await waitText(/39%/, 10000), await cardText());
    await page.waitForTimeout(900);
    // Play button off in Settings: no box at all, the Cell Library as before.
    await page.evaluate(() => { const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; pinia._s.get('userPrefs').prefs.hidePlayButton = true; });
    await page.waitForTimeout(600);
    check('Play button off: no box, Cell Library only', await page.evaluate(() => !document.getElementById('nge-cell-match') && !document.body.classList.contains('nge-cm-owns')), null);
    await page.evaluate(() => { const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; pinia._s.get('userPrefs').prefs.hidePlayButton = false; });
    check('Play button on again: the box is back', await waitText(/39%/, 10000), await cardText());

    // The info box (Ames 2026-11-13: "Also an info box").
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-i').click());
    const infoText = await page.evaluate(() => { const i = document.querySelector('#nge-cell-match .nge-cm-info'); return getComputedStyle(i).display !== 'none' ? i.innerText : null; });
    check('i opens an explanation', /Match score:/.test(infoText || '') && /Merge:/.test(infoText || '') && /Cut:/.test(infoText || '') && !/[\u2013\u2014]|\s-\s/.test(infoText || ''), infoText);
    await shot('cell-match-info.png');
    // Admins change the i text in the game (Ames 2026-11-14); players never see Edit.
    check('a player has no Edit button in the info', await page.evaluate(() => !document.querySelector('#nge-cell-match .nge-cm-info .nge-edtext-btn')), null);
    await page.evaluate(() => { const pb = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend'); pb.isAdmin = true; });
    await page.waitForTimeout(300);
    const adminEdit = await page.evaluate(() => { const b = document.querySelector('#nge-cell-match .nge-cm-info .nge-edtext-btn'); if (!b) return null; const label = b.textContent.trim(); b.click(); return label; });
    await page.waitForTimeout(300);
    const draftLines = await page.evaluate(() => { const t = document.querySelector('#nge-cell-match .nge-cm-info textarea'); return t ? t.value.split('\n').filter(l => l.trim()).length : 0; });
    check('an admin gets Edit, and it opens the text one paragraph per line', adminEdit === 'Edit' && draftLines === 5, { adminEdit, draftLines });
    await shot('cell-match-info-edit.png');
    await page.evaluate(() => { const c = [...document.querySelectorAll('#nge-cell-match .nge-cm-info .nge-edtext-btn')].find(b => b.textContent.trim() === 'Cancel'); if (c) c.click(); const pb = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend'); pb.isAdmin = false; });
    await page.waitForTimeout(300);
    const guideCss = await page.evaluate(() => [...document.querySelectorAll('style')].some(s => s.textContent.includes('#nge-cell-match-guide{position:fixed')));
    check('the guided walk styles name the walk, not undefined', guideCss, null);
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-i').click());
    // Collapsed: Cell match and the two bars only, and it stays collapsed.
    const fullH = await page.evaluate(() => document.getElementById('nge-cell-match').offsetHeight);
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-min-btn').click());
    await page.waitForTimeout(300);
    const mini = await page.evaluate(() => { const c = document.getElementById('nge-cell-match'); const vis = s => [...c.querySelectorAll(s)].filter(e => e.offsetParent !== null).length; return { h: c.offsetHeight, gauges: vis('.nge-cm-gauge'), nums: vis('.nge-cm-num'), pieces: vis('.nge-cm-pieces'), title: c.querySelector('.nge-cm-title').offsetParent !== null }; });
    const tips = await page.evaluate(() => [...document.querySelectorAll('#nge-cell-match .nge-cm-row')].map(r => r.title));
    check('hovering says what each line means', /^Match score 19%: your Merge and Cut together, half each$/.test(tips[0]) && /^Merge \d+%: \d+ of \d+ pieces merged in$/.test(tips[1]) && /^Cut/.test(tips[2]), tips);
    const miniText = await page.evaluate(() => document.getElementById('nge-cell-match').innerText.replace(/\s+/g, ' ').trim());
    check('collapse shows Practice and the score bar only', mini.title && mini.gauges === 1 && mini.nums === 1 && mini.pieces === 0 && /^practice/i.test(miniText) && /19%/.test(miniText) && !/playing/i.test(miniText) && mini.h < fullH / 2, { mini, fullH, miniText });
    await shot('cell-match-collapsed.png');
    answer = ANSWERS.merged;
    await edit([ANSWERS.merged.root]);
    await page.waitForTimeout(3500);
    check('collapsed stays collapsed through edits', await page.evaluate(() => document.getElementById('nge-cell-match').classList.contains('nge-cm-min')), null);
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-min-btn').click());
    await waitText(/39%/, 10000);

    await page.evaluate(() => {
      const ml = window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState);
      ml.layer.displayState.segmentationGroupState.value.visibleSegments.clear();
    });
    await page.waitForTimeout(3000);
    // Not playing, no cell on screen: no card; the Play button is the way in
    // (Ames 2026-11-13: "it should appear after I'm already playing").
    const go = () => page.evaluate(() => { const b = document.querySelector('#nge-cell-match .nge-cm-idle-go'); return b ? b.textContent : null; });
    check('not playing and off screen: no card', (await cardText()) === null, await cardText());
    // Playing, with the cell not on screen: Standby with Open my cell.
    await page.evaluate(() => sessionStorage.setItem('nge_play_on', 'cells'));
    await page.waitForTimeout(3000);
    check('playing: Standby with Open my cell', /your cell is not on screen/.test(await cardText() || '') && (await go()) === 'Open my cell', { text: await cardText(), go: await go() });
    const sub = await page.evaluate(() => { const s = document.querySelector('#nge-cell-match .nge-cm-sub'); const p = document.querySelector('#nge-cell-match .nge-cm-row[data-row="merge"] .nge-cm-pieces'); return { sub: s && !s.hidden ? s.textContent : null, inRow: p.textContent }; });
    check('the note is a line under the title, not in the Missing row', sub.sub === 'Your cell is not on screen' && sub.inRow === '', sub);
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-min-btn').click());
    const subMin = await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-sub').offsetParent === null);
    check('collapsed: the note is hidden', subMin, subMin);
    await page.evaluate(() => document.querySelector('#nge-cell-match .nge-cm-min-btn').click());
    // The Play button stays away while a tutorial is on screen (Ames 2026-11-14): close the one the Sandbox opened.
    await page.evaluate(() => document.querySelectorAll('.introductionStep, .introductionStepAnchor').forEach(e => e.remove()));
    await page.waitForTimeout(800);
    const pressed = await page.evaluate(() => { let hit = false; const t = document.querySelector('.nge-play-chip') || document.querySelector('.nge-play-btn'); if (!t) return 'no play control'; t.addEventListener('click', e => { hit = true; e.stopImmediatePropagation(); }, { capture: true, once: true }); document.querySelector('#nge-cell-match .nge-cm-idle-go').click(); return hit; });
    check('Open my cell presses the game Play control', pressed === true, pressed);
    const playBox = await page.evaluate(() => { const b = document.querySelector('.nge-play-btn'); return b ? Math.round(b.getBoundingClientRect().height) : null; });
    check('on the Sandbox the Play button is big', playBox === null || playBox >= 56, playBox);
    await shot('play-big.png');
    await shot('cell-match-standby.png');
    await page.evaluate(() => sessionStorage.removeItem('nge_play_on'));
    await page.waitForTimeout(3000);
    check('Play off: the card goes', (await cardText()) === null, await cardText());
    check('no page errors', errors.length === 0, errors);
  } catch (e) { check('the run finished', false, String(e).slice(0, 300)); }
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
