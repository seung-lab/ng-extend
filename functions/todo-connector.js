'use strict';
/**
 * The To do board connector (Ames 2026-10-20: "let's add a connector"). An
 * MCP server, so an admin's own AI (Claude, or ChatGPT where the plan allows
 * custom connectors) can read and work the admins' To do board.
 *
 * The address is ewTodoConnector/<key>; "Connect your AI" on the board makes
 * it (todos.js, todo.key). Each request finds whose key it is, checks they are
 * still an admin, and then does exactly what the board does through
 * todoAction, signed "<name> (via AI)". It cannot delete a card.
 *
 * Plain JSON over HTTP POST (MCP streamable HTTP without a stream): every
 * call is answered at once, nothing is kept between calls.
 */
const { todoAction, hashKey } = require('./todos');

const LIST_WORDS = { todo: 'To do', doing: 'Doing', done: 'Done' };
const LIST_KEYS = { 'to do': 'todo', todo: 'todo', doing: 'doing', done: 'done' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const LINK_WORDS = { test: 'Test site', live: 'Live', pr: 'Pull request', doc: 'Doc', other: 'Link' };
const LINK_SCHEMA = { type: 'object', properties: {
  url: { type: 'string', description: 'An https address.' },
  kind: { type: 'string', enum: ['test', 'live', 'pr', 'doc', 'other'], description: 'test = a test site, live = the live page, pr = a pull request or branch, doc = a document.' },
  label: { type: 'string', description: 'A short name, for kind other.' } }, required: ['url'] };
/** A link's kind: given, or a Pyr test site recognized by its address. */
const linkKind = l => l.kind || (/-dot-brain-wire-dot-seung-lab\.ue\.r\.appspot\.com/.test(l.url || '') && !/^https:\/\/eyewire-ii-community-dot/.test(l.url || '') ? 'test' : 'other');

const TOOLS = [
  { name: 'list_cards', description: 'List the cards on the admins\' To do board, optionally only one list (To do, Doing, Done) or one owner. Done cards finished more than 14 days ago are left out unless asked for.',
    inputSchema: { type: 'object', properties: {
      list: { type: 'string', enum: ['To do', 'Doing', 'Done'], description: 'Only this list.' },
      owner: { type: 'string', description: 'Only cards owned by this admin (a name or first name), or "me", or "nobody".' },
      include_old_done: { type: 'boolean', description: 'Also list Done cards finished more than 14 days ago.' } } } },
  { name: 'get_card', description: 'Everything on one card: notes, checklist (numbered from 1), comments, size, owner, list, and the player report it came from.',
    inputSchema: { type: 'object', properties: { card: { type: 'string', description: 'The card id (the first 8 characters are enough).' } }, required: ['card'] } },
  { name: 'add_card', description: 'Add a card. It goes to the bottom of its list. Writing @Name (an admin) in the title or notes tags them: they get a bell in Pyr and a Slack ping.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string', description: 'A short title, 200 characters at most.' },
      notes: { type: 'string' },
      list: { type: 'string', enum: ['To do', 'Doing', 'Done'] },
      size: { type: 'string', enum: ['S', 'M', 'L'], description: 'S an hour or so, M a session or two, L days.' },
      owner: { type: 'string', description: 'An admin\'s name or first name, or "me".' },
      checklist: { type: 'array', items: { type: 'string' }, description: 'Checklist items.' },
      status: { type: 'string', description: 'One short line on where it stands, like "waiting for Celia\'s go".' },
      due: { type: 'string', description: 'A due day, YYYY-MM-DD.' },
      links: { type: 'array', items: LINK_SCHEMA, description: 'Links, such as the test site.' } }, required: ['title'] } },
  { name: 'update_card', description: 'Change a card: title, notes (replaces them), size, owner, or move it to another list. Only the fields given change. Newly written @Name tags notify that admin.',
    inputSchema: { type: 'object', properties: {
      card: { type: 'string', description: 'The card id (the first 8 characters are enough).' },
      title: { type: 'string' }, notes: { type: 'string' },
      size: { type: 'string', enum: ['S', 'M', 'L', 'none'] },
      owner: { type: 'string', description: 'An admin\'s name or first name, "me", or "nobody".' },
      list: { type: 'string', enum: ['To do', 'Doing', 'Done'] },
      status: { type: 'string', description: 'One short line on where it stands; empty clears it.' },
      due: { type: 'string', description: 'A due day, YYYY-MM-DD, or "none".' } }, required: ['card'] } },
  { name: 'link', description: 'Add a link to a card (a test site, the live page, a pull request or branch, a doc), or remove one by its number from get_card.',
    inputSchema: { type: 'object', properties: { card: { type: 'string' }, add: LINK_SCHEMA, remove: { type: 'integer', description: 'Link number to remove.' } }, required: ['card'] } },
  { name: 'checklist', description: 'Add an item to a card\'s checklist, or tick or untick an item by its number (from get_card).',
    inputSchema: { type: 'object', properties: {
      card: { type: 'string' },
      add: { type: 'string', description: 'Text of a new item.' },
      tick: { type: 'integer', description: 'Item number to tick.' },
      untick: { type: 'integer', description: 'Item number to untick.' } }, required: ['card'] } },
  { name: 'comment', description: 'Add a comment to a card. @Name tags an admin: a bell in Pyr and a Slack ping.',
    inputSchema: { type: 'object', properties: { card: { type: 'string' }, text: { type: 'string' } }, required: ['card', 'text'] } },
  { name: 'list_people', description: 'The admins who can own cards or be tagged.',
    inputSchema: { type: 'object', properties: {} } },
];

