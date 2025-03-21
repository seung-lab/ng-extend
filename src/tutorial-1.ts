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
  {
    html: `<iframe style="margin-bottom: -4px;" width='640' height='360'
        src="https://www.youtube-nocookie.com/embed/goL_WA3Wjtc?rel=0"
        frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
    position: MIDDLE,
    modal: true,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //1 -- full screen 3D - button option to skip to keyboard commands - state middleauth+https://global.daf-apis.com/nglstate/api/v1/6173054938906624
  {
    text: `The brain is composes of neurons, branched cells that pass signals to each other.
          As our commnunity pieces together these structures, we'll begin to uncover a roadmap to the brain. Join us!`,
    position: OVER_3D,
  },
  //2 + image 2
  {
    text: `To create our dataset, an animal bain was sectioned into thin slices. 
          An image of each slice was taken using an electron microscope.`,
    position: OVER_3D,
  },
  //3
  {
    text: `The images were stacked to create a digital representation of the brain. 
          Imagine the image stack like a 3D printer - once the 2D images are layered on top of each other, a 3D model can emerge.`,
    position: OVER_3D,
  },
  //4 -- button says "how does it work"
  {
    text: `Recent improvements in image processing and AI allow us to quickly create high fidelity 3D reconstructions of neurons in the brain, allowing us to see all the way down to the synaptic connections between neurons. 
          Although the AI's automatic reconstructions are impressive, it's not perfect. That's why we need YOU!
          The flexibility of the human mind and big-picture thinking enables humans to problem solve when the AI gets stuck.`,
    position: OVER_3D,
  },
  //5 -- this is the box that #1 jumps to if user clicks to skip to commands
  {
    text: `Welcome to the Sandbox! This is a place to play and get acquainted with neurons and the software we use to map them.`,
    position: OVER_3D,
  },
  //6 - gif reuse 3D click+ drag
  {
    text: `This is a 3D neuron that has been mapped by AI. 
          CLICK + DRAG to rotate it.`,
    position: OVER_3D,
  },
  //7 - gif reuse 3D CNTRL+SCROLL
  {
    text: `CNTRL+SCROLL to zoom in and out.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //8 - right click - find annotation middleauth+https://global.daf-apis.com/nglstate/api/v1/6175014098305024
  {
    text: `Right click on the neuron to center view at that point. <b>See if you can find a yellow annotation at the end of one of the branches and zoom in on it.
          Don’t worry if you can’t find it - the Next button will take you there.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6175014098305024",
  },
  //9 - new NG state middleauth+https://global.daf-apis.com/nglstate/api/v1/4893758698029056
  {
    text: `There it is! This flat edge reveals a mistake by the AI. It missed a branch! Let’s see if we can find it.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4893758698029056",
  },
  //10
  {
    text: `There are many challenges like this that arise when mapping the brain - that’s why we need YOU. Your human insight is more powerful than an AI.`,
    position: OVER_3D,
  },
  //11 - this tries to get user to bring up split screen - we need to default to split vs 4 panel view. otherwise need to add anoter box to get them to split view - ng link middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288

  {
    text: `Hit SPACE to bring up a split screen view that reveals the electron microscope image data from which these neurons were reconstructed.`,
    position: OVER_3D,
  },
  //11a - point to split screen icon (xy-3d layout)
  {
    text: `Click this button to move from 4 panel view to split screen. You will not ever need the 4 panel view.`,
    position: OVER_3D,
  },
  //12 - over 2D - ng view middleauth+https://global.daf-apis.com/nglstate/api/v1/5216018583519232
  {
    text: `This grey stuff is a 2D electron microscope image of the brain. A stack of such images creates a 3D volume. The neuron branch is highlighted in the cross section.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },
  //13 - gif
  {
    text: `Hold your mouse over the black and press COMMA and PERIOD to step through the slices.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },
  //14 - 2D control + scroll gif
  {
    text: `Hold your cursor over 2D and CTRL + Scroll to zoom`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //15 - 2D right click center gif
  {
    text: `This also works in 3D.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //16 - 2D click and drag to pan gif
  {
    text: `Hold your mouse over 2D to use this command. The control is Shift + Click and drag in 3D.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
  },
  //17 - position center of page - ensure location is  middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288
  {
    text: `The big black empty space is an imaging defect, which happens occasionally when you are snapping at the nanoscale. It caused the AI to make a mistake.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },
  //18 -  middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408
  {
    text: `To fix it, we need to scroll past the defect and find where the branch continues.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },
  //19 -
  {
    text: `Scroll to find the continuation. 
          This is a tutorial so we dropped a hint. There is an annotation point in the continuation segment. See what happens when you double click it 2D segment. 
          Hit next to reveal the answer.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },
  //20 - Nurro swoop! - new NG state with extension added middleauth+https://global.daf-apis.com/nglstate/api/v1/5190220459802624
  {
    text: `Bravo! We found the continuation!
          In the future we'll learn how to fuse these branches together and fix the cell. For now, feel free to click around and explore or hit Next Tutorial for a tour of the interface.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
  },

  {
    video: `https://storage.googleapis.com/flywire-frontend/videos/rotate-3d.mp4`,
    position: OVER_3D,
  },
  {
    html: "Check out the <b>Quick Start Guide</b> if you need a refresher. Use the <b>Cheatsheet</b> for additional commands.",
    position: {
      element: ".nge-gs-link.quickstart",
      side: "right",
      offset: { x: -25, y: 0 },
    },
  },
  {
    html: "Take the <b>Self-guided training</b> when you are ready to learn more! At the end of the training you can take a test to gain access to the Production dataset.",
    position: {
      element: ".nge-gs-link.training",
      side: "right",
      offset: { x: -25, y: 0 },
    },
  },
];
