// Builds the neuroglancer viewer state for a single review window.
//
// This is the ng-extend port of the original demo's
// buildSpelunkerUrl(): instead of serialising the state into a
// spelunker `#!{...}` URL for an iframe, we return the plain state
// object and hand it to the embedded viewer via
// viewer.state.restoreState() (see store.ts).  The state schema is
// identical to what neuroglancer loads from its URL hash.

import type { Bundle, ReviewWindow, ViewerState } from "#src/merge_review/types.js";

// 4 nm xy → 1 voxel = 4nm; 1 µm = 250 vox
export const UM_TO_VOXEL_X = 250.0;
// 40 nm z → 1 voxel = 40nm; 1 µm = 25 vox
export const UM_TO_VOXEL_Z = 25.0;

// Cluster colour palette (max ~7 clusters in practice).  Deliberately
// avoids red and blue families so the dots stay distinguishable from
// the underlying segmentation meshes (latest_root = #8888ff blue,
// old_root = #ff6688 pink).
export const CLUSTER_COLORS = [
  "#ffe119", // yellow
  "#3cb44b", // saturated green
  "#ff8c00", // orange
  "#aa44ff", // purple
  "#bfef45", // lime
  "#00d0a0", // teal
  "#ee44ff", // magenta-violet (distinct from the pinker old-root)
];

export function clusterColor(label: number): string {
  return CLUSTER_COLORS[label % CLUSTER_COLORS.length];
}

const EM_SOURCE =
  "precomputed://https://bossdb-open-data.s3.amazonaws.com/" +
  "iarpa_microns/minnie/minnie65/em";

export function segmentationSources(datastack: string): string[] {
  return [
    "graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/" +
      datastack,
    "precomputed://middleauth+https://minnie.microns-daf.com/skeletoncache/" +
      "api/v1/" +
      datastack +
      "/precomputed/skeleton/",
  ];
}

// Per-window manual point edits, keyed by GLOBAL token index:
//   number → re-assign the token to that cluster label (recolour)
//   "x"    → delete the token (drop it from both split sides)
// Empty / missing entry → use the token's original cluster label.
export type TokenEdits = Record<number, number | "x">;

// Effective cluster label of a token after edits, or null if deleted.
export function effectiveLabel(
  origLabel: number,
  tokenIdx: number,
  edits: TokenEdits,
): number | null {
  const e = edits[tokenIdx];
  if (e === undefined) return origLabel;
  if (e === "x") return null;
  return e;
}

