// Type definitions for the MERGER FREE review bundle, mirroring the
// JSON produced by export_review_bundle.py.  Kept loose (optional
// fields, string|number ids) so older bundles still load.

export interface NeuronInfo {
  latest_root_id: string | number;
  old_root_id?: string | number;
  old_root_ids?: (string | number)[];
  datastack?: string;
}

export interface SpectralInfo {
  k?: number;
  score?: number;
}

export interface Tokens {
  pos_rel_um: number[][];
  labels: number[];
  spectral?: SpectralInfo;
}

export interface ReviewWindow {
  idx: number;
  center_um: number[];
  is_suspect?: boolean;
  verify_prob?: number | null;
  tokens?: Tokens;
  // Pipeline-candidate windows (autoproof candidates.json) also carry:
  kind?: string; // "merge" | "split"
  partner_root?: string | number | null; // the candidate partner segment (null: none)
  site_id?: number; // pipeline site id (NOT unique — one row per partner)
}

export interface BundleMetadata {
  n_suspects?: number;
  n_windows?: number;
}

export interface Bundle {
  neuron: NeuronInfo;
  windows: ReviewWindow[];
  metadata?: BundleMetadata;
  // Provenance sidecar when the bundle was synthesised from an autoproof
  // pipeline manifest + candidates.json (absent for classic bundles).
  pipeline?: PipelineInfo;
}

// ── Autoproof pipeline output format ─────────────────────────────
// manifest.json produced by the auto-proofread pipeline.  The artifact
// URIs are usually file:// paths that a browser cannot fetch, so we only
// use the manifest for its root id + provenance and ask the user to
// import candidates.json directly.
export interface PipelineManifest {
  root_id: string | number;
  // The CAVE datastack the job was computed on: the segmentation table that
  // root_id and every candidate's partner_root belong to.  Absent on manifests
  // written before the pipeline recorded it.
  datastack?: string;
  model_version?: string;
  params_hash?: string;
  generated_at?: string;
  artifacts: Record<string, string>;
  counts?: Record<string, number>;
}

// One entry of the pipeline's candidates.json array.
export interface PipelineCandidate {
  site_id: number;
  kind: string; // "merge" | "split"
  // The partner segment as a digit STRING (ids exceed 2^53); null when the
  // candidate has no partner (a split candidate in general).
  partner_root: string | number | null;
  score: number; // 0..1 confidence
  site_center_nm: number[];
}

// Provenance recorded on a Bundle built from pipeline output.
export interface PipelineInfo {
  model_version?: string;
  params_hash?: string;
  generated_at?: string;
}

// A single decision.  `split` is the new schema (array of cluster-id
// strings, or "skip"); `verdict`/`affinity` are legacy fields kept for
// back-compat when importing old decision exports.
export interface Decision {
  merge?: string;
  verdict?: string; // legacy → merge
  split?: string | string[];
  affinity?: string | string[]; // legacy → split
  notes?: string;
  ts?: string;
}

export type DecisionMap = Record<string, Decision>;

// A neuroglancer viewer state object, as accepted by
// viewer.state.restoreState().  Loosely typed on purpose.
export type ViewerState = Record<string, unknown>;
