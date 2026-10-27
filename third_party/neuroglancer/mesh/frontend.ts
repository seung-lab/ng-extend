/**
 * @license
 * Copyright 2016 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {NgeShell} from 'neuroglancer/mesh/nge_hover';
import {bindNgeMeshTint, getNgeMeshTint, bindNgeMeshTintFine, getNgeMeshTintFine} from 'neuroglancer/mesh/nge_tint';
import {bindNgeLanternMask, getNgeLantern, getNgeLanternSecond, ngeLanternNmFromModel, ngeLanternPositionNm} from 'neuroglancer/mesh/nge_lantern';
import {getNgeMeshEdge} from 'neuroglancer/mesh/nge_edge';
import {ChunkState} from 'neuroglancer/chunk_manager/base';
import {Chunk, ChunkManager, ChunkSource} from 'neuroglancer/chunk_manager/frontend';
import {VisibleLayerInfo} from 'neuroglancer/layer';
import {EncodedMeshData, FRAGMENT_SOURCE_RPC_ID, MESH_LAYER_RPC_ID, MULTISCALE_FRAGMENT_SOURCE_RPC_ID, MULTISCALE_MESH_LAYER_RPC_ID, MultiscaleFragmentFormat, VertexPositionFormat} from 'neuroglancer/mesh/base';
import {getMultiscaleChunksToDraw, getMultiscaleFragmentKey, MultiscaleMeshManifest, validateOctree} from 'neuroglancer/mesh/multiscale';
import {PerspectivePanel} from 'neuroglancer/perspective_view/panel';
import {PerspectiveViewReadyRenderContext, PerspectiveViewRenderContext, PerspectiveViewRenderLayer} from 'neuroglancer/perspective_view/render_layer';
import {ThreeDimensionalRenderLayerAttachmentState, update3dRenderLayerAttachment} from 'neuroglancer/renderlayer';
import {forEachVisibleSegment, getObjectKey} from 'neuroglancer/segmentation_display_state/base';
import {forEachVisibleSegmentToDraw, ngeHaloFar, ngeHoverStyle, ngeListHover, ngePulseColor, registerRedrawWhenSegmentationDisplayState3DChanged, SegmentationDisplayState3D, SegmentationLayerSharedObject} from 'neuroglancer/segmentation_display_state/frontend';
import {makeCachedDerivedWatchableValue, WatchableValueInterface} from 'neuroglancer/trackable_value';
import {Borrowed, RefCounted} from 'neuroglancer/util/disposable';
import {getFrustrumPlanes, mat3, mat3FromMat4, mat4, scaleMat3Output, vec3, vec4} from 'neuroglancer/util/geom';
import * as matrix from 'neuroglancer/util/matrix';
import {Uint64} from 'neuroglancer/util/uint64';
import {Buffer} from 'neuroglancer/webgl/buffer';
import {GL} from 'neuroglancer/webgl/context';
import {parameterizedEmitterDependentShaderGetter} from 'neuroglancer/webgl/dynamic_shader';
import {ShaderBuilder, ShaderProgram} from 'neuroglancer/webgl/shader';
import {registerSharedObjectOwner, RPC} from 'neuroglancer/worker_rpc';

const tempMat4 = mat4.create();
const tempMat3 = mat3.create();

// To validate the octrees and to determine the multiscale fragment responsible for each framebuffer
// location, set `DEBUG_MULTISCALE_FRAGMENTS=true` and also set `DEBUG_PICKING=true` in
// `src/neuroglancer/object_picking.ts`.
const DEBUG_MULTISCALE_FRAGMENTS = false;

function copyMeshDataToGpu(gl: GL, chunk: FragmentChunk|MultiscaleFragmentChunk) {
  chunk.vertexBuffer =
      Buffer.fromData(gl, chunk.meshData.vertexPositions, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
  chunk.indexBuffer =
      Buffer.fromData(gl, chunk.meshData.indices, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
  chunk.normalBuffer =
      Buffer.fromData(gl, chunk.meshData.vertexNormals, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
}

function freeGpuMeshData(chunk: FragmentChunk|MultiscaleFragmentChunk) {
  chunk.vertexBuffer.dispose();
  chunk.indexBuffer.dispose();
  chunk.normalBuffer.dispose();
}

/**
 * Decodes normal vectors in 2xSnorm8 octahedron encoding into normalized 3x32f vector.
 *
 * Zina H. Cigolle, Sam Donow, Daniel Evangelakos, Michael Mara, Morgan McGuire, and Quirin Meyer,
 * Survey of Efficient Representations for Independent Unit Vectors, Journal of Computer Graphics
 * Techniques (JCGT), vol. 3, no. 2, 1-30, 2014
 *
 * Available online http://jcgt.org/published/0003/02/01/
 */
const glsl_decodeNormalOctahedronSnorm8 = `
highp vec3 decodeNormalOctahedronSnorm8(highp vec2 e) {
  vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) v.xy = (1.0 - abs(v.yx)) * vec2(v.x > 0.0 ? 1.0 : -1.0, v.y > 0.0 ? 1.0 : -1.0);
  return normalize(v);
}
`;

function decodeSnorm8(x: number) {
  if (x >= 128) {
    x = x - 256;
  }
  return Math.max(-1, x / 127);
}

/**
 * Javascript implementation of normal decoding, for debugging.
 */
export function decodeNormalOctahedronSnorm8(normals: Uint8Array) {
  let n = normals.length;
  n -= 1;
  let out = new Float32Array(Math.floor(normals.length / 2) * 3);
  let outIndex = 0;
  for (let i = 0; i < n; i += 2) {
    const e0 = decodeSnorm8(normals[i]);
    const e1 = decodeSnorm8(normals[i + 1]);
    let v0 = e0;
    let v1 = e1;
    let v2 = 1.0 - Math.abs(e0) - Math.abs(e1);
    if (v2 < 0) {
      v0 = (1 - Math.abs(v1)) * (v0 > 0 ? 1 : -1);
      v1 = (1 - Math.abs(v0)) * (v1 > 0 ? 1 : -1);
    }
    const len = Math.sqrt(v0 ** 2 + v1 ** 2 + v2 ** 2);
    out[outIndex] = v0 / len;
    out[outIndex + 1] = v1 / len;
    out[outIndex + 2] = v2 / len;
    outIndex += 3;
  }
  return out;
}

interface VertexPositionFormatHandler {
  defineShader: (builder: ShaderBuilder) => void;
  bind:
      (gl: GL, shader: ShaderProgram, fragmentChunk: FragmentChunk|MultiscaleFragmentChunk) => void;
  endLayer: (gl: GL, shader: ShaderProgram) => void;
}

function getFloatPositionHandler(glAttributeType: number): VertexPositionFormatHandler {
  return {
    defineShader: (builder: ShaderBuilder) => {
      builder.addAttribute('highp vec3', 'aVertexPosition');
      builder.addVertexCode(`highp vec3 getVertexPosition() { return aVertexPosition; }`);
    },
    bind(_gl: GL, shader: ShaderProgram, fragmentChunk: FragmentChunk|MultiscaleFragmentChunk) {
      fragmentChunk.vertexBuffer.bindToVertexAttrib(
          shader.attribute('aVertexPosition'),
          /*components=*/ 3, glAttributeType, /* normalized=*/ true);
    },
    endLayer: (gl: GL, shader: ShaderProgram) => {
      gl.disableVertexAttribArray(shader.attribute('aVertexPosition'));
    }
  };
}

const vertexPositionHandlers: {[format: number]: VertexPositionFormatHandler} = {
  [VertexPositionFormat.float32]: getFloatPositionHandler(WebGL2RenderingContext.FLOAT),
  [VertexPositionFormat.uint16]: getFloatPositionHandler(WebGL2RenderingContext.UNSIGNED_SHORT),
  [VertexPositionFormat.uint10]: {
    defineShader: (builder: ShaderBuilder) => {
      builder.addAttribute('highp uint', 'aVertexPosition');
      builder.addVertexCode(`
highp vec3 getVertexPosition() {
  return vec3(float(aVertexPosition & 1023u),
              float((aVertexPosition >> 10) & 1023u),
              float((aVertexPosition >> 20) & 1023u)) / 1023.0;
}
`);
    },
    bind(_gl: GL, shader: ShaderProgram, fragmentChunk: FragmentChunk|MultiscaleFragmentChunk) {
      fragmentChunk.vertexBuffer.bindToVertexAttribI(
          shader.attribute('aVertexPosition'),
          /*components=*/ 1, WebGL2RenderingContext.UNSIGNED_INT);
    },
    endLayer: (gl: GL, shader: ShaderProgram) => {
      gl.disableVertexAttribArray(shader.attribute('aVertexPosition'));
    }
  },
};

