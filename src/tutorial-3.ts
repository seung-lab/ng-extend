import { Step } from "./store-pyr";
// Two pieces of one dendrite the AI left apart (Ames, 2026-10-02). The gap
// between them is a mesh still being built; when it fills in, retake the
// screenshot from the archived view:
// https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/#!middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5762238107353088
import imgMergeWelcome from './images/merge-welcome.jpg';
import imgBravoNurro from './images/bravo-nurro.png';
// Amy's merge example, 2026-09-26: the cut-in-half branch, cell purple, loose piece yellow.
import imgMergeExample from './images/merge-example.jpg';
import imgProfessorNurro from './images/professor-nurro.png';
import { startDatasetTransition, releaseDatasetTransition } from './util/dataset_transition';
import { beginPractice, holdsSlot, practiceShown, currentPractice, endPractice, ensureTool, joinWaitlist, leaveWaitlist, piecesMerged, placeMergeLine, stopWaitingForTutorial, tutorialNeeds, waitForTutorial, type PracticeKind } from './practice';
import { useTutorialStore } from './store-pyr';
import { useSplitMergeOverlayStore } from './store';
import { watch } from 'vue';
import { hidePyrMarkers, showPyrMarkers } from './markers';
import { drawSearchLine } from './tutorial_pointer';
import { defaultCredentialsManager } from 'neuroglancer/credentials_provider/default_manager';
import { responseJson } from 'neuroglancer/util/http_request';
import { cancellableFetchSpecialOk, parseSpecialUrl } from 'neuroglancer/util/special_protocol_request';

/**
 * Tutorial 3: Merge.
 * The cut half moved to tutorial-cut.ts (tutorial 5) on 2026-09-27, Amy:
 * one tool per tutorial, with the merge tutorial ending in an invitation to
 * the cut one. The helpers below are shared by both.
 */

// Amy's saved view with point annotations at the two spots to Ctrl+click for
// that merge (2026-09-28). Only its points are read; the tutorial draws Pyr
// pins there instead of loading the annotation layer.
const STATE_MERGE_HINTS = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5751472100737024';

/** Point annotations in a saved state, as global voxel coordinates. */
async function pointsInState(stateUrl: string): Promise<number[][]> {
  try {
    const { url, credentialsProvider } = parseSpecialUrl(stateUrl, defaultCredentialsManager);
    const state: any = await cancellableFetchSpecialOk(credentialsProvider, url, {}, responseJson);
    const out: number[][] = [];
    // Layers are an array in current states and a name-keyed object in old ones.
    const layers: any[] = Array.isArray(state?.layers) ? state.layers : Object.values(state?.layers ?? {});
    for (const layer of layers) {
      if (layer?.type !== 'annotation') continue;
      for (const a of layer.annotations ?? []) {
        const pt = a?.point ?? (a?.type === undefined && Array.isArray(a) ? a : null);
        if ((a?.type === 'point' || a?.type === undefined) && Array.isArray(pt)) out.push(pt.slice(0, 3).map(Number));
      }
    }
    console.info(`[tutorial] hint state: ${layers.length} layers, ${layers.filter(l => l?.type === 'annotation').length} annotation layers, ${out.length} points`);
    return out;
  } catch (e) {
    console.warn('[tutorial] could not read hint points:', e);
    return [];
  }
}

/** Pyr pins at the click spots: the example's registered points if it has
 *  them, else Amy's hint state for the built-in merge example. */
