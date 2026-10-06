/**
 * Say so when a dataset's segmentation server is down.
 *
 * When the server behind a dataset stops answering, the cells simply never
 * appear: a 3D only view stays black and nothing explains why. On 2026-10-05
 * the MEC server answered 503 and it read as a sign in problem (Ames: "maybe
 * didn't prompt me to login?"). This shows a plain bar while the server is
 * down and takes it away when it answers again.
 *
 * How it tells. Asked with no sign in, a healthy CAVE server answers "401, sign
 * in first", and the browser lets the page read that. A server that is down
 * answers with a bare error page (which the browser will not let the page
 * read, so the request fails) or not at all. Checked against the real
 * servers on 2026-10-05: Retina, Sandbox, BANC and MEC answer 401 when up,
 * and an MEC service that was answering 503 made the request fail. The bar
 * shows only when the cells have also failed to load in the viewer, the
 * browser is online, and two checks in a row agree.
 */
import { findDatasetBySegName } from '../datasets';

const CHECK_MS = 30000;
const CONFIRM_MS = 8000;

interface Target { url: string; name: string; loaded: boolean; }

/** The graphene segmentation layer on screen, if there is one. */
function target(viewer: any): Target | null {
  for (const ml of viewer?.layerManager?.managedLayers ?? []) {
    const source = ml.layer?.dataSources?.[0];
    const url: string = source?.spec?.url ?? '';
    if (!url.startsWith('graphene://') || !url.includes('/segmentation/table/')) continue;
    const clean = url.replace('graphene://middleauth+', '').replace('graphene://', '');
    const loadState = source.loadState;
    return { url: `${clean}/info`, name: ml.name ?? '', loaded: loadState !== undefined && loadState.error === undefined };
  }
  return null;
}

/** True when the server answered the way a working one does. */
async function serverAnswers(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return r.status < 500;
  } catch { return false; }
}

const CSS = `
.nge-seg-down { position: fixed; top: 104px; left: 50%; transform: translateX(-50%); z-index: 9000;
  display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 24px));
  padding: 9px 10px 9px 14px; border-radius: 8px; font: 13px/1.4 'Inter', system-ui, sans-serif;
  color: #ffe9c7; background: rgba(28, 18, 6, 0.95); border: 1px solid rgba(255, 190, 90, 0.55);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
.nge-seg-down .nge-sd-text { overflow-wrap: anywhere; }
.nge-seg-down .nge-sd-no { flex-shrink: 0; width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1;
  color: rgba(255, 233, 199, 0.75); background: transparent; border: 1px solid rgba(255, 233, 199, 0.2); }
`;

let dismissedFor = '';

function show(name: string, key: string) {
  if (dismissedFor === key || document.querySelector('.nge-seg-down')) return;
  const label = findDatasetBySegName(name)?.shortLabel || name || 'This dataset';
  const bar = document.createElement('div');
  bar.className = 'nge-seg-down';
  bar.setAttribute('role', 'alert');
  bar.innerHTML = `<span class="nge-sd-text"></span><button type="button" class="nge-sd-no" aria-label="Dismiss">×</button>`;
  (bar.querySelector('.nge-sd-text') as HTMLElement).textContent =
    `The ${label} server is not answering, so its cells cannot load right now. Your sign in is fine. I will say here when it is back.`;
  bar.querySelector('.nge-sd-no')!.addEventListener('click', () => { dismissedFor = key; bar.remove(); });
  document.body.appendChild(bar);
}
const hide = () => document.querySelector('.nge-seg-down')?.remove();
/** The server answers again but this page's cells never loaded: say to reload. */
function sayBack(name: string) {
  const text = document.querySelector('.nge-seg-down .nge-sd-text');
  if (!text) return;
  const label = findDatasetBySegName(name)?.shortLabel || name || 'This dataset';
  text.textContent = `The ${label} server is answering again. Reload the page to load its cells.`;
}

/** Call once the viewer exists. */
export function startSegmentationServerWatch(viewer: any) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  let busy = false;
  const check = async () => {
    // Not while the sign in screen is up: nothing loads behind it anyway.
    if (busy || document.hidden || document.querySelector('.nge-login-blocker')) return;
    busy = true;
    try {
      const t = target(viewer);
      if (!t || t.loaded || !navigator.onLine) { hide(); return; }
      if (await serverAnswers(t.url)) { sayBack(t.name); return; }
      // One odd answer is not an outage: look again before saying anything.
      await new Promise(r => setTimeout(r, CONFIRM_MS));
      const again = target(viewer);
      if (!again || again.url !== t.url || again.loaded || !navigator.onLine) { hide(); return; }
      if (await serverAnswers(again.url)) { hide(); return; }
      show(again.name, again.url);
    } finally { busy = false; }
  };
  setTimeout(check, 12000);          // give the dataset time to load first
  setInterval(check, CHECK_MS);
}
