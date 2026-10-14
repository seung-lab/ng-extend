/**
 * nge: the cells a player pasted or typed into the Seg panel's box (Ames
 * 2026-10-14). An ID entered there is added to the view at once, shown, and
 * listed under its own "Pasted" heading above the cells already in view,
 * instead of appearing hidden in a separate search box that had to be
 * starred. Kept per segmentation group for this page only; nothing here is
 * saved in the view state, which still holds one list of cells.
 */
import {NullarySignal} from 'neuroglancer/util/signal';
import {Uint64} from 'neuroglancer/util/uint64';

export interface PastedSegments {
  ids: string[];
  changed: NullarySignal;
}

const pastedByGroup = new WeakMap<object, PastedSegments>();

export function getPastedSegments(group: object): PastedSegments {
  let p = pastedByGroup.get(group);
  if (p === undefined) {
    p = {ids: [], changed: new NullarySignal()};
    pastedByGroup.set(group, p);
  }
  return p;
}

/** The IDs in a box entry when it holds IDs and nothing else (commas, spaces,
 *  `#` and new lines between them are fine); undefined for anything else, a
 *  name or a /regexp, which stays a search. */
export function parsePastedIds(text: string): Uint64[]|undefined {
  const parts = text.split(/[\s,;#]+/).filter(s => s.length > 0);
  if (!parts.length) return undefined;
  const ids: Uint64[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined;
    const id = new Uint64();
    if (!id.tryParseString(part) || (id.low === 0 && id.high === 0)) return undefined;
    ids.push(id);
  }
  return ids;
}

/** Add the cells to the view, shown, and list them as pasted (newest paste
 *  first, each ID once). */
export function addPastedSegments(
    group: {selectedSegments: any, visibleSegments: any}, ids: Uint64[]) {
  if (!ids.length) return;
  group.selectedSegments.set(ids, true);
  group.visibleSegments.set(ids, true);
  const p = getPastedSegments(group);
  const fresh = ids.map(id => id.toString());
  p.ids = [...new Set([...fresh, ...p.ids.filter(s => !fresh.includes(s))])];
  p.changed.dispatch();
}

/** nge: the name Pyr shows on a cell's row (its type, from the cell status
 *  ng-extend reads), by segment ID, so the box can find cells by name. The
 *  layer's own label property is empty on most datasets, which is why a name
 *  search used to answer "No label property" (Ames 2026-10-14). */
export const segmentLabels = new Map<string, string>();

/** Three plain numbers, as copied from the coordinates line or a message
 *  ("48430, 29415, 582", "[48430 29415 582]", "x 48430 y 29415 z 582"), are a
 *  place, not three cells (Ames 2026-10-14: pasted coordinates turned into
 *  three empty rows). Cell IDs are far longer than any coordinate. */
export function parseCoordinates(text: string): number[]|undefined {
  const cleaned = text.replace(/[\[\](){}]/g, ' ').replace(/\b[xyz]\s*[:=]?/gi, ' ');
  const parts = cleaned.split(/[\s,;]+/).filter(s => s.length > 0);
  if (parts.length !== 3) return undefined;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isFinite(n) || n < 0 || n >= 1e8)) return undefined;
  return nums;
}

/** True when a row's cell matches the words typed in the box: the ID or the
 *  name, any case; `/text` is a regular expression. */
export function segmentMatchesFilter(id: string, filter: string): boolean {
  const f = filter.trim();
  if (!f) return true;
  const label = segmentLabels.get(id) ?? '';
  if (f.startsWith('/')) {
    try {
      const re = new RegExp(f.slice(1), 'i');
      return re.test(label) || re.test(id);
    } catch {
      return false;
    }
  }
  const lower = f.toLowerCase();
  return label.toLowerCase().includes(lower) || id.includes(lower);
}

/** Move the pasted cells down into the main list (they stay in view). */
export function clearPastedSegments(group: object) {
  const p = getPastedSegments(group);
  if (!p.ids.length) return;
  p.ids = [];
  p.changed.dispatch();
}
