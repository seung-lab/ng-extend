/**
 * Top bar staging (Ames, approved 2026-10-19; plan card t_e0d9d696, the
 * gamemaster page https://claude.ai/artifact/ApBcrLjVjuCCWxJ4GxCUFo).
 *
 * A new player starts with only the bell in the customisable part of the top
 * bar. Each other icon arrives at the moment that teaches it:
 *
 *   first visit                        notif
 *   Get Started finished               cells, leaderboard, layers, chat (Nurro says so)
 *   Merge tutorial, "How to Merge"     merge
 *   Cut tutorial, "How to Cut"         split
 *   Advanced Interface, its own steps  undelete, findPath, tags, highlight, lantern
 *   first edit on your own, or day 2   help (and tags, if not yet)
 *   day 3                              screenshot
 *   production access                  batch, and everything still waiting
 *   never on its own                   recap, datasetStats (Settings turns them on)
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
import { supabase } from '../supabase';
import { useProofreadingBackendStore, useUserPreferencesStore } from '../store';
import { DATASETS } from '../datasets';
import { editsAny } from './dataset_access';
import { resolveToolbarOrder } from '../data/toolbar-icons';

// ── What arrives when ───────────────────────────────────────────────────────

export interface StageMoment {
  key: string;
  /** Shown in the test panel. */
  label: string;
  icons: string[];
  /** Nurro's line when this moment brings icons no tutorial box introduces. */
  nurro?: string;
}

/** Never brought in on their own: the weekly notification leads there. */
export const NEVER_AUTO = ['recap', 'datasetStats'];

export const STAGE_MOMENTS: StageMoment[] = [
  { key: 'start', label: 'First visit', icons: ['notif'] },
  { key: 'getStarted', label: 'Finish Get Started', icons: ['leaderboard', 'layers', 'chat'],
    nurro: 'You know your way around now. Three things just landed in your top bar: the Leaderboard, the Layer panel and Chat. Come say hi!' },
  { key: 'merge', label: 'Merge tutorial: How to Merge', icons: ['merge'] },
  { key: 'cut', label: 'Cut tutorial: How to Cut', icons: ['split'] },
  // Ames 2026-10-20: the Cell Library waits until a player can merge and cut.
  { key: 'basics', label: 'Finish the Merge and Cut tutorials', icons: ['cells'],
    nurro: 'You can merge and you can cut. The Cell Library is in your top bar now: pick a cell and start proofreading!' },
  { key: 'ai-undelete', label: 'Advanced Interface: the cell rows', icons: ['undelete'] },
  { key: 'ai-findPath', label: 'Advanced Interface: Find Path', icons: ['findPath'] },
  { key: 'ai-tags', label: 'Advanced Interface: Tag a merger', icons: ['tags'] },
  { key: 'ai-highlight', label: 'Advanced Interface: Highlight', icons: ['highlight'] },
  { key: 'ai-lantern', label: 'Advanced Interface: Lantern', icons: ['lantern'] },
  { key: 'ownEdit', label: 'First edit on your own', icons: ['help', 'tags'],
    nurro: 'Your first edit on your own! Not sure about a spot? Ask for a Second Opinion with the magnifier in your top bar.' },
  // A player who skips the tutorials is not left with a bare bar: coming back
  // brings whatever the earlier moments would have, tutorial or not.
  { key: 'day2', label: 'Come back on day 2', icons: ['help', 'tags', 'leaderboard', 'layers', 'chat', 'merge', 'split', 'cells'],
    nurro: 'Welcome back! Your top bar has a few more tools now. Not sure about a spot? Ask for a Second Opinion with the magnifier.' },
  { key: 'day3', label: 'Come back on day 3', icons: ['screenshot', 'undelete', 'findPath', 'highlight', 'lantern'],
    nurro: 'Day three! Your top bar has the rest of the everyday tools now. Found something beautiful? The camera saves a picture of it.' },
  // Batch arrives too, quietly: no glow, not named (Ames 2026-10-20).
  { key: 'production', label: 'Get production access', icons: ['batch'],
    nurro: 'You have production access! Every tool you had not met yet is in your top bar now.' },
];

/** Every icon a staged player can be given automatically. */
const ALL_AUTO = [...new Set(STAGE_MOMENTS.flatMap(m => m.icons))];

