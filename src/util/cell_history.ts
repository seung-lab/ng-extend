/**
 * Watch it grow (Nseraf, triage #194; Ames 2026-10-22: 3D only). A slider
 * through a cell's edits, oldest to newest, showing the cell as it was at
 * each one in the 3D view, with who made the edit, when, and whether it
 * joined pieces or cut one off. A play button steps through on a timer, for
 * screen recordings.
 *
 * How the past cell is found: the chunked graph's lineage of today's cell
 * lists every past version (root) that led to it and when each was made. At
 * a moment, the versions made by then and not yet replaced are the pieces
 * the cell was then: several where branches were still apart, joining as
 * the edits go on (Ames 2026-10-22: following one spot only showed the cell
 * body, and its first 43 edits were all on branches joined later). One
 * request for the whole history; old roots keep their meshes.
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
import { authHeaders, getPcgInfo } from '../widgets/pcg_service';
import { supabase } from '../supabase';
import { setStatedColor } from '../widgets/widget_utils';
import { parseBigJson, parseChangeLog, parseLineage, piecesAt, blockCounts, blocksByCell, drawPieces, evenSample, stepView, MOSTLY_THIS_CELL, historySteps, editorName, type HistoryEdit, type HistoryStep, type Lineage, type StepView, type PieceDrawing } from './cell_history_steps';
import './cell_history.css';

const SHOW_LAYER = 'Cell history (temporary)';
const AHEAD_LAYER = 'Cell history, next steps (temporary)';
const FADED_LAYER = 'Cell history, other material (temporary)';
const OPEN_KEY = 'nge_cell_history_open';
const LOOK_AHEAD = 3;
/** Most pieces loaded ahead at once, so a cell built from hundreds of
 *  fragments does not ask for all their meshes in one go. */
const MAX_AHEAD = 40;
/** Building blocks of today's cell asked about at each step, and how many
 *  steps are asked about at once. */
const MAX_SAMPLE = 30000;
const MAX_LOOKUPS = 2;
/** The piece joined at a step, and the piece cut off at one. */
const JOINED_COLOR = '#ffd84d';
const CUT_COLOR = '#ff5d73';
const SPEEDS = [
  { label: 'Slow', ms: 2000 },
  { label: 'Normal', ms: 1000 },
  { label: 'Fast', ms: 450 },
];

const viewerOf = (): any => (window as any).viewer;
const isNumericId = (id: unknown): id is string => typeof id === 'string' && /^\d+$/.test(id) && id !== '0';

function managedByName(name: string): any {
  return viewerOf()?.layerManager?.managedLayers?.find((l: any) => l.name === name && !l.archived);
}
function groupOf(ml: any): any {
  return ml?.layer?.displayState?.segmentationGroupState?.value;
}

// ─── Talking to the chunked graph ───────────────────────────────────────────

// A root id names one version of a cell that never changes, so its history
// never does either: asked once a visit, however often the panel opens.
const editsMem = new Map<string, Promise<HistoryEdit[]>>();
const lineageMem = new Map<string, Promise<string>>();
const sampleMem = new Map<string, Promise<string[]>>();
function remembered<T>(mem: Map<string, Promise<T>>, root: string, get: () => Promise<T>): Promise<T> {
  const key = `${getPcgInfo()?.server}|${getPcgInfo()?.table}|${root}`;
  let p = mem.get(key);
  if (!p) {
    p = get();
    mem.set(key, p);
    p.catch(() => mem.delete(key));   // a failure is asked again next time
  }
  return p;
}

async function fetchEdits(root: string): Promise<HistoryEdit[]> {
  const pcg = getPcgInfo();
  if (!pcg) throw Error('no graph');
  const res = await fetch(`${pcg.server}/segmentation/api/v1/table/${pcg.table}/root/${root}/tabular_change_log`,
    { headers: authHeaders(pcg.server) });
  if (!res.ok) throw Error(`change log ${res.status}`);
  return parseChangeLog(parseBigJson(await res.text()), root);
}

