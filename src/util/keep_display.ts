/**
 * Keep your own display settings when the Cell Library loads a cell's view
 * (Nseraf via Amy 2026-09-30: "when I click the jump to segment it resets
 * opacity and other settings ... keep my settings unless I click someone
 * else's link"). A cell's Start link or saved view carries its creator's
 * opacity, layout and so on; we snapshot yours first and put them back once
 * the new view has loaded. Shared links (chat, My Links) are not touched.
 *
 * Only look-and-feel is kept: segment and image opacity, saturation, blend,
 * image shader and its controls, layout, background colours, scale bar, axis
 * lines, 3D slices. Position, segments and annotation layers come from the
 * cell's view as before.
 */
type Getter = (o: any) => any;

const VIEWER_KEYS: [string, Getter][] = [
  ['layout', v => v.layout],
  ['showSlices', v => v.showPerspectiveSliceViews],
  ['showAxisLines', v => v.showAxisLines],
  ['showScaleBar', v => v.showScaleBar],
  ['crossSectionBackgroundColor', v => v.crossSectionBackgroundColor],
  ['projectionBackgroundColor', v => v.perspectiveViewBackgroundColor],
];
const LAYER_KEYS: Record<string, [string, Getter][]> = {
  segmentation: [
    ['selectedAlpha', l => l.displayState?.selectedAlpha],
    ['notSelectedAlpha', l => l.displayState?.notSelectedAlpha],
    ['objectAlpha', l => l.displayState?.objectAlpha],
    ['saturation', l => l.displayState?.saturation],
  ],
  image: [
    ['opacity', l => l.opacity],
    ['blend', l => l.blendMode],
    ['shader', l => l.fragmentMain],
    ['shaderControls', l => l.shaderControlState],
  ],
};

// ── Annotation point size, by layer name (annkri 2026-10-06) ────────────────
// The size of a layer's points is set on the layer (the Annotations tab) and
// travels in the view. Each Cell Library cell opens its own view with its own
// layers (on Retina: Soma, True End, Can't Fix, Hits Edge, Notes), so the size
// fell back to the small default on every new cell. The size a player set on a
// layer is carried to the layer of the same name in the next cell, and kept in
// the browser so the first cell of a session gets it too.
// "Show through cells in 3D" (the layer's onTop) is carried the same way.
const SIZES_KEY = 'nge-annotation-point-sizes';
const ON_TOP_KEY = 'nge-annotation-on-top';
type Sizes = Record<string, number>;
const annotationState = (ml: any): any =>
  ml?.layer?.constructor?.type === 'annotation' ? ml.layer.annotationDisplayState : undefined;
