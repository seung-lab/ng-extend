import { Step, useTutorialStore } from "./store-pyr";
import { TOOLBAR_ICON_DEFS } from "./data/toolbar-icons";
import { cheatSheet } from "./tutorial-3";
import { startDatasetTour } from "./dataset_tour";

/**
 * Tutorial 12 : the Tracer Tour (Ames, 2026-10-16)
 * --------------------------------------------------------------
 * The interface tour for the Princeton Tracers, professional neuron mappers
 * playing on their own edition (src/edition.ts). It replaces Get Started as
 * the first thing they see, and the Site Tour in the burger menu.
 *
 * They know neuroglancer and proofreading already, so the boxes are short
 * and say what each control does in this game, not what a merge is. The top
 * bar goes in its default order (DEFAULT_TOOLBAR_ORDER in
 * data/toolbar-icons.ts); keep the two in step when an icon is added. Each
 * icon box targets `[data-icon-id]` and wears the bar's own icon. An icon
 * the player has hidden is not found, and TutorialStep centres that box.
 */

/** The bar's own icon for a box title, at the title's size. */
function icon(id: string): string | undefined {
  const def = TOOLBAR_ICON_DEFS.find(d => d.id === id);
  if (!def?.svg) return undefined;
  return `<span style="font-size:24px;line-height:0;display:block">${def.svg}</span>`;
}

const below = (element: string) => ({ element, side: "bottom" as const, offset: { x: 0, y: 14 } });
const onIcon = (id: string) => below(`[data-icon-id="${id}"]`);

const MIDDLE = { element: "body", x: 0.5, y: 0.5 };

/** The finish box's button: MEC's own "Meet the cells" tour. */
document.addEventListener("nge:tracer-meet-cells", () => {
  const store = useTutorialStore();
  store.tutorialStep12 = steps.length;
  startDatasetTour("pni_mec");
});

