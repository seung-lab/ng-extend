'use strict';
/**
 * The admins' To do board (supabase-admin-todos.sql, Ames 2026-10-19): a
 * planning board apart from player reports, with lists To do, Doing and Done,
 * cards with notes, a checklist, a size, an owner, comments and @ tags.
 *
 * todoAction(action, args, {db, me, byName, tag}) is the whole surface, for
 * admins only (index.js checks that first). `db` is a small set of reads and
 * writes (restDb below, over the service key; the tests pass one in memory).
 * `tag(people, card, what)` tells the admins who were tagged or given the
 * card: a bell notification in Pyr and a Slack message.
 *
 *   todo.list     every card, and the admins who can be tagged
 *   todo.save     a new card (no id) or changed fields of one card
 *   todo.comment  adds one comment to a card
 *   todo.delete   removes a card for good
 *
 * A card made from a player report (fields.triage_id) also puts that report
 * on the To do list on the triage board, so the robot never builds it, and
 * "closeReport" with a move to Done closes the report too.
 */
const LISTS = ['todo', 'doing', 'done'];
const SIZES = ['S', 'M', 'L'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECK_MAX = 60;
const LINKS_MAX = 20;
const IMAGES_MAX = 10;
/** Images added on the board: our own storage, the todo-images folder. */
const TODO_IMAGES = 'https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/public/admin-uploads/todo-images/';
/** Test site, live, pull request or branch, doc, anything else. */
const LINK_KINDS = ['test', 'live', 'pr', 'doc', 'other'];
const COMMENT_MAX = 2000;
const COMMENTS_MAX = 200;

const crypto = require('crypto');
const CONNECTOR_BASE = 'https://us-central1-eyewire-ii-e4d52.cloudfunctions.net/ewTodoConnector';
const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');
function newKey() {
  const key = crypto.randomBytes(24).toString('base64url');
  return { key, hash: hashKey(key) };
}

const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const uuid = (v, what) => { const s = String(v || ''); if (!UUID.test(s)) fail(400, `Bad ${what}.`); return s.toLowerCase(); };
const text = (v, max, what) => {
  const s = String(v ?? '').replace(/\r\n?/g, '\n');
  if (s.length > max) fail(400, `${what} is too long (${max} characters at most).`);
  return s;
};

/** Only the fields a card may have, each checked. */
function cleanFields(f, isNew) {
  const out = {};
  if ('title' in f || isNew) {
    const t = text(f.title, 200, 'The title').trim();
    if (!t) fail(400, 'A card needs a title.');
    out.title = t;
  }
  if ('notes' in f) out.notes = text(f.notes, 8000, 'The notes');
  if ('list' in f) { if (!LISTS.includes(f.list)) fail(400, 'Bad list.'); out.list = f.list; }
  if ('rank' in f) { if (!Number.isFinite(f.rank)) fail(400, 'Bad rank.'); out.rank = f.rank; }
  if ('size' in f) { if (f.size !== null && !SIZES.includes(f.size)) fail(400, 'Bad size.'); out.size = f.size; }
  if ('owner_id' in f) out.owner_id = f.owner_id === null ? null : uuid(f.owner_id, 'owner');
  if ('checklist' in f) {
    if (!Array.isArray(f.checklist) || f.checklist.length > CHECK_MAX) fail(400, 'Bad checklist.');
    out.checklist = f.checklist.map(c => ({ text: text(c && c.text, 300, 'A checklist item').trim(), done: !!(c && c.done) }))
      .filter(c => c.text);
  }
  // Optional extras (supabase-admin-todos-fields.sql, Ames 2026-10-21).
  if ('status' in f) out.status = text(f.status, 200, 'The status').replace(/\s+/g, ' ').trim();
  if ('due_on' in f) {
    if (f.due_on !== null && f.due_on !== '' && !/^\d{4}-\d\d-\d\d$/.test(String(f.due_on))) fail(400, 'A due date is a day, like 2026-10-31.');
    out.due_on = f.due_on || null;
  }
  if ('links' in f) {
    if (!Array.isArray(f.links) || f.links.length > LINKS_MAX) fail(400, `At most ${LINKS_MAX} links.`);
    out.links = f.links.map(l => {
      const url = String((l && l.url) || '').trim();
      if (!/^https:\/\/[^\s"'<>]+$/.test(url) || url.length > 500) fail(400, 'A link must be one https address.');
      const kind = LINK_KINDS.includes(l.kind) ? l.kind : 'other';
      return { kind, url, label: text((l && l.label) || '', 40, 'A link name').trim() };
    });
  }
  if ('images' in f) {
    if (!Array.isArray(f.images) || f.images.length > IMAGES_MAX) fail(400, `At most ${IMAGES_MAX} images.`);
    out.images = f.images.map(u => {
      const url = String(u || '');
      if (!url.startsWith(TODO_IMAGES) || url.length > 500 || !/^[^\s"'<>]+$/.test(url)) fail(400, 'An image must be one added on the board.');
      return url;
    });
  }
  if (isNew && f.triage_id) out.triage_id = uuid(f.triage_id, 'report');
  return out;
}

/** The admins who can be tagged, from tagIds, and only those. */
function tagged(people, ids) {
  if (!Array.isArray(ids)) return [];
  const want = new Set(ids.map(String));
  return people.filter(p => want.has(p.id));
}

async function todoAction(action, args, {db, me, byName, tag, connectorBase = CONNECTOR_BASE}) {
  const now = new Date().toISOString();
  if (action === 'todo.list') {
    const [cards, people] = await Promise.all([db.cards(), db.people()]);
    return { cards, people: people.map(p => ({ id: p.id, name: p.name })) };
  }

  if (action === 'todo.save') {
    const isNew = !args.id;
    const fields = cleanFields(args.fields || {}, isNew);
    let card;
    if (isNew && fields.triage_id) {
      // A report already on the board keeps its one card: it comes back to To do.
      const had = await db.cardByReport(fields.triage_id);
      if (had) {
        await db.reportToTodo(fields.triage_id, byName);
        return { card: had.list === 'done' ? await db.patch(had.id, { list: 'todo', done_at: null, updated_at: now }) : had };
      }
    }
    if (isNew) {
      if (!('list' in fields)) fields.list = 'todo';
      if (!('rank' in fields)) fields.rank = (await db.maxRank(fields.list)) + 1;
      card = await db.insert({ ...fields, created_by: byName, updated_at: now, done_at: fields.list === 'done' ? now : null });
      if (fields.triage_id) await db.reportToTodo(fields.triage_id, byName);
      // Given to someone else as it is made: they hear about it.
      if (fields.owner_id && fields.owner_id !== (me && me.id)) {
        const owner = (await db.people()).filter(p => p.id === fields.owner_id);
        if (owner.length) await tag(owner, card, 'gave you');
      }
    } else {
      const id = uuid(args.id, 'card');
      const before = await db.card(id);
      if (!before) fail(404, 'That card is gone. Refresh the board.');
      if ('list' in fields && fields.list !== before.list) {
        fields.done_at = fields.list === 'done' ? now : null;
        // Moved without a place: the bottom of its new list.
        if (!('rank' in fields)) fields.rank = (await db.maxRank(fields.list)) + 1;
      }
      card = await db.patch(id, { ...fields, updated_at: now });
      if (fields.list === 'done' && args.closeReport && before.triage_id) await db.closeReport(before.triage_id, byName);
      // Given the card: they hear about it, unless they gave it to themselves.
      if (fields.owner_id && fields.owner_id !== before.owner_id && fields.owner_id !== (me && me.id)) {
        const people = await db.people();
        const owner = people.filter(p => p.id === fields.owner_id);
        if (owner.length) await tag(owner, card, 'gave you');
      }
    }
    const people = (Array.isArray(args.tagIds) && args.tagIds.length) ? await db.people() : [];
    const who = tagged(people, args.tagIds).filter(p => p.id !== (me && me.id));
    if (who.length) await tag(who, card, 'tagged you on');
    return { card };
  }

  if (action === 'todo.comment') {
    const id = uuid(args.id, 'card');
    const body = text(args.text, COMMENT_MAX, 'The comment').trim();
    if (!body) fail(400, 'Write something first.');
    const before = await db.card(id);
    if (!before) fail(404, 'That card is gone. Refresh the board.');
    const comments = [...(before.comments || []), { by: byName, text: body, at: now }].slice(-COMMENTS_MAX);
    const card = await db.patch(id, { comments, updated_at: now });
    const people = (Array.isArray(args.tagIds) && args.tagIds.length) ? await db.people() : [];
    const who = tagged(people, args.tagIds).filter(p => p.id !== (me && me.id));
    if (who.length) await tag(who, card, 'tagged you on', body);
    return { card };
  }

  // The connector address (supabase-admin-todo-keys.sql): one per admin. A
  // new one switches the old one off; the key is shown once, kept hashed.
  if (action === 'todo.keyStatus') {
    const k = await db.activeKey(me.id);
    return { connected: !!k, created_at: k ? k.created_at : null, last_used_at: k ? k.last_used_at : null };
  }
  if (action === 'todo.key') {
    await db.revokeKeys(me.id);
    if (args.off) return { connected: false };
    const { key, hash } = newKey();
    await db.addKey(me.id, hash);
    return { connected: true, url: `${connectorBase}/${key}` };
  }

  if (action === 'todo.delete') {
    const id = uuid(args.id, 'card');
    await db.remove(id);
    return { deleted: id };
  }

  fail(400, `unknown action ${action}`);
}

// Slack ids of the admins, so a tag pings them (the bot has no users:read).
// Matched on the start of the Pyr name or the email.
const SLACK_IDS = [
  { match: /^(amy|ames)\b|^amy/i, id: 'U02FH1DRC' },
  { match: /^celia/i, id: 'U033NHWDE' },
  { match: /^(marissa|m sorek|sorek)/i, id: 'U033TSX9A' },
];
function slackIdOf(person) {
  for (const s of SLACK_IDS) if (s.match.test(person.name || '') || s.match.test(person.email || '')) return s.id;
  return null;
}

/** Tells the people tagged on (or given) a card: the bell in Pyr, and a
 *  Slack ping in #citsci_feedback with a link to the card. */
function makeTagger({ sb, slackPost, slackToken, channel, site, byName, meId }) {
  return async (people, card, what, said) => {
    const link = `${site}/?triage=board&todo=${card.id}`;
    const quote = String(said || '').replace(/\s+/g, ' ').slice(0, 200);
    const rows = people.map(p => ({ title: `📋 ${byName} ${what} a To do`.slice(0, 120),
      body: `${card.title}${quote ? `\n\n"${quote}"` : ''}\n\n${link}`.slice(0, 500),
      target_type: 'user', target_id: p.id, send_at: new Date().toISOString(), created_by: meId || null }));
    try { await sb('notifications', { method: 'POST', body: JSON.stringify(rows) }); }
    catch (e) { console.warn('[todo] bell failed:', e.message); }
    const pings = people.map(p => { const id = slackIdOf(p); return id ? `<@${id}>` : `@${p.name}`; }).join(' ');
    try {
      const r = await slackPost(slackToken, 'chat.postMessage', { channel, unfurl_links: false,
        text: `📋 ${pings} ${byName} ${what} a To do: *${card.title}*${quote ? `\n> ${quote}` : ''}\n<${link}|Open it on the To do board>` });
      if (!r.ok) console.warn('[todo] slack failed:', r.error);
    } catch (e) { console.warn('[todo] slack failed:', e.message); }
  };
}

/** The database, over the service key. `sb` is index.js's ewSb(key). */
function restDb(sb) {
  const enc = encodeURIComponent;
  return {
    cards: () => sb('admin_todos?select=*&order=list.asc,rank.asc&limit=500'),
    card: async id => (await sb(`admin_todos?id=eq.${id}&select=*&limit=1`))[0] || null,
    cardByReport: async id => (await sb(`admin_todos?triage_id=eq.${id}&select=*&limit=1`))[0] || null,
    maxRank: async list => {
      const r = await sb(`admin_todos?list=eq.${list}&select=rank&order=rank.desc&limit=1`);
      return r[0] ? Number(r[0].rank) : 0;
    },
    insert: async row => (await sb('admin_todos', { method: 'POST', body: JSON.stringify(row) }))[0],
    patch: async (id, row) => (await sb(`admin_todos?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(row) }))[0],
    remove: id => sb(`admin_todos?id=eq.${id}`, { method: 'DELETE' }),
    activeKey: async userId => (await sb(`admin_todo_keys?user_id=eq.${userId}&revoked_at=is.null&select=created_at,last_used_at&order=created_at.desc&limit=1`))[0] || null,
    revokeKeys: userId => sb(`admin_todo_keys?user_id=eq.${userId}&revoked_at=is.null`, { method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString() }) }),
    addKey: (userId, hash) => sb('admin_todo_keys', { method: 'POST', body: JSON.stringify({ user_id: userId, key_hash: hash }) }),
    /** Whose key this is, if it is still on. */
    keyOwner: async hash => (await sb(`admin_todo_keys?key_hash=eq.${hash}&revoked_at=is.null&select=id,user_id,last_used_at&limit=1`))[0] || null,
    keyUsed: id => sb(`admin_todo_keys?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ last_used_at: new Date().toISOString() }) }),
    /** Every admin with a Pyr profile: id, name, email. */
    people: async () => {
      const emails = (await sb('admins?select=email')).map(a => String(a.email || '').toLowerCase()).filter(Boolean);
      if (!emails.length) return [];
      const list = emails.map(e => '"' + e.replace(/["\\]/g, '') + '"').join(',');
      const users = await sb(`users?select=id,display_name,username,middleauth_email&middleauth_email=in.(${enc(list)})`);
      return users.map(u => ({ id: u.id, name: u.display_name || u.username || u.middleauth_email, email: u.middleauth_email }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    /** The report goes on the To do list on the triage board: the robot never builds it. */
    reportToTodo: (id, by) => sb(`feedback_triage?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({
      status: 'approved', impl_state: null, approver_note: 'To do: on the To do board, not being built by the robot.',
      reviewed_by: by, reviewed_at: new Date().toISOString() }) }),
    closeReport: (id, by) => sb(`feedback_triage?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({
      status: 'done', result_note: `Done on the To do board, closed by ${by}.`,
      reviewed_by: by, reviewed_at: new Date().toISOString() }) }),
  };
}

module.exports = { todoAction, restDb, slackIdOf, cleanFields, makeTagger, hashKey, newKey, CONNECTOR_BASE };