// EyeWire II Highlight mode: meshes near a marked path take its colour
// (mesh/nge_tint.ts).
const ngeTintSamplerSymbol = Symbol('ngeMeshTint');
const ngeTintMat = mat4.create();
const ngeFineSamplerSymbol = Symbol('ngeMeshTintFine');
const ngeFineMat = mat4.create();
// EyeWire II Lantern mode: the cell is lit around where you are, and left in
// shadow elsewhere (mesh/nge_lantern.ts).
const ngeLanternMat = mat4.create();
// Its "Clicked branch": a map of the branch that is lit.
const ngeLanternMaskSymbol = Symbol('ngeLanternMask');
const ngeLanternMaskMat = mat4.create();
// The edge of the dataset in the Hunt (mesh/nge_edge.ts): model to nanometres.
const ngeEdgeMat = mat4.create();

// ── EyeWire II hover effects (ngeHoverStyle, wolfryder101 #181) ─────────────
/** How far behind the cell its outline and halo shells sit, in clip space
 *  (times w), so the cell's own surface always wins inside it. */
const NGE_SHELL_DEPTH_BIAS = 0.004;
/** The step along the surface normal, in model units, used to find which way
 *  "outward" points on screen. Only its direction matters. */
const NGE_SHELL_NORMAL_STEP = 20;
const ngeShellColor = new Float32Array(4);
/** The rim colour: a light tint of the cell's own colour. */
/** The hologram's colour: the pulse colour if one is chosen, else cyan. */
function ngeHoloRgb(): ArrayLike<number> {
  return ngePulseColor.value ?? NGE_HOLO_CYAN;
}
const NGE_HOLO_CYAN = [0.36, 0.86, 1.0];
function ngeShellColorFor(color: Float32Array|number[], alpha: number) {
  const a = color[3] || 1;
  const rgb = ngeHoverStyle.value === 'hologram' ? ngeHoloRgb() : ngeGlowColor(color);
  // Times alpha: the halo keeps the brightest shell at each pixel (MAX blending).
  // It does not breathe (Ames 2026-10-20: "I don't like the breathing").
  const fade = ngeHoverStyle.value === 'halo' ? ngeHaloFade : 1;
  for (let i = 0; i < 3; i++) ngeShellColor[i] = rgb[i] * alpha * fade * a;
  ngeShellColor[3] = alpha;
  return ngeShellColor;
}
const ngeGlowRgb = new Float32Array(3);
/** The glow's colour: the cell's own hue at full brightness, a little toward
 *  white, so a dark blue cell glows bright blue rather than a dim line. */
function ngeGlowColor(color: Float32Array|number[]) {
  const a = color[3] || 1;
  const max = Math.max(color[0], color[1], color[2]) / a || 1;
  for (let i = 0; i < 3; i++) ngeGlowRgb[i] = Math.min(1, (color[i] / a / max) * 0.8 + 0.2);
  return ngeGlowRgb;
}
let ngePulseRunning = false;
/** How much of the halo to draw at this zoom, 0.3 to 1 (Ames 2026-10-20:
 *  "looks good up close but far away too thick"). Set per frame from how
 *  many pixels a 1 um branch covers: full from about 12 px up. */
let ngeHaloZoom = 1;
let ngeHaloFade = 1;
let ngeHoloStepNm = 64;
function ngeUpdateHaloZoom(projectionParameters: any) {
  const viewer: any = (window as any).viewer;
  const info = projectionParameters.displayDimensionRenderInfo;
  let minNm = Infinity;
  for (let i = 0; i < 3; i++) minNm = Math.min(minNm, (info.displayDimensionScales[i] || 1e-9) * 1e9);
  const viewNm = Math.max(1, (viewer?.projectionScale?.value ?? 1000) * minNm);
  const branchPx = 1000 / (viewNm / Math.max(1, projectionParameters.height));
  ngeHaloZoom = Math.max(0.3, Math.min(1, branchPx / 12));
  // And fainter: thinner alone still left every spine outlined far out (Ames
  // 2026-10-20: "still looks too heavy when I am zoomed out").
  // Gone when a branch is about 3 px across, where Saturate's colour takes over.
  ngeHaloFade = Math.max(0, Math.min(1, (branchPx - 3) / 14));
  ngeHaloFar.value = 1 - ngeHaloFade;
  // The hologram's dots: about 14 px apart, in power of two steps of nm.
  ngeHoloStepNm = Math.pow(2, Math.round(Math.log2(Math.max(1, 14 * viewNm / Math.max(1, projectionParameters.height)))));
}
/** The main pass's hover mode for the cell under the mouse: 1 the pulse,
 *  2 the halo's rim of light on the cell's own edges (colour in uNgeRim). */
let ngeRimGl: {gl: GL, shader: ShaderProgram}|null = null;
function ngeHoverGlowMode(color: Float32Array|number[]) {
  const style = ngeHoverStyle.value;
  if ((style === 'hologram' || style === 'metallic') && ngeRimGl) {
    // Metallic glows in a light tint of the cell's own colour; the hologram
    // is one colour of light, whatever the cell's.
    const rgb = style === 'hologram' ? ngeHoloRgb() : ngeGlowColor(color);
    ngeRimGl.gl.uniform4f(ngeRimGl.shader.uniform('uNgeRim'), rgb[0], rgb[1], rgb[2], 1);
    return style === 'metallic' ? 6 : 5;
  }
  // Pulse, pointed at from a list: no mouse in 3D to start a ring from.
  if ((style === 'saturate' || (style === 'pulse' && ngeListHover.value)) && ngeRimGl) {
    ngeRimGl.gl.uniform4f(ngeRimGl.shader.uniform('uNgeRim'), 0, 0, 0, 0.25);
    return 4;
  }
  if (style === 'spotlight' && ngeRimGl) {
    // Only a touch of light from within: the dimmed cells around do the rest.
    ngeRimGl.gl.uniform4f(ngeRimGl.shader.uniform('uNgeRim'), 0, 0, 0, 0.12);
    return 4;
  }
  if (style === 'halo' && ngeRimGl) {
    const rgb = ngeGlowColor(color);
    ngeRimGl.gl.uniform4f(ngeRimGl.shader.uniform('uNgeRim'), rgb[0], rgb[1], rgb[2], ngeHaloFade);
    return 2;
  }
  return 0;
}
let ngePulseKey = '', ngePulseSeenAt = 0;
const ngePulseCenter = new Float32Array(3);
const ngePulseScale = new Float32Array(3);
let ngePulseViewNm = 1000;
let ngeMouseActive = false;
/** Per frame: where the mouse is over the 3D view, and how far out it is
 *  zoomed, which sets the pulse's speed and band width. */
function ngePulsePrepare(projectionParameters: any) {
  const viewer: any = (window as any).viewer;
  const info = projectionParameters.displayDimensionRenderInfo;
  const mouse = viewer?.mouseState;
  // Over the 3D view or not: a pulse stops when the mouse leaves it (Ames:
  // "keeps pulsing ... even after I move hover"), though neuroglancer keeps
  // the last cell as the hovered one.
  ngeMouseActive = !!mouse?.active;
  if (mouse?.active && mouse.position) {
    for (let i = 0; i < 3; i++) {
      const d = info.displayDimensionIndices[i];
      if (d >= 0) ngePulseCenter[i] = mouse.position[d];
    }
  }
  let minNm = Infinity;
  for (let i = 0; i < 3; i++) {
    ngePulseScale[i] = (info.displayDimensionScales[i] || 1e-9) * 1e9;
    minNm = Math.min(minNm, ngePulseScale[i]);
  }
  ngePulseViewNm = Math.max(1, (viewer?.projectionScale?.value ?? 1000) * minNm);
}

// ── The P key: one ring of light from the mouse along the cell under it ─────
// (Ames 2026-10-20: "maybe we need a hot key to make the cell pulse"). It
// works with any 3D Hover look; the cell is the one under the mouse when the
// next frame is drawn.
const NGE_BURST_MS = 2200;
const ngeBurst = {pending: false, key: '', t0: -1e9, center: new Float32Array(3)};
export function ngeFirePulse() {
  ngeBurst.pending = true;
  ngeBurst.key = '';
  ngeBurst.t0 = performance.now();
  ngeBurst.center.set(ngePulseCenter);
}
function ngeSetPulse(gl: GL, shader: ShaderProgram, center: Float32Array, travelledNm: number, periodNm: number, strength: number) {
  gl.uniform3fv(shader.uniform('uNgePulseCenter'), center);
  // .w is on and how strong (fading out as the ring spreads).
  gl.uniform4f(shader.uniform('uNgePulse'), travelledNm, ngePulseViewNm * 0.025, periodNm, 1 + strength);
  const pc = ngePulseColor.value;
  gl.uniform4f(shader.uniform('uNgePulseColor'), pc?.[0] ?? 0, pc?.[1] ?? 0, pc?.[2] ?? 0, pc ? 1 : 0);
}
/** For one cell: is it pulsing? Sets the pulse for it and returns 1, else 0.
 *  The Pulse look sends one ring when the mouse comes onto a cell, the same
 *  ring as the P key (Ames 2026-10-20: "it still won't stop pulsing": it
 *  used to repeat for as long as the mouse stayed). */
