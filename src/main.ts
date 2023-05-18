import {createApp} from 'vue';
import {createPinia} from 'pinia';

import 'neuroglancer/ui/default_viewer.css';

import App from 'components/App.vue';
import {Viewer, ViewerOptions} from 'neuroglancer/viewer';
import {setDefaultInputEventBindings} from 'third_party/neuroglancer/ui/default_input_event_bindings';
import {bindTitle} from 'third_party/neuroglancer/ui/title';
import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'third_party/neuroglancer/ui/default_clipboard_handling';
// import {disableContextMenu, disableWheel} from 'third_party/neuroglancer/ui/disable_default_actions';
import {DisplayContext} from 'third_party/neuroglancer/display_context';
import {StatusMessage} from 'third_party/neuroglancer/status';
import {makeDefaultViewer} from 'third_party/neuroglancer/ui/default_viewer';

class ExtendViewer extends Viewer {
  constructor(public display: DisplayContext) {
    super(display, {
      showLayerDialog: false,
      showUIControls: true,
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
}

export function makeExtendViewer(options?: Partial<ViewerOptions>, target = document.getElementById('neuroglancer-container')! ) {
  options;
  console.log('options', options);
  console.log('target', target);
  try {
    let display = new DisplayContext(target);
    return new ExtendViewer(display);
  } catch (error) {
    StatusMessage.showMessage(`Error: ${error.message}`);
    throw error;
  }
}

// function makeDefaultViewer(options?: Partial<ViewerOptions>) {
//   disableContextMenu();
//   disableWheel();
//   options;
//   return makeExtendViewer(options);
// }

function setupViewer() {
  console.log('seup viewer');
  const viewer = (<any>window)['viewer'] = makeDefaultViewer();
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

function mergeTopBars() {
  const ngTopBar = document.querySelector('.neuroglancer-viewer')!.children[0];
  console.log(ngTopBar);
  const topBarVueParent = document.getElementById('insertNGTopBar')!;
  console.log(topBarVueParent);
  topBarVueParent.appendChild(ngTopBar);
  // const buttons =
  //     ngTopBar.querySelectorAll('div.neuroglancer-icon-button:not(.unmerged)');
  // for (const button of buttons) {
  //   const htmlButton = <HTMLElement>button;
  //   const text = htmlButton.title;
  //   const click = () => htmlButton.click();
  //   storeProxy.actionsMenuItems.push({text: text, click: click});
  //   button.remove();
  // }
}

window.addEventListener('DOMContentLoaded', () => {
  const pinia = createPinia();
  const app = createApp(App);
  app.use(pinia);
  app.mount('#app');
  // setTimeout(() => {
    const viewer = setupViewer();
    viewer;
    mergeTopBars;
  // }, 1000);

  mergeTopBars();
  
  // mergeTopBars();
});
