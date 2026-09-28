/**
 * What the signed in player may do in each dataset, straight from CAVE.
 *
 * CAVE's auth service answers /api/v1/user/cache with permissions_v2: for
 * every CAVE dataset the account can reach, a list such as ['view', 'edit'].
 * Each DatasetEntry names its CAVE dataset (caveDataset in datasets.ts; the
 * table to dataset mapping comes from auth's
 * /service/pychunkedgraph/table/<table>/dataset). A dataset that is missing
 * from the list is one CAVE would refuse to load for this player.
 *
 * Unknown (not signed in yet, or CAVE unreachable) never locks anything:
 * a failed lookup must not keep someone out of a dataset they can use.
 */
import { ref } from 'vue';

export type DatasetAccess = 'edit' | 'view' | 'none' | 'unknown';

const AUTH_URL = 'https://global.daf-apis.com/auth/api/v1/user/cache';
const TOKEN_KEY = 'auth_token_v2_https://global.daf-apis.com/sticky_auth';

const permissions = ref<Record<string, string[]> | null>(null);
let loadedFor = '';
let inflight: Promise<void> | null = null;

function caveToken(): string {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}').accessToken || ''; } catch { return ''; }
}

/** Fetch once per sign in; cheap to call every time the switcher opens. */
export function loadDatasetPermissions(): Promise<void> {
  const token = caveToken();
  if (!token) { permissions.value = null; loadedFor = ''; return Promise.resolve(); }
  if (token === loadedFor && permissions.value) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(AUTH_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const me = await r.json();
      // Datasets whose terms of service are not accepted yet appear only in
      // the _ignore_tos list; the viewer asks for the terms on load, so they
      // count as reachable.
      const merged: Record<string, string[]> = {};
      for (const src of [me.permissions_v2_ignore_tos, me.permissions_v2]) {
        for (const [ds, list] of Object.entries(src || {})) {
          merged[ds] = [...new Set([...(merged[ds] || []), ...(list as string[])])];
        }
      }
      permissions.value = merged;
      loadedFor = token;
    } catch { /* stays unknown */ } finally { inflight = null; }
  })();
  return inflight;
}

export function datasetAccess(caveDataset?: string): DatasetAccess {
  const p = permissions.value;
  if (!caveDataset || !p) return 'unknown';
  const list = p[caveDataset] || [];
  if (list.includes('edit')) return 'edit';
  if (list.includes('view')) return 'view';
  return 'none';
}
