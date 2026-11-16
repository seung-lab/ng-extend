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
// Each note ends with two links (Ames 2026-11-09: "the notif before and after
// is ok and I can revert or open to edit from there"): Put back the old text
// (the edit's row in site_text_edits, #nge-text-revert=<id>) and Open to edit
// (#nge-text-open=<key>). The game handles both (src/text_edit_links.ts).
//
// planApproveNote words a "to approve" note for a suggestion waiting for
// approval (draft.*, the Hunt's and 2D Tools' instructions). It is ready but
// not switched on in index.js (Ames 2026-11-10 asked for the two links only).
//
// Not sent: suggestions waiting for approval, an edit that changes nothing,
// and Ames's own edits.

/** Ames's accounts: the note goes to them, and their own edits send none. */
const OWNER_EMAILS = ['amylr@princeton.edu', 'amyleerobinson@gmail.com'];
/** The bell's Admin tab takes titles that start with 📋 (src/util/notif_kinds.ts). */
const TITLE_MARK = '📋 ';
const MAX_QUOTE = 3000;
const MAX_BODY = 6000; // the bell scrolls a long note (Ames 2026-11-10: "we need scroll if needed")

const TUTORIALS = {
  1: 'Get Started', 2: 'Advanced Interface', 3: 'Merge', 4: 'Site Tour', 5: 'Cut',
  6: 'Meet the cells of MEC', 7: 'Meet the cells of the retina', 8: 'Meet the cells of the fly brain',
  9: 'Merger Sandbox', 10: 'Meet the cells of CA3', 11: 'Proofreading Test', 13: 'Extension Sandbox', 14: 'Cilia Quest Training',
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
    try { const j = JSON.parse(body); return [j.title, j.words].filter(Boolean).join('\n\n'); } catch (e) { /* plain */ }
  }
  return String(body);
}

/** The code's wording a tutorial edit replaced, kept in its JSON as "from". */
function codeWordingOf(key, after) {
  if (!/^tutorial\./.test(key) || after == null) return null;
  try { const f = JSON.parse(after).from; return f ? [f.title, f.words].filter(Boolean).join('\n\n') || null : null; } catch (e) { return null; }
}

