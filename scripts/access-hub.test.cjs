// The Access page, "?triage=access" (Ames 2026-11-09), headless.
// Build:  DATASET=pinky_sandbox node scripts/build-prod.js
// Serve:  python -m http.server 3558 --directory dist/min
// Run:    node scripts/access-hub.test.cjs [shots dir]
// Checks: each person sits in the column of the furthest step they reached,
// with full name and email; a waiting dataset request takes its own column;
// emails from a pasted list fold away; nothing is outlined as late;
// requests waiting on us sit above the steps; a dataset request shows the
// player's Proofreading Test tries; search finds
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
  edits_30d: 0, cells: 0, cells_30d: 0, chats: 0, chats_30d: 0, help_asked: 0, help_answered_for: 0, help_asked_30d: 0, help_given: 0, help_given_30d: 0 };
const UID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PEOPLE = [
  // Asked 9 days ago, from the site, with an EyeWire name: late.
  { ...base, email: 'ken@example.org', name: 'Ken Mierow', request_id: UID(1), asked_at: ago(9), from_site: true, ew_name: 'kmierow', ew_rank: 'Guardian', their_note: 'I traced for years.', invited_at: '2026-11-09T21:05:00Z', invited_for: 'mec_talk', invited_role: 'Scout', invited_as: 'kmierow@old.example', ew_email: 'kmierow@old.example' },
  // One person, two emails: asked from the site with an EyeWire name, and
  // asked in Pyr, signed in, with an email starting with that EyeWire name.
  { ...base, email: 'dom.a@hotmail.example', name: 'Dominic Aitken', request_id: UID(5), asked_at: ago(0.2), from_site: true, ew_name: 'domaitk' },
  { ...base, email: 'domaitk358@example.org', user_id: UID(16), name: 'Inezh', request_id: UID(6), asked_at: ago(0.21), joined_at: ago(0.2) },
  // Asked yesterday, then Later.
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
    edits_30d: 1880, cells: 95, cells_30d: 41, chats: 900, chats_30d: 212, help_asked: 4, help_answered_for: 3, help_asked_30d: 1, help_given: 27, help_given_30d: 6 },
  // Editing, and waiting on a dataset request: the dataset column.
  { ...base, email: 'lou@example.org', user_id: UID(14), name: 'Lou Baker', username: 'lbaker', pilot_enabled: true, let_in_at: ago(20), joined_at: ago(19), tutorial_at: ago(19), tutorials: 2, first_edit_at: ago(18), last_edit_at: ago(1), edits: 300, last_dataset: 'pinky_nf_v2' },
];
// An admin, never asked and not on Pilot testers: the Admin step.
PEOPLE.push({ ...base, email: 'ryan.t.morey@gmail.com', user_id: UID(16), name: 'Ryan Morey', pilot_enabled: true, joined_at: ago(30), tutorial_at: ago(29), tutorials: 3, first_edit_at: ago(28), last_edit_at: ago(1), edits: 50, edits_30d: 50 });
PEOPLE.push({ ...base, email: 'boss@example.org', user_id: UID(15), name: 'Ames Admin', pilot_enabled: false, joined_at: ago(200), tutorial_at: ago(199), tutorials: 6, first_edit_at: ago(198), last_edit_at: ago(2), edits: 782, is_admin: true });
for (let i = 0; i < 6; i++) PEOPLE.push({ ...base, email: `list${i}@example.org`, pilot_enabled: true, let_in_at: ago(40), from_list: true });
const EDITS = Array.from({ length: 10 }, (_, i) => ({ at: ago(0.1 + i * 0.01), dataset: 'stroeh_mouse_retina', operation: i % 3 ? 'split' : 'merge', success: i !== 1 }));
const THEIRS = [{ user_id: UID(13), dataset: 'stroeh_mouse_retina', edits: 1500, cells: 40, chats: 150, last_edit_at: ago(0.1) },
  { user_id: UID(13), dataset: 'pni_mec', edits: 300, cells: 1, chats: 50, last_edit_at: ago(2) },
  { user_id: UID(13), dataset: 'pinky_nf_v2', edits: 80, cells: 0, chats: 2, last_edit_at: ago(5) },
  { user_id: UID(13), dataset: 'pinky_training6', edits: 0, cells: 0, chats: 10, last_edit_at: null }];
