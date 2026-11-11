/**
 * Tutorial 14 : Cilia Quest
 * --------------------------------------------------------------
 * How to do a Cilia Quest, on the lab's own example (Ames 2026-11-10: "a
 * Cilia Quest tutorial ... using demo annotations they can see and practice
 * on"). The plan Ames approved:
 *   1. a finished example: the lab's "Cilium annotated" cell
 *      (annotation_quest_examples.ts, the only lab example with a centerline),
 *      its three marks shown one at a time;
 *   2. practice: the same cell with the marks hidden and the three empty
 *      layers a real quest has. Each mark is checked against the lab's as it
 *      is placed ("Spot on", "that's the daughter centriole", "Not quite"
 *      with Show me); then the lab's answer comes back to compare;
 *   3. the status: the lab's two "No cilium" examples, and the player picks
 *      the status from the real list, answered in the lab's own words;
 *   4. Submit, Split or Merged, Notes and Release, then Open Cilia Quests.
 * Nothing is claimed and nothing goes to the lab's sheet. Admins can reword
 * every box with the pencil, as in the other tutorials (tutorial_edits.ts):
 * the buttons and the feedback line are found by their data attributes, so
 * they keep working in an edited box.
 *
 * Started from the Quests tab's Tutorial button, the Instructions box and the
 * burger menu, by `nge:tutorial-start` with id 14 (startCiliaTutorial).
 */
import { Step, useTutorialStore } from './store-pyr';
import { findDatasetByCanonical } from './datasets';
import { QUEST_EXAMPLES, QUEST_STATUS_GUIDE, type QuestExample } from './annotation_quest_examples';
import { questWork, questOnScreen, saveQuestWork, markQuestOnScreen } from './annotation_quests';
import { makeLayer } from 'neuroglancer/layer';
import { stopWatching } from './tutorial-3';
import { supabase } from './supabase';
import { useProofreadingBackendStore } from './store';
import { awardSpecialOnce } from './util/special_award';
import imgCiliaAnnotated from './images/cilia-annotated.jpg';

export const CILIA_TUTORIAL = 14;

/** Start it the way every menu entry does (Tutorial.vue, tutorial-3.ts). */
export function startCiliaTutorial() {
  document.dispatchEvent(new CustomEvent('nge:tutorial-start', { detail: { id: CILIA_TUTORIAL } }));
}

// ── The example cells ────────────────────────────────────────────────────
const DEMO = QUEST_EXAMPLES.find(e => e.status === 'Cilium annotated' && e.centerline)!;
const CLEAR = QUEST_EXAMPLES.find(e => e.status === 'No cilium (BB & DC clear)')!;
const UNCLEAR = QUEST_EXAMPLES.find(e => e.status === 'No cilium (BB & DC unclear; internal centriole pair)')!;

const COLORS = { centerline: '#7CFFB2', daughter: '#e06060', basal: '#f5d142', answer: '#ffffff' };
/** The layers a real quest has, with the names players see in the Instructions. */
const LAYER = { centerline: 'Cilium centerline', daughter: 'Daughter centriole', basal: 'Basal body' };
const ANSWER_LAYER = "Lab's answer";
/** Retina voxels, in nanometers. */
const VOXEL_NM = [16, 16, 40];

/** The layers carry the retina's coordinates themselves: a plain
 *  'local://annotations' made while a step's view is loading gets an empty
 *  coordinate space, and then refuses every mark it is given. */
