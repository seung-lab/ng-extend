/**
 * pcg_service.ts
 * PyChunkedGraph API helpers for fetching edit/operation logs.
 *
 * Uses the segmentation layer's graphene URL to derive the PCG server
 * and table ID, then calls the change_log endpoint for per-cell
 * merge/split counts.
 *
 * See: https://github.com/CAVEconnectome/PyChunkedGraph
 */

// ─── Auth token helper (same pattern as lightbulb_service.ts) ────────────────

function getAuthToken(server: string): string | null {
  const TOKEN_PREFIX = 'auth_token_v2_';
  let fallback: string | null = null;

  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(TOKEN_PREFIX)) continue;
    try {
      const data = JSON.parse(window.localStorage.getItem(key) || '{}');
      if (!data.accessToken) continue;
      try {
        if (new URL(data.url).hostname === new URL(server).hostname) {
          return data.accessToken;
        }
      } catch {}
      fallback = fallback ?? data.accessToken;
    } catch {}
  }
  return fallback;
}

function authHeaders(server: string): HeadersInit {
  const token = getAuthToken(server);
  return {
    'Content-Type': 'application/json',
    ...(token ? {'Authorization': `Bearer ${token}`} : {}),
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChangeLogSummary {
  nMerges: number;
  nSplits: number;
  /** Per-user breakdown: { userId: { n_mergers, n_splits } } */
  userInfo: Record<string, { n_mergers: number; n_splits: number }>;
}

export interface PcgInfo {
  /** e.g. "https://minnie.microns-daf.com" */
  server: string;
  /** e.g. "pinky_training3" or "fly_v31" */
  table: string;
}

// ─── Extract PCG server + table from the viewer's graphene layer ─────────────

/**
 * Inspects the neuroglancer viewer's segmentation layer URL to extract
 * the PCG server base URL and table name.
 *
 * Typical graphene URLs:
 *   graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_training3
 *   graphene://https://prod.flywire-daf.com/segmentation/table/fly_v31
 */
export function getPcgInfo(): PcgInfo | null {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const url: string = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (!url.includes('segmentation/table/')) continue;

      // Strip protocol wrappers: graphene://middleauth+ or graphene://
      let clean = url.replace('graphene://middleauth+', '')
                     .replace('graphene://', '');

      try {
        const u = new URL(clean);
        const server = `${u.protocol}//${u.host}`;
        // pathname like /segmentation/table/pinky_training3
        const tableMatch = u.pathname.match(/\/segmentation\/table\/([^/]+)/);
        if (tableMatch) {
          return { server, table: tableMatch[1] };
        }
      } catch {}
    }
  } catch {}
  return null;
}

// ─── Change log endpoint ─────────────────────────────────────────────────────

// NOTE: the only caller (AnnotationPanel) is currently commented out of
// ExtensionBar's template, so these functions are tree-shaken out of the
// shipped bundle — verified 2026-08-11: the live main.bundle.js contains no
// change_log strings at all. Regular whole-history changelog load on the PCG
// servers therefore cannot be coming from this app; check the pyr backend's
// tabular_change_log_recent caller instead. The cache below matters the day
// the panel is re-enabled.

// A root ID names one immutable version of the graph — any further edit
// creates a NEW root ID — so a root's change log can never change. Computing
// it is expensive for the PCG server (it walks the full lineage history,
// which on minnie65 spans years of edits), and the annotation panel asks for
// it on every segment selection. So: cache per (table, root), in memory for
// the session and in localStorage across sessions, and dedupe concurrent
// requests for the same root. Only successful responses are cached.

const CHANGELOG_CACHE_KEY = 'nge_pcg_changelog_cache_v1';
const CHANGELOG_CACHE_MAX = 400; // roots kept in localStorage (LRU by last use)

const changeLogMem = new Map<string, ChangeLogSummary>();
const changeLogInflight = new Map<string, Promise<ChangeLogSummary | null>>();

type PersistedChangeLog = Record<string, { v: ChangeLogSummary; t: number }>;

