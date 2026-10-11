/**
 * EyeWire II props: small textured models drawn INSIDE the 3D view, so the
 * cells hide them and they hide what is behind them, like anything else in
 * the scene (Ames 2026-10-10: "is there no way to pin reaper to position so
 * that branches will still occlude?"). The first use is the Halloween ghost
 * in Lantern mode (src/util/spooky.ts).
 *
 * Neuroglancer has no way to draw a textured model, so this is a small one of
 * its own: one mesh, one colour texture, a head light, and a dissolve for
 * appearing and vanishing. It is drawn after the cells and the annotations,
 * with the depth test on. It writes no picking data, so a prop can never be
 * hovered or clicked, and a cell behind a see-through prop still can.
 *
 * A prop is drawn twice: first depth only, then colour where it is the
 * nearest surface. That is what lets a see-through prop look right from any
 * side without sorting its triangles.
 *
 * The app owns what is drawn and where (setNgeProps); this file only draws.
 */
import {GL} from 'neuroglancer/webgl/context';
import {mat4} from 'neuroglancer/util/geom';

export interface NgePropMesh {
  /** Any stable object: the GPU copy is kept against it. */
  key: object;
  /** xyz per vertex, in the model's own units. */
  positions: Float32Array;
  normals: Float32Array;
  /** uv per vertex, glTF convention (0,0 is the image's top left). */
  uvs: Float32Array;
  indices: Uint32Array;
  image: TexImageSource;
}

export interface NgeProp {
  mesh: NgePropMesh;
  /** Model units to the viewer's global coordinates. Model +z faces the eye. */
  modelMat: mat4;
  /** 0 to 1. */
  alpha: number;
  /** 0 = all there, 1 = gone. Eaten away in patches, with a lit edge. */
  dissolve: number;
  /** Changes the pattern of the dissolve, so two props do not match. */
  seed: number;
  /** Light the prop gives off itself, rgb 0..1: it stays visible in the dark. */
  glow: [number, number, number];
  /** Colour of the rim and of the dissolving edge. */
  rim: [number, number, number];
  /** How brightly its own colours are lit: 1 as painted, less for a figure
   *  that should stand in the dark as a shape with a lit edge. */
  shade: number;
}

let props: NgeProp[] = [];
export function setNgeProps(list: NgeProp[]) {
  props = list;
}
export function ngeHasProps() {
  return props.length > 0;
}

const VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uModelViewProjection;
out vec3 vNormal;
out vec3 vPosition;
out vec2 vUv;
void main() {
  gl_Position = uModelViewProjection * vec4(aPosition, 1.0);
  vNormal = aNormal;
  vPosition = aPosition;
  vUv = aUv;
}
`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPosition;
in vec2 vUv;
uniform sampler2D uTexture;
uniform vec4 uLook;      // alpha, dissolve, seed, depthOnly
uniform vec3 uGlow;
uniform vec3 uRim;
uniform float uShade;
layout(location = 0) out vec4 out_color;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// Smooth noise in 0..1: patches, not static.
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  float dissolve = uLook.y;
  // It goes from the bottom up, in patches.
  float n = 0.62 * noise(vPosition * 5.5 + uLook.z) + 0.38 * noise(vPosition * 13.0 - uLook.z) + 0.22 * (vPosition.y + 0.5);
  float edge = n / 1.22 - dissolve * 1.12 + 0.06;
  if (dissolve > 0.0 && edge < 0.0) discard;
  if (uLook.w > 0.5) { out_color = vec4(0.0); return; }
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;
  // A head light a little above and to the side of the eye (model +z faces the eye).
  float lit = 0.42 + 0.58 * max(dot(normal, normalize(vec3(0.3, 0.45, 1.0))), 0.0);
  vec3 color = texture(uTexture, vUv).rgb * lit * uShade + uGlow;
  float rim = pow(1.0 - clamp(abs(normal.z), 0.0, 1.0), 2.2);
  color += uRim * rim * 0.9;
  // the edge of what is left burns in the rim colour
  float burn = dissolve > 0.0 ? 1.0 - smoothstep(0.0, 0.07, edge) : 0.0;
  color = mix(color, uRim * 1.15, burn);
  out_color = vec4(min(color, vec3(1.0)), uLook.x);
}
`;

interface GpuMesh { vao: WebGLVertexArrayObject; texture: WebGLTexture; count: number; buffers: WebGLBuffer[]; }
interface GpuState {
  program: WebGLProgram|null;
  failed: boolean;
  uniforms: Record<string, WebGLUniformLocation|null>;
  meshes: WeakMap<object, GpuMesh>;
}
const states = new WeakMap<GL, GpuState>();

function build(gl: GL): GpuState {
  const state: GpuState = {program: null, failed: false, uniforms: {}, meshes: new WeakMap()};
  const T = WebGL2RenderingContext;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, T.COMPILE_STATUS)) {
      console.warn('[props] shader did not compile:', gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vs = compile(T.VERTEX_SHADER, VERTEX), fs = compile(T.FRAGMENT_SHADER, FRAGMENT);
  if (vs === null || fs === null) { state.failed = true; return state; }
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, T.LINK_STATUS)) {
    console.warn('[props] program did not link:', gl.getProgramInfoLog(program));
    state.failed = true;
    return state;
  }
  state.program = program;
  for (const name of ['uModelViewProjection', 'uTexture', 'uLook', 'uGlow', 'uRim', 'uShade']) {
    state.uniforms[name] = gl.getUniformLocation(program, name);
  }
  return state;
}

