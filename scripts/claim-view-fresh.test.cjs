// A claim's saved view brings back the cell as it is now, headless (Ames
// 2026-11-13: "I closed the Start Playing popup and it reverted my cut
// (loaded old state)"). The cut was on the server; the view kept the old ID.
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3571 --directory dist/min
// Run:    node scripts/claim-view-fresh.test.cjs [base url]
// Checks, against a pretend chunkedgraph (nothing reaches production):
//  - the claim's old ID in the view is swapped for its current ID;
//  - a piece cut off the cell is not brought back, and another old ID that is
//    not this cell stays as it is;
//  - a view already on the current ID is left alone.
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:3571/';
const OLD = '648518346351955068';     // the claim's ID before the cut (Ames's cell, Sheet #17)
const NOW = '648518346350642432';     // the cell after the cut
const CUT = '648518346350642999';     // the piece the cut took off
const OTHER = '648518346351111111';   // some other cell, also out of date
const OTHER_NOW = '648518346351222222';
const SV = '76561193665298433';       // the claim's soma supervoxel
const json = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
const state = (ids) => ({ dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] }, position: [84054, 50604, 1424], layout: '3d', layers: [
  { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2' }, name: 'pinky_nf_v2', segments: ids },
] });
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 300) : '')); };

async function run(browser, ids) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    try { localStorage.setItem('auth_token_v2_https://global.daf-apis.com/sticky_auth', JSON.stringify(token)); } catch (e) {}
  });
  await context.route(/global\.daf-apis\.com/, r => r.fulfill(json({})));
  const asked = [];
  // The pretend chunkedgraph.
  await context.route(/minnie\.microns-daf\.com/, async r => {
    const u = r.request().url();
    if (/\/node\/\d+\/root/.test(u)) { asked.push('root'); return r.fulfill(json({ root_id: NOW })); }
    if (/is_latest_roots/.test(u)) {
      const body = r.request().postData() || '';
      const got = (body.match(/\d{6,}/g) || []);
      asked.push('latest');
      return r.fulfill(json({ is_latest: got.map(id => id === NOW || id === CUT || id === OTHER_NOW) }));
    }
    const lin = u.match(/\/root\/(\d+)\/lineage_graph/);
    if (lin) {
      asked.push('lineage ' + lin[1]);
      const links = lin[1] === OTHER ? [{ source: OTHER, target: OTHER_NOW }] : [{ source: OLD, target: NOW }, { source: OLD, target: CUT }];
      return r.fulfill(json({ directed: true, graph: {}, links, nodes: [] }));
    }
    return r.abort();
  });
  const me = { id: 1, email: 't@example.org', name: 'Test Player', permissions_v2: { pinky_sandbox: ['view', 'edit'], pinky100: ['view', 'edit'] } };
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)|\/auth\/api\/v1\/user\/\d+\/permissions/, r => r.fulfill(json(me)));
  await context.route(/cloudfunctions\.net|run\.app|supabase\.co|docs\.google\.com/, r => r.fulfill(json([])));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  let out = {};
  try {
    await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(state(ids))), { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer && window.__ngeFreshenClaimView); }, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    out = await page.evaluate(async ([old, sv]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const pb = pinia._s.get('proofreadingBackend');
      pb.userId = 'test-user';
      pb.tasks.push({ id: 99001, segment_id: old, supervoxel_id: sv, assigned_to: 'test-user', status: 'in_progress', dataset: 'pinky_sandbox', claim_point_x: 0, claim_point_y: 0, claim_point_z: 0 });
      const swapped = await window.__ngeFreshenClaimView(99001, pb);
      const ml = window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.displayState && l.layer.displayState.segmentationGroupState);
      return { swapped, shown: [...ml.layer.displayState.segmentationGroupState.value.visibleSegments].map(String).sort(), live: pb.liveRoots[99001] };
    }, [OLD, SV]);
  } catch (e) { out.error = String(e).slice(0, 300); }
  out.asked = asked; out.errors = errors;
  await context.close();
  return out;
}

async function links(browser) {
  const context = await browser.newContext();
  const retina = { layers: [{ type: 'image', name: '2D EM' }, { type: 'segmentation', name: '3D Retina Cells', source: [{ url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina_v2' }] }] };
  // Last registered is asked first: the catch all goes in first.
  await context.route(/global\.daf-apis\.com/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/global\.daf-apis\.com\/nglstate\/api\/v1\/\d+/, r => r.fulfill(json(retina)));
  await context.route(/minnie\.microns-daf\.com|cloudfunctions\.net|run\.app|supabase\.co|docs\.google\.com/, r => r.abort());
  await context.addInitScript(() => {
    const t = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: ['https://global.daf-apis.com', 'https://global.daf-apis.com/', 'https://global.daf-apis.com/nglstate/'] };
    try { localStorage.setItem('auth_token_v2_https://global.daf-apis.com/sticky_auth', JSON.stringify(t)); } catch (e) {}
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__ngeStateLink, null, { timeout: 120000 });
  const out = await page.evaluate(async ([sb, rt]) => {
    const L = window.__ngeStateLink;
    const at = (st) => location.origin + '/#!' + encodeURIComponent(JSON.stringify(st));
    const read = async (link) => { const s = await L.readStateLink(link); return s ? L.stateSegTable(s) : null; };
    return { sandbox: await read(at(sb)), retina: await read(at(rt)), short: await Promise.race([read(location.origin + '/#!middleauth+https://global.daf-apis.com/nglstate/api/v1/5555555555'), new Promise(r => setTimeout(() => r('timeout'), 20000))]) };
  }, [{ layers: [{ type: 'image', name: '2D EM' }, { type: 'segmentation', name: '3D segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2' } }] }, retina]);
  await context.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const a = await run(browser, [OLD, OTHER]);
  check('the claim knows its current ID', a.live === NOW, a);
  check('the old ID in the saved view becomes the current one', a.shown && a.shown.includes(NOW) && !a.shown.includes(OLD), a);
  check('the piece cut off is not brought back', a.shown && !a.shown.includes(CUT), a.shown);
  check('another out of date cell is left as it is', a.shown && a.shown.includes(OTHER) && !a.shown.includes(OTHER_NOW), a.shown);
  const b = await run(browser, [NOW]);
  check('a view already current is left alone', b.swapped && b.swapped.length === 0 && b.shown.join() === NOW, b);
  // A saved view on another dataset is told apart (Ames 2026-11-13: Play on
  // the Sandbox went to Retina): its table is read from the link itself, or
  // from the state server for a short link.
  const c = await links(browser);
  check('a Sandbox view named 3D segmentation reads as pinky_nf_v2', c.sandbox === 'pinky_nf_v2', c);
  check('a Retina view reads as Retina', /stroeh/.test(c.retina || ''), c);
  check('a short link is read from the state server', /stroeh/.test(c.short || ''), c);
  check('no page errors', !a.errors.length && !b.errors.length, [...a.errors, ...b.errors]);
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
