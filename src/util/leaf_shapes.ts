/**
 * Autumn leaf shapes and colours, shared by the falling leaves
 * (src/util/leaves.ts), the leaf confetti (ConfettiCelebration.vue) and the
 * November point particles (src/util/season.ts). Each shape is about 1 unit
 * long with its stem end at the bottom.
 */

/** Red, orange, gold and brown, bright enough to read on the dark screen. */
export const AUTUMN = ['#e8552b', '#f28c28', '#f6c142', '#d63f2f', '#b8692c', '#f2a03d'];

/** A maple leaf's outline: five points. */
export const MAPLE: [number, number][] = [
  [0, 0.5], [0.06, 0.22], [0.42, 0.3], [0.32, 0.08], [0.5, -0.05], [0.28, -0.12], [0.33, -0.38], [0.12, -0.28],
  [0, -0.5], [-0.12, -0.28], [-0.33, -0.38], [-0.28, -0.12], [-0.5, -0.05], [-0.32, 0.08], [-0.42, 0.3], [-0.06, 0.22],
];

let shapes: Path2D[] | null = null;
/** Maple (twice as often), oak and a plain pointed leaf. */
export function leafShapes(): Path2D[] {
  if (shapes) return shapes;
  const maple = new Path2D('M' + MAPLE.map(p => p.join(',')).join(' L') + ' Z');
  const oak = new Path2D('M0,0.5 C0.08,0.4 0.22,0.38 0.2,0.24 C0.34,0.24 0.36,0.1 0.24,0.06 C0.36,0.0 0.34,-0.16 0.2,-0.14 C0.28,-0.28 0.18,-0.42 0.06,-0.34 C0.04,-0.46 -0.04,-0.46 -0.06,-0.34 C-0.18,-0.42 -0.28,-0.28 -0.2,-0.14 C-0.34,-0.16 -0.36,0.0 -0.24,0.06 C-0.36,0.1 -0.34,0.24 -0.2,0.24 C-0.22,0.38 -0.08,0.4 0,0.5 Z');
  const plain = new Path2D('M0,0.5 C0.3,0.3 0.3,-0.2 0,-0.5 C-0.3,-0.2 -0.3,0.3 0,0.5 Z');
  shapes = [maple, maple, oak, plain];
  return shapes;
}

let vein: Path2D | null = null;
/** The centre vein, drawn faintly over a leaf. */
export function leafVein(): Path2D { return vein ??= new Path2D('M0,0.5 L0,-0.4'); }

export const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
