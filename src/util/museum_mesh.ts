// Real specimen wireframes for the Achievement Museum.
//
// Rides the mesh download pipeline the app already has: neuroglancer fetches
// and draco-decodes mesh fragments for any visible segment using the user's
// own authenticated session. We temporarily add the specimen segment to the
// active segmentation layer's visible set, wait for its fragments to stream
// in, read the decoded vertex/index buffers, decimate them to a few thousand
// edges with vertex clustering, and cache the tiny wireframe in localStorage
// so later museum visits skip the download entirely.

import {MeshLayer} from 'neuroglancer/mesh/frontend';
import {getObjectKey} from 'neuroglancer/segmentation_display_state/base';
import {Uint64} from 'neuroglancer/util/uint64';

export interface MuseumWireframe {
  /** Flat vertex positions, milliunits: each axis normalized to [-1000, 1000]. */
  verts: number[];
  /** Flat pairs of vertex indices. */
  edges: number[];
}

const CACHE_PREFIX = 'nge_museum_wire_v1_';
const EDGE_CAP = 6500;
const POLL_MS = 600;

export async function getMuseumWireframe(
    segId: string, timeoutMs = 45000): Promise<MuseumWireframe | null> {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + segId);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.verts?.length && parsed?.edges?.length) return parsed;
    }
  } catch {}
  const wire = await fetchAndDecimate(segId, timeoutMs);
  if (wire) {
    try {
      localStorage.setItem(CACHE_PREFIX + segId, JSON.stringify(wire));
    } catch {}
  }
  return wire;
}

async function fetchAndDecimate(
    segId: string, timeoutMs: number): Promise<MuseumWireframe | null> {
  const viewer = (window as any)['viewer'];
  const managedLayers = viewer?.layerManager?.managedLayers ?? [];
  let id: Uint64;
  try {
    id = Uint64.parseString(segId);
  } catch {
    return null;
  }

  for (const managed of managedLayers) {
    const userLayer = managed.layer;
    if (!userLayer) continue;
    const meshLayer = (userLayer.renderLayers ?? [])
        .find((rl: any) => rl instanceof MeshLayer) as MeshLayer | undefined;
    if (!meshLayer) continue;
    const visible = (userLayer as any).displayState?.segmentationGroupState?.value?.visibleSegments;
    if (!visible) continue;

    const wasVisible = !!visible.has?.(id);
    if (!wasVisible) {
      try {
        visible.add(id);
      } catch {
        continue;
      }
    }
    try {
      const buffers = await waitForFragments(meshLayer, id, timeoutMs);
      if (buffers) return decimate(buffers.verts, buffers.indices);
    } finally {
      // Leave the user's own selection alone; only remove what we added.
      if (!wasVisible) {
        try {
          visible.delete(id);
        } catch {}
      }
    }
  }
  return null;
}

interface RawBuffers {
  verts: Float32Array[];
  indices: (Uint16Array | Uint32Array)[];
}