function ngePulseFor(gl: GL, shader: ShaderProgram, key: string, hovered: boolean): number {
  const now = performance.now();
  if (ngeHoverStyle.value === 'pulse' && hovered && ngeMouseActive) {
    // A new cell under the mouse (or the same one after the mouse was away).
    if (key !== ngePulseKey || now - ngePulseSeenAt > 400) {
      ngeBurst.pending = false;
      ngeBurst.key = key;
      ngeBurst.t0 = now;
      ngeBurst.center.set(ngePulseCenter);
    }
    ngePulseKey = key;
    ngePulseSeenAt = now;
  }
  // P pressed with no cell under the mouse: nothing, not the next cell later.
  if (ngeBurst.pending && now - ngeBurst.t0 > 300) ngeBurst.pending = false;
  if (ngeBurst.pending && hovered) {
    ngeBurst.pending = false;
    ngeBurst.key = key;
  }
  if (ngeBurst.key !== key) return 0;
  const age = now - ngeBurst.t0;
  if (age < NGE_BURST_MS) {
    // One ring, spreading out and fading: the period is longer than anything
    // on screen.
    ngeSetPulse(gl, shader, ngeBurst.center, (age / 1000) * ngePulseViewNm * 0.6, ngePulseViewNm * 20,
                1 - age / NGE_BURST_MS);
    ngePulseRunning = true;
    return 1;
  }
  // Just finished: one more frame, drawn without it.
  if (ngeBurst.key !== '') {
    ngeBurst.key = '';
    ngePulseRunning = true;
  }
  return 0;
}
const ngeLanternPos = new Float32Array(3);

export class MeshShaderManager {
  private tempLightVec = new Float32Array(4);
  private vertexPositionHandler = vertexPositionHandlers[this.vertexPositionFormat];
  constructor(
      public fragmentRelativeVertices: boolean, public vertexPositionFormat: VertexPositionFormat) {
  }

  beginLayer(
      gl: GL, shader: ShaderProgram, renderContext: PerspectiveViewRenderContext,
      displayState: MeshDisplayState) {
    let {lightDirection, ambientLighting, directionalLighting} = renderContext;
    let lightVec = <vec3>this.tempLightVec;
    vec3.scale(lightVec, lightDirection, directionalLighting);
    lightVec[3] = ambientLighting;
    gl.uniform4fv(shader.uniform('uLightDirection'), lightVec);
    // EyeWire II hover effects: off unless a pass turns them on.
    gl.uniform4f(shader.uniform('uNgeShell'), 0, 0, 0, 0);
    gl.uniform1f(shader.uniform('uNgeGlow'), 0);
    ngeRimGl = {gl, shader};
    const {projectionParameters} = renderContext;
    ngeUpdateHaloZoom(projectionParameters);
    gl.uniform1f(shader.uniform('uNgeHoloStep'), ngeHoloStepNm);
    gl.uniform2f(shader.uniform('uNgeViewport'), projectionParameters.width, projectionParameters.height);
    ngePulsePrepare(projectionParameters);
    gl.uniform3fv(shader.uniform('uNgePulseScale'), ngePulseScale);
    gl.uniform4f(shader.uniform('uNgePulse'), 0, 1, 1, 0);
    const silhouetteRendering = displayState.silhouetteRendering.value;
    if (silhouetteRendering > 0) {
      gl.uniform1f(shader.uniform('uSilhouettePower'), silhouetteRendering);
    }
  }

  setColor(gl: GL, shader: ShaderProgram, color: vec4) {
    gl.uniform4fv(shader.uniform('uColor'), color);
  }

  /** EyeWire II hover pulse (ngeHoverStyle 'pulse'): on for the cell under the mouse. */
  setGlow(gl: GL, shader: ShaderProgram, glow: number) {
    gl.uniform1f(shader.uniform('uNgeGlow'), glow);
  }

  /** EyeWire II hover outline and halo: one shell of the cell, `widthPx` out
   *  from its edge on screen, in `color`. Width 0 draws the cell itself. */
  setShell(gl: GL, shader: ShaderProgram, widthPx: number, color?: Float32Array|number[]) {
    // Thinner when zoomed out (ngeHaloZoom).
    gl.uniform4f(shader.uniform('uNgeShell'), widthPx * ngeHaloZoom, NGE_SHELL_DEPTH_BIAS, NGE_SHELL_NORMAL_STEP, 1);
    if (color) gl.uniform4fv(shader.uniform('uNgeShellColor'), color);
  }

  setPickID(gl: GL, shader: ShaderProgram, pickID: number) {
    gl.uniform1ui(shader.uniform('uPickID'), pickID);
  }

  beginModel(
      gl: GL, shader: ShaderProgram, renderContext: PerspectiveViewRenderContext, modelMat: mat4) {
    const {projectionParameters} = renderContext;
    gl.uniformMatrix4fv(
        shader.uniform('uModelViewProjection'), false,
        mat4.multiply(tempMat4, projectionParameters.viewProjectionMat, modelMat));
    mat3FromMat4(tempMat3, modelMat);
    scaleMat3Output(
        tempMat3, tempMat3, projectionParameters.displayDimensionRenderInfo.canonicalVoxelFactors);
    mat3.invert(tempMat3, tempMat3);
    mat3.transpose(tempMat3, tempMat3);
    gl.uniformMatrix3fv(shader.uniform('uNormalMatrix'), false, tempMat3);
    gl.uniformMatrix4fv(shader.uniform('uNgeModel'), false, modelMat);
    // Highlight tint: only when colour is drawn, and only if there are marks.
    const tint = renderContext.emitColor ? getNgeMeshTint() : null;
    const unit = shader.textureUnit(ngeTintSamplerSymbol);
    if (tint !== null && bindNgeMeshTint(gl, unit)) {
      gl.uniformMatrix4fv(
          shader.uniform('uNgeTintMatrix'), false,
          mat4.multiply(ngeTintMat, tint.gridFromGlobal, modelMat));
      gl.uniform1f(shader.uniform('uNgeTintOn'), 1);
      const glow = tint.glow;
      gl.uniform4f(shader.uniform('uNgeTintGlow'), glow?.[0] ?? 0, glow?.[1] ?? 0, glow?.[2] ?? 0, glow ? 1 : 0);
    } else {
      gl.uniform1f(shader.uniform('uNgeTintOn'), 0);
    }
    // The fine map of the cut preview, over the map above.
    const fineTint = renderContext.emitColor ? getNgeMeshTintFine() : null;
    const fineUnit = shader.textureUnit(ngeFineSamplerSymbol);
    if (fineTint !== null && bindNgeMeshTintFine(gl, fineUnit)) {
      gl.uniformMatrix4fv(
          shader.uniform('uNgeFineMatrix'), false,
          mat4.multiply(ngeFineMat, fineTint.gridFromGlobal, modelMat));
      gl.uniform1f(shader.uniform('uNgeFineOn'), 1);
    } else {
      gl.uniform1f(shader.uniform('uNgeFineOn'), 0);
    }
    // Lantern: only where colour is drawn (never the picking pass, so a cell
    // in shadow can still be hovered and clicked).
    const lantern = renderContext.emitColor ? getNgeLantern() : null;
    if (lantern !== null) {
      ngeLanternPositionNm(ngeLanternPos, lantern, projectionParameters.invViewMatrix);
      gl.uniformMatrix4fv(
          shader.uniform('uNgeLanternModel'), false, ngeLanternNmFromModel(ngeLanternMat, lantern, modelMat));
      gl.uniform4f(
          shader.uniform('uNgeLantern'), ngeLanternPos[0], ngeLanternPos[1], ngeLanternPos[2], lantern.radiusNm);
      const mask = lantern.mask ?? null;
      if (mask !== null) {
        bindNgeLanternMask(gl, shader.textureUnit(ngeLanternMaskSymbol), mask);
        gl.uniformMatrix4fv(
            shader.uniform('uNgeLanternMaskMatrix'), false, mat4.multiply(ngeLanternMaskMat, mask.gridFromGlobal, modelMat));
      }
      // x: 1 lights round the lantern, 2 lights the mapped branch.
      gl.uniform3f(shader.uniform('uNgeLanternLight'), mask !== null ? 2 : 1, lantern.intensity, lantern.shadow);
      const second = getNgeLanternSecond();
      if (second !== null && second.radiusNm > 0) {
        gl.uniform4f(shader.uniform('uNgeLantern2'), second.posNm[0], second.posNm[1], second.posNm[2], second.radiusNm);
        gl.uniform3f(shader.uniform('uNgeLantern2Color'), second.color[0], second.color[1], second.color[2]);
      } else {
        gl.uniform4f(shader.uniform('uNgeLantern2'), 0, 0, 0, 0);
      }
    } else {
      gl.uniform3f(shader.uniform('uNgeLanternLight'), 0, 1, 1);
    }
    // The edge of the dataset (the Hunt): only where colour is drawn.
    const edge = renderContext.emitColor ? getNgeMeshEdge() : null;
    if (edge !== null) {
      gl.uniformMatrix4fv(shader.uniform('uNgeEdgeModel'), false, ngeLanternNmFromModel(ngeEdgeMat, edge, modelMat));
      gl.uniform4f(shader.uniform('uNgeEdgeLo'), edge.lo[0], edge.lo[1], edge.lo[2], edge.marginNm);
      gl.uniform4f(shader.uniform('uNgeEdgeHi'), edge.hi[0], edge.hi[1], edge.hi[2], 1);
      gl.uniform3f(shader.uniform('uNgeEdgeColor'), edge.color[0], edge.color[1], edge.color[2]);
    } else {
      gl.uniform4f(shader.uniform('uNgeEdgeHi'), 0, 0, 0, 0);
    }
  }

