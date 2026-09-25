#!/usr/bin/env node
/**
 * slack-triage-bridge.mjs
 * --------------------------------------------------------------------
 * Two-way Slack bridge for the feedback triage pipeline, and the clock for
 * the implement-on-approval loop (docs/TRIAGE-LOOP.md). Runs every 10 min.
 *
 * OUTBOUND: every feedback_triage row with status='proposed' that has not
 * been posted yet (slack_ts is null) is posted to the feedback channel,
 * threaded under the original report when it can be found.
 *
 * INBOUND: for every still-proposed row with a slack_ts, thread replies
 * are read. The FIRST reply from an allowed approver that starts with
 * approve / accept / dismiss (case-insensitive) decides the row. Text after
 * the word is kept: on a 'message' proposal it replaces the message sent to
 * the reporter; on a spec it is saved as approver_note, shown in the Admin
 * Hub and handed to Claude with the spec.
 *
 * ADMIN HUB SYNC: decisions made in Admin Hub > Triage are echoed into the
 * Slack thread (a thread is started if the row never had one), so the two
 * lists never disagree. decision_slack_ts records the echo.
 *
 * LOOP (only when TRIAGE_LOOP=on and the loop columns exist):
 *   approved spec/feature -> impl_state 'queued' -> triage-implement.yml
 *   -> preview posted, approver tagged -> 'testing'
 *   while testing: the approver is re-tagged every 10 minutes until they
 *   reply "good" (-> triage-deploy.yml, live) or reply with a problem
 *   (-> Claude fixes it and posts a new preview).
 *
 * DONE SWEEP: rows moved to status='done' get a "change shipped" update in
 * their thread tagging every approver. done_slack_ts records it.
 *
 * Approval identity is the Slack member id (U…), never a display name.
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, APPROVER_SLACK_IDS
 * Loop env (optional; without them the bridge behaves as before):
 *   TRIAGE_LOOP=on, GITHUB_TOKEN (actions: write), GITHUB_REPOSITORY
 *   APPROVER_NAME_MAP  JSON {"amy":"U…","celia":"U…"}: first name of an
 *                      Admin Hub reviewer -> the Slack id to tag
 *   TRIAGE_LOOP_SINCE  ISO time; approvals before it are backlog, not auto
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLACK_TOKEN  = process.env.SLACK_BOT_TOKEN;
const CHANNEL      = process.env.SLACK_CHANNEL_ID;
const APPROVERS    = (process.env.APPROVER_SLACK_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const LOOP_WANTED  = (process.env.TRIAGE_LOOP || '').toLowerCase() === 'on';
const GH_TOKEN     = process.env.GITHUB_TOKEN;
const GH_REPO      = process.env.GITHUB_REPOSITORY || 'seung-lab/ng-extend';
const BASE_BRANCH  = 'eyewire-ii-community';
const LOOP_SINCE   = process.env.TRIAGE_LOOP_SINCE || '2026-09-25T00:00:00Z';
const NAG_EVERY_MS = 10 * 60 * 1000;
// A cron tick lands a little early or late; nag if at least this much passed.
const NAG_SLACK_MS = 60 * 1000;
const STALE_RUN_MS = 90 * 60 * 1000;
const MAX_PARALLEL_IMPL = 3;
let NAME_MAP = { amy: 'U02FH1DRC', celia: 'U033NHWDE' };
try { if (process.env.APPROVER_NAME_MAP) NAME_MAP = JSON.parse(process.env.APPROVER_NAME_MAP); }
catch { console.warn('[bridge] APPROVER_NAME_MAP is not JSON, using defaults'); }

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

async function patchRow(id, fields) {
  const upd = await sb(`feedback_triage?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
  if (!upd.ok) throw new Error(`update failed for ${id}: ${upd.status} ${await upd.text()}`);
}

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

const say = (row, text) => slack('chat.postMessage', {
  channel: row.slack_channel || CHANNEL, thread_ts: row.slack_ts, text,
});

async function dispatchWorkflow(file, rowId) {
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ ref: BASE_BRANCH, inputs: { row_id: rowId } }),
  });
  if (res.status !== 204) throw new Error(`dispatch ${file} failed: ${res.status} ${await res.text()}`);
}

/** Admin Hub reviewer name ("Amy Sterling", "slack:U…") -> Slack id to tag. */
function slackIdFor(reviewedBy) {
  if (!reviewedBy) return APPROVERS[0];
  if (reviewedBy.startsWith('slack:')) return reviewedBy.slice(6);
  const first = reviewedBy.trim().split(/\s+/)[0].toLowerCase();
  return NAME_MAP[first] || APPROVERS[0];
}

