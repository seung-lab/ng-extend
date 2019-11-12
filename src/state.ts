import { createModule, action, createProxy, extractVuexModule } from "vuex-class-component";
import { authFetch, authTokenShared } from "neuroglancer/authentication/frontend";

import {viewer} from "./main";

interface LoggedInUser {
  name: string;
  email: string;
}

interface Layer {
  source: string,
  type: "image"|"segmentation"|"segmentation_with_graph"
}

export interface Dataset {
  name: string,
  layers: Layer[],
  active: boolean,
}

class AppStore extends createModule({strict: false}) {
  loggedInUser: LoggedInUser|null = null;
  showDatasetChooser: boolean = false;

  datasets: Dataset[] = [
    {
      name: "production",
      active: false,
      layers: [
        {
          type: "image",
          source: "precomputed://gs://microns-seunglab/drosophila_v0/alignment/vector_fixer30_faster_v01/v4/image_stitch_v02"
        },
        {
          type: "segmentation_with_graph",
          source: "graphene://https://fafbv2.dynamicannotationframework.com/segmentation/1.0/fly_v31"
        }
      ]
    },
    {
      name: "sandbox",
      active: false,
      layers: [
        {
          type: "image",
          source: "precomputed://gs://microns-seunglab/drosophila_v0/alignment/vector_fixer30_faster_v01/v4/image_stitch_v02"
        },
        {
          type: "segmentation_with_graph",
          source: "graphene://https://fafbv2.dynamicannotationframework.com/segmentation/1.0/fly_v26"
        }
      ]
    }
  ];

  @action async loadActiveDataset() {
    const numberOfLayers = viewer!.layerManager.managedLayers.length;

    if (numberOfLayers > 0) {
      const firstLayerName = viewer!.layerManager.managedLayers[0].name.split('-')[0];
      for (let datasets of this.datasets) {
        if (datasets.name === firstLayerName) {
          // TODO, should check to see the layers are correct
          datasets.active = true;

          // force update
          this.datasets = this.datasets;
          break;
        }
      }
    } else {
      storeProxy.showDatasetChooser = true;
    }
  }

  @action async selectDataset(dataset: Dataset) {
    if (!viewer) {
      return false;
    }

    for (let v of this.datasets.values()) {
      v.active = false;
    }
    dataset.active = true;
    // force update
    this.datasets = this.datasets;

    viewer.layerManager.clear();
    viewer.navigationState.position.spatialCoordinatesValid = false;

    for (let layer of dataset.layers) {
      viewer.layerManager.addManagedLayer(viewer.layerSpecification.getLayer(`${dataset.name}-${layer.type}`, {
        source: layer.source,
        type: layer.type,
      }));
    }

    return true;
  }

  @action async fetchLoggedInUser() {
    const existingToken = localStorage.getItem("auth_token");
    const existingAuthURL = localStorage.getItem("auth_url");

    if (existingToken && existingAuthURL) {
      let res = await authFetch(`https://${existingAuthURL}/user/me`);
      let user = await res.json();
      let {name, email} = user;
      this.loggedInUser = {name, email};
    } else {
      this.loggedInUser = null; // TODO - do I need this?
    }
  }

  @action async logout() {
    const existingToken = localStorage.getItem("auth_token");
    const existingAuthURL = localStorage.getItem("auth_url");

    if (existingToken && existingAuthURL) {
      await authFetch(`https://${existingAuthURL}/logout`).then(res => {
        return res.json();
      });

      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_url");

      authTokenShared!.value = null;

      this.loggedInUser = null;
    }
  }
}

import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(Vuex);

export const store = new Vuex.Store({
  modules: {
    ...extractVuexModule(AppStore)
  },
});

export const storeProxy = createProxy(store, AppStore);
export {Vue}; // vue app needs to be instantiated from this modified VueConstructor