  drawFragmentHelper(
      gl: GL, shader: ShaderProgram, fragmentChunk: FragmentChunk|MultiscaleFragmentChunk,
      indexBegin: number, indexEnd: number) {
    this.vertexPositionHandler.bind(gl, shader, fragmentChunk);
    const {meshData} = fragmentChunk;
    fragmentChunk.normalBuffer.bindToVertexAttrib(
        shader.attribute('aVertexNormal'),
        /*components=*/ 2, WebGL2RenderingContext.BYTE, /*normalized=*/ true);
    const {indices} = meshData;
    fragmentChunk.indexBuffer.bind();
    gl.drawElements(
        meshData.strips ? WebGL2RenderingContext.TRIANGLE_STRIP : WebGL2RenderingContext.TRIANGLES,
        indexEnd - indexBegin,
        indices.BYTES_PER_ELEMENT === 2 ? WebGL2RenderingContext.UNSIGNED_SHORT :
                                          WebGL2RenderingContext.UNSIGNED_INT,
        indexBegin * indices.BYTES_PER_ELEMENT);
  }

  drawFragment(gl: GL, shader: ShaderProgram, fragmentChunk: FragmentChunk) {
    const {meshData} = fragmentChunk;
    const {indices} = meshData;
    this.drawFragmentHelper(gl, shader, fragmentChunk, 0, indices.length);
  }

  drawMultiscaleFragment(
      gl: GL,
      shader: ShaderProgram,
      fragmentChunk: MultiscaleFragmentChunk,
      subChunkBegin: number,
      subChunkEnd: number,
  ) {
    const indexBegin = fragmentChunk.meshData.subChunkOffsets[subChunkBegin];
    const indexEnd = fragmentChunk.meshData.subChunkOffsets[subChunkEnd];
    this.drawFragmentHelper(gl, shader, fragmentChunk, indexBegin, indexEnd);
  }

  endLayer(gl: GL, shader: ShaderProgram) {
    this.vertexPositionHandler.endLayer(gl, shader);
    gl.disableVertexAttribArray(shader.attribute('aVertexNormal'));
  }

