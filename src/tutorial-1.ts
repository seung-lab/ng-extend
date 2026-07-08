import { Step } from "./store-pyr";
import imgMainBanner from './images/main-banner-vF.jpg';
import imgSegmentation from './images/segmentation-tutorial.jpg';
import imgSynapseWide from './images/synapse-wide.png';
import imgSandboxExplosion from './images/sandbox-explosion.jpg';
import imgInspectorNurro from './images/inspector-nurro-2.png';
import imgNurroSuccessTiny from './images/nurro-success-tutorial-tiny.png';
import imgBravoNurro from './images/bravo-nurro.png';
import imgRikaSuccess from './images/rika-success.png';
import imgTutorialFinal from './images/ng-tutorial-final-image.png';

/* eslint-disable @typescript-eslint/no-explicit-any */
function getViewer(): any {
  return (window as any)['viewer'];
}

/** Set annotation color on all annotation layers */
function setAnnotationColor(color: string) {
  const viewer = getViewer();
  if (!viewer) return;
  const layers = viewer.layerManager && viewer.layerManager.managedLayers;
  if (!layers) return;
  for (const ml of layers) {
    const name = ml.layer && ml.layer.constructor && ml.layer.constructor.name;
    if (name && (name as string).indexOf('Annotation') >= 0) {
      try { ml.layer.annotationColor.value = color; } catch (e) { /* */ }
    }
  }
}

