import { Step } from "./store-pyr";
import imgSynapsesTutorial from './images/synapses-tutorial.jpg';
import imgBravoNurro from './images/bravo-nurro.png';
import { beginPractice, currentPractice, endPractice, piecesMerged } from './practice';

/* eslint-disable @typescript-eslint/no-explicit-any */
function getViewer(): any {
  return (window as any)['viewer'];
}

/** Close the side panel if open */
function closeSidePanel() {
  const viewer = getViewer();
  if (!viewer) return;
  try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
}

// ─── Practice cell wiring (src/practice.ts) ────────────────────────────────
// One sandbox example per user at a time. The status line under the step
// text is the only live part of the tutorial: it says whether the example
// loaded, and flips when the viewer confirms the merge or the cut landed.

let practiceWatch = 0;

function practiceStatus(text: string, done = false) {
  const chip = document.querySelector('.introductionStepAnchor .chip .html');
  if (!chip) return;
  let el = chip.querySelector('.nge-practice-status') as HTMLElement | null;
  if (!el) {
    el = document.createElement('p');
    el.className = 'nge-practice-status';
    el.style.cssText = 'margin:10px 0 0;padding:8px 10px;border-radius:4px;font-size:0.92em;line-height:1.4;'
      + 'background:rgba(53,181,255,0.10);border-left:2px solid rgba(53,181,255,0.75);color:#d0e8ff;';
    chip.appendChild(el);
  }
  el.textContent = text;
  el.style.background = done ? 'rgba(96,192,96,0.14)' : 'rgba(53,181,255,0.10)';
  el.style.borderLeftColor = done ? '#60c060' : 'rgba(53,181,255,0.75)';
}

/** Wait for the chip to render, then keep a status line current while
 *  polling the graph until `wantMerged` matches, or the step changes. */
function watchPractice(wantMerged: boolean, waiting: string, finished: string) {
  const token = ++practiceWatch;
  const tick = async () => {
    if (token !== practiceWatch) return;
    const p = currentPractice();
    if (p.phase === 'unavailable') { practiceStatus('Practice cells need you to be signed in. Read along and press next.'); return; }
    if (p.phase === 'busy') { practiceStatus('Every practice cell is in use right now. Read along and press next, or come back in a few minutes.'); return; }
    if (!p.example) { practiceStatus('Loading a practice cell…'); setTimeout(tick, 1000); return; }
    const merged = await piecesMerged();
    if (token !== practiceWatch) return;
    if (merged === wantMerged) { practiceStatus(finished, true); return; }
    practiceStatus(waiting);
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 600);
}

function stopWatching() { practiceWatch++; }

const MIDDLE = {
  element: "body",
  x: 0.5,
  y: 0.5,
};

const OVER_3D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.75,
  y: 0.15,
};

const OVER_2D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.25,
  y: 0.15,
};

