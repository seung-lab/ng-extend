// Anchor→window "entrance" route that FOLLOWS THE NEURON.
//
// The neuron already has a precomputed skeleton in the CAVE skeletoncache
// (the same `skeletoncache/.../precomputed/skeleton/` source that's in the
// segmentation layer). We fetch it, snap the anchor and the window each to
// their nearest skeleton vertex (the anchor's nearest vertex is the "entrance
// gate"), and walk the shortest path along the skeleton's own edges between
// them. Auth is handled by neuroglancer's middleauth http source — the exact
// mechanism the graphene segmentation and the ngl_info volumes list use.

import type { Viewer } from "neuroglancer/unstable/viewer.js";
import { getHttpSource } from "neuroglancer/unstable/datasource/graphene/base.js";

export interface Skeleton {
  vertices: Float32Array; // nv * 3, nanometres (info transform is identity)
  edges: Uint32Array; // ne * 2, vertex indices
  nv: number;
}

// One in-flight/resolved fetch per (datastack, root) — the skeleton doesn't
// change for a fixed root, so switching windows never refetches.
const cache = new Map<string, Promise<Skeleton | null>>();

export function skeletonUrl(datastack: string, rootId: string): string {
  return (
    "middleauth+https://minnie.microns-daf.com/skeletoncache/api/v1/" +
    datastack +
    "/precomputed/skeleton/" +
    rootId
  );
}

