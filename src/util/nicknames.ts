/**
 * Nicknames (Nseraf, report 602; Ames 2026-11-21: "Nickname it is"): a
 * player's own name for a cell, like "cell I merged a branch into", that is
 * not a cell type. Only they see it; it never goes to CAVE or the lab. It is
 * kept on the server (functions/nicknames.js) so it follows them to another
 * computer, and in this browser too (the newest wins, and a server that does
 * not know nicknames yet still leaves them working here).
 *
 * It follows the cell through merges and cuts: each nickname keeps every ID the
 * cell has had and, when known, a supervoxel inside it (the anchor). After an
 * edit, a nickname whose cell is on screen asks the anchor for the cell's ID
 * now and adds it. Pyr shows the nickname wherever it shows a cell's name
 * (store.ts getNickname: My Cells, the side panel, the Profile).
 */
import { reactive } from 'vue';
import { Uint64 } from 'neuroglancer/util/uint64';
import { secureWrite } from '../secure_write';
import { currentSegLayer } from '../datasets';
import { getRootFromSupervoxel, latestDescendants } from '../widgets/pcg_service';

export const NICKNAME_MAX = 80;
export interface Nickname { key: string; nickname: string; ids: string[]; anchor: string | null; at: number }

const LOCAL_KEY = 'nge_nicknames_v1';
/** By the cell's first ID (key). */
const byKey = reactive<Record<string, Nickname>>({});
/** Any ID the cell has had, to its key. */
const keyOf = reactive<Record<string, string>>({});

function index(n: Nickname) {
  for (const id of [n.key, ...n.ids]) keyOf[id] = n.key;
}
function unindex(key: string) {
  for (const [id, k] of Object.entries(keyOf)) if (k === key) delete keyOf[id];
}
function persist() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Object.values(byKey))); } catch { /* private window */ }
  // The segments list shows nicknames (button_service applyRowLabel).
  setTimeout(() => document.dispatchEvent(new CustomEvent('nge:nicknames-changed')), 0);
}
(function loadLocal() {
  try {
    for (const n of JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as Nickname[]) {
      if (n && n.key && n.nickname) { byKey[n.key] = { ...n, ids: n.ids || [] }; index(byKey[n.key]); }
    }
  } catch { /* nothing kept */ }
})();

/** The nickname for any ID the cell has had, or undefined. */
export function nicknameOf(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const k = keyOf[id];
  return k ? byKey[k]?.nickname : undefined;
}
/** The key (first ID) of the cell this ID belongs to, if it has a nickname. */
export const nicknameKeyOf = (id: string) => keyOf[id];

let loaded = false;
/** This player's nicknames from the server; this browser's newer ones stay. */
export async function loadNicknames(force = false): Promise<void> {
  if (loaded && !force) return;
  try {
    const res = await secureWrite<{ nicknames: any[] }>('nicknames.list');
    loaded = true;
    for (const r of res?.nicknames || []) {
      const at = Date.parse(r.updated_at || '') || 0;
      const key = String(r.seg_id);
      if (byKey[key] && byKey[key].at > at) continue;
      byKey[key] = { key, nickname: String(r.nickname), ids: (r.ids || []).map(String), anchor: r.anchor_sv ? String(r.anchor_sv) : null, at };
      index(byKey[key]);
    }
    persist();
  } catch { /* the server can't say: this browser's copy stands */ }
}

let lastTry = 0;
/** Load once signed in: asked again at most once a minute until it works. */
export function ensureNicknames() {
  if (loaded || Date.now() - lastTry < 60000) return;
  lastTry = Date.now();
  void loadNicknames();
}

/** Give a cell a nickname ('' clears it). key = its first ID (the listed ID);
 *  ids = other IDs it has now; anchor = a supervoxel inside it, if known. */
export async function setNickname(key: string, nickname: string, opts: { ids?: (string | null | undefined)[]; anchor?: string | null; dataset?: string } = {}): Promise<boolean> {
  const name = nickname.replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX);
  const ids = [...new Set((opts.ids || []).filter((x): x is string => !!x && /^\d+$/.test(x) && x !== key))];
  if (!name) {
    unindex(key);
    delete byKey[key];
  } else {
    const was = byKey[key];
    byKey[key] = { key, nickname: name, ids: [...new Set([...(was?.ids || []), ...ids])], anchor: opts.anchor || was?.anchor || null, at: Date.now() };
    index(byKey[key]);
  }
  persist();
  try {
    const res = await secureWrite<{ saved: boolean }>('nicknames.set', { segId: key, nickname: name, ids, anchorSv: opts.anchor || undefined, dataset: opts.dataset });
    return !!(res && res.saved);
  } catch { return false; }   // kept in this browser
}

/** After an edit: a nicknamed cell on screen gets its ID now. */
async function follow() {
  let vis: any;
  try { vis = currentSegLayer()?.layer?.displayState?.segmentationGroupState?.value?.visibleSegments; } catch { return; }
  if (!vis) return;
  const shown = (id: string) => { try { return vis.has(Uint64.parseString(id)); } catch { return false; } };
  for (const n of Object.values(byKey)) {
    const all = [n.key, ...n.ids];
    if (!all.some(shown)) continue;
    let now: string | null = null;
    if (n.anchor) now = await getRootFromSupervoxel(n.anchor).catch(() => null);
    if (!now) {
      const ends = await latestDescendants(all[all.length - 1]).catch(() => null);
      if (ends && ends.length === 1) now = ends[0];
    }
    if (!now || all.includes(now)) continue;
    n.ids = [...n.ids, now];
    keyOf[now] = n.key;
    persist();
    void secureWrite('nicknames.track', { segId: n.key, ids: [now] }).catch(() => undefined);
  }
}
let followTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('nge:edit-logged', e => {
  const op = (e as CustomEvent).detail?.operation;
  if (op !== 'merge' && op !== 'split') return;
  clearTimeout(followTimer);
  followTimer = setTimeout(() => void follow(), 2000);
});
