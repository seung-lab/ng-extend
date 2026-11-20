// Glia Split Training (tutorial 16), headless, against the real Retina graph
// (2026-11-20). Uses this machine's CAVE token for READS only: Find Path and
// the cut preview. Every edit endpoint (split, merge) is blocked here, and the
// test fails if the page ever asks for one. Pyr's own servers are stubbed.
// Build:  node scripts/build-prod.js      Serve dist/min on 3495
// Run:    node scripts/glia-split-training.test.cjs [shots dir]
const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:3495/';
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || path.join(__dirname, 'shots-glia-split');
fs.mkdirSync(OUT, { recursive: true });
const tok = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cloudvolume/secrets/cave-secret.json'), 'utf8')).token;
const results = []; const edits = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript((tok) => {
    const apps = []; for (const h of ['https://global.daf-apis.com', 'https://minnie.microns-daf.com']) apps.push(h, h + '/', h + '/segmentation', h + '/segmentation/', h + '/meshing', h + '/meshing/');
    localStorage.setItem('auth_token_v2_https://global.daf-apis.com/sticky_auth', JSON.stringify({ tokenType: 'Bearer', accessToken: tok, url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps }));
    for (const k of ['nge-cilia-training-autoplayed', 'nge-cilia-quest-intro-seen', 'pyr-intro-seen']) localStorage.setItem(k, '1');
  }, tok);
  await context.route(/cloudfunctions\.net|run\.app|supabase\.co|brain-wire-test\.org/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // No edit may leave this browser.
  await context.route(/\/(split|merge|undo|redo)\?|\/graph\/(merge|split)\?/, r => { edits.push(r.request().url()); return r.abort(); });
  const page = await context.newPage();
  page.on('console', m => { if (/glia|tutorial/i.test(m.text())) console.log('  [page]', m.text().slice(0, 160)); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.viewer, null, { timeout: 90000 });
  await wait(15000);
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });
  const box = () => page.evaluate(() => { const b = document.querySelector('.introductionStep'); return b ? { title: (b.querySelector('h1,h2,h3,.title')?.textContent || '').trim(), text: b.textContent.replace(/\s+/g, ' ').slice(0, 300), fb: (b.querySelector('[data-nge-gs-feedback]')?.textContent || '').trim() } : null; });
  const next = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll('.introductionStep button.next')].pop(); b && b.click(); }); await wait(1500); };
  const center = async () => page.evaluate(() => {
    const panels = [...document.querySelectorAll('.neuroglancer-rendered-data-panel')].filter(el => !el.classList.contains('nge-3d-panel') && el.offsetWidth > 0);
    const p = panels.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0]; const r = p.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // Hover until the viewer knows the pair is under the mouse, as a player's
  // mouse would, then Ctrl+click.
  const under = () => page.evaluate(() => { const l = window.viewer.layerManager.managedLayers.find(x => x.layer?.constructor?.type === 'segmentation'); return String(l.layer.displayState.segmentSelectionState?.value ?? ''); });
  const ctrlClickCenter = async () => {
    // Search outward from the middle of the 2D view for the pair, as a
    // player clicks on the blue they see, then Ctrl+click there.
    const c = await center();
    const spots = [[0, 0]];
    for (const r of [10, 20, 30, 45, 60]) for (let a = 0; a < 8; a++) spots.push([Math.round(r * Math.cos(a * Math.PI / 4)), Math.round(r * Math.sin(a * Math.PI / 4))]);
    let at = [c.x, c.y];
    found: for (let round = 0; round < 6; round++) {
      for (const [dx, dy] of spots) { await page.mouse.move(c.x + dx, c.y + dy); await wait(250); if ((await under()) === '720575940552463731') { at = [c.x + dx, c.y + dy]; break found; } }
      await wait(5000);
    }
    await page.keyboard.down('Control'); await page.mouse.click(at[0], at[1]); await page.keyboard.up('Control'); await wait(1500);
  };

  const key = async k => { const c = await center(); await page.mouse.move(c.x, c.y); await page.keyboard.press(k); await wait(800); };
  const goSoma = w => page.evaluate(w => { const el = document.createElement('button'); el.dataset.ngeGsGo = w; document.body.appendChild(el); el.click(); el.remove(); }, w);

  await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:tutorial-start', { detail: { id: 16 } })));
  await wait(3000);
  let b = await box(); check('the training opens', /Glia Split Training/.test(b?.text || ''), b?.title); await shot('0-intro');
  await next(); await wait(30000);
  const shownNow = () => page.evaluate(() => { const l = window.viewer.layerManager.managedLayers.find(x => x.layer?.constructor?.type === 'segmentation'); return [...l.layer.displayState.segmentationGroupState.value.visibleSegments].map(String); });
  b = await box(); check('the glia box thanks Nseraf', /A M[uü]ller glia/.test(b?.text || '') && /Nseraf/.test(b?.text || ''));
  check("Nseraf's glia is shown", (await shownNow()).join() === '720575940558455015', (await shownNow()).join(' '));
  await shot('1-glia');
  await next(); await wait(30000);
  b = await box(); check('the neuron box', /A neuron, for comparison/.test(b?.text || ''));
  check("the gallery's RBC is shown, by its current root", (await shownNow()).join() === '720575940549637981', (await shownNow()).join(' '));
  await shot('1b-bipolar');
  await next(); await wait(30000);
  b = await box(); check('the fused pair box', /Two glia, one segment/.test(b?.text || '')); await shot('2-pair');
  await next(); await wait(4000);
  check('Next waits for Find Path', await page.evaluate(() => window.__ngeStepPending === true));
  const fpNow = () => page.evaluate(() => { const l = window.viewer.layerManager.managedLayers.find(x => x.layer?.constructor?.type === 'segmentation'); const f = l.layer.graphConnection.value.state.findPathState; return { src: !!f.source.value, tgt: !!f.target.value, under: String(l.layer.displayState.segmentSelectionState?.value ?? '') }; });
  await wait(8000);
  console.log('  under at A, first look', JSON.stringify(await page.evaluate(() => { const c = document.querySelector('.neuroglancer-rendered-data-panel'); return { pos: Array.from(window.viewer.navigationState.position.value).map(Math.round), zoom: window.viewer.navigationState.zoomFactor.value }; })));
  await goSoma('b'); await wait(8000); await goSoma('a'); await wait(8000);
  await key('f'); await ctrlClickCenter();
  console.log('  after A', JSON.stringify(await fpNow()));
  await shot('3a-at-A');
  await goSoma('b'); await wait(10000); await ctrlClickCenter();
  console.log('  after B', JSON.stringify(await fpNow()));
  await key('Enter');
  await page.waitForFunction(() => /Found it/.test(document.querySelector('.introductionStep [data-nge-gs-feedback]')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  b = await box(); check('Find Path is seen', /Found it/.test(b?.fb || ''), b?.fb); await shot('3-path');
  await key('Escape');
  await next(); await next(); await wait(2000);
  b = await box(); check('points box', /Red on A, blue on B/.test(b?.text || ''));
  await page.evaluate(() => { const l = window.viewer.layerManager.managedLayers.find(x => x.layer?.constructor?.type === 'segmentation'); window.viewer.selectedLayer.layer = l; });
  await goSoma('a'); await wait(8000); await key('c'); await wait(1500); await ctrlClickCenter();
  await key('g'); await goSoma('b'); await wait(8000); await ctrlClickCenter();
  await wait(1500);
  b = await box(); check('red and blue are seen', /Both sides are marked/.test(b?.fb || ''), b?.fb); await shot('4-points');
  await next(); await wait(1000);
  await page.evaluate(() => document.querySelector('.graphene-multicut .nge-cut-preview-button')?.click());
  await page.waitForFunction(() => /There it is/.test(document.querySelector('.introductionStep [data-nge-gs-feedback]')?.textContent || ''), null, { timeout: 90000 }).catch(() => {});
  b = await box(); check('Preview is seen', /There it is/.test(b?.fb || ''), b?.fb); await wait(5000); await shot('5-preview');
  // Submit, by the icon and by Enter: neither may reach the server.
  await page.evaluate(() => { const i = [...document.querySelectorAll('.neuroglancer-icon[title="Submit multicut"]')].pop(); i && i.click(); });
  await key('Enter'); await wait(4000);
  const said = await page.evaluate(() => document.body.innerText.includes('Glia Split Training never cuts'));
  check('Submit is refused in training, and says so', said);
  check('no edit request left the page', edits.length === 0, edits.join(' '));
  await shot('6-refused');
  await next(); await next(); await wait(2000);
  b = await box(); check('the last box', /In the real quest/.test(b?.text || ''));
  const left = await page.evaluate(() => { const l = window.viewer.layerManager.managedLayers.find(x => x.layer?.constructor?.type === 'segmentation'); const s = l.layer.graphConnection.value.state; return s.multicutState.sinks.size + s.multicutState.sources.size + (s.findPathState.source.value ? 1 : 0); });
  check('no points or path are left for real play', left === 0, String(left));
  await shot('7-finale');
  await next(); await wait(2000);
  check('cutting works again once the training is closed', await page.evaluate(() => !window.__ngeNoCutSubmit()));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
