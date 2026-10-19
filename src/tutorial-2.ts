import { Step, useTutorialStore } from "./store-pyr";
import { drawSearchLine } from "./tutorial_pointer";
import { lantern } from "./util/lantern";
import { setStatedColor } from "./widgets/widget_utils";
import { Uint64 } from "neuroglancer/util/uint64";
import { useUserPreferencesStore } from "./store";

/** How a layer chip is selected and hidden. Since 2026-10-11 a plain click
 *  selects and a right click hides; Classic layer tabs in Settings swaps them
 *  (as tutorial-3.ts selectClick). The steps used to say it the old way round
 *  (Ames 2026-10-18). */
const classicLayers = () => { try { return useUserPreferencesStore().prefs.classicLayerClicks === true; } catch { return false; } };
const SELECT_CLICK = () => (classicLayers() ? 'RIGHT-CLICK' : 'CLICK');
const HIDE_CLICK = () => (classicLayers() ? 'CLICK' : 'RIGHT-CLICK');
/** A copy button for coordinates (TutorialStep.vue onHtmlClick). */
const copyButton = (coords: string) => `<button type="button" class="nge-tut-copy" data-nge-copy="${coords}">📋 Copy ${coords}</button>`;
/** The soma the tutorial starts on (its saved view, read 2026-10-18). */
const SOMA = '75744, 56704, 656';
/** A spot out along one of the cell's branches (inside cell 648518346353084129). */
const COLLAB_SPOT = '77499, 61988, 423';
// 132KB web-sized JPEG; the 18MB source PNG stays out of the bundle.
import imgWheresNurro from './images/wheres-nurro.png';
import imgNurroAtHome from './images/nurro-at-home600.png';
import imgTutorialFinal from './images/ng-tutorial-final-image.png';

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

/** Move on by itself once the view has jumped to `spot` ("x, y, z"). */
function nextWhenAt(spot: string) {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const want = spot.split(',').map(Number);
  const at = () => {
    try {
      const p = (window as any).viewer.navigationState.position.value;
      return Math.abs(p[0] - want[0]) < 30 && Math.abs(p[1] - want[1]) < 30 && Math.abs(p[2] - want[2]) < 3;
    } catch { return false; }
  };
  // Wait for the step's view to load, which may itself sit on the spot.
  setTimeout(() => {
    const already = at();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      if (at() && !already) {
        clearInterval(timer);
        setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1500);
      }
    }, 400);
  }, 2500);
}
/** Step 4 needs an annotation layer: the player's own if they made one,
 *  otherwise the + makes it now (so it gets the Pyr gem tool). */
function ensureAnnotationLayer() {
  setTimeout(() => {
    const viewer = (window as any).viewer;
    const layers = viewer?.layerManager?.managedLayers ?? [];
    const ann = layers.filter((ml: any) => !ml.archived && ml.layer?.type === 'annotation');
    if (ann.length === 0) {
      (document.querySelector('.neuroglancer-layer-add-button') as HTMLElement | null)?.click();
      return;
    }
    // Open its panel if another layer's is showing.
    const mine = ann[ann.length - 1];
    if (viewer.selectedLayer.layer !== mine) { viewer.selectedLayer.layer = mine; viewer.selectedLayer.visible = true; }
  }, 600);
}

const SEG_BOX = '.neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query';
/** Show where to paste: the box glows, and a Find Path style search line runs
 *  from the tutorial box to it every few seconds until the player clicks
 *  into it (Ames 2026-10-18: "bring more attention to where to paste IDs"). */
function pointAtSegBox() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  let box: HTMLElement | null = null;
  const draw = () => {
    box = document.querySelector<HTMLElement>(SEG_BOX);
    const chip = document.querySelector('.introductionStepAnchor .chip');
    if (!box || !chip || document.activeElement === box) return;
    box.classList.add('nge-tour-target');
    const a = chip.getBoundingClientRect(), b = box.getBoundingClientRect();
    drawSearchLine({ x: a.right - 40, y: a.top + 40 }, { x: b.left + 24, y: b.top + b.height / 2 }, 2400);
  };
  setTimeout(draw, 900);
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); box?.classList.remove('nge-tour-target'); return; }
    draw();
  }, 4500);
}

