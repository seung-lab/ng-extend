// "Here's a reference" in the Cilia Quest instructions: the lab's three real
// example cells in one view (2026-10-13).
// Build:  DATASET=stroeh_mouse_retina node scripts/build-prod.js
// Serve:  python -m http.server 3488 --directory dist/min
// Run:    node scripts/quest-examples.test.cjs [shots dir]
// Every server call is answered here; nothing reaches production.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');

const BASE = 'http://localhost:3488/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots-examples');
fs.mkdirSync(OUT, { recursive: true });
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

function colourPixels(file, box, kind) {
  const py = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
x0, y0, x1, y1 = [int(v) for v in sys.argv[2:6]]
kind = sys.argv[6]
n = 0
px = im.load()
for y in range(max(0, y0), min(im.height, y1)):
    for x in range(max(0, x0), min(im.width, x1)):
        r, g, b = px[x, y]
        t = (124, 255, 178) if kind == 'green' else (245, 209, 66)   # the layers' own colours
        if abs(r - t[0]) + abs(g - t[1]) + abs(b - t[2]) <= 48: n += 1
print(n)
`;
  return Number(execFileSync('python', ['-I', '-c', py, file, ...box.map(v => String(Math.round(v))), kind]).toString().trim());
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: ['https://global.daf-apis.com', 'https://minnie.microns-daf.com'] };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com\/(segmentation|meshing|info)/, r => r.abort());
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)/, r => r.fulfill(json({ id: 1, email: 't@example.org', name: 'Test Player' })));
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    if (/ewSheetSync/.test(r.request().url())) return r.fulfill(json({ ok: true, you: 'Test Player', rows: [] }));
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }] : [];
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows) }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));

  const page = await context.newPage();
  const errors = [];
  const ready = async (pg) => {
    pg.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    await pg.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await pg.evaluate((css) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const login = pinia._s.get('login');
      if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
      const pb = pinia._s.get('proofreadingBackend');
      if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; } catch (e) {} }
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }, HIDE_CSS);
  };
  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await ready(page);
    await page.waitForTimeout(3000);
    await page.evaluate(() => { const pb = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend'); pb.userId = 'test-user'; });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', shiftKey: true, bubbles: true })));
    await page.waitForSelector('.nge-cl-panel', { timeout: 10000 });
    await page.click('.nge-cl-quests-tab');
    await page.waitForSelector('.nge-aq', { timeout: 10000 });
    await page.click('.nge-aq-info');
    await page.waitForSelector('.nge-aq-help', { timeout: 5000 });
    const links = await page.evaluate(() => [...document.querySelectorAll('.nge-aq-help a')].map(a => [a.textContent.trim(), a.getAttribute('href')]));
    check('the instructions link the guide, the video and the reference', links.length === 3 && links[0][0] === 'this guide' && /^https:\/\/unitc-my\.sharepoint\.com\/:p:\//.test(links[0][1]) && links[1][0] === 'training video' && links[1][1] === 'https://www.youtube.com/watch?v=-l2-R-9vX6o&t=1525s' && links[2][0] === "Here's a reference", links.map(l => [l[0], l[1].slice(0, 60)]));
    const before = await page.evaluate(() => JSON.stringify(window.viewer.state.toJSON()).length);
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), page.click('.nge-aq-help a:has-text("Here\'s a reference")')]);
    check('the reference opens in a new tab and leaves this view alone', !!popup && before === await page.evaluate(() => JSON.stringify(window.viewer.state.toJSON()).length));
    await popup.waitForLoadState('load');
    await ready(popup);
    await popup.waitForFunction(() => { const ml = window.viewer.layerManager.managedLayers.find(l => l.name === 'Basal body'); return !!(ml && ml.layer && ml.layer.localAnnotations); }, null, { timeout: 40000 });
    await popup.waitForTimeout(4000);
    const info = await popup.evaluate(() => {
      const v = window.viewer;
      const ann = (name) => { const ml = v.layerManager.managedLayers.find(l => l.name === name); return ml && ml.layer && ml.layer.localAnnotations ? ml.layer.localAnnotations.toJSON() : null; };
      const colour = (name) => { const ml = v.layerManager.managedLayers.find(l => l.name === name); return ml ? [...ml.layer.annotationDisplayState.color.value].map(x => Math.round(x * 255)) : null; };
      const seg = v.layerManager.managedLayers.find(l => l.layer && String(l.layer.type || '').startsWith('segmentation'));
      const state = v.state.toJSON();
      return {
        layers: v.layerManager.managedLayers.map(l => l.name),
        cc: ann('Cilium centerline'), dc: ann('Daugther centriole'), bb: ann('Basal body'),
        colours: [colour('Cilium centerline'), colour('Daugther centriole'), colour('Basal body')],
        segments: (state.layers.find(l => l.type && l.type.startsWith('segmentation')) || {}).segments,
        position: state.position, selected: state.selectedLayer,
        shaderError: ['Cilium centerline', 'Daugther centriole', 'Basal body'].map(n => String(v.layerManager.managedLayers.find(l => l.name === n).layer.annotationDisplayState.shaderError.value || '')).join(''),
      };
    });
    console.log('layers: ' + JSON.stringify(info.layers) + ' selected: ' + JSON.stringify(info.selected));
    check('the three quest layers, named as the lab names them, in its order', JSON.stringify(info.layers.slice(-3)) === JSON.stringify(['Cilium centerline', 'Daugther centriole', 'Basal body']), info.layers);
    check('the lab\'s centerline is one polyline of nine points', info.cc && info.cc.length === 1 && info.cc[0].type === 'polyline' && info.cc[0].points.length === 9, info.cc && info.cc.map(a => [a.type, a.points && a.points.length]));
    check('its first and last points are the lab\'s', info.cc && JSON.stringify(info.cc[0].points[0]) === JSON.stringify([17404.837890625, 26084.09375, 751.5000610351562]) && JSON.stringify(info.cc[0].points[8]) === JSON.stringify([17548.291015625, 26215.197265625, 737.5]), info.cc && [info.cc[0].points[0], info.cc[0].points[8]]);
    check('three basal bodies and three daughter centrioles, the lab\'s points', info.bb && info.dc && info.bb.length === 3 && info.dc.length === 3 && JSON.stringify(info.bb[0].point) === JSON.stringify([17393.1953125, 26087.73828125, 748.4999389648438]) && JSON.stringify(info.dc[2].point) === JSON.stringify([6681.09716796875, 60326.87109375, 1212.4998779296875]), info.bb && info.bb.map(a => a.point));
    check('each basal body says its status and when to use it', info.bb && info.bb[0].description === 'Example: Cilium annotated. Cilium emerges from the cell, both centrioles and cilium centerline are annotated' && /^Example: No cilium \(BB & DC clear\)\. No cilium, but centrioles are visible/.test(info.bb[1].description) && /^Example: No cilium \(BB & DC unclear; internal centriole pair\)\./.test(info.bb[2].description), info.bb && info.bb.map(a => a.description.slice(0, 70)));
    check('the three example cells are the ones shown', JSON.stringify((info.segments || []).map(String).sort()) === JSON.stringify(['720575940557564614', '720575940561630366', '720575940571019529']), info.segments);
    check('the layers are in the colour key', JSON.stringify(info.colours) === JSON.stringify([[124, 255, 178], [224, 96, 96], [245, 209, 66]]), info.colours);
    check('the shaders compiled', !info.shaderError, info.shaderError);
    const list = await popup.evaluate(() => { const l = document.querySelector('.neuroglancer-annotation-list'); return l ? l.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : null; });
    check('the basal body list is open and reads as the index of the examples', !!list && /Example: Cilium annotated/.test(list) && /No cilium \(BB & DC clear\)/.test(list), list);
    // Whatever floats over the views is put away (the Welcome dialog this
    // made-up player gets, the chat), so the views themselves are measured.
    const putAway = await popup.evaluate(() => {
      const panels = [...document.querySelectorAll('.neuroglancer-rendered-data-panel')];
      const hidden = [];
      for (const panel of panels) {
        const r = panel.getBoundingClientRect();
        for (let gx = 1; gx < 8; gx++) for (let gy = 1; gy < 8; gy++) {
          for (let i = 0; i < 8; i++) {
            const el = document.elementFromPoint(r.left + r.width * gx / 8, r.top + r.height * gy / 8);
            if (!el || panels.some(q => el === q || q.contains(el) || el.contains(q))) break;
            let top = el;
            while (top.parentElement && !panels.some(q => top.parentElement.contains(q))) top = top.parentElement;
            top.style.display = 'none';
            hidden.push(String(top.className || top.id || top.tagName).slice(0, 40));
          }
        }
      }
      return hidden;
    });
    console.log('put away over the views: ' + JSON.stringify(putAway));
    await popup.waitForTimeout(1500);
    const QUEST = ['Cilium centerline', 'Daugther centriole', 'Basal body'];
    const rects = () => popup.evaluate(() => [...document.querySelectorAll('.neuroglancer-rendered-data-panel')].map(p => { const r = p.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
    const show = async (on) => {
      const now = await popup.evaluate(([names, on]) => { const out = []; for (const l of window.viewer.layerManager.managedLayers) if (names.includes(l.name)) { l.setVisible(on); out.push(l.visible); } return out; }, [QUEST, on]);
      // The control is only a control if the layers really went away and came back.
      if (JSON.stringify(now) !== JSON.stringify([on, on, on])) throw new Error('the quest layers did not turn ' + (on ? 'on' : 'off') + ': ' + JSON.stringify(now));
      await popup.waitForTimeout(1500);
    };
    // A colour counted in the views with the quest layers shown, and again
    // with them hidden: the control that says the pixels are the annotations'.
    const measure = async (name, kind) => {
      await popup.screenshot({ path: path.join(OUT, name + '.png') });
      const rect = await rects();
      const shown = rect.map(b => colourPixels(path.join(OUT, name + '.png'), b, kind));
      await show(false);
      await popup.screenshot({ path: path.join(OUT, name + '-control.png') });
      const hidden = rect.map(b => colourPixels(path.join(OUT, name + '-control.png'), b, kind));
      await show(true);
      return { shown, hidden };
    };
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    // As it opens: the lab's own view of the first example, at the tip of the cilium.
    const opening = await measure('examples', 'green');
    check('as it opens, the centerline polyline is drawn (green, against the layers hidden)', sum(opening.shown) > sum(opening.hidden) + 40, opening);
    // The arrows over the list step through the examples, one basal body at a time.
    const position = () => popup.evaluate(() => [...window.viewer.navigationState.position.value].map(v => Math.round(v)));
    const selectedRow = () => popup.evaluate(() => { const r = document.querySelector('.neuroglancer-annotation-list-entry.neuroglancer-annotation-selected'); const d = r && r.querySelector('.neuroglancer-annotation-description'); if (!d) return null; const b = d.getBoundingClientRect(); return { text: d.textContent, lines: Math.round(b.height / parseFloat(getComputedStyle(d).lineHeight)), cut: d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1, size: getComputedStyle(d).fontSize }; });
    const next = async () => { await popup.evaluate(() => { const b = [...document.querySelectorAll('.nge-ann-step button, button.nge-ann-step, .nge-ann-nav button')].pop(); if (b) b.click(); else throw new Error('no step button'); }); await popup.waitForTimeout(1800); };
    const stops = [];
    for (let i = 0; i < 3; i++) { await next(); stops.push({ at: await position(), row: await selectedRow() }); if (i === 0) await popup.screenshot({ path: path.join(OUT, 'example-1.png') }); if (i === 1) await popup.screenshot({ path: path.join(OUT, 'example-2.png') }); if (i === 2) await popup.screenshot({ path: path.join(OUT, 'example-3.png') }); }
    console.log('stops: ' + JSON.stringify(stops));
    check('the arrows step to each example\'s basal body in turn', JSON.stringify(stops.map(s => s.at)) === JSON.stringify([[17393, 26088, 748], [16678, 26097, 610], [6665, 60400, 1203]]), stops.map(s => s.at));
    check('the row stepped to shows its whole description, not one cut line', stops.every(s => s.row && !s.row.cut && s.row.size === '13px' && /^Example: /.test(s.row.text) && s.row.lines >= 2), stops.map(s => s.row && [s.row.lines, s.row.cut, s.row.size]));
    // Back on the first: its basal body, gold, in the section it sits in.
    await next();
    const first = await measure('basal-body', 'gold');
    check('at the first example the basal body is drawn (gold, against the layers hidden)', sum(first.shown) > sum(first.hidden) + 15, first);
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 4));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
