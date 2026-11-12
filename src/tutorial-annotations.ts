/**
 * Tutorial 15, Annotations (Ames 2026-10-23, player report 220): make an
 * annotation layer, recolor it, move through its points, right click to jump,
 * a second layer and switching back, the other tools and Size, then Find Path.
 * Twelve boxes, kept short on purpose (Ames 2026-11-05: "how short can you make
 * this tutorial?"). Notes and the gem tool are Advanced Interface's;
 * Find Path reuses its step so the two cannot drift apart.
 *
 * Annotations are the player's own, so there is no practice cell and no queue.
 * Every working box moves on by itself once the player has done the thing.
 */
import { Step, useTutorialStore } from "./store-pyr";
import {
  advance, classicLayers, findPathStep, glowAddButton, nextWhenAnnotationLayerAdded,
  OVER_3D, SELECT_CLICK, waitForAction,
} from "./tutorial-2";
import { startTutorialButton, stopWatching } from "./tutorial-3";
import imgNurroAtHome from "./images/nurro-at-home600.png";
import { supabase } from "./supabase";
import { useProofreadingBackendStore } from "./store";
import { awardSpecialOnce } from "./util/special_award";

export const ANNOTATIONS_TUTORIAL = 15;

/** The Achievement for finishing this tutorial (Ames 2026-11-10: "we need an
 *  achievement for this"). An admin makes it in the Admin Hub with this code
 *  name; its name, words and art are theirs. Until then nothing happens. The
 *  server checks the player's own finish record (tutorial_completions,
 *  tutorial 15) before it lets the award through (functions/index.js). */
export const ANNOTATIONS_ACHIEVEMENT = 'annotations-tutorial';
const FINISHED_HERE = 'nge-annotations-tutorial-finished';
export async function awardAnnotationsAchievement() {
  try { localStorage.setItem(FINISHED_HERE, '1'); } catch { /* no storage */ }
  try {
    const uid = useProofreadingBackendStore().userId;
    if (!uid) return;
    const { data, error } = await supabase.from('tutorial_completions')
      .select('tutorial').eq('user_id', uid).eq('tutorial', ANNOTATIONS_TUTORIAL).limit(1);
    if (error || !data?.length) return;
    await awardSpecialOnce({ slug: ANNOTATIONS_ACHIEVEMENT, reason: 'Finished the Annotations tutorial', earnedBy: 'finished the Annotations tutorial' });
  } catch { /* tried again at the next visit */ }
}
// A finish whose award did not go through (signed out, or before the admin
// made the Achievement) is tried again at the next visit. Only in a browser
// that finished it, so no other player's visit costs a database read.
setTimeout(() => {
  let finished = false;
  try { finished = localStorage.getItem(FINISHED_HERE) === '1'; } catch { /* no storage */ }
  if (finished) void awardAnnotationsAchievement();
}, 9000);

const PART = "Annotations";
/** The Sandbox cell Advanced Interface adds its first annotation layer on. */
const START_VIEW = "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384";
/** Advanced Interface's Find Path view, on the soma. */
/**
 * Find Path on a real merger (Ames 2026-11-10: not the Advanced Interface
 * mission's, "that's repetitive"; and not the two-nucleus cell first picked
 * from the nuclei table, which is a capillary). Ames's pick: Sandbox cell
 * 648518346352484298, two cells joined by one merge in December 2022
 * (operation 983), somas at 117716, 53443, 1867 and 115213, 45018, 1093. The
 * join exists only in pinky_nf_v2 (in pinky_training6 the two are separate),
 * so the view shows the Sandbox; a split of that merge would take the merger
 * away. find_path traces soma to soma through it (checked 2026-11-10).
 */
