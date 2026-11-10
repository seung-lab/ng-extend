'use strict';

// A note to Ames for every edit an admin makes to an in-game window, with the
// window before and after (Ames 2026-11-06: "send me a notification every
// time an admin makes an edit to an in-game window with before/after").
//
// Every admin edit of an in-game window is a site text (src/site_texts.ts):
// the Cilia Quest's intro, steps and picture, the Cell Library how-tos, the
// Hunt's instructions, and tutorial boxes (tutorial.<tutorial>.<box>, JSON).
// ewCommunityData (index.js) reads the text before the write and, once the
// write went through, asks planEditNote what to send. It is decided here, on
// the server, so no edit can skip it.
//
// Not sent: suggestions waiting for approval (draft.*, tutorial-draft.*), as
// the approvers already get "to approve" for those; an edit that changes
// nothing; and Ames's own edits.

/** Ames's accounts: the note goes to them, and their own edits send none. */
const OWNER_EMAILS = ['amylr@princeton.edu', 'amyleerobinson@gmail.com'];
/** The bell's Admin tab takes titles that start with 📋 (src/util/notif_kinds.ts). */
const TITLE_MARK = '📋 ';
const MAX_QUOTE = 1400;

const TUTORIALS = {
  1: 'Get Started', 2: 'Advanced Interface', 3: 'Merge', 4: 'Site Tour', 5: 'Cut',
  6: 'Meet the cells of MEC', 7: 'Meet the cells of the retina', 8: 'Meet the cells of the fly brain',
  9: 'Merger Sandbox', 10: 'Meet the cells of CA3', 11: 'Proofreading Test', 13: 'Extension Sandbox',
};
const NAMED = {
  'quest.retina_cilia.lead': 'Cilia Quest instructions, the intro',
  'quest.retina_cilia.steps': 'Cilia Quest instructions, the steps',
  'quest.retina_cilia.image': 'Cilia Quest instructions, the picture',
  'howto.retina': 'Cell Library how-to, Retina',
};

const isDraft = (key) => /^(draft\.|tutorial-draft\.)/.test(key);
const isPicture = (key) => /\.image$/.test(key);

/** The window an edit is in, in words. */
function windowName(key) {
  if (NAMED[key]) return NAMED[key];
  const t = /^tutorial\.(\d+)\.(\d+)$/.exec(key);
  if (t) return `Tutorial ${TUTORIALS[t[1]] || t[1]}, box ${Number(t[2]) + 1}`;
  if (key.startsWith('howto.')) return `Cell Library how-to (${key.slice(6)})`;
  if (key.startsWith('hunt.')) return 'Hunt instructions';
  return `In-game text "${key}"`;
}

/** A saved body as the words a person reads: a tutorial box is JSON. */
function readable(key, body) {
  if (body == null) return null;
  if (/^tutorial\./.test(key)) {
    try { const j = JSON.parse(body); return plainBox([j.title, j.words].filter(Boolean).join('\n\n')); } catch (e) { /* plain */ }
  }
  return String(body);
}

/** The code's wording a tutorial edit replaced, kept in its JSON as "from". */
function codeWordingOf(key, after) {
  if (!/^tutorial\./.test(key) || after == null) return null;
  try { const f = JSON.parse(after).from; return f ? plainBox([f.title, f.words].filter(Boolean).join('\n\n')) || null : null; } catch (e) { return null; }
}

/** A tutorial box as a player reads it: no HTML tags, no ** or __ markers. */
const plainBox = (t) => t.replace(/<[^>]*>/g, '').replace(/\*\*|__/g, '').replace(/[ \t]+/g, ' ');

