/**
 * Is a segment ID still the cell's current one?
 *
 * An edit gives a cell a new ID, so an ID kept in a list, a link or a note
 * goes out of date the moment anyone edits that cell. The old lightbulb told
 * you so; this is that check again (Ames 2026-10-08: "the old lightbulb
 * technique of letting user know if segID is out of date").
 *
 * Cheap on purpose: only the IDs actually in your segment list are asked
 * about, many at once in a single request, and each answer is remembered.
 * "Out of date" never changes back, so it is kept for the session. "Current"
 * can stop being true, so it is asked again after a minute.
 */
import { isLatestRoots, latestDescendants } from '../widgets/pcg_service';
import { currentSegLayer } from '../datasets';
import { Uint64 } from 'neuroglancer/util/uint64';

const CURRENT_FOR_MS = 60_000;
const WAIT_MS = 250;      // gather the IDs of a list being drawn into one request
const MAX_PER_REQUEST = 400;

const known = new Map<string, { latest: boolean; at: number }>();
let waiting = new Map<string, ((latest: boolean | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = waiting;
  waiting = new Map();
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += MAX_PER_REQUEST) {
    const part = ids.slice(i, i + MAX_PER_REQUEST);
    const flags = await isLatestRoots(part).catch(() => null);
    for (const id of part) {
      const latest = flags?.get(id);
      if (latest !== undefined) known.set(id, { latest, at: Date.now() });
      for (const done of batch.get(id) ?? []) done(latest ?? null);
    }
  }
}

/** True: current. False: the cell has been edited since and this ID is old.
 *  Null: could not be checked (no proofreading graph here, or CAVE did not
 *  answer), which must never be shown as out of date. */
export function isCurrentId(id: string): Promise<boolean | null> {
  if (!/^\d+$/.test(id) || id === '0') return Promise.resolve(null);
  const hit = known.get(id);
  if (hit && (!hit.latest || Date.now() - hit.at < CURRENT_FOR_MS)) return Promise.resolve(hit.latest);
  return new Promise(resolve => {
    (waiting.get(id) ?? waiting.set(id, []).get(id)!).push(resolve);
    if (!timer) timer = setTimeout(() => { void flush(); }, WAIT_MS);
  });
}

/**
 * Swap an out of date ID in the view for what the cell is now. After splits
 * a cell can have become several pieces: all of them are shown, so the
 * player can see them and drop the ones they do not want.
 * Returns the IDs now showing, or null when the current ID could not be found.
 */
/** What an out of date ID has become: one current ID, or several pieces
 *  after splits. Null when it could not be looked up. Asked once per ID. */
const became = new Map<string, Promise<string[] | null>>();
export function currentIdsOf(id: string): Promise<string[] | null> {
  let p = became.get(id);
  if (!p) {
    p = latestDescendants(id).then(ends => (ends && ends.length && !(ends.length === 1 && ends[0] === id) ? ends : null)).catch(() => null);
    became.set(id, p);
    // A failed lookup is asked again next time.
    void p.then(v => { if (!v) became.delete(id); });
  }
  return p;
}

export async function updateToCurrentId(id: string): Promise<string[] | null> {
  const ends = await currentIdsOf(id);
  if (!ends) return null;
  const group = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value;
  if (!group?.visibleSegments) return null;
  const old = Uint64.parseString(id);
  const wasSelected = !!group.selectedSegments?.has(old);
  for (const e of ends) {
    const u = Uint64.parseString(e);
    if (wasSelected || !group.selectedSegments) group.selectedSegments?.add(u);
    group.visibleSegments.add(u);
  }
  group.visibleSegments.delete(old);
  group.selectedSegments?.delete(old);
  return ends;
}
