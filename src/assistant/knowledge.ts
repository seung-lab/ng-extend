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
import type { ChangeEntry } from "../util/version_watch";
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
    "- In the tutorials menu (top right), a green check mark after a tutorial's name means you have finished it and have its Achievement.",
    "- Merge tutorial (burger menu, top right): two real merges on a practice cell. Press M, Ctrl+click each of the two pieces, then Submit merge.",
    "- Cut tutorial (burger menu): two real cuts. Press C, Ctrl+click a red point on one neuron, press G to switch to blue, Ctrl+click a blue point on the other neuron right where they touch, then Submit cut.",
    "- Merger Sandbox (burger menu, 'Cut the mergers'): a set of fused cells, one at a time, shown as 'N / total solved'. Each opens in 3D with two neurons fused into one purple segment. The player finds where they touch and cuts them apart with the Cut tool (C, red points, G, blue points, Submit cut). Space brings up the 2D images.",
    "- Cut preview: in cut mode, once there is at least one red and one blue point, the Preview button on the cut bar (between Submit cut and Clear) colours the cell in 3D. Red is what would stay with the red points, blue is what would go with the blue points. Around the points the colours follow the supervoxels, so the edge of the cut is exact there; farther along the cell they show which side each branch ends up on. Nothing is cut until Submit cut. The colours clear when a point is moved, the cut is submitted, or cut mode is left. If it says 'No preview', the server refused those points, as it would refuse the cut: move them or add more.",
    "- Training Sim (Play on the Sandbox): Match score is Merge and Cut averaged. Merge is the share of missing pieces merged in, by size; Cut is the share of wrong parts cut off. With 0% Cut the score stays under about 50%: cut off the wrong parts to raise it.",
    "- Server status: one line at the top of Profile > Datasets says whether the lab servers for Retina, the Sandbox and MEC are OK; it opens by itself when one is slow or down.",
    "- Settings: sections are listed on the left (click one to jump there), with a search box and a Changed filter that shows only settings changed from the defaults.",
    "- In the Training Sim, Jump drops a pin, drawn over the cell, on the next spot to fix: blue means look near here, gold means merge this piece in, red means cut here.",
    "- Drag the line between the 2D and 3D views to resize them; double click it to split evenly.",
    "- The merge and cut bars at the bottom are both blue (merge used to be green). The cut bar stays blue the whole time cut mode is on. Which side you are placing shows on the RED and BLUE switch: the side being placed is the solid one. The button beside it, G Place blue (or G Place red), says what pressing G will do.",
    "- Holding the right mouse button still on a cell, in the 3D or a 2D view, for half a second opens that cell's Δ menu, the same menu as the Δ button by its ID in the segment list. A right click or a right drag still moves the view as before.",
    "- Merge points too far apart: the server only joins two points that are close together. Click both pieces right where they touch, zooming in first if needed.",
    "- A red merge dot that will not go away: Clear in Merge mode now removes every leftover dot, including one from a merge that never made it into the queue.",
    "- Merge and Cut tutorials take one learner at a time. If someone else has the practice cells (for example after a reload partway through), the tutorial box puts the player in line and shows their place; the cell loads by itself when it is their turn.",
    "- Removing a segment that has marks on it asks whether to delete its marks too. The box shows the removed segment's id in its own color, and Show takes the view to the marks before deciding.",
    "- In the Merge and Cut tutorials and the Merger Sandbox, the 'Help me' button in the tutorial box shows red and blue gems where the points go. 'Still need help?' offers chat and this guide.",
    "- If a cut goes through but the box still waits, the cut was not at the join: the two neurons are still one segment. Cut again where they touch.",
    // Ames 2026-11-04: Nurro's answer to the cut bar's 400 error, word for word.
    "- When asked about a cut that failed with 'Split failed: [400]' (for example 'Supervoxels must belong to the same object'), answer with exactly this text, keeping its line breaks: \"You received this error because your multi-cut points are too close together. Pyr neurons are made up of \"supervoxel\" building blocks that stack together to create segments. If blue and red points end up on the same supervoxel, the cut will fail. It can also mean a point landed on a neighboring cell: check that every red and blue point is on the cell you're cutting.\n\nA few tips:\n\n- Change point placement: place your points slightly further away from the merger area for a better result.\n- Find Path: use this tool (\"F\" to activate) to make sure you're viewing a merge and not an autapse (branches touching but not joined). Note: Find Path is only available in some datasets.\n- Use fewer points: sometimes 2 or 3 well-placed points work better than many scattered ones.\n- Preview first: in Cut mode, the Preview button shows you which supervoxels would go where before you submit, so you can check if the cut makes sense.\n\nIf you're still stuck after adjusting, you could also request a second opinion (the \"Help me\" button in the cut bar or the Second Opinion Requests panel) to get advice from another proofreader.\"",
    "- Someone stuck in the Merger Sandbox needs cutting advice. Do not send them to the Cell Library, Find Path or the merge tool, and do not offer the merge tutorial.",
    "- Practice cells are a spare copy. Edits there never touch real data and are undone for the next person.",
    "",
    // The short address (report 541, Ames 2026-11-15).
    "## The page address and sharing views",
    "- The page address is a short code (it ends in #!pyr: and a few letters). The view itself is kept in the player's own browser, so reloading, reopening a closed tab, or restarting the browser brings the view back.",
    "- The address only works in the same browser on the same computer. To send a view to someone, use the Share button in the top bar: it copies a short link that works anywhere. Copying the address bar does not share the view.",
    "- Switching to a dataset picks up where the player left off there. A bar offers Starting view to open it fresh; Settings > Switching datasets picks the default. Opening a cell from chat, the Cell Library or a quest still goes straight to it.",
    "",
    // Nurro could not say what Start playing does (Ames 2026-11-12).
    "## Play (the Start playing button)",
    "- Play is the quick way in: the Play button, 'Start playing' on a dataset card, or 'Play here'. It picks the work for the player, so there is nothing to choose or claim by hand.",
    "- If the Play button covers part of the 2D view, turn off 'Play button on the 2D view' in Settings, Screen. The Play button in the Cell Library stays, so you can still start playing from there.",
    "- A player who has not finished the training yet is taken to the next tutorial instead, in order: Get Started, Merge, Cut, Annotations, then Advanced Interface. A player with production access skips this.",
    "- After that, Play claims a cell on the dataset the player is on and opens it, with the Cell Library folded down to one slim bar showing that cell. Finish it with Complete (or Submit on a quest) and the next cell is waiting. Skip puts a cell back and moves on.",
    "- Not done with a cell yet? 'Save and come back' in the Complete form saves the view and keeps the cell claimed. An ordinary claim has no time limit: it stays the player's until they complete or release it. A Super Quest is held for 2 months from when it was claimed.",
    // MEC Axon complete vs Cell complete (Ames 2026-11-14).
    "- On MEC, the Complete form (and the Delta menu next to a segment ID) asks how the cell ended: 'Axon complete' means the axon is proofread to every end, and 'Complete' means the whole cell, axon and dendrites, is done. Both count as one completed cell for the player's total, the leaderboard and Achievements. Only a whole cell is marked proofread for the lab.",
    "- The two are counted separately too: the MEC card in Profile > Datasets and the 'Now entering' card show how many of the player's MEC cells were whole cells and how many were axons, the celebration says 'Axon Complete!' for an axon, and the Cell Library labels such a cell 'axon complete'.",
    "- An axon-complete cell can be finished as the whole cell later: open it and use Mark as Proofread in the Delta menu. It stays one cell, counted once, and becomes a whole cell. Axon completes made before 14 November 2026 were not recorded as axons, so they count as whole cells in these numbers.",
    "- Time on Quests: on MEC, Pyr counts active time on each claimed cell (cell on screen, Pyr in front, worked on in the last 5 minutes). Profile > Overview shows the player's own MEC Quest time and the Super Quest part, for today, this week, this month and all time (US Eastern weeks from Monday, months from the 1st); Dataset Stats shows it under Your part. Only the player sees it. Cilia Quests are not timed: a Cilia Quests card under Scout Report shows today, this week, all time, their Quests leaderboard place, and a bar to the next milestone.",
    "- On Retina, Play offers a choice: the BC Challenge (bipolar cells to proofread) or Cilia Quests (mark the cilium on a starburst cell).",
    "- While playing, a pill in the top bar says what is being played, such as 'BC Challenge' or 'Cilia Quest'. Clicking it hides the play box, and clicking again brings it back on the cell in hand. On Retina, the small arrows button beside it changes what is played (BC Challenge or Cilia Quests) or stops playing. On any other dataset, such as MEC or the Sandbox, the small square button beside the pill stops playing; the cell in hand stays claimed.",
    "- While playing Cilia Quests, the small i button on the play bar opens the quest instructions. The slim Highlight strip moves by its grip at the left edge (or any empty part), and the Highlight box keeps clear of the Cell Library box.",
    "- The Cilia Quests list shows the first 50 open cells (more appear as those are claimed) and the player's own cells; cells other players hold or submitted are counted, not listed.",
    "- In the Cell Library, the claimed cell the player is working on has a green Active tag by its name, like the quest being worked on in the Quests tab. Save view saves to that cell.",
    "- Letter shortcuts follow the letter printed on the key, so on a French (AZERTY) or German keyboard M still merges, C cuts, and so on.",
    "- In Highlight mode, with a start point placed, S marks the way back to the soma (To soma) and B marks every branch beyond the point (Beyond). Clear all asks first; Enter confirms. It removes only highlights, never segments or lab marks.",
    "- A player chooses a username when they request beta access (3 to 20 letters, numbers or underscores). It is how they appear in chat and how others tag them with @. If their sign-in has no name, it is also the name on the leaderboard. It can be changed any time in Profile > Settings.",
    "",
    // Questions players asked Nurro or chat that it could not answer, checked
    // against the code (Nov 2026 chat and guide_logs review).
    "## Common questions",
    "- Getting a view back: the corner buttons on each view switch between 2D + 3D, 3D only and 2D only, and Space toggles the layout. Clicking the 2D image layer's tab shows or hides the 2D view; right click on the tab turns the layer on or off, so a missing EM image is often a layer turned off. In the command palette (Ctrl+K): Toggle 3D Panel, Layer Side Panel, and Reset Viewer Position (that one only moves the camera back).",
    "- A hidden top bar means Magic Top Bar is on: move the mouse to the top edge, or press \\ (backslash). Turn it off in Settings or with Magic Top Bar in Ctrl+K.",
    "- Folders, in the segment list and the annotation list: '+ Folder' makes one (named 'New folder'). Double click a name to rename it. Drag a row onto a folder to put it in, or Ctrl+click or Shift+click rows and use 'Move to…' in the pick bar ('+ New folder', 'Out of folders'). Folders can be dragged: drop on the top or bottom edge of another folder to put it above or below, or on its middle to put it inside. The ✕ on a folder deletes it and asks whether its cells stay in view.",
    "- Hunts: when a Hunt is announced (in notifications), a pill in the top bar counts down ('Hunt in'), then opens the Hunt panel ('Open the Hunt'). Hunt cells are frozen while it runs, so nothing gets merged or cut. Ctrl+click drops a gem: key 3 for a Cut gem (a merger), key 4 for an Extend gem (a missing piece). Each gem shows Got it!, Not there, Found already, Edge of the dataset or Wrong gem; Found already and Edge of the dataset use no gem. A run ends when all are found or the gems run out. Medals (Gold, Silver, Bronze) go by how many were found, and the Hunt panel has its own Top hunters list.",
    "- Log out is the last item in the burger menu (top right), under Learn more.",
    "- To report a bug or send an idea: the bug icon in the top bar ('Submit an issue or feedback'). The form asks What kind? (Bug, Idea or Other) and can attach the current view, recent console messages, and up to four screenshots, each with a pen.",
    "- Edit access on real cells: burger menu, Ask for Edit Access. The player finds ten mistakes on cells that are not tutorial cells, in the Sandbox or the retina (seven cuts and three merges), places the cut or merge points without submitting, and saves each view in that panel. A reviewer approves it or asks for changes. If it still says View only after approval, sign out of Pyr and back in. The Proofreading Test in the menu is marked DO NOT TAKE, WIP.",
    "- Datasets Unlocked: the profile's overview shows a row under the favorite Achievement with an emblem for each dataset the player has unlocked edit access to (the Retina, MEC, FlyWire or BANC; it arrived Nov 20 2026 with a Datasets Unlocked ceremony in chat), with the date under it (the grant in Pyr, or the player's first edit there; FlyWire and BANC show just the year). CA3, the mouse hippocampus, has an emblem too, for everyone who helped proofread it. On their own profile a player can drag the emblems into the order they like (kept in that browser for now). Only unlocked ones show, on every profile; with none unlocked the row is not there. The Datasets tab has the same emblems under Edit access. If a dataset was just unlocked and still shows locked, sign out of Pyr and back in.",
    "- Notifications (the bell): Mark all read clears the unread dots; Delete all removes every note from your own feed only (it asks first); the x on a note hides just that one.",
    "- True End and Hits Edge are lab marks: True End is a branch end where the branch naturally stops, Hits Edge is a branch that reaches the edge of the dataset. Pick a mark, then Ctrl+click the cell. Pyr does not require them to complete a cell. On MEC an ordinary claim uses only the AIS mark; a Super Quest uses AIS, Checked and True End, and only the AIS is required. On Retina they are optional layers: Settings > 'Claiming a Retina cell adds the annotation layers', or the Annotation layers button in the Cell Library.",
    "- Cell type at completion: the Complete form shows the lab's AI prediction under 'Cell type (optional)'. 'Wrong? Correct it' is only for when the player is sure the AI is wrong; their choice is saved as a correction, and 'Keep the AI's type' undoes it.",
    "- Streaks: opening Pyr counts as the day, by the player's own local calendar day. The streak chip in the top bar is a flame with the day count inside it, drawn dark against the fire so it reads; the flame grows as the number gets more digits. Hover or click it to see the current streak and the best. Achievements are in Profile > Trophy Case: open a badge and use Make gold (one), Add silver (up to 5) or Add bronze (up to 10) to show it in Favorites.",
    "- Chat: there are no private messages. ↩ Reply quotes a message and pings its author, @ mentions someone, and Shift+Enter starts a new line. To show something, the 📍 menu offers Share my view or Share view + screenshot; other images can't be posted. In chat, ! asks Nurro (!help lists the commands) and only the player sees the answer.",
    "- CA3 is view only: it has no cell list, so cells can't be claimed or completed there. It has its own tour, Meet the cells of CA3, which plays the first time and replays from the 'tour' link in the Cell Library.",
    "",
    "## Toolbar buttons (the icon row)",
    toolbar,
    "- A new player starts with few of these and receives the rest over time: finishing Get Started brings Leaderboard, Undelete and Chat; the Merge and Cut tutorials bring Merge and Cut, and finishing both brings the Cell Library; Advanced Interface brings Find Path, Tags, Highlight and Lantern, and finishing it brings the Layer side panel; a first edit outside a tutorial brings Second Opinion; coming back on a second and third day brings anything still missing and Screenshot; a week brings Your Week in Science; production access brings the rest. Dataset Stats and Batch Processor start off for new players; Settings turns them on. Real cells can be edited once edit access is granted (burger menu, Ask for Edit Access). If a player cannot see an icon, it is in Profile > Settings > Toolbar Icons and in the Ctrl+K command bar. Never say it does not exist.",
    "- Shift+N adds a new layer; Profile > Settings > Merging can change it to N, Alt+N or none. The Lantern is Ctrl+L (Cmd+L on a Mac).",
    "- A new player first gets a short Starship tour of a real neuron (its parts, a synapse, a signal), then Get Started. Leaving the tour early still starts Get Started. It plays by itself once per browser; anyone can watch it again from the burger menu (top right), Starship Tour. The old rocket button by the chat box is retired.",
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