const annotationSize = (ml: any): any => annotationState(ml)?.ngeSize;
function storedOnTop(): Record<string, boolean> {
  try { const v = JSON.parse(localStorage.getItem(ON_TOP_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function currentOnTop(viewer: any): Record<string, boolean> {
  const now: Record<string, boolean> = {};
  for (const ml of viewer.layerManager.managedLayers) {
    const onTop = annotationState(ml)?.ngeOnTop;
    if (ml.archived || !onTop || !ml.name) continue;
    now[ml.name] = !!onTop.value;
  }
  const all = { ...storedOnTop(), ...now };
  try {
    const names = Object.keys(all);
    for (const name of names.slice(0, Math.max(0, names.length - 80))) delete all[name];
    localStorage.setItem(ON_TOP_KEY, JSON.stringify(all));
  } catch { /* private mode */ }
  return all;
}
function applyOnTop(want: Record<string, boolean>, before: Set<unknown>) {
  const viewer: any = (window as any).viewer;
  for (const ml of viewer.layerManager.managedLayers) {
    if (before.has(ml) || ml.archived) continue;
    const onTop = annotationState(ml)?.ngeOnTop;
    if (!onTop || typeof want[ml.name] !== 'boolean' || onTop.value === want[ml.name]) continue;
    try { onTop.value = want[ml.name]; } catch { /* skip */ }
  }
}
function storedSizes(): Sizes {
  try { const v = JSON.parse(localStorage.getItem(SIZES_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
/** The size of each annotation layer on screen, by name; also saved. */
function currentSizes(viewer: any): Sizes {
  const now: Sizes = {};
  for (const ml of viewer.layerManager.managedLayers) {
    const size = annotationSize(ml)?.value;
    if (ml.archived || typeof size !== 'number' || !ml.name) continue;
    now[ml.name] = size;
  }
  const all = { ...storedSizes(), ...now };
  try {
    const names = Object.keys(all);
    // Keep the list small: layer names are few, but never let it grow without end.
    for (const name of names.slice(0, Math.max(0, names.length - 80))) delete all[name];
    localStorage.setItem(SIZES_KEY, JSON.stringify(all));
  } catch { /* private mode */ }
  return all;
}
function applySizes(sizes: Sizes, before: Set<unknown>) {
  const viewer: any = (window as any).viewer;
  for (const ml of viewer.layerManager.managedLayers) {
    if (before.has(ml) || ml.archived) continue;
    const size = annotationSize(ml);
    const want = sizes[ml.name];
    if (!size || typeof want !== 'number' || !(want >= 0.25 && want <= 20) || size.value === want) continue;
    try { size.value = want; } catch { /* skip */ }
  }
}

interface Snapshot {
  sizes: Sizes;
  onTop: Record<string, boolean>;
  viewer: Record<string, unknown>;
  layers: Record<string, Record<string, unknown>>;  // by layer type
  before: Set<unknown>;                             // managed layers before the load
}

const layerType = (ml: any): string => ml?.layer?.constructor?.type ?? '';

export function snapshotDisplay(): Snapshot | null {
  const viewer: any = (window as any).viewer;
  if (!viewer) return null;
  const snap: Snapshot = { sizes: currentSizes(viewer), onTop: currentOnTop(viewer), viewer: {}, layers: {}, before: new Set(viewer.layerManager.managedLayers) };
  for (const [key, get] of VIEWER_KEYS) {
    try { const t = get(viewer); if (t?.toJSON) snap.viewer[key] = t.toJSON(); } catch { /* skip */ }
  }
  for (const ml of viewer.layerManager.managedLayers) {
    const type = layerType(ml);
    if (!LAYER_KEYS[type] || snap.layers[type] || ml.archived) continue;
    const vals: Record<string, unknown> = {};
    for (const [key, get] of LAYER_KEYS[type]) {
      try { const t = get(ml.layer); if (t?.toJSON) vals[key] = t.toJSON(); } catch { /* skip */ }
    }
    snap.layers[type] = vals;
  }
  return snap;
}

function apply(snap: Snapshot, layers: any[]) {
  const viewer: any = (window as any).viewer;
  for (const [key, get] of VIEWER_KEYS) {
    if (!(key in snap.viewer)) continue;
    try { get(viewer)?.restoreState(snap.viewer[key]); } catch { /* skip */ }
  }
  for (const ml of layers) {
    const vals = snap.layers[layerType(ml)];
    if (!vals) continue;
    for (const [key, get] of LAYER_KEYS[layerType(ml)]) {
      if (!(key in vals)) continue;
      try { get(ml.layer)?.restoreState(vals[key]); } catch { /* skip */ }
    }
  }
  applySizes(snap.sizes, snap.before);
  applyOnTop(snap.onTop, snap.before);
}

/** When the new view lands, put the snapshot back (twice: some settings
 *  arrive a beat after the layer does).
 *
 *  This used to poll for the new layers and give up after 15 s. A saved view
 *  is fetched from the state server, and when that took longer the cell
 *  opened with the link's own layout, often 3D only, and the player's 2D
 *  panels never came back (Ames 2026-10-04: "Lost 2D after jumping to
 *  claimed cell"). Now it waits for the load itself: neuroglancer applies a
 *  link by calling viewer.state.restoreState, so watch that call. */
const LOAD_LIMIT_MS = 120000;
export function restoreDisplayAfterLoad(snap: Snapshot | null) {
  if (!snap) return;
  const viewer: any = (window as any).viewer;
  const state: any = viewer?.state;
  if (!state?.restoreState) return;
  // Phones already wrap restoreState on the instance (store.ts): put back
  // exactly what was there rather than deleting it.
  const hadOwn = Object.prototype.hasOwnProperty.call(state, 'restoreState');
  const previous = state.restoreState;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (state.restoreState !== watching) return;      // someone wrapped after us: leave theirs
    if (hadOwn) state.restoreState = previous; else delete state.restoreState;
  };
  const watching = function (this: any, obj: unknown) {
    previous.call(state, obj);
    if (done) return;
    const fresh = viewer.layerManager.managedLayers.filter((ml: any) =>
      !snap.before.has(ml) && !ml.archived && ml.layer && LAYER_KEYS[layerType(ml)]);
    if (!fresh.length) return;                        // not the view we are waiting for
    finish();
    apply(snap, fresh);
    setTimeout(() => apply(snap, fresh), 700);
  };
  state.restoreState = watching;
  setTimeout(finish, LOAD_LIMIT_MS);
}

export function keepDisplayEnabled(): boolean {
  try { return JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}').keepDisplayOnJump !== false; } catch { return true; }
}
