/**
 * window.eyewire: a small, stable API for player scripts (Tampermonkey).
 *
 * Ames 2026-10-02, after asking the script writers on the forum: scripts used
 * to reach into internals that move with every deploy. This is the part we
 * promise to keep working: the current cell and view, events (claim, release,
 * complete, cells changed, dataset changed), a toolbar button, a side panel,
 * an annotation layer, and per-script settings. window.viewer stays open for
 * anything this does not cover; ask for additions on the forum.
 *
 * Rules for changing this file: add, never rename or remove. Bump VERSION
 * when something is added, and keep static/scripts.html in step.
 */
import {makeLayer} from 'neuroglancer/layer';
import {canonicalDataset, currentSegLayer, currentSegLayerName, findDatasetBySegName} from './datasets';
import {cellAtCrosshair} from './util/crosshair_cell';
import {quietly} from './util/annotation_counter';

const VERSION = 1;

type Handler = (detail: any) => void;
const handlers = new Map<string, Set<Handler>>();
const EVENTS = ['claim', 'release', 'complete', 'cellschange', 'datasetchange', 'viewchange'];

/** Tell scripts something happened. A script that throws never breaks the game. */
export function emitScriptEvent(name: string, detail: any = {}) {
  for (const fn of handlers.get(name) ?? []) {
    try { fn(detail); } catch (e) { console.warn(`[eyewire] a script's "${name}" handler failed:`, e); }
  }
  try { window.dispatchEvent(new CustomEvent(`eyewire:${name}`, { detail })); } catch { /* old browser */ }
}

export interface ScriptApiDeps {
  /** The signed in player, or null. Never a token. */
  user: () => { id: string; username: string } | null;
  /** The player's open claims and completed cells in the dataset on screen. */
  myCells: () => { taskId: number; cellId: string; status: string; dataset: string }[];
}

const viewer = (): any => (window as any).viewer;

function selectedCells(): string[] {
  const ml = currentSegLayer();
  if (!ml) return [];
  try {
    const spec = ml.toJSON?.() ?? {};
    return ((spec.segments ?? []) as any[]).map(String).filter(id => !id.startsWith('!'));
  } catch { return []; }
}

function datasetInfo() {
  const name = currentSegLayerName();
  const entry = findDatasetBySegName(name);
  return { id: canonicalDataset(name) || name, label: entry?.label || name, layer: name };
}

function position(): number[] {
  const raw = viewer()?.navigationState?.position?.value;
  return raw ? Array.from(raw as Float32Array).slice(0, 3).map(Number) : [];
}

// ── UI: toolbar buttons and side panels ─────────────────────────────────
const CSS = `
.nge-script-buttons { display: flex; align-items: center; gap: 4px; margin: 0 6px; flex-shrink: 0; }
.nge-script-buttons--floating { position: fixed; left: 12px; bottom: 12px; z-index: 900; }
.nge-script-btn { padding: 3px 9px; border-radius: 6px; cursor: pointer; font: 12px/1.4 'Inter', system-ui, sans-serif;
  color: #dce6f5; background: rgba(100, 200, 255, 0.10); border: 1px solid rgba(100, 200, 255, 0.35); white-space: nowrap; }
.nge-script-btn:hover { background: rgba(100, 200, 255, 0.22); }
.nge-script-btn:focus-visible { outline: 2px solid #7fd4ff; outline-offset: 1px; }
.nge-script-panel { position: fixed; top: 48px; right: 8px; z-index: 900; width: 300px; max-width: calc(100vw - 16px);
  max-height: calc(100vh - 64px); display: flex; flex-direction: column; border-radius: 10px;
  font: 13px/1.45 'Inter', system-ui, sans-serif; color: #dce6f5; background: rgba(8, 14, 28, 0.96);
  border: 1px solid rgba(100, 200, 255, 0.35); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }
.nge-script-panel[hidden] { display: none; }
.nge-script-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.10); font-weight: 600; }
.nge-script-panel-close { width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 15px; line-height: 1;
  color: rgba(220, 230, 245, 0.75); background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); }
.nge-script-panel-body { padding: 10px 12px; overflow: auto; }
`;
let cssIn = false;
function ensureCss() {
  if (cssIn) return;
  cssIn = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function buttonHost(): HTMLElement {
  // In the top bar when it exists, else floating at the bottom left.
  let host = document.querySelector<HTMLElement>('.nge-script-buttons');
  if (host?.isConnected) return host;
  const slot = document.getElementById('insertNGTopBar');
  host = document.createElement('div');
  host.className = 'nge-script-buttons';
  if (slot?.parentElement) slot.insertAdjacentElement('afterend', host);
  else { host.classList.add('nge-script-buttons--floating'); document.body.appendChild(host); }
  return host;
}

const cleanId = (id: string) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60) || 'script';