/** Remove a segment from the first segmentation layer */
function removeSegment(segId: string) {
  const viewer = getViewer();
  if (!viewer) return;
  const layers = viewer.layerManager && viewer.layerManager.managedLayers;
  if (!layers) return;
  for (const ml of layers) {
    const layer = ml.layer;
    const name = layer && layer.constructor && layer.constructor.name;
    if (name && (name as string).indexOf('Segmentation') >= 0) {
      const rootSegs = layer.displayState && layer.displayState.rootSegments;
      if (rootSegs) {
        for (const seg of rootSegs) {
          if (seg.toString() === segId) {
            rootSegs.delete(seg);
            return;
          }
        }
      }
    }
  }
}

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
 // {
 //   html: `<iframe style="margin-bottom: -4px;" width='640' height='360'
 //       src="https://www.youtube.com/embed/tnoIdea7Wmo?si=xiJSTIQyr_Q5XDo3"
 //       frameborder="0" allow="autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
 //   position: MIDDLE,
 //   modal: true,
 //   state:
 //     "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
 // },
  //1 -- full screen 3D - button option to skip to keyboard commands - state middleauth+https://global.daf-apis.com/nglstate/api/v1/6173054938906624
  {
    title: `Welcome!`,
    text: `
We’re a community  of researchers, citizen scientists, and engineers from around the world working to map the brain. This tutorial will teach you the basics of navigating the interactive 3D neuron realm.

Together, we're exploring uncharted neural territory and transforming neuroscience. Join us!`,
    image:
      imgMainBanner,
    position: MIDDLE,
    width: "1000px",
    state: 
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4594033348313088",
  },
  //2 + image 2
  {
    text: `
To create a connectomics dataset, we start with a brain. It is sectioned, imaged at nanoscale, and reconstructed in 3D using a mix of human insight and AI.`,
    position: MIDDLE,
    image:
      imgSegmentation,
    width: "500px"
  },
  //4
  {
    text: `
Connectomics allows us to see all the way down to the synaptic connections between neurons.

Although AI reconstructions are impressive, there are still many mistakes. The AI misses huge branches and fuses cells together. That's why we need YOU!

The flexibility and big-picture thinking of the human mind enables humans to solve problems when the AI gets stuck. Ready to get started?`,
    position: MIDDLE,
    image:
      imgSynapseWide,
    width: "500px",
    nextLabel: "Let's go!",
  },
  //5 -- this is the box that #1 jumps to if user clicks to skip to commands
  {
    text: `
Welcome to the Sandbox! This is a place to play and get acquainted with neurons and the software used to map them. The sandbox uses data from the MICrONS project. The cell behind this box is a pyramidal neuron from mouse visual cortex.`,
    position: MIDDLE,
    image:
      imgSandboxExplosion,
    width: "500px",
    state: "middleauth+https://global.daf-apis.com/nglstate/api/v1/5789745012539392",
    nextLabel: "ONWARD!",
  },
  //6 - gif reuse 3D click+ drag
  {
    text: `
This is a 3D neuron that has been mapped by AI. 

CLICK + DRAG to rotate it.

This box won't go away when you click outside it.`,
    position: OVER_3D,
  },
  //7 - gif reuse 3D CNTRL+SCROLL
  {
    text: `CNTRL+SCROLL to zoom in and out.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/4662970274545664",
    onEnter: () => {
      const viewer = getViewer();
      if (!viewer) return;
      // Close side panel so segment list isn't visible
      try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
      // Remove the annotations layer entirely
      setTimeout(() => {
        const layers = viewer.layerManager && viewer.layerManager.managedLayers;
        if (layers) {
          for (let i = layers.length - 1; i >= 0; i--) {
            const n = layers[i].layer && layers[i].layer.constructor && layers[i].layer.constructor.name;
            if (n && (n as string).indexOf('Annotation') >= 0) {
              layers[i].setVisible(false);
              try { viewer.layerManager.removeManagedLayer(layers[i]); } catch (e) { /* */ }
            }
          }
        }
        // Remove extra segments, keep only 648518346353862024
        removeSegment('648518346353084129');
        removeSegment('648518346354708544');
        removeSegment('648518346355322263');
        removeSegment('648518346356789312');
      }, 1500);
    },
  },
  //8a - right click
  {
    text: `Right click on the neuron to center view at any point.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5527767895506944",
    onEnter: () => {
      const viewer = getViewer();
      if (!viewer) return;
      // Turn on axis lines (keyboard shortcut A)
      viewer.showAxisLines.value = true;
      // Close the side panel / deselect layer to remove annotation tab
      try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
      try { viewer.selectedLayer.layer = null; } catch (e) { /* */ }
      // Also try closing after a delay in case state load re-opens it
      setTimeout(() => {
        try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
        try { viewer.selectedLayer.layer = null; } catch (e) { /* */ }
      }, 1000);
    },
  },
  //8b - find annotation
  {
    text: `**See if you can find a yellow annotation at the end of one of the branches and zoom in on it.**

Don't worry if you can't find it - the Next button will take you there.`,
    position: OVER_3D,
    image:
      imgInspectorNurro,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5527767895506944",
    onEnter: () => { setAnnotationColor('#ffff00'); },
  },
  //9 - new NG state middleauth+https://global.daf-apis.com/nglstate/api/v1/4893758698029056
  {
    text: `There it is! This flat edge reveals a mistake by the AI.

It missed a branch. Let's see if we can find it.`,

    position: OVER_3D,
    image:
      imgNurroSuccessTiny,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6606861248757760",
    width: "200px",
    onEnter: () => { setAnnotationColor('#ffff00'); },
  },
  //11 - this tries to get user to bring up split screen - we need to default to split vs 4 panel view. otherwise need to add anoter box to get them to split view - ng link middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288

  {
    text: `Hit SPACE to bring up a split screen view that reveals the electron microscope image data from which these neurons were reconstructed.`,
    position: OVER_3D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6606861248757760",
    spaceAdvances: true,
  },
  //12 - over 2D - EM cross section view
  {
    text: `This is an electron microscope (EM) image of the brain. A stack of such images creates a 3D volume. The neuron branch is highlighted in the cross section.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },
  //12a - split screen tip
  {
    text: `You're now in split screen view — EM on the left, 3D on the right. If you ever end up in 4 panel view, look for the ◫ button to get back to split screen.`,
    position: OVER_2D,
  },
  //13 - gif
  {
    text: `Move your cursor outside this box, then press COMMA and PERIOD to step through the EM slices. You can also hover your mouse over EM and scroll through images.

Don't worry if you lose the neuron - the Next button in this section resets this view.`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },
  //14 - 2D control + scroll gif
  {
    text: `Hold your cursor over black and white EM and CTRL + Scroll to zoom in and out`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },
  //15 - 2D right click center gif
  {
    text: `Right click to recenter`,
    position: OVER_2D,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5220308702199808",
  },

  //17 - position center of page - ensure location is  middleauth+https://global.daf-apis.com/nglstate/api/v1/5325932265996288
  {
    text: `The big black empty space is an imaging defect, which happens occasionally when you are snapping at the nanoscale. It caused the AI to make a mistake and disconnect a dendrite.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408",
    onEnter: () => {
      // Remove the erroneous purple segment
      setTimeout(() => removeSegment('648518346356484078'), 1500);
    },
  },
  //18 -  middleauth+https://global.daf-apis.com/nglstate/api/v1/6543003020689408
  {
    text: `To fix it, we need to scroll past the defect and find where the branch continues.

This is a tutorial so we dropped a hint. Hit the comma key a few times until you get to an image past the black spill that does not have the cell colored in. There is an annotation point in the continuation segment. See what happens when you double click in 2D.

Hit next to reveal the answer.`,
    position: MIDDLE,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5250067188416512",
  },
  //20 - Nurro swoop! - new NG state with extension added middleauth+https://global.daf-apis.com/nglstate/api/v1/5190220459802624
  {
    text: `Bravo! We found the continuation!`,
    position: {
      element: "body",
      x: 0.5,
      y: 0.12,
    },
    floatingImage:
      imgBravoNurro,
    state:
      "middleauth+https://global.daf-apis.com/nglstate/api/v1/5114308439572480",
  },
  {
    text: `Now you know the basics. In the future, we will learn how to fuse branches together and slice away mergers. Feel free to click around and explore.`,
    image:
      imgRikaSuccess,
    position: OVER_3D,
  },
  {
    text: `Check out this top right menu for guides, tutorials, and more resources.`,
    position: {
      element: "#hamburger > button",
      side: "bottom",
      offset: { x: 0, y: 0 },
    },
    onEnter: () => {
      const viewer = getViewer();
      if (!viewer) return;
      // Close layers side panel aggressively
      function closePanel() {
        try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
        try { viewer.selectedLayer.layer = null; } catch (e) { /* */ }
        // Hide any side panel elements by broad class matching
        var selectors = [
          '.neuroglancer-layer-side-panel-container',
          '.neuroglancer-layer-list-panel',
          '.neuroglancer-selected-layer-side-panel',
          '[class*="side-panel"]',
          '[class*="sidepanel"]',
          '[class*="SidePanel"]',
        ];
        for (var i = 0; i < selectors.length; i++) {
          var els = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < els.length; j++) {
            (els[j] as HTMLElement).style.display = 'none';
          }
        }
        // Also try toggling the layer bar visibility
        try { viewer.showLayerPanel.value = false; } catch (e) { /* */ }
        try { viewer.layerSpecification.visible = false; } catch (e) { /* */ }
      }
      closePanel();
      setTimeout(closePanel, 300);
      setTimeout(closePanel, 1000);
      setTimeout(closePanel, 2000);

      // Fun hamburger emoji animation on the menu button
      setTimeout(() => {
        const btn = document.querySelector('#hamburger > button') as HTMLElement;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();

        // Create emoji overlay
        const emoji = document.createElement('div');
        emoji.textContent = '\u{1F354}';
        emoji.style.cssText = [
          'position: fixed',
          'z-index: 10000',
          'font-size: 28px',
          'pointer-events: none',
          'left: ' + (rect.left + rect.width / 2) + 'px',
          'top: ' + (rect.top + rect.height / 2) + 'px',
          'transform: translate(-50%, -50%) scale(0)',
          'transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
          'opacity: 1',
          'filter: drop-shadow(0 0 8px rgba(255, 180, 50, 0.6))',
        ].join(';');
        document.body.appendChild(emoji);

        // Animate in: scale up with bounce
        requestAnimationFrame(() => {
          emoji.style.transform = 'translate(-50%, -50%) scale(1.8)';
        });

        // Wiggle
        setTimeout(() => {
          emoji.style.transition = 'transform 0.15s ease-in-out';
          emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(12deg)';
          setTimeout(() => {
            emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(-10deg)';
            setTimeout(() => {
              emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(6deg)';
              setTimeout(() => {
                emoji.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(0deg)';
              }, 150);
            }, 150);
          }, 150);
        }, 500);

        // Fade out
        setTimeout(() => {
          emoji.style.transition = 'transform 0.5s ease-in, opacity 0.5s ease-in';
          emoji.style.transform = 'translate(-50%, -50%) scale(0.5)';
          emoji.style.opacity = '0';
          setTimeout(() => emoji.remove(), 600);
        }, 1600);
      }, 800);
    },
  },
  {
    text: `Researchers: take the **Self-guided training** when you are ready to learn more and gain access to the production dataset! LINK

Citizen scientists: [Unlock access](https://blog.eyewire.org/how-to-access-the-eyewire-ii-dataset/) to start mapping neurons in Eyewire II!

Email support at eyewire.ai with any questions.


Thanks for being a part of the neuroscience community. For Science!`,
    position: MIDDLE,
    image:
      imgTutorialFinal,
    width: "600px",
    onEnter: () => {
      const viewer = getViewer();
      if (!viewer) return;
      try { viewer.selectedLayer.visible = false; } catch (e) { /* */ }
      try { viewer.selectedLayer.layer = null; } catch (e) { /* */ }
      try { viewer.showLayerPanel.value = false; } catch (e) { /* */ }
      var selectors = ['[class*="side-panel"]', '[class*="sidepanel"]', '[class*="SidePanel"]'];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          (els[j] as HTMLElement).style.display = 'none';
        }
      }
    },
  },
];
