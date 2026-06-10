// Bridge between the review UI and neuroglancer's graphene multicut
// tool.  Given two clusters of annotation positions (in the *global*
// coordinate space), we resolve a supervoxel id at each point (reading
// the loaded base segmentation), seed the layer's MulticutState with
// one cluster as sinks and the other as sources, then activate the
// multicut tool so the reviewer can submit the split.
//
// This pokes at neuroglancer internals that aren't part of the public
// typings (the graphene GraphConnection / MulticutState, the
// segmentation render layers' getValueAt, the layer's chunk
// transform), so the structural shapes below are declared locally and
// reached via narrow casts.

import type { Viewer } from "neuroglancer/unstable/viewer.js";
import { restoreTool } from "neuroglancer/unstable/ui/tool.js";
import { StatusMessage } from "neuroglancer/unstable/status.js";
import {
  getChunkPositionFromCombinedGlobalLocalPositions,
  getChunkTransformParameters,
} from "neuroglancer/unstable/render_coordinate_transform.js";

const GRAPHENE_MULTICUT_SEGMENTS_TOOL_ID = "grapheneMulticutSegments";

interface SegmentSelection {
  segmentId: bigint;
  rootId: bigint;
  position: number[];
}

interface MulticutStateLike {
  reset(): void;
  focusSegment: { value: bigint | undefined };
  // false → clicks land in `sinks` (red / side A); true → `sources`
  // (blue / side B).  This is graphene's own active-group toggle.
  blueGroup: { value: boolean };
  sinks: { add(x: SegmentSelection): void; size: number };
  sources: { add(x: SegmentSelection): void; size: number };
}

interface RenderLayerLike {
  getValueAt?: (position: Float32Array) => unknown;
}

// Minimal shape of the bits of SegmentationUserLayer we reach into.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLayer = any;

interface UserLayerLike {
  renderLayers: RenderLayerLike[];
  graphConnection?: {
    value?: { state?: { multicutState?: MulticutStateLike } };
  };
}

// Converts a position from the global coordinate space into the
// segmentation layer's chunk/model space — i.e. exactly what the
// multicut tool stores via getMousePositionInLayerCoordinates().  The
// stored position is later multiplied by the layer's inputSpace scales
// to get nanometres, so it MUST be in layer space, not global space.
type GlobalToLayer = (globalPosition: number[]) => number[] | null;

// Replicates the graphene frontend's getGraphLoadedSubsource(): the
// enabled "graph" subsource carries the transform multicut uses.
function getGraphSubsource(layer: AnyLayer): AnyLayer | undefined {
  for (const dataSource of layer.dataSources ?? []) {
    const loadState = dataSource.loadState;
    if (!loadState || loadState.error !== undefined) continue;
    for (const subsource of loadState.subsources ?? []) {
      if (subsource.enabled && subsource.subsourceEntry?.id === "graph") {
        return subsource;
      }
    }
  }
  return undefined;
}

// Builds the global→layer converter using the layer's actual chunk
// transform (handles the segmentation's native voxel size, any offset,
// and axis ordering).  Returns null if the transform isn't ready.
function makeGlobalToLayer(layer: AnyLayer): GlobalToLayer | null {
  const subsource = getGraphSubsource(layer);
  if (!subsource) return null;
  const modelTransformValue = subsource.getRenderLayerTransform().value;
  if (!modelTransformValue || modelTransformValue.error !== undefined) {
    return null;
  }
  let chunkTransform: AnyLayer;
  try {
    chunkTransform = getChunkTransformParameters(modelTransformValue);
  } catch {
    return null;
  }
  if (!chunkTransform || chunkTransform.error !== undefined) return null;
  const localPosition: Float32Array =
    layer.localPosition?.value ?? new Float32Array(0);
  const rank: number = chunkTransform.modelTransform.unpaddedRank;
  return (globalPosition: number[]) => {
    const chunkPosition = new Float32Array(rank);
    const ok = getChunkPositionFromCombinedGlobalLocalPositions(
      chunkPosition,
      Float32Array.from(globalPosition),
      localPosition,
      chunkTransform.layerRank,
      chunkTransform.combinedGlobalLocalToChunkTransform,
    );
    return ok ? Array.from(chunkPosition) : null;
  };
}