const MERGER_CELL = '648518346352484298';
const FIND_PATH_VIEW = {
  dimensions: { x: [4e-9, 'm'], y: [4e-9, 'm'], z: [4e-8, 'm'] },
  position: [116464.5, 49230.5, 1480.5],
  crossSectionScale: 13.47,
  projectionOrientation: [-0.026123709976673126, -0.9990066289901733, -0.010010872967541218, -0.03468627110123634],
  projectionScale: 70000,
  layers: [
    {
      type: 'image', source: 'precomputed://https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/pinky/em', tab: 'annotations',
      shader: `#uicontrol float black slider(min=0, max=1, default=0.0)
#uicontrol float white slider(min=0, max=1, default=1.0)
float rescale(float value) {
  return (value - black) / (white - black);
}
void main() {
  float val = toNormalized(getDataValue());
  if (val < black) {
    emitRGB(vec3(0,0,0));
  } else if (val > white) {
    emitRGB(vec3(1.0, 1.0, 1.0));
  } else {
    emitGrayscale(rescale(val));
  }
}
`,
      shaderControls: { black: 0.29 }, name: 'img',
    },
    {
      type: 'segmentation', source: 'graphene://middleauth+https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2', tab: 'segments',
      selectedAlpha: 0.3, segments: [MERGER_CELL], segmentColors: { [MERGER_CELL]: '#2ec0ff' }, name: 'pinky_nf_v2',
    },
  ],
  showAxisLines: false, showSlices: false, selectedLayer: { layer: 'pinky_nf_v2' }, layout: '3d',
};

const viewer = () => (window as any).viewer;
function annotationLayers(): any[] {
  return (viewer()?.layerManager?.managedLayers ?? []).filter((ml: any) => !ml.archived && ml.layer?.type === 'annotation');
}
function annotationsOf(ml: any): any[] {
  try { return ml.layer?.localAnnotations?.toJSON?.() ?? []; } catch { return []; }
}
const allAnnotations = () => annotationLayers().flatMap(annotationsOf);

/** Keeps an annotation layer's panel open: the selected one if it is an
 *  annotation layer (the player may just have switched to it), else the
 *  newest. Advanced Interface's ensureAnnotationLayer always takes the newest,
 *  which undid the switch back made in the box before. */
function openAnnotationPanel() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const open = (addIfNone: boolean) => {
    if (store.activeTutorial !== tutorial || store.getTutorialStep() !== step) return;
    const v = viewer();
    const layers = annotationLayers();
    // Skipped the first box: make the layer it would have made.
    if (!layers.length && addIfNone) (document.querySelector('.neuroglancer-layer-add-button') as HTMLElement | null)?.click();
    if (!v || !layers.length) return;
    const mine = layers.includes(v.selectedLayer.layer) ? v.selectedLayer.layer : layers[layers.length - 1];
    if (v.selectedLayer.layer !== mine) v.selectedLayer.layer = mine;
    if (!v.selectedLayer.visible) v.selectedLayer.visible = true;
  };
  setTimeout(() => open(true), 600);
  setTimeout(() => open(false), 2000);
}

/**
 * Runs `tick` every 400 ms while the player is on this box. A box with a
 * checklist ticks off each `[data-check]` line as its test passes, and moves
 * on once every line is ticked. `setup` runs once the view has settled and
 * returns the tests, so their starting values are read then.
 */
function watchChecks(setup: () => Record<string, () => boolean>, autoNext = true) {
  waitForAction();
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  setTimeout(() => {
    if (!here()) return;
    const checks = setup();
    const done = new Set<string>();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      for (const [key, test] of Object.entries(checks)) {
        if (done.has(key)) continue;
        let ok = false;
        try { ok = test(); } catch { /* the viewer is not ready */ }
        if (!ok) continue;
        done.add(key);
        document.querySelector(`.nge-tut-checklist [data-check="${key}"]`)?.classList.add('nge-tut-done');
      }
      if (done.size === Object.keys(checks).length) {
        clearInterval(timer);
        if (autoNext) { setTimeout(() => { if (here()) advance(); }, 1500); return; }
        // A box with a checklist has more to read: it waits for Next (Ames
        // 2026-11-10: "I didn't have time to finish reading before this one
        // advanced"), as the Advanced Interface mission does.
        (window as any).__ngeStepPending = false;
        const list = document.querySelector('.introductionStepAnchor .nge-tut-checklist');
        if (list && !document.querySelector('.introductionStepAnchor .nge-tut-found')) {
          const p = document.createElement('p');
          p.className = 'nge-tut-found';
          p.textContent = 'Nice! Press Next when you are ready.';
          list.after(p);
        }
      }
    }, 400);
  }, 1200);
}

