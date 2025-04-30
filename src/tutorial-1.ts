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
  //1.2 -- Note
  {
    text: `
During this tutorial, you may make a mistake, accidentally delete something or become lost. Don't worry, just keep moving. We will restore the workspace within 1 or 2 slides.`,
    image:
      "https://github.com/seung-lab/ng-extend/blob/celia-tutorial/src/images/wheres-nurro.png?raw=true",
    position: MIDDLE,
    width: "400px",
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //1.3 -- Hover states
  {
    text: `
Many elements in the interface have hover states with help text. Try hovering your mouse over some of the buttons or white text areas that you see on screen. The text may take a few seconds to load.

If you get confused in the future, hovering may help!`,
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
      offset: { x: 0, y: 20 },
    },
     state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
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
  //3.1 -- Coordinates part 3
  {
    text: `
You can also adjust the x, y, and z COORDINATES individually. Click into the X coordinate and paste something new, then press ENTER. 

Don't worry if you fly off screen. We'll readjust in the next slide!`,
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

You can CLICK to SHOW/HIDE any layer. 

Pressing the LAYER NUMBER on your keyboard also works. In this case the number is "2." Try both ways!`,
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(3) > div.neuroglancer-layer-item-value-container",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
      state:
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
    //4.1 -- Using layers
  {
    text: `
To SELECT a layer, you must RIGHT-CLICK it.  Try selecting the IMG layer.`,
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(2)",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },

    //5 -- Deleted Layers
  {
    text: `
If you accidentally click the "X" when attempting to select a layer, you can open the layers panel here to recover it!

Try not to accidentally click the 🗑️ icon or the layer will be gone forever 😭.`,
    position: {
      element: "#insertNGTopBar > div > div:nth-child(6)",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  //6 -- Layer Toolbox
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
  //7 -- Layer Toolbox cont.
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
  //8 -- Layer Toolbox Tabs
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
  //9 -- Layer Toolbox Tabs cont.
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
  //10 -- Layer Toolbox Tabs "Render"
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
  //11 -- Add annotation layer
  {
    text: `
Let's try adding an ANNOTATION LAYER.

CLICK the "+" to it.`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div.neuroglancer-icon.neuroglancer-layer-add-button",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
    state: 
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/6312137807888384",
  },
  //12 -- Annotation layer double check
  {
    text: `
Oops, I forgot 🙈! LEFT-CLICK adds a BLANK LAYER. For an ANNOTATION LAYER we need to RIGHT-CLICK. 

That's okay, it's an easy fix! Use the 🗑️ to remove the NEW LAYER and then RIGHT-CLICK the "+" to add an ANNOTATION LAYER.`,
    width: "500px",
    position: {
      element: "#neuroglancer-container > div > div > div:nth-child(2) > div:nth-child(2) > div.neuroglancer-layer-group-viewer > div.neuroglancer-layer-panel > div:nth-child(4)",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  //13 -- Annotation Layer Panel
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
        "middleauth+https://global.daf-apis.com/nglstate/api/v1/5451570511609856",
  },
  //14 -- Add annotation point
  {
    text: `
The most common action in this panel is adding an annotation point. 

Click the "○" button to select the single point annotation. ⚠️You must always choose an annotation type after creating a new annotation layer.`,
    position: {
      element: "#neuroglancer-container > div > div > div.neuroglancer-side-panel-column > div:nth-child(2) > div.neuroglancer-tab-view.neuroglancer-layer-side-panel-tab-view > div.neuroglancer-tab-view-bar",
      side: "left",
      offset: { x: 0, y: 0 },
    },
  },
  //20 -- Add annotation point pt. 2
  {
    text: `CTRL+Click anywhere on the cell to place your annotation points. Try placing a few!`,
    position: OVER_3D,
  },
  //21 -- Learn more about annotations
  {
    text: `
If you'd like to learn more about annotation points, you can <a href="https://www.youtube.com/watch?v=vnAqH91EgNQ&list=PLZlCbXsRJFCw0BLFWKrc49JHKWK1o41Ud&index=6" target="_blank"> watch this video</a> after you finish the tutorial.`,
    position: MIDDLE,
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
Check out the help menu here as well. You can also press "H" on your keyboard.`,
    position: {
      element: "#insertNGTopBar > div > div:nth-child(11)",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
  },
  {
    text: `
The help menu is pre-computed, and some instructions can be a little difficult to understand at first glance. 

The YELLOW TEXT indicates a KEYBOARD or MOUSE COMMAND. The WHITE TEXT indicates the ACTION that will be taken.`,
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
