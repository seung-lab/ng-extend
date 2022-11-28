require('neuroglancer/ui/default_viewer.css');
require('./widgets/seg_management.css');
require('./widgets/custom_check.css');
require('./widgets/custom_color.css');
require('./widgets/icon_override.css');
require('./widgets/lightbulbMenu.css');
require('./widgets/summary.css');
require('./widgets/cell_identification.css');
require('./widgets/loader.css');
require('./main.css');

import 'neuroglancer/sliceview/chunk_format_handlers';
import {setDefaultInputEventBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {disableWheel} from 'neuroglancer/ui/disable_default_actions';
import {DisplayContext} from 'neuroglancer/display_context';
import {StatusMessage} from 'neuroglancer/status';
import {Viewer} from 'neuroglancer/viewer';
import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'neuroglancer/ui/default_clipboard_handling';
import {setupVueApp} from './vueapp';
import {layerProxy, storeProxy} from './state';
import {connectChatSocket} from './chat_socket';
import './config';
import {authTokenShared} from 'neuroglancer/authentication/frontend';
import Config from './config';
import {registerEventListener} from 'neuroglancer/util/disposable';
import {Theming} from './themes/themes';
import {CustomCheck} from './widgets/custom_check';
import {CustomColor} from './widgets/custom_color';
import {BulbService} from './widgets/bulb_service';
// import {vec3} from 'neuroglancer/util/geom';

window.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  const app = setupVueApp();
  localStorage.setItem('neuroglancer-disableWhatsNew', '0');
  const viewer = setupViewer();
  storeProxy.initializeViewer(viewer);
  mergeTopBars();
  storeProxy.loopUpdateLeaderboard();
  connectChatSocket();
  storeProxy.joinChat();
  disableNGErrMsg();
  liveNeuroglancerInjection();


  app.$nextTick(() => {
    storeProxy.finishedLoading = true;
    repositionUndoRedo();
  });
});

export let config: Config;

async function loadConfig() {
  const configURL = 'src/config.json';
  config = await fetch(configURL).then(res => res.json());
}

function disableNGErrMsg() {
  const error = document.getElementById('nge-error');
  if (error) {
    error.style.display = 'none';
  }
}

function mergeTopBars() {
  const ngTopBar = document.getElementById('neuroglancerViewer')!.children[0];
  const topBarVueParent = document.getElementById('insertNGTopBar')!;
  topBarVueParent.appendChild(ngTopBar);
  const buttons =
      ngTopBar.querySelectorAll('div.neuroglancer-icon-button:not(.unmerged)');
  for (const button of buttons) {
    const htmlButton = <HTMLElement>button;
    const text = htmlButton.title;
    const click = () => htmlButton.click();
    storeProxy.actionsMenuItems.push({text: text, click: click});
    button.remove();
  }
}

function setupViewer() {
  const viewer = (<any>window)['viewer'] = makeExtendViewer();
  setDefaultInputEventBindings(viewer.inputEventBindings);

  viewer.loadFromJsonUrl().then(() => {
    layerProxy.loadActiveDataset();
  });
  viewer.initializeSaver();

  bindDefaultCopyHandler(viewer);
  bindDefaultPasteHandler(viewer);
  viewer.showDefaultAnnotations.value = false;
  // replaceIcons();
  CustomColor.convertColor(
      <HTMLInputElement>document.getElementById('path-finder-color-widget'));
  // viewer
  return viewer;
}
/* replace with content-visibility: hidden
function replaceIcons() {
  ['.copy-all-segment-IDs-button',
   '.segment-copy-button.copy-visible-segment-IDs-button',
   '.segment-copy-button',
   '.neuroglancer-copy-button.neuroglancer-button',
  ].forEach((icon: any) => {
    document.querySelectorAll(icon).forEach((el: any) => {
      el.innerHTML = '';
    });
  });
};*/

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

function repositionUndoRedo() {
  const dcButton = document.getElementById('datasetChooser');
  const undobreak = document.createElement('div');
  undobreak.classList.add('ng-extend-spacer');
  const redobreak = undobreak.cloneNode();
  const undo = document.querySelector('#neuroglancer-undo-button');
  const redo = document.querySelector('#neuroglancer-redo-button');
  if (redo && dcButton) {
    dcButton.parentNode!.insertBefore(redo, dcButton.nextSibling);
    redo.parentNode!.insertBefore(redobreak, redo);
  }
  if (undo && dcButton) {
    dcButton.parentNode!.insertBefore(undo, dcButton.nextSibling);
    undo.parentNode!.insertBefore(undobreak, undo);
  }
}

function observeSegmentSelect(targetNode: Element) {
  const viewer: ExtendViewer = (<any>window)['viewer'];
  const bs = viewer.bulbService;
  // Select the node that will be observed for mutations
  if (!targetNode) {
    return;
  }

  // Options for the observer (which mutations to observe)
  const config = {childList: true, subtree: true};

  const updateSegmentSelectItem = function(item: HTMLElement) {
    if (item.classList) {
      let buttonList: Element|HTMLElement[] = [];
      if (item.classList.contains('segment-div')) {
        buttonList = [item];
      } else if (
          item.classList.contains('neuroglancer-tab-content') &&
          item.classList.contains('segmentation-dropdown')) {
        buttonList = Array.from(item.querySelectorAll('.segment-div'));
      }

      /*const element = document.querySelector('.segment-copy-button');
      if (element) element.innerHTML = '';*/

      buttonList.forEach(item => {
        const segmentIDString =
            (<HTMLElement>item.querySelector('.segment-button')).dataset.segId!;
        item.querySelectorAll('input[type="color"]')
            .forEach((colorbox: HTMLInputElement) => {
              CustomColor.convertColor(colorbox);
            });
        item.querySelectorAll('input[type="checkbox"]')
            .forEach((checkbox: HTMLInputElement) => {
              CustomCheck.convertCheckbox(checkbox);
            });
        let bulb =
            item.querySelector('.nge-segment-changelog-button.lightbulb');
        if (bulb == null) {
          bulb = bs.createChangelogButton(segmentIDString, item.dataset);
          bulb.classList.add('error');
          item.appendChild(bulb);
          (<HTMLButtonElement>bulb).title = 'Click for Cell Information menu.';
        }
        if (item.dataset.dataset == 'fly_v31') {
          // always force bulb status on creation
          bs.addBulbToDict(<HTMLButtonElement>bulb, segmentIDString);
        }
      });
    }
  };

  // Callback function to execute when mutations are observed
  const detectMutation = function(mutationsList: MutationRecord[]) {
    console.log('Segment ID Added');
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
  theme = new Theming();
  bulbService = new BulbService();
  constructor(public display: DisplayContext) {
    super(display, {
      showLayerDialog: false,
      showUIControls: true,
      showPanelBorders: true,
      defaultLayoutSpecification: 'xy-3d',
      minSidePanelSize: 310
    });
    storeProxy.loadedViewer = true;
    authTokenShared!.changed.add(() => {
      storeProxy.fetchLoggedInUser();
    });
    storeProxy.fetchLoggedInUser();

    if (!this.jsonStateServer.value) {
      this.jsonStateServer.value = config.linkShortenerURL;
    }
  }

  promptJsonStateServer(message: string): void {
    let json_server_input = prompt(message, config.linkShortenerURL);
    if (json_server_input !== null) {
      this.jsonStateServer.value = json_server_input;
    } else {
      this.jsonStateServer.reset();
    }
  }
}
