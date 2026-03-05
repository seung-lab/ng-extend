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

/**
 * Fetch the change log summary for a root ID from the PCG server.
 * Returns merge/split counts and per-user breakdown.
 *
 * Endpoint: GET /segmentation/api/v1/table/{table}/root/{rootId}/change_log
 */
export async function getChangeLog(rootId: string): Promise<ChangeLogSummary | null> {
  const pcg = getPcgInfo();
  if (!pcg) {
    console.info('[pcg] No PCG info available — skipping change_log fetch');
    return null;
  }

  const url = `${pcg.server}/segmentation/api/v1/table/${pcg.table}/root/${rootId}/change_log`;
  console.info(`[pcg] GET change_log → ${url}`);

  try {
    const res = await fetch(url, { headers: authHeaders(pcg.server) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[pcg] change_log ${res.status}:`, errText);
      return null;
    }
    const data = await res.json();
    return {
      nMerges: data.n_mergers ?? 0,
      nSplits: data.n_splits ?? 0,
      userInfo: data.user_info ?? {},
    };
  } catch (e) {
    console.warn('[pcg] change_log network error:', e);
    return null;
  }
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

export async function getTabularChangeLog(rootId: string): Promise<EditLogEntry[] | null> {
  const pcg = getPcgInfo();
  if (!pcg) return null;

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
    return entries;
  } catch (e) {
    console.warn('[pcg] tabular_change_log network error:', e);
    return null;
  }
}