  makeGetter(layer: RefCounted&{gl: GL, displayState: MeshDisplayState}) {
    const silhouetteRenderingEnabled = layer.registerDisposer(
        makeCachedDerivedWatchableValue(x => x > 0, [layer.displayState.silhouetteRendering]));
    return parameterizedEmitterDependentShaderGetter(layer, layer.gl, {
      memoizeKey:
          `mesh/MeshShaderManager/${this.fragmentRelativeVertices}/${this.vertexPositionFormat}`,
      parameters: silhouetteRenderingEnabled,
      defineShader: (builder, silhouetteRenderingEnabled) => {
        this.vertexPositionHandler.defineShader(builder);
        builder.addAttribute('highp vec2', 'aVertexNormal');
        builder.addVarying('highp vec4', 'vColor');
        builder.addUniform('highp vec4', 'uLightDirection');
        builder.addUniform('highp vec4', 'uColor');
        builder.addUniform('highp mat3', 'uNormalMatrix');
        builder.addUniform('highp mat4', 'uModelViewProjection');
        builder.addUniform('highp uint', 'uPickID');
        builder.addUniform('highp mat4', 'uNgeTintMatrix');
        builder.addUniform('highp float', 'uNgeTintOn');
        builder.addUniform('highp float', 'uNgeGlow');
        builder.addUniform('highp vec4', 'uNgeShell');
        builder.addUniform('highp vec4', 'uNgeShellColor');
        builder.addUniform('highp vec2', 'uNgeViewport');
        builder.addUniform('highp vec4', 'uNgePulse');
        builder.addUniform('highp vec3', 'uNgePulseCenter');
        builder.addUniform('highp vec3', 'uNgePulseScale');
        builder.addUniform('highp vec4', 'uNgePulseColor');
        builder.addUniform('highp vec4', 'uNgeRim');
        builder.addVarying('highp vec4', 'vNgeHolo');
        builder.addVarying('highp vec3', 'vNgeHoloPos');
        builder.addVarying('highp vec3', 'vNgeHoloN');
        builder.addUniform('highp float', 'uNgeHoloStep');
        // Scattered soft dots (Ames 2026-10-22: "not so weirdly a grid ... a
        // little offset, farther apart, much farther"): each grid cell holds
        // one dot at a random spot in it, about two cells in three, smoothed
        // by its size on screen.
        builder.addFragmentCode(`
highp float ngeHoloHash(highp vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
highp float ngeHoloDot(highp vec2 p) {
  highp vec2 cell = floor(p);
  highp vec2 at = vec2(ngeHoloHash(cell), ngeHoloHash(cell + 17.3)) * 0.6 + 0.2;
  highp float d = length(fract(p) - at);
  highp float aa = fwidth(d) * 1.2;
  highp float on = step(0.5, ngeHoloHash(cell + 41.9));
  return on * (1.0 - smoothstep(0.06 - aa, 0.06 + aa, d));
}
`);
        builder.addUniform('highp mat4', 'uNgeModel');
        builder.addUniform('highp vec4', 'uNgeTintGlow');
        builder.addTextureSampler('sampler3D', 'uNgeTint', ngeTintSamplerSymbol);
        builder.addUniform('highp mat4', 'uNgeFineMatrix');
        builder.addUniform('highp float', 'uNgeFineOn');
        builder.addTextureSampler('sampler3D', 'uNgeFine', ngeFineSamplerSymbol);
        // Lantern: model to nanometres; where it is (xyz, nm) and how far it
        // reaches (w, nm); x on or off, y brightness of the lit part, z of the rest.
        builder.addUniform('highp mat4', 'uNgeLanternModel');
        builder.addUniform('highp vec4', 'uNgeLantern');
        builder.addUniform('highp vec3', 'uNgeLanternLight');
        builder.addUniform('highp mat4', 'uNgeLanternMaskMatrix');
        builder.addTextureSampler('sampler3D', 'uNgeLanternMask', ngeLanternMaskSymbol);
        // A second, coloured light (the reaper's red lantern): xyz nm, w reach.
        builder.addUniform('highp vec4', 'uNgeLantern2');
        builder.addUniform('highp vec3', 'uNgeLantern2Color');
        // The edge of the dataset: model to nanometres; the volume's low corner
        // (xyz, nm) and the margin (w, nm); its high corner (xyz) and on (w).
        builder.addUniform('highp mat4', 'uNgeEdgeModel');
        builder.addUniform('highp vec4', 'uNgeEdgeLo');
        builder.addUniform('highp vec4', 'uNgeEdgeHi');
        builder.addUniform('highp vec3', 'uNgeEdgeColor');
        if (silhouetteRenderingEnabled) {
          builder.addUniform('highp float', 'uSilhouettePower');
        }
        if (this.fragmentRelativeVertices) {
          builder.addUniform('highp vec3', 'uFragmentOrigin');
          builder.addUniform('highp vec3', 'uFragmentShape');
        }
        builder.addVertexCode(glsl_decodeNormalOctahedronSnorm8);
        let vertexMain = ``;
        if (this.fragmentRelativeVertices) {
          vertexMain += `
highp vec3 vertexPosition = uFragmentOrigin + uFragmentShape * getVertexPosition();
highp vec3 normalMultiplier = 1.0 / uFragmentShape;
`;
        } else {
          vertexMain += `
highp vec3 vertexPosition = getVertexPosition();
highp vec3 normalMultiplier = vec3(1.0, 1.0, 1.0);
`;
        }
        vertexMain += `
gl_Position = uModelViewProjection * vec4(vertexPosition, 1.0);
vec3 origNormal = decodeNormalOctahedronSnorm8(aVertexNormal);
vec3 normal = normalize(uNormalMatrix * (normalMultiplier * origNormal));
float absCosAngle = abs(dot(normal, uLightDirection.xyz));
float lightingFactor = absCosAngle + uLightDirection.w;
vColor = vec4(lightingFactor * uColor.rgb, uColor.a);
vNgeHolo = vec4(0.0);
vNgeHoloPos = vec3(0.0);
vNgeHoloN = vec3(0.0, 0.0, 1.0);
if (uNgeGlow > 4.5) {
  // EyeWire II hover hologram (Ames 2026-10-21: the real wireframe was too
  // slow; "a hologram effect ... or an inner glow?"): a dark body glowing from
  // its edges in a light tint of its own colour, worked out per pixel
  // (fragment main). Nothing moves; shader only, as quick as the cell itself.
  highp float holoLen = length(uLightDirection.xyz);
  highp float holoFacing = holoLen > 0.0 ? abs(dot(normal, uLightDirection.xyz / holoLen)) : 1.0;
  // .z: 1 Metallic (uNgeGlow 6), 0 Hologram (5).
  vNgeHolo = vec4(1.0 - holoFacing, lightingFactor, uNgeGlow > 5.5 ? 1.0 : 0.0, 1.0);
  // The dots' grid: positions in nm, in steps that keep the dots about 14 px
  // apart (uNgeHoloStep, a power of two, so they do not crawl as you zoom).
  vNgeHoloPos = (uNgeModel * vec4(vertexPosition, 1.0)).xyz * uNgePulseScale / uNgeHoloStep;
  vNgeHoloN = normalMultiplier * origNormal;
} else if (uNgeGlow > 3.5) {
  // EyeWire II hover 'saturate', lit from within (Ames 2026-10-20: a colour
  // already at full strength cannot get richer): the shading flattens toward
  // full light, so the shadowed sides brighten and the cell seems to glow.
  vColor.rgb = min(uColor.rgb * mix(lightingFactor, 1.12, uNgeRim.w), vec3(uColor.a));
} else if (uNgeGlow > 1.5) {
  // EyeWire II hover halo, on the cell itself: where its surface turns away
  // from you, it takes on the glow's colour, so the glow seems to come from
  // inside the edge as well as around it. The middle keeps its own shading.
  highp float rimLen = length(uLightDirection.xyz);
  highp float rimFacing = rimLen > 0.0 ? abs(dot(normal, uLightDirection.xyz / rimLen)) : 1.0;
  highp float rimAmount = pow(1.0 - rimFacing, 4.0);
  // As the halo fades for zoom (uNgeRim.w down), the cell is lit from within
  // instead, as with Saturate.
  vColor.rgb = min(uColor.rgb * mix(lightingFactor, 1.12, 0.6 * (1.0 - uNgeRim.w)), vec3(uColor.a));
  // Fainter when zoomed out, where a thin branch is nearly all edge.
  vColor.rgb = mix(vColor.rgb, uNgeRim.rgb * uColor.a, 0.35 * uNgeRim.w * rimAmount);
} else if (uNgeGlow > 0.5 && uNgePulse.w > 0.5) {
  // EyeWire II hover pulse: bands of light run out along the cell from the
  // mouse, like a signal firing. Distances in nm, so z counts as much as x.
  highp vec3 pulseAt = (uNgeModel * vec4(vertexPosition, 1.0)).xyz;
  highp float pulseDist = length((pulseAt - uNgePulseCenter) * uNgePulseScale);
  highp float pulsePhase = mod(pulseDist - uNgePulse.x, uNgePulse.z);
  highp float pulseOff = min(pulsePhase, uNgePulse.z - pulsePhase) / uNgePulse.y;
  highp float pulseBand = exp(-pulseOff * pulseOff);
  highp vec3 pulseColor = uNgePulseColor.w > 0.5 ? uNgePulseColor.rgb * uColor.a : mix(uColor.rgb, vec3(uColor.a), 0.65);
  vColor.rgb = mix(vColor.rgb, pulseColor, 0.9 * pulseBand * clamp(uNgePulse.w - 1.0, 0.0, 1.0));
}
if (uNgeTintOn > 0.5) {
  highp vec3 tintCoord = (uNgeTintMatrix * vec4(vertexPosition, 1.0)).xyz;
  if (all(greaterThanEqual(tintCoord, vec3(0.0))) && all(lessThanEqual(tintCoord, vec3(1.0)))) {
    highp vec4 tint = texture(uNgeTint, tintCoord);
    if (tint.a > 0.02) {
      highp vec3 tintRgb = tint.rgb / tint.a;
      // The glowing colour keeps only a third of the shading and sits above
      // full brightness, so it reads as lit from within.
      highp float isGlow = uNgeTintGlow.a * step(distance(tintRgb, uNgeTintGlow.rgb), 0.06);
      // Lit more evenly than the rest, but never past full brightness: at
      // 0.95 + 0.35 a large mark (a whole arbor from Beyond) burned out to a
      // pale blank, most of all in yellow (Ames 2026-10-10).
      highp float tintLight = mix(lightingFactor, min(1.0, 0.58 + 0.44 * lightingFactor), isGlow);
      vColor.rgb = mix(vColor.rgb, tintLight * tintRgb, min(1.0, tint.a * 1.15));
    }
  }
}
if (uNgeFineOn > 0.5) {
  highp vec3 fineCoord = (uNgeFineMatrix * vec4(vertexPosition, 1.0)).xyz;
  if (all(greaterThanEqual(fineCoord, vec3(0.0))) && all(lessThanEqual(fineCoord, vec3(1.0)))) {
    highp vec4 fineTint = texture(uNgeFine, fineCoord);
    if (fineTint.a > 0.5) vColor.rgb = lightingFactor * fineTint.rgb;
  }
}
if (uNgeEdgeHi.w > 0.5) {
  // EyeWire II Hunt: where the cell runs out of the data, within the margin of
  // the volume's sides, it takes the edge colour, lit a little from within so
  // it shows on the far side too (Ames 2026-10-23: "highlight the 3D mesh").
  highp vec3 edgeAt = (uNgeEdgeModel * vec4(vertexPosition, 1.0)).xyz;
  highp vec3 edgeFromLo = edgeAt - uNgeEdgeLo.xyz;
  highp vec3 edgeFromHi = uNgeEdgeHi.xyz - edgeAt;
  highp float edgeDist = min(min(min(edgeFromLo.x, edgeFromLo.y), edgeFromLo.z), min(min(edgeFromHi.x, edgeFromHi.y), edgeFromHi.z));
  highp float edgeAmount = 1.0 - smoothstep(0.95 * uNgeEdgeLo.w, uNgeEdgeLo.w, edgeDist);
  vColor.rgb = mix(vColor.rgb, min(uNgeEdgeColor * (0.45 + 0.6 * lightingFactor), vec3(1.0)) * uColor.a, edgeAmount);
}
if (uNgeLanternLight.x > 0.5) {
  highp vec3 lanternFrom = (uNgeLanternModel * vec4(vertexPosition, 1.0)).xyz - uNgeLantern.xyz;
  // Fully lit inside four fifths of the reach, fading out just past it.
  highp float lit = 1.0 - smoothstep(0.8 * uNgeLantern.w, 1.2 * uNgeLantern.w, length(lanternFrom));
  if (uNgeLanternLight.x > 1.5) {
    // Clicked branch: only the mapped branch, as far as the light has spread.
    highp vec3 maskCoord = (uNgeLanternMaskMatrix * vec4(vertexPosition, 1.0)).xyz;
    highp float inMap = all(greaterThanEqual(maskCoord, vec3(0.0))) && all(lessThanEqual(maskCoord, vec3(1.0))) ? 1.0 : 0.0;
    lit *= inMap * smoothstep(0.15, 0.6, texture(uNgeLanternMask, maskCoord).r);
  }
  // In shadow a cell keeps its shape and loses its colour.
  highp float grey = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
  vColor.rgb = mix(vec3(grey) * uNgeLanternLight.z, min(vColor.rgb * uNgeLanternLight.y, vec3(1.0)), lit);
  if (uNgeLantern2.w > 0.0) {
    // The second light colours what it reaches, whatever colour the cell is.
    highp float lit2 = 1.0 - smoothstep(0.3 * uNgeLantern2.w, uNgeLantern2.w, length(lanternFrom + uNgeLantern.xyz - uNgeLantern2.xyz));
    vColor.rgb = mix(vColor.rgb, min(uNgeLantern2Color * (0.35 + 1.9 * grey), vec3(1.0)), 0.92 * lit2);
  }
}
`;
        if (silhouetteRenderingEnabled) {
          vertexMain += `
vColor *= pow(1.0 - absCosAngle, uSilhouettePower);
`;
        }
        // EyeWire II hover outline and halo: this pass draws the cell pushed
        // out along its surface normals by a few pixels on screen and a little
        // behind itself, so only the rim outside the cell shows.
        vertexMain += `
if (uNgeShell.w > 0.5) {
  highp vec3 shellNormal = normalize(normalMultiplier * origNormal);
  highp vec4 shellAway = uModelViewProjection * vec4(vertexPosition + shellNormal * uNgeShell.z, 1.0);
  highp vec2 shellDir = (shellAway.xy / shellAway.w - gl_Position.xy / gl_Position.w) * uNgeViewport;
  highp float shellLen = length(shellDir);
  if (shellLen > 1e-6) {
    gl_Position.xy += (shellDir / shellLen) * uNgeShell.x * 2.0 / uNgeViewport * gl_Position.w;
  }
  gl_Position.z += uNgeShell.y * gl_Position.w;
  vColor = uNgeShellColor;
}
`;
        builder.setVertexMain(vertexMain);
        builder.setFragmentMain(`
if (vNgeHolo.w > 0.5) {
  if (vNgeHolo.z > 0.5) {
    // Metallic (Ames 2026-10-21: "this does not look like a hologram, but it
    // is cool ... maybe we need a metallic option"): a dark body with bright
    // edges in a light tint of its own colour.
    highp float metalRim = pow(clamp(vNgeHolo.x, 0.0, 1.0), 1.6);
    highp vec3 metalBody = uColor.rgb * (0.18 + 0.18 * vNgeHolo.y);
    emit(vec4(min(metalBody + uNgeRim.rgb * uColor.a * (0.12 + 1.3 * metalRim), vec3(1.0)), uColor.a), uPickID);
  } else {
    // Hologram, made of light (Ames 2026-10-22, from her pictures: a cyan
    // chameleon, a globe of light). One colour whatever the cell's own (cyan,
    // or the pulse colour; uNgeRim), a bright evenly lit body, edges burning
    // toward white, and a fine sprinkle of small dots fixed to the surface
    // (dots on the three planes, blended by the normal, as in Ames's
    // scifi-ui hologram). The glow around it is the halo pass, in cyan.
    highp float holoRim = pow(clamp(vNgeHolo.x, 0.0, 1.0), 2.2);
    highp vec3 holoW = abs(normalize(vNgeHoloN));
    holoW = holoW * holoW;
    holoW /= max(holoW.x + holoW.y + holoW.z, 1e-6);
    highp float holoDots = ngeHoloDot(vNgeHoloPos.yz) * holoW.x + ngeHoloDot(vNgeHoloPos.xz) * holoW.y + ngeHoloDot(vNgeHoloPos.xy) * holoW.z;
    highp vec3 holoC = uNgeRim.rgb;
    highp vec3 holoBody = holoC * (0.32 + 0.18 * vNgeHolo.y);
    highp vec3 holoEdge = mix(holoC, vec3(1.0), 0.55) * 1.25 * holoRim;
    emit(vec4(min(holoBody + holoEdge + holoC * 0.5 * holoDots, vec3(1.0)) * uColor.a, uColor.a), uPickID);
  }
} else {
  emit(vColor, uPickID);
}`);
      },
    });
  }
}