const DIMENSIONS = { x: [1.6e-8, 'm'], y: [1.6e-8, 'm'], z: [4e-8, 'm'] };
function annotationLayer(name: string, color: string, tool: string, annotations: any[]) {
  return {
    type: 'annotation', source: { url: 'local://annotations', transform: { outputDimensions: DIMENSIONS } },
    tab: 'annotations', name, annotationColor: color, tool, annotations,
  };
}
function marksOf(e: QuestExample, tag: string) {
  return {
    centerline: e.centerline ? [{ type: 'polyline', id: `${tag}-centerline`, points: e.centerline, description: 'Cilium centerline: from the base of the cilium to its tip' }] : [],
    daughter: [{ type: 'point', id: `${tag}-daughter`, point: e.daughterCentriole, description: 'Daughter centriole: the partner, set back from the base' }],
    basal: [{ type: 'point', id: `${tag}-basal`, point: e.basalBody, description: 'Basal body: where the cilium starts' }],
  };
}
/** A view of one example cell, with its three layers filled or left empty. */
function exampleState(e: QuestExample, filled: boolean, selected: string = LAYER.centerline) {
  const dataset = findDatasetByCanonical('stroeh_mouse_retina');
  const base = (dataset?.layers ?? []).map((l: any) =>
      typeof l?.type === 'string' && l.type.startsWith('segmentation')
        // See-through, so the marks inside the cell show in 3D (Ames, 2026-11-10).
        ? { ...l, segments: [e.root], objectAlpha: 0.35, selectedAlpha: 0.29 } : { ...l });
  const m = filled ? marksOf(e, 'demo') : { centerline: [], daughter: [], basal: [] };
  return {
    dimensions: DIMENSIONS,
    position: e.position,
    crossSectionScale: e.crossSectionScale,
    projectionScale: e.projectionScale,
    ...(e.projectionOrientation ? { projectionOrientation: e.projectionOrientation } : {}),
    layout: 'xy-3d',
    // The 2D slice shown in the 3D view, so the two views line up (Ames).
    showSlices: true,
    layers: [
      ...base,
      annotationLayer(LAYER.centerline, COLORS.centerline, 'annotatePolyline', m.centerline),
      annotationLayer(LAYER.daughter, COLORS.daughter, 'annotatePoint', m.daughter),
      annotationLayer(LAYER.basal, COLORS.basal, 'annotatePoint', m.basal),
    ],
    selectedLayer: { layer: selected, visible: true },
    selection: { visible: false },
  };
}

// ── The viewer ───────────────────────────────────────────────────────────
const viewer = (): any => (window as any).viewer;
const isAnnotation = (ml: any) => ml?.layer?.type === 'annotation' || ml?.layer?.constructor?.type === 'annotation';
function findLayer(name: string): any {
  return (viewer()?.layerManager?.managedLayers ?? []).find((ml: any) => isAnnotation(ml) && ml.name === name) ?? null;
}
function selectLayer(name: string) {
  const v = viewer(), ml = findLayer(name);
  if (!v || !ml) return;
  try { v.selectedLayer.layer = ml; v.selectedLayer.visible = true; } catch { /* not ready */ }
}
/** Move the crosshairs onto a spot, closer in. */
function goTo(p: number[], zoom = 0.6) {
  try {
    const v = viewer();
    v.navigationState.position.value = Float32Array.from(p);
    if (zoom) v.navigationState.zoomFactor.value = zoom;
  } catch { /* the view stays as it is */ }
}
/** A pulsing ring and an arrow on the middle of the 2D view, where goTo put
 *  the mark (Ames, 2026-11-10: "a little arrow pointing to it"). It goes when
 *  the box changes or the 2D view is dragged, since then it no longer points
 *  at the mark. */
