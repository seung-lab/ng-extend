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

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CellStatus {
  isComplete: boolean;
  /** ID of the completion annotation row (needed for deletion / unmark). */
  annotationId?: number;
  cellType?: string;
  cellTypeAnnotationId?: number;
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

  console.info(`[lightbulb] Using dataset config: datastack=${datastack}, status=${cellStatusTable}, type=${cellTypeTable} (${cellTypeSchema})`);

  const status: CellStatus = {isComplete: false};
  let caveAvailable = false;

  // Try materialization query — resolves annotations by current root_id
  try {
    const matUrl = `${caveServer}/materialize/api/v3/datastack/${datastack}/version/latest/table/${cellStatusTable}/query`;
    console.info(`[lightbulb] POST materialization query → ${matUrl}`);
    const res = await fetch(matUrl, {
      method: 'POST',
      headers: authHeaders(caveServer),
      body: JSON.stringify({ filter_equal_dict: { pt_root_id: [rootId] } }),
    });
    if (res.ok) {
      const rows: any[] = await res.json();
      const hit = rows.find((a: any) => a.tag === 'complete');
      if (hit) {
        status.isComplete = true;
        status.annotationId = hit.id;
      }
      caveAvailable = true;
    } else {
      console.warn(`[lightbulb] materialization query (completion) ${res.status}`);
    }
  } catch (e) {
    console.warn('[lightbulb] materialization query (completion) error:', e);
  }

  // Cell type via materialization
  try {
    const matUrl = `${caveServer}/materialize/api/v3/datastack/${datastack}/version/latest/table/${cellTypeTable}/query`;
    const res = await fetch(matUrl, {
      method: 'POST',
      headers: authHeaders(caveServer),
      body: JSON.stringify({ filter_equal_dict: { pt_root_id: [rootId] } }),
    });
    if (res.ok) {
      const rows: any[] = await res.json();
      if (rows.length) {
        const latest = rows[rows.length - 1];
        // cell_type_local schema has 'cell_type' field; bound_tag has 'tag'
        status.cellType = cellTypeSchema === 'cell_type_local'
          ? (latest.cell_type || latest.tag)
          : latest.tag;
        status.cellTypeAnnotationId = latest.id;
      }
      caveAvailable = true;
    } else {
      console.warn(`[lightbulb] materialization query (cellType) ${res.status}`);
    }
  } catch (e) {
    console.warn('[lightbulb] materialization query (cellType) error:', e);
  }

  // Fall back to localStorage if CAVE/materialization aren't reachable
  if (!caveAvailable) {
    console.info('[lightbulb] CAVE not available — using localStorage fallback');
    const store = getLocalAnnotations();
    const pos = getViewerPosition();
    const key = ptKey(pos);
    const local = store[key];
    if (local) {
      status.isComplete = local.isComplete;
      status.cellType = local.cellType || '';
      if (local.isComplete) status.annotationId = -1;
      if (local.cellType) status.cellTypeAnnotationId = -1;
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
      }
      return res.ok;
    }

    if (complete) {
      const pos = getViewerPosition();
      const body = {
        annotations: [{
          pt: {position: pos},
          tag: 'complete',
        }],
      };
      console.info(`[lightbulb] POST completion → ${baseUrl}`, body);
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        console.info(`[lightbulb] ✓ Completion saved to CAVE`);
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

    // Create new annotation — schema-aware payload
    // cell_type_local: {pt, cell_type, classification_system}
    // bound_tag:       {pt, tag}
    const annotation = cellTypeSchema === 'cell_type_local'
      ? {
          pt: {position: pos},
          cell_type: cellType,
          classification_system: '',  // optional classification group
        }
      : {
          pt: {position: pos},
          tag: cellType,
        };
    const body = {
      annotations: [annotation],
    };
    console.info(`[lightbulb] POST cell type → ${baseUrl}`, body);
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: authHeaders(caveServer),
      body: JSON.stringify(body),
    });
    if (res.ok) {
      console.info(`[lightbulb] ✓ Cell type saved to CAVE`);
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
