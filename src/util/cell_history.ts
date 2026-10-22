/**
 * Watch it grow (Nseraf, triage #194; Ames 2026-10-22: 3D only). A slider
 * through a cell's edits, oldest to newest, showing the cell as it was at
 * each one in the 3D view, with who made the edit, when, and whether it
 * joined pieces or cut one off. A play button steps through on a timer, for
 * screen recordings.
 *
 * How the past cell is found: one supervoxel inside today's cell (the
 * anchor) never changes, so the chunked graph's root for it at a moment is
 * what the cell was then. Old roots keep their meshes.
 *
 * How it is shown without touching the player's view: the past cell is drawn
 * in a temporary layer of its own that reads only the meshes (no 2D, no
 * proofreading graph), and today's cell is unticked in its layer while the
 * panel is open. Closing puts both back. If the tab goes away with the panel
 * open, the next page load does the same (recoverCellHistory).
 */
import { makeLayer } from 'neuroglancer/layer';
import { Uint64 } from 'neuroglancer/util/uint64';
import { getBaseObjectColor } from 'neuroglancer/segmentation_display_state/frontend';
import { currentSegLayer } from '../datasets';
import { authHeaders, getPcgInfo, getRootFromSupervoxel, getSelectedSupervoxelId } from '../widgets/pcg_service';
import { supervoxelAtPlace } from './crosshair_cell';
import { supabase } from '../supabase';
import { useProofreadingBackendStore } from '../store';
import { parseChangeLog, historySteps, editorName, type HistoryEdit, type HistoryStep } from './cell_history_steps';
import './cell_history.css';

const SHOW_LAYER = 'Cell history (temporary)';
const AHEAD_LAYER = 'Cell history, next steps (temporary)';
const OPEN_KEY = 'nge_cell_history_open';
const LOOK_AHEAD = 3;
const MAX_LOOKUPS = 4;
const SPEEDS = [
  { label: 'Slow', ms: 2000 },
  { label: 'Normal', ms: 1000 },
  { label: 'Fast', ms: 450 },
];

const viewerOf = (): any => (window as any).viewer;
const isNumericId = (id: unknown): id is string => typeof id === 'string' && /^\d+$/.test(id) && id !== '0';
/** A supervoxel lives on level 1 of the graph (the top 8 bits of its id). */
const isSupervoxel = (id: string) => isNumericId(id) && Math.floor(Number(id) / 2 ** 56) === 1;

function managedByName(name: string): any {
  return viewerOf()?.layerManager?.managedLayers?.find((l: any) => l.name === name && !l.archived);
}
function groupOf(ml: any): any {
  return ml?.layer?.displayState?.segmentationGroupState?.value;
}

// ─── Talking to the chunked graph ───────────────────────────────────────────

async function fetchEdits(root: string): Promise<HistoryEdit[]> {
  const pcg = getPcgInfo();
  if (!pcg) throw Error('no graph');
  const res = await fetch(`${pcg.server}/segmentation/api/v1/table/${pcg.table}/root/${root}/tabular_change_log`,
    { headers: authHeaders(pcg.server) });
  if (!res.ok) throw Error(`change log ${res.status}`);
  return parseChangeLog(await res.json(), root);
}

/** The root of a supervoxel at a moment (milliseconds). Read as text: the
 *  ids are 18 digits and a JSON number would round them. */
async function rootAt(sv: string, at: number): Promise<string | null> {
  const pcg = getPcgInfo();
  if (!pcg) return null;
  const res = await fetch(
    `${pcg.server}/segmentation/api/v1/table/${pcg.table}/node/${sv}/root?int64_as_str=1&timestamp=${(at / 1000).toFixed(3)}`,
    { headers: authHeaders(pcg.server) });
  if (!res.ok) return null;
  const m = (await res.text()).match(/"root_id"\s*:\s*"?(\d+)/);
  return m && m[1] !== '0' ? m[1] : null;
}

/** Pyr names for lab logins, where the login is a Pyr player's. */
async function playerNames(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(userIds.filter(isNumericId))].slice(0, 500);
  if (!ids.length) return names;
  try {
    const { data } = await supabase.from('users').select('cave_user_id, username').in('cave_user_id', ids.map(Number));
    for (const row of (data ?? []) as any[]) {
      if (row?.cave_user_id != null && row.username) names.set(String(row.cave_user_id), String(row.username));
    }
  } catch { /* names stay unknown */ }
  return names;
}

