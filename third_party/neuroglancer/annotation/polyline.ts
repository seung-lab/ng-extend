/**
 * @license
 * Copyright 2018 Google Inc.
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

/**
 * @file Support for rendering polyline annotations.
 *
 * nge: ported from seung-lab/neuroglancer (branch cj-polyline-test-fix,
 * src/annotation/polyline.ts) for the Cilia Quest's centerline (Ames
 * 2026-10-13), so a polyline made in Pyr is the same annotation the lab's
 * viewer makes, and theirs open here. A polyline is drawn as one line
 * instance per pair of points; each instance starts with a uint32 whose low
 * 31 bits are the line's index within its polyline and whose high bit marks
 * the last line.
 */

import {AnnotationType, PolyLine} from 'neuroglancer/annotation';
import {AnnotationRenderContext, AnnotationRenderHelper, AnnotationShaderGetter, registerAnnotationTypeRenderHandler} from 'neuroglancer/annotation/type_handler';
import {projectPointToLineSegment} from 'neuroglancer/util/geom';
import {defineCircleShader, drawCircles, initializeCircleShader, VERTICES_PER_CIRCLE} from 'neuroglancer/webgl/circles';
import {defineLineShader, drawLines, initializeLineShader} from 'neuroglancer/webgl/lines';
import {ShaderBuilder, ShaderProgram} from 'neuroglancer/webgl/shader';
import {defineVectorArrayVertexShaderInput} from 'neuroglancer/webgl/shader_lib';
import {defineVertexId, VertexIdHelper} from 'neuroglancer/webgl/vertex_id';

const FULL_OBJECT_PICK_OFFSET = 0;
const ENDPOINTS_PICK_OFFSET = FULL_OBJECT_PICK_OFFSET + 1;
const PICK_IDS_PER_INSTANCE = ENDPOINTS_PICK_OFFSET + 2;

function defineNoOpEndpointMarkerSetters(builder: ShaderBuilder) {
  builder.addVertexCode(`
void setPolyEndpointMarkerSize(float startSize, float endSize) {}
void setPolyEndpointMarkerBorderWidth(float startSize, float endSize) {}
void setPolyEndpointMarkerColor(vec4 startColor, vec4 endColor) {}
void setPolyEndpointMarkerBorderColor(vec4 startColor, vec4 endColor) {}
`);
}

function defineNoOpLineSetters(builder: ShaderBuilder) {
  builder.addVertexCode(`
void setPolyLineWidth(float width) {}
void setPolyLineColor(vec4 startColor, vec4 endColor) {}
`);
}

class RenderHelper extends AnnotationRenderHelper {
  defineShader(builder: ShaderBuilder) {
    defineVertexId(builder);
    // Position of endpoints in model coordinates.
    const {rank} = this;
    defineVectorArrayVertexShaderInput(
        builder, 'float', WebGL2RenderingContext.FLOAT, /*normalized=*/ false, 'VertexPosition',
        rank, 2);
    const type = 'uint';
    const name = 'aPolyLineNumVertices';
    builder.addAttribute(type, name);
    // Low 31 bits: the index of this line within its polyline.
    builder.addVertexCode(`${type} getNumRelatedInstances() { return ${name} & 0x7FFFFFFFu; }`);
    // High bit: whether the polyline ends at this line.
    builder.addVertexCode(`${type} getPolyLineEndpointType() { return ${name} >> 31u; }`);
    builder.addInitializer(shader => {
      const location = shader.attribute(name);
      const {gl} = shader;
      shader.vertexShaderInputBinders[name] = location === -1 ?
          {enable() {}, disable() {}, bind() {}} :
          {
            enable(divisor: number) {
              gl.enableVertexAttribArray(location);
              gl.vertexAttribDivisor(location, divisor);
            },
            disable() {
              gl.vertexAttribDivisor(location, 0);
              gl.disableVertexAttribArray(location);
            },
            bind(stride: number, offset: number) {
              gl.vertexAttribIPointer(
                  location, 1, WebGL2RenderingContext.UNSIGNED_INT, stride, offset);
            },
          };
    });
  }

  private vertexIdHelper = this.registerDisposer(VertexIdHelper.get(this.gl));

