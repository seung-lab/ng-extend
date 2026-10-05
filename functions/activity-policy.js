'use strict';
// What the server accepts as a logged activity (an edit_log row), and how it
// checks a split or merge with the graph server before counting it.
// Pure policy: tested without credentials, a database, or production writes.
//
// Why (leaderboard audit, 2026-10-05). The browser used to write its own
// totals on its profile row, and insert log rows nobody checked. Now a browser
// can only REPORT an event. The server decides whether it happened, records
// it once, and moves the counters itself (SQL: ew_log_activity).
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

// The operations edit_log has always held, plus 'annotate'.
const OPERATIONS = new Set(['split','merge','undo_split','undo_merge','mark_complete','unmark_complete',
  'set_cell_type','claim_task','release_task','complete_task','annotate']);
const GRAPH_EDITS = new Set(['split','merge']);

// Graph servers the server may ask about an operation. The player's sign-in
// token is sent ONLY to these hosts (the same host identity is checked with).
// MEC's server (hc.himc-cave.com) is left out on purpose for now: its edits
// are recorded as unverified rather than sending tokens or load its way.
const GRAPH_HOSTS = new Set(['minnie.microns-daf.com']);
// Graph table -> the dataset name its rows are logged under.
const TABLE_DATASET = Object.freeze({
  stroeh_mouse_retina: 'stroeh_mouse_retina',
  pinky_nf_v2: 'pinky_nf_v2',
  minnie65_public: 'minnie65_public',
  minnie3_v1: 'minnie3_v1',
});
/** How old an operation may be and still be reported as a game edit. Edits
 *  are reported the moment the graph server answers; this only has to cover
 *  a slow connection, and keeps old work done in other tools from being
 *  reported as play. */
const MAX_OPERATION_AGE_MS = 15 * 60 * 1000;

const text = (v, max, name) => {
  if (v == null) return null;
  if (typeof v !== 'string' && typeof v !== 'number') fail(400, `Invalid ${name}.`);
  const s = String(v);
  if (s.length > max) fail(400, `${name} is too long.`);
  return s;
};

/** Where a reported split or merge can be looked up, or null. */
function graphTarget(metadata) {
  const id = metadata?.operation_id;
  if (id == null || !/^[1-9]\d{0,18}$/.test(String(id))) return null;
  let url; try { url = new URL(String(metadata.graph || '')); } catch { return null; }
  const table = url.pathname.match(/\/table\/([A-Za-z0-9_]{1,80})\/?$/)?.[1];
  if (url.protocol !== 'https:' || !table) return null;
  return {host: url.hostname, table, operationId: String(id), trusted: GRAPH_HOSTS.has(url.hostname)};
}

/**
 * The row to record, from what a browser sent. Unknown fields are dropped;
 * identity, time and the row id are never taken from the browser (the caller
 * passes the signed-in player to the database function separately).
 */
function cleanActivityRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid row');
  const operation = String(value.operation || '');
  if (!OPERATIONS.has(operation)) fail(400, 'Unknown operation.');
  if (value.success != null && typeof value.success !== 'boolean') fail(400, 'Invalid success flag.');
  if (value.task_id != null && (!Number.isSafeInteger(value.task_id) || value.task_id <= 0)) fail(400, 'Invalid task.');
  let metadata = null;
  if (value.metadata != null) {
    if (typeof value.metadata !== 'object' || Array.isArray(value.metadata)) fail(400, 'Invalid details.');
    if (JSON.stringify(value.metadata).length > 4000) fail(413, 'Details are too large.');
    metadata = {...value.metadata};
    // Set by the server only.
    delete metadata.verified; delete metadata.verified_by;
  }
  const dataset = value.dataset == null || value.dataset === '' ? 'eyewire_ii' : String(value.dataset);
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(dataset)) fail(400, 'Invalid dataset.');
  const row = {
    operation, task_id: value.task_id ?? null, success: value.success ?? true, dataset, metadata,
    segment_before: text(value.segment_before, 4000, 'segment list'),
    segment_after: text(value.segment_after, 4000, 'segment list'),
    coordinates: text(value.coordinates, 200, 'coordinates'),
    op_key: null,
  };
  if (GRAPH_EDITS.has(operation)) {
    // A split or merge is keyed by the graph server's own operation id, so it
    // can be recorded once only, whoever reports it and however many times.
    const target = graphTarget(metadata);
    if (target) {
      row.op_key = `pcg:${target.table}:${target.operationId}`;
      if (target.trusted && TABLE_DATASET[target.table]) row.dataset = TABLE_DATASET[target.table];
    }
  } else if (value.op_key != null) {
    // Anything else may carry an id made when the button was pressed, so a
    // retry or a second tab is not a second row.
    if (typeof value.op_key !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value.op_key)) fail(400, 'Invalid operation key.');
    row.op_key = 'c:' + value.op_key;
  }
  return row;
}

/**
 * Ask the graph server whether this split or merge happened, and whose it is.
 *   'verified'    it exists, succeeded, is this player's, and is recent
 *   'rejected'    the graph server says otherwise: do not record it
 *   'unverified'  it could not be checked (no operation id from an older app
 *                 version, a graph server we do not ask, or no answer)
 * Returns {state, operation?}: when verified, `operation` is what the graph
 * server says it was (an added edge is a merge, a removed one a split).
 */
async function verifyGraphEdit(row, who, token, fetchImpl = fetch, now = Date.now()) {
  if (!GRAPH_EDITS.has(row.operation)) return {state: 'not_applicable'};
  const target = graphTarget(row.metadata);
  if (!target || !target.trusted || !token || who?.caveId == null) return {state: 'unverified'};
  let details;
  try {
    const url = `https://${target.host}/segmentation/api/v1/table/${target.table}/operation_details?int64_as_str=1&operation_ids=${encodeURIComponent('['+target.operationId+']')}`;
    const res = await fetchImpl(url, {headers: {Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(8000)});
    if (!res.ok) return {state: 'unverified'};
    details = await res.json();
  } catch { return {state: 'unverified'}; }
  const d = details && typeof details === 'object' ? details[target.operationId] : null;
  if (!d) return {state: 'rejected', why: 'The graph server has no such operation.'};
  if (String(d.user) !== String(who.caveId)) return {state: 'rejected', why: 'That operation is not yours.'};
  if (Number(d.operation_status) !== 0) return {state: 'rejected', why: 'That operation did not succeed.'};
  const at = Date.parse(String(d.timestamp || d.operation_ts || '').replace(' ', 'T'));
  if (!Number.isFinite(at) || now - at > MAX_OPERATION_AGE_MS || at - now > 5 * 60 * 1000) return {state: 'rejected', why: 'That operation is not a current edit.'};
  const operation = Array.isArray(d.added_edges) ? 'merge' : Array.isArray(d.removed_edges) ? 'split' : null;
  if (!operation) return {state: 'rejected', why: 'That operation is not a split or a merge.'};
  return {state: 'verified', operation};
}

// Counters only the server may move once it records activity itself.
const SERVER_COUNTERS = ['total_edits','total_merges','total_splits','cells_completed','current_streak',
  'longest_streak','last_edit_date','total_annotations'];
/** Drop the counters from a profile write. Returns true when it removed any. */
function stripCounters(row) {
  let removed = false;
  for (const k of SERVER_COUNTERS) if (row && k in row) { delete row[k]; removed = true; }
  return removed;
}

module.exports = {cleanActivityRow, verifyGraphEdit, graphTarget, stripCounters, OPERATIONS, SERVER_COUNTERS, MAX_OPERATION_AGE_MS};
