/**
 * Top bar staging (Ames, approved 2026-10-19; plan card t_e0d9d696, the
 * gamemaster page https://claude.ai/artifact/ApBcrLjVjuCCWxJ4GxCUFo).
 *
 * A new player starts with only the bell in the customisable part of the top
 * bar. Each other icon arrives at the moment that teaches it:
 *
 *   first visit                        notif
 *   Get Started finished (or left)     leaderboard, undelete, chat (Nurro says so), then Merge starts
 *   Merge tutorial, "How to Merge"     merge
 *   Cut tutorial, "How to Cut"         split
 *   Merge and Cut both finished        cells (Nurro)
 *   Advanced Interface, its own steps  findPath, tags, highlight, lantern
 *   Advanced Interface finished        layers (Nurro)
 *   first edit on your own             help, tags (Nurro)
 *   day 2 / day 3                      anything still missing, then screenshot (Nurro)
 *   a week after first staged          recap, with a Profile Settings button (Nurro)
 *   production access                  everything still waiting
 *   never on its own                   datasetStats, batch (Settings turns them on)
 *
 * Any tutorial step that points at an icon brings it in (tutorialStepReveals),
 * whichever tutorial gets there first. Once an icon has arrived it stays.
 *
 * Who is staged: on the live site, accounts created after STAGING_SINCE that
 * are not admins. Everyone else sees the top bar exactly as before.
 *
 * Test sites: nothing is staged and nothing is saved to the account. The
 * Staging test panel (StagingTestPanel.vue) turns on a pretend new player
 * whose state lives only in this browser (localStorage), and steps through
 * the moments above. Real tutorial steps reveal icons in that pretend state
 * too, so a tutorial can be played through as a new player would.
 */
import { reactive, ref, watch } from 'vue';
import { getActivePinia } from 'pinia';
import { supabase } from '../supabase';
import { useProofreadingBackendStore, useUserPreferencesStore } from '../store';
import { DATASETS } from '../datasets';
import { editsAny } from './dataset_access';
import { resolveToolbarOrder } from '../data/toolbar-icons';
import { reportStagingProblem } from './error_reporting';
import { STAGE_MOMENTS, NEVER_AUTO, ALL_AUTO, tutorialStepReveals } from '../data/toolbar-stages';
export { STAGE_MOMENTS, NEVER_AUTO, ALL_AUTO, TUTORIAL_REVEALS, checkTutorialWiring, tutorialStepReveals, dragInFull, togglesInFull } from '../data/toolbar-stages';
export type { StageMoment } from '../data/toolbar-stages';


/** Live site accounts created at or after this are staged: the deploy time
 *  (Ames said deploy, 2026-10-21). Everyone older keeps their top bar. */
export const STAGING_SINCE = '2026-10-21T18:49:56Z';

export const IS_LIVE_SITE = typeof location !== 'undefined' && location.hostname.startsWith('eyewire-ii-community-dot-');
/** The test panel exists on every test site, and for admins on the live site
 *  (Ames 2026-10-21: an admin's own account is never staged, so this is how
 *  they see a new player's top bar there). */
export const STAGING_TEST_AVAILABLE = !IS_LIVE_SITE;
export function stagingTestAllowed(): boolean {
  if (STAGING_TEST_AVAILABLE) return true;
  try { return !!(useProofreadingBackendStore() as any).isAdmin; } catch { return false; }
}

// ── State ───────────────────────────────────────────────────────────────────

export interface StageState {
  staged: boolean;
  /** Icons that have arrived. */
  revealed: string[];
  /** The local date (YYYY-MM-DD) this player was first staged. */
  firstSeen?: string;
  /** Local dates (YYYY-MM-DD) the player has been here, newest last, up to 3. */
  visitDays: string[];
  /** Moments already handled (keys of STAGE_MOMENTS). */
  done: string[];
}

/** Icons that have just arrived and should glow for a while. */
export const freshIcons = reactive(new Set<string>());

/** The Nurro card on screen, if any. */
export const announcement = ref<{ text: string; icons: string[]; at: number; settingsButton?: boolean } | null>(null);

const SIM_KEY = 'nge-staging-sim';
const SIM_ON_KEY = 'nge-staging-sim-on';
const freshState = (): StageState => ({ staged: true, revealed: ['notif'], firstSeen: new Date().toLocaleDateString('en-CA'), visitDays: [], done: ['start'] });