export interface MeshDisplayState extends SegmentationDisplayState3D {
  silhouetteRendering: WatchableValueInterface<number>;
}

export class MeshLayer extends
    PerspectiveViewRenderLayer<ThreeDimensionalRenderLayerAttachmentState> {
  protected meshShaderManager =
      new MeshShaderManager(/*fragmentRelativeVertices=*/ false, VertexPositionFormat.float32);
  private getShader = this.meshShaderManager.makeGetter(this);
  backend: SegmentationLayerSharedObject;

  constructor(
      public chunkManager: ChunkManager, public source: MeshSource,
      public displayState: MeshDisplayState) {
    super();

    registerRedrawWhenSegmentationDisplayState3DChanged(displayState, this);
    this.registerDisposer(displayState.silhouetteRendering.changed.add(this.redrawNeeded.dispatch));

    let sharedObject = this.backend = this.registerDisposer(
        new SegmentationLayerSharedObject(chunkManager, displayState, this.layerChunkProgressInfo));
    sharedObject.RPC_TYPE_ID = MESH_LAYER_RPC_ID;
    sharedObject.initializeCounterpartWithChunkManager({
      'source': source.addCounterpartRef(),
    });
    sharedObject.visibility.add(this.visibility);
    this.registerDisposer(displayState.renderScaleHistogram.visibility.add(this.visibility));
  }

  get isTransparent() {
    const {displayState} = this;
    return displayState.objectAlpha.value < 1.0 || displayState.silhouetteRendering.value > 0;
  }

  get transparentPickEnabled() {
    return this.displayState.transparentPickEnabled.value;
  }

  get gl() {
    return this.chunkManager.chunkQueueManager.gl;
  }

  draw(
      renderContext: PerspectiveViewRenderContext,
      attachment: VisibleLayerInfo<PerspectivePanel, ThreeDimensionalRenderLayerAttachmentState>) {
    if (!renderContext.emitColor && renderContext.alreadyEmittedPickID) {
      // No need for a separate pick ID pass.
      return;
    }
    const {gl, displayState, meshShaderManager} = this;
    if (displayState.objectAlpha.value <= 0.0) {
      // Skip drawing.
      return;
    }
    const modelMatrix = update3dRenderLayerAttachment(
        displayState.transform.value, renderContext.projectionParameters.displayDimensionRenderInfo,
        attachment);
    if (modelMatrix === undefined) {
      return;
    }
    const {shader} = this.getShader(renderContext.emitter);
    if (shader === null) return;
    shader.bind();
    meshShaderManager.beginLayer(gl, shader, renderContext, this.displayState);
    meshShaderManager.beginModel(gl, shader, renderContext, modelMatrix);

    const manifestChunks = this.source.chunks;

    let totalChunks = 0, presentChunks = 0;
    const {renderScaleHistogram} = this.displayState;
    const fragmentChunks = this.source.fragmentSource.chunks;
    const shells = this.ngeShellPass;

    forEachVisibleSegmentToDraw(
        displayState, this, renderContext.emitColor,
        renderContext.emitPickID ? renderContext.pickIDs : undefined,
        (objectId, color, pickIndex) => {
          const key = getObjectKey(objectId);
          const manifestChunk = manifestChunks.get(key);
          ++totalChunks;
          if (manifestChunk === undefined) return;
          ++presentChunks;
          const hovered = displayState.hoverHighlight.value &&
              displayState.segmentSelectionState.isSelected(objectId);
          const drawFragments = () => {
            for (const fragmentId of manifestChunk.fragmentIds) {
              const {key: fragmentKey} = this.source.getFragmentKey(key, fragmentId);
              const fragment = fragmentChunks.get(fragmentKey);
              if (fragment !== undefined && fragment.state === ChunkState.GPU_MEMORY) {
                meshShaderManager.drawFragment(gl, shader, fragment);
                ++presentChunks;
              }
            }
          };
          // EyeWire II: the outline and halo pass draws only the hovered cell's shells.
          if (shells !== null) {
            if (!hovered) return;
            for (const shell of shells) {
              meshShaderManager.setShell(gl, shader, shell.widthPx, ngeShellColorFor(color!, shell.alpha));
              drawFragments();
            }
            return;
          }
          if (renderContext.emitColor) {
            meshShaderManager.setColor(gl, shader, color!);
            const pulsing = ngePulseFor(gl, shader, key, hovered);
            meshShaderManager.setGlow(gl, shader, pulsing || (hovered ? ngeHoverGlowMode(color!) : 0));
            // Back to no pulse for the next cell.
            if (!pulsing) gl.uniform4f(shader.uniform('uNgePulse'), 0, 1, 1, 0);
          }
          if (renderContext.emitPickID) {
            meshShaderManager.setPickID(gl, shader, pickIndex!);
          }
          totalChunks += manifestChunk.fragmentIds.length;
          drawFragments();
        });

    if (renderContext.emitColor && shells === null) {
      renderScaleHistogram.begin(
          this.chunkManager.chunkQueueManager.frameNumberCounter.frameNumber);
      renderScaleHistogram.add(
          Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, presentChunks,
          totalChunks - presentChunks);
    }
    meshShaderManager.endLayer(gl, shader);
    // EyeWire II: the pulse moves, so keep drawing while a cell is pulsing.
    if (ngePulseRunning) {
      ngePulseRunning = false;
      this.redrawNeeded.dispatch();
    }
  }

  /** EyeWire II: one outline or halo pass (perspective_view/panel.ts). */
  ngeShellPass: NgeShell[]|null = null;
  ngeDrawShells(
      renderContext: PerspectiveViewRenderContext,
      attachment: VisibleLayerInfo<PerspectivePanel, ThreeDimensionalRenderLayerAttachmentState>,
      shells: NgeShell[]) {
    this.ngeShellPass = shells;
    try {
      this.draw(renderContext, attachment);
    } finally {
      this.ngeShellPass = null;
    }
  }

  isReady() {
    const {displayState, source} = this;
    let ready = true;
    const fragmentChunks = source.fragmentSource.chunks;
    forEachVisibleSegment(displayState.segmentationGroupState.value, objectId => {
      const key = getObjectKey(objectId);
      const manifestChunk = source.chunks.get(key);
      if (manifestChunk === undefined) {
        ready = false;
        return;
      }
      for (const fragmentId of manifestChunk.fragmentIds) {
        const {key: fragmentKey} = this.source.getFragmentKey(key, fragmentId);
        const fragmentChunk = fragmentChunks.get(fragmentKey);
        if (fragmentChunk === undefined || fragmentChunk.state !== ChunkState.GPU_MEMORY) {
          ready = false;
          return;
        }
      }
    });
    return ready;
  }
}

