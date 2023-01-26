import {ImageUserLayer} from 'neuroglancer/image_user_layer';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {StatusMessage} from 'neuroglancer/status';
import {vec3} from 'neuroglancer/util/geom';
import {Uint64} from 'neuroglancer/util/uint64';
import {action, createModule} from 'vuex-class-component';

import {CellDescription, ImageLayerDescription, SegmentationLayerDescription, Vector3} from './config';
import {config} from './main';
import {getLayerPanel, viewer} from './state';
import {packColor} from 'neuroglancer/util/color';

export function getLayerByName(name: string) {
  if (!viewer) {
    return undefined;
  }

  const layers = viewer.layerManager.managedLayers;

  for (let layer of layers) {
    if (layer.name === name) {
      return layer;
    }
  }

  return undefined;
}

export class LayerState extends createModule
({
  strict: false,
  enableLocalWatchers: true,
}) {
  activeImageLayer: ImageLayerDescription|null = null;
  activeSegmentationLayer: SegmentationLayerDescription|null = null;
  activeCells: CellDescription[] = [];

  @action
  async loadActiveDataset() {
    const numberOfLayers = viewer!.layerManager.managedLayers.length;

    if (numberOfLayers > 0) {
      const firstImageLayerName =
          viewer!.layerManager.managedLayers[0].name.split('-')[0];
      for (let layer of config.imageLayers) {
        if (layer.name === firstImageLayerName) {
          this.activeImageLayer = layer;
          break;
        }
      }
      const firstSegmentationLayerName =
          viewer!.layerManager.managedLayers[1].name.split('-')[0];
      for (let layer of config.segmentationLayers) {
        if (layer.name === firstSegmentationLayerName) {
          this.activeSegmentationLayer = layer;
          break;
        }
      }
    } else {
      // load sandbox with default view state
      if (config.segmentationLayers.length) {
        viewer!.layerManager.clear();
        await this.selectImageLayer(config.imageLayers[0]);
        this.selectSegmentationLayer(config.segmentationLayers[0]);
      } else {
        StatusMessage.showTemporaryMessage(
            `There are no datasets available.`, 10000, {color: 'yellow'});
      }
    }

    const layers = viewer!.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        console.log('root segments callback 2');
        layer.displayState.rootSegments.changed.add(() => {
          console.log('root segments changed! 2');
          this.refreshActiveCells();
        });
        this.refreshActiveCells();
      }
    }
  }

  @action
  async refreshActiveCells() {
    if (!viewer) {
      return false;
    }

    if (!this.activeSegmentationLayer ||
        !this.activeSegmentationLayer.curatedCells) {
      return false;
    }

    const layers = viewer.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        let changes = false;
        // await layer.multiscaleSource!;

        console.log('clearing active cells!');
        this.activeCells = [];

        console.log('---- checking active');

        console.log('active roots', layer.displayState.rootSegments);

        for (let segment of layer.displayState.rootSegments) {
          console.log('we have a segment: ', segment.toString());
          for (let cell of this.activeSegmentationLayer.curatedCells) {
            if (segment.toString() === cell.id) {
              console.log('segment confirmed curated', cell.id);
              this.activeCells.push(cell);
              changes = true;
            }
          }
        }

        if (changes) {
          // force update
          // this.activeCells = this.activeCells;
        }

        return true;
      }
    }

    return false;
  }

  @action
  async selectActiveLayer(name: string) {
    const layerPanel = getLayerPanel(viewer!)!;
    const layer = getLayerByName(name);
    if (layer) {
      layerPanel.selectedLayer.layer = layer;
    }
  }

  @action
  async selectImageLayer(layer: ImageLayerDescription) {
    if (!viewer) {
      return false;
    }

    if (this.activeImageLayer === layer) {
      return true;
    }

    this.activeImageLayer = layer;
    return this.selectLayer(layer);
  }

  @action
  async selectSegmentationLayer(layer: SegmentationLayerDescription) {
    if (!viewer) {
      return false;
    }

    this.activeSegmentationLayer = layer;
    return this.selectLayer(layer);
  }

  getSegmentationUserLayer() {
    if (!viewer) {
      return;
    }
    const layer = this.activeSegmentationLayer!;
    const layerName = layer.layerName!;
    const layerWithSpec = viewer.layerSpecification.getLayer(layerName, layer);
    const addedLayer = layerWithSpec.layer;

    if (addedLayer instanceof SegmentationUserLayer) {
      return addedLayer;
    }
    return;
  }

  @action
  async set2dPosition({x, y, z}: Vector3) {
    if (viewer) {
      viewer.navigationState.position.setVoxelCoordinates(
          vec3.fromValues(x, y, z));
      // viewer.navigationState.position.spatialCoordinatesValid = false; //
      // TODO what was this for? seems to cause issues
    }
  }

  @action
  async resetViewer() {
    if (!viewer) {
      return false;
    }
    viewer.navigationState.reset();
    viewer.perspectiveNavigationState.reset();
    return true;
  }

  @action
  async selectLayer(layer: ImageLayerDescription|SegmentationLayerDescription) {
    if (!viewer) {
      return false;
    }

    if (layer.defaultPosition) {
      this.set2dPosition(layer.defaultPosition);
    }
    if (layer.defaultPerspectiveZoomFactor !== undefined) {
      viewer.perspectiveNavigationState.zoomFactor.value =
          layer.defaultPerspectiveZoomFactor;
    }

    const layerName =
        layer.layerName ? layer.layerName : `${layer.name}-${layer.type}`;

    let replacedLayer;
    let replacedLayerPos = 0;
    for (const existingLayer of viewer.layerManager.managedLayers) {
      if ((existingLayer.layer instanceof ImageUserLayer) ===
          (layer.type === 'image')) {
        replacedLayer = existingLayer;
        break;
      }
      replacedLayerPos++;
    }

    const layerWithSpec = viewer.layerSpecification.getLayer(layerName, layer);
    viewer.layerManager.addManagedLayer(layerWithSpec, replacedLayerPos);

    const addedLayer = layerWithSpec.layer;

    if (addedLayer instanceof ImageUserLayer) {
      await addedLayer.multiscaleSource;  // wait because there is an error if
                                          // both layers load at the same time?
    } else if (addedLayer instanceof SegmentationUserLayer) {
      this.selectActiveLayer(layerName);
      if ('curatedCells' in layer && layer.curatedCells) {
        for (let cell of layer.curatedCells) {
          if (cell.default) {
            this.selectCell(cell);
          }
        }
      }

      await addedLayer.multiscaleSource;
      addedLayer.displayState.rootSegments.changed.add(() => {
        this.refreshActiveCells();
      });
      this.refreshActiveCells();
    }

    if (replacedLayer) {
      viewer.layerManager.removeManagedLayer(replacedLayer);
    }
    // viewer.layerManager.reorderManagedLayer(viewer.layerManager.managedLayers.length
    // - 1, replacedLayerPos);

    viewer.differ.purgeHistory();
    viewer.differ.ignoreChanges();
    return true;
  }

  @action
  async clearSelectedCells() {
    if (!viewer) {
      return false;
    }

    const layers = viewer.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        if (layer.volumePath && layer.volumePath.startsWith("precomputed://gs://flywire_neuropil_meshes/")) {
          continue;
        }
        layer.displayState.rootSegments.clear();
      }
    }

    return true;
  }

  @action
  async selectCell(cell: CellDescription) {
    if (!viewer) {
      return false;
    }

    const layers = viewer.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        layer.displayState.rootSegments.add(
            new Uint64().parseString(cell.id, 10));
        return true;
      }
    }

    return false;
  }

  @action
  async toggleBrainMesh() {
    if (!viewer) {
      return false;
    }
    const layerName = config.brainMeshURL.split("/").pop()!;
    const brainMeshLayer = getLayerByName(layerName);
    if (brainMeshLayer) {
      viewer.layerManager.removeManagedLayer(brainMeshLayer);
    }
    else {
      const layerWithSpec = viewer.layerSpecification.getLayer(layerName, config.brainMeshURL);
      viewer.layerManager.addManagedLayer(layerWithSpec);
      layerWithSpec.readyStateChanged.add(() => {
        if (layerWithSpec.isReady()) {
          const layer = layerWithSpec.layer;
          if (layer instanceof SegmentationUserLayer) {
            layer.displayState.rootSegments.add(Uint64.ONE);
            const dark = viewer!.perspectiveViewBackgroundColor.value[0] === 0;
            layer.displayState.objectAlpha.value = dark ? config.brainMeshOpacityDark : config.brainMeshOpacityLight;
            const segmentColor = new Uint64(packColor(vec3.fromValues(0.5, 0.5, 0.5)));
            layer.displayState.segmentStatedColors.set(Uint64.ONE, segmentColor);
          }
        }
      });
    }
    return true;
  }
}