let pointerTimer = 0;
function clearPointer() {
  document.getElementById('nge-cq-pointer')?.remove();
  window.clearInterval(pointerTimer);
}
function pointAt(color: string, label: string) {
  clearPointer();
  const panels = [...document.querySelectorAll<HTMLElement>('.neuroglancer-rendered-data-panel')]
    .filter(el => !el.classList.contains('nge-3d') && !el.classList.contains('nge-3d-panel') && el.offsetWidth > 0);
  const panel = panels.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0];
  if (!panel) return;
  const r = panel.getBoundingClientRect();
  const el = document.createElement('div');
  el.id = 'nge-cq-pointer';
  el.className = 'nge-cq-pointer';
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + r.height / 2}px`;
  el.style.setProperty('--nge-cq-color', color);
  el.innerHTML = `<div class="nge-cq-pointer__ring"></div><div class="nge-cq-pointer__arrow"><span>${label}</span>&#x2198;</div>`;
  document.body.appendChild(el);
  const st = useTutorialStore();
  const at = `${st.activeTutorial}:${st.getTutorialStep()}`;
  const drag = () => clearPointer();
  panel.addEventListener('pointerdown', drag, { once: true });
  pointerTimer = window.setInterval(() => {
    const now = `${st.activeTutorial}:${st.getTutorialStep()}`;
    if (!document.getElementById('nge-cq-pointer') || now !== at) { panel.removeEventListener('pointerdown', drag); clearPointer(); }
  }, 400);
}
const POINT = {
  basal: () => { selectLayer(LAYER.basal); goTo(DEMO.basalBody, 0.3); setTimeout(() => pointAt(COLORS.basal, 'Basal body'), 300); },
  daughter: () => { selectLayer(LAYER.daughter); goTo(DEMO.daughterCentriole, 0.3); setTimeout(() => pointAt(COLORS.daughter, 'Daughter centriole'), 300); },
  centerline: () => { selectLayer(LAYER.centerline); const c = DEMO.centerline!; goTo(c[Math.floor(c.length / 2)], 0.6); setTimeout(() => pointAt(COLORS.centerline, 'Cilium centerline'), 300); },
};
function annotationsIn(name: string): any[] {
  try {
    const a = findLayer(name)?.layer?.localAnnotations?.toJSON?.();
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function removeAnswerLayer() {
  try {
    const lm = viewer()?.layerManager;
    for (const ml of [...(lm?.managedLayers ?? [])]) if (ml.name === ANSWER_LAYER) lm.removeManagedLayer(ml);
  } catch { /* nothing to remove */ }
}
function addAnswerLayer() {
  removeAnswerLayer();
  const v = viewer();
  if (!v) return;
  const m = marksOf(DEMO, 'answer');
  try {
    const managed = makeLayer(v.layerSpecification, ANSWER_LAYER, annotationLayer(ANSWER_LAYER, COLORS.answer, 'annotatePoint',
        [...m.centerline, ...m.daughter, ...m.basal]));
    v.layerSpecification.add(managed);
  } catch (e) { console.warn('[cilia tutorial] could not add the answer layer:', e); }
}

/** The Achievement for finishing this tutorial: an admin makes it in the
 *  Admin Hub with this code name (its name, words and art are theirs). Until
 *  then nothing happens. The server checks the player's own finish record
 *  (tutorial_completions, tutorial 14) before it lets the award through. */
export const CILIA_ACHIEVEMENT = 'cilia-tutorial';
export async function awardCiliaAchievement() {
  try {
    const uid = useProofreadingBackendStore().userId;
    if (!uid) return;
    const { data, error } = await supabase.from('tutorial_completions')
      .select('tutorial').eq('user_id', uid).eq('tutorial', CILIA_TUTORIAL).limit(1);
    if (error || !data?.length) return;
    await awardSpecialOnce({ slug: CILIA_ACHIEVEMENT, reason: 'Finished Cilia Quest Training', earnedBy: 'finished Cilia Quest Training' });
  } catch { /* tried again at the next sign in */ }
}
// Also from the account's record, so players who finished before the
// Achievement existed get it at their next visit.
setTimeout(() => { void awardCiliaAchievement(); }, 8000);

/** A Cilia Quest open in this tab is saved and marked off screen before the
 *  tutorial's view replaces it, so its autosave never saves the tutorial as
 *  the quest's work (annotation_quests.ts startQuestWorkWatch). */
function leaveQuestScreen() {
  const a = questWork.active;
  if (a && questOnScreen(a.segmentId)) void saveQuestWork(a.segmentId);  // reads the view at once
  markQuestOnScreen(null);
}
/** A merge or cut tool left on (merge mode from the Merge tutorial or from
 *  play) would take the tutorial's Ctrl+clicks as merge points, so it goes
 *  off as the tutorial starts (Ames, 2026-11-10). */
function toolsOff() {
  // The Merge or Cut tutorial's checker too, with its "Merge mode is off"
  // line and Help me button (Ames, 2026-11-10).
  stopWatching();
  document.querySelectorAll('.introductionStepAnchor .nge-practice-status, .introductionStepAnchor .nge-practice-helprow').forEach(el => el.remove());
  const v = viewer();
  try { v?.globalToolBinder?.activeTool_?.cancel?.(); } catch { /* */ }
  try { v?.toolBinder?.activeTool_?.cancel?.(); } catch { /* */ }
}
document.addEventListener('nge:tutorial-start', (e: Event) => {
  if (Number((e as CustomEvent).detail?.id) !== CILIA_TUTORIAL) return;
  leaveQuestScreen();
  toolsOff();
});

// ── Checking the player's marks ──────────────────────────────────────────
const nm = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => (v - b[i]) * VOXEL_NM[i]));
/** Distance (nm) from a point to a polyline. */
function toLine(p: number[], line: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const ab = a.map((v, k) => (b[k] - v) * VOXEL_NM[k]);
    const ap = a.map((v, k) => (p[k] - v) * VOXEL_NM[k]);
    const len2 = ab.reduce((s, v) => s + v * v, 0);
    const t = len2 ? Math.max(0, Math.min(1, ab.reduce((s, v, k) => s + v * ap[k], 0) / len2)) : 0;
    best = Math.min(best, Math.hypot(...ap.map((v, k) => v - t * ab[k])));
  }
  if (line.length === 1) best = nm(p, line[0]);
  return best;
}
const NEAR_NM = 350;   // on the centriole: about its own length
const CLOSE_NM = 900;  // nearby, about the distance between the two centrioles

