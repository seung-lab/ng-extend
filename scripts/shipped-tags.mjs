/**
 * Who is tagged in Slack when a report is closed ("🔧 Change shipped").
 *
 * Celia asked (2026-11-09) to be told of a closed report only when:
 *   1. it was her report,
 *   2. she commented on it,
 *   3. she sent feedback to the player on it,
 * and Ames added: 4. someone @ed her anywhere in it. Ames: the same for
 * Marissa. Ames herself is no longer tagged on these ("I don't need to be
 * tagged in change shipped either", 2026-11-09).
 */
export const WATCHERS = [
  { id: 'U033NHWDE', who: 'Celia', name: /^celia/i, at: /@celia/i },
  // Marissa Sorek ("M Sorek" in Pyr), never Marissa Pratt, who is a player.
  { id: 'U033TSX9A', who: 'Marissa', name: /^(m[ _.]?sorek|sorek|marissa sorek)\b/i, at: /@(m[ _.]?sorek|sorek|marissa sorek)\b/i },
];

/**
 * Why this watcher is involved in the report, or null.
 * ctx: { row (feedback_triage), reporterName, thread (Slack replies) }
 */
export function involvement(w, { row = {}, reporterName = '', thread = [] } = {}) {
  const named = s => !!s && w.name.test(String(s).trim());
  const tags = s => !!s && (String(s).includes(`<@${w.id}>`) || w.at.test(String(s)));
  const log = Array.isArray(row.feedback_log) ? row.feedback_log : [];
  const notes = Array.isArray(row.admin_notes) ? row.admin_notes : [];
  const people = thread.filter(m => m && !m.bot_id && m.subtype !== 'bot_message');

  if (named(reporterName)) return 'her report';
  if (log.some(e => e && e.role === 'reporter_update' && e.via !== 'auto' && (e.user === w.id || named(e.by)))) return 'sent feedback';
  if (notes.some(n => n && named(n.by))) return 'commented';
  if (log.some(e => e && e.via !== 'auto' && (e.user === w.id || named(e.by)))) return 'commented';
  if (people.some(m => m.user === w.id)) return 'commented';
  const texts = [row.result_note, row.approver_note, ...notes.map(n => n && n.text), ...log.map(e => e && e.via !== 'auto' && e.text), ...people.map(m => m.text)];
  if (texts.some(tags)) return 'tagged';
  return null;
}

/** The Slack ids to tag: only the watchers involved in this report. */
export function shippedTags(ctx, watchers = WATCHERS) {
  return watchers.filter(w => involvement(w, ctx)).map(w => w.id);
}
