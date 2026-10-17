// Retina access requests, headless (Ames 2026-10-16): a player saves 7 cuts
// and 3 merges from the view and sends them; a reviewer marks points and
// examples in the Admin Hub and in the view, asks for a redo; the player sees
// the notes; the reviewer invites.
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3497 --directory dist/min
// Run:    node scripts/access-request.test.cjs [shots dir]
// The ewAccessRequest function is answered here by the real rules
// (functions/access-request.js) over an in-memory database, so the browser
// meets the same checks it will meet in production. Nothing reaches
// production: every middleauth host, state server, Supabase and function is
// answered or refused here.
// Not covered: Neuroglancer's own Multicut state needs the chunked graph,
// which cannot load without a sign in, so the red and blue points are put on
// the layer's graph connection by hand, in the shape Neuroglancer keeps them
// (graphene/frontend.ts: multicutState.sinks red, .sources blue).
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const { handle } = require('../functions/access-request');

const BASE = process.env.BASE || 'http://localhost:3497/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots-access');
fs.mkdirSync(OUT, { recursive: true });
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// ── An in-memory database for the real rules ──────────────────────────────
const db = { access_requests: [], access_request_items: [], access_request_item_history: [], pilot_members: [] };
const told = [];
let nextId = 1;
function sb(pathq, init = {}) {
  const [table, qs = ''] = pathq.split('?');
  const q = new URLSearchParams(qs), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
  const rows = db[table];
  const match = r => [...q].every(([k, v]) => {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('neq.')) return String(r[k]) !== v.slice(4);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
    return true;
  });
  if (method === 'POST') {
    const conflict = q.get('on_conflict');
    if (conflict) {
      const keys = conflict.split(',');
      const hit = rows.find(r => keys.every(k => String(r[k]) === String(body[k])));
      if (hit) { Object.assign(hit, body); return Promise.resolve([{ ...hit }]); }
    }
    const row = { id: nextId++, status: 'draft', tries: 0, verdict: null, point_marks: {}, ...body };
    rows.push(row); return Promise.resolve([{ ...row }]);
  }
  const hits = rows.filter(match);
  if (method === 'PATCH') { hits.forEach(r => Object.assign(r, body)); return Promise.resolve(hits.map(r => ({ ...r }))); }
  if (method === 'DELETE') { db[table] = rows.filter(r => !hits.includes(r)); return Promise.resolve([]); }
  return Promise.resolve(hits.map(r => ({ ...r })));
}
const PLAYER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', display_name: 'Test Player' };
const REVIEWER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', username: 'celiad', display_name: 'Celia' };
let actingAs = 'player';
// Notifications the test hands the bell, through every way it reads them.
let fakeNotes = [];
// From the review step on, saved views load slowly, as on real data.
let slowViews = false;
const calls = [];

