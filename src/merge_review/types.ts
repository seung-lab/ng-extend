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
}

export interface BundleMetadata {
  n_suspects?: number;
  n_windows?: number;
}

export interface Bundle {
  neuron: NeuronInfo;
  windows: ReviewWindow[];
  metadata?: BundleMetadata;
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
