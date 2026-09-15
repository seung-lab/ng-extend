// Client for Candela's review_decisions table — the "edits DB" that records every
// reviewer verdict (merge yes/no/skip/unsure, which clusters to split, notes)
// next to the cut queue, under the same datastack and the same CAVE login.
//
//   GET  …/datastack/<ds>/decisions?source_root_id=<root>[&reviewer=<id>]
//        → {decisions: [{window_id, reviewer, merge, split, notes,
//                        autoproof_job_id, session_id, updated_at}]}
//   PUT  …/datastack/<ds>/decisions
//        {source_root_id, session_id?, autoproof_job_id?,
//         decisions: {window_id: {merge?, split?, notes?}}}      → {upserted: n}
//
// The server keys rows by (datastack, source_root_id, window_id, reviewer) and
// takes the reviewer from the auth token — the client never names one.  A field
// sent as null clears it on the server (a verdict the reviewer withdrew); a field
// left out is untouched.  localStorage stays the primary store (decisions.ts);
// this is the fire-and-forget mirror the store debounces into.
//
// Root ids are STRINGS end to end (they exceed 2^53).
import {
  authedFetch,
  QUEUE_BASE,
} from "#src/merge_review/mergeQueueClient.js";

// One row as the server returns it.  `split` is whatever JSON the reviewer's
// browser sent — an array of cluster-id strings, or "skip".
export interface ServerDecision {
  window_id: string;
  reviewer: string;
  merge: string | null;
  split: string | string[] | null;
  notes: string | null;
  autoproof_job_id: string | null;
  session_id: string | null;
  updated_at: string | null;
}

// The per-window patch the store sends: only the fields that changed, with
// null meaning "cleared".
export interface DecisionPatch {
  merge?: string | null;
  split?: string | string[] | null;
  notes?: string | null;
}

export interface PutDecisionsBody {
  source_root_id: string;
  session_id?: string;
  autoproof_job_id?: string;
  decisions: Record<string, DecisionPatch>;
}

type J = Record<string, unknown>;

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

async function errorText(r: Response): Promise<string> {
  let text = "";
  try {
    text = await r.text();
  } catch {
    /* body unreadable */
  }
  try {
    const d = JSON.parse(text) as J;
    const m = d && (typeof d.message === "string" ? d.message : d.error);
    if (typeof m === "string") return `Candela ${r.status}: ${m}`;
  } catch {
    /* not JSON */
  }
  return `Candela ${r.status}: ${text.slice(0, 140)}`;
}

// Every decision the server holds for this root (all reviewers unless one is
// named), or {error} when it could not be asked — [] means "none recorded".
export async function fetchDecisions(
  sourceRootId: string,
  reviewer?: string,
): Promise<ServerDecision[] | { error: string }> {
  try {
    const q = new URLSearchParams({ source_root_id: sourceRootId });
    if (reviewer) q.set("reviewer", reviewer);
    const r = await authedFetch(`${QUEUE_BASE}/decisions?${q.toString()}`);
    if (!r.ok) return { error: await errorText(r) };
    const d = (await r.json()) as J;
    if (!Array.isArray(d?.decisions)) {
      return { error: "Candela: malformed decisions response" };
    }
    const out: ServerDecision[] = [];
    for (const raw of d.decisions as unknown[]) {
      const row = (raw && typeof raw === "object" ? raw : null) as J | null;
      if (!row) continue;
      const windowId = str(row.window_id);
      if (windowId == null) continue;
      const split = row.split;
      out.push({
        window_id: windowId,
        reviewer: str(row.reviewer) ?? "",
        merge: str(row.merge),
        split:
          split == null
            ? null
            : Array.isArray(split)
              ? split.map((x) => String(x))
              : String(split),
        notes: str(row.notes),
        autoproof_job_id: str(row.autoproof_job_id),
        session_id: str(row.session_id),
        updated_at: str(row.updated_at),
      });
    }
    return out;
  } catch (e) {
    return { error: String(e) };
  }
}

// Upsert a batch of per-window patches.  `keepalive` lets a flush started
// from pagehide outlive the page.
export async function putDecisions(
  body: PutDecisionsBody,
  opts: { keepalive?: boolean } = {},
): Promise<{ upserted: number } | { error: string }> {
  try {
    const r = await authedFetch(`${QUEUE_BASE}/decisions`, {
      method: "PUT",
      body: JSON.stringify(body),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
    if (!r.ok) return { error: await errorText(r) };
    const d = (await r.json()) as J;
    const n = typeof d?.upserted === "number" ? d.upserted : Number(d?.upserted);
    return { upserted: Number.isFinite(n) ? n : 0 };
  } catch (e) {
    return { error: String(e) };
  }
}
