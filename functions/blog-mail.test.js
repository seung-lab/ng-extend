const test = require('node:test');
const assert = require('node:assert');
const bm = require('./blog-mail');

/** A pretend Resend: contacts by email, segments by name, every call logged. */
function fakeResend({ contacts = {}, segments = {} } = {}) {
  const calls = [];
  let n = 0;
  const resend = async (p, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, p, body: init.body });
    if (p === '/segments' && method === 'GET') return { data: Object.entries(segments).map(([name, id]) => ({ id, name })) };
    if (p === '/segments' && method === 'POST') { const id = `seg${++n}`; segments[init.body.name] = id; return { id }; }
    let m = /^\/contacts\/([^/]+)$/.exec(p);
    if (m && method === 'GET') {
      const c = contacts[decodeURIComponent(m[1])];
      if (!c) { const e = new Error('resend 404'); e.status = 404; e.resend = true; throw e; }
      return c;
    }
    if (m && method === 'PATCH') { Object.assign(contacts[decodeURIComponent(m[1])], init.body); return {}; }
    if (p === '/contacts' && method === 'POST') { contacts[init.body.email] = { id: `c${++n}`, ...init.body }; return { id: contacts[init.body.email].id }; }
    if (/^\/contacts\/[^/]+\/segments\/[^/]+$/.test(p)) return {};
    if (p === '/broadcasts' && method === 'POST') return { id: `b${++n}` };
    if (/^\/broadcasts\/[^/]+\/send$/.test(p)) return {};
    if (p === '/emails/batch' && method === 'POST') return { data: init.body.map(() => ({ id: `e${++n}` })) };
    throw new Error(`unexpected ${method} ${p}`);
  };
  return { resend, calls, contacts, segments };
}
function io(extra = {}) {
  const f = fakeResend(extra.resendState);
  const subs = {}, marks = {};
  return {
    f, subs, marks,
    resend: f.resend, cache: {},
    subscribers: { set: async (e, v) => { subs[e] = { ...subs[e], ...v }; }, update: async (e, v) => { subs[e] = { ...subs[e], ...v }; } },
    sentPosts: {
      get: async (id) => marks[id] || null,
      set: async (id, v) => { marks[id] = { ...marks[id], ...v }; },
      claim: async (id, v, seen) => { if ((marks[id] ? marks[id].at : null) !== (seen ? seen.at : null)) return false; marks[id] = { ...marks[id], ...v }; return true; },
    },
    posts: async () => extra.posts || [],
    page: async (url) => (extra.pages || {})[url] || null,
    renderer: async () => (md) => md.split(/\n\n+/).map((b) => `<p>${b}</p>`).join('\n'),
    ...extra.io,
  };
}

test('subscribe: a new address is added, subscribed, and put in the blog segment', async () => {
  const x = io();
  const r = await bm.handle('subscribe', { name: 'Kim', email: ' Kim@Example.org ', source: 'home' }, x);
  assert.deepStrictEqual(r, { ok: true, again: false });
  assert.strictEqual(x.f.contacts['kim@example.org'].unsubscribed, false);
  assert.ok(x.f.calls.some((c) => c.p === `/contacts/kim%40example.org/segments/${x.f.segments[bm.SEGMENT]}`));
  assert.strictEqual(x.subs['kim@example.org'].resend, true);
});

test('subscribe: signing up again after an unsubscribe subscribes them again', async () => {
  const x = io({ resendState: { contacts: { 'kim@example.org': { id: 'c1', email: 'kim@example.org', unsubscribed: true } }, segments: { [bm.SEGMENT]: 's1' } } });
  const r = await bm.handle('subscribe', { name: 'Kim', email: 'kim@example.org' }, x);
  assert.strictEqual(r.again, true);
  assert.strictEqual(x.f.contacts['kim@example.org'].unsubscribed, false);
  assert.ok(!x.f.calls.some((c) => c.p === '/contacts' && c.method === 'POST'), 'no second contact');
});

