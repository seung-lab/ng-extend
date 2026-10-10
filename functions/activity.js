'use strict';
// Recording a player's activity: check it, write it once, and let the
// database move the counters in the same transaction (ew_log_activity in
// supabase-leaderboard-accuracy.sql). See activity-policy.js for the rules.
const {cleanActivityRow, verifyGraphEdit, lineageTarget, sameCellAs, stripCounters, stripDayCounters} = require('./activity-policy');
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const NOBODY = '00000000-0000-0000-0000-000000000000';

// Has the database function been installed? Until it is, everything behaves
// exactly as before (plain log insert, the browser's own counters), so this
// code can be deployed first and takes over by itself the moment the SQL is
// run. Once seen, it is not asked again; while absent, it is asked at most
// once every five minutes per server instance.
const state = {ready: null, checkedAt: 0};
async function serverCounts(rpc, now = Date.now()) {
  if (state.ready === true) return true;
  if (state.ready === false && now - state.checkedAt < 5 * 60 * 1000) return false;
  state.checkedAt = now;
  try {
    // A player who does not exist: the function answers "unknown player"
    // and changes nothing. A missing function answers 404.
    const r = await rpc('ew_log_activity', {p_user: NOBODY, p_row: {operation: 'claim_task'}});
    state.ready = r.status === 400 && r.body?.code === 'P0001' && /unknown player/.test(String(r.body?.message));
  } catch { state.ready = false; }
  return state.ready;
}
/** For tests. */
function resetServerCounts() { state.ready = null; state.checkedAt = 0; }

/**
 * Record one reported event for the signed-in player.
 *   rpc(name, args) -> {status, body}   database function call, service role
 *   insertLegacy(row)                   the old plain insert
 * Returns {counted:false} while the database function is not installed (the
 * caller keeps the old behaviour), otherwise the function's answer: whether
 * the row was recorded or was a duplicate, and the player's counters.
 */
async function recordActivity({rpc, insertLegacy, who, me, token, value, fetchImpl}) {
  if (!me?.id) fail(401, 'Sign in first.');
  const row = cleanActivityRow(value);
  if (!(await serverCounts(rpc))) {
    const {op_key, ...legacy} = row;
    await insertLegacy({...legacy, user_id: me.id});
    return {counted: false};
  }
  const check = await verifyGraphEdit(row, who, token, fetchImpl);
  if (check.state === 'rejected') fail(403, check.why);
  if (check.state === 'verified') { row.operation = check.operation; row.metadata = {...row.metadata, verified: true}; }
  else if (check.state === 'unverified') row.metadata = {...(row.metadata || {}), verified: false};
  // A cell completed again after an edit is the same cell: tie a root id the
  // player has not logged before to the cell it came from. Until
  // supabase-completions-same-cell.sql is run the first call answers 404 and
  // nothing changes.
  if (lineageTarget(row)) {
    let known = null;
    try { known = await rpc('ew_completion_roots', {p_user: me.id, p_dataset: row.dataset}); } catch { /* counted by root id */ }
    if (known?.status === 200 && Array.isArray(known.body)) {
      const same = await sameCellAs(row, known.body, token, fetchImpl);
      if (same.state === 'same') row.metadata = {...row.metadata, same_cell_as: same.cell};
      else if (same.state === 'unchecked') row.metadata = {...row.metadata, lineage_checked: false};
    }
  }
  const r = await rpc('ew_log_activity', {p_user: me.id, p_row: row});
  if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
    // Say WHY, in the server log. This line used to be all there was, and a
    // database rule that refused every 'annotate' row went unseen for four
    // days (2026-10-05 to 10-09): hundreds of refusals, none with a reason.
    // The database's own code and message, and what kind of row it was;
    // nothing of the player's beyond that.
    console.error('[activity] the database refused a record', JSON.stringify({
      operation: row.operation, dataset: row.dataset, status: r.status,
      code: r.body && r.body.code, message: String((r.body && r.body.message) || '').slice(0, 300),
      details: String((r.body && r.body.details) || '').slice(0, 200),
    }));
    fail(500, 'The activity could not be recorded.');
  }
  return {counted: true, verified: check.state === 'verified' ? true : check.state === 'unverified' ? false : null, ...r.body};
}

module.exports = {recordActivity, serverCounts, resetServerCounts, stripCounters, stripDayCounters};
