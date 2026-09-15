// Client for the auto-proofread pipeline API (autoproof-pipeline/, Flask on :8090).
//
// Same configuration precedence as the Candela queue client (mergeQueueClient.ts):
//   window.AUTOPROOF_API = "https://<host>/autoproof";   // runtime override, no trailing slash
//   config/ng-extend.json { "autoproof_api": "..." }     // build-time; the deploy workflow patches it
//   http://localhost:8090                                // local dev default
//
// Every root id is a STRING end to end. Root ids exceed 2^53, so the API serialises them
// as strings and this module never Number()s one — JSON.parse would already have rounded
// a bare integer, which is exactly why the contract forbids them.

import type {
  PipelineCandidate,
  PipelineManifest,
} from "#src/merge_review/types.js";
import { authedFetch } from "#src/merge_review/mergeQueueClient.js";

type W = { AUTOPROOF_API?: string };
const w = (typeof window !== "undefined" ? (window as unknown as W) : {}) as W;

// Baked in at build time by webpack's DefinePlugin from config/ng-extend.json
// (see src/config.ts for the full key list).
declare const CONFIG: { autoproof_api?: string } | undefined;
const cfg = typeof CONFIG !== "undefined" && CONFIG ? CONFIG : {};

const DEFAULT_API = "http://localhost:8090";
export const AUTOPROOF_API = (
  w.AUTOPROOF_API ||
  cfg.autoproof_api ||
  DEFAULT_API
).replace(/\/$/, "");

// Per-root status values, as the API reports them.
export type AutoproofStatus =
  | "QUEUED"
  | "PREPROC_RUNNING"
  | "PREPROC_DONE"
  | "INFER_RUNNING"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

export const AUTOPROOF_TERMINAL: ReadonlySet<string> = new Set([
  "DONE",
  "FAILED",
  "CANCELLED",
]);

export function isAutoproofTerminal(status: string | null | undefined): boolean {
  return status != null && AUTOPROOF_TERMINAL.has(status);
}

// One root inside a job (GET /jobs/<id> → roots[], GET /jobs/<id>/roots/<root>).
export interface AutoproofRootRow {
  root_id: string;
  status: string;
  attempt: number;
  error: string | null;
  manifest_uri: string | null;
}

// GET /jobs/<id>
export interface AutoproofJobRollup {
  job_id: string;
  created_at: string | null;
  model_version: string | null;
  params_hash: string | null;
  counts: Record<string, number>;
  roots: AutoproofRootRow[];
}

// One entry of GET /roots/<root>/jobs → jobs[] (newest first).
export interface AutoproofRootJob {
  job_id: string;
  status: string;
  attempt: number;
  error: string | null;
  manifest_uri: string | null;
  created_at: string | null;
  updated_at: string | null;
  model_version: string | null;
  params_hash: string | null;
}

export type AutoproofError = { error: string; status?: string };

export function isAutoproofError(r: unknown): r is AutoproofError {
  return (
    !!r &&
    typeof r === "object" &&
    !Array.isArray(r) &&
    typeof (r as { error?: unknown }).error === "string"
  );
}

// ── helpers ──────────────────────────────────────────────────────
type J = Record<string, unknown>;

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

function num(v: unknown, dflt = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function toRootRow(raw: unknown): AutoproofRootRow {
  const r = (raw && typeof raw === "object" ? raw : {}) as J;
  return {
    root_id: str(r.root_id) ?? "",
    status: str(r.status) ?? "",
    attempt: num(r.attempt),
    error: str(r.error),
    manifest_uri: str(r.manifest_uri),
  };
}

function toCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as J)) out[k] = num(v);
  }
  return out;
}

// "autoproof 409: not ready (INFER_RUNNING)" — pulls {error, status} out of a JSON
// error body when there is one, otherwise the first bit of the text body.
// `json` is true only when the body was the API's own JSON `{error}`: a 404
// from whatever sits in front of the API (a reverse proxy with the wrong path
// prefix, an ingress mid-rollout, a placeholder page during a redeploy) is
// HTML/plain text and must not be mistaken for the API saying "not found".
async function errorOf(
  r: Response,
): Promise<AutoproofError & { json: boolean }> {
  let text = "";
  try {
    text = await r.text();
  } catch {
    /* body unreadable */
  }
  try {
    const d = JSON.parse(text) as J;
    if (d && typeof d.error === "string") {
      const status = typeof d.status === "string" ? d.status : undefined;
      const msg = status ? `${d.error} (${status})` : d.error;
      return { error: `autoproof ${r.status}: ${msg}`, status, json: true };
    }
  } catch {
    /* not JSON */
  }
  return { error: `autoproof ${r.status}: ${text.slice(0, 140)}`, json: false };
}

const url = (path: string) => `${AUTOPROOF_API}${path}`;
const enc = encodeURIComponent;

// ── API ──────────────────────────────────────────────────────────

