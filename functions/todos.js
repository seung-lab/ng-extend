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
 *   todo.commentEdit  {id, index, text}: its writer changes a comment; the
 *                 first wording is kept as `original` (Ames 2026-11-05: "edit
 *                 ... comments with show original")
 *   todo.helpers  {id, ids}: a card's collaborators, beside its one owner
 *                 (Ames 2026-11-05: "add a second person to todo card"). They
 *                 hear they were added, and follow the card.
 *   todo.follow   follow or stop following a card (Ames 2026-11-02, from
 *                 Asana): followers hear in the bell when it changes
 *
 * Checklist items can have their own owner and due day (subtasks, the same
 * ask). Followers live apart from the card (deps.follows, Firestore in
 * index.js), so no new column: the card's maker, its owner and anyone who
 * comments follow it on their own, and anyone can stop.
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
    out.checklist = f.checklist.map(c => {
      const item = { text: text(c && c.text, 300, 'A checklist item').trim(), done: !!(c && c.done) };
      if (c && c.due) {
        if (!/^\d{4}-\d\d-\d\d$/.test(String(c.due))) fail(400, 'A due date is a day, like 2026-10-31.');
        item.due = String(c.due);
      }
      if (c && c.owner_id) item.owner_id = uuid(c.owner_id, 'item owner');
      return item;
    }).filter(c => c.text);
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

/** What changed, in words, for a follower's bell. Only a move in the list says nothing. */
function changeWords(fields, before) {
  if ('list' in fields && fields.list !== before.list) return fields.list === 'done' ? 'finished' : `moved to ${fields.list === 'doing' ? 'Doing' : 'To do'}`;
  if ('checklist' in fields) {
    const was = before.checklist || [], now = fields.checklist;
    const ticked = now.filter((c, i) => c.done && !(was[i] && was[i].done) && was[i] && was[i].text === c.text);
    if (ticked.length === 1) return `ticked "${ticked[0].text.slice(0, 80)}" on`;
    if (now.length > was.length) return 'added to the checklist on';
    return 'updated the checklist on';
  }
  if ('owner_id' in fields) return 'changed who owns';
  if ('due_on' in fields) return 'changed the due day of';
  if (['title', 'notes', 'status', 'links', 'images'].some(k => k in fields)) return 'updated';
  return '';
}
const noFollows = { all: async () => ({}), get: async () => [], set: async () => {} };
const HELPERS_MAX = 6;

async function todoAction(action, args, {db, me, byName, tag, follows = noFollows, helpers = noFollows, bell = async () => {}, connectorBase = CONNECTOR_BASE}) {
  const now = new Date().toISOString();
  const meId = me && me.id;
  /** Followers hear, but never the one who did it, nor anyone already told. */
  // Followers hear only that a card is finished (Ames 2026-11-05: "I don't want
  // all these notifications - only ones where I am tagged or something is
  // marked done"). Tags, and being given a card, still reach people as before.
  const tellFollowers = async (card, what, said, skip = []) => {
    if (what !== 'finished') return;
    const ids = (await follows.get(card.id)).filter(id => id !== meId && !skip.includes(id));
    if (ids.length) await bell(ids, card, what, said);
  };
  const follow = async (cardId, ids) => {
    const had = await follows.get(cardId);
    const next = [...new Set([...had, ...ids.filter(Boolean)])];
    if (next.length !== had.length) await follows.set(cardId, next);
  };
  if (action === 'todo.list') {
    const [cards, people, followers, helping] = await Promise.all([db.cards(), db.people(), follows.all().catch(() => ({})), helpers.all().catch(() => ({}))]);
    return { cards, people: people.map(p => ({ id: p.id, name: p.name })), followers, helpers: helping };
  }
  if (action === 'todo.commentEdit') {
    const id = uuid(args.id, 'card');
    const body = text(args.text, COMMENT_MAX, 'The comment').trim();
    if (!body) fail(400, 'Write something first.');
    const before = await db.card(id);
    if (!before) fail(404, 'That card is gone. Refresh the board.');
    const i = Number(args.index);
    const list = [...(before.comments || [])];
    const old = Number.isInteger(i) ? list[i] : null;
    if (!old) fail(404, 'That comment is gone. Refresh the board.');
    if (old.by !== byName) fail(403, 'Only the person who wrote a comment can change it.');
    if (old.text === body) return { card: before };
    list[i] = { ...old, text: body, edited_at: now, original: old.original ?? old.text };
    return { card: await db.patch(id, { comments: list, updated_at: now }) };
  }
  if (action === 'todo.helpers') {
    const id = uuid(args.id, 'card');
    if (!Array.isArray(args.ids) || args.ids.length > HELPERS_MAX) fail(400, `At most ${HELPERS_MAX} collaborators.`);
    const ids = [...new Set(args.ids.map(x => uuid(x, 'collaborator')))];
    const card = await db.card(id);
    if (!card) fail(404, 'That card is gone. Refresh the board.');
    const people = await db.people();
    if (ids.some(x => !people.some(p => p.id === x))) fail(400, 'A collaborator must be an admin on the board.');
    const had = await helpers.get(id);
    await helpers.set(id, ids);
    const added = ids.filter(x => !had.includes(x));
    if (added.length) {
      await follow(id, added).catch(() => {});
      const told = people.filter(p => added.includes(p.id) && p.id !== meId);
      if (told.length) await tag(told, card, 'added you as a collaborator on');
    }
    return { id, helpers: ids };
  }
  if (action === 'todo.follow') {
    const id = uuid(args.id, 'card');
    if (!meId) fail(403, 'No Pyr profile.');
    const had = await follows.get(id);
    const next = args.on === false ? had.filter(x => x !== meId) : [...new Set([...had, meId])];
    await follows.set(id, next);
    return { id, followers: next };
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
      await follow(card.id, [meId, fields.owner_id]).catch(() => {});
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
        await follow(id, [fields.owner_id]).catch(() => {});
      }
      card.__changed = changeWords(fields, before);
    }
    const people = (Array.isArray(args.tagIds) && args.tagIds.length) ? await db.people() : [];
    const who = tagged(people, args.tagIds).filter(p => p.id !== (me && me.id));
    if (who.length) await tag(who, card, 'tagged you on');
    const changed = card.__changed;
    delete card.__changed;
    if (!isNew) await tellFollowers(card, changed, '', [...who.map(p => p.id), fields.owner_id].filter(Boolean)).catch(e => console.warn('[todo] followers not told:', e.message));
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
    await follow(id, [meId]).catch(() => {});
    await tellFollowers(card, 'commented on', body, who.map(p => p.id)).catch(e => console.warn('[todo] followers not told:', e.message));
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
  // Tagging Marissa on a card still pings her in Slack (Ames 2026-10-27).
  { match: /^(marissa|m sorek|sorek)/i, id: 'U033TSX9A' },
];
function slackIdOf(person) {
  for (const s of SLACK_IDS) if (s.match.test(person.name || '') || s.match.test(person.email || '')) return s.id;
  return null;
}

/** Followers: the bell only, no Slack, so following stays quiet. */
function makeFollowBell({ sb, site, byName, meId }) {
  return async (ids, card, what, said) => {
    const link = `${site}/?triage=board&todo=${card.id}`;
    const quote = String(said || '').replace(/\s+/g, ' ').slice(0, 200);
    const rows = ids.map(id => ({ title: `📋 ${byName} ${what} a To do you follow`.slice(0, 120),
      body: `${card.title}${quote ? `\n\n"${quote}"` : ''}\n\n${link}`.slice(0, 500),
      target_type: 'user', target_id: id, send_at: new Date().toISOString(), created_by: meId || null }));
    try { await sb('notifications', { method: 'POST', body: JSON.stringify(rows) }); }
    catch (e) { console.warn('[todo] follower bell failed:', e.message); }
  };
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

module.exports = { todoAction, restDb, slackIdOf, cleanFields, makeTagger, hashKey, newKey, CONNECTOR_BASE, makeFollowBell };