const INSTRUCTIONS = 'The admins\' To do board for Pyr (EyeWire II): their own planning, apart from player reports. ' +
  'Lists are To do, Doing and Done. Refer to cards by id from list_cards. Tag an admin by writing @ and their name. ' +
  'Everything you write is signed as the person who connected you, "(via AI)". You cannot delete cards.';

const userError = message => Object.assign(new Error(message), { status: 400, forUser: true });

/** An admin by name: whole name, first name, or the start of it. */
function personByName(name, people, me) {
  const q = String(name || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) throw userError('Say whose card it is.');
  if (q === 'me' || q === 'myself') return me;
  const exact = people.filter(p => p.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const starts = people.filter(p => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/)[0] === q);
  if (starts.length === 1) return starts[0];
  throw userError(`${starts.length ? 'More than one' : 'No'} admin matches "${name}". Admins: ${people.map(p => p.name).join(', ')}.`);
}

/** Admins tagged in a text: "@" and their whole name or their first name. */
function tagIdsIn(text, people) {
  const t = String(text || '').toLowerCase();
  return people.filter(p => {
    const full = '@' + p.name.toLowerCase();
    const first = '@' + p.name.toLowerCase().split(/\s+/)[0];
    return t.includes(full) || new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(t);
  }).map(p => p.id);
}

function cardByRef(ref, cards) {
  const r = String(ref || '').trim().toLowerCase();
  if (r.length < 6) throw userError('Give the card id (at least its first 6 characters) from list_cards.');
  const hits = cards.filter(c => c.id.toLowerCase().startsWith(r));
  if (hits.length !== 1) throw userError(hits.length ? 'More than one card starts with that id; give more of it.' : 'No card has that id. Use list_cards.');
  return hits[0];
}

const listKey = l => {
  const k = LIST_KEYS[String(l || '').trim().toLowerCase()];
  if (!k) throw userError('The lists are To do, Doing and Done.');
  return k;
};

function cardLine(c, people) {
  const owner = people.find(p => p.id === c.owner_id);
  const done = c.checklist.filter(i => i.done).length;
  return `- ${c.title}  (id ${c.id.slice(0, 8)}, ${LIST_WORDS[c.list]}${c.size ? `, size ${c.size}` : ''}${owner ? `, owner ${owner.name}` : ''}` +
    `${c.checklist.length ? `, checklist ${done}/${c.checklist.length}` : ''}${c.comments.length ? `, ${c.comments.length} comment${c.comments.length === 1 ? '' : 's'}` : ''}` +
    `${c.due_on ? `, due ${c.due_on}` : ''}${(c.links || []).length ? `, ${(c.links || []).length} link${(c.links || []).length === 1 ? '' : 's'}` : ''})` +
    `${c.status ? `\n    status: ${c.status}` : ''}`;
}

