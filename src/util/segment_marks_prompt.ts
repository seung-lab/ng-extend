/**
 * Removing a segment from view can leave its marks behind (annkri, report
 * 309: "deleted segment had 20 checked and 3 true end marks, do you want to
 * delete them?"). When a player removes a segment that has marks made on it,
 * this asks. Nothing goes without their say.
 *
 * Only a segment the player removed themself counts: a cut or merge replaces
 * the id (another id comes in with it), and a loaded view replaces the list
 * with no click or key behind it.
 */
import { reactive } from 'vue';
import { currentSegLayer } from '../datasets';
import { marksOfCells, removeHighlightsOfCells } from './highlight';

export const segmentMarksPrompt = reactive<{ roots: string[]; counts: { label: string; n: number }[] }>({ roots: [], counts: [] });

export function deleteSegmentMarks() {
  removeHighlightsOfCells(segmentMarksPrompt.roots);
  keepSegmentMarks();
}
export function keepSegmentMarks() {
  segmentMarksPrompt.roots = [];
  segmentMarksPrompt.counts = [];
}

/** A click or key this recently can be what removed the segment. */
const INPUT_MS = 800;
/** Time for a cut or merge's new id to arrive before deciding. */
const SETTLE_MS = 700;
/** More than this at once is a Clear or a load: not one segment being tidied. */
const MAX_REMOVED = 3;

let lastInput = 0;
let watched: any = null;
let known = new Set<string>();
let pending = new Set<string>();
let added = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function decide() {
  timer = null;
  const roots = [...pending];
  const replaced = added;
  pending = new Set();
  added = false;
  if (replaced || !roots.length || roots.length > MAX_REMOVED) return;
  const counts = marksOfCells(roots);
  if (!counts.length) return;
  segmentMarksPrompt.roots = roots;
  segmentMarksPrompt.counts = counts;
}

function onChanged(group: any) {
  const now = new Set<string>();
  for (const id of group.selectedSegments) now.add(String(id));
  for (const id of now) if (!known.has(id)) added = true;
  if (Date.now() - lastInput < INPUT_MS) for (const id of known) if (!now.has(id)) pending.add(id);
  known = now;
  if (pending.size) { if (!timer) timer = setTimeout(decide, SETTLE_MS); } else added = false;
}

function attach() {
  let group: any = null;
  try { group = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value; } catch { /* not loaded */ }
  if (!group?.selectedSegments || group === watched) return;
  watched = group;
  known = new Set();
  for (const id of group.selectedSegments) known.add(String(id));
  group.selectedSegments.changed.add(() => { if (watched === group) onChanged(group); });
}

let started = false;
export function startSegmentMarksPrompt() {
  if (started) return;
  started = true;
  const note = () => { lastInput = Date.now(); };
  window.addEventListener('pointerdown', note, true);
  window.addEventListener('keydown', note, true);
  setInterval(attach, 1500);
  attach();
}