export const steps: Step[] = [
  // ═══════════════════════════════════════
  //  INTRODUCTION
  // ═══════════════════════════════════════

  // 1 — Welcome
  {
    title: "Cut & Merge",
    text: `
AI reconstructions of neurons are impressive — but they're not perfect. Sometimes the AI fuses two separate neurons into one. Other times, it misses a branch entirely, leaving a neuron incomplete.

**Cut** and **Merge** are the two core tools you'll use to fix these errors and help map the brain accurately.`,
    position: MIDDLE,
    width: "520px",
    // TODO: Amy — set a state showing a clear 3D neuron, maybe one with a visible merge error
    // state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/XXXXXXXXX",
    nextLabel: "Let's learn!",
  },

  // 2 — Why it matters
  {
    text: `
Every correction you make improves the connectome — the wiring diagram of the brain.

**Merge** reconnects branches that the AI missed. **Cut** separates neurons the AI incorrectly fused together.

These two operations are the bread and butter of proofreading. Let's start with Merge.`,
    position: MIDDLE,
    width: "480px",
    image: imgSynapsesTutorial,
  },

  // ═══════════════════════════════════════
  //  MERGE
  // ═══════════════════════════════════════

  // 3 — What is merge?
  {
    title: "Merge",
    text: `
A **merge** joins two separate segments that actually belong to the same neuron.

This is needed when the AI fails to connect parts of a cell — for example, a dendrite that should be attached to the soma but was reconstructed as a separate piece.`,
    position: MIDDLE,
    width: "480px",
    // TODO: Amy — add merge illustration image
    // TODO: Amy — state with a neuron that has an obviously disconnected branch nearby
    // state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/XXXXXXXXX",
  },

  // 4 — Merge video
  {
    title: "Merge in Action",
    html: `<iframe style="margin-bottom: -4px;" width='500' height='281'
        src="https://www.youtube.com/embed/48GS9Sizrvw?si=1"
        frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
    position: MIDDLE,
    modal: true,
    width: "540px",
  },

  // 5 — Activating merge
  {
    title: "How to Merge",
    text: `
To start a merge, press the **M** key on your keyboard (make sure the segmentation layer is selected).

You can also activate it from the toolbar at the top of the screen.

Once activated, you'll see the merge tool appear at the bottom of the viewer.`,
    position: MIDDLE,
    width: "450px",
    // TODO: Amy — state with segmentation layer selected, clean view
    // state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/XXXXXXXXX",
    onEnter: closeSidePanel,
  },

  // 6 — Placing merge points
  {
    text: `
With the merge tool active:

1. **Ctrl+Click** on the first segment (the one you're merging *from*).
2. **Ctrl+Click** on the second segment (the one you're merging *into*).

The system will attempt to connect these two segments. You'll see a status message — "trying..." and then "done" if successful.`,
    position: OVER_3D,
    width: "400px",
  },

  // 7 — Merge tips
  {
    title: "Merge Tips",
    text: `
- Click as **close to the junction** as possible — where the two pieces should connect.
- In the **2D view**, you can see the cross-section to find the exact spot where the segments touch.
- If a merge fails, try clicking at a slightly different location.
- Merged the wrong piece? There is no undo key. Fix it with a **cut** between the two pieces, which the Cut section teaches next.`,
    position: OVER_2D,
    width: "400px",
  },

  // 8 — Try it yourself
  {
    title: "Your Turn!",
    text: `
Time to practice! This is a real cell in the sandbox, and it is yours alone until you finish. The AI left a branch disconnected from it.

1. Press **M** to activate the merge tool.
2. **Ctrl+Click** on the main neuron body.
3. **Ctrl+Click** on the disconnected branch.
4. Watch them join together!

Press **next** once the box below says the merge landed (or skip if you'd like to move on).`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(true, 'Waiting for your merge…', 'Merged! The branch is part of the cell now. Press next.');
      await beginPractice();
    },
  },

  // ═══════════════════════════════════════
  //  CUT
  // ═══════════════════════════════════════

  // 9 — What is cut?
  {
    title: "Cut",
    text: `
A **cut** separates a segment into two pieces. This is needed when the AI incorrectly fuses two different neurons into one — a common error, especially in densely packed regions.

If you see a segment with a branch that clearly belongs to a *different* cell, that's a cut waiting to happen.`,
    position: MIDDLE,
    width: "480px",
    // TODO: Amy — add cut illustration image
    // TODO: Amy — state showing a segment with an obvious merge error (two cells fused)
    // state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/XXXXXXXXX",
  },

  // 10 — Cut video
  {
    title: "Cut in Action",
    html: `<iframe style="margin-bottom: -4px;" width='500' height='281'
        src="https://www.youtube.com/embed/DB6wmQWGsck?si=1"
        frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
    position: MIDDLE,
    modal: true,
    width: "540px",
  },

  // 11 — Activating cut
  {
    title: "How to Cut",
    text: `
To start a cut, press the **C** key on your keyboard.

The cut tool uses a **red and blue point** system. You'll **Ctrl+Click** to place points on *each side* of where you want to cut — red on one side, blue on the other.

You can place **multiple points** per color for more precision. The system then finds the best place to separate the segment.`,
    position: MIDDLE,
    width: "460px",
    // TODO: Amy — state with a segment ready for cutting
    // state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/XXXXXXXXX",
    onEnter: closeSidePanel,
  },

  // 12 — Red and blue groups
  {
    title: "Red & Blue Points",
    text: `
When the cut tool is active, you'll see a group indicator at the bottom showing which color you're placing.

Red and blue simply mark the **two sides** of where the cut should happen — one color on each side of the boundary.

**Ctrl+Click** to place a point. Press **G** to switch between red and blue groups.`,
    position: OVER_2D,
    width: "420px",
  },

  // 13 — Where to place points
  {
    title: "Placement Tips",
    text: `
For the best results:

- Place points **near the junction** where you want the cut to happen.
- Use the **2D view** to navigate to the exact cross-section where the two neurons meet.
- You can place **multiple points** per color — more points near the boundary means a cleaner cut.
- The closer your points are to the actual error, the better the result.`,
    position: OVER_2D,
    width: "420px",
  },

  // 14 — Submitting the cut
  {
    text: `
After placing your red and blue points:

- Press **Enter** to submit the cut.
- You'll see a "splitting..." status — wait for it to process (this can take a moment).
- If successful, the segment will split into two separate pieces.
- If the result isn't right, there is no undo key. Rejoin the pieces with a **merge**.`,
    position: OVER_3D,
    width: "400px",
  },

  // 15 — Try it yourself
  {
    title: "Your Turn!",
    text: `
Practice time! Remember the branch you merged on? Now cut it back off, right where you joined it.

1. Press **C** to activate the cut tool.
2. **Ctrl+Click** to place **red points** on the cell side of the join.
3. Press **G** to switch to blue, then **Ctrl+Click** to place **blue points** on the branch side.
4. Press **Enter** to submit the cut.

Press **next** once the box below says the cut landed.`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Waiting for your cut… (if the branch is not merged yet, go back a few steps and merge it first)', 'Cut! The branch is separate again. Press next.');
      await beginPractice();
    },
  },

  // ═══════════════════════════════════════
  //  WRAP-UP
  // ═══════════════════════════════════════

  // 16 — Quick reference
  {
    title: "Quick Reference",
    text: `
Here's your cheat sheet:

| Action | Key |
|--------|-----|
| **Merge** | M |
| **Cut** | C |
| **Place point** | Ctrl+Click |
| **Switch red/blue** | G |
| **Submit cut** | Enter |
| **Fix a bad merge** | Cut it apart |
| **Fix a bad cut** | Merge it back |

You can also find video guides in the **☰ menu** at the top right.`,
    position: MIDDLE,
    width: "400px",
    onEnter: () => {
      stopWatching();
      // Whatever state the practice cell is in, put it back for the next person.
      endPractice();
    },
  },

  // 17 — You're ready
  {
    title: "You're Ready!",
    text: `
You now know the two most important proofreading operations in connectomics. Every merge reconnects a lost branch. Every cut untangles confused neurons.

The brain is vast and full of mysteries — and every correction you make brings us closer to understanding it.

Happy proofreading!`,
    position: MIDDLE,
    width: "480px",
    image: imgBravoNurro,
  },
];
