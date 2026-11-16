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
import { marksNowOn, removeTrackedMarks, type TrackedMark } from './highlight';
import { getPcgInfo, authHeaders } from '../widgets/pcg_service';

/** Are these still whole cells on the server? An id a merge or cut replaced is
 *  not: that segment was edited, not removed, however late its new id turns up
 *  (Nseraf 2026-11-01: asked to delete marks after a merge). If the server can't
 *  say, it counts as edited, so a player is not asked over nothing. */
async function stillLatest(roots: string[]): Promise<boolean> {
  try {
    const pcg = getPcgInfo();
    if (!pcg) return false;
    const res = await fetch(`${pcg.server}/segmentation/api/v1/table/${pcg.table}/is_latest_roots?int64_as_str=1`, {
      method: 'POST',
      headers: { ...(authHeaders(pcg.server) as Record<string, string>), 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_ids: roots }),
    });
    if (!res.ok) return false;
    const latest = (await res.json())?.is_latest;
    return Array.isArray(latest) && latest.length === roots.length && latest.every(Boolean);
  } catch { return false; }
}

export const segmentMarksPrompt = reactive<{ counts: { label: string; n: number }[] }>({ counts: [] });
let found: TrackedMark[] = [];

export function deleteSegmentMarks() {
  removeTrackedMarks(found);
  keepSegmentMarks();
}
export function keepSegmentMarks() {
  found = [];
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
/** When the player added a segment by itself (no other id went at the same
 *  time, so not a merge or cut). Marks made before it are not on it (#517). */
const addedAt = new Map<string, number>();
let lastAdd: { ids: string[]; at: number } = { ids: [], at: 0 };
const REPLACE_MS = 3000;
let pending = new Set<string>();
let added = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function decide() {
  timer = null;
  const roots = [...pending];
  const replaced = added;
  pending = new Set();
  added = false;
  if (replaced || !roots.length || roots.length > MAX_REMOVED) return;
  if (!(await stillLatest(roots))) return;
  // Every removed segment added after the mark: the oldest add decides.
  const since = roots.every(r => addedAt.has(r)) ? Math.min(...roots.map(r => addedAt.get(r)!)) : 0;
  let marks: TrackedMark[] = [];
  try { marks = await marksNowOn(roots, [...known], since); } catch (e) { console.warn('[marks] could not look for this segment\'s marks:', e); }
  if (!marks.length) return;
  const counts = new Map<string, number>();
  for (const m of marks) counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
  found = marks;
  segmentMarksPrompt.counts = [...counts].map(([label, n]) => ({ label, n }));
}

function onChanged(group: any) {
  const now = new Set<string>();
  for (const id of group.selectedSegments) now.add(String(id));
  const fresh = [...now].filter(id => !known.has(id));
  if (fresh.length) added = true;
  if (fresh.length && [...known].every(id => now.has(id))) {
    for (const id of fresh) addedAt.set(id, Date.now());
    lastAdd = { ids: fresh, at: Date.now() };
  }
  // Ids going right after one came in: that was a merge or cut arriving in two
  // steps, not the player adding a segment.
  if ([...known].some(id => !now.has(id)) && Date.now() - lastAdd.at < REPLACE_MS) for (const id of lastAdd.ids) addedAt.delete(id);
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
