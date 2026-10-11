/**
 * Does a mark kept under an earlier ID of a cell belong to the ID it has now?
 *
 * A mark made in the Δ menu (cell type, completion) shows at once from a copy
 * kept in this browser under the ID the cell had then. An edit gives the cell
 * a new ID, and CAVE only reports a new mark some time later, so straight
 * after a merge the mark was gone from the menu (Nseraf 2026-10-11: "the
 * annotation does not follow with the new segID"). This finds the copy to
 * carry over to the new ID, the way CAVE itself decides: by the spot the mark
 * was made on.
 *
 * No network or storage of its own, so it can be tested as it is.
 */
export interface KeptMark {
  isComplete: boolean;
  cellType: string;
  /** The supervoxel the mark was made on, when known. */
  sv?: string;
}

export interface FollowLookups {
  /** Which of these IDs is this cell itself or led to it? Null: none. Undefined: could not ask. */
  ancestorAmong(root: string, candidates: string[]): Promise<string | null | undefined>;
  /** The cell a supervoxel is in now. */
  rootOfSupervoxel(sv: string): Promise<string | null>;
  /** What an old ID has become: one ID, or several pieces after cuts. */
  liveEnds(root: string): Promise<string[] | null>;
}

/** The ID whose mark belongs to `rootId` now, or null. `marks` is keyed by ID. */
export async function markToCarry(
    rootId: string, marks: Record<string, KeptMark | undefined>, look: FollowLookups): Promise<string | null> {
  if (!/^\d+$/.test(rootId) || marks[rootId]) return null;
  const marked = Object.keys(marks).filter(id => {
    const m = marks[id];
    return /^\d+$/.test(id) && !!m && (m.isComplete || !!m.cellType);
  });
  if (!marked.length) return null;
  const from = await look.ancestorAmong(rootId, marked);
  if (!from || from === rootId) return null;
  const old = marks[from];
  if (!old) return null;
  // After a cut the old cell lives on as more than one piece, and the mark
  // belongs to only one of them: the piece holding the spot it was made on.
  // Without that spot on record, it is carried only when there is one piece.
  if (old.sv) return (await look.rootOfSupervoxel(old.sv)) === rootId ? from : null;
  const ends = await look.liveEnds(from);
  return ends && ends.length === 1 && ends[0] === rootId ? from : null;
}