test('subscribe: the bot trap and bad input', async () => {
  const x = io();
  assert.deepStrictEqual(await bm.handle('subscribe', { name: 'b', email: 'b@b.co', _honey: 'x' }, x), { ok: true });
  assert.strictEqual(x.f.calls.length, 0);
  await assert.rejects(bm.handle('subscribe', { name: 'Kim', email: 'not an email' }, x), { status: 400 });
  await assert.rejects(bm.handle('subscribe', { name: '', email: 'kim@example.org' }, x), { status: 400 });
  await assert.rejects(bm.handle('nope', {}, x), { status: 400 });
});

const POST = { id: 'p1', slug: 'new-post', title: 'A new post', summary: 'Short.', body: 'Hello there.', published_at: '2026-11-06T10:00:00Z' };
const LIVE_PAGE = { 'https://connectome.quest/blog/new-post/': '<h1>A new post</h1>' };

test('check: nothing goes while LIVE is off', async () => {
  assert.strictEqual(bm.LIVE, false, 'the deployed code must stay off until Ames says go');
  const x = io({ posts: [POST], pages: LIVE_PAGE });
  assert.deepStrictEqual(await bm.handle('check', {}, x), { live: false, sent: [] });
  assert.strictEqual(x.f.calls.length, 0);
});

test('check: a new post goes once, to the blog segment, only when its page is live', async () => {
  const live = { since: '2026-11-06T00:00:00Z' };
  const old = { ...POST, id: 'p0', slug: 'old-post', title: 'Old', published_at: '2026-11-01T00:00:00Z' };
  const x = io({ posts: [POST, old], pages: {}, io: { live } });
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, [], 'page not built yet');
  x.page = async (u) => LIVE_PAGE[u] || '<h1>Old</h1>';
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, ['new-post'], 'old posts never go');
  const b = x.f.calls.find((c) => c.p === '/broadcasts');
  assert.strictEqual(b.body.segment_id, x.f.segments[bm.SEGMENT]);
  assert.strictEqual(b.body.subject, 'A new post');
  assert.match(b.body.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  assert.match(b.body.html, /href="https:\/\/connectome\.quest\/blog\/new-post\/"/);
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, [], 'never twice');
  assert.strictEqual(x.f.calls.filter((c) => /\/send$/.test(c.p)).length, 1);
});

test('check: the weekly release notes are never emailed', async () => {
  const notes = { ...POST, id: 'w1', slug: 'whats-new-in-pyr-2026-11-09', title: 'Release notes, week of November 9' };
  const x = io({ posts: [notes], pages: { 'https://connectome.quest/blog/whats-new-in-pyr-2026-11-09/': `<h1>${notes.title}</h1>` }, io: { live: { since: '2026-11-06T00:00:00Z' } } });
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, []);
});

test('check: a post another run is sending is left alone', async () => {
  const x = io({ posts: [POST], pages: LIVE_PAGE, io: { live: { since: '2026-11-06T00:00:00Z' } } });
  x.marks.p1 = { state: 'sending', at: new Date().toISOString(), tries: 1 };
  assert.deepStrictEqual((await bm.handle('check', {}, x)).sent, []);
});

test('test: goes only to the Test segment, and subscribes Ames again', async () => {
  const x = io({ posts: [POST], resendState: { contacts: { 'amyleerobinson@gmail.com': { id: 'c9', unsubscribed: true } }, segments: {} } });
  await bm.handle('test', { slug: 'new-post' }, x);
  const b = x.f.calls.find((c) => c.p === '/broadcasts');
  assert.strictEqual(b.body.segment_id, x.f.segments[bm.TEST_SEGMENT]);
  assert.notStrictEqual(b.body.segment_id, x.f.segments[bm.SEGMENT]);
  assert.strictEqual(x.f.contacts['amyleerobinson@gmail.com'].unsubscribed, false);
  await assert.rejects(bm.handle('test', { slug: 'missing' }, x), { status: 404 });
});

test('emailBody: videos, phone pictures, sizes and links become email safe', () => {
  const html = [
    '<div class="blog-post__video"><iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="YouTube video" loading="lazy"></iframe></div>',
    '<figure class="blog-post__figure blog-post__figure--small" data-size="small"><picture><source media="(max-width: 700px)" srcset="https://x/p.png" /><img src="https://x/a.png" alt="A" loading="lazy" /></picture><figcaption>Cap</figcaption></figure>',
    '<p>See <a href="/blog/">the blog</a>.</p>',
  ].join('\n');
  const out = bm.emailBody(html);
  assert.doesNotMatch(out, /<iframe|<picture|<source|<figure|class=/);
  assert.match(out, /https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk/);
  assert.match(out, /max-width:50%/);
  assert.match(out, /href="https:\/\/connectome\.quest\/blog\/"/);
});

