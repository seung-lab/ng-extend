import 'neuroglancer/ui/default_viewer.css';
import { Viewer } from 'third_party/neuroglancer/viewer';
import { LightBulbService } from './widgets/lightbulb_service';
import { DisplayContext } from 'third_party/neuroglancer/display_context';
import { setupParentViewer } from './extend_viewer_setup';
import { disableContextMenu, disableWheel } from 'third_party/neuroglancer/ui/disable_default_actions';
import { StatusMessage } from 'third_party/neuroglancer/status';


export function setupExtendedViewer() {
    let viewer = (<any>window)['viewer'] = makeExtendViewer();
    return setupParentViewer(viewer);
} 

function makeExtendViewer() {
  disableContextMenu();
  disableWheel();
  try {
    let display =
        new DisplayContext(document.getElementById('neuroglancer-container')!);
    return new ExtendViewer(display);
  } catch (error) {
    StatusMessage.showMessage(`Error: ${error.message}`);
    throw error;
  }
}

export function liveNeuroglancerInjection() {
    const watchNode = document.querySelector('#content');
  if (!watchNode) {
    return;
  }
  observeSegmentSelect(watchNode);
}

function observeSegmentSelect(targetNode : Element) {
    const viewer: ExtendViewer = (<any>window)['viewer'];
    const lightbulb = viewer.lightbulb;
  
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
              bulb = lightbulb.createButton(segmentIDString, dataset);
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
        mutation.addedNodes.forEach(placeLightbulb);
      });
    };
  
    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(detectMutation);
  
    // Start observing the target node for configured mutations
    observer.observe(targetNode, config);
  }


class ExtendViewer extends Viewer {

    lightbulb = new LightBulbService();
  
    constructor(public display: DisplayContext) {
      super(display, {
        showLayerDialog: false,
        showUIControls: true,
        showPanelBorders: true
      });
    }
  }