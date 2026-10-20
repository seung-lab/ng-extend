/**
 * EyeWire II hover outline and halo (ngeHoverStyle in
 * segmentation_display_state/frontend.ts): the shells drawn around the cell
 * under the mouse. Drawn by perspective_view/panel.ts through
 * MeshLayer.ngeDrawShells (mesh/frontend.ts). Kept apart so both can import
 * it without importing each other.
 */
export type NgeShell = {widthPx: number, alpha: number};

/** On while the wireframe pass draws: mesh/frontend.ts then draws each
 *  fragment as the edges of its triangles. */
export const ngeWireframePass = {on: false};

/** The wireframe: the mesh's own lines on its surface, in a bright tint of
 *  the cell's colour over its dimmed body. */
export const NGE_WIREFRAME_SHELLS: NgeShell[] = [{widthPx: 0, alpha: 0.9}];

/** The outline: one crisp line. */
export const NGE_OUTLINE_SHELLS: NgeShell[] = [{widthPx: 2.5, alpha: 1}];

/** The halo: shells fading outward. Each pixel keeps its brightest shell
 *  (MAX blending), so overlapping triangles never pile up to white. */
export const NGE_HALO_SHELLS: NgeShell[] = [
  // Ames 2026-10-20, after 14 px (too much), 7 px at half strength (too dim)
  // and 9 px breathing ("I do like the final stage with the slim line
  // border"): a slim bright line with a short soft edge.
  {widthPx: 1.2, alpha: 1}, {widthPx: 2.2, alpha: 0.42}, {widthPx: 3.4, alpha: 0.14},
];