function addButton(opts: { id: string; label: string; title?: string; onClick: () => void }) {
  ensureCss();
  const id = `nge-script-btn-${cleanId(opts.id)}`;
  document.getElementById(id)?.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'nge-script-btn';
  btn.textContent = String(opts.label ?? opts.id).slice(0, 24);
  if (opts.title) btn.title = String(opts.title);
  btn.addEventListener('click', () => {
    try { opts.onClick(); } catch (e) { console.warn(`[eyewire] button "${opts.id}" failed:`, e); }
  });
  buttonHost().appendChild(btn);
  return { el: btn, remove: () => btn.remove() };
}

function addPanel(opts: { id: string; title?: string; open?: boolean }) {
  ensureCss();
  const id = `nge-script-panel-${cleanId(opts.id)}`;
  document.getElementById(id)?.remove();
  const panel = document.createElement('section');
  panel.id = id;
  panel.className = 'nge-script-panel';
  panel.hidden = opts.open === false;
  const head = document.createElement('div');
  head.className = 'nge-script-panel-head';
  const title = document.createElement('span');
  title.textContent = String(opts.title ?? opts.id);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nge-script-panel-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  head.append(title, close);
  const body = document.createElement('div');
  body.className = 'nge-script-panel-body';
  panel.append(head, body);
  document.body.appendChild(panel);
  const api = {
    el: body,
    open: () => { panel.hidden = false; },
    close: () => { panel.hidden = true; },
    toggle: () => { panel.hidden = !panel.hidden; },
    isOpen: () => !panel.hidden,
    remove: () => panel.remove(),
  };
  close.addEventListener('click', api.close);
  return api;
}

// ── Annotation layers ───────────────────────────────────────────────────
function findLayer(name: string): any {
  return viewer()?.layerManager?.managedLayers?.find((l: any) => l.name === name) ?? null;
}