/** The view's center is on one of the player's points (within about half a
 *  micrometre in this dataset's voxels). */
function viewOnAMark(): boolean {
  let p: number[];
  try { p = [...viewer().navigationState.position.value]; } catch { return false; }
  return allAnnotations().some(a => {
    const q = a?.point ?? a?.pointA;
    return Array.isArray(q) && Math.abs(q[0] - p[0]) < 150 && Math.abs(q[1] - p[1]) < 150 && Math.abs(q[2] - p[2]) < 15;
  });
}

/** Merge or Cut mode left on would take the tutorial's Ctrl+clicks as edit
 *  points, so they go off as it starts (as tutorial-cilia.ts toolsOff). */
function toolsOff() {
  stopWatching();
  const v = viewer();
  try { v?.globalToolBinder?.activeTool_?.cancel?.(); } catch { /* none */ }
  try { v?.toolBinder?.activeTool_?.cancel?.(); } catch { /* none */ }
}

/** Counts the presses of ‹ › and right clicks (or ↗ jumps) on list rows, from
 *  the moment it is called. The panel's own handlers stop the events, so these
 *  listen first, on the way down. */
function countPanelUse() {
  const used = { steps: 0, jumps: 0, viewJumps: 0 };
  const onClick = (e: Event) => {
    const t = e.target as Element | null;
    if (t?.closest?.('.nge-ann-step')) used.steps++;
    if (t?.closest?.('.nge-ann-row-jump')) used.jumps++;
  };
  const onDown = (e: MouseEvent) => {
    if (e.button !== 2) return;
    const t = e.target as Element | null;
    if (t?.closest?.('.neuroglancer-annotation-list-entry')) used.jumps++;
    // A right click in the 2D or 3D view moves there: it counts when the
    // view lands on one of the player's marks.
    else if (t?.closest?.('.neuroglancer-rendered-data-panel')) setTimeout(() => { if (viewOnAMark()) used.viewJumps++; }, 400);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', onDown, true);
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const stop = setInterval(() => {
    if (store.activeTutorial === tutorial && store.getTutorialStep() === step) return;
    clearInterval(stop);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onDown, true);
  }, 500);
  return used;
}

/** The polyline button's own drawing (ui/annotations.ts), so the box shows
 *  the button to look for (Ames 2026-11-10). */
const POLYLINE_ICON = '<span class="nge-tut-inline-icon" aria-label="polyline button"><svg viewBox="0 0 18 18" width="18" height="18" fill="none" aria-hidden="true" style="vertical-align:-3px">'
  + '<path d="M3 14 L7.5 6.5 L11.5 11 L15 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="3" cy="14" r="1.7" fill="currentColor"/><circle cx="7.5" cy="6.5" r="1.4" fill="currentColor"/>'
  + '<circle cx="11.5" cy="11" r="1.4" fill="currentColor"/><circle cx="15" cy="4" r="1.7" fill="currentColor"/></svg></span>';