type Grade = 'ok' | 'swap' | 'close' | 'off';
const results: Record<'basal' | 'daughter' | 'centerline', Grade | null> = { basal: null, daughter: null, centerline: null };

const showMe = (what: string) => `<button type="button" class="nge-hud-btn nge-hud-btn--sm" data-nge-cq-show="${what}" title="Take me to it">Help me</button>`;
const note = (kind: 'ok' | 'warn' | '', html: string) => `<div class="nge-hud-note${kind ? ' nge-hud-note--' + kind : ''}">${html}</div>`;

function gradePoint(which: 'basal' | 'daughter'): { grade: Grade | null; html: string } {
  const pts = annotationsIn(which === 'basal' ? LAYER.basal : LAYER.daughter).filter(a => a?.type === 'point' && Array.isArray(a.point));
  const name = which === 'basal' ? 'basal body' : 'daughter centriole';
  if (!pts.length) return { grade: null, html: note('', `Waiting for your ${name}. <strong>CTRL+CLICK</strong> on it in the 2D view. Stuck? ${showMe(which)}`) };
  const p = pts[pts.length - 1].point;
  const target = which === 'basal' ? DEMO.basalBody : DEMO.daughterCentriole;
  const other = which === 'basal' ? DEMO.daughterCentriole : DEMO.basalBody;
  const d = nm(p, target), dOther = nm(p, other);
  const extra = pts.length > 1 ? ' One point is all it needs: remove the others with the trash icon in the list on the right.' : '';
  if (d <= NEAR_NM) return { grade: 'ok', html: note('ok', `Spot on! That's the ${name}.${extra}`) };
  if (dOther <= NEAR_NM) return {
    grade: 'swap',
    html: note('warn', (which === 'basal'
      ? 'Close, but that\'s the <strong>daughter centriole</strong>. The basal body is its partner right at the base of the cilium, where the cilium leaves the cell.'
      : 'Close, but that\'s the <strong>basal body</strong>, at the base of the cilium. The daughter centriole is its partner, set back a little from it.')
      + ` Remove it with the trash icon in the list on the right, then try again. ${showMe(which)}`),
  };
  if (d <= CLOSE_NM) return { grade: 'close', html: note('warn', `Close! The ${name} is a little way from there. Scroll through a few slices to find it. ${showMe(which)}`) };
  return {
    grade: 'off',
    html: note('warn', `Not quite. ${which === 'basal' ? 'Follow the cilium back to where it leaves the cell: the basal body sits right at its base.' : 'Look just behind the basal body, inside the cell: the daughter centriole is the second small barrel there.'} ${showMe(which)}`),
  };
}

function gradeLine(): { grade: Grade | null; html: string } {
  const lines = annotationsIn(LAYER.centerline).filter(a => a?.type === 'polyline' && Array.isArray(a.points) && a.points.length >= 2);
  if (!lines.length) return { grade: null, html: note('', 'Waiting for your line. Hold <strong>CTRL</strong> and click along the cilium, then press <kbd>ENTER</kbd>. Stuck? ' + showMe('centerline')) };
  const mine: number[][] = lines[lines.length - 1].points;
  const lab = DEMO.centerline!;
  const off = mine.map(p => toLine(p, lab));
  const meanOff = off.reduce((s, v) => s + v, 0) / off.length;
  const covered = lab.filter(p => toLine(p, mine) <= 500).length / lab.length;
  if (meanOff > 600) return { grade: 'off', html: note('warn', `Your line is not on the cilium yet. The cilium is the thin tube that starts at the basal body and leaves the cell. ${showMe('centerline')}`) };
  if (covered < 0.6) return { grade: 'close', html: note('warn', `Good start! The cilium runs further than that: trace it from its base all the way to its tip. Draw a new line, then remove the short one with the trash icon. ${showMe('centerline')}`) };
  return { grade: 'ok', html: note('ok', 'Nicely traced! Your line follows the cilium from base to tip.') };
}