const RETINA_LAYERS = [
  { type: 'image', source: 'precomputed://gs://stroeh_sem_mouse_retina/image/v2', name: 'em' },
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina', subsources: { default: true, mesh: true, graph: true }, enableDefaultSubsources: true }, name: 'stroeh_mouse_retina', segments: ['720575940561794892'] },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate', host + '/nglstate/', host + '/nglstate/api/v1', host + '/segmentation', host + '/segmentation/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) {
      try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {}
    }
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/cache/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/daf-apis\.com\/auth\/api\/v1\/user\/me|microns-daf\.com\/auth\/api\/v1\/user\/me/, r => r.fulfill(json({ email: 't@example.org', name: 'Test Player' })));
  await context.route(/cloudfunctions\.net|run\.app/, async r => {
    const u = r.request().url();
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    if (/ewAccessRequest/.test(u)) {
      const { action, token, ...args } = input;
      calls.push(action);
      const me = actingAs === 'reviewer' ? REVIEWER : PLAYER;
      try {
        const data = await handle(action, args, { sb, me, isAdmin: actingAs === 'reviewer',
          who: { email: actingAs === 'reviewer' ? 'celia@example.org' : 't@example.org', caveId: actingAs === 'reviewer' ? 77 : 4242 },
          grantCave: async id => { told.push({ to: 'cave', id }); return { ok: true, status: 200 }; },
          notifyReviewers: async n => { told.push({ to: 'reviewers', ...n }); },
          notifyPlayer: async n => { told.push({ to: 'player', ...n }); },
          postSlack: async p => { told.push({ to: 'slack', ...p }); } });
        return r.fulfill(json({ ok: true, data }));
      } catch (e) { return r.fulfill(json({ error: e.message }, e.status || 500)); }
    }
    const get = String(input.method || 'GET').toUpperCase() === 'GET';
    const rows = input.table === 'users' && get
      ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org', total_edits: 0, cells_completed: 0 }]
      : input.table === 'notifications' && get ? fakeNotes : [];
    const single = /pgrst\.object/.test(String(input.accept || ''));
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(single ? (rows[0] || null) : rows) }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json(/\/rest\/v1\/notifications/.test(r.request().url()) && r.request().method() === 'GET' ? fakeNotes : [])));
  let minted = 0;
  await context.route(/nglstate\/api\/v1\/post/, r => { minted++; return r.fulfill(json('https://global.daf-apis.com/nglstate/api/v1/' + (5000 + minted))); });
  // The saved views load slowly, as on real data (Ames 2026-10-16: the
  // points were drawn, then the view landed and wiped them).
  await context.route(/global\.daf-apis\.com\/nglstate\/api\/v1\/\d+/, async r => { if (slowViews) await new Promise(res => setTimeout(res, 5000)); return r.fulfill(json({ dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] }, position: [37166, 16688, 1973], layers: RETINA_LAYERS, layout: 'xy-3d' })); });

  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && /access|Access|acc-|arv/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  const shotOf = async (sel, name) => {
    const box = await page.locator(sel).first().boundingBox().catch(() => null);
    if (box) await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: Math.max(0, box.x - 2), y: Math.max(0, box.y - 2), width: Math.min(1400 - box.x + 2, box.width + 4), height: Math.min(900 - box.y + 2, box.height + 4) } });
    else await page.screenshot({ path: path.join(OUT, name + '.png') });
  };
  const full = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  const panelText = () => page.evaluate(() => (document.querySelector('.nge-acc') || {}).innerText || '');
  const setIdentity = (admin) => page.evaluate((admin) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const login = pinia._s.get('login');
    if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
    const pb = pinia._s.get('proofreadingBackend');
    if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; pb.userEmail = 't@example.org'; pb.isAdmin = admin; } catch (e) {} }
  }, admin);
  // The view's contents: red and blue Multicut points, and the pieces shown.
  // As in Neuroglancer, Multicut points sit on one cell, its focus segment.
  const setView = (red, blue, segs, merges = []) => page.evaluate(({ red, blue, segs, merges }) => {
    const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'stroeh_mouse_retina');
    const g = ml.layer.displayState.segmentationGroupState.value;
    // Neuroglancer's own 64 bit ID type, taken from an ID already shown.
    window.__U64 = window.__U64 || [...g.visibleSegments][0].constructor;
    const sel = (p, i) => ({ position: Float32Array.from(p), segmentId: String(100 + i), rootId: '720575940561794892' });
    const focus = { value: red.length || blue.length ? window.__U64.parseString('720575940561794892') : undefined };
    ml.layer.graphConnection.value = { state: { multicutState: { focusSegment: focus, sinks: new Set(red.map(sel)), sources: new Set(blue.map(sel)), reset() { focus.value = undefined; this.sinks.clear(); this.sources.clear(); } },
      mergeState: { merges: { value: merges.map(([a, b], i) => ({ id: 'm' + i, locked: false, sink: sel(a, i), source: sel(b, i + 50) })) } } } };
    g.visibleSegments.clear(); for (const s of segs) g.visibleSegments.add(window.__U64.parseString(s));
  }, { red, blue, segs, merges });
  const ok = (cond, what) => { console.log((cond ? 'PASS ' : 'FAIL ') + what); if (!cond) process.exitCode = 1; };

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.addStyleTag({ content: HIDE_CSS });
    await setIdentity(false);
    await page.waitForTimeout(3500);
    await setIdentity(false);
    await page.waitForTimeout(500);

    // 1. The menu line, last in the burger.
    await page.click('#hamburger > button');
    await page.waitForTimeout(400);
    const menu = await page.evaluate(() => [...document.querySelectorAll('#hamburger li')].map(li => li.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean));
    console.log('menu tail: ' + JSON.stringify(menu.slice(-3)));
    ok(/Ask for Edit Access/.test(menu[menu.length - 1] || ''), 'the last menu line is Ask for Edit Access');
    await shotOf('#hamburger', '01-menu');
    await page.evaluate(() => document.querySelector('.nge-menu-access').click());
    await page.waitForSelector('.nge-acc', { timeout: 8000 });
    await page.waitForTimeout(1200);
    ok(/Seven cuts/.test(await panelText()), 'the panel explains the ten examples');
    // Drag it by its header: it moves and remembers where it was put.
    const before = await page.locator('.nge-acc').boundingBox();
    await page.mouse.move(before.x + 120, before.y + 18);
    await page.mouse.down();
    await page.mouse.move(before.x - 300, before.y + 140, { steps: 8 });
    await page.mouse.up();
    const after = await page.locator('.nge-acc').boundingBox();
    ok(Math.round(after.x) === Math.round(before.x - 420) && Math.round(after.y) === Math.round(before.y + 122), `the box moves when dragged (${Math.round(before.x)},${Math.round(before.y)} to ${Math.round(after.x)},${Math.round(after.y)})`);
    ok(!!(await page.evaluate(() => localStorage.getItem('nge_access_panel_pos'))), 'the box remembers where it was put');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.nge-acc')).fontSize) === '15px', 'the panel text is 15px');
    await shotOf('.nge-acc', '02-panel-empty');

    // 2. A cut with no blue point is refused with a reason.
    await setView([[37100, 16600, 1970]], [], ['720575940561794892']);
    await page.waitForTimeout(1200);
    await page.click('.nge-acc-save >> nth=0');
    await page.waitForTimeout(400);
    ok(/red and blue Multicut points/.test(await panelText()), 'a cut without blue points is refused');
    ok(db.access_request_items.length === 0, 'nothing was saved');
    // Red and blue on a cell the player has hidden: the reviewer would see
    // points in empty space, so the save asks for the cell first.
    await setView([[37100, 16600, 1970]], [[37200, 16700, 1975]], ['720575940561794999']);
    await page.waitForTimeout(1200);
    await page.click('.nge-acc-save >> nth=0');
    await page.waitForTimeout(400);
    ok(/Show the cell your points are on, then save\./.test(await panelText()), 'a cut whose cell is hidden is refused');
    ok(db.access_request_items.length === 0, 'nothing was saved');
    await shotOf('.nge-acc', '02b-cut-cell-hidden');

    // 3. Seven cuts and three merges.
    for (let i = 1; i <= 7; i++) {
      await setView([[37100 + i, 16600, 1970], [37110 + i, 16600, 1970]], [[37200 + i, 16700, 1975]], ['720575940561794892']);
      if (i === 1) await page.fill('.nge-acc textarea', 'The merger starts at the soma.');
      await page.waitForTimeout(1100);
      await page.click('.nge-acc-save >> nth=0');
      await page.waitForFunction(n => document.querySelectorAll('.nge-acc-item').length >= n, i, { timeout: 8000 });
      if (i === 1) {
        await page.waitForTimeout(1200);
        ok(/In view: 0 red, 0 blue/.test(await panelText()), 'the points are cleared from the view after a save');
      }
    }
    await setView([], [], ['720575940561794892']);
    await page.waitForTimeout(1100);
    await page.click('.nge-acc-save >> nth=0');
    await page.waitForTimeout(400);
    ok(/Ctrl\+click the two pieces/.test(await panelText()), 'a merge without merge points is refused');
    // Two merges queued in one view: a yes is asked for first, and Cancel saves nothing.
    await setView([], [], ['720575940561794892'], [[[1, 2, 3], [4, 5, 6]], [[7, 8, 9], [10, 11, 12]]]);
    await page.waitForTimeout(1100);
    await page.click('.nge-acc-save >> nth=0');
    await page.waitForSelector('.nge-acc-confirm', { timeout: 4000 });
    ok(/2 merges queued/.test(await panelText()), 'two merges in one view ask for a yes');
    await shotOf('.nge-acc', '03a-confirm-merges');
    await page.click('.nge-acc-confirm-no');
    ok(!db.access_request_items.some(i => i.kind === 'merge'), 'Cancel saves nothing');
    for (let i = 1; i <= 3; i++) {
      await setView([], [], ['720575940561794892', String(720575940561794000 + i)], [[[38000 + i, 16600, 1970], [38050 + i, 16620, 1972]]]);
      await page.waitForTimeout(1100);
      await page.click('.nge-acc-save >> nth=0');
      await page.waitForFunction(n => document.querySelectorAll('.nge-acc-item').length >= n, 7 + i, { timeout: 8000 });
    }
    ok(db.access_request_items.length === 10, `ten examples saved (${db.access_request_items.length})`);
    const c1 = db.access_request_items.find(i => i.kind === 'cut' && i.slot === 1);
    ok(c1 && c1.points.red.length === 2 && c1.points.blue.length === 1 && /nglstate\/api\/v1\/\d+/.test(c1.link), 'cut 1 keeps its two red, one blue points and a short link');
    ok(c1 && c1.note === 'The merger starts at the soma.', 'cut 1 keeps the player note');
    const m1 = db.access_request_items.find(i => i.kind === 'merge' && i.slot === 1);
    ok(m1 && m1.points.merge.length === 2 && m1.points.merge[0].position[0] === 38001, 'merge 1 keeps its two merge points');
    await page.fill('.nge-acc-input >> nth=1', 'testplayer_ew');
    await shotOf('.nge-acc', '03-panel-full');
    // Slim: counts, Save and Send only; remembered; back to full.
    await page.click('.nge-acc-size');
    await page.waitForTimeout(300);
    const slimBox = await page.locator('.nge-acc').boundingBox();
    ok(await page.$$eval('.nge-acc-item', els => els.length) === 0 && !!(await page.$('.nge-acc-send')) && slimBox.width < 300, `slim hides the lists and keeps Send (${Math.round(slimBox.width)} by ${Math.round(slimBox.height)} px)`);
    ok(await page.evaluate(() => localStorage.getItem('nge_access_panel_slim')) === '1', 'slim is remembered');
    await shotOf('.nge-acc', '03b-panel-slim');
    await page.click('.nge-acc-size');
    await page.waitForTimeout(300);
    await page.click('.nge-acc-send');
    await page.waitForFunction(() => /A reviewer is looking/.test((document.querySelector('.nge-acc') || {}).innerText || ''), null, { timeout: 8000 });
    ok(db.access_requests[0].status === 'submitted', 'the request is submitted');
    ok(told.some(t => t.to === 'reviewers') && told.some(t => t.to === 'slack' && t.eyewireUsername === 'testplayer_ew'), 'reviewers get a bell and Slack gets a post');
    await shotOf('.nge-acc', '04-panel-sent');
    // Second thoughts: take them back, replace cut 3, send again.
    await page.click('.nge-acc-back');
    await page.waitForSelector('.nge-acc-rep', { timeout: 8000 });
    ok(db.access_requests[0].status === 'draft', 'taken back to change');
    await setView([[39000, 16600, 1970]], [[39100, 16700, 1975]], ['720575940561794892']);
    await page.waitForTimeout(1100);
    await page.click('.nge-acc-item >> nth=2 >> .nge-acc-rep');
    await page.waitForSelector('.nge-acc-confirm', { timeout: 4000 });
    ok(/replaces the cut 3/.test(await panelText()), 'Replace asks for a yes');
    await page.click('.nge-acc-confirm-yes');
    await page.waitForTimeout(800);
    const c3 = db.access_request_items.find(i => i.kind === 'cut' && i.slot === 3);
    ok(c3.points.red.length === 1 && c3.points.red[0].position[0] === 39000, 'cut 3 replaced with the new view');
    await shotOf('.nge-acc', '04b-panel-taken-back');
    await page.click('.nge-acc-send');
    await page.waitForFunction(() => /A reviewer is looking/.test((document.querySelector('.nge-acc') || {}).innerText || ''), null, { timeout: 8000 });
    ok(db.access_requests[0].tries === 2, 'sent again as try 2');
    await page.click('.nge-acc-close');

    // 4. The reviewer: Admin Hub > Access requests.
    actingAs = 'reviewer';
    await setIdentity(true);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'access' } })));
    await page.waitForSelector('.nge-accr-card', { timeout: 10000 });
    await page.waitForTimeout(800);
    ok(/Test Player/.test(await page.evaluate(() => document.querySelector('.nge-accr').innerText)), 'the request is listed with the player name');
    await full('05-admin-list');
    // Mark cut 1 good from the list.
    await page.click('.nge-accr-btn--good >> nth=0');
    await page.waitForTimeout(500);
    // Open cut 2 in the view.
    slowViews = true;
    await page.click('.nge-accr-acts >> nth=1 >> text=Review in the view');
    await page.waitForSelector('.nge-arv', { timeout: 8000 });
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => !document.querySelector('.nge-profile-shell')), 'the profile closed for the view');
    ok(/Cut 2/.test(await page.evaluate(() => document.querySelector('.nge-arv').innerText)), 'the review bar shows cut 2');
    // Review mode draws the example's points itself, and the cells are see through,
    // still after the slow view has landed.
    await page.waitForTimeout(8000);
    const rv = await page.evaluate(() => {
      const ls = window.viewer.layerManager.managedLayers;
      const n = name => { const l = ls.find(x => x.name === name); return l ? l.layer.localAnnotations.toJSON().length : 0; };
      const seg = ls.find(x => x.layer && x.layer.displayState && x.layer.displayState.objectAlpha);
      return { red: n('Review red'), blue: n('Review blue'), alpha: seg ? seg.layer.displayState.objectAlpha.value : null };
    });
    ok(rv.red === 2 && rv.blue === 1 && rv.alpha === 0.5, `review mode draws the points and the cells are half see through (${JSON.stringify(rv)})`);
    // All points of an example in one click, and a second click clears them.
    await page.click('.nge-arv-all >> text=all good');
    await page.waitForTimeout(500);
    let c2m = db.access_request_items.find(i => i.kind === 'cut' && i.slot === 2).point_marks;
    ok(Object.keys(c2m).length === 3 && Object.values(c2m).every(v => v === 'good'), `all good marks every point (${JSON.stringify(c2m)})`);
    await page.click('.nge-arv-all >> text=all good');
    await page.waitForTimeout(500);
    c2m = db.access_request_items.find(i => i.kind === 'cut' && i.slot === 2).point_marks;
    ok(Object.keys(c2m).length === 0, 'a second click clears them');
    // Fly to blue 1, mark it off, red 1 good, the example redo, with a note.
    await page.click('.nge-arv-fly--blue');
    await page.waitForTimeout(300);
    const pos = await page.evaluate(() => [...window.viewer.position.value].map(Math.round));
    ok(pos[0] === 37202 && pos[1] === 16700, `flying to blue 1 moves the view (${pos})`);
    await page.click('.nge-arv-pt:has(.nge-arv-fly--blue) >> text=off');
    await page.waitForTimeout(300);
    await page.click('.nge-arv-pt:has(.nge-arv-fly--red) >> nth=0 >> text=good');
    await page.waitForTimeout(300);
    await page.click('.nge-arv-v >> text=Redo');
    await page.fill('.nge-arv-note', 'The blue point sits on the merger itself. Put it on the other cell.');
    await page.click('.nge-arv-head');
    await page.waitForTimeout(600);
    const c2 = db.access_request_items.find(i => i.kind === 'cut' && i.slot === 2);
    ok(c2.verdict === 'redo' && c2.point_marks['blue:0'] === 'off' && c2.point_marks['red:0'] === 'good' && /other cell/.test(c2.feedback || ''), 'per point marks, verdict and note are saved');
    await shotOf('.nge-arv', '06-review-bar');
    await full('07-review-in-view');
    // Back to the request and ask for redos.
    await page.click('.nge-arv-btn--list');
    await page.waitForTimeout(500);
    const leftReview = await page.evaluate(() => {
      const ls = window.viewer.layerManager.managedLayers;
      const seg = ls.find(x => x.layer && x.layer.displayState && x.layer.displayState.objectAlpha);
      return { review: ls.filter(x => /^Review /.test(x.name)).length, alpha: seg ? seg.layer.displayState.objectAlpha.value : null };
    });
    ok(leftReview.review === 0 && leftReview.alpha === 1, `leaving review mode removes the points and makes the cells solid (${JSON.stringify(leftReview)})`);
    await page.waitForSelector('.nge-accr-decide textarea', { timeout: 10000 });
    await page.fill('.nge-accr-decide textarea', 'Close! One to fix.');
    await page.click('.nge-accr-decide-btns >> text=Ask for redos');
    await page.waitForSelector('.nge-accr-done', { timeout: 8000 });
    ok(db.access_requests[0].status === 'redo' && told.some(t => t.to === 'player' && /one again/.test(t.body)), 'redo sent, player told');
    await full('08-admin-redo-sent');

    // 5. The player sees the notes and redoes cut 2.
    actingAs = 'player';
    await setIdentity(false);
    await page.evaluate(() => document.querySelector('.nge-profile-exit')?.click());
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:access-open')));
    await page.waitForSelector('.nge-acc-state--redo', { timeout: 10000 });
    await page.click('.nge-acc-item--redo .nge-acc-more');
    await page.waitForTimeout(300);
    ok(/other cell/.test(await panelText()) && /off/.test(await panelText()), 'the player sees the note and the point marks');
    await shotOf('.nge-acc', '09-player-notes');
    await setView([[37102, 16600, 1970]], [[37502, 16900, 1975]], ['720575940561794892']);
    await page.waitForTimeout(1100);
    await page.click('.nge-acc-save >> nth=0');
    await page.waitForSelector('.nge-acc-confirm', { timeout: 4000 });
    await page.click('.nge-acc-confirm-yes');
    await page.waitForTimeout(800);
    await page.click('.nge-acc-send');
    await page.waitForFunction(() => /A reviewer is looking/.test((document.querySelector('.nge-acc') || {}).innerText || ''), null, { timeout: 8000 });
    ok(db.access_requests[0].tries === 3, 'sent again after the redo as try 3');
    await page.click('.nge-acc-close');

    // 6. The reviewer invites.
    actingAs = 'reviewer';
    await setIdentity(true);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'access' } })));
    await page.waitForSelector('.nge-accr-refresh', { timeout: 10000 });
    await page.click('.nge-accr-refresh');
    await page.waitForSelector('.nge-accr-decide', { timeout: 10000 });
    // The replaced cut 2: new since the review, its earlier try kept with the note.
    ok(/new since your review/.test(await page.evaluate(() => document.querySelector('.nge-accr').innerText)), 'a changed example says new since your review');
    await page.click('.nge-accr-earlier-btn');
    await page.waitForTimeout(300);
    ok(/marked redo/.test(await page.evaluate(() => (document.querySelector('.nge-accr-earlier') || {}).innerText || '')) && db.access_request_item_history.length >= 1, 'the earlier try is kept and shown with its mark');
    await full('10a-admin-earlier-try');
    ok(/Eyewire_2_Edit/.test(await page.evaluate(() => (document.querySelector('.nge-accr-cave') || {}).innerText || '')), 'the reviewer is told the grant adds them to Eyewire_2_Edit');
    await page.click('.nge-accr-btn--invite');
    await page.waitForSelector('.nge-accr-done', { timeout: 8000 });
    ok(db.access_requests[0].status === 'invited' && db.pilot_members.some(m => m.email === 't@example.org'), 'invited and added to the pilot testers');
    ok(told.some(t => t.to === 'cave' && t.id === 4242) && db.access_requests[0].cave_granted === true, 'Grant edit access adds the player to Eyewire_2_Edit');
    await full('10-admin-invited');
    actingAs = 'player';
    await setIdentity(false);
    await page.evaluate(() => document.querySelector('.nge-profile-exit')?.click());
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:access-open')));
    await page.waitForSelector('.nge-acc-state--yes', { timeout: 10000 });
    await shotOf('.nge-acc', '11-player-invited');
    await page.click('.nge-acc-close');

    // 7. The notifications are links: a reviewer's opens Access requests,
    // a player's opens their panel.
    const clickNote = async (title) => {
      fakeNotes = [{ id: 9000 + fakeNotes.length, title, body: 'Test.', send_at: new Date(Date.now() - 60000).toISOString(), created_at: new Date(Date.now() - 60000).toISOString(), target_type: 'user', target_id: 'test-user' }];
      await page.evaluate((note) => {
        const pb = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend');
        pb.notifications = [note];
        document.dispatchEvent(new CustomEvent('nge:open-notification'));
      }, fakeNotes[0]);
      await page.waitForSelector('.nge-notif-card', { timeout: 8000 });
      await page.click(`.nge-notif-card:has-text("${title.slice(3, 30)}")`);
    };
    await page.evaluate(() => document.querySelector('.nge-profile-exit')?.click());
    await page.waitForTimeout(500);
    actingAs = 'reviewer';
    await setIdentity(true);
    await clickNote('🔬 Retina access request from Test Player');
    await page.waitForSelector('.nge-accr', { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => !!document.querySelector('.nge-accr')), "the reviewer's notification opens Access requests");
    await full('12-note-opens-requests');
    await page.evaluate(() => document.querySelector('.nge-profile-exit')?.click());
    await page.keyboard.press('Escape');
    actingAs = 'player';
    await setIdentity(false);
    await clickNote('🔬 Notes on your retina access request');
    await page.waitForSelector('.nge-acc', { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => !!document.querySelector('.nge-acc')), "the player's notification opens their panel");

    // 8. Admins start over: Start over in their own panel, Delete in the Admin Hub.
    await page.click('.nge-acc-close').catch(() => {});
    actingAs = 'reviewer';
    await setIdentity(true);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:access-open')));
    await page.waitForSelector('.nge-acc', { timeout: 8000 });
    await page.waitForTimeout(800);
    await setView([[40000, 16600, 1970]], [[40100, 16700, 1975]], ['720575940561794892']);
    await page.waitForTimeout(1100);
    await page.click('.nge-acc-save >> nth=0');
    await page.waitForSelector('.nge-acc-admin .nge-acc-rep', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('.nge-acc-admin .nge-acc-rep').click());
    await page.waitForSelector('.nge-cfm', { timeout: 4000 });
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('nge-cfm-no')), 'Start over asks in a pop up, with Cancel focused');
    await page.click('.nge-cfm-yes');
    await page.waitForTimeout(800);
    ok(!db.access_requests.some(r => r.user_id === REVIEWER.id) && /Started over/.test(await panelText()), 'an admin starts their own request over');
    await page.click('.nge-acc-close');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:open-profile', { detail: { tab: 'access' } })));
    await page.waitForSelector('.nge-accr-refresh', { timeout: 8000 });
    await page.click('.nge-accr-filter >> text=All');
    await page.waitForSelector('.nge-accr-card', { timeout: 8000 });
    if (!(await page.$('.nge-accr-delete'))) await page.click('.nge-accr-head');
    await page.click('.nge-accr-delete >> text=Delete request');
    await page.waitForSelector('.nge-cfm', { timeout: 4000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok(!(await page.$('.nge-cfm')) && db.access_requests.length === 1, 'Escape cancels a delete');
    await page.click('.nge-accr-delete >> text=Delete request');
    await page.waitForSelector('.nge-cfm', { timeout: 4000 });
    await shotOf('.nge-cfm', '13-delete-popup');
    await page.click('.nge-cfm-yes');
    await page.waitForTimeout(800);
    ok(db.access_requests.length === 0 && db.access_request_items.length === 0, "an admin deletes a player's request in the Admin Hub");
  } catch (e) {
    console.log('ERROR ' + (e && e.stack || e));
    console.log('panel: ' + JSON.stringify(await panelText().catch(() => '')));
    process.exitCode = 1;
    await full('zz-error').catch(() => {});
  }
  console.log('calls: ' + JSON.stringify(calls));
  console.log('told: ' + JSON.stringify(told.map(t => t.to + ': ' + (t.title || t.name))));
  console.log('page errors: ' + JSON.stringify(errors));
  await browser.close();
})();
