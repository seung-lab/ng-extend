import { Step } from "./store-pyr";
import neuronIcon from '../static/badges/pyr/neuron-icon-white.png';

/**
 * Tutorial 4 : Site Tour
 * --------------------------------------------------------------
 * A guided walkthrough of every feature in the EyeWire II
 * Community interface. Unlike Tutorials 1-3 (which teach the
 * science of proofreading) this tour teaches the UI itself:
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
This quick tour walks you through every feature in the community interface: the **toolbar**, **panels**, **profile**, and **viewer**.

Use **Next** / **Back** (or **Enter**) to navigate. Press **×** to exit.

*Takes about 2 minutes.*`,
    position: MIDDLE,
    modal: true,
    width: "560px",
    onEnter: closeAllPanels,
  },

  // ── 2. The Pyr logo / brand ──────────────────────────────────
  {
    title: "The Pyr Logo",
    text: `That little neuron in the top-left is **Pyr**, our pyramidal mascot. Click it any time to go home.`,
    position: { element: ".nge-pyr-logo", side: "bottom", offset: { x: 0, y: 12 } },
    highlight: true,
  },

  // ── 3. Dataset selector ──────────────────────────────────────
  {
    title: "Dataset Selector",
    text: `Switch between brain datasets here: **Pinky**, **Minnie65**, **Stroeh mouse retina**, **FlyWire**, and more.

Each dataset is a different volume of neural tissue with its own segments and tools.`,
    position: { element: ".nge-dataset-btn", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 4. Streak chip ───────────────────────────────────────────
  {
    title: "🔥 Your Streak",
    text: `Every day you make at least one edit, your streak grows. Skip a day and it resets, so come back tomorrow!

Your streak is shown next to your name on the leaderboard.`,
    position: { element: ".nge-streak-chip", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 5. Command palette ───────────────────────────────────────
  {
    title: "⌘K Command Palette",
    text: `Press **Ctrl+K** (or **⌘K** on Mac) to open the command palette: a fuzzy search across every action, panel, and recently-viewed cell.`,
    position: { element: ".nge-cmd-trigger", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 6. Cut Mode ──────────────────────────────────────────────
  {
    title: "✂️ Cut Mode",
    text: `**Shortcut: C**

When two neurons are incorrectly merged into one segment, **Cut Mode** lets you separate them. Place red dots on one neuron, blue dots on the other, then submit.

The Cut/Merge tutorial covers this in depth.`,
    position: { element: '[title^="Cut Mode"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 7. Merge Mode ────────────────────────────────────────────
  {
    title: "🔗 Merge Mode",
    text: `**Shortcut: M**

When pieces of the same neuron are split into multiple segments, **Merge Mode** stitches them back together. Click on each piece and the AI joins them into one root.`,
    position: { element: '[title^="Merge Mode"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 8. Find Path ─────────────────────────────────────────────
  {
    title: "🛤️ Find Path",
    text: `**Shortcut: F**

Drop two points on a neuron and Find Path traces the shortest route between them. Perfect for verifying a long dendrite is fully connected.`,
    position: { element: '[title^="Find Path"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 9. Week in Science ───────────────────────────────────────
  {
    title: "📊 Your Week in Science",
    text: `A weekly recap of your edits, completions, streak, plus a science fact or two.

We're so grateful for the contributions of our citizen science community. Every edit helps map the brain.

Sent automatically every Sunday as a notification.`,
    position: { element: '[title^="Your Week in Science"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 10. Leaderboard ──────────────────────────────────────────
  {
    title: "🏆 Leaderboard",
    text: `See who's leading the community. Toggle between **All Time / Month / Week**, and switch the metric between **edits** and **cells completed**.

Click any name to view their full Researcher Profile.`,
    position: { element: '[title^="Leaderboard"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 11. Cell Library ─────────────────────────────────────────
  {
    title: "🧬 Cell Library",
    text: `The community workshop. Six tabs:

- **My Cells**: claims + your completed
- **All / Available / Claimed / Completed**: explore the full library
- **Help**: open second-opinion requests

Claim up to 3 cells at a time. Mark them complete when done.`,
    position: { element: '[title^="Cell Library"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 12. Batch Processor ──────────────────────────────────────
  {
    title: "📦 Batch Processor",
    text: `Apply actions to many cells at once: recolor, complete, annotate. Useful when you've built a list of cells of the same type.`,
    position: { element: '[title^="Batch Processor"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 13. Second-opinion / Help ────────────────────────────────
  {
    title: "🔍 Second Opinion",
    text: `Stuck on a tricky cell? Request a second opinion. Other proofreaders can jump straight to your view, leave a note, and link an annotation layer with their suggestions.`,
    position: { element: '[title^="Second Opinion"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 14. Notifications ────────────────────────────────────────
  {
    title: "🔔 Notifications",
    text: `Badge unlocks, help-request responses, weekly recaps, and admin announcements all land here.`,
    position: { element: '[title^="Notifications"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 15. Chat ─────────────────────────────────────────────────
  {
    title: "💬 Community Chat",
    text: `Real-time chat with everyone currently online. Type **#segId** to share a clickable link to a segment, or **@name** to ping someone.

Drag the panel anywhere on screen.`,
    position: { element: '[title^="Chat"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 16. Settings ─────────────────────────────────────────────
  {
    title: "⚙️ Profile Settings",
    text: `Set your **flag emoji**, **bio**, and (under **Advanced**) toggle viewer settings, edit raw JSON state, and manage logged-in sessions.`,
    position: { element: '[title^="Profile Settings"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 17. My Profile ───────────────────────────────────────────
  {
    title: "Your Researcher Profile",
    text: `The person icon opens your **Researcher Profile**, home of stats, achievements, recent cells, and more.

Click any user's name in chat or the leaderboard to open *their* profile.`,
    position: { element: "#profileBtn", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 18. Hamburger menu ───────────────────────────────────────
  {
    title: "☰ Tutorials & Help",
    text: `The hamburger menu has three numbered tutorials:

1. **Basics**: navigation
2. **Advanced Interface**: every panel
3. **Cut & Merge**: proofreading operations

Plus links to the **Forum** and YouTube videos for each tool.`,
    position: { element: "#hamburger", side: "left", offset: { x: -10, y: 0 } },
    highlight: true,
  },

  // ── 19. The 3D viewer ────────────────────────────────────────
  {
    title: "The 3D Viewer",
    text: `The right panel renders neurons as 3D meshes. **Drag** to rotate, **scroll** to zoom, **shift-drag** to pan.

Click a segment to select it. A **Delta menu** next to the segment ID has completion, cell-type, and claim controls.`,
    position: VIEWER_3D,
  },

  // ── 20. The 2D viewer ────────────────────────────────────────
  {
    title: "The 2D Slice Viewers",
    text: `The left panels show electron-microscopy slices through the brain. This is the raw data the segmentation was built from.

**Scroll** to move through slices, **drag** to pan.`,
    position: VIEWER_2D,
  },

  // ── 21. The end ──────────────────────────────────────────────
  {
    title: "You're ready to explore!",
    html: `
<p style="text-align:center;font-size:15px;line-height:1.55;color:#dfeeff;margin:0 12px 16px;">
  Thank you for being part of our citizen science community.<br/>
  Every edit you make helps map the brain.
</p>
<div class="nge-tour-grid">
  <div class="nge-tour-card">
    <div class="nge-tour-card-icon"><img src="${neuronIcon}" alt="" style="width:24px;height:24px;display:block;margin:0 auto;"/></div>
    <div class="nge-tour-card-title">Cell Library</div>
    <div class="nge-tour-card-sub">Claim a neuron</div>
  </div>
  <div class="nge-tour-card">
    <div class="nge-tour-card-icon">📖</div>
    <div class="nge-tour-card-title">Tutorial 1</div>
    <div class="nge-tour-card-sub">Hands-on practice</div>
  </div>
  <div class="nge-tour-card">
    <div class="nge-tour-card-icon">🏆</div>
    <div class="nge-tour-card-title">Leaderboard</div>
    <div class="nge-tour-card-sub">Star community contributors</div>
  </div>
  <div class="nge-tour-card">
    <div class="nge-tour-card-icon">⌘K</div>
    <div class="nge-tour-card-title">Palette</div>
    <div class="nge-tour-card-sub">Power-user shortcuts</div>
  </div>
</div>
<p style="text-align:center;font-size:13px;margin:16px 12px 4px;color:rgba(190,215,240,0.75);">
  Drop us a note if you have any questions: <a href="mailto:support@eyewire.org" style="color:#9fdcff;text-decoration:none;border-bottom:1px solid rgba(159,220,255,0.4);">support@eyewire.org</a>
</p>
<p style="text-align:center;font-size:14px;margin:8px 12px 0;color:#9fdcff;font-style:italic;letter-spacing:0.4px;">
  Happy proofreading!
</p>`,
    position: MIDDLE,
    modal: true,
    width: "560px",
    nextLabel: "finish",
  },
];
