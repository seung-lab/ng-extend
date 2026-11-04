/**
 * mentor.ts: the mentor program, a proof of concept (Nseraf, triage report
 * 317; Ames 2026-11-04). A new player's first cells get a second look before
 * they count. Server: functions/mentors.js (ewMentor). Tab: Cell Library,
 * Mentoring (MentoringTab.vue). In the view: MentorBox.vue.
 *
 * The apprentice: Complete in the Cell Library sends the cell to a mentor
 * (sendForSecondLook) instead of completing it. Nothing is written to CAVE,
 * the claim or the sheet, and nothing counts, until a mentor completes it.
 *
 * The mentor: takes a cell, opens it in the view with a "Mentor notes" layer,
 * drops notes (points with a few words), then sends suggestions or completes
 * it. Complete writes the CAVE mark from the mentor's browser without counting
 * it for the mentor (setCellComplete forApprentice), and the server finishes
 * the apprentice's claim and credits them.
 *
 * After a mentor's Complete, the apprentice's own browser writes the cell's
 * sheet row (the sheet only takes a row from the player whose claim it is).
 */
import { reactive, ref } from 'vue';
import { makeLayer } from 'neuroglancer/layer';
import { secureWrite } from './secure_write';
import { apprenticeFlag } from './util/mentor_flag';
import { setStateRewriter, useLayersStore, useCellHistoryStore, useProofreadingBackendStore } from './store';
import { currentDatasetTag } from './datasets';
import { setCellComplete, activeCaveServer, getLastCompletionProblem, labelAxonComplete } from './widgets/lightbulb_service';
import { syncCellToSheet, marksProofread, AXON_COMPLETE } from './sheet_sync';

export interface MentorNote { id: string; position: number[]; text: string }
export interface MentorReview {
  id: number; state: 'waiting' | 'looking' | 'suggestions' | 'complete'; rounds: number;
  apprenticeId: string; apprenticeName: string; mentorId: string | null; mentorName: string | null;
  dataset: string; logDataset: string; taskId: number; segmentId: string; rootId: string;
  position: number[] | null; link: string; done: { status?: string; notes?: string; cellType?: string; coords?: string; sheet?: boolean };
  notes: MentorNote[]; cellNote: string;
  sentAt: string; claimedAt: string | null; decidedAt: string | null; touchedAt: string; sheetDone: boolean;
}
export interface Apprentice {
  id: string; name: string; status: 'active' | 'finished' | 'left'; mentorId: string | null; mentorName: string | null;
  cellsDone: number; cellsNeeded: number; startedAt: string; finishedAt: string | null;
}

export const mentorState = reactive({
  loaded: false,
  /** False until the SQL is run and ewMentor is deployed: then nothing shows. */
  installed: false,
  admin: false,
  mentor: false,
  apprentice: null as Apprentice | null,
  /** The apprentice's own cells, every state. */
  mine: [] as MentorReview[],
  /** Mentors: cells nobody has taken, and cells waiting for this mentor. */
  waiting: 0,
  yours: 0,
  queue: null as null | { waiting: MentorReview[]; yours: MentorReview[]; apprentices: Apprentice[]; slots: { used: number; max: number } },
  error: '',
});

const call = <T = any>(action: Parameters<typeof secureWrite>[0], args: Record<string, any> = {}) => secureWrite<T>(action, args);

/** Shown to mentors, admins and apprentices once the program is installed. */
export const mentoringShown = () => mentorState.installed && (mentorState.mentor || mentorState.admin || !!mentorState.apprentice);
/** An apprentice right now: Complete sends to a mentor. */
export const isApprentice = () => mentorState.apprentice?.status === 'active';

