/**
 * EyeWire II Lantern mode (Krzysztof Kruk's idea, 2026-10-09): the part of a
 * cell around where you are is drawn as usual, and the rest of it is greyed
 * down to a shadow, "like climbing a tree at night with a lantern in your
 * hand". It is for checking a big, bushy cell a part at a time, without the
 * far branches mixing into the near ones.
 *
 * It is done in the mesh vertex shader (mesh/frontend.ts): each vertex is
 * dimmed by its distance, in nanometres, from the lantern. Moving the lantern
 * is one uniform, so it follows the view every frame and nothing is rebuilt.
 * Picking is untouched: a dimmed cell can still be hovered and clicked.
 *
 * The app owns the settings (src/util/lantern.ts); this file is only what the
 * renderer reads.
 */
import {mat4, vec3} from 'neuroglancer/util/geom';

export interface NgeLantern {
  /** The centre of the view, in the viewer's global coordinates. */
  center: Float32Array;
  /** Nanometres per global unit, per axis. */
  scaleNm: Float32Array;
  /** How far the light reaches, nm. */
  radiusNm: number;
  /** How far the lantern is lifted off the centre, toward the eye, nm. */
  heightNm: number;
  /** Brightness of the lit part: 1 leaves it as it was. */
  intensity: number;
  /** Brightness of the part left in shadow, 0 to 1. */
  shadow: number;
  /**
   * Lighting and putting out: a line of light crossing the screen from left
   * to right. `edge` is where it is, in screen units from -1 (left) to 1
   * (right); it is outside that range when nothing is sweeping. Lighting,
   * the Lantern takes hold behind the line; putting out, it lets go behind
   * it. `band` is how bright the line itself is, 0 to 1.
   */
  sweep: {edge: number; dousing: boolean; band: number};
}

let current: NgeLantern|null = null;
export function setNgeLantern(lantern: NgeLantern|null) {
  current = lantern;
}
export function getNgeLantern() {
  return current;
}

/**
 * A second, coloured light somewhere else in the scene, on top of the
 * lantern (the Halloween reaper carries a red one: src/util/spooky.ts). It
 * only shows while the lantern itself is lit.
 */
export interface NgeLanternSecond {
  /** Where it is, nm. */
  posNm: Float32Array;
  /** How far it reaches, nm. */
  radiusNm: number;
  /** Its colour, rgb 0..1. */
  color: [number, number, number];
}
let second: NgeLanternSecond|null = null;
export function setNgeLanternSecond(light: NgeLanternSecond|null) {
  second = light;
}
export function getNgeLanternSecond() {
  return second;
}

const a = vec3.create(), b = vec3.create();
const ZERO = vec3.fromValues(0, 0, 0), TOWARD_EYE = vec3.fromValues(0, 0, 1);

/**
 * Where the lantern is for one view, in nanometres: the centre, lifted toward
 * that view's eye by the height. `invViewMatrix` is camera to global; the eye
 * looks down the camera's -z, so +z points back at it.
 */
export function ngeLanternPositionNm(out: Float32Array, lantern: NgeLantern, invViewMatrix: mat4) {
  const {center, scaleNm, heightNm} = lantern;
  for (let i = 0; i < 3; i++) out[i] = center[i] * scaleNm[i];
  if (heightNm > 0) {
    vec3.transformMat4(a, ZERO, invViewMatrix);
    vec3.transformMat4(b, TOWARD_EYE, invViewMatrix);
    let dx = (b[0] - a[0]) * scaleNm[0], dy = (b[1] - a[1]) * scaleNm[1], dz = (b[2] - a[2]) * scaleNm[2];
    const len = Math.hypot(dx, dy, dz);
    if (len > 0) {
      out[0] += dx / len * heightNm;
      out[1] += dy / len * heightNm;
      out[2] += dz / len * heightNm;
    }
  }
  return out;
}

/** Global coordinates to nanometres, as a matrix, times the model matrix. */
export function ngeLanternNmFromModel(out: mat4, lantern: NgeLantern, modelMat: mat4) {
  const s = lantern.scaleNm;
  // scale each ROW i of modelMat by s[i] (column major: element [col*4 + row])
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 3; row++) out[col * 4 + row] = modelMat[col * 4 + row] * s[row];
    out[col * 4 + 3] = modelMat[col * 4 + 3];
  }
  return out;
}