function readSim(): StageState {
  try {
    const raw = localStorage.getItem(SIM_KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch { /* no storage */ }
  return freshState();
}
let simOnAtStart = false;
try { simOnAtStart = localStorage.getItem(SIM_ON_KEY) === '1'; } catch { /* no storage */ }

/** The pretend new player of the test panel (test sites only). */
export const simulating = ref(simOnAtStart);
export const simState = reactive<StageState>(readSim());

/** Every earlier state of the pretend player, newest last, so the test panel
 *  can step back one moment at a time. Kept in this browser only. */
const HIST_KEY = 'nge-staging-sim-history';
function readHistory(): { label: string; state: string }[] {
  try { const raw = localStorage.getItem(HIST_KEY); if (raw) return JSON.parse(raw); } catch { /* no storage */ }
  return [];
}
export const simHistory = reactive<{ label: string; state: string }[]>(readHistory());
let lastSimJson = JSON.stringify(simState);
/** What the next save of the pretend player is called in the history. */
let pendingLabel = '';

function saveSim() {
  const now = JSON.stringify(simState);
  if (now !== lastSimJson) {
    simHistory.push({ label: pendingLabel || 'a change', state: lastSimJson });
    if (simHistory.length > 60) simHistory.splice(0, simHistory.length - 60);
  }
  lastSimJson = now;
  pendingLabel = '';
  try {
    localStorage.setItem(SIM_KEY, now);
    localStorage.setItem(HIST_KEY, JSON.stringify(simHistory));
  } catch { /* no storage */ }
}

/** The pretend player as it stands, to put back after the panel's check. */
export function simSnapshot(): { state: string; history: string } {
  return { state: JSON.stringify(simState), history: JSON.stringify(simHistory) };
}
export function simRestore(snap: { state: string; history: string }) {
  Object.assign(simState, freshState(), JSON.parse(snap.state));
  simHistory.splice(0, simHistory.length, ...JSON.parse(snap.history));
  lastSimJson = snap.state;
  freshIcons.clear();
  announcement.value = null;
  try {
    localStorage.setItem(SIM_KEY, snap.state);
    localStorage.setItem(HIST_KEY, snap.history);
  } catch { /* no storage */ }
}

/** Undo the pretend player's last moment. */
export function simBack() {
  const h = simHistory.pop();
  if (!h) return;
  Object.assign(simState, freshState(), JSON.parse(h.state));
  lastSimJson = h.state;
  freshIcons.clear();
  announcement.value = null;
  try {
    localStorage.setItem(SIM_KEY, h.state);
    localStorage.setItem(HIST_KEY, JSON.stringify(simHistory));
  } catch { /* no storage */ }
}

export function setSimulating(on: boolean) {
  if (!stagingTestAllowed()) return;
  simulating.value = on;
  try { localStorage.setItem(SIM_ON_KEY, on ? '1' : '0'); } catch { /* no storage */ }
  if (on) noteVisit();
}

/** Back to a brand new player's first visit. */
export function resetSim() {
  Object.assign(simState, freshState());
  simHistory.splice(0);
  lastSimJson = JSON.stringify(simState);
  freshIcons.clear();
  announcement.value = null;
  try {
    localStorage.setItem(SIM_KEY, lastSimJson);
    localStorage.setItem(HIST_KEY, '[]');
  } catch { /* no storage */ }
}

function prefs() { return useUserPreferencesStore(); }

/** The state that decides the top bar now, or null when nothing is staged. */
function current(): StageState | null {
  // The pretend player: test sites, or an admin on the live site.
  if (simulating.value && stagingTestAllowed()) return simState;
  if (!IS_LIVE_SITE) return null;
  const s = (prefs().prefs as any).toolbarStage as StageState | undefined;
  return s && s.staged ? s : null;
}

/** Is this icon in the top bar for the player as things stand? */
export function iconArrived(id: string): boolean {
  const s = current();
  if (!s) return true;
  return s.revealed.includes(id);
}

/** True while some icons are being held back. */
export function isStaged(): boolean {
  return !!current();
}


function save(s: StageState) {
  if (s === simState) { saveSim(); return; }
  prefs().save({ toolbarStage: { ...s, revealed: [...s.revealed], visitDays: [...s.visitDays], done: [...s.done] } } as any);
}

/**
 * Bring icons in. Returns the ones that had not arrived before. With `line`,
 * Nurro introduces them; without it they fade in and glow (a tutorial box is
 * doing the introducing).
 */
export function reveal(ids: string[], line?: string, label?: string, settingsButton?: boolean): string[] {
  const s = current();
  if (!s) return [];
  const added = ids.filter(id => !s.revealed.includes(id));
  if (!added.length) return [];
  s.revealed.push(...added);
  pendingLabel = label || 'A tutorial step';
  save(s);
  for (const id of added) freshIcons.add(id);
  setTimeout(() => { for (const id of added) freshIcons.delete(id); }, 9000);
  if (line) announcement.value = { text: line, icons: added, at: Date.now(), settingsButton };
  return added;
}

/** Run one moment of STAGE_MOMENTS now (the test panel, or once quiet). */
export function runMoment(key: string): string[] {
  const s = current();
  const m = STAGE_MOMENTS.find(x => x.key === key);
  if (!s || !m) return [];
  if (!s.done.includes(key)) s.done.push(key);
  const icons = key === 'production' ? ALL_AUTO : m.icons;
  const added = reveal(icons, m.nurro, m.label, m.settingsButton);
  if (!added.length) { pendingLabel = m.label; save(s); }
  return added;
}

/**
 * Wait until nothing else is talking to the player: no Achievement
 * celebration, no username question, no profile (a celebration opens it), no
 * tutorial box. Then a moment more, so the icons and Nurro are noticed. Gives
 * up waiting after 90 seconds.
 */
export async function untilQuiet() {
  const backend: any = useProofreadingBackendStore();
  const busy = () => !!backend.pendingBadgeCelebration
    || !!document.querySelector('.nge-hero-overlay, .nge-cell-overlay, .nge-batch-overlay, .nge-un-backdrop, .nge-profile-modal, .introductionStep, .nge-tut-resume');
  const start = Date.now();
  let quietSince = 0;
  await new Promise(r => setTimeout(r, 1500));
  while (Date.now() - start < 90000) {
    if (busy()) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince > 2500) return;
    await new Promise(r => setTimeout(r, 400));
  }
}

/** A real moment (not the test panel): Nurro speaks once the screen is quiet. */
async function momentWhenQuiet(key: string) {
  const s = current();
  if (!s || s.done.includes(key)) return;
  await untilQuiet();
  runMoment(key);
}

// ── Tutorials ───────────────────────────────────────────────────────────────

/** The Site Tour points at every icon: it skips, never reveals. */
export const SITE_TOUR = 4;


/**
 * On the live site, a moment after a tutorial box that brings icons opens:
 * each icon must be in the top bar (unless the player took it off in
 * Settings). If one is not, staging is broken for this player, and the
 * errors table hears about it (reportStagingProblem), so a breakage shows up
 * without anyone having to notice a missing button.
 */
export function verifyStepIcons(ids: string[], where: string) {
  if (!IS_LIVE_SITE || !ids.length) return;
  setTimeout(() => {
    if (!document.querySelector('#extensionBar .nge-toolbar-icons')) return; // signed out: no bar to check
    const p = prefs().prefs;
    const kept = resolveToolbarOrder(p.toolbarIcons, p.toolbarIconsInjected);
    const missing = ids.filter(id => kept.includes(id) && !document.querySelector(`#extensionBar .nge-toolbar-icons [data-icon-id="${id}"]`));
    if (missing.length) reportStagingProblem(`${where}: ${missing.join(', ')} not in the top bar`, JSON.stringify({ staged: isStaged(), revealed: current()?.revealed }));
  }, 2500);
}

/** For the Site Tour: show a toolbar step only when its icon is in the bar. */
export function siteTourShows(iconId: string): boolean {
  if (!iconArrived(iconId)) return false;
  // A player can also have taken it off in Settings.
  const p = prefs().prefs;
  return resolveToolbarOrder(p.toolbarIcons, p.toolbarIconsInjected).includes(iconId);
}

/** Set by Tutorial.vue: whether a tutorial box, a practice cell or the test is
 *  on screen, so edits made there do not count as your own. */
let tutorialBusy: () => boolean = () => false;
export function setTutorialBusy(fn: () => boolean) { tutorialBusy = fn; }

/**
 * Get Started is over. Once its Achievement and the username question have
 * cleared, its icons arrive (Nurro says so) and the Merge tutorial starts by
 * itself (Ames 2026-10-07), through its usual gate: a busy Merge offers a place
 * in line. Nothing starts if the player has opened another tutorial meanwhile.
 */
export async function getStartedFinished(isStillOnGetStarted: () => boolean) {
  await untilQuietExceptTutorial();
  runMoment('getStarted');
  if (isStillOnGetStarted()) document.dispatchEvent(new CustomEvent('nge:tutorial-start', { detail: { id: 3 } }));
}

/** As untilQuiet, without waiting for tutorial boxes: Get Started has just
 *  closed its own, and Merge is about to open the next. */
async function untilQuietExceptTutorial() {
  const backend: any = useProofreadingBackendStore();
  const busy = () => !!backend.pendingBadgeCelebration
    || !!document.querySelector('.nge-hero-overlay, .nge-cell-overlay, .nge-batch-overlay, .nge-un-backdrop, .nge-profile-modal');
  const start = Date.now();
  let quietSince = 0;
  await new Promise(r => setTimeout(r, 1500));
  while (Date.now() - start < 90000) {
    if (busy()) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince > 2500) return;
    await new Promise(r => setTimeout(r, 400));
  }
}

