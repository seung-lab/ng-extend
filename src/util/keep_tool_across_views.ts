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
import { useSplitMergeOverlayStore } from '../store';
import { activateGrapheneTool, exitGrapheneTool } from '../widgets/graphene_tool_utils';

const SETTLE_MS = 2500;
let timer: ReturnType<typeof setTimeout> | null = null;

export function startKeepToolAcrossViews(): void {
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
