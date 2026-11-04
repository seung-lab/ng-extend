// Tags that wait too long (Ames 2026-11-04: "if I tag someone and they don't
// reply for 24 hours (if it's the work week, ping them on slack every day
// until they reply)").
//
// The tag bells are the record: "📋 Ames tagged you on a To do" and
// "💬 Ames tagged you on a report", each carrying its card's link. A tag
// counts as answered once the tagged person comments on that To do card,
// leaves a note on that report, or writes in the report's Slack thread after
// it. Finished, deleted or closed work is never chased. Each ping leaves a
// "⏰ Still waiting on you" bell with the same link, which is how a day's ping
// is known to be sent: once a day per person and card, Monday to Friday
// between 9 am and 6 pm Eastern, never after, however many bridge runs there are. Run from the bridge's
// first pass (slack-triage-bridge.mjs).

const DAY_MS = 24 * 60 * 60 * 1000;
export const NUDGE_TITLE = '⏰ Still waiting on you';
const TAG_TITLE = /^(?:📋|💬) (.+?) tagged you on a (To do|report)$/u;
const LINK = /[?&](todo|report)=([0-9a-f-]{36})/i;
/** Tags older than this are let go. */
const GIVE_UP_DAYS = 30;
/** Tags from before this began are not chased: no surprise pings about last week. */
export const NUDGE_SINCE = Date.parse('2026-11-04T00:00:00-05:00');

// The admins' Slack ids (functions/todos.js SLACK_IDS).
const SLACK_IDS = [
  { match: /^(amy|ames)\b|^amy/i, id: 'U02FH1DRC' },
  { match: /^celia/i, id: 'U033NHWDE' },
  { match: /^(marissa|m sorek|sorek)/i, id: 'U033TSX9A' },
];
export const slackIdOf = name => (SLACK_IDS.find(s => s.match.test(String(name || ''))) || {}).id || null;

/** Eastern time parts, for "a weekday, 9 am to 6 pm" (Ames 2026-11-04). */
export function eastern(now) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour) % 24, day: `${p.year}-${p.month}-${p.day}` };
}
export function isNudgeTime(now) {
  const e = eastern(now);
  return !['Sat', 'Sun'].includes(e.weekday) && e.hour >= 9 && e.hour < 18;
}

/** The waiting tags: one per person and card, the newest tag of each. */
export function waitingTags(notes, now) {
  const latest = new Map();
  for (const n of notes) {
    const t = String(n.title || '').match(TAG_TITLE);
    const l = String(n.body || '').match(LINK);
    if (!t || !l || !n.target_id) continue;
    const at = Date.parse(n.send_at);
    if (!(at <= now - DAY_MS) || at < now - GIVE_UP_DAYS * DAY_MS || at < NUDGE_SINCE) continue;
    const key = `${n.target_id}|${l[1]}|${l[2].toLowerCase()}`;
    const had = latest.get(key);
    if (!had || at > had.at) latest.set(key, { key, person: n.target_id, kind: l[1].toLowerCase(), id: l[2].toLowerCase(), by: t[1], at, link: (String(n.body).match(/https?:\/\/\S+/) || [''])[0] });
  }
  return [...latest.values()];
}

/** Has the person answered since the tag, or is the work finished? */
export function answered(tag, personName, thing, slackId) {
  if (!thing) return true;                                  // deleted
  const after = iso => Date.parse(iso) > tag.at;
  const mine = by => personName && String(by || '').trim().toLowerCase() === String(personName).trim().toLowerCase();
  if (tag.kind === 'todo') {
    if (thing.list === 'done') return true;
    return (thing.comments || []).some(c => mine(c.by) && after(c.at));
  }
  if (['done', 'dismissed'].includes(thing.status)) return true;
  if ((thing.admin_notes || []).some(n => mine(n.by) && after(n.at))) return true;
  // A reply in the report's Slack thread (the bridge keeps them in feedback_log).
  return !!slackId && (thing.feedback_log || []).some(m => m && m.user === slackId && Number(m.ts) * 1000 > tag.at);
}

const dayWords = ms => new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' });
export function nudgeText(tag, slackId, title, link) {
  const who = slackId ? `<@${slackId}>` : 'Hi';
  const what = tag.kind === 'todo' ? 'a To do' : 'a report';
  return `⏰ ${who} ${tag.by} tagged you on ${what} on ${dayWords(tag.at)} and is waiting for your reply: *${title}*${link ? `\n<${link}|Open it>` : ''}`;
}

/**
 * One day's pings. io: { get(path) -> rows, post(table, rows), slack(channel, threadTs, text), channel, now }.
 * Returns how many people were pinged.
 */
export async function nudgeWaitingTags(io) {
  const now = io.now ?? Date.now();
  if (!isNudgeTime(new Date(now))) return 0;
  const since = new Date(now - GIVE_UP_DAYS * DAY_MS).toISOString();
  const tagNotes = await io.get(`notifications?select=title,body,target_id,send_at&target_type=eq.user&send_at=gte.${encodeURIComponent(since)}`
    + `&or=${encodeURIComponent('(title.like.*tagged you on a To do,title.like.*tagged you on a report)')}&order=send_at.desc&limit=300`);
  const waiting = waitingTags(tagNotes, now);
  if (!waiting.length) return 0;
  const today = eastern(new Date(now)).day;
  const ids = [...new Set(waiting.map(w => w.person))];
  const people = await io.get(`users?select=id,display_name,username&id=in.(${ids.join(',')})`);
  const nameOf = id => { const p = people.find(x => x.id === id); return p ? (p.display_name || p.username) : ''; };
  const pinged = await io.get(`notifications?select=body,target_id,send_at&title=like.${encodeURIComponent(NUDGE_TITLE + '*')}&send_at=gte.${encodeURIComponent(new Date(now - 2 * DAY_MS).toISOString())}`);
  let sent = 0;
  for (const tag of waiting) {
    if (pinged.some(p => p.target_id === tag.person && String(p.body || '').includes(tag.id) && eastern(new Date(p.send_at)).day === today)) continue;
    const thing = tag.kind === 'todo'
      ? (await io.get(`admin_todos?id=eq.${tag.id}&select=id,title,list,comments`))[0]
      : (await io.get(`feedback_triage?id=eq.${tag.id}&select=id,status,source_excerpt,admin_notes,feedback_log,slack_ts,slack_channel`))[0];
    const name = nameOf(tag.person), slackId = slackIdOf(name);
    if (answered(tag, name, thing, slackId)) continue;
    const title = tag.kind === 'todo' ? thing.title : String(thing.source_excerpt || 'a report').replace(/\s+/g, ' ').slice(0, 90);
    await io.slack(tag.kind === 'report' && thing.slack_ts ? (thing.slack_channel || io.channel) : io.channel,
      tag.kind === 'report' ? thing.slack_ts || null : null, nudgeText(tag, slackId, title, tag.link));
    await io.post('notifications', [{ title: `${NUDGE_TITLE}: ${title}`.slice(0, 120),
      body: `${tag.by} tagged you on this on ${dayWords(tag.at)}. A reply there stops these reminders.\n\n${tag.link}`.slice(0, 500),
      target_type: 'user', target_id: tag.person, send_at: new Date(now).toISOString() }]);
    sent++;
  }
  return sent;
}
