import {createApp} from 'vue';
import {createPinia} from 'pinia';

import 'neuroglancer/ui/default_viewer.css';
import './widgets/lightbulb_menu.css';

import App from 'components/App.vue';
import {useLayersStore, useSegmentAnnotationStore, useSplitMergeOverlayStore, useVolumesStore} from 'src/store';
import {useStatsStore} from './store-pyr';
import {exitGrapheneTool} from './widgets/graphene_tool_utils';
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
import {getLayerScales} from "./widgets/widget_utils";
import {registerFreeRotateCubeAnnotationTool} from "./widgets/free_rotate_cube_annotation";

declare var NEUROGLANCER_DEFAULT_STATE_FRAGMENT: string|undefined;

type CustomBinding = {
  layer: string, tool: unknown, provider?: string,
}

type CustomBindings = {
  [key: string]: CustomBinding|string
};

declare const CUSTOM_BINDINGS: CustomBindings|undefined;

declare const DATASETS: { [key: string]: string};
export const hasCustomBindings = typeof CUSTOM_BINDINGS !== 'undefined' && Object.keys(CUSTOM_BINDINGS).length > 0;

function mergeTopBars() {
  const ngTopBar = document.querySelector('.neuroglancer-viewer')!.children[0];
  const topBarVueParent = document.getElementById('insertNGTopBar')!;
  topBarVueParent.appendChild(ngTopBar);
}