// POST /jobs {root_ids, params?} → 201 {job_id, n_roots, root_ids}.
export async function submitAutoproof(
  rootIds: string[],
  params?: Record<string, unknown>,
): Promise<{ job_id: string; root_ids: string[] } | AutoproofError> {
  try {
    const body: J = { root_ids: rootIds };
    if (params && Object.keys(params).length) body.params = params;
    const r = await authedFetch(url("/jobs"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!r.ok) return await errorOf(r);
    const d = (await r.json()) as J;
    const jobId = str(d?.job_id);
    if (!jobId) return { error: "autoproof: malformed response (no job_id)" };
    const ids = Array.isArray(d.root_ids)
      ? (d.root_ids as unknown[]).map((x) => String(x))
      : rootIds;
    return { job_id: jobId, root_ids: ids };
  } catch (e) {
    return { error: String(e) };
  }
}

// GET /jobs/<job_id>.  The documented 404 — the API's own JSON `{error}` (the
// server no longer knows the job: its DB was reset, or the remembered id is
// stale) — is reported as `missing` so callers stop polling it and forget the
// id; every other failure (network, 5xx, malformed body, and a non-JSON 404
// from a misconfigured proxy or an ingress mid-rollout) is transient and may
// be retried, keeping the remembered job id intact.
export type AutoproofJobResult =
  | { ok: true; roll: AutoproofJobRollup }
  | { ok: false; missing: boolean; error: string };

export async function fetchAutoproofJob(
  jobId: string,
): Promise<AutoproofJobResult> {
  try {
    const r = await authedFetch(url(`/jobs/${enc(jobId)}`));
    if (!r.ok) {
      const e = await errorOf(r);
      return { ok: false, missing: r.status === 404 && e.json, error: e.error };
    }
    const d = (await r.json()) as J;
    if (!d || typeof d !== "object") {
      return { ok: false, missing: false, error: "autoproof: malformed job" };
    }
    return {
      ok: true,
      roll: {
        job_id: str(d.job_id) ?? jobId,
        created_at: str(d.created_at),
        model_version: str(d.model_version),
        params_hash: str(d.params_hash),
        counts: toCounts(d.counts),
        roots: Array.isArray(d.roots) ? d.roots.map(toRootRow) : [],
      },
    };
  } catch (e) {
    return { ok: false, missing: false, error: String(e) };
  }
}

// GET /roots/<root_id>/jobs?limit=N → every job containing this root, newest
// first; [] when the root has none, null when the API could not be asked
// (unreachable / error) — the two must not be confused.
export async function fetchAutoproofJobsForRoot(
  rootId: string,
  limit = 20,
): Promise<AutoproofRootJob[] | null> {
  try {
    const r = await authedFetch(
      url(`/roots/${enc(rootId)}/jobs?limit=${enc(String(limit))}`),
    );
    if (!r.ok) return null;
    const d = (await r.json()) as J;
    if (!Array.isArray(d?.jobs)) return null;
    return (d.jobs as unknown[]).map((raw) => {
      const j = (raw && typeof raw === "object" ? raw : {}) as J;
      return {
        job_id: str(j.job_id) ?? "",
        status: str(j.status) ?? "",
        attempt: num(j.attempt),
        error: str(j.error),
        manifest_uri: str(j.manifest_uri),
        created_at: str(j.created_at),
        updated_at: str(j.updated_at),
        model_version: str(j.model_version),
        params_hash: str(j.params_hash),
      };
    }).filter((j) => j.job_id !== "");
  } catch {
    return null;
  }
}

// GET /jobs/<job_id>/roots/<root_id>/manifest → manifest.json (409 until DONE).
export async function fetchAutoproofManifest(
  jobId: string,
  rootId: string,
): Promise<PipelineManifest | AutoproofError> {
  try {
    const r = await authedFetch(
      url(`/jobs/${enc(jobId)}/roots/${enc(rootId)}/manifest`),
    );
    if (!r.ok) return await errorOf(r);
    const d = (await r.json()) as Partial<PipelineManifest> | null;
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      return { error: "autoproof: malformed manifest" };
    }
    // The API sends root_id as the canonical digit string (the requested form
    // may carry leading zeros); prefer it, fall back to what we asked for.
    const bodyRoot =
      typeof d.root_id === "string" && /^\d+$/.test(d.root_id)
        ? d.root_id
        : null;
    return {
      ...d,
      root_id: bodyRoot ?? rootId,
      // The datastack the job was computed on (the table the ids belong to);
      // absent on manifests written before the pipeline recorded it.
      datastack:
        typeof d.datastack === "string" && d.datastack ? d.datastack : undefined,
      artifacts:
        d.artifacts && typeof d.artifacts === "object" ? d.artifacts : {},
    };
  } catch (e) {
    return { error: String(e) };
  }
}

// GET /jobs/<job_id>/roots/<root_id>/candidates → candidates.json array (409 until DONE).
export async function fetchAutoproofCandidates(
  jobId: string,
  rootId: string,
): Promise<PipelineCandidate[] | AutoproofError> {
  try {
    const r = await authedFetch(
      url(`/jobs/${enc(jobId)}/roots/${enc(rootId)}/candidates`),
    );
    if (!r.ok) return await errorOf(r);
    const d = (await r.json()) as unknown;
    if (!Array.isArray(d)) return { error: "autoproof: malformed candidates" };
    // partner_root arrives as a string; keep it that way (never Number()).  A
    // candidate without a partner is null on the wire and stays null — never
    // "" — so it cannot leak into the segmentation layer's segment list.
    return (d as unknown[]).map((raw) => {
      const c = (raw && typeof raw === "object" ? raw : {}) as J;
      return {
        ...(c as unknown as PipelineCandidate),
        partner_root: c.partner_root == null ? null : String(c.partner_root),
      };
    });
  } catch (e) {
    return { error: String(e) };
  }
}

// POST /jobs/<job_id>/cancel → {cancelled: n}. Only still-queued roots can be
// cancelled; a running root finishes on its own.
export async function cancelAutoproof(
  jobId: string,
): Promise<{ cancelled: number } | AutoproofError> {
  try {
    const r = await authedFetch(url(`/jobs/${enc(jobId)}/cancel`), {
      method: "POST",
    });
    if (!r.ok) return await errorOf(r);
    const d = (await r.json()) as J;
    return { cancelled: num(d?.cancelled) };
  } catch (e) {
    return { error: String(e) };
  }
}
