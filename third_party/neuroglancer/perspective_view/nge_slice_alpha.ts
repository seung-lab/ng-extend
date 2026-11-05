/**
 * EyeWire II: how solid the 2D slice is in the 3D view (lalonso, report 322;
 * Ames 2026-11-01). 1 draws it as neuroglancer always has. Below 1 the cells
 * behind it show through. This browser remembers it. The 2D view is untouched.
 */
import {TrackableValue} from 'neuroglancer/trackable_value';

const KEY = 'nge_slice_opacity_3d';
const clamp = (x: any) => {
  const v = Number(x);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
};
let start = 1;
try {
  const saved = localStorage.getItem(KEY);
  if (saved !== null) start = clamp(saved);
} catch { /* a private window */ }
export const ngeSliceAlpha = new TrackableValue<number>(start, clamp);
ngeSliceAlpha.changed.add(() => {
  try { localStorage.setItem(KEY, String(ngeSliceAlpha.value)); } catch { /* a private window */ }
});
