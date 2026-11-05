// A notification with just a title and a picture, headless (2026-10-24).
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
//         and copy any wide PNG to dist/min/test-wide.png
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    node scripts/notif-picture-only.test.cjs [shots dir]
// Checks: title and picture only lays out like a video note, the title on
// top and the picture across the card below it, no empty column beside it.
// Control: with words too, the picture stays beside the text as before.
// Every server call is answered here; nothing reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3558;
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  await context.route(/cloudfunctions\.net|run\.app/, r => r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' })));
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const IMG = `http://localhost:${PORT}/test-wide.png`;
  const preview = (d) => page.evaluate((d) => document.dispatchEvent(new CustomEvent('nge:preview-notification', { detail: d })), d);
  const measure = () => page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
    const lay = document.querySelector('.nge-notif-detail-layout');
    return { layout: lay ? lay.className : null, card: r('.nge-notif-detail-layout'), title: r('.nge-notif-detail-title'), img: r('.nge-notif-detail-img'), text: r('.nge-notif-detail-text') };
  });
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 90000 });
    await page.addStyleTag({ content: HIDE_CSS });
    await page.waitForTimeout(1500);

    await preview({ title: 'You can now jump straight to your cells from Dataset Switcher', body: '', image_url: IMG });
    await page.waitForSelector('.nge-notif-detail-img', { timeout: 10000 });
    await page.waitForFunction(() => { const i = document.querySelector('.nge-notif-detail-img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const a = await measure();
    console.log(JSON.stringify(a));
    check('title and picture only: the picture-only layout', /picture-only/.test(a.layout || '') && !/has-image/.test(a.layout || ''), a.layout);
    check('the title sits above the picture', a.title && a.img && a.title.bottom <= a.img.y, { title: a.title, img: a.img });
    check('the picture spans the card (nothing beside it)', a.img && a.card && a.img.w >= a.card.w * 0.9, { img: a.img && a.img.w, card: a.card && a.card.w });
    await page.screenshot({ path: path.join(OUT, 'notif-picture-only.png') });

    await page.click('.nge-notif-detail-close');
    await page.waitForTimeout(500);
    await preview({ title: 'With words too', body: 'Some words beside the picture, as notes have always had.', image_url: IMG });
    await page.waitForSelector('.nge-notif-detail-img', { timeout: 10000 });
    await page.waitForTimeout(800);
    const b = await measure();
    check('control: with words the picture stays beside the text', /has-image/.test(b.layout || '') && b.img && b.text && b.text.x >= b.img.x + b.img.w, { layout: b.layout, img: b.img, text: b.text });
    await page.screenshot({ path: path.join(OUT, 'notif-with-words.png') });
  } catch (e) {
    check('the test ran to the end', false, String(e).slice(0, 400));
  } finally {
    await browser.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
