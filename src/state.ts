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
  id: number;
  joinDate: string;
  admin: boolean;
}

interface LayerDescription {
  source: string,
  type: 'image'|'segmentation'|'segmentation_with_graph',
  name?: string,
  defaultSelected?: boolean,
}

export interface Vector3 {
  x: number,
  y: number,
  z: number,
}

export interface DatasetDescription {
  name: string, description: string, color?: string, 
  layers: LayerDescription[], curatedCells?: CellDescription[], defaultPerspectiveZoomFactor?: number, defaultPosition?: Vector3,
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

export interface UserInfo {
  editsToday: number, editsThisWeek: number, editsAllTime: number
}

export interface ActionsMenuItem {
  text: string,
  click(): void
}

export let viewer: Viewer | undefined;

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


export class AppStore extends createModule({strict: false, enableLocalWatchers: true,}) {
  sidebarOpen = false;

  loggedInUser: LoggedInUser|null|undefined = undefined; // undefined = fetchLoggedInUser hasn't returned yet 
  showDatasetChooser: boolean = false;
  showCellChooser: boolean = false;
  showResetConfirm: boolean = false;
  showAdminPanel: boolean = false;

  activeDataset: DatasetDescription|null = null;
  activeCells: CellDescription[] = [];

  loadedViewer: boolean = false;
  finishedLoading: boolean = false;
  activeDropdown: {[group: string]: number} = {};
  actionsMenuItems: ActionsMenuItem[] = [];
  leaderboardEntries: LeaderboardEntry[] = [];
  leaderboardTimespan: LeaderboardTimespan = LeaderboardTimespan.Weekly;
  leaderboardLoaded: boolean = false;
  userInfo: UserInfo = {editsToday: 0, editsThisWeek: 0, editsAllTime: 0};

  introductionStep: number = parseInt(localStorage.getItem('nge-introduction-step') || '0');

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
      name: 'Sandbox',
      description: 'A practice dataset. Cell edits are visible to all, but user mistakes don\'t matter here.',
      color: '#E6C760',
      defaultPerspectiveZoomFactor: 79,
      defaultPosition: {x: 158581, y: 72226, z: 2189},
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
    },
    {
      name: 'Production',
      description: 'The "real" dataset, accessible after you pass the test. Cell edits all contribute to one high quality dataset.',
      defaultPerspectiveZoomFactor: 79,
      defaultPosition: {x: 158581, y: 72226, z: 2189},
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
      curatedCells: [
        {
          id: "720575940621039145",
          default: true,
        },
        {
          id: "720575940626877799",
          default: true
        },
      ]
    }
  ];

  static $watch = {
    introductionStep(newVal: number) {
      localStorage.setItem('nge-introduction-step', JSON.stringify(newVal));
    }
  }

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
          if (dataset.name === 'Sandbox') {
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
  async set2dPosition({x, y, z}: Vector3) {
    if (viewer) {
      viewer.navigationState.position.setVoxelCoordinates(vec3.fromValues(x, y, z));
      // viewer.navigationState.position.spatialCoordinatesValid = false; TODO what was this for? seems to cause issues
    }
  }

  @action
  async selectDataset(dataset: DatasetDescription) {
    if (!viewer) {
      return false;
    }

    viewer.layerManager.clear();
    viewer.navigationState.reset();
    viewer.perspectiveNavigationState.reset();

    this.activeDataset = dataset;

    if (dataset.defaultPosition) {
      this.set2dPosition(dataset.defaultPosition);
    }
    if (dataset.defaultPerspectiveZoomFactor !== undefined) {
      viewer.perspectiveNavigationState.zoomFactor.value = dataset.defaultPerspectiveZoomFactor;
    }

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
        if (dataset.curatedCells) {
          for (let cell of dataset.curatedCells) {
            if (cell.default) {
              this.selectCell(cell);
            }
          }
        }

        await layer.multiscaleSource;
        console.log('root segments callback 1');
        layer.displayState.rootSegments.changed.add(() => {
          console.log('root segments changed 1');
          this.refreshActiveCells();
        });
        this.refreshActiveCells();
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
        layer.displayState.rootSegments.add(new Uint64().parseString(cell.id, 10));
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
      let {name, email, id, created, admin} = user;
      const createdTime = new Date(created);
      const joinDate = createdTime.toLocaleDateString('en-US');
      this.loggedInUser = {name, email, id, joinDate, admin};
      this.updateUserInfo();
    } else {
      this.loggedInUser = null;
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
    await this.updateUserInfo();
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

  @action
  async updateUserInfo() {
    if (!this.loggedInUser) return;
    const url = config.leaderboardURL + '/userInfo?userID=' + this.loggedInUser!.id;
    fetch(url).then(result => result.json()).then(async (json) => {
      this.userInfo = json;
    });
  }

  @action
  async rollbackUserID(userID: string) {
    const existingToken = localStorage.getItem('auth_token');
    const existingAuthURL = localStorage.getItem('auth_url');

    if (existingToken && existingAuthURL) {
      const authURL = new URL(existingAuthURL).origin;
      const res = await authFetch(`${authURL}/auth/api/v1/user?id=${userID}`);
      const json = await res.json();
      const name = json[0].name;
      const email = json[0].email;
      if (confirm("Rollback training edits for user " + name + " (" + email + ")?")) {
        console.log("Rollback user", userID); //TODO send a rollback request with the current authtoken to the proctor
      }
    }
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