test('excerpt: short posts go whole; long ones stop at a block, never inside code', () => {
  assert.deepStrictEqual(bm.excerpt('One.\n\nTwo.'), { md: 'One.\n\nTwo.', cut: false });
  const para = Array(120).fill('word').join(' ');
  const long = [para, '```\ncode line\n\nmore code\n```', para, '## Heading', para, para, para].join('\n\n');
  const { md, cut } = bm.excerpt(long);
  assert.strictEqual(cut, true);
  assert.strictEqual((md.match(/```/g) || []).length % 2, 0, 'a code fence is never cut in half');
  assert.doesNotMatch(md, /## Heading\s*$/, 'never ends on a heading');
});

// ── What's new in Pyr by email ──
function notesIo(extra = {}) {
  const x = io(extra);
  const store = {};
  x.notesStore = store;
  x.verify = async (t) => (t === 'good' ? { email: 'Player@Example.com' } : null);
  x.notesSubscribers = {
    get: async (e) => store[e] || null,
    set: async (e, v) => { store[e] = { ...store[e], ...v }; },
    list: async () => Object.values(store).filter((s) => s.on),
  };
  x.renderer = async () => (md) => md;
  return x;
}

test('notes: the box keeps the list in Pyr, never in a Resend segment', async () => {
  const x = notesIo();
  await assert.rejects(bm.handle('notes', { token: 'bad' }, x), /sign in/);
  assert.deepStrictEqual(await bm.handle('notes', { token: 'good' }, x), { on: false, email: 'player@example.com' });
  assert.deepStrictEqual(await bm.handle('notes', { token: 'good', on: true }, x), { on: true, email: 'player@example.com' });
  assert.strictEqual(x.f.calls.length, 0, 'the Resend plan has no room for another segment');
  const key = x.notesStore['player@example.com'].key;
  assert.ok(key && key.length >= 20);
  assert.strictEqual((await bm.handle('notes', { token: 'good' }, x)).on, true);
  await bm.handle('notes', { token: 'good', on: false }, x);
  assert.strictEqual(x.notesStore['player@example.com'].on, false);
  await bm.handle('notes', { token: 'good', on: true }, x);
  assert.strictEqual(x.notesStore['player@example.com'].key, key, 'the unsubscribe key stays the same');
});

test('notes-off: the link in the email takes you off, a wrong key does not', async () => {
  const x = notesIo();
  await bm.handle('notes', { token: 'good', on: true }, x);
  const key = x.notesStore['player@example.com'].key;
  await assert.rejects(bm.handle('notes-off', { e: 'player@example.com', k: 'guess' }, x), /does not work/);
  await assert.rejects(bm.handle('notes-off', { e: 'nobody@example.com', k: key }, x), /does not work/);
  assert.strictEqual(x.notesStore['player@example.com'].on, true);
  assert.deepStrictEqual(await bm.handle('notes-off', { e: 'Player@Example.com', k: key }, x), { on: false, email: 'player@example.com' });
  assert.strictEqual((await bm.handle('notes', { token: 'good' }, x)).on, false, 'the box shows it');
});

const WEEK = { id: 'w9', slug: 'whats-new-in-pyr-2026-11-09', title: 'Notes week of November 9', summary: 'Every update.', published_at: '2026-11-09T21:00:00Z',
  body: 'Intro.\n\n## Tuesday, November 10\n\nBig day.\n\n**Tool:** Does it.\n\n### All 2 updates\n\n- **A.** One.\n- **B.** Two.\n\n*Players made 5 edits and completed 1 cell.*\n\n## Monday, November 9\n\nSmall day.\n\n### The update\n\n- **C.** Three.\n\n---\n\n[The week before](/blog/whats-new-in-pyr-2026-11-02/)' };

test('notes: the email has each day\'s summary, not the full lists', () => {
  assert.strictEqual(bm.notesMarkdown(WEEK.body), 'Intro.\n\n## Tuesday, November 10\n\nBig day.\n\n**Tool:** Does it.\n\n## Monday, November 9\n\nSmall day.');
  const m = bm.postEmail(WEEK, (md) => md);
  assert.match(m.html, /Read every update on the blog/);
  assert.match(m.html, /asked for What's new in Pyr each week/);
});

test('check: a finished week goes once to its own list, never while it is still going', async () => {
  const pages = { 'https://connectome.quest/blog/whats-new-in-pyr-2026-11-09/': `<h1>${WEEK.title}</h1>` };
  const x = notesIo({ posts: [WEEK], pages, io: { notesLive: { since: '2026-11-01T00:00:00Z' } } });
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse('2026-11-15T22:00:00Z');   // Sunday: the week is not over
    assert.deepStrictEqual((await bm.handle('check', {}, x)).notes, undefined);
    Date.now = () => Date.parse('2026-11-16T15:00:00Z');   // the Monday after
    for (let i = 0; i < 150; i++) x.notesStore[`p${String(i).padStart(3, '0')}@example.com`] = { email: `p${String(i).padStart(3, '0')}@example.com`, on: true, key: `key${i}aaaaaaaaaaaaaaaaaa` };
    x.notesStore['gone@example.com'] = { email: 'gone@example.com', on: false, key: 'kgone' };
    assert.deepStrictEqual((await bm.handle('check', {}, x)).notes, [WEEK.slug]);
    const batches = x.f.calls.filter((c) => c.p === '/emails/batch');
    assert.deepStrictEqual(batches.map((c) => c.body.length), [100, 50], 'one email each, at most 100 a call');
    assert.ok(!x.f.calls.some((c) => c.p === '/broadcasts'), 'no Resend segment');
    const first = batches[0].body[0];
    assert.deepStrictEqual(first.to, ['p000@example.com']);
    const off = bm.notesOffUrl({ email: 'p000@example.com', key: 'key0aaaaaaaaaaaaaaaaaa' });
    assert.ok(first.html.includes(off.replace(/&/g, '&amp;')), 'her own unsubscribe link');
    assert.ok(!first.html.includes('RESEND_UNSUBSCRIBE_URL') && !first.text.includes('RESEND_UNSUBSCRIBE_URL'));
    assert.strictEqual(first.headers['List-Unsubscribe'], `<${off}>`);
    assert.ok(!batches.some((c) => c.body.some((m) => m.to[0] === 'gone@example.com')));
    assert.deepStrictEqual((await bm.handle('check', {}, x)).notes, undefined, 'never twice');
  } finally { Date.now = realNow; }
  assert.strictEqual(bm.NOTES_LIVE, false, 'nothing goes to real subscribers until Ames has seen a test');
});

test('check: a week that stopped part way goes on to the rest, not again to the first', async () => {
  const pages = { 'https://connectome.quest/blog/whats-new-in-pyr-2026-11-09/': `<h1>${WEEK.title}</h1>` };
  const x = notesIo({ posts: [WEEK], pages, io: { notesLive: { since: '2026-11-01T00:00:00Z' } } });
  for (let i = 0; i < 150; i++) x.notesStore[`p${String(i).padStart(3, '0')}@example.com`] = { email: `p${String(i).padStart(3, '0')}@example.com`, on: true, key: `k${i}` };
  const real = x.resend;
  let calls = 0;
  x.resend = async (p, init) => { if (p === '/emails/batch' && ++calls === 2) { const e = new Error('resend 500'); e.status = 500; e.resend = true; throw e; } return real(p, init); };
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse('2026-11-16T15:00:00Z');
    await assert.rejects(bm.handle('check', {}, x), /resend 500/);
    assert.strictEqual(x.marks[`notes:${WEEK.slug}`].done, 100);
    x.notesStore['p149@example.com'].on = false;   // left the list in between
    assert.deepStrictEqual((await bm.handle('check', {}, x)).notes, [WEEK.slug]);
    const sent = x.f.calls.filter((c) => c.p === '/emails/batch').flatMap((c) => c.body.map((m) => m.to[0]));
    assert.strictEqual(sent.length, 149);
    assert.strictEqual(new Set(sent).size, 149, 'nobody twice');
  } finally { Date.now = realNow; }
});
