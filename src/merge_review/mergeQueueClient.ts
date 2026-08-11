// HTTP client for the merge-cut queue backend (Auto-proofreading-system/9_merge_cut_queue).
// Override the endpoint by setting window.MERGE_QUEUE_API before load.
const API =
  (typeof window !== "undefined" &&
    (window as unknown as { MERGE_QUEUE_API?: string }).MERGE_QUEUE_API) ||
  "http://localhost:8777";

export interface EnqueueBody {
  session_id: string;
  reviewer?: string;
  window_id: string;
  source_root_id: string; // string: supervoxel/root ids exceed JS safe-int range
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
    const r = await fetch(`${API}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok ? await r.json() : { error: `HTTP ${r.status}` };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function fetchKeepRoot(sessionId: string): Promise<string | null> {
  try {
    const r = await fetch(`${API}/keep_root?session_id=${encodeURIComponent(sessionId)}`);
    const d = await r.json();
    return d.keep_root_id != null ? String(d.keep_root_id) : null;
  } catch {
    return null;
  }
}

export const QUEUE_API = API;