/** While this step shows: check the player's mark, write the feedback into
 *  the box, and let Next through once it is right. */
function watchMark(which: 'basal' | 'daughter' | 'centerline') {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  let last = '';
  const mark = which;
  const layerName = which === 'basal' ? LAYER.basal : which === 'daughter' ? LAYER.daughter : LAYER.centerline;
  const started = Date.now();
  const tick = () => {
    if (!here()) { clearInterval(timer); return; }
    // A step's view can finish loading just after the box opens and put its
    // own selected layer back: hold this one for the first few seconds.
    const selected = viewer()?.selectedLayer?.layer?.name;
    if (selected !== layerName && Date.now() - started < 4000) selectLayer(layerName);
    const graded = which === 'centerline' ? gradeLine() : gradePoint(which);
    const grade = graded.grade;
    let html = graded.html;
    // Ctrl+click marks the selected layer: say so when it is another one.
    if (grade !== 'ok' && selected && selected !== layerName && Date.now() - started >= 4000) {
      const which = [LAYER.basal, LAYER.daughter, LAYER.centerline].includes(selected) ? `<strong>${selected}</strong> layer` : 'cell layer';
      html = note('warn', `The ${which} is selected, so your clicks go there. Click the <strong>${layerName}</strong> tab at the top first. ${showMe(mark)}`);
    }
    if (grade) results[which] = grade;
    if (grade === 'ok') (window as any).__ngeStepPending = false;
    const el = document.querySelector<HTMLElement>('.introductionStep [data-nge-cq-feedback]');
    if (el && html !== last) { el.innerHTML = html; last = html; }
  };
  const timer = setInterval(tick, 400);
  setTimeout(tick, 300);
}
/** A step waits on the player (Tutorial.vue: the first Next says try it first). */
function waitForAction() { (window as any).__ngeStepPending = true; }

// ── The status quiz ──────────────────────────────────────────────────────
const QUIZ_CHOICES = [
  'Cilium annotated',
  'No cilium (BB & DC clear)',
  'No cilium (BB & DC unclear; internal centriole pair)',
  'Skipped (low quality)',
];
/** The statuses the lead-in box explains, in the lab's words. "No cilium"
 *  alone is for reviewers, so it is left out. */
const STATUS_LIST = [
  'Cilium annotated',
  'No cilium (BB & DC clear)',
  'No cilium (BB & DC unclear; internal centriole pair)',
  'Need help',
  'Need help: One centriole missing',
  'Skipped (low quality)',
].filter(s => QUEST_STATUS_GUIDE[s]);
const QUIZ_ANSWER: Record<string, string> = { clear: CLEAR.status, unclear: UNCLEAR.status };
const QUIZ_WHY: Record<string, string> = {
  clear: 'There is no cilium, and you can tell the two centrioles apart: the basal body is the one nearer the cell\'s surface.',
  unclear: 'There is no cilium, and the two centrioles sit deep inside the cell, so you cannot tell which one is the basal body.',
};
/** A close call (Ames, 2026-11-10: this cell looked to her like it has a
 *  cilium). Said with either answer, and a pick of Cilium annotated is not
 *  called wrong. */
const CLOSE_CALL: Record<string, string> = {
  clear: 'This one is a close call: something near the top can look like a cilium. The lab looked closely and called it no cilium. When you are not sure in a real quest, say so in the Notes.',
};
function quiz(id: 'clear' | 'unclear') {
  return `<div class="nge-cq-quiz" data-nge-cq-quiz="${id}">`
    + QUIZ_CHOICES.map(s => `<button type="button" class="nge-cq-choice" data-nge-cq-pick="${s}">${s}</button>`).join('')
    + `</div><div data-nge-cq-feedback></div>`;
}
function quizStep() {
  waitForAction();
}