/* ── Neuron Favicon (data-URI SVG) ── */
function injectNeuronFavicon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%">
<feGaussianBlur stdDeviation="1.2"/></filter></defs>
<rect width="32" height="32" rx="6" fill="#0a1223"/>
<g filter="url(#g)" opacity="0.7">
<path d="M16 14 L15.5 10 L15 6 L14 3" stroke="#18cfff" stroke-width="1.8" stroke-linecap="round" fill="none"/>
<path d="M15 6 L12 4" stroke="#15c8f8" stroke-width="1" stroke-linecap="round" fill="none"/>
<path d="M15 6 L18 3.5" stroke="#15c8f8" stroke-width="1" stroke-linecap="round" fill="none"/>
<path d="M15.5 10 L19 8 L22 7" stroke="#12c0f0" stroke-width="0.9" stroke-linecap="round" fill="none"/>
<path d="M15.5 10 L12 8 L9 7.5" stroke="#12c0f0" stroke-width="0.9" stroke-linecap="round" fill="none"/>
<path d="M14 16 L10 18 L6 22 L4 26" stroke="#18cfff" stroke-width="1.4" stroke-linecap="round" fill="none"/>
<path d="M6 22 L4 20" stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" fill="none"/>
<path d="M18 16 L22 18 L26 22 L28 26" stroke="#18cfff" stroke-width="1.4" stroke-linecap="round" fill="none"/>
<path d="M26 22 L28 20" stroke="#10b8e8" stroke-width="0.8" stroke-linecap="round" fill="none"/>
<path d="M15 16 L11 14" stroke="#15c8f8" stroke-width="1" stroke-linecap="round" fill="none"/>
<path d="M17 16 L21 14" stroke="#15c8f8" stroke-width="1" stroke-linecap="round" fill="none"/>
<path d="M16 17 L16 22 L15 27 L14.5 30" stroke="#18cfff" stroke-width="1.2" stroke-linecap="round" fill="none"/>
<path d="M15 27 L12 28" stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" fill="none"/>
<path d="M15 27 L17 29" stroke="#08a0d0" stroke-width="0.6" stroke-linecap="round" fill="none"/>
</g>
<ellipse cx="16" cy="15.5" rx="2.8" ry="2.4" fill="#20d0ff" opacity="0.9" filter="url(#g)"/>
<ellipse cx="16" cy="15.5" rx="1.4" ry="1.2" fill="#b0f8ff" opacity="0.7"/>
</svg>`;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  document.head.appendChild(link);
  // Also set the page title
  document.title = 'EyeWire II — neuroglancer';
}

window.addEventListener('DOMContentLoaded', () => {
  injectNeuronFavicon();
  const pinia = createPinia();
  const app = createApp(App);
  app.use(pinia);
  const {initializeWithViewer} = useLayersStore();
  const {loadVolumes} = useVolumesStore();
  app.directive('visible', function(el, binding) {
    el.style.visibility = !!binding.value ? 'visible' : 'hidden';
  });
  app.mount('#app');
  const viewer = setupViewer();
  // const viewer = setupDefaultViewer();
  initializeWithViewer(viewer);
  loadVolumes(viewer);
  mergeTopBars();
  liveNeuroglancerInjection();

  const {loopUpdateLeaderboard} = useStatsStore();
  loopUpdateLeaderboard();

  // Auto-select segmentation layer after viewer loads (fallback for when
  // LoginModal doesn't fire — e.g. already authenticated or bypass).
  autoSelectSegLayer(viewer);

  // Escape key handler: exit split/merge tools
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const store = useSplitMergeOverlayStore();
    // Check both store state AND DOM for tool presence (DOM is ground truth)
    const toolDomPresent = document.querySelector('.graphene-multicut') || document.querySelector('.graphene-merge-segments');
    if (!store.toolActive && !toolDomPresent) return;
    exitGrapheneTool();
    // Also sync store if DOM showed the tool
    if (toolDomPresent && !store.toolActive) {
      store.setToolState(null);
    }
    e.preventDefault();
    e.stopPropagation();
  }, true); // capture phase to catch before NG
});

/**
 * Try to select the segmentation layer and open the Seg. tab.
 * Retries a few times since layers may still be initializing.
 */
function autoSelectSegLayer(viewer: any, attempt = 0) {
  if (attempt > 5) return; // give up after ~10s
  setTimeout(() => {
    try {
      // Don't override if user already selected a layer
      if (viewer.selectedLayer.layer && viewer.selectedLayer.visible) return;

      const segLayer = viewer.layerManager.managedLayers.find(
        (l: any) => {
          const typeName = l.layer?.constructor?.name ?? '';
          if (typeName.includes('Segmentation')) return true;
          const url = l.layer?.dataSources?.[0]?.spec?.url ?? '';
          return url.includes('graphene') || url.includes('segmentation');
        },
      );
      if (!segLayer) {
        autoSelectSegLayer(viewer, attempt + 1);
        return;
      }
      viewer.selectedLayer.layer = segLayer;
      viewer.selectedLayer.visible = true;

      // Click the Seg. tab after panel renders
      setTimeout(() => {
        const tabs = document.querySelectorAll(
          '.neuroglancer-layer-side-panel-tab, .neuroglancer-tab-label, [data-tab]'
        );
        for (const tab of tabs) {
          const text = tab.textContent?.trim();
          if (text === 'Seg.' || text === 'Seg' || text === 'Segments') {
            (tab as HTMLElement).click();
            return;
          }
        }
      }, 600);
    } catch { autoSelectSegLayer(viewer, attempt + 1); }
  }, 2000 * (attempt + 1)); // 2s, 4s, 6s, 8s, 10s
}

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

/** Injects a small pip legend below the segment list (once). */
function injectSegmentLegend() {
  // Find the segment list container — the scrollable parent of segment entries
  const entry = document.querySelector('.neuroglancer-segment-list-entry');
  if (!entry) return;
  const listContainer = entry.closest('.neuroglancer-segment-list')
      ?? entry.parentElement;
  if (!listContainer || listContainer.querySelector('.nge-seg-legend')) return;

  const legend = document.createElement('div');
  legend.className = 'nge-seg-legend';
  legend.innerHTML =
    '<span class="nge-seg-legend-item"><span class="nge-legend-pip nge-legend-pip--complete"></span>Done</span>' +
    '<span class="nge-seg-legend-item"><span class="nge-legend-pip nge-legend-pip--annotated"></span>Labeled</span>' +
    '<span class="nge-seg-legend-item"><span class="nge-legend-pip nge-legend-pip--incomplete"></span>Todo</span>';
  listContainer.appendChild(legend);
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

  // Derives the CAVE server base URL from the active layers, with fallback
  // to per-dataset config and global override. Keeps UI buttons working even
  // when the layer URL lacks a middleauth+ prefix (e.g. in dev).
  const getLocalServerURL = (): string => {
    const {getCaveServerUrl} = useLayersStore();
    return getCaveServerUrl();
  };

  const updateSegmentSelectItem = function(item: HTMLElement) {
    if (item.classList) {
      let buttonList: Element|HTMLElement[] = [];
      if (item.classList.contains("neuroglancer-segment-list-entry")) {
        buttonList = [item];
      }
      const localServerURL = getLocalServerURL();
      buttonList.forEach(item => {
        const segmentIDString =
            item.getAttribute('data-id');
        if (segmentIDString) {
          // Track this as the active segment for the annotation panel
          useSegmentAnnotationStore().setActiveSegId(segmentIDString, localServerURL);

          let button = item.querySelector('.nge-segment-button.menu');
          if (button == null) {
            const viewer: ExtendViewer = (<any>window)['viewer'];
            const layerName = viewer.selectedLayer.layer?.name || 'default';
            const dataset = (typeof DATASETS !== 'undefined' && DATASETS) ? (DATASETS[layerName] ?? '') : '';

            button = buttonService.createButton(localServerURL, segmentIDString, dataset);
            button.classList.add('error')
            item.appendChild(button);
            (<HTMLButtonElement>button).title = 'Click for opening context menu';
            // Inject a placeholder badge immediately; it will be updated once the
            // async CAVE status fetch completes inside _refreshButtonStatus.
            buttonService.updateLabelBadge(item as HTMLElement, null);
          }

          // Clean up any leftover nickname labels (feature removed)
          const nameLabel = item.querySelector('.nge-segment-nickname');
          if (nameLabel) nameLabel.remove();
          const idSpan = item.querySelector('.neuroglancer-segment-list-entry-id') as HTMLElement | null;
          if (idSpan) idSpan.classList.remove('nge-id-collapsed');
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
      mutation.addedNodes.forEach(node => {
        updateSegmentSelectItem(node as HTMLElement);
        // Also process any segment entries nested inside a newly-added container
        // (the whole panel can be added at once, so the entry itself may not be
        //  a direct addedNode).
        if ((node as Element).querySelectorAll) {
          (node as Element)
              .querySelectorAll('.neuroglancer-segment-list-entry')
              .forEach(el => updateSegmentSelectItem(el as HTMLElement));
        }
      });
      mutation.addedNodes.forEach(node => {
        updateSelectionDetailsBody(node as HTMLElement);
        if ((node as Element).querySelectorAll) {
          (node as Element)
              .querySelectorAll('.neuroglancer-annotation-list-entry')
              .forEach(el => updateSelectionDetailsBody(el as HTMLElement));
        }
      });
    });
    // Inject the status legend after the segment list when segments are present
    injectSegmentLegend();
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
  observeSplitMergeTools();
}

/**
 * Watch for graphene multicut / merge tool activation in neuroglancer's DOM.
 * Updates useSplitMergeOverlayStore so Vue components can react.
 */
function observeSplitMergeTools() {
  const store = useSplitMergeOverlayStore();
  let rafId: number | null = null;
  // Track previous merge statuses so we only fire flash on change
  let prevMergeStatuses: string[] = [];
  // Track previous point counts for multicut submit detection
  let prevSinkCount = 0;
  let prevSourceCount = 0;
  let wasMulticutActive = false;
  let wasMergeActive = false;
  let hadPointsPlaced = false;
  let multicutOpenTime = 0;

  // Track NG status bar messages to capture split/merge errors
  let lastStatusText = '';
  let lastStatusTime = 0;
  const STATUS_COOLDOWN_MS = 3000;

  /** Scan #statusContainer for split/merge related errors/info */
  function checkStatusMessages() {
    if (!store.toolActive && !store.pendingClose) return;
    if (store.resultFlash) return; // already showing a result

    const statusContainer = document.getElementById('statusContainer');
    if (!statusContainer) return;

    for (const child of Array.from(statusContainer.children)) {
      const el = child as HTMLElement;
      if (el.style.display === 'none') continue;

      const text = el.textContent?.trim() || '';
      if (!text) continue;

      // Cooldown: don't re-trigger same message within window
      if (text === lastStatusText && Date.now() - lastStatusTime < STATUS_COOLDOWN_MS) continue;

      const lower = text.toLowerCase();
      // Only capture messages related to split/merge operations
      const isRelevant = lower.includes('split') || lower.includes('merge') ||
        lower.includes('multicut') || lower.includes('supervoxel') ||
        lower.includes('segment');
      if (!isRelevant) continue;

      const cleanText = text.replace(/\s*dismiss\s*$/i, '').trim();
      lastStatusText = text;
      lastStatusTime = Date.now();

      if (lower.includes('failed') || lower.includes('error')) {
        store.showResult('error', cleanText, 6000);
        store.submitting = false;
      }
      return; // one message per scan cycle
    }
  }

  function scanToolState() {
    // Don't scan during success-hold close animation
    if (store.pendingClose) return;

    const multicutEl = document.querySelector('.graphene-multicut');
    const mergeEl = document.querySelector('.graphene-merge-segments');

    if (multicutEl) {
      store.setToolState('multicut');

      // Detect active group from the indicator div
      const indicator = multicutEl.querySelector('.activeGroupIndicator');
      if (indicator) {
        store.setActiveGroup(indicator.classList.contains('blueGroup') ? 'blue' : 'red');
      }

      // Read point counts from internal multicut state (sinks = red, sources = blue)
      const viewer: any = (<any>window)['viewer'];
      let gotInternalCounts = false;
      try {
        const segLayer = viewer?.selectedLayer?.layer?.layer;
        const gc = segLayer?.graphConnection?.value;
        if (gc?.state?.multicutState) {
          const ms = gc.state.multicutState;
          const sinkCount = ms.sinks?.size ?? 0;
          const sourceCount = ms.sources?.size ?? 0;
          store.updatePointCounts(sinkCount, sourceCount);
          if (sinkCount > 0 || sourceCount > 0) hadPointsPlaced = true;
          gotInternalCounts = true;

          // Detect submit: points reset to 0 means user submitted
          if (wasMulticutActive &&
              (prevSinkCount > 0 || prevSourceCount > 0) &&
              sinkCount === 0 && sourceCount === 0) {
            store.submitting = true;
            store.setStatusMessage('Submitting split...');
          }
          prevSinkCount = sinkCount;
          prevSourceCount = sourceCount;
        }
      } catch { /* fallback below */ }

      // Fallback: detect points from DOM if internal state access failed
      if (!gotInternalCounts) {
        const annotations = multicutEl.querySelectorAll('[class*="annotation"], [class*="point"], circle, .neuroglancer-annotation-layer-view');
        if (annotations.length > 0) hadPointsPlaced = true;
        // Also check if the multicut UI shows any point count text
        const text = multicutEl.textContent || '';
        if (/\d+\s*(source|sink|point)/i.test(text)) hadPointsPlaced = true;
      }

      if (!wasMulticutActive) multicutOpenTime = Date.now();
      wasMulticutActive = true;
      wasMergeActive = false;

    } else if (mergeEl) {
      store.setToolState('merge');
      wasMulticutActive = false;
      wasMergeActive = true;

      // Count merge submissions
      const submissions = mergeEl.querySelectorAll('.graphene-merge-segments-submission');
      store.mergeSubmissionCount = submissions.length;

      // Scrape per-submission status from .graphene-merge-segments-submission-status
      const statusEls = mergeEl.querySelectorAll('.graphene-merge-segments-submission-status');
      const currentStatuses: string[] = [];
      statusEls.forEach(el => {
        const text = (el.textContent || '').trim();
        if (text) currentStatuses.push(text);
      });

      // Detect new status changes
      if (currentStatuses.length > 0) {
        const latest = currentStatuses[currentStatuses.length - 1];
        const prevLatest = prevMergeStatuses.length > 0
          ? prevMergeStatuses[prevMergeStatuses.length - 1] : '';

        if (latest !== prevLatest) {
          const lower = latest.toLowerCase();
          if (lower === 'trying...' || lower === 'trying') {
            store.submitting = true;
            store.setStatusMessage('Merging segments...');
          } else if (lower === 'done') {
            store.showResult('success', 'Merge complete', 1500);
          } else if (latest && lower !== 'trying...' && lower !== 'done') {
            store.showResult('error', `Merge failed: ${latest}`, 5000);
          }
        }
      }
      prevMergeStatuses = currentStatuses;

    } else {
      // Tool DOM disappeared
      if (wasMulticutActive) {
        // Tool was open long enough that user likely placed points and submitted,
        // even if we couldn't detect points via internal state
        const toolWasUsed = store.submitting || hadPointsPlaced ||
          (Date.now() - multicutOpenTime > 3000);
        if (toolWasUsed) {
          // Had points placed and tool disappeared — likely submitted
          store.beginSuccessClose('Split complete');
        } else {
          // No points were ever placed — cancelled immediately
          store.setToolState(null);
        }
        wasMulticutActive = false;
        hadPointsPlaced = false;
      } else if (wasMergeActive) {
        // Merge tool exited — just close silently
        // (merge successes/errors were already shown inline during session)
        store.setToolState(null);
        wasMergeActive = false;
      } else {
        store.setToolState(null);
      }
      prevSinkCount = 0;
      prevSourceCount = 0;
      hadPointsPlaced = false;
      prevMergeStatuses = [];
      lastStatusText = '';
    }

    // Check NG status bar for errors during tool use
    checkStatusMessages();
  }

  // Debounce with requestAnimationFrame to avoid thrashing
  function debouncedScan() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      scanToolState();
    });
  }

  // Observe the entire content area for tool status changes
  const container = document.querySelector('#content') || document.body;
  const observer = new MutationObserver(debouncedScan);
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // Also poll periodically for point-count updates (annotations added
  // inside the tool don't always trigger DOM mutations we can observe)
  setInterval(scanToolState, 500);
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
      // minSidePanelSize: 310  // not in ViewerOptions type
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
