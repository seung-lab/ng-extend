/**
 * EyeWire II Highlight mode: tint the SURFACE of meshes near marked paths.
 *
 * A cell is one colour (one uColor per object), and its mesh pieces do not
 * line up with "the stretch I checked". So the tint is geometric instead: the
 * app rasterises its marks into a small 3D texture (premultiplied RGBA, in
 * the viewer's global coordinates) and the mesh vertex shader samples it at
 * each vertex. No server ids, and it works on any mesh.
 */
import {NullarySignal} from 'neuroglancer/util/signal';
import {mat4} from 'neuroglancer/util/geom';
import {GL} from 'neuroglancer/webgl/context';

export interface NgeMeshTint {
  /** Premultiplied RGBA8, x fastest, then y, then z. */
  data: Uint8Array;
  dims: [number, number, number];
  /** Global (display) coordinates to texture coordinates in [0, 1]. */
  gridFromGlobal: mat4;
}

let current: NgeMeshTint|null = null;
let version = 0;
export const ngeMeshTintChanged = new NullarySignal();

export function setNgeMeshTint(tint: NgeMeshTint|null) {
  current = tint;
  version++;
  ngeMeshTintChanged.dispatch();
}
export function getNgeMeshTint() {
  return current;
}

const textures = new WeakMap<GL, {texture: WebGLTexture|null, version: number}>();

/** Bind the tint texture to `unit`, uploading it if it changed. False when
 *  there is nothing to tint. */
export function bindNgeMeshTint(gl: GL, unit: number): boolean {
  if (current === null) return false;
  let entry = textures.get(gl);
  if (entry === undefined) {
    entry = {texture: gl.createTexture(), version: -1};
    textures.set(gl, entry);
  }
  const T = WebGL2RenderingContext;
  gl.activeTexture(T.TEXTURE0 + unit);
  gl.bindTexture(T.TEXTURE_3D, entry.texture);
  if (entry.version !== version) {
    entry.version = version;
    const [w, h, d] = current.dims;
    gl.pixelStorei(T.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(T.TEXTURE_3D, T.TEXTURE_MIN_FILTER, T.LINEAR);
    gl.texParameteri(T.TEXTURE_3D, T.TEXTURE_MAG_FILTER, T.LINEAR);
    gl.texParameteri(T.TEXTURE_3D, T.TEXTURE_WRAP_S, T.CLAMP_TO_EDGE);
    gl.texParameteri(T.TEXTURE_3D, T.TEXTURE_WRAP_T, T.CLAMP_TO_EDGE);
    gl.texParameteri(T.TEXTURE_3D, T.TEXTURE_WRAP_R, T.CLAMP_TO_EDGE);
    gl.texImage3D(T.TEXTURE_3D, 0, T.RGBA8, w, h, d, 0, T.RGBA, T.UNSIGNED_BYTE, current.data);
  }
  return true;
}