function cardText(c, people, site) {
  const owner = people.find(p => p.id === c.owner_id);
  const lines = [
    `${c.title}`,
    `id ${c.id} · ${LIST_WORDS[c.list]} · size ${c.size || 'not set'} · owner ${owner ? owner.name : 'nobody'}`,
    `Added by ${c.created_by || 'someone'} on ${String(c.created_at).slice(0, 10)}${c.done_at ? `, done ${String(c.done_at).slice(0, 10)}` : ''}`,
    c.triage_id ? `Made from a player report: ${site}/?triage=board&report=${c.triage_id}` : '',
    `Open it: ${site}/?triage=board&todo=${c.id}`,
    c.status ? `Status: ${c.status}` : '',
    c.due_on ? `Due: ${c.due_on}` : '',
    (c.links || []).length ? 'Links:\n' + (c.links || []).map((l, k) => `${k + 1}. ${l.label || LINK_WORDS[l.kind] || 'Link'}: ${l.url}`).join('\n') : '',
    '', 'Notes:', c.notes || '(none)',
    '', 'Checklist:', c.checklist.length ? c.checklist.map((i, k) => `${k + 1}. [${i.done ? 'x' : ' '}] ${i.text}`).join('\n') : '(none)',
    '', 'Comments:', c.comments.length ? c.comments.map(m => `${m.by}, ${String(m.at).slice(0, 16).replace('T', ' ')} UTC: ${m.text}`).join('\n') : '(none)',
  ];
  return lines.filter(l => l !== '' && l !== undefined).join('\n').replace(/\n(Notes:|Checklist:|Comments:)/g, '\n\n$1');
}

/** One tool call. ctx: { db, me: {id, name}, byName, tag, site }. */
async function callTool(name, a, ctx) {
  const { db, me, site } = ctx;
  const act = (action, args) => todoAction(action, args, { db, me: { id: me.id }, byName: ctx.byName, tag: ctx.tag });
  const board = async () => act('todo.list', {});
  a = a || {};

  if (name === 'list_people') {
    const { people } = await board();
    return people.map(p => `- ${p.name}${p.id === me.id ? ' (you)' : ''}`).join('\n');
  }
  if (name === 'list_cards') {
    const { cards, people } = await board();
    let rows = cards;
    if (a.list) rows = rows.filter(c => c.list === listKey(a.list));
    if (a.owner) {
      const o = String(a.owner).trim().toLowerCase();
      rows = o === 'nobody' ? rows.filter(c => !c.owner_id) : rows.filter(c => c.owner_id === personByName(a.owner, people, me).id);
    }
    if (!a.include_old_done) rows = rows.filter(c => !(c.list === 'done' && c.done_at && Date.now() - Date.parse(c.done_at) > 14 * 864e5));
    if (!rows.length) return 'No cards match.';
    const out = [];
    for (const l of ['todo', 'doing', 'done']) {
      const these = rows.filter(c => c.list === l).sort((x, y) => x.rank - y.rank);
      if (these.length) out.push(`${LIST_WORDS[l]} (${these.length}):`, ...these.map(c => cardLine(c, people)), '');
    }
    return out.join('\n').trim();
  }
  if (name === 'get_card') {
    const { cards, people } = await board();
    return cardText(cardByRef(a.card, cards), people, site);
  }
  if (name === 'add_card') {
    const { people } = await board();
    const fields = { title: a.title, notes: a.notes || '' };
    if (a.list) fields.list = listKey(a.list);
    if (a.size) fields.size = a.size;
    if (a.owner) fields.owner_id = personByName(a.owner, people, me).id;
    if (Array.isArray(a.checklist)) fields.checklist = a.checklist.map(t => ({ text: String(t), done: false }));
    if (a.status) fields.status = a.status;
    if (a.due) fields.due_on = a.due;
    if (Array.isArray(a.links)) fields.links = a.links.map(l => ({ url: l.url, kind: linkKind(l), label: l.label || '' }));
    const { card } = await act('todo.save', { fields, tagIds: tagIdsIn(`${a.title} ${a.notes || ''} ${(a.checklist || []).join(' ')}`, people) });
    return `Added: ${cardLine(card, people)}`;
  }
  if (name === 'update_card') {
    const { cards, people } = await board();
    const c = cardByRef(a.card, cards);
    const fields = {};
    if (a.title !== undefined) fields.title = a.title;
    if (a.notes !== undefined) fields.notes = a.notes;
    if (a.size !== undefined) fields.size = a.size === 'none' ? null : a.size;
    if (a.owner !== undefined) fields.owner_id = String(a.owner).trim().toLowerCase() === 'nobody' ? null : personByName(a.owner, people, me).id;
    if (a.list !== undefined) fields.list = listKey(a.list);
    if (a.status !== undefined) fields.status = a.status;
    if (a.due !== undefined) fields.due_on = String(a.due).trim().toLowerCase() === 'none' ? null : a.due;
    if (!Object.keys(fields).length) throw userError('Nothing to change: give a title, notes, size, owner, list, status or due day.');
    const old = new Set(tagIdsIn(`${c.title} ${c.notes}`, people));
    const tagIds = tagIdsIn(`${fields.title ?? ''} ${fields.notes ?? ''}`, people).filter(id => !old.has(id));
    const { card } = await act('todo.save', { id: c.id, fields, tagIds });
    return `Updated: ${cardLine(card, people)}`;
  }
  if (name === 'link') {
    const { cards, people } = await board();
    const c = cardByRef(a.card, cards);
    let links = (c.links || []).map(l => ({ ...l }));
    if (a.remove !== undefined) {
      if (!Number.isInteger(a.remove) || a.remove < 1 || a.remove > links.length) throw userError(`Link numbers on this card run from 1 to ${links.length}.`);
      links.splice(a.remove - 1, 1);
    }
    if (a.add) links = [...links, { url: a.add.url, kind: linkKind(a.add), label: a.add.label || '' }];
    if (a.remove === undefined && !a.add) throw userError('Say what link to add or remove.');
    const { card } = await act('todo.save', { id: c.id, fields: { links } });
    return cardText(card, people, site);
  }
  if (name === 'checklist') {
    const { cards, people } = await board();
    const c = cardByRef(a.card, cards);
    let list = c.checklist.map(i => ({ ...i }));
    const at = n => {
      if (!Number.isInteger(n) || n < 1 || n > list.length) throw userError(`Item numbers on this card run from 1 to ${list.length}.`);
      return n - 1;
    };
    if (a.tick !== undefined) list[at(a.tick)].done = true;
    if (a.untick !== undefined) list[at(a.untick)].done = false;
    if (a.add) list = [...list, { text: String(a.add), done: false }];
    if (a.tick === undefined && a.untick === undefined && !a.add) throw userError('Say what to add, tick or untick.');
    const { card } = await act('todo.save', { id: c.id, fields: { checklist: list }, tagIds: a.add ? tagIdsIn(a.add, people) : [] });
    return cardText(card, people, site).split('\n\nComments:')[0];
  }
  if (name === 'comment') {
    const { cards, people } = await board();
    const c = cardByRef(a.card, cards);
    await act('todo.comment', { id: c.id, text: a.text, tagIds: tagIdsIn(a.text, people) });
    return `Commented on "${c.title}".`;
  }
  throw userError(`There is no tool called ${name}.`);
}

