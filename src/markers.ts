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
    .nge-pyr-pin span { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); white-space: nowrap; font: 600 11px/1 Inter, sans-serif; letter-spacing: 0.06em; color: #edd040; text-shadow: 0 1px 3px #000; }
    @keyframes nge-pyr-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes nge-pyr-ring { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }
  `;
  document.head.appendChild(st);
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
  const m: Float32Array = pp.viewProjectionMat;
  const f: ArrayLike<number> = pp.displayDimensionRenderInfo?.canonicalVoxelFactors ?? [1, 1, 1];
  const w = panel.element.clientWidth, h = panel.element.clientHeight;
  points.forEach((pt, i) => {
    const pin = pins[i];
    if (!pin || !w || !h) return;
    const x = pt[0] * (f[0] ?? 1), y = pt[1] * (f[1] ?? 1), z = pt[2] * (f[2] ?? 1);
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(cw > 0)) { pin.style.display = 'none'; return; }
    const nx = cx / cw, ny = cy / cw;
    if (nx < -1.05 || nx > 1.05 || ny < -1.05 || ny > 1.05) { pin.style.display = 'none'; return; }
    pin.style.display = 'block';
    pin.style.left = `${(nx + 1) / 2 * w}px`;
    pin.style.top = `${(1 - ny) / 2 * h}px`;
  });
  raf = requestAnimationFrame(tick);
}

/**
 * Show Pyr pins at the given global points for `seconds` (0 keeps them until
 * hidePyrMarkers). Labels are optional, one per point.
 */
export function showPyrMarkers(pts: number[][], labels: string[] = [], seconds = 45) {
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
    if (labels[i]) { const s = document.createElement('span'); s.textContent = labels[i]; pin.appendChild(s); }
    container!.appendChild(pin);
    return pin;
  });
  raf = requestAnimationFrame(tick);
  if (seconds > 0) hideTimer = setTimeout(hidePyrMarkers, seconds * 1000);
  return true;
}

export function hidePyrMarkers() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  container?.remove();
  container = null;
  pins = [];
  points = [];
}
