require('neuroglancer/ui/default_viewer.css');
require('./widgets/seg_management.css');
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
import {authFetch, authTokenShared} from 'neuroglancer/authentication/frontend';
import Config from './config';
import {ContextMenu} from 'neuroglancer/ui/context_menu';
// import {SubmitDialog} from './widgets/seg_management';
import {SegmentationUserLayerWithGraph, SegmentationUserLayerWithGraphDisplayState} from 'neuroglancer/segmentation_user_layer_with_graph';
import {Loader} from './widgets/loader';
// import {CellIdDialog} from './widgets/cell_identification';
import {CellReviewDialog} from './widgets/cell_review';
import {registerEventListener} from 'neuroglancer/util/disposable';
import {PartnersDialog} from './widgets/partners';
import {SummaryDialog} from './widgets/summary';
import {Theming} from './themes/themes';
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
  replaceIcons();
  // viewer
  return viewer;
}

function replaceIcons() {
  ['.copy-all-segment-IDs-button',
   '.segment-copy-button.copy-visible-segment-IDs-button',
   '.segment-copy-button', '.neuroglancer-copy-button.neuroglancer-button']
      .forEach((icon: any) => {
        document.querySelectorAll(icon).forEach((el: any) => {
          el.innerHTML = '';
        });
      });
};

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
    const displayState =
        <SegmentationUserLayerWithGraphDisplayState>layer.displayState;

    if (displayState.timestamp) return parseInt(displayState.timestamp.value);

    const timestamps = await authFetch(
        `${layer.chunkedGraphUrl}/root_timestamps`,
        {method: 'POST', body: JSON.stringify({node_ids: [segmentIDString]})});
    const ts = await timestamps.json();
    return ts.timestamp[0];
  };

  const dsTimestamp = () => {
    const mLayer = (<any>window).viewer.selectedLayer.layer;
    if (mLayer == null) return;
    return mLayer.layer.displayState.timestamp.value;
  };

  // Given an HTMLDivElement, generate a section with the title given by the
  // title parameter and a button under the title with the text given by the
  // button parameter
  const generateSection =
      (title: string, buttons: (string|((e: MouseEvent) => void))[][],
       menuOpt: (string|((e: MouseEvent) => void))[][],
       contentCB?: Function) => {
        const section = document.createElement('div');
        section.classList.add('nge-lb-section');
        const sectionTitle = document.createElement('div');
        sectionTitle.classList.add('nge-lb-section-title');
        sectionTitle.innerText = title;

        section.appendChild(sectionTitle);
        if (contentCB) {
          const sectionContent = document.createElement('div');
          sectionContent.classList.add('nge-lb-section-content');
          sectionContent.innerText = contentCB() || '';
          section.appendChild(sectionContent);
        }
        for (const [name, classNames, action] of buttons) {
          const sectionButton = document.createElement('button');
          sectionButton.classList.add('nge-lb-section-button');
          sectionButton.innerText = <string>name;
          sectionButton.className += ' ' + classNames;
          if (action) {
            sectionButton.addEventListener('click', <any>action!);
          }
          section.appendChild(sectionButton);
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
          section.appendChild(label);
        }
        return section;
      };

  // this function needs to be refactored
  const makeChangelogMenu =
      (parent: HTMLElement, segmentIDString: string,
       dataset: string): ContextMenu => {
        const contextMenu = new ContextMenu(parent);
        const menu = contextMenu.element;
        menu.style.left = `${parseInt(menu.style.left || '0') - 100}px`;
        menu.classList.add(
            'neuroglancer-layer-group-viewer-context-menu', 'nge_lbmenu');
        const paramStr = `${segmentIDString}&dataset=${dataset}&submit=true`;
        const host = 'https://prod.flywire-daf.com';
        let timestamp: number|undefined = dsTimestamp();
        let optGroup: any = {analysis: [], proofreading: []};

        const cleanOverlays = () => {
          const overlays = document.getElementsByClassName('nge-overlay');
          [...overlays].forEach(function(element) {
            try {
              (<any>element).dispose();
            } catch {
            }
          });
        };
        const handleDialogOpen = async (e: MouseEvent, callback: Function) => {
          e.preventDefault();
          let spinner = new Loader();
          if (timestamp == undefined) {
            timestamp = await getTimeStamp(segmentIDString);
          }
          cleanOverlays();
          spinner.dispose();
          callback(parent.classList.contains('error'));
        };
        const currentTimeStamp = () => timestamp;
        // timestamp will change but because the menu opt is static, if it
        // already exists then the user has defined a timestamp to use and the
        // field should be added
        const linkTS = timestamp ? `&timestamp=${timestamp}` : '';
        const dashTS = timestamp ? `&timestamp_field=${timestamp}` : '';

        let changelog =
            ['Change Log', `${host}/progress/api/v1/query?rootid=${paramStr}`];
        // If production data set
        if (dataset == 'fly_v31') {
          optGroup.proofreading.push(SummaryDialog.generateMenuOption(
              handleDialogOpen, host, segmentIDString, currentTimeStamp));
          optGroup.analysis.push([
            'Connectivity',
            `${host}/dash/datastack/flywire_fafb_production/apps/fly_connectivity/?input_field=${
                segmentIDString}&cleft_thresh_field=50${dashTS}`,
          ]);
          optGroup.proofreading.push(changelog);
          optGroup.proofreading.push([
            'Cell Completion Details',
            `${host}/neurons/api/v1/lookup_info?filter_by=root_id&filter_string=${
                paramStr}${linkTS}`
          ]);
          /*
          optGroup.proofreading.push([
            'Cell Identification',
            `${host}/neurons/api/v1/cell_identification?filter_by=root_id&filter_string=${
                paramStr}${linkTS}`
          ]);
          */
          optGroup.analysis.push(PartnersDialog.generateMenuOption(
              handleDialogOpen, host, segmentIDString, currentTimeStamp));

          // the timestamp parameter is falsy if the user has defined a
          // timestamp
          if (!timestamp) {
            /*
            optGroup.proofreading.push(SubmitDialog.generateMenuOption(
                handleDialogOpen, host, segmentIDString, currentTimeStamp));
            optGroup.proofreading.push(CellIdDialog.generateMenuOption(
                handleDialogOpen, host, segmentIDString, currentTimeStamp));
            */
            if (parent.classList.contains('active')) {
              optGroup.proofreading.push(
                  CellReviewDialog.generateMenuOption(
                      handleDialogOpen, host, segmentIDString,
                      currentTimeStamp),
              );
            }
          }
        } else {
          optGroup.proofreading.push(changelog);
        }

        const br = () => document.createElement('br');
        menu.append(
            br(),
            generateSection(
                'Cell Identification', [['Identify']], [], () => {}),
            br(), br(), generateSection('Analysis', [], optGroup.analysis),
            br(), br(),
            generateSection(
                'Proofreading', [[
                  'Complete',
                  parent.classList.contains('active') ? 'green' : 'blue',

                ]],
                optGroup.proofreading),
            br(), br());
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
        let cmenu = makeChangelogMenu(
            changelogButton, segmentIDString, dataset.dataset!);
        changelogButton.addEventListener('click', (event: MouseEvent) => {
          cmenu.show(<MouseEvent>{
            clientX: event.clientX - 200,
            clientY: event.clientY
          });
        });
        changelogButton.dataset.dataset = dataset.dataset!;
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

      /*const element = document.querySelector('.segment-copy-button');
      if (element) element.innerHTML = '';*/

      buttonList.forEach(item => {
        const segmentIDString =
            (<HTMLElement>item.querySelector('.segment-button')).dataset.segId!;
        let bulb =
            item.querySelector('.nge-segment-changelog-button.lightbulb');
        if (bulb == null) {
          bulb = createChangelogButton(segmentIDString, item.dataset);
          bulb.classList.add('error');
          item.appendChild(bulb);
          (<HTMLButtonElement>bulb).title = 'Click for Cell Information menu.';
        }
        if (item.dataset.dataset == 'fly_v31') {
          // always force bulb status on creation
          checkBulbStatus(<HTMLButtonElement>bulb, segmentIDString, true);
        }
      });
    }
  };

  const checkTime = 120000;
  const checkVisibleTime = 30000;
  const checkBulbStatus =
      function(bulb: HTMLButtonElement, sid: string, force?: boolean) {
    const view = bulb.getBoundingClientRect();
    if (!force && (!view.height || !view.width)) {
      // not visible
      setTimeout(checkBulbStatus, checkVisibleTime, bulb, sid);
    } else {
      const menuText = 'Click for Cell Information menu.';
      const rawTS = dsTimestamp();
      const timestamp = rawTS ? `?timestamp=${rawTS}` : '';
      authFetch(
          `https://prod.flywire-daf.com/neurons/api/v1/proofreading_status/root_id/${
              sid}${timestamp}`,
          {credentials: 'same-origin'})
          .then(response => response.json())
          .then(data => {
            // const isActive = bulb.classList.contains('active');
            bulb.classList.remove('error', 'outdated', 'active');
            if (Object.keys(data.valid).length) {
              bulb.title = `This segment is marked as proofread. ${menuText}`;
              bulb.classList.add('active');
              // We need to recreate the menu
              let cmenu = makeChangelogMenu(bulb, sid, bulb.dataset.dataset!);
              bulb.removeEventListener('click', <any>bulb.onclick);
              bulb.addEventListener('click', (event: MouseEvent) => {
                cmenu.show(<MouseEvent>{
                  clientX: event.clientX - 200,
                  clientY: event.clientY
                });
              });
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
    replaceIcons();

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
