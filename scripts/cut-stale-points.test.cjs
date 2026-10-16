// Cut points left on another cell, headless (Ames, 2026-10-16: pressing C
// showed only some old cell and hid the cells she was working on).
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3496 --directory dist/min
// Run:    node scripts/cut-stale-points.test.cjs [base url] [shots dir] [--expect-bug]
// The graph server is answered here with an info file only (no meshes, no
// root lookups), which is all the cut tool needs to open. Cases:
//   1. a saved view or link restores points on cell 111 while 222 and 333
//      are shown: C must keep 222 and 333 on screen and offer Undo;
//   2. Undo puts the 3 points back;
//   3. the player hides the cell with points while cut mode is closed: it
//      stays hidden, and C clears the points;
//   4. points on a cell that IS shown are kept, and C shows that cell;
//   5. a restored cell with no points is cleared without a notice.
// Run with --expect-bug against a build without the fix as the control:
// it passes when the bug shows (C isolates the old cell).
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const BASE = args[0] || 'http://localhost:3496/';
const OUT = args[1] || path.join(__dirname, 'shots-cut-stale');
const EXPECT_BUG = process.argv.includes('--expect-bug');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };

// The retina table's info, as far as the cut tool needs it.
const GRAPH_INFO = {
  data_dir: 'gs://nge-test-none/ws', data_type: 'uint64', num_channels: 1, type: 'segmentation', mesh: 'graphene_meshes',
  scales: [{ key: '16_16_40', resolution: [16, 16, 40], size: [80000, 60000, 3000], voxel_offset: [0, 0, 0],
             chunk_sizes: [[256, 256, 32]], encoding: 'compressed_segmentation', compressed_segmentation_block_size: [8, 8, 8] }],
  app: { supported_api_versions: [0, 1] }, graph: { chunk_size: [256, 256, 512], n_bits_for_layer_id: 8 },
};
const P = [32653, 23923, 583];
// Root IDs carry their layer in the top 8 bits; a bare 111 would read as a
// supervoxel and be swapped for its root. Shortened to 111, 222, 333 below.
const sel = (sv, root, dx) => ({ segmentId: sv, rootId: root, position: [P[0] + dx, P[1], P[2]] });
const POINTS_ON = root => ({ focusSegment: root, sinks: [sel('72057594037929001', root, 0), sel('72057594037929002', root, 40)], sources: [sel('72057594037929003', root, 400)] });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\//, r => {
    const req = r.request(), url = req.url();
    if (process.env.LOGURL) console.log('URL', req.method(), url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors, body: '' });
    if (/\/auth_info$/.test(url)) return r.fulfill({ ...json({ login_url: 'https://global.daf-apis.com/sticky_auth' }), headers: cors });
    if (/\/segmentation\/table\/[^/?]+\/info(\?|$)/.test(url)) return r.fulfill({ ...json(GRAPH_INFO), headers: cors });
    // Every cell here is current: none is swapped for a newer one or dropped.
    if (/\/is_latest_roots/.test(url)) {
      let n = 0; try { n = JSON.parse(req.postData() || '{}').node_ids.length; } catch (e) {}
      return r.fulfill({ ...json({ is_latest: Array(n).fill(true) }), headers: cors });
    }
    const lin = url.match(/\/root\/(\d+)\/lineage_graph/);
    if (lin) return r.fulfill({ ...json({ nodes: [{ id: Number(lin[1]) }], links: [] }), headers: cors });
    return r.abort();
  });
  await context.route(/nge-test-none/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  await context.route(/supabase\.co/, r => r.fulfill(json([])));

  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const t0 = Date.now();
  const step = m => { if (process.env.STEPS) console.log('STEP', ((Date.now() - t0) / 1000).toFixed(1), m); };
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));

  const segLayer = `(() => window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.constructor.type === 'segmentation'))()`;
  const read = () => page.evaluate((segLayer) => {
    const ml = eval(segLayer);
    const gc = ml.layer.graphConnection && ml.layer.graphConnection.value;
    const ms = gc && gc.state.multicutState;
    const g = ml.layer.displayState.segmentationGroupState.value;
    const ids = s => [...s].map(x => x.toString()).sort();
    const bar = document.querySelector('.nge-split-merge-overlay');
    return {
      graph: !!ms, toolOpen: !!document.querySelector('.graphene-multicut'),
      focus: ms && ms.focusSegment.value ? ms.focusSegment.value.toString() : null,
      points: ms ? ms.sinks.size + ms.sources.size : null,
      visible: ids(g.visibleSegments),
      isolating: !!g.useTemporaryVisibleSegments.value, shownInCut: ids(g.temporaryVisibleSegments),
      notice: (document.querySelector('.nge-smo-stale') || {}).innerText || null,
      bar: bar ? bar.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    };
  }, segLayer);
  // Each case opens the page fresh from a link that holds the view, the way a
  // saved view, a share link or a refresh brings old points back.
  let baseState = null;
  const ready = async () => {
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      if (!document.getElementById('test-hide')) { const st = document.createElement('style'); st.id = 'test-hide'; st.textContent = css; document.head.appendChild(st); }
    }, HIDE_CSS);
  };
  const load = async (segments, multicut) => {
    const st = JSON.parse(JSON.stringify(baseState));
    const L = st.layers.find(l => l.type === 'segmentation');
    const src = typeof L.source === 'string' ? { url: L.source } : { ...L.source };
    if (multicut) src.state = { multicut, merge: { merges: [], autoSubmit: false }, findPath: {} }; else delete src.state;
    L.source = src;
    L.segments = segments;
    await page.goto('about:blank');
    await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(st)), { waitUntil: 'load' });
    await ready();
    if (process.env.POLL) for (let i = 0; i < 16; i++) {
      const v = await Promise.race([page.evaluate(() => { const ml = window.viewer.layerManager.managedLayers.find(l => l.layer && l.layer.constructor.type === 'segmentation'); if (!ml || !ml.layer) return 'no layer'; const g = ml.layer.displayState.segmentationGroupState.value; return [...g.visibleSegments].map(String).join(',') + ' | gc=' + !!(ml.layer.graphConnection && ml.layer.graphConnection.value) + ' | hash=' + /segments/.test(decodeURIComponent(location.hash)); }), new Promise(r => setTimeout(() => r('TIMEOUT'), 3000))]);
      step('poll ' + v);
      await page.waitForTimeout(500);
    }
    await page.waitForFunction((segLayer) => { const ml = eval(segLayer); return !!(ml && ml.layer && ml.layer.graphConnection && ml.layer.graphConnection.value); }, segLayer, { timeout: 60000 });
    await page.waitForTimeout(2500);
  };
  const pressC = async () => {
    step('select layer');
    await page.evaluate(() => {
      const v = window.viewer;
      const seg = v.layerManager.managedLayers.find(l => l.layer && l.layer.constructor.type === 'segmentation');
      if (seg) v.selectedLayer.layer = seg;
      v.element.focus({ preventScroll: true });
    });
    step('selected');
    step('press C');
    await page.keyboard.press('c');
    step('pressed');
    await page.waitForTimeout(900);
    step('waited');
  };
  const exitCut = async () => {
    if (!(await read()).toolOpen) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    if ((await read()).toolOpen) { await page.keyboard.press('c'); await page.waitForTimeout(700); }
  };
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await ready();
    await page.waitForTimeout(3000);
    baseState = await page.evaluate(() => window.viewer.state.toJSON());

    // ── 1. Restored from a saved view or link: points on 111, 222 and 333 shown
    await load(['648518346400000222', '648518346400000333'], POINTS_ON('648518346400000111'));
    const before = await read();
    check('graph connected and the old points restored', before.graph && before.focus === '648518346400000111' && before.points === 3, before);
    await pressC();
    const c1 = await read();
    await shot('1-after-C-restored-points');
    if (EXPECT_BUG) {
      check('CONTROL: C isolates the old cell 111, hiding 222 and 333', c1.toolOpen && c1.isolating && c1.shownInCut.includes('648518346400000111') && !c1.shownInCut.includes('648518346400000222'), c1);
    } else {
      check('cut mode opened', c1.toolOpen, c1);
      check('C keeps the shown cells: no isolation of 111', !c1.isolating && c1.focus === null && c1.points === 0, c1);
      check('the bar says the points were cleared, with Undo', /Cleared 3 points left on another cell\./.test(c1.notice || '') && /Undo/.test(c1.notice || ''), c1.notice);

      // ── 2. Undo
      await page.click('.nge-smo-stale-undo');
      await page.waitForTimeout(700);
      const u = await read();
      await shot('2-after-undo');
      check('Undo puts the 3 points back on 111, and cut mode shows that cell', u.focus === '648518346400000111' && u.points === 3 && u.isolating && u.shownInCut.includes('648518346400000111') && !u.notice, u);
    }
    await exitCut();

    // ── 3. Live: the player hides the cell with points while cut mode is closed
    await load(['648518346400000111', '648518346400000222', '648518346400000333'], POINTS_ON('648518346400000111'));
    await page.evaluate((segLayer) => {
      const g = eval(segLayer).layer.displayState.segmentationGroupState.value;
      const U = [...g.visibleSegments][0].constructor;
      g.visibleSegments.delete(U.parseString('648518346400000111'));
    }, segLayer);
    await page.waitForTimeout(500);
    const h = await read();
    if (EXPECT_BUG) {
      check('CONTROL: hiding 111 is refused while cut mode is closed', h.visible.includes('648518346400000111'), h.visible);
    } else {
      check('hiding the cell with points works while cut mode is closed', !h.visible.includes('648518346400000111') && h.points === 3, h);
      await pressC();
      const c3 = await read();
      await shot('3-after-C-hidden-cell');
      check('C then clears its points and keeps 222 and 333', c3.toolOpen && !c3.isolating && c3.points === 0 && /Cleared 3 points/.test(c3.notice || ''), c3);
    }
    await exitCut();

    // ── 4. Points on a cell that is shown are the player's: kept
    await load(['648518346400000222', '648518346400000333'], POINTS_ON('648518346400000222'));
    await pressC();
    const c4 = await read();
    await shot('4-after-C-points-on-shown-cell');
    check('points on a shown cell are kept, and cut mode shows that cell', c4.toolOpen && c4.focus === '648518346400000222' && c4.points === 3 && c4.isolating && !c4.notice, c4);
    await exitCut();

    // ── 5. A restored cell with no points
    if (!EXPECT_BUG) {
      await load(['648518346400000222', '648518346400000333'], { focusSegment: '648518346400000111', sinks: [], sources: [] });
      const b5 = await read();
      await pressC();
      const c5 = await read();
      check('a leftover cell with no points is cleared silently', b5.focus === '648518346400000111' && c5.toolOpen && !c5.isolating && c5.focus === null && !c5.notice, { before: b5.focus, after: c5 });
      await exitCut();
    }

    check('no page errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) {
    check('test ran to the end', false, String(e).slice(0, 400));
    console.log(await page.evaluate(() => window.viewer.layerManager.managedLayers.map(ml => ({
      name: ml.name, type: ml.layer && ml.layer.constructor.type, url: ml.layer && ml.layer.dataSources.map(d => d.spec.url),
      load: ml.layer && ml.layer.dataSources.map(d => d.loadState ? (d.loadState.error ? String(d.loadState.error) : d.loadState.subsources.map(s => s.subsourceEntry.id + ':' + s.enabled)) : 'loading'),
      messages: ml.layer && ml.layer.dataSources.map(d => [...d.messages].map(m => m.message)),
    }))).catch(x => String(x)));
    await shot('error').catch(() => {});
  }
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
