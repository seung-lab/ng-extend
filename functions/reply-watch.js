/**
 * A copy to Ames of every reply another admin sends a player on a triage card
 * (Ames 2026-11-09: "If another admin replies to a player on a triage card,
 * send me the notification as well. I want to keep tabs").
 *
 * Only Ames's bell, never Slack: the copy is for her alone. Her own replies,
 * and the robot's automatic thank you notes, are not copied.
 */
const OWNER_EMAILS = ['amylr@princeton.edu', 'amyleerobinson@gmail.com'];
// Nurro doing geometry (Ames 2026-11-09: "Use this image on those
// notifications and any notifications about changes to my magnum opus by
// Celia or Marissa"). Served from static/notes/ (scripts/build-prod.js).
const WATCH_PICTURE = 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/notes/nurro-geometry.jpg';
const isCeliaOrMarissa = name => /^(celia|m[ _.]?sorek|sorek|marissa sorek)\b/i.test(String(name || '').trim());

/** Replies to the player in `after` that were not in `before`. */
function newReplies(before, after) {
  const had = new Set((Array.isArray(before) ? before : []).filter(e => e && e.role === 'reporter_update').map(e => `${e.ts}|${e.text}`));
  return (Array.isArray(after) ? after : []).filter(e => e && e.role === 'reporter_update' && e.via !== 'auto' && e.sent !== false
    && typeof e.text === 'string' && e.text.trim() && !had.has(`${e.ts}|${e.text}`));
}

/** The bell Ames gets: who wrote, what the report was, the exact words sent. */
function copyNote({ by, text, about, link, imageUrl }) {
  const who = String(by || 'An admin').trim().slice(0, 60);
  const report = String(about || 'a report').replace(/\s+/g, ' ').trim().slice(0, 90);
  return {
    title: `💬 ${who} replied to a player`.slice(0, 120),
    body: `On "${report}":\n\n${String(text).trim().slice(0, 1200)}\n\n${link}`.slice(0, 1500),
    image_url: imageUrl || WATCH_PICTURE, thumbnail_url: WATCH_PICTURE,
  };
}

const isOwnerEmail = email => !!email && OWNER_EMAILS.includes(String(email).toLowerCase());

module.exports = { newReplies, copyNote, isOwnerEmail, isCeliaOrMarissa, OWNER_EMAILS, WATCH_PICTURE };
