import { Step } from "./store-pyr";
import neuronIcon from '../static/badges/pyr/neuron-icon-white.png';
import mossyFibersHero from '../static/tour-mossy-fibers.png';
import brainToSynapseHero from '../static/tour-brain-to-synapse.png';

/* ─────────────────────────────────────────────────────────────────────────
   Title icons — the same SVGs that live in the top toolbar
   (`ExtensionBar.vue`), re-emitted here at the size the tour title
   expects (24px) so each step's popup wears its toolbar's face. Keep the
   strokes, fills, and palette identical to ExtensionBar.vue so a user who
   recognizes the toolbar icon recognizes the step.
   ───────────────────────────────────────────────────────────────────────── */
const TI_STYLE = 'width:24px;height:24px;vertical-align:middle;display:block;';
const TI_NEUTRAL = '#cfdcef';
const TI_RED     = '#e06060';
const TI_GREEN   = '#60c060';
const TI_PURPLE  = '#c8a4ff';
const TI_AMBER   = '#f5d142';

const ICON_SPLIT       = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_RED}"><path d="M8 3v2a4 4 0 0 1-4 4H4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 3v2a4 4 0 0 0 4 4h0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="2.5" r="1.4" fill="currentColor"/><circle cx="4" cy="13" r="1.4" fill="currentColor"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/><path d="M4 9v4M12 9v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_MERGE       = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_GREEN}"><path d="M4 3v4a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="4" cy="2.5" r="1.4" fill="currentColor"/><circle cx="12" cy="2.5" r="1.4" fill="currentColor"/><circle cx="8" cy="13" r="1.4" fill="currentColor"/><path d="M8 11v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_FINDPATH    = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_PURPLE}"><circle cx="3" cy="13" r="1.6" fill="currentColor"/><circle cx="13" cy="3" r="1.6" fill="currentColor"/><path d="M5 12 Q7 9 8 8 Q9 7 11 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.4 1.8"/></svg>`;
const ICON_RECAP       = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_NEUTRAL}"><rect x="2" y="10" width="2.4" height="4" rx="0.5" fill="currentColor" opacity="0.45"/><rect x="5.5" y="7" width="2.4" height="7" rx="0.5" fill="currentColor" opacity="0.65"/><rect x="9" y="4" width="2.4" height="10" rx="0.5" fill="currentColor" opacity="0.85"/><rect x="12.5" y="1.5" width="2" height="12.5" rx="0.5" fill="currentColor"/></svg>`;
const ICON_LEADERBOARD = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_AMBER}"><path d="M5 2h6v3.5a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 3H3v.8a2 2 0 0 0 2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 3h2v.8a2 2 0 0 1-2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.5 13h5l-.5-1.4h-4z" fill="currentColor"/></svg>`;
const ICON_BATCH       = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_NEUTRAL}"><path d="M8 1.8L13.5 4.6V11L8 13.8L2.5 11V4.6L8 1.8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.5 4.6L8 7.4L13.5 4.6M8 7.4V13.8" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const ICON_HELP        = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_NEUTRAL}"><circle cx="6.6" cy="6.6" r="3.8" stroke="currentColor" stroke-width="1.6"/><path d="M9.6 9.6l3.8 3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const ICON_NOTIF       = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_NEUTRAL}"><path d="M3.7 11.5h8.6c.5 0 .8-.5.5-.95L11.5 8.8V6.5a3.5 3.5 0 0 0-7 0v2.3L3.2 10.55c-.3.45 0 .95.5.95z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const ICON_CHAT        = `<svg viewBox="0 0 16 16" fill="none" style="${TI_STYLE}color:${TI_NEUTRAL}"><path d="M2.5 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7L4.5 14v-2.5a2 2 0 0 1-2-2V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const ICON_SETTINGS    = `<svg viewBox="0 0 24 24" fill="none" style="${TI_STYLE}color:${TI_NEUTRAL}"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.213-1.281Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke="currentColor" stroke-width="1.5"/></svg>`;
const ICON_CELLS       = `<img src="${neuronIcon}" alt="" style="width:22px;height:22px;display:block;opacity:0.92" />`;

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
    html: `
<div class="nge-tour-welcome">
  <div class="nge-tour-welcome-hero">
    <img src="${mossyFibersHero}" alt="CA3 sea of mossy fibers" />
  </div>
  <div class="nge-tour-welcome-body">
    <p>This quick tour walks you through the main features of EyeWire II: the <strong>toolbar</strong>, <strong>panels</strong>, <strong>profile</strong>, and <strong>viewer</strong>.</p>
    <p>Use <strong>Next</strong> / <strong>Back</strong> (or <strong>Enter</strong>) to navigate. Press <strong>×</strong> to exit.</p>
  </div>
</div>`,
    position: MIDDLE,
    modal: true,
    width: "640px",
    onEnter: closeAllPanels,
  },

  // ── 2. The Pyr logo / brand ──────────────────────────────────
  {
    title: "The Pyr Logo",
    text: `That little neuron in the top-left is **Pyr**, our pyramidal mascot.

**Click Pyr to hard-refresh the page** — the fastest way to pull in a fresh deploy without hunting for Ctrl+F5.`,
    position: { element: ".nge-pyr-logo", side: "bottom", offset: { x: 0, y: 12 } },
    highlight: true,
  },

  // ── 3. Share button ──────────────────────────────────────────
  {
    title: "Share",
    text: `Click **Share** to copy a link to your current view — same dataset, same camera, same selected segments.

Drop it into chat, email, or the forum and the recipient lands exactly where you are.`,
    position: { element: '[title="Share State"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 4. Help / "?" button ─────────────────────────────────────
  {
    title: "Keyboard Shortcuts (?)",
    text: `The **?** button opens neuroglancer's keybinding reference: every mouse and keyboard shortcut for navigation, tools, and layer controls.

Different from **⌘K** — the **?** is a *read-only cheat sheet*, ⌘K is an *action launcher*.`,
    position: { element: '.neuroglancer-viewer-top-row > .neuroglancer-icon[title*="elp"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 5. Dataset selector ──────────────────────────────────────
  {
    title: "Dataset Selector",
    text: `Switch between brain datasets here: **Pinky**, **Minnie65**, **Stroeh mouse retina**, **FlyWire**, and more.

Each dataset is a different volume of neural tissue with its own segments and tools.`,
    position: { element: ".nge-dataset-btn", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 6. Streak chip ───────────────────────────────────────────
  {
    title: "🔥 Your Streak",
    text: `Every day you make at least one edit, your streak grows. Skip a day and it resets, so come back tomorrow!

Your streak is shown next to your name on the leaderboard.`,
    position: { element: ".nge-streak-chip", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 7. Command palette ───────────────────────────────────────
  {
    title: "⌘K Command Palette",
    text: `Press **Ctrl+K** (or **⌘K** on Mac) to *do something fast*: fuzzy-search every action, panel, and recently-viewed cell, then run it from the keyboard.

Different from the **?** button, which is a static keybinding reference.`,
    position: { element: ".nge-cmd-trigger", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 6. Cut Mode ──────────────────────────────────────────────
  {
    title: "Cut Mode",
    titleIcon: ICON_SPLIT,
    text: `**Shortcut: C**

When two neurons are incorrectly merged into one segment, **Cut Mode** lets you separate them. Place red dots on one neuron, blue dots on the other, then submit.

The Cut/Merge tutorial covers this in depth.`,
    position: { element: '[title^="Cut Mode"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 7. Merge Mode ────────────────────────────────────────────
  {
    title: "Merge Mode",
    titleIcon: ICON_MERGE,
    text: `**Shortcut: M**

When pieces of the same neuron are split into multiple segments, **Merge Mode** stitches them back together. Click on each piece and the AI joins them into one root.`,
    position: { element: '[title^="Merge Mode"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 8. Find Path ─────────────────────────────────────────────
  {
    title: "Find Path",
    titleIcon: ICON_FINDPATH,
    text: `**Shortcut: F**

**Alt+click** two points on a neuron and Find Path traces the shortest route between them.

Drop a point on the right cell and somewhere on the merged cell to find where it originated.`,
    position: { element: '[title^="Find Path"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 9. Week in Science ───────────────────────────────────────
  {
    title: "Your Week in Science",
    titleIcon: ICON_RECAP,
    text: `A weekly recap of your edits, completions, streak, plus a science fact or two.

We're grateful to you for being a citizen scientist. Every edit brings us closer to mapping the brain!`,
    position: { element: '[title^="Your Week in Science"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 10. Leaderboard ──────────────────────────────────────────
  {
    title: "Leaderboard",
    titleIcon: ICON_LEADERBOARD,
    text: `See who's leading the community. Toggle between **All Time / Month / Week**, and switch the metric between **edits** and **cells completed**.

Click any name to view profile.`,
    position: { element: '[title^="Leaderboard"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 11. Cell Library ─────────────────────────────────────────
  {
    title: "Cell Library",
    titleIcon: ICON_CELLS,
    text: `The community workshop. Seven tabs:

- **My Cells**: claims + your completed
- **All / Available / Claimed / Completed**: explore the full library
- **Help**: open second-opinion requests
- **Links**: your saved cells and references

Claim up to 3 cells at a time. Mark them complete when done.`,
    position: { element: '[title^="Cell Library"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 12. Batch Processor ──────────────────────────────────────
  {
    title: "Batch Processor",
    titleIcon: ICON_BATCH,
    text: `Apply actions to many cells at once: recolor, complete, annotate. Useful when you've built a list of cells of the same type.

*Inspired by an extension originally built by citizen scientist KrzysztofKruk.*`,
    position: { element: '[title^="Batch Processor"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 13. Second-opinion / Help ────────────────────────────────
  {
    title: "Second Opinion",
    titleIcon: ICON_HELP,
    text: `Stuck on a tricky cell? Request Help.

Other citizen scientists can jump straight to your view, leave a note, link an annotation layer with their suggestions, and help you out!`,
    position: { element: '[title^="Second Opinion"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 14. Notifications ────────────────────────────────────────
  {
    title: "Notifications",
    titleIcon: ICON_NOTIF,
    text: `New achievements, help-request responses, weekly recaps, and admin announcements all land here.`,
    position: { element: '[title^="Notifications"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 15. Chat ─────────────────────────────────────────────────
  {
    title: "Community Chat",
    titleIcon: ICON_CHAT,
    text: `Real-time chat with everyone currently online. Type **#segId** to share a clickable link to a segment, or **@name** to ping someone.

You can also share your saved Links in chat.

Drag the panel anywhere on screen.`,
    position: { element: '[title^="Chat"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 16. Settings ─────────────────────────────────────────────
  {
    title: "Profile Settings",
    titleIcon: ICON_SETTINGS,
    text: `Set your **flag emoji**, **bio**, **toolbar icons**, and (under **Advanced**) toggle viewer settings, edit raw JSON state, manage logged-in sessions, and more.`,
    position: { element: '[title^="Profile Settings"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 17. My Profile ───────────────────────────────────────────
  {
    title: "Your Researcher Profile",
    text: `As a citizen scientist, you are officially contributing to scientific research.

Click here to open up your profile — home of your stats, achievements, recent cells, and more.

Click any user's name in chat or the leaderboard to open *their* profile.`,
    position: { element: "#profileBtn", side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },

  // ── 18. Hamburger menu ───────────────────────────────────────
  {
    title: "☰ Tutorials & Help",
    text: `Three numbered tutorials — **Basics** (navigation), **Advanced Interface** (every panel), and **Cut & Merge** (proofreading operations) — plus links to the **Forum** and YouTube videos for each tool.`,
    position: { element: "#hamburger", side: "left", offset: { x: -10, y: 0 } },
    highlight: true,
  },

  // ── 19. The Layers bar ───────────────────────────────────────
  {
    title: "The Layers Bar",
    text: `Each chip at the bottom is a data layer (image volume, segmentation, annotation, etc.).

**Click a layer chip** to open its side panel — that's where you find the **Source / Render / Seg. / Graph / Annotations** tabs you've seen throughout the tour.

Drag to reorder, **+** to add a new layer.`,
    position: { element: ".neuroglancer-layer-panel", side: "top", offset: { x: 0, y: -14 } },
    highlight: true,
  },

  // ── 20. The 3D viewer ────────────────────────────────────────
  {
    title: "The 3D Viewer",
    text: `The right panel renders neurons as 3D meshes. **Drag** to rotate, **scroll** to zoom, **shift-drag** to pan.

Click a segment to select it. A **Delta menu** next to the segment ID has completion, cell-type, and claim controls.`,
    position: VIEWER_3D,
    highlight: true,
  },

  // ── 21. The 2D viewer ────────────────────────────────────────
  {
    title: "The 2D Slice Viewers",
    text: `The left panels show electron-microscopy slices through the brain. This is the raw data the segmentation was built from.

**Scroll** to move through slices, **drag** to pan.`,
    position: VIEWER_2D,
    highlight: true,
  },

  // ── 22. The end ──────────────────────────────────────────────
  {
    title: "You're ready to explore!",
    html: `
<div class="nge-tour-finale">
  <div class="nge-tour-finale-hero">
    <img src="${brainToSynapseHero}" alt="From the human brain to a single synapse" />
  </div>
  <p class="nge-tour-finale-lead">
    Thank you for being a part of the EyeWire brain mapping community!
  </p>
  <p class="nge-tour-finale-sub">
    Every edit you make brings us closer to mapping the brain.
  </p>
  <p class="nge-tour-finale-contact">
    Questions? <a href="mailto:support@eyewire.org">support@eyewire.org</a>
  </p>
  <p class="nge-tour-finale-tag">
    For Science!
  </p>
</div>`,
    position: MIDDLE,
    modal: true,
    width: "640px",
    nextLabel: "finish",
  },
];
