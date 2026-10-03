/**
 * markers.ts, Pyr markers: "click here" pins drawn over the 3D view.
 *
 * Amy (2026-09-28) wanted the tutorial's where-to-click hints as the Pyr
 * icon rather than neuroglancer's point annotations (pink blobs). The pins
 * are DOM images laid over the perspective panel and re-projected every
 * frame with the panel's own view-projection matrix, so they follow the
 * camera and hide when the point is behind it or off the panel.
 *
 * Points are global viewer coordinates (voxels, what the position widget
 * shows). Neuroglancer's world space scales each display dimension by its
 * canonical voxel factor, so z on a 4x4x40 nm volume is multiplied by 10.
 */
import pyrIcon from './images/pyr-icon.png';

/* eslint-disable @typescript-eslint/no-explicit-any */
function getViewer(): any {
  return (window as any)['viewer'];
}

function perspectivePanel(): any {
  const viewer = getViewer();
  const panels: any[] = viewer?.display?.panels ? [...viewer.display.panels] : [];
  return panels.find(p => p.projectionParameters && p.element) ?? null;
}

let container: HTMLElement | null = null;
let pins: HTMLElement[] = [];
let points: number[][] = [];
let raf = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureStyle() {
  if (document.getElementById('nge-pyr-marker-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-pyr-marker-style';
  st.textContent = `
    .nge-pyr-markers { position: absolute; inset: 0; pointer-events: none; z-index: 6; overflow: hidden; }
    .nge-pyr-pin { position: absolute; width: 44px; height: 54px; margin-left: -22px; margin-top: -54px; display: none; }
    .nge-pyr-pin img { width: 44px; height: 44px; display: block; filter: drop-shadow(0 0 6px rgba(237, 208, 64, 0.9)) drop-shadow(0 2px 4px rgba(0,0,0,0.8)); animation: nge-pyr-bob 1.1s ease-in-out infinite; }
    .nge-pyr-pin::after { content: ''; position: absolute; left: 50%; bottom: 0; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; border: 2px solid #edd040; box-shadow: 0 0 10px 3px rgba(237, 208, 64, 0.7); animation: nge-pyr-ring 1.1s ease-in-out infinite; }
    .nge-pyr-pin--coloured img { filter: drop-shadow(0 0 7px var(--pin)) drop-shadow(0 2px 4px rgba(0,0,0,0.8)); }
    .nge-pyr-pin--coloured::after { border-color: var(--pin); box-shadow: 0 0 10px 3px var(--pin); }
    .nge-pyr-pin span { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); white-space: nowrap; font: 600 11px/1 Inter, sans-serif; letter-spacing: 0.06em; color: #edd040; text-shadow: 0 1px 3px #000; }
    @keyframes nge-pyr-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes nge-pyr-ring { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }
  `;
  document.head.appendChild(st);
}

/** Which transform turns a global voxel position into the panel's world
 *  space. Neuroglancer's convention is voxels times the canonical voxel
 *  factors, but rather than trust that, try the plausible ones and keep the
 *  one that projects the viewer's own centre position to the panel centre. */
type Convention = 'scaled' | 'plain' | 'scaled-rel' | 'plain-rel';
let convention: Convention | null = null;

function project(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw, cw];
}

function toWorld(pt: number[], pp: any): [number, number, number] {
  const f: ArrayLike<number> = pp.displayDimensionRenderInfo?.canonicalVoxelFactors ?? [1, 1, 1];
  const gp: ArrayLike<number> = pp.globalPosition ?? [0, 0, 0];
  const rel = convention === 'scaled-rel' || convention === 'plain-rel';
  const scaled = convention === 'scaled' || convention === 'scaled-rel' || convention === null;
  const p = [0, 1, 2].map(i => ((pt[i] ?? 0) - (rel ? (gp[i] ?? 0) : 0)) * (scaled ? (f[i] ?? 1) : 1));
  return [p[0], p[1], p[2]];
}

function calibrate(pp: any) {
  if (convention) return;
  const gp: ArrayLike<number> = pp.globalPosition ?? [];
  if (gp.length < 3) return;
  const m: Float32Array = pp.viewProjectionMat;
  const f: ArrayLike<number> = pp.displayDimensionRenderInfo?.canonicalVoxelFactors ?? [1, 1, 1];
  const tries: Array<[Convention, [number, number, number]]> = [
    ['scaled', [gp[0] * f[0], gp[1] * f[1], gp[2] * f[2]]],
    ['plain', [gp[0], gp[1], gp[2]]],
    ['scaled-rel', [0, 0, 0]],
    ['plain-rel', [0, 0, 0]],
  ];
  let best: Convention | null = null, bestErr = Infinity;
  for (const [name, w] of tries) {
    const [nx, ny, cw] = project(m, w[0], w[1], w[2]);
    if (!(cw > 0)) continue;
    const err = Math.hypot(nx, ny);
    if (err < bestErr) { bestErr = err; best = name; }
  }
  if (best && bestErr < 0.05) {
    convention = best;
    console.info(`[markers] world convention: ${best} (centre error ${bestErr.toFixed(4)})`);
  } else {
    console.warn('[markers] could not calibrate the projection; using scaled voxels', bestErr);
    convention = 'scaled';
  }
}

function tick() {
  raf = 0;
  const panel = perspectivePanel();
  if (!container || !panel) { raf = requestAnimationFrame(tick); return; }
  if (container.parentElement !== panel.element) {
    panel.element.appendChild(container);
    if (getComputedStyle(panel.element).position === 'static') panel.element.style.position = 'relative';
  }
  const pp = panel.projectionParameters.value;
  calibrate(pp);
  const m: Float32Array = pp.viewProjectionMat;
  const w = panel.element.clientWidth, h = panel.element.clientHeight;
  points.forEach((pt, i) => {
    const pin = pins[i];
    if (!pin || !w || !h) return;
    const [x, y, z] = toWorld(pt, pp);
    const [nx, ny, cw] = project(m, x, y, z);
    if (!(cw > 0)) { pin.style.display = 'none'; return; }
    // Off the panel: pin to the nearest edge so the learner knows which way.
    const ex = Math.max(-0.97, Math.min(0.97, nx)), ey = Math.max(-0.9, Math.min(0.97, ny));
    pin.style.display = 'block';
    pin.style.opacity = (ex !== nx || ey !== ny) ? '0.55' : '1';
    pin.style.left = `${(ex + 1) / 2 * w}px`;
    pin.style.top = `${(1 - ey) / 2 * h}px`;
  });
  raf = requestAnimationFrame(tick);
}

/**
 * Show Pyr pins at the given global points for `seconds` (0 keeps them until
 * hidePyrMarkers). Labels are optional, one per point.
 */
export function showPyrMarkers(pts: number[][], labels: string[] = [], seconds = 45, colors: string[] = []) {
  hidePyrMarkers();
  ensureStyle();
  points = pts.filter(p => Array.isArray(p) && p.length >= 3).map(p => [Number(p[0]), Number(p[1]), Number(p[2])]);
  if (!points.length) return false;
  container = document.createElement('div');
  container.className = 'nge-pyr-markers';
  pins = points.map((_, i) => {
    const pin = document.createElement('div');
    pin.className = 'nge-pyr-pin';
    const img = document.createElement('img');
    img.src = pyrIcon;
    img.alt = '';
    pin.appendChild(img);
    if (labels[i]) { const s = document.createElement('span'); s.textContent = labels[i]; if (colors[i]) s.style.color = colors[i]; pin.appendChild(s); }
    // A coloured pin (the cut tutorial's red and blue sides): glow and ring.
    if (colors[i]) {
      pin.style.setProperty('--pin', colors[i]);
      pin.classList.add('nge-pyr-pin--coloured');
    }
    container!.appendChild(pin);
    return pin;
  });
  raf = requestAnimationFrame(tick);
  if (seconds > 0) hideTimer = setTimeout(hidePyrMarkers, seconds * 1000);
  return true;
}

export function hidePyrMarkers() {
  convention = null;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  container?.remove();
  container = null;
  pins = [];
  points = [];
}
