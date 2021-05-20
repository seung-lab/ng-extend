interface NextToElementPostition {
  element: string;
  side: 'top'|'left'|'bottom'|'right';
  offset?: {x: number, y: number};
}

export function isNextToElementPostition(
    position: NextToElementPostition|
    InsideElementPostition): position is NextToElementPostition {
  return (position as NextToElementPostition).side !== undefined;
}

interface InsideElementPostition {
  element: string;
  x: number;
  y: number;
}

export interface Step {
  title?: string;
  text?: string;
  html?: string;
  position: NextToElementPostition|InsideElementPostition;
  modal?: boolean;
  noborder?: boolean;
  state?: string;
  video?: string;
  image?: string;
  preloading?: boolean;
  videoCache?: HTMLVideoElement;
}

const MIDDLE = {
  element: `body`,
  x: 0.5,
  y: 0.5,
};

const OVER_2D = {
  element: `.neuroglancer-layer-group-viewer > div:nth-child(2)`,
  x: 0.25,
  y: 0.15,
};

const OVER_3D = {
  element: `.neuroglancer-layer-group-viewer > div:nth-child(2)`,
  x: 0.75,
  y: 0.15,
};

export const steps: Step[] = [
  {
    image: 'images/tutorial/01 action potential side sterling.gif',
    text:
        `1. Neuroscience needs your help to trace all the wiring of a brain! The brain is composed of neurons, branched cells that pass electrical and chemical signals to each other (and support cells called glia). Mapping neuronal circuits can help us understand how the brain works. `,
    position: MIDDLE,
    state: 'https://globalv1.flywire-daf.com/nglstate/5993558939009024'
  },
  {
    image: 'images/tutorial/02 Human Brain.png',
    text:
        `2. However, a human brain has over 100 billion neurons, making it much too large to map with current technology.`,
    position: MIDDLE,
    state: 'https://globalv1.flywire-daf.com/nglstate/5993558939009024'
  },
  {
    image: 'images/tutorial/03 Fly Brain.png',
    text:
        `3. Instead, we’re tackling a brain with about 100,000 neurons: a fruit fly!`,
    position: MIDDLE,
    state: 'https://globalv1.flywire-daf.com/nglstate/5993558939009024'
  },
  {
    image: 'images/tutorial/04 Slicing and Imaging.png',
    text:
        `4. First, the brain is sliced into layers, each of which is imaged under a microscope.`,
    position: MIDDLE,
    state: 'https://globalv1.flywire-daf.com/nglstate/5993558939009024'
  },
  {
    image: 'images/tutorial/05 Stacked Slices with Moving Neurons.png',
    text:
        `5. These are stacked to create a digital representation of the brain, which allows us to follow neurons from slice to slice in cross section. This fly brain may not be much bigger than a grain of table salt, but it shares some surprising similarities to ours…`,
    position: MIDDLE,
    state: 'https://globalv1.flywire-daf.com/nglstate/5993558939009024'
  },
  {
    image: 'images/tutorial/06 Circuits.png',
    text:
        `6. … with circuits that let the fly see, smell, hear, taste, feel pain, develop addictions, make decisions, remember things, and even try
      to impress the opposite sex with dance moves.Mapping the whole fly brain
              would be a big milestone in science,
          that could teach us fundamental principles about how our own brains
              work.`,
    position: MIDDLE,
    state: 'https://globalv1.flywire-daf.com/nglstate/5993558939009024'
  },
  {
    image: 'images/tutorial/07 Crowdsourcing.png',
    text:
        `7. But we need your help to crowdsource this effort! FlyWire brings together gamers, scientists and powerful artificial intelligence to try
      to find neurons in a whole fly brain.`,
    position: MIDDLE,
    state: 'https://globalv1.flywire-daf.com/nglstate/5993558939009024'
  },
  {
    text: ` 8. Here’s the dataset we’ll use,
          a fly brain cut into about 7000 slices.You’re looking at slice #4000,
          viewed from the front of the fly.`,
    state: `https://globalv1.flywire-daf.com/nglstate/5430608985587712`,
    position: {
      element: `.neuroglancer-position-widget-input-container`,
      side: `bottom`,
      offset: {x: 60, y: 0}
    },
  },
  {
    image: 'images/tutorial/09 Brain Silhouette.png',
    text:
        `9. Each slice is imaged in thousands of tiles under the tiny window of an electron microscope. The whole brain is stitched together from 21 million images! Images can sometimes take a moment to load. (Sometimes it helps to reload your browser window.)`,
    position: MIDDLE,
  },
  {
    text:
        `10. Try zooming in and out. CTRL + SCROLL to zoom. (Different devices’ trackpads or mice have different ways of scrolling - try Googling yours if you’re not sure.)`,
    position: OVER_3D,
  },
  {
    text:
        `11. In this zoomed-in view, you see a cross section through the brain’s densely packed cells. The thick dark lines are the outer membranes that surround each cell.`,
    position: OVER_3D,
    state: `https://globalv1.flywire-daf.com/nglstate/5447721745907712`
  },
  {
    text:
        `12. Membranes can also be found inside cells, surrounding structures like the nucleus (where DNA is found),`,
    position: OVER_3D,
    state: `https://globalv1.flywire-daf.com/nglstate/6573621652750336`
  },

  {
    image: 'images/tutorial/13 mitochondria screenshot.png',
    text: `13. ... and mitochondria (which produce energy for the cell).`,
    position: OVER_3D,
  },

  {
    text:
        `14. Take a look around! CLICK + DRAG to pan, or RIGHT CLICK to jump to any location.`,
    position: OVER_3D,
  },
  {
    text:
        `15. You don’t need to memorize these commands. Come back to this tab afterwards, but just click here to open the left menu, then select “Cheatsheet” to open a list of basic commands in a separate tab.`,
    position: {element: `.toggleSidebarButton`, side: `right`},
  },
  {
    text:
        `16. In the Seung lab at Princeton University, we used artificial intelligence (AI) on all the images from this fly brain to try
      to find all outer cell membranes and fill in
          possible cells
                  .This process is called “segmentation” since it produces
      segments of cells.`,
    position: OVER_3D,
  },
  {
    text: ` 17. This 2D slice shows cross -
              sections of example cells in
          color.Neurons are 3D objects branched like trees,
          that can span thousands of slices.In this slice,
          the pink neuron happened to have a branch sliced lengthwise,
          the thicker green one was sliced across,
          and the blue one had branches diving in and out of the slice,
          appearing in three places here.`,
    position: OVER_3D,
    state: ` https:  // globalv1.flywire-daf.com/nglstate/6262029425836032`,
  },
  {
    text:
        `18. Use the PERIOD and COMMA keys (or MOUSE SCROLL) to follow the cells from slice to slice, like a flip book. (Data loading may take a moment.) The AI also followed cells from slice to slice, to reconstruct cells’ full 3D structure. `,
    position: OVER_3D,
  },
  {
    text: `19. Click here to show the 3D view of these reconstructed neurons.`,
    state: `https://globalv1.flywire-daf.com/nglstate/6590394842218496`,
    position: {
      element:
          `#neuroglancerViewer > div:nth-child(1) > div:nth-child(1) > div.neuroglancer-layer-group-viewer > div:nth-child(2) > div > div > button:nth-child(2) > div`,
      side: `bottom`,
    },
  },
  {
    text: `20. In the 3D view, CLICK + DRAG to rotate.`,
    position: OVER_3D,
  },
  {
    text: `21. CTRL + SCROLL to zoom.`,
    position: OVER_3D,
  },
  {
    text: `22. RIGHT CLICK any location to center there`,
    position: OVER_3D,
  },
  {
    text: `23. SHIFT + CLICK & DRAG to pan`,
    position: OVER_3D,
  },
  {
    text:
        `24. The AI is pretty advanced, but it’s not perfect. For example, this branch looks like it was accidentally cut off, since it ends sharply. That’s why FlyWire needs human players: you’ll correct the mistakes the AI made, to help reconstruct complete neurons. `,
    position: {
      element:
          `#neuroglancerViewer > div:nth-child(1) > div:nth-child(1) > div.neuroglancer-layer-group-viewer > div:nth-child(2) > div:nth-child(2)`,
      // offset: {x: 1000, y: 500},
      side: `top`,
    },
    // position: OVER_3D,
    state: `https://globalv1.flywire-daf.com/nglstate/5375534351515648`,
  },
  {
    text: `25. You’ll look for missing pieces to add,`,
    /*position: {
      element: `.neuroglancer-layer-group-viewer > div:nth-child(2)`,
      x: 0.75,
      y: 0.6,
      // side: `bottom`,
    },*/
    position: OVER_3D,
    state: `https://globalv1.flywire-daf.com/nglstate/6501434258358272`,
  },
  {
    text:
        `26. ... and incorrect pieces to cut off. If enough players join, we hope to proofread every neuron to achieve a complete wiring diagram of the fly brain.`,
    /*position: {
      element: `.neuroglancer-layer-group-viewer > div:nth-child(2)`,
      x: 0.75,
      y: 0.6,
      // side: `bottom`,
    },*/
    position: OVER_3D,
  },
  {
    text:
        `27. Explore these cells a bit using the navigation commands you’ve learned. Note that they each have only one “cell body”, like a balloon on a string.`,
    position: OVER_3D,
  }
];

// set in-between states
for (const [i, step] of steps.entries()) {
  if (i > 0 && step.state === undefined) {
    step.state = steps[i - 1].state;
  }
}
