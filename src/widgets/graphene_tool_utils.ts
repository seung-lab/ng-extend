/**
 * graphene_tool_utils.ts
 * Utility to deactivate graphene multicut / merge tools in the viewer.
 * Shared between SplitMergeOverlay.vue and main.ts (Escape handler).
 */

/**
 * Deactivate the active graphene multicut or merge tool.
 *
 * Uses the neuroglancer SelectedLegacyTool API: setting layer.tool.value
 * to undefined properly calls dispose() on the tool and cleans up all
 * event listeners and in-progress annotations.
 *
 * We run all known approaches in sequence — even if approach 1 succeeds, we
 * also call toolBinder.deactivate_() to clear any straggler activation. Some
 * NG builds keep the legacy tool reference alive while the toolBinder still
 * holds an activation; only clearing both fully exits.
 */
export function exitGrapheneTool() {
  const viewer = (window as any)['viewer'];
  if (!viewer) return;
  let didSomething = false;

  // Approach 1: Set the selected layer's tool.value to undefined.
  // SelectedLegacyTool.set(undefined) → unregister() → tool.dispose()
  try {
    const layer = viewer.selectedLayer?.layer?.layer;
    if (layer && layer.tool && layer.tool.value !== undefined) {
      const toolName = (layer.tool.value?.constructor?.name || '').toLowerCase();
      if (toolName.includes('multicut') || toolName.includes('merge') || toolName.includes('graphene') || toolName.includes('line')) {
        console.info('[graphene_tool_utils] Disposing tool via selectedLayer.tool.value =', toolName);
        layer.tool.value = undefined;
        didSomething = true;
      }
    }
  } catch (e) {
    console.warn('[graphene_tool_utils] Approach 1 (selectedLayer.tool.value) failed:', e);
  }

  // Approach 2: Walk all managed layers — even if approach 1 ran, the active
  // tool may live on a different layer than the selected one.
  try {
    for (const ml of viewer.layerManager?.managedLayers ?? []) {
      const userLayer = ml.layer;
      if (!userLayer || !userLayer.tool) continue;
      const tool = userLayer.tool.value;
      if (!tool) continue;
      const name = (tool.constructor?.name || '').toLowerCase();
      if (name.includes('multicut') || name.includes('merge') || name.includes('graphene') || name.includes('line')) {
        console.info('[graphene_tool_utils] Disposing tool on layer', ml.name, ':', name);
        userLayer.tool.value = undefined;
        didSomething = true;
      }
    }
  } catch (e) {
    console.warn('[graphene_tool_utils] Approach 2 (iterate layers) failed:', e);
  }

  // Approach 3: Use the globalToolBinder to clear any tool activation. This
  // covers the case where layer.tool.value is undefined but a toolBinder
  // activation is still keeping the overlay open.
  try {
    const gtb = viewer.toolBinder || viewer.globalToolBinder;
    if (gtb?.activeTool_) {
      console.info('[graphene_tool_utils] Cancelling activeTool_ via globalToolBinder');
      try { gtb.activeTool_.cancel?.(); } catch {}
      didSomething = true;
    }
    if (typeof gtb?.deactivate_ === 'function') {
      console.info('[graphene_tool_utils] Calling globalToolBinder.deactivate_()');
      gtb.deactivate_();
      didSomething = true;
    }
  } catch (e) {
    console.warn('[graphene_tool_utils] Approach 3 (globalToolBinder) failed:', e);
  }

  // Approach 4: If the DOM overlay is still present after all the above, hide
  // the selectedLayer panel as a last resort to remove the visible UI.
  try {
    const stillThere = !!(
      document.querySelector('.graphene-multicut') ||
      document.querySelector('.graphene-merge-segments')
    );
    if (stillThere) {
      if (!didSomething) {
        console.info('[graphene_tool_utils] Fallback — DOM overlay still present, hiding selectedLayer panel');
      }
      viewer.selectedLayer.visible = false;
    }
  } catch {}
}