// ─── A supervoxel inside today's cell ───────────────────────────────────────

async function insideCell(sv: string | null | undefined, root: string): Promise<string | null> {
  if (!sv || !isSupervoxel(sv)) return null;
  return (await getRootFromSupervoxel(sv).catch(() => null)) === root ? sv : null;
}

/** Without asking the player: the claim's own anchor or soma point, the
 *  supervoxel last pointed at, or the one at the crosshairs. */
async function findAnchor(root: string): Promise<string | null> {
  try {
    const backend = useProofreadingBackendStore();
    const t: any = backend.tasks.find((t: any) => backend.isTaskCell(t, root));
    if (t) {
      const sv = await insideCell(t.supervoxel_id, root);
      if (sv) return sv;
      const p = [t.claim_point_x, t.claim_point_y, t.claim_point_z];
      if (p.every(n => typeof n === 'number' && Number.isFinite(n)) && p.some(n => n !== 0)) {
        const at = await insideCell(await supervoxelAtPlace(p), root);
        if (at) return at;
      }
    }
  } catch { /* no claims loaded */ }
  const picked = await insideCell(getSelectedSupervoxelId(), root);
  if (picked) return picked;
  const pos = viewerOf()?.navigationState?.position?.value;
  if (pos) {
    const at = await insideCell(await supervoxelAtPlace(Array.from(pos as Float32Array)), root);
    if (at) return at;
    try {
      const value = currentSegLayer()?.layer?.getValueAt?.(pos, { pickedRenderLayer: null });
      const sv = value == null ? '' : String(Array.isArray(value) ? value[0] : value);
      const there = await insideCell(sv, root);
      if (there) return there;
    } catch { /* nothing loaded there */ }
  }
  return null;
}

/** The supervoxel the mouse is on, when it is on this cell: in a 2D view,
 *  the hover readout's own supervoxel; in 3D, the stored volume at the
 *  point on the surface. */
async function anchorUnderMouse(root: string): Promise<string | null> {
  const picked = await insideCell(getSelectedSupervoxelId(), root);
  if (picked) return picked;
  const viewer = viewerOf();
  const ms = viewer?.mouseState;
  const sel = currentSegLayer()?.layer?.displayState?.segmentSelectionState;
  if (!ms?.active || !sel?.hasSelectedSegment || String(sel.selectedSegment) !== root) return null;
  return insideCell(await supervoxelAtPlace(Array.from(ms.position as Float32Array)), root);
}

// ─── Putting things back ────────────────────────────────────────────────────

function removeTempLayers() {
  const lm = viewerOf()?.layerManager;
  for (const ml of [...(lm?.managedLayers ?? [])]) {
    if (ml.name === SHOW_LAYER || ml.name === AHEAD_LAYER) {
      try { lm.removeManagedLayer(ml); } catch { /* already gone */ }
    }
  }
}

function tickAgain(root: string) {
  const group = groupOf(currentSegLayer());
  if (!group) return false;
  const id = Uint64.parseString(root);
  if (group.selectedSegments.has(id) && !group.visibleSegments.has(id)) group.visibleSegments.add(id);
  return true;
}

/** After a page load: a history panel left open when the tab went away
 *  leaves its layers in the saved view and today's cell unticked. Put both
 *  right once the viewer has its layers. */
