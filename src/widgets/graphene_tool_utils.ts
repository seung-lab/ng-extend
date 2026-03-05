/**
 * graphene_tool_utils.ts
 * Utility to deactivate graphene multicut / merge tools in the viewer.
 * Shared between SplitMergeOverlay.vue and main.ts (Escape handler).
 */

/**
 * Deactivate the active graphene multicut or merge tool.
 * Tries the viewer's toolBinder first, falls back to toggling the side panel.
 */
export function exitGrapheneTool() {
  const viewer = (window as any)['viewer'];
  if (!viewer) return;

  // Approach 1: Access the viewer's toolBinder and dispose graphene tools
  try {
    const tb = viewer.toolBinder;
    if (tb?.bindings) {
      const entries: [any, any][] = typeof tb.bindings.entries === 'function'
        ? Array.from(tb.bindings.entries()) as [any, any][]
        : [];
      for (const [, binding] of entries) {
        if (!binding) continue;
        let tool: any = null;
        try { tool = binding.tool_?.value ?? binding.tool_; } catch {}
        if (tool && typeof tool === 'object' && tool !== binding) {
          const name = (tool.constructor?.name || '').toLowerCase();
          if (name.includes('multicut') || name.includes('merge') || name.includes('graphene')) {
            try { if (typeof tool.dispose === 'function') tool.dispose(); } catch {}
            try {
              if (binding.tool_ && 'value' in binding.tool_) binding.tool_.value = undefined;
            } catch {}
            return;
          }
        }
      }
    }
  } catch {}

  // Approach 2: Toggle selectedLayer visibility to close the tool panel
  try { viewer.selectedLayer.visible = false; } catch {}
}