/** Glow the layer side panel button (top bar, far right) for a while. */
function glowPanelButton() {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>('#ngFarRight > .neuroglancer-icon:last-child');
    if (!el) return;
    el.classList.add('nge-tour-target');
    setTimeout(() => el.classList.remove('nge-tour-target'), 20000);
  }, 800);
}
/** The eye from the Segments panel, and a pretend row built from the
 *  panel's own parts (Ames 2026-10-18: "make a fake row with the icons"). */
const EYE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const FAKE_ROW = `<div class="nge-tut-row" aria-hidden="true"><span class="nge-tut-row-eye">${EYE_ICON}</span><span class="nge-tut-row-id">648518346354852928</span><span class="nge-tut-row-gap"></span><span class="nge-tut-row-fly">↗</span><span class="nge-tut-row-tri">▲</span></div>`;

/** Find Path in the tutorial: the cells go see through so the path shows,
 *  a big "Path found!" when it arrives, then on. The cells come back to
 *  full strength once the player is past the next box. */
function findPathStep() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const segLayers = () => ((window as any).viewer?.layerManager?.managedLayers ?? [])
    .filter((ml: any) => ml?.layer?.displayState?.objectAlpha);
  setTimeout(() => { for (const ml of segLayers()) ml.layer.displayState.objectAlpha.value = 0.35; }, 1500);
  const restore = setInterval(() => {
    const s = store.getTutorialStep();
    if (store.activeTutorial === tutorial && (s === step || s === step + 1)) return;
    clearInterval(restore);
    for (const ml of segLayers()) ml.layer.displayState.objectAlpha.value = 1;
  }, 500);
  const onFound = () => {
    if (store.activeTutorial !== tutorial || store.getTutorialStep() !== step) return;
    document.removeEventListener('nge:path-found', onFound);
    const banner = document.createElement('div');
    banner.className = 'nge-tut-banner';
    banner.textContent = 'Path found!';
    document.body.appendChild(banner);
    document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate'));
    setTimeout(() => {
      banner.remove();
      if (store.activeTutorial === tutorial && store.getTutorialStep() === step) document.dispatchEvent(new CustomEvent('nge:tutorial-next'));
    }, 2600);
  };
  document.addEventListener('nge:path-found', onFound);
}

/** Move on once Lantern is lit. */
function nextWhenLanternOn() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const was = lantern.on;
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    if (lantern.on && !was) {
      clearInterval(timer);
      setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1200);
    }
  }, 400);
}

/** The visible segment IDs of the segmentation layer. */
function visibleIds(): Set<string> {
  try {
    for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
      const vs = ml.layer?.displayState?.segmentationGroupState?.value?.visibleSegments;
      if (vs) return new Set([...vs].map((x: any) => x.toString()));
    }
  } catch { /* the viewer is not ready */ }
  return new Set();
}
/** Move on by itself once `count` new cells have joined the view (any cells:
 *  the Sandbox's cells are edited by players, so their IDs change). Stops
 *  when the learner leaves the step. As tutorial-1.ts advanceWhenSegmentAdded. */
function nextWhenCellsAdded(count: number) {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  setTimeout(() => {
    const base = visibleIds();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      const fresh = [...visibleIds()].filter(id => !base.has(id));
      fresh.forEach(colorNewCell);
      const added = fresh.length;
      if (added >= count) {
        clearInterval(timer);
        setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1200);
      }
    }, 400);
  }, 1500);
}
/** Each cell the player adds gets its own color, so a new cell stands
 *  apart from the ones already in view (Ames 2026-10-18). */
