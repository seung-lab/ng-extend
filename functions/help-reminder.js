/**
 * help-reminder.js: "Was your help request answered?" (Ames, 2026-10-21).
 *
 * When someone replies to a help request, the player who asked gets a bell
 * notification a day later asking whether it was answered, with a link that
 * marks the request solved. One reminder per request, never repeated, and it
 * is deleted if the request is marked solved before it arrives.
 *
 * The reminder carries its request in its link (#nge-help-solved=<id>); the
 * bell (NotificationFeedPanel.vue) handles that link. `sb` is the Supabase
 * REST caller from index.js: sb(path, init) returns the parsed rows.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f-]{1,40}$/i;

const mark = id => `nge-help-solved=${id}`;
/** PostgREST filter for notifications whose body holds this request's link. */
const bodyHas = id => `body=like.${encodeURIComponent(`*${mark(id)}*`)}`;

/** A player's words, quoted safely: one line, short, and with no brackets,
 *  so a note can not make a link of its own in the reminder. */
const quote = (text, max = 220) => {
  const t = String(text || '').replace(/[\[\]<>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
const dayOf = iso => {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }); }
  catch { return ''; }
};

/** The reminder says which request it is about (annkri, report 247: "add more
 *  context to this message so i know what actually is in the help request"):
 *  when it was asked, its issue, its cell and its note, and the reply. */
function reminderBody(req, reply) {
  const segId = req && req.segment_id ? String(req.segment_id).slice(0, 40) : '';
  const day = req && req.created_at ? dayOf(req.created_at) : '';
  const lines = [`You got a reply on your help request${day ? ` from ${day}` : ''}.`];
  const about = [req && req.issue_type ? `**${quote(req.issue_type, 60)}**` : '', segId ? `cell ${segId}` : ''].filter(Boolean).join(', ');
  const note = req ? quote(req.note) : '';
  if (about || note) lines.push(`> ${about}${about && note ? ': ' : ''}${note ? `"${note}"` : ''}`);
  const said = reply ? quote(reply.note) : '';
  if (said) lines.push(`**Reply from ${quote(reply.user_name, 40) || 'a helper'}:** "${said}"`);
  lines.push(`If it answered your question, please [mark it solved](#${mark('ID')}) so helpers know. `
    + 'If not, reply in the Help tab to keep the conversation going.');
  return lines.join('\n\n');
}

/**
 * After `me` replied to request `requestId` asked by `target`: schedule the
 * reminder for a day later, unless the request is solved or already has one.
 * Returns { scheduled: boolean, why?: string }.
 */
async function scheduleReminder({ sb, me, target, requestId, now = Date.now() }) {
  const id = String(requestId || '');
  if (!ID_RE.test(id)) return { scheduled: false, why: 'no request' };
  const req = (await sb(`help_requests?id=eq.${id}&user_id=eq.${target}&select=id,segment_id,resolved,note,issue_type,created_at&limit=1`))[0];
  if (!req) return { scheduled: false, why: 'not their request' };
  if (req.resolved) return { scheduled: false, why: 'already solved' };
  // Only someone who really replied schedules one.
  const replied = await sb(`help_responses?request_id=eq.${id}&user_id=eq.${me.id}&select=id,note,user_name&order=created_at.desc&limit=1`);
  if (!replied.length) return { scheduled: false, why: 'no reply from you' };
  const have = await sb(`notifications?target_type=eq.user&target_id=eq.${target}&${bodyHas(id)}&select=id&limit=1`);
  if (have.length) return { scheduled: false, why: 'already reminded' };
  const row = {
    title: '❓ Was your help request answered?',
    body: reminderBody(req, replied[0]).replace(mark('ID'), mark(id)),
    target_type: 'user', target_id: target,
    send_at: new Date(now + DAY_MS).toISOString(),
    created_by: me.id,
  };
  await sb('notifications', { method: 'POST', body: JSON.stringify(row) });
  return { scheduled: true };
}

/**
 * The request was marked solved: delete its reminder if it has not arrived
 * yet. Anyone may ask, since it only removes a reminder for a solved request.
 * Returns { dropped: number }.
 */
async function dropReminder({ sb, requestId, now = Date.now() }) {
  const id = String(requestId || '');
  if (!ID_RE.test(id)) return { dropped: 0 };
  const req = (await sb(`help_requests?id=eq.${id}&select=id,user_id,resolved&limit=1`))[0];
  if (!req || !req.resolved || !req.user_id) return { dropped: 0 };
  const gone = await sb(`notifications?target_type=eq.user&target_id=eq.${req.user_id}&send_at=gt.${new Date(now).toISOString()}&${bodyHas(id)}`,
    { method: 'DELETE' });
  return { dropped: (gone || []).length };
}

module.exports = { scheduleReminder, dropReminder, mark, DAY_MS };