export async function loadMentor(): Promise<void> {
  try {
    const s = await call<any>('mentor.status');
    mentorState.installed = !!s?.installed;
    mentorState.admin = !!s?.admin;
    mentorState.mentor = !!s?.mentor;
    mentorState.apprentice = s?.apprentice ?? null;
    mentorState.mine = s?.mine ?? [];
    mentorState.waiting = s?.waiting ?? 0;
    mentorState.yours = s?.yours ?? 0;
    mentorState.error = '';
  } catch (e: any) {
    // ewMentor not deployed (a branch build before Ames's deploy): stay hidden.
    if (!mentorState.loaded) mentorState.installed = false;
    mentorState.error = e?.message || '';
  } finally {
    mentorState.loaded = true;
    apprenticeFlag.active = isApprentice();
    if (mentorState.apprentice) apprenticeFlag.cellsNeeded = mentorState.apprentice.cellsNeeded;
  }
  if (isApprentice() || mentorState.apprentice) void finishApprovedCells();
}

export async function loadQueue(): Promise<void> {
  if (!(mentorState.mentor || mentorState.admin)) { mentorState.queue = null; return; }
  mentorState.queue = await call('mentor.queue');
}

let started = false;
/** Once a player is signed in. One status read now and one every ten
 *  minutes: the server's write allowance is shared by every player. */
export function startMentor() {
  if (started || !useProofreadingBackendStore().userId) return;
  started = true;
  void loadMentor();
  window.setInterval(() => { if (document.visibilityState === 'visible') void loadMentor(); }, 10 * 60 * 1000);
}

// ── The apprentice ──────────────────────────────────────────────────────
/** In place of completing a claimed cell (CellLibraryPanel completeCell). */
export async function sendForSecondLook(cell: { taskId?: number | null; segId: string; dataset?: string | null }, done: { finalSegId: string; coords: string; link: string; notes?: string; status?: string; cellType?: string; sheet?: boolean }) {
  if (!cell.taskId) throw new Error('Claim this cell first, then complete it.');
  const nums = (done.coords || '').split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
  const out = await call<{ review: MentorReview; apprentice: Apprentice }>('mentor.send', {
    taskId: cell.taskId, dataset: cell.dataset || currentDatasetTag(), logDataset: currentDatasetTag(),
    segmentId: cell.segId, rootId: done.finalSegId, position: nums.length === 3 ? nums : viewerPosition(),
    link: done.link, done: { status: done.status || '', notes: done.notes || '', cellType: done.cellType || '', coords: done.coords || '', sheet: !!done.sheet },
  });
  mentorState.apprentice = out.apprentice;
  const at = mentorState.mine.findIndex(r => r.id === out.review.id);
  if (at >= 0) mentorState.mine[at] = out.review; else mentorState.mine.unshift(out.review);
  return out.review;
}

/** A cell the mentor completed: the rest of what Complete does for the player
 *  themself (the sheet row, an axon label), from the player's own browser. */
let finishing = false;
async function finishApprovedCells() {
  if (finishing) return;
  finishing = true;
  try {
    for (const r of mentorState.mine) {
      if (r.state !== 'complete' || r.sheetDone) continue;
      try {
        if (r.done?.sheet) await syncCellToSheet('complete', r.segmentId, undefined, r.dataset, r.link || undefined, r.done.notes || undefined, r.done.status || undefined, r.done.cellType || undefined);
        if (r.done?.status === AXON_COMPLETE && r.position?.length === 3) await labelAxonComplete(activeCaveServer() || '', r.rootId, r.position as [number, number, number]);
        await call('mentor.sheetDone', { reviewId: r.id });
        r.sheetDone = true;
      } catch (e: any) { console.warn('[mentor] could not finish cell', r.id, e?.message); }
    }
  } finally { finishing = false; }
}

// ── Mentors ─────────────────────────────────────────────────────────────
export async function takeCell(r: MentorReview): Promise<MentorReview> {
  const out = await call<MentorReview>('mentor.claim', { reviewId: r.id });
  await loadQueue().catch(() => {});
  return out;
}
export const handBack = (apprenticeId: string) => call('mentor.handBack', { apprenticeId }).then(() => loadQueue());

// ── In the view ─────────────────────────────────────────────────────────
/** The cell open in the view, and whether we are its mentor or its apprentice. */
export const inView = ref<{ review: MentorReview; role: 'mentor' | 'apprentice' } | null>(null);
export const NOTES_LAYER = 'Mentor notes';
const NOTES_COLOR = '#ffd166';