export const steps: Step[] = [
  {
    title: "Welcome, Princeton Tracers",
    text: `This is **Pyr**, the EyeWire II game, set up for you. It is the same game and the same data as the public site: your merges and cuts are real edits to the segmentation, and you share chat, the Cell Library and the leaderboard with the players.

You start in **MEC**. This tour walks the top bar from left to right. Press **Next**, or **×** to leave any time. It is in the burger menu (top right) whenever you want it again.`,
    position: MIDDLE,
    modal: true,
    width: "560px",
    onEnter: () => { document.dispatchEvent(new CustomEvent("nge:close-all-panels")); },
  },
  {
    title: "Nurro, and the Command Bar",
    text: `**Ctrl+K** (**⌘K** on Mac), or click **AI**. Type to search every action, panel and recent cell, and press **Enter** to run it.

Ask a question in plain words instead and Nurro, the guide, answers from what the game can do.`,
    position: below(".nge-ask-btn"),
    highlight: true,
  },
  {
    title: "Dataset Selector",
    text: `Switch datasets here. Each one is its own volume with its own cells and Cell Library. Datasets you can view but not edit are marked **View only**.`,
    position: below(".nge-dataset-btn"),
    highlight: true,
  },
  {
    title: "Share",
    text: `Copies a link to your exact view: dataset, camera, selected cells and layers. Paste it in chat and anyone who opens it lands where you are.`,
    position: below('[title="Share State"]'),
    highlight: true,
  },
  {
    title: "Cell Library",
    titleIcon: icon("cells"),
    text: `**Shift+L.** The work list for this dataset. Find an **Available** cell and **Claim** it, then mark it **Complete** when it is done. How many cells you can hold at once depends on the dataset.

Other tabs hold help requests, Scout Tags, your claims and your saved links. Some datasets put an **instructions** link in the header, and the **tour** link replays the dataset's tour of its cell types.`,
    position: onIcon("cells"),
    highlight: true,
  },
  {
    title: "Cut",
    titleIcon: icon("split"),
    text: `**C.** **Ctrl+click** red points on one cell, press **G** for blue, **Ctrl+click** blue points on the other, then **Submit cut** (or **Enter**).

**Preview** on the cut bar colors the two sides in 3D before you commit. Nothing is cut until you submit.`,
    position: onIcon("split"),
    highlight: true,
  },
  {
    title: "Merge",
    titleIcon: icon("merge"),
    text: `**M.** **Ctrl+click** each of the two pieces, then **Submit merge** (or **Enter**).`,
    position: onIcon("merge"),
    highlight: true,
  },
  {
    title: "Find Path",
    titleIcon: icon("findPath"),
    text: `**F.** **Ctrl+click** two points on one segment and it draws the shortest route between them through the cell. Useful to find where a merger joins the cell you are tracing.`,
    position: onIcon("findPath"),
    highlight: true,
  },
  {
    title: "Highlight",
    titleIcon: icon("highlight"),
    text: `**Shift+H.** Mark what you have checked. **Hold H and click** two points on a cell and the stretch between them is painted: **Checked**, **Needs a look** or **Problem**, or a label of your own.

Not every dataset has it yet: on MEC the icon says so.`,
    position: onIcon("highlight"),
    highlight: true,
  },
  {
    title: "Lantern",
    titleIcon: icon("lantern"),
    text: `**Shift+N.** Lights the cell around the center of your view and dims the rest, and the light moves with you. For checking a big cell one part at a time. Its panel sets the size of the light and how bright it is.`,
    position: onIcon("lantern"),
    highlight: true,
  },
  {
    title: "Undelete",
    titleIcon: icon("undelete"),
    text: `**Ctrl+Z.** Brings back cells you just removed from the view, newest first, including a whole cleared selection as one step.

It is about the view only. It does not undo a merge or a cut.`,
    position: onIcon("undelete"),
    highlight: true,
  },
  {
    title: "Your Week in Science",
    titleIcon: icon("recap"),
    text: `Your edits, completed cells and streak for the week.`,
    position: onIcon("recap"),
    highlight: true,
  },
  {
    title: "Leaderboard",
    titleIcon: icon("leaderboard"),
    text: `Rankings by edits or by cells completed, for all time, the month or the week. Click a name to open that person's profile.`,
    position: onIcon("leaderboard"),
    highlight: true,
  },
  {
    title: "Dataset Stats",
    titleIcon: icon("datasetStats"),
    text: `The dataset as a whole: cells completed, edits and annotations, with a short strip for your own part.`,
    position: onIcon("datasetStats"),
    highlight: true,
  },
  {
    title: "Batch Processor",
    titleIcon: icon("batch"),
    text: `Name a group of segment IDs and act on all of them at once: recolor, complete, annotate, copy the IDs or remove them from view.`,
    position: onIcon("batch"),
    highlight: true,
  },
  {
    title: "Screenshot",
    titleIcon: icon("screenshot"),
    text: `Save a picture of your view: pick the size, a transparent background, or the 3D view alone.`,
    position: onIcon("screenshot"),
    highlight: true,
  },
  {
    title: "Second Opinion",
    titleIcon: icon("help"),
    text: `Ask for a second pair of eyes on a cell, or answer someone else's request. A response can carry a note, a view link and an annotation layer.`,
    position: onIcon("help"),
    highlight: true,
  },
  {
    title: "Scout Tags",
    titleIcon: icon("tags"),
    text: `**Shift+T.** Flag a problem that is not your job right now. Pick a kind (Snip, Hairball, Twins, Debris or Extension), then **hold T and click** the spot in 2D or 3D.

Open tags are listed in **Cell Library, Tags**, so you can work through what others found.`,
    position: onIcon("tags"),
    highlight: true,
  },
  {
    title: "Layer Side Panel",
    titleIcon: icon("layers"),
    text: `Opens the selected layer's panel. On a segmentation layer the **Segments** tab lists the cells in view:

- Paste IDs (or coordinates) into the box and press **Enter** to add them
- The trash can removes a cell from view
- **Folders** group cells, with a color each
- **Ctrl+click** or **Shift+click** rows to pick several for one action`,
    position: onIcon("layers"),
    highlight: true,
  },
  {
    title: "Notifications",
    titleIcon: icon("notif"),
    text: `Achievements, answers to your help requests, and announcements from the team.`,
    position: onIcon("notif"),
    highlight: true,
  },
  {
    title: "Chat",
    titleIcon: icon("chat"),
    text: `Live chat with everyone online. Type **#** and a segment ID to post a link that jumps to it, and **@name** to mention someone.`,
    position: onIcon("chat"),
    highlight: true,
  },
  {
    title: "Your Profile",
    text: `Your stats, Achievements and recent cells. **Settings** live here too: which top bar icons you see (drag icons in the bar to reorder them), annotation point size, and neuroglancer's own controls behind the **?** button.`,
    position: below("#profileBtn"),
    highlight: true,
  },
  {
    title: "The Burger Menu",
    text: `This tour, the tutorials, the Merger Sandbox and the Proofreading Guide. You can skip the tutorials: they teach Merge and Cut from the start.`,
    position: { element: "#hamburger", side: "left", offset: { x: -10, y: 0 } },
    highlight: true,
  },
  {
    title: "Keyboard Shortcuts",
    html: cheatSheet([
      ["Command bar", "Ctrl+K"],
      ["Cell Library", "Shift+L"],
      ["Cut, then G for blue", "C"],
      ["Merge", "M"],
      ["Find Path", "F"],
      ["Submit a cut, merge or path", "Enter"],
      ["Highlight on and off", "Shift+H"],
      ["Lantern on and off", "Shift+N"],
      ["Scout Tags on and off", "Shift+T"],
      ["Undelete", "Ctrl+Z"],
      ["Mark the selected cell complete", "Ctrl+Shift+C"],
      ["Previous and next segment", "[ and ]"],
      ["Clear the selection", "Ctrl+Shift+X"],
      ["Switch layouts", "Space"],
      ["Step through EM slices", ", and ."],
    ]),
    position: MIDDLE,
    modal: true,
    width: "520px",
  },
  {
    title: "That's the bar",
    html: `<p>Pick a cell from the <strong>Cell Library</strong>, claim it, and go. Questions go to chat or to Nurro (<strong>Ctrl+K</strong>).</p>
<p>MEC has its own tour of its cell types:</p>
<button class="nge-hud-btn nge-hud-btn--go" style="margin-top:4px" onclick="document.dispatchEvent(new CustomEvent('nge:tracer-meet-cells'))">Meet the cells of MEC</button>`,
    position: MIDDLE,
    modal: true,
    width: "520px",
    nextLabel: "finish",
  },
];
