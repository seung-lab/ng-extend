/**
 * Which cells of a list sheet come next (Sandbox, Ames 2026-11-01): the sheet
 * is much longer than the Cell Library should be, so it is kept topped up to
 * `size` unclaimed cells, taken in the sheet's order (Ames 2026-11-12: "it
 * should keep 50").
 */

/** True when nobody has proofread this cell: no edits at all, or only the
 *  setup merge (Ames 2026-11-01: players start from the pre-proofread cell).
 *  @param editors {user id: {n_mergers, n_splits}} from the cell's history */
export function untouched(editors, setupEditor) {
  return Object.entries(editors || {}).every(([user, e]) =>
    user === setupEditor && (e.n_mergers || 0) <= 1 && !(e.n_splits || 0));
}

/** @param cells rows of the sheet: {index, point:[x,y,z]}
 *  @param tasks the dataset's tasks: {status, assigned_to, notes, source_sheet_url, claim_point_x, _y, _z}
 *  @param batch {sheetId, size, skipIndexes}
 *  @returns {unclaimed, need, due, candidates} candidates in sheet order, not yet added */
export function nextBatch(cells, tasks, batch) {
  const mine = tasks.filter(t => (t.source_sheet_url || '').includes(batch.sheetId));
  // Every task counts as added, whatever became of it: a finished or hidden
  // cell never comes back. The note covers a claim point that was moved.
  const points = new Set(mine.filter(t => t.claim_point_x != null).map(t => `${t.claim_point_x},${t.claim_point_y},${t.claim_point_z}`));
  const indexes = new Set(mine.map(t => (t.notes || '').match(/Sheet #([\w-]+)/)?.[1]).filter(Boolean));
  const skip = new Set(batch.skipIndexes || []);
  const unclaimed = mine.filter(t => t.status === 'pending' && !t.assigned_to).length;
  const seen = new Set();
  const candidates = cells.filter(c => {
    const k = c.point.join(',');
    if (points.has(k) || seen.has(k) || indexes.has(c.index) || skip.has(c.index)) return false;
    seen.add(k);
    return true;
  });
  const need = Math.max(0, batch.size - unclaimed);
  return { unclaimed, need, due: need > 0 && candidates.length > 0, candidates };
}
