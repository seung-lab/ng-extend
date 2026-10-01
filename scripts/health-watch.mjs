#!/usr/bin/env node
/**
 * health-watch.mjs: hourly check that the writes players depend on still
 * work, with a Slack alert only when something breaks (and one "recovered"
 * message when it is fixed). Run by .github/workflows/health-watch.yml.
 *
 * Checks
 *   1. Sheets write-back: ewSheetSync's own health action, which opens every
 *      registered sheet and makes a no-op find/replace in its write columns
 *      as the keyless service account (proves the sheets are still shared).
 *   2. CAVE tables: each dataset's proofread and cell type table answers
 *      (metadata read with the CAVE service token).
 *   3. Player failures: failed sheet or CAVE writes that browsers reported to
 *      Supabase client_errors (reportWriteFailure) in the last hour. Sign in
 *      problems (401) are the player's session, not an outage, and are left out.
 *
 * Alerting is stateless: the bot's own recent "[health]" messages in the
 * channel say whether it already raised this, so a broken check alerts once,
 * repeats at most every 6 hours, and says when it recovers.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CAVE_SERVICE_TOKEN,
 *      SLACK_BOT_TOKEN, SLACK_CHANNEL_ID (default #citsci_feedback),
 *      ALERT_SLACK_ID (who to tag), DRY_RUN=true to print instead of post.
 */

const env = process.env;
const DRY = env.DRY_RUN === 'true';
const CHANNEL = env.SLACK_CHANNEL_ID || 'C0BG5CN71C3';
const TAG = env.ALERT_SLACK_ID || 'U02FH1DRC';
const FUNCTIONS = 'https://us-central1-eyewire-ii-e4d52.cloudfunctions.net';
const MARK = '[health]';
const REPEAT_MS = 6 * 3600 * 1000;
const FAILURE_THRESHOLD = 3;

// Mirrors the writable (or shown) tables in src/config.ts CAVE_CONFIGS_BY_DATASET.
// MEC is left out on purpose: it logs to Supabase edit_log (no CAVE tables yet).
const CAVE_TABLES = [
  { label: 'Retina', server: 'https://minnie.microns-daf.com', vol: 'stroeh_mouse_retina', tables: ['eyewire_ii_cell_status_v2', 'eyewire_ii_cell_type_v2'] },
  { label: 'Sandbox', server: 'https://minnie.microns-daf.com', vol: 'pinky100', tables: ['eyewire_ii_cell_status_v2', 'cell_type_dev'] },
  { label: 'MICrONS', server: 'https://minnie.microns-daf.com', vol: 'minnie65_phase3', tables: ['eyewire_ii_cell_status_v2', 'eyewire_ii_cell_type_v2'] },
  { label: 'BANC', server: 'https://cave.fanc-fly.com', vol: 'brain_and_nerve_cord', tables: ['backbone_proofread', 'cell_info'] },
];

async function timed(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
}

async function checkSheets() {
  try {
    const r = await timed(`${FUNCTIONS}/ewSheetSync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'health' }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok && j.writable) return { ok: true, detail: `${(j.sheets || []).length} sheet(s) writable` };
    return { ok: false, detail: `ewSheetSync health ${r.status}: ${j.error || JSON.stringify(j).slice(0, 160)}` };
  } catch (e) { return { ok: false, detail: `ewSheetSync health unreachable: ${e.message}` }; }
}

async function checkCave() {
  const bad = [];
  let good = 0;
  // One slow answer is not an outage: the 2026-10-01 alert was a single 30 s
  // timeout on MICrONS that was fine the next hour. Try three times, a
  // minute apart, and only report a table that fails every time.
  const once = async (ds, t) => {
    try {
      const r = await timed(`${ds.server}/annotation/api/v2/aligned_volume/${ds.vol}/table/${t}`, {
        headers: { Authorization: `Bearer ${env.CAVE_SERVICE_TOKEN}` },
      });
      return r.ok ? null : String(r.status);
    } catch (e) { return e.message; }
  };
  let todo = CAVE_TABLES.flatMap(ds => ds.tables.map(t => ({ ds, t, err: '' })));
  const total = todo.length;
  for (let attempt = 1; attempt <= 3 && todo.length; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, 60000));
    const still = [];
    for (const x of todo) { x.err = await once(x.ds, x.t); if (x.err) still.push(x); }
    todo = still;
  }
  good = total - todo.length;
  for (const x of todo) bad.push(`${x.ds.label} ${x.t}: ${x.err} (3 tries)`);
  return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: `${good} table(s) answer` };
}

/**
 * The robot's AI step (Claude in GitHub Actions). When the Anthropic key is
 * out of credit, expired or revoked, the `model` job fails in under a second
 * and every proposal and build dies quietly (Ames 2026-10-01). Failing: the
 * model job failed in each of the last 3 runs that reached it, across the
 * propose and implement workflows.
 */
async function checkRobotAi() {
  const token = env.GITHUB_TOKEN;
  if (!token) return { ok: true, detail: 'not checked (no GitHub token)' };
  const gh = async (path) => {
    const r = await timed(`https://api.github.com/repos/seung-lab/ng-extend/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'eyewire-health-watch' },
    });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return r.json();
  };
  try {
    const runs = [];
    for (const wf of ['triage-propose.yml', 'triage-implement.yml']) {
      const j = await gh(`actions/workflows/${wf}/runs?status=completed&per_page=15`);
      runs.push(...(j.workflow_runs || []));
    }
    runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const verdicts = [];
    for (const run of runs) {
      if (verdicts.length >= 3) break;
      const jobs = (await gh(`actions/runs/${run.id}/jobs`)).jobs || [];
      const model = jobs.find(j => j.name === 'model');
      if (!model || model.conclusion === 'skipped') continue; // nothing to do that run
      verdicts.push({ ok: model.conclusion === 'success', url: run.html_url, at: run.created_at });
    }
    if (verdicts.length < 3 || verdicts.some(v => v.ok)) return { ok: true, detail: `AI step fine in ${verdicts.filter(v => v.ok).length} of the last ${verdicts.length} runs` };
    return { ok: false, detail: `Claude failed in the last 3 robot runs (latest ${verdicts[0].url}). `
      + 'Usually the Anthropic account is out of credit or the key expired: check console.anthropic.com, Billing and API Keys, '
      + 'then update the ANTHROPIC_API_KEY secret in GitHub if the key changed.' };
  } catch (e) { return { ok: true, detail: `not checked (${e.message})` }; }
}

