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

/** Fires when names arrive, so a list narrowed by name updates. */
export const segmentLabelsChanged = new NullarySignal();

/** Set by the app: look up the names of cells not drawn yet (a row's name is
 *  only read when its row is on screen, so a search by name missed cells
 *  scrolled out of sight). */
let labelRequester: ((ids: string[]) => void)|undefined;
export function setSegmentLabelRequester(fn: (ids: string[]) => void) {
  labelRequester = fn;
}
export function requestSegmentLabels(ids: string[]) {
  labelRequester?.(ids);
}

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

/** Whether pasted numbers are a place. Brackets, x/y/z or a decimal point
 *  always say so. Three plain numbers are a place only where cell IDs are
 *  long (a graphene volume, or a list already holding long IDs): on MANC,
 *  MCNS or MAOL a cell ID has 5 or 6 digits, so there three plain numbers
 *  are three cells. */
export function placeFrom(text: string, layer: any): number[]|undefined {
  const nums = parseCoordinates(text);
  if (nums === undefined) return undefined;
  if (/[\[\](){}]|\b[xyz]\s*[:=]?\s*\d|\d\.\d/i.test(text)) return nums;
  let longIds = false;
  try {
    for (const ds of layer?.dataSources ?? []) {
      if (/graphene:\/\//.test(String(ds?.spec?.url ?? ''))) longIds = true;
    }
    for (const id of layer?.displayState?.segmentationGroupState?.value?.selectedSegments ?? []) {
      if (id.toString().length >= 12) longIds = true;
      break;
    }
  } catch { /* unknown: keep them as IDs */ }
  return longIds ? nums : undefined;
}

/** The words that narrow the lists: none while the box holds what looks
 *  like IDs or coordinates being typed (brackets, or several numbers), which
 *  Enter acts on instead (Ames 2026-10-14: "It's treating ( as a query"). One
 *  number still narrows the lists to IDs that contain it. */
export function listFilterOf(text: string): string {
  const t = text.trim();
  if (/^[\s\d,;.:=xyz()\[\]{}#-]*$/i.test(t) && (/[(\[{]/.test(t) || /\d[\s,;]+\d/.test(t))) return '';
  return t;
}

/** Set by the app: find the cell at the view's centre once it has loaded,
 *  for a pasted coordinate (Ames 2026-10-14: "can we make it load the segID
 *  for that coord?"). */
let placeCellLoader: ((group: any) => void)|undefined;
export function setPlaceCellLoader(fn: (group: any) => void) {
  placeCellLoader = fn;
}
export function loadCellAtPlace(group: any) {
  placeCellLoader?.(group);
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