/** A tutorial was finished. Finishing both Merge and Cut brings the Cell
 *  Library (Ames 2026-10-20), once the Achievement has had its moment. */
export function tutorialFinished(n: number) {
  const s = current();
  if (!s) return;
  if (n === 2) { void momentWhenQuiet('aiDone'); return; }
  const mark = n === 3 ? 'mergeDone' : n === 5 ? 'cutDone' : '';
  if (!mark || s.done.includes(mark)) return;
  s.done.push(mark);
  pendingLabel = n === 3 ? 'Finish the Merge tutorial' : 'Finish the Cut tutorial';
  save(s);
  if (s.done.includes('mergeDone') && s.done.includes('cutDone')) void momentWhenQuiet('basics');
}

// ── Edits, days, access ─────────────────────────────────────────────────────

document.addEventListener('nge:edit-logged', ((e: CustomEvent) => {
  const op = e.detail?.operation;
  if (op !== 'merge' && op !== 'split') return;
  if (tutorialBusy()) return;
  const s = current();
  if (s && !s.done.includes('ownEdit')) void momentWhenQuiet('ownEdit');
}) as EventListener);

const today = () => new Date().toLocaleDateString('en-CA');

/** Count today as a visit, and bring in what days 2 and 3 bring. */
export function noteVisit(date = today()) {
  const s = current();
  if (!s) return;
  if (!s.visitDays.includes(date)) {
    s.visitDays = [...s.visitDays, date].slice(-3);
    pendingLabel = 'A new day';
    save(s);
  }
  if (s.visitDays.length >= 2 && !s.done.includes('day2')) void momentWhenQuiet('day2');
  if (s.visitDays.length >= 3 && !s.done.includes('day3')) void momentWhenQuiet('day3');
  // A week after signing up (counted from the day staging began for them).
  if (!s.firstSeen) { s.firstSeen = date; save(s); }
  const days = (new Date(date).getTime() - new Date(s.firstSeen).getTime()) / 86400000;
  if (days >= 7 && !s.done.includes('week1')) void momentWhenQuiet('week1');
}

