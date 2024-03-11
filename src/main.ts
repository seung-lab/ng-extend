import {createApp} from 'vue';
import {createPinia} from 'pinia';

import 'neuroglancer/ui/default_viewer.css';
import {formatScaleWithUnit} from "neuroglancer/util/si_units";

import App from 'components/App.vue';
import {useLayersStore} from 'src/store';
import {Viewer} from 'neuroglancer/viewer';
import {DisplayContext} from 'neuroglancer/display_context';
import {setupDefaultViewer} from 'third_party/neuroglancer/ui/default_viewer_setup';
import { LightBulbService, Point3D } from './widgets/lightbulb_service';

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
  const viewer = setupDefaultViewer();
  initializeWithViewer(viewer);
  liveNeuroglancerInjection();
  mergeTopBars();
});





function liveNeuroglancerInjection() {
  const watchNode = document.querySelector("#content");
  if(!watchNode) {
    return;
  }
  observeSegmentSelect(watchNode);
}

function observeSegmentSelect(targetNode : Element) {
  const viewer : ExtendViewer = (<any>window)['viewer'];
  const bulbService : LightBulbService = viewer.lightBulbService;
  const annotationService : AnnotationService = viewer.annotationService;

  if(!targetNode) {
    return;
  }

  const config = {childList: true, subtree: true};
  let datasetElement = (<HTMLElement>targetNode.querySelector('.neuroglancer-layer-item-label'));
  let dataset = ""
  if (dataset) {
    dataset = datasetElement.innerText;
  }

  const updateSegmentSelectItem = function(item: HTMLElement) {
    if(item.classList) {
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
            button = bulbService.createButton(segmentIDString, dataset);
            button.classList.add('error')
            item.appendChild(button);
            (<HTMLButtonElement>button).title = 'Click for opening context menu';
          }
        }
      })
    }
  }

  const getLayerScales = (coordinateSpace: any) => {
    let scales = new Float32Array(coordinateSpace.value?.scales.length);

    for (let i=0; i < coordinateSpace.value?.scales.length; i++) {
        const {scale} = formatScaleWithUnit(coordinateSpace.value?.scales[i], coordinateSpace.value?.units[i])
        scales[i] = parseFloat(scale);
    }
    return scales
  }

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
          const coordElements = item.querySelectorAll('.neuroglancer-annotation-coordinate');
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
            distance = annotationService.calculateDistance(coordinates, scales);
            item.appendChild(annotationService.calculateDistance(coordinates, scales));
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




export class ExtendViewer extends Viewer{
  lightBulbService = new LightBulbService();
  annotationService = new AnnotationService();

  constructor(public display: DisplayContext) {
    super(display, {showLayerDialog: false, showUIControls: true, showPanelBorders: true})
  }
}


function calculateDistance(coordinates: Point3D[], scales: Float32Array): string {
  const point1: Point3D = coordinates[0];
  const point2: Point3D = coordinates[1];
  // Ignore the Z coordinate for XY plane distance
  const dx = scales[0] * (Number(point2.x) - Number(point1.x));
  const dy = scales[1] *(Number(point2.y) - Number(point1.y));
  const dz = scales[2] *(Number(point2.z) - Number(point1.z));

  // Calculate the distance using the Pythagorean theorem
  const distanceXY = Math.sqrt(dx * dx + dy * dy).toFixed(2);
  const distanceYZ: string = Math.sqrt(dy * dy + dz * dz).toFixed(2);
  const distanceZX: string = Math.sqrt(dz * dz + dx * dx).toFixed(2);

  return `Distance\nXY: ${distanceXY}nm, YZ: ${distanceYZ}nm, ZX: ${distanceZX}nm`;
}


export class AnnotationService {
  calculateDistance(coordinates: Point3D[], scales: Float32Array) {
      const distance = document.createElement('div');
      distance.className = 'nge-selected-annotation distance';
      distance.style.gridColumn = 'dim / -1';
      distance.style.textOverflow = 'ellipsis';
      if (coordinates.length == 2) {
          distance.innerText = calculateDistance(coordinates, scales)
      }
      return distance;
  }


}