export class ManifestChunk extends Chunk {
  fragmentIds: string[];

  constructor(source: MeshSource, x: any) {
    super(source);
    this.fragmentIds = x.fragmentIds;
  }
}

export class FragmentChunk extends Chunk {
  source: FragmentSource;
  vertexBuffer: Buffer;
  indexBuffer: Buffer;
  normalBuffer: Buffer;
  meshData: EncodedMeshData;

  constructor(source: FragmentSource, x: any) {
    super(source);
    this.meshData = x;
  }

  copyToGPU(gl: GL) {
    super.copyToGPU(gl);
    copyMeshDataToGpu(gl, this);
  }

  freeGPUMemory(gl: GL) {
    super.freeGPUMemory(gl);
    freeGpuMeshData(this);
  }
}

export interface MeshSourceOptions {}

export class MeshSource extends ChunkSource {
  fragmentSource = this.registerDisposer(new FragmentSource(this.chunkManager, this));
  chunks: Map<string, ManifestChunk>;

  constructor(chunkManager: Borrowed<ChunkManager>, options: MeshSourceOptions) {
    super(chunkManager, options);
  }

  initializeCounterpart(rpc: RPC, options: any) {
    this.fragmentSource.initializeCounterpart(this.chunkManager.rpc!, {});
    options['fragmentSource'] = this.fragmentSource.addCounterpartRef();
    super.initializeCounterpart(rpc, options);
  }
  getChunk(x: any) {
    return new ManifestChunk(this, x);
  }
  getFragmentKey(objectKey: string, fragmentId: string) {
    return {key:`${objectKey}/${fragmentId}`, fragmentId: fragmentId}
  }
}

@registerSharedObjectOwner(FRAGMENT_SOURCE_RPC_ID)
export class FragmentSource extends ChunkSource {
  chunks: Map<string, FragmentChunk>;
  get key() {
    return this.meshSource.key;
  }
  constructor(chunkManager: ChunkManager, public meshSource: MeshSource) {
    super(chunkManager);
  }
  getChunk(x: any) {
    return new FragmentChunk(this, x);
  }
}


function hasFragmentChunk(
    fragmentChunks: Map<string, MultiscaleFragmentChunk>, objectKey: string, lod: number,
    chunkIndex: number) {
  const fragmentChunk = fragmentChunks.get(getMultiscaleFragmentKey(objectKey, lod, chunkIndex));
  return fragmentChunk !== undefined && fragmentChunk.state === ChunkState.GPU_MEMORY;
}

