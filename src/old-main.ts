// import {setupDefaultViewer} from 'neuroglancer/ui/default_viewer_setup';
import { DisplayContext } from 'third_party/neuroglancer/display_context';
import { StatusMessage } from 'third_party/neuroglancer/status';
import { bindDefaultCopyHandler, bindDefaultPasteHandler } from 'third_party/neuroglancer/ui/default_clipboard_handling';
import { setDefaultInputEventBindings } from 'third_party/neuroglancer/ui/default_input_event_bindings';
import { disableContextMenu, disableWheel } from 'third_party/neuroglancer/ui/disable_default_actions';
import { bindTitle } from 'third_party/neuroglancer/ui/title';
import { Viewer, ViewerOptions } from 'third_party/neuroglancer/viewer';

import { createApp } from 'vue';

// import 'neuroglancer/ui/default_viewer.css';


// import {makeDefaultViewer} from 'neuroglancer/ui/default_viewer';

class ExtendViewer extends Viewer {
  constructor(public display: DisplayContext) {
    super(display, {
      showLayerDialog: false,
      showUIControls: true,
      // defaultLayoutSpecification: ' xy-3d',
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
}

export function makeExtendViewer(options?: Partial<ViewerOptions>, target = document.getElementById('neuroglancer-container')! ) {
  options;
  console.log('options', options);
  try {
    let display = new DisplayContext(target);
    return new ExtendViewer(display);
  } catch (error) {
    StatusMessage.showMessage(`Error: ${error.message}`);
    throw error;
  }
}

export function makeDefaultViewer(options?: Partial<ViewerOptions>) {
  disableContextMenu();
  disableWheel();
  return makeExtendViewer(options);
}

export function setupDefaultViewer() {
  let viewer = (<any>window)['viewer'] = makeDefaultViewer();
  setDefaultInputEventBindings(viewer.inputEventBindings);

  // const hashBinding = viewer.registerDisposer(
  //     new UrlHashBinding(viewer.state, viewer.dataSourceProvider.credentialsManager, {
  //       defaultFragment: typeof NEUROGLANCER_DEFAULT_STATE_FRAGMENT !== 'undefined' ?
  //           NEUROGLANCER_DEFAULT_STATE_FRAGMENT :
  //           undefined
  //     }));
  // viewer.registerDisposer(hashBinding.parseError.changed.add(() => {
  //   const {value} = hashBinding.parseError;
  //   if (value !== undefined) {
  //     const status = new StatusMessage();
  //     status.setErrorMessage(`Error parsing state: ${value.message}`);
  //     console.log('Error parsing state', value);
  //   }
  //   hashBinding.parseError;
  // }));
  // hashBinding.updateFromUrlHash();
  viewer.registerDisposer(bindTitle(viewer.title));

  bindDefaultCopyHandler(viewer);
  bindDefaultPasteHandler(viewer);

  return viewer;
}

window.addEventListener('DOMContentLoaded', () => {
  // setupDefaultViewer();
  setupDefaultViewer;

const app = createApp({
  data() {
    return {
      count: 0
    }
  }
})

app.mount('#app')

  // console.log('app', app);
});