export function viewerPosition(): number[] | null {
  try { const p = (window as any).viewer?.position?.value; return p && p.length === 3 ? Array.from(p as Float32Array).map(n => Math.round(n * 10) / 10) : null; } catch { return null; }
}
export function flyTo(position: number[] | null | undefined) {
  try { const v = (window as any).viewer; if (v && position?.length === 3) v.position.value = Float32Array.from(position); } catch { /* no view */ }
}

/** Why this cell cannot be opened here, or ''. */
export function cannotOpen(r: MentorReview): string {
  const here = currentDatasetTag();
  if (r.logDataset && here && r.logDataset !== here) return `Switch to the dataset this cell is in first (${r.logDataset}).`;
  return '';
}

/** The apprentice's saved view if there is one, else a jump to the cell. */
function loadView(r: MentorReview) {
  try {
    const hash = r.link ? new URL(r.link).hash : '';
    if (hash.startsWith('#!')) {
      const body = hash.slice(2);
      let target: string | Record<string, any> | null = null;
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(body)) target = body;
      else { try { target = JSON.parse(decodeURIComponent(body.startsWith('+') ? body.slice(1) : body)); } catch { target = null; } }
      if (target) {
        // No old notes layer in the view that loads (the right one is added after).
        setStateRewriter(async (state: any) => {
          if (Array.isArray(state?.layers)) state.layers = state.layers.filter((l: any) => l?.name !== NOTES_LAYER);
          else if (state?.layers && typeof state.layers === 'object') delete state.layers[NOTES_LAYER];
          return state;
        });
        const pinia = (document.querySelector('#app') as any)?.__vue_app__?.config?.globalProperties?.$pinia;
        void useLayersStore(pinia).loadState(target).finally(() => setStateRewriter(null));
        return;
      }
    }
  } catch (e) { console.warn('[mentor] could not load the saved view', e); }
  const pos = r.position?.length === 3 ? (r.position as [number, number, number]) : undefined;
  useCellHistoryStore().jumpToCell(r.rootId || r.segmentId, pos, { keep: false });
}

function notesLayer(): any {
  return ((window as any).viewer?.layerManager?.managedLayers ?? []).find((ml: any) => ml.name === NOTES_LAYER) ?? null;
}
/** The Mentor notes layer is in the view (a saved view may still be loading). */
export const hasNotesLayer = () => !!notesLayer();
/** The notes in the view now: points of the Mentor notes layer, with their
 *  descriptions. A mentor may also place them with the annotation tools. */
export function readNotesLayer(): MentorNote[] {
  try {
    const list = notesLayer()?.layer?.localAnnotations?.toJSON() ?? [];
    return list.filter((a: any) => a?.type === 'point' && Array.isArray(a.point))
      .map((a: any, i: number) => ({ id: String(a.id ?? `n${i + 1}`), position: Array.from(a.point as number[]).map(n => Math.round(Number(n) * 10) / 10), text: String(a.description || '').trim() || 'Look here' }));
  } catch { return []; }
}
/** Puts the notes in the view as their own annotation layer. */
export function writeNotesLayer(notes: MentorNote[]): boolean {
  const v = (window as any).viewer;
  if (!v?.layerSpecification) return false;
  const old = notesLayer();
  if (old) v.layerManager.removeManagedLayer(old);
  const spec = { type: 'annotation', source: { url: 'local://annotations' }, annotationColor: NOTES_COLOR, pointSize: 2, tab: 'annotations',
    annotations: notes.map(n => ({ type: 'point', id: n.id, point: n.position, description: n.text })) };
  v.layerSpecification.add(makeLayer(v.layerSpecification, NOTES_LAYER, spec));
  return true;
}
let keepTimer: number | undefined;
/** A saved view loads seconds after it is asked for and replaces every
 *  layer, the notes too (as access review points do): put them back while
 *  the view settles. */
