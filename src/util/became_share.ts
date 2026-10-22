/**
 * Which of the cells alive now an old cell ID became (src/widgets/pcg_service.ts
 * currentPiecesOf). Kept free of imports so a node test can run it.
 *
 * Following an old ID's edit history forward finds every live end, and that
 * includes bits cut away from a wrong merger and then joined to the cells they
 * really belong to (Nseraf 2026-10-22, 720575940538342067: "Update to the
 * current ID" showed every one of them). So a sample of the old cell's
 * building blocks is asked which cell each is in now, and only the cells that
 * hold a real share of the old one are kept.
 */

/** A part of the old cell a piece must hold, besides the biggest, to be kept. */
export const MIN_SHARE = 0.2;
export const MAX_SAMPLE = 2000;

/** At most `max` of `ids`, spread evenly through them. */
export function evenSample<T>(ids: T[], max = MAX_SAMPLE): T[] {
  if (ids.length <= max) return ids.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(ids[Math.floor(i * ids.length / max)]);
  return out;
}

/**
 * `rootsNow[i]` is the cell block i of the old cell is in now. Returns the
 * biggest of those cells plus any other holding at least `minShare` of the
 * blocks, biggest first. With `ends` (the live ends of the edit history),
 * only cells among them count: a block whose answer is not a live end (its
 * chunk was rebuilt by an edit, so it points at a retired ID) is left out.
 * Empty when no block landed in a cell that counts.
 */
export function mainPieces(rootsNow: string[], ends: string[] | null = null, minShare = MIN_SHARE): string[] {
  const allowed = ends ? new Set(ends) : null;
  const count = new Map<string, number>();
  for (const r of rootsNow) {
    if (!/^\d+$/.test(r) || r === '0' || (allowed && !allowed.has(r))) continue;
    count.set(r, (count.get(r) ?? 0) + 1);
  }
  const ranked = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!ranked.length) return [];
  const total = rootsNow.length;
  return ranked.filter(([, n], i) => i === 0 || n >= minShare * total).map(([r]) => r);
}