/**
 * Answers one HTTP request. deps: { db, key, makeCtx(person) }.
 * Returns { status, body } (body null for "accepted, nothing to say").
 */
async function handleConnector(method, key, body, deps) {
  if (method !== 'POST') return { status: 405, body: { error: 'POST only' } };
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(key || ''))) return { status: 404, body: { error: 'Unknown connector address' } };
  const row = await deps.db.keyOwner(hashKey(key));
  if (!row) return { status: 404, body: { error: 'This connector address is switched off. Make a new one on the To do board.' } };
  const people = await deps.db.people();
  const me = people.find(p => p.id === row.user_id);
  if (!me) return { status: 403, body: { error: 'Only admins can use the To do board.' } };
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 3600e3) await deps.db.keyUsed(row.id);
  const ctx = deps.makeCtx(me);

  const one = async msg => {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid request' } };
    }
    if (msg.id === undefined) return null;   // a notification: nothing to answer
    const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params && msg.params.protocolVersion;
        return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'pyr-todo-board', version: '1.0.0' }, instructions: INSTRUCTIONS });
      }
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const p = msg.params || {};
        try {
          const text = await callTool(p.name, p.arguments, ctx);
          return reply({ content: [{ type: 'text', text }] });
        } catch (e) {
          // Rule errors go back to the AI to fix; anything else stays vague.
          const said = e && e.status ? e.message : 'The board could not do that just now. Try again in a moment.';
          if (!(e && e.status)) console.warn('[todo connector]', p.name, e && e.message);
          return reply({ content: [{ type: 'text', text: said }], isError: true });
        }
      }
      default: return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } };
    }
  };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(one))).filter(Boolean);
    return { status: out.length ? 200 : 202, body: out.length ? out : null };
  }
  const out = await one(body);
  return { status: out ? 200 : 202, body: out };
}

module.exports = { handleConnector, callTool, tagIdsIn, personByName, TOOLS };