/** Lines as a markdown quote, every character as written (escaped). */
function quote(text) {
  let t = String(text).trim();
  if (t.length > MAX_QUOTE) t = t.slice(0, MAX_QUOTE) + ' …';
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '> (empty)';
  // Colons and @ too: markdown makes a bare web address or email a link.
  return lines.map(l => '> ' + l.replace(/[\\`*_{}[\]()#+\-.!|<>~:@]/g, c => '\\' + c)).join('\n');
}

const escapeMd = (w) => w.replace(/[\\`*_{}[\]()#+\-.!|<>~:@]/g, c => '\\' + c);
/** Words and line breaks, for comparing two texts. */
const tokens = (text) => {
  let t = String(text).trim();
  if (t.length > MAX_QUOTE) t = t.slice(0, MAX_QUOTE) + ' …';
  return t.match(/[^\s]+|\n/g) || [];
};

/**
 * Before and after as quotes, the changed words marked: struck through in
 * Before (removed), bold in After (added). Word by word, longest common
 * run. `onlyChanged` keeps just the lines with a change, for a long text.
 */
function diffQuotes(beforeText, afterText, onlyChanged = false) {
  const x = tokens(beforeText), y = tokens(afterText);
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const keptX = new Array(n).fill(false), keptY = new Array(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (x[i] === y[j]) { keptX[i++] = true; keptY[j++] = true; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return { before: render(x, keptX, '~~', onlyChanged), after: render(y, keptY, '**', onlyChanged) };
}

/** Tokens as quote lines; a run of changed words on a line is wrapped in `mark`. */
function render(toks, kept, mark, onlyChanged) {
  const lines = [];
  let words = [], run = [], changed = false;
  const flushRun = () => { if (run.length) { words.push(mark + run.join(' ') + mark); run = []; } };
  const endLine = () => { flushRun(); if (words.length) lines.push({ text: words.join(' '), changed }); words = []; changed = false; };
  toks.forEach((t, i) => {
    if (t === '\n') { endLine(); return; }
    if (kept[i]) { flushRun(); words.push(escapeMd(t)); }
    else { run.push(escapeMd(t)); changed = true; }
  });
  endLine();
  if (!lines.length) return '> (empty)';
  let shown = lines;
  if (onlyChanged) {
    shown = [];
    for (const l of lines) {
      if (l.changed) shown.push(l);
      else if (!shown.length || shown[shown.length - 1].text !== '…') shown.push({ text: '…' });
    }
  }
  return shown.map(l => '> ' + l.text).join('\n');
}

/** Our own uploaded pictures only, as https links. */
const OWN_PICTURE = /^https:\/\/javthknksdcrlhiaaptj\.supabase\.co\/storage\/v1\/object\/public\/admin-uploads\/[A-Za-z0-9/_.-]+$/;
function pictureWords(body) {
  if (body == null) return 'The original picture';
  if (body.trim() === 'none') return 'No picture';
  return OWN_PICTURE.test(body.trim()) ? `[The new picture](${body.trim()})` : 'A picture';
}

/**
 * What to send for one edit, or null for none.
 *   key     the site text's key
 *   before  its saved body before the write, or null when the code's own
 *           wording showed (no saved text)
 *   after   its saved body after the write, or null when it was removed
 *           (Restore original)
 *   editor  { email, name }
 */
function planEditNote({ key, before, after, editor }) {
  if (typeof key !== 'string' || !key || isDraft(key)) return null;
  const email = String((editor && editor.email) || '').trim().toLowerCase();
  if (OWNER_EMAILS.includes(email)) return null;
  if ((before ?? null) === (after ?? null)) return null;
  const who = String((editor && editor.name) || 'An admin').slice(0, 80);
  const where = windowName(key);
  const title = `${TITLE_MARK}Edited: ${where}`.slice(0, 120);
  if (isPicture(key)) {
    const image = after && OWN_PICTURE.test(after.trim()) ? after.trim() : null;
    const body = `${who} changed the picture in **${where}**.\n\n**Before:** ${pictureWords(before)}\n\n**After:** ${pictureWords(after)}`;
    return { title, body: body.slice(0, 1500), image };
  }
  // A tutorial box that showed the code's wording: the edit keeps that wording as "from".
  const b = readable(key, before) ?? codeWordingOf(key, after), a = readable(key, after);
  let beforeText = b == null ? '> (the original wording from the code)' : quote(b);
  let afterText = a == null ? '> (put back to the original wording from the code)' : quote(a);
  // Both known: the words that changed stand out (Ames 2026-11-10: "highlight the difference").
  if (b != null && a != null) {
    const d = diffQuotes(b, a);
    beforeText = d.before; afterText = d.after;
    if (`${beforeText}\n${afterText}`.length > 1300) { const s = diffQuotes(b, a, true); beforeText = s.before; afterText = s.after; }
  }
  let body = `${who} edited **${where}**.\n\n**Before:**\n${beforeText}\n\n**After:**\n${afterText}`;
  if (body.length > 1500) body = body.slice(0, 1497) + '…';
  return { title, body, image: null };
}

/** The keys a site_texts write touches: an upsert's rows, or a delete's key=eq. filter. */
function editedKeys(method, query, body) {
  if (method === 'DELETE') {
    const k = /^eq\.(.+)$/.exec(query.get('key') || '');
    return k ? [k[1]] : [];
  }
  if (method === 'POST' || method === 'PATCH') {
    const rows = Array.isArray(body) ? body : body ? [body] : [];
    const keys = rows.map(r => r && r.key).filter(k => typeof k === 'string');
    if (!keys.length && method === 'PATCH') { const k = /^eq\.(.+)$/.exec(query.get('key') || ''); if (k) keys.push(k[1]); }
    return keys;
  }
  return [];
}

module.exports = { planEditNote, editedKeys, windowName, OWNER_EMAILS, OWN_PICTURE };
