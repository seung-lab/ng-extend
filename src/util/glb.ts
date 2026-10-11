/**
 * Read one small model out of a .glb file, for the props drawn in the 3D view
 * (third_party/neuroglancer/perspective_view/nge_props.ts).
 *
 * Deliberately narrow: the first mesh, its first set of triangles, and its
 * colour texture. No skeleton, no animation, no other materials. The models
 * are made for this: a still pose
 * with one colour texture.
 *
 * The model is recentred and scaled so its height is 1, standing on y, so
 * the app can size and place any model the same way.
 */
import type {NgePropMesh} from 'neuroglancer/perspective_view/nge_props';

const COMPONENTS: Record<number, {bytes: number; read: (v: DataView, o: number) => number}> = {
  5121: {bytes: 1, read: (v, o) => v.getUint8(o)},
  5123: {bytes: 2, read: (v, o) => v.getUint16(o, true)},
  5125: {bytes: 4, read: (v, o) => v.getUint32(o, true)},
  5126: {bytes: 4, read: (v, o) => v.getFloat32(o, true)},
};
const WIDTH: Record<string, number> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};

export async function loadGlbModel(url: string): Promise<NgePropMesh> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model ${res.status}`);
  const file = await res.arrayBuffer();
  const head = new DataView(file);
  if (head.getUint32(0, true) !== 0x46546c67 || head.getUint32(4, true) !== 2) throw new Error('not a glTF 2 binary file');
  const jsonLength = head.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(file, 20, jsonLength)));
  const binStart = 20 + jsonLength + 8;
  const view = new DataView(file, binStart, head.getUint32(20 + jsonLength, true));

  const accessor = (index: number): {data: number[]; width: number} => {
    const a = gltf.accessors[index], bv = gltf.bufferViews[a.bufferView];
    const c = COMPONENTS[a.componentType], width = WIDTH[a.type];
    if (!c || !width) throw new Error('unsupported model data');
    const stride = bv.byteStride || c.bytes * width;
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const data = new Array<number>(a.count * width);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < width; k++) data[i * width + k] = c.read(view, start + i * stride + k * c.bytes);
    return {data, width};
  };

  const prim = gltf.meshes?.[0]?.primitives?.[0];
  if (!prim || (prim.mode ?? 4) !== 4 || prim.attributes?.POSITION == null) throw new Error('no triangles in the model');
  const positions = Float32Array.from(accessor(prim.attributes.POSITION).data);
  const count = positions.length / 3;
  const normals = prim.attributes.NORMAL != null ? Float32Array.from(accessor(prim.attributes.NORMAL).data) : new Float32Array(count * 3).fill(0);
  const uvs = prim.attributes.TEXCOORD_0 != null ? Float32Array.from(accessor(prim.attributes.TEXCOORD_0).data) : new Float32Array(count * 2);
  const indices = prim.indices != null ? Uint32Array.from(accessor(prim.indices).data) : Uint32Array.from({length: count}, (_, i) => i);

  // Height 1, centred, standing on y.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k], positions[i]); hi[k] = Math.max(hi[k], positions[i]); }
  const height = (hi[1] - lo[1]) || 1;
  for (let i = 0; i < positions.length; i++) { const k = i % 3; positions[i] = (positions[i] - (lo[k] + hi[k]) / 2) / height; }

  // The colour texture, or plain white.
  let image: TexImageSource;
  const material = gltf.materials?.[prim.material ?? 0];
  const tex = material?.pbrMetallicRoughness?.baseColorTexture;
  const source = tex != null ? gltf.images?.[gltf.textures?.[tex.index]?.source] : undefined;
  if (source?.bufferView != null) {
    const bv = gltf.bufferViews[source.bufferView];
    const blob = new Blob([new Uint8Array(file, binStart + (bv.byteOffset || 0), bv.byteLength)], {type: source.mimeType || 'image/jpeg'});
    image = await createImageBitmap(blob);
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 2, 2);
    image = canvas;
  }
  return {key: {}, positions, normals, uvs, indices, image};
}