async function showWhereToClick(): Promise<boolean> {
  const ex = currentPractice().example;
  let pts: number[][] = [];
  if (ex?.point_a && ex?.point_b) {
    try { pts = [JSON.parse(ex.point_a), JSON.parse(ex.point_b)]; } catch { pts = []; }
  }
  if (!pts.length) pts = await pointsInState(STATE_MERGE_HINTS);
  return showPyrMarkers(pts, ['Ctrl+click', 'Ctrl+click'], 60);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getViewer(): any {
  return (window as any)['viewer'];
}

/** Close the side panel if open */
export function closeSidePanel() {
  const viewer = getViewer();
  if (!viewer) return;
  try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
}

// ─── Practice cell wiring (src/practice.ts) ────────────────────────────────
// One sandbox example per user at a time. The status line under the step
// text is the only live part of the tutorial: it says whether the example
// loaded, and flips when the viewer confirms the merge or the cut landed.

let practiceWatch = 0;

function chipBody(): Element | null {
  return document.querySelector('.introductionStepAnchor .chip .html');
}

function smallButton(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.style.cssText = 'margin:8px 8px 0 0;padding:5px 10px;border-radius:4px;font:inherit;font-size:0.85em;cursor:pointer;'
    + 'background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.4);color:#cde;';
  b.addEventListener('click', onClick);
  return b;
}

/** Whether the current step shows the "?" help button (a step that only
 *  asks for a key press does not). */
let helpWanted = true;

export function practiceStatus(text: string, done = false) {
  const chip = chipBody();
  if (!chip) return;
  let el = chip.querySelector('.nge-practice-status') as HTMLElement | null;
  if (!el) {
    el = document.createElement('p');
    el.className = 'nge-practice-status';
    el.style.cssText = 'margin:10px 0 0;padding:8px 10px;border-radius:4px;font-size:1rem;line-height:1.4;'
      + 'background:rgba(53,181,255,0.10);border-left:2px solid rgba(53,181,255,0.75);color:#d0e8ff;';
    chip.appendChild(el);
  }
  el.textContent = text;
  el.style.background = done ? 'rgba(96,192,96,0.14)' : 'rgba(53,181,255,0.10)';
  el.style.borderLeftColor = done ? '#60c060' : 'rgba(53,181,255,0.75)';
  el.style.fontWeight = done ? '600' : '';
  // Stuck? A "?" on the right opens a small panel with the ways out (Amy).
  let help = chip.querySelector('.nge-practice-help') as HTMLElement | null;
  if (!help) {
    help = smallButton('nge-practice-help', '?', () => toggleStuckPanel());
    help.title = 'Stuck? Ways to get help';
    help.style.cssText += 'float:right;width:30px;height:30px;padding:0;border-radius:50%;font-weight:700;font-size:1em;margin:8px 0 0;';
    chip.appendChild(help);
  }
  help.style.display = (done || !helpWanted) ? 'none' : '';
  const stuck = chip.querySelector('.nge-practice-stuck') as HTMLElement | null;
  if (stuck && done) stuck.remove();
  const place = chip.querySelector('.nge-practice-place') as HTMLElement | null;
  if (place) place.style.display = done ? 'none' : '';
  // The chip just grew; keep it on screen.
  document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
}

function notePanel(cls: string, html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.style.cssText = 'margin:8px 0 0;padding:10px 12px;border-radius:6px;font-size:0.9em;line-height:1.45;'
    + 'background:rgba(8,12,24,0.9);border:1px solid rgba(74,158,255,0.35);color:#d0e8ff;';
  el.innerHTML = html;
  return el;
}

/**
 * Where the red and blue points go in each cut cell (Ames, 2026-10-02: "a
 * tooltip that tells me where to place points if I am stuck"). These are the
 * points used when the exercise was made (the server keeps them with the
 * cut: red = sources, blue = sinks), in viewer voxels (4 x 4 x 40 nm). They
 * sit on the surface, close to the right spots rather than exactly on them.
 */
const CUT_HINTS: Record<string, { red: number[][]; blue: number[][] }> = {
  // Fusion on a proofread cell (op 1728)
  '02c5adcc-23c8-4003-83cd-cd9df7a65ce0': {
    red: [[81668, 49056, 516], [82030, 49104, 529]],
    blue: [[81516, 49232, 525], [81910, 49234, 521]],
  },
};
const RED = '#ff5c5c', BLUE = '#5c8cff';

/**
 * A saved view with the cut points already placed (Ames, 2026-10-05), per
 * cell. The cut tool keeps its points in the layer state as
 * multicut.sinks (red) and multicut.sources (blue), each with a position.
 * Read with the learner's own login when they ask for help.
 */
const CUT_HINT_STATES: Record<string, string> = {
  // Small branch merged to cell (Celia, 16:27), the 2D cut
  '0482d846-0c16-4393-ab8a-0d1212b9520f': 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5145051306917888',
  // Fusion on a proofread cell (Ames), the 3D cut
  '02c5adcc-23c8-4003-83cd-cd9df7a65ce0': 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5715664052420608',
};

async function cutPointsInState(stateUrl: string): Promise<{ red: number[][]; blue: number[][] } | null> {
  try {
    const { url, credentialsProvider } = parseSpecialUrl(stateUrl, defaultCredentialsManager);
    const state: any = await cancellableFetchSpecialOk(credentialsProvider, url, {}, responseJson);
    const pos = (list: any): number[][] => (Array.isArray(list) ? list : [])
      .map((x: any) => x?.position).filter((p: any) => Array.isArray(p) && p.length >= 3).map((p: any) => p.slice(0, 3).map(Number));
    let found: { red: number[][]; blue: number[][] } | null = null;
    // The multicut block sits somewhere under the segmentation layer; find it
    // wherever this neuroglancer version put it.
    const walk = (o: any, depth: number) => {
      if (found || !o || typeof o !== 'object' || depth > 6) return;
      if (o.multicut && (o.multicut.sinks || o.multicut.sources)) {
        const red = pos(o.multicut.sinks), blue = pos(o.multicut.sources);
        if (red.length || blue.length) { found = { red, blue }; return; }
      }
      for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v, depth + 1);
    };
    walk(state, 0);
    console.info('[tutorial] cut hint state:', found ? `${(found as any).red.length} red, ${(found as any).blue.length} blue` : 'no cut points in it');
    return found;
  } catch (e) {
    console.warn('[tutorial] could not read cut hint points:', e);
    return null;
  }
}

async function showWhereToCut(): Promise<boolean> {
  const ex = currentPractice().example;
  if (!ex) return false;
  const fromState = CUT_HINT_STATES[ex.id] ? await cutPointsInState(CUT_HINT_STATES[ex.id]) : null;
  const h = fromState ?? CUT_HINTS[ex.id];
  if (!h) return false;
  // A handful of each is plenty to show the idea.
  const red = h.red.slice(0, 4), blue = h.blue.slice(0, 4);
  return showPyrMarkers([...red, ...blue], [...red.map(() => 'red'), ...blue.map(() => 'blue')], 60,
    [...red.map(() => RED), ...blue.map(() => BLUE)]);
}

