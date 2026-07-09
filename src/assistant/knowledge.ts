// assistant/knowledge.ts — auto-generates the Guide's *factual* UI reference
// from the app's own source modules: the toolbar icon table, the keybinding
// config, and (passed in) the command-palette catalog. This is sent to the
// backend each turn and placed in the CACHED part of the system prompt, so the
// assistant's knowledge of buttons / shortcuts / commands stays correct as the
// app changes — no hand-edited prompt list to drift.
//
// The backend keeps the voice, safety rules, and how-to prose; this supplies
// the ground truth for "what buttons exist, what are the shortcuts, what can
// the command palette do."

import { TOOLBAR_ICON_DEFS } from "../data/toolbar-icons";
// @ts-ignore — JSON import (esbuild bundles it). This IS the keybind source file.
import CUSTOM_KEYBINDS from "../../config/custom-keybinds.json";

export interface CommandMeta {
  id: string;
  label: string;
  description?: string;
  category?: string;
  shortcut?: string;
}

// Readable labels for graphene tools and known command ids.
const TOOL_LABELS: Record<string, string> = {
  grapheneMergeSegments: "Merge segments (join two pieces of one neuron)",
  grapheneMulticutSegments: "Split / multicut segments (cut apart wrongly-joined neurons)",
  grapheneFindPath: "Find path between two points",
  freeRotateCubeAnnotationTool: "Free-rotate the annotation cube",
  "clear-segments": "Clear selected segments",
  "select-previous": "Select previous segment",
  "select-next": "Select next segment",
};

function keyLabel(code: string): string {
  return code
    .split("+")
    .map((part) => {
      if (part === "control") return "Ctrl";
      if (part === "shift") return "Shift";
      if (part === "alt") return "Alt";
      if (part === "meta") return "Cmd";
      if (/^key[a-z]$/i.test(part)) return part.slice(3).toUpperCase();
      if (/^digit\d$/i.test(part)) return part.slice(5);
      if (part === "bracketleft") return "[";
      if (part === "bracketright") return "]";
      if (part === "space") return "Space";
      return part;
    })
    .join("+");
}

function bindingLabel(val: any): string | null {
  if (val === false || val == null) return null; // disabled binding
  if (typeof val === "string") return TOOL_LABELS[val] || val;
  if (typeof val === "object" && val.tool) return TOOL_LABELS[val.tool] || val.tool;
  return null;
}

// Toolbar + keybindings are build-time constants — compute once.
let cachedStatic: string | null = null;

function buildStaticReference(): string {
  const toolbar = TOOLBAR_ICON_DEFS.map((i) => `- ${i.label} (id: ${i.id})`).join("\n");

  const binds: string[] = [];
  try {
    for (const [code, val] of Object.entries(CUSTOM_KEYBINDS as Record<string, any>)) {
      const label = bindingLabel(val);
      if (label) binds.push(`- ${keyLabel(code)} — ${label}`);
    }
  } catch {
    /* leave empty */
  }

  return [
    "## Toolbar buttons (the icon row)",
    toolbar,
    "",
    "## Keyboard shortcuts",
    binds.length ? binds.join("\n") : "(none configured)",
  ].join("\n");
}

/**
 * Assemble the live UI reference. `commands` (the command-palette catalog) is
 * optional — passed in from the CommandPalette component, since its list is
 * built with component-scoped closures.
 */
export function buildUiReference(commands?: CommandMeta[]): string {
  if (cachedStatic === null) cachedStatic = buildStaticReference();

  let cmdSection = "";
  if (commands && commands.length) {
    const byCat: Record<string, string[]> = {};
    for (const c of commands) {
      const cat = c.category || "other";
      (byCat[cat] = byCat[cat] || []).push(
        `- ${c.label}${c.shortcut ? ` [${c.shortcut}]` : ""}${c.description ? ` — ${c.description}` : ""}`,
      );
    }
    cmdSection =
      "\n\n## Command palette (Ctrl+K) commands\n" +
      Object.entries(byCat)
        .map(([cat, items]) => `### ${cat}\n${items.join("\n")}`)
        .join("\n");
  }

  return cachedStatic + cmdSection;
}