export function fetchSkeleton(
  viewer: Viewer,
  datastack: string,
  rootId: string,
): Promise<Skeleton | null> {
  const key = `${datastack}/${rootId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const url = skeletonUrl(datastack, rootId);
    const buf = await fetchSkeletonBuffer(viewer, url);
    return buf ? parseSkeleton(buf) : null;
  })();
  cache.set(key, p);
  return p;
}

// A skeleton binary starts with a u32 vertex count; an HTML login/redirect page
// starts with '<' (0x3c). Reject the latter so we don't parse garbage.
function looksBinary(b: ArrayBuffer): boolean {
  return b.byteLength >= 8 && new Uint8Array(b, 0, 1)[0] !== 0x3c;
}

// The middleauth access tokens the login flow stashed in localStorage
// (auth_token_v2_<login_url> → { url, accessToken }); same source the login
// store reads. We try each as a Bearer token.
function middleauthTokens(): string[] {
  const out: string[] = [];
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : undefined;
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith("auth_token_v2_")) continue;
      const raw = ls.getItem(k);
      if (!raw) continue;
      try {
        const d = JSON.parse(raw);
        if (d && typeof d.accessToken === "string") out.push(d.accessToken);
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return out;
}

async function fetchSkeletonBuffer(
  viewer: Viewer,
  url: string,
): Promise<ArrayBuffer | null> {
  const plain = url.replace(/^middleauth\+/, "");
  // 1) Direct Bearer with the stored middleauth tokens — the exact pattern the
  //    login store uses for /user/me, proven to work against this host.
  const tokens = middleauthTokens();
  for (const tok of tokens) {
    try {
      const r = await fetch(plain, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (r.ok) {
        const b = await r.arrayBuffer();
        if (looksBinary(b)) {
          console.log("[anchor-path] skeleton via Bearer token");
          return b;
        }
        console.warn("[anchor-path] token 200 but non-binary body");
      } else {
        console.warn("[anchor-path] token fetch status", r.status);
      }
    } catch (e) {
      console.warn("[anchor-path] token fetch error", e);
    }
  }
  // 2) Fall back to neuroglancer's own auth-aware http source.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { kvStoreContext } = (viewer as any).dataSourceProvider
      .sharedKvStoreContext;
    const { fetchOkImpl, baseUrl } = getHttpSource(kvStoreContext, url);
    const resp = await fetchOkImpl(baseUrl);
    const b = await resp.arrayBuffer();
    if (looksBinary(b)) {
      console.log("[anchor-path] skeleton via getHttpSource");
      return b;
    }
    console.warn("[anchor-path] getHttpSource returned non-binary body");
  } catch (e) {
    console.warn("[anchor-path] getHttpSource fetch failed", e);
  }
  console.warn(
    `[anchor-path] skeleton fetch FAILED (${tokens.length} token(s) tried)`,
    plain,
  );
  return null;
}

// neuroglancer precomputed skeleton: u32 nv, u32 ne, then nv*3 f32 vertices
// (nm), then ne*2 u32 edges, then per-vertex attributes (ignored here).
function parseSkeleton(buf: ArrayBuffer): Skeleton | null {
  if (buf.byteLength < 8) return null;
  const dv = new DataView(buf);
  const nv = dv.getUint32(0, true);
  const ne = dv.getUint32(4, true);
  const vEnd = 8 + nv * 12;
  const eEnd = vEnd + ne * 8;
  if (nv === 0 || buf.byteLength < eEnd) return null;
  // slice() copies onto a fresh 0-aligned buffer so the typed-array views are
  // valid regardless of the source buffer's offset.
  const vertices = new Float32Array(buf.slice(8, vEnd));
  const edges = new Uint32Array(buf.slice(vEnd, eEnd));
  return { vertices, edges, nv };
}

function vertexNm(s: Skeleton, i: number): number[] {
  return [s.vertices[3 * i], s.vertices[3 * i + 1], s.vertices[3 * i + 2]];
}

function edgeLen(s: Skeleton, a: number, b: number): number {
  const v = s.vertices;
  const dx = v[3 * a] - v[3 * b];
  const dy = v[3 * a + 1] - v[3 * b + 1];
  const dz = v[3 * a + 2] - v[3 * b + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function nearestVertex(s: Skeleton, p: number[]): number {
  const v = s.vertices;
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < s.nv; i++) {
    const dx = v[3 * i] - p[0];
    const dy = v[3 * i + 1] - p[1];
    const dz = v[3 * i + 2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}

// Shortest path along the skeleton edges from the vertex nearest `aNm` (the
// entrance gate) to the vertex nearest `bNm`. Returns the inclusive polyline
// in nm, or null if the two ends are on disconnected components.
export function shortestPathNm(
  s: Skeleton,
  aNm: number[],
  bNm: number[],
): number[][] | null {
  const src = nearestVertex(s, aNm);
  const dst = nearestVertex(s, bNm);
  if (src === dst) return [vertexNm(s, src)];

  const adj: number[][] = Array.from({ length: s.nv }, () => [] as number[]);
  const ne = s.edges.length / 2;
  for (let i = 0; i < ne; i++) {
    const a = s.edges[2 * i];
    const b = s.edges[2 * i + 1];
    adj[a].push(b);
    adj[b].push(a);
  }

  const dist = new Float64Array(s.nv).fill(Infinity);
  const prev = new Int32Array(s.nv).fill(-1);
  dist[src] = 0;
  const heap = new MinHeap();
  heap.push(0, src);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (u === dst) break;
    if (d > dist[u]) continue;
    for (const w of adj[u]) {
      const nd = d + edgeLen(s, u, w);
      if (nd < dist[w]) {
        dist[w] = nd;
        prev[w] = u;
        heap.push(nd, w);
      }
    }
  }
  if (!isFinite(dist[dst])) return null;

  const idx: number[] = [];
  for (let u = dst; u !== -1; u = prev[u]) idx.push(u);
  idx.reverse();
  return idx.map((i) => vertexNm(s, i));
}

// Minimal binary min-heap of (priority, value) number pairs.
class MinHeap {
  private p: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.p.length;
  }
  push(pr: number, val: number): void {
    const { p, v } = this;
    p.push(pr);
    v.push(val);
    let i = p.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [p[par], p[i]] = [p[i], p[par]];
      [v[par], v[i]] = [v[i], v[par]];
      i = par;
    }
  }
  pop(): [number, number] {
    const { p, v } = this;
    const topP = p[0];
    const topV = v[0];
    const lastP = p.pop() as number;
    const lastV = v.pop() as number;
    if (p.length) {
      p[0] = lastP;
      v[0] = lastV;
      let i = 0;
      const n = p.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && p[l] < p[m]) m = l;
        if (r < n && p[r] < p[m]) m = r;
        if (m === i) break;
        [p[m], p[i]] = [p[i], p[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return [topP, topV];
  }
}
