interface NextToElementPostition {
  element: string, side: 'top'|'left'|'bottom'|'right',
      offset?: {x: number, y: number},
}

export function isNextToElementPostition(
    position: NextToElementPostition|
    InsideElementPostition): position is NextToElementPostition {
  return (position as NextToElementPostition).side !== undefined;
}

interface InsideElementPostition {
  element: string, x: number, y: number,
}

export interface Step {
  title?: string, text?: string, html?: string,
      position: NextToElementPostition|InsideElementPostition, modal?: boolean,
      noborder?: boolean, state?: string, video?: string,
      videoBeingPreloaded?: boolean, videoCache?: HTMLVideoElement,
}

const MIDDLE = {
  element: `body`,
  x: 0.5,
  y: 0.5,
}

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

export const steps: Step[] =
    [
      {
        text:
            `[zappy neuron gif - Jay] Neuroscience needs your help to trace all the wiring of a brain! The brain is composed of neurons, branched cells that pass electrical and chemical signals to each other. Mapping neuronal circuits can help us understand how the brain works. `,
        position: MIDDLE,
      },
      {
        text:
            `[stylized human brain - Jay] However, a human brain has over 100 billion neurons, making it much too large to map with current technology.`,
        position: MIDDLE,
      },
      {
        text:
            `[stylized fly brain - Jay] Instead, we’re tackling a brain with about 100,000 neurons: a fruit fly!`,
        position: MIDDLE,
      },
      {
        text:
            `[sliced brain, microscope with several slices on conveyor belt - Jay First, the brain is sliced into layers, each of which is imaged under a microscope.`,
        position: MIDDLE,
      },
      {
        text:
            `[slice stack, two slices with color coded neurons moving - Jay] These are stacked to create a digital representation of the brain, which allows us to follow neurons from slice to slice in cross section. This fly brain may not be much bigger than a grain of table salt, but it shares some surprising similarities to ours…`,
        position: MIDDLE,
      },
      {
        text:
            ` … with circuits that let the fly see, smell, hear, taste, feel pain, develop addictions, make decisions, remember things, and even try to impress the opposite sex with dance moves. Mapping the whole fly brain would be a big milestone in science, that could teach us fundamental principles about how our own brains work.`,
        position: MIDDLE,
      },
      {
        text:
            `But we need your help to crowdsource this effort! FlyWire brings together gamers, scientists and powerful artificial intelligence to try to find neurons in a whole fly brain.`,
        position: MIDDLE,
      },
      {
        text:
            `Here’s the dataset we’ll use, a fly brain cut into about 7000 slices [list credits]. You’re looking at slice #4000, viewed from the front of the fly.`,
        state: `https://globalv1.flywire-daf.com/nglstate/5025045457928192`,
        position: {
          element: `.neuroglancer-position-widget-input-container`,
          side: `bottom`
        },
      },
      {
        text:
            `[Pop-up with pic of brain within fly - Jay Each slice is imaged in thousands of tiles under the tiny window of an electron microscope. The whole brain is stitched together from 21 million images! Images can sometimes take a moment to load. (Sometimes it helps to reload your browser window.)`,
        position: MIDDLE,
      },
      {
        text:
            `Try zooming in and out. CTRL + SCROLL to zoom. (Different devices’ trackpads or mice have different ways of scrolling - try Googling yours if you’re not sure.)`,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up with arrow towards a membrane, or a pic of membrane with arrow drawn:] In this zoomed-in view, you see a cross section through the brain’s densely packed cells. The thick dark lines are the outer membranes that surround each cell.`,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up with pic of nucleus:] Membranes can also be found inside cells, surrounding structures like the nucleus (where DNA is found),`,
        position: OVER_3D,
      },

      {
        text:
            `[Pop-up with pic of mitochondrion] ... and mitochondria (which produce energy for the cell).`,
        position: OVER_3D,
      },

      {
        text:
            `[Pop-up:] Take a look around! CLICK + DRAG to pan [Chris:Do we need to consider moving the pop-up too? Could maybe even lock features at certain points, like prevent scrolling while first learning to zoom, etc.], or RIGHT CLICK to jump to any location.`,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up with arrow towards left hamburger menu:] You don’t need to memorize these commands. Come back to this tab afterwards, but just click here to open the left menu, then select “Cheatsheet” to open a list of basic commands in a separate tab.`,
        position: {element: `.toggleSidebarButton`, side: `right`},
      },
      {
        text:
            `[Pop-up with link to region with all segments in color:] In the Seung lab at Princeton University, we used artificial intelligence (AI) on all the images from this fly brain to try to find all outer cell membranes and fill in possible cells. This process is called “segmentation” since it produces segments of cells.`,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up:] This 2D slice shows cross-sections of example cells in color. Neurons are 3D objects branched like trees, that can span thousands of slices. In this slice, the pink neuron happened to have a branch sliced lengthwise, the thicker green one was sliced across, and the blue one had branches diving in and out of the slice, appearing in three places here.`,
        position: OVER_3D,
        state: `https://globalv1.flywire-daf.com/nglstate/6262029425836032`,
      },
      {
        text:
            `[Pop-up:] Use the PERIOD and COMMA keys (or MOUSE SCROLL) to follow the cells from slice to slice, like a flip book. (Data loading may take a moment.) The AI also followed cells from slice to slice, to reconstruct cells’ full 3D structure. `,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up with arrow towards xy-3D layout button:] Click here to show the 3D view of these reconstructed neurons.`,
        position: OVER_3D,
      },
      {
        position: OVER_3D,
        state: `https://globalv1.flywire-daf.com/nglstate/6590394842218496`
      },
      {
        text:
            `[Pop-up with arrow towards 3D view:] In the 3D view, CLICK + DRAG to rotate.`,
        position: OVER_3D,
      },
      {
        text: `[Pop-up with arrow towards 3D view:] CTRL + SCROLL to zoom.`,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up with arrow towards 3D view:] RIGHT CLICK any location to center there`,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up with arrow towards 3D view:] SHIFT + CLICK & DRAG to pan`,
        position: OVER_3D,
      },
      {
        position: OVER_3D,
        state: `https://globalv1.flywire-daf.com/nglstate/5375534351515648`,
      },
      {
        position: OVER_3D,
        state: `https://globalv1.flywire-daf.com/nglstate/6501434258358272`,
      },
      {
        text: `[Pop-up with arrow:] You’ll look for missing pieces to add,`,
        position: OVER_3D,
      },
      {
        text:
            `[Pop-up with arrow. Above arbor, with glia in different color:] ... and incorrect pieces to cut off. If enough players join, we hope to proofread every neuron to achieve a complete wiring diagram of the fly brain.`,
        position: OVER_3D,
      },
      {
        text:
            `Explore these cells a bit using the navigation commands you’ve learned. Note that they each have only one “cell body”, like a balloon on a string.`,
        position: OVER_3D,
      }
    ];

// set in-between states
for (const [i, step] of steps.entries()) {
  if (i > 0 && step.state === undefined) {
    step.state = steps[i - 1].state;
  }
}
