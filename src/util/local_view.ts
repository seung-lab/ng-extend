/**
 * The page address holds a short code, not the whole view (hi529, report 541;
 * many players found the address "heavy").
 *
 * Neuroglancer keeps the entire view in the address and rewrites it as the
 * view changes. Pyr's views carry thousands of marks and segments, so each
 * copy could be close to a megabyte, and Firefox keeps every address a page
 * sets: one player's history filled with 12 GB of them.
 *
 * Now the address reads "#!pyr:<code>". The view itself is kept in this
 * browser's own database under that code (IndexedDB, no size limit), written
 * once the view is still for a moment and at least every 5 s while it keeps
 * changing, and again when the page is left. A reload, a reopened tab and
 * Firefox's session restore all bring it back from there. The same address
 * pasted into another tab of this browser works too. Sharing goes through
 * Share or Copy view link (state_link.ts), which makes a short link that
 * works anywhere.
 *
 * Links people open (a state server link, or an old "#!{...}" view) are read
 * as before; the address becomes a code once the view has loaded.
 */

const DB = 'nge-local-views';
const STORE = 'views';
const INDEX_KEY = 'nge-local-view-index';
const TAB_KEY = 'nge-view-code';
const BACKUP_KEY = 'nge-view-backup';
export const LOCAL_PREFIX = '#!pyr:';
const KEEP_DAYS = 30;
const KEEP_MAX = 60;

export function isLocalViewHash(hash: string = location.hash): boolean {
  return (hash || '').startsWith(LOCAL_PREFIX);
}
function codeOf(hash: string): string {
  return isLocalViewHash(hash) ? hash.slice(LOCAL_PREFIX.length) : '';
}

/** Which codes this browser holds, and when each was written. Kept in
 *  localStorage so startup can tell, before anything else reads the address,
 *  whether a code can be brought back here. */
function readIndex(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}') || {}; } catch { return {}; }
}
function writeIndex(ix: Record<string, number>) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); } catch { /* private mode */ }
}

function newCode(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('');
}

/** This tab's code. A duplicated tab copies sessionStorage, so a tab that
 *  finds another open tab already writing its code takes a new one. */
let myCode: string | null = null;
export function myViewCode(): string {
  if (myCode) return myCode;
  try { myCode = sessionStorage.getItem(TAB_KEY); } catch { /* */ }
  if (!myCode) myCode = newCode();
  try { sessionStorage.setItem(TAB_KEY, myCode); } catch { /* */ }
  return myCode;
}
let channel: BroadcastChannel | null = null;
function watchOtherTabs() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel('nge-view-codes');
    channel.onmessage = e => {
      const m = e.data || {};
      // Another tab starting up with my code: tell it so.
      if (m.ask && m.ask === myViewCode() && m.nonce !== askNonce) channel!.postMessage({taken: m.ask, to: m.nonce});
      // An open tab already has my code: this one (the duplicate) moves on.
      if (m.taken && m.taken === myViewCode() && m.to === askNonce) {
        myCode = newCode();
        lastJson = '';
        try { sessionStorage.setItem(TAB_KEY, myCode); } catch { /* */ }
      }
    };
    channel.postMessage({ask: myViewCode(), nonce: askNonce});
  } catch { /* old browser: duplicated tabs share a code */ }
}
const askNonce = Math.random().toString(36).slice(2);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let dbPromise: Promise<IDBDatabase> | null = null;
function db() { return dbPromise ??= openDb(); }

