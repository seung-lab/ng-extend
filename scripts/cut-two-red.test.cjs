// The Cut tutorial's "Place 2 red points" and the cut bar's "press G",
// headless (annkri, report 217, 2026-10-23).
// Build:  node scripts/build-prod.js
// Serve:  python -m http.server 3559 --directory dist/min
// Run:    node scripts/cut-two-red.test.cjs [shots dir]
// Checks: with the Cut tutorial's red step on screen and ONE red point down,
// the big "Now press G" banner stays away, the G key does not light, and the
// bar asks for one more red point. With the second point the banner comes.
// Outside a tutorial the bar says "press G" after one point, as before.
// The cut tool's own element is stood in for (the bar reads the tool from
// the page), and the point counts are set on the bar's store: no real cell,
// no server, nothing reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3559;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org|microns-daf\.com/, r => r.abort());
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.addStyleTag({ content: HIDE_CSS });
    await page.waitForTimeout(2000);
    // The cut tool is on (its element, with red active) and the bar reads it.
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'graphene-multicut';
      el.innerHTML = '<div class="activeGroupIndicator"></div>';
      el.style.display = 'none';
      document.body.appendChild(el);
    });
    const bar = () => page.evaluate(() => {
      const banner = document.querySelector('.nge-smo-swap-banner');
      const key = document.querySelector('.nge-smo-swap-hint');
      const hint = [...document.querySelectorAll('.nge-split-merge-overlay .nge-smo-hint')].map(h => h.innerText.trim()).filter(Boolean);
      return { banner: banner ? banner.innerText.replace(/\s+/g, ' ').trim() : null, keyLit: !!(key && key.classList.contains('nge-smo-swap-hint--now')), key: key ? key.innerText.trim() : null, hint };
    });
    const setPoints = (red, blue = 0, wanted) => page.evaluate(([red, blue, wanted]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const s = pinia._s.get('splitMergeOverlay');
      if (wanted !== undefined) s.redWanted = wanted;
      s.updatePointCounts(red, blue);
    }, [red, blue, wanted]);
    const tutorial = (on) => page.evaluate((on) => {
      // A tutorial box on screen, in the Cut tutorial's red step (5, step 4).
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const t = pinia._s.get('tutorial');
      let box = document.getElementById('test-intro-step');
      if (on) {
        t.activeTutorial = 5; t.setTutorialStep(4);
        if (!box) { box = document.createElement('div'); box.id = 'test-intro-step'; box.className = 'introductionStep'; box.style.display = 'none'; document.body.appendChild(box); }
      } else {
        t.activeTutorial = 0;
        if (box) box.remove();
      }
    }, on);
    await page.waitForSelector('.nge-split-merge-overlay', { timeout: 10000 });

    // Outside a tutorial: one red point, "press G" as before.
    await tutorial(false);
    await setPoints(1, 0, 2);   // a stale ask from a tutorial is ignored here
    await page.waitForTimeout(1200);
    let b = await bar();
    check('outside a tutorial, one red point: the bar says press G', b.hint.some(h => /Press G/.test(h)) && b.keyLit && !b.banner, b);

    // The Cut tutorial's red step, which asks for 2.
    await tutorial(true);
    await setPoints(1, 0, 2);
    await page.waitForTimeout(1200);
    b = await bar();
    check('Cut tutorial, 1 of 2 red points: no big press G banner', !b.banner, b);
    check('... the G key does not light', !b.keyLit, b);
    check('... the bar asks for one more red point', b.hint.some(h => /^Ctrl\+Click 1 more red point$/.test(h)), b.hint);
    await page.screenshot({ path: path.join(OUT, 'cut-one-red.png') });

    await setPoints(2, 0, 2);
    await page.waitForTimeout(1200);
    b = await bar();
    check('Cut tutorial, 2 of 2 red points: the banner says press G', /press G to switch to blue/i.test(b.banner || ''), b);
    check('... and the G key lights', b.keyLit, b);
    await page.screenshot({ path: path.join(OUT, 'cut-two-red.png') });

    // The 2D cut asks for 3 or 4: G after 3.
    await setPoints(2, 0, 3);
    await page.waitForTimeout(1200);
    b = await bar();
    check('2D cut, 2 of 3 red points: no banner, one more asked for', !b.banner && b.hint.some(h => /1 more red point/.test(h)), b);
    await setPoints(3, 0, 3);
    await page.waitForTimeout(1200);
    b = await bar();
    check('2D cut, 3 red points: the banner comes', !!b.banner, b);
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
    try { await page.screenshot({ path: path.join(OUT, 'cut-two-red-failed.png') }); } catch (e2) { /* no picture */ }
  } finally {
    await browser.close();
  }
  // "Failed to fetch" is this test blocking every server, not the page.
  const real = errors.filter(e => !/Failed to fetch/.test(e));
  check('no page errors', real.length === 0, real.slice(0, 3));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