  private edgeShaderGetter =
      this.getDependentShader('annotation/polyline/edge', (builder: ShaderBuilder) => {
        const {rank} = this;
        this.defineShader(builder);
        defineLineShader(builder);
        builder.addVarying(`highp float[${rank}]`, 'vModelPosition');
        builder.addVertexCode(`
float ng_PolyLineWidth;
`);
        defineNoOpEndpointMarkerSetters(builder);
        builder.addVertexCode(`
void setPolyLineWidth(float width) {
  ng_PolyLineWidth = width;
}
void setPolyLineColor(vec4 startColor, vec4 endColor) {
  vColor = mix(startColor, endColor, getLineEndpointCoefficient());
}
`);
        builder.setVertexMain(`
float modelPositionA[${rank}] = getVertexPosition0();
float modelPositionB[${rank}] = getVertexPosition1();
for (int i = 0; i < ${rank}; ++i) {
  vModelPosition[i] = mix(modelPositionA[i], modelPositionB[i], getLineEndpointCoefficient());
}
ng_PolyLineWidth = 1.0;
vColor = vec4(0.0, 0.0, 0.0, 0.0);
${this.invokeUserMain}
emitLine(uModelViewProjection * vec4(projectModelVectorToSubspace(modelPositionA), 1.0),
         uModelViewProjection * vec4(projectModelVectorToSubspace(modelPositionB), 1.0),
         ng_PolyLineWidth);
${this.setPartIndex(builder)};
`);
        builder.setFragmentMain(`
float clipCoefficient = getSubspaceClipCoefficient(vModelPosition);
emitAnnotation(vec4(vColor.rgb, vColor.a * getLineAlpha() *
                                ${this.getCrossSectionFadeFactor()} *
                                clipCoefficient));
`);
      });

  private endpointShaderGetter =
      this.getDependentShader('annotation/polyline/endpoint', (builder: ShaderBuilder) => {
        const {rank} = this;
        this.defineShader(builder);
        defineCircleShader(builder, this.targetIsSliceView);
        builder.addVarying('highp float', 'vClipCoefficient');
        builder.addVarying('highp vec4', 'vBorderColor');
        defineNoOpLineSetters(builder);
        builder.addVertexCode(`
float ng_PolyMarkerDiameter;
float ng_PolyMarkerBorderWidth;
int getEndpointIndex() {
  return gl_VertexID / ${VERTICES_PER_CIRCLE};
}
void setPolyEndpointMarkerSize(float startSize, float endSize) {
  ng_PolyMarkerDiameter = mix(startSize, endSize, float(getEndpointIndex()));
}
void setPolyEndpointMarkerBorderWidth(float startSize, float endSize) {
  ng_PolyMarkerBorderWidth = mix(startSize, endSize, float(getEndpointIndex()));
}
void setPolyEndpointMarkerColor(vec4 startColor, vec4 endColor) {
  vColor = mix(startColor, endColor, float(getEndpointIndex()));
}
void setPolyEndpointMarkerBorderColor(vec4 startColor, vec4 endColor) {
  vBorderColor = mix(startColor, endColor, float(getEndpointIndex()));
}
`);
        // The first endpoint of every line is drawn; the second only on the last line.
        builder.setVertexMain(`
float modelPosition[${rank}] = getVertexPosition0();
float modelPositionB[${rank}] = getVertexPosition1();
for (int i = 0; i < ${rank}; ++i) {
  modelPosition[i] = mix(modelPosition[i], modelPositionB[i], float(getEndpointIndex()));
}
vClipCoefficient = getSubspaceClipCoefficient(modelPosition);
vColor = vec4(0.0, 0.0, 0.0, 0.0);
vBorderColor = vec4(0.0, 0.0, 0.0, 1.0);
ng_PolyMarkerDiameter = 5.0;
ng_PolyMarkerBorderWidth = 1.0;
${this.invokeUserMain}
if (getEndpointIndex() == 0 || getPolyLineEndpointType() == 1u) {
  emitCircle(uModelViewProjection * vec4(projectModelVectorToSubspace(modelPosition), 1.0), ng_PolyMarkerDiameter, ng_PolyMarkerBorderWidth);
} else {
  gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
}
${this.setPartIndex(builder, 'uint(getEndpointIndex()) + 1u')};
`);
        builder.setFragmentMain(`
vec4 color = getCircleColor(vColor, vBorderColor);
color.a *= vClipCoefficient;
emitAnnotation(color);
`);
      });