const DS = [{ id: UID(21), userId: UID(14), name: 'Lou Baker', dataset: 'pni_mec', label: 'Medial Entorhinal Cortex', cave: 'pni_mec', email: 'lou@example.org', note: 'Ready for MEC', at: ago(0.5),
  access: null, history: null, caveGroup: 'MEC_Edit', mark: null, markedAt: null, markedBy: '' },
  { id: UID(22), userId: UID(13), name: 'Nik Serafin', dataset: 'pni_mec', label: 'Medial Entorhinal Cortex', cave: 'pni_mec', email: 'nik@example.org', note: '', at: ago(10),
  access: null, history: null, caveGroup: 'MEC_Edit', mark: 'granted', markedAt: ago(9), markedBy: 'amy' }];
// Proofreading Test tries (test.tries): Lou passed on the second go; Nik's try is not Lou's.
const TRIES = [{ id: 3, test_id: 't', started_at: ago(0.7), submitted_at: ago(0.68), outcome: 'pass', found: 9, errors: 10, damaged: 0, percent: 88, timed_out: false, error: null, ends_total: 4, ends_found: 4, username: 'lbaker', cave_user_id: 7 },
  { id: 2, test_id: 't', started_at: ago(3), submitted_at: ago(2.9), outcome: 'fail', found: 4, errors: 10, damaged: 2, percent: 41, timed_out: true, error: null, ends_total: 4, ends_found: 1, username: 'lbaker', cave_user_id: 7 },
  { id: 1, test_id: 't', started_at: ago(4), submitted_at: null, outcome: 'pass', found: 10, errors: 10, damaged: 0, percent: 100, timed_out: false, error: null, username: 'nseraf', cave_user_id: 8 }];
const ACTIVITY = [{ dataset: 'stroeh_mouse_retina', edits: 41347, editors: 16, cells: 1800, finishers: 13, chats: 2032, chatters: 14 },
  { dataset: 'pni_mec', edits: 5642, editors: 10, cells: 5, finishers: 2, chats: 743, chatters: 11 },
  { dataset: 'pinky_nf_v2', edits: 2320, editors: 29, cells: 33, finishers: 9, chats: 1347, chatters: 18 },
  { dataset: 'pinky_training6', edits: 0, editors: 0, cells: 0, finishers: 0, chats: 247, chatters: 17 }];
const STATS = [{ tutorial: 2, step: 26, last_box: 'Your mission: a collaborator found a merger.', n: 3, players: 2, median_s: 250, p90_s: 530, help_rate: 0, closes: 0 },
  { tutorial: 3, step: 3, last_box: 'Make the merge', n: 8, players: 3, median_s: 78, p90_s: 233, help_rate: 0.25, closes: 4 },
  { tutorial: 3, step: 2, last_box: 'Find the gap', n: 5, players: 4, median_s: 40, p90_s: 90, help_rate: 0, closes: 0 },
  { tutorial: 8, step: 1, last_box: 'Optic: T4 Cell', n: 1, players: 1, median_s: 129, p90_s: 129, help_rate: 0, closes: 1 }];