const escapeMd = (w) => w.replace(/[\\`*_{}[\]()#+\-.!|<>~:@]/g, c => '\\' + c);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/**
 * The words of a text as a player reads them (Ames 2026-11-10: "show me the
 * actual formatting in the notif not the html"): each word with its bold and
 * slanted, from ** and * or <strong> and <em>; a picture is 🖼; every other
 * tag is dropped. Line breaks are kept as '\n'. Only bold and slanted ever
 * reach the note: nothing an editor typed becomes a link or a tag.
 */
function styledWords(text) {
  let t = String(text).trim();
  if (t.length > MAX_QUOTE) t = t.slice(0, MAX_QUOTE) + ' …';
  t = t.replace(/<a\b[^>]*>\s*open in new tab[^<]*<\/a>/gi, '')
    .replace(/<img\b[^>]*>/gi, ' 🖼 ')
    .replace(/<br\s*\/?>|<\/(?:p|div|figure|figcaption|li|h\d|ul|ol)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ');
  const out = [];
  let b = false, i = false;
  const re = /<(\/?)(strong|b|em|i)\b[^>]*>|<[^>]*>|\*\*|\*|\n|&(#?\w+);|[^\s<*&]+|&|[ \t\r]+/g;
  // A piece is glued to the one before when no space came between them
  // ("<b>M</b>." is a bold M and a plain full stop, one word).
  let m, word = '', gap = true;
  const push = () => { if (word) { out.push({ w: word, b, i, glue: !gap }); word = ''; gap = false; } };
  while ((m = re.exec(t))) {
    const s = m[0], next = t[re.lastIndex] || ' ', prev = t[m.index - 1] || ' ';
    if (m[2]) { push(); const on = !m[1]; if (/^(strong|b)$/i.test(m[2])) b = on; else i = on; continue; }
    if (s[0] === '<') { push(); continue; }
    if (s === '\n') { push(); out.push('\n'); b = i = false; gap = true; continue; }
    if (/^[ \t\r]+$/.test(s)) { push(); gap = true; continue; }
    if (s === '**' || s === '*') {
      const open = s === '**' ? !b : !i;
      if ((open && /\S/.test(next)) || (!open && /\S/.test(prev))) { push(); if (s === '**') b = open; else i = open; continue; }
    }
    if (m[3]) { word += ENTITIES[m[3].toLowerCase()] ?? s; continue; }
    word += s;
  }
  push();
  while (out[0] === '\n') out.shift();
  return out;
}
const sameWord = (a, c) => a === c || (a !== '\n' && c !== '\n' && a.w === c.w && a.b === c.b && a.i === c.i);

/** Parts joined, a space only where the text had one. */
const joinParts = (parts) => parts.map((p, k) => (k && !p.glue ? ' ' : '') + p.text).join('');

/** Words with their bold and slanted, as bell markup: { text, glue }. */
function styled(words) {
  const groups = [];
  let k = 0;
  while (k < words.length) {
    const { b, i } = words[k];
    const group = [];
    while (k < words.length && words[k].b === b && words[k].i === i) { group.push({ text: escapeMd(words[k].w), glue: words[k].glue }); k++; }
    let g = joinParts(group);
    if (i) g = `<em>${g}</em>`;
    if (b) g = `<strong>${g}</strong>`;
    groups.push({ text: g, glue: group[0].glue });
  }
  return { text: joinParts(groups), glue: groups[0].glue };
}

/** Tokens as quote lines; a run of changed words is wrapped in `tag` (mark: added, del: removed). */
function render(toks, kept, tag, onlyChanged) {
  const lines = [];
  let parts = [], run = [], same = [], changed = false;
  const flushSame = () => { if (same.length) { parts.push(styled(same)); same = []; } };
  const flushRun = () => { if (run.length) { const r = styled(run); parts.push({ text: `<${tag}>${r.text}</${tag}>`, glue: r.glue }); run = []; } };
  const endLine = () => { flushSame(); flushRun(); if (parts.length) lines.push({ text: joinParts(parts), changed }); parts = []; changed = false; };
  toks.forEach((t, k) => {
    if (t === '\n') { endLine(); return; }
    if (kept[k]) { flushRun(); same.push(t); } else { flushSame(); run.push(t); changed = true; }
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

/** A text as a quote, formatted as players see it. */
function quote(text) {
  const x = styledWords(text);
  return render(x, x.map(() => true), 'mark', false);
}

/**
 * Before and after as quotes, the changed words marked: struck through in
 * Before (removed), highlighted in After (added). Word by word, longest
 * common run. `onlyChanged` keeps just the lines with a change, for a long text.
 */
function diffQuotes(beforeText, afterText, onlyChanged = false) {
  const x = styledWords(beforeText), y = styledWords(afterText);
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = sameWord(x[i], y[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const keptX = new Array(n).fill(false), keptY = new Array(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (sameWord(x[i], y[j])) { keptX[i++] = true; keptY[j++] = true; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return { before: render(x, keptX, 'del', onlyChanged), after: render(y, keptY, 'mark', onlyChanged) };
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
function planEditNote({ key, before, after, editor, editId }) {
  if (typeof key !== 'string' || !key || isDraft(key)) return null;
  const email = String((editor && editor.email) || '').trim().toLowerCase();
  if (OWNER_EMAILS.includes(email)) return null;
  if ((before ?? null) === (after ?? null)) return null;
  const who = String((editor && editor.name) || 'An admin').slice(0, 80);
  const where = windowName(key);
  const title = `${TITLE_MARK}Edited: ${where}`.slice(0, 120);
  const links = editLinks(key, editId, isPicture(key) ? 'Put back the old picture' : 'Put back the old text');
  if (isPicture(key)) {
    const image = after && OWN_PICTURE.test(after.trim()) ? after.trim() : null;
    const body = `${who} changed the picture in **${where}**.\n\n**Before:** ${pictureWords(before)}\n\n**After:** ${pictureWords(after)}`;
    return { title, body: fit(body, links), image };
  }
  // A tutorial box that showed the code's wording: the edit keeps that wording as "from".
  const b = readable(key, before) ?? codeWordingOf(key, after), a = readable(key, after);
  let beforeText = b == null ? '> (the original wording from the code)' : quote(b);
  let afterText = a == null ? '> (put back to the original wording from the code)' : quote(a);
  // Both known: the words that changed stand out (Ames 2026-11-10: "highlight the difference").
  if (b != null && a != null) {
    const d = diffQuotes(b, a);
    beforeText = d.before; afterText = d.after;
    if (`${beforeText}\n${afterText}`.length > MAX_BODY - 600) { const s = diffQuotes(b, a, true); beforeText = s.before; afterText = s.after; }
  }
  const body = `${who} edited **${where}**.\n\n**Before:**\n${beforeText}\n\n**After:**\n${afterText}`;
  return { title, body: fit(body, links), image: null };
}

/** The note's two links: always kept whole, the quotes shortened instead. */
function editLinks(key, editId, revertWords) {
  const out = [];
  if (Number.isInteger(editId) && editId > 0) out.push(`[${revertWords}](#nge-text-revert=${editId})`);
  if (/^[a-z0-9_.-]{1,64}$/.test(key)) out.push(`[Open to edit](#nge-text-open=${key})`);
  return out.join(' · ');
}
function fit(body, links) {
  const tail = links ? `\n\n${links}` : '';
  const room = MAX_BODY - tail.length;
  return (body.length > room ? body.slice(0, room - 1) + '…' : body) + tail;
}

/** The live key a suggestion is for: draft.<key>, tutorial-draft.<t>.<b>. */
function liveKeyOf(draftKey) {
  if (draftKey.startsWith('draft.')) return draftKey.slice(6);
  if (draftKey.startsWith('tutorial-draft.')) return 'tutorial.' + draftKey.slice(15);
  return null;
}

/**
 * The note for a suggestion waiting for approval, or null for none.
 *   key        the draft's key (draft.<key> or tutorial-draft.<t>.<b>)
 *   live       the text players see now (null: the code's own wording)
 *   suggested  the suggestion as saved (null: it was removed, approved or
 *              turned down, which sends nothing)
 */
function planApproveNote({ key, live, suggested, editor }) {
  if (typeof key !== 'string' || !isDraft(key) || suggested == null) return null;
  const email = String((editor && editor.email) || '').trim().toLowerCase();
  if (OWNER_EMAILS.includes(email)) return null;
  const liveKey = liveKeyOf(key);
  if (!liveKey) return null;
  const who = String((editor && editor.name) || 'An admin').slice(0, 80);
  const where = windowName(liveKey);
  const title = `${TITLE_MARK}Edit to approve: ${where}`.slice(0, 120);
  const n = readable(liveKey, live) ?? codeWordingOf(liveKey, suggested), s = readable(liveKey, suggested);
  let nowText = n == null ? '> (the original wording from the code)' : quote(n);
  let sugText = quote(s);
  if (n != null) { const d = diffQuotes(n, s); nowText = d.before; sugText = d.after; }
  const link = liveKey.startsWith('tutorial.') ? '[Open Tutorial edits](#nge-tutorial-edits) to approve or turn it down.'
    : `[Open it in the game](#nge-text-open=${liveKey}) to approve or turn it down.`;
  const body = `${who} suggested a change to **${where}**. Players see nothing until you approve it.\n\n**Now:**\n${nowText}\n\n**Suggested:**\n${sugText}`;
  return { title, body: fit(body, link), image: null };
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

module.exports = { planEditNote, planApproveNote, liveKeyOf, editedKeys, windowName, isDraft, OWNER_EMAILS, OWN_PICTURE };
