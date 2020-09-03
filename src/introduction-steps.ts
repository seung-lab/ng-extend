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
    html: `<iframe style="margin-bottom: -4px;" width='640' height='360'
      src="https://www.youtube-nocookie.com/embed/LH4iovmbv3c?rel=0"
      frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
    position: MIDDLE,
    modal: true,
  },
  {
    text:
        'Welcome to the Sandbox! This is a place to play and get acquainted with fly neurons. Have fun learning and exploring. No real data will be harmed!',
    position: MIDDLE,
  },
  {
    text:
        ' If you get stuck, you can click here to return to the default Sandbox view.',
    position: {element: '.resetDataset', side: 'bottom'}
  },
  {
    text:
        'The 2D view shows one slice of a whole sliced fly brain. Two neurons have been preselected, with their cross sections highlighted in color.',
    position: OVER_2D,
  },
  {
    text:
        'The 3D view shows the same preselected neurons. Here you can see the 2D cross-section intersecting with the 3D model.',
    position: OVER_3D,
  },
  {
    text:
        'You can toggle the 2D plane on and off here for easier navigation. Try it!',
    position: {
      element: '.perspective-panel-show-slice-views',
      side: 'bottom',
    }
  },
  {
    video:
        'https://storage.googleapis.com/flywire-frontend/videos/rotate-3d.mp4',
    position: OVER_3D,
  },
  {
    video: 'https://storage.googleapis.com/flywire-frontend/videos/zoom-3d.mp4',
    position: OVER_3D,
  },
  {
    video: 'https://storage.googleapis.com/flywire-frontend/videos/zoom-2d.mp4',
    position: OVER_2D,
  },
  {
    video:
        'https://storage.googleapis.com/flywire-frontend/videos/center-3d.mp4',
    position: OVER_3D,
  },
  {
    video:
        'https://storage.googleapis.com/flywire-frontend/videos/center-2d.mp4',
    position: OVER_2D,
  },
  {
    video: 'https://storage.googleapis.com/flywire-frontend/videos/pan-2d.mp4',
    position: OVER_2D,
  },
  {
    video: 'https://storage.googleapis.com/flywire-frontend/videos/pan-3d.mp4',
    position: OVER_3D,
  },
  {
    video:
        'https://storage.googleapis.com/flywire-frontend/videos/add-remove.mp4',
    position: OVER_2D,
  },
  {
    html:
        'Check out the <b>Quick Start Guide</b> if you need a refresher. Use the <b>Cheatsheet</b> for additional commands.',
    position: {
      element: '.nge-gs-link:nth-child(2)',
      side: 'right',
      offset: {x: -25, y: 0},
    }
  },
  {
    html:
        'Take the <b>Self-guided training</b> when you are ready to learn more! At the end of the training you can take a test to gain access to the Production dataset.',
    position: {
      element: '.nge-gs-link:nth-child(3)',
      side: 'right',
      offset: {x: -25, y: 0},
    }
  },
  {
    html:
        'Join the <b>Slack Forum</b> to interact with the FlyWire community! You can learn tips and tricks, give suggestions, and meet other FlyWire enthusiasts!',
    position: {
      element: '.nge-gs-link:nth-child(5)',
      side: 'right',
      offset: {x: -25, y: 0},
    }
  },
  {
    html:
        'You finished the tutorial! You can restart the tutorial at any time.',
    position: {
      element: '.nge-gs-link:nth-child(7)',
      side: 'right',
      offset: {x: -25, y: 0},
    }
  },
];
