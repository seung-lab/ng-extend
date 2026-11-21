// Community milestones, headless (Ames 2026-11-20).
// Build:  node scripts/build-prod.js
// Serve:  python -m http.server 3583 --directory dist/min
// Run:    node scripts/community-milestone.test.cjs [base url] [screenshot dir]
// Checks, on a local build with the server's two tables answered here:
//   a fresh cells 5,000 milestone (banner true) shows the banner once, with
//     CONGRATS!, the line, the countdown from the live count, and Nurro flying;
//   the X closes it and it does not come back on reload;
//   its notification plays it again when clicked, Nurro too; only the newest
//     milestone notification stays in the feed;
//   a milestone over 7 days old does not play by itself;
//   two recent milestones never queue: one plays, closing it brings no other;
//   a milestone with banner false (inside the week) never pops up;
//   a Lost Fragments count over 500 shows the same banner for Lost Fragments;
//   Dataset Stats shows the next milestone.
// Nothing reaches production: every server call is answered here.
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:3583/';
const SHOTS = process.argv[3] || '';
const HIDE_CSS = '.nge-login-blocker, .nge-login-modal, .nge-mw-blocker { display: none !important; }';
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail).slice(0, 400) : '')); };

const now = () => new Date().toISOString();
const PROGRESS = [{ track: 'cells', count: 5012 }, { track: 'edits', count: 61234 }, { track: 'players', count: 58 }];
const OLD_NOTE = { id: 990000, title: '🎊 Together we are 100 players strong', target_type: 'all', target_id: null, image_url: null, thumbnail_url: null,
  body: 'Congrats! Together we are now 100 players strong. A Pyr community milestone.\n\n[See the celebration again](#nge-milestone=players:100)' };
const NOTE = { id: 990001, title: '🎊 Together we completed 5,000 cells', target_type: 'all', target_id: null, image_url: null, thumbnail_url: null,
  body: 'Congrats! Together we just completed 5,000 cells. A Pyr community milestone. 4,988 to go until 10,000.\n\n[See the celebration again](#nge-milestone=cells:5000)' };

async function open(context, page, fragments) {
  const state = { dimensions: { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] }, position: [38932, 41971, 1222], layout: '3d', layers: [
    { type: 'segmentation', source: { url: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina' }, name: 'stroeh_mouse_retina' }] };
  await page.goto(BASE + '#!' + encodeURIComponent(JSON.stringify(state)), { waitUntil: 'load' });
  await page.waitForFunction(() => { const a = document.querySelector('#app'); return !!(a && a.__vue_app__ && window.viewer); }, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  // Watch for Nurro: flyNurroAcross puts his picture on the page at z-index 99999.
  await page.evaluate(() => {
    window.__nurro = 0;
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === 'IMG' && n.style && n.style.zIndex === '99999') window.__nurro++; })
      .observe(document.body, { childList: true });
  });
  await page.evaluate(({ css, admin }) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const login = pinia._s.get('login');
    if (login && Array.isArray(login.sessions) && login.sessions.length === 0) login.sessions.push({ name: 'Test Player', email: 't@example.org', hostname: 'test' });
    const pb = pinia._s.get('proofreadingBackend');
    if (pb) { try { pb.userId = 'test-user'; pb.userName = 'Test Player'; pb.username = 'testplayer'; if (admin) pb.isAdmin = true; } catch (e) {} }
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }, { css: HIDE_CSS, admin: !!fragments });
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.querySelectorAll('.introductionStep, .introductionStepAnchor, .nge-login-skip').forEach(e => e.remove()));
}
const banner = (page) => page.evaluate(() => {
  const b = document.querySelector('.nge-cm');
  if (!b) return null;
  return { congrats: b.querySelector('.nge-cm-congrats').textContent.trim(), sub: b.querySelector('.nge-cm-sub').textContent.trim(),
    next: b.querySelector('.nge-cm-next').textContent.trim(), frame: !!b.querySelector('.nge-cm-frame svg'),
    top: Math.round(b.getBoundingClientRect().top), center: Math.round(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2), vw: innerWidth };
});