export function recoverCellHistory() {
  let left: { root?: string } | null = null;
  try { left = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null'); } catch { left = null; }
  let tries = 0;
  const look = () => {
    // A panel opened since: its layers are wanted.
    if (closeOpen) return;
    const lm = viewerOf()?.layerManager;
    if (lm?.managedLayers?.length) {
      removeTempLayers();
      if (left?.root && tickAgain(left.root)) {
        left = null;
        try { localStorage.removeItem(OPEN_KEY); } catch { /* */ }
      }
    }
    if (++tries < 30) setTimeout(look, 1000);
  };
  setTimeout(look, 1500);
}

// ─── The panel ──────────────────────────────────────────────────────────────

let closeOpen: (() => void) | null = null;

export function openCellHistory(root: string) {
  closeOpen?.();
  const viewer = viewerOf();
  const main = currentSegLayer();
  if (!viewer || !main?.layer || !getPcgInfo()) return;

  let closed = false;
  let steps: HistoryStep[] = [];
  let edits: HistoryEdit[] = [];
  let names = new Map<string, string>();
  let anchor: string | null = null;
  let current = -1;
  let shown: string | null = null;
  let hidMain = false;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | null = null;
  let pointTimer: ReturnType<typeof setInterval> | null = null;
  let speed = SPEEDS[1].ms;

  // ── DOM ──
  const panel = document.createElement('div');
  panel.className = 'nge-ch';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Watch it grow');
  panel.innerHTML = `
    <div class="nge-ch-head">
      <div><div class="nge-ch-eyebrow">Watch it grow</div><div class="nge-ch-id"></div></div>
      <button type="button" class="nge-ch-close" title="Close and show today's cell again" aria-label="Close">×</button>
    </div>
    <div class="nge-ch-step" hidden><span class="nge-ch-count"></span><span class="nge-ch-kind"></span></div>
    <div class="nge-ch-who" hidden></div>
    <div class="nge-ch-status" role="status" aria-live="polite"></div>
    <input class="nge-ch-slider" type="range" min="0" max="0" value="0" hidden aria-label="Step through the cell's history">
    <div class="nge-ch-controls" hidden>
      <button type="button" class="nge-ch-btn nge-ch-back" title="One step back" aria-label="One step back">‹</button>
      <button type="button" class="nge-ch-btn nge-ch-play" title="Play through the history">▶ Play</button>
      <button type="button" class="nge-ch-btn nge-ch-fwd" title="One step forward" aria-label="One step forward">›</button>
      <label class="nge-ch-speed">Speed <select></select></label>
    </div>
    <div class="nge-ch-note" hidden></div>`;
  const $ = (s: string) => panel.querySelector(s) as HTMLElement;
  const idEl = $('.nge-ch-id'), stepEl = $('.nge-ch-step'), countEl = $('.nge-ch-count'), kindEl = $('.nge-ch-kind');
  const whoEl = $('.nge-ch-who'), statusEl = $('.nge-ch-status'), noteEl = $('.nge-ch-note');
  const slider = $('.nge-ch-slider') as HTMLInputElement;
  const controls = $('.nge-ch-controls');
  const playBtn = $('.nge-ch-play') as HTMLButtonElement;
  const speedSel = panel.querySelector('select') as HTMLSelectElement;
  for (const s of SPEEDS) {
    const o = document.createElement('option');
    o.value = String(s.ms);
    o.textContent = s.label;
    if (s.ms === speed) o.selected = true;
    speedSel.appendChild(o);
  }
  idEl.textContent = root;
  idEl.title = root;
  const say = (text: string) => { statusEl.textContent = text; };
  // Keys typed here are the panel's, not the viewer's shortcuts.
  for (const ev of ['keydown', 'keyup', 'keypress']) {
    panel.addEventListener(ev, e => {
      if ((e as KeyboardEvent).key === 'Escape' && ev === 'keydown') close();
      e.stopPropagation();
    });
  }
  document.body.appendChild(panel);

  // Moved by its title, out of the way of a recording.
  const head = $('.nge-ch-head');
  head.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m: PointerEvent) => {
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - r.width, m.clientX - dx))}px`;
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, m.clientY - dy))}px`;
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // ── Close: everything back as it was ──
  function close() {
    if (closed) return;
    closed = true;
    closeOpen = null;
    if (playTimer) clearTimeout(playTimer);
    if (pointTimer) clearInterval(pointTimer);
    removeTempLayers();
    if (hidMain) tickAgain(root);
    try { localStorage.removeItem(OPEN_KEY); } catch { /* */ }
    panel.remove();
  }
  closeOpen = close;
  $('.nge-ch-close').addEventListener('click', close);

  // ── Roots of each step, looked up a few at a time ──
  const roots = new Map<number, string | null>();
  const pending = new Map<number, Promise<string | null>>();
  const queue: number[] = [];
  let active = 0;
  const pump = () => {
    while (active < MAX_LOOKUPS && queue.length && !closed) {
      const i = queue.shift()!;
      const run = runners.get(i);
      if (run) { runners.delete(i); active++; run().finally(() => { active--; pump(); }); }
    }
  };
  const runners = new Map<number, () => Promise<void>>();
  function rootOf(i: number, urgent = false): Promise<string | null> {
    if (roots.has(i)) return Promise.resolve(roots.get(i)!);
    const step = steps[i];
    if (step.askAt === null) { roots.set(i, root); return Promise.resolve(root); }
    let p = pending.get(i);
    if (!p) {
      p = new Promise<string | null>(resolve => {
        runners.set(i, async () => {
          const r = await rootAt(anchor!, step.askAt!).catch(() => null);
          // A failed lookup is not remembered, so the step can be tried again.
          if (r) roots.set(i, r);
          pending.delete(i);
          resolve(r);
        });
      });
      pending.set(i, p);
      queue.push(i);
    }
    if (urgent) { const k = queue.indexOf(i); if (k > 0) { queue.splice(k, 1); queue.unshift(i); } }
    pump();
    return p;
  }

  // ── The temporary layers ──
  function setLayerCells(name: string, ids: string[], color: string, alpha: number) {
    let ml = managedByName(name);
    if (!ml) {
      let src: any = main.layer.toJSON?.()?.source;
      if (Array.isArray(src)) src = src[0];
      if (typeof src === 'string') src = { url: src };
      if (!src?.url) return;
      // Meshes only: nothing in 2D, and no proofreading graph to edit.
      const source = { ...src, enableDefaultSubsources: false, subsources: { mesh: true } };
      ml = makeLayer(viewer.layerSpecification, name, {
        type: 'segmentation', source, segments: ids, objectAlpha: alpha,
        segmentDefaultColor: color, hideSegmentZero: true,
      });
      viewer.layerSpecification.add(ml);
      return;
    }
    const group = groupOf(ml);
    if (!group) return;
    const want = new Set(ids);
    for (const id of [...group.selectedSegments].map((u: Uint64) => u.toString())) {
      if (!want.has(id)) group.selectedSegments.delete(Uint64.parseString(id));
    }
    for (const id of ids) {
      const u = Uint64.parseString(id);
      if (!group.selectedSegments.has(u)) group.selectedSegments.add(u);
      if (!group.visibleSegments.has(u)) group.visibleSegments.add(u);
    }
  }

  let color = '#7cffb2';
  try {
    const c = getBaseObjectColor(main.layer.displayState, Uint64.parseString(root), new Float32Array(4));
    color = '#' + Array.from(c.slice(0, 3)).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
  } catch { /* the default green */ }

  function showRoot(r: string) {
    if (closed) return;
    if (!hidMain) {
      const group = groupOf(main);
      const id = Uint64.parseString(root);
      if (group?.visibleSegments.has(id)) { group.visibleSegments.delete(id); hidMain = true; }
      try { localStorage.setItem(OPEN_KEY, JSON.stringify({ root: hidMain ? root : undefined })); } catch { /* */ }
    }
    shown = r;
    setLayerCells(SHOW_LAYER, [r], color, 1);
  }

  async function lookAhead(from: number) {
    const next: string[] = [];
    for (let i = from + 1; i < steps.length && i <= from + LOOK_AHEAD; i++) {
      const r = await rootOf(i);
      if (closed || current !== from) return;
      if (r && r !== shown && !next.includes(r)) next.push(r);
    }
    for (let i = Math.max(0, from - 2); i < from; i++) void rootOf(i);
    // Fetched but never drawn: alpha 0 skips drawing, not loading.
    setLayerCells(AHEAD_LAYER, next, color, 0);
  }

  /** True once the shown cell's 3D pieces have arrived, false while some
   *  are still coming, null when it cannot tell. */
  function meshReady(): boolean | null {
    let need = 0, have = 0, seen = false;
    for (const rl of managedByName(SHOW_LAYER)?.layer?.renderLayers ?? []) {
      const p = rl?.layerChunkProgressInfo;
      if (!p) continue;
      seen = true;
      need += p.numVisibleChunksNeeded;
      have += p.numVisibleChunksAvailable;
    }
    if (!seen || need === 0) return null;
    return have >= need;
  }

  const when = (ms: number) => new Date(ms).toLocaleString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function describe(i: number) {
    const step = steps[i];
    stepEl.hidden = false;
    whoEl.hidden = false;
    if (step.edit < 0) {
      countEl.textContent = 'Before any edits';
      kindEl.textContent = '';
      kindEl.className = 'nge-ch-kind';
      whoEl.textContent = `How the cell started, before the first edit on ${when(edits[0].at)}.`;
      return;
    }
    const e = edits[step.edit];
    countEl.textContent = `Edit ${step.edit + 1} of ${edits.length}${step.askAt === null ? ', today' : ''}`;
    kindEl.textContent = e.isMerge ? 'Joined' : 'Cut';
    kindEl.className = 'nge-ch-kind ' + (e.isMerge ? 'nge-ch-kind--merge' : 'nge-ch-kind--cut');
    whoEl.textContent = `${e.isMerge ? 'Pieces joined' : 'A piece cut off'} by ${editorName(e.userId, names)}, ${when(e.at)}`;
  }

  let showSeq = 0;
  async function go(i: number) {
    if (closed || !steps.length) return;
    i = Math.max(0, Math.min(steps.length - 1, i));
    current = i;
    slider.value = String(i);
    describe(i);
    const seq = ++showSeq;
    const known = roots.has(i);
    if (!known) say('Loading this step…');
    const r = await rootOf(i, true);
    if (closed || seq !== showSeq) return;
    if (!r) { say("Couldn't load this step from the lab's server. Move the slider to try again."); return; }
    const same = r === shown;
    showRoot(r);
    void lookAhead(i);
    if (!same) say('Loading this step in 3D…');
    const prev = i > 0 && steps[i].edit >= 0 ? await rootOf(i - 1) : null;
    if (closed || seq !== showSeq) return;
    const quiet = prev === r;
    const note = quiet ? 'This edit was on a piece that joined the cell later, so nothing changes here yet.' : '';
    if (same) { say(note); return; }
    say(note || 'Loading this step in 3D…');
    for (let t = 0; t < 80 && !closed && seq === showSeq; t++) {
      await new Promise(res => setTimeout(res, 150));
      if (meshReady() !== false) break;
    }
    if (!closed && seq === showSeq) say(note);
  }

  // ── Playing ──
  function stop() {
    playing = false;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    playBtn.textContent = '▶ Play';
    playBtn.title = 'Play through the history';
  }
  async function tick() {
    if (!playing || closed) return;
    if (current >= steps.length - 1) { stop(); say("That's the cell as it is today."); return; }
    await go(current + 1);
    if (!playing || closed) return;
    // Wait for the 3D to arrive, so a recording never shows a gap.
    for (let t = 0; t < 60 && meshReady() === false && playing; t++) await new Promise(res => setTimeout(res, 150));
    const quiet = current > 0 && roots.get(current) === roots.get(current - 1);
    playTimer = setTimeout(tick, quiet ? Math.min(250, speed) : speed);
  }
  playBtn.addEventListener('click', () => {
    if (playing) { stop(); return; }
    playing = true;
    playBtn.textContent = '❚❚ Pause';
    playBtn.title = 'Pause';
    if (current >= steps.length - 1) void go(0).then(() => { if (playing) playTimer = setTimeout(tick, speed); });
    else void tick();
  });
  speedSel.addEventListener('change', () => { speed = Number(speedSel.value) || SPEEDS[1].ms; });
  slider.addEventListener('input', () => { stop(); void go(Number(slider.value)); });
  $('.nge-ch-back').addEventListener('click', () => { stop(); void go(current - 1); });
  $('.nge-ch-fwd').addEventListener('click', () => { stop(); void go(current + 1); });

  // ── Start ──
  void (async () => {
    say("Getting this cell's edits from the lab's server…");
    try {
      edits = await fetchEdits(root);
    } catch {
      if (!closed) say("Couldn't get this cell's history from the lab's server. Check you are signed in, then try again.");
      return;
    }
    if (closed) return;
    if (!edits.length) {
      say('Nobody has edited this cell yet, so it has no history to show. It looks today as it always has.');
      return;
    }
    steps = historySteps(edits);
    const namesReady = playerNames(edits.map(e => e.userId)).then(n => { names = n; if (!closed && current >= 0) describe(current); });

    say('Finding a spot inside the cell to follow…');
    anchor = await findAnchor(root);
    if (closed) return;
    if (!anchor) {
      say('Point at this cell to start: hover over it in the 3D view, or in a 2D view. Its cell body works best.');
      await new Promise<void>(resolve => {
        let busy = false;
        pointTimer = setInterval(async () => {
          if (busy || closed) { if (closed) resolve(); return; }
          busy = true;
          const sv = await anchorUnderMouse(root).catch(() => null);
          busy = false;
          if (sv && !closed) { anchor = sv; if (pointTimer) clearInterval(pointTimer); pointTimer = null; resolve(); }
        }, 400);
      });
      if (closed || !anchor) return;
    }

    slider.max = String(steps.length - 1);
    slider.hidden = false;
    controls.hidden = false;
    const sampled = steps.length - 1 < edits.length;
    noteEl.hidden = !sampled;
    if (sampled) noteEl.textContent = `This cell has ${edits.length} edits. The slider shows ${steps.length - 1} of them, spread evenly from first to last.`;
    await namesReady.catch(() => {});
    void go(0);
  })();
}
