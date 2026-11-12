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
  /** 0 = whole. Above 0 the prop is drawn as pieces flying apart and
   *  falling, further apart as it goes up (the Sandbox pumpkins smashed with
   *  the hammer, src/util/pumpkin.ts). Fade it out with alpha as it ends. */
  shatter?: number;
  /** Toward the eye, in the model's own axes, unit length. Leave it out for a
   *  prop that is turned to face the eye (model +z). A prop that turns its
   *  own way, like the Starship flying its route, passes it so its head light
   *  and rim follow the camera, not the model. */
  eye?: [number, number, number];
}

/** Glowing points (the Starship's engine trail): soft round sprites added
 *  onto the picture, hidden by anything in front of them, writing no depth
 *  and no picking. */
export interface NgeGlow {
  /** xyz per point, in the viewer's global coordinates. */
  positions: Float32Array;
  /** rgba per point, 0..1. Added, so dark means faint. */
  colors: Float32Array;
  /** Diameter per point, in nanometres. */
  sizesNm: Float32Array;
  count: number;
  /** One nanometre across the screen (toward the camera's right), in global
   *  coordinates: how the sprites get their size on screen. */
  nmRight: [number, number, number];
  /** Drawn through everything, with no depth test (Signal Controller's
   *  beacons on the cell bodies, seen behind the branches in front). */
  through?: boolean;
}
const glows = new Map<string, NgeGlow>();
export function setNgeGlow(glow: NgeGlow|null, group = 'starship') {
  if (glow && glow.count > 0) glows.set(group, glow); else glows.delete(group);
}
export function ngeHasGlow() {
  return glows.size > 0;
}

/** Each part of the app keeps its own list, so one clearing its props (the
 *  ghost leaving) does not take away another's (the Sandbox pumpkin). */
const groups = new Map<string, NgeProp[]>();
let props: NgeProp[] = [];
export function setNgeProps(list: NgeProp[], group = 'spooky') {
  if (list.length) groups.set(group, list); else groups.delete(group);
  props = ([] as NgeProp[]).concat(...groups.values());
}
export function ngeHasProps() {
  return props.length > 0;
}

const VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
// Centre of the triangle this vertex belongs to (the shatter copy only).
layout(location = 3) in vec3 aCentroid;
uniform mat4 uModelViewProjection;
uniform vec2 uShatter;   // amount 0..1, seed
out vec3 vNormal;
out vec3 vPosition;
out vec2 vUv;
float h3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
vec3 turn(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main() {
  vec3 p = aPosition;
  vec3 n = aNormal;
  if (uShatter.x > 0.0) {
    // Triangles are grouped into chunks by where they sit; each chunk flies
    // out from the middle, tumbles, and falls (model +y is up).
    float t = uShatter.x;
    vec3 cell = floor(aCentroid * 6.0);
    vec3 c = (cell + 0.5) / 6.0;
    float r1 = h3(cell + uShatter.y), r2 = h3(cell + 3.1 + uShatter.y), r3 = h3(cell + 7.7 + uShatter.y);
    vec3 dir = normalize(c + (vec3(r1, r2, r3) - 0.5) * 0.9 + vec3(0.0, 0.45, 0.0) + 1e-4);
    vec3 axis = normalize(vec3(r2, r3, r1) - 0.5 + 1e-4);
    float a = (r3 * 2.0 - 1.0) * 8.0 * t;
    p = c + turn(p - c, axis, a) + dir * (0.8 + 1.2 * r1) * t - vec3(0.0, 2.4 * t * t, 0.0);
    n = turn(n, axis, a);
  }
  gl_Position = uModelViewProjection * vec4(p, 1.0);
  vNormal = n;
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
uniform vec3 uEye;       // toward the eye, model axes
uniform vec3 uLight;     // the head light, model axes
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
  // A head light a little above and to the side of the eye (by default model
  // +z faces the eye; a prop that turns its own way passes its eye).
  float lit = 0.42 + 0.58 * max(dot(normal, uLight), 0.0);
  vec3 color = texture(uTexture, vUv).rgb * lit * uShade + uGlow;
  float rim = pow(1.0 - clamp(abs(dot(normal, uEye)), 0.0, 1.0), 2.2);
  color += uRim * rim * 0.9;
  // the edge of what is left burns in the rim colour
  float burn = dissolve > 0.0 ? 1.0 - smoothstep(0.0, 0.07, edge) : 0.0;
  color = mix(color, uRim * 1.15, burn);
  out_color = vec4(min(color, vec3(1.0)), uLook.x);
}
`;

interface GpuMesh { vao: WebGLVertexArrayObject; texture: WebGLTexture; count: number; buffers: WebGLBuffer[]; }
/** The shatter copy of a mesh: every triangle on its own three vertices, with
 *  its centre, so pieces can come apart. Made the first time a mesh shatters. */
const shardMeshes = new WeakMap<object, NgePropMesh & {centroids: Float32Array}>();
function shardsOf(mesh: NgePropMesh) {
  let shard = shardMeshes.get(mesh.key);
  if (shard !== undefined) return shard;
  const {positions: P, normals: N, uvs: U, indices: I} = mesh;
  const n = I.length;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  const centroids = new Float32Array(n * 3);
  for (let t = 0; t + 2 < n; t += 3) {
    const cx = (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3;
    const cy = (P[I[t] * 3 + 1] + P[I[t + 1] * 3 + 1] + P[I[t + 2] * 3 + 1]) / 3;
    const cz = (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3;
    for (let k = 0; k < 3; k++) {
      const v = I[t + k], o = t + k;
      positions.set(P.subarray(v * 3, v * 3 + 3), o * 3);
      normals.set(N.subarray(v * 3, v * 3 + 3), o * 3);
      uvs.set(U.subarray(v * 2, v * 2 + 2), o * 2);
      centroids[o * 3] = cx; centroids[o * 3 + 1] = cy; centroids[o * 3 + 2] = cz;
    }
  }
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  shard = {key: {}, positions, normals, uvs, indices, image: mesh.image, centroids};
  shardMeshes.set(mesh.key, shard);
  return shard;
}

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
  for (const name of ['uModelViewProjection', 'uTexture', 'uLook', 'uGlow', 'uRim', 'uShade', 'uShatter', 'uEye', 'uLight']) {
    state.uniforms[name] = gl.getUniformLocation(program, name);
  }
  return state;
}

function upload(gl: GL, mesh: NgePropMesh & {centroids?: Float32Array}): GpuMesh {
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
  if (mesh.centroids) attribute(3, mesh.centroids, 3);
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

/** The eye and head light in the model's axes: the default (model +z faces
 *  the eye, the light a little up and to the side), or the prop's own eye
 *  with the light lifted toward the model's up. */
function setEyeAndLight(gl: GL, u: Record<string, WebGLUniformLocation|null>, eye?: [number, number, number]) {
  if (!eye) {
    gl.uniform3f(u.uEye, 0, 0, 1);
    const n = Math.hypot(0.3, 0.45, 1);
    gl.uniform3f(u.uLight, 0.3 / n, 0.45 / n, 1 / n);
    return;
  }
  gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
  // up (model +y) with the part along the eye taken out, then a little of it added
  const along = eye[1];
  let lx = eye[0] - eye[0] * along * 0.45, ly = eye[1] + (1 - eye[1] * along) * 0.45, lz = eye[2] - eye[2] * along * 0.45;
  const n = Math.hypot(lx, ly, lz) || 1;
  gl.uniform3f(u.uLight, lx / n, ly / n, lz / n);
}

const GLOW_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSizeNm;
uniform mat4 uViewProjection;
uniform vec3 uNmRight;
uniform vec2 uViewport;
out vec4 vColor;
void main() {
  vec4 a = uViewProjection * vec4(aPosition, 1.0);
  vec4 b = uViewProjection * vec4(aPosition + uNmRight * aSizeNm, 1.0);
  gl_Position = a;
  float px = length((b.xy / b.w - a.xy / a.w) * uViewport * 0.5);
  gl_PointSize = clamp(px, 1.5, 96.0);
  vColor = aColor;
}
`;
const GLOW_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
layout(location = 0) out vec4 out_color;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d >= 1.0) discard;
  // a hot core and a soft halo
  float k = exp(-d * d * 5.0) * (1.0 - d * d);
  float a = vColor.a * k;
  out_color = vec4(vColor.rgb * a, a);
}
`;
interface GlowGpu { program: WebGLProgram|null; failed: boolean; vao: WebGLVertexArrayObject|null; buffers: WebGLBuffer[]; u: Record<string, WebGLUniformLocation|null>; }
const glowStates = new WeakMap<GL, GlowGpu>();
function buildGlow(gl: GL): GlowGpu {
  const T = WebGL2RenderingContext;
  const state: GlowGpu = {program: null, failed: true, vao: null, buffers: [], u: {}};
  const compile = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, T.COMPILE_STATUS)) { console.warn('[glow] shader did not compile:', gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const vs = compile(T.VERTEX_SHADER, GLOW_VERTEX), fs = compile(T.FRAGMENT_SHADER, GLOW_FRAGMENT);
  if (!vs || !fs) return state;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, T.LINK_STATUS)) { console.warn('[glow] program did not link:', gl.getProgramInfoLog(program)); return state; }
  state.program = program;
  for (const n of ['uViewProjection', 'uNmRight', 'uViewport']) state.u[n] = gl.getUniformLocation(program, n);
  state.vao = gl.createVertexArray();
  gl.bindVertexArray(state.vao);
  [[0, 3], [1, 4], [2, 1]].forEach(([loc, size]) => {
    const b = gl.createBuffer()!;
    state.buffers.push(b);
    gl.bindBuffer(T.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, T.FLOAT, false, 0, 0);
  });
  gl.bindVertexArray(null);
  gl.bindBuffer(T.ARRAY_BUFFER, null);
  state.failed = false;
  return state;
}

/**
 * Draw the glowing points into the colour buffer that is bound, after the
 * props: depth tested, no depth written, added onto what is there. The
 * caller has switched picking output off. Restores blending off and the
 * depth mask on.
 */
export function drawNgeGlow(gl: GL, viewProjectionMat: mat4) {
  if (glows.size === 0) return;
  let st = glowStates.get(gl);
  if (st === undefined) { st = buildGlow(gl); glowStates.set(gl, st); }
  if (st.failed || !st.program) return;
  const T = WebGL2RenderingContext;
  const vp = gl.getParameter(T.VIEWPORT) as Int32Array;
  gl.useProgram(st.program);
  gl.uniformMatrix4fv(st.u.uViewProjection, false, viewProjectionMat);
  gl.uniform2f(st.u.uViewport, vp[2], vp[3]);
  gl.enable(T.DEPTH_TEST);
  gl.depthFunc(T.LEQUAL);
  gl.depthMask(false);
  gl.enable(T.BLEND);
  gl.blendFuncSeparate(T.ONE, T.ONE, T.ONE, T.ONE);
  gl.bindVertexArray(st.vao);
  for (const g of glows.values()) {
    if (g.through) gl.disable(T.DEPTH_TEST); else gl.enable(T.DEPTH_TEST);
    gl.uniform3f(st.u.uNmRight, g.nmRight[0], g.nmRight[1], g.nmRight[2]);
    gl.bindBuffer(T.ARRAY_BUFFER, st.buffers[0]);
    gl.bufferData(T.ARRAY_BUFFER, g.positions.subarray(0, g.count * 3), T.DYNAMIC_DRAW);
    gl.bindBuffer(T.ARRAY_BUFFER, st.buffers[1]);
    gl.bufferData(T.ARRAY_BUFFER, g.colors.subarray(0, g.count * 4), T.DYNAMIC_DRAW);
    gl.bindBuffer(T.ARRAY_BUFFER, st.buffers[2]);
    gl.bufferData(T.ARRAY_BUFFER, g.sizesNm.subarray(0, g.count), T.DYNAMIC_DRAW);
    gl.drawArrays(T.POINTS, 0, g.count);
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(T.ARRAY_BUFFER, null);
  gl.enable(T.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(T.BLEND);
  gl.blendFunc(T.SRC_ALPHA, T.ONE_MINUS_SRC_ALPHA);
  gl.depthFunc(T.LESS);
}

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
    const shatter = prop.shatter ?? 0;
    const mesh = shatter > 0 ? shardsOf(prop.mesh) : prop.mesh;
    let gpu = state.meshes.get(mesh.key);
    if (gpu === undefined) {
      gpu = upload(gl, mesh);
      state.meshes.set(mesh.key, gpu);
      gl.useProgram(state.program);
    }
    gl.uniform2f(u.uShatter, shatter, prop.seed * 13.0);
    gl.bindVertexArray(gpu.vao);
    gl.bindTexture(T.TEXTURE_2D, gpu.texture);
    gl.uniformMatrix4fv(u.uModelViewProjection, false, mat4.multiply(mvp, viewProjectionMat, prop.modelMat));
    gl.uniform3f(u.uGlow, prop.glow[0], prop.glow[1], prop.glow[2]);
    gl.uniform3f(u.uRim, prop.rim[0], prop.rim[1], prop.rim[2]);
    gl.uniform1f(u.uShade, prop.shade);
    setEyeAndLight(gl, u, prop.eye);
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
