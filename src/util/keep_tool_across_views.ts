/**
 * Merge or cut mode carries on into the next view (Nseraf #203: "If I have
 * merge enabled and I complete a cell, then get auto-jumped to a new cell
 * ctrl+click to select stuff to merge doesn't/won't work unless i disable
 * merge and then re-enable").
 *
 * Pyr loads a view in place by setting the address (the next claim after a
 * completion, a claim, a jump): the layers are rebuilt, and the tool stayed
 * bound to the old segmentation layer, looking on but doing nothing. When
 * that happens with merge or cut mode on, the mode is switched off and on
 * again once the new view has loaded, as the player had to do by hand.
 */
import { watch } from 'vue';
import { useSplitMergeOverlayStore } from '../store';
import { activateGrapheneTool, exitGrapheneTool } from '../widgets/graphene_tool_utils';

const SETTLE_MS = 2500;
let timer: ReturnType<typeof setTimeout> | null = null;

/** And through a refresh (Nseraf, report 240: "if we have merge/cut open
 *  before a refresh/reload for that merge/cut to be there after"). The points
 *  already come back with the view; the tool that was open is remembered per
 *  tab (sessionStorage, so another tab does not open it) and opened again
 *  once the cell layer is ready. */
const OPEN_TOOL_KEY = 'nge-open-tool';
function reopenAfterRefresh(): void {
  let was = '';
  try { was = sessionStorage.getItem(OPEN_TOOL_KEY) || ''; } catch { /* storage blocked */ }
  const store = useSplitMergeOverlayStore();
  let reopening = false;
  // From now on, keep the note up to date.
  watch(() => store.toolActive, mode => {
    try {
      if (mode === 'merge' || mode === 'multicut') sessionStorage.setItem(OPEN_TOOL_KEY, mode);
      else if (!reopening) sessionStorage.removeItem(OPEN_TOOL_KEY);
    } catch { /* storage blocked */ }
  });
  if (was !== 'merge' && was !== 'multicut') return;
  // Wait for a cell layer with its proofreading server, for up to 30 s.
  reopening = true;
  let tries = 0;
  const look = () => {
    const viewer: any = (window as any).viewer;
    const seg = viewer?.layerManager?.managedLayers?.find((x: any) => !x.archived && String(x.layer?.type || '').startsWith('segmentation'));
    const ready = !!seg?.layer?.graphConnection?.value;
    if (store.toolActive === was) { reopening = false; return; }
    if (ready) {
      setTimeout(() => { activateGrapheneTool(was as 'merge' | 'multicut'); reopening = false; }, 800);
      return;
    }
    if (++tries < 60) setTimeout(look, 500); else reopening = false;
  };
  setTimeout(look, 1500);
}

export function startKeepToolAcrossViews(): void {
  reopenAfterRefresh();
  // Neuroglancer writes the view into the address with replaceState, which
  // fires no hashchange: this is only Pyr (or the player) loading a view.
  window.addEventListener('hashchange', () => {
    const mode = useSplitMergeOverlayStore().toolActive;
    if (mode !== 'merge' && mode !== 'multicut') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const viewer: any = (window as any).viewer;
      const seg = viewer?.layerManager?.managedLayers?.find((x: any) => String(x.layer?.type || '').startsWith('segmentation'));
      if (!seg) return;
      exitGrapheneTool();
      setTimeout(() => activateGrapheneTool(mode), 150);
    }, SETTLE_MS);
  });
}