// One listener for the buttons inside the boxes (an edited box keeps them).
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement | null;
  const show = t?.closest?.('[data-nge-cq-show]') as HTMLElement | null;
  if (show) {
    e.preventDefault();
    const what = show.dataset.ngeCqShow;
    if (what === 'basal' || what === 'daughter' || what === 'centerline') POINT[what]();
    const box = show.closest('[data-nge-cq-feedback]');
    if (box && !box.querySelector('.nge-cq-shown')) box.insertAdjacentHTML('beforeend', '<div class="nge-cq-shown">The crosshairs are on it now. Look at the center of the 2D view.</div>');
    return;
  }
  const go = t?.closest?.('[data-nge-cq-go]') as HTMLElement | null;
  if (go) {
    e.preventDefault();
    const what = go.dataset.ngeCqGo;
    if (what === 'basal' || what === 'daughter' || what === 'centerline') POINT[what]();
    return;
  }
  const pick = t?.closest?.('[data-nge-cq-pick]') as HTMLElement | null;
  if (!pick) return;
  e.preventDefault();
  const quizEl = pick.closest('[data-nge-cq-quiz]') as HTMLElement | null;
  const id = quizEl?.dataset.ngeCqQuiz || '';
  const answer = QUIZ_ANSWER[id];
  if (!answer) return;
  const picked = pick.dataset.ngeCqPick || '';
  const right = picked === answer;
  quizEl!.querySelectorAll('.nge-cq-choice').forEach(b => b.classList.remove('nge-cq-choice--right', 'nge-cq-choice--wrong'));
  pick.classList.add(right ? 'nge-cq-choice--right' : 'nge-cq-choice--wrong');
  const fb = quizEl!.parentElement?.querySelector<HTMLElement>('[data-nge-cq-feedback]');
  const close = CLOSE_CALL[id] ? ` <span class="nge-cq-lab">${CLOSE_CALL[id]}</span>` : '';
  if (fb) fb.innerHTML = right
    ? note('ok', `Right! ${QUIZ_WHY[id] || ''} <span class="nge-cq-lab">The lab's guide: "${QUEST_STATUS_GUIDE[answer] || ''}"</span>${close}`)
    : close && picked === 'Cilium annotated'
      ? note('warn', `Good eye, but not quite.${close} Which status fits a cell with no cilium?`)
      : note('warn', `Not this one. <strong>${picked}</strong> is for: ${QUEST_STATUS_GUIDE[picked] || 'other cases'}. Look at the cell again and try another.`);
  if (right) {
    (window as any).__ngeStepPending = false;
    // A "give it a try first" from an earlier Next no longer applies.
    document.querySelectorAll('.introductionStep .nge-tut-nudge').forEach(el => el.remove());
  }
}, true);

/** The compare step: the lab's answer in white, and how each mark went. */
function compareStep() {
  addAnswerLayer();
  goTo(DEMO.position, DEMO.crossSectionScale);
  const said: Record<Grade, string> = { ok: 'spot on', swap: 'swapped with its partner', close: 'close', off: 'not on it yet' };
  const line = (label: string, g: Grade | null) => `<li>${label}: <strong>${g ? said[g] : 'skipped'}</strong></li>`;
  const html = `<ul class="nge-cq-score">${line('Basal body', results.basal)}${line('Daughter centriole', results.daughter)}${line('Cilium centerline', results.centerline)}</ul>`;
  // The box is drawn after this runs: fill it in once it is there.
  let tries = 0;
  const timer = setInterval(() => {
    const el = document.querySelector<HTMLElement>('.introductionStep [data-nge-cq-feedback]');
    if (el) el.innerHTML = html;
    if (el || ++tries > 30) clearInterval(timer);
  }, 200);
}

// ── The boxes ────────────────────────────────────────────────────────────
const MIDDLE = { element: 'body', x: 0.5, y: 0.5 };
/** Over the 3D panel, out of the way of the 2D view where the work is. */
const OVER_3D = { element: '.neuroglancer-rendered-data-panel.nge-3d-panel', x: 0.5, y: 0.03 };
/** Room for the status choices and the feedback line. */
const BOX_W = '400px';
const chip = (name: string, color: string) => `<span class="nge-hud-chip" style="border-color:${color};color:${color}">${name}</span>`;
const BB = chip('Basal body', COLORS.basal), DC = chip('Daughter centriole', COLORS.daughter), CL = chip('Cilium centerline', COLORS.centerline);
/** On the finished example a name is a link: a click takes the view to that
 *  mark (Ames, 2026-11-10: "click to see the labels"). Not used on the
 *  practice boxes, where it would give the answer away. */
