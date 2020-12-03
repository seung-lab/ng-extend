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
      position: NextToElementPostition|InsideElementPostition, modal?: boolean, noborder?: boolean, state?: string,
      video?: string, videoBeingPreloaded?: boolean,
      videoCache?: HTMLVideoElement,
}

const MIDDLE = {
  element: 'body',
  x: 0.5,
  y: 0.5,
}

const OVER_2D = {
  element: '.neuroglancer-layer-group-viewer > div:nth-child(2)',
  x: 0.25,
  y: 0.15,
};

const OVER_3D = {
  element: '.neuroglancer-layer-group-viewer > div:nth-child(2)',
  x: 0.75,
  y: 0.15,
};

export const steps: Step[] = [
  {
    text: 'Neuroscience needs your help to reverse engineer a brain!',
    position: MIDDLE,
    modal: true,
    noborder: false,
    state: 'https://globalv1.flywire-daf.com/nglstate/6676691388727296',
  },
  {
    text: 'Let’s say you want to figure out how an alien spaceship works after it has crashed to earth. One good approach could be to trace all the wiring of its systems. [Graphic of spaceship, zoom into tangled wires.] Likewise, we could start to reverse engineer a brain if we could trace the circuits formed by its neurons, which you can think of as wires.',
    position: MIDDLE,
  },
  {
    text: '[Movie of activity in neural circuits.] You might have seen cartoon neurons like this before, but in reality we don’t know how most of the brain is wired. Real brains are densely packed with almost no space between neurons. [Skip? The best way to follow neuronal wiring is to slice brain tissue, image it under a high-powered electron microscope, then image another slice and try to follow the cross sections of neurons from slice to slice.] [Advantage of including this here: can use mouse movies.]',
    position: MIDDLE,
  },
  {
    text: 'Here’s the brain of a fruit fly, which is about the biggest brain that science could currently hope to trace all the wiring in. [Zoom from fly pic into brain outline, from front.] A fruit fly’s brain may not be much bigger than a grain of table salt, but it contains about 100,000 neurons, and has some surprising similarities to ours, with circuits that let the fly see, smell, hear, taste, feel pain, make decisions, and even remember things. Mapping the whole fly brain would be a big milestone in science, that could teach us fundamental principles about how our own brains work. But we need your help to crowdsource this effort! FlyWire brings together gamers, scientists and a powerful artificial intelligence to try to find neurons in a whole fly brain.',
    position: MIDDLE,
  },
  {
    text: 'Here’s the dataset we’ll use, a fly brain cut into about 7000 slices [list credits]. You’re looking at slice #4000, viewed from the front of the fly.',
    state: 'https://globalv1.flywire-daf.com/nglstate/5025045457928192',
    position: {element: '.neuroglancer-position-widget-input-container', side: 'bottom'},
  },
  {
    text: 'Try zooming in and out. CTRL + SCROLL to zoom. (Different devices’ trackpads or mice have different ways of scrolling - try Googling yours if you’re not sure.)',
    position: OVER_3D,
  },

  {
    text: '[Pop-up with arrow towards a membrane, or a pic of membrane with arrow drawn:] In this zoomed-in view, you see a cross section through the brain’s densely packed cells. The thick dark lines are the outer membranes that surround each cell.',
    position: OVER_3D,
  },

  {
    text: '[Pop-up with pic of nucleus:] Membranes can also be found inside cells, surrounding structures like the nucleus (where DNA is found),',
    position: OVER_3D,
  },

  {
    text: '[Pop-up with pic of mitochondrion] ... and mitochondria (which produce energy for the cell).',
    position: OVER_3D,
  },

  {
    text: '[Pop-up:] Take a look around! CLICK + DRAG to pan [Chris:Do we need to consider moving the pop-up too? Could maybe even lock features at certain points, like prevent scrolling while first learning to zoom, etc.], or RIGHT CLICK to jump to any location.',
    position: OVER_3D,
  },


  {
    text: '[Pop-up with arrow towards left hamburger menu:] You don’t need to memorize these commands, just click here for a reminder. Then you can open a separate tab with a list of basic commands by selecting “Cheatsheet”.',
    position: {element: '.toggleSidebarButton', side: 'right'},
  },

  {
    text: '[Pop-up with link to region with all segments in color:] The AI tried to find all outer cell membranes, to fill in possible cells. This process is called “segmentation” since it produces segments of cells.',
    position: OVER_3D,
  },

  {
    text: '[Pop-up:] This 2D slice shows cross-sections of example cells in color. Neurons are 3D objects branched like trees, that can span thousands of slices. In this slice, the pink neuron happened to have a branch sliced lengthwise, the thicker green one was sliced across, and the blue one had branches diving in and out of the slice, appearing in three places here.',
    position: OVER_3D,
    state: 'https://globalv1.flywire-daf.com/nglstate/6298169545588736',
  },
];

// set in-between states
for (const [i, step] of steps.entries()) {
  if (i > 0 && step.state === undefined) {
    step.state = steps[i-1].state;
  }
}
