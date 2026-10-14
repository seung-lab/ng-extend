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

/** Move the pasted cells down into the main list (they stay in view). */
export function clearPastedSegments(group: object) {
  const p = getPastedSegments(group);
  if (!p.ids.length) return;
  p.ids = [];
  p.changed.dispatch();
}
