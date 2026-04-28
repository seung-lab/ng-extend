/**
 * lightbulb_service.ts
 * Eyewire II — CAVE API helpers for cell completion and annotation.
 *
 * Per-dataset CAVE config is resolved via getDatasetCaveConfig() in config.ts.
 * Each dataset (stroeh_mouse_retina, pinky_sandbox, etc.) can have its own
 * annotation tables, datastack, and aligned volume.
 */

import {getDatasetCaveConfig, type DatasetCaveConfig} from '../config';
import {useProofreadingBackendStore, useCellHistoryStore, useUserStatsStore} from '../store';
import {defaultCredentialsManager} from 'neuroglancer/credentials_provider/default_manager';
import {parseSpecialUrl} from 'neuroglancer/util/special_protocol_request';
import nurroSuccess from '../../static/nurro/nurro-success.png';
import nurroTrophy from '../../static/nurro/nurro-trophy.png';
import nurroCelebrate from '../../static/nurro/nurro-celebrate.png';
import nurroDance from '../../static/nurro/nurro-dance.png';
import nurroAtHome from '../../static/nurro/nurro-at-home.png';
import nurroConfetti from '../../static/nurro/nurro-confetti.png';
import nurroCelebrate2 from '../../static/nurro/nurro-celebrate2.png';
import nurroPopcorn from '../../static/nurro/nurro-popcorn.png';
import nurroCelebrate3 from '../../static/nurro/nurro-celebrate3.png';
import nurroExperiment from '../../static/nurro/nurro-experiment.png';
const NURRO_IMAGES = [nurroSuccess, nurroTrophy, nurroCelebrate, nurroDance, nurroAtHome, nurroConfetti, nurroCelebrate2, nurroPopcorn, nurroCelebrate3, nurroExperiment];

// ─── Auth token helpers (mirrors the pattern in store.ts) ───────────────────

function getAuthToken(caveServer: string): string | null {
  const TOKEN_PREFIX = 'auth_token_v2_';
  let fallback: string | null = null;

  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(TOKEN_PREFIX)) continue;
    try {
      const data = JSON.parse(window.localStorage.getItem(key) || '{}');
      if (!data.accessToken) continue;
      // Prefer a token whose URL matches the CAVE server hostname
      try {
        if (new URL(data.url).hostname === new URL(caveServer).hostname) {
          return data.accessToken;
        }
      } catch {}
      fallback = fallback ?? data.accessToken;
    } catch {}
  }
  return fallback;
}

function authHeaders(caveServer: string): HeadersInit {
  const token = getAuthToken(caveServer);
  return {
    'Content-Type': 'application/json',
    ...(token ? {'Authorization': `Bearer ${token}`} : {}),
  };
}

/** Parse the auth realm hostname from a 401's WWW-Authenticate header.
 *  CAVE 401s advertise `Bearer realm="https://global.daf-apis.com/sticky_auth/..."`,
 *  and tokens in localStorage are keyed by that realm host — NOT the API host. */
function parseAuthRealmHost(res: Response): string | undefined {
  const m = res.headers.get('www-authenticate')?.match(/realm="([^"]+)"/);
  if (!m) return undefined;
  try { return new URL(m[1]).hostname; } catch { return undefined; }
}

/** Drop expired auth tokens so neuroglancer's middleauth pipeline re-prompts
 *  on the next request, and notify the app shell so a banner can prompt the
 *  user.
 *
 *  IMPORTANT: tokens are stored under the auth REALM hostname (parsed from
 *  WWW-Authenticate, e.g. `global.daf-apis.com`), not the CAVE API hostname
 *  (e.g. `minnie.microns-daf.com`). Always pass `realmHost` from a real 401;
 *  the caveServer fallback only matches if the token happened to be stored
 *  under that exact hostname (rare). */
function handleCaveAuthExpired(caveServer: string, realmHost?: string): void {
  const targetHost = realmHost ?? new URL(caveServer).hostname;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith('auth_token_v2_')) continue;
      try {
        const data = JSON.parse(window.localStorage.getItem(key) || '{}');
        if (new URL(data.url).hostname === targetHost) {
          window.localStorage.removeItem(key);
          console.warn('[lightbulb] Cleared expired CAVE token for', data.url);
        }
      } catch { /* skip malformed entry */ }
    }
  } catch { /* localStorage unavailable */ }
  document.dispatchEvent(new CustomEvent('nge:cave-auth-expired', {
    detail: { server: caveServer },
  }));
}

