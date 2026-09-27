export interface PracticeOperation { operationId: number; at: number }

export function parsePcgStamp(value: unknown): number {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(\.\d+)?$/.test(value)) return parsePcgStamp(Number(value));
  const iso = value.replace(' ', 'T');
  return Date.parse(iso + (/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
}

export function practiceOperationsAfter(data: any, rootId: string, baseline: string): PracticeOperation[] {
  let rows = data[String(rootId)] ?? data;
  if (typeof rows === 'string') rows = JSON.parse(rows);
  if (!Array.isArray(rows)) {
    if (!rows || !Object.prototype.hasOwnProperty.call(rows, 'operation_id') || !Object.prototype.hasOwnProperty.call(rows, 'timestamp')) throw Error('Unrecognized CAVE operation history shape');
    rows = Object.keys(rows.operation_id).map(i => ({ operation_id: rows.operation_id[i], timestamp: rows.timestamp?.[i] }));
  }
  const ops: PracticeOperation[] = rows.map((row: any) => ({ operationId: Number(row.operation_id), at: parsePcgStamp(row.timestamp) }));
  if (!Number.isFinite(Date.parse(baseline)) || ops.some(row => !Number.isSafeInteger(row.operationId) || row.operationId < 0 || !Number.isFinite(row.at) || row.at > Date.now() + 60000)) throw Error('Unrecognized CAVE operation history');
  const result = ops.filter(row => row.at > Date.parse(baseline)).sort((a, b) => b.at - a.at);
  if (result.length > 10000) throw Error('Unexpectedly large practice history; ask an admin to review this example.');
  return result;
}

/** Cancel completed undo pairs; undoing an undo leaves the original edit active.
 * Redo operations are ordinary edits whose own effect can be undone. */
export function remainingPracticeOperations(ops: PracticeOperation[], details: Record<string, any>): PracticeOperation[] {
  const ids = new Set(ops.map(op => op.operationId)), cancelled = new Set<number>();
  for (const op of [...ops].sort((a, b) => b.at - a.at || b.operationId - a.operationId)) {
    const detail = details[String(op.operationId)];
    if (!detail || Number(detail.operation_status) !== 0) throw Error('Missing or unsuccessful CAVE operation details');
    if (cancelled.has(op.operationId)) continue;
    if (detail.undo_operation_id != null) {
      const target = Number(detail.undo_operation_id);
      if (!Number.isSafeInteger(target) || target < 0 || target >= op.operationId) throw Error('Invalid CAVE undo reference');
      if (ids.has(target)) {
        if (cancelled.has(target)) throw Error('Ambiguous repeated CAVE undo; ask an admin to review this example.');
        cancelled.add(op.operationId); cancelled.add(target);
      }
    }
  }
  const active = ops.filter(op => !cancelled.has(op.operationId)).sort((a, b) => b.at - a.at || b.operationId - a.operationId);
  if (active.length > 200) throw Error('Unexpectedly large active practice history; ask an admin to review this example.');
  return active;
}