// Read the base supervoxel id at a global (voxel-space) position from
// whichever segmentation render layer has the covering chunk loaded.
// Returns null when no loaded chunk covers the point.
function supervoxelAt(
  userLayer: UserLayerLike,
  globalPosition: number[],
): bigint | null {
  const gp = Float32Array.from(globalPosition);
  for (const rl of userLayer.renderLayers) {
    if (typeof rl.getValueAt !== "function") continue;
    let value: unknown;
    try {
      value = rl.getValueAt(gp);
    } catch {
      continue;
    }
    // Base segmentation values are uint64 (bigint); 0 is background.
    if (typeof value === "bigint" && value !== 0n) return value;
  }
  return null;
}

function resolveSelections(
  userLayer: UserLayerLike,
  globalPositions: number[][],
  rootId: bigint,
  toLayer: GlobalToLayer,
): SegmentSelection[] {
  const out: SegmentSelection[] = [];
  const seen = new Set<bigint>();
  for (const globalPosition of globalPositions) {
    const segmentId = supervoxelAt(userLayer, globalPosition);
    if (segmentId === null || seen.has(segmentId)) continue;
    const position = toLayer(globalPosition);
    if (position === null) continue;
    seen.add(segmentId);
    out.push({ segmentId, rootId, position });
  }
  return out;
}

export interface SeedMulticutResult {
  ok: boolean;
  message: string;
}

// Locate the managed layer backed by a graphene multicut state.
function findGrapheneLayer(
  viewer: Viewer,
): { userLayer: object; multicutState: MulticutStateLike } | null {
  for (const managed of viewer.layerManager.managedLayers) {
    const userLayer = managed.layer as unknown as UserLayerLike | null;
    const multicutState =
      userLayer?.graphConnection?.value?.state?.multicutState;
    if (userLayer && multicutState) {
      return { userLayer: managed.layer as object, multicutState };
    }
  }
  return null;
}

// Seed and activate multicut.  `sinkPositions` / `sourcePositions` are
// token positions for the two selected clusters, in the *global*
// coordinate space (the same coords the cluster ellipsoids use).
export function seedMulticut(
  viewer: Viewer,
  rootIdStr: string,
  sinkPositions: number[][],
  sourcePositions: number[][],
): SeedMulticutResult {
  const found = findGrapheneLayer(viewer);
  if (!found) {
    const msg = "No graphene segmentation layer with multicut support.";
    StatusMessage.showTemporaryMessage(msg, 7000);
    return { ok: false, message: msg };
  }
  const { userLayer, multicutState } = found;

  let rootId: bigint;
  try {
    rootId = BigInt(rootIdStr);
  } catch {
    const msg = `Invalid root id: ${rootIdStr}`;
    StatusMessage.showTemporaryMessage(msg, 7000);
    return { ok: false, message: msg };
  }

  const toLayer = makeGlobalToLayer(userLayer as AnyLayer);
  if (!toLayer) {
    const msg = "Segmentation layer transform isn't ready yet — retry.";
    StatusMessage.showTemporaryMessage(msg, 7000);
    return { ok: false, message: msg };
  }

  const layerLike = userLayer as unknown as UserLayerLike;
  const sinks = resolveSelections(layerLike, sinkPositions, rootId, toLayer);
  const sources = resolveSelections(
    layerLike,
    sourcePositions,
    rootId,
    toLayer,
  );

  if (sinks.length === 0 || sources.length === 0) {
    const msg =
      "Couldn't resolve supervoxels for both clusters — make sure the " +
      "segmentation is loaded/visible at this location, then retry.";
    StatusMessage.showTemporaryMessage(msg, 9000);
    return { ok: false, message: msg };
  }

  multicutState.reset();
  multicutState.focusSegment.value = rootId;
  for (const s of sinks) multicutState.sinks.add(s);
  for (const s of sources) multicutState.sources.add(s);

  // Activate the multicut tool on the segmentation layer.
  const tool = restoreTool(userLayer, GRAPHENE_MULTICUT_SEGMENTS_TOOL_ID);
  if (tool) {
    viewer.activateTool("C", tool);
  }

  const msg = `Multicut seeded: ${sinks.length} sink + ${sources.length} source supervoxels.`;
  StatusMessage.showTemporaryMessage(msg, 6000);
  return { ok: true, message: msg };
}

