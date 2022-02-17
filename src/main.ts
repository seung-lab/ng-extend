require('neuroglancer/ui/default_viewer.css');
require('./widgets/seg_management.css');
require('./main.css');

import 'neuroglancer/sliceview/chunk_format_handlers';
import {setDefaultInputEventBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {disableContextMenu, disableWheel} from 'neuroglancer/ui/disable_default_actions';
import {DisplayContext} from 'neuroglancer/display_context';
import {StatusMessage} from 'neuroglancer/status';
import {Viewer} from 'neuroglancer/viewer';
import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'neuroglancer/ui/default_clipboard_handling';
import {setupVueApp} from './vueapp';
import {layerProxy, storeProxy} from './state';
import {connectChatSocket} from './chat_socket';
import './config';
import {authFetch, authTokenShared} from 'neuroglancer/authentication/frontend';
import Config from './config';
import {ContextMenu} from 'neuroglancer/ui/context_menu';
import {SubmitDialog} from './widgets/seg_management';
import {SegmentationUserLayerWithGraph} from 'third_party/neuroglancer/src/neuroglancer/segmentation_user_layer_with_graph';
// import {vec3} from 'neuroglancer/util/geom';

window.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  const app = setupVueApp();
  localStorage.setItem('neuroglancer-disableWhatsNew', '1');
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

  return viewer;
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
  // Select the node that will be observed for mutations
  if (!targetNode) {
    return;
  }

  // Options for the observer (which mutations to observe)
  const config = {childList: true, subtree: true};
  const getTimeStamp = async (segmentIDString: string) => {
    const mLayer = (<any>window).viewer.selectedLayer.layer;
    if (mLayer == null) return;
    const layer = <SegmentationUserLayerWithGraph>mLayer.layer;
    const timestamps = await authFetch(
        `${layer.chunkedGraphUrl}/root_timestamps`,
        {method: 'POST', body: JSON.stringify({node_ids: [segmentIDString]})});
    const ts = await timestamps.json();
    return ts.timestamp[0];
  };
  const makeChangelogMenu =
      (parent: HTMLElement, segmentIDString: string,
       dataset: string): ContextMenu => {
        const contextMenu = new ContextMenu(parent);
        const menu = contextMenu.element;
        menu.classList.add('neuroglancer-layer-group-viewer-context-menu');
        const paramStr = `${segmentIDString}&dataset=${dataset}&submit=true`;
        const host = 'https://prod.flywire-daf.com';
        let timestamp: number|undefined;
        let menuOpt: (string|((e: MouseEvent) => void))[][] =
            [['ChangeLog', `${host}/progress/api/v1/query?rootid=${paramStr}`]];

        // If production data set
        if (dataset == 'fly_v31') {
          menuOpt = [
            ...menuOpt,
            [
              'Proofreading Contributors',
              `${host}/neurons/api/v1/lookup_info?filter_by=root_id&filter_string=${
                  paramStr}`
            ],
            [
              'Mark Complete', ``,
              async (e: MouseEvent) => {
                e.preventDefault();
                if (timestamp == undefined) {
                  timestamp = await getTimeStamp(segmentIDString);
                }
                // cannot gurantee that outdated neuron will throw error
                if (parent.classList.contains('error')) {
                  StatusMessage.showMessage(
                      `Error: Cannot Mark Complete is not avaliable. Please re-select the segment for the most updated version.`,
                      {color: '#ff0000'});
                } else {
                  new SubmitDialog(
                      (<any>window).viewer, segmentIDString, timestamp!,
                      storeProxy.loggedInUser!.id);
                }
              }
            ],
            [
              'Cell Identification',
              `${host}/neurons/api/v1/cell_identification?filter_by=root_id&filter_string=${
                  paramStr}`
            ],
          ];
        }

        for (const [name, model, action] of menuOpt) {
          const label = document.createElement('a');
          label.style.display = 'flex';
          label.style.flexDirection = 'row';
          label.style.whiteSpace = 'nowrap';
          label.textContent = `${name}`;
          label.style.color = 'white';
          label.href = `${model}`;
          label.target = '_blank';
          if (action) {
            label.addEventListener('click', <any>action!);
          }
          menu.appendChild(label);
        }
        return contextMenu;
      };
  const createChangelogButton =
      (segmentIDString: string, dataset: DOMStringMap): HTMLButtonElement => {
        // Button for the user to copy a segment's ID
        const changelogButton = document.createElement('button');
        changelogButton.className = 'nge-segment-changelog-button lightbulb';
        changelogButton.title =
            `Show changelog for Segment: ${segmentIDString}`;
        changelogButton.innerHTML = '⠀';
        var cmenu = makeChangelogMenu(
            changelogButton, segmentIDString, dataset.dataset!);
        changelogButton.addEventListener('click', (event: MouseEvent) => {
          cmenu.show(event);
        });
        return changelogButton;
      };

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

      buttonList.forEach(item => {
        const segmentIDString =
            (<HTMLElement>item.querySelector('.segment-button')).dataset.segId!;
        let bulb =
            item.querySelector('.nge-segment-changelog-button.lightbulb');
        if (bulb == null) {
          bulb = createChangelogButton(segmentIDString, item.dataset);
          bulb.classList.add('error');
          item.appendChild(bulb);
          (<HTMLButtonElement>bulb).title = 'Click for cell information menu.';
        }
        if (item.dataset.dataset == 'fly_v31') {
          checkBulbStatus(<HTMLButtonElement>bulb, segmentIDString);
        }
      });
    }
  };

  const checkTime = 120000;
  const checkVisibleTime = 30000;
  const checkBulbStatus =
      function(bulb: HTMLButtonElement, sid: string) {
    const view = bulb.getBoundingClientRect();
    if (!view.height || !view.width) {
      // not visible
      setTimeout(checkBulbStatus, checkVisibleTime, bulb, sid);
    } else {
      const menuText = 'Click for cell information menu.';
      authFetch(
          `https://prod.flywire-daf.com/neurons/api/v1/proofreading_status/root_id/${
              sid}`,
          {credentials: 'same-origin'})
          .then(response => response.json())
          .then(data => {
            bulb.classList.remove('error');
            if (Object.keys(data.valid).length) {
              bulb.title = `This segment is marked as proofread. ${menuText}`;
              bulb.classList.add('active');
            } else {
              bulb.title =
                  `This segment is not marked as proofread. ${menuText}`;
            }
          })
          .catch((reason) => {
            if (reason.status == '401') {
              bulb.title = `This segment is outdated. ${menuText}`;
              bulb.classList.add('outdated');
            }
          })
          .finally(() => {
            setTimeout(checkBulbStatus, checkTime, bulb, sid);
          });
    }
  }

  // Callback function to execute when mutations are observed
  const detectMutation = function(mutationsList: MutationRecord[]) {
    console.log('Segment ID Added');

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
