/**
 * Play (Ames 2026-11-09): one button that finds a player something to do and
 * keeps them doing it. "Rather than having to go to available cells and jump
 * to them and claim them, they could just hit play": Play claims a task, jumps
 * to it, and after Complete or Submit claims the next one of the same kind.
 *
 * Two kinds of task:
 *   cells   mapping: proofread a cell's shape (bipolar cells on Retina, or a
 *           Sandbox cell before edit access), Complete to finish it.
 *   quests  annotating: the Cilia Quest, Submit to finish it.
 *
 * Where it starts: the Play button at the top left of the view (PlayButton),
 * "Play here" on the Cell Library's Available and Quests tabs, and the
 * Sandbox card's Start playing. The Cell Library does the work: while Play is
 * on it shows only the task in hand (the slim bar) with Skip and Stop.
 *
 * State: whether Play is on lives in this tab's session, so a dataset switch
 * that reloads the page keeps playing. The kind last chosen is kept in the
 * browser, so the next Play goes straight in. "Enter" is a one time note the
 * Cell Library takes once its cells are in: go to (or claim) a task now.
 */
import { reactive } from 'vue';
import { DATASETS, findDatasetBySegName, currentSegLayerName, canonicalDataset, segLayerName, switchToDataset, type DatasetEntry } from '../datasets';
import { datasetAccess, loadDatasetPermissions, refreshDatasetPermissions } from './dataset_access';
import { startDatasetTransition, transitionDone } from './dataset_transition';
import { skipNextViewRestoreOffer } from './view_autosave';
import { QUEST_DATASET } from '../annotation_quests';
import { useProofreadingBackendStore } from '../store';
import { trainingLeft, openTraining } from './play_training';

export type PlayKind = 'cells' | 'quests';

const KIND_KEY = 'nge-play-kind';
const ON_KEY = 'nge_play_on';
const ENTER_KEY = 'nge_play_enter';
const FRESH_MS = 3 * 60_000;  // a dataset switch can reload the page

function readOn(): PlayKind | null {
  try {
    const v = sessionStorage.getItem(ON_KEY);
    return v === 'cells' || v === 'quests' ? v : null;
  } catch { return null; }
}

export const play = reactive({
  /** The kind being played, or null when Play is off. */
  on: readOn() as PlayKind | null,
  /** The choice card is open. */
  choosing: false,
});

export function savedKind(): PlayKind | null {
  try {
    const v = localStorage.getItem(KIND_KEY);
    return v === 'cells' || v === 'quests' ? v : null;
  } catch { return null; }
}
function keepKind(k: PlayKind) { try { localStorage.setItem(KIND_KEY, k); } catch { /* private window */ } }

function setOn(k: PlayKind | null) {
  play.on = k;
  try { if (k) sessionStorage.setItem(ON_KEY, k); else sessionStorage.removeItem(ON_KEY); } catch { /* private window */ }
}

/** Stop: keep the task in hand, show the full Cell Library again. */
export function stopPlay() {
  setOn(null);
  document.dispatchEvent(new CustomEvent('nge:play-stopped'));
}

/** Ask the Cell Library to go to (or claim) a task of this kind. */
function askEnter(k: PlayKind) {
  try { sessionStorage.setItem(ENTER_KEY, JSON.stringify({ kind: k, at: Date.now() })); } catch { /* the library just opens */ }
}
/** The Cell Library takes the note once: the kind to enter, or null. */
export function takePlayEnter(): PlayKind | null {
  try {
    const w = JSON.parse(sessionStorage.getItem(ENTER_KEY) || 'null');
    sessionStorage.removeItem(ENTER_KEY);
    if (!w || Date.now() - (w.at || 0) > FRESH_MS) return null;
    return w.kind === 'cells' || w.kind === 'quests' ? w.kind : null;
  } catch { return null; }
}

// ── Where each kind is played ───────────────────────────────────────────────
const isAdmin = () => { try { return !!useProofreadingBackendStore().isAdmin; } catch { return false; } };
const canClaimOn = (ds: DatasetEntry | undefined) => !!ds && (isAdmin() || datasetAccess(ds.caveDataset) === 'edit');
const RETINA = () => DATASETS.find(d => d.id === 'stroeh_mouse_retina');
const SANDBOX = () => DATASETS.find(d => d.id === 'pinky_sandbox');
export function datasetHere(): DatasetEntry | undefined { return findDatasetBySegName(currentSegLayerName()); }
const isQuestDataset = (ds: DatasetEntry | undefined) => !!ds && canonicalDataset(segLayerName(ds)) === QUEST_DATASET;

/** Can this player annotate quests? They need edit access on Retina. */
export function canQuest(): boolean { return canClaimOn(RETINA()); }

/** Where mapping happens for this player: the dataset on screen when it has
 *  cells to claim and they may edit it (MEC, say), else Retina's bipolar
 *  cells, else the Sandbox before edit access. */
