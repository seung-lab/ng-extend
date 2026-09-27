import { Step } from "./store-pyr";
import imgSynapsesTutorial from './images/synapses-tutorial.jpg';
import imgBravoNurro from './images/bravo-nurro.png';
// Amy's sandbox cell 648518346350730372 before and after she cut a fused
// axon off it (2026-09-26). Web-sized JPEGs; originals in her images.
import imgCutBefore from './images/cut-before.jpg';
import imgCutAfter from './images/cut-after.jpg';
// Amy's merge example, 2026-09-26: the cut-in-half branch, cell purple, loose piece yellow.
import imgMergeExample from './images/merge-example.jpg';
import { beginPractice, colorFirstTwoVisible, currentPractice, endPractice, ensureTool, piecesMerged } from './practice';
import { useLayersStore } from './store';

// Amy's cut walkthrough, 2026-09-26: a fused axon in the sandbox, the same
// cell before the cut with the error marked, with the red and blue points
// placed, and after a successful split.
const STATE_CUT_FUSED  = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5679121900240896';
const STATE_CUT_POINTS = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5745573634244608';
const STATE_CUT_DONE   = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5675806990794752';
// Amy's merge example, 2026-09-26: a branch she cut in half in the sandbox
// (648518346350730372 and 648518346351348401). Shown when no practice cell
// can be claimed, so the merge steps always have something to point at.
const STATE_MERGE_EXAMPLE = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5718864172154880';

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
  // Stuck? One click opens the community chat, where people answer.
  let help = chip.querySelector('.nge-practice-help') as HTMLElement | null;
  if (!help) {
    help = document.createElement('button');
    help.className = 'nge-practice-help';
    help.textContent = 'Ask for help in chat';
    help.style.cssText = 'margin:8px 0 0;padding:5px 10px;border-radius:4px;font:inherit;font-size:0.85em;cursor:pointer;'
      + 'background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.4);color:#cde;';
    help.addEventListener('click', () => document.dispatchEvent(new CustomEvent('nge:open-chat')));
    chip.appendChild(help);
  }
  help.style.display = done ? 'none' : '';
}

/** Wait for the chip to render, then keep a status line current while
 *  polling the graph until `wantMerged` matches, or the step changes. */
