// Supabase-backed client for the merge-cut queue. Works from the HTTPS appspot (no localhost).
// Configure at runtime, before the app loads:
//   window.SUPABASE_URL = "https://<ref>.supabase.co";
//   window.SUPABASE_ANON_KEY = "eyJ...anon...";
type W = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; MERGE_QUEUE_API?: string };
const w = (typeof window !== "undefined" ? (window as unknown as W) : {}) as W;
const SB_URL = (w.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = w.SUPABASE_ANON_KEY || "";
const REST = `${SB_URL}/rest/v1`;

function hdr(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
function configured(): boolean {
  return !!(SB_URL && SB_KEY);
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
  if (!configured()) {
    return { error: "Supabase not configured (window.SUPABASE_URL / SUPABASE_ANON_KEY)" };
  }
  try {
    const r = await fetch(`${REST}/merge_cut_queue`, {
      method: "POST",
      headers: hdr({ Prefer: "return=representation" }),
      body: JSON.stringify({ ...body, approved: false, status: "queued" }),
    });
    if (!r.ok) return { error: `Supabase ${r.status}: ${(await r.text()).slice(0, 140)}` };
    const rows = await r.json();
    return { id: Array.isArray(rows) && rows[0] ? rows[0].id : 0 };
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

export async function fetchStatus(): Promise<StatusRow[]> {
  if (!configured()) return [];
  try {
    const cols =
      "id,window_id,status,approved,keep_side,keep_root_id,operation_id,attempts,error";
    const r = await fetch(
      `${REST}/merge_cut_queue?select=${cols}&order=created_at.desc`,
      { headers: hdr() },
    );
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

export async function fetchKeepRoot(_sessionId: string): Promise<string | null> {
  if (!configured()) return null;
  try {
    const r = await fetch(
      `${REST}/merge_cut_queue?select=keep_root_id&keep_root_id=not.is.null&order=created_at.desc&limit=1`,
      { headers: hdr() },
    );
    const d = await r.json();
    return Array.isArray(d) && d[0] && d[0].keep_root_id != null
      ? String(d[0].keep_root_id)
      : null;
  } catch {
    return null;
  }
}

// Anchor→window skeleton path (the "main branch"). Needs a live CAVE find_path; Supabase can't do
// it. On the appspot this is a follow-up (route through CAVE directly). Uses a local path backend
// only if window.MERGE_QUEUE_API is set.
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

export const QUEUE_API = SB_URL;
