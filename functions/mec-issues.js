'use strict';
// "MEC error" on a triage card (Ames 2026-11-07: "we need an 'MEC error'
// button that adds MEC to the sheet, celia should be able to press as well").
// Adds the report as one row of the "MEC segment issues (Pyr)" sheet, in the
// columns that sheet already has. Admins only (ewSheetSync checks).
//
// The report itself (player, date, text, view link, pictures, console log)
// is read by the server from site_issues, so nothing a browser sends can put
// a different link in the sheet. The segments and position come from the
// player's saved view, which only a signed in browser can open, so the admin's
// browser reads them and sends them here as plain numbers.

const MEC_ISSUES_SHEET = '1_ukhH3ymSxBJvKjy5uAZBsdby4DJwz5DATcozn58JE0';
const LIVE_SITE = 'https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com';
const HEADERS = ['Triage #', 'Date (UTC)', 'Player', 'Problem', 'Segment(s)', 'Made by op', 'X', 'Y', 'Z',
  'Jump link (MEC at this spot)', "Player's view", 'Video / images', 'Console log', 'Status'];

const bad = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const utc = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toISOString().slice(0, 16).replace('T', ' '); };
const utcTime = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toISOString().slice(11, 19); };

/** What the browser may send: the card's number, the view's segments and spot. */
function readInput(input) {
  const triageId = String(input.triageId || '');
  if (!/^[0-9a-f-]{36}$/i.test(triageId)) throw bad(400, 'bad report id');
  const number = Number(input.number);
  if (!Number.isInteger(number) || number < 1 || number > 1e6) throw bad(400, 'bad report number');
  const segments = (Array.isArray(input.segments) ? input.segments : [])
    .map(s => String(s).replace(/^!/, '')).filter(s => /^\d{1,20}$/.test(s));
  const at = Array.isArray(input.at) && input.at.length === 3 && input.at.every(v => Number.isFinite(Number(v)) && Math.abs(Number(v)) < 1e7)
    ? input.at.map(v => Math.round(Number(v))) : null;
  return { triageId, number, segments: [...new Set(segments)].slice(0, 8), at };
}

/** The console log in one line: the error messages, each once, with how often. */
function consoleSummary(log) {
  const counts = new Map();
  for (const line of String(log || '').split('\n')) {
    const m = /^\d\d:\d\d:\d\d (ERROR|WARN) (.*)$/.exec(line.trim());
    if (!m || m[1] !== 'ERROR') continue;
    const key = clip(m[2]
      .replace(/https?:\/\/\S+?\/([^/\s?]+)(\?\S*)?(?=[\s)]|$)/g, '$1')  // a URL by its last part
      .replace(/\b\d{6,}\b/g, '…'), 90);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return log ? 'no errors' : '';
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, n]) => n === 1 ? `${k} (once)` : `${k} (${n} times)`).join('; ');
}

/** The player's last cut or merge in MEC before they sent it: probably the one. */
function madeBy(edits) {
  const e = (edits || []).find(x => ['split', 'merge'].includes(x.operation));
  if (!e) return '';
  const op = e.metadata && e.metadata.operation_id;
  return `${e.operation}${op ? ' ' + op : ''} (${utcTime(e.created_at)}), their last ${e.operation === 'split' ? 'cut' : 'merge'} before the report (not checked)`;
}

