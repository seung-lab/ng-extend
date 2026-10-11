'use strict';
// A cell's edit history from the chunkedgraph, and which edits are still in
// effect. The same rules as scripts/practice-reset-policy.mjs (the practice
// cell reset job) and src/util/practice_history.ts (the browser's reset);
// pcg-history.test.js checks this copy against the job's.

function parsePcgStamp(value) {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(\.\d+)?$/.test(value)) return parsePcgStamp(Number(value));
  const iso = value.replace(' ', 'T');
  return Date.parse(iso + (/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
}

/** The operations in a root's history after the baseline, newest first.
 *  `data` is the chunkedgraph's tabular_change_log answer for the root. */
function operationsAfter(data, rootId, baseline) {
  let rows = data[String(rootId)] ?? data;
  if (typeof rows === 'string') rows = JSON.parse(rows);
  if (!Array.isArray(rows)) {
    if (!rows || !Object.hasOwn(rows, 'operation_id') || !Object.hasOwn(rows, 'timestamp')) throw Error('Unrecognized CAVE operation history shape');
    const ids = rows.operation_id ?? {};
    rows = Object.keys(ids).map(i => ({operation_id: ids[i], timestamp: rows.timestamp?.[i]}));
  }
  const ops = rows.map(row => ({operationId: Number(row.operation_id), at: parsePcgStamp(row.timestamp)}));
  if (!Number.isFinite(Date.parse(baseline)) || ops.some(row => !Number.isSafeInteger(row.operationId) || row.operationId < 0 || !Number.isFinite(row.at) || row.at > Date.now() + 60000)) throw Error('Unrecognized CAVE operation history');
  const result = ops.filter(row => row.at > Date.parse(baseline)).sort((a, b) => b.at - a.at);
  if (result.length > 10000) throw Error('Unexpectedly large history; an admin has to look at this cell.');
  return result;
}

/** Drop completed undo pairs: undoing an undo leaves the original edit in
 *  effect. Redo operations are ordinary edits whose own effect can be undone. */
function remainingOperations(ops, details) {
  const ids = new Set(ops.map(op => op.operationId)), cancelled = new Set();
  for (const op of [...ops].sort((a, b) => b.at - a.at || b.operationId - a.operationId)) {
    const detail = details[String(op.operationId)];
    if (!detail || Number(detail.operation_status) !== 0) throw Error('Missing or unsuccessful CAVE operation details');
    if (cancelled.has(op.operationId)) continue;
    if (detail.undo_operation_id != null) {
      const target = Number(detail.undo_operation_id);
      if (!Number.isSafeInteger(target) || target < 0 || target >= op.operationId) throw Error('Invalid CAVE undo reference');
      if (ids.has(target)) {
        if (cancelled.has(target)) throw Error('Ambiguous repeated CAVE undo; an admin has to look at this cell.');
        cancelled.add(op.operationId); cancelled.add(target);
      }
    }
  }
  const active = ops.filter(op => !cancelled.has(op.operationId)).sort((a, b) => b.at - a.at || b.operationId - a.operationId);
  if (active.length > 200) throw Error('Unexpectedly large active history; an admin has to look at this cell.');
  return active;
}

module.exports = {parsePcgStamp, operationsAfter, remainingOperations};