/** Every past version of the cell (lineage_graph). Kept as text: it is
 *  read once the edit list is in, whose times fill any it lacks. */
async function fetchLineage(root: string): Promise<string> {
  const pcg = getPcgInfo();
  if (!pcg) throw Error('no graph');
  const res = await fetch(`${pcg.server}/segmentation/api/v1/table/${pcg.table}/root/${root}/lineage_graph`,
    { headers: authHeaders(pcg.server) });
  if (!res.ok) throw Error(`lineage ${res.status}`);
  return res.text();
}

/** A sample of today's cell's building blocks (its level 2 pieces, spread
 *  evenly), the same for every step. */
async function fetchSample(root: string): Promise<string[]> {
  const pcg = getPcgInfo();
  if (!pcg) throw Error('no graph');
  const base = `${pcg.server}/segmentation/api/v1/table/${pcg.table}/node/${root}`;
  const get = async (url: string) => {
    const res = await fetch(url, { headers: authHeaders(pcg.server) });
    if (!res.ok) throw Error(`${res.status}`);
    return parseBigJson(await res.text());
  };
  const ids = new Set<string>();
  for (const e of (await get(`${base}/lvl2_graph?int64_as_str=1`))?.edge_graph ?? []) { ids.add(String(e[0])); ids.add(String(e[1])); }
  // A cell of one piece has no links between pieces to list.
  if (!ids.size) for (const id of (await get(`${base}/leaves?int64_as_str=1&stop_layer=2`))?.leaf_ids ?? []) ids.add(String(id));
  return evenSample([...ids].filter(isNumericId).sort(), MAX_SAMPLE);
}

/** The cell each block belonged to at a moment, in one request. Sent and
 *  read as raw 64 bit numbers, so 18 digit ids are never rounded. */
async function rootsAt(ids: string[], at: number): Promise<string[]> {
  const pcg = getPcgInfo();
  if (!pcg) throw Error('no graph');
  const body = new BigUint64Array(ids.map(id => BigInt(id)));
  const headers: Record<string, string> = { ...(authHeaders(pcg.server) as Record<string, string>), 'Content-Type': 'application/octet-stream' };
  const res = await fetch(
    `${pcg.server}/segmentation/api/v1/table/${pcg.table}/roots_binary?timestamp=${(at / 1000).toFixed(3)}`,
    { method: 'POST', headers, body: body.buffer });
  if (!res.ok) throw Error(`roots ${res.status}`);
  return Array.from(new BigUint64Array(await res.arrayBuffer()), v => v.toString());
}

/** A past cell's size in level 2 blocks. Only asked about pieces that are
 *  not the cell's main body, and remembered: a cell id never changes. */
