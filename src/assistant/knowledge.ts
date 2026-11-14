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
import { formatKeyStroke } from "neuroglancer/help/input_event_bindings";
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
    // First, so it is never cut off by the length limit on this reference.
    // Nurro told a player stuck in the Merger Sandbox to merge two pieces
    // (Ames, 2026-10-11): a "merger" there is the opposite job.
    "## Practice tutorials and the Merger Sandbox",
    "- A MERGER is an error where two different neurons are wrongly fused into one segment. It is fixed with a CUT, never with a merge. A missing branch is the opposite error and is fixed with a merge.",
    "- Merge tutorial (burger menu, top right): two real merges on a practice cell. Press M, Ctrl+click each of the two pieces, then Submit merge.",
    "- Cut tutorial (burger menu): two real cuts. Press C, Ctrl+click a red point on one neuron, press G to switch to blue, Ctrl+click a blue point on the other neuron right where they touch, then Submit cut.",
    "- Merger Sandbox (burger menu, 'Cut the mergers'): a set of fused cells, one at a time, shown as 'N / total solved'. Each opens in 3D with two neurons fused into one purple segment. The player finds where they touch and cuts them apart with the Cut tool (C, red points, G, blue points, Submit cut). Space brings up the 2D images.",
    "- Cut preview: in cut mode, once there is at least one red and one blue point, the Preview button on the cut bar (between Submit cut and Clear) colours the cell in 3D. Red is what would stay with the red points, blue is what would go with the blue points. Around the points the colours follow the supervoxels, so the edge of the cut is exact there; farther along the cell they show which side each branch ends up on. Nothing is cut until Submit cut. The colours clear when a point is moved, the cut is submitted, or cut mode is left. If it says 'No preview', the server refused those points, as it would refuse the cut: move them or add more.",
    "- In the Merge and Cut tutorials and the Merger Sandbox, the 'Help me' button in the tutorial box shows red and blue gems where the points go. 'Still need help?' offers chat and this guide.",
    "- If a cut goes through but the box still waits, the cut was not at the join: the two neurons are still one segment. Cut again where they touch.",
    // Ames 2026-11-04: Nurro's answer to the cut bar's 400 error, word for word.
    "- When asked about a cut that failed with 'Split failed: [400]' (for example 'Supervoxels must belong to the same object'), answer with exactly this text, keeping its line breaks: \"You received this error because your multi-cut points are too close together. Pyr neurons are made up of \"supervoxel\" building blocks that stack together to create segments. If blue and red points end up on the same supervoxel, the cut will fail. It can also mean a point landed on a neighboring cell: check that every red and blue point is on the cell you're cutting.\n\nA few tips:\n\n- Change point placement: place your points slightly further away from the merger area for a better result.\n- Find Path: use this tool (\"F\" to activate) to make sure you're viewing a merge and not an autapse (branches touching but not joined). Note: Find Path is only available in some datasets.\n- Use fewer points: sometimes 2 or 3 well-placed points work better than many scattered ones.\n- Preview first: in Cut mode, the Preview button shows you which supervoxels would go where before you submit, so you can check if the cut makes sense.\n\nIf you're still stuck after adjusting, you could also request a second opinion (the \"Help me\" button in the cut bar or the Second Opinion Requests panel) to get advice from another proofreader.\"",
    "- Someone stuck in the Merger Sandbox needs cutting advice. Do not send them to the Cell Library, Find Path or the merge tool, and do not offer the merge tutorial.",
    "- Practice cells are a spare copy. Edits there never touch real data and are undone for the next person.",
    "",
    // Nurro could not say what Start playing does (Ames 2026-11-12).
    "## Play (the Start playing button)",
    "- Play is the quick way in: the Play button, 'Start playing' on a dataset card, or 'Play here'. It picks the work for the player, so there is nothing to choose or claim by hand.",
    "- A player who has not finished the training yet is taken to the next tutorial instead, in order: Get Started, Merge, Cut, Annotations, then Advanced Interface. A player with production access skips this.",
    "- After that, Play claims a cell on the dataset the player is on and opens it, with the Cell Library folded down to one slim bar showing that cell. Finish it with Complete (or Submit on a quest) and the next cell is waiting. Skip puts a cell back and moves on.",
    "- Not done with a cell yet? 'Save and come back' in the Complete form saves the view and keeps the cell claimed. An ordinary claim has no time limit: it stays the player's until they complete or release it. A Super Quest is held for 2 months from when it was claimed.",
    // MEC Axon complete vs Cell complete (Ames 2026-11-14).
    "- On MEC, the Complete form (and the Delta menu next to a segment ID) asks how the cell ended: 'Axon complete' means the axon is proofread to every end, and 'Complete' means the whole cell, axon and dendrites, is done. Both count as one completed cell for the player's total, the leaderboard and Achievements. Only a whole cell is marked proofread for the lab.",
    "- The two are counted separately too: the MEC card in Profile > Datasets and the 'Now entering' card show how many of the player's MEC cells were whole cells and how many were axons, the celebration says 'Axon Complete!' for an axon, and the Cell Library labels such a cell 'axon complete'.",
    "- An axon-complete cell can be finished as the whole cell later: open it and use Mark as Proofread in the Delta menu. It stays one cell, counted once, and becomes a whole cell. Axon completes made before 14 November 2026 were not recorded as axons, so they count as whole cells in these numbers.",
    "- Time on Quests: on MEC, Pyr counts a player's active time on each claimed cell (the cell on screen, Pyr in front, and work on it in the last 5 minutes, such as moving the view, a mark, a merge or a cut). Profile > Overview shows their own time on Quests and on Super Quests for today, this week, this month and all time, and Dataset Stats shows the same for the dataset picked, under Your part. Weeks run Monday to Sunday and months from the 1st, on US Eastern time, like the weekly and monthly awards. Only the player sees their own time; it is not on other players' profiles. The table appears once there is at least a minute counted.",
    "- On Retina, Play offers a choice: the BC Challenge (bipolar cells to proofread) or Cilia Quests (mark the cilium on a starburst cell).",
    "- While playing, a pill in the top bar says what is being played, such as 'BC Challenge' or 'Cilia Quest'. Clicking it hides the play box, and clicking again brings it back on the cell in hand. On Retina, the small arrows button beside it changes what is played (BC Challenge or Cilia Quests) or stops playing.",
    "- In Highlight mode, with a start point placed, S marks the way back to the soma (To soma) and B marks every branch beyond the point (Beyond). Clear all asks first; Enter confirms. It removes only highlights, never segments or lab marks.",
    "- A player chooses a username when they request beta access (3 to 20 letters, numbers or underscores). It is how they appear in chat and how others tag them with @. If their sign-in has no name, it is also the name on the leaderboard. It can be changed any time in Profile > Settings.",
    "",
    "## Toolbar buttons (the icon row)",
    toolbar,
    "- A new player starts with few of these and receives the rest over time: finishing Get Started brings Leaderboard, Undelete and Chat; the Merge and Cut tutorials bring Merge and Cut, and finishing both brings the Cell Library; Advanced Interface brings Find Path, Tags, Highlight and Lantern, and finishing it brings the Layer side panel; a first edit outside a tutorial brings Second Opinion; coming back on a second and third day brings anything still missing and Screenshot; a week brings Your Week in Science; production access brings the rest. Dataset Stats and Batch Processor start off for new players; Settings turns them on. Real cells can be edited only after passing the Proofreading Test. If a player cannot see an icon, it is in Profile > Settings > Toolbar Icons and in the Ctrl+K command bar. Never say it does not exist.",
    "",
    "## Keyboard shortcuts",
    binds.length ? binds.join("\n") : "(none configured)",
  ].join("\n");
}

