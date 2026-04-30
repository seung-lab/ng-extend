import { Step } from "./store-pyr";

/**
 * Tutorial 4 — Site Tour
 * --------------------------------------------------------------
 * A guided walkthrough of every feature in the EyeWire II
 * Community interface. Unlike Tutorials 1-3 (which teach the
 * science of proofreading) this tour teaches the UI itself —
 * what each button does, where to find each panel, and which
 * keyboard shortcuts make you faster.
 *
 * Run it from the hamburger menu → "Site Tour".
 */

const MIDDLE = {
  element: "body",
  x: 0.5,
  y: 0.5,
};

const VIEWER_3D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.72,
  y: 0.18,
};

const VIEWER_2D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.22,
  y: 0.18,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function closeAllPanels() {
  // Best-effort: emit a custom event other components can listen to,
  // and click any visible close (×) buttons on open Vue panels so the
  // tour starts from a clean slate.
  document.dispatchEvent(new CustomEvent("nge:close-all-panels"));
}

export const steps: Step[] = [
  // ── 1. Welcome ───────────────────────────────────────────────
  {
    title: "Welcome to EyeWire II",
    text: `
This quick tour walks you through every feature in the community interface — the **toolbar**, **panels**, **profile**, and **viewer**.

Use **Next** / **Back** (or **Enter**) to navigate. You can exit any time with the **×** button.

*Takes about 2 minutes.*`,
    position: MIDDLE,
    modal: true,
    width: "560px",
    onEnter: closeAllPanels,
  },

  // ── 2. The Pyr logo / brand ──────────────────────────────────
  {
    title: "The Pyr Logo",
    text: `That little neuron in the top-left is **Pyr**, our pyramidal mascot. Click it any time to visit eyewire.org.`,
    position: { element: ".nge-pyr-logo", side: "bottom", offset: { x: 0, y: 12 } },
  },

  // ── 3. Dataset selector ──────────────────────────────────────
  {
    title: "Dataset Selector",
    text: `Switch between brain datasets here — **Pinky**, **Minnie65**, **Stroeh mouse retina**, **FlyWire**, and more.

Each dataset is a different volume of neural tissue with its own segments and tools.`,
    position: { element: ".nge-dataset-btn", side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 4. Streak chip ───────────────────────────────────────────
  {
    title: "🔥 Your Streak",
    text: `Every day you make at least one edit, your streak grows. Skip a day and it resets — so come back tomorrow!

Your streak is shown next to your name on the leaderboard.`,
    position: { element: ".nge-streak-chip", side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 5. Command palette ───────────────────────────────────────
  {
    title: "⌘K — Command Palette",
    text: `Press **Ctrl+K** (or **⌘K** on Mac) to open the command palette — a fuzzy search across every action, panel, and recently-viewed cell.

Power users live here.`,
    position: { element: ".nge-cmd-trigger", side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 6. Cut Mode ──────────────────────────────────────────────
  {
    title: "✂️ Cut Mode",
    text: `**Shortcut: C**

When two neurons are incorrectly merged into one segment, **Cut Mode** lets you separate them. Place red dots on one neuron, blue dots on the other, then submit.

The Cut/Merge tutorial covers this in depth.`,
    position: { element: '[title^="Cut Mode"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 7. Merge Mode ────────────────────────────────────────────
  {
    title: "🔗 Merge Mode",
    text: `**Shortcut: M**

When pieces of the same neuron are split into multiple segments, **Merge Mode** stitches them back together. Click on each piece — the AI joins them into one root.`,
    position: { element: '[title^="Merge Mode"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 8. Find Path ─────────────────────────────────────────────
  {
    title: "🛤️ Find Path",
    text: `**Shortcut: F**

Drop two points on a neuron and Find Path traces the shortest route between them — perfect for verifying a long dendrite is fully connected.`,
    position: { element: '[title^="Find Path"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 9. Week in Science ───────────────────────────────────────
  {
    title: "📊 Your Week in Science",
    text: `A weekly recap of your edits, completions, streak, and where you rank in the community — plus a science fact or two.

Sent automatically every Sunday as a notification.`,
    position: { element: '[title^="Your Week in Science"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 10. Leaderboard ──────────────────────────────────────────
  {
    title: "🏆 Leaderboard",
    text: `See who's leading the community. Toggle between **All Time / Month / Week**, and switch the metric between **edits** and **cells completed**.

Click any name to view their full Researcher Profile.`,
    position: { element: '[title^="Leaderboard"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 11. Cell Library ─────────────────────────────────────────
  {
    title: "🧬 Cell Library",
    text: `The community workshop. Six tabs:

- **My Cells** — claims + your completed
- **All / Available / Claimed / Completed** — explore the full library
- **Help** — open second-opinion requests

Claim up to 3 cells at a time. Mark them complete when done.`,
    position: { element: '[title^="Cell Library"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 12. Batch Processor ──────────────────────────────────────
  {
    title: "📦 Batch Processor",
    text: `Apply actions to many cells at once — recolor, complete, annotate. Useful when you've built a list of cells of the same type.`,
    position: { element: '[title^="Batch Processor"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 13. Second-opinion / Help ────────────────────────────────
  {
    title: "🔍 Second Opinion",
    text: `Stuck on a tricky cell? Request a second opinion. Other proofreaders can jump straight to your view, leave a note, and link an annotation layer with their suggestions.`,
    position: { element: '[title^="Second Opinion"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 14. Notifications ────────────────────────────────────────
  {
    title: "🔔 Notifications",
    text: `Badge unlocks, help-request responses, weekly recaps, and admin announcements all land here. Click an item to expand it; click **Open in Help tab** on a help response to jump back to the cell.`,
    position: { element: '[title^="Notifications"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 15. Chat ─────────────────────────────────────────────────
  {
    title: "💬 Community Chat",
    text: `Real-time chat with everyone currently online. Type **#segId** to share a clickable link to a segment, or **@name** to ping someone.

Drag the panel anywhere on screen.`,
    position: { element: '[title^="Chat"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 16. Settings ─────────────────────────────────────────────
  {
    title: "⚙️ Profile Settings",
    text: `Set your **flag emoji**, **bio**, and (under **Advanced**) toggle viewer settings, edit raw JSON state, and manage logged-in sessions.

Admins also see the **Admin** tab here.`,
    position: { element: '[title^="Profile Settings"]', side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 17. My Profile ───────────────────────────────────────────
  {
    title: "Your Researcher Profile",
    text: `The big white person icon on the right opens **your profile** — stats, badges, recent cells, trophy case, special awards.

Click any user's name in chat or the leaderboard to open *their* profile.`,
    position: { element: "#profileBtn", side: "bottom", offset: { x: 0, y: 14 } },
  },

  // ── 18. Hamburger menu ───────────────────────────────────────
  {
    title: "☰ Tutorials & Help",
    text: `The hamburger menu has three numbered tutorials:

1. **Basics** — navigation
2. **Advanced Interface** — every panel
3. **Cut & Merge** — proofreading operations

Plus links to the **Forum** and YouTube videos for each tool.`,
    position: { element: "#hamburger", side: "left", offset: { x: -10, y: 0 } },
  },

  // ── 19. The 3D viewer ────────────────────────────────────────
  {
    title: "The 3D Viewer",
    text: `The right panel renders neurons as 3D meshes. **Drag** to rotate, **scroll** to zoom, **shift-drag** to pan.

Click a segment to select it — a lightbulb menu appears with completion / cell-type / claim controls.`,
    position: VIEWER_3D,
  },

  // ── 20. The 2D viewer ────────────────────────────────────────
  {
    title: "The 2D Slice Viewers",
    text: `The left panels show electron-microscopy slices through the brain. This is the raw data the segmentation was built from — you'll spend a lot of time here verifying merges and cuts at the pixel level.

**Scroll** to move through slices, **drag** to pan.`,
    position: VIEWER_2D,
  },

  // ── 21. The end ──────────────────────────────────────────────
  {
    title: "You're ready to explore!",
    text: `That's the whole interface. A few things to try next:

- Pick a neuron from **🧬 Cell Library** and claim it
- Run **Tutorial 1** (hamburger menu) for hands-on practice
- Open the **🏆 Leaderboard** to see who's online
- Press **Ctrl+K** for the command palette

Welcome to the community — happy proofreading!`,
    position: MIDDLE,
    modal: true,
    width: "560px",
    nextLabel: "finish",
  },
];