export function buildViewerState(
  bundle: Bundle,
  window_: ReviewWindow,
  edits: TokenEdits = {},
): ViewerState {
  const n = bundle.neuron;
  const c = window_.center_um;
  const datastack = n.datastack || "minnie65_public";

  // Build the segments list: latest root in blue + every old root in
  // pink.  Old roots come from `old_root_ids` (preferred) or the
  // legacy single-string `old_root_id` (back-compat).
  const segs: string[] = [String(n.latest_root_id)];
  const segColors: Record<string, string> = {};
  segColors[String(n.latest_root_id)] = "#8888ff";

  let oldRoots: string[] = [];
  if (Array.isArray(n.old_root_ids)) {
    oldRoots = n.old_root_ids.filter(Boolean).map(String);
  } else if (n.old_root_id) {
    oldRoots = [String(n.old_root_id)];
  }
  for (const oid of oldRoots) {
    if (oid && oid !== String(n.latest_root_id)) {
      segs.push(oid);
      segColors[oid] = "#ff6688";
    }
  }

  const layers: Record<string, unknown>[] = [
    {
      type: "image",
      source: EM_SOURCE,
      tab: "source",
      name: "imagery",
    },
    {
      type: "segmentation",
      source: segmentationSources(datastack),
      tab: "source",
      segments: segs,
      segmentColors: segColors,
      name: "segmentation",
    },
  ];

  if (window_.tokens && window_.tokens.pos_rel_um && window_.tokens.labels) {
    const positions = window_.tokens.pos_rel_um;
    const labels = window_.tokens.labels;
    const byCluster: Record<string, { pt: number[]; desc: string; tok: number }[]> = {};
    for (let i = 0; i < positions.length; i++) {
      // Honour manual edits: a recoloured token moves to its new cluster,
      // a deleted token (null) is skipped entirely.
      const lab = effectiveLabel(labels[i], i, edits);
      if (lab === null) continue;
      if (!byCluster[lab]) byCluster[lab] = [];
      const p = positions[i];
      byCluster[lab].push({
        pt: [
          (c[0] + p[0]) * UM_TO_VOXEL_X,
          (c[1] + p[1]) * UM_TO_VOXEL_X,
          (c[2] + p[2]) * UM_TO_VOXEL_Z,
        ],
        desc: `T${i} cluster=${lab}`,
        tok: i,
      });
    }
    // Use ELLIPSOID annotations (200 nm radius spheres ≈ 50 voxels xy /
    // 5 voxels z) so the cluster overlay reads as bigger soft blobs on
    // top of the EM image, with reduced fill opacity so the underlying
    // segmentation remains visible.
    Object.keys(byCluster)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((lab) => {
        const color = clusterColor(Number(lab));
        layers.push({
          type: "annotation",
          source: "local://annotations",
          tab: "annotations",
          annotationColor: color,
          annotationFillOpacity: 0.35,
          annotations: byCluster[lab].map((a) => ({
            type: "ellipsoid",
            center: a.pt,
            radii: [50, 50, 5],
            // id encodes the GLOBAL token index so a hovered annotation
            // maps straight back to the token for manual edits.
            id: `tok${a.tok}`,
            description: a.desc,
          })),
          name: `cluster-${lab}`,
        });
      });
  }

  return {
    dimensions: { x: [4e-9, "m"], y: [4e-9, "m"], z: [4e-8, "m"] },
    position: [
      c[0] * UM_TO_VOXEL_X,
      c[1] * UM_TO_VOXEL_X,
      c[2] * UM_TO_VOXEL_Z,
    ],
    crossSectionScale: 1.0,
    projectionScale: 12000,
    // Hide the cross-section slice planes in the 3D/mesh view by default
    // (the "Sections" toggle in the perspective panel).  Reviewers can
    // still turn them back on from that checkbox.
    showSlices: false,
    layers,
    selectedLayer: { layer: "segmentation", visible: true },
    layout: "xy-3d",
  };
}

// Positions of every token in the GLOBAL coordinate space (the same
// voxel coords as the ellipsoid annotations buildViewerState() emits),
// grouped by cluster label.  Used to seed the graphene multicut tool:
// one cluster's points become the sinks, the other's the sources.  The
// multicut bridge re-projects these into the segmentation layer's own
// coordinate space before storing them (see multicut.ts).
export function clusterPositions(
  window_: ReviewWindow,
  edits: TokenEdits = {},
): Map<number, number[][]> {
  const map = new Map<number, number[][]>();
  const t = window_.tokens;
  if (!t || !t.pos_rel_um || !t.labels) return map;
  const c = window_.center_um;
  for (let i = 0; i < t.pos_rel_um.length; i++) {
    const lab = effectiveLabel(t.labels[i], i, edits); // honour edits
    if (lab === null) continue; // deleted token
    const p = t.pos_rel_um[i];
    const pt = [
      (c[0] + p[0]) * UM_TO_VOXEL_X,
      (c[1] + p[1]) * UM_TO_VOXEL_X,
      (c[2] + p[2]) * UM_TO_VOXEL_Z,
    ];
    const arr = map.get(lab);
    if (arr) arr.push(pt);
    else map.set(lab, [pt]);
  }
  return map;
}

// Unique cluster labels present in a window AFTER edits (sorted).  Drives
// the SPLIT WHICH buttons and the digit-key cluster mapping so both stay
// in sync with manual recolours/deletes.
export function editedClusterLabels(
  window_: ReviewWindow,
  edits: TokenEdits = {},
): number[] {
  const t = window_.tokens;
  if (!t || !t.labels) return [];
  const set = new Set<number>();
  for (let i = 0; i < t.labels.length; i++) {
    const lab = effectiveLabel(t.labels[i], i, edits);
    if (lab !== null) set.add(lab);
  }
  return Array.from(set).sort((a, b) => a - b);
}
