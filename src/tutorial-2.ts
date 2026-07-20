import { Step } from "./store-pyr";
import scytheHero from './images/scythe_hero.png';
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

Click here to COPY our current location.`,
    width: "500px",
    position: {
      element: "#insertNGTopBar > div > div.neuroglancer-position-widget > div.neuroglancer-icon",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
     state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
  //6 -- Coordinates pt 2
  {
    text: `
One of our collaborators would like us to check out a precise location on this cell. 

The X coordinate for our new location is 456789. <strong>Click onto this number and type it in</strong>. Press "Enter" to jump to the new location.`,
    width: "500px",
    position: {
      element: "#insertNGTopBar > div > div.neuroglancer-position-widget > div:nth-child(1) > div:nth-child(1) > input",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4781279796002816",
  },
    //7 -- Coordinates pt 3
  {
    text: `
Oh sorry, that wasn't right! That was the amount owed on my cat's latest vet bill 😿. Now we're lost in neuron space!

That's okay, remember that we COPIED the coorinates for the cell's soma. 

<strong>CTRL+V anywhere in the interface to PASTE them</strong> and we'll jump back to the right spot.`,
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
This LAYER has a blue border to indicate it is currently selected.`,
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
    text: `
<strong>RIGHT-CLICK</strong> to select this layer instead.  

If you did it correctly it will have a blue border!`,
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(3) > div.neuroglancer-layer-item-value-container",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
   //10 -- Using layers, select
  {
    text: `
<strong>LEFT-CLICK</strong> on they layer to SHOW or HIDE it. 

<strong>Pressing the LAYER NUMBER</strong> on your keyboard also works. In this case the number is "2." 

Try both ways!`,
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(3) > div.neuroglancer-layer-item-value-container",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  //11 -- Layer Toolbox
  {
    text: `
Look here! This SIDE PANEL opened up when the layer was selected.

You can see the NAME of the selected layer in this <span style="color: #b0d0ff; background: linear-gradient(135deg, rgba(20, 35, 65, 0.95), rgba(15, 25, 50, 0.95)); padding: 2px 8px; border-radius: 3px; border: 1px solid rgba(74, 158, 255, 0.3); font-weight: 600;">BLUE BOX</span> as well as the LAYER TYPE in <span style="color: white; background-color: #1e3a5f; font-weight: bold;">DARK BLUE</span>.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5647622615334912",
  },
  //12 -- Layer Toolbox cont.
  {
    text: `
This layer type is <span style="color: white; background-color: #1e3a5f; font-weight: bold;">seg</span> or "segmentation layer" which shows the 3D model.

Other layer types include IMG which indicates the EM image layer, and ANN for annotation layer.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //13 -- Layer Toolbox Tabs
  {
    text: `
These TABS correspond to your selected layer.

We are currently in the <span style="color: white; background-color: black; font-weight: bold; border: 1px solid white;">Seg.</span> tab which shows the segment ID for our visible cell. `,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-tab-view.neuroglancer-layer-side-panel-tab-view > div.neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //14 -- Layer Toolbox Tabs cont.
  {
    text: `
If we add more cells, their IDs will appear here as well. `,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-tab-view.neuroglancer-layer-side-panel-tab-view > div.neuroglancer-stack-view > div > div:nth-child(4) > div:nth-child(2) > span",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6222746955546624",
  },
  //15 -- Layer Toolbox Tabs "Render"
  {
    text: `
<span style="color: white; background-color: black; font-weight: bold; border: 1px solid white;">Render</span> is another important tab. Here you can alter the visualization of your cell.

We've opened the 2D view so you can see how the render controls affect the 2D as well.

Try it! We'll restore the default view in the next slide.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-tab-view.neuroglancer-layer-side-panel-tab-view > div.neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        //"middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
    "middleauth+https://global.daf-apis.com/nglstate/api/v1/5352335057354752",
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
      // Highlight the + button with a pulsing glow so it's easy to find
      let style = document.getElementById('nge-tutorial-highlight');
      if (!style) { style = document.createElement('style'); style.id = 'nge-tutorial-highlight'; document.head.appendChild(style); }
      style.textContent = `
        .neuroglancer-layer-add-button {
          animation: nge-pulse-highlight 1.2s ease-in-out infinite !important;
          border-radius: 4px !important;
          position: relative;
          z-index: 1;
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
Oops, I forgot 🙈! LEFT-CLICK adds a BLANK LAYER. For an ANNOTATION LAYER we need to RIGHT-CLICK. 

That's okay, it's an easy fix! <strong>Hover on NEW LAYER, and click the "X" to remove it.</strong>`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(4)",
      side: "bottom",
      offset: { x: 0, y: 7 },
    },
  },
   //5 -- Layers menu
  {
    text: `
Our NEW LAYER was removed, but it was not deleted permanently!

You can view all layers by opening <strong>Settings ⚙️</strong> in the toolbar, then clicking <strong>☰ Layer List Panel</strong> at the bottom.

Try it! Open the Layer List Panel, and you'll see the hidden layer. <strong>Click the EYE icon</strong> to reveal it, then <strong>click the 🗑️</strong> to delete it permanently.

⚠️<em>Be careful with the</em> 🗑️ <em>function! Any trashed layers are UNRECOVERABLE.</em>`,
    width: "500px",
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
  },
   //5 -- Share to save
  {
    text: `
It's recommended to hit the SHARE button to save your work at frequent intervals in case you accidentally delete something important! 

⚠️<em>SHARE only copies the link to your clipboard, to save it you must PASTE the link in a location convenient to you.</em>`,
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
    <strong>RIGHT-CLICK the "+" button</strong> to add an ANNOTATION LAYER.
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
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
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
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-tab-view.neuroglancer-layer-side-panel-tab-view > div.neuroglancer-tab-view-bar",
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

⚠️<em>You must always choose an annotation type after creating a new annotation layer.</em>`,
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
          if (ml.layer?.constructor?.name?.includes('Annotation')) {
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
Now you have a basic understanding of the EyeWire II interface! For additional training you can find more resources under the hamburger menu.`,
    position: {
      element: "#hamburger > button",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //23
  {
    text: `
Check out <strong>Ask</strong> here! Press <strong>Ctrl+K</strong> (<strong>⌘K</strong> on Mac) to quickly search for tools, actions, and help resources, or just ask a question.`,
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
    text: `Ready for the next step? Try the **Merge & Split Tutorial** to learn how to fuse branches and cut away errors.

When you're ready, submit a set of **10 annotated test edits** (5 splits and 5 merges) to <a href="mailto:support@eyewire.org" style="color: #7df;">support@eyewire.org</a> to gain access to the Production dataset. Thanks for being a part of the neuroscience community! 🧠 For Science!`,
    position: MIDDLE,
    image:
      imgTutorialFinal,
  },
];
