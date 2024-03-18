import {createApp} from 'vue';
import {createPinia} from 'pinia';

import 'neuroglancer/ui/default_viewer.css';

import App from 'components/App.vue';
import {useLayersStore} from 'src/store';
import {Viewer} from 'neuroglancer/viewer';
import {setDefaultInputEventBindings} from 'neuroglancer/ui/default_input_event_bindings';
import {bindDefaultCopyHandler, bindDefaultPasteHandler} from 'neuroglancer/ui/default_clipboard_handling';
import {disableContextMenu, disableWheel} from 'neuroglancer/ui/disable_default_actions';
import {DisplayContext} from 'neuroglancer/display_context';
import {StatusMessage} from 'neuroglancer/status';
import 'neuroglancer/sliceview/chunk_format_handlers';
import {ButtonService} from "./widgets/button_service";
import {AnnotationService, Point3D} from "./widgets/annotation_service";
import {UrlHashBinding} from "neuroglancer/ui/url_hash_binding";
import {bindTitle} from "neuroglancer/ui/title";
import {UserLayer, UserLayerConstructor, layerTypes} from "neuroglancer/layer";
import {Tool, restoreTool} from 'neuroglancer/ui/tool';
import {verifyObject, verifyObjectProperty, verifyString} from 'neuroglancer/util/json';
import {getLayerScales} from "./widgets/widget_utils.tx";
import {registerFreeRotateCubeAnnotationTool} from "./widgets/free_rotate_cube_annotation";

declare var NEUROGLANCER_DEFAULT_STATE_FRAGMENT: string|undefined;

type CustomBinding = {
  layer: string, tool: unknown, provider?: string,
}

type CustomBindings = {
  [key: string]: CustomBinding|string
};

declare const CUSTOM_BINDINGS: CustomBindings|undefined;
export const hasCustomBindings = typeof CUSTOM_BINDINGS !== 'undefined' && Object.keys(CUSTOM_BINDINGS).length > 0;

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
  // const viewer = setupDefaultViewer();
  initializeWithViewer(viewer);
  mergeTopBars();
  liveNeuroglancerInjection();
});