// ─── Materialization version + query body helpers ──────────────────────────

const _versionCache = new Map<string, number>();

async function getLatestMaterializedVersion(
    caveServer: string, datastack: string): Promise<number | null> {
  const cacheKey = `${caveServer}:${datastack}`;
  const cached = _versionCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(
      `${caveServer}/materialize/api/v3/datastack/${datastack}/versions`,
      {headers: authHeaders(caveServer)});
    if (!res.ok) return null;
    const versions: number[] = await res.json();
    if (!Array.isArray(versions) || versions.length === 0) return null;
    const latest = Math.max(...versions);
    _versionCache.set(cacheKey, latest);
    return latest;
  } catch { return null; }
}

/** Build JSON body for /datastack/<ds>/query (live query). pt_root_id is
 *  emitted as a JSON int literal (not quoted) — JS Number can't hold root_ids
 *  precisely (> 2^53), and postgres BIGINT comparison against a quoted string
 *  isn't reliable. We hand-build the JSON to bypass JS number precision. */
function buildLiveQueryBody(table: string, timestamp: string, rootId: string): string {
  return `{"table":"${table}","timestamp":"${timestamp}","filter_in_dict":{"${table}":{"pt_root_id":[${rootId}]}}}`;
}

/** Same idea for /version/<N>/table/<t>/query (frozen / materialized query). */
function buildFrozenQueryBody(table: string, rootId: string): string {
  return `{"filter_in_dict":{"${table}":{"pt_root_id":[${rootId}]}}}`;
}

/** Try live query first (catches writes after the latest materialization),
 *  fall back to the materialized snapshot if live errors out. Returns the
 *  parsed row array, or [] if both paths fail. */
async function queryAnnotationsForRootId(
    caveServer: string, datastack: string,
    table: string, rootId: string): Promise<any[]> {
  const nowIso = new Date().toISOString();
  // Live query — returns rows including post-materialization writes.
  try {
    const res = await fetch(
      `${caveServer}/materialize/api/v3/datastack/${datastack}/query?return_pyarrow=false`,
      {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: buildLiveQueryBody(table, nowIso, rootId),
      });
    if (res.ok) {
      const rows = await res.json();
      console.info(`[lightbulb] live query ${table} → ${rows.length} rows`);
      return rows;
    }
    console.warn(`[lightbulb] live query ${table} ${res.status} — falling back to materialized`);
  } catch (e) {
    console.warn(`[lightbulb] live query ${table} error — falling back to materialized:`, e);
  }
  // Fallback: materialized snapshot at the latest version.
  const version = await getLatestMaterializedVersion(caveServer, datastack);
  if (version === null) return [];
  try {
    const res = await fetch(
      `${caveServer}/materialize/api/v3/datastack/${datastack}/version/${version}/table/${table}/query?return_pyarrow=false`,
      {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: buildFrozenQueryBody(table, rootId),
      });
    if (res.ok) {
      const rows = await res.json();
      console.info(`[lightbulb] materialized v${version} ${table} → ${rows.length} rows`);
      return rows;
    }
    console.warn(`[lightbulb] materialized v${version} ${table} ${res.status}`);
  } catch (e) {
    console.warn(`[lightbulb] materialized ${table} error:`, e);
  }
  return [];
}

// ─── User attribution (interim — CAVE schemas don't have user_id) ──────────
// CAVE's bound_tag and cell_type_local schemas don't include a per-row user_id
// column, so we encode the writer's identifier into the existing string fields
// until the schema is extended:
//   - cell_type_local: stash user in `classification_system` (currently always
//     '' for ng-extend writes; the original 480 stroeh rows use AC/RGC there
//     so we leave those untouched).
//   - bound_tag tag='complete' (cell_status): write `complete|<user>`. Read
//     filter accepts either bare 'complete' or the prefixed form.
//   - bound_tag tag=<cell type> (cell_type_dev): write `<cell_type>|<user>`.
//     Read parses the suffix.
// USER_DELIMITER is unique enough not to collide with cell-type free text.
const USER_DELIMITER = '|by:';

