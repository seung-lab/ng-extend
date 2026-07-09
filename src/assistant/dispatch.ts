// assistant/dispatch.ts — dispatch(actions): run a list of assistant actions
// through the allow-list. Anything not in the registry (§6) is ignored. This is
// the single choke point between model output and the UI: if it's not an
// allow-listed, validated action, it does not run.

import { AssistantAction, runAction } from "./actions";

/**
 * Execute each action in order, dropping any that are unknown or malformed.
 * Returns the number of actions actually dispatched.
 */
export function dispatch(actions: AssistantAction[] | undefined | null): number {
  if (!Array.isArray(actions)) return 0;
  let ran = 0;
  for (const action of actions) {
    if (runAction(action)) ran++;
  }
  return ran;
}
