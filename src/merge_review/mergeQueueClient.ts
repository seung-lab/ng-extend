// Candela-backed client for the merge-cut queue.
//
// Was Supabase/PostgREST; now talks to the Candela service (CAVEconnectome/Candela, which
// also vendors this frontend). Two things changed and both matter:
//   * Auth is CAVE middle-auth, not a Supabase anon key. We send the same bearer token the
//     login flow already stashed in localStorage, so a reviewer who is signed in to CAVE is
//     signed in here — and the server records WHO queued each cut.
//   * The API is scoped by datastack, because a CAVE service is.
//
// Configure at runtime, before the app loads:
//   window.CANDELA_API = "https://<host>/candela";   // no trailing slash
//   window.CANDELA_DATASTACK = "minnie65_phase3_v1";
type W = {
  CANDELA_API?: string;
  CANDELA_DATASTACK?: string;
  MERGE_QUEUE_API?: string;
};
const w = (typeof window !== "undefined" ? (window as unknown as W) : {}) as W;

// Baked in at build time by webpack's DefinePlugin from config/ng-extend.json; the deploy
// workflow patches that file so the deployed bundle knows its own API without anyone
// setting a global by hand.
declare const CONFIG:
  | { candela_api?: string; candela_datastack?: string; autoproof_api?: string }
  | undefined;
const cfg = typeof CONFIG !== "undefined" && CONFIG ? CONFIG : {};

// Precedence: runtime window override → build-time config → local dev default.
const DEFAULT_API = "http://localhost:8080/candela";
const DEFAULT_DATASTACK = "minnie65_phase3_v1";
const API = (w.CANDELA_API || cfg.candela_api || DEFAULT_API).replace(/\/$/, "");
const DATASTACK = w.CANDELA_DATASTACK || cfg.candela_datastack || DEFAULT_DATASTACK;
const BASE = `${API}/api/v1/datastack/${encodeURIComponent(DATASTACK)}`;

// The middleauth access tokens the login flow stashed in localStorage
// (auth_token_v2_<login_url> → { url, accessToken }). Same source skeletonPath.ts reads.
function middleauthTokens(): string[] {
  const out: string[] = [];
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : undefined;
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith("auth_token_v2_")) continue;
      const raw = ls.getItem(k);
      if (!raw) continue;
      try {
        const d = JSON.parse(raw);
        if (d && typeof d.accessToken === "string") out.push(d.accessToken);
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return out;
}

// Several CAVE deployments can be logged in at once, so try each token until one is
// accepted rather than guessing which login this datastack belongs to.
// No credentials:"include" — we send the bearer explicitly, and cookie-mode would
// forbid the wildcard CORS origin the service replies with.
// Exported so autoproofClient.ts speaks to the autoproof API with the same tokens.
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const tokens = middleauthTokens();
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (tokens.length === 0) {
    return fetch(url, { ...init, headers: base });
  }
  let last: Response | null = null;
  for (const t of tokens) {
    const r = await fetch(url, {
      ...init,
      headers: { ...base, Authorization: `Bearer ${t}` },
    });
    if (r.status !== 401 && r.status !== 403) return r;
    last = r;
  }
  return last as Response;
}

export interface EnqueueBody {
  session_id: string;
  reviewer?: string;
  window_id: string;
  source_root_id: string; // string: root/supervoxel ids exceed JS safe-int range
  anchor_sv: string;
  cluster_a_nm: number[][];
  cluster_b_nm: number[][];
  cluster_a_sv?: string[] | null;
  cluster_b_sv?: string[] | null;
  approved?: boolean;
}

export async function enqueueJob(
  body: EnqueueBody,
): Promise<{ id: number } | { error: string }> {
  try {
    // approved:false always — queueing must never arm a cut. Arming is a separate,
    // deliberate step, and the worker refuses unapproved jobs unless run with
    // --auto-approve.
    const r = await authedFetch(`${BASE}/jobs`, {
      method: "POST",
      body: JSON.stringify({ ...body, approved: false }),
    });
    if (!r.ok) {
      return { error: `Candela ${r.status}: ${(await r.text()).slice(0, 140)}` };
    }
    const d = await r.json();
    return { id: d && typeof d.id === "number" ? d.id : 0 };
  } catch (e) {
    return { error: String(e) };
  }
}

// Cancel a still-queued job so the worker never cuts it. The server refuses once a job has
// been claimed — cancelling then would not stop the CAVE edit — and answers 409.
export async function cancelJob(
  id: number,
): Promise<{ ok: true } | { error: string }> {
  try {
    const r = await authedFetch(`${BASE}/jobs/${id}/cancel`, { method: "POST" });
    if (r.status === 409) return { error: "already running/done — too late to cancel" };
    if (!r.ok) return { error: `Candela ${r.status}: ${(await r.text()).slice(0, 140)}` };
    return { ok: true };
  } catch (e) {
    return { error: String(e) };
  }
}

export interface StatusRow {
  id: number;
  window_id: string;
  status: string;
  approved: boolean;
  keep_side: string | null;
  keep_root_id: number | null;
  operation_id: number | null;
  attempts: number;
  error: string | null;
}

// One queue per neuron: pass the current root id to show only that neuron's jobs
// (omit it for an admin view of every root).
export async function fetchStatus(rootId?: string): Promise<StatusRow[]> {
  try {
    let q = `${BASE}/jobs?limit=200`;
    if (rootId) q += `&source_root_id=${encodeURIComponent(rootId)}`;
    const r = await authedFetch(q);
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d?.jobs) ? d.jobs : [];
  } catch {
    return [];
  }
}

// Latest cleaned (keep) root for THIS neuron — scoped by root so the cleaned layer never
// picks up another neuron's result.
export async function fetchKeepRoot(rootId: string): Promise<string | null> {
  if (!rootId) return null;
  try {
    const r = await authedFetch(`${BASE}/keep_root/${encodeURIComponent(rootId)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.keep_root_id ? String(d.keep_root_id) : null;
  } catch {
    return null;
  }
}

// Anchor→window skeleton path (the "main branch"). Needs a live CAVE find_path, which the
// queue service does not proxy; used only if window.MERGE_QUEUE_API points at a path backend.
export async function fetchAnchorPath(
  rootId: string,
  srcNm: number[],
  dstNm: number[],
): Promise<number[][] | null> {
  const api = w.MERGE_QUEUE_API;
  if (!api) return null;
  try {
    const q = new URLSearchParams({
      root_id: rootId,
      src_x: String(srcNm[0]), src_y: String(srcNm[1]), src_z: String(srcNm[2]),
      dst_x: String(dstNm[0]), dst_y: String(dstNm[1]), dst_z: String(dstNm[2]),
    });
    const r = await fetch(`${api}/path?${q.toString()}`);
    const d = await r.json();
    return Array.isArray(d.path_nm) ? d.path_nm : null;
  } catch {
    return null;
  }
}

export const QUEUE_API = API;
// The datastack-scoped base every Candela call hangs off (…/api/v1/datastack/<ds>);
// decisionsClient.ts uses it so the decisions land in the same datastack as the cuts.
export const QUEUE_BASE = BASE;
export const QUEUE_DATASTACK = DATASTACK;