/** The sheet row, in the sheet's own column order. */
function issueRow({ number, segments, at }, issue, edits) {
  const text = String(issue.message || '');
  const links = [...new Set((text.match(/https?:\/\/\S+/g) || []).map(u => u.replace(/[)"'.,]+$/, '')))];
  const pictures = [issue.screenshot_url, ...links.filter(u => /imgur|youtu|loom|\.(png|jpe?g|gif|webp|mp4|mov)(\?|$)/i.test(u))].filter(Boolean);
  const words = clip(text.replace(/https?:\/\/\S+/g, '').replace(/^["“]|["”]$/g, ''), 300);
  const title = clip(issue.title, 120);
  const problem = title && words && !words.startsWith(title) ? `${title}: ${words}` : (words || title);
  const jump = at ? `${LIVE_SITE}/?at=${encodeURIComponent(at.join(','))}&ds=pni_mec` : '';
  return [String(number), utc(issue.created_at), clip(issue.user_name, 80) || 'unknown', problem,
    segments.length ? segments.join(', ') : 'not given: open the view to read them', madeBy(edits),
    at ? String(at[0]) : '', at ? String(at[1]) : '', at ? String(at[2]) : '', jump,
    /^https:\/\//.test(issue.url || '') ? String(issue.url).slice(0, 1000) : '',
    pictures.join(' ').slice(0, 1000), consoleSummary(issue.console_log), 'Open'];
}

/** The bell to the player who sent it, in Ames's words. */
function reporterBell(number, issue) {
  const title = clip(issue.title || String(issue.message || '').replace(/https?:\/\/\S+/g, ''), 80) || 'your report';
  return { title: '🧩 Added to the MEC known segment error report',
    body: `Your triage #${number} about "${title}" has been added to the MEC known segment error report. Thank you for reporting it.`,
    target_type: 'user', target_id: issue.user_id, send_at: new Date().toISOString() };
}

/**
 * io: sb (Supabase REST), api (Sheets REST, path relative to /spreadsheets/).
 * Returns { row, already } where row is the sheet row number.
 */
async function addIssue(input, io) {
  const want = readInput(input);
  const triage = (await io.sb(`feedback_triage?id=eq.${want.triageId}&select=id,source,source_id&limit=1`))[0];
  if (!triage || triage.source !== 'site_issue') throw bad(404, 'Only a player\'s report can go on the MEC sheet.');
  const issue = (await io.sb(`site_issues?id=eq.${encodeURIComponent(triage.source_id)}&select=id,user_id,user_name,title,message,url,screenshot_url,console_log,created_at&limit=1`))[0];
  if (!issue) throw bad(404, 'That report is gone.');

  const meta = await io.api(MEC_ISSUES_SHEET + '?fields=sheets.properties(sheetId,title,index)');
  const tab = (meta.sheets || []).map(s => s.properties).sort((a, b) => a.index - b.index)[0];
  if (!tab) throw bad(503, 'The MEC sheet has no tab.');
  const q = "'" + tab.title.replace(/'/g, "''") + "'";
  // Once per report: pressing it again says where it already is.
  const col = (await io.api(MEC_ISSUES_SHEET + '/values/' + encodeURIComponent(q + '!A1:A5000'))).values || [];
  const head = (col[0] || [])[0];
  if (head !== HEADERS[0]) throw bad(503, 'The MEC sheet\'s first column is no longer "Triage #".');
  const found = col.findIndex((r, i) => i > 0 && String((r || [])[0]).trim() === String(want.number));
  if (found > 0) return { row: found + 1, already: true };

  let edits = [];
  if (issue.user_id) {
    const since = new Date(Date.parse(issue.created_at) - 60 * 60 * 1000).toISOString();
    try {
      edits = await io.sb(`edit_log?user_id=eq.${encodeURIComponent(issue.user_id)}&dataset=eq.pni_mec&operation=in.(split,merge)`
        + `&created_at=lte.${encodeURIComponent(issue.created_at)}&created_at=gte.${encodeURIComponent(since)}`
        + '&select=operation,metadata,created_at&order=created_at.desc&limit=1');
    } catch (e) { edits = []; }
  }
  const values = [issueRow(want, issue, edits)];
  const out = await io.api(MEC_ISSUES_SHEET + '/values/' + encodeURIComponent(q + '!A1:N1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { method: 'POST', body: JSON.stringify({ values }) });
  const m = /![A-Z]+(\d+)/.exec((out.updates && out.updates.updatedRange) || '');
  // The player hears it went on the list (Ames 2026-11-07), once, only them.
  // A report sent without signing in has nobody to tell.
  let notified = false;
  if (issue.user_id && io.bell) {
    try { await io.bell(reporterBell(want.number, issue)); notified = true; }
    catch (e) { console.warn('[mec-issues] bell not sent', String(e && e.message || e).slice(0, 200)); }
  }
  return { row: m ? Number(m[1]) : null, already: false, notified };
}

module.exports = { addIssue, issueRow, reporterBell, consoleSummary, readInput, madeBy, MEC_ISSUES_SHEET, HEADERS };
