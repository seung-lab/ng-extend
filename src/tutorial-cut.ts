import { Step } from "./store-pyr";
import imgBravoNurro from './images/bravo-nurro.png';
// Amy's sandbox cell 648518346350730372 before and after she cut a fused
// axon off it (2026-09-26). Web-sized JPEGs; originals in her images.
import imgCutBefore from './images/cut-before.jpg';
import imgCutAfter from './images/cut-after.jpg';
// Amy's cut with the points placed (2026-09-26): red along the axon, blue on the dendrite.
import imgCutPoints from './images/cut-points-example.jpg';
import { beginPractice, endPractice, ensureTool } from './practice';
import { INFO_LAYER, MIDDLE, OVER_2D, OVER_3D, beforeAfter, cheatSheet, closeSidePanel, movingToSandbox, stopWatching, watchPractice } from './tutorial-3';

/**
 * Tutorial 5: Cut. Split off the Cut & Merge tutorial on 2026-09-27 (Amy).
 * Practice cells: a `cut` example starts fused; "What is cut" previews the
 * finished cut (the two post-cut roots), "How to Cut" loads the fused root
 * for the learner to separate, and the wrap-up hands the cell back.
 */

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
      // Claim before loading any shared practice geometry.
      await movingToSandbox('Cut', () => beginPractice('cut', 'preview'));
    },
  },

  // 3: Activating cut
  {
    title: "How to Cut",
    text: `
Now the same cell as the AI left it: the axon and the dendrite are one purple segment. Your job is to separate them.

Press the **C** key to start the cut tool. The segmentation layer has to be selected for that. ` + INFO_LAYER + `

Once it's on, the cut bar appears at the bottom of the viewer with the red group active.`,
    position: OVER_3D,
    width: "440px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Press C to start the cut tool, then next.', 'Cut success! You did it. The two pieces are separate now.');
      setTimeout(() => document.dispatchEvent(new CustomEvent('nge:tutorial-flash-seg-layer')), 1500);
      await beginPractice('cut', 'start');
    },
  },

  // 4: Placing the points
  {
    title: "Place the points",
    // The example picture is a thumbnail beside the text (Ames, 2026-10-02:
    // full width made the box taller than the screen). Click opens it full size.
    text: `
<a href="` + imgCutPoints + `" target="_blank" rel="noopener" title="Open full size in a new tab" style="float:right;width:150px;margin:2px 0 8px 14px;text-align:center;font-size:0.72em;line-height:1.3;color:#9fd0ff;text-decoration:none"><img src="` + imgCutPoints + `" alt="A good set of cut points" style="display:block;width:150px;height:auto;border-radius:6px;border:1px solid rgba(74,158,255,0.35);margin-bottom:4px">A good set of points. Click to enlarge.</a>

The cut tool uses a <strong style="color:#ff5c5c">red</strong> and <strong style="color:#5c8cff">blue</strong> point system, one colour on each side of where you want to cut.

1. **Ctrl+Click** 3 or 4 <strong style="color:#ff5c5c">red</strong> points on the axon, the piece that doesn't belong, working back from the join.
2. Press **G** to switch to <strong style="color:#5c8cff">blue</strong>, then **Ctrl+Click** 3 or 4 <strong style="color:#5c8cff">blue</strong> points on the cell, just past the join.
3. Press **Submit cut** on the bar at the bottom, or **Enter**. You'll see "splitting..." for a moment, then the axon comes away as its own segment.

If the result isn't right, there is no undo key: rejoin the pieces with a <strong style="color:#60c060">merge</strong>.`,
    position: OVER_3D,
    width: "460px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Waiting for your cut: red on the axon, G, blue on the dendrite, Submit cut.', 'Cut success! You did it. The two pieces are separate now.');
      await beginPractice('cut', 'start');
      // The previous step said "press C"; turn the tool on if they didn't.
      setTimeout(() => ensureTool('multicut'), 400);
    },
  },

  // 5: Red and blue groups
  {
    title: "Red & Blue Points",
    text: `
When the cut tool is active, the bar at the bottom shows which colour you're placing.

<strong style="color:#ff5c5c">red</strong> and <strong style="color:#5c8cff">blue</strong> simply mark the **two sides** of where the cut should happen, one colour on each side of the boundary.

**Ctrl+Click** to place a point. Press **G** to switch between the <strong style="color:#ff5c5c">red</strong> and <strong style="color:#5c8cff">blue</strong> groups.`,
    position: OVER_2D,
    width: "420px",
    onEnter: () => {
      closeSidePanel();
      setTimeout(() => ensureTool('multicut'), 400);
    },
  },

  // 6: Where to place points
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

  // 7: Try it yourself
  {
    title: "Your Turn: another one",
    text: `
One more, on a different cell. Two pieces that belong to different neurons are fused here. Find the join and cut them apart.

1. Press **C** to activate the cut tool.
2. **Ctrl+Click** 3 or 4 <strong style="color:#ff5c5c">red</strong> points on the piece that doesn't belong.
3. Press **G**, then **Ctrl+Click** 3 or 4 <strong style="color:#5c8cff">blue</strong> points on the other side of the join.
4. Press **Submit cut** on the bar at the bottom, or **Enter**.

Press **next** once the box below says the cut landed.`,
    position: OVER_3D,
    width: "400px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Waiting for your cut: red on one side of the join, G, blue on the other, Submit cut.', 'Cut success! You did it again. The two pieces are separate now.');
      // A second cut cell, held alongside the first; both go back at the
      // end. With only one registered, the same cell is shown again.
      await beginPractice('cut', 'start', { slot: 'b' });
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
