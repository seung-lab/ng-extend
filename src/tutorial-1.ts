import { Step } from "./store-pyr";

const MIDDLE = {
  element: "body",
  x: 0.5,
  y: 0.5,
};

const OVER_2D = {
  element: ".neuroglancer-layer-group-viewer > div:nth-child(2)",
  x: 0.25,
  y: 0.15,
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
      "https://github.com/seung-lab/ng-extend/blob/celia-tutorial/src/images/wheres-nurro.png?raw=true",
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //2 -- Coordinates
  {
    text: `
These COORDINATES show your location in space. Click here to COPY them.`,
    width: "500px",
    position: {
      element: "#insertNGTopBar > div > div.neuroglancer-position-widget > div.neuroglancer-icon",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  //3 -- Coordinates part 2
  {
    text: `
We've jumped you to a new location. 

CTRL+V anywhere on the interface to PASTE in copied coordinates. This will jump us back to the previous location.`,
    width: "500px",
    position: {
      element: "#insertNGTopBar > div > div.neuroglancer-position-widget > div.neuroglancer-icon",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5766780040511488",
  },
  //4 -- Using layers
  {
    text: `
This LAYER has a green border to indicate it is currently selected.

You can RIGHT-CLICK to SELECT any layer.  You can LEFT-CLICK to SHOW/HIDE any layer.`,
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(3) > div.neuroglancer-layer-item-value-container",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
    //4.1 -- Deleted Layers
  {
    text: `
If you accidentally click the "X" when attempting to select a layer, you can open the layers panel here to recover it!

Try not to click the 🗑️ icon or it will be gone forever 😭.`,
    position: {
      element: "#insertNGTopBar > div > div:nth-child(6)",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  //5 -- Layer Toolbox
  {
    text: `
This TOOLBOX corresponds with your current LAYER. 

You can see the name of the selected layer in this green box as well as the layer type.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //6 -- Layer Toolbox cont.
  {
    text: `
This layer type is SEG or "segmentation layer" which shows the 3D model.

Other layer types include IMG which indicates the EM image layer, and ANN for annotation layer.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //6 -- Layer Toolbox Tabs
  {
    text: `
These TABS correspond to your selected layer. 

We are currently in the "Seg." tab which shows the segment ID for our visible cell. `,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //6 -- Layer Toolbox Tabs cont.
  {
    text: `
If we add more cells, their IDs will appear here as well. `,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6222746955546624",
  },
  //7 -- Layer Toolbox Tabs "Render"
  {
    text: `
RENDER is another important tab. Here you can alter the visualization of your cell. 

Try it! We'll restore the default view in the next slide.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-side-panel-titlebar.neuroglancer-layer-side-panel-title",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
  },
  //7 -- Add annotation layer
  {
    text: `
Let's try adding a new layer.

CLICK the "+" to add an ANNOTATION LAYER.`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div.neuroglancer-icon.neuroglancer-layer-add-button",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
  },
  //8 -- Annotation layer double check
  {
    text: `
Oops, I forgot 🙈! LEFT-CLICK adds a NEW LAYER. For an ANNOTATION LAYER we need to RIGHT-CLICK. 

That's okay, it's an easy fix! Use the 🗑️ to remove the NEW LAYER and then RIGHT-CLICK the "+" to add an ANNOTATION LAYER.`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(4)",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  //9 -- Annotation Layer Panel
  {
    text: `
Let's take a look at the Annotation Layer Panel.

The ANNOTATIONS tab is our most important tab here. Select it now.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-tab-view.neuroglancer-layer-side-panel-tab-view > div.neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
  },
  //11 - this tries to get user to bring up split screen - we need to default to split vs 4 panel view. otherwise need to add anoter box to get them to split view - ng link middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288

  {
    text: `Hit SPACE to bring up a split screen view that reveals the electron microscope image data from which these neurons were reconstructed.`,
    position: OVER_3D,
  },
  //11a - point to split screen icon (xy-3d layout)
  {
    text: `Click this button to move from 4 panel view to split screen. You will not ever need the 4 panel view.`,
    position: {
      element:
        "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div:nth-child(2) > div > div:nth-child(1) > div:nth-child(1) > div.neuroglancer-data-panel-layout-controls > button:nth-child(2) > div",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4718500091265024",
  },
  //12 - over 2D - ng view middleauth+https://global.daf-apis.com/nglstate/api/v1/5216018583519232
  {
    text: `This grey stuff is a 2D electron microscope image of the brain. A stack of such images creates a 3D volume. The neuron branch is highlighted in the cross section.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5348370668322816",
  },
  //13 - gif
  {
    text: `Hold your mouse over the black and press COMMA and PERIOD to step through the slices.
    
    Don't worry if you lose the neuron - the Next button in this section resets this view.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5348370668322816",
  },
  //14 - 2D control + scroll gif
  {
    text: `Hold your cursor over 2D and CTRL + Scroll to zoom in and out`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5348370668322816",
  },
  //15 - 2D right click center gif
  {
    text: `Right click to recenter`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5348370668322816",
  },

  //17 - position center of page - ensure location is  middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288
  {
    text: `The big black empty space is an imaging defect, which happens occasionally when you are snapping at the nanoscale. It caused the AI to make a mistake and disconnect a dendrite.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },
  //18 -  middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408
  {
    text: `To fix it, we need to scroll past the defect and find where the branch continues.
    
    This is a tutorial so we dropped a hint. There is an annotation point in the continuation segment. See what happens when you double click it 2D segment. 

Hit next to reveal the answer.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5250067188416512",
  },
  //20 - Nurro swoop! - new NG state with extension added middleauth+https://global.daf-apis.com/nglstate/api/v1/5190220459802624
  {
    text: `Bravo! We found the continuation!`,
    position: MIDDLE,
    image:
      "https://github.com/seung-lab/ng-extend/blob/cj-ca3-tutorial/src/images/bravo-nurro.png?raw=true",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },
  {
    text: "Now you know the basics. In the future, we will learn how to fuse branches together and slice away mergers. Feel free to click around and explore. Check out this menu for guides, tutorials, and more resources.",
    image:
      "https://github.com/seung-lab/ng-extend/blob/cj-ca3-tutorial/src/images/rika-success.png?raw=true",

    position: {
      element: "#hamburger > button",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  {
    text: "Take the **Self-guided training** when you are ready to learn more! At the end of the training you can take a test to gain access to the Production dataset. Email us support@eyewire.ai with any questions. Thanks for being a part of the neuroscience community! For Science!",
    position: MIDDLE,
    image:
      "https://github.com/seung-lab/ng-extend/blob/cj-ca3-tutorial/src/images/ng-tutorial-final-image.png?raw=true",
  },
];
