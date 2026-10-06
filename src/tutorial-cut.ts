import { Step } from "./store-pyr";
import imgBravoNurro from './images/bravo-nurro.png';
// Amy's sandbox cell 648518346350730372 before and after she cut a fused
// axon off it (2026-09-26). Web-sized JPEGs; originals in her images.
import imgCutBefore from './images/cut-before.jpg';
import imgCutAfter from './images/cut-after.jpg';
// Amy's cut with the points placed (2026-09-26): red along the axon, blue on the dendrite.
import imgCutPoints from './images/cut-points-example.jpg';
// The second cut's cell, fused and after the cut (Ames, 2026-10-06).
import imgCut2Before from './images/cut2-before.jpg';
import imgCut2After from './images/cut2-after.jpg';
import { beginPractice, endPractice, ensureTool, hasCutPreview, holdsSlot } from './practice';
import { useTutorialStore } from './store-pyr';
import { BLACK_BOX_NOTE, CHEAT_SHEET_URL, practiceStatus, MIDDLE, OVER_2D, OVER_3D, beforeAfter, celebrateStep, closeSidePanel, finishPracticeTutorial, getViewer, showWhereToCut, movingToSandbox, stopWatching, watchPractice, watchTool } from './tutorial-3';

/**
 * The Cut track is staged (Ames, 2026-10-05): the same two cells in the same
 * order for everyone, a 3D cut first, then a 2D one. When a named cell is
 * not free the claim falls back to another, and with no second cell the 2D
 * step is skipped.
 */
const CUT_FIRST = '02c5adcc-23c8-4003-83cd-cd9df7a65ce0';  // Fusion on a proofread cell (3D)
const CUT_SECOND = '0813e168-d4e6-4baa-91b7-c9846b9fc6f4'; // Axon fused to a dendrite (Ames, 2026-10-06), the 2D cut

/** "Sections" on: the 2D slice drawn inside the 3D view, which shows where
 *  the 2D images sit on the cell. */
function showSections() {
  try { const v = getViewer()?.showPerspectiveSliceViews; if (v && !v.value) v.value = true; } catch (e) { /* */ }
}

/** Split view, so the 2D images are on screen for the 2D cut. */
function show2D() {
  try { getViewer()?.layout?.restoreState('xy-3d'); } catch (e) { console.warn('[tutorial] could not open the 2D view:', e); }
}

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
The yellow axon was incorrectly fused by AI to the purple dendrite. A citizen scientist like yourself corrected it by cutting it off.

