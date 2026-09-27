import { Step } from "./store-pyr";
import imgBravoNurro from './images/bravo-nurro.png';
// Amy's sandbox cell 648518346350730372 before and after she cut a fused
// axon off it (2026-09-26). Web-sized JPEGs; originals in her images.
import imgCutBefore from './images/cut-before.jpg';
import imgCutAfter from './images/cut-after.jpg';
import { beginPractice, currentPractice, endPractice, ensureTool } from './practice';
import { useLayersStore } from './store';
import { MIDDLE, OVER_2D, OVER_3D, beforeAfter, cheatSheet, closeSidePanel, stopWatching, watchPractice } from './tutorial-3';

/**
 * Tutorial 5: Cut. Split off the Cut & Merge tutorial on 2026-09-27 (Amy).
 * Practice cells: a `cut` example starts fused; "What is cut" previews the
 * finished cut (the two post-cut roots), "How to Cut" loads the fused root
 * for the learner to separate, and the wrap-up hands the cell back.
 */

// Amy's cut walkthrough, 2026-09-26: a fused axon in the sandbox, the same
// cell before the cut with the error marked, with the red and blue points
// placed, and after a successful split. Shown when no practice cell can be
// claimed; with a cell, the learner's own view stays put.
const STATE_CUT_FUSED  = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5679121900240896';
const STATE_CUT_POINTS = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5745573634244608';
const STATE_CUT_DONE   = 'middleauth+https://global.brain-wire-test.org/nglstate/api/v1/5675806990794752';

async function showStaticIfNoCell(state: string) {
  if (!currentPractice().example) await useLayersStore().loadState(state);
}

export const steps: Step[] = [
  // 1: Welcome
  {
    title: "Cut",
    text: `
Sometimes the AI fuses two separate neurons into one. A <strong style="color:#e06060">cut</strong> separates them again.

If you see a segment with a branch that clearly belongs to a *different* cell, that's a cut waiting to happen. Here is one before and after:
`
    + beforeAfter(
        imgCutBefore, 'Before: a thin axon runs into this dendrite, and the AI made them one segment.',
        imgCutAfter, 'After a cut: the axon (yellow) is its own segment again.'),
    position: MIDDLE,
    width: "640px",
    nextLabel: "Let's learn!",
  },

  // 2: The finished cut, on the learner's own cell
  {
    title: "What a cut fixes",
    text: `
Behind this box is a finished cut: the yellow axon had been fused to the purple dendrite, and someone cut it off.

In a moment you'll get the fused version of this very cell and make the cut yourself. It is yours alone until you finish.`,
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

  // 3: Activating cut
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
      watchPractice(false, 'Press C, then red points on the axon, G, blue points on the dendrite, Submit cut.', 'Cut success! You did it. The two pieces are separate now.');
      await beginPractice('cut', 'start');
    },
  },

  // 4: Red and blue groups
  {
    title: "Red & Blue Points",
    text: `
When the cut tool is active, you'll see a group indicator at the bottom showing which color you're placing.

Red and blue simply mark the **two sides** of where the cut should happen, one color on each side of the boundary.

**Ctrl+Click** to place a point. Press **G** to switch between red and blue groups.`,
    position: OVER_2D,
    width: "420px",
    onEnter: () => {
      closeSidePanel();
      showStaticIfNoCell(STATE_CUT_POINTS);
      // The previous step said "press C"; turn the tool on if they didn't.
      setTimeout(() => ensureTool('multicut'), 400);
    },
  },

  // 5: Where to place points
  {
    title: "Placement Tips",
    text: `
For the best results:

- Place points **near the junction** where you want the cut to happen.
- Use the **2D view** to navigate to the exact cross-section where the two neurons meet.
- You can place **multiple points** per color. More points near the boundary means a cleaner cut.
- Keep every point on this one segment. Points on a neighbour make the server refuse the cut.`,
    position: OVER_2D,
    width: "420px",
  },

  // 6: Submitting the cut
  {
    text: `
After placing your red and blue points:

- Press **Submit cut** on the bar at the bottom, or **Enter**.
- You'll see a "splitting..." status. Wait for it to process (this can take a moment).
- If successful, the segment will split into two separate pieces.
- If the result isn't right, there is no undo key. Rejoin the pieces with a <strong style="color:#60c060">merge</strong>.`,
    position: OVER_3D,
    width: "400px",
    onEnter: () => {
      closeSidePanel();
      showStaticIfNoCell(STATE_CUT_DONE);
    },
  },

  // 7: Try it yourself
  {
    title: "Your Turn!",
    text: `
A thin axon runs into this cell and the AI fused the two. Cut the axon off.

1. Press **C** to activate the cut tool.
2. **Ctrl+Click** 3 or 4 **red points** on the axon, the piece that doesn't belong, working back from the join.
3. Press **G** to switch to blue, then **Ctrl+Click** 3 or 4 **blue points** on the cell, just past the join.
4. Press **Submit cut** on the bar at the bottom, or **Enter**.

Press **next** once the box below says the cut landed.`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Waiting for your cut…', 'Cut success! You did it. The two pieces are separate now.');
      await beginPractice('cut', 'start');
      setTimeout(() => ensureTool('multicut'), 400);
    },
  },

  // 8: Done
  {
    title: "Cut: done!",
    text: `
You now know the two most important proofreading operations in connectomics. Every merge reconnects a lost branch. Every cut untangles confused neurons.

The cell you practised on is put back for the next person. Happy proofreading!
` + cheatSheet([
      ['<strong style="color:#e06060">Cut</strong> tool', 'C'],
      ['<strong style="color:#60c060">Merge</strong> tool', 'M'],
      ['Place a point', 'Ctrl+Click'],
      ['Switch red and blue', 'G'],
      ['Submit', 'Enter'],
      ['Fix a bad cut', 'Merge it back'],
      ['Fix a bad merge', 'Cut it apart'],
    ]),
    position: MIDDLE,
    width: "480px",
    image: imgBravoNurro,
    onEnter: () => {
      stopWatching();
      endPractice();
    },
  },
];