/**
 * Ask Anthropic directly whether the robot's key works: a one token request,
 * so the alert carries Anthropic's own reason (out of credit, invalid key,
 * spend limit). The key itself is never printed.
 */
async function checkAnthropicKey() {
  if (!env.ANTHROPIC_API_KEY) return { ok: true, detail: 'not checked (no key in this job)' };
  try {
    const r = await timed('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
    });
    if (r.ok) return { ok: true, detail: 'Anthropic accepts the key' };
    const j = await r.json().catch(() => ({}));
    const why = `${j?.error?.type || 'error'}: ${String(j?.error?.message || '').slice(0, 240)}`;
    // Overload and rate limits pass on their own; only account or key problems alert.
    if ([429, 500, 529].includes(r.status) && !/credit|billing|spend/i.test(why)) return { ok: true, detail: `Anthropic busy (${r.status}), not a key problem` };
    return { ok: false, detail: `Anthropic refuses the robot's key (${r.status} ${why}). Fix at console.anthropic.com, then update ANTHROPIC_API_KEY in GitHub and Firebase if the key changed.` };
  } catch (e) { return { ok: true, detail: `not checked (${e.message})` }; }
}

async function checkPlayerFailures() {
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }) };
  try {
    const r = await timed(`${env.SUPABASE_URL}/rest/v1/client_errors?select=message,user_id&source=in.(sheet_sync,cave_write)`
      + `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=200`, { headers });
    if (!r.ok) return { ok: false, detail: `could not read client_errors (${r.status})` };
    const rows = (await r.json()).filter(x => !/\b401\b|sign in/i.test(x.message || ''));
    if (rows.length < FAILURE_THRESHOLD) return { ok: true, detail: `${rows.length} failed write(s) in the last hour` };
    const kinds = {};
    for (const x of rows) { const k = (x.message || '').split(':')[0]; kinds[k] = (kinds[k] || 0) + 1; }
    const people = new Set(rows.map(x => x.user_id).filter(Boolean)).size;
    const sample = rows[0].message.slice(0, 140);
    return { ok: false, detail: `${rows.length} failed write(s) in the last hour from ${people} player(s) `
      + `(${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}). Latest: ${sample}` };
  } catch (e) { return { ok: false, detail: `client_errors check failed: ${e.message}` }; }
}

async function slack(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`slack ${method}: ${j.error}`);
  return j;
}

/** The bot's most recent [health] message in the channel, if any. */
async function lastHealthMessage() {
  const r = await fetch(`https://slack.com/api/conversations.history?channel=${CHANNEL}&limit=200`, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`slack history: ${j.error}`);
  return (j.messages || []).find(m => m.bot_id && (m.text || '').includes(MARK)) || null;
}

(async () => {
  const results = {
    'Spreadsheet write-back': await checkSheets(),
    'CAVE tables': await checkCave(),
    'Player write failures': await checkPlayerFailures(),
    'Robot AI step': await checkRobotAi(),
    'Anthropic key': await checkAnthropicKey(),
  };
  for (const [name, r] of Object.entries(results)) console.log(`[health] ${r.ok ? 'OK  ' : 'FAIL'} ${name}: ${r.detail}`);
  const failing = Object.entries(results).filter(([, r]) => !r.ok);
  const signature = failing.map(([n]) => n).sort().join('|');

  const last = await lastHealthMessage().catch(e => { console.warn(e.message); return null; });
  const lastSig = last?.text?.match(/\{sig:([^}]*)\}/)?.[1] ?? '';
  // Slack hands the emoji back as :rotating_light:, so the 🚨 itself cannot
  // be matched; an alert is a message with a non-empty signature.
  const lastWasFailure = !!last && lastSig !== '';
  const lastAt = last ? Number(last.ts) * 1000 : 0;

  let text = null;
  if (failing.length) {
    const fresh = !lastWasFailure || lastSig !== signature || Date.now() - lastAt > REPEAT_MS;
    if (fresh) {
      text = `🚨 ${MARK} <@${TAG}> something players rely on is not working:\n`
        + failing.map(([n, r]) => `• *${n}*: ${r.detail}`).join('\n')
        + `\nI check every hour and will say here when it recovers. {sig:${signature}}`;
    }
  } else if (lastWasFailure) {
    text = `✅ ${MARK} Recovered: spreadsheet write-back, CAVE tables and player writes all look normal again. {sig:}`;
  }

  if (!text) { console.log('[health] nothing to post'); return; }
  if (DRY) { console.log('[health] DRY RUN, would post:\n' + text); return; }
  await slack('chat.postMessage', { channel: CHANNEL, text, unfurl_links: false });
  console.log('[health] posted to Slack');
})().catch(e => { console.error('[health] fatal:', e.message); process.exit(1); });
