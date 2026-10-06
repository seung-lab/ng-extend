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
import { makeLayer } from 'neuroglancer/layer';

/* eslint-disable @typescript-eslint/no-explicit-any */
function getViewer(): any {
  return (window as any)['viewer'];
}

function perspectivePanel(): any {
  const viewer = getViewer();
  const panels: any[] = viewer?.display?.panels ? [...viewer.display.panels] : [];
  // Slice panels have no projectionParameters; prefer the one that owns the
  // "show slices" control in case that ever changes.
  return panels.find(p => p.projectionParameters && p.element?.querySelector?.('.perspective-panel-show-slice-views'))
    ?? panels.find(p => p.projectionParameters && p.element) ?? null;
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
    /* Coloured pins (the cut tutorial's red and blue sides): the Pyr icon
       itself in that colour, smaller, and still (Ames: a cluster of bobbing,
       pulsing pins was too much). The icon is cyan, so it is drawn in grey
       and washed with the colour through a mask of its own shape, which
       keeps the facets' shading (turning the hue gave pink and olive). */
    .nge-pyr-pin--coloured { width: 30px; height: 38px; margin-left: -15px; margin-top: -38px; }
    .nge-pyr-gem { position: relative; display: block; width: 30px; height: 30px; isolation: isolate; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.9)); }
    .nge-pyr-pin--coloured .nge-pyr-gem img { width: 30px; height: 30px; animation: none; filter: grayscale(1) brightness(1.25) contrast(1.05); }
    .nge-pyr-gem i { position: absolute; inset: 0; background: var(--pin); mix-blend-mode: multiply;
      -webkit-mask: var(--pin-icon) center / contain no-repeat; mask: var(--pin-icon) center / contain no-repeat; }
    .nge-pyr-pin--coloured::after { width: 8px; height: 8px; margin-left: -4px; border-width: 0; background: var(--pin); box-shadow: 0 0 6px 1px var(--pin); animation: none; }
    .nge-pyr-pin span { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); white-space: nowrap; font: 600 11px/1 Inter, sans-serif; letter-spacing: 0.06em; color: #edd040; text-shadow: 0 1px 3px #000; }
    @keyframes nge-pyr-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes nge-pyr-ring { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }
  `;
  document.head.appendChild(st);
}

/**
 * Viewer voxels go into the panel's view-projection matrix as they are.
 * neuroglancer builds that matrix with the camera at the position in voxel
 * coordinates and the per-axis scaling folded in (navigation_state.ts,
 * DisplayPose.toMat4), so nothing is multiplied here.
 *
 * This used to guess between conventions by seeing which one put the
 * camera's own position at the centre of the panel. Every point on the line
 * of sight does that, so the guess picked "z times 10", and each pin landed
 * off the panel and was parked in the top left corner (Ames, 2026-10-06;
 * also why "Show me where to click" never showed on the Merge tutorial).
 * Checked against the live app: the position projects to (0, 0) as is.
 */
function project(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw, cw];
}

function toWorld(pt: number[]): [number, number, number] {
  return [pt[0] ?? 0, pt[1] ?? 0, pt[2] ?? 0];
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
  const w = panel.element.clientWidth, h = panel.element.clientHeight;
  points.forEach((pt, i) => {
    const pin = pins[i];
    if (!pin || !w || !h) return;
    const [x, y, z] = toWorld(pt);
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
      pin.style.setProperty('--pin-icon', `url("${pyrIcon}")`);
      // Wrap the icon so the colour wash can sit exactly over it.
      // A div: the label rule above targets every span in a pin.
      const gem = document.createElement('div');
      gem.className = 'nge-pyr-gem';
      pin.insertBefore(gem, img);
      gem.appendChild(img);
      gem.appendChild(document.createElement('i'));
      pin.classList.add('nge-pyr-pin--coloured');
    }
    container!.appendChild(pin);
    return pin;
  });
  raf = requestAnimationFrame(tick);
  if (seconds > 0) hideTimer = setTimeout(hidePyrMarkers, seconds * 1000);
  return true;
}

/**
 * Gem markers: real points in the viewer, drawn as Pyr gems in 3D and dots
 * in 2D, in their own small annotation layers (the way Highlight Mode shows
 * its start point, util/highlight.ts). Unlike the pins above, which are
 * pictures laid over the panel, these are part of the scene: a neuron in
 * front hides them (Ames, 2026-10-06), and they show on the 2D images too.
 * One layer per group, named for what it is, removed by hidePyrMarkers.
 */
const GEM_LAYERS = new Set<string>();

function managedLayer(name: string): any {
  return getViewer()?.layerManager?.managedLayers?.find((l: any) => l.name === name && !l.archived);
}

export function showGemMarkers(groups: Array<{ name: string; color: string; points: number[][] }>): boolean {
  const viewer = getViewer();
  if (!viewer?.layerSpecification) return false;
  hideGemMarkers();
  let shown = false;
  for (const g of groups) {
    const pts = g.points.filter(p => Array.isArray(p) && p.length >= 3);
    if (!pts.length) continue;
    try {
      viewer.layerSpecification.add(makeLayer(viewer.layerSpecification, g.name, {
        type: 'annotation', source: 'local://annotations',
        annotations: pts.map((p, i) => ({ type: 'point', id: `${g.name}-${i}`, point: [p[0], p[1], p[2]] })),
        annotationColor: g.color, pointMarker: 'pyr', pointSize: 1.4,
        // Not pickable: a Ctrl+click on a gem must reach the cell under it,
        // or the learner's own cut point would not land.
        pick: false,
      }));
      GEM_LAYERS.add(g.name);
      shown = true;
    } catch (e) {
      console.warn('[markers] could not add the hint layer', g.name, e);
    }
  }
  return shown;
}

export function hideGemMarkers() {
  const viewer = getViewer();
  for (const name of GEM_LAYERS) {
    const managed = managedLayer(name);
    if (managed) { try { viewer.layerManager.removeManagedLayer(managed); } catch (e) { /* already gone */ } }
  }
  GEM_LAYERS.clear();
}

export function hidePyrMarkers() {
  hideGemMarkers();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  container?.remove();
  container = null;
  pins = [];
  points = [];
}
