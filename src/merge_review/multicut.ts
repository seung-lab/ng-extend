// Bridge between the review UI and neuroglancer's graphene multicut
// tool.  Given two clusters of annotation positions, we resolve a
// supervoxel id at each point (reading the loaded base segmentation),
// seed the layer's MulticutState with one cluster as sinks and the
// other as sources, then activate the multicut tool so the reviewer
// can submit the split.
//
// This pokes at neuroglancer internals that aren't part of the public
// typings (the graphene GraphConnection / MulticutState, the
// segmentation render layers' getValueAt), so the structural shapes
// below are declared locally and reached via narrow casts.

import type { Viewer } from "neuroglancer/unstable/viewer.js";
import { restoreTool } from "neuroglancer/unstable/ui/tool.js";
import { StatusMessage } from "neuroglancer/unstable/status.js";

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

interface UserLayerLike {
  renderLayers: RenderLayerLike[];
  graphConnection?: {
    value?: { state?: { multicutState?: MulticutStateLike } };
  };
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

// Read the base supervoxel id at a global (voxel-space) position from
// whichever segmentation render layer has the covering chunk loaded.
// Returns null when no loaded chunk covers the point.
function supervoxelAt(
  userLayer: UserLayerLike,
  position: number[],
): bigint | null {
  const gp = Float32Array.from(position);
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
  positions: number[][],
  rootId: bigint,
): SegmentSelection[] {
  const out: SegmentSelection[] = [];
  const seen = new Set<bigint>();
  for (const position of positions) {
    const segmentId = supervoxelAt(userLayer, position);
    if (segmentId === null || seen.has(segmentId)) continue;
    seen.add(segmentId);
    out.push({ segmentId, rootId, position: position.slice() });
  }
  return out;
}

export interface SeedMulticutResult {
  ok: boolean;
  message: string;
}

// Seed and activate multicut.  `sinkPositions` / `sourcePositions` are
// voxel-space token positions for the two selected clusters.
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

  const layerLike = userLayer as unknown as UserLayerLike;
  const sinks = resolveSelections(layerLike, sinkPositions, rootId);
  const sources = resolveSelections(layerLike, sourcePositions, rootId);

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
