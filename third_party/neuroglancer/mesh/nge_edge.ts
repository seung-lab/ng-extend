/**
 * EyeWire II Hunt: the edge of the dataset, on the cells themselves (Ames
 * 2026-10-23: "Can you actually highlight the 3D mesh tho?"). Where a cell
 * comes within marginNm of the segmentation volume's sides, it runs out of the
 * data there, and it is drawn in the edge colour.
 *
 * Done in the mesh vertex shader (mesh/frontend.ts), like the lantern: each
 * vertex is coloured by its distance, in nanometres, from the volume's sides.
 * Colour passes only, so picking is untouched. The app owns when it shows
 * (src/hunt.ts); this file is only what the renderer reads.
 */
export interface NgeMeshEdge {
  /** The volume's low and high corners, nm. */
  lo: number[];
  hi: number[];
  /** This close to a side is the edge, nm (the Hunt's judging uses the same). */
  marginNm: number;
  /** Nanometres per global unit, per axis. */
  scaleNm: Float32Array;
  /** rgb 0..1 */
  color: [number, number, number];
}

let current: NgeMeshEdge|null = null;
export function setNgeMeshEdge(edge: NgeMeshEdge|null) {
  current = edge;
}
export function getNgeMeshEdge() {
  return current;
}
