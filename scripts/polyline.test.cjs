// Polyline annotations, headless (ported from the lab's neuroglancer, 2026-10-13).
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3488 --directory dist/min
// Run:    node scripts/polyline.test.cjs [shots dir]
// Checks, on a retina build with every server call answered here:
//   1. a share link that holds a polyline (the lab's JSON) loads and draws
//      (counted in pixels, with a before picture as the control);
//   2. the tool: the button, Ctrl+click points, Backspace, Enter, Esc, the hint;
//   3. picking: hovering a polyline, a point and a line each finds its own;
//   4. the view saves and reloads the polyline unchanged.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');

const BASE = 'http://localhost:3488/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots-polyline');
fs.mkdirSync(OUT, { recursive: true });
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

// Green pixels in a region of a screenshot (PIL), so drawing is measured.
function greenPixels(file, box) {
  const py = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
x0, y0, x1, y1 = [int(v) for v in sys.argv[2:6]]
n = 0
px = im.load()
for y in range(max(0, y0), min(im.height, y1)):
    for x in range(max(0, x0), min(im.width, x1)):
        r, g, b = px[x, y]
        if g > 170 and r < 110 and b < 110: n += 1
print(n)
`;
  return Number(execFileSync('python', ['-I', '-c', py, file, ...box.map(v => String(Math.round(v)))]).toString().trim());
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  // No real server is reached (one 401 with the fake token wedges the sign-in).
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  await context.route(/supabase\.co/, r => r.fulfill(json([])));

  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  const errors = [], glErrors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  // A slow readback under the software renderer is a note, not an error.
  page.on('console', m => { const t = m.text(); if (/GPU stall due to ReadPixels/.test(t)) return; if (/shader|GLSL|ERROR: \d+:\d+|INVALID_|GL_INVALID/i.test(t) && (m.type() === 'error' || m.type() === 'warning')) glErrors.push(t.slice(0, 300)); });

  const ready = async () => {
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; } catch (e) {} }
      if (!document.getElementById('test-hide')) { const st = document.createElement('style'); st.id = 'test-hide'; st.textContent = css; document.head.appendChild(st); }
    }, HIDE_CSS);
  };
  // Anything floating over a point of the views is put away, so a click lands on the view.
  const clearAt = async (x, y) => page.evaluate(([x, y]) => {
    const hidden = [];
    const panel = document.querySelector('.neuroglancer-rendered-data-panel');
    for (let i = 0; i < 12; i++) {
      const el = document.elementFromPoint(x, y);
      if (!el || !panel) break;
      // The view itself, or something the view sits inside: nothing is over it.
      if (el === panel || panel.contains(el) || el.contains(panel)) break;
      // The largest thing over the view that does not hold the view.
      let top = el;
      while (top.parentElement && !top.parentElement.contains(panel)) top = top.parentElement;
      top.style.display = 'none';
      hidden.push(String(top.className || top.id || top.tagName).slice(0, 50));
    }
    return hidden;
  }, [x, y]);
  const layerInfo = () => page.evaluate(() => {
    const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'Cilium Centerline');
    if (!ml || !ml.layer) return null;
    const anns = ml.layer.localAnnotations ? ml.layer.localAnnotations.toJSON() : [];
    return { tool: ml.layer.tool && ml.layer.tool.value ? ml.layer.tool.value.toJSON() : null, shaderError: String((ml.layer.annotationDisplayState.shaderError && ml.layer.annotationDisplayState.shaderError.value) || ''), anns: anns.map(a => ({ type: a.type, id: a.id, n: a.points ? a.points.length : undefined, points: a.points, point: a.point, pointA: a.pointA, pointB: a.pointB })) };
  });
  const picked = () => page.evaluate(() => ({ id: window.viewer.mouseState.pickedAnnotationId || null, part: window.viewer.mouseState.pickedOffset, type: window.viewer.mouseState.pickedAnnotationType }));
  const hint = () => page.evaluate(() => { const h = document.querySelector('.nge-polyline-hint'); return h ? h.innerText.replace(/\s+/g, ' ').trim() : null; });

  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await ready();
    await page.waitForTimeout(3000);

    // ── 1. A share link with a polyline in it, the lab's JSON ──────────────
    const base = await page.evaluate(() => window.viewer.state.toJSON());
    const center = [37166, 16688, 1973];
    const labPolyline = { type: 'polyline', id: 'lab-polyline-1', points: [[37000, 16600, 1973], [37100, 16760, 1973], [37250, 16640, 1973], [37350, 16800, 1973]] };
    const stateWith = (annotations) => ({
      ...base, position: center, layout: 'xy-3d',
      selectedLayer: { layer: 'Cilium Centerline', visible: true },
      layers: [...(base.layers || []).filter(l => l.type !== 'annotation'), {
        type: 'annotation', source: 'local://annotations', name: 'Cilium Centerline', tab: 'annotations',
        annotationColor: '#00ff00', annotations,
        shader: 'void main() {\n  setColor(defaultColor());\n  setLineWidth(6.0);\n  setEndpointMarkerSize(10.0);\n}\n',
      }],
    });
    const load = async (state) => {
      await page.evaluate((s) => { window.location.hash = '#!' + encodeURIComponent(JSON.stringify(s)); }, state);
      await page.waitForFunction(() => { const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'Cilium Centerline'); return !!(ml && ml.layer && ml.layer.localAnnotations); }, null, { timeout: 30000 });
      await page.waitForTimeout(2500);
    };
    // Control: the same view with an empty layer.
    await load(stateWith([]));
    const measure = () => page.evaluate(() => { const p = document.querySelector('.neuroglancer-rendered-data-panel'); const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    // Putting the overlays away moves the views, so clear, measure, and clear again.
    for (let pass = 0; pass < 2; pass++) {
      const r0 = await measure();
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.45, 0.55], [0.6, 0.35], [0.75, 0.6], [0.2, 0.75], [0.35, 0.85], [0.6, 0.8]]) {
        const h = await clearAt(r0.x + fx * r0.w, r0.y + fy * r0.h);
        if (h.length) console.log('  put away: ' + JSON.stringify(h));
      }
      await page.waitForTimeout(400);
    }
    const panelRect = await measure();
    console.log('2D panel: ' + JSON.stringify(panelRect));
    const box2d = [panelRect.x, panelRect.y, panelRect.x + panelRect.w, panelRect.y + panelRect.h];
    await page.screenshot({ path: path.join(OUT, '1-control.png') });
    const before = greenPixels(path.join(OUT, '1-control.png'), box2d);
    await load(stateWith([labPolyline]));
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.6, 0.35]]) await clearAt(panelRect.x + fx * panelRect.w, panelRect.y + fy * panelRect.h);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, '2-lab-polyline.png') });
    const after = greenPixels(path.join(OUT, '2-lab-polyline.png'), box2d);
    let info = await layerInfo();
    check('a share link with a polyline loads as one polyline of four points', info && info.anns.length === 1 && info.anns[0].type === 'polyline' && info.anns[0].n === 4, info && info.anns.map(a => [a.type, a.n]));
    check('the polyline is drawn in the 2D view (green pixels, the empty layer as control)', before < 500 && after > before + 600, { before, after });
    check('the annotation shader compiled', info && !info.shaderError, info && info.shaderError);

    // Hovering the loaded polyline finds it. Its second point, on screen:
    const zoom = Number(base.crossSectionScale) || 2;
    console.log('voxels per pixel: ' + zoom);
    const toScreen = (p) => [panelRect.x + panelRect.w / 2 + (p[0] - center[0]) / zoom, panelRect.y + panelRect.h / 2 + (p[1] - center[1]) / zoom];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hover = async ([x, y]) => { await page.mouse.move(x - 3, y - 3); await page.mouse.move(x, y); await page.waitForTimeout(700); return picked(); };
    const m12 = mid(toScreen(labPolyline.points[1]), toScreen(labPolyline.points[2]));
    const m23 = mid(toScreen(labPolyline.points[2]), toScreen(labPolyline.points[3]));
    let pk = await hover(m12);
    check('hovering the loaded polyline (its second line) picks it', pk.id === 'lab-polyline-1', pk);
    pk = await hover(m23);
    check('hovering its third line picks the same polyline', pk.id === 'lab-polyline-1', pk);
    pk = await hover([panelRect.x + panelRect.w * 0.5, panelRect.y + panelRect.h * 0.9]);
    check('hovering empty space picks nothing', pk.id === null, pk);

    // ── 2. The tool ───────────────────────────────────────────────────────
    await load(stateWith([]));
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.45, 0.55], [0.6, 0.35], [0.75, 0.6], [0.2, 0.75]]) await clearAt(panelRect.x + fx * panelRect.w, panelRect.y + fy * panelRect.h);
    const rect2 = await page.evaluate(() => { const p = document.querySelector('.neuroglancer-rendered-data-panel'); const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const at = (fx, fy) => [rect2.x + fx * rect2.w, rect2.y + fy * rect2.h];
    const button = await page.$('.neuroglancer-annotation-toolbox .nge-polyline-tool');
    check('the polyline button is in the toolbox', !!button, await page.evaluate(() => [...document.querySelectorAll('.neuroglancer-annotation-toolbox .neuroglancer-icon')].map(e => e.title).filter(Boolean)));
    if (button) {
      await button.click();
      const tb = await page.locator('.neuroglancer-annotation-toolbox').boundingBox();
      if (tb) await page.screenshot({ path: path.join(OUT, '3-toolbox.png'), clip: { x: Math.max(0, tb.x - 6), y: Math.max(0, tb.y - 6), width: Math.min(1400 - tb.x, tb.width + 12), height: tb.height + 12 } });
    }
    info = await layerInfo();
    check('pressing it arms the polyline tool', info && info.tool === 'annotatePolyline', info && info.tool);
    const ctrlClick = async ([x, y]) => { await page.mouse.move(x, y); await page.waitForTimeout(120); await page.keyboard.down('Control'); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Control'); await page.waitForTimeout(250); };
    const P1 = at(0.25, 0.3), P2 = at(0.42, 0.52), P3 = at(0.58, 0.34), P4 = at(0.72, 0.58);
    await ctrlClick(P1);
    check('the first Ctrl+click starts a polyline and shows the hint', /1 point\b/.test(String(await hint())), await hint());
    await ctrlClick(P2); await ctrlClick(P3); await ctrlClick(P4);
    check('each Ctrl+click adds a point', /4 points/.test(String(await hint())), await hint());
    await page.mouse.move(...at(0.8, 0.7)); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '4-placing.png') });
    await page.keyboard.press('Backspace'); await page.waitForTimeout(250);
    check('Backspace takes the last point back', /3 points/.test(String(await hint())), await hint());
    await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    info = await layerInfo();
    check('Enter finishes: one polyline of three points, the hint goes', info && info.anns.length === 1 && info.anns[0].type === 'polyline' && info.anns[0].n === 3 && (await hint()) === null, info && info.anns.map(a => [a.type, a.n]));
    const madeId = info && info.anns[0] && info.anns[0].id;
    // Esc gives a polyline up.
    await ctrlClick(at(0.2, 0.75)); await ctrlClick(at(0.35, 0.85));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    info = await layerInfo();
    check('Esc gives a polyline up: still one annotation, no hint', info && info.anns.length === 1 && (await hint()) === null, info && info.anns.length);
    // Enter with a single point keeps nothing.
    await ctrlClick(at(0.2, 0.75));
    await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    info = await layerInfo();
    check('Enter after one point keeps nothing', info && info.anns.length === 1 && (await hint()) === null, info && info.anns.length);

    // ── 3. Picking, with a point and a line beside the polyline ──────────
    pk = await hover(mid(P1, P2));
    check('hovering the drawn polyline picks it', pk.id === madeId, pk);
    await page.click('.neuroglancer-annotation-toolbox [title="Annotate point"]');
    const PT = at(0.3, 0.7);
    await ctrlClick(PT);
    await page.click('.neuroglancer-annotation-toolbox [title="Annotate line"]');
    const LA = at(0.55, 0.7), LB = at(0.75, 0.82);
    await ctrlClick(LA); await ctrlClick(LB);
    info = await layerInfo();
    const pointAnn = info.anns.find(a => a.type === 'point'), lineAnn = info.anns.find(a => a.type === 'line');
    check('a point and a line can still be placed', !!pointAnn && !!lineAnn && info.anns.length === 3, info.anns.map(a => a.type));
    await page.mouse.move(...at(0.9, 0.2)); await page.waitForTimeout(300);
    pk = await hover(PT);
    check('hovering the point picks the point', pointAnn && pk.id === pointAnn.id, pk);
    pk = await hover(mid(LA, LB));
    check('hovering the line picks the line', lineAnn && pk.id === lineAnn.id, pk);
    pk = await hover(mid(P2, P3));
    check('hovering the polyline still picks the polyline', pk.id === madeId, pk);
    await page.mouse.move(...at(0.9, 0.2)); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '5-all-three.png') });
    const list = await page.locator('.neuroglancer-annotation-list').boundingBox().catch(() => null);
    if (list) await page.screenshot({ path: path.join(OUT, '6-list.png'), clip: { x: Math.max(0, list.x - 6), y: Math.max(0, list.y - 90), width: Math.min(1400 - list.x, list.width + 12), height: Math.min(900 - list.y + 90, list.height + 100) } });

    // ── 4. Save and reload ────────────────────────────────────────────────
    const saved = await page.evaluate(() => window.viewer.state.toJSON());
    const savedLayer = saved.layers.find(l => l.name === 'Cilium Centerline');
    const savedPoly = savedLayer.annotations.find(a => a.type === 'polyline');
    check('the saved view holds the polyline as {type: "polyline", points: [...]}', savedPoly && Array.isArray(savedPoly.points) && savedPoly.points.length === 3 && savedPoly.points.every(p => Array.isArray(p) && p.length === 3), savedPoly && { keys: Object.keys(savedPoly), first: savedPoly.points[0] });
    await page.evaluate((s) => { window.location.hash = '#!' + encodeURIComponent(JSON.stringify(s)); }, { ...saved, layers: saved.layers.map(l => l.name === 'Cilium Centerline' ? { ...l, name: 'Cilium Centerline' } : l) });
    await page.waitForTimeout(3000);
    info = await layerInfo();
    const again = info && info.anns.find(a => a.type === 'polyline');
    check('reloading the saved view gives the same polyline', again && JSON.stringify(again.points) === JSON.stringify(savedPoly.points) && info.anns.length === 3, info && info.anns.map(a => [a.type, a.n]));

    // ── 5. The other shapes still compile and draw beside a polyline ──────
    // (every shape's shader now carries the polyline's setters too).
    const withShapes = { ...saved, layers: saved.layers.map(l => l.name !== 'Cilium Centerline' ? l : { ...l, annotations: [...l.annotations,
      { type: 'axis_aligned_bounding_box', id: 'box-1', pointA: [36800, 16900, 1965], pointB: [36950, 17000, 1985] },  // a box with depth, so the slice cuts it
      { type: 'ellipsoid', id: 'ell-1', center: [37400, 16300, 1973], radii: [60, 60, 10] }] }) };
    await page.evaluate((s) => { window.location.hash = '#!' + encodeURIComponent(JSON.stringify(s)); }, withShapes);
    await page.waitForTimeout(3000);
    info = await layerInfo();
    check('a box and an ellipsoid load beside the polyline, and the shader still compiles', info && info.anns.length === 5 && !info.shaderError, info && { types: info.anns.map(a => a.type), shaderError: info.shaderError });
    await page.mouse.move(panelRect.x + panelRect.w * 0.9, panelRect.y + panelRect.h * 0.1); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '7-every-shape.png') });
    const toScreen2 = (p) => [rect2.x + rect2.w / 2 + (p[0] - center[0]) / zoom, rect2.y + rect2.h / 2 + (p[1] - center[1]) / zoom];
    pk = await hover(toScreen2([36875, 16900, 1973]));
    check('hovering the box edge picks the box', pk.id === 'box-1', pk);
    pk = await hover(mid(P1, P2));
    check('and the polyline is still picked with every shape present', pk.id === madeId, pk);
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'fail.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 4));
  check('no shader or WebGL errors in the console', glErrors.length === 0, glErrors.slice(0, 4));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
