#!/usr/bin/env node
/**
 * slack-triage-bridge.mjs
 * --------------------------------------------------------------------
 * Two-way Slack bridge for the feedback triage pipeline.
 *
 * OUTBOUND: every feedback_triage row with status='proposed' that has not
 * been posted yet (slack_ts is null) is posted to the feedback channel.
 * If the original report is findable in recent channel history (the
 * submitIssue Cloud Function posted it), the proposal is threaded under
 * it; otherwise it stands alone. The message ts is written back to
 * feedback_triage.slack_ts so nothing is ever double-posted.
 *
 * INBOUND: for every still-proposed row with a slack_ts, thread replies
 * are read. The FIRST reply from an allowed approver that starts with
 * "approve" or "dismiss" (case-insensitive) decides the row:
 *   - approve on a 'message' proposal also sends the proposed message to
 *     the reporter as an in-app notification (any reply text after the
 *     word approve replaces the proposed message, so
 *     "approve Thanks for flagging this, fixed!" edits it in-line)
 *   - the row's status/reviewed_by/reviewed_at are updated
 *   - the bot confirms in-thread
 * Replies from anyone not in APPROVER_SLACK_IDS are ignored (and noted
 * in-thread once so it isn't silent).
 *
 * DONE SWEEP: rows moved to status='done' (Admin Hub's "Mark done", or by
 * whoever ships the change) get a change update posted into the original
 * Slack thread, tagging every listed approver, with the row's result_note
 * when one was written. done_slack_ts records the announcement so it never
 * double-posts. Requires supabase-triage-done-columns.sql.
 *
 * Approval identity is the Slack member id (U…), not display name, so it
 * cannot be spoofed by renaming. Set APPROVER_SLACK_IDS to Amy's and
 * Celia's ids (Profile > three dots > Copy member ID).
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SLACK_BOT_TOKEN        bot token (xoxb-…) with chat:write,
 *                          channels:history, channels:read; bot must be
 *                          invited to the channel
 *   SLACK_CHANNEL_ID       channel id (C…) of the feedback channel
 *   APPROVER_SLACK_IDS     comma-separated Slack member ids allowed to
 *                          approve or dismiss
 *
 * The in-app Admin Hub > Triage tab remains the source of truth; this is
 * a second door to the same gate. A row approved in the app before the
 * bridge runs is simply never asked about in Slack again.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLACK_TOKEN  = process.env.SLACK_BOT_TOKEN;
const CHANNEL      = process.env.SLACK_CHANNEL_ID;
const APPROVERS    = (process.env.APPROVER_SLACK_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY, SLACK_BOT_TOKEN: SLACK_TOKEN, SLACK_CHANNEL_ID: CHANNEL })) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
}
if (!APPROVERS.length) { console.error('APPROVER_SLACK_IDS is empty: nobody could approve. Refusing to run.'); process.exit(1); }

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
    ...(init.headers || {}),
  },
});

// Write methods (chat.postMessage) take a JSON POST; read methods
// (conversations.history / .replies) reject JSON bodies with
// invalid_arguments and want GET query params. Two helpers accordingly.
const slack = async (method, payload) => {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
};

const slackGet = async (method, params) => {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
    headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
};

// Feedback replies arrive "from Nurro": the guide's avatar as the card icon,
// plus a random real neuron render as the card image (uploaded to
// admin-uploads/nurro-neurons; sourced from scifi-ui/media + the CA3 render).
const NURRO_AVATAR_URL =
  `${SUPABASE_URL}/storage/v1/object/public/admin-uploads/nurro/guide-avatar.png`;
const NEURON_RENDER_COUNT = 24; // scifi-ui media + CA3 + microns + FlyWire galleries
const randomNeuronUrl = () =>
  `${SUPABASE_URL}/storage/v1/object/public/admin-uploads/nurro-neurons/neuron-${1 + Math.floor(Math.random() * NEURON_RENDER_COUNT)}.jpg`;

const REC_LABEL = {
  nothing: 'No action', message: 'Send a message',
  bug_fix_spec: 'Bug fix spec', new_feature: 'New feature',
};

/** Try to find the original report message in recent history to thread under. */
async function findReportTs(excerpt) {
  if (!excerpt) return null;
  try {
    const needle = excerpt.slice(0, 60).toLowerCase();
    const hist = await slackGet('conversations.history', { channel: CHANNEL, limit: 100 });
    for (const m of hist.messages ?? []) {
      if ((m.text || '').toLowerCase().includes(needle)) return m.thread_ts || m.ts;
    }
  } catch (e) { console.warn('[bridge] history search failed:', e.message); }
  return null;
}