function toggleStuckPanel() {
  const chip = chipBody();
  if (!chip) return;
  const existing = chip.querySelector('.nge-practice-stuck');
  if (existing) { existing.remove(); document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp')); return; }
  const panel = notePanel('nge-practice-stuck',
    '<div style="font-weight:600;margin-bottom:6px">Stuck? Three ways out.</div>'
    + '<div style="margin:4px 0">1. The merge and cut tools act on the <b>segmentation layer</b>, the chip at the top of the viewer. Press <kbd>2</kbd> or right-click it to select it.</div>'
    + '<div style="margin:4px 0">2. Ask people in the community chat. Someone is usually around.</div>'
    + '<div style="margin:4px 0">3. Ask Nurro, the AI guide. It knows this tutorial and the tools.</div>');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:0 4px;margin-top:6px';
  row.appendChild(smallButton('nge-practice-stuck-layer', 'Show me the layer', () => document.dispatchEvent(new CustomEvent('nge:tutorial-flash-seg-layer'))));
  const ex = currentPractice().example;
  if (ex && ex.kind === 'merge_then_cut') {
    row.appendChild(smallButton('nge-practice-stuck-where', 'Show me where to click', async () => {
      ensureTool('merge');
      const shown = await showWhereToClick();
      if (!shown) { practiceStatus('No click hints for this cell yet. Ctrl+click anywhere on the yellow piece, then anywhere on the purple segment near it.'); return; }
      const placed = ex?.point_a && ex?.point_b ? placeMergeLine() : false;
      practiceStatus(placed
        ? 'Pyr marks the two spots and the merge line is already placed. Press Submit merge, or Enter.'
        : 'Pyr marks the two spots: Ctrl+click the one on the yellow piece, then the one on the purple segment, then Submit merge.');
    }));
  }
  if (ex && ex.kind === 'cut') {
    row.appendChild(smallButton('nge-practice-stuck-where', 'Show me where to place points', async () => {
      ensureTool('multicut');
      practiceStatus((await showWhereToCut())
        ? 'Pyr marks the spots: red points on one side of the join, blue points on the other. Ctrl+click near each, press G to switch colour, then Submit cut.'
        : 'No point hints for this cell yet. Red goes on the piece that does not belong, blue on the cell just past the join.');
    }));
  }
  row.appendChild(smallButton('nge-practice-stuck-chat', 'Ask in chat', () => document.dispatchEvent(new CustomEvent('nge:open-chat'))));
  row.appendChild(smallButton('nge-practice-stuck-ai', 'Ask Nurro', () => (document.querySelector('.nge-ask-btn') as HTMLElement | null)?.click()));
  panel.appendChild(row);
  chip.appendChild(panel);
  document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
}

/** "Place the merge points for me": the registered points go into the merge
 *  tool as a ready line, and the learner only has to press Submit merge.
 *  Only offered when the example carries points. */
function offerPlacePoints() {
  const chip = chipBody();
  const ex = currentPractice().example;
  if (!chip || !ex || !ex.point_a || !ex.point_b || chip.querySelector('.nge-practice-place')) return;
  const b = smallButton('nge-practice-place', 'Place the merge points for me', () => {
    ensureTool('merge');
    setTimeout(() => {
      const ok = placeMergeLine();
      practiceStatus(ok ? 'Points placed. Press Submit merge on the bar at the bottom, or Enter.'
                        : 'Could not place the points. Press M and Ctrl+click the two pieces yourself.');
    }, 700);
  });
  chip.insertBefore(b, chip.querySelector('.nge-practice-help'));
}

/** Wait for the chip to render, then keep a status line current while
 *  polling the graph until `wantMerged` matches, or the step changes.
 *  Success gets confetti once, and the black box note (Amy): a fresh mesh
 *  can render as a black box until the page is refreshed. */
/**
 * Which part of a neuron each practice cell is (Ames, 2026-09-29: the text
 * said axon over a dendrite). The step text carries PART placeholders and
 * labelPart() fills them from the cell actually on screen.
 */
/** The Merge tutorial's second cell: Axon missing a branch. */
const MERGE_SECOND = 'a4bd2f76-67e9-4093-adc7-e670230d1577';
const CELL_PART: Record<string, string> = {
  'b231f4e7-e9f3-4214-941f-975b8b25a237': 'dendrite', // Branch cut in half
  'a4bd2f76-67e9-4093-adc7-e670230d1577': 'axon',     // Axon missing a branch
};
const PART = '<span class="nge-practice-part">neuron</span>';

export function labelPart() {
  const ex = currentPractice().example;
  if (!ex) return;
  const part = CELL_PART[ex.id] ?? (/axon/i.test(ex.title ?? '') ? 'axon' : /dendrite/i.test(ex.title ?? '') ? 'dendrite' : 'neuron');
  document.querySelectorAll('.nge-practice-part').forEach(el => { if (el.textContent !== part) el.textContent = part; });
}

/**
 * The last failed edit (Ames, 2026-10-02: "what is the error state if the
 * cut doesn't work?"). The tool bar flashes the server's message for a few
 * seconds; the tutorial box used to keep saying "waiting". It now repeats
 * the reason and what to try, for half a minute.
 */
let lastEditError: { text: string; at: number } | null = null;
let editErrorWatched = false;
function watchEditErrors() {
  if (editErrorWatched) return;
  editErrorWatched = true;
  const store = useSplitMergeOverlayStore();
  watch(() => [store.resultFlash, store.resultText] as const, ([flash, text]) => {
    if (flash === 'error') lastEditError = { text: String(text || 'the server refused it'), at: Date.now() };
    else if (flash === 'success') lastEditError = null;
  });
}
function recentEditError(): string | null {
  return lastEditError && Date.now() - lastEditError.at < 30000 ? lastEditError.text : null;
}

/**
 * For the harder Cut tutorial to come (Ames, 2026-10-02): a step that asks
 * the learner to run Find Path between two points, to find where a merger
 * starts. neuroglancer reports the search as plain status lines
 * (find_path_status.ts restyles them); this reads the same lines.
 * `advance` moves on once a path is found.
 */
export function watchFindPath(waiting: string, found: string, opts: { advance?: boolean } = {}) {
  const token = ++practiceWatch;
  helpWanted = true;
  const state = (): 'working' | 'done' | 'error' | '' => {
    for (const li of Array.from(document.querySelectorAll('#statusContainer li'))) {
      const t = (li.textContent ?? '').trim();
      if (t.includes('Path finding failed')) return 'error';
      if (t.includes('Path found')) return 'done';
      if (t.includes('Finding path between') || t.includes('Tracing path')) return 'working';
    }
    return document.body.classList.contains('nge-fp-busy') ? 'working' : '';
  };
  const tick = () => {
    if (token !== practiceWatch) return;
    const s = state();
    if (s === 'done') {
      if (opts.advance) { practiceWatch++; document.dispatchEvent(new CustomEvent('nge:tutorial-next')); return; }
      practiceStatus(found, true);
      return;
    }
    practiceStatus(s === 'working' ? 'Tracing the path…'
      : s === 'error' ? 'That search did not find a path. Alt+click one point on each cell, on the same segment, and try again.'
      : waiting);
    setTimeout(tick, 700);
  };
  setTimeout(tick, 400);
}

export function watchPractice(wantMerged: boolean, waiting: string, finished: string, opts: { advance?: boolean } = {}) {
  const token = ++practiceWatch;
  watchEditErrors();
  lastEditError = null;
  helpWanted = true;
  let celebrated = false;
  const tick = async () => {
    if (token !== practiceWatch) return;
    const p = currentPractice();
    if (p.phase === 'unavailable') { practiceStatus('Practice needs an invited account and a current session. Sign in, or press back then next to try again. You can read along while waiting.'); return; }
    if (p.phase === 'busy') { waitForCell(wantMerged ? 'merge_then_cut' : 'cut', wantMerged, waiting, finished); return; }
    if (p.phase === 'released') { return; }
    if (!p.example) { practiceStatus('Loading a practice cell…'); setTimeout(tick, 1000); return; }
    labelPart();
    const merged = await piecesMerged();
    if (token !== practiceWatch) return;
    if (merged === wantMerged) {
      hidePyrMarkers();
      if (opts.advance) {
        // The next step is the success box; it celebrates.
        practiceWatch++;
        document.dispatchEvent(new CustomEvent('nge:tutorial-next'));
        return;
      }
      practiceStatus(finished + ' If a black box appears where the pieces meet, the new mesh is still being built.', true);
      if (!celebrated) { celebrated = true; document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate')); }
      return;
    }
    const failed = recentEditError();
    practiceStatus(failed
      ? `That ${wantMerged ? 'merge' : 'cut'} didn't go through. The server said: "${failed}". `
        + (wantMerged
          ? 'Ctrl+click once on each of the two pieces, then submit again.'
          : 'Keep every point on the one fused segment, red on one side of the join and blue on the other, then submit again. Clear on the bar starts over.')
      : waiting);
    if (wantMerged) offerPlacePoints();
    setTimeout(tick, failed ? 1500 : 3000);
  };
  setTimeout(tick, 600);
}

export function stopWatching() { practiceWatch++; leaveWaitlist(); hidePyrMarkers(); helpWanted = true; }

function toolIsOn(): boolean {
  const viewer = getViewer();
  try { if (viewer?.globalToolBinder?.activeTool_ || viewer?.toolBinder?.activeTool_) return true; } catch { /* DOM check */ }
  return !!document.querySelector('.neuroglancer-tool-status');
}

/** The success box after a practice edit: confetti, the black box note. */
export function celebrateStep() {
  setTimeout(labelPart, 50);
  stopWatching();
  helpWanted = false;
  document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate'));
}

export const BLACK_BOX_NOTE = 'If a black box appears where the pieces meet, the new mesh is still being built.';

/** A step that only asks for the tool to be switched on: the status line
 *  flips when it is. No help button on such a step (Amy). */
export function watchTool(waiting: string, finished: string) {
  const token = ++practiceWatch;
  helpWanted = false;
  const tick = () => {
    if (token !== practiceWatch) return;
    const p = currentPractice();
    if (p.phase === 'unavailable') { practiceStatus('Practice cells need you to be signed in. Read along and press next.'); return; }
    if (p.phase === 'busy') { practiceStatus('Every practice cell is in use right now. Read along and press next.'); return; }
    if (toolIsOn()) { practiceStatus(finished, true); return; }
    practiceStatus(waiting);
    setTimeout(tick, 700);
  };
  setTimeout(tick, 600);
}

// Idle countdown under the status line (Amy): appears after a quiet minute,
// and at zero the cell is undone and released.
document.addEventListener('nge:practice-countdown', ((e: CustomEvent) => {
  const chip = chipBody();
  if (!chip) return;
  const secs = e.detail?.seconds as number | null;
  let el = chip.querySelector('.nge-practice-countdown') as HTMLElement | null;
  if (secs == null) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('p');
    el.className = 'nge-practice-countdown';
    el.style.cssText = 'margin:8px 0 0;padding:6px 10px;border-radius:4px;font-size:0.88em;line-height:1.4;'
      + 'background:rgba(245,166,35,0.12);border-left:2px solid rgba(245,166,35,0.8);color:#ffd27a;';
    chip.appendChild(el);
  }
  const m = Math.floor(secs / 60), s = String(secs % 60).padStart(2, '0');
  el.textContent = `Still there? Your practice cell goes to the next person in ${m}:${s}. Move the mouse or press a key to keep it.`;
}) as EventListener);

document.addEventListener('nge:practice-unavailable', () => {
  hidePyrMarkers();
  practiceStatus('Your practice session could not be renewed. Editing is paused. Press back, then next, to get a session again.');
});

document.addEventListener('nge:practice-released', () => {
  practiceStatus('Your practice cell was released after five quiet minutes and put back for the next person. Press back, then next, to get a cell again.');
});

/** Every cell of this kind is held: queue up, and take the cell the moment
 *  it is our turn. The status line shows the position. */
function waitForCell(kind: PracticeKind, wantMerged: boolean, waiting: string, finished: string) {
  const token = practiceWatch;
  joinWaitlist(kind,
    () => { if (token === practiceWatch) watchPractice(wantMerged, waiting, finished); },
    (pos) => { if (token === practiceWatch) practiceStatus(pos <= 1
      ? 'You are next in line for a practice cell. It becomes yours the moment it is free.'
      : `Every practice cell is in use. You are number ${pos} in line; this box updates when one is yours. Read along meanwhile.`); });
}

/** A small (i) in the step text. Hover for the tip, click to flash the
 *  segmentation layer chip at the top of the viewer. Inline onclick works
 *  inside v-html where a Vue handler would not. */
export const INFO_LAYER = '<span class="nge-tut-info" role="button" tabindex="0"'
  + ' title="Which layer? Click for a note."'
  + ' onclick="document.dispatchEvent(new CustomEvent(\'nge:tutorial-layer-note\'))"'
  + ' style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:4px;border-radius:50%;border:1px solid #7ecaff;color:#7ecaff;font-size:12px;font-weight:700;cursor:pointer;vertical-align:middle;line-height:1">i</span>';

// The (i) next to "the segmentation layer has to be selected": a note in
// the box (a browser tooltip ran off the screen and vanished), plus a flash
// of the chip it means.
document.addEventListener('nge:tutorial-layer-note', () => {
  const chip = chipBody();
  if (!chip) return;
  if (!chip.querySelector('.nge-practice-layer-note')) {
    const note = notePanel('nge-practice-layer-note',
      'The <b>segmentation layer</b> is the chip at the top of the viewer that is flashing now, named <b>3D segmentation</b>, next to <b>2D EM Images</b>. '
      + 'Press <kbd>2</kbd>, or right-click that chip, to select it. Tools like merge and cut only work on the selected layer.');
    chip.appendChild(note);
    document.dispatchEvent(new CustomEvent('nge:tutorial-reclamp'));
  }
  document.dispatchEvent(new CustomEvent('nge:tutorial-flash-seg-layer'));
  // And a search line from the (i) to the chip (Ames, 2026-10-02).
  const info = document.querySelector('.introductionStepAnchor .nge-tut-info');
  const target = segLayerChip();
  if (info && target) {
    const a = info.getBoundingClientRect(), b = target.getBoundingClientRect();
    drawSearchLine({ x: a.left + a.width / 2, y: a.top + a.height / 2 }, { x: b.left + b.width / 2, y: b.bottom - 2 });
  }
});

function segLayerChip(): HTMLElement | undefined {
  const layers: any[] = getViewer()?.layerManager?.managedLayers ?? [];
  const seg = layers.find(ml => (ml.layer?.constructor?.name ?? '').includes('Segmentation'));
  const chips = Array.from(document.querySelectorAll('.neuroglancer-layer-panel .neuroglancer-layer-item')) as HTMLElement[];
  return (seg ? chips.find(c => (c.textContent ?? '').includes(seg.name)) : undefined) ?? chips[Math.max(0, layers.indexOf(seg))];
}

/**
 * Friendlier layer names while the Merge or Cut tutorial is up (Ames,
 * 2026-10-02): "2D EM Images" for img, "3D segmentation" for the dataset
 * layer. Display only: the layers keep their real names, which the app uses
 * to tell which dataset it is in. The real name stays in the chip's text
 * (hidden), a data attribute carries the shown one.
 */
function friendlyLayerNames() {
  const on = [3, 5].includes(useTutorialStore().activeTutorial) && !!document.querySelector('.introductionStepAnchor');
  document.body.classList.toggle('nge-friendly-layers', on);
  if (!on) return;
  if (!document.getElementById('nge-friendly-layers-style')) {
    const st = document.createElement('style');
    st.id = 'nge-friendly-layers-style';
    st.textContent = `
      body.nge-friendly-layers .neuroglancer-layer-item-label[data-nge-label] { font-size: 0 !important; }
      body.nge-friendly-layers .neuroglancer-layer-item-label[data-nge-label]::after { content: attr(data-nge-label); font-size: 12px; }`;
    document.head.appendChild(st);
  }
  const layers: any[] = getViewer()?.layerManager?.managedLayers ?? [];
  const chips = Array.from(document.querySelectorAll('.neuroglancer-layer-panel .neuroglancer-layer-item')) as HTMLElement[];
  for (const ml of layers) {
    const kind = ml.layer?.constructor?.name ?? '';
    const name = kind.includes('Segmentation') ? '3D segmentation' : kind.includes('Image') ? '2D EM Images' : '';
    const label = chips.find(c => (c.querySelector('.neuroglancer-layer-item-label')?.textContent ?? '') === ml.name)
      ?.querySelector('.neuroglancer-layer-item-label') as HTMLElement | null | undefined;
    if (!label) continue;
    if (name) label.dataset.ngeLabel = name; else delete label.dataset.ngeLabel;
  }
}
setInterval(() => { try { friendlyLayerNames(); } catch { /* store not ready yet */ } }, 1000);

document.addEventListener('nge:tutorial-flash-seg-layer', () => {
  const viewer = getViewer();
  const layers: any[] = viewer?.layerManager?.managedLayers ?? [];
  const seg = layers.find(ml => (ml.layer?.constructor?.name ?? '').includes('Segmentation'));
  const chips = Array.from(document.querySelectorAll('.neuroglancer-layer-panel .neuroglancer-layer-item')) as HTMLElement[];
  // Match the chip by its label; fall back to the layer's index.
  let chip = seg ? chips.find(c => (c.textContent ?? '').includes(seg.name)) : undefined;
  if (!chip) chip = chips[Math.max(0, layers.indexOf(seg))];
  if (!chip) { console.warn('[tutorial] no layer chip to flash'); return; }
  // The layer bar clips box shadows, so flash the chip itself: background,
  // colour and a little scale, which stay inside the bar.
  const old = { bg: chip.style.background, color: chip.style.color, transform: chip.style.transform, transition: chip.style.transition, z: chip.style.zIndex };
  chip.style.transition = 'background 0.2s, transform 0.2s';
  chip.style.zIndex = '5';
  let on = false;
  const timer = setInterval(() => {
    on = !on;
    chip!.style.background = on ? '#edd040' : old.bg;
    chip!.style.color = on ? '#000' : old.color;
    chip!.style.transform = on ? 'scale(1.12)' : old.transform;
  }, 320);
  setTimeout(() => {
    clearInterval(timer);
    Object.assign(chip!.style, { background: old.bg, color: old.color, transform: old.transform, transition: old.transition, zIndex: old.z });
  }, 3500);
});

// Starting a tutorial (book menu, or the merge tutorial's last step). The
// merge and cut tutorials run on practice cells one learner at a time, so
// when the cells are held the learner gets a "get in line" card instead
// (Amy), and a notification when it is their turn.
function openTutorial(id: number) {
  const store = useTutorialStore();
  store.activeTutorial = id;
  store.setTutorialStep(0);
}

const PRACTICE_KIND: Record<number, PracticeKind> = { 3: 'merge_then_cut', 5: 'cut' };
const TUTORIAL_NAME: Record<number, string> = { 3: 'Merge', 5: 'Cut' };

function removeGateCard() {
  document.getElementById('nge-tutorial-gate')?.remove();
}

/**
 * "Moving you to the Sandbox": the dataset switch card, held over the first
 * practice load (claiming cells and loading their view takes seconds, and
 * the box used to sit there with no sign of life). Skipped when a practice
 * view is already up.
 */
export async function movingToSandbox<T>(tutorial: string, work: () => Promise<T>): Promise<T> {
  if (practiceShown()) return work();
  startDatasetTransition({
    id: 'practice-sandbox',
    label: 'The Sandbox',
    eyebrow: `${tutorial} tutorial · Moving you to`,
    thumbnail: imgProfessorNurro,
    contain: true,
    hold: true,
    steps: ['Finding your practice cells', 'Holding them for you', 'Loading the volume', 'Colouring the pieces', 'Almost there'],
  });
  try { return await work(); } finally { releaseDatasetTransition(); }
}

// The gate card wears the app's scifi-ui holopanel (the surface
// DatasetTransition.vue uses) and the sign in dialog's holo buttons, with
// Professor Nurro at the board (Ames, 2026-09-29).
function ensureGateStyle() {
  if (document.getElementById('nge-gate-style')) return;
  const st = document.createElement('style');
  st.id = 'nge-gate-style';
  st.textContent = `
    #nge-tutorial-gate { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 9500;
      width: min(480px, 92vw); padding: 20px 22px 18px; border-radius: 14px;
      border: 1px solid rgba(74, 150, 224, 0.35);
      background: linear-gradient(158deg, rgba(15, 18, 24, 0.97), rgba(6, 10, 18, 0.98));
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6), 0 0 70px rgba(66, 213, 236, 0.10), inset 0 1px 0 rgba(196, 228, 255, 0.12);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      color: rgba(214, 228, 242, 0.9); font-size: 14.5px; line-height: 1.5;
      animation: nge-gate-materialize 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes nge-gate-materialize {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(1.025) translateY(-8px); filter: blur(14px); }
      60% { opacity: 1; transform: translate(-50%, -50%) scale(0.995); filter: blur(0); }
      100% { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: blur(0); } }
    #nge-tutorial-gate .nge-gate-eyebrow { display: flex; align-items: center; gap: 8px; font-size: 11px;
      letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; color: rgba(140, 200, 245, 0.95); }
    #nge-tutorial-gate .nge-gate-dot { width: 7px; height: 7px; border-radius: 50%; background: #42d5ec;
      box-shadow: 0 0 10px #42d5ec; animation: nge-gate-pulse 1.1s ease-in-out infinite; }
    @keyframes nge-gate-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    #nge-tutorial-gate .nge-gate-title { margin: 6px 0 10px; font-size: 22px; font-weight: 700; letter-spacing: -0.01em;
      color: #fff; text-shadow: 0 0 22px rgba(120, 190, 255, 0.35); }
    #nge-tutorial-gate .nge-gate-art { display: block; width: 100%; height: auto; max-height: 250px; object-fit: contain;
      margin: 0 0 12px; border-radius: 10px; padding: 8px 10px; box-sizing: border-box;
      background: radial-gradient(ellipse at 45% 55%, rgba(66, 213, 236, 0.14), #04070d 72%);
      border: 1px solid rgba(255, 255, 255, 0.08); }
    #nge-tutorial-gate p { margin: 0 0 12px; }
    #nge-tutorial-gate .nge-gate-status { color: #9fd0ff; }
    #nge-tutorial-gate .nge-gate-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    #nge-tutorial-gate button { position: relative; overflow: hidden; padding: 9px 16px; border-radius: 2px; cursor: pointer;
      border: 1px solid rgba(0, 180, 255, 0.3); color: rgba(200, 230, 255, 0.95); font: 600 13px/1.2 inherit; letter-spacing: 0.04em;
      background: linear-gradient(135deg, rgba(0, 100, 255, 0.2) 0%, rgba(0, 60, 180, 0.3) 50%, rgba(80, 0, 200, 0.2) 100%);
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s; }
    #nge-tutorial-gate button:hover:not(:disabled) { border-color: rgba(0, 220, 255, 0.6); transform: translateY(-1px);
      box-shadow: 0 0 30px rgba(0, 180, 255, 0.15), inset 0 0 30px rgba(0, 150, 255, 0.05); }
    #nge-tutorial-gate button.nge-gate-primary::after { content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(90deg, transparent 0%, rgba(0, 200, 255, 0.15) 50%, transparent 100%);
      animation: nge-gate-sweep 3s ease-in-out infinite; }
    @keyframes nge-gate-sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
    #nge-tutorial-gate button.nge-gate-quiet { background: transparent; border-color: rgba(255, 255, 255, 0.12); color: rgba(214, 228, 242, 0.75); }
    #nge-tutorial-gate button:disabled { cursor: default; opacity: 0.8; border-style: dashed; background: rgba(0, 60, 120, 0.12); }
    #nge-tutorial-gate button:disabled::after { display: none; }
    @media (prefers-reduced-motion: reduce) {
      #nge-tutorial-gate, #nge-tutorial-gate .nge-gate-dot, #nge-tutorial-gate button::after { animation: none; } }
  `;
  document.head.appendChild(st);
}

function gateButton(label: string, cls: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function gateCard(eyebrow: string, title: string, paragraphs: string[], status: string) {
  removeGateCard();
  ensureGateStyle();
  const card = document.createElement('div');
  card.id = 'nge-tutorial-gate';
  card.setAttribute('role', 'dialog');
  card.innerHTML = `<div class="nge-gate-eyebrow"><span class="nge-gate-dot"></span>${eyebrow}</div>`
    + `<div class="nge-gate-title">${title}</div>`
    + `<img class="nge-gate-art" src="${imgProfessorNurro}" alt="Professor Nurro at the chalkboard">`
    + paragraphs.map(t => `<p>${t}</p>`).join('')
    + `<p class="nge-gate-status">${status}</p>`
    + `<div class="nge-gate-row"></div>`;
  document.body.appendChild(card);
  return {
    card,
    row: card.querySelector('.nge-gate-row') as HTMLElement,
    status: card.querySelector('.nge-gate-status') as HTMLElement,
  };
}

/** When it is their turn: open the tutorial if the card is still up,
 *  otherwise ask (they may be in the middle of something). */
function yourTurn(id: number) {
  if (document.getElementById('nge-tutorial-gate')) { removeGateCard(); openTutorial(id); return; }
  const name = TUTORIAL_NAME[id];
  const { row } = gateCard('Your turn', `The ${name} tutorial is free`, [
    'The practice cells are free. Start now and they are held for you while you work through it.',
  ], 'Or pass, and the next person in line gets them.');
  row.append(
    gateButton('Start the tutorial', 'nge-gate-primary', () => { removeGateCard(); openTutorial(id); }),
    gateButton('Pass', 'nge-gate-quiet', () => removeGateCard()),
  );
}

function showGateCard(id: number, kind: PracticeKind, inUse = true) {
  const name = TUTORIAL_NAME[id];
  // Only say someone is practising when someone is: otherwise the cells are
  // on their way back to their starting state.
  const { row, status } = inUse
    ? gateCard('One learner at a time', `The ${name} tutorial is in use`, [
      'Someone is practising on its cells right now. The cells go back to their starting state between people.',
    ], "Get in line and we'll tell you when it's your turn.")
    : gateCard('Getting ready', `The ${name} tutorial is resetting`, [
      'Nobody is using it, but its practice cells are going back to their starting state after the last learner.',
    ], "Get in line and we'll open it as soon as they're ready.");
  const lineBtn = gateButton('Get in line', 'nge-gate-primary', () => {
    // Waiting is not a button: it shows the state, and OK takes over as the
    // way to get back to work while staying in line.
    lineBtn.disabled = true;
    lineBtn.textContent = 'In line';
    lineBtn.classList.remove('nge-gate-primary');
    readBtn.remove();
    row.insertBefore(okBtn, noBtn);
    waitForTutorial(kind,
      () => yourTurn(id),
      (pos, needed) => { status.textContent = pos <= 1
        ? `You're next. We'll open the tutorial the moment its ${needed === 1 ? 'cell is' : 'cells are'} free, and a notification will say so too.`
        : `You're number ${pos} in line. Keep the app open; a notification will say when it's your turn.`; });
  });
  const readBtn = gateButton('Read it without a cell', '', () => { stopWaitingForTutorial(); removeGateCard(); openTutorial(id); });
  const okBtn = gateButton('OK', 'nge-gate-primary', () => removeGateCard());
  const noBtn = gateButton('Nevermind', 'nge-gate-quiet', () => { stopWaitingForTutorial(); removeGateCard(); });
  row.append(lineBtn, readBtn, noBtn);
}

document.addEventListener('nge:tutorial-start', (async (e: CustomEvent) => {
  const id = Number(e.detail?.id);
  if (!Number.isFinite(id)) return;
  const kind = PRACTICE_KIND[id];
  if (!kind) { openTutorial(id); return; }
  // If the availability check fails, open the tutorial anyway: its steps
  // show the no-cell fallback rather than the menu doing nothing.
  const need = await Promise.race([
    tutorialNeeds(kind),
    new Promise<null>(r => setTimeout(() => r(null), 4000)),
  ]).catch(e => { console.warn('[tutorial] availability check failed:', e); return null; });
  if (!need) { removeGateCard(); openTutorial(id); return; }
  if (need.registered === 0 || need.free >= need.needed) { removeGateCard(); openTutorial(id); return; }
  showGateCard(id, kind, need.heldByOthers > 0);
}) as EventListener);

export function startTutorialButton(id: number, label: string) {
  return `<button onclick="document.dispatchEvent(new CustomEvent('nge:tutorial-start',{detail:{id:${id}}}))"`
    + ' style="margin-top:12px;padding:8px 16px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;'
    + 'background:rgba(96,192,96,0.18);border:1px solid rgba(96,192,96,0.6);color:#d6ffd6">' + label + '</button>';
}

/** Two captioned pictures side by side, inline styled because the step
 *  html is rendered outside TutorialStep's scoped CSS. Each opens full size
 *  in a new tab (Amy: keep the examples open while working). */
export function beforeAfter(before: string, beforeCaption: string, after: string, afterCaption: string) {
  const fig = (src: string, cap: string) =>
    `<figure style="margin:0;flex:1 1 0;min-width:0">`
    + `<a href="${src}" target="_blank" rel="noopener" title="Open in a new tab">`
    + `<img src="${src}" alt="${cap}" style="display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:4px;border:1px solid rgba(74,158,255,0.25)">`
    + `</a>`
    + `<figcaption style="margin-top:6px;font-size:0.85em;line-height:1.35;color:#9fd0ff">${cap}`
    + ` <a href="${src}" target="_blank" rel="noopener" style="color:#7ecaff;white-space:nowrap">open in new tab ↗</a></figcaption>`
    + `</figure>`;
  return `<div style="display:flex;gap:12px;align-items:flex-start;margin-top:14px">${fig(before, beforeCaption)}${fig(after, afterCaption)}</div>`;
}

/** Where the cheat sheet lives on the web, to keep open beside the viewer. */
export const CHEAT_SHEET_URL = 'https://connectome.quest/proofreading/';

/** A tidy two-column cheat sheet (Amy: the markdown table ran its columns
 *  together). Keys sit in key caps; the link opens the same sheet on
 *  connectome.quest in a new tab. */
export function cheatSheet(rows: Array<[string, string]>) {
  const key = (k: string) => /^[A-Z]$|^Enter$|^Ctrl\+Click$/.test(k)
    ? `<kbd style="display:inline-block;padding:2px 8px;border-radius:4px;border:1px solid rgba(126,202,255,0.5);background:rgba(126,202,255,0.10);font:inherit;font-size:0.9em;color:#d0e8ff">${k}</kbd>`
    : k;
  const tr = (a: string, b: string) =>
    `<tr><td style="padding:6px 18px 6px 0;white-space:nowrap;color:#d0e8ff">${a}</td><td style="padding:6px 0;color:#9fd0ff">${key(b)}</td></tr>`;
  return `<table style="border-collapse:collapse;margin:10px 0 4px;font-size:0.95em;line-height:1.3">${rows.map(r => tr(r[0], r[1])).join('')}</table>`
    + `<p style="margin:6px 0 0;font-size:0.85em"><a href="${CHEAT_SHEET_URL}" target="_blank" rel="noopener" style="color:#7ecaff">Open the cheat sheet in a new tab ↗</a></p>`;
}

export const MIDDLE = {
  element: "body",
  x: 0.5,
  y: 0.5,
};

export const OVER_3D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.75,
  y: 0.15,
};

export const OVER_2D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.25,
  y: 0.15,
};