/**
 * Neuroglancer's own controls (the "Neuroglancer controls" panel), read from
 * the live viewer so the guide always knows what is actually bound (Amy
 * 2026-09-30). Per-layer bindings (toggle-layer-1 ... 9) collapse to one line.
 * Built once, the first time a viewer exists.
 */
let cachedNgControls: string | null = null;
function buildNgControls(): string {
  if (cachedNgControls !== null) return cachedNgControls;
  const ib = (window as any).viewer?.inputEventBindings;
  if (!ib) return '';
  const groups: [string, any][] = [['Global', ib.global], ['2D cross-section view', ib.sliceView], ['3D view', ib.perspectiveView]];
  const out: string[] = ['## Neuroglancer controls (keys and mouse)'];
  for (const [label, map] of groups) {
    if (!map) continue;
    const entries = new Map<string, string>();
    const seen = new Set<any>();
    const walk = (m: any) => {
      if (!m || seen.has(m)) return;
      seen.add(m);
      for (const parent of m.parents ?? []) walk(parent);
      for (const [event, action] of m.bindings?.entries?.() ?? []) {
        const key = String(event).substring(String(event).indexOf(':') + 1);
        const name = typeof action === 'string' ? action : action?.action;
        if (name) entries.set(key, String(name));
      }
    };
    walk(map);
    const lines: string[] = [];
    const layerCollapsed = new Set<string>();
    for (const [key, action] of entries) {
      const m = action.match(/^(.*-layer)-(\d+)$/);
      if (m) {
        if (m[2] !== '1') continue;
        const k = formatKeyStroke(key).replace(/\d/, 'N');
        const line = `- ${k}: ${m[1]}-N (N = 1 to 9, the layer number)`;
        if (!layerCollapsed.has(line)) { layerCollapsed.add(line); lines.push(line); }
        continue;
      }
      lines.push(`- ${formatKeyStroke(key)}: ${action}`);
    }
    if (lines.length) out.push(`### ${label}`, ...lines);
  }
  cachedNgControls = out.length > 1 ? out.join("\n") : '';
  return cachedNgControls;
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

  const ng = buildNgControls();
  return cachedStatic + cmdSection + (ng ? "\n\n" + ng : '');
}