function keepNotes(notes: MentorNote[]) {
  window.clearInterval(keepTimer);
  let beats = 0;
  keepTimer = window.setInterval(() => {
    if (++beats > 25) { window.clearInterval(keepTimer); return; }
    if (!notesLayer()) writeNotesLayer(notes);
  }, 600);
}

export function openInView(review: MentorReview, role: 'mentor' | 'apprentice') {
  const why = cannotOpen(review);
  if (why) throw new Error(why);
  inView.value = { review, role };
  // Out of the way, so the cell can be seen: the library and the profile close.
  document.dispatchEvent(new CustomEvent('nge:close-cell-library'));
  document.dispatchEvent(new CustomEvent('nge:mentor-view'));
  loadView(review);
  keepNotes(review.notes || []);
}
export function closeView() {
  window.clearInterval(keepTimer);
  inView.value = null;
  try { const v = (window as any).viewer; const l = notesLayer(); if (v && l) v.layerManager.removeManagedLayer(l); } catch { /* gone */ }
}

export async function saveNotes(cellNote: string): Promise<MentorReview> {
  const cur = inView.value;
  if (!cur) throw new Error('No cell open.');
  const out = await call<MentorReview>('mentor.saveNotes', { reviewId: cur.review.id, notes: readNotesLayer(), cellNote });
  cur.review = out;
  return out;
}
export async function sendSuggestions(cellNote: string): Promise<MentorReview> {
  const cur = inView.value;
  if (!cur) throw new Error('No cell open.');
  const out = await call<MentorReview>('mentor.suggest', { reviewId: cur.review.id, notes: readNotesLayer(), cellNote });
  cur.review = out;
  void loadQueue().catch(() => {});
  return out;
}

/** The mentor's Complete. The CAVE mark first, from this browser, counted for
 *  nobody here; then the server finishes the apprentice's claim and credits
 *  them. A mark CAVE refuses stops it before anything counts. */
export async function completeForApprentice(cellNote: string): Promise<{ finished: boolean }> {
  const cur = inView.value;
  if (!cur) throw new Error('No cell open.');
  const r = cur.review;
  if (marksProofread(r.done?.status)) {
    const server = activeCaveServer();
    if (!server) throw new Error('No CAVE server for this dataset. Open the cell in its dataset first.');
    const ok = await setCellComplete(server, r.rootId, true, undefined, (r.position?.length === 3 ? r.position : viewerPosition() || undefined) as any, true, [], { forApprentice: true });
    if (!ok) throw new Error(getLastCompletionProblem() || 'CAVE did not take the mark. Nothing was completed. Try again in a moment.');
  }
  const out = await call<{ review: MentorReview; finished: boolean }>('mentor.complete', { reviewId: r.id, root: r.rootId, notes: readNotesLayer(), cellNote });
  cur.review = out.review;
  void loadQueue().catch(() => {});
  return { finished: out.finished };
}

// ── Admins ──────────────────────────────────────────────────────────────
export const adminList = () => call<{ mentors: { id: string; name: string }[]; apprentices: Apprentice[]; overdue: MentorReview[]; cellsNeeded: number; maxApprentices: number }>('mentor.admin');
export const addMentor = (username: string) => call('mentor.addMentor', { username });
export const removeMentor = (userId: string) => call('mentor.removeMentor', { userId });
export const addApprentice = (username: string) => call('mentor.addApprentice', { username });
export const removeApprentice = (userId: string) => call('mentor.removeApprentice', { userId });

/** "...1234" for a cell. */
export const shortCell = (r: { rootId?: string; segmentId?: string }) => { const id = r.rootId || r.segmentId || ''; return id ? `...${id.slice(-4)}` : 'a cell'; };
/** "2 days ago", "3 hours ago". */
export function ago(iso: string | null | undefined): string {
  const ms = Date.now() - Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.floor(h / 24)} days ago`;
}

// For tests and for looking around in the console, as window.ngeTeam is.
(window as any).ngeMentor = { setCellComplete, state: mentorState, inView, loadMentor, loadQueue, sendForSecondLook, openInView, closeView, readNotesLayer, isApprentice };