const goChip = (name: string, color: string, what: string) =>
  `<span class="nge-hud-chip nge-cq-go" data-nge-cq-go="${what}" title="Click to go to this mark" style="border-color:${color};color:${color}">${name}</span>`;
const BBgo = goChip('Basal body', COLORS.basal, 'basal'), DCgo = goChip('Daughter centriole', COLORS.daughter, 'daughter'), CLgo = goChip('Cilium centerline', COLORS.centerline, 'centerline');

export const steps: Step[] = [
  {
    part: 'Look at a finished one',
    title: 'Hunt for a cilium',
    image: imgCiliaAnnotated,
    modal: true,
    position: MIDDLE,
    width: '620px',
    text: `Almost every cell has one **primary cilium**, a tiny antenna that senses the chemistry around it. In a Cilia Quest you find the cilium on a starburst cell in the retina and mark it for the lab.

This is **Cilia Quest Training**. First you'll look at a cell the lab has already marked, then you'll mark it yourself and we'll check your work. It takes about five minutes.

Already know how? Close this box with the ✕. You can come back any time with the **Training** button in the Quests tab.`,
    nextLabel: 'Start',
    onEnter: leaveQuestScreen,
  },
  {
    part: 'Look at a finished one',
    title: 'A finished Cilia Quest',
    state: exampleState(DEMO, true),
    position: OVER_3D,
    width: BOX_W,
    html: `This starburst cell has been marked by the lab. A finished quest has three marks, each in its own layer:
<ul>
<li>${CLgo} a line along the cilium</li>
<li>${BBgo} where the cilium starts</li>
<li>${DCgo} its partner, just behind it</li>
</ul>
Click a name to go to its mark. The 2D view on the left is where you work. Let's look at each mark.`,
  },
  {
    part: 'Look at a finished one',
    title: 'The cilium centerline',
    position: OVER_3D,
    width: BOX_W,
    html: `The green line is the ${CLgo}. We start with it because the cilium is the easiest part to spot: a thin finger sticking out of the cell. The line runs down its middle, from its base to its tip.

<p>To draw one: select its layer, hold <strong>CTRL</strong> and click point by point along the cilium, then press <kbd>ENTER</kbd> to finish. <kbd>BACKSPACE</kbd> takes back the last point and <kbd>ESC</kbd> cancels the line.</p>

<p>The line tool is already on for this layer: in the layer panel on the right, the zigzag line button is lit. If CTRL+click ever drops single dots instead of a line, click that button first.</p>`,
    onEnter() { POINT.centerline(); },
  },
  {
    part: 'Look at a finished one',
    title: 'The basal body',
    position: OVER_3D,
    width: BOX_W,
    html: `The gold point is the ${BBgo}. Follow the green line down to the base of the cilium and you find it: a tiny barrel, a <strong>centriole</strong>, right where the cilium leaves the cell.

<p>The crosshairs are on it now. Scroll the mouse wheel over the 2D view to move up and down through the slices and see its shape.</p>`,
    onEnter() { POINT.basal(); },
  },
  {
    part: 'Look at a finished one',
    title: 'The daughter centriole',
    position: OVER_3D,
    width: BOX_W,
    html: `The red point is the ${DCgo}, the basal body's partner. It is a second small barrel, set back a little from the base of the cilium and often turned at an angle to the first.

<p>The two always come as a pair. If you find one, look close by for the other.</p>`,
    onEnter() { POINT.daughter(); },
  },
  {
    part: 'Your turn',
    title: 'Now you try',
    state: exampleState(DEMO, false),
    position: OVER_3D,
    width: BOX_W,
    html: `Same cell, but the lab's marks are hidden. You have the three empty layers a real quest gives you: ${CL}, ${DC} and ${BB}.

<p>You'll place each mark, and we'll tell you right away how close you are.</p>`,
    onEnter() { removeAnswerLayer(); results.basal = results.daughter = results.centerline = null; },
  },
  {
    part: 'Your turn',
    title: 'Trace the cilium',
    position: OVER_3D,
    width: BOX_W,
    html: `First the cilium, the easiest part to find. The ${CL} layer is selected and its line tool is on (the lit zigzag button in the layer panel on the right; click it if it is not lit). Hold <strong>CTRL</strong> and click along the middle of the cilium, from its base to its tip, then press <kbd>ENTER</kbd>.

<p>The cilium may run through several slices: scroll as you go and keep clicking.</p>
<div data-nge-cq-feedback></div>`,
    onEnter() { removeAnswerLayer(); selectLayer(LAYER.centerline); watchMark('centerline'); },
  },
  {
    part: 'Your turn',
    title: 'Mark the basal body',
    position: OVER_3D,
    width: BOX_W,
    html: `Now the ${BB} layer is selected. Follow your line back to where the cilium leaves the cell, then <strong>CTRL+CLICK</strong> on the basal body at its base in the 2D view.
<div data-nge-cq-feedback></div>`,
    onEnter() { removeAnswerLayer(); selectLayer(LAYER.basal); watchMark('basal'); },
  },
  {
    part: 'Your turn',
    title: 'Mark the daughter centriole',
    position: OVER_3D,
    width: BOX_W,
    html: `Last one: the ${DC} layer is selected. Find the basal body's partner, just behind it, and <strong>CTRL+CLICK</strong> on it.
<div data-nge-cq-feedback></div>`,
    onEnter() { removeAnswerLayer(); selectLayer(LAYER.daughter); watchMark('daughter'); },
  },
  {
    part: 'Your turn',
    title: 'Compare with the lab',
    position: OVER_3D,
    width: BOX_W,
    html: `The lab's answer is back, in white, in its own layer called <strong>Lab's answer</strong>. Your marks are in color. How did you do?
<div data-nge-cq-feedback></div>
<p>Right click the <strong>Lab's answer</strong> tab to hide it and show it again.</p>`,
    onEnter: compareStep,
  },
  {
    part: 'Choose a status',
    title: 'Every quest gets a status',
    position: OVER_3D,
    width: '460px',
    html: `When you submit a quest, you also pick a <strong>status</strong>: one line that tells the lab what you found. Not every cell has a cilium you can see, and the status says so.
<ul class="nge-cq-statuses">${STATUS_LIST.map(s => `<li><strong>${s}</strong>: ${QUEST_STATUS_GUIDE[s]}</li>`).join('')}</ul>
<p>Next, two cells from the lab with no cilium. Pick the status that fits each.</p>`,
  },
  {
    part: 'Choose a status',
    title: 'No cilium here',
    state: exampleState(CLEAR, true),
    position: OVER_3D,
    width: BOX_W,
    html: `Some cells have no cilium you can see. You still mark the two centrioles if you can find them, and the status says what you found.

<p>The lab marked this cell's two centrioles. Look closely: is there a cilium? Can you tell which centriole is the basal body? Which status fits?</p>
${quiz('clear')}`,
    onEnter: quizStep,
  },
  {
    part: 'Choose a status',
    title: 'Which one is which?',
    state: exampleState(UNCLEAR, true),
    position: OVER_3D,
    width: BOX_W,
    html: `Here is another cell with no cilium. This time its two centrioles sit deep inside the cell, side by side. Which status fits?
${quiz('unclear')}`,
    onEnter: quizStep,
  },
  {
    part: 'Choose a status',
    title: 'Sending your quest',
    position: MIDDLE,
    modal: true,
    width: '560px',
    html: `In a real quest, when your marks are in:
<ul>
<li>Put the crosshairs inside the cell and press <strong>Submit</strong> on its row in the Quests tab.</li>
<li>Choose the <strong>cilium status</strong>. The list explains each one as you pick it.</li>
<li>Say whether the cilium is <strong>Split</strong> (cut off into another segment) or <strong>Merged</strong> (joined to something that isn't this cell), if either.</li>
<li>Add <strong>Notes</strong> for the reviewers if anything was unusual.</li>
</ul>
<p>Can't find a cilium or the centrioles at all? Choose <strong>Need help</strong> and say what you saw. You can hold three cells at a time, and <strong>Release</strong> sends one back for someone else.</p>
<p>That's everything. Ready for a real one?</p>`,
    nextLabel: 'Open Cilia Quests',
    notNowLabel: 'Not now',
  },
];
