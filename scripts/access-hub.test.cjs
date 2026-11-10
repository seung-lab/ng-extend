// The Access page, "?triage=access" (Ames 2026-11-09), headless.
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    node scripts/access-hub.test.cjs [shots dir]
// Checks: each person sits in the column of the furthest step they reached,
// with full name and email; a waiting dataset request takes its own column;
// emails from a pasted list fold away; a long wait is flagged; search finds
// an EyeWire username; the side panel shows the request, adds a note and
// lets someone in (Pilot testers, the bell, the email); removed requests
// fold away; the community and tutorial boxes read their views; a phone
// width page does not scroll sideways.
// Every server call is answered here; nothing reaches production.
const path = require('path');
const { chromium } = require('C:/Users/amyle/hidden-worlds/node_modules/playwright');
const CHROME = 'C:/Users/amyle/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const OUT = process.argv[2] || __dirname;
const PORT = process.env.PORT || 3558;
const ok = d => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: d }) });
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };

const ago = d => new Date(Date.now() - d * 864e5).toISOString();
const base = { user_id: null, name: null, username: null, request_id: null, asked_at: null, from_site: null, gave_email: null, ew_name: null, ew_rank: null, found_us: null, their_note: null,
  pilot_enabled: null, let_in_at: null, from_list: false, joined_at: null, tutorial_active: null, tutorial_at: null, tutorials: 0, first_edit_at: null, last_edit_at: null, edits: 0, last_dataset: null,
  edits_30d: 0, cells: 0, cells_30d: 0, chats_30d: 0, last_chat_at: null };
const UID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PEOPLE = [
  // Asked 9 days ago, from the site, with an EyeWire name: late.
  { ...base, email: 'ken@example.org', name: 'Ken Mierow', request_id: UID(1), asked_at: ago(9), from_site: true, ew_name: 'kmierow', ew_rank: 'Guardian', their_note: 'I traced for years.' },
  // Asked yesterday, kept on the list.
  { ...base, email: 'rae@example.org', name: 'Rae Lin', request_id: UID(2), asked_at: ago(1.2) },
  // Asked, then removed.
  { ...base, email: 'gone@example.org', name: 'Gone Person', request_id: UID(3), asked_at: ago(5) },
  // Asked and let in (moved on in 2 days), not signed in.
  { ...base, email: 'sam@example.org', name: 'Sam Park', request_id: UID(4), asked_at: ago(6), pilot_enabled: true, let_in_at: ago(4) },
  // Signed in, in tutorial 3.
  { ...base, email: 'ann@example.org', user_id: UID(11), name: 'Ann Vo', pilot_enabled: true, let_in_at: ago(3), joined_at: ago(2), tutorial_active: 3 },
  // Tutorial done, no edits.
  { ...base, email: 'jo@example.org', user_id: UID(12), name: 'Jo Kim', pilot_enabled: true, let_in_at: ago(8), joined_at: ago(7), tutorial_at: ago(6), tutorials: 1 },
  // Editing.
  { ...base, email: 'nik@example.org', user_id: UID(13), name: 'Nik Serafin', username: 'nseraf', pilot_enabled: true, let_in_at: ago(30), joined_at: ago(29), tutorial_at: ago(29), tutorials: 3, first_edit_at: ago(29), last_edit_at: ago(0.1), edits: 4210, last_dataset: 'stroeh_mouse_retina',
    edits_30d: 1880, cells: 95, cells_30d: 41, chats_30d: 212, last_chat_at: ago(0.2) },
  // Editing, and waiting on a dataset request: the dataset column.
  { ...base, email: 'lou@example.org', user_id: UID(14), name: 'Lou Baker', pilot_enabled: true, let_in_at: ago(20), joined_at: ago(19), tutorial_at: ago(19), tutorials: 2, first_edit_at: ago(18), last_edit_at: ago(1), edits: 300, last_dataset: 'pinky_nf_v2' },
];
for (let i = 0; i < 6; i++) PEOPLE.push({ ...base, email: `list${i}@example.org`, pilot_enabled: true, let_in_at: ago(40), from_list: true });
const DS = [{ id: UID(21), userId: UID(14), name: 'Lou Baker', dataset: 'pni_mec', label: 'Medial Entorhinal Cortex', cave: 'pni_mec', email: 'lou@example.org', note: 'Ready for MEC', at: ago(0.5),
  access: null, history: null, caveGroup: 'MEC_Edit', mark: null, markedAt: null, markedBy: '' },
  { id: UID(22), userId: UID(13), name: 'Nik Serafin', dataset: 'pni_mec', label: 'Medial Entorhinal Cortex', cave: 'pni_mec', email: 'nik@example.org', note: '', at: ago(10),
  access: null, history: null, caveGroup: 'MEC_Edit', mark: 'granted', markedAt: ago(9), markedBy: 'amy' }];
