// The Switch Dataset window's chips straight to the work, headless (2026-10-23).
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    node scripts/dataset-jump.test.cjs [shots dir]
// Checks: the cards with cells to claim (Retina, MEC, Sandbox) offer
// Available cells, Retina offers Quests, and My cells shows only where the
// player holds claims; FlyWire and the View Only cards stay as they were and
// no card grows. A chip on the dataset on screen opens the Cell Library on
// its tab; a chip on another dataset switches (the page reloads into the start
// view) and the library comes back open on that tab.
// Every server call is answered here; nothing reaches production. One 401
// with the fake token wedges the middleauth provider, so every middleauth
// host is answered by a catch-all registered first.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3558;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const RETINA_LAYERS = [
  { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' },
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'stroeh_mouse_retina', segments: [] },
];
// The player holds two Retina cells and one MEC cell, none on Sandbox.
const claim = (id, dataset) => ({ id, dataset, status: 'assigned', assigned_to: 'test-user', segment_id: String(720575940000000000 + id), priority: 0, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' });
const CLAIMS = [claim(1, 'stroeh_mouse_retina'), claim(2, 'stroeh_mouse_retina'), claim(3, 'pni_mec')];
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate', host + '/nglstate/', host + '/nglstate/api/v1', host + '/segmentation', host + '/segmentation/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
    // A sign in screen after the switch, as a player meets one: up for 6 s
    // once the page has loaded. Inline !important beats the test's hiding rule.
    // Note whether "Pick up where you left off?" shows on this page at all
    // (it leaves by itself after 8 s).
    window.__restoreBarSeen = false;
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => { if (document.querySelector('.nge-view-restore')) window.__restoreBarSeen = true; })
        .observe(document.body, { childList: true, subtree: true });
    });
    if (sessionStorage.getItem('test_fake_signin')) {
      sessionStorage.removeItem('test_fake_signin');
      window.addEventListener('load', () => {
        const d = document.createElement('div');
        d.className = 'nge-login-blocker';
        d.setAttribute('style', 'display:block !important; position:fixed; left:0; top:0; width:20px; height:20px;');
        document.body.appendChild(d);
        setTimeout(() => { d.remove(); window.__signinGone = Date.now(); }, 6000);
      });
    }
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  // Edit on Retina and Sandbox, view only on MEC (chips still show), nothing on FlyWire.
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player',
    permissions_v2: { 'stroeh-mouse-retina': ['view', 'edit'], pinky100: ['view', 'edit'], HiMC: ['view'] } })));
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    if (/ewSheetSync/.test(r.request().url())) return r.fulfill(json({ ok: true, you: 'Test Player', rows: [] }));
    // A saved view on every dataset, unlike the one on screen, so the offer has something to offer.
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }]
      : input.table === 'user_views' && r.request().method() === 'POST' && (input.method || 'GET') === 'GET'
        ? [{ state: { layers: RETINA_LAYERS, position: [100, 200, 300], layout: '3d' }, updated_at: new Date(Date.now() - 3600e3).toISOString() }] : [];
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  const claimReads = [];
  await context.route(/supabase\.co/, r => {
    const u = decodeURIComponent(r.request().url());
    if (/proofreading_tasks/.test(u) && /assigned_to=eq\.test-user/.test(u) && /status=in\./.test(u)) { claimReads.push(u); return r.fulfill(json(CLAIMS)); }
    return r.fulfill(json([]));
  });
  const stateReads = [];
  await context.route(/global\.brain-wire-test\.org\/nglstate\/api\/v1\/\d+/, r => { stateReads.push(r.request().url().split('/').pop()); return r.fulfill(json({ dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [37166, 16688, 1973], layers: RETINA_LAYERS, layout: 'xy-3d' })); });

  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const ready = async () => {
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      if (!document.getElementById('test-hide')) { const st = document.createElement('style'); st.id = 'test-hide'; st.textContent = css; document.head.appendChild(st); }
    }, HIDE_CSS);
  };
  const layers = () => page.evaluate(() => window.viewer.layerManager.managedLayers.map(l => l.name));
  const dataLabel = () => page.evaluate(() => (document.body.innerText.match(/Data: [A-Za-z ]+/) || [''])[0].trim());
  const openSwitcher = async () => {
    await page.click('.nge-dataset-btn');
    await page.waitForSelector('.nge-dataset-panel', { timeout: 10000 });
    await page.waitForTimeout(1500); // the claims read, and the arrival animation
  };
  // Each card: its name, its chips' words, its size, and whether a chip leaves it.
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.nge-dataset-panel .nge-ds-card')].map(c => {
    const r = c.getBoundingClientRect();
    const chips = [...c.querySelectorAll('.nge-ds-task')];
    return {
      name: c.querySelector('.nge-ds-card-label').innerText.trim(),
      chips: chips.map(b => b.textContent.replace(/\s+/g, ' ').replace('›', '').trim()),
      rows: new Set(chips.map(b => Math.round(b.getBoundingClientRect().top))).size,
      thumbH: Math.round((c.querySelector('.nge-ds-card-thumb') || c).getBoundingClientRect().height),
      textH: Math.round(c.querySelector('.nge-ds-card-text').getBoundingClientRect().height),
      h: Math.round(r.height),
      inside: chips.every(b => { const q = b.getBoundingClientRect(); return q.right <= r.right + 0.5 && q.bottom <= r.bottom + 0.5; }),
    };
  }));
  const card = (list, name) => list.find(c => c.name === name) || { chips: [] };
  const activeTab = () => page.evaluate(() => { const b = document.querySelector('.nge-cl-panel .nge-cl-tabgroup-row button.active'); return b ? b.innerText.replace(/\s+/g, ' ').trim() : null; });
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await ready();
    await page.waitForTimeout(2500);
    console.log('dataset on screen: ' + (await layers()).join(',') + ' | ' + await dataLabel());

    await openSwitcher();
    const list = await cards();
    console.log(JSON.stringify(list.map(c => [c.name, c.chips, c.h])));
    check('Retina: Available cells, Quests, My cells 2', JSON.stringify(card(list, 'EyeWire II: Retina').chips) === JSON.stringify(['Available cells', 'Quests', 'My cells2']), card(list, 'EyeWire II: Retina').chips);
    // View only on MEC: no claim chips, even with a claim there (Ames 2026-10-24).
    check('MEC, view only: no chips', card(list, 'Medial Entorhinal Cortex').chips.length === 0, card(list, 'Medial Entorhinal Cortex').chips);
    check('Sandbox: Available cells only (no claims there)', JSON.stringify(card(list, 'Pinky Sandbox').chips) === JSON.stringify(['Available cells']), card(list, 'Pinky Sandbox').chips);
    check('FlyWire and every View Only card have no chips', list.filter(c => !['EyeWire II: Retina', 'Medial Entorhinal Cortex', 'Pinky Sandbox'].includes(c.name)).every(c => c.chips.length === 0));
    check('your claims were read once', claimReads.length === 1, claimReads.length);
    check('every chip sits inside its card', list.every(c => c.inside));
    // The words and chips fit in the room beside the picture, so the card
    // is exactly as tall as before.
    check('the production cards with chips stay as tall as their picture', ['EyeWire II: Retina'].every(n => card(list, n).textH <= card(list, n).thumbH),
      ['EyeWire II: Retina'].map(n => [card(list, n).textH, card(list, n).thumbH]));
    check('all three Retina chips fit on one row', card(list, 'EyeWire II: Retina').rows === 1, card(list, 'EyeWire II: Retina').rows);
    const panel = await page.locator('.nge-dataset-panel').boundingBox();
    await page.screenshot({ path: path.join(OUT, 'dataset-jump-window.png'), clip: { x: panel.x - 2, y: panel.y - 2, width: panel.width + 4, height: panel.height + 4 } });
    await page.hover('.nge-ds-card:has(.nge-ds-card-label:text-is("EyeWire II: Retina")) .nge-ds-task >> nth=0');
    await page.waitForTimeout(300);
    const rbox = await page.locator('.nge-ds-card:has(.nge-ds-card-label:text-is("EyeWire II: Retina"))').boundingBox();
    await page.screenshot({ path: path.join(OUT, 'dataset-jump-hover.png'), clip: { x: rbox.x - 4, y: rbox.y - 4, width: rbox.width + 8, height: rbox.height + 8 } });

    // A chip on the dataset on screen: no switch, the library opens on its tab.
    let reloads = 0; page.on('load', () => { reloads++; });
    await page.click('.nge-ds-card:has(.nge-ds-card-label:text-is("Pinky Sandbox")) .nge-ds-task');
    const opened = await page.waitForSelector('.nge-cl-panel', { timeout: 10000 }).then(() => true, () => false);
    await page.waitForTimeout(800);
    check('Sandbox Available cells: the window closes and the library opens on Available, no reload',
      opened && !(await page.$('.nge-dataset-panel')) && /^Available/.test(await activeTab() || '') && reloads === 0, { tab: await activeTab(), reloads });

    // A chip on another dataset: the switch reloads into Retina's start view,
    // and the library comes back open on Available.
    await openSwitcher();
    await page.evaluate(() => sessionStorage.setItem('test_fake_signin', '1'));
    const reloaded = page.waitForEvent('load', { timeout: 40000 }).then(() => true, () => false);
    await page.click('.nge-ds-card:has(.nge-ds-card-label:text-is("EyeWire II: Retina")) .nge-ds-task >> nth=0');
    check('Retina Available cells: the switch reloads the page', await reloaded);
    await ready();
    await page.waitForFunction(() => window.viewer.layerManager.managedLayers.some(l => l.name === 'stroeh_mouse_retina'), null, { timeout: 40000 }).catch(() => {});
    check('Retina is on screen', (await layers()).includes('stroeh_mouse_retina') && await dataLabel() === 'Data: Retina', { layers: await layers(), label: await dataLabel(), stateReads });
    const back = await page.waitForSelector('.nge-cl-panel', { timeout: 30000 }).then(() => true, () => false);
    const order = await page.evaluate(() => ({ gone: window.__signinGone || 0, now: Date.now(), entering: !!document.querySelector('.nge-dst') }));
    check('the library waits until the sign in screen is gone', back && order.gone > 0 && order.now >= order.gone, order);
    check('the library opens after Now entering has finished, not over it', back && !order.entering, order);
    await page.waitForTimeout(800);
    check('the Cell Library comes back open on Available', back && /^Available/.test(await activeTab() || ''), await activeTab());
    check('the note left for the next page is used up', await page.evaluate(() => sessionStorage.getItem('nge_cl_after_switch')) === null);

    // With the library still open on Available: Quests on Retina moves it to Quests.
    await openSwitcher();
    await page.click('.nge-ds-card:has(.nge-ds-card-label:text-is("EyeWire II: Retina")) .nge-ds-task:has-text("Quests")');
    await page.waitForTimeout(800);
    check('Quests on the dataset on screen moves the open library to Quests', !(await page.$('.nge-dataset-panel')) && !!(await page.$('.nge-cl-quests-tab.active')), await activeTab());
    await openSwitcher();
    await page.click('.nge-ds-card:has(.nge-ds-card-label:text-is("EyeWire II: Retina")) .nge-ds-task:has-text("My cells")');
    await page.waitForTimeout(800);
    check('My cells moves it to My Cells', /^My Cells/.test(await activeTab() || ''), await activeTab());
    await page.screenshot({ path: path.join(OUT, 'dataset-jump-after.png') });
    await page.waitForTimeout(3000);
    check('no "Pick up where you left off?" after a chip switch', !(await page.evaluate(() => window.__restoreBarSeen)));

    // Control: a plain card switch still offers it, so the check above can see the bar.
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:close-cell-library')));
    await openSwitcher();
    const reloaded2 = page.waitForEvent('load', { timeout: 40000 }).then(() => true, () => false);
    await page.click('.nge-ds-card:has(.nge-ds-card-label:text-is("Medial Entorhinal Cortex"))');
    await reloaded2;
    await ready();
    const offered = await page.waitForFunction(() => window.__restoreBarSeen, null, { timeout: 30000 }).then(() => true, () => false);
    check('control: a plain card switch still offers "Pick up where you left off?"', offered);
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
    try { await page.screenshot({ path: path.join(OUT, 'dataset-jump-failed.png') }); } catch (e2) { /* no picture */ }
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