async function run(browser, opts) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript((seen) => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
    try { localStorage.setItem('nge-cilia-training-autoplayed', '1'); localStorage.setItem('pyr-intro-seen', '1');
      // The Datasets Unlocked day flyby (ChatPanel, Nov 20 only) would count as a second Nurro.
      localStorage.setItem('nge-nurro-flyby-at', String(Date.now())); } catch (e) {}
    // When the banner first shows and when each Nurro flies, from page start.
    window.__nurroAt = []; window.__cmAt = null;
    new MutationObserver(() => {
      if (window.__cmAt == null && document.querySelector('.nge-cm')) window.__cmAt = performance.now();
    }).observe(document, { childList: true, subtree: true });
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === 'IMG' && n.style && n.style.zIndex === '99999') window.__nurroAt.push(performance.now()); })
      .observe(document, { childList: true, subtree: true });
  });
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org/, r => r.fulfill(json({})));
  await context.route(/\/auth_info$/, r => r.fulfill(json({ login_url: 'https://global.daf-apis.com/sticky_auth' })));
  await context.route(/minnie\.microns-daf\.com/, r => r.abort());
  const me = { id: 1, email: 't@example.org', name: 'Test Player', permissions_v2: { 'stroeh-mouse-retina': ['view', 'edit'], pinky100: ['view', 'edit'] } };
  await context.route(/sticky_auth\/api\/v1\/user\/me|\/auth\/api\/v1\/user\/(me|cache)|\/auth\/api\/v1\/user\/\d+\/permissions/, r => r.fulfill(json(me)));
  await context.route(/docs\.google\.com/, r => r.fulfill({ status: 200, contentType: 'text/csv', body: 'Segment ID\n' }));
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    // Lost Fragments' count: 512 done by everyone.
    if (input.action === 'fragments.list') return r.fulfill(json({ ok: true, data: { mine: [], others: Array.from({ length: opts.fragments || 0 }, (_, i) => 'f' + i) } }));
    if (input.table === 'notifications' && opts.notes) return r.fulfill(json({ status: 200, ok: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.notes.map((n, i) => ({ ...n, send_at: new Date(Date.now() - i * 3600e3).toISOString(), created_at: now() }))) }));
    const rows = input.table === 'users' ? [{ id: 'test-user', display_name: 'Test Player', username: 'testplayer', middleauth_email: 't@example.org' }] : [];
    return r.fulfill(json({ status: 200, ok: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(/pgrst\.object/.test(String(input.accept || '')) ? (rows[0] || null) : rows), data: { invited: true } }));
  });
  const asked = { progress: 0, milestones: 0 };
  await context.route(/supabase\.co/, r => {
    const u = r.request().url();
    if (/\/community_progress\b/.test(u)) { asked.progress++; return r.fulfill(json(PROGRESS)); }
    if (/\/community_milestones\b/.test(u)) { asked.milestones++; return r.fulfill(json(opts.milestones)); }
    return r.fulfill(json([]));
  });
  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  return { context, page, asked };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    // ── 1. A fresh milestone with its banner ──
    {
      const { context, page, asked } = await run(browser, { milestones: [{ track: 'cells', value: 5000, reached_at: now(), banner: true }], notes: [NOTE, OLD_NOTE] });
      await open(context, page);
      await page.waitForSelector('.nge-cm', { timeout: 15000 }).catch(() => {});
      check('server tables read', asked.progress > 0 && asked.milestones > 0, asked);
      // Nurro waits for CONGRATS! to finish building in (2.7 s after the banner).
      await page.waitForTimeout(1800);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cm-building.png` });
      await page.waitForTimeout(1600);
      const b = await banner(page);
      check('banner shows', !!b, b);
      check('CONGRATS! headline', b && b.congrats === 'CONGRATS!', b && b.congrats);
      check('line', b && b.sub === 'Together we just completed 5,000 cells.', b && b.sub);
      check('countdown from the live count', b && b.next === '4,988 to go until 10,000.', b && b.next);
      check('hologram frame drawn', b && b.frame);
      check('centered on the screen', b && Math.abs(b.center - b.vw / 2) <= 2, b && [b.center, b.vw]);
      const fl = await page.evaluate(() => ({ at: window.__cmAt, nurro: window.__nurroAt.map(t => Math.round(t - window.__cmAt)) }));
      check('Nurro not before CONGRATS! is in', fl.at != null && fl.nurro.every(d => d >= 2400), fl);
      check('Nurro flew across after it, once', fl.nurro.filter(d => d >= 2400 && d <= 4500).length === 1, fl);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cm-banner.png` });
      await page.click('.nge-cm-close');
      await page.waitForTimeout(1000);
      check('X closes it', !(await banner(page)));
      check('remembered as seen', JSON.parse(await page.evaluate(() => localStorage.getItem('nge_community_milestones_seen_v1')) || '{}').cells === 5000);

      // Dataset Stats: the next milestone.
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('nge:open-dataset-stats', { detail: { panel: true } })));
      await page.waitForTimeout(1500);
      const ds = await page.evaluate(() => { const e = document.querySelector('.nge-dsp-milestone'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
      // Edits are nearest their next one here (61% of the way, cells just passed 5,000).
      check('Dataset Stats next milestone', ds === 'Next Pyr milestone: 100,000 edits, everyone together. 38,766 to go.', ds);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cm-dataset-stats.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // The notification brings it back, quietly.
      const nurroBefore = await page.evaluate(() => window.__nurro);
      await page.evaluate(async () => {
        const pb = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend');
        await pb.loadNotifications();
        document.dispatchEvent(new CustomEvent('nge:open-notification', { detail: {} }));
      });
      await page.waitForTimeout(1500);
      console.log('  notes in store', await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('proofreadingBackend').notifications.length));
      const card = await page.evaluate(() => { const c = [...document.querySelectorAll('.nge-notif-card')].find(c => /5,000 cells/.test(c.textContent)); return c ? { milestone: c.classList.contains('nge-notif-card--milestone'), text: c.textContent.replace(/\s+/g, ' ').trim() } : null; });
      check('notification card, milestone style', card && card.milestone, card);
      const msCards = await page.evaluate(() => [...document.querySelectorAll('.nge-notif-card')].filter(c => /Together we/.test(c.textContent)).length);
      check('only the newest milestone notification is kept', msCards === 1, msCards);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cm-notification.png` });
      await page.evaluate(() => [...document.querySelectorAll('.nge-notif-card')].find(c => /5,000 cells/.test(c.textContent)).click());
      await page.waitForTimeout(3600);
      const back = await banner(page);
      check('notification brings it back', back && back.sub === 'Together we just completed 5,000 cells.', back);
      check('panel closed behind it', await page.evaluate(() => { const p = document.querySelector('.nge-notif-panel'); return !p || p.offsetParent === null; }));
      check('clicking it plays it, Nurro too', (await page.evaluate(() => window.__nurro)) === nurroBefore + 1, await page.evaluate(() => window.__nurro));
      await page.click('.nge-cm-close');
      await page.waitForTimeout(500);

      // Reload: seen, so no banner.
      await open(context, page);
      await page.waitForTimeout(3000);
      check('not again after reload', !(await banner(page)));
      await context.close();
    }
    // ── 1b. Over 7 days old: waits in the notification, does not play ──
    {
      const { context, page } = await run(browser, { milestones: [{ track: 'cells', value: 5000, reached_at: new Date(Date.now() - 8 * 864e5).toISOString(), banner: true }] });
      // The real table is asked for the last 7 days only; answer what it would.
      await context.route(/\/community_milestones/, r => { const u = decodeURIComponent(r.request().url()); const since = (u.match(/reached_at=gte\.([^&]+)/) || [])[1]; return r.fulfill(json(since && new Date(since) > new Date(Date.now() - 8 * 864e5) ? [] : [{ track: 'cells', value: 5000, reached_at: new Date(Date.now() - 8 * 864e5).toISOString(), banner: true }])); });
      await open(context, page);
      await page.waitForTimeout(5000);
      check('over 7 days old does not play by itself', !(await banner(page)), await banner(page));
      await context.close();
    }
    // ── 1c. Two recent ones: one plays, nothing queues behind it ──
    {
      const { context, page } = await run(browser, { milestones: [
        { track: 'edits', value: 100000, reached_at: now(), banner: true },
        { track: 'cells', value: 5000, reached_at: new Date(Date.now() - 3 * 864e5).toISOString(), banner: true }] });
      await open(context, page);
      await page.waitForSelector('.nge-cm', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const first = await banner(page);
      check('the newest plays', first && first.sub === 'Together we just made 100,000 edits.', first && first.sub);
      await page.click('.nge-cm-close');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      // Read the tables again, as the 20 minute timer does.
      await open(context, page);
      await page.waitForTimeout(4000);
      check('the older one does not queue up after', !(await banner(page)));
      await context.close();
    }
    // ── 2. A milestone inside the week (banner false): notification only ──
    {
      const { context, page } = await run(browser, { milestones: [{ track: 'edits', value: 100000, reached_at: now(), banner: false }] });
      await open(context, page);
      await page.waitForTimeout(5000);
      check('banner false never pops up', !(await banner(page)));
      await context.close();
    }
    // ── 3. Lost Fragments through the same banner ──
    {
      const { context, page } = await run(browser, { milestones: [], fragments: 512 });
      await open(context, page, true);
      await page.waitForSelector('.nge-cm', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2600);
      const b = await banner(page);
      check('Lost Fragments 500 banner', b && b.sub === 'Together we just completed 500 Lost Fragments.' && b.next === '488 to go until 1,000.', b);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cm-fragments.png` });
      await context.close();
    }
    // ── 4. Phone width ──
    {
      const { context, page } = await run(browser, { milestones: [{ track: 'players', value: 100, reached_at: now(), banner: true }] });
      await page.setViewportSize({ width: 390, height: 800 });
      await open(context, page);
      await page.waitForSelector('.nge-cm', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2600);
      const fit = await page.evaluate(() => { const b = document.querySelector('.nge-cm'); if (!b) return null; const r = b.getBoundingClientRect(), c = b.querySelector('.nge-cm-congrats').getBoundingClientRect(); return { l: r.left, r: r.right, cl: c.left, cr: c.right, vw: innerWidth, sub: b.querySelector('.nge-cm-sub').textContent.trim() }; });
      check('fits a phone', fit && fit.l >= 0 && fit.r <= fit.vw && fit.cl >= fit.l && fit.cr <= fit.r, fit);
      check('players line', fit && fit.sub === 'Together we are now 100 players strong.', fit && fit.sub);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cm-phone.png` });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter(r => !r).length;
  console.log(`${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