const NEW_CELL_COLORS = [0xf5d142, 0x7cffb2, 0xb48cff, 0xff7aa8];
const colored = new Set<string>();
function colorNewCell(id: string) {
  if (colored.has(id)) return;
  try {
    for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
      const map = ml.layer?.displayState?.segmentationColorGroupState?.value?.segmentStatedColors;
      if (!map) continue;
      const rgb = NEW_CELL_COLORS[colored.size % NEW_CELL_COLORS.length];
      // packed as 0xBBGGRR
      const packed = ((rgb >> 16) & 0xff) | (((rgb >> 8) & 0xff) << 8) | ((rgb & 0xff) << 16);
      setStatedColor(map, Uint64.parseString(id), packed);
      colored.add(id);
      return;
    }
  } catch { /* the layer is not ready */ }
}
/** Move on by itself once an annotation layer has been added. */
function nextWhenAnnotationLayerAdded() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const count = () => ((window as any).viewer?.layerManager?.managedLayers ?? [])
    .filter((ml: any) => !ml.archived && (ml.layer?.constructor?.type ?? ml.layer?.type ?? ml.initialSpecification?.type) === 'annotation').length;
  setTimeout(() => {
    const base = count();
    const timer = setInterval(() => {
      if (!here()) { clearInterval(timer); return; }
      if (count() > base) {
        clearInterval(timer);
        document.getElementById('nge-tutorial-highlight')?.remove();
        setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1200);
      }
    }, 400);
  }, 1200);
}
/** Move on by itself once an annotation layer is called "Tutorial". */
function nextWhenRenamedTutorial() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    const named = ((window as any).viewer?.layerManager?.managedLayers ?? [])
      .some((ml: any) => !ml.archived && /^tutorial$/i.test(String(ml.name || '').trim()));
    if (named) {
      clearInterval(timer);
      setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1200);
    }
  }, 400);
}
/** The annotations in layers with these names, counted. */
function annotationsIn(names: RegExp): number {
  let n = 0;
  for (const ml of (window as any).viewer?.layerManager?.managedLayers ?? []) {
    if (ml.archived || !names.test(String(ml.name || ''))) continue;
    try { n += (ml.layer?.localAnnotations?.toJSON?.() ?? []).length; } catch { /* not an annotation layer */ }
  }
  return n;
}
/** Move on once something has been highlighted (src/util/highlight.ts layers). */
function nextWhenHighlighted() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const marked = /^(Checked ✓|Needs a look|Problem)$/;
  const base = annotationsIn(marked);
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    if (annotationsIn(marked) > base) {
      clearInterval(timer);
      setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1500);
    }
  }, 500);
}
/** The memo mission: each line of the checklist ticks itself off, and a point
 *  in the Top Secret layer is the find (Ames 2026-10-18: "detect your action,
 *  and something should happen when you find the missing branch"). */
function watchMission() {
  const store = useTutorialStore();
  const tutorial = store.activeTutorial, step = store.getTutorialStep();
  const here = () => store.activeTutorial === tutorial && store.getTutorialStep() === step;
  const SPOT = [87298, 52545, 998];
  const secret = /top\s*secret/i;
  const checks: Record<string, () => boolean> = {
    spot: () => {
      try {
        const p = (window as any).viewer.navigationState.position.value;
        return Math.abs(p[0] - SPOT[0]) < 2500 && Math.abs(p[1] - SPOT[1]) < 2500 && Math.abs(p[2] - SPOT[2]) < 150;
      } catch { return false; }
    },
    layer: () => ((window as any).viewer?.layerManager?.managedLayers ?? []).some((ml: any) => !ml.archived && secret.test(String(ml.name || ''))),
    layout: () => { try { const l = (window as any).viewer.layout.toJSON(); const name = typeof l === 'string' ? l : l?.type; return name !== '3d' && name !== 'xy' && name !== 'yz' && name !== 'xz'; } catch { return false; } },
    point: () => annotationsIn(secret) > 0,
  };
  const done = new Set<string>();
  const timer = setInterval(() => {
    if (!here()) { clearInterval(timer); return; }
    for (const [key, test] of Object.entries(checks)) {
      if (done.has(key) || !test()) continue;
      done.add(key);
      document.querySelector(`.nge-tut-checklist [data-check="${key}"]`)?.classList.add('nge-tut-done');
    }
    if (done.has('point')) {
      clearInterval(timer);
      // Found it: the celebration, then on.
      document.dispatchEvent(new CustomEvent('nge:tutorial-celebrate'));
      setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 2600);
    }
  }, 500);
}
/** Glow the Render tab's controls worth trying first (Ames 2026-10-18). */
function glowRenderControls() {
  setTimeout(() => {
    const want = /^(Opacity \(on\)|Opacity \(3d\)|Silhouette \(3d\)|Saturation)$/i;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.neuroglancer-layer-side-panel-tab-view label, .neuroglancer-layer-side-panel-tab-view .neuroglancer-layer-control-label'))) {
      const text = (el.textContent || '').trim();
      if (!want.test(text)) continue;
      const row = (el.closest('.neuroglancer-layer-control-container, .neuroglancer-layer-control-row, label') as HTMLElement) || el;
      row.classList.add('nge-tour-target');
      setTimeout(() => row.classList.remove('nge-tour-target'), 25000);
    }
  }, 600);
}