function setupViewer() {
  const viewer = (<any>window)['viewer'] = makeExtendViewer();
  setDefaultInputEventBindings(viewer.inputEventBindings);

  // borrowed from setupDefaultViewer()
  const bindNonLayerSpecificTool = (obj: unknown, toolKey: string, desiredLayerType: UserLayerConstructor, desiredProvider?: string) => {
    let previousTool: Tool<Object>|undefined;
    let previousLayer: UserLayer|undefined;
    if (typeof obj === 'string') {
      obj = {'type': obj};
    }
    verifyObject(obj);
    const type = verifyObjectProperty(obj, 'type', verifyString);
    viewer.bindAction(`tool-${type}`, () => {
      const acceptableLayers = viewer.layerManager.managedLayers.filter((managedLayer) => {
        const correctLayerType = managedLayer.layer instanceof desiredLayerType;
        if (desiredProvider && correctLayerType) {
          for (const dataSource of managedLayer.layer?.dataSources || []) {
            const protocol = viewer.dataSourceProvider.getProvider(dataSource.spec.url)[2];
            if (protocol === desiredProvider) {
              return true;
            }
          }
          return false;
        } else {
          return correctLayerType;
        }
      });
      if (acceptableLayers.length > 0) {
        const firstLayer = acceptableLayers[0].layer;
        if (firstLayer) {
          if (firstLayer !== previousLayer) {
            previousTool = restoreTool(firstLayer, obj);
            previousLayer = firstLayer;
          }
          if (previousTool) {
            viewer.activateTool(toolKey, previousTool);
          }
        }
      }
    });
  }

  if (hasCustomBindings) {
    for (const [key, val] of Object.entries(CUSTOM_BINDINGS!)) {
      if (typeof val === 'string') {
        viewer.inputEventBindings.global.set(key, val);
      } else {
        viewer.inputEventBindings.global.set(key, `tool-${val.tool}`);
        const layerConstructor = layerTypes.get(val.layer);
        if (layerConstructor) {
          const toolKey = key.charAt(key.length - 1).toUpperCase();
          bindNonLayerSpecificTool(val.tool, toolKey, layerConstructor, val.provider);
        }
      }
    }
  }

  const hashBinding = viewer.registerDisposer(
      new UrlHashBinding(viewer.state, viewer.dataSourceProvider.credentialsManager, {
        defaultFragment: typeof NEUROGLANCER_DEFAULT_STATE_FRAGMENT !== 'undefined' ?
            NEUROGLANCER_DEFAULT_STATE_FRAGMENT :
            undefined
      }));
  viewer.registerDisposer(hashBinding.parseError.changed.add(() => {
    const {value} = hashBinding.parseError;
    if (value !== undefined) {
      const status = new StatusMessage();
      status.setErrorMessage(`Error parsing state: ${value.message}`);
      console.log('Error parsing state', value);
    }
    hashBinding.parseError;
  }));
  hashBinding.updateFromUrlHash();
  viewer.registerDisposer(bindTitle(viewer.title));

  bindDefaultCopyHandler(viewer);
  bindDefaultPasteHandler(viewer);

  registerFreeRotateCubeAnnotationTool();

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

function observeSegmentSelect(targetNode: Element) {
  const viewer: ExtendViewer = (<any>window)['viewer'];
  const buttonService = viewer.buttonService;
  const annotationService = viewer.annotationService;
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
  console.log(dataset)
  const updateSegmentSelectItem = function(item: HTMLElement) {
    if (item.classList) {
      let buttonList: Element|HTMLElement[] = [];
      if (item.classList.contains("neuroglancer-segment-list-entry")) {
        buttonList = [item];
      }
      buttonList.forEach(item => {
        const segmentIDString =
            item.getAttribute('data-id');
        if (segmentIDString) {
          let button = item.querySelector('.nge-segment-button.menu');
          if (button == null) {
            button = buttonService.createButton(segmentIDString, dataset);
            button.classList.add('error')
            item.appendChild(button);
            (<HTMLButtonElement>button).title = 'Click for opening context menu';
          }
        }
      })
    }
  };

  const updateSelectionDetailsBody = function(item: HTMLElement) {
    if (item.classList) {
      let selectionList: Element|HTMLElement[] = [];
      if (item.classList.contains("neuroglancer-annotation-list-entry")) {
        selectionList = [item];
      }
      selectionList.forEach(item => {
        const positionGrid = item.querySelector(".neuroglancer-annotation-position")
        const isDataBounds = item.querySelector(".neuroglancer-annotation-description")?.textContent === "Data Bounds" ? true : false;

        if (positionGrid && !isDataBounds) {
          const icon = item.querySelector(".neuroglancer-annotation-icon")?.textContent;
          let type = "unknown";
          if (icon == '❑') { // box
            type = 'box';
          } else if (icon == 'ꕹ') { // line
            type = "line";
          } else if (icon == '⚬') { // point
            type = "point";
          } else if (icon == '◎') { // ellipsoid
            type = "ellipsoid";
          }
          const coordElements = item.querySelectorAll(' .neuroglancer-annotation-coordinate');
          let coordinates: Point3D[] = [];

          for (let i = 0; i < coordElements?.length; i += 3){
            const dimCoord: Point3D = {
              x: coordElements[i].textContent?.trim() || '',
              y: coordElements[i+1].textContent?.trim() || '',
              z: coordElements[i+2].textContent?.trim() || ''
            }
            coordinates.push(dimCoord)
          }

          let distance = item.querySelector(".nge-selected-annotation.distance")
          if (distance == null) {
            const viewer: ExtendViewer = (<any>window)['viewer'];
            const scales = getLayerScales(viewer.coordinateSpace)
            distance = annotationService.calculateDistance(type, coordinates, scales);
            item.appendChild(distance);
          }
        }
      })
    }
  }

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
      mutation.addedNodes.forEach(updateSelectionDetailsBody)
    });
  };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(detectMutation);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);

  // Convert existing items
  targetNode.querySelectorAll('.neuroglancer-segment-list-entry').forEach(updateSegmentSelectItem);
  targetNode.querySelectorAll('.neuroglancer-annotation-list-entry').forEach(updateSelectionDetailsBody);
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
  annotationService = new AnnotationService();
  constructor(public display: DisplayContext) {
    super(display, {
      showLayerDialog: false,
      showUIControls: true,
      showPanelBorders: true,
      // defaultLayoutSpecification: 'xy-3d',
      // minSidePanelSize: 310
    });
  }
    // storeProxy.loadedViewer = true;
    // authTokenShared!.changed.add(() => {
    //   storeProxy.fetchLoggedInUser();
    // });
    // storeProxy.fetchLoggedInUser();

    // if (!this.jsonStateServer.value) {
    //   this.jsonStateServer.value = config.linkShortenerURL;
    // }


  // promptJsonStateServer(message: string): void {
  //   let json_server_input = prompt(message, config.linkShortenerURL);
  //   if (json_server_input !== null) {
  //     this.jsonStateServer.value = json_server_input;
  //   } else {
  //     this.jsonStateServer.reset();
  //   }
  // }
}
