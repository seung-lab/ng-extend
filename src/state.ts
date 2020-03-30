import { createModule, action, createProxy, extractVuexModule } from "vuex-class-component";
import { authFetch, authTokenShared } from "neuroglancer/authentication/frontend";
import { SegmentationUserLayer } from "neuroglancer/segmentation_user_layer";
import { Uint64 } from "neuroglancer/util/uint64";

import {viewer} from "./main";

interface LoggedInUser {
  name: string;
  email: string;
}

interface LayerDescription {
  source: string,
  type: "image"|"segmentation"|"segmentation_with_graph"
}

export interface DatasetDescription {
  name: string,
  layers: LayerDescription[],
  curatedCells?: CellDescription[]
}

export interface CellDescription {
  id: string,
}

export interface LeaderboardEntry {
  name: string,
  score: number
}

export interface ChatMessage {
  type: string,
  name: string,
  time: string | undefined,
  message: string | undefined
}

class AppStore extends createModule({strict: false}) {
  loggedInUser: LoggedInUser|null = null;
  showDatasetChooser: boolean = false;
  showCellChooser: boolean = false;

  activeDataset: DatasetDescription|null = null;
  activeCells: CellDescription[] = [];

  activeDropdown: { [group: string]: number} = {};
  leaderboardEntries: LeaderboardEntry[] = [];
  chatMessages: ChatMessage[] = [];

  datasets: DatasetDescription[] = [
    {
      name: "production",
      layers: [
        {
          type: "image",
          source: "precomputed://gs://microns-seunglab/drosophila_v0/alignment/vector_fixer30_faster_v01/v4/image_stitch_v02"
        },
        {
          type: "segmentation_with_graph",
          source: "graphene://https://prodv1.flywire-daf.com/segmentation/1.0/fly_v31"
        }
      ],
      curatedCells: [
        {
          id: "720575940650468481",
        }
      ]
    },
    {
      name: "sandbox",
      layers: [
        {
          type: "image",
          source: "precomputed://gs://microns-seunglab/drosophila_v0/alignment/vector_fixer30_faster_v01/v4/image_stitch_v02"
        },
        {
          type: "segmentation_with_graph",
          source: "graphene://https://prodv1.flywire-daf.com/segmentation/1.0/fly_v26"
        }
      ],
      curatedCells: [
        {
          id: "720575940625416797",
        },
        {
          id: "720575940637436173",
        },
      ]
    }
  ];

  @action async loadActiveDataset() {
    const numberOfLayers = viewer!.layerManager.managedLayers.length;

    if (numberOfLayers > 0) {
      const firstLayerName = viewer!.layerManager.managedLayers[0].name.split('-')[0];
      for (let dataset of this.datasets) {
        if (dataset.name === firstLayerName) {
          // TODO, should check to see the layers are correct
          this.activeDataset = dataset;
          break;
        }
      }
    } else {
      storeProxy.showDatasetChooser = true;
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

  @action async refreshActiveCells() {
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

  @action async selectDataset(dataset: DatasetDescription) {
    if (!viewer) {
      return false;
    }

    this.activeDataset = dataset;

    viewer.layerManager.clear();
    viewer.navigationState.position.spatialCoordinatesValid = false;

    for (let layerDesc of dataset.layers) {
      const layerWithSpec = viewer.layerSpecification.getLayer(`${dataset.name}-${layerDesc.type}`, layerDesc);
      viewer.layerManager.addManagedLayer(layerWithSpec);

      const {layer} = layerWithSpec;

      if (layer instanceof SegmentationUserLayer) {
        await layer.multiscaleSource!;
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

  @action async selectCell(cell: CellDescription) {
    if (!viewer) {
      return false;
    }

    console.log('selectCell');
    const layers = viewer.layerManager.managedLayers;

    for (const {layer} of layers) {
      if (layer instanceof SegmentationUserLayer) {
        console.log('we have a seg layer');
        console.log('want to select cell', cell.id);
        await layer.multiscaleSource!;
        const uint64Id = new Uint64().parseString(cell.id, 10);
        layer.displayState.segmentSelectionState.set(uint64Id);
        layer.displayState.segmentSelectionState.setRaw(uint64Id);
        layer.selectSegment();
        console.log('selectedCell', cell.id);
        return true;
      }
    }

    return false;
  }

  @action async fetchLoggedInUser() {
    const existingToken = localStorage.getItem("auth_token");
    const existingAuthURL = localStorage.getItem("auth_url");

    if (existingToken && existingAuthURL) {
      const authURL = new URL(existingAuthURL).origin;

      let res = await authFetch(`${authURL}/auth/api/v1/user/me`);
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
      const authURL = new URL(existingAuthURL).origin;

      await authFetch(`${authURL}/auth/api/v1/logout`).then(res => {
        return res.json();
      });

      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_url");

      authTokenShared!.value = null;

      this.loggedInUser = null;
    }
  }

  @action async updateLeaderboard() {
    const url = 'https://pyrdev.eyewire.org/pyr-backend';
    //const url = 'http://localhost:9000';
    fetch(url).then(result => result.json()).then(async (json) => {
      const newEntries = json.entries;
      this.leaderboardEntries.splice(0, this.leaderboardEntries.length);
      for (const entry of newEntries) {
        this.leaderboardEntries.push(entry);
      }
    });

    await new Promise(() => setTimeout(this.updateLeaderboard, 20000));
  }

  @action async joinChat() {
    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    await this.fetchLoggedInUser();
    const joinMessage = JSON.stringify({
      type: 'join',
      name: this.loggedInUser ? this.loggedInUser.name : 'Guest'
    });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(joinMessage);
    } else {
      ws.onopen = () => { ws.send(joinMessage); };
    }
  }

  @action async handleMessage(message: any) {
    const messageObj: ChatMessage = JSON.parse(message);
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
    messageObj.time = time;

    if (messageObj.type === 'message') {
      const numMessages = this.chatMessages.length;
      let addInfo = true;
      if (numMessages > 0) {
        const lastMessage = this.chatMessages[numMessages - 1];
        if (lastMessage.type.startsWith('message') && lastMessage.name === messageObj.name) {
          addInfo = false;
        }
      }
      if (addInfo) {
        const senderInfo: ChatMessage = { type: 'sender', name: messageObj.name, time: messageObj.time, message: undefined };
        this.chatMessages.push(senderInfo);
      }

      // split message up into text and links
      const messageParts = messageObj.message!.split(/(https?:\/\/\S+)/);
      console.log(messageParts);
      for (let i = 0; i < messageParts.length; i++) {
        const messagePart: ChatMessage = {
          type: i % 2 === 0 ? 'messagePart' : 'messageLink',
          message: messageParts[i],
          name: messageObj.name,
          time: messageObj.time
        }
        this.chatMessages.push(messagePart);
      }
      messageObj.type = 'messageEnd';
    }
    
    this.chatMessages.push(messageObj);

    // scroll to bottom of message box (once vue updates the page)
    Vue.nextTick(() => {
      const messageBox = <HTMLElement>document.querySelector('.nge-chatbox-messages');
      messageBox.scrollTo(0, messageBox.scrollHeight);
    });
  }
}

import Vue from 'vue';
import Vuex from 'vuex';
import ws from './chat_socket';
Vue.use(Vuex);

export const store = new Vuex.Store({
  modules: {
    ...extractVuexModule(AppStore)
  },
});

export const storeProxy = createProxy(store, AppStore);
export {Vue}; // vue app needs to be instantiated from this modified VueConstructor
