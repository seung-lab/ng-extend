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
 */
export function exitGrapheneTool() {
  const viewer = (window as any)['viewer'];
  if (!viewer) return;

  // Approach 1: Set the selected layer's tool.value to undefined.
  // This is the canonical neuroglancer way to deactivate a tool.
  // SelectedLegacyTool.set(undefined) → unregister() → tool.dispose()
  try {
    const layer = viewer.selectedLayer?.layer?.layer;
    if (layer && layer.tool && layer.tool.value !== undefined) {
      const toolName = (layer.tool.value?.constructor?.name || '').toLowerCase();
      if (toolName.includes('multicut') || toolName.includes('merge') || toolName.includes('graphene') || toolName.includes('line')) {
        console.info('[graphene_tool_utils] Disposing tool via layer.tool.value =', toolName);
        layer.tool.value = undefined;
        return;
      }
    }
  } catch (e) {
    console.warn('[graphene_tool_utils] Approach 1 (layer.tool.value) failed:', e);
  }

  // Approach 2: Walk all managed layers looking for an active graphene tool
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
        return;
      }
    }
  } catch (e) {
    console.warn('[graphene_tool_utils] Approach 2 (iterate layers) failed:', e);
  }

  // Approach 3: Use the globalToolBinder to deactivate the active tool
  try {
    const gtb = viewer.toolBinder || viewer.globalToolBinder;
    if (gtb?.activeTool_) {
      console.info('[graphene_tool_utils] Cancelling via globalToolBinder');
      gtb.activeTool_.cancel?.();
      return;
    }
    // Try deactivate_ directly
    if (typeof gtb?.deactivate_ === 'function') {
      console.info('[graphene_tool_utils] Calling globalToolBinder.deactivate_()');
      gtb.deactivate_();
      return;
    }
  } catch (e) {
    console.warn('[graphene_tool_utils] Approach 3 (globalToolBinder) failed:', e);
  }

  // Approach 4: Close the side panel as last resort
  try {
    console.info('[graphene_tool_utils] Fallback — hiding selectedLayer panel');
    viewer.selectedLayer.visible = false;
  } catch {}
}