export const steps: Step[] = [
  // 1: Welcome
  {
    title: "Merge",
    text: `
AI reconstructions of neurons are impressive, but they're not perfect. Sometimes the AI misses a branch entirely, leaving a neuron incomplete.

A <strong style="color:#60c060">merge</strong> joins two separate segments that actually belong to the same neuron. Every merge you make reconnects a lost branch and improves the connectome, the wiring diagram of the brain.`,
    position: MIDDLE,
    width: "480px",
    image: imgMergeWelcome,
    nextLabel: "Let's learn!",
  },

  // 2: What is merge?
  {
    title: "What a merge fixes",
    text: `
This is an example. The yellow branch belongs to the purple cell, but the AI left it as its own segment. We will fix it in a moment.`,
    position: MIDDLE,
    width: "560px",
    image: imgMergeExample,
    nextLabel: "Let's fix it!",
  },

  // 3: Activating merge, on the learner's own cell
  {
    title: "How to Merge",
    text: `
Let's jump to an area that needs a merge. The purple ` + PART + ` behind this box is missing the yellow piece; the AI left it off. It is yours to practice on until the end of this tutorial.

Press the **M** key to start the merge tool. The segmentation layer has to be selected for that. ` + INFO_LAYER + `

You can also start it from the toolbar at the top of the screen. Once it's on, the merge tool appears at the bottom of the viewer.`,
    position: OVER_3D,
    width: "450px",
    onEnter: async () => {
      closeSidePanel();
      watchTool('Press M to activate merge mode.', 'Merge mode is on. Press next.');
      // Point at the segmentation layer chip without being asked (Amy).
      setTimeout(() => document.dispatchEvent(new CustomEvent('nge:tutorial-flash-seg-layer')), 1500);
      // The whole tutorial runs on both merge cells (Amy): take both now, so
      // a learner never starts on one and finds the other held.
      await movingToSandbox('Merge', async () => {
        // The two merges are on one neuron and come in a set order (Ames,
        // 2026-10-05): the dendrite first, then the axon. If the dendrite
        // cannot be had, take whatever is free.
        const first = await beginPractice('merge_then_cut', 'start', { slot: 'a', avoid: [MERGE_SECOND] })
          ?? await beginPractice('merge_then_cut', 'start', { slot: 'a' });
        if (first) {
          // The second cell is claimed now and shown at step 6.
          // With one merge cell registered there is no second: the learner
          // keeps the first, and step 6 skips ahead (Ames scrapped the axon
          // cell, 2026-09-29, it was on the same neuron as the dendrite).
          await beginPractice('merge_then_cut', 'start', { slot: 'b', show: false });
        }
      });
    },
  },

  // 4: Make the merge
  {
    title: "Make the merge",
    text: `
With merge mode on:

1. **Ctrl+Click** the yellow piece. You can click in the 2D or the 3D view.
2. **Ctrl+Click** the purple ` + PART + `, close to where the piece should join it.
3. Press **Submit merge** on the bar at the bottom, or press **Enter**.

The server connects the two. You'll see "trying..." and then "done", and the piece turns purple.`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(true, 'Waiting for your merge: Ctrl+click yellow, Ctrl+click purple, Submit merge.', '', { advance: true });
      await beginPractice('merge_then_cut');
      // The previous step said "press M"; if they pressed next instead,
      // the tool comes on anyway.
      setTimeout(() => ensureTool('merge'), 400);
    },
  },

  // 5: Merge success
  {
    title: "Merge success!",
    text: `
You did it. The piece is part of the ` + PART + ` now, and the whole thing is purple.

` + BLACK_BOX_NOTE + `

Press next to keep going.`,
    position: OVER_3D,
    width: "420px",
    image: imgBravoNurro,
    onEnter: celebrateStep,
  },

  // 6: Another merge, on a second cell
  {
    title: "Let's try another merge",
    text: `
Here is a different one: this time it's a ` + PART + `. The purple ` + PART + ` behind this box lost the yellow piece; the AI left it as its own segment.

1. Press **M** if the merge tool is off.
2. **Ctrl+Click** the yellow piece, in 2D or 3D.
3. **Ctrl+Click** the purple ` + PART + `, close to where the piece should join it.
4. Press **Submit merge** on the bar at the bottom, or press **Enter**.

You'll see "trying..." and then "done", and the piece turns purple.`,
    position: OVER_3D,
    width: "420px",
    onEnter: async () => {
      closeSidePanel();
      // Only one merge cell for now: never show the first again (Ames), go
      // straight to the wrap up.
      if (!holdsSlot('b')) { useTutorialStore().setTutorialStep(7); return; }
      watchPractice(true, 'Waiting for your merge: Ctrl+click yellow, Ctrl+click purple, Submit merge.', '', { advance: true });
      // The second merge cell, taken at How to Merge together with the first.
      await beginPractice('merge_then_cut', 'start', { slot: 'b' });
      setTimeout(() => ensureTool('merge'), 400);
    },
  },

  // 7: Success again, with the tips
  {
    title: "Merge success, again!",
    text: `
Two for two. The piece is part of the ` + PART + ` now.

A few things worth knowing:

- Not sure two pieces belong together? The **2D panel** on the left shows the raw electron microscope slices. Scroll through them at the join for context the 3D can't give you.
- If a merge fails, try clicking at a slightly different spot on each piece.
- Merged the wrong piece? There is no undo key. Fix it with a <strong style="color:#e06060">cut</strong> between the two pieces, which the Cut tutorial teaches.`,
    position: OVER_2D,
    width: "420px",
    onEnter: celebrateStep,
  },

  // 8: Done, and on to cuts
  {
    title: "Merge: done!",
    // Kept short, like "Cut: done!" (the box was 860px tall, more than a
    // laptop screen): small Nurro, the button on its own line, the key list
    // one click away.
    text: `
<img src="` + imgBravoNurro + `" alt="" style="display:block;width:120px;height:auto;margin:0 auto 10px">

You know how to merge. Every merge reconnects a lost branch, and there are thousands waiting.

Next up is the other half of proofreading: a <strong style="color:#e06060">cut</strong> separates two neurons the AI fused together.

<div style="text-align:center">` + startTutorialButton(5, 'Start the Cut tutorial') + `</div>

Or press done and explore. The cells you practised on are put back for the next person.

<a href="` + CHEAT_SHEET_URL + `" target="_blank" rel="noopener" style="color:#7ecaff">Open the cheat sheet in a new tab ↗</a>`,
    position: MIDDLE,
    width: "460px",
    onEnter: () => {
      stopWatching();
      // Whatever state the practice cell is in, put it back for the next person.
      endPractice();
    },
  },
];
