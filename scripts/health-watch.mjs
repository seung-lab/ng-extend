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
  for (const ds of CAVE_TABLES) {
    for (const t of ds.tables) {
      try {
        const r = await timed(`${ds.server}/annotation/api/v2/aligned_volume/${ds.vol}/table/${t}`, {
          headers: { Authorization: `Bearer ${env.CAVE_SERVICE_TOKEN}` },
        });
        if (r.ok) good++; else bad.push(`${ds.label} ${t}: ${r.status}`);
      } catch (e) { bad.push(`${ds.label} ${t}: ${e.message}`); }
    }
  }
  return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: `${good} table(s) answer` };
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
  };
  for (const [name, r] of Object.entries(results)) console.log(`[health] ${r.ok ? 'OK  ' : 'FAIL'} ${name}: ${r.detail}`);
  const failing = Object.entries(results).filter(([, r]) => !r.ok);
  const signature = failing.map(([n]) => n).sort().join('|');

  const last = await lastHealthMessage().catch(e => { console.warn(e.message); return null; });
  const lastWasFailure = !!last && (last.text || '').includes('🚨');
  const lastSig = last?.text?.match(/\{sig:([^}]*)\}/)?.[1] ?? '';
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
