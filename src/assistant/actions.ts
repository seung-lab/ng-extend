// assistant/actions.ts — the ACTION REGISTRY. This is the allow-list of
// everything the assistant is permitted to do in the UI. Every entry is
// non-destructive: navigation and teaching only.
//
// HARD RULE (see docs/ai-assistant-spec.md §3): there is deliberately NO
// action here that merges, splits, submits a completion, requests help, or
// writes an annotation to CAVE. `setToolMode` only ENTERS a tool mode; the
// human performs the actual edit. Do not add write actions to this file.
//
// Each action, once validated, is emitted as a `nge:assistant-action`
// CustomEvent. ExtensionBar.vue owns the single listener that flips its panel
// refs, calls activateTool(), opens the command palette, or loads a segment —
// so the app's real state stays in one place.

export interface AssistantAction {
  name: string;
  args?: Record<string, any>;
}

export const ASSISTANT_ACTION_EVENT = "nge:assistant-action";

const PANELS = new Set([
  "cellLibrary", "leaderboard", "notifications", "settings",
  "chat", "recap", "batch", "datasetSelector",
]);
const TOOL_MODES = new Set(["merge", "split", "findPath", "none"]);

type Validator = (args: Record<string, any>) => Record<string, any> | null;

/**
 * Allow-listed actions and their argument validators. A validator returns the
 * cleaned args to run, or null to reject. `explainOnly` is intentionally absent
 * — it means "no UI action", handled by dispatch as a silent no-op.
 */
export const ACTION_REGISTRY: Record<string, Validator> = {
  openPanel: (args) =>
    PANELS.has(args?.panel) ? { panel: args.panel } : null,

  closePanel: (args) =>
    PANELS.has(args?.panel) ? { panel: args.panel } : null,

  setToolMode: (args) =>
    TOOL_MODES.has(args?.mode) ? { mode: args.mode } : null,

  goToSegment: (args) => {
    const segId = String(args?.segId ?? "").trim();
    return /^\d+$/.test(segId) ? { segId } : null;
  },

  openCommandPalette: (args) => {
    const query = typeof args?.query === "string" ? args.query : "";
    return { query };
  },
};

/**
 * Validate a single action against the registry and, if valid, emit it for
 * ExtensionBar to execute. Unknown or malformed actions are dropped. Returns
 * true if the action was dispatched.
 */
export function runAction(action: AssistantAction): boolean {
  if (!action || typeof action.name !== "string") return false;
  if (action.name === "explainOnly") return false; // text-only, nothing to do

  const validate = ACTION_REGISTRY[action.name];
  if (!validate) {
    console.warn("[assistant] dropped non-allow-listed action:", action.name);
    return false;
  }
  const cleanArgs = validate(action.args || {});
  if (!cleanArgs) {
    console.warn("[assistant] dropped action with invalid args:", action.name, action.args);
    return false;
  }

  document.dispatchEvent(
    new CustomEvent(ASSISTANT_ACTION_EVENT, {
      detail: { name: action.name, args: cleanArgs },
    }),
  );
  return true;
}
