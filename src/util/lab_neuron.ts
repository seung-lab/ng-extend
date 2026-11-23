/**
 * A real neuron turning slowly behind the lab meeting preview (Ames
 * 2026-11-22: "Need a neuron rotating in the background").
 *
 * The cell is the MICrONS pyramidal cell the tutorial's mini volume already
 * ships (static/mini-volume: cell.bin, meta.json), drawn as a glowing
 * hologram: the edges of each branch light up in the scene's colors, the
 * insides stay faint, and overlapping branches add up. WebGL 1, one draw call.
 */
export interface NeuronLayer {
  /** angle in radians; colors 0..255; alpha 0..1. */
  /** shift: sideways, in half widths of the canvas. */
  draw(angle: number, a: [number, number, number], b: [number, number, number], alpha: number, shift?: number): void;
  resize(): void;
  dispose(): void;
}

const VS = `
attribute vec3 aPos; attribute vec3 aNrm;
uniform float uAng; uniform float uAspect; uniform float uScale; uniform float uShift;
varying vec3 vN; varying float vY;
void main() {
  float c = cos(uAng), s = sin(uAng);
  // Turn about the cell's long axis, then tip it a little toward us.
  vec3 p = vec3(c * aPos.x + s * aPos.z, aPos.y, -s * aPos.x + c * aPos.z);
  vec3 n = vec3(c * aNrm.x + s * aNrm.z, aNrm.y, -s * aNrm.x + c * aNrm.z);
  float t = 0.18, ct = cos(t), st = sin(t);
  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  n = vec3(n.x, ct * n.y - st * n.z, st * n.y + ct * n.z);
  vN = n; vY = p.y;
  float persp = 1.0 / (1.0 + p.z * 0.35);
  gl_Position = vec4(p.x * uScale * persp / uAspect + uShift, p.y * uScale * persp, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
uniform vec3 uA; uniform vec3 uB; uniform float uAlpha;
varying vec3 vN; varying float vY;
void main() {
  vec3 n = normalize(vN);
  float rim = 1.0 - abs(n.z);
  float glow = 0.08 + pow(rim, 2.2) * 0.9;
  vec3 col = mix(uA, uB, clamp(vY * 0.9 + 0.5, 0.0, 1.0));
  col = mix(col, vec3(1.0), pow(rim, 6.0) * 0.35);
  gl_FragColor = vec4(col * glow * uAlpha, 1.0);
}`;

interface Cell { nv: number; nf: number; pos: Float32Array; idx: Uint16Array; soma: [number, number, number]; }
let cellPromise: Promise<Cell> | null = null;
/** The mesh, read once: micrometers centered on the cell's middle, y flipped
 *  so the pia is up, scaled so the cell's tallest side spans -1..1. */
function loadCell(): Promise<Cell> {
  return cellPromise ??= (async () => {
    const [meta, bin] = await Promise.all([
      fetch('mini-volume/meta.json').then(r => r.json()),
      fetch('mini-volume/cell.bin').then(r => { if (!r.ok) throw new Error(`cell ${r.status}`); return r.arrayBuffer(); }),
    ]);
    const nv: number = meta.cell.verts, nf: number = meta.cell.faces;
    const lo: number[] = meta.cell.lo, hi: number[] = meta.cell.hi;
    const q = new Uint16Array(bin, 0, nv * 3);
    const idx = new Uint16Array(bin.slice(nv * 6, nv * 6 + nf * 6));
    const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const k = 2 / Math.max(...span);
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      pos[i * 3] = (lo[0] + q[i * 3] / 65535 * span[0] - mid[0]) * k;
      pos[i * 3 + 1] = -(lo[1] + q[i * 3 + 1] / 65535 * span[1] - mid[1]) * k;
      pos[i * 3 + 2] = (lo[2] + q[i * 3 + 2] / 65535 * span[2] - mid[2]) * k;
    }
    const s: number[] = meta.soma;
    const soma: [number, number, number] = [(s[0] - mid[0]) * k, -(s[1] - mid[1]) * k, (s[2] - mid[2]) * k];
    return { nv, nf, pos, idx, soma };
  })();
}

/** n points on the real neuron's surface, spread evenly over it and ordered
 *  from the soma outward, so lighting them in order grows the cell. Each is
 *  x, y, z in the same space the layer draws. */
export async function loadNeuronPoints(n: number): Promise<Float32Array> {
  const { nv, pos, soma } = await loadCell();
  // Every k-th vertex after a fixed shuffle spreads them over the whole cell.
  const order = Array.from({ length: nv }, (_, i) => i);
  let a = 12345;
  for (let i = nv - 1; i > 0; i--) { a = (a * 1103515245 + 12345) >>> 0; const j = a % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const pick = order.slice(0, Math.min(n, nv)).map(i => {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    return { x, y, z, d: Math.hypot(x - soma[0], y - soma[1], z - soma[2]) };
  }).sort((p, q) => p.d - q.d);
  const out = new Float32Array(pick.length * 3);
  pick.forEach((p, i) => { out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; });
  return out;
}

/** Where the layer puts a point, in 0..1 of its canvas (same turn and tilt as the shader). */
export function projectNeuron(x: number, y: number, z: number, ang: number, aspect: number, shift = 0): [number, number, number] {
  const c = Math.cos(ang), s = Math.sin(ang);
  let px = c * x + s * z, py = y, pz = -s * x + c * z;
  const t = 0.18, ct = Math.cos(t), st = Math.sin(t);
  const qy = ct * py - st * pz, qz = st * py + ct * pz;
  py = qy; pz = qz;
  const persp = 1 / (1 + pz * 0.35);
  return [0.5 + (px * 0.92 * persp / aspect + shift) * 0.5, 0.5 - py * 0.92 * persp * 0.5, pz];
}

export async function createNeuronLayer(cv: HTMLCanvasElement): Promise<NeuronLayer | null> {
  const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;
  const { nv, nf, pos, idx } = await loadCell();
  const nrm = new Float32Array(nv * 3);
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const j of [a, b, c]) { nrm[j] += nx; nrm[j + 1] += ny; nrm[j + 2] += nz; }
  }

  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
  gl.useProgram(prog);
  const attr = (name: string, data: Float32Array) => {
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
  };
  attr('aPos', pos); attr('aNrm', nrm);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const uShift = U('uShift'), uAng = U('uAng'), uAspect = U('uAspect'), uScale = U('uScale'), uA = U('uA'), uB = U('uB'), uAlpha = U('uAlpha');
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  const layer: NeuronLayer = {
    resize() {
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
    },
    draw(angle, a, b, alpha, shift = 0) {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (alpha <= 0.001) return;
      gl.uniform1f(uAng, angle);
      gl.uniform1f(uShift, shift);
      gl.uniform1f(uAspect, cv.width / Math.max(1, cv.height));
      gl.uniform1f(uScale, 0.92);
      gl.uniform3f(uA, a[0] / 255, a[1] / 255, a[2] / 255);
      gl.uniform3f(uB, b[0] / 255, b[1] / 255, b[2] / 255);
      gl.uniform1f(uAlpha, alpha);
      gl.drawElements(gl.TRIANGLES, nf * 3, gl.UNSIGNED_SHORT, 0);
    },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
  layer.resize();
  return layer;
}