function upload(gl: GL, mesh: NgePropMesh): GpuMesh {
  const T = WebGL2RenderingContext;
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buffers: WebGLBuffer[] = [];
  const attribute = (location: number, data: Float32Array, size: number) => {
    const buffer = gl.createBuffer()!;
    buffers.push(buffer);
    gl.bindBuffer(T.ARRAY_BUFFER, buffer);
    gl.bufferData(T.ARRAY_BUFFER, data, T.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, T.FLOAT, false, 0, 0);
  };
  attribute(0, mesh.positions, 3);
  attribute(1, mesh.normals, 3);
  attribute(2, mesh.uvs, 2);
  const index = gl.createBuffer()!;
  buffers.push(index);
  gl.bindBuffer(T.ELEMENT_ARRAY_BUFFER, index);
  gl.bufferData(T.ELEMENT_ARRAY_BUFFER, mesh.indices, T.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(T.ARRAY_BUFFER, null);

  const texture = gl.createTexture()!;
  gl.activeTexture(T.TEXTURE0);
  gl.bindTexture(T.TEXTURE_2D, texture);
  gl.pixelStorei(T.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(T.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(T.TEXTURE_2D, 0, T.RGBA, T.RGBA, T.UNSIGNED_BYTE, mesh.image);
  gl.generateMipmap(T.TEXTURE_2D);
  gl.texParameteri(T.TEXTURE_2D, T.TEXTURE_MIN_FILTER, T.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(T.TEXTURE_2D, T.TEXTURE_MAG_FILTER, T.LINEAR);
  gl.texParameteri(T.TEXTURE_2D, T.TEXTURE_WRAP_S, T.REPEAT);
  gl.texParameteri(T.TEXTURE_2D, T.TEXTURE_WRAP_T, T.REPEAT);
  gl.bindTexture(T.TEXTURE_2D, null);
  return {vao, texture, count: mesh.indices.length, buffers};
}

const mvp = mat4.create();

/**
 * Draw the props into the colour buffer that is bound, against its depth.
 * The caller has switched picking output off, and puts the framebuffer's
 * draw buffers back afterwards. Everything else changed here is restored to
 * what the 3D view expects at this point: blending off, depth test LESS.
 */
export function drawNgeProps(gl: GL, viewProjectionMat: mat4) {
  if (props.length === 0) return;
  let state = states.get(gl);
  if (state === undefined) {
    state = build(gl);
    states.set(gl, state);
  }
  if (state.failed || state.program === null) return;
  const T = WebGL2RenderingContext;
  const u = state.uniforms;
  gl.useProgram(state.program);
  gl.activeTexture(T.TEXTURE0);
  gl.uniform1i(u.uTexture, 0);
  gl.enable(T.DEPTH_TEST);
  gl.depthMask(true);
  for (const prop of props) {
    if (prop.alpha <= 0 || prop.dissolve >= 1) continue;
    let gpu = state.meshes.get(prop.mesh.key);
    if (gpu === undefined) {
      gpu = upload(gl, prop.mesh);
      state.meshes.set(prop.mesh.key, gpu);
      gl.useProgram(state.program);
    }
    gl.bindVertexArray(gpu.vao);
    gl.bindTexture(T.TEXTURE_2D, gpu.texture);
    gl.uniformMatrix4fv(u.uModelViewProjection, false, mat4.multiply(mvp, viewProjectionMat, prop.modelMat));
    gl.uniform3f(u.uGlow, prop.glow[0], prop.glow[1], prop.glow[2]);
    gl.uniform3f(u.uRim, prop.rim[0], prop.rim[1], prop.rim[2]);
    gl.uniform1f(u.uShade, prop.shade);
    // 1. depth only: where the prop's nearest surface is
    gl.colorMask(false, false, false, false);
    gl.disable(T.BLEND);
    gl.depthFunc(T.LESS);
    gl.uniform4f(u.uLook, prop.alpha, prop.dissolve, prop.seed, 1);
    gl.drawElements(T.TRIANGLES, gpu.count, T.UNSIGNED_INT, 0);
    // 2. colour, only on that surface
    gl.colorMask(true, true, true, true);
    gl.enable(T.BLEND);
    gl.blendFunc(T.SRC_ALPHA, T.ONE_MINUS_SRC_ALPHA);
    gl.depthFunc(T.LEQUAL);
    gl.uniform4f(u.uLook, prop.alpha, prop.dissolve, prop.seed, 0);
    gl.drawElements(T.TRIANGLES, gpu.count, T.UNSIGNED_INT, 0);
  }
  gl.bindVertexArray(null);
  gl.bindTexture(T.TEXTURE_2D, null);
  gl.disable(T.BLEND);
  gl.depthFunc(T.LESS);
}
