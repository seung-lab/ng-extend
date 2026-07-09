// assistant/context.ts — buildAppContext(): a read-only snapshot of the current
// app state, sent to the guideAssistant backend each turn so answers are
// grounded in what the user is actually looking at. Every field maps to
// something that already exists in the app. Nothing here mutates state.

import { getDatasetCaveConfig } from "../config";
import { useLayersStore, useLoginStore } from "../store";
import { useTutorialStore } from "../store-pyr";

export interface AppContext {
  dataset?: string;
  datastack?: string;
  caveServer?: string;
  toolMode?: string;
  selectedSegments?: string[];
  openPanels?: string[];
  loggedIn?: boolean;
  userName?: string;
  tutorialProgress?: { active: number; step: number };
  lang?: string;
}

/** UI state only the ExtensionBar knows (its panel refs + active tool). */
export interface UiState {
  openPanels?: string[];
  toolMode?: string;
}

function getViewer(): any {
  return (window as any)["viewer"] || null;
}

function findSegmentationLayer(viewer: any): any {
  try {
    return viewer?.layerManager?.managedLayers?.find((x: any) => {
      const layer = x.layer;
      if (!layer) return false;
      const cn = layer.constructor?.name || "";
      return cn.includes("Segmentation") || layer.type === "segmentation";
    }) || null;
  } catch {
    return null;
  }
}

function readVisibleSegments(segLayer: any, cap = 25): string[] {
  try {
    const groupState = segLayer?.layer?.displayState?.segmentationGroupState?.value;
    const set = groupState?.visibleSegments;
    if (!set) return [];
    const out: string[] = [];
    for (const seg of set) {
      out.push(seg.toString());
      if (out.length >= cap) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Build the appContext snapshot. `ui` carries the panel/tool state that only
 * the ExtensionBar owns (its `show*` refs and the active tool); everything else
 * is read defensively from stores and the viewer so a missing piece never
 * throws.
 */
export function buildAppContext(ui: UiState = {}): AppContext {
  const ctx: AppContext = {};
  const viewer = getViewer();
  const segLayer = findSegmentationLayer(viewer);

  // Dataset + datastack + CAVE server
  try {
    const layerName = segLayer?.name || undefined;
    const cfg = getDatasetCaveConfig(layerName);
    ctx.dataset = cfg.datastack;
    ctx.datastack = cfg.datastack;
    try {
      ctx.caveServer = useLayersStore().getCaveServerUrl() || cfg.caveServer;
    } catch {
      ctx.caveServer = cfg.caveServer;
    }
  } catch { /* leave unset */ }

  // Visible segments
  ctx.selectedSegments = readVisibleSegments(segLayer);

  // Panels + tool mode (from the UI caller)
  if (ui.openPanels) ctx.openPanels = ui.openPanels;
  ctx.toolMode = ui.toolMode || "none";

  // Login
  try {
    const login = useLoginStore();
    const sessions: any[] = (login as any).sessions || [];
    const active = sessions.find((s: any) => s?.name) || sessions[0];
    ctx.loggedIn = sessions.length > 0;
    if (active?.name) ctx.userName = active.name;
  } catch { /* leave unset */ }

  // Tutorial progress
  try {
    const tut: any = useTutorialStore();
    const active = tut.activeTutorial?.value ?? tut.activeTutorial ?? 0;
    const step = typeof tut.getCurrentStep === "function"
      ? tut.getCurrentStep()
      : (tut.currentStep?.value ?? tut.currentStep ?? 0);
    ctx.tutorialProgress = { active: Number(active) || 0, step: Number(step) || 0 };
  } catch { /* leave unset */ }

  // Language
  try {
    ctx.lang = navigator.language;
  } catch { /* leave unset */ }

  return ctx;
}