const sizeMem = new Map<string, Promise<number | null>>();
function pieceSize(id: string): Promise<number | null> {
  const pcg = getPcgInfo();
  if (!pcg) return Promise.resolve(null);
  const key = `${pcg.server}|${pcg.table}|${id}`;
  let p = sizeMem.get(key);
  if (!p) {
    p = fetch(`${pcg.server}/segmentation/api/v1/table/${pcg.table}/node/${id}/leaves?int64_as_str=1&stop_layer=2`,
      { headers: authHeaders(pcg.server) })
      .then(async res => (res.ok ? ((await res.text()).match(/\d{15,}/g) ?? []).length || null : null))
      .catch(() => null);
    sizeMem.set(key, p);
    p.then(n => { if (n === null) sizeMem.delete(key); });   // a failure is asked again
  }
  return p;
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

// ─── Putting things back ────────────────────────────────────────────────────

function removeTempLayers() {
  const lm = viewerOf()?.layerManager;
  for (const ml of [...(lm?.managedLayers ?? [])]) {
    if (ml.name === SHOW_LAYER || ml.name === AHEAD_LAYER || ml.name === FADED_LAYER) {
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
  let lineage: Lineage | null = null;
  let sample: string[] = [];
  let current = -1;
  let shown: string[] = [];
  let hidMain = false;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | null = null;
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
    <div class="nge-ch-legend" hidden></div>
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
  const whoEl = $('.nge-ch-who'), statusEl = $('.nge-ch-status'), noteEl = $('.nge-ch-note'), legendEl = $('.nge-ch-legend');
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
    removeTempLayers();
    if (hidMain) tickAgain(root);
    try { localStorage.removeItem(OPEN_KEY); } catch { /* */ }
    panel.remove();
  }
  closeOpen = close;
  $('.nge-ch-close').addEventListener('click', close);

  // ── The pieces of each step ──
  // Which cells, at the step's moment, held a sample of today's building
  // blocks: only what ends up in this cell, never a whole other cell that
  // was wrongly joined on and cut away again (Nseraf, Ames 2026-10-22).
  // Asked a couple of steps at a time, the step on screen first.
  const piecesMem = new Map<number, string[]>();
  const countsMem = new Map<number, Map<string, number>>();
  const heldMem = new Map<number, Map<string, string[]>>();
  const pending = new Map<number, Promise<string[] | null>>();
  const queue: number[] = [];
  const runners = new Map<number, () => Promise<void>>();
  let active = 0;
  const pump = () => {
    while (active < MAX_LOOKUPS && queue.length && !closed) {
      const run = runners.get(queue.shift()!);
      if (!run) continue;
      active++;
      run().finally(() => { active--; pump(); });
    }
  };
  function known(i: number): string[] | undefined { return piecesMem.get(i); }
  function piecesOf(i: number, urgent = false): Promise<string[] | null> {
    const have = piecesMem.get(i);
    if (have) return Promise.resolve(have);
    const step = steps[i];
    const done = (p: string[]) => { const v = p.length ? p : [root]; piecesMem.set(i, v); return v; };
    if (step.askAt === null) return Promise.resolve(done([root]));
    // No sample (the server would not list the cell's blocks): the lineage alone.
    if (!sample.length) return Promise.resolve(done(lineage ? piecesAt(lineage, step.askAt) : [root]));
    let p = pending.get(i);
    if (!p) {
      p = new Promise<string[] | null>(resolve => {
        runners.set(i, async () => {
          const answers = await rootsAt(sample, step.askAt!).catch(() => null);
          pending.delete(i);
          // A failed lookup is not remembered, so the step can be tried again.
          if (!answers) { resolve(null); return; }
          const counts = blockCounts(answers, root);
          countsMem.set(i, counts);
          heldMem.set(i, blocksByCell(sample, answers, root));
          resolve(done([...counts.keys()].sort()));
        });
      });
      pending.set(i, p);
      queue.push(i);
    }
    if (urgent) { const k = queue.indexOf(i); if (k > 0) { queue.splice(k, 1); queue.unshift(i); } }
    pump();
    return p;
  }
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, k) => x === b[k]);

  // ── The temporary layers ──
  const packed = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) | (((n >> 8) & 255) << 8) | ((n & 255) << 16); };
  function setLayerCells(name: string, ids: string[], color: string, alpha: number, colors: Record<string, string> = {}) {
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
        segmentDefaultColor: color, segmentColors: colors, hideSegmentZero: true,
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
    try {
      const stated = ml.layer.displayState.segmentationColorGroupState.value.segmentStatedColors;
      stated.clear();
      for (const [id, hex] of Object.entries(colors)) setStatedColor(stated, Uint64.parseString(id), packed(hex));
    } catch { /* plain colour */ }
  }

  let color = '#7cffb2';
  try {
    const c = getBaseObjectColor(main.layer.displayState, Uint64.parseString(root), new Float32Array(4));
    color = '#' + Array.from(c.slice(0, 3)).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
  } catch { /* the default green */ }

  function showPieces(view: StepView, drawing: PieceDrawing, borrowedCut = false) {
    if (closed) return;
    if (!hidMain) {
      const group = groupOf(main);
      const id = Uint64.parseString(root);
      if (group?.visibleSegments.has(id)) { group.visibleSegments.delete(id); hidMain = true; }
      try { localStorage.setItem(OPEN_KEY, JSON.stringify({ root: hidMain ? root : undefined })); } catch { /* */ }
    }
    shown = view.ids;
    const colors: Record<string, string> = {};
    for (const id of view.added) colors[id] = JOINED_COLOR;
    for (const id of view.cut) colors[id] = CUT_COLOR;
    // A borrowed piece drawn as its blocks: the blocks take its colour.
    const drawn = [...drawing.whole];
    for (const b of drawing.blocks) {
      drawn.push(...b.ids);
      if (colors[b.of]) for (const id of b.ids) colors[id] = colors[b.of];
    }
    setLayerCells(SHOW_LAYER, drawn, color, 1, colors);
    if (drawing.faded.length || managedByName(FADED_LAYER)) setLayerCells(FADED_LAYER, drawing.faded, color, 0.2);
    const swatch = (c: string, text: string) => `<div class="nge-ch-legend-row"><span class="nge-ch-swatch" style="background:${c}"></span>${text}</div>`;
    const rows: string[] = [];
    if (view.added.length) rows.push(swatch(JOINED_COLOR, 'The piece joined on at this edit'));
    if (view.cut.length) rows.push(swatch(CUT_COLOR, 'The piece cut off at this edit'));
    if (borrowedCut) rows.push('<div class="nge-ch-legend-row">This edit cut a bit out of another merger. The bit joins this cell later.</div>');
    if (drawing.blocks.length) rows.push('<div class="nge-ch-legend-row">Bits that were still inside another merger show without the rest of it.</div>');
    if (drawing.faded.length) rows.push('<div class="nge-ch-legend-row">Faded: the rest of another merger a bit was later cut out of.</div>');
    legendEl.hidden = !rows.length;
    legendEl.innerHTML = rows.join('');
  }

  async function lookAhead(from: number) {
    const next: string[] = [];
    for (let i = from + 1; i < steps.length && i <= from + LOOK_AHEAD; i++) {
      const p = await piecesOf(i);
      if (closed || current !== from) return;
      // Only each step's main body: another piece may turn out to be a bit
      // of a big merger, drawn as its blocks, and is not worth fetching whole.
      const held = heldMem.get(i);
      const body = held ? [...held.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] : p?.[0];
      if (body && !shown.includes(body) && !next.includes(body)) next.push(body);
    }
    for (let i = Math.max(0, from - 2); i < from; i++) void piecesOf(i);
    // Fetched but never drawn: alpha 0 skips drawing, not loading.
    setLayerCells(AHEAD_LAYER, next.slice(0, MAX_AHEAD), color, 0);
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

  const quietAt = (i: number) => {
    const a = known(i), b = i > 0 ? known(i - 1) : undefined;
    return !!a && !!b && steps[i].edit >= 0 && sameSet(a, b);
  };
  function piecesLine(i: number): string {
    const n = known(i)?.length ?? 1;
    return n > 1 ? `${n} separate pieces at this point, which are joined into the cell later.` : '';
  }

  let showSeq = 0;
  async function go(i: number) {
    if (closed || !steps.length) return;
    i = Math.max(0, Math.min(steps.length - 1, i));
    current = i;
    slider.value = String(i);
    describe(i);
    const seq = ++showSeq;
    if (!known(i)) say('Loading this step…');
    const pieces = await piecesOf(i, true);
    if (closed || seq !== showSeq) return;
    if (!pieces) { say("Couldn't load this step from the lab's server. Move the slider to try again."); return; }
    if (i > 0) await piecesOf(i - 1);
    if (closed || seq !== showSeq) return;
    const before = countsMem.get(i - 1);
    let view = stepView(lineage!, steps[i].edit >= 0 ? edits[steps[i].edit] : undefined, pieces,
      before ? (id => before.get(id) ?? 0) : undefined);
    // Which of today's blocks each piece held (just before the edit too, for
    // the pieces a join shows), and the sizes of the pieces that may be bits
    // of other mergers.
    const held = new Map([...(heldMem.get(i - 1) ?? []), ...(heldMem.get(i) ?? [])]);
    const body = [...view.ids].sort((a, b) => (held.get(b)?.length ?? 0) - (held.get(a)?.length ?? 0))[0];
    const sizes = new Map<string, number | null>();
    // A cut that took a bit out of another merger (the bit joins later):
    // the rest of that merger was never part of this cell, so it is not
    // shown in red as if cut off it (Nseraf's capillary, 2026-10-24).
    let borrowedCut = false;
    const edit = steps[i].edit >= 0 ? edits[steps[i].edit] : undefined;
    if (edit && !edit.isMerge && view.cut.length) {
      const prevHeld = heldMem.get(i - 1) ?? new Map<string, string[]>();
      const prevBody = [...prevHeld.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
      for (const from of edit.beforeRoots) {
        const mine = prevHeld.get(from)?.length ?? 0;
        if (from === prevBody || !mine) continue;
        const size = await pieceSize(from);
        if (size && mine / size < MOSTLY_THIS_CELL) borrowedCut = true;
      }
      if (closed || seq !== showSeq) return;
      if (borrowedCut) view = { ...view, ids: view.ids.filter(id => !view.cut.includes(id)), cut: [] };
    }
    const others = view.ids.filter(id => id !== body && held.has(id));
    if (others.some(id => !sizeMem.has(`${getPcgInfo()?.server}|${getPcgInfo()?.table}|${id}`))) say('Loading this step…');
    await Promise.all(others.map(async id => sizes.set(id, await pieceSize(id))));
    if (closed || seq !== showSeq) return;
    const drawing = drawPieces(view.ids, held, sizes);
    const same = sameSet(view.ids, shown);
    showPieces(view, drawing, borrowedCut);
    void lookAhead(i);
    const note = quietAt(i) ? 'Nothing that ends up in this cell changes at this edit.' : piecesLine(i);
    if (same) { say(note); return; }
    say('Loading this step in 3D…');
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
    playTimer = setTimeout(tick, quietAt(current) ? Math.min(250, speed) : speed);
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
      const [e, text, blocks] = await Promise.all([
        remembered(editsMem, root, () => fetchEdits(root)),
        remembered(lineageMem, root, () => fetchLineage(root)),
        remembered(sampleMem, root, () => fetchSample(root)).catch(() => [] as string[]),
      ]);
      sample = blocks;
      edits = e;
      lineage = parseLineage(text, root, new Map(e.map(x => [x.operationId, x.at])));
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

    const versions = lineage.bornAt.size;
    const dated = [...lineage.bornAt.values()].filter(Number.isFinite).length;
    console.info(`[cell history] ${root}: ${edits.length} edits, ${versions} past versions (${dated} with a time), ` +
      `${sample.length} building blocks followed`);
    const flat = !sample.length && (versions <= 1 || dated === 0);

    slider.max = String(steps.length - 1);
    slider.hidden = false;
    controls.hidden = false;
    const sampled = steps.length - 1 < edits.length;
    const notes: string[] = [];
    if (flat) notes.push("The lab's server did not send this cell's past shapes, so every step shows it as it is today. Who made each edit and when is still right.");
    if (sampled) notes.push(`This cell has ${edits.length} edits. The slider shows ${steps.length - 1} of them, spread evenly from first to last.`);
    noteEl.hidden = !notes.length;
    noteEl.textContent = notes.join(' ');
    await namesReady.catch(() => {});
    void go(0);
  })();
}