// Where each player is in each tutorial (access_hub_tutorials): Ann Vo left
// Merge's box 3 with Next, so she is on box 4; Nik finished Get Started.
const TUTS = [{ user_id: UID(11), tutorial: 3, last_step: 2, last_left: 'next', last_at: ago(2), done_at: null },
  { user_id: UID(11), tutorial: 1, last_step: 18, last_left: 'next', last_at: ago(2.1), done_at: ago(2.1) }];

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
      if (a === 'test.tries') return r.fulfill(ok({ kept: true, test: null, key: null, line: [], tries: TRIES }));
      if (a === 'access.notes') return r.fulfill(ok(notes));
      if (a === 'access.note') { (notes[input.key] = notes[input.key] || []).push({ id: 'n' + (++noteN), text: input.text, by: 'Amy Sterling', at: new Date().toISOString() }); return r.fulfill(ok(notes)); }
      if (a === 'access.welcomeEmail') return r.fulfill(ok({ sent: true }));
      if (a === 'access.askSent') return r.fulfill(ok({}));
      if (a === 'access.setEwName') return r.fulfill(ok({ ewName: String(input.ewName).toLowerCase() }));
      if (a === 'access.inviteCount') return r.fulfill(ok({ invited: 414, signedIn: 20 }));
      if (a === 'access.askDraft') return r.fulfill(ok({ subject: 'Your Pyr beta request', text: `Hi ${String(input.name).split(' ')[0]},

Could you reply with your EyeWire username?

Amy Sterling and the Pyr Team at Princeton` }));
      if (a === 'access.askEmail') return r.fulfill(ok({ sent: true, at: new Date().toISOString() }));
      // The bio page sends no CORS header, so the page asks the server (Ames 2026-11-13).
      if (a === 'access.ewBio') { const n = String(input.args?.name || input.name || ''); calls.push({ ewBio: n });
        return r.fulfill(ok(n === 'kmierow' ? { joined: 1399207428, roles: ['scout', 'scythe'], country: 'Germany' } : n === 'domaitk' ? { joined: 1794344311, roles: [] } : { none: true })); }
      if (a === 'canEdit') return r.fulfill(ok({ 'nik@example.org': 'MEC, Retina', 'jo@example.org': 'MEC', 'lou@example.org': 'FlyWire public', 'boss@example.org': 'Retina' }));
      if (a === 'usersSheet') return r.fulfill(ok({ people: 14, url: 'https://docs.google.com/spreadsheets/d/x/edit' }));
      return r.fulfill(ok({}));
    }
    calls.push({ table: input.table, method: input.method, body: input.body, query: input.query });
    // The real gateway's rule (functions/community-data.js): at most 500
    // rows a read, "Invalid limit" past that (live on 2026-11-09).
    const q = new URLSearchParams(input.query || '');
    const limit = Number(q.get('limit') ?? 500), offset = Number(q.get('offset') ?? 0);
    if (!Number.isInteger(limit) || limit < 0 || limit > 500) return r.fulfill(json({ status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Invalid limit' }) }));
    const all = input.table === 'access_hub_player_datasets' ? THEIRS : input.table === 'access_hub_recent_edits' ? EDITS : input.table === 'access_hub_people' ? PEOPLE : input.table === 'access_hub_activity' ? ACTIVITY : input.table === 'tutorial_step_stats' ? STATS : input.table === 'access_hub_tutorials' ? TUTS : input.table === 'users' && /cave_user_id/.test(String(input.query || '')) ? [{ cave_user_id: 4321 }] : [];
    const rows = all.slice(offset, offset + limit);
    return r.fulfill(json({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) }));
  });
  await context.route(/supabase\.co/, r => r.fulfill(json([])));
  // eyewire.org's public player pages (the page reads them for EyeWire stats).
  await context.route(/eyewire\.org\/1\.0\/player\//, r => {
    const [, name, what] = r.request().url().match(/player\/([^/]+)\/(stats|bio)/) || [];
    calls.push({ eyewire: name, what });
    if (name === 'kmierow') return r.fulfill(json(what === 'stats'
      ? { username: 'kmierow', forever: { points: '31685747', cubes: '224881', complete: '13389' }, fscore: [{ fscore: 0.9247 }] }
      : { status: 'no CORS: the browser never sees this' }));
    if (name === 'domaitk') return r.fulfill(json(what === 'stats' ? { username: 'domaitk', forever: { points: '0', cubes: '0' }, fscore: [] } : { username: 'domaitk', joined: 1794344311, roles: [] }));
    return r.fulfill({ status: 404, body: '' });
  });

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
    check('waiting on us first, then the steps, Editing off by default', b.map(c => c.title).join('|') === 'Asked|Emailed|Asked for a dataset|Let in|Signed in|Tutorial done', b.map(c => c.title));
    const groups = await page.$$eval('.ah-group-title', els => els.map(e => e.textContent.replace(/[▾▸]/g, '').trim()));
    check('two rows: Waiting on us above Getting started', groups.join('|') === 'Waiting on us|Getting started', groups);
    // The admins' leaderboard ranks everyone who edited (Ames 2026-11-10).
    const lb = () => page.$$eval('.ah-lb-row', els => els.map(e => ({ rank: e.querySelector('.ah-lb-rank').textContent.trim(), who: e.querySelector('.ah-lb-who b').textContent.trim(), v: e.querySelector('.ah-lb-v').textContent.trim() })));
    await page.screenshot({ path: path.join(OUT, 'access-hub-lb.png'), fullPage: true });
    let L = await lb();
    check('leaderboard: last 30 days by edits, top first, admin left out', L.map(r => r.who + ' ' + r.v).join('|') === 'Nik Serafin 1,880', L);
    // Sections fold, and stay folded on the next visit (Ames 2026-11-12).
    const lbWidth = await page.$eval('.ah-lb', e => e.getBoundingClientRect().width);
    check('the leaderboard is not full width', lbWidth <= 900, lbWidth);
    await page.click('.ah-lb .ah-fold-btn');
    check('the leaderboard folds', (await page.$$('.ah-lb-row')).length === 0 && await page.$eval('.ah-lb .ah-fold-btn', e => e.getAttribute('aria-expanded')) === 'false');
    await page.click('.ah-group-title .ah-fold-btn:has-text("Getting started")');
    check('a board row folds', (await page.$$('.ah-group')).length === 2 && await page.$$eval('.ah-group', gs => gs.map(g => !!g.querySelector('.ah-board')).join(',')) === 'true,false');
    await page.reload(); await page.waitForSelector('.ah-lb .ah-fold-btn');
    check('folds are remembered', (await page.$$('.ah-lb-row')).length === 0 && await page.$$eval('.ah-group', gs => gs.map(g => !!g.querySelector('.ah-board')).join(',')) === 'true,false');
    await page.click('.ah-lb .ah-fold-btn');
    await page.click('.ah-group-title .ah-fold-btn:has-text("Getting started")');
    await page.waitForSelector('.ah-lb-row');
    await page.click('.ah-seg button:has-text("All time")');
    L = await lb();
    check('leaderboard: all time', L.map(r => r.who + ' ' + r.v).join('|') === 'Nik Serafin 4,210|Lou Baker 300', L);
    await page.click('.ah-seg button:has-text("Help given")');
    L = await lb();
    check('leaderboard: by help given', L.map(r => r.who + ' ' + r.v).join('|') === 'Nik Serafin 27', L);
    await page.click('.ah-seg button:has-text("Edits")');
    await page.click('.ah-lb-row:has-text("Lou Baker")');
    await page.waitForSelector('.ah-panel h2', { timeout: 3000 }).catch(() => {});
    check('a leaderboard row opens their panel', (await page.textContent('.ah-panel h2').catch(() => '')) === 'Lou Baker');
    const cave = await page.waitForSelector('.ah-caveid', { timeout: 3000 }).then(e => e.textContent()).catch(() => '');
    check('the panel shows their CAVE ID (Celia #528)', cave.trim() === '4321', cave);
    const tries = await page.$$eval('.ah-tries li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    // Ames 2026-11-14: "Let them in & send notification", and a test to my own bell.
    const dsBtns = await page.$$eval('.ah-ds .ah-actions button', els => els.map(e => e.textContent.trim()));
    check('the dataset buttons say they send the notification', dsBtns.join('|') === 'Let them in & send notification|I added them by hand, send notification|Not now|Send me a test', dsBtns);
    await page.click('.ah-ds button:has-text("Send me a test")');
    await page.waitForTimeout(300);
    check('Send me a test asks the server for this dataset\'s bell, to me', calls.some(c => c.action === 'access.datasetTestBell' && c.args.dataset === 'pni_mec') && /Test sent to your bell/.test(await page.textContent('.ah-ds .ah-actions')), calls.filter(c => c.action === 'access.datasetTestBell'));
    check('their dataset request shows their Proofreading Test tries, newest first, only theirs', tries.length === 2 && /^Passed \(88%\) · 9 of 10 mistakes fixed · 4 of 4 ends marked · nothing damaged/.test(tries[0]) && /^Did not pass \(41%\).*2 real branches cut off/.test(tries[1]), tries);
    await page.screenshot({ path: path.join(OUT, 'access-hub-tries.png'), fullPage: false });
    await page.click('.ah-close');
    await page.click('.ah-lb-col');
    b = await board();
    check('the Editing column comes back on request', b.map(c => c.title).pop() === 'Editing', b.map(c => c.title));
    check('Asked: the three waiting, Later and removed left out', col(b, 'Asked').n === '3' && col(b, 'Asked').cards[0].name === 'Ken Mierow' && col(b, 'Asked').cards.map(c => c.name).sort().join(',') === 'Dominic Aitken,Inezh,Ken Mierow', col(b, 'Asked'));
    check('cards show the full name and the email', col(b, 'Asked').cards[0].email === 'ken@example.org', col(b, 'Asked').cards[0]);
    check('no card is outlined as late', b.every(c => c.cards.every(k => !k.late)));
    check('a dataset card names their latest test result', /Test: passed/.test(col(b, 'Asked for a dataset').cards[0].text), col(b, 'Asked for a dataset').cards[0]);
    check('the EyeWire tag reads their cubes from eyewire.org', /EyeWire kmierow: 224,881 cubes/.test(col(b, 'Asked').cards[0].text) && /EyeWire domaitk: new/.test(col(b, 'Asked').cards.find(c => c.name === 'Dominic Aitken').text), col(b, 'Asked').cards.map(c => c.text));
    check('the two emails of one person are flagged on both cards', /Maybe the same as Inezh/.test(col(b, 'Asked').cards.find(c => c.name === 'Dominic Aitken').text) && /Maybe the same as Dominic Aitken/.test(col(b, 'Asked').cards.find(c => c.name === 'Inezh').text) && !/Maybe the same/.test(col(b, 'Asked').cards[0].text));
    check('opening the page marks read the bells of requests dealt with (Ames 2026-11-12)', calls.some(c => c.action === 'access.readHandledBetaBells'));
    const icon = await page.$eval('link[rel=icon]', e => e.getAttribute('href')).catch(() => '');
    check('the Access tab has its own purple gem (Ames 2026-11-12)', /pyr-icon-access/.test(icon), icon);
    const totals = await page.$$eval('.ah-total', els => els.map(e => e.querySelector('b').textContent.trim() + ' ' + e.querySelector('span').textContent.trim()));
    check('overall numbers, admins left out; dataset access from CAVE (the sheet), public datasets not counted', totals.join('|') === '414 Invited by email|6 Total access requests|20 Signed in ↗|3 Finished a tutorial|2 Made an edit|2 Dataset access', totals);
    check('Let in counts the list but shows only the one who asked', col(b, 'Let in').n === '7' && col(b, 'Let in').cards.map(c => c.name).join(',') === 'Sam Park', col(b, 'Let in'));
    check('Signed in shows the tutorial they are in', col(b, 'Signed in').cards.length === 1 && /in tutorial 3/.test(col(b, 'Signed in').cards[0].text), col(b, 'Signed in'));
    check('Tutorial done and Editing', col(b, 'Tutorial done').cards[0]?.name === 'Jo Kim' && col(b, 'Editing').cards.map(c => c.name).join(',') === 'Nik Serafin', [col(b, 'Tutorial done'), col(b, 'Editing')]);
    check('a waiting dataset request takes its own column', col(b, 'Asked for a dataset').cards.length === 1 && /Medial Entorhinal Cortex/.test(col(b, 'Asked for a dataset').cards[0].text), col(b, 'Asked for a dataset'));
    const summary = await page.textContent('.ah-sum');
    check('the head counts what waits on us, and Later', /3 Beta requests and 1 dataset request waiting on us, 1 for later/.test(summary), summary);
    await page.click('.ah-later-fold');
    const later = await page.$$eval('.ah-later .ah-card', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('Later folds away below', later.length === 1 && /Rae Lin/.test(later[0]), later);
    await page.click('.ah-later-fold');
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
    check('their stats and recent activity show', /4,210 edits · 95 cells done · 3 tutorials finished/.test(stats) && /1,880 edits · 41 cells done/.test(stats) && /asked 4 times, 3 answered · helped others 27 times \(1 asked, 6 helped in 30 days\)/.test(stats) && /900 messages, 212 in 30 days/.test(stats), stats);
    const edits = await page.waitForSelector('.ah-edits li', { timeout: 5000 }).then(() => page.$$eval('.ah-edits li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()))).catch(() => []);
    check('their 10 latest edits, read for that player only', edits.length === 10 && /^Merge, EyeWire II/.test(edits[0]) && /did not go through/.test(edits[1]), edits.slice(0, 3));
    const theirs = await page.$$eval('.ah-their-row', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('their 30 days by dataset, busiest first, training volumes added in', theirs.length === 3 && /^EyeWire II ?1,500 edits ?40 cells done · 150 chat messages/.test(theirs[0]) && /^MEC ?300 edits/.test(theirs[1]) && /^Sandbox ?80 edits ?0 cells done · 12 chat messages/.test(theirs[2]), theirs);
    const dsCall = [...calls].reverse().find(c => c.table === 'access_hub_player_datasets');
    check('the dataset snapshot asks for that one player', dsCall && /user_id=eq\.00000000-0000-4000-8000-000000000013/.test(dsCall.query), dsCall && dsCall.query);
    const editCall = [...calls].reverse().find(c => c.table === 'access_hub_recent_edits');
    check('the latest edits ask for that one player', editCall && /user_id=eq\.00000000-0000-4000-8000-000000000013/.test(editCall.query) && /limit=10/.test(editCall.query), editCall && editCall.query);
    await page.click('.ah-close');
    await page.fill('.ah-search', '');

    await page.click('.ah-card:has-text("Ken Mierow")');
    await page.waitForSelector('.ah-panel');
    const panel = await page.textContent('.ah-panel');
    const env = await page.$$eval('.ah-card', els => els.filter(e => e.querySelector('.ah-invited')).map(e => [e.querySelector('.ah-card-name').textContent.trim(), e.querySelector('.ah-invited').getAttribute('title')]));
    check('the envelope marks only the person we invited by email', env.length === 1 && env[0][0] === 'Ken Mierow' && /invited them by email as an EyeWire Scout: the MEC talk email, Nov 9 at kmierow@old\.example/.test(env[0][1]), env);
    check('the panel says we invited them', /We invited them by email as an EyeWire Scout/.test(panel), panel.slice(0, 300));
    check('the panel shows the request', /Ken Mierow/.test(panel) && /ken@example\.org/.test(panel) && /rank Guardian/.test(panel) && /I traced for years/.test(panel), panel.slice(0, 200));
    check('the panel shows their EyeWire email (Ames 2026-11-12)', /EyeWire email kmierow@old\.example/.test(panel), panel.slice(0, 400));
    const ew = await page.$eval('.ah-ew', e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    check('the panel shows their EyeWire stats', /31,685,747 points · 224,881 cubes · 92% accuracy/.test(ew) && /Scout, Scythe · joined EyeWire May 4, 2014 · Germany/.test(ew) && calls.some(c => c.ewBio === 'kmierow'), ew);
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

    // One person, two emails: Same person folds the email without an account
    // into the signed in one (Ames 2026-11-10).
    await page.click('.ah-card:has(.ah-card-name:text-is("Dominic Aitken"))');
    await page.waitForSelector('.ah-dupe', { timeout: 3000 }).catch(() => {});
    check('the panel offers Same person', /Maybe the same person as Inezh/.test(await page.textContent('.ah-panel')));
    await page.screenshot({ path: path.join(OUT, 'access-hub-dupe.png'), fullPage: false });
    await page.click('.ah-dupe button:has-text("Same person")');
    await page.waitForTimeout(500);
    const link = calls.find(c => c.action === 'access.linkEmails');
    check('Same person links the email without an account into the one with', link && link.args.email === 'dom.a@hotmail.example' && link.args.to === 'domaitk358@example.org', link);
    // Inezh signed in but never played: no rows of zeros.
    const inezh = await page.textContent('.ah-panel').catch(() => '');
    check('signed in, nothing played: one line, no zero stats', /Signed in to Pyr, nothing played yet/.test(inezh) && !/All time/.test(inezh) && !/Not signed in/.test(inezh), inezh.slice(0, 300));
    // No EyeWire name: ask for it by email, read the draft, edit, send (Ames 2026-11-12).
    await page.click('.ah-panel button:has-text("Ask for their EyeWire name")');
    await page.waitForSelector('.ah-ask-draft', { timeout: 3000 }).catch(() => {});
    const draft = await page.textContent('.ah-ask-draft').catch(() => '');
    check('the draft shows before sending, to them, from Amy at Pyr', /To domaitk358@example\.org, from Amy at Pyr/.test(draft) && /Hi Inezh,/.test(draft) && /EyeWire username/.test(draft), draft.slice(0, 200));
    await page.screenshot({ path: path.join(OUT, 'access-hub-ask.png') });
    await page.click('.ah-ask-draft button:has-text("Edit")');
    await page.fill('.ah-ask-draft textarea', 'Hi Inezh, edited by us.');
    await page.click('.ah-ask-draft button:has-text("Send")');
    await page.waitForTimeout(500);
    const askCall = calls.find(c => c.action === 'access.askEmail');
    check('Send sends the edited email', askCall && askCall.args.email === 'domaitk358@example.org' && askCall.args.text === 'Hi Inezh, edited by us.' && askCall.args.subject === 'Your Pyr beta request' && askCall.args.again === false, askCall);
    const afterAsk = await page.textContent('.ah-panel').catch(() => '');
    b = await board();
    check('the panel says they were asked, and they move to Emailed', /Asked for their EyeWire name by email/.test(afterAsk) && col(b, 'Asked').cards.every(c => c.name !== 'Inezh') && col(b, 'Emailed').cards.some(c => c.name === 'Inezh'), { afterAsk: afterAsk.slice(0, 200), emailed: col(b, 'Emailed') });
    // Their reply gave their EyeWire name: type it in, the stats fill in, and
    // they come back to Asked with the envelope (Ames 2026-11-12).
    await page.fill('.ah-ewset-input', 'KMierow');
    await page.click('.ah-ewset button:has-text("Save")');
    await page.waitForTimeout(600);
    const setCall = calls.find(c => c.action === 'access.setEwName');
    check('typing in their EyeWire username saves it', setCall && setCall.args.email === 'domaitk358@example.org' && setCall.args.ewName === 'KMierow', setCall);
    const afterEw = await page.textContent('.ah-panel').catch(() => '');
    b = await board();
    check('their EyeWire stats fill in, they show as an EyeWire player, and move back to Asked', /31,685,747 points · 224,881 cubes/.test(afterEw) && /added by hand/.test(afterEw) && /An EyeWire player/.test(afterEw) && col(b, 'Asked').cards.some(c => c.name === 'Inezh') && !(await page.$('.ah-ewset-input')), afterEw.slice(0, 400));
    await page.click('.ah-ewset-change');
    check('Change opens the field again with the name in it', await page.$eval('.ah-ewset-input', e => e.value).catch(() => '') === 'kmierow');
    await page.click('.ah-ewset button:has-text("Cancel")');
    // Later takes them off the Asked list.
    await page.click('.ah-panel button:has-text("Later")');
    await page.waitForTimeout(400);
    const laterCall = [...calls].reverse().find(c => c.action === 'access.betaMark');
    b = await board();
    check('Later marks them and takes them off Asked', laterCall && laterCall.args.mark === 'listed' && laterCall.args.email === 'domaitk358@example.org' && col(b, 'Asked').cards.every(c => c.name !== 'Inezh'), laterCall);
    await page.click('.ah-close').catch(() => {});

    // The tutorials as a flow; open one for its boxes and who is on each (Ames 2026-11-12).
    const flow = await page.$$eval('.ah-flow .ah-node', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('the tutorial flow: the main path in order, with finished and in it now', /^Get Started ?1 finished ?0 in it now$/.test(flow[0]) && /^Merge ?0 finished ?1 in it now$/.test(flow[1]) && /^Cut/.test(flow[2]) && /^Advanced Interface/.test(flow[3]) && /^Proofreading Test/.test(flow[4]), flow);
    await page.click('.ah-node:has-text("Merge")');
    const steps = await page.$$eval('.ah-tut-open .ah-step', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('opening Merge shows each box with its median time, and who is on it now', steps.length === 2 && /^3\. Find the gap.*40 s median.*4 reached/.test(steps[0]) && /^4\. Make the merge.*1 min 18 s median.*3 reached of 4.*25% asked for help.*4 left here.*On it now: Ann Vo/.test(steps[1]), steps);
    await page.$eval('.ah-flowbox', e => e.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(OUT, 'access-hub-tutorials.png') });
    await page.click('.ah-tut-open .ah-chip:has-text("Ann Vo")');
    await page.waitForTimeout(300);
    check('a name on a box opens that person', /Ann Vo/.test(await page.textContent('.ah-panel').catch(() => '')));
    await page.click('.ah-close').catch(() => {});

    // Admins are their own step (Ames 2026-11-10), off the board columns.
    b = await board();
    check('an admin is in no step column', b.every(c => c.cards.every(x => x.name !== 'Ames Admin')), b.map(c => c.title));
    await page.click('.ah-fold--wide:has-text("admin")');
    const admins = await page.$$eval('.ah-admins .ah-card', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('admins fold away below as Admin, and the team as Team (Ryan Morey, Ames 2026-11-12)', admins.length === 2 && /Ames Admin/.test(admins[0]) && /Admin, 782 edits/.test(admins[0]) && /Ryan Morey/.test(admins[1]) && /Team, 50 edits/.test(admins[1]), admins);
    await page.click('.ah-fold--wide:has-text("removed")');
    const removed = await page.$$eval('.ah-removed .ah-card', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    check('removed requests fold away below, without the admin', removed.length === 1 && /Gone Person/.test(removed[0]), removed);

    const ins = await page.$$eval('.ah-box', els => els.map(e => [...e.querySelectorAll('.ah-bar-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim())));
    check('community: one row per dataset, most edits first', ins[0].length === 3 && /^EyeWire II/.test(ins[0][0]) && /41,347 edits/.test(ins[0][0]) && /Sandbox/.test(ins[0][2]) && /1,594 chat/.test(ins[0][2]), ins[0]);
    check('tutorial: slowest boxes reached by two or more', ins[1].length === 3 && /4 min 10 s/.test(ins[1][0]) && /25% asked for help/.test(ins[1][1]), ins[1]);

    // Bars compare across rows: every track the same length, the busiest
    // one full (Ames's phone, 2026-11-09: EyeWire II had no bar at all).
    const bars = () => page.$$eval('.ah-box', els => els.map(e => [...e.querySelectorAll('.ah-bar')].map(t => ({ track: Math.round(t.getBoundingClientRect().width), fill: Math.round(t.firstElementChild.getBoundingClientRect().width) }))));
    const barsOk = bs => bs.every(rows => rows.length && rows.every(r => r.track === rows[0].track) && rows[0].track >= 80 && rows[0].fill >= rows[0].track - 1);
    let bw = await bars();
    check('wide: bar tracks are equal and the top bar is full', barsOk(bw), bw);

    await page.click('.ah-head button:has-text("Update the sheet now")');
    await page.waitForSelector('.ah-sheet-said', { timeout: 5000 }).catch(() => {});
    const said = await page.textContent('.ah-sheet-said').catch(() => '');
    check('Update the sheet now asks the server and says how many', /Sheet updated: 14 people/.test(said) && calls.some(c => c.action === 'usersSheet'), said);
    check('the sheet is linked', await page.$eval('.ah-head a[href*="10VW3cSrtK8y0pLlivJnQIuMAp65_B-eDJAVb3DbpKBs"]', e => e.textContent.trim()).catch(() => '') === 'Pyr Users sheet');

    // A tag's link opens that person, even one folded away (Ames 2026-11-10).
    const p2 = await context.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(String(e).slice(0, 300))); p2.on('console', m => { if (m.type() === 'error') e2.push('console: ' + m.text().slice(0, 200)); });
    await p2.goto(`http://localhost:${PORT}/?triage=access&person=boss%40example.org`, { waitUntil: 'load' });
    await p2.waitForSelector('.ah-panel h2', { timeout: 60000 }).catch(() => {});
    check('a tag link opens that person, and leaves the address', (await p2.textContent('.ah-panel h2').catch(() => '')) === 'Ames Admin' && !/person=/.test(p2.url()), [p2.url(), e2.slice(0, 4), (await p2.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)]);
    check('the note box says how to tag', /@Celia or @Marissa/.test(await p2.getAttribute('.ah-panel textarea', 'placeholder').catch(() => '') || ''));
    await p2.close();

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
