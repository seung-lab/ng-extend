/**
 * Which cells of a list sheet come next (Sandbox, Ames 2026-11-01): the sheet
 * is much longer than the Cell Library should be, so its cells are added a
 * batch at a time, in the sheet's order, once few of the last ones are left.
 */

/** @param cells rows of the sheet: {index, point:[x,y,z]}
 *  @param tasks the dataset's tasks: {status, assigned_to, notes, source_sheet_url, claim_point_x, _y, _z}
 *  @param batch {sheetId, size, whenLeft, skipIndexes}
 *  @returns {unclaimed, due, candidates} candidates in sheet order, not yet added */
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
  return { unclaimed, due: unclaimed <= batch.whenLeft && candidates.length > 0, candidates };
}