function readPersistedChangeLogs(): PersistedChangeLog {
  try { return JSON.parse(localStorage.getItem(CHANGELOG_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function writePersistedChangeLog(key: string, value: ChangeLogSummary) {
  try {
    const store = readPersistedChangeLogs();
    store[key] = { v: value, t: Date.now() };
    const keys = Object.keys(store);
    if (keys.length > CHANGELOG_CACHE_MAX) {
      keys.sort((a, b) => store[a].t - store[b].t);
      for (const k of keys.slice(0, keys.length - CHANGELOG_CACHE_MAX)) delete store[k];
    }
    localStorage.setItem(CHANGELOG_CACHE_KEY, JSON.stringify(store));
  } catch { /* quota exceeded or private mode — memory cache still works */ }
}

/**
 * Fetch the change log summary for a root ID from the PCG server.
 * Returns merge/split counts and per-user breakdown. Cached — see above.
 *
 * Endpoint: GET /segmentation/api/v1/table/{table}/root/{rootId}/change_log
 */
export async function getChangeLog(rootId: string): Promise<ChangeLogSummary | null> {
  const pcg = getPcgInfo();
  if (!pcg) {
    console.info('[pcg] No PCG info available — skipping change_log fetch');
    return null;
  }

  const key = `${pcg.server}|${pcg.table}|${rootId}`;

  const mem = changeLogMem.get(key);
  if (mem) return mem;

  const persisted = readPersistedChangeLogs()[key];
  if (persisted) {
    changeLogMem.set(key, persisted.v);
    writePersistedChangeLog(key, persisted.v); // refresh LRU timestamp
    return persisted.v;
  }

  const inflight = changeLogInflight.get(key);
  if (inflight) return inflight;

  const url = `${pcg.server}/segmentation/api/v1/table/${pcg.table}/root/${rootId}/change_log`;
  console.info(`[pcg] GET change_log → ${url}`);

  const req = (async (): Promise<ChangeLogSummary | null> => {
    try {
      const res = await fetch(url, { headers: authHeaders(pcg.server) });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[pcg] change_log ${res.status}:`, errText);
        return null;
      }
      const data = await res.json();
      const summary: ChangeLogSummary = {
        nMerges: data.n_mergers ?? 0,
        nSplits: data.n_splits ?? 0,
        userInfo: data.user_info ?? {},
      };
      changeLogMem.set(key, summary);
      writePersistedChangeLog(key, summary);
      return summary;
    } catch (e) {
      console.warn('[pcg] change_log network error:', e);
      return null;
    } finally {
      changeLogInflight.delete(key);
    }
  })();
  changeLogInflight.set(key, req);
  return req;
}

/**
 * Fetch the tabular change log for a root ID (detailed per-operation list).
 * Returns an array of edit entries with user, timestamp, and merge/split flag.
 *
 * Endpoint: GET /segmentation/api/v1/table/{table}/root/{rootId}/tabular_change_log
 */
export interface EditLogEntry {
  operationId: number;
  timestamp: number;
  userId: string;
  isMerge: boolean;
  userName?: string;
}

// Same immutability argument as getChangeLog, but the per-operation list can
// be large, so it's cached in memory only (not localStorage).
const tabularMem = new Map<string, EditLogEntry[]>();

export async function getTabularChangeLog(rootId: string): Promise<EditLogEntry[] | null> {
  const pcg = getPcgInfo();
  if (!pcg) return null;

  const key = `${pcg.server}|${pcg.table}|${rootId}`;
  const mem = tabularMem.get(key);
  if (mem) return mem;

  const url = `${pcg.server}/segmentation/api/v1/table/${pcg.table}/root/${rootId}/tabular_change_log`;
  console.info(`[pcg] GET tabular_change_log → ${url}`);

  try {
    const res = await fetch(url, { headers: authHeaders(pcg.server) });
    if (!res.ok) {
      console.warn(`[pcg] tabular_change_log ${res.status}`);
      return null;
    }
    const data = await res.json();

    // Data comes as columnar dict: { operation_id: [...], timestamp: [...], user_id: [...], is_merge: [...], ... }
    const ids: number[] = data.operation_id ?? [];
    const timestamps: number[] = data.timestamp ?? [];
    const userIds: string[] = data.user_id ?? [];
    const isMerge: boolean[] = data.is_merge ?? [];
    const userNames: string[] = data.user_name ?? [];

    const entries: EditLogEntry[] = [];
    for (let i = 0; i < ids.length; i++) {
      entries.push({
        operationId: ids[i],
        timestamp: timestamps[i],
        userId: userIds[i] ?? '',
        isMerge: isMerge[i] ?? false,
        userName: userNames[i] ?? undefined,
      });
    }
    tabularMem.set(key, entries);
    return entries;
  } catch (e) {
    console.warn('[pcg] tabular_change_log network error:', e);
    return null;
  }
}

// ─── Supervoxel → root resolution ───────────────────────────────────────────

/**
 * Get the current root ID for an immutable supervoxel ID.
 * Supervoxels never change across edits, so storing a supervoxel at claim time
 * lets us always resolve to the correct current root — even after splits.
 *
 * Endpoint: GET /segmentation/api/v1/table/{table}/node/{supervoxel_id}/root
 */
export async function getRootFromSupervoxel(
  supervoxelId: string,
): Promise<string | null> {
  const pcg = getPcgInfo();
  if (!pcg) {
    console.info('[pcg] No PCG info available — skipping root lookup');
    return null;
  }

  const url = `${pcg.server}/segmentation/api/v1/table/${pcg.table}/node/${supervoxelId}/root`;
  console.info(`[pcg] GET root_from_supervoxel → ${url}`);

  try {
    const res = await fetch(url, { headers: authHeaders(pcg.server) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[pcg] root_from_supervoxel ${res.status}:`, errText);
      return null;
    }
    const data = await res.json();
    const rootId = data.root_id ?? data;
    return rootId ? String(rootId) : null;
  } catch (e) {
    console.warn('[pcg] root_from_supervoxel network error:', e);
    return null;
  }
}

/**
 * Batch-resolve multiple supervoxel IDs to their current root IDs.
 */
export async function getRootsFromSupervoxels(
  supervoxelIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (supervoxelIds.length === 0) return result;

  const promises = supervoxelIds.map(async (svId) => {
    const rootId = await getRootFromSupervoxel(svId);
    if (rootId) result.set(svId, rootId);
  });
  await Promise.all(promises);
  return result;
}

// ─── Viewer supervoxel extraction ───────────────────────────────────────────

/**
 * Get the supervoxel ID currently under the cursor / selected in the viewer.
 * Neuroglancer stores the base (supervoxel) segment alongside the mapped (root) segment
 * in segmentSelectionState.baseSelectedSegment.
 */
export function getSelectedSupervoxelId(): string | null {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      const layer = ml.layer;
      if (!layer) continue;
      const typeName = layer.constructor?.name ?? '';
      if (!typeName.includes('Segmentation')) continue;
      const selState = layer.displayState?.segmentSelectionState;
      if (selState?.hasSelectedSegment) {
        const base = selState.baseSelectedSegment;
        if (base && (base.low || base.high)) {
          return base.toString();
        }
      }
    }
  } catch {}
  return null;
}

// ─── Root lineage endpoints ─────────────────────────────────────────────────

/**
 * Check which root IDs are still current (not superseded by edits).
 *
 * Endpoint: GET /segmentation/api/v1/table/{table}/is_latest_roots?root_ids=...
 */
export async function isLatestRoots(rootIds: string[]): Promise<Map<string, boolean> | null> {
  const pcg = getPcgInfo();
  if (!pcg || rootIds.length === 0) return null;

  const url = `${pcg.server}/segmentation/api/v1/table/${pcg.table}/is_latest_roots?root_ids=${rootIds.join(',')}`;
  console.info(`[pcg] GET is_latest_roots → ${rootIds.length} IDs`);

  try {
    const res = await fetch(url, { headers: authHeaders(pcg.server) });
    if (!res.ok) {
      console.warn(`[pcg] is_latest_roots ${res.status}`);
      return null;
    }
    const data = await res.json();
    // Response: { is_latest: [true, false, ...] } parallel to input order
    const flags: boolean[] = data.is_latest ?? data ?? [];
    const result = new Map<string, boolean>();
    for (let i = 0; i < rootIds.length && i < flags.length; i++) {
      result.set(rootIds[i], !!flags[i]);
    }
    return result;
  } catch (e) {
    console.warn('[pcg] is_latest_roots network error:', e);
    return null;
  }
}

/**
 * Get the current root IDs for a set of (possibly stale) root IDs.
 *
 * Endpoint: POST /segmentation/api/v1/table/{table}/get_latest_roots
 */
export async function getLatestRoots(rootIds: string[]): Promise<Map<string, string> | null> {
  const pcg = getPcgInfo();
  if (!pcg || rootIds.length === 0) return null;

  const url = `${pcg.server}/segmentation/api/v1/table/${pcg.table}/get_latest_roots`;
  console.info(`[pcg] POST get_latest_roots → ${rootIds.length} IDs`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(pcg.server),
      body: JSON.stringify({ root_ids: rootIds }),
    });
    if (!res.ok) {
      console.warn(`[pcg] get_latest_roots ${res.status}`);
      return null;
    }
    const data = await res.json();
    // Response: { old_id: new_id, ... } or { latest_root_ids: [...] }
    const result = new Map<string, string>();
    if (data.latest_root_ids && Array.isArray(data.latest_root_ids)) {
      for (let i = 0; i < rootIds.length && i < data.latest_root_ids.length; i++) {
        const newId = String(data.latest_root_ids[i]);
        if (newId !== rootIds[i]) {
          result.set(rootIds[i], newId);
        }
      }
    } else {
      // Object mapping format: { "oldId": "newId", ... }
      for (const [oldId, newId] of Object.entries(data)) {
        if (String(newId) !== oldId) {
          result.set(oldId, String(newId));
        }
      }
    }
    return result;
  } catch (e) {
    console.warn('[pcg] get_latest_roots network error:', e);
    return null;
  }
}