export const steps: Step[] = [
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
You've merged and cut your first cells. Now let's take a deeper dive into the interface, in four short parts: marking what you see, working with cells, finding your way, and putting it together to find where a merger starts.`,
    image:
      imgWheresNurro,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
During this tutorial, you may make a mistake, accidentally delete something or become lost. 

You can step backwards in the tutorial to retry. If you are still lost, just keep going and we will restore the workspace within 1 or 2 slides.`,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
Let's start by marking what we see. Annotations are your notes on the cells: points, lines and boxes you place yourself.

They live in an ANNOTATION LAYER. <strong>CLICK the "+" to add one.</strong>`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div.neuroglancer-icon.neuroglancer-layer-add-button",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
    state:
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
    onEnter() {
      nextWhenAnnotationLayerAdded();
      // Highlight the + button with a pulsing glow so it's easy to find
      let style = document.getElementById('nge-tutorial-highlight');
      if (!style) { style = document.createElement('style'); style.id = 'nge-tutorial-highlight'; document.head.appendChild(style); }
      style.textContent = `
        .neuroglancer-layer-add-button {
          animation: nge-pulse-highlight 1.2s ease-in-out infinite !important;
          border-radius: 4px !important;
          position: relative;
          z-index: 1;
          /* Big enough to read as a plus (Nik took it for an airplane). */
          transform: scale(1.7);
          transform-origin: left center;
          margin-right: 18px !important;
          color: #fff !important;
          border-color: #7ee0ff !important;
          background: rgba(126, 224, 255, 0.22) !important;
        }
        @keyframes nge-pulse-highlight {
          0%, 100% { box-shadow: 0 0 8px 3px rgba(80, 160, 255, 0.7), inset 0 0 4px rgba(80, 160, 255, 0.3); }
          50% { box-shadow: 0 0 18px 6px rgba(80, 160, 255, 1), inset 0 0 8px rgba(80, 160, 255, 0.5); }
        }
      `;
    },
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
This is your new layer's side panel. Let's give the layer a name of its own.

<strong>Click the ✎ pencil next to the layer's name</strong> (or the name itself), type <strong>Tutorial</strong> and press Enter.`,
    position: {
      element: ".neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter() { ensureAnnotationLayer(); nextWhenRenamedTutorial(); },
  },
  {
    part: "Part 1 of 4 · Mark what you see",
    text: `
The Pyr gem tool is already picked. <strong>CTRL+CLICK anywhere on the cell</strong> to drop a gem. Try placing a few!

Each gem is listed in the panel: click one there to add a note to it. Your gems stay with you for the rest of the tutorial. Press Next when you're ready to move on.`,
    position: OVER_3D,
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
This LAYER has a light running around its border: that means it is the one selected.`,
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(2)",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
      state:
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/5077771186339840",
  },
  {
    part: "Part 2 of 4 · Working with cells",
    get text() { return `
<strong>${SELECT_CLICK()}</strong> to select this layer instead.

If it worked, the light moves to its border!`; },
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(3) > div.neuroglancer-layer-item-value-container",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    get text() { return `
<strong>${HIDE_CLICK()}</strong> on the layer to SHOW or HIDE it.

<strong>Pressing the LAYER NUMBER</strong> on your keyboard also works. In this case the number is "2."

Try both ways!`; },
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(3) > div.neuroglancer-layer-item-value-container",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Selecting a layer opens its SIDE PANEL. This one is <strong>3D segmentation</strong>, where the cells live: you'll work here and in the annotation layers you add with <strong>+</strong>.

The glowing button at the right end of the top bar opens and closes the side panel any time.`,
    onEnter: glowPanelButton,
    position: {
      element: ".neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5647622615334912",
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Let's add more cells. The box at the top of the Segments tab takes cell IDs. Copy this one:

${copyButton('648518346354852928')}

<strong>Click the box, then press CTRL+V</strong>. The cell appears in 3D and in the list.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => { nextWhenCellsAdded(1); pointAtSegBox(); },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5647622615334912",
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Good job! You added a second pyramidal neuron. Pyramidal neurons are the main excitatory neurons of the brain, and the cells Pyr is named after!

You can paste several IDs at once, separated by commas:

${copyButton('648518346353636160, 648518346354708544')}

<strong>Paste them into the same box.</strong>`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => { nextWhenCellsAdded(2); pointAtSegBox(); },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
The box also takes coordinates: it adds whichever cell is at that spot. Copy these:

${copyButton('77499, 61988, 423')}

<strong>Paste them into the box too.</strong>`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => { nextWhenCellsAdded(1); pointAtSegBox(); },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
Each cell in view has a row here, like this one:

${FAKE_ROW}

<div class="nge-tut-legend">
<div><span class="nge-tut-key">${EYE_ICON}</span>shows or hides the cell</div>
<div><span class="nge-tut-key nge-tut-key--id">ID</span>the cell's ID</div>
<div><span class="nge-tut-key">↗</span>flies to the cell</div>
<div><span class="nge-tut-key">▲</span>marks it Proofread or gives it a cell type</div>
</div>

Make folders with <strong>+ Folder</strong> to keep cells together.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view .neuroglancer-segment-list-entry",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  {
    part: "Part 2 of 4 · Working with cells",
    text: `
<span style="color: white; background-color: black; font-weight: bold; border: 1px solid white;">Render</span> is another important tab. Here you change how your cells look.

We've lit up a few worth trying: <strong>Opacity (on)</strong> for the cell in the 2D view, <strong>Opacity (3d)</strong> and <strong>Silhouette (3d)</strong> for the 3D view, and <strong>Saturation</strong> for its colors. We've opened the 2D view so you can see both.

Try them! We'll restore the default view in the next slide.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view .neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        //"middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
    "middleauth+https://global.daf-apis.com/nglstate/api/v1/5352335057354752",
    onEnter: glowRenderControls,
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
Many elements in the interface have hover states with help text. Try hovering your mouse over some of the buttons or white text at the top of the screen. The help text may need a few seconds to load.

If you get confused in the future, hovering may help!`,
    image:
      imgNurroAtHome,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
Right now we are centered in the cell's soma. <strong>Press the "A" key</strong> to reveal the axis lines. 

These lines converge at the point we are centered on and represent the volume's x, y, and z dimensions.

<strong>Press "A" again</strong> to remove them. Many of our keyboard commands act as a toggle switch between SHOW and HIDE.`,
    width: "500px",
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
Before we explore, let's save a way back to the cell's soma, where we are now.

This box shows where you are. <strong>Click its copy icon</strong> to COPY our current location.`,
    width: "500px",
    position: { element: "#extensionBar .neuroglancer-position-widget", side: "right", offset: { x: 0, y: 0 } },
    highlight: true,
     state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
One of our collaborators would like us to check out a spot on this cell. Here it is:

${copyButton(COLLAB_SPOT)}

<strong>Copy it, then press CTRL+V anywhere in the viewer to PASTE it</strong>. Pyr jumps straight to that spot. (Not in a text box: there it would just paste the numbers.)`,
    width: "500px",
    position: OVER_3D,
    onEnter: () => nextWhenAt(COLLAB_SPOT),
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 3 of 4 · Find your way",
    text: `
Now let's go back to the soma. Paste the spot you copied from the coordinates box (or copy it again here):

${copyButton(SOMA)}

<strong>Press CTRL+V anywhere in the viewer</strong> to jump back.`,
    width: "500px",
    position: OVER_3D,
    onEnter: () => nextWhenAt(SOMA),
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Now let's put it together. <strong>Find Path</strong> draws the route through a cell between two points.

<strong>Press F</strong> (or the Find Path button on the top bar), then <strong>CTRL+CLICK the soma</strong> and <strong>CTRL+CLICK the end of a branch</strong>, and press <strong>Enter</strong>.

We've made the cell see through, so the path stands out.`,
    width: "500px",
    position: OVER_3D,
    onEnter: findPathStep,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
That's how you find where a merger starts. When a branch looks wrong, put one point on the soma and one on the wrong branch, and Find Path shows exactly where the wrong piece joins the cell. That join is where you cut.

If you are scouting mergers, you can then tag the spot with the glowing <strong>Tag</strong> tool on the top bar, so you or a teammate can find it again.`,
    width: "500px",
    position: { element: '#extensionBar [data-icon-id="tags"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
One more tool for keeping track: <strong>Highlight</strong> marks the parts of a cell you have already checked, so you never look twice.

<strong>Press SHIFT+H</strong> (or the glowing Highlight button on the top bar), pick <strong>Checked</strong>, then <strong>CTRL+CLICK two points along a branch</strong>. The branch between them lights up.`,
    width: "500px",
    position: { element: '#extensionBar [data-icon-id="highlight"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
    onEnter: () => nextWhenHighlighted(),
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
For a big cell, <strong>Lantern</strong> lights the part around where you are and dims the rest, so you can check it one part at a time.

<strong>Press SHIFT+N</strong> (or the glowing lantern on the top bar) to light it.`,
    width: "500px",
    position: { element: '#extensionBar [data-icon-id="lantern"]', side: "bottom", offset: { x: 0, y: 14 } },
    highlight: true,
    onEnter: nextWhenLanternOn,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Move around the cell: the light follows you. In the Lantern box, <strong>Size</strong> sets how much of the cell is lit and <strong>Flame</strong> how bright.

Press <strong>SHIFT+N</strong> again whenever you want the whole cell back.`,
    width: "500px",
    position: OVER_3D,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Oh great, I finally found that very important memo from our collaborators! It was buried in a different pile of papers along with some suspicious looking cat hair and a file called "KITTY WORLD DOMINATION TOP SECRET." I wonder what that could mean 🤔.

Can you help out with this final task? Each line ticks itself off as you do it:

<ol class="nge-tut-checklist">
<li data-check="spot">Go to this location: ${copyButton('87298, 52545, 998')}</li>
<li data-check="layer">Add a new annotation layer and name it <strong>Top Secret Location</strong></li>
<li data-check="layout">Open the 2 panel view (2D + 3D)</li>
<li data-check="point">There is a missing branch here! Scroll through the 2D slices until you find it, then CTRL+CLICK to put a point where the branch should continue</li>
</ol>`,
    position: OVER_3D,
    state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/4777677526401024",
    onEnter: watchMission,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Optional: Add a description and tag to your annotation point. <em>Skip to the next slide if you prefer not to complete this task!</em>

You can <a href="https://www.youtube.com/watch?v=vnAqH91EgNQ&list=PLZlCbXsRJFCw0BLFWKrc49JHKWK1o41Ud&index=6" target="_blank"> watch this video</a> to learn about adding descriptions and tags.`,
    position: OVER_3D,
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
Check out <strong>AI</strong> here! That's Nurro, your guide. Press <strong>Ctrl+K</strong> (<strong>⌘K</strong> on Mac) to quickly search for tools, actions, and help resources, or just ask a question.`,
    position: {
      // Was ".nge-cmd-trigger" — that chip was removed from the toolbar and the
      // palette now lives inside the Ask dock, so anchor to the Ask button.
      element: ".nge-ask-btn",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
  },
  {
    part: "Part 4 of 4 · Put it together",
    text: `
That's the whole interface! Next: put it to work in the <strong>Merger Sandbox</strong>. Seven cells, each with a merger to find and cut.

<button class="nge-hud-btn nge-hud-btn--go" onclick="document.dispatchEvent(new CustomEvent('nge:sandbox-next'))">Start the Merger Sandbox</button>

When you are ready to edit real cells, choose <strong>Ask for Edit Access</strong> in the ☰ menu. <a href="https://connectome.quest/blog/post.html?p=how-to-unlock-edit-access-in-pyr" target="_blank" rel="noopener">How access works ↗</a>

Thanks for being a part of the neuroscience community! 🧠 For Science!`,
    position: MIDDLE,
    image:
      imgTutorialFinal,
  },
];