function waitForFragments(
    meshLayer: MeshLayer, id: Uint64, timeoutMs: number): Promise<RawBuffers | null> {
  const started = Date.now();
  return new Promise(resolve => {
    const poll = () => {
      const elapsed = Date.now() - started;
      const objectKey = getObjectKey(id);
      const manifest = (meshLayer.source as any).chunks.get(objectKey);
      const fragmentIds = manifest?.fragmentIds;
      const out: RawBuffers = {verts: [], indices: []};
      let loaded = 0;
      if (fragmentIds?.length) {
        const fragmentChunks = (meshLayer.source as any).fragmentSource.chunks;
        for (const fragmentId of fragmentIds) {
          const {key} = (meshLayer.source as any).getFragmentKey(objectKey, fragmentId);
          const fragment = fragmentChunks.get(key);
          const verts = fragment?.meshData?.vertexPositions;
          const indices = fragment?.meshData?.indices;
          // Small fragments decode with 16 bit indices, only large ones use
          // 32 bit. Accept both or most cells never finish loading.
          if (verts instanceof Float32Array && verts.length >= 9 &&
              (indices instanceof Uint32Array || indices instanceof Uint16Array) &&
              indices.length >= 3) {
            out.verts.push(verts);
            out.indices.push(indices);
            loaded++;
          }
        }
        if (loaded === fragmentIds.length && loaded > 0) {
          resolve(out);
          return;
        }
        // Big cells stream many fragments; after a generous wait, take what
        // arrived rather than nothing.
        if (elapsed > timeoutMs && loaded > 0) {
          resolve(out);
          return;
        }
      }
      if (elapsed > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(poll, POLL_MS);
    };
    poll();
  });
}

/**
 * Vertex clustering decimation: snap vertices to a coarse grid, merge each
 * occupied cell to its average position, and keep one edge per pair of
 * neighboring cells. Tries progressively coarser grids until the edge count
 * fits the cap.
 */
function decimate(
    vertArrays: Float32Array[],
    indexArrays: (Uint16Array | Uint32Array)[]): MuseumWireframe | null {
  if (vertArrays.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const verts of vertArrays) {
    for (let i = 0; i + 2 < verts.length; i += 3) {
      const x = verts[i], y = verts[i + 1], z = verts[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  const extX = Math.max(1e-6, maxX - minX);
  const extY = Math.max(1e-6, maxY - minY);
  const extZ = Math.max(1e-6, maxZ - minZ);
  const maxExt = Math.max(extX, extY, extZ);

  for (const grid of [140, 110, 84, 64, 48, 36, 26]) {
    const cell = maxExt / grid;
    const nx = Math.max(1, Math.ceil(extX / cell));
    const ny = Math.max(1, Math.ceil(extY / cell));
    const nz = Math.max(1, Math.ceil(extZ / cell));

    const clusterOf = (x: number, y: number, z: number) => {
      const ix = Math.min(nx - 1, Math.floor((x - minX) / cell));
      const iy = Math.min(ny - 1, Math.floor((y - minY) / cell));
      const iz = Math.min(nz - 1, Math.floor((z - minZ) / cell));
      return ix + nx * (iy + ny * iz);
    };

    const clusterIndex = new Map<number, number>();
    const sums: number[] = [];
    const counts: number[] = [];
    const clusterForVertex: Int32Array[] = [];

    for (const verts of vertArrays) {
      const map = new Int32Array(verts.length / 3);
      for (let i = 0, vi = 0; i + 2 < verts.length; i += 3, vi++) {
        const key = clusterOf(verts[i], verts[i + 1], verts[i + 2]);
        let idx = clusterIndex.get(key);
        if (idx === undefined) {
          idx = counts.length;
          clusterIndex.set(key, idx);
          sums.push(0, 0, 0);
          counts.push(0);
        }
        sums[idx * 3] += verts[i];
        sums[idx * 3 + 1] += verts[i + 1];
        sums[idx * 3 + 2] += verts[i + 2];
        counts[idx]++;
        map[vi] = idx;
      }
      clusterForVertex.push(map);
    }

    const edgeSet = new Set<number>();
    const nClusters = counts.length;
    for (let a = 0; a < indexArrays.length; a++) {
      const tri = indexArrays[a];
      const map = clusterForVertex[a];
      for (let i = 0; i + 2 < tri.length; i += 3) {
        const c0 = map[tri[i]], c1 = map[tri[i + 1]], c2 = map[tri[i + 2]];
        addEdge(edgeSet, c0, c1, nClusters);
        addEdge(edgeSet, c1, c2, nClusters);
        addEdge(edgeSet, c2, c0, nClusters);
      }
    }
    if (edgeSet.size > EDGE_CAP) continue;
    if (edgeSet.size < 3) return null;

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const scale = 2000 / maxExt;
    const verts: number[] = new Array(nClusters * 3);
    for (let i = 0; i < nClusters; i++) {
      verts[i * 3] = Math.round((sums[i * 3] / counts[i] - cx) * scale);
      verts[i * 3 + 1] = Math.round((sums[i * 3 + 1] / counts[i] - cy) * scale);
      verts[i * 3 + 2] = Math.round((sums[i * 3 + 2] / counts[i] - cz) * scale);
    }
    const edges: number[] = [];
    edgeSet.forEach(packed => {
      edges.push(Math.floor(packed / nClusters), packed % nClusters);
    });
    return {verts, edges};
  }
  return null;
}

function addEdge(edgeSet: Set<number>, a: number, b: number, n: number) {
  if (a === b) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  edgeSet.add(lo * n + hi);
}