const ACTIVITY = [{ dataset: 'stroeh_mouse_retina', edits: 41347, editors: 16, cells: 1800, finishers: 13, chats: 2032, chatters: 14 },
  { dataset: 'pni_mec', edits: 5642, editors: 10, cells: 5, finishers: 2, chats: 743, chatters: 11 },
  { dataset: 'pinky_nf_v2', edits: 2320, editors: 29, cells: 33, finishers: 9, chats: 1347, chatters: 18 },
  { dataset: 'pinky_training6', edits: 0, editors: 0, cells: 0, finishers: 0, chats: 247, chatters: 17 }];
const STATS = [{ tutorial: 2, step: 26, last_box: 'Your mission: a collaborator found a merger.', n: 3, players: 2, median_s: 250, p90_s: 530, help_rate: 0, closes: 0 },
  { tutorial: 3, step: 3, last_box: 'Make the merge', n: 8, players: 3, median_s: 78, p90_s: 233, help_rate: 0.25, closes: 4 },
  { tutorial: 8, step: 1, last_box: 'Optic: T4 Cell', n: 1, players: 1, median_s: 129, p90_s: 129, help_rate: 0, closes: 1 }];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => {
    const apps = [];
    for (const host of ['https://global.daf-apis.com', 'https://global.brain-wire-test.org', 'https://minnie.microns-daf.com']) apps.push(host, host + '/', host + '/nglstate', host + '/nglstate/', host + '/nglstate/api/v1', host + '/segmentation', host + '/segmentation/');
    const token = { tokenType: 'Bearer', accessToken: 'test-token', url: 'https://global.daf-apis.com/sticky_auth', appUrls: apps };
    for (const u of ['https://global.daf-apis.com/sticky_auth', 'https://global.brain-wire-test.org/sticky_auth']) { try { localStorage.setItem('auth_token_v2_' + u, JSON.stringify(token)); } catch (e) {} }
  });
  const calls = [];
  let marks = { 'rae@example.org': { mark: 'listed', at: ago(1) }, 'gone@example.org': { mark: 'removed', at: ago(4) } };
  const notes = {};
  let noteN = 0;
  await context.route(/global\.daf-apis\.com|global\.brain-wire-test\.org|minnie\.microns-daf\.com/, r => {
    if (/user\/me/.test(r.request().url())) return r.fulfill(json({ id: 1, email: 'amy@example.org', name: 'Amy Sterling' }));
    return r.fulfill(json({}));
  });
  await context.route(/cloudfunctions\.net|run\.app/, r => {
    let input = {}; try { input = r.request().postDataJSON() || {}; } catch (e) {}
    if (input.action) {
      calls.push({ action: input.action, args: input });
      const a = input.action;
      if (a === 'access.betaMarks') return r.fulfill(ok(marks));
      if (a === 'access.betaMark') { if (input.mark === 'waiting') delete marks[input.email]; else marks = { ...marks, [input.email]: { mark: input.mark, at: new Date().toISOString() } }; return r.fulfill(ok(marks)); }
      if (a === 'access.datasetList') return r.fulfill(ok(DS));
      if (a === 'access.notes') return r.fulfill(ok(notes));
      if (a === 'access.note') { (notes[input.key] = notes[input.key] || []).push({ id: 'n' + (++noteN), text: input.text, by: 'Amy Sterling', at: new Date().toISOString() }); return r.fulfill(ok(notes)); }
      if (a === 'access.welcomeEmail') return r.fulfill(ok({ sent: true }));
      return r.fulfill(ok({}));
    }
    calls.push({ table: input.table, method: input.method, body: input.body, query: input.query });
    // The real gateway's rule (functions/community-data.js): at most 500
    // rows a read, "Invalid limit" past that (live on 2026-11-09).
    const q = new URLSearchParams(input.query || '');
    const limit = Number(q.get('limit') ?? 500), offset = Number(q.get('offset') ?? 0);
    if (!Number.isInteger(limit) || limit < 0 || limit > 500) return r.fulfill(json({ status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Invalid limit' }) }));
    const all = input.table === 'access_hub_people' ? PEOPLE : input.table === 'access_hub_activity' ? ACTIVITY : input.table === 'tutorial_step_stats' ? STATS : [];
    const rows = all.slice(offset, offset + limit);
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const board = () => page.evaluate(() => [...document.querySelectorAll('.ah-col')].map(c => ({
    title: c.querySelector('.ah-col-title')?.textContent.trim(),
    n: c.querySelector('.ah-col-n')?.textContent.trim(),
    cards: [...c.querySelectorAll('.ah-card')].map(k => ({ name: k.querySelector('.ah-card-name')?.textContent.trim(), email: k.querySelector('.ah-card-email')?.textContent.trim(), late: k.classList.contains('ah-card--late'), text: k.textContent.replace(/\s+/g, ' ').trim() })),
  })));
  const col = (b, t) => b.find(c => c.title === t) || { cards: [] };
  try {
    await page.goto(`http://localhost:${PORT}/?triage=access`, { waitUntil: 'load' });
    await page.waitForSelector('.ah-card', { timeout: 60000 });
    await page.waitForTimeout(500);
    let b = await board();
    const errText = await page.$eval('.ah-error', e => e.textContent).catch(() => '');
    check('every part reads without an error (the 500 row limit)', !errText, errText);
    check('six columns in order', b.map(c => c.title).join('|') === 'Asked|Let in|Signed in|Tutorial done|Asked for a dataset|Editing', b.map(c => c.title));
    check('Asked: the two waiting, removed left out', col(b, 'Asked').n === '2' && col(b, 'Asked').cards.map(c => c.name).join(',') === 'Ken Mierow,Rae Lin', col(b, 'Asked'));
    check('cards show the full name and the email', col(b, 'Asked').cards[0].email === 'ken@example.org', col(b, 'Asked').cards[0]);
    check('a long wait is flagged, a short one is not', col(b, 'Asked').cards[0].late && !col(b, 'Asked').cards[1].late);
    check('on the list and the EyeWire name show as tags', /On the list/.test(col(b, 'Asked').cards[1].text) && /EyeWire kmierow/.test(col(b, 'Asked').cards[0].text));
    check('Let in counts the list but shows only the one who asked', col(b, 'Let in').n === '7' && col(b, 'Let in').cards.map(c => c.name).join(',') === 'Sam Park', col(b, 'Let in'));
    check('Signed in shows the tutorial they are in', col(b, 'Signed in').cards.length === 1 && /in tutorial 3/.test(col(b, 'Signed in').cards[0].text), col(b, 'Signed in'));
    check('Tutorial done and Editing', col(b, 'Tutorial done').cards[0]?.name === 'Jo Kim' && col(b, 'Editing').cards.map(c => c.name).join(',') === 'Nik Serafin', [col(b, 'Tutorial done'), col(b, 'Editing')]);
    check('a waiting dataset request takes its own column', col(b, 'Asked for a dataset').cards.length === 1 && /Medial Entorhinal Cortex/.test(col(b, 'Asked for a dataset').cards[0].text), col(b, 'Asked for a dataset'));
    const summary = await page.textContent('.ah-sum');
    check('the head counts what waits on us', /2 Beta requests and 1 dataset request waiting on us/.test(summary), summary);
    await page.screenshot({ path: path.join(OUT, 'access-hub.png'), fullPage: false });

    await page.click('.ah-fold');
    b = await board();
    check('the pasted list unfolds', col(b, 'Let in').cards.length === 7);

    await page.fill('.ah-search', 'kmierow');
    b = await board();
    const shown = b.flatMap(c => c.cards.map(k => k.name));
    check('search finds an EyeWire username', shown.join(',') === 'Ken Mierow', shown);
    await page.waitForSelector('.ah-panel', { timeout: 3000 }).catch(() => {});
    check('a search with one match opens that person', /ken@example\.org/.test(await page.textContent('.ah-panel').catch(() => '')));
    await page.fill('.ah-search', 'nseraf');
    await page.waitForTimeout(300);
    const stats = await page.$eval('.ah-stats', e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    check('their stats and recent activity show', /4,210 edits · 95 cells done · 3 tutorials finished/.test(stats) && /1,880 edits · 41 cells done · 212 chat messages/.test(stats) && /on EyeWire II/.test(stats) && /Last chat/.test(stats), stats);
    await page.click('.ah-close');
    await page.fill('.ah-search', '');

    await page.click('.ah-card:has-text("Ken Mierow")');
    await page.waitForSelector('.ah-panel');
    const panel = await page.textContent('.ah-panel');
    check('the panel shows the request', /Ken Mierow/.test(panel) && /ken@example\.org/.test(panel) && /rank Guardian/.test(panel) && /I traced for years/.test(panel), panel.slice(0, 200));
    await page.fill('.ah-panel textarea', 'Do we know him?');
    await page.click('.ah-panel button:has-text("Add note")');
    await page.waitForSelector('.ah-note-text');
    const noteCall = calls.find(c => c.action === 'access.note');
    check('a note is saved for this person', noteCall && noteCall.args.key === 'ken@example.org' && noteCall.args.text === 'Do we know him?' && /Do we know him\?/.test(await page.textContent('.ah-panel')), noteCall);
    b = await board();
    check('the card shows it has a note', /1 note/.test(col(b, 'Asked').cards[0].text));
    await page.screenshot({ path: path.join(OUT, 'access-hub-panel.png') });

    await page.click('.ah-panel button:has-text("Let them in")');
    await page.waitForTimeout(800);
    const upsert = calls.find(c => c.table === 'pilot_members');
    const mail = calls.find(c => c.action === 'access.welcomeEmail');
    check('Let them in adds them to Pilot testers and emails them', upsert && /ken@example\.org/.test(JSON.stringify(upsert)) && mail && mail.args.email === 'ken@example.org', { upsert, mail });
    b = await board();
    check('and they move to Let in', col(b, 'Asked').cards.every(c => c.name !== 'Ken Mierow') && col(b, 'Let in').cards.some(c => c.name === 'Ken Mierow'));

    await page.click('.ah-fold--wide');
    const removed = await page.$$eval('.ah-removed .ah-card', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('removed requests fold away below', removed.length === 1 && /Gone Person/.test(removed[0]), removed);

    const ins = await page.$$eval('.ah-box', els => els.map(e => [...e.querySelectorAll('.ah-bar-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim())));
    check('community: one row per dataset, most edits first', ins[0].length === 3 && /^EyeWire II/.test(ins[0][0]) && /41,347 edits/.test(ins[0][0]) && /Sandbox/.test(ins[0][2]) && /1,594 chat/.test(ins[0][2]), ins[0]);
    check('tutorial: slowest boxes reached by two or more', ins[1].length === 2 && /4 min 10 s/.test(ins[1][0]) && /25% asked for help/.test(ins[1][1]), ins[1]);

    // Bars compare across rows: every track the same length, the busiest
    // one full (Ames's phone, 2026-11-09: EyeWire II had no bar at all).
    const bars = () => page.$$eval('.ah-box', els => els.map(e => [...e.querySelectorAll('.ah-bar')].map(t => ({ track: Math.round(t.getBoundingClientRect().width), fill: Math.round(t.firstElementChild.getBoundingClientRect().width) }))));
    const barsOk = bs => bs.every(rows => rows.length && rows.every(r => r.track === rows[0].track) && rows[0].track >= 80 && rows[0].fill >= rows[0].track - 1);
    let bw = await bars();
    check('wide: bar tracks are equal and the top bar is full', barsOk(bw), bw);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const wide = await page.evaluate(() => ({ sw: document.querySelector('.ah').scrollWidth, cw: document.querySelector('.ah').clientWidth }));
    check('a phone width page does not scroll sideways', wide.sw <= wide.cw + 1, wide);
    bw = await bars();
    check('phone: bar tracks are equal and the top bar is full', barsOk(bw), bw);
    await page.screenshot({ path: path.join(OUT, 'access-hub-phone.png') });
    await (await page.$('.ah-box')).screenshot({ path: path.join(OUT, 'access-hub-phone-community.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) {
    check('ran without throwing', false, String(e).slice(0, 300));
  }
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
