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
// A suggestion waiting for approval (draft.*, tutorial-draft.*) gets its own
// note, "to approve", with the text now and as suggested (planApproveNote).
// It is sent here, on the server, because the game's own lookup of the
// approvers never found them (admins.user_id is empty).
//
// Not sent: an edit that changes nothing, and Ames's own edits.

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
    try { const j = JSON.parse(body); return [j.title, j.words].filter(Boolean).join('\n\n'); } catch (e) { /* plain */ }
  }
  return String(body);
}

/** Lines as a markdown quote, every character as written (escaped). */
function quote(text) {
  let t = String(text).trim();
  if (t.length > MAX_QUOTE) t = t.slice(0, MAX_QUOTE) + ' …';
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '> (empty)';
  // Colons and @ too: markdown makes a bare web address or email a link.
  return lines.map(l => '> ' + l.replace(/[\\`*_{}[\]()#+\-.!|<>~:@]/g, c => '\\' + c)).join('\n');
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
  const b = readable(key, before), a = readable(key, after);
  const beforeText = b == null ? '> (the original wording from the code)' : quote(b);
  const afterText = a == null ? '> (put back to the original wording from the code)' : quote(a);
  const body = `${who} edited **${where}**.\n\n**Before:**\n${beforeText}\n\n**After:**\n${afterText}`;
  return { title, body: fit(body, links), image: null };
}

const MAX_BODY = 1500;
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
  const n = readable(liveKey, live), s = readable(liveKey, suggested);
  const nowText = n == null ? '> (the original wording from the code)' : quote(n);
  const link = liveKey.startsWith('tutorial.') ? '[Open Tutorial edits](#nge-tutorial-edits) to approve or turn it down.'
    : `[Open it in the game](#nge-text-open=${liveKey}) to approve or turn it down.`;
  const body = `${who} suggested a change to **${where}**. Players see nothing until you approve it.\n\n**Now:**\n${nowText}\n\n**Suggested:**\n${quote(s)}`;
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