In a moment you'll get the fused version of this very cell and make the cut yourself. It is yours alone until you finish.`,
    position: OVER_3D,
    width: "480px",
    onEnter: async () => {
      closeSidePanel();
      stopWatching();
      // Claim before loading any shared practice geometry.
      await movingToSandbox('Cut', async () => {
        const first = await beginPractice('cut', 'preview', { prefer: CUT_FIRST });
        // The second cut cell is taken now and shown at "Your Turn" (the
        // Merge tutorial does the same).
        if (first) await beginPractice('cut', 'start', { slot: 'b', show: false, prefer: CUT_SECOND });
        // The staged first cell has a finished cut to show. A stand-in cell
        // (when that one is busy) may never have been cut: say so rather
        // than call a fused cell a finished cut (Ames, 2026-10-05).
        if (first && !hasCutPreview(first)) {
          practiceStatus('This cell has not been cut before, so what you see is the fused version: two neurons as one purple segment. Press next and you will cut it.', true);
        }
      });
    },
  },

  // 3: Activating cut
  {
    title: "How to Cut",
    text: `
Now the same cell as the AI left it: the two are one purple segment. Your job is to separate them.

Press the **C** key to start the cut tool.

Once it's on, the cut bar appears at the bottom of the viewer with the red group active.`,
    position: OVER_3D,
    width: "440px",
    onEnter: async () => {
      closeSidePanel();
      // No "?" yet: the help it opens is about placing points, the next box.
      watchTool('Press C to start the cut tool.', 'Cut mode is on. Press next.');
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

1. **Ctrl+Click** 3 or 4 <strong style="color:#ff5c5c">red</strong> points on the piece that doesn't belong, working back from the join.
2. Press **G** to switch to <strong style="color:#5c8cff">blue</strong>, then **Ctrl+Click** 3 or 4 <strong style="color:#5c8cff">blue</strong> points on the cell, just past the join.
3. Press **Submit cut** on the bar at the bottom, or **Enter**. You'll see "splitting..." for a moment, then the piece comes away as its own segment.

If the result isn't right, there is no undo key: rejoin the pieces with a <strong style="color:#60c060">merge</strong>.

The red and blue gems on the cell show where the points go.`,
    position: OVER_3D,
    width: "460px",
    onEnter: async () => {
      closeSidePanel();
      watchPractice(false, 'Waiting for your cut: red on the piece to remove, G, blue on the cell, Submit cut.', '', { advance: true });
      await beginPractice('cut', 'start');
      // The previous step said "press C"; turn the tool on if they didn't.
      setTimeout(() => ensureTool('multicut'), 400);
      // The first cut starts with the red and blue hint gems showing (Ames,
      // 2026-10-06); the second one leaves them to the "?" button.
      setTimeout(() => { showWhereToCut(); }, 1400);
    },
  },

  // 5: Cut success
  {
    title: "Cut success!",
    text: `
You did it. The piece that didn't belong is its own segment now.

` + BLACK_BOX_NOTE,
    position: OVER_3D,
    width: "420px",
    image: imgBravoNurro,
    onEnter: celebrateStep,
  },

  // 6: Cutting in 2D, then straight to the second cell
  {
    title: "You can also cut in 2D",
    text: `
**Ctrl+Click** places points on the 2D images too, not only on the 3D shape: <strong style="color:#ff5c5c">red</strong> inside one cell's outline, <strong style="color:#5c8cff">blue</strong> inside the other's. It helps when the join is hard to see in 3D.

Scroll through the 2D images to the cross-section where the two cells touch, and place points **near the cut point**.

Keep every point on the one fused segment. Points on a neighbour make the server refuse the cut.

<span class="nge-cut-2d-next">Press next to try it on a new cell, this one:</span>
`
    + beforeAfter(
        imgCut2Before, 'Now: one segment.',
        imgCut2After, 'After your cut: the axon (yellow) is its own segment.'),
    position: OVER_2D,
    width: "440px",
    onEnter: () => {
      closeSidePanel();
      stopWatching();
      // This box is about the 2D images, so put them on screen.
      show2D();
      // Only promise the 2D try when there is a second cell to try it on.
      setTimeout(() => {
        const el = document.querySelector('.nge-cut-2d-next');
        if (el && !holdsSlot('b')) el.textContent = 'A second example to try it on is coming soon.';
      }, 300);
    },
  },

  // 7: The 2D cut, on the second cell
  {
    title: "Your Turn: cut in 2D",
    text: `
A new cell, again with an axon (the thin branch) fused onto a dendrite (the thicker branch with all the little blobs coming out of it). Fun fact: each one of those blobs is the receiving half of a synapse!

Find where they touch and cut them apart, placing the points in the 2D images on the left.

1. Press **C** if the cut tool is off.
2. **Ctrl+Click** 3 or 4 <strong style="color:#ff5c5c">red</strong> points inside the piece that doesn't belong.
3. Press **G**, then **Ctrl+Click** 3 or 4 <strong style="color:#5c8cff">blue</strong> points on the other side of the join.
4. Press **Submit cut** on the bar at the bottom, or **Enter**.

The red and blue dots on the images show where the points go.`,
    position: OVER_3D,
    width: "420px",
    onEnter: async () => {
      closeSidePanel();
      // No second cut cell: never show the first again (it is already cut),
      // go to the wrap up.
      if (!holdsSlot('b')) { useTutorialStore().setTutorialStep(7); return; }
      watchPractice(false, 'Waiting for your cut: red on one side of the join, G, blue on the other, Submit cut.', '', { advance: true });
      // The second cut cell, taken at the start together with the first.
      await beginPractice('cut', 'start', { slot: 'b' });
      setTimeout(() => { show2D(); showSections(); }, 900);
      setTimeout(() => ensureTool('multicut'), 1400);
      // The example points show from the start here too (Ames): in 2D they
      // are dots on the images, which is where this cut is made.
      setTimeout(() => { showWhereToCut(); }, 1900);
    },
  },

  // 8: Done. Kept short (Ames: the box was taller than the screen); the full
  // key list is one click away.
  {
    title: "Cut: done!",
    text: `
<img src="` + imgBravoNurro + `" alt="" style="display:block;width:120px;height:auto;margin:0 auto 10px">

<span class="nge-done-lead">You now know the two most important proofreading operations: every <strong style="color:#60c060">merge</strong> reconnects a lost branch, every <strong style="color:#e06060">cut</strong> untangles confused neurons.</span>

The cells you practised on are put back for the next person. Happy proofreading!

**Coming soon:** a harder Cut tutorial, where you use **Find Path** to track down where two neurons were fused.

<a href="` + CHEAT_SHEET_URL + `" target="_blank" rel="noopener" style="color:#7ecaff">Open the cheat sheet in a new tab ↗</a>`,
    position: MIDDLE,
    width: "460px",
    onEnter: () => {
      stopWatching();
      // Confetti only for cuts actually made.
      if (finishPracticeTutorial('cut')) document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate'));
      endPractice();
    },
  },
];