function hasProductionAccess(): boolean | null {
  try { return editsAny(DATASETS.filter(d => d.section === 'production').map(d => d.caveDataset)); } catch { return null; }
}

/**
 * Live site only: decide once whether this account is staged, after its saved
 * settings have been read. Admins and accounts from before STAGING_SINCE never
 * are, so nobody who has an icon today loses it.
 */
async function classify() {
  const backend: any = useProofreadingBackendStore();
  const p: any = prefs().prefs;
  if (p.toolbarStage || !backend.userId) return;
  if (backend.isAdmin) { prefs().save({ toolbarStage: { staged: false, revealed: [], visitDays: [], done: [] } } as any); return; }
  const { data } = await supabase.from('users').select('created_at').eq('id', backend.userId).maybeSingle();
  const created = (data as any)?.created_at;
  if (!created) return;
  const staged = new Date(created).getTime() >= new Date(STAGING_SINCE).getTime();
  prefs().save({ toolbarStage: staged ? freshState() : { staged: false, revealed: [], visitDays: [], done: [] } } as any);
}

// The stores need Pinia, which main.ts installs only once the page has loaded.
// This file can run before that, so wait for it rather than reading the stores
// too early (which threw on every live page load and skipped classify()).
function startStaging() {
  if (!getActivePinia()) { setTimeout(startStaging, 50); return; }
  if (IS_LIVE_SITE) {
    watch(() => [useProofreadingBackendStore().userId, (useUserPreferencesStore() as any).accountLoaded] as const,
      ([id, loaded]) => { if (id && loaded) classify().then(() => noteVisit()).catch(() => {}); }, { immediate: true });
  }
  if (simulating.value) noteVisit();
  // Production access, as CAVE reports it: everything arrives. Not for the
  // pretend player, whose access is the test panel's to give.
  watch(() => hasProductionAccess(), ok => {
    if (!ok || simulating.value) return;
    const s = current();
    if (s && !s.done.includes('production')) void momentWhenQuiet('production');
  }, { immediate: true });
}
setTimeout(startStaging, 0);