// ───────────────────────── manual multicut ──────────────────────────
// Free-form seed editing (Option C): instead of (or on top of) the
// cluster-derived seeds, the reviewer places every sink/source point by
// hand — clicking supervoxels directly in the viewer.  These helpers
// drive graphene's own MulticutState so the actual cut still happens in
// the native multicut tool; we only expose blank-activate, side-toggle,
// and clear so the reviewer never has to hunt for ng's hidden controls.

function activateMulticutTool(viewer: Viewer, userLayer: object): void {
  const tool = restoreTool(userLayer, GRAPHENE_MULTICUT_SEGMENTS_TOOL_ID);
  if (tool) viewer.activateTool("C", tool);
}

// Start a BLANK multicut on the given root: clear any existing seeds,
// focus the root, default to the red (side-A) group, and activate the
// tool.  After this the reviewer clicks supervoxels in the viewer to add
// points; clicking an existing point removes it (native graphene
// behaviour).  Use setMulticutSide() to switch which side clicks add to.
export function startManualMulticut(
  viewer: Viewer,
  rootIdStr: string,
): SeedMulticutResult {
  const found = findGrapheneLayer(viewer);
  if (!found) {
    const msg = "No graphene segmentation layer with multicut support.";
    StatusMessage.showTemporaryMessage(msg, 7000);
    return { ok: false, message: msg };
  }
  let rootId: bigint;
  try {
    rootId = BigInt(rootIdStr);
  } catch {
    const msg = `Invalid root id: ${rootIdStr}`;
    StatusMessage.showTemporaryMessage(msg, 7000);
    return { ok: false, message: msg };
  }
  const { userLayer, multicutState } = found;
  multicutState.reset();
  multicutState.focusSegment.value = rootId;
  multicutState.blueGroup.value = false; // start on side A (red / sinks)
  activateMulticutTool(viewer, userLayer);
  const msg =
    "Manual split: click supervoxels to add points to the active side; " +
    "click a point again to remove it.";
  StatusMessage.showTemporaryMessage(msg, 6000);
  return { ok: true, message: msg };
}

// Choose which side the reviewer's next viewer-clicks land on.
// "red" → sinks (side A), "blue" → sources (side B).
export function setMulticutSide(
  viewer: Viewer,
  side: "red" | "blue",
): boolean {
  const found = findGrapheneLayer(viewer);
  if (!found) return false;
  found.multicutState.blueGroup.value = side === "blue";
  return true;
}

// Drop every manually-placed (and cluster-derived) seed without leaving
// the tool, so the reviewer can restart placement from scratch.
export function clearMulticutSeeds(viewer: Viewer): boolean {
  const found = findGrapheneLayer(viewer);
  if (!found) return false;
  found.multicutState.reset();
  return true;
}

// Current seed counts, for a live readout in the panel.  Returns null
// when no graphene layer is present.
export function getMulticutCounts(
  viewer: Viewer,
): { sinks: number; sources: number; blue: boolean } | null {
  const found = findGrapheneLayer(viewer);
  if (!found) return null;
  const m = found.multicutState;
  return { sinks: m.sinks.size, sources: m.sources.size, blue: m.blueGroup.value };
}
