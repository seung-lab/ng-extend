/**
 * Autosave the viewer (annotations, layers, camera) to the player's own
 * Supabase row for the dataset on screen, and offer it back.
 *
 * Neuroglancer keeps the state only in the page address, so work was lost on
 * closing the tab, switching datasets, opening another link or changing
 * computers (Ames 2026-09-30: "we can put in DB"). A few seconds after the
 * view stops changing it is saved to user_views (private: owner only, through
 * ewCommunityData; supabase-user-views.sql). When a dataset opens WITHOUT the
 * player's own view in the address (a bare link, its starting view, or just
 * after a dataset switch), a small bar offers "Pick up where you left off?".
 * A link someone opened on purpose (a shared view) is never interrupted.
 */
import { supabase } from '../supabase';
import { bootHash, viewHasCells } from './local_view';
import { currentSegLayerName, findDatasetBySegName } from '../datasets';
import { getDatasetCaveConfig } from '../config';
import { getCachedJson } from 'neuroglancer/util/trackable';

const QUIET_MS = 12000;     // save this long after the last change
const MIN_GAP_MS = 30000;   // and at most this often
const MAX_BYTES = 240 * 1024;
const OFFER_KEY = 'nge-offer-view-restore';
const SKIP_KEY = 'nge-skip-view-restore';

let lastSaved = '';
/** A view's text without its 3D angle (as url_hash_binding.ts withoutTurn). */
const withoutTurn = (json: string) => json.replace(/"projectionOrientation":\[[^\]]*\],?/, '');
/** The state's change count when it was last looked at here. Nothing changed
 *  since: no JSON is made at all. A view too big to save is not turned into
 *  JSON again until it changes (perf audit 2026-11-14: one over the limit was
 *  serialized after every change for the rest of the visit). */
let lastSeenGen = -1;
let lastSeenDataset = '';
let lastSaveAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let userIdOf: () => string | null = () => null;

const keyOf = (seg: string) => (seg || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100);
const datasetKey = () => keyOf(currentSegLayerName());

/** The view saved to the player's account for a dataset, when signed in. */
export async function accountViewOf(seg: string): Promise<{json: string, t: number} | null> {
  if (!userIdOf() || !seg) return null;
  try {
    const { data, error } = await supabase.from('user_views')
      .select('state,updated_at').eq('dataset', keyOf(seg)).maybeSingle();
    if (error || !data?.state) return null;
    return { json: JSON.stringify(data.state), t: Date.parse(String(data.updated_at || '')) || 0 };
  } catch { return null; }
}

/** A switch is about to reload into the player's last view of a dataset
 *  (store.ts selectLayers): after the reload, say so, with a way back to the
 *  dataset's starting view. */
const RESUMED_KEY = 'nge-resumed-view';
const RESUME_TOLD_KEY = 'nge-resume-bar-shown';
export function noteResumedView(seg: string) {
  try { sessionStorage.setItem(RESUMED_KEY, JSON.stringify({ seg, at: Date.now() })); } catch { /* */ }
  skipNextViewRestoreOffer();
}
function takeResumed(): string {
  try {
    const r = JSON.parse(sessionStorage.getItem(RESUMED_KEY) || 'null');
    sessionStorage.removeItem(RESUMED_KEY);
    return r && Date.now() - r.at < 120_000 ? String(r.seg || '') : '';
  } catch { return ''; }
}

async function saveNow(viewer: any) {
  timer = null;
  const dataset = datasetKey();
  if (!userIdOf() || !dataset || !viewer?.state) return;
  let state: any, gen = -1;
  // The same cached JSON the address bar uses (built once per change).
  try { const c = getCachedJson(viewer.state); state = c.value; gen = c.generation; } catch { return; }
  if (gen === lastSeenGen && dataset === lastSeenDataset) return;
  const text = JSON.stringify(state);
  if (text === lastSaved || text.length > MAX_BYTES) { lastSeenGen = gen; lastSeenDataset = dataset; return; }
  // No cell on screen: the account keeps the last view that had one.
  if (!viewHasCells(text)) { lastSeenGen = gen; lastSeenDataset = dataset; return; }
  // Only the Starship's slow turn moved: not saved again (it was an account
  // write every 30 s while the page sat idle).
  const turning = performance.now() - ((window as any).__ngeAutoTurnAt || -1e9) < 2000;
  if (turning && lastSaved && dataset === lastSeenDataset && withoutTurn(text) === withoutTurn(lastSaved)) { lastSeenGen = gen; return; }
  const wait = MIN_GAP_MS - (Date.now() - lastSaveAt);
  if (wait > 0) { timer = setTimeout(() => saveNow(viewer), wait); return; }
  lastSaveAt = Date.now();
  const { error } = await supabase.from('user_views')
    .upsert({ dataset, state }, { onConflict: 'user_id,dataset' });
  if (error) console.warn('[views] autosave failed:', error.message);
  else { lastSaved = text; lastSeenGen = gen; lastSeenDataset = dataset; }
}


/** Called by the dataset switcher. A switch that reloads the page offers the
 *  saved view on the next load; one that does not, a few seconds from now. */
export function offerViewRestoreAfterSwitch() {
  // A switch opens where you left off by itself now (Settings, Switching
  // datasets); no bar offers it afterwards (Ames 2026-11-20).
}

