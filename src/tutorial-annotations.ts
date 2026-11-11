/**
 * Tutorial 15, Annotations (Ames 2026-10-23, player report 220): make an
 * annotation layer, recolor it, move through its points, right click to jump,
 * a second layer and switching back, the other tools and Size, then Find Path.
 * Eleven boxes, kept short on purpose (Ames 2026-11-05: "how short can you make
 * this tutorial?"). Notes and the gem tool are Advanced Interface's;
 * Find Path reuses its step so the two cannot drift apart.
 *
 * Annotations are the player's own, so there is no practice cell and no queue.
 * Every working box moves on by itself once the player has done the thing.
 */
import { Step, useTutorialStore } from "./store-pyr";
import {
  advance, classicLayers, findPathStep, MIDDLE, nextWhenAnnotationLayerAdded,
  OVER_3D, SELECT_CLICK, waitForAction,
} from "./tutorial-2";
import { stopWatching } from "./tutorial-3";
import imgNurroAtHome from './images/nurro-at-home600.png';

export const ANNOTATIONS_TUTORIAL = 15;

const PART = "Annotations";
/** The Sandbox cell Advanced Interface adds its first annotation layer on. */
const START_VIEW = "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384";
/** Advanced Interface's Find Path view, on the soma. */
const FIND_PATH_VIEW = "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816";

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
function watchChecks(setup: () => Record<string, () => boolean>) {
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
        setTimeout(() => { if (here()) advance(); }, 1500);
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
    onEnter() { toolsOff(); nextWhenAnnotationLayerAdded(); },
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
      watchChecks(() => ({ jump: () => used.jumps >= 1, view: () => used.viewJumps >= 1 }));
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
      });
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
      });
    },
  },
  {
    part: PART,
    text: `
Last one: <strong>Find Path</strong> draws the route through a cell between two points, placed with the same CTRL+CLICK.

<strong>Press F</strong>, then <strong>CTRL+CLICK on the soma</strong> and then <strong>on the tip of a branch</strong>, then press <span class="nge-tut-key-big">ENTER</span> (or click <strong>Submit</strong> in the Find Path bar).

We've made the cell see through, so the path stands out. Your marks come along.`,
    width: "500px",
    position: OVER_3D,
    reveals: ['findPath'],
    state: FIND_PATH_VIEW,
    onEnter: findPathStep,
  },
  {
    part: PART,
    text: `
That route is how you find where a merger joins: one point on the soma, one on the odd branch.

That's annotations! Your layers stay in your view, ready for your next cell.`,
    image: imgNurroAtHome,
    position: MIDDLE,
    width: "440px",
  },
];
