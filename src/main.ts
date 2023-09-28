import {createApp} from 'vue';
import {createPinia} from 'pinia';

import 'neuroglancer/ui/default_viewer.css';

import App from 'components/App.vue';
import {useLayersStore} from 'src/store';
import {Viewer} from 'neuroglancer/viewer';
import {setDefaultInputEventBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'neuroglancer/ui/default_clipboard_handling';
import {disableWheel} from 'neuroglancer/ui/disable_default_actions';
import {DisplayContext} from 'neuroglancer/display_context';
import {StatusMessage} from 'neuroglancer/status';
import {registerEventListener} from 'neuroglancer/util/disposable';
import 'neuroglancer/sliceview/chunk_format_handlers';
import {ButtonService} from "./widgets/button_service"

function mergeTopBars() {
  const ngTopBar = document.querySelector('.neuroglancer-viewer')!.children[0];
  const topBarVueParent = document.getElementById('insertNGTopBar')!;
  topBarVueParent.appendChild(ngTopBar);
}

window.addEventListener('DOMContentLoaded', () => {
  const pinia = createPinia();
  const app = createApp(App);
  app.use(pinia);
  const {initializeWithViewer} = useLayersStore();
  app.directive('visible', function(el, binding) {
    el.style.visibility = !!binding.value ? 'visible' : 'hidden';
  });
  app.mount('#app');
  const viewer = setupViewer();
  initializeWithViewer(viewer);
  mergeTopBars();
  liveNeuroglancerInjection();
});

function setupViewer() {
  const viewer = (<any>window)['viewer'] = makeExtendViewer();
  setDefaultInputEventBindings(viewer.inputEventBindings);

  // viewer.loadFromJsonUrl().then(() => {
  //   layerProxy.loadActiveDataset();
  // });
  // viewer.initializeSaver();

  bindDefaultCopyHandler(viewer);
  bindDefaultPasteHandler(viewer);
  viewer.showDefaultAnnotations.value = false;
  // replaceIcons();
  // CustomColor.convertColor(
  //     <HTMLInputElement>document.getElementById('path-finder-color-widget'));
  // viewer
  return viewer;
}

function makeExtendViewer() {
  registerEventListener(
      document.getElementById('neuroglancer-container')!, 'contextmenu',
      (e: Event) => {
        e.preventDefault();
      });
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

function observeSegmentSelect(targetNode: Element) {
  const viewer: ExtendViewer = (<any>window)['viewer'];
  const buttonService = viewer.buttonService;
  // Select the node that will be observed for mutations
  console.log(viewer, targetNode)
  if (!targetNode) {
    return;
  }

  // Options for the observer (which mutations to observe)
  const config = {childList: true, subtree: true};

  const updateSegmentSelectItem = function(item: HTMLElement) {
    if (item.classList) {
      if (item.classList.contains("neuroglancer-segment-list-entry")) {
        console.log(item)
        let segmentIDString =
            item.getAttribute('data-id');
        if (segmentIDString) {
          console.log(segmentIDString)
          let button = buttonService.createButton(segmentIDString)
          item.appendChild(button);
          (<HTMLButtonElement>button).title = 'Click for opening in Synapse Proofreading System';
        }
      }
    }
  };

  // Callback function to execute when mutations are observed
  const detectMutation = function(mutationsList: MutationRecord[]) {
    //console.log('Segment ID Added');
    // replaceIcons();
    // TODO: this is not ideal, but it works for now  (maybe)
    /*Array.from(document.querySelectorAll('.top-buttons .segment-checkbox'))
        .forEach((item: any) => {
          CustomCheck.convertCheckbox(item);
        });
*/
    mutationsList.forEach(mutation => {
      mutation.addedNodes.forEach(updateSegmentSelectItem);
    });
  };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(detectMutation);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);

  // Convert existing items
  targetNode.querySelectorAll('.segment-div').forEach(updateSegmentSelectItem);
}

function liveNeuroglancerInjection() {
  const watchNode = document.querySelector('#content');
  if (!watchNode) {
    return;
  }
  observeSegmentSelect(watchNode);
}

class ExtendViewer extends Viewer {
  // theme = new Theming();
  buttonService = new ButtonService();
  constructor(public display: DisplayContext) {
    super(display, {
      showLayerDialog: false,
      showUIControls: true,
      showPanelBorders: true,
      // defaultLayoutSpecification: 'xy-3d',
      // minSidePanelSize: 310
    });
    // storeProxy.loadedViewer = true;
    // authTokenShared!.changed.add(() => {
    //   storeProxy.fetchLoggedInUser();
    // });
    // storeProxy.fetchLoggedInUser();

    // if (!this.jsonStateServer.value) {
    //   this.jsonStateServer.value = config.linkShortenerURL;
    // }
  }

  // promptJsonStateServer(message: string): void {
  //   let json_server_input = prompt(message, config.linkShortenerURL);
  //   if (json_server_input !== null) {
  //     this.jsonStateServer.value = json_server_input;
  //   } else {
  //     this.jsonStateServer.reset();
  //   }
  // }
}