function getUserIdentifier(): string {
  try {
    // Avoid a circular import at module load — resolve lazily.
    const backend = useProofreadingBackendStore();
    return backend.userName || backend.userEmail?.split('@')[0] || 'anon';
  } catch { return 'anon'; }
}

function encodeTag(base: string): string {
  const u = getUserIdentifier();
  return u && u !== 'anon' ? `${base}${USER_DELIMITER}${u}` : base;
}

function decodeTag(stored: string | undefined): {value: string; user?: string} {
  if (!stored) return {value: ''};
  const i = stored.indexOf(USER_DELIMITER);
  if (i < 0) return {value: stored};
  return {value: stored.slice(0, i), user: stored.slice(i + USER_DELIMITER.length)};
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CellStatus {
  isComplete: boolean;
  /** ID of the completion annotation row (needed for deletion / unmark). */
  annotationId?: number;
  cellType?: string;
  /** Classification system (e.g. 'RGC', 'AC') from cell_type_local schema. */
  classificationSystem?: string;
  cellTypeAnnotationId?: number;
  /** User who labeled the cell type (parsed from interim user attribution). */
  labeledBy?: string;
  /** User who marked the cell complete. */
  completedBy?: string;
}

// ─── localStorage fallback for dev/testing ──────────────────────────────────
// When CAVE dev tables don't exist yet, annotations are stored locally so the
// full UI flow can be tested end-to-end.  Once real tables are created, the
// CAVE API calls succeed and the fallback is never used.

const LOCAL_ANNOTATION_KEY = 'nge_local_annotations_v2';

interface LocalAnnotationStore {
  /** Keys are "pt:x,y,z" for point-based entries. */
  [key: string]: {
    isComplete: boolean;
    cellType: string;
  };
}

/** Generate a point-based localStorage key from viewer coordinates. */
function ptKey(pos: [number, number, number]): string {
  return `pt:${pos[0]},${pos[1]},${pos[2]}`;
}

function getLocalAnnotations(): LocalAnnotationStore {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ANNOTATION_KEY) || '{}');
  } catch { return {}; }
}

function setLocalAnnotation(key: string, data: Partial<{isComplete: boolean; cellType: string}>) {
  const store = getLocalAnnotations();
  store[key] = { ...{isComplete: false, cellType: ''}, ...store[key], ...data };
  localStorage.setItem(LOCAL_ANNOTATION_KEY, JSON.stringify(store));
}

function deleteLocalAnnotation(key: string, field: 'isComplete' | 'cellType') {
  const store = getLocalAnnotations();
  if (!store[key]) return;
  if (field === 'isComplete') store[key].isComplete = false;
  if (field === 'cellType') store[key].cellType = '';
  localStorage.setItem(LOCAL_ANNOTATION_KEY, JSON.stringify(store));
}

// ─── Current dataset helper ─────────────────────────────────────────────────

function getCurrentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      // Check layer type name (works even if dataSources haven't loaded)
      const typeName = ml.layer?.constructor?.name ?? '';
      if (typeName.includes('Segmentation')) return ml.name ?? '';
      // Fallback: check URL
      const url = ml.layer?.dataSources?.[0]?.spec?.url ?? '';
      if (url.includes('graphene') || url.includes('segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}

// ─── Current viewer position helper ─────────────────────────────────────────

function getViewerPosition(): [number, number, number] {
  try {
    const viewer = (window as any)['viewer'];
    const pos = viewer?.navigationState?.position?.value;
    if (pos && pos.length >= 3) {
      return [Math.round(pos[0]), Math.round(pos[1]), Math.round(pos[2])];
    }
  } catch {}
  return [0, 0, 0];
}

// ─── Cell status (mark complete) ────────────────────────────────────────────

// ─── Per-dataset config resolution ──────────────────────────────────────────

/** Resolve the CAVE config for the currently active dataset in the viewer. */
function getActiveDatasetConfig(): DatasetCaveConfig {
  return getDatasetCaveConfig(getCurrentDataset());
}

// ─── CAVE Annotation API v2 helpers ─────────────────────────────────────────

function annotationBaseUrl(caveServer: string, table: string, alignedVolume?: string): string {
  const vol = alignedVolume ?? getActiveDatasetConfig().alignedVolume;
  return `${caveServer}/annotation/api/v2/aligned_volume/${vol}/table/${table}/annotations`;
}

/**
 * Authenticated fetch through neuroglancer's middleauth pipeline.
 * This bypasses CORS issues by routing through the credentials provider.
 */
/** @internal Authenticated fetch through neuroglancer's middleauth pipeline — for future use. */
export async function caveFetch(url: string, init?: RequestInit): Promise<Response> {
  const maUrl = `middleauth+${url}`;
  const {url: fetchUrl, credentialsProvider} = parseSpecialUrl(maUrl, defaultCredentialsManager);
  // cancellableFetchSpecialOk only supports GET+responseJson, so for POST/DELETE
  // we need to get the credentials and do the fetch ourselves
  if (credentialsProvider) {
    try {
      const creds: any = await credentialsProvider.get(undefined as any);
      const token = creds?.credentials?.token || creds?.token;
      if (token) {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        return fetch(fetchUrl, { ...init, headers });
      }
    } catch {}
  }
  // Fallback: try with localStorage token
  const token = getAuthToken(url);
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...init, headers });
}

/**
 * Fetch the current completion + cell-type status for a root ID.
 * Uses materialization to find annotations at the current viewer position,
 * with localStorage fallback when CAVE is unavailable.
 */
export async function getCellStatus(
    caveServer: string, rootId: string): Promise<CellStatus | null> {
  const dsCfg = getActiveDatasetConfig();
  const {cellStatusTable, cellTypeTable, datastack, cellTypeSchema} = dsCfg;
  if (!caveServer) return null;

  console.info(`[lightbulb] getCellStatus: datastack=${datastack}, rootId=${rootId}`);

  const status: CellStatus = {isComplete: false};
  let caveAvailable = false;

  // Cell completion — live query first, materialized fallback.
  const completionRows = await queryAnnotationsForRootId(
    caveServer, datastack, cellStatusTable, rootId);
  if (completionRows.length > 0) caveAvailable = true;
  // Match both legacy bare 'complete' and new 'complete|by:<user>' encoding.
  const completionHit = completionRows.find((a: any) =>
    typeof a.tag === 'string' && (a.tag === 'complete' || a.tag.startsWith('complete' + USER_DELIMITER)));
  if (completionHit) {
    status.isComplete = true;
    status.annotationId = completionHit.id;
    // Prefer server-injected user_id (bound_tag_user schema). Fall back to
    // suffix-decoded user (interim hack on plain bound_tag tables).
    if (completionHit.user_id !== undefined && completionHit.user_id !== null) {
      status.completedBy = String(completionHit.user_id);
    } else {
      const decoded = decodeTag(completionHit.tag);
      if (decoded.user) status.completedBy = decoded.user;
    }
  }

  // Cell type — same hybrid path.
  const cellTypeRows = await queryAnnotationsForRootId(
    caveServer, datastack, cellTypeTable, rootId);
  if (cellTypeRows.length > 0) caveAvailable = true;
  if (cellTypeRows.length > 0) {
    const latest = cellTypeRows[cellTypeRows.length - 1];
    if (cellTypeSchema === 'cell_type_local') {
      status.cellType = latest.cell_type || latest.tag;
      // classification_system doubles as our interim user_id slot for ng-extend
      // writes. The original 480 stroeh rows use real classifications (AC/RGC),
      // so we pass that through unchanged when it doesn't look like a user id.
      const cs: string = latest.classification_system || '';
      if (cs) {
        // Heuristic: real classifications are short/uppercase (AC, RGC, ON Bipolar
        // Cell). User identifiers are typically lowercase or contain a dot/space.
        // We treat everything as classificationSystem and ALSO surface it as
        // labeledBy if it looks user-like; UIs can pick which to show.
        status.classificationSystem = cs;
        if (/[a-z]|@|\./.test(cs)) status.labeledBy = cs;
      }
    } else {
      // bound_tag (or bound_tag_user). Prefer server-injected user_id when
      // present (bound_tag_user); fall back to suffix-decoded user from the
      // tag (interim hack on plain bound_tag tables).
      if (latest.user_id !== undefined && latest.user_id !== null) {
        status.cellType = latest.tag;  // tag is the cell type, no encoding
        status.labeledBy = String(latest.user_id);
      } else {
        const decoded = decodeTag(latest.tag);
        status.cellType = decoded.value;
        if (decoded.user) status.labeledBy = decoded.user;
      }
    }
    status.cellTypeAnnotationId = latest.id;
  }

  // Always merge localStorage on top of CAVE results: writes are mirrored to
  // localStorage immediately, but CAVE materialization runs only every other
  // day. So a just-written annotation isn't in any materialized version yet
  // and the /query above returns empty. The local mirror fills the gap.
  // Local data only fills fields CAVE didn't already populate (CAVE wins ties).
  {
    const store = getLocalAnnotations();
    const pos = getViewerPosition();
    const local = store[ptKey(pos)];
    if (local) {
      if (!status.isComplete && local.isComplete) {
        status.isComplete = true;
        if (status.annotationId === undefined) status.annotationId = -1;
      }
      if (!status.cellType && local.cellType) {
        status.cellType = local.cellType;
        if (status.cellTypeAnnotationId === undefined) status.cellTypeAnnotationId = -1;
      }
      if (!caveAvailable) {
        console.info('[lightbulb] CAVE not reachable — using localStorage');
      }
    }
  }

  return status;
}

