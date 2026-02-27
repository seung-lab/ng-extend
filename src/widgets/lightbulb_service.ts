/**
 * lightbulb_service.ts
 * Eyewire II — CAVE API helpers for cell completion and annotation.
 *
 * TODO: Once you have the CAVE annotation table names from your admin,
 *       update EYEWIRE_II_CAVE_CONFIG in src/config.ts.
 */

import {EYEWIRE_II_CAVE_CONFIG} from '../config';

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

  // Check completion table
  try {
    const url =
        `${caveServer}/annotation/api/v1/table/${cellStatusTable}/annotation/` +
        `?filter_equal=root_id:${rootId}`;
    const res = await fetch(url, {headers: authHeaders(caveServer)});
    if (res.ok) {
      const data = await res.json();
      const rows: any[] = Array.isArray(data) ? data : (data.annotations ?? []);
      const hit = rows.find((a: any) => a.tag === 'complete');
      if (hit) {
        status.isComplete = true;
        status.annotationId = hit.id;
      }
    }
  } catch (e) {
    console.warn('[lightbulb] getCellStatus (completion):', e);
  }

  // Check cell-type table
  try {
    const url =
        `${caveServer}/annotation/api/v1/table/${cellTypeTable}/annotation/` +
        `?filter_equal=root_id:${rootId}`;
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
    }
  } catch (e) {
    console.warn('[lightbulb] getCellStatus (cellType):', e);
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
      const res = await fetch(`${baseUrl}${existingAnnotationId}`,
          {method: 'DELETE', headers: authHeaders(caveServer)});
      return res.ok;
    }

    if (complete) {
      const pos = getViewerPosition();
      const body = {
        annotations: [{
          type: 'BoundText',
          pt: {position: pos},
          tag: 'complete',
          root_id: parseInt(rootId, 10),
        }],
      };
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      return res.ok;
    }
  } catch (e) {
    console.error('[lightbulb] setCellComplete:', e);
  }
  return false;
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
    if (existingAnnotationId !== undefined) {
      // Update existing row
      const body = {
        type: 'BoundText',
        pt: {position: pos},
        tag: cellType,
        root_id: parseInt(rootId, 10),
      };
      const res = await fetch(`${baseUrl}${existingAnnotationId}`, {
        method: 'PUT',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      return res.ok;
    } else {
      // Create new row
      const body = {
        annotations: [{
          type: 'BoundText',
          pt: {position: pos},
          tag: cellType,
          root_id: parseInt(rootId, 10),
        }],
      };
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: authHeaders(caveServer),
        body: JSON.stringify(body),
      });
      return res.ok;
    }
  } catch (e) {
    console.error('[lightbulb] saveCellType:', e);
  }
  return false;
}