const isBuildable = row => row.recommendation === 'bug_fix_spec' || row.recommendation === 'new_feature';

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

function proposalText(row, footer) {
  return [
    `*Triage proposal: ${REC_LABEL[row.recommendation] ?? row.recommendation}*`,
    row.source_excerpt ? `> ${row.source_excerpt}` : null,
    row.rationale ? `_${row.rationale}_` : null,
    row.proposed_message ? `Proposed reply: "${row.proposed_message}"` : null,
    row.spec ? '```' + row.spec.slice(0, 2500) + '```' : null,
    footer,
  ].filter(Boolean).join('\n');
}

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

/** Post a card for a row and store the THREAD ROOT ts on it. */
async function openThread(row, footer) {
  const threadTs = await findReportTs(row.source_excerpt);
  const posted = await slack('chat.postMessage', {
    channel: CHANNEL, text: proposalText(row, footer),
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  // Store the thread root, not the card's own ts: when the card is threaded
  // under the original report, replies land in the report's thread, and
  // conversations.replies on a child ts sees nothing.
  const slackTs = threadTs || posted.ts;
  await patchRow(row.id, { slack_channel: CHANNEL, slack_ts: slackTs });
  row.slack_channel = CHANNEL;
  row.slack_ts = slackTs;
  return threadTs ? 'threaded' : 'standalone';
}

async function postProposals() {
  const res = await sb('feedback_triage?status=eq.proposed&slack_ts=is.null&select=*');
  const rows = await res.json();
  for (const row of rows) {
    const where = await openThread(row,
      `Reply *approve* or *dismiss* in this thread. Text after "approve" is kept as your note${LOOP ? ' and handed to Claude with the spec' : ''}. Also reviewable in Admin Hub, Triage tab.`);
    console.log(`[bridge] posted proposal ${row.id} (${where})`);
  }
  return rows.length;
}

async function applyDecision(row, decision, approverId, extraText) {
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
  const isMessage = row.recommendation === 'message';
  await patchRow(row.id, {
    status: decision,
    // On a message proposal the extra text IS the message; on anything else
    // it is the approver's note (it used to overwrite proposed_message, which
    // the Admin Hub never showed for specs, so the comment vanished).
    ...(extraText && isMessage ? { proposed_message: extraText } : {}),
    ...(COLS && extraText && !isMessage ? { approver_note: extraText } : {}),
    ...(COLS ? { approver_slack_id: approverId } : {}),
    ...(LOOP && decision === 'approved' && isBuildable(row) ? { impl_state: 'queued' } : {}),
    reviewed_by: `slack:${approverId}`, reviewed_at: new Date().toISOString(),
  });
}

async function readApprovals() {
  const res = await sb('feedback_triage?status=eq.proposed&slack_ts=not.is.null&select=*');
  const rows = await res.json();
  let acted = 0;
  for (const row of rows) {
    let replies;
    try {
      replies = await slackGet('conversations.replies', { channel: row.slack_channel || CHANNEL, ts: row.slack_ts, limit: 200 });
    } catch (e) { console.warn(`[bridge] replies fetch failed for ${row.id}: ${e.message}`); continue; }
    for (const msg of (replies.messages ?? []).slice(1)) { // [0] is the thread root
      const text = (msg.text || '').trim();
      // approve/approved/accept/accepted/dismiss/dismissed all count: Amy's
      // first real decision was "approved" and the strict form ignored it.
      const m = text.match(/^(approved?|accept(?:ed)?|dismiss(?:ed)?)\b[\s,.:!-]*(.*)$/is);
      if (!m) continue;
      if (!APPROVERS.includes(msg.user)) {
        await say(row, `Only listed approvers can decide this one (<@${msg.user}> is not on the list).`).catch(() => {});
        continue;
      }
      const decision = /^(approve|accept)/i.test(m[1]) ? 'approved' : 'dismissed';
      const extraText = m[2]?.trim() || '';
      await applyDecision(row, decision, msg.user, extraText);
      const building = LOOP && decision === 'approved' && isBuildable(row);
      const posted = await say(row, decision === 'approved'
        ? (row.recommendation === 'message'
            ? `Approved by <@${msg.user}>. Message sent to the reporter. ✓`
            : building
              ? `Approved by <@${msg.user}>${extraText ? ` with the note "${extraText}"` : ''}. Claude is starting on it now. <@${msg.user}>, you'll get a preview link here, and you're the tester. ✓`
              : `Approved by <@${msg.user}>. Marked accepted in the work queue. ✓`)
        : `Dismissed by <@${msg.user}>. ✓`);
      if (COLS) await patchRow(row.id, { decision_slack_ts: posted.ts, last_reply_ts: posted.ts });
      console.log(`[bridge] ${row.id} ${decision} by ${msg.user}`);
      acted++;
      break; // first valid decision wins
    }
  }
  return acted;
}

/** Decisions made in the Admin Hub, echoed into Slack so both lists agree. */
async function echoAppDecisions() {
  const res = await sb(`feedback_triage?status=in.(approved,dismissed)&decision_slack_ts=is.null&reviewed_at=gte.${encodeURIComponent(LOOP_SINCE)}&select=*`);
  if (!res.ok) { console.warn(`[bridge] echo skipped (${res.status})`); return 0; }
  let echoed = 0;
  for (const row of await res.json()) {
    if ((row.reviewed_by || '').startsWith('slack:')) {
      // Decided in Slack before the loop columns existed: nothing to echo.
      await patchRow(row.id, { decision_slack_ts: 'slack' });
      continue;
    }
    if (!row.slack_ts) await openThread(row, '_Decided in the Admin Hub before this reached Slack._');
    const tester = slackIdFor(row.reviewed_by);
    const building = LOOP && row.status === 'approved' && isBuildable(row) && !row.impl_state;
    const note = row.approver_note ? ` with the note "${row.approver_note}"` : '';
    const posted = await say(row, row.status === 'approved'
      ? `Approved in the Admin Hub by ${row.reviewed_by}${note}.${building ? ` Claude is starting on it now. <@${tester}>, you're the tester.` : ''} ✓`
      : `Dismissed in the Admin Hub by ${row.reviewed_by}. ✓`);
    await patchRow(row.id, {
      decision_slack_ts: posted.ts,
      last_reply_ts: posted.ts,
      approver_slack_id: row.approver_slack_id || tester,
      // An approval from an older client bundle that did not queue the work.
      ...(building ? { impl_state: 'queued' } : {}),
    });
    console.log(`[bridge] echoed app decision ${row.id} (${row.status})`);
    echoed++;
  }
  return echoed;
}

/** Start Claude on queued rows, and the deploy on rows the tester passed. */
async function dispatchWork() {
  const res = await sb('feedback_triage?impl_state=in.(queued,changes_requested,deploy_queued,implementing,deploying)&select=*');
  const rows = await res.json();
  let running = rows.filter(r => r.impl_state === 'implementing').length;
  let started = 0;
  for (const row of rows) {
    if (row.impl_state === 'implementing' || row.impl_state === 'deploying') {
      const age = Date.now() - new Date(row.impl_started_at || 0).getTime();
      if (age > STALE_RUN_MS) {
        await patchRow(row.id, { impl_state: 'failed' });
        if (row.slack_ts) await say(row, `⚠️ The ${row.impl_state === 'deploying' ? 'deploy' : 'implementation'} run has been going ${Math.round(age / 60000)} minutes, so I've marked it failed. <@${APPROVERS[0]}> please look${row.impl_run_url ? `: ${row.impl_run_url}` : ''}. Retry is in the Admin Hub, Triage tab.`);
      }
      continue;
    }
    const deploy = row.impl_state === 'deploy_queued';
    if (!deploy && running >= MAX_PARALLEL_IMPL) continue;
    // A "good" or a Retry clicked in the Admin Hub has no Slack reply behind
    // it, so say so in the thread before starting.
    if (row.slack_ts && deploy && row.tested_by && !row.tested_by.startsWith('slack:')) {
      await say(row, `Marked tested and good in the Admin Hub by ${row.tested_by}. Deploying to the live community site now.`);
    } else if (row.slack_ts && row.impl_state === 'queued' && row.impl_attempts > 0) {
      await say(row, 'Retry requested. Claude is starting on it again.');
    }
    await dispatchWorkflow(deploy ? 'triage-deploy.yml' : 'triage-implement.yml', row.id);
    await patchRow(row.id, { impl_state: deploy ? 'deploying' : 'implementing', impl_started_at: new Date().toISOString() });
    if (!deploy) running++;
    console.log(`[bridge] dispatched ${deploy ? 'deploy' : 'implement'} for ${row.id}`);
    started++;
  }
  return started;
}

/** While a preview is up: read the tester's reply, else re-tag them. */
async function pollTesting() {
  const res = await sb('feedback_triage?impl_state=eq.testing&select=*');
  const rows = await res.json();
  let nagged = 0;
  for (const row of rows) {
    if (!row.slack_ts) continue;
    const tester = row.approver_slack_id || slackIdFor(row.reviewed_by);
    let replies;
    try {
      replies = await slackGet('conversations.replies', {
        channel: row.slack_channel || CHANNEL, ts: row.slack_ts, limit: 200,
        ...(row.last_reply_ts ? { oldest: row.last_reply_ts } : {}),
      });
    } catch (e) { console.warn(`[bridge] replies fetch failed for ${row.id}: ${e.message}`); continue; }
    const fresh = (replies.messages ?? [])
      .filter(m => m.ts !== row.slack_ts && (!row.last_reply_ts || Number(m.ts) > Number(row.last_reply_ts)))
      .filter(m => !m.bot_id && m.subtype !== 'bot_message');
    let decided = false;
    const log = Array.isArray(row.feedback_log) ? [...row.feedback_log] : [];
    let newest = row.last_reply_ts;
    for (const m of fresh) {
      newest = m.ts;
      const text = (m.text || '').trim();
      if (m.user !== tester) {
        // Anyone can add context, but only the tester's reply moves the row.
        log.push({ user: m.user, text, ts: m.ts, role: 'comment' });
        continue;
      }
      if (/^(good|looks good|lgtm)\b/i.test(text)) {
        await patchRow(row.id, { impl_state: 'deploy_queued', tested_by: `slack:${m.user}`, tested_at: new Date().toISOString(), last_reply_ts: m.ts, feedback_log: log });
        const posted = await say(row, `Thanks <@${m.user}>, tested and good. Deploying to the live community site now; I'll post here when it's live.`);
        await patchRow(row.id, { last_reply_ts: posted.ts });
        decided = true;
        break;
      }
      log.push({ user: m.user, text, ts: m.ts, role: 'tester' });
      await patchRow(row.id, { impl_state: 'changes_requested', last_reply_ts: m.ts, feedback_log: log });
      const posted = await say(row, `Got it <@${m.user}>. Sending that back to Claude, and a new preview link will follow here.`);
      await patchRow(row.id, { last_reply_ts: posted.ts });
      decided = true;
      break;
    }
    if (decided) continue;
    if (newest !== row.last_reply_ts) await patchRow(row.id, { last_reply_ts: newest, feedback_log: log });
    const since = Date.now() - new Date(row.last_nag_at || 0).getTime();
    if (since >= NAG_EVERY_MS - NAG_SLACK_MS) {
      const n = (row.nag_count || 0) + 1;
      const posted = await say(row, `⏰ <@${tester}> reminder ${n}: please test ${row.preview_url || 'the preview'} and reply *good* to deploy it, or reply with what's wrong. I'll keep asking every 10 minutes until you do.`);
      await patchRow(row.id, { last_nag_at: new Date().toISOString(), nag_count: n, last_reply_ts: posted.ts });
      nagged++;
    }
  }
  return nagged;
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
    const posted = await say(row, `🔧 Change shipped for this one${note ? `: ${note}` : ''}. ${tags} ✓`);
    await patchRow(row.id, { done_slack_ts: posted.ts });
    console.log(`[bridge] announced done ${row.id}`);
    announced++;
  }
  return announced;
}

// COLS: the loop columns exist, so Slack/Admin Hub sync and approver notes
// work. LOOP: additionally TRIAGE_LOOP=on with a GitHub token, so approved
// work is handed to Claude and testers are chased.
let COLS = false;
let LOOP = false;

(async () => {
  // Until supabase-triage-loop-columns.sql runs, behave exactly as before.
  const probe = await sb('feedback_triage?select=impl_state,decision_slack_ts&limit=1');
  COLS = probe.ok;
  if (!COLS) console.warn('[bridge] loop columns missing: run supabase-triage-loop-columns.sql (sync and loop stay off)');
  if (COLS && LOOP_WANTED) {
    if (!GH_TOKEN) console.warn('[bridge] TRIAGE_LOOP=on but GITHUB_TOKEN is missing');
    else LOOP = true;
  }
  const posted = await postProposals();
  const acted = await readApprovals();
  let echoed = 0, started = 0, nagged = 0;
  if (COLS) echoed = await echoAppDecisions();
  if (LOOP) {
    started = await dispatchWork();
    nagged = await pollTesting();
  }
  const announced = await announceDone();
  console.log(`[bridge] done: ${posted} posted, ${acted} decided, ${echoed} echoed, ${started} started, ${nagged} nagged, ${announced} announced (sync ${COLS ? 'on' : 'off'}, loop ${LOOP ? 'on' : 'off'})`);
})().catch(e => { console.error('[bridge] fatal:', e.message); process.exit(1); });
