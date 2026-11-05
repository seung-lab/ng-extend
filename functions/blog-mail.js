// Blog email for connectome.quest (Ames 2026-11-05: "new blog posts emailed,
// nicely formatted, to subscribers, with a working unsubscribe").
//
// The list lives in Resend (Ames's account): one global contact list, grouped
// into Segments. A contact must be in a Segment to get a Broadcast, and Resend
// gives every Broadcast its own one click unsubscribe ({{{RESEND_UNSUBSCRIBE_URL}}})
// and keeps the unsubscribed list itself. Needs a FULL ACCESS key
// (RESEND_FULL_KEY): the sending only key cannot touch contacts or broadcasts.
//
// Actions (index.js ewBlogMail, all public, all from connectome.quest):
//   subscribe  {name, email, username?, source?, _honey?}  the signup forms.
//   check      {}  the blog build (every 15 minutes) asks: is a post new?
//              Each post goes once, only after its page is live, and only
//              posts published after LIVE_SINCE. Nothing goes while LIVE is false.
//   test       {slug}  the same email, sent only to the Test segment (Ames).
//
// Nothing here talks to the network itself: index.js passes in resend(),
// posts(), page(), renderer() and the Firestore stores, so the tests can too.

const SITE = 'https://connectome.quest';
const FROM = 'Map the Brain <blog@connectome.quest>';
const REPLY_TO = 'support@eyewire.ai';
const SEGMENT = 'connectome.quest blog';
const TEST_SEGMENT = 'connectome.quest blog test';
// Who the Test segment holds (Ames 2026-11-05: a test only to her).
const TEST_EMAILS = ['amyleerobinson@gmail.com'];
// Real subscribers get nothing until Ames has seen a test and said go.
const LIVE = false;
// Posts published before this are never emailed (set when LIVE turns on), so
// switching on does not send the old posts.
const LIVE_SINCE = '2099-01-01T00:00:00Z';
// Long posts: the opening, up to about this many words, then "Read the rest".
const EXCERPT_WORDS = 320;
const WHOLE_POST_WORDS = 600;

