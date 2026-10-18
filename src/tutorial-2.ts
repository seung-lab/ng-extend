import { Step, useTutorialStore } from "./store-pyr";
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
// 132KB web-sized JPEG; the 18MB source PNG stays out of the bundle.
import scytheHero from './images/scythe_hero_web.jpg';
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

/** Glow on the coordinates box (bottom left) for a while. */
function glowCoordinates() {
  const el = Array.from(document.querySelectorAll('.neuroglancer-position-widget'))
    .find(e => !e.closest('.neuroglancer-layer-item')) as HTMLElement | undefined;
  if (!el) return;
  el.classList.add('nge-tour-target');
  setTimeout(() => el.classList.remove('nge-tour-target'), 20000);
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
      const added = [...visibleIds()].filter(id => !base.has(id)).length;
      if (added >= count) {
        clearInterval(timer);
        setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1200);
      }
    }, 400);
  }, 1500);
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
        setTimeout(() => { if (here()) document.dispatchEvent(new CustomEvent('nge:tutorial-next')); }, 1200);
      }
    }, 400);
  }, 1200);
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
 /*  {
    html: `<iframe style="margin-bottom: -4px;" width='640' height='360'
        src="https://www.youtube.com/embed/tnoIdea7Wmo?si=xiJSTIQyr_Q5XDo3"
        frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
    position: MIDDLE,
    modal: true,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  }, */
  //1 -- introducing interface -- state middleauth+https://global.daf-apis.com/nglstate/api/v1/6173054938906624
  {
    text: `
Now that you've gotten familiar with the basics, let's take a deeper dive into the interface.`,
    image:
      imgWheresNurro,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  //2 -- Making mistakes
  {
    text: `
During this tutorial, you may make a mistake, accidentally delete something or become lost. 

You can step backwards in the tutorial to retry. If you are still lost, just keep going and we will restore the workspace within 1 or 2 slides.`,
    image:
      imgWheresNurro,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  //2 -- Making mistakes
  {
    text: `
The mouse and keyboard commands explained in this tutorial are based on the QWERTY keyboard layout. 

If you are using another country's keyboard layout, you can <a href="https://kbdlayout.info/features/languages" target="blank">use this resource</a> to translate the correct keys for your layout. 

Here's a <a href="https://kbdlayout.info/kbdus" target="blank">quick link to the QWERTY keyboard</a> as well.`,
    image:
      imgWheresNurro,
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  //3 -- Hover states
  {
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
  //4 -- Adding Axis
  {
    text: `
Right now we are centered in the cell's soma. <strong>Press the "A" key</strong> to reveal the axis lines. 

These lines converge at the point we are centered on and represent the volume's x, y, and z dimensions.

<strong>Press "A" again</strong> to remove them. Many of our keyboard commands act as a toggle switch between SHOW and HIDE.`,
    width: "500px",
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  //5 -- Coordinates pt 1
  {
    text: `
Let's explore a bit! But before we do, we'd like to be able to easily return to the soma in case we get lost. 

Click the copy icon in the glowing coordinates box, bottom left, to COPY our current location.`,
    width: "500px",
    position: { element: "body", x: 0.24, y: 0.66 },
    // The coordinates box now sits in the bottom left corner. Anchored to it
    // with side "bottom", this box opened below the screen and the tutorial
    // seemed to quit (Ames, 2026-10-06). It sits just above the corner now,
    // and the coordinates box glows.
    onEnter: glowCoordinates,
     state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  //6 -- Coordinates pt 2
  {
    text: `
One of our collaborators would like us to check out a spot in this dataset. Here it is:

${copyButton('87298, 52545, 998')}

<strong>Copy it, then press CTRL+V anywhere in the viewer to PASTE it</strong>. Pyr jumps straight to that spot. (Not in a text box: there it would just paste the numbers.)`,
    width: "500px",
    position: { element: "body", x: 0.24, y: 0.66 },
    onEnter: glowCoordinates,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
    //7 -- Coordinates pt 3
  {
    text: `
Oh sorry, that wasn't right! That was the amount owed on my cat's latest vet bill 😿. Now we're lost in neuron space!

That's okay: let's go back to the cell's soma. We copied its spot a moment ago, but the new numbers replaced it, so here it is again:

${copyButton(SOMA)}

<strong>Copy it and press CTRL+V anywhere in the viewer</strong> to jump back to the right spot.`,
    width: "500px",
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6180235000152064",
  },
  //8 -- Coordinates pt 4
  {
    text: `
Great! We're back in view of our cell again. 

Let's keep investigating.`,
    width: "500px",
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  //9 -- Using layers, show/hide
  {
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
    //10 -- Using layers, select
  {
    get text() { return `
<strong>${SELECT_CLICK()}</strong> to select this layer instead.

If it worked, the light moves to its border!`; },
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(3) > div.neuroglancer-layer-item-value-container",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
   //10 -- Using layers, select
  {
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
  //11 -- Layer Toolbox
  {
    text: `
Look here! This SIDE PANEL opened when you selected the layer.

Its title is the layer's NAME. You can open and close it any time with the Layer side panel button, at the right end of the top bar.`,
    position: {
      element: ".neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5647622615334912",
  },
  //12 -- Layer Toolbox cont.
  {
    text: `
<strong>3D segmentation</strong> is a SEGMENTATION layer: it holds the cells, shown as shapes in 3D and outlined in the 2D view.

<strong>2D EM</strong> is an IMAGE layer, the electron microscopy pictures themselves, and the layers you add with <strong>+</strong> are ANNOTATION layers, for your own points and notes.`,
    position: {
      element: ".neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //13 -- Layer Toolbox Tabs
  {
    text: `
These TABS correspond to your selected layer.

We are currently in the <span style="color: white; background-color: black; font-weight: bold; border: 1px solid white;">Segments</span> tab which shows the segment ID for our visible cell. `,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view .neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //14 -- Layer Toolbox Tabs cont.
  //16a -- Add a cell by its ID
  {
    text: `
Let's add more cells. The box at the top of the Segments tab takes cell IDs. Copy this one:

${copyButton('648518346354852928')}

<strong>Click the box, then press CTRL+V</strong>. The cell appears in 3D and in the list.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => nextWhenCellsAdded(1),
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5647622615334912",
  },
  //16b -- Add several at once
  {
    text: `
You can paste several IDs at once, separated by commas:

${copyButton('648518346353636160, 648518346354708544')}

<strong>Paste them into the same box.</strong>`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => nextWhenCellsAdded(2),
  },
  //16c -- Add the cell at a spot
  {
    text: `
The box also takes coordinates: it adds whichever cell is at that spot. Copy these:

${copyButton('77499, 61988, 423')}

<strong>Paste them into the box too.</strong>`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view input.neuroglancer-segment-list-query",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => nextWhenCellsAdded(1),
  },
  //16d -- The rows
  {
    text: `
Each cell in view has a row here, with its ID. You can:

- click the eye to show or hide a cell, and the trash can to take it out of view
- click the arrow ↗ to fly to a cell
- click the triangle at the end of the row to mark it Proofread or give it a cell type

Make folders with <strong>+ Folder</strong> to keep cells together.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view .neuroglancer-segment-list-entry",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //15 -- Layer Toolbox Tabs "Render"
  {
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
  //16 -- Add annotation layer
  {
    text: `
Let's try adding an ANNOTATION LAYER.

<strong>CLICK the "+" to add it.</strong>`,
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
  //17 -- Remove new layer
  {
    text: `
That made an ANNOTATION LAYER. (CTRL+CLICK on the "+" makes a BLANK data layer instead, which you will rarely need.)

A layer is just as easy to take away. <strong>Hover on the new layer and click its trash can</strong> to delete it.`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(4)",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
  },
   //5 -- Layers menu
   //5 -- Share to save
  {
    text: `
Pyr saves your view as you go: next time you open it, it offers to take you back where you left off. A cell you claim has its own <strong>Save view</strong> in the Cell Library, and quest work saves itself.

The <strong>SHARE</strong> button is for sending your view to someone: it copies a link to your clipboard, ready to paste in chat or anywhere else.`,
    position: {
      element: "#insertNGTopBar > div > div:nth-child(4) > div",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
  },
  //11 -- Add annotation layer
   {
    text: `
Back to our ANNOTATION LAYER. Do you remember how to add it? Try it! If you forgot, click below to reveal the answer.

<details>
    <summary>Answer</summary>
    <strong>CLICK the "+" button</strong> to add an ANNOTATION LAYER.
</details>`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div.neuroglancer-icon.neuroglancer-layer-add-button",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
    onEnter() {
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
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
  },
  //13 -- Annotation Layer Panel
  {
    text: `
Let's take a look at the Annotation Layer Panel.

Let's give our tab another name. Click into the <span style="color: #b0d0ff; background: linear-gradient(135deg, rgba(20, 35, 65, 0.95), rgba(15, 25, 50, 0.95)); padding: 2px 8px; border-radius: 3px; border: 1px solid rgba(74, 158, 255, 0.3); font-weight: 600;">BLUE BOX</span> here and <strong>DELETE the current text. TYPE IN new text.</strong> Let's call it "Tutorial."`,
    position: {
      element: ".neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/5451570511609856",
  },
    //13 -- Annotation Layer Panel
  {
    text: `
Now it's time to add some annotations! Select the <span style="color: white; background-color: black; font-weight: bold; border: 1px solid white;">Annotations</span> tab to begin.`,
    position: {
      element: ".neuroglancer-layer-side-panel-tab-view .neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/5934606860681216",
  },
  //14 -- Add annotation point
  {
    text: `
Great! Click the "○" button to select the single point annotation.

A new annotation layer starts with the point tool already picked. Use these buttons whenever you want a different kind of annotation.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-tab-view.neuroglancer-layer-side-panel-tab-view > div.neuroglancer-stack-view > div.neuroglancer-tab-content.neuroglancer-annotations-tab > div > div.neuroglancer-annotation-toolbox",
      side: "left",
      offset: { x: -40, y: 2 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5377501518888960",
    onEnter() {
      // Set annotation layer color to golden yellow
      try {
        const viewer = (window as any).viewer;
        for (const ml of viewer?.layerManager?.managedLayers ?? []) {
          if (ml.layer?.type === 'annotation') {   // by the layer's own type: class names are renamed in the production build
            const color = ml.layer.annotationDisplayState?.color;
            if (color) color.restoreState('#ffd700');
            break;
          }
        }
      } catch (_) {}
    },
  },
  //20 -- Add annotation point pt. 2
  {
    text: `CTRL+Click anywhere on the cell to place your annotation points. Try placing a few!`,
    position: OVER_3D,
  },
  //20 -- Putting it all together
  {
    text: `
Oh great, I finally found that very important memo from our collaborators! 
    
It was buried in a different pile of papers along with some suspicious looking cat hair and a file called "KITTY WORLD DOMINATION TOP SECRET." I wonder what that could mean 🤔.
    
Can you help out with this final task? Here's what I need:
<ol>
  <li>Go to this location: 87298, 52545, 998</li>
  <li>Add a new annotation layer. Rename it "Top Secret Location"</li>
  <li>Open the 2 panel view</li>
  <li>There is a missing branch here! scroll until you find it.</li>
  <li>Add an annotation point to show where the branch should continue.</li>
</ol>

Click "next" once you've completed this task!`,
    position: OVER_3D,
    state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/4777677526401024",
  },
  //21 -- Learn more about annotations
  {
    text: `
Optional: Add a description and tag to your annotation point. <em>Skip to the next slide if you prefer not to complete this task!</em>

You can <a href="https://www.youtube.com/watch?v=vnAqH91EgNQ&list=PLZlCbXsRJFCw0BLFWKrc49JHKWK1o41Ud&index=6" target="_blank"> watch this video</a> to learn about adding descriptions and tags.`,
    position: OVER_3D,
  },
  //22
  {
    text: `
Now you have a basic understanding of the Pyr interface! For more practice, the ☰ menu at the top right has the other tutorials, the Merger Sandbox and the Forum.`,
    position: {
      element: "#hamburger > button",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //23
  {
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
    text: `
The help menu is auto-computed, and some instructions can be a little difficult to understand at first glance.

Note that the <span style="color: #7df;">CYAN TEXT</span> indicates a KEYBOARD or MOUSE COMMAND. The <span style="color: #aab;">GRAY TEXT</span> indicates the ACTION that will be taken.`,
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div.neuroglancer-side-panel > div.neuroglancer-side-panel-titlebar",
      side: "right",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/5414723718742016",
  },
  {
    text: "Now you know the basics. In the future, we will learn how to fuse branches together and slice away mergers. Feel free to click around and explore. Check out this menu for guides, tutorials, and more resources.",
    image: scytheHero,
    position: {
      element: "#hamburger > button",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  {
    text: `
Ready for the next step? Try the <strong>Merge</strong> and <strong>Cut</strong> tutorials to learn how to join pieces of a cell and cut away mistakes, then practice in the <strong>Merger Sandbox</strong>.

When you are ready to edit real cells, choose <strong>Ask for Edit Access</strong> in the ☰ menu. Thanks for being a part of the neuroscience community! 🧠 For Science!`,
    position: MIDDLE,
    image:
      imgTutorialFinal,
  },
];