/** Most room the recent changelog entries may take in the reference. */
export const RECENT_CHANGES_MAX = 12000;
/** The newest entries keep their full sentences up to this much; older ones keep their title. */
const RECENT_CHANGES_DETAIL = 4000;

/**
 * The changelog entries players were shown, newest first, so Nurro knows every
 * change since its notes were last written (Ames 2026-11-16: "a way for Nurro
 * to stay up to date like by reading deployments"). Pyr deploys many times a
 * day, so the newest entries keep their sentences and the rest keep only their
 * title. Newest wins when it disagrees with an older note.
 */
export function formatRecentChanges(entries: ChangeEntry[]): string {
  if (!entries.length) return "";
  const out = ["## What changed recently (Pyr's changelog, newest first; where it disagrees with an older note above, this wins)"];
  let size = out[0].length;
  for (const e of entries) {
    const head = `### ${e.at.slice(0, 10)}: ${e.title}`;
    const full = [head, ...e.items.map(i => `- ${i}`)].join("\n");
    const block = size + full.length < RECENT_CHANGES_DETAIL ? full : head;
    if (size + block.length + 1 > RECENT_CHANGES_MAX) break;
    out.push(block);
    size += block.length + 1;
  }
  return out.length > 1 ? out.join("\n") : "";
}

/**
 * Assemble the live UI reference. `commands` (the command-palette catalog) is
 * optional — passed in from the CommandPalette component, since its list is
 * built with component-scoped closures. `recent` are the changelog entries
 * from recentChanges() in util/version_watch.ts.
 */
export function buildUiReference(commands?: CommandMeta[], recent?: ChangeEntry[]): string {
  if (cachedStatic === null) cachedStatic = buildStaticReference();
  const recentSection = recent && recent.length ? "\n\n" + formatRecentChanges(recent) : "";

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
  return cachedStatic + recentSection + cmdSection + (ng ? "\n\n" + ng : '');
}
