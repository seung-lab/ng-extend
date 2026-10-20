'use strict';
/**
 * Notes on a triage card, with no decision (Celia #178, Ames 2026-10-20 "do
 * it all"): "a way to leave notes on entries in the triage panel without
 * submitting any other actions". A note changes nothing else on the card:
 * not its status, not the robot, nothing to the submitter.
 *
 * Kept in feedback_triage.admin_notes (supabase-triage-notes.sql), apart
 * from feedback_log, which the bridge rewrites from its own copy.
 * "@Celia" (an admin's first or whole name) tags them: a bell in Pyr, and a
 * ping in the report's own Slack thread (or the channel, when it has none).
 * The bridge ignores the bot's posts, so a note never counts as a reply.
 */
const { tagIdsIn } = require('./todo-connector');
const { slackIdOf } = require('./todos');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 2000;
const NOTES_MAX = 200;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

/**
 * deps: { db: { row(id), saveNotes(id, notes), people() }, me: {id}, byName,
 *         bell(rows), slack(channel, threadTs, text), channel, site }
 */
async function addNote(args, deps) {
  const id = String(args.id || '');
  if (!UUID.test(id)) fail(400, 'Bad report.');
  const text = String(args.text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) fail(400, 'Write something first.');
  if (text.length > NOTE_MAX) fail(400, `A note is ${NOTE_MAX} characters at most.`);
  const row = await deps.db.row(id);
  if (!row) fail(404, 'That report is gone. Refresh the board.');
  const at = new Date().toISOString();
  const notes = [...(Array.isArray(row.admin_notes) ? row.admin_notes : []), { by: deps.byName, text, at }].slice(-NOTES_MAX);
  await deps.db.saveNotes(id, notes);

  const people = await deps.db.people();
  const tagged = tagIdsIn(text, people).filter(pid => pid !== (deps.me && deps.me.id));
  if (tagged.length) {
    const who = people.filter(p => tagged.includes(p.id));
    const link = `${deps.site}/?triage=board&report=${id}`;
    const about = String(row.source_excerpt || 'a report').replace(/\s+/g, ' ').slice(0, 90);
    await deps.bell(who.map(p => ({ title: `💬 ${deps.byName} tagged you on a report`.slice(0, 120),
      body: `"${about}"\n\n${text.slice(0, 300)}\n\n${link}`.slice(0, 500),
      target_type: 'user', target_id: p.id, send_at: at, created_by: (deps.me && deps.me.id) || null })));
    const pings = who.map(p => { const s = slackIdOf(p); return s ? `<@${s}>` : `@${p.name}`; }).join(' ');
    const quote = text.replace(/\s+/g, ' ').slice(0, 300);
    await deps.slack(row.slack_ts ? (row.slack_channel || deps.channel) : deps.channel, row.slack_ts || null,
      `💬 ${pings} ${deps.byName} left a note on the board:\n> ${quote}\n<${link}|Open it on the triage board>`);
  }
  return { admin_notes: notes, tagged: tagged.length };
}

module.exports = { addNote };