/** Live site accounts created at or after this are staged. Far in the future
 *  until Ames says deploy: set it to the deploy time then. */
export const STAGING_SINCE = '2099-01-01T00:00:00Z';

export const IS_LIVE_SITE = typeof location !== 'undefined' && location.hostname.startsWith('eyewire-ii-community-dot-');
/** The test panel exists everywhere except the live site. */
export const STAGING_TEST_AVAILABLE = !IS_LIVE_SITE;

// ── State ───────────────────────────────────────────────────────────────────

export interface StageState {
  staged: boolean;
  /** Icons that have arrived. */
  revealed: string[];
  /** Local dates (YYYY-MM-DD) the player has been here, newest last, up to 3. */
  visitDays: string[];
  /** Moments already handled (keys of STAGE_MOMENTS). */
  done: string[];
}

/** Icons that have just arrived and should glow for a while. */
export const freshIcons = reactive(new Set<string>());

/** The Nurro card on screen, if any. */
export const announcement = ref<{ text: string; icons: string[]; at: number } | null>(null);

const SIM_KEY = 'nge-staging-sim';
const SIM_ON_KEY = 'nge-staging-sim-on';
const freshState = (): StageState => ({ staged: true, revealed: ['notif'], visitDays: [], done: ['start'] });

function readSim(): StageState {
  try {
    const raw = localStorage.getItem(SIM_KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch { /* no storage */ }
  return freshState();
}
let simOnAtStart = false;
try { simOnAtStart = STAGING_TEST_AVAILABLE && localStorage.getItem(SIM_ON_KEY) === '1'; } catch { /* no storage */ }

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
  if (!STAGING_TEST_AVAILABLE) return;
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
  if (simulating.value) return simState;
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

/*
 * Saving the top bar while icons are held back. The saved order keeps every
 * icon, shown or not, and only the change the player made is applied to it,
 * so nothing still on its way is dropped or moved (and a test on a real
 * account leaves that account's own top bar order exactly as it was).
 */

/** A drag of `src` onto `target`, applied to the full saved order. */
export function dragInFull(full: string[], src: string, target: string, movedRight: boolean): string[] {
  const out = full.filter(id => id !== src);
  const at = out.indexOf(target);
  if (at < 0) return [...out, src];
  out.splice(movedRight ? at + 1 : at, 0, src);
  return out;
}

/** The Settings grid's on and off switches, applied to the full saved order:
 *  icons switched off leave it, icons switched on join the end. */
export function togglesInFull(full: string[], shownBefore: string[], shownNow: string[]): string[] {
  const out = full.filter(id => !(shownBefore.includes(id) && !shownNow.includes(id)));
  for (const id of shownNow) if (!out.includes(id)) out.push(id);
  return out;
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
export function reveal(ids: string[], line?: string, label?: string): string[] {
  const s = current();
  if (!s) return [];
  const added = ids.filter(id => !s.revealed.includes(id));
  if (!added.length) return [];
  s.revealed.push(...added);
  pendingLabel = label || 'A tutorial step';
  save(s);
  for (const id of added) freshIcons.add(id);
  setTimeout(() => { for (const id of added) freshIcons.delete(id); }, 9000);
  if (line) announcement.value = { text: line, icons: added, at: Date.now() };
  return added;
}

/** Run one moment of STAGE_MOMENTS now (the test panel, or once quiet). */
export function runMoment(key: string): string[] {
  const s = current();
  const m = STAGE_MOMENTS.find(x => x.key === key);
  if (!s || !m) return [];
  if (!s.done.includes(key)) s.done.push(key);
  if (key === 'production' && !s.revealed.includes('batch')) s.revealed.push('batch');
  const icons = key === 'production' ? ALL_AUTO.filter(id => id !== 'batch') : m.icons;
  const added = reveal(icons, m.nurro, m.label);
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

/** The icons a tutorial step brings in: its own `reveals`, plus the icon its
 *  box points at (`[data-icon-id="..."]`). */
export function tutorialStepReveals(step: { reveals?: string[]; position?: any } | undefined): string[] {
  if (!step) return [];
  const out = [...(step.reveals || [])];
  const el = typeof step.position?.element === 'string' ? step.position.element : '';
  const m = el.match(/data-icon-id="([a-zA-Z]+)"/);
  if (m) out.push(m[1]);
  return out;
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

setTimeout(() => {
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
}, 0);
