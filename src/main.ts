require('neuroglancer/ui/default_viewer.css');
require('./main.css');

import 'neuroglancer/sliceview/chunk_format_handlers';

import {setDefaultInputEventBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {disableContextMenu, disableWheel} from 'neuroglancer/ui/disable_default_actions';
import {DisplayContext} from 'neuroglancer/display_context';
import {StatusMessage} from 'neuroglancer/status';
import {Viewer} from 'neuroglancer/viewer';

import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'neuroglancer/ui/default_clipboard_handling';
import {WhatsNewDialog} from 'neuroglancer/whats_new/whats_new';

import {setupVueApp} from './vueapp';
import {storeProxy} from './state';
import './config';

window.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  setupVueApp();
  setupViewer();
  mergeTopBars();
  newUserExperience();
  storeProxy.loadActiveDataset();
  storeProxy.loopUpdateLeaderboard();
});

export let viewer: Viewer|null = null;
export let config: Config;

async function loadConfig() {
  const configURL = 'src/config.json';
  config = await fetch(configURL).then(res => res.json());
}

function newUserExperience() {
  const newUser = !localStorage.getItem('ng-newuser');
  if (newUser && viewer) {
    localStorage.setItem('ng-newuser', '1');
    localStorage.setItem('neuroglancer-whatsnew', '1');
    let description = (require('../src/NEW_USER.md')) || '';
    return new WhatsNewDialog(viewer, description, {center: true});
  }
  return;
  // maybe defer?
}

function mergeTopBars() {
  const ngTopBar = document.getElementById('neuroglancerViewer')!.children[0];
  const topBarVueParent = document.getElementById('insertNGTopBar')!;
  topBarVueParent.appendChild(ngTopBar);
}

function setupViewer() {
  viewer = (<any>window)['viewer'] = makeExtendViewer();
  setDefaultInputEventBindings(viewer.inputEventBindings);

  viewer.loadFromJsonUrl();
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

import {authTokenShared} from 'neuroglancer/authentication/frontend';
import Config from './config';

class ExtendViewer extends Viewer {
  constructor(public display: DisplayContext) {
    super(display, {
      showLayerDialog: false,
      showUIControls: true,
      showPanelBorders: true,
    });

    authTokenShared!.changed.add(() => {
      storeProxy.fetchLoggedInUser();
    });
    storeProxy.fetchLoggedInUser();
  }

  promptJsonStateServer(message: string): void {
    let json_server_input =
        prompt(message, config.linkShortenerURL + '/nglstate/post');
    if (json_server_input !== null) {
      this.jsonStateServer.value = json_server_input;
    } else {
      this.jsonStateServer.reset();
    }
  }
}
