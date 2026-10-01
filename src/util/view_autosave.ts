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
import { currentSegLayerName, findDatasetBySegName } from '../datasets';
import { getDatasetCaveConfig } from '../config';

const QUIET_MS = 12000;     // save this long after the last change
const MIN_GAP_MS = 30000;   // and at most this often
const MAX_BYTES = 240 * 1024;
const OFFER_KEY = 'nge-offer-view-restore';

let lastSaved = '';
let lastSaveAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let userIdOf: () => string | null = () => null;

const datasetKey = () => (currentSegLayerName() || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100);

async function saveNow(viewer: any) {
  timer = null;
  const dataset = datasetKey();
  if (!userIdOf() || !dataset || !viewer?.state) return;
  let state: any;
  try { state = viewer.state.toJSON(); } catch { return; }
  const text = JSON.stringify(state);
  if (text === lastSaved || text.length > MAX_BYTES) return;
  const wait = MIN_GAP_MS - (Date.now() - lastSaveAt);
  if (wait > 0) { timer = setTimeout(() => saveNow(viewer), wait); return; }
  lastSaveAt = Date.now();
  const { error } = await supabase.from('user_views')
    .upsert({ dataset, state }, { onConflict: 'user_id,dataset' });
  if (error) console.warn('[views] autosave failed:', error.message);
  else lastSaved = text;
}

let viewerRef: any = null;

/** Called by the dataset switcher. A switch that reloads the page offers the
 *  saved view on the next load; one that does not, a few seconds from now. */
export function offerViewRestoreAfterSwitch() {
  try { sessionStorage.setItem(OFFER_KEY, '1'); } catch { /* private mode */ }
  setTimeout(() => {
    try { if (sessionStorage.getItem(OFFER_KEY) !== '1') return; sessionStorage.removeItem(OFFER_KEY); } catch { return; }
    if (viewerRef && userIdOf()) void offerRestore(viewerRef);
  }, 4000);
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

async function offerRestore(viewer: any) {
  const dataset = datasetKey();
  if (!dataset) return;
  // Never on the Sandbox (practice data, nothing to pick up), and not when
  // the player turned the offer off (Ames 2026-10-01).
  if (!offerEnabled()) return;
  if (findDatasetBySegName(currentSegLayerName())?.section === 'sandbox') return;
  const { data, error } = await supabase.from('user_views')
    .select('state,updated_at').eq('dataset', dataset).maybeSingle();
  if (error || !data?.state) return;
  let now = '';
  try { now = JSON.stringify(viewer.state.toJSON()); } catch { /* */ }
  if (JSON.stringify(data.state) === now) return;
  showBar(dataset, String(data.updated_at || ''), () => {
    try { viewer.state.restoreState(data.state); } catch (e) { console.warn('[views] restore failed:', e); }
  });
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function showBar(dataset: string, updatedAt: string, onRestore: () => void) {
  document.querySelector('.nge-view-restore')?.remove();
  const label = findDatasetBySegName(dataset)?.shortLabel || dataset;
  const bar = document.createElement('div');
  bar.className = 'nge-view-restore';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<span class="nge-vr-text"></span>`
    + `<button type="button" class="nge-vr-yes">Restore</button>`
    + `<button type="button" class="nge-vr-no" aria-label="Dismiss">×</button>`;
  (bar.querySelector('.nge-vr-text') as HTMLElement).textContent =
    `Pick up where you left off in ${label}? Saved ${ago(updatedAt)}.`;
  const close = () => bar.remove();
  bar.querySelector('.nge-vr-yes')!.addEventListener('click', () => { onRestore(); close(); });
  bar.querySelector('.nge-vr-no')!.addEventListener('click', close);
  document.body.appendChild(bar);
  // Gone by itself after a few seconds unless the pointer is on it (it was
  // 30 s, long enough to feel stuck there).
  const SHOW_MS = 8000;
  let hide = setTimeout(close, SHOW_MS);
  bar.addEventListener('mouseenter', () => { clearTimeout(hide); bar.classList.add('nge-view-restore--held'); });
  bar.addEventListener('mouseleave', () => { bar.classList.remove('nge-view-restore--held'); hide = setTimeout(close, 3000); });
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
  viewerRef = viewer;
  const hashAtLoad = window.location.hash;
  let switched = false;
  try { switched = sessionStorage.getItem(OFFER_KEY) === '1'; sessionStorage.removeItem(OFFER_KEY); } catch { /* */ }
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
      if (switched || withoutOwnView(hashAtLoad)) void offerRestore(viewer);
    } else if (tries > 120) clearInterval(wait);
  }, 1000);
}