export const steps: Step[] = [
  {
    part: PART,
    text: `
Annotations are your own marks on a cell: points, lines and shapes. They live in an ANNOTATION LAYER.

<strong>Click the + to add one.</strong>`,
    width: "440px",
    position: { element: ".neuroglancer-layer-add-button", side: "bottom", offset: { x: 0, y: 7 } },
    highlight: true,
    state: START_VIEW,
    onEnter() { toolsOff(); nextWhenAnnotationLayerAdded(); glowAddButton(); },
  },
  // Naming the layer (Ames 2026-11-10: "shouldn't it ask me to rename the
  // layer earlier on?"). Any new name counts.
  {
    part: PART,
    text: `
This is your layer's panel. Give the layer a name of its own.

<strong>Click the ✎ pencil</strong> (or the name itself), type a name such as <strong>Branch ends</strong>, and press Enter.`,
    position: { element: ".nge-ann-panel .neuroglancer-layer-side-panel-title", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      watchChecks(() => {
        const base = new Map(annotationLayers().map(ml => [ml, String(ml.name || '')]));
        return { name: () => annotationLayers().some(ml => base.has(ml) && String(ml.name || '').trim() !== '' && ml.name !== base.get(ml)) };
      });
    },
  },
  {
    part: PART,
    text: `
The Pyr gem tool is already picked.

<strong>CTRL+CLICK three spots on the cell</strong> to drop three gems.`,
    position: OVER_3D,
    onEnter() {
      openAnnotationPanel();
      watchChecks(() => {
        const base = allAnnotations().length;
        return { three: () => allAnnotations().length >= base + 3 };
      });
    },
  },
  {
    part: PART,
    text: `
Make them yours: <strong>click the color pill</strong> at the top of the panel and pick a color.`,
    position: { element: ".nge-ann-panel input.neuroglancer-color-widget", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      watchChecks(() => {
        const colorOf = (ml: any) => String(ml.layer?.annotationDisplayState?.color?.toString?.() ?? '').toLowerCase();
        const base = new Map(annotationLayers().map(ml => [ml, colorOf(ml)]));
        return { color: () => annotationLayers().some(ml => base.has(ml) && colorOf(ml) !== base.get(ml)) };
      });
    },
  },
  {
    part: PART,
    text: `
Fly from gem to gem: <strong>press the ‹ › arrows</strong> beside the count a few times.`,
    position: { element: ".nge-ann-panel .nge-ann-stepper", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      const used = countPanelUse();
      watchChecks(() => ({ step: () => used.steps >= 2 }));
    },
  },
  // Jumping from the list and from the view itself (Ames 2026-11-10: "will
  // it later show me how to jump to annotations from 3D?").
  {
    part: PART,
    text: `
Two ways to jump straight to a gem. Each line ticks itself off:

<ol class="nge-tut-checklist">
<li data-check="jump"><strong>RIGHT-CLICK</strong> a gem's row in the list</li>
<li data-check="view"><strong>RIGHT-CLICK</strong> a gem in the 3D view (the 2D view works too)</li>
</ol>`,
    // Left of the first row, so the rows stay uncovered.
    position: { element: ".nge-ann-panel .neuroglancer-annotation-list-entry", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      const used = countPanelUse();
      watchChecks(() => ({ jump: () => used.jumps >= 1, view: () => used.viewJumps >= 1 }), false);
    },
  },
  {
    part: PART,
    get text() { return `
You can keep as many layers as you like, say one for branch ends and one for mergers.

<ol class="nge-tut-checklist">
<li data-check="add">Click <strong>+</strong> again for a second annotation layer</li>
<li data-check="back"><strong>${SELECT_CLICK()}</strong> the tab of the layer you named, or press ${classicLayers() ? '<strong>SHIFT</strong> and the number on its tab' : 'the <strong>number</strong> on its tab'}, to switch back to it</li>
</ol>

New marks always go into the layer whose panel is open.`; },
    position: { element: ".neuroglancer-layer-add-button", side: "bottom", offset: { x: 0, y: 7 } },
    onEnter() {
      watchChecks(() => {
        const before = new Set(annotationLayers());
        const added = () => annotationLayers().some(ml => !before.has(ml));
        return {
          add: added,
          back: () => added() && before.has(viewer()?.selectedLayer?.layer),
        };
      }, false);
    },
  },
  {
    part: PART,
    text: `
These buttons pick what CTRL+CLICK draws. The top row makes points (Pyr gem, dot, big dot); the bottom row makes shapes (box, line, ellipsoid, polyline).

Try the <strong>polyline</strong> ${POLYLINE_ICON}, the tool Cilia Quests use to trace a cilium: pick it, <strong>CTRL+CLICK three or more spots along a branch</strong>, then press <span class="nge-tut-key-big">ENTER</span> to finish it.`,
    position: { element: ".nge-ann-panel .neuroglancer-annotation-toolbox", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      watchChecks(() => {
        const lines = () => allAnnotations().filter(a => a?.type === 'polyline').length;
        const base = lines();
        return { polyline: () => lines() > base };
      });
    },
  },
  // Size works on points only, so it has a box of its own (Ames 2026-11-10).
  {
    part: PART,
    text: `
Points come in sizes. Each line ticks itself off:

<ol class="nge-tut-checklist">
<li data-check="point">Pick the <strong>dot</strong> or the <strong>big dot</strong> in the top row and CTRL+CLICK once</li>
<li data-check="size">Drag <strong>Size</strong> to make the points bigger or smaller</li>
</ol>`,
    position: { element: ".nge-ann-panel .nge-ann-size-row", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      watchChecks(() => {
        const points = () => allAnnotations().filter(a => a?.type === 'point').length;
        const sizeOf = (ml: any) => ml.layer?.annotationDisplayState?.ngeSize?.value;
        const markerOf = (ml: any) => ml.layer?.annotationDisplayState?.ngeMarker?.value;
        const basePoints = points();
        const baseSize = new Map(annotationLayers().map(ml => [ml, sizeOf(ml)]));
        return {
          point: () => points() > basePoints && annotationLayers().some(ml => markerOf(ml) === 'dot'),
          size: () => annotationLayers().some(ml => baseSize.has(ml) && sizeOf(ml) !== baseSize.get(ml)),
        };
      }, false);
    },
  },
  {
    part: PART,
    text: `
Last one: <strong>Find Path</strong> draws the route through a cell between two points, placed with the same CTRL+CLICK.

This cell has <strong>two somas</strong>, so it is really two cells stuck together: a merger. We've switched Find Path on: <strong>CTRL+CLICK on one soma</strong> and then <strong>on the other</strong>, then press <span class="nge-tut-key-big">ENTER</span> (or click <strong>Submit</strong> in the Find Path bar).

We've made the cell see through, so the path stands out. Your marks come along.`,
    width: "500px",
    position: OVER_3D,
    reveals: ['findPath'],
    state: FIND_PATH_VIEW,
    onEnter: findPathStep,
  },
  // Two boxes after the path (Ames 2026-11-10: "maybe this should be 2
  // boxes, one saying how we can use this to find the origin of a merger").
  {
    part: PART,
    text: `
That's how you find where a merger starts. The route has to cross the merger to get from one soma to the other: <strong>where it passes from one cell into the other is the spot to cut</strong>.

Please leave this cell as it is, so the next player finds the same merger.`,
    // Off to the right, so the path stays in view (Ames 2026-11-10: "this
    // box was blocking the path").
    position: { element: "body", x: 0.84, y: 0.2 },
    width: "380px",
  },
  {
    part: PART,
    text: `
That's annotations! Your layers stay in your view, ready for your next cell.

Next is **Advanced Interface**: working with many cells, finding your way, and the tools for tracking down mergers.

<div style="text-align:center;margin:12px 0 4px">${startTutorialButton(2, 'Start Advanced Interface')}</div>`,
    image: imgNurroAtHome,
    position: { element: "body", x: 0.84, y: 0.4 },
    width: "380px",
  },
];