export class MultiscaleMeshLayer extends
    PerspectiveViewRenderLayer<ThreeDimensionalRenderLayerAttachmentState> {
  protected meshShaderManager = new MeshShaderManager(
      /*fragmentRelativeVertices=*/ this.source.format.fragmentRelativeVertices,
      this.source.format.vertexPositionFormat);
  private getShader = this.meshShaderManager.makeGetter(this);
  backend: SegmentationLayerSharedObject;

  constructor(
      public chunkManager: ChunkManager, public source: MultiscaleMeshSource,
      public displayState: MeshDisplayState) {
    super();

    registerRedrawWhenSegmentationDisplayState3DChanged(displayState, this);
    this.registerDisposer(displayState.silhouetteRendering.changed.add(this.redrawNeeded.dispatch));

    let sharedObject = this.backend = this.registerDisposer(
        new SegmentationLayerSharedObject(chunkManager, displayState, this.layerChunkProgressInfo));
    sharedObject.RPC_TYPE_ID = MULTISCALE_MESH_LAYER_RPC_ID;
    sharedObject.initializeCounterpartWithChunkManager({
      'source': source.addCounterpartRef(),
    });
    sharedObject.visibility.add(this.visibility);
    this.registerDisposer(displayState.renderScaleHistogram.visibility.add(this.visibility));
  }

  get isTransparent() {
    const {displayState} = this;
    return displayState.objectAlpha.value < 1.0 || displayState.silhouetteRendering.value > 0;
  }

  get transparentPickEnabled() {
    return this.displayState.transparentPickEnabled.value;
  }

  get gl() {
    return this.chunkManager.chunkQueueManager.gl;
  }

  draw(
      renderContext: PerspectiveViewRenderContext,
      attachment: VisibleLayerInfo<PerspectivePanel, ThreeDimensionalRenderLayerAttachmentState>) {
    if (!renderContext.emitColor && renderContext.alreadyEmittedPickID) {
      // No need for a separate pick ID pass.
      return;
    }
    const {gl, displayState, meshShaderManager} = this;
    if (displayState.objectAlpha.value <= 0.0) {
      // Skip drawing.
      return;
    }
    const modelMatrix = update3dRenderLayerAttachment(
        displayState.transform.value, renderContext.projectionParameters.displayDimensionRenderInfo,
        attachment);
    if (modelMatrix === undefined) return;
    const {shader} = this.getShader(renderContext.emitter);
    if (shader === null) return;
    shader.bind();
    meshShaderManager.beginLayer(gl, shader, renderContext, this.displayState);

    const {renderScaleHistogram} = this.displayState;
    const shells = this.ngeShellPass;
    if (renderContext.emitColor && shells === null) {
      renderScaleHistogram.begin(
          this.chunkManager.chunkQueueManager.frameNumberCounter.frameNumber);
    }

    mat3FromMat4(tempMat3, modelMatrix);
    scaleMat3Output(
        tempMat3, tempMat3,
        renderContext.projectionParameters.displayDimensionRenderInfo.voxelPhysicalScales);
    const scaleMultiplier = Math.pow(Math.abs(mat3.determinant(tempMat3)), 1 / 3);

    const {chunks} = this.source;
    const fragmentChunks = this.source.fragmentSource.chunks;

    const {projectionParameters} = renderContext;

    const modelViewProjection =
        mat4.multiply(mat4.create(), projectionParameters.viewProjectionMat, modelMatrix);

    const clippingPlanes = getFrustrumPlanes(new Float32Array(24), modelViewProjection);

    const detailCutoff = this.displayState.renderScaleTarget.value;
    const {fragmentRelativeVertices} = this.source.format;

    meshShaderManager.beginModel(gl, shader, renderContext, modelMatrix);

    let totalManifestChunks = 0;
    let presentManifestChunks = 0;

    forEachVisibleSegmentToDraw(
        displayState, this, renderContext.emitColor,
        renderContext.emitPickID ? renderContext.pickIDs : undefined,
        (objectId, color, pickIndex) => {
          const key = getObjectKey(objectId);
          const manifestChunk = chunks.get(key);
          ++totalManifestChunks;
          if (manifestChunk === undefined) return;
          ++presentManifestChunks;
          const {manifest} = manifestChunk;
          const {octree, chunkShape, chunkGridSpatialOrigin, vertexOffsets} = manifest;
          if (DEBUG_MULTISCALE_FRAGMENTS) {
            try {
              validateOctree(octree);
            } catch (e) {
              console.log(`invalid octree for object=${objectId}: ${e.message}`)
            }
          }
          const hovered = displayState.hoverHighlight.value &&
              displayState.segmentSelectionState.isSelected(objectId);
          if (shells !== null && !hovered) return;
          if (shells === null && renderContext.emitColor) {
            meshShaderManager.setColor(gl, shader, color!);
            const pulsing = ngePulseFor(gl, shader, key, hovered);
            meshShaderManager.setGlow(gl, shader, pulsing || (hovered ? ngeHoverGlowMode(color!) : 0));
            // Back to no pulse for the next cell.
            if (!pulsing) gl.uniform4f(shader.uniform('uNgePulse'), 0, 1, 1, 0);
          }
          if (renderContext.emitPickID) {
            meshShaderManager.setPickID(gl, shader, pickIndex!);
          }
          // EyeWire II: the outline and halo pass draws the hovered cell once per shell.
          for (const shell of (shells ?? [null])) {
          if (shell !== null) {
            meshShaderManager.setShell(gl, shader, shell.widthPx, ngeShellColorFor(color!, shell.alpha));
          }
          getMultiscaleChunksToDraw(
              manifest, modelViewProjection, clippingPlanes, detailCutoff,
              projectionParameters.width, projectionParameters.height,
              (lod, chunkIndex, renderScale) => {
                const has = hasFragmentChunk(fragmentChunks, key, lod, chunkIndex);
                if (renderContext.emitColor && shells === null) {
                  renderScaleHistogram.add(
                      manifest.lodScales[lod] * scaleMultiplier, renderScale, has ? 1 : 0,
                      has ? 0 : 1);
                }
                return has;
              },
              (lod, chunkIndex, subChunkBegin, subChunkEnd) => {
                const fragmentKey = getMultiscaleFragmentKey(key, lod, chunkIndex);
                const fragmentChunk = fragmentChunks.get(fragmentKey)!;
                const x = octree[5 * chunkIndex], y = octree[5 * chunkIndex + 1],
                      z = octree[5 * chunkIndex + 2];
                const scale = 1 << lod;
                if (fragmentRelativeVertices) {
                  gl.uniform3f(
                      shader.uniform('uFragmentOrigin'),
                      chunkGridSpatialOrigin[0] + (x * chunkShape[0]) * scale +
                          vertexOffsets[lod * 3 + 0],
                      chunkGridSpatialOrigin[1] + (y * chunkShape[1]) * scale +
                          vertexOffsets[lod * 3 + 1],
                      chunkGridSpatialOrigin[2] + (z * chunkShape[2]) * scale +
                          vertexOffsets[lod * 3 + 2]);
                  gl.uniform3f(
                      shader.uniform('uFragmentShape'), chunkShape[0] * scale,
                      chunkShape[1] * scale, chunkShape[2] * scale);
                }
                if (DEBUG_MULTISCALE_FRAGMENTS) {
                  const message = `lod=${lod}, chunkIndex=${chunkIndex}, subChunkBegin=${
                      subChunkBegin}, subChunkEnd=${subChunkEnd}, uFragmentOrigin=${
                          [chunkGridSpatialOrigin[0] + (x * chunkShape[0]) * scale +
                               vertexOffsets[lod * 3 + 0],
                           chunkGridSpatialOrigin[1] + (y * chunkShape[1]) * scale +
                               vertexOffsets[lod * 3 + 1],
                           chunkGridSpatialOrigin[2] + (z * chunkShape[2]) * scale +
                               vertexOffsets[lod * 3 + 2]]}, uFragmentShape=${
                          [chunkShape[0] * scale, chunkShape[1] * scale, chunkShape[2] * scale]}`;
                  const pickIndex =
                      renderContext.pickIDs.registerUint64(this, objectId, 1, message);
                  if (renderContext.emitPickID) {
                    meshShaderManager.setPickID(gl, shader, pickIndex!);
                  }
                }
                meshShaderManager.drawMultiscaleFragment(
                    gl,
                    shader,
                    fragmentChunk,
                    subChunkBegin,
                    subChunkEnd,
                );
              });
          }
        });
    if (shells === null) renderScaleHistogram.add(
        Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, presentManifestChunks,
        totalManifestChunks - presentManifestChunks);
    meshShaderManager.endLayer(gl, shader);
    // EyeWire II: the pulse moves, so keep drawing while a cell is pulsing.
    if (ngePulseRunning) {
      ngePulseRunning = false;
      this.redrawNeeded.dispatch();
    }
  }

  /** EyeWire II: one outline or halo pass (perspective_view/panel.ts). */
  ngeShellPass: NgeShell[]|null = null;
  ngeDrawShells(
      renderContext: PerspectiveViewRenderContext,
      attachment: VisibleLayerInfo<PerspectivePanel, ThreeDimensionalRenderLayerAttachmentState>,
      shells: NgeShell[]) {
    this.ngeShellPass = shells;
    try {
      this.draw(renderContext, attachment);
    } finally {
      this.ngeShellPass = null;
    }
  }

  isReady(
      renderContext: PerspectiveViewReadyRenderContext,
      attachment: VisibleLayerInfo<PerspectivePanel, ThreeDimensionalRenderLayerAttachmentState>) {
    let {displayState} = this;
    if (displayState.objectAlpha.value <= 0.0) {
      // Skip drawing.
      return true;
    }
    const modelMatrix = update3dRenderLayerAttachment(
        displayState.transform.value, renderContext.projectionParameters.displayDimensionRenderInfo,
        attachment);
    if (modelMatrix === undefined) return false;
    const {chunks} = this.source;
    const fragmentChunks = this.source.fragmentSource.chunks;

    const {projectionParameters} = renderContext;
    const modelViewProjection =
        mat4.multiply(mat4.create(), projectionParameters.viewProjectionMat, modelMatrix);

    const clippingPlanes = getFrustrumPlanes(new Float32Array(24), modelViewProjection);

    const detailCutoff = this.displayState.renderScaleTarget.value;

    let hasAllChunks = true;

    forEachVisibleSegment(displayState.segmentationGroupState.value, (objectId) => {
      if (!hasAllChunks) return;
      const key = getObjectKey(objectId);
      const manifestChunk = chunks.get(key);
      if (manifestChunk === undefined) {
        hasAllChunks = false;
        return;
      }
      const {manifest} = manifestChunk;
      getMultiscaleChunksToDraw(
          manifest, modelViewProjection, clippingPlanes, detailCutoff, projectionParameters.width,
          projectionParameters.height, (lod, chunkIndex) => {
            hasAllChunks = hasAllChunks && hasFragmentChunk(fragmentChunks, key, lod, chunkIndex);
            return hasAllChunks;
          }, () => {});
    });
    return hasAllChunks;
  }

  getObjectPosition(id: Uint64): Float32Array|undefined {
    const transform = this.displayState.transform.value;
    if (transform.error !== undefined) return undefined;
    const chunk = this.source.chunks.get(getObjectKey(id));
    if (chunk === undefined) return undefined;
    const {manifest} = chunk;
    const {clipLowerBound, clipUpperBound} = manifest;
    const {rank} = transform;
    // Center position, in model coordinates.
    const modelCenter = new Float32Array(rank);
    for (let i = 0; i < 3; ++i) {
      modelCenter[i] = (clipLowerBound[i] + clipUpperBound[i]) / 2;
    }
    const layerCenter = new Float32Array(rank);
    matrix.transformPoint(
      layerCenter, transform.modelToRenderLayerTransform, rank + 1, modelCenter, rank);
    return layerCenter;
  }
}

export class MultiscaleManifestChunk extends Chunk {
  manifest: MultiscaleMeshManifest;
  source: MultiscaleMeshSource;

  constructor(source: MultiscaleMeshSource, x: any) {
    super(source);
    this.manifest = x['manifest'];
  }
}

export class MultiscaleFragmentChunk extends Chunk {
  meshData: EncodedMeshData&{subChunkOffsets: Uint32Array};
  source: MultiscaleFragmentSource;
  vertexBuffer: Buffer;
  indexBuffer: Buffer;
  normalBuffer: Buffer;

  constructor(source: MultiscaleFragmentSource, x: any) {
    super(source);
    this.meshData = x;
  }

  copyToGPU(gl: GL) {
    super.copyToGPU(gl);
    copyMeshDataToGpu(gl, this);
  }

  freeGPUMemory(gl: GL) {
    super.freeGPUMemory(gl);
    freeGpuMeshData(this);
  }
}

export interface MultiscaleMeshSourceOptions extends MeshSourceOptions {
  format: MultiscaleFragmentFormat;
}

export class MultiscaleMeshSource extends ChunkSource {
  OPTIONS: MultiscaleMeshSourceOptions;
  fragmentSource = this.registerDisposer(new MultiscaleFragmentSource(this.chunkManager, this));
  chunks: Map<string, MultiscaleManifestChunk>;
  format: MultiscaleFragmentFormat;
  constructor(chunkManager: Borrowed<ChunkManager>, options: MultiscaleMeshSourceOptions) {
    super(chunkManager, options);
    this.format = options.format;
  }

  static encodeOptions(options: MultiscaleMeshSourceOptions) {
    return {format: options.format, ...super.encodeOptions(options)};
  }

  initializeCounterpart(rpc: RPC, options: any) {
    this.fragmentSource.initializeCounterpart(this.chunkManager.rpc!, {});
    options['fragmentSource'] = this.fragmentSource.addCounterpartRef();
    options['format'] = this.format;
    super.initializeCounterpart(rpc, options);
  }
  getChunk(x: any) {
    return new MultiscaleManifestChunk(this, x);
  }
}

@registerSharedObjectOwner(MULTISCALE_FRAGMENT_SOURCE_RPC_ID)
export class MultiscaleFragmentSource extends ChunkSource {
  chunks: Map<string, MultiscaleFragmentChunk>;
  get key() {
    return this.meshSource.key;
  }
  constructor(chunkManager: ChunkManager, public meshSource: MultiscaleMeshSource) {
    super(chunkManager);
  }
  getChunk(x: any) {
    return new MultiscaleFragmentChunk(this, x);
  }
}
