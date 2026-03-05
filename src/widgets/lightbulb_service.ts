/**
 * lightbulb_service.ts
 * Eyewire II — CAVE API helpers for cell completion and annotation.
 *
 * TODO: Once you have the CAVE annotation table names from your admin,
 *       update EYEWIRE_II_CAVE_CONFIG in src/config.ts.
 */

import {EYEWIRE_II_CAVE_CONFIG} from '../config';
import {useProofreadingBackendStore, useCellHistoryStore, useUserStatsStore} from '../store';

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

const LOCAL_ANNOTATION_KEY = 'nge_local_annotations_v1';

interface LocalAnnotationStore {
  [rootId: string]: {
    isComplete: boolean;
    cellType: string;
  };
}

function getLocalAnnotations(): LocalAnnotationStore {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ANNOTATION_KEY) || '{}');
  } catch { return {}; }
}

function setLocalAnnotation(rootId: string, data: Partial<{isComplete: boolean; cellType: string}>) {
  const store = getLocalAnnotations();
  store[rootId] = { ...{isComplete: false, cellType: ''}, ...store[rootId], ...data };
  localStorage.setItem(LOCAL_ANNOTATION_KEY, JSON.stringify(store));
}

function deleteLocalAnnotation(rootId: string, field: 'isComplete' | 'cellType') {
  const store = getLocalAnnotations();
  if (!store[rootId]) return;
  if (field === 'isComplete') store[rootId].isComplete = false;
  if (field === 'cellType') store[rootId].cellType = '';
  localStorage.setItem(LOCAL_ANNOTATION_KEY, JSON.stringify(store));
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

/**
 * Fetch the current completion + cell-type status for a root ID.
 * Returns null if the CAVE table is not yet configured.
 */
export async function getCellStatus(
    caveServer: string, rootId: string): Promise<CellStatus | null> {
  const {cellStatusTable, cellTypeTable} = EYEWIRE_II_CAVE_CONFIG;
  if (!caveServer) return null;

  const status: CellStatus = {isComplete: false};
  let caveAvailable = false;

  // Check completion table
  try {
    const url =
        `${caveServer}/annotation/api/v1/table/${cellStatusTable}/annotation/` +
        `?filter_equal=pt_root_id:${rootId}`;
    console.info(`[lightbulb] GET status → ${url}`);
    const res = await fetch(url, {headers: authHeaders(caveServer)});
    if (res.ok) {
      const data = await res.json();
      const rows: any[] = Array.isArray(data) ? data : (data.annotations ?? []);
      const hit = rows.find((a: any) => a.tag === 'complete');
      if (hit) {
        status.isComplete = true;
        status.annotationId = hit.id;
      }
      caveAvailable = true;
    } else {
      const errText = await res.text().catch(() => '');
      console.warn(`[lightbulb] getCellStatus (completion) ${res.status}:`, errText);
    }
  } catch (e) {
    console.warn('[lightbulb] getCellStatus (completion) network error:', e);
  }

  // Check cell-type table
  try {
    const url =
        `${caveServer}/annotation/api/v1/table/${cellTypeTable}/annotation/` +
        `?filter_equal=pt_root_id:${rootId}`;
    const res = await fetch(url, {headers: authHeaders(caveServer)});
    if (res.ok) {
      const data = await res.json();
      const rows: any[] = Array.isArray(data) ? data : (data.annotations ?? []);
      if (rows.length) {
        // Most recent annotation wins
        const latest = rows[rows.length - 1];
        status.cellType = latest.tag;
        status.cellTypeAnnotationId = latest.id;
      }
      caveAvailable = true;
    } else {
      const errText = await res.text().catch(() => '');
      console.warn(`[lightbulb] getCellStatus (cellType) ${res.status}:`, errText);
    }
  } catch (e) {
    console.warn('[lightbulb] getCellStatus (cellType) network error:', e);
  }

  // Fall back to localStorage if CAVE tables aren't reachable
  if (!caveAvailable) {
    console.info('[lightbulb] CAVE tables not available — using localStorage fallback');
    const local = getLocalAnnotations()[rootId];
    if (local) {
      status.isComplete = local.isComplete;
      status.cellType = local.cellType || '';
      // Use negative IDs to signal "local" annotations
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
  const {cellStatusTable} = EYEWIRE_II_CAVE_CONFIG;
  if (!caveServer) {
    console.warn('[lightbulb] No CAVE server — cannot save completion status.');
    return false;
  }

  const baseUrl =
      `${caveServer}/annotation/api/v1/table/${cellStatusTable}/annotation/`;

  try {
    if (!complete && existingAnnotationId !== undefined) {
      // Local annotation — just clear localStorage
      if (existingAnnotationId < 0) {
        deleteLocalAnnotation(rootId, 'isComplete');
        return true;
      }
      console.info(`[lightbulb] DELETE completion → ${baseUrl}${existingAnnotationId}`);
      const res = await fetch(`${baseUrl}${existingAnnotationId}`,
          {method: 'DELETE', headers: authHeaders(caveServer)});
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
          type: 'BoundText',
          pt: {position: pos},
          tag: 'complete',
          pt_root_id: rootId,
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
            position: pos,
          });
          const statsStore = useUserStatsStore();
          statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
          statsStore.logDailyCellComplete();
        } catch { /* non-critical */ }
        return true;
      }
      const errText = await res.text().catch(() => '');
      console.error(`[lightbulb] CAVE POST failed (${res.status}):`, errText);
    }
  } catch (e) {
    console.error('[lightbulb] setCellComplete — CAVE network error:', e);
  }

  // localStorage fallback — save locally so UI still works
  setLocalAnnotation(rootId, {isComplete: complete});
  console.info(`[lightbulb] Saved completion locally for ${rootId} (CAVE unavailable)`);
  // Update local cell history & stats so Profile UI reflects immediately
  try {
    const pos = getViewerPosition();
    const historyStore = useCellHistoryStore();
    historyStore.upsert({
      segId: rootId,
      isComplete: complete,
      position: pos,
    });
    if (complete) {
      const statsStore = useUserStatsStore();
      statsStore.setStats({ cellsSubmitted: statsStore.stats.cellsSubmitted + 1 });
      statsStore.logDailyCellComplete();
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
  return true;
}

/**
 * Save (or update) the cell-type annotation for a root ID.
 */
export async function saveCellType(
    caveServer: string, rootId: string, cellType: string,
    existingAnnotationId?: number): Promise<boolean> {
  const {cellTypeTable} = EYEWIRE_II_CAVE_CONFIG;
  if (!caveServer) {
    console.warn('[lightbulb] No CAVE server — cannot save cell type.');
    return false;
  }

  const baseUrl =
      `${caveServer}/annotation/api/v1/table/${cellTypeTable}/annotation/`;
  const pos = getViewerPosition();

  try {
    if (existingAnnotationId !== undefined && existingAnnotationId >= 0) {
      // Update existing CAVE row
      const body = {
        type: 'BoundText',
        pt: {position: pos},
        tag: cellType,
        pt_root_id: rootId,
      };
      console.info(`[lightbulb] PUT cell type → ${baseUrl}${existingAnnotationId}`, body);
      const res = await fetch(`${baseUrl}${existingAnnotationId}`, {
        method: 'PUT',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        console.info(`[lightbulb] ✓ Cell type saved to CAVE (update)`);
        try {
          const backend = useProofreadingBackendStore();
          if (backend.userId) {
            backend.logEdit({ operation: 'set_cell_type', segment_after: rootId, metadata: { root_id: rootId, cell_type: cellType } });
            backend.postActivity(`labeled ...${rootId.slice(-4)} as ${cellType}`, rootId);
          }
        } catch { /* non-critical */ }
        // Update local cell history so Profile UI reflects immediately
        try {
          const historyStore = useCellHistoryStore();
          historyStore.upsert({
            segId: rootId,
            cellType: cellType,
            position: pos,
          });
        } catch { /* non-critical */ }
        return true;
      }
      const errText = await res.text().catch(() => '');
      console.error(`[lightbulb] CAVE PUT failed (${res.status}):`, errText);
    } else if (existingAnnotationId === undefined || existingAnnotationId < 0) {
      // Create new CAVE row (or local annotation is being re-saved)
      const body = {
        annotations: [{
          type: 'BoundText',
          pt: {position: pos},
          tag: cellType,
          pt_root_id: rootId,
        }],
      };
      console.info(`[lightbulb] POST cell type → ${baseUrl}`, body);
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        console.info(`[lightbulb] ✓ Cell type saved to CAVE (create)`);
        // Update local cell history so Profile UI reflects immediately
        try {
          const historyStore = useCellHistoryStore();
          historyStore.upsert({
            segId: rootId,
            cellType: cellType,
            position: pos,
          });
        } catch { /* non-critical */ }
        return true;
      }
      const errText = await res.text().catch(() => '');
      console.error(`[lightbulb] CAVE POST failed (${res.status}):`, errText);
    }
  } catch (e) {
    console.error('[lightbulb] saveCellType — CAVE network error:', e);
  }

  // localStorage fallback — save locally so UI still works
  setLocalAnnotation(rootId, {cellType});
  console.info(`[lightbulb] Saved cell type locally for ${rootId} (CAVE unavailable)`);
  // Update local cell history so Profile UI reflects immediately
  try {
    const historyStore = useCellHistoryStore();
    historyStore.upsert({
      segId: rootId,
      cellType: cellType,
      position: pos,
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
