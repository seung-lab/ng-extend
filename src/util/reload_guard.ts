/**
 * Keep the view through a reload when it is too big for the page address
 * (Nseraf, report 371: "If I refresh (or reload after update) in MEC any work
 * done up to that point ... is lost").
 *
 * Neuroglancer keeps the whole view in the address and a reload reads it from
 * there. A big view (MEC with thousands of marks and highlight points) makes
 * the address megabytes long: Firefox stops taking it (about 1 MB) and Chrome
 * will not reload it at all (over 2 MB), so a reload brought back an old view
 * or failed. The account autosave (view_autosave.ts) skips views that big.
 *
 * Here: neuroglancer marks when the address could not keep up (ui/
 * url_hash_binding.ts, window.__ngeHashStale). While it cannot, the view is
 * kept in this browser's own database (IndexedDB, no size limit), for this
 * tab only. On a reload of that tab, the view comes back from there instead
 * of from the address. Opening a link, or a new tab, is never affected.
 */

const DB = 'nge-reload-guard';
const STORE = 'views';
const TAB_KEY = 'nge-tab-id';
const STALE_KEY = 'nge-view-in-db';
const QUIET_MS = 1200;

function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(TAB_KEY, id); }
    return id;
  } catch { return 'tab'; }
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function put(key: string, value: any) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (value === undefined) tx.objectStore(STORE).delete(key); else tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function get(key: string): Promise<any> {
  const db = await openDb();
  const out = await new Promise<any>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

const isReload = () => {
  try { return (performance.getEntriesByType('navigation')[0] as any)?.type === 'reload'; } catch { return false; }
};

/** Which address the tab had when its view was kept. Coming back to that
 *  same address (not only a reload: Firefox restarting for an update, session
 *  restore, a reopened tab) is the same work, so the kept view is used
 *  (Nseraf 2026-11-11, report "MEC interneuron": after Firefox restarted, the
 *  address was the bare "#" the guard leaves behind and everything was gone).
 *  A different address is a link opened on purpose and is used as it is. */
const ADDRESS_KEY = 'nge-view-in-db-address';
function addressPrint(hash: string): string {
  const h = hash || '#';
  return `${h.length}:${h.slice(0, 120)}:${h.slice(-120)}`;
}
const isBlank = (hash: string) => !hash || hash === '#' || hash === '#!';

/** Before neuroglancer reads the address at startup: when this tab's view
 *  was kept in the database and the tab is back at the address it had then
 *  (or reloaded, or left with no view at all), set the address aside.
 *  Returns the address set aside, or null when the address is to be used. */
export function setAsideStaleAddress(): string | null {
  try {
    if (sessionStorage.getItem(STALE_KEY) !== '1') return null;
    const kept = sessionStorage.getItem(ADDRESS_KEY);
    const sameAddress = kept !== null && kept === addressPrint(location.hash);
    if (!isReload() && !sameAddress && !isBlank(location.hash)) return null;
    const hash = location.hash;
    history.replaceState(history.state, '', location.pathname + location.search + '#');
    return hash || '#';
  } catch { return null; }
}

/** After startup: bring the kept view back (or, if it can't be had, the
 *  address that was set aside), then keep watching. */
export function startReloadGuard(viewer: any, setAside: string | null, readAddress: () => void) {
  if (setAside !== null) {
    get(tabId()).then(saved => {
      if (saved && typeof saved === 'string') {
        viewer.state.restoreState(JSON.parse(saved));
        console.info('[reload guard] view brought back from this browser after a reload (too big for the page address)');
      } else throw new Error('nothing kept');
    }).catch(() => {
      try { history.replaceState(history.state, '', location.pathname + location.search + setAside); } catch { /* keep the default view */ }
      readAddress();
    });
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const keep = () => {
    timer = null;
    const stale = !!(window as any).__ngeHashStale;
    try {
      if (stale) {
        // The text neuroglancer just made for the address, when it has it:
        // making it again froze the view for a second (report 383).
        const text = (window as any).__ngeStaleJson || JSON.stringify(viewer.state.toJSON());
        void put(tabId(), text).then(() => {
          try { sessionStorage.setItem(STALE_KEY, '1'); sessionStorage.setItem(ADDRESS_KEY, addressPrint(location.hash)); } catch { /* private mode */ }
        })
          .catch(e => console.warn('[reload guard] could not keep the view:', e));
      } else if (sessionStorage.getItem(STALE_KEY) === '1') {
        sessionStorage.removeItem(STALE_KEY);
        sessionStorage.removeItem(ADDRESS_KEY);
        void put(tabId(), undefined).catch(() => {});
      }
    } catch { /* not kept this time */ }
  };
  viewer.state.changed.add(() => { if (timer) clearTimeout(timer); timer = setTimeout(keep, QUIET_MS); });
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); keep(); } });
}