/** The next offer is not wanted: the player switched datasets to go straight
 *  to some work (the Switch Dataset chips), so they will pick the cell
 *  themselves (Ames 2026-10-24). Kept across the switch's reload, used once,
 *  and stale after two minutes. */
export function skipNextViewRestoreOffer(skip = true) {
  try { if (skip) sessionStorage.setItem(SKIP_KEY, String(Date.now())); else sessionStorage.removeItem(SKIP_KEY); } catch { /* private mode */ }
}
function takeSkip(): boolean {
  try {
    const at = Number(sessionStorage.getItem(SKIP_KEY) || 0);
    sessionStorage.removeItem(SKIP_KEY);
    return at > 0 && Date.now() - at < 120_000;
  } catch { return false; }
}

/** True when the address held no view the player chose themselves: empty, or
 *  the dataset's own starting view. Decided once the dataset is known. */
function withoutOwnView(hashAtLoad: string): boolean {
  if (!hashAtLoad || hashAtLoad === '#' || hashAtLoad === '#!') return true;
  const curated = getDatasetCaveConfig(currentSegLayerName()).defaultStateUrl || '';
  const i = curated.indexOf('#');
  return i >= 0 && curated.slice(i) === hashAtLoad;
}

/** Settings: "Offer to pick up where I left off". On unless turned off. */
function offerEnabled(): boolean {
  try { return JSON.parse(localStorage.getItem('nge_prefs_v1') || '{}').offerViewRestore !== false; } catch { return true; }
}

async function offerRestore(viewer: any, stale: () => boolean = () => false) {
  const dataset = datasetKey();
  if (!dataset) return;
  // Never on the Sandbox (practice data, nothing to pick up), and not when
  // the player turned the offer off (Ames 2026-10-01).
  if (!offerEnabled()) return;
  if (takeSkip()) return;
  if (findDatasetBySegName(currentSegLayerName())?.section === 'sandbox') return;
  const { data, error } = await supabase.from('user_views')
    .select('state,updated_at').eq('dataset', dataset).maybeSingle();
  if (error || !data?.state) return;
  let now = '';
  try { now = JSON.stringify(viewer.state.toJSON()); } catch { /* */ }
  if (JSON.stringify(data.state) === now) return;
  // Not over a tour or tutorial, and not once the player has started.
  if (stale() || document.body.classList.contains('nge-intro-on') || document.querySelector('.introductionStep')) return;
  try { viewer.state.restoreState(data.state); } catch (e) { console.warn('[views] restore failed:', e); }
}

const CSS = `
.nge-view-restore { position: fixed; top: 58px; left: 50%; transform: translateX(-50%); z-index: 9000;
  display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 24px);
  padding: 8px 10px 8px 14px; border-radius: 8px; font: 13px/1.35 'Inter', system-ui, sans-serif;
  color: #dce6f5; background: rgba(8, 14, 28, 0.94); border: 1px solid rgba(100, 200, 255, 0.4);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); overflow: hidden; }
.nge-view-restore::after { content: ''; position: absolute; left: 0; bottom: 0; height: 2px; width: 100%;
  background: rgba(127, 212, 255, 0.7); transform-origin: left; animation: nge-vr-count 8s linear forwards; }
.nge-view-restore--held::after { animation: none; transform: scaleX(1); opacity: 0.35; }
@keyframes nge-vr-count { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.nge-view-restore .nge-vr-text { overflow-wrap: anywhere; }
.nge-view-restore .nge-vr-yes { flex-shrink: 0; padding: 5px 12px; border-radius: 6px; cursor: pointer; font: inherit; font-weight: 600;
  color: #06121f; background: #7fd4ff; border: 0; }
.nge-view-restore .nge-vr-yes:hover { background: #a9e3ff; }
.nge-view-restore .nge-vr-no { flex-shrink: 0; width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1;
  color: rgba(220, 230, 245, 0.7); background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); }
`;

/** Call once the viewer exists. userId() returns the signed in player's id. */
export function startViewAutosave(viewer: any, userId: () => string | null) {
  userIdOf = userId;
  const hashAtLoad = bootHash();
  // The bar comes once per browser, the first time a switch picks up where
  // the player left off; after that Settings is the place to change it (Ames
  // 2026-11-16: "I don't think we need this every time").
  const resumed = takeResumed();
  let firstResume = false;
  try { firstResume = !localStorage.getItem(RESUME_TOLD_KEY); if (resumed) localStorage.setItem(RESUME_TOLD_KEY, '1'); } catch { /* */ }
  // The one-time "Back where you left off" note is gone (Ames 2026-11-20:
  // "We don't need that bar"): a switch just opens where you were.
  void firstResume;
  try { sessionStorage.removeItem(OFFER_KEY); } catch { /* */ }
  // Opening the plain address brings back your view of the dataset by
  // itself, as a switch does, unless you have started working already.
  let touched = false;
  const touch = () => { touched = true; };
  for (const t of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(t, touch, { capture: true, once: true });
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  viewer.state.changed.add(() => {
    if (!userIdOf()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveNow(viewer), QUIET_MS);
  });
  // Offer the saved view once per page load, when signed in and the dataset
  // is on screen (sign in can finish well after the viewer starts).
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    if (userIdOf() && datasetKey()) {
      clearInterval(wait);
      if (withoutOwnView(hashAtLoad) && !touched) void offerRestore(viewer, () => touched);
    } else if (tries > 120) clearInterval(wait);
  }, 1000);
}