function fail(status, message) { const e = new Error(message); e.status = status; throw e; }

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
function cleanEmail(v) {
  const email = String(v || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) fail(400, 'Please check your email address.');
  return email;
}
function cleanText(v, max) {
  return String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ── Resend helpers ────────────────────────────────────────────────────────
/** A segment's id by name, made the first time it is asked for. */
async function segmentId(resend, name, cache) {
  if (cache && cache[name]) return cache[name];
  const list = await resend('/segments');
  let seg = (list.data || []).find((s) => s.name === name);
  if (!seg) seg = await resend('/segments', { method: 'POST', body: { name } });
  if (cache) cache[name] = seg.id;
  return seg.id;
}

/** Add or update a contact, subscribed, and put it in the segment. */
async function upsertContact(resend, { email, name }, segId) {
  let existing = null;
  try { existing = await resend(`/contacts/${encodeURIComponent(email)}`); }
  catch (e) { if (e.status !== 404) throw e; }
  if (existing && existing.id) {
    // Signing up again means they want it again, even after an unsubscribe.
    await resend(`/contacts/${encodeURIComponent(email)}`, { method: 'PATCH',
      body: { unsubscribed: false, ...(name ? { first_name: name } : {}) } });
  } else {
    await resend('/contacts', { method: 'POST', body: { email, first_name: name || '', unsubscribed: false } });
  }
  await resend(`/contacts/${encodeURIComponent(email)}/segments/${segId}`, { method: 'POST' });
  return existing && existing.id ? 'again' : 'new';
}

// ── subscribe ─────────────────────────────────────────────────────────────
async function subscribe(a, io) {
  // The forms' bot trap: a bot that filled it is told yes and nothing happens.
  if (a._honey) return { ok: true };
  const email = cleanEmail(a.email);
  const name = cleanText(a.name, 80);
  if (!name) fail(400, 'Please add your name.');
  const username = cleanText(a.username, 60);
  const source = ['home', 'blog'].includes(a.source) ? a.source : 'other';
  // Our own copy first, so a Resend outage loses nobody.
  await io.subscribers.set(email, { email, name, username, source, at: new Date().toISOString(), resend: false });
  const segId = await segmentId(io.resend, SEGMENT, io.cache);
  const kind = await upsertContact(io.resend, { email, name }, segId);
  await io.subscribers.update(email, { resend: true });
  return { ok: true, again: kind === 'again' };
}

// ── The email ─────────────────────────────────────────────────────────────
const C = { bg: '#f4f6fa', card: '#ffffff', ink: '#0b101a', text: '#151b27', soft: '#5a6578', teal: '#0a7286', line: '#e3e7ef' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const postUrl = (slug) => `${SITE}/blog/${slug}/`;
function day(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
const words = (md) => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/@\[\w+\]\([^)]*\)/g, ' ')
  .replace(/[#>*_`\[\]()-]/g, ' ').split(/\s+/).filter(Boolean).length;

/** The opening of a long post: whole blocks (split at blank lines, never
 *  inside a code fence) until about EXCERPT_WORDS. A short post goes whole. */
function excerpt(md) {
  const text = String(md || '').replace(/\r\n?/g, '\n');
  if (words(text) <= WHOLE_POST_WORDS) return { md: text, cut: false };
  const blocks = [];
  let cur = [], fence = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    if (!fence && !line.trim()) { if (cur.length) blocks.push(cur.join('\n')); cur = []; }
    else cur.push(line);
  }
  if (cur.length) blocks.push(cur.join('\n'));
  const kept = [];
  let n = 0;
  for (const b of blocks) {
    if (kept.length && n + words(b) > EXCERPT_WORDS) break;
    kept.push(b);
    n += words(b);
    if (n >= EXCERPT_WORDS) break;
  }
  // Never end on a heading, or on a section's first line or two ("What don't
  // we know?" then "Quite a lot, actually."): stop before that section.
  const head = (b) => /^#{1,3}\s/.test(b);
  const last = kept.length - 1 - [...kept].reverse().findIndex(head);
  if (last > 0 && last < kept.length && words(kept.slice(last + 1).join(' ')) < 60) kept.length = last;
  return { md: kept.join('\n\n'), cut: kept.length < blocks.length };
}

const S = {
  p: `margin:0 0 16px;font:16px/1.6 ${FONT};color:${C.text}`,
  h2: `margin:28px 0 12px;font:700 22px/1.3 ${FONT};color:${C.ink}`,
  h3: `margin:24px 0 10px;font:700 18px/1.35 ${FONT};color:${C.ink}`,
  list: `margin:0 0 16px;padding:0 0 0 24px;font:16px/1.6 ${FONT};color:${C.text}`,
  li: 'margin:0 0 6px',
  a: `color:${C.teal};text-decoration:underline`,
  quote: `margin:0 0 16px;padding:4px 0 4px 16px;border-left:3px solid ${C.teal};color:${C.soft}`,
  callout: `margin:0 0 16px;padding:14px 16px 2px;background:#eaf5f7;border-radius:10px`,
  img: 'display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:10px',
  fig: 'margin:0 0 16px',
  cap: `margin:6px 0 0;font:13px/1.5 ${FONT};color:${C.soft}`,
  pre: `margin:0 0 16px;padding:12px 14px;background:#eef1f6;border-radius:8px;font:13px/1.5 Menlo,Consolas,monospace;color:${C.ink};white-space:pre-wrap;word-break:break-word`,
  code: `padding:1px 4px;background:#eef1f6;border-radius:4px;font:14px Menlo,Consolas,monospace`,
  hr: `border:0;border-top:1px solid ${C.line};margin:24px 0`,
  button: `display:inline-block;padding:13px 26px;background:${C.teal};color:#ffffff;border-radius:999px;font:700 16px/1 ${FONT};text-decoration:none`,
};
const SIZE_MAX = { small: '50%', medium: '75%' };

/** The blog's own rendered HTML (assets/blog.js renderBlogMarkdown), made safe
 *  for email: inline styles, no iframes or <picture>, absolute links. */
function emailBody(html) {
  return String(html)
    // A video becomes its picture, linked to YouTube.
    .replace(/<div class="blog-post__video"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})"[^>]*><\/iframe><\/div>/g,
      (m, id) => `<p style="${S.p}"><a href="https://www.youtube.com/watch?v=${id}"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="Watch the video on YouTube" style="${S.img}" /></a></p>`)
    // A picture with a phone version: email gets the main one.
    .replace(/<picture><source [^>]*\/>(<img [^>]*\/>)<\/picture>/g, '$1')
    .replace(/<div class="blog-post__pair">/g, '<div>')
    .replace(/<figure class="blog-post__figure(?: blog-post__figure--(\w+))?"(?: data-size="\w+")?>/g,
      (m, size) => `<div style="${S.fig}${SIZE_MAX[size] ? `;max-width:${SIZE_MAX[size]}` : ''}">`)
    .replace(/<\/figure>/g, '</div>')
    .replace(/<figcaption>/g, `<p style="${S.cap}">`).replace(/<\/figcaption>/g, '</p>')
    .replace(/<img ([^>]*?)\s*loading="lazy"\s*\/>/g, `<img $1 style="${S.img}" />`)
    .replace(/<aside class="blog-post__callout">/g, `<div style="${S.callout}">`).replace(/<\/aside>/g, '</div>')
    .replace(/<p class="blog-post__cta"><a class="blog-post__button" /g, `<p style="${S.p};text-align:center"><a style="${S.button}" `)
    .replace(/<p>/g, `<p style="${S.p}">`)
    .replace(/<h2>/g, `<h2 style="${S.h2}">`).replace(/<h3>/g, `<h3 style="${S.h3}">`)
    .replace(/<(ul|ol)>/g, `<$1 style="${S.list}">`).replace(/<li>/g, `<li style="${S.li}">`)
    .replace(/<blockquote><p style="[^"]*">/g, `<blockquote style="${S.quote}"><p style="${S.p};color:${C.soft}">`)
    .replace(/<pre><code>/g, `<pre style="${S.pre}"><code>`)
    .replace(/<code>/g, `<code style="${S.code}">`)
    .replace(/<hr \/>/g, `<hr style="${S.hr}" />`)
    // Links: absolute, and styled unless they are the button.
    .replace(/<a href="\/(?!\/)/g, `<a href="${SITE}/`)
    .replace(/<a href="/g, `<a style="${S.a}" href="`);
}

/** Subject, HTML and plain text for one post. render = BlogRender.renderBlogMarkdown. */
function postEmail(post, render) {
  const url = postUrl(post.slug);
  const title = String(post.title || '').trim();
  const summary = String(post.summary || '').trim();
  const { md, cut } = excerpt(post.body);
  const body = emailBody(render(md));
  const cover = /^https:\/\//.test(post.cover_url || '')
    ? `<tr><td style="padding:0"><a href="${esc(url)}"><img src="${esc(post.cover_url)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0" /></a></td></tr>` : '';
  const meta = [day(post.published_at), post.author_name ? esc(post.author_name) : ''].filter(Boolean).join(' · ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" /><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(summary || title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:0 4px 14px;font:700 13px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase"><a href="${SITE}/blog/" style="color:${C.teal};text-decoration:none"><img src="${SITE}/assets/images/favicon-pyr.png" width="20" height="20" alt="" style="vertical-align:middle;border:0;border-radius:4px;margin-right:8px" />Map the Brain blog</a></td></tr>
<tr><td style="background:${C.card};border-radius:16px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cover}
<tr><td style="padding:28px 28px 8px">
<h1 style="margin:0 0 8px;font:800 28px/1.25 ${FONT};color:${C.ink}"><a href="${esc(url)}" style="color:${C.ink};text-decoration:none">${esc(title)}</a></h1>
${meta ? `<p style="margin:0 0 22px;font:14px/1.4 ${FONT};color:${C.soft}">${meta}</p>` : ''}
${body}
${cut ? `<p style="${S.p};color:${C.soft}">The post goes on from here.</p>` : ''}
<p style="margin:28px 0 24px;text-align:center"><a href="${esc(url)}" style="${S.button}">Read it on the blog</a></p>
</td></tr></table></td></tr>
<tr><td style="padding:20px 8px 8px;text-align:center;font:13px/1.6 ${FONT};color:${C.soft}">
You're getting this because you signed up at <a href="${SITE}/" style="color:${C.soft}">connectome.quest</a>.<br />
<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${C.soft}">Unsubscribe</a> any time, in one click.<br />
Seung Lab, Princeton University</td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, meta.replace(/&[a-z#0-9]+;/g, ''), '', summary, '', `Read it on the blog: ${url}`, '',
    'You\'re getting this because you signed up at connectome.quest.', 'Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}'].join('\n');
  return { subject: title, html, text };
}

// ── Sending ───────────────────────────────────────────────────────────────
/** Is the post's page live, with its title in it? A link to a page that is
 *  not built yet would greet subscribers with a 404. */
async function pageIsLive(io, post) {
  try {
    const html = await io.page(postUrl(post.slug));
    return !!html && html.includes(esc(String(post.title || '').trim()));
  } catch (e) { return false; }
}

async function broadcast(io, post, segName, label) {
  const render = await io.renderer();
  const msg = postEmail(post, render);
  const segment_id = await segmentId(io.resend, segName, io.cache);
  const b = await io.resend('/broadcasts', { method: 'POST', body: {
    segment_id, from: FROM, reply_to: REPLY_TO, subject: msg.subject, html: msg.html, text: msg.text,
    name: `${label}: ${String(post.title).slice(0, 80)}` } });
  await io.resend(`/broadcasts/${b.id}/send`, { method: 'POST' });
  return b.id;
}

async function check(a, io) {
  // io.live: the tests only. The deployed function uses the constants.
  const live = io.live || (LIVE ? { since: LIVE_SINCE } : null);
  if (!live) return { live: false, sent: [] };
  const since = Date.parse(live.since);
  const posts = (await io.posts()).filter((p) => p.slug && p.title && Date.parse(p.published_at) > since);
  const sent = [];
  // Oldest first, and at most two a run: a burst of posts goes out over runs.
  for (const post of posts.sort((x, y) => String(x.published_at).localeCompare(String(y.published_at)))) {
    if (sent.length >= 2) break;
    const mark = await io.sentPosts.get(post.id);
    if (mark && mark.state === 'sent') continue;
    if (mark && mark.state === 'sending' && Date.now() - Date.parse(mark.at) < 30 * 60000) continue;
    if (mark && (mark.tries || 0) >= 3) continue;
    if (!(await pageIsLive(io, post))) continue;
    // Claim it first, so two runs at once cannot both send.
    if (!(await io.sentPosts.claim(post.id, { slug: post.slug, title: post.title, state: 'sending', at: new Date().toISOString(), tries: ((mark && mark.tries) || 0) + 1 }, mark))) continue;
    try {
      const id = await broadcast(io, post, SEGMENT, 'Blog');
      await io.sentPosts.set(post.id, { state: 'sent', broadcast: id, sentAt: new Date().toISOString() });
      sent.push(post.slug);
    } catch (e) {
      await io.sentPosts.set(post.id, { state: 'failed', error: String(e && e.message).slice(0, 300) });
      throw e;
    }
  }
  return { live: true, sent };
}

async function test(a, io) {
  const slug = String(a.slug || '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(400, 'Which post?');
  const post = (await io.posts()).find((p) => p.slug === slug);
  if (!post) fail(404, 'No published post has that address.');
  const segId = await segmentId(io.resend, TEST_SEGMENT, io.cache);
  // Ames may have tried the Unsubscribe link in the last test: a new test
  // subscribes her again, or it would never arrive.
  for (const email of TEST_EMAILS) await upsertContact(io.resend, { email, name: 'Ames' }, segId);
  return { ok: true, broadcast: await broadcast(io, post, TEST_SEGMENT, 'TEST') };
}

async function handle(action, a, io) {
  if (action === 'subscribe') return subscribe(a || {}, io);
  if (action === 'check') return check(a || {}, io);
  if (action === 'test') return test(a || {}, io);
  fail(400, 'Unknown action.');
}

module.exports = { handle, postEmail, emailBody, excerpt, cleanEmail, LIVE, LIVE_SINCE, SEGMENT, TEST_SEGMENT };