export function mappingDataset(): DatasetEntry | undefined {
  const here = datasetHere();
  // Before CAVE has answered, the cell dataset on screen is where to play:
  // "unknown" never locks anything (hi529 2026-11-14, just let into MEC, was
  // sent to Retina by Play while the answer was on its way).
  if (here?.cellTasks && here.section !== 'viewonly' && (canClaimOn(here) || datasetAccess(here.caveDataset) === 'unknown')) return here;
  const retina = RETINA();
  if (canClaimOn(retina)) return retina;
  return SANDBOX();
}

/** Hear from CAVE (at most 4 s each) before Play picks the dataset, and ask
 *  again when the cell dataset on screen is not editable by what this page
 *  heard: access may have been granted since (an MEC invite). */
async function settleAccess() {
  const wait = (p: Promise<void>) => Promise.race([p, new Promise<void>(r => setTimeout(r, 4000))]);
  await wait(loadDatasetPermissions());
  const here = datasetHere();
  if (here?.cellTasks && here.section !== 'viewonly' && !canClaimOn(here)) await wait(refreshDatasetPermissions());
}

/** "Bipolar cells on Retina", "cells in the Sandbox", for the choice card. */
export function mappingWhere(): string {
  const ds = mappingDataset();
  if (!ds) return '';
  if (ds.id === 'pinky_sandbox') return 'Sandbox cells, for practice';
  if (ds.id === 'stroeh_mouse_retina') return 'Bipolar cells on Retina';
  return `Cells on ${ds.shortLabel || ds.label}`;
}

/**
 * Start playing a kind: remember it, then go to the dataset it is played on
 * and open the Cell Library there, which takes the task. A switch that
 * reloads the page carries the note across.
 */
export async function startPlay(k: PlayKind, on?: DatasetEntry, justOpen = false): Promise<boolean> {
  play.choosing = false;
  if (!on && k === 'cells') await settleAccess();
  const target = on ?? (k === 'quests' ? RETINA() : mappingDataset());
  if (!target) return false;
  if (k === 'quests' && !canQuest()) return false;
  // Tutorials still to do come first (Ames 2026-11-12): Play carries on the training.
  if (!justOpen) {
    const t = await trainingLeft();
    if (t != null) { openTraining(t); return true; }
  }
  if (!justOpen) { keepKind(k); setOn(k); }
  askEnter(k);
  const tab = k === 'quests' ? 'quests' : 'available';
  const here = datasetHere();
  const already = here && (here.id === target.id || (k === 'quests' && isQuestDataset(here)));
  if (already) {
    document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab, play: k } }));
    return true;
  }
  // As the dataset switcher does: close the library (it belongs to the
  // dataset being left), play "Now entering", and leave word for the next
  // page to open the library on this tab.
  try { sessionStorage.setItem('nge_cl_after_switch', JSON.stringify({ tab, reqId: null, at: Date.now() })); } catch { /* */ }
  skipNextViewRestoreOffer();
  document.dispatchEvent(new CustomEvent('nge:close-cell-library'));
  startDatasetTransition(target);
  await new Promise(r => setTimeout(r, 60));
  let leaving = false;
  const onLeave = () => { leaving = true; };
  window.addEventListener('beforeunload', onLeave);
  const ok = await switchToDataset(target);
  await new Promise(r => setTimeout(r, 1200));
  window.removeEventListener('beforeunload', onLeave);
  if (leaving) return true;
  try { sessionStorage.removeItem('nge_cl_after_switch'); } catch { /* */ }
  if (!ok) { skipNextViewRestoreOffer(false); setOn(null); return false; }
  await transitionDone();
  document.dispatchEvent(new CustomEvent('nge:open-cell-library', { detail: { tab, play: k } }));
  return true;
}

/** "Open active cell" on a dataset card: go there and open your cell, as
 *  Play does, without playing (Ames 2026-11-12). */
export function openMyCell(ds: DatasetEntry): Promise<boolean> { return startPlay('cells', ds, true); }

/** What is being played, for the top bar: "BC Challenge", "Cilia Quest". */
export function playLabel(): string {
  if (play.on === 'quests') return 'Cilia Quest';
  const ds = mappingDataset();
  if (ds?.id === 'stroeh_mouse_retina') return 'BC Challenge';
  if (ds?.id === 'pinky_sandbox') return 'Sandbox practice';
  return ds ? `${ds.shortLabel || ds.label} mapping` : 'Mapping';
}

/** The choice between mapping and Cilia Quest is only ever offered on Retina,
 *  where the quests are, to a player who may do them. On any other dataset
 *  (the Sandbox, MEC) Play just starts mapping there (Ames 2026-11-12: "if I'm
 *  in the sandbox ... it should just start me playing in the sandbox"). */
export function offersChoice(): boolean { return isQuestDataset(datasetHere()) && canQuest(); }

/** The Play button: straight in with the kind last chosen, else the card. */
export function pressPlay() {
  if (!offersChoice()) { void startPlay('cells'); return; }
  const k = savedKind();
  if (k && (k === 'cells' || canQuest())) { void startPlay(k); return; }
  play.choosing = true;
}
/** Open the choice card to change the kind; off Retina, just play here. */
export function choosePlay() {
  if (!offersChoice()) { void startPlay('cells'); return; }
  play.choosing = true;
}
