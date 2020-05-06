import {authFetch, authTokenShared} from 'neuroglancer/authentication/frontend';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {ImageUserLayer} from 'neuroglancer/image_user_layer';
import {SingletonLayerGroupViewer} from 'neuroglancer/layer_groups_layout';
import {StatusMessage} from 'neuroglancer/status';
import {Uint64} from 'neuroglancer/util/uint64';
import {vec3} from 'neuroglancer/util/geom';
import {Viewer} from 'neuroglancer/viewer';
import {config} from './main';

import {action, createModule, createProxy, extractVuexModule} from 'vuex-class-component';

interface LoggedInUser {
  name: string;
  email: string;
}

interface LayerDescription {
  source: string,
  type: 'image'|'segmentation'|'segmentation_with_graph',
  name?: string,
  defaultSelected?: boolean,
}

export interface DatasetDescription {
  name: string, layers: LayerDescription[], curatedCells?: CellDescription[], defaultPerspectiveZoomFactor?: number,
  defaultPosition?: {x: number, y: number, z: number},
}

export interface CellDescription {
  id: string,
  default?: boolean,
}

export interface LeaderboardEntry {
  name: string, score: number
}

export enum LeaderboardTimespan {
  Daily = 0,
  Weekly = 6
}

let viewer: Viewer | undefined;

function getLayerPanel(viewer: Viewer) {
  const groupViewerSingleton = viewer.layout.container.component;
  if (groupViewerSingleton instanceof SingletonLayerGroupViewer) {
    return groupViewerSingleton.layerGroupViewer.layerPanel;
  }

  return undefined;
}