function addAnnotationLayer(name: string, opts: { color?: string } = {}) {
  const v = viewer();
  if (!v) throw new Error('The viewer is not ready yet.');
  name = String(name).slice(0, 80);
  let managed = findLayer(name);
  if (!managed) {
    managed = makeLayer(v.layerSpecification, name, {
      type: 'annotation',
      source: { url: 'local://annotations' },
      annotationColor: opts.color || '#7fd4ff',
      annotations: [],
    });
    v.layerSpecification.add(managed);
  }
  const source = () => findLayer(name)?.layer?.localAnnotations;
  // A new layer takes a moment to get its annotation source, so additions
  // made straight away wait for it (up to 10 s) instead of failing.
  const waiting: ((src: any) => void)[] = [];
  let poll: ReturnType<typeof setInterval> | null = null;
  const withSource = (fn: (src: any) => void) => {
    const src = source();
    if (src && !waiting.length) { fn(src); return; }
    waiting.push(fn);
    if (poll) return;
    let tries = 0;
    poll = setInterval(() => {
      const ready = source();
      if (!ready && ++tries < 100) return;
      clearInterval(poll!); poll = null;
      const todo = waiting.splice(0);
      if (!ready) { console.warn(`[eyewire] annotation layer "${name}" never became ready; ${todo.length} annotation(s) dropped`); return; }
      for (const f of todo) { try { f(ready); } catch (e) { console.warn('[eyewire] adding an annotation failed:', e); } }
    }, 100);
  };
  let n = 0;
  const newId = () => `script-${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name,
    /** Add a point at [x, y, z] (voxels). Returns its id. */
    addPoint(point: number[], description = ''): string {
      const id = newId();
      // Not counted as the player's own annotation (the profile counter).
      withSource(src => quietly(() => src.add({ id, type: 0 /* POINT */, point: Float32Array.from(point.slice(0, 3)), properties: [], description: String(description) }, true)));
      return id;
    },
    /** Add a line from a to b (voxels). Returns its id. */
    addLine(a: number[], b: number[], description = ''): string {
      const id = newId();
      withSource(src => quietly(() => src.add({ id, type: 1 /* LINE */, pointA: Float32Array.from(a.slice(0, 3)), pointB: Float32Array.from(b.slice(0, 3)), properties: [], description: String(description) }, true)));
      return id;
    },
    /** Everything in the layer, as plain objects. */
    list(): any[] {
      try { return (findLayer(name)?.toJSON?.()?.annotations ?? []) as any[]; } catch { return []; }
    },
    /** Remove one annotation by id. */
    removeAnnotation(id: string) {
      withSource(src => { try { const ref = src.getReference(id); if (ref) { src.delete(ref); ref.dispose(); } } catch { /* already gone */ } });
    },
    /** Remove the whole layer. */
    remove() {
      const m = findLayer(name);
      if (m) viewer().layerManager.removeManagedLayer(m);
    },
  };
}

// ── Settings: one small JSON object per script, in this browser ─────────
function settings(namespace: string) {
  const key = `nge-script:${cleanId(namespace)}`;
  const read = (): Record<string, any> => {
    try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  };
  return {
    get: (name: string, fallback?: any) => { const all = read(); return name in all ? all[name] : fallback; },
    set: (name: string, value: any) => { const all = read(); all[name] = value; try { localStorage.setItem(key, JSON.stringify(all)); } catch { /* full or private mode */ } },
    all: read,
    clear: () => { try { localStorage.removeItem(key); } catch { /* */ } },
  };
}

/** Call once the viewer exists. */
export function installScriptApi(v: any, deps: ScriptApiDeps) {
  if ((window as any).eyewire) return;

  // cellschange and datasetchange and viewchange come from the view itself.
  let lastCells = selectedCells();
  let lastDataset = datasetInfo().id;
  let timer: ReturnType<typeof setTimeout> | null = null;
  v.state.changed.add(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const ds = datasetInfo();
      if (ds.id !== lastDataset) { lastDataset = ds.id; emitScriptEvent('datasetchange', { dataset: ds }); }
      const now = selectedCells();
      if (now.length !== lastCells.length || now.some((id, i) => id !== lastCells[i])) {
        const before = new Set(lastCells), after = new Set(now);
        emitScriptEvent('cellschange', {
          selected: now,
          added: now.filter(id => !before.has(id)),
          removed: lastCells.filter(id => !after.has(id)),
        });
        lastCells = now;
      }
      if (handlers.get('viewchange')?.size) emitScriptEvent('viewchange', { position: position() });
    }, 150);
  });

  const api = {
    version: VERSION,
    /** The neuroglancer viewer, for anything the API does not cover. May change between updates. */
    get viewer() { return viewer(); },
    events: EVENTS.slice(),
    /** Listen for an event. Returns a function that stops listening. */
    on(name: string, fn: Handler) {
      if (!EVENTS.includes(name)) console.warn(`[eyewire] unknown event "${name}". Known: ${EVENTS.join(', ')}`);
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(fn);
      return () => { handlers.get(name)?.delete(fn); };
    },
    off(name: string, fn: Handler) { handlers.get(name)?.delete(fn); },
    user: () => deps.user(),
    dataset: datasetInfo,
    view: {
      /** The whole view as JSON: layers, selected cells, position, annotations. */
      get: () => viewer().state.toJSON(),
      /** Replace the whole view. */
      set: (state: any) => viewer().state.restoreState(state),
      position,
      /** Move the crosshairs to [x, y, z] (voxels). */
      goTo(point: number[]) {
        const pos = viewer().navigationState.position;
        const next = Float32Array.from(pos.value);
        for (let i = 0; i < 3 && i < point.length; i++) next[i] = Number(point[i]);
        pos.value = next;
      },
    },
    cells: {
      /** Ids of the cells selected (visible) in the dataset's segmentation layer. */
      selected: selectedCells,
      /** The cell under the crosshairs: { position, supervoxel, root, problem? }. */
      atCrosshair: () => cellAtCrosshair(),
      /** Your open claims and completed cells in this dataset. */
      mine: () => deps.myCells(),
    },
    ui: { addButton, addPanel },
    annotations: { addLayer: addAnnotationLayer },
    settings,
  };
  (window as any).eyewire = Object.freeze(api);
  emitScriptEvent('ready', { version: VERSION });
}