async function idbPut(code: string, value: {json: string, t: number} | undefined, alsoKey = '') {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    if (value === undefined) tx.objectStore(STORE).delete(code); else tx.objectStore(STORE).put(value, code);
    if (alsoKey && value !== undefined) tx.objectStore(STORE).put(value, alsoKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(code: string): Promise<{json: string, t: number} | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(code);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Old codes go: a month unused, or beyond the newest 60. */
function prune() {
  const ix = readIndex();
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  const codes = Object.keys(ix).sort((a, b) => ix[b] - ix[a]);
  const drop = codes.filter((c, i) => c !== myCode && (ix[c] < cutoff || i >= KEEP_MAX));
  if (!drop.length) return;
  for (const c of drop) delete ix[c];
  writeIndex(ix);
  for (const c of drop) void idbPut(c, undefined).catch(() => {});
}

/** The dataset on screen (its segmentation layer's name), set by main.ts. */
let datasetOf: () => string = () => '';
export function setLocalViewDataset(fn: () => string) { datasetOf = fn; }
/** Each dataset's latest view in this browser is kept as well, under this
 *  key, so switching back to a dataset picks up where it was left (Ben
 *  Noble, report 542). One per dataset, shared by the tabs. */
const datasetKeyOf = (seg: string) => 'dataset:' + seg;

/** Set once the page is about to reload into another view (openViewHere):
 *  nothing more is written for the view that is leaving. */
let frozen = false;

/** Keep the view under this tab's code. Returns the code for the address. */
let lastJson = '';
export function saveLocalView(json: string): string {
  const code = myViewCode();
  if (frozen) return code;
  // A view with no layers is not kept: brought back, it is a blank screen
  // (Ames 2026-11-16). The tab's last real view stays under its code.
  if (!json.includes('"layers"')) return code;
  if (json === lastJson) return code;
  lastJson = json;
  const t = Date.now();
  const ix = readIndex();
  ix[code] = t;
  writeIndex(ix);
  let ds = '';
  try { ds = datasetOf(); } catch { /* */ }
  void idbPut(code, {json, t}, ds ? datasetKeyOf(ds) : '').catch(e => console.warn('[view] could not keep the view in this browser:', e));
  return code;
}

/** This browser's latest view of a dataset, if it has one. */
export async function lastLocalViewOf(seg: string): Promise<{json: string, t: number} | undefined> {
  try { return await idbGet(datasetKeyOf(seg)); } catch { return undefined; }
}

/** The view on screen, kept for its dataset now (before a switch away). */
export async function keepDatasetViewNow(): Promise<void> {
  if (frozen) return;
  let ds = '', json = '';
  try { ds = datasetOf(); json = JSON.stringify((window as any).viewer.state.toJSON()); } catch { return; }
  if (!ds || !json.includes('"layers"')) return;
  try { await idbPut(datasetKeyOf(ds), {json, t: Date.now()}); } catch { /* */ }
}

/** Reload this tab into the given view, the way a reload brings a view back
 *  (used to pick up where a dataset was left). */
export async function openViewHere(json: string): Promise<void> {
  const code = myViewCode();
  const t = Date.now();
  frozen = true;
  const ix = readIndex();
  ix[code] = t;
  writeIndex(ix);
  try { await idbPut(code, {json, t}); } catch { /* the backup below stands */ }
  try { sessionStorage.setItem(BACKUP_KEY, JSON.stringify({code, t, json})); } catch { /* too big: the database copy stands */ }
  try { history.replaceState(history.state, '', location.pathname + location.search + LOCAL_PREFIX + code); } catch { /* */ }
  location.reload();
}

/** Leaving the page (a reload among it): the database write may not finish
 *  in time, so the view also goes to this tab's sessionStorage, which is
 *  written at once. Only views that fit (a few MB). */
export function backupForReload(json: string) {
  if (frozen) return;
  try { sessionStorage.setItem(BACKUP_KEY, JSON.stringify({code: myViewCode(), t: Date.now(), json})); } catch { /* too big: the database copy stands */ }
}

/** The kept view for a code: the newer of this tab's backup and the database. */
export async function loadLocalView(code: string): Promise<string | null> {
  let backup: {code: string, t: number, json: string} | null = null;
  try { backup = JSON.parse(sessionStorage.getItem(BACKUP_KEY) || 'null'); } catch { /* */ }
  if (backup && backup.code !== code) backup = null;
  let stored: {json: string, t: number} | undefined;
  try { stored = await idbGet(code); } catch (e) { console.warn('[view] could not read the kept view:', e); }
  const best = backup && (!stored || backup.t >= stored.t) ? backup.json : stored?.json;
  return best ?? null;
}

/**
 * The address as the page opened it, with one change: a code this browser
 * does not hold (pasted from another computer) is treated as no view at all,
 * so the usual starting view loads. Decided once, before neuroglancer or the
 * store read the address.
 */
let boot: string | null = null;
export function bootHash(): string {
  if (boot !== null) return boot;
  boot = location.hash;
  if (isViewWithoutLayers(boot)) {
    // An old address for a view with no layers (one came back from Chrome's
    // address bar for Ames, 2026-11-16) opened a blank screen until a
    // sign-in let the dataset list load. Open the starting view instead.
    console.info('[view] this address holds a view with no layers; opening the starting view');
    try { history.replaceState(history.state, '', location.pathname + location.search + '#'); } catch { /* */ }
    boot = '';
    return boot;
  }
  const code = codeOf(boot);
  if (code) {
    let backup = false;
    try { backup = JSON.parse(sessionStorage.getItem(BACKUP_KEY) || 'null')?.code === code; } catch { /* */ }
    if (!readIndex()[code] && !backup) {
      console.info('[view] this address names a view kept in another browser; opening the starting view');
      (window as any).__ngeLocalViewMissing = true;
      try { history.replaceState(history.state, '', location.pathname + location.search + '#'); } catch { /* */ }
      boot = '';
    }
  }
  return boot;
}

/** A "#!{...}" address whose view has no layers. Only short ones are read:
 *  a view with layers in it is long. */
function isViewWithoutLayers(hash: string): boolean {
  if (!hash.startsWith('#!') || hash.length > 4000) return false;
  let text = hash.slice(2);
  try { text = decodeURIComponent(text); } catch { return false; }
  if (!text.startsWith('{')) return false;
  try {
    const layers = JSON.parse(text)?.layers;
    if (!layers) return true;
    return Array.isArray(layers) ? layers.length === 0 : Object.keys(layers).length === 0;
  } catch { return false; }
}

/** True when the address at load carried a view of the player's own with a
 *  layout in it (a kept code always does). */
export function bootHashHasLayout(): boolean {
  const h = bootHash();
  return h.includes('layout') || isLocalViewHash(h);
}

/** A link with the whole view in it, as the address used to be: for working
 *  links and other records that are opened in this same app later. Not for
 *  sending to people: use mintShortStateLink (state_link.ts). */
export function fullViewUrl(): string {
  const base = location.origin + location.pathname + location.search;
  try {
    const viewer: any = (window as any).viewer;
    const json = JSON.stringify(viewer.state.toJSON());
    return base + '#!' + encodeURIComponent(json);
  } catch {
    return isLocalViewHash() ? base + '#' : location.href;
  }
}

/** Set up once at startup: the hooks neuroglancer's address binding calls
 *  (third_party/neuroglancer/ui/url_hash_binding.ts). */
export function installLocalView() {
  bootHash();
  watchOtherTabs();
  try { prune(); } catch { /* */ }
  (window as any).__ngeLocalView = {
    prefix: LOCAL_PREFIX,
    save: saveLocalView,
    backup: backupForReload,
    load: loadLocalView,
    code: myViewCode,
  };
}