/**
 * Mark or unmark a cell as complete.
 * If marking complete, creates a new annotation row.
 * If unmarking, deletes the existing annotation by ID.
 */
export async function setCellComplete(
    caveServer: string, rootId: string, complete: boolean,
    existingAnnotationId?: number): Promise<boolean> {
  const dsCfg = getActiveDatasetConfig();
  const {cellStatusTable, alignedVolume} = dsCfg;
  if (!caveServer) {
    console.warn('[lightbulb] No CAVE server — cannot save completion status.');
    return false;
  }

  const baseUrl = annotationBaseUrl(caveServer, cellStatusTable, alignedVolume);

  try {
    if (!complete && existingAnnotationId !== undefined) {
      // Local annotation — just clear localStorage
      if (existingAnnotationId < 0) {
        const pos = getViewerPosition();
        deleteLocalAnnotation(ptKey(pos), 'isComplete');
        return true;
      }
      // CAVE v2 DELETE uses JSON body with annotation_ids
      console.info(`[lightbulb] DELETE completion → ${baseUrl} id=${existingAnnotationId}`);
      const res = await fetch(baseUrl, {
        method: 'DELETE',
        headers: authHeaders(caveServer),
        body: JSON.stringify({ annotation_ids: [existingAnnotationId] }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[lightbulb] CAVE DELETE failed (${res.status}):`, errText);
      } else {
        // Clear local mirror so the lightbulb doesn't keep showing the deleted state.
        deleteLocalAnnotation(ptKey(getViewerPosition()), 'isComplete');
      }
      return res.ok;
    }

    if (complete) {
      const pos = getViewerPosition();
      // bound_tag_user → server auto-fills user_id from auth context, no need
      // to encode it into the tag. Plain bound_tag → use the interim suffix.
      const dsCfg = getActiveDatasetConfig();
      const usesAutoUserId = dsCfg.cellStatusSchema === 'bound_tag_user';
      const body = {
        annotations: [{
          pt: {position: pos},
          tag: usesAutoUserId ? 'complete' : encodeTag('complete'),
        }],
      };
      console.info(`[lightbulb] POST completion → ${baseUrl}`, body);
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        const errText = await res.text().catch(() => '');
        console.error('[lightbulb] CAVE 401 — token expired:', errText);
        handleCaveAuthExpired(caveServer, parseAuthRealmHost(res));
        return false;  // do NOT fake-save to localStorage on auth failure
      }
      if (res.ok) {
        console.info(`[lightbulb] ✓ Completion saved to CAVE`);
        // Mirror to localStorage so the lightbulb shows the write immediately,
        // before the next materialization cron run (every other day on stroeh).
        setLocalAnnotation(ptKey(pos), {isComplete: true});
        try {
          const backend = useProofreadingBackendStore();
          if (backend.userId) {
            const p = getViewerPosition();
            backend.logEdit({ operation: 'mark_complete', segment_after: rootId, coordinates: `${p[0]}, ${p[1]}, ${p[2]}`, metadata: { root_id: rootId } });
            backend.postActivity(`marked ...${rootId.slice(-4)} complete`, rootId);
          }
        } catch { /* non-critical */ }
        // Update local cell history & stats so Profile UI reflects immediately
        try {
          const historyStore = useCellHistoryStore();
          historyStore.upsert({
            segId: rootId,
            isComplete: true,
            claimPoint: pos,
            position: pos,
            dataset: getCurrentDataset(),
          });
          const statsStore = useUserStatsStore();
          statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
          statsStore.logDailyCellComplete();
        } catch { /* non-critical */ }
        // Celebration! Read fresh count from Supabase for accuracy
        try {
          const backend = useProofreadingBackendStore();
          await backend.loadUserStats(); // refresh from DB
          const statsStore = useUserStatsStore();
          const total = statsStore.stats.cellsSubmitted;
          const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
          backend.pendingCellCelebration = {
            totalCells: total,
            imageUrl: nurro,
          };
        } catch { /* non-critical */ }
        return true;
      }
      const errText = await res.text().catch(() => '');
      console.error(`[lightbulb] CAVE POST failed (${res.status}):`, errText);
    }
  } catch (e) {
    console.error('[lightbulb] setCellComplete — CAVE network error:', e);
  }

  // localStorage fallback — save locally so UI still works (keyed by point)
  const fallbackPos = getViewerPosition();
  setLocalAnnotation(ptKey(fallbackPos), {isComplete: complete});
  console.info(`[lightbulb] Saved completion locally at ${ptKey(fallbackPos)} (CAVE unavailable)`);
  // Update local cell history & stats so Profile UI reflects immediately
  try {
    const historyStore = useCellHistoryStore();
    historyStore.upsert({
      segId: rootId,
      isComplete: complete,
      claimPoint: fallbackPos,
      position: fallbackPos,
      dataset: getCurrentDataset(),
    });
    const statsStore = useUserStatsStore();
    if (complete) {
      statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
      statsStore.logDailyCellComplete();
    } else {
      // Decrement on unmark (don't go below 0)
      statsStore.setStats({ cellsSubmitted: Math.max(0, statsStore.stats.cellsSubmitted - 1) });
    }
  } catch { /* non-critical */ }
  // Log to Supabase regardless of CAVE/local path
  try {
    const backend = useProofreadingBackendStore();
    if (backend.userId) {
      backend.logEdit({
        operation: complete ? 'mark_complete' : 'unmark_complete',
        segment_after: rootId,
        coordinates: (() => { const p = getViewerPosition(); return `${p[0]}, ${p[1]}, ${p[2]}`; })(),
        metadata: { root_id: rootId },
      });
      backend.postActivity(
        complete ? `marked ...${rootId.slice(-4)} complete` : `unmarked ...${rootId.slice(-4)}`,
        rootId,
      );
    }
  } catch { /* non-critical */ }
  // Celebration on complete (fallback path — CAVE was unavailable)
  if (complete) {
    try {
      const backend = useProofreadingBackendStore();
      await backend.loadUserStats();
      const statsStore = useUserStatsStore();
      const total = statsStore.stats.cellsSubmitted;
      const nurro = NURRO_IMAGES[Math.floor(Math.random() * NURRO_IMAGES.length)];
      backend.pendingCellCelebration = {
        totalCells: total,
        imageUrl: nurro,
      };
    } catch { /* non-critical */ }
  }
  return true;
}

/**
 * Save (or update) the cell-type annotation for a root ID.
 */
export async function saveCellType(
    caveServer: string, rootId: string, cellType: string,
    existingAnnotationId?: number): Promise<boolean> {
  const dsCfg = getActiveDatasetConfig();
  const {cellTypeTable, cellTypeSchema, alignedVolume} = dsCfg;
  if (!caveServer) {
    console.warn('[lightbulb] No CAVE server — cannot save cell type.');
    return false;
  }

  const baseUrl = annotationBaseUrl(caveServer, cellTypeTable, alignedVolume);
  const pos = getViewerPosition();

  try {
    // Delete old annotation if updating
    if (existingAnnotationId !== undefined && existingAnnotationId >= 0) {
      await fetch(baseUrl, {
        method: 'DELETE',
        headers: authHeaders(caveServer),
        body: JSON.stringify({ annotation_ids: [existingAnnotationId] }),
      }).catch(() => {});
    }

    // Create new annotation — schema-aware payload.
    //   - cell_type_local: classification_system carries the interim user
    //     identifier (currently '' for all ng-extend writes; original 480
    //     stroeh rows use AC/RGC there and stay untouched).
    //   - bound_tag_user: tag is the bare cell_type; AnnotationEngine
    //     auto-injects user_id server-side from g.auth_user["id"].
    //   - bound_tag (legacy): tag carries `<cell_type>|by:<user>`; the read
    //     path decodes the suffix.
    const userId = getUserIdentifier();
    let annotation: any;
    if (cellTypeSchema === 'cell_type_local') {
      annotation = {
        pt: {position: pos},
        cell_type: cellType,
        classification_system: userId !== 'anon' ? userId : '',
      };
    } else if (cellTypeSchema === 'bound_tag_user') {
      annotation = {
        pt: {position: pos},
        tag: cellType,  // server fills in user_id
      };
    } else {
      annotation = {
        pt: {position: pos},
        tag: encodeTag(cellType),
      };
    }
    const body = {
      annotations: [annotation],
    };
    console.info(`[lightbulb] POST cell type → ${baseUrl}`, body);
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: authHeaders(caveServer),
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      const errText = await res.text().catch(() => '');
      console.error('[lightbulb] CAVE 401 — token expired:', errText);
      handleCaveAuthExpired(caveServer, parseAuthRealmHost(res));
      return false;  // do NOT fake-save to localStorage on auth failure
    }
    if (res.ok) {
      console.info(`[lightbulb] ✓ Cell type saved to CAVE`);
      // Mirror to localStorage so the lightbulb shows the write immediately,
      // before the next materialization cron run.
      setLocalAnnotation(ptKey(pos), {cellType});
      try {
        const backend = useProofreadingBackendStore();
        if (backend.userId) {
          backend.logEdit({ operation: 'set_cell_type', segment_after: rootId, metadata: { root_id: rootId, cell_type: cellType } });
          backend.postActivity(`labeled ...${rootId.slice(-4)} as ${cellType}`, rootId);
        }
      } catch { /* non-critical */ }
      try {
        const historyStore = useCellHistoryStore();
        historyStore.upsert({
          segId: rootId,
          cellType: cellType,
          claimPoint: pos,
          position: pos,
          dataset: getCurrentDataset(),
        });
      } catch { /* non-critical */ }
      return true;
    }
    const errText = await res.text().catch(() => '');
    console.error(`[lightbulb] CAVE POST failed (${res.status}):`, errText);
  } catch (e) {
    console.error('[lightbulb] saveCellType — CAVE network error:', e);
  }

  // localStorage fallback — save locally so UI still works (keyed by point)
  setLocalAnnotation(ptKey(pos), {cellType});
  console.info(`[lightbulb] Saved cell type locally at ${ptKey(pos)} (CAVE unavailable)`);
  // Update local cell history so Profile UI reflects immediately
  try {
    const historyStore = useCellHistoryStore();
    historyStore.upsert({
      segId: rootId,
      cellType: cellType,
      claimPoint: pos,
      position: pos,
      dataset: getCurrentDataset(),
    });
  } catch { /* non-critical */ }
  // Log to Supabase regardless of CAVE/local path
  try {
    const backend = useProofreadingBackendStore();
    if (backend.userId) {
      backend.logEdit({ operation: 'set_cell_type', segment_after: rootId, metadata: { root_id: rootId, cell_type: cellType } });
      backend.postActivity(`labeled ...${rootId.slice(-4)} as ${cellType}`, rootId);
    }
  } catch { /* non-critical */ }
  return true;
}
