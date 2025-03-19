import { Ref, ref, reactive } from "vue";
import { defineStore } from "pinia";

import { Viewer } from "neuroglancer/unstable/viewer.js";
import { getDefaultCredentialsManager } from "neuroglancer/unstable/credentials_provider/default_manager.js";
import { MiddleAuthCredentialsProvider } from "neuroglancer/unstable/kvstore/middleauth/credentials_provider.js";

import { Config } from "#src/config.js";
import { getHttpSource } from "neuroglancer/unstable/datasource/graphene/base.js";

declare const CONFIG: Config | undefined;

export const useDropdownListStore = defineStore("dropdownlist", () => {
  let dropdownCount = 0;

  const activeDropdowns = reactive(
    {} as { [group: string]: number | undefined }
  );

  function getDropdownId() {
    dropdownCount++;
    return dropdownCount;
  }

  return { getDropdownId, activeDropdowns };
});

export interface loginSession {
  id: number;
  key: string;
  name: string;
  email: string;
  hostname: string;
  status?: number;
}

const defaultCredentialsManager = getDefaultCredentialsManager();

export const useLoginStore = defineStore("login", () => {
  const TOKEN_PREFIX = "auth_token_v2_";

  async function logout(session: loginSession) {
    window.localStorage.removeItem(session.key);
    const login_url = session.key.split(TOKEN_PREFIX)[1] as string | undefined;
    if (!login_url) return;
    const provider = defaultCredentialsManager.getCredentialsProvider(
      "middleauth",
      login_url
    ) as MiddleAuthCredentialsProvider;
    if (provider) {
      provider.updateCachedGet();
    }
    sessions.value = sessions.value.filter((x) => x.key !== session.key);
  }

  async function update() {
    const localStorageKeys: string[] = [];
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(TOKEN_PREFIX)) {
        localStorageKeys.push(key);
      }
    }

    const newSessions: loginSession[] = [];

    for (const key of localStorageKeys) {
      const login_url = key.split(TOKEN_PREFIX)[1] as string | undefined;
      if (!login_url) continue;
      const provider = defaultCredentialsManager.getCredentialsProvider(
        "middleauth",
        login_url
      ) as MiddleAuthCredentialsProvider;
      if (!provider) continue;

      const dataString = localStorage.getItem(key);
      if (!dataString) {
        return;
      }
      const data = JSON.parse(dataString);
      const { hostname } = new URL(data.url);

      try {
        const res = await fetch(data.url + "/api/v1/user/me", {
          headers: {
            Authorization: `Bearer ${data.accessToken}`,
          },
        });
        if (res.status === 200) {
          const contentType = res.headers.get("content-type");
          const message = await (contentType === "application/json"
            ? res.json()
            : res.text());
          const { id, name, email } = message;
          newSessions.push({
            id,
            key,
            name,
            email,
            hostname,
          });
        } else {
          newSessions.push({
            id: 0,
            key,
            name: "",
            email: "",
            hostname,
            status: res.status,
          });
        }
      } catch (e) {
        e;
        // newSessions.push({
        //   name: '',
        //   email: '',
        //   hostname,
        //   error: e,
        // });
      }
    }

    sessions.value = newSessions;
  }
  const sessions: Ref<loginSession[]> = ref([]);
  return { sessions, update, logout };
});

export interface Volume {
  name: string;
  description: string;
  image_layers: Layer[];
  segmentation_layers: Layer[];
}

interface Layer {
  source: string[];
  ngl_image_name?: string;
  name: string;
  description: string;
  type: string;
  skeleton_source?: string;
}

export const useLayersStore = defineStore("layers", () => {
  const activeLayers: Set<string> = reactive(new Set());

  let viewer: Viewer | undefined = undefined;

  function refreshLayers() {
    if (!viewer) return;
    activeLayers.clear();
    const layers = viewer.layerManager.managedLayers;
    for (const layer of layers) {
      if (!layer.layer) {
        console.log("does this ever happen?");
        continue;
      }
      const dataSources = layer.layer.dataSources;
      for (const source of dataSources) {
        activeLayers.add(source.spec.url);
      }
    }
  }

  function initializeWithViewer(v: Viewer) {
    viewer = v;

    viewer.displayDimensions.changed.add(() => {
      console.log(
        "viewer.displayDimensions.changed",
        viewer!.displayDimensions.value
      );
    });

    viewer.layerManager.layersChanged.add(refreshLayers);
    refreshLayers();
  }

  async function selectLayers(layers: Layer[]) {
    if (!viewer) return;
    layers = layers.map((x) => {
      return { ...x, name: `${x.name} (${x.type})` };
    });
    viewer.layerSpecification.restoreState(layers);
    viewer.navigationState.reset();
    const imageLayer = viewer.layerManager.managedLayers.filter(
      (x) => x.name === "img"
    )[0];
    if (imageLayer) {
      const stopListening = imageLayer.readyStateChanged.add(() => {
        if (imageLayer.isReady() && imageLayer.layer) {
          const { dataSources } = imageLayer.layer;
          stopListening();
          if (dataSources.length) {
            const { loadState } = dataSources[0];
            if (loadState !== undefined && loadState.error === undefined) {
              loadState;
              const { scales } = loadState.transform.outputSpace.value;
              viewer!.coordinateSpace.restoreState({
                x: [scales[0], "m"],
                y: [scales[1], "m"],
                z: [scales[2], "m"],
              });
            }
          }
        }
      });
    }
  }

  return { initializeWithViewer, activeLayers, selectLayers };
});

export const useVolumesStore = defineStore("volumes", () => {
  const volumes: Ref<Volume[]> = ref([]);

  async function loadVolumes(viewer: Viewer) {
    if (!CONFIG || !CONFIG.volumes_url) return;
    const { kvStoreContext } = viewer.dataSourceProvider.sharedKvStoreContext;
    const httpSource = getHttpSource(kvStoreContext, CONFIG.volumes_url);
    const { fetchOkImpl, baseUrl } = httpSource;
    const response = await fetchOkImpl(baseUrl).then((response) =>
      response.json()
    );

    for (const [key, value] of Object.entries(response as any)) {
      if (CONFIG.volumes_enabled && !CONFIG.volumes_enabled.includes(key)) {
        continue;
      }
      volumes.value.push({
        name: key,
        description: (value as any).description,
        image_layers: (value as any).image_layers.map((x: any) => {
          x.type = "image";
          x.source = [x.image_source];
          return x;
        }),
        segmentation_layers: (value as any).segmentation_layers.map(
          (x: any) => {
            x.type = "segmentation";
            x.source = [x.segmentation_source];
            if (x.skeleton_source) {
              x.source.push(x.skeleton_source);
            }
            return x;
          }
        ),
      });
    }

    const layerStore = useLayersStore();

    if (
      layerStore.activeLayers.size === 0 ||
      (layerStore.activeLayers.size === 1 && layerStore.activeLayers.has(""))
    ) {
      if (CONFIG.volumes_default) {
        const volume = volumes.value.find(
          (x) => x.name === CONFIG.volumes_default?.name
        );

        if (volume) {
          const imageLayer = volume.image_layers.find(
            (x) => x.name === CONFIG.volumes_default?.image
          );
          const segmentationLayer = volume.segmentation_layers.find(
            (x) => x.name === CONFIG.volumes_default?.segmentation
          );

          if (imageLayer && segmentationLayer) {
            layerStore.selectLayers([imageLayer, segmentationLayer]);
          }
        }
      }
    }
  }

  return { loadVolumes, volumes };
});
