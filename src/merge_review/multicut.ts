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
  sinks: { add(x: SegmentSelection): void };
  sources: { add(x: SegmentSelection): void };
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
export function supervoxelAt(
  userLayer: unknown,
  globalPosition: number[],
): bigint | null {
  const gp = Float32Array.from(globalPosition);
  for (const rl of (userLayer as UserLayerLike).renderLayers) {
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