async function postProposals() {
  const res = await sb('feedback_triage?status=eq.proposed&slack_ts=is.null&select=*');
  const rows = await res.json();
  for (const row of rows) {
    const lines = [
      `*Triage proposal: ${REC_LABEL[row.recommendation] ?? row.recommendation}*`,
      row.source_excerpt ? `> ${row.source_excerpt}` : null,
      row.rationale ? `_${row.rationale}_` : null,
      row.proposed_message ? `Proposed reply: "${row.proposed_message}"` : null,
      row.spec ? '```' + row.spec.slice(0, 2500) + '```' : null,
      `Reply *approve* or *dismiss* in this thread (approve with extra text edits the reply). Also reviewable in Admin Hub, Triage tab.`,
    ].filter(Boolean);
    const threadTs = await findReportTs(row.source_excerpt);
    const posted = await slack('chat.postMessage', {
      channel: CHANNEL, text: lines.join('\n'),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    // Store the THREAD ROOT ts, not the proposal's own ts: when the proposal
    // is threaded under the original report, approver replies land in the
    // report's thread, and conversations.replies on a child ts sees nothing.
    const upd = await sb(`feedback_triage?id=eq.${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ slack_channel: CHANNEL, slack_ts: threadTs || posted.ts }),
    });
    if (!upd.ok) throw new Error(`slack_ts write failed for ${row.id}: ${upd.status}`);
    console.log(`[bridge] posted proposal ${row.id}${threadTs ? ' (threaded)' : ''}`);
  }
  return rows.length;
}

async function applyDecision(row, decision, approverId, extraText) {
  const reviewedBy = `slack:${approverId}`;
  if (decision === 'approved' && row.recommendation === 'message') {
    const text = (extraText || row.proposed_message || '').trim();
    if (text) {
      let targetUserId = null;
      if (row.source === 'site_issue') {
        const r = await sb(`site_issues?id=eq.${row.source_id}&select=user_id`);
        targetUserId = (await r.json())[0]?.user_id ?? null;
      }
      const ins = await sb('notifications', {
        method: 'POST',
        body: JSON.stringify({
          title: '💬 Nurro replied to your feedback', body: text,
          thumbnail_url: NURRO_AVATAR_URL,
          image_url: randomNeuronUrl(),
          target_type: targetUserId ? 'user' : 'all', target_id: targetUserId,
          send_at: new Date().toISOString(),
        }),
      });
      if (!ins.ok) throw new Error(`notification insert failed: ${ins.status}`);
    }
  }
  const upd = await sb(`feedback_triage?id=eq.${row.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: decision,
      ...(extraText ? { proposed_message: extraText } : {}),
      reviewed_by: reviewedBy, reviewed_at: new Date().toISOString(),
    }),
  });
  if (!upd.ok) throw new Error(`status update failed for ${row.id}: ${upd.status}`);
}

async function readApprovals() {
  const res = await sb('feedback_triage?status=eq.proposed&slack_ts=not.is.null&select=*');
  const rows = await res.json();
  let acted = 0;
  for (const row of rows) {
    let replies;
    try {
      replies = await slackGet('conversations.replies', { channel: row.slack_channel || CHANNEL, ts: row.slack_ts });
    } catch (e) { console.warn(`[bridge] replies fetch failed for ${row.id}: ${e.message}`); continue; }
    for (const msg of (replies.messages ?? []).slice(1)) { // [0] is the proposal itself
      const text = (msg.text || '').trim();
      // "approve"/"approved"/"dismiss"/"dismissed" all count: Amy's first
      // real-world decision was the word "approved" and the strict form
      // silently ignored it.
      const m = text.match(/^(approved?|dismissed?)\b\s*(.*)$/is);
      if (!m) continue;
      if (!APPROVERS.includes(msg.user)) {
        // Note it once per run so non-approver replies aren't silently ignored.
        await slack('chat.postMessage', {
          channel: row.slack_channel || CHANNEL, thread_ts: row.slack_ts,
          text: `Only listed approvers can decide this one (<@${msg.user}> is not on the list).`,
        }).catch(() => {});
        continue;
      }
      const decision = m[1].toLowerCase().startsWith('approve') ? 'approved' : 'dismissed';
      const extraText = m[2]?.trim() || '';
      await applyDecision(row, decision, msg.user, extraText);
      await slack('chat.postMessage', {
        channel: row.slack_channel || CHANNEL, thread_ts: row.slack_ts,
        text: decision === 'approved'
          ? (row.recommendation === 'message'
              ? `Approved by <@${msg.user}>. Message sent to the reporter. ✓`
              : `Approved by <@${msg.user}>. Marked accepted in the work queue. ✓`)
          : `Dismissed by <@${msg.user}>. ✓`,
      });
      console.log(`[bridge] ${row.id} ${decision} by ${msg.user}`);
      acted++;
      break; // first valid decision wins
    }
  }
  return acted;
}

/** Post a change update into the thread when an approved row ships. */
async function announceDone() {
  const res = await sb('feedback_triage?status=eq.done&slack_ts=not.is.null&done_slack_ts=is.null&select=*');
  if (!res.ok) {
    // Most likely the done columns have not been applied yet.
    console.warn(`[bridge] done sweep skipped (${res.status}) - run supabase-triage-done-columns.sql`);
    return 0;
  }
  const rows = await res.json();
  let announced = 0;
  for (const row of rows) {
    const tags = APPROVERS.map(id => `<@${id}>`).join(' ');
    const note = (row.result_note || '').trim();
    const posted = await slack('chat.postMessage', {
      channel: row.slack_channel || CHANNEL, thread_ts: row.slack_ts,
      text: `🔧 Change shipped for this one${note ? `: ${note}` : ''}. ${tags} ✓`,
    });
    const upd = await sb(`feedback_triage?id=eq.${row.id}`, {
      method: 'PATCH', body: JSON.stringify({ done_slack_ts: posted.ts }),
    });
    if (!upd.ok) throw new Error(`done_slack_ts write failed for ${row.id}: ${upd.status}`);
    console.log(`[bridge] announced done ${row.id}`);
    announced++;
  }
  return announced;
}

(async () => {
  const posted = await postProposals();
  const acted = await readApprovals();
  const announced = await announceDone();
  console.log(`[bridge] done: ${posted} posted, ${acted} decided, ${announced} announced`);
})().catch(e => { console.error('[bridge] fatal:', e.message); process.exit(1); });
