/**
 * Tutorial 15, Annotations (Ames 2026-10-23, player report 220): make an
 * annotation layer, recolor it, move through its points, right click to jump,
 * a second layer and switching back, the other tools and Size, then Find Path.
 * Eight boxes, kept short on purpose (Ames 2026-11-05: "how short can you make
 * this tutorial?"). Renaming, notes and the gem tool are Advanced Interface's;
 * Find Path reuses its step so the two cannot drift apart.
 *
 * Annotations are the player's own, so there is no practice cell and no queue.
 * Every working box moves on by itself once the player has done the thing.
 */
import { Step, useTutorialStore } from "./store-pyr";
import {
  advance, findPathStep, MIDDLE, nextWhenAnnotationLayerAdded,
  OVER_3D, SELECT_CLICK, waitForAction,
} from "./tutorial-2";
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

/** Counts the presses of ‹ › and right clicks (or ↗ jumps) on list rows, from
 *  the moment it is called. The panel's own handlers stop the events, so these
 *  listen first, on the way down. */
function countPanelUse() {
  const used = { steps: 0, jumps: 0 };
  const onClick = (e: Event) => {
    const t = e.target as Element | null;
    if (t?.closest?.('.nge-ann-step')) used.steps++;
    if (t?.closest?.('.nge-ann-row-jump')) used.jumps++;
  };
  const onDown = (e: MouseEvent) => {
    if (e.button === 2 && (e.target as Element | null)?.closest?.('.neuroglancer-annotation-list-entry')) used.jumps++;
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
    onEnter: nextWhenAnnotationLayerAdded,
  },
  {
    part: PART,
    text: `
This is your layer's panel, and the Pyr gem tool is already picked.

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
Now get around your gems. Each line ticks itself off:

<ol class="nge-tut-checklist">
<li data-check="step">Fly from gem to gem with the <strong>‹ ›</strong> arrows</li>
<li data-check="jump"><strong>RIGHT-CLICK</strong> a gem's row in the list to jump straight to it</li>
</ol>`,
    // Left of the whole list, so the rows it asks for stay uncovered.
    position: { element: ".nge-ann-panel .nge-ann-list-tools", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      const used = countPanelUse();
      watchChecks(() => ({ step: () => used.steps >= 2, jump: () => used.jumps >= 1 }));
    },
  },
  {
    part: PART,
    get text() { return `
You can keep as many layers as you like, say one for branch ends and one for mergers.

<ol class="nge-tut-checklist">
<li data-check="add">Click <strong>+</strong> again for a second annotation layer</li>
<li data-check="back"><strong>${SELECT_CLICK()}</strong> your first annotation layer's tab to switch back to it</li>
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

<ol class="nge-tut-checklist">
<li data-check="shape">Pick the <strong>line</strong> or the <strong>box</strong>, then CTRL+CLICK twice to draw one</li>
<li data-check="size">Drag <strong>Size</strong> to make the points bigger or smaller</li>
</ol>`,
    position: { element: ".nge-ann-panel .neuroglancer-annotation-toolbox", side: "left", offset: { x: 0, y: 0 } },
    onEnter() {
      openAnnotationPanel();
      watchChecks(() => {
        const shapes = () => allAnnotations().filter(a => a?.type && a.type !== 'point').length;
        const sizeOf = (ml: any) => ml.layer?.annotationDisplayState?.ngeSize?.value;
        const baseShapes = shapes();
        const baseSize = new Map(annotationLayers().map(ml => [ml, sizeOf(ml)]));
        return {
          shape: () => shapes() > baseShapes,
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

<strong>+ Folder</strong> sorts your marks, and a folder's target button sends every new mark into it.

The <strong>Proofreading Test</strong> asks for a point at the end of every branch, in its End layer.`,
    image: imgNurroAtHome,
    position: MIDDLE,
    width: "440px",
  },
];