  enable(
      shaderGetter: AnnotationShaderGetter, context: AnnotationRenderContext,
      callback: (shader: ShaderProgram) => void) {
    super.enable(shaderGetter, context, shader => {
      const binder = shader.vertexShaderInputBinders['VertexPosition'];
      const countBinder = shader.vertexShaderInputBinders['aPolyLineNumVertices'];
      binder.enable(1);
      countBinder.enable(1);
      this.gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, context.buffer.buffer);
      // Each instance: the uint32, then the two endpoints.
      binder.bind(this.geometryDataStride, context.bufferOffset + 4);
      countBinder.bind(this.geometryDataStride, context.bufferOffset);
      const {vertexIdHelper} = this;
      vertexIdHelper.enable();
      callback(shader);
      vertexIdHelper.disable();
      binder.disable();
      countBinder.disable();
    });
  }

  drawEdges(context: AnnotationRenderContext) {
    this.enable(this.edgeShaderGetter, context, shader => {
      initializeLineShader(
          shader, context.renderContext.projectionParameters, /*featherWidthInPixels=*/ 1.0);
      drawLines(shader.gl, 1, context.count);
    });
  }

  drawEndpoints(context: AnnotationRenderContext) {
    this.enable(this.endpointShaderGetter, context, shader => {
      initializeCircleShader(
          shader, context.renderContext.projectionParameters, {featherWidthInPixels: 0.5});
      drawCircles(shader.gl, 2, context.count);
    });
  }

  draw(context: AnnotationRenderContext) {
    this.drawEdges(context);
    this.drawEndpoints(context);
  }
}

function snapPositionToLine(position: Float32Array, endpoints: Float32Array) {
  const rank = position.length;
  projectPointToLineSegment(
      position, endpoints.subarray(0, rank), endpoints.subarray(rank), position);
}

function snapPositionToEndpoint(position: Float32Array, endpoint: Float32Array) {
  const rank = position.length;
  for (let i = 0; i < rank; ++i) {
    position[i] = endpoint[i];
  }
}

/** A polyline's part index counts across its lines: three pick ids per line
 *  (the line, its start, its end). */
function getPartIndexInfo(partIndex: number) {
  // 0 for the line, 1 for its start point, 2 for its end point.
  const linePart = partIndex % PICK_IDS_PER_INSTANCE;
  // Which line of the polyline.
  const lineIndex = Math.floor(partIndex / PICK_IDS_PER_INSTANCE);
  const pointIndex = Math.max(lineIndex + (linePart - 1), 0);
  return {linePart, lineIndex, pointIndex};
}

registerAnnotationTypeRenderHandler<PolyLine>(AnnotationType.POLYLINE, {
  sliceViewRenderHelper: RenderHelper,
  perspectiveViewRenderHelper: RenderHelper,
  defineShaderNoOpSetters(builder) {
    defineNoOpEndpointMarkerSetters(builder);
    defineNoOpLineSetters(builder);
  },
  pickIdsPerInstance: PICK_IDS_PER_INSTANCE,
  snapPosition(position, data, offset, partIndex) {
    // `offset` is that of the picked line's own instance.
    const {linePart} = getPartIndexInfo(partIndex);
    const rank = position.length;
    const startingOffset = offset + 4;
    // The buffer is a packed byte stream, so the two endpoints are copied
    // out first: a Float32Array view needs an offset that is a multiple of
    // four, and the copy keeps the platform's byte order.
    const endpoints =
        new Float32Array(new Uint8Array(data, startingOffset, rank * 2 * 4).slice().buffer);
    if (linePart !== FULL_OBJECT_PICK_OFFSET) {
      snapPositionToEndpoint(position, endpoints.subarray((linePart - 1) * rank, linePart * rank));
    } else {
      snapPositionToLine(position, endpoints);
    }
  },
  getRepresentativePoint(out, ann, partIndex) {
    const {pointIndex} = getPartIndexInfo(partIndex);
    out.set(ann.points[Math.min(pointIndex, ann.points.length - 1)]);
  },
  updateViaRepresentativePoint(oldAnnotation, position, partIndex) {
    const {linePart, pointIndex} = getPartIndexInfo(partIndex);
    const rank = position.length;
    const index = Math.min(pointIndex, oldAnnotation.points.length - 1);
    // Fresh arrays: the annotation in hand is not changed in place.
    const points = oldAnnotation.points.map(p => Float32Array.from(p));
    if (linePart === FULL_OBJECT_PICK_OFFSET) {
      // Dragged by a line: the whole polyline moves with it.
      const oldPoint = oldAnnotation.points[index];
      for (let i = 0; i < rank; ++i) {
        const diff = position[i] - oldPoint[i];
        for (let j = 0; j < points.length; ++j) points[j][i] += diff;
      }
    } else {
      // Dragged by a point: that point moves.
      points[index] = Float32Array.from(position);
    }
    return {...oldAnnotation, points};
  },
});