function watchPractice(wantMerged: boolean, waiting: string, finished: string) {
  const token = ++practiceWatch;
  const tick = async () => {
    if (token !== practiceWatch) return;
    const p = currentPractice();
    if (p.phase === 'unavailable') { practiceStatus('Practice cells need you to be signed in. Read along and press next.'); return; }
    if (p.phase === 'busy') { practiceStatus('No practice cell is free right now. Read along and press next, or come back in a few minutes.'); return; }
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

/** A small (i) in the step text. Hover for the tip, click to flash the
 *  segmentation layer chip at the top of the viewer. Inline onclick works
 *  inside v-html where a Vue handler would not. */
const INFO_LAYER = '<span class="nge-tut-info" role="button" tabindex="0"'
  + ' title="Tools act on the selected layer. Press 2, or right-click the segmentation chip at the top, to select it. Click here to show which chip."'
  + ' onclick="document.dispatchEvent(new CustomEvent(\'nge:tutorial-flash-seg-layer\'))"'
  + ' style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:4px;border-radius:50%;border:1px solid #7ecaff;color:#7ecaff;font-size:12px;font-weight:700;cursor:pointer;vertical-align:middle;line-height:1">i</span>';

document.addEventListener('nge:tutorial-flash-seg-layer', () => {
  const viewer = getViewer();
  const layers: any[] = viewer?.layerManager?.managedLayers ?? [];
  const idx = layers.findIndex(ml => (ml.layer?.constructor?.name ?? '').includes('Segmentation'));
  const chips = document.querySelectorAll('.neuroglancer-layer-panel .neuroglancer-layer-item');
  const chip = chips[idx] as HTMLElement | undefined;
  if (!chip) return;
  const old = chip.style.boxShadow;
  chip.style.transition = 'box-shadow 0.3s';
  let on = false;
  const timer = setInterval(() => { on = !on; chip.style.boxShadow = on ? '0 0 0 3px #7ecaff, 0 0 18px 6px rgba(126,202,255,0.8)' : old; }, 350);
  setTimeout(() => { clearInterval(timer); chip.style.boxShadow = old; }, 3200);
});

/** Two captioned pictures side by side, inline styled because the step
 *  html is rendered outside TutorialStep's scoped CSS. */
function beforeAfter(before: string, beforeCaption: string, after: string, afterCaption: string) {
  const fig = (src: string, cap: string) =>
    `<figure style="margin:0;flex:1 1 0;min-width:0">`
    + `<img src="${src}" alt="${cap}" style="display:block;width:100%;height:auto;border-radius:4px;border:1px solid rgba(74,158,255,0.25)">`
    + `<figcaption style="margin-top:6px;font-size:0.85em;line-height:1.35;color:#9fd0ff">${cap}</figcaption>`
    + `</figure>`;
  return `<div style="display:flex;gap:12px;align-items:flex-start;margin-top:14px">${fig(before, beforeCaption)}${fig(after, afterCaption)}</div>`;
}

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

  // 1: Welcome
  {
    title: "Cut & Merge",
    text: `
AI reconstructions of neurons are impressive, but they're not perfect. Sometimes the AI fuses two separate neurons into one. Other times, it misses a branch entirely, leaving a neuron incomplete.

<strong style="color:#e06060">Cut</strong> and <strong style="color:#60c060">Merge</strong> are the two core tools you'll use to fix these errors and help map the brain accurately.
`
    + beforeAfter(
        imgCutBefore, 'Before: a thin axon runs into this dendrite, and the AI made them one segment.',
        imgCutAfter, 'After a cut: the axon (yellow) is its own segment again.'),
    position: MIDDLE,
    width: "640px",
    nextLabel: "Let's learn!",
  },

  // 2: Why it matters
  {
    text: `
Every correction you make improves the connectome, the wiring diagram of the brain.

<strong style="color:#60c060">Merge</strong> reconnects branches that the AI missed. <strong style="color:#e06060">Cut</strong> separates neurons the AI incorrectly fused together.

These two operations are the bread and butter of proofreading. Let's start with Merge.`,
    position: MIDDLE,
    width: "480px",
    image: imgSynapsesTutorial,
  },

  // ═══════════════════════════════════════
  //  MERGE
  // ═══════════════════════════════════════

  // 3: What is merge?
  {
    title: "Merge",
    text: `
A <strong style="color:#60c060">merge</strong> joins two separate segments that actually belong to the same neuron.

This is needed when the AI fails to connect parts of a cell.

Like this one: the yellow branch belongs to the purple cell, but the AI left it as its own segment. You will fix it in a moment.`,
    position: MIDDLE,
    width: "560px",
    image: imgMergeExample,
  },

  // 5: Activating merge
  {
    title: "How to Merge",
    text: `
Let's jump to an area that needs a merge. The purple cell behind this box has a yellow branch the AI left off it. It is yours to practice on until the end of the merge section.

Press the **M** key to start the merge tool. The segmentation layer has to be selected for that. ` + INFO_LAYER + `

You can also start it from the toolbar at the top of the screen. Once it's on, the merge tool appears at the bottom of the viewer.`,
    position: OVER_3D,
    width: "450px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(true, 'Press M, then Ctrl+click the yellow branch and the purple cell.', 'Merged! The branch is part of the cell now.');
      const ex = await beginPractice('merge_then_cut');
      // No cell free (or not signed in): show Amy's example to look at.
      if (!ex) {
        await useLayersStore().loadState(STATE_MERGE_EXAMPLE);
        colorFirstTwoVisible('pinky_nf_v2');
      }
    },
  },

  // 6: Placing merge points
  {
    text: `
With the merge tool active:

1. **Ctrl+Click** the yellow branch.
2. **Ctrl+Click** the purple cell, close to where the branch should join it.
3. Press **Submit merge** on the bar at the bottom, or press **Enter**.

The server connects the two. You'll see "trying..." and then "done", and the branch turns purple.`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(true, 'Waiting for your merge: Ctrl+click yellow, Ctrl+click purple, Submit merge.', 'Merged! The branch is part of the cell now.');
      await beginPractice('merge_then_cut');
      // The previous step said "press M"; if they pressed next instead,
      // the tool comes on anyway.
      setTimeout(() => ensureTool('merge'), 400);
    },
  },

  // 7: Merge tips
  {
    title: "Merge Tips",
    text: `
- In the **2D view**, you can see the cross-section to find the exact spot where the segments touch.
- If a merge fails, try clicking at a slightly different location.
- Merged the wrong piece? There is no undo key. Fix it with a <strong style="color:#e06060">cut</strong> between the two pieces, which the Cut section teaches next.`,
    position: OVER_2D,
    width: "400px",
  },

  // 8: Try it yourself
  {
    title: "Your Turn!",
    text: `
Time to practice! This is a real cell in the sandbox, and it is yours alone until you finish. The AI left a branch disconnected from it.

1. Press **M** to activate the merge tool.
2. **Ctrl+Click** the yellow branch.
3. **Ctrl+Click** the purple cell next to it.
4. Press **Submit merge** (or Enter) and watch them join!

Press **next** once the box below says the merge landed (or skip if you'd like to move on).`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(true, 'Waiting for your merge: Ctrl+click yellow, Ctrl+click purple, Submit merge.', 'Merged! The branch is part of the cell now. Press next.');
      await beginPractice('merge_then_cut');
      setTimeout(() => ensureTool('merge'), 400);
    },
  },

  // ═══════════════════════════════════════
  //  CUT
  // ═══════════════════════════════════════

  // 9: What is cut?
  {
    title: "Cut",
    text: `
A <strong style="color:#e06060">cut</strong> separates a segment into two pieces. This is needed when the AI incorrectly fuses two different neurons into one, a common error, especially in densely packed regions.

If you see a segment with a branch that clearly belongs to a *different* cell, that's a cut waiting to happen.

Behind this box is a finished cut: the yellow axon had been fused to the purple dendrite, and someone cut it off. In a moment you'll get the fused version and make this cut yourself.`,
    position: OVER_3D,
    width: "480px",
    onEnter: async () => {
      closeSidePanel();
      stopWatching();
      // Claim the cut cell now and show the result first (Amy). Without a
      // cell, her saved view of the same axon before the cut.
      const ex = await beginPractice('cut', 'preview');
      if (!ex) await useLayersStore().loadState(STATE_CUT_FUSED);
    },
  },

  // 11: Activating cut
  {
    title: "How to Cut",
    text: `
Now the same cell as the AI left it: the axon and the dendrite are one purple segment. Your job is to separate them.

To start a cut, press the **C** key on your keyboard.

The cut tool uses a **red and blue point** system. You'll **Ctrl+Click** to place points on *each side* of where you want to cut: red on one side, blue on the other.

You can place **multiple points** per color for more precision. The system then finds the best place to separate the segment.`,
    position: OVER_3D,
    width: "460px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Press C, then red points on the axon, G, blue points on the dendrite, Submit cut.', 'Cut! The two pieces are separate now.');
      await beginPractice('cut', 'start');
    },
  },

  // 12: Red and blue groups
  {
    title: "Red & Blue Points",
    text: `
When the cut tool is active, you'll see a group indicator at the bottom showing which color you're placing.

Red and blue simply mark the **two sides** of where the cut should happen, one color on each side of the boundary.

**Ctrl+Click** to place a point. Press **G** to switch between red and blue groups.

Here the points are already placed: red along the axon, blue on the dendrite it ran into.`,
    position: OVER_2D,
    width: "420px",
    state: STATE_CUT_POINTS,
    onEnter: () => {
      closeSidePanel();
      // The previous step said "press C"; turn the tool on if they didn't.
      setTimeout(() => ensureTool('multicut'), 400);
    },
  },

  // 13: Where to place points
  {
    title: "Placement Tips",
    text: `
For the best results:

- Place points **near the junction** where you want the cut to happen.
- Use the **2D view** to navigate to the exact cross-section where the two neurons meet.
- You can place **multiple points** per color. More points near the boundary means a cleaner cut.
- The closer your points are to the actual error, the better the result.`,
    position: OVER_2D,
    width: "420px",
  },

  // 14: Submitting the cut
  {
    text: `
After placing your red and blue points:

- Press **Submit cut** on the bar at the bottom, or **Enter**.
- You'll see a "splitting..." status. Wait for it to process (this can take a moment).
- If successful, the segment will split into two separate pieces.
- If the result isn't right, there is no undo key. Rejoin the pieces with a <strong style="color:#60c060">merge</strong>.

This is the same cell after the cut: the axon is its own segment now.`,
    position: OVER_3D,
    width: "400px",
    state: STATE_CUT_DONE,
    onEnter: closeSidePanel,
  },

  // 15: Try it yourself
  {
    title: "Your Turn!",
    text: `
Practice time! This cell is yours alone until you finish. A thin axon runs into it and the AI fused the two. Cut the axon off.

1. Press **C** to activate the cut tool.
2. **Ctrl+Click** 3 or 4 **red points** on the axon, the piece that doesn't belong, working back from the join.
3. Press **G** to switch to blue, then **Ctrl+Click** 3 or 4 **blue points** on the cell, just past the join.
4. Keep every point on this one segment. Points on a neighbour make the server refuse the cut.
5. Press **Submit cut** on the bar at the bottom, or **Enter**.

Press **next** once the box below says the cut landed.`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Waiting for your cut…', 'Cut! The two pieces are separate now. Press next.');
      // A cut example of its own. beginPractice hands the merge cell back
      // first (its merge is undone), so the two exercises stay independent.
      await beginPractice('cut');
      setTimeout(() => ensureTool('multicut'), 400);
    },
  },

  // ═══════════════════════════════════════
  //  WRAP-UP
  // ═══════════════════════════════════════

  // 16: Quick reference
  {
    title: "Quick Reference",
    text: `
Here's your cheat sheet:

| Action | Key |
|--------|-----|
| <strong style="color:#60c060">Merge</strong> | M |
| <strong style="color:#e06060">Cut</strong> | C |
| **Place point** | Ctrl+Click |
| **Switch red/blue** | G |
| **Submit cut** | Enter |
| **Fix a bad merge** | Cut it apart |
| **Fix a bad cut** | Merge it back |

You can also find video guides in the **book menu** at the top right.`,
    position: MIDDLE,
    width: "400px",
    onEnter: () => {
      stopWatching();
      // Whatever state the practice cell is in, put it back for the next person.
      endPractice();
    },
  },

  // 17: You're ready
  {
    title: "You're Ready!",
    text: `
You now know the two most important proofreading operations in connectomics. Every merge reconnects a lost branch. Every cut untangles confused neurons.

The brain is vast and full of mysteries, and every correction you make brings us closer to understanding it.

Happy proofreading!`,
    position: MIDDLE,
    width: "480px",
    image: imgBravoNurro,
  },
];