function getLayerByName(name: string) {
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

export interface ViewerState {
  layers: string[],
  selectedLayer: string|undefined,
  sidebar: {
    open: boolean,
    width: number,
  }
};


export class AppStore extends createModule
({strict: false}) {
  sidebarOpen = false;

  loggedInUser: LoggedInUser|null = null;
  showDatasetChooser: boolean = false;
  showCellChooser: boolean = false;

  activeDataset: DatasetDescription|null = null;
  activeCells: CellDescription[] = [];

  activeDropdown: {[group: string]: number} = {};
  leaderboardEntries: LeaderboardEntry[] = [];
  leaderboardTimespan: LeaderboardTimespan = LeaderboardTimespan.Weekly;
  leaderboardLoaded: boolean = false;

  viewer: ViewerState = {
    layers: [],
    selectedLayer: undefined,
    sidebar: {
      open: false,
      width: 0,
    }
  };

  datasets: DatasetDescription[] = [
    {
      name: 'production',
      layers: [
        {
          type: 'image',
          source:
              'precomputed://gs://microns-seunglab/drosophila_v0/alignment/image_rechunked'
        },
        {
          type: 'segmentation_with_graph',
          source:
              'graphene://https://prodv1.flywire-daf.com/segmentation/1.0/fly_v31',
          defaultSelected: true,
        }
      ],
      curatedCells: [{
        id: '720575940650468481',
      }]
    },
    {
      name: 'sandbox',
      defaultPerspectiveZoomFactor: 6310,
      defaultPosition: {x: 158604, y: 72224, z: 2198},
      layers: [
        {
          type: 'image',
          source:
              'precomputed://gs://microns-seunglab/drosophila_v0/alignment/image_rechunked'
        },
        {
          name: 'sandbox-segmentation-FOR PRACTICE ONLY',
          type: 'segmentation_with_graph',
          source:
              'graphene://https://prodv1.flywire-daf.com/segmentation/1.0/fly_v26',
          defaultSelected: true,
        }
      ],
      curatedCells: [
        {
          id: '720575940625416797',
        },
        {
          id: '720575940637436173',
        },
        {
          id: "720575940615251979",
          default: true,
        },
        {
          id: "720575940610453042",
          default: true
        },
      ]
    }
  ];

  @action
  async initializeViewer(v: Viewer) {
    viewer = v;
    
    const layerPanel = getLayerPanel(v)!;
    layerPanel.selectedLayer.changed.add(() => {
      this.viewer.selectedLayer = layerPanel.selectedLayer.layer ? layerPanel.selectedLayer.layer.name : undefined;
      this.viewer.sidebar.open = layerPanel.selectedLayer.visible;
      // size has it's own changed signal but size changes also trigger selectedLayer.changed
      this.viewer.sidebar.width = layerPanel.selectedLayer.size.value;
    });

    v.layerManager.layersChanged.add(() => {
      this.viewer.layers = v.layerManager.managedLayers.map((layer) => layer.name);
    });
  }

  @action
  async loadActiveDataset() {
    const numberOfLayers = viewer!.layerManager.managedLayers.length;

    if (numberOfLayers > 0) {
      const firstLayerName =
          viewer!.layerManager.managedLayers[0].name.split('-')[0];
      for (let dataset of this.datasets) {
        if (dataset.name === firstLayerName) {
          // TODO, should check to see the layers are correct
          this.activeDataset = dataset;
          break;
        }
      }
    } else {
      // load sandbox with default view state
      if (this.datasets.length) {
        for (let dataset of this.datasets) {
          if (dataset.name == 'sandbox') {
            this.selectDataset(dataset);
          }
        }
      } else {
        StatusMessage.showTemporaryMessage(
            `There are no datasets avaliable.`, 10000, {color: 'yellow'});
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

    if (!this.activeDataset || !this.activeDataset.curatedCells) {
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
          for (let cell of this.activeDataset.curatedCells) {
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
  async toggleSidePanel(visible?: boolean) {
    const layerPanel = getLayerPanel(viewer!)!;

    if (visible === undefined) {
      layerPanel.selectedLayer.visible = !layerPanel.selectedLayer.visible;
    } else {
      layerPanel.selectedLayer.visible = visible;
    }
  }

  @action
  async selectDataset(dataset: DatasetDescription) {
    if (!viewer) {
      return false;
    }

    if (dataset.defaultPerspectiveZoomFactor !== undefined) {
      viewer.perspectiveNavigationState.zoomFactor.value = dataset.defaultPerspectiveZoomFactor;
    }

    if (dataset.defaultPosition !== undefined) {
      const {x, y, z} = dataset.defaultPosition;
      viewer.navigationState.position.setVoxelCoordinates(vec3.fromValues(x, y, z));
    }

    this.activeDataset = dataset;

    viewer.layerManager.clear();
    viewer.navigationState.position.spatialCoordinatesValid = false;

    for (let layerDesc of dataset.layers) {
      const layerName = layerDesc.name ? layerDesc.name : `${dataset.name}-${layerDesc.type}`;
      const layerWithSpec = viewer.layerSpecification.getLayer(layerName, layerDesc);
      viewer.layerManager.addManagedLayer(layerWithSpec);

      const {layer} = layerWithSpec;

      if (layerDesc.defaultSelected) {
        this.selectActiveLayer(layerName);
      }

      if (layer instanceof ImageUserLayer) {
        await layer.multiscaleSource; // wait because there is an error if both layers load at the same time?
      } else if (layer instanceof SegmentationUserLayer) {
        await layer.multiscaleSource;
        console.log('root segments callback 1');
        layer.displayState.rootSegments.changed.add(() => {
          console.log('root segments changed 1');
          this.refreshActiveCells();
        });
        this.refreshActiveCells();
      }
    }

    if (dataset.curatedCells) {
      for (let cell of dataset.curatedCells) {
        if (cell.default) {
          this.selectCell(cell);
        }
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
        await layer.multiscaleSource!;
        const uint64Id = new Uint64().parseString(cell.id, 10);
        layer.displayState.segmentSelectionState.set(uint64Id);
        layer.displayState.segmentSelectionState.setRaw(uint64Id);
        layer.selectSegment();
        return true;
      }
    }

    return false;
  }

  @action
  async fetchLoggedInUser() {
    const existingToken = localStorage.getItem('auth_token');
    const existingAuthURL = localStorage.getItem('auth_url');

    if (existingToken && existingAuthURL) {
      const authURL = new URL(existingAuthURL).origin;

      let res = await authFetch(`${authURL}/auth/api/v1/user/me`);
      let user = await res.json();
      let {name, email} = user;
      this.loggedInUser = {name, email};
    } else {
      this.loggedInUser = null;  // TODO - do I need this?
    }
  }

  @action
  async logout() {
    const existingToken = localStorage.getItem('auth_token');
    const existingAuthURL = localStorage.getItem('auth_url');

    if (existingToken && existingAuthURL) {
      const authURL = new URL(existingAuthURL).origin;

      await authFetch(`${authURL}/auth/api/v1/logout`).then(res => {
        return res.json();
      });

      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_url');

      authTokenShared!.value = null;

      this.loggedInUser = null;
    }
  }

  @action
  async loopUpdateLeaderboard() {
    await this.updateLeaderboard();
    await new Promise(() => setTimeout(this.loopUpdateLeaderboard, 20000));
  }

  @action
  async updateLeaderboard() {
    const goalTimespan = this.leaderboardTimespan;
    const url = config.leaderboardURL;
    const queryUrl = url + '?days=' + this.leaderboardTimespan;
    fetch(queryUrl).then(result => result.json()).then(async (json) => {
      if (this.leaderboardTimespan != goalTimespan) return;
      const newEntries = json.entries;
      this.leaderboardEntries.splice(0, this.leaderboardEntries.length);
      for (const entry of newEntries) {
        this.leaderboardEntries.push(entry);
      }
      this.leaderboardLoaded = true;
    });
  }

  @action
  async resetLeaderboard() {
    this.leaderboardLoaded = false;
    this.leaderboardEntries.splice(0, this.leaderboardEntries.length);
    return this.updateLeaderboard();
  }
}

import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(Vuex);

export const store = new Vuex.Store({
  modules: {...extractVuexModule(AppStore)},
});

export const storeProxy = createProxy(store, AppStore);
export {
  Vue
};  // vue app needs to be instantiated from this modified VueConstructor
