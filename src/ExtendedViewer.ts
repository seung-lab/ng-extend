// import 'neuroglancer/ui/default_viewer.css';
// import { Viewer } from "neuroglancer/unstable/viewer.js";
import { LightBulbService } from './widgets/lightbulb_service';
// import { DisplayContext } from 'neuroglancer/unstable/display_context.js';
// import { setupParentViewer } from './extend_viewer_setup';
// import { disableContextMenu, disableWheel } from 'neuroglancer/unstable/ui/disable_default_actions.js';
// import { StatusMessage } from 'neuroglancer/unstable/status.js';


// export function setupExtendedViewer() {
//     let viewer = (<any>window)['viewer'] = makeExtendViewer();
//     return setupParentViewer(viewer);
// } 

// function makeExtendViewer() {
//   disableContextMenu();
//   disableWheel();
//   try {
//     let display =
//         new DisplayContext(document.getElementById('neuroglancer-container')!);
//     return new ExtendViewer(display);
//   } catch (error) {
//     StatusMessage.showMessage(`Error: ${error.message}`);
//     throw error;
//   }
// }

export function liveNeuroglancerInjection(lightbulb : LightBulbService) {
    const watchNode = document.querySelector('#content');
  if (!watchNode) {
    return;
  }
  observeSegmentSelect(watchNode, lightbulb);
}

function observeSegmentSelect(targetNode : Element, lightbulb : LightBulbService) {  
    // Select the node that will be observed for mutations
    if (!targetNode) {
      return;
    }
  
    // Options for the observer (which mutations to observe)
    const config = {childList: true, subtree: true};
    let datasetElement = (<HTMLElement>targetNode.querySelector('.neuroglancer-layer-item-label'));
    let dataset = ""
    if (dataset) {
      dataset = datasetElement.innerText;
    }

    const placeLightbulb = function(item: HTMLElement) {
      if (item.classList) {
        let buttonList: Element|HTMLElement[] = [];
        if (item.classList.contains("neuroglancer-segment-list-entry")) {
          buttonList = [item];
        }

        buttonList.forEach(item => {
          const segmentIDString =
              item.getAttribute('data-id');

          if (segmentIDString) {
            let bulb = item.querySelector('.nge-lightbulb-section.menu');
            if (bulb == null) {
              bulb = lightbulb.createButton(segmentIDString);
              
              bulb.classList.add('error')
              item.appendChild(bulb);
              (<HTMLButtonElement>bulb).title = 'Click for opening context menu';
            }
          }
        })
      }
    };
  
    // Callback function to execute when mutations are observed
    const detectMutation = function(mutationsList: MutationRecord[]) {
  
      mutationsList.forEach(mutation => {
        mutation.addedNodes.forEach(placeLightbulb)
      });
    };
  
    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(detectMutation);
  
    // Start observing the target node for configured mutations
    observer.observe(targetNode, config);
  }


// class ExtendViewer extends Viewer {

//     lightbulb = new LightBulbService();
  
//     constructor(public display: DisplayContext) {
//       super(display, {
//         showLayerDialog: false,
//         showUIControls: true,
//         showPanelBorders: true
//       });
//     }
//   }