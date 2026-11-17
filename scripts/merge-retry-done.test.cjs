// A merge that went through on the server, then showed FAILED (Ames
// 2026-11-17: "merge worked but I got a merge failed" with "[400]:
// Supervoxels must belong to different objects"). Each merge is tried up to
// three times; when the first try joins the cells but its answer is lost, the
// retry is refused because the two points are one cell now.
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3497 --directory dist/min
// Run:    node scripts/merge-retry-done.test.cjs [base url] [--expect-bug]
// The fake graph server answers the first /merge with a 500, every later one
// with the 400 refusal, and both points' roots as one cell (777). Cases:
//   1. that merge ends "done", merged into 777, with no error;
//   2. a refusal when the two points are NOT one cell still fails, with the
//      server's words (the check never hides a real failure).
// --expect-bug runs against a build without the fix as the control: it
// passes when case 1 shows the failure.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const BASE = args[0] || 'http://localhost:3497/';
const EXPECT_BUG = process.argv.includes('--expect-bug');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };

const GRAPH_INFO = {
  data_dir: 'gs://nge-test-none/ws', data_type: 'uint64', num_channels: 1, type: 'segmentation', mesh: 'graphene_meshes',
  scales: [{ key: '16_16_40', resolution: [16, 16, 40], size: [80000, 60000, 3000], voxel_offset: [0, 0, 0],
             chunk_sizes: [[256, 256, 32]], encoding: 'compressed_segmentation', compressed_segmentation_block_size: [8, 8, 8] }],
  app: { supported_api_versions: [0, 1] }, graph: { chunk_size: [256, 256, 512], n_bits_for_layer_id: 8 },
};
// Roots carry their layer in the top 8 bits.
const ROOT_A = '648518346350000111', ROOT_B = '648518346350000222', JOINED = '648518346350000777';
const SV_A = '72057594037929001', SV_B = '72057594037929002';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  // The world: joined (case 1) or apart (case 2).
  let joined = true, merges = 0;
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\//, r => {
    const req = r.request(), url = req.url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors, body: '' });
    if (/\/auth_info$/.test(url)) return r.fulfill({ ...json({ login_url: 'https://global.daf-apis.com/sticky_auth' }), headers: cors });
    if (/\/segmentation\/table\/[^/?]+\/info(\?|$)/.test(url)) return r.fulfill({ ...json(GRAPH_INFO), headers: cors });
    if (/\/merge\?/.test(url)) {
      merges++;
      // The first try: joined on the server, but the answer is an error.
      if (merges === 1) return r.fulfill({ ...json({ message: 'Internal Server Error' }, 500), headers: cors });
      return r.fulfill({ ...json({ code: 400, message: 'Supervoxels must belong to different objects.' }, 400), headers: cors });
    }
    const root = url.match(/\/node\/(\d+)\/root/);
    if (root) return r.fulfill({ ...json({ root_id: joined ? JOINED : (root[1] === SV_A ? ROOT_A : ROOT_B) }), headers: cors });
    if (/\/is_latest_roots/.test(url)) {
      let n = 0; try { n = JSON.parse(req.postData() || '{}').node_ids.length; } catch (e) {}
      return r.fulfill({ ...json({ is_latest: Array(n).fill(true) }), headers: cors });
    }
    return r.abort();
  });
  await context.route(/nge-test-none/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  await context.route(/supabase\.co/, r => r.fulfill(json([])));

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  // One merge sent the way the queue sends it: GraphConnection.bulkMerge.
  const send = () => page.evaluate(async ({ SV_A, SV_B, ROOT_A, ROOT_B }) => {
    const ml = window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.constructor.type === 'segmentation');
    const gc = ml.layer.graphConnection.value;
    // Uint64 from the layer's own module, through a visible segment set.
    const g = ml.layer.displayState.segmentationGroupState.value;
    const Uint64 = [...g.visibleSegments][0].constructor;
    const sel = (sv, root, dx) => ({ segmentId: Uint64.parseString(sv), rootId: Uint64.parseString(root), position: new Float32Array([32653 + dx, 23923, 583]) });
    const sub = { id: 'test-' + Math.random(), locked: false, sink: sel(SV_A, ROOT_A, 0), source: sel(SV_B, ROOT_B, 30) };
    await gc.bulkMerge([sub]);
    return { status: sub.status || null, error: sub.error || null, merged: sub.mergedRoot ? sub.mergedRoot.toString() : null };
  }, { SV_A, SV_B, ROOT_A, ROOT_B });

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.waitForTimeout(3000);
    // The layer shows the two cells, so a Uint64 is at hand and the graph is up.
    const st = await page.evaluate(() => window.viewer.state.toJSON());
    const L = st.layers.find(l => l.type === 'segmentation');
    L.segments = [ROOT_A, ROOT_B];
    await page.goto('about:blank');
    await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(st)), { waitUntil: 'load' });
    await page.waitForFunction(() => { const ml = window.viewer && window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.constructor.type === 'segmentation'); return !!(ml && ml.layer && ml.layer.graphConnection && ml.layer.graphConnection.value); }, null, { timeout: 90000 });
    await page.waitForTimeout(2000);

    const one = await send();
    if (EXPECT_BUG) {
      check('control: without the fix, the merge that went through shows failed', one.status !== 'done' && /different objects/.test(one.error || one.status || ''), one);
    } else {
      check('a merge refused on retry because it already went through ends done', one.status === 'done' && one.merged === JOINED && !one.error, { ...one, merges });
      joined = false; merges = 0;
      const two = await send();
      check('a refusal when the two are NOT one cell still fails, in the server\'s words', two.status !== 'done' && /different objects/.test(two.error || two.status || ''), two);
    }
    check('no page errors', errors.length === 0, errors);
  } catch (e) { check('the run finished', false, String(e).slice(0, 300)); }
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